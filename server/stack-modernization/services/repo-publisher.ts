/**
 * Repository Publisher
 * Publishes upgraded code + generated tests to Azure DevOps using the ADO REST API.
 */

import type { StackModernizationState } from "../types";

export interface PublishResult {
  success: boolean;
  repoUrl?: string;
  branchName?: string;
  commitSha?: string;
  errors?: string[];
}

export interface PublishOptions {
  provider: "azure-devops" | "github";
  orgName: string;
  orgUrl?: string;
  projectName: string;
  repoName: string;
  repositoryId?: string;
  branchName?: string;
  commitMessage?: string;
  accessToken?: string;
  targetPath?: string;
}

/**
 * Collect ALL publishable files: full original repo with upgraded files overlaid + generated tests.
 * Each file has { path, content } with path relative to project root.
 */
function collectFiles(state: StackModernizationState, targetPath?: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const prefix = targetPath ? (targetPath.endsWith("/") ? targetPath : targetPath + "/") : "";

  // Build a map of upgraded files for O(1) lookup with suffix matching
  const modifiedFiles = state.modifiedFiles ?? (state as any).codeUpgrade?.modifiedFiles ?? [];
  const upgradedMap = new Map<string, string>();
  for (const f of modifiedFiles) {
    const filePath = ((f as any).path ?? (f as any).filePath ?? "").replace(/\\/g, "/");
    const content = (f as any).content ?? (f as any).modifiedContent;
    if (filePath && content != null) {
      upgradedMap.set(filePath, String(content));
    }
  }

  function findUpgraded(extractedPath: string): string | undefined {
    const normalized = extractedPath.replace(/\\/g, "/");
    if (upgradedMap.has(normalized)) return upgradedMap.get(normalized);
    const lower = normalized.toLowerCase();
    for (const [modPath, modContent] of upgradedMap) {
      const modNorm = modPath.replace(/\\/g, "/");
      if (modNorm.toLowerCase() === lower) return modContent;
      if (lower.endsWith("/" + modNorm.toLowerCase()) || modNorm.toLowerCase().endsWith("/" + lower)) return modContent;
    }
    return undefined;
  }

  // Add ALL extracted files, overlaying upgraded content where available
  const extractedFiles = state.extractedFiles ?? [];
  const addedPaths = new Set<string>();
  for (const f of extractedFiles) {
    const filePath = ((f as any).relativePath ?? (f as any).path ?? "").replace(/\\/g, "/");
    if (!filePath) continue;
    const upgraded = findUpgraded(filePath);
    const content = upgraded ?? (f as any).content ?? "";
    if (content) {
      files.push({ path: `${prefix}${filePath}`, content: String(content) });
      addedPaths.add(filePath.toLowerCase());
    }
  }

  // Add any new files from the upgrade that weren't in the original repo
  for (const [filePath, content] of upgradedMap) {
    if (!addedPaths.has(filePath.toLowerCase())) {
      files.push({ path: `${prefix}${filePath}`, content });
    }
  }

  // Generated test files
  const generatedTests = state.generatedTests ?? [];
  for (const t of generatedTests) {
    const filePath = (t as any).filePath ?? (t as any).path;
    const content = (t as any).testCode ?? (t as any).content ?? (t as any).code;
    if (filePath && content != null) {
      files.push({ path: `${prefix}${filePath}`, content: String(content) });
    }
  }

  return files;
}

/**
 * Publish upgraded code to remote repository.
 */
export async function publishToRepository(
  state: StackModernizationState,
  options: PublishOptions
): Promise<PublishResult> {

  try {
    if (options.provider === "azure-devops") {
      return await publishToAzureDevOps(state, options);
    } else if (options.provider === "github") {
      return await publishToGitHub(state, options);
    } else {
      throw new Error(`Unsupported provider: ${options.provider}`);
    }
  } catch (error) {
    console.error(`[RepoPublisher] Publishing failed:`, error);
    return {
      success: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Publish to Azure DevOps using the REST API (pushMultipleFiles).
 */
async function publishToAzureDevOps(
  state: StackModernizationState,
  options: PublishOptions
): Promise<PublishResult> {
  const { AzureDevOpsService } = await import("../../azure-devops-service");

  const pat = options.accessToken || process.env.ADO_PAT || "";
  if (!pat) throw new Error("No ADO PAT available (neither in options nor in ADO_PAT env var)");

  const orgName = options.orgName;
  const adoService = new AzureDevOpsService({
    organization: orgName,
    project: options.projectName,
    pat,
  });

  const files = collectFiles(state, options.targetPath);
  if (files.length === 0) throw new Error("No files to publish");

  const branchName = options.branchName || `devx-upgrade-${Date.now()}`;
  const commitMessage =
    options.commitMessage ||
    `DevX Stack Modernization: ${files.length} file(s) upgraded`;


  const result = await adoService.pushMultipleFiles({
    repositoryId: options.repositoryId,
    repositoryName: options.repoName,
    branchName,
    files,
    commitMessage,
    authorName: "DevX Automation",
  });

  return {
    success: true,
    repoUrl: `https://dev.azure.com/${orgName}/${options.projectName}/_git/${options.repoName}?version=GB${branchName}`,
    branchName,
    commitSha: result.commitId,
  };
}

/**
 * Publish to GitHub (fallback using git CLI for GitHub).
 */
async function publishToGitHub(
  state: StackModernizationState,
  options: PublishOptions
): Promise<PublishResult> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const os = await import("os");
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const accessToken = options.accessToken;
  if (!accessToken) throw new Error("GitHub publishing requires an access token");

  const gitDir = path.join(os.tmpdir(), `git-publish-${Date.now()}`);
  await fs.mkdir(gitDir, { recursive: true });

  try {
    await execAsync("git init", { cwd: gitDir });
    await execAsync(`git config user.email "devx@automation.local"`, { cwd: gitDir });
    await execAsync(`git config user.name "DevX Automation"`, { cwd: gitDir });

    const files = collectFiles(state, options.targetPath);
    if (files.length === 0) throw new Error("No files to publish");

    for (const file of files) {
      const filePath = path.join(gitDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.content, "utf-8");
    }

    const branchName = options.branchName || `devx-upgrade-${Date.now()}`;
    await execAsync(`git checkout -b ${branchName}`, { cwd: gitDir });

    const commitMessage = options.commitMessage || `DevX Stack Modernization: ${files.length} file(s) upgraded`;
    await execAsync("git add .", { cwd: gitDir });
    await execAsync(`git commit -m "${commitMessage}"`, { cwd: gitDir });

    const remoteUrl = `https://${accessToken}@github.com/${options.orgName}/${options.repoName}.git`;
    await execAsync(`git remote add origin ${remoteUrl}`, { cwd: gitDir });

    try {
      await execAsync(`git push -u origin ${branchName}`, { cwd: gitDir, timeout: 60000 });
    } catch {
      await execAsync(`git push -u origin ${branchName} --force`, { cwd: gitDir, timeout: 60000 });
    }

    const { stdout: commitSha } = await execAsync("git rev-parse HEAD", { cwd: gitDir });
    await fs.rm(gitDir, { recursive: true, force: true });

    return {
      success: true,
      repoUrl: `https://github.com/${options.orgName}/${options.repoName}/tree/${branchName}`,
      branchName,
      commitSha: commitSha.trim(),
    };
  } catch (error) {
    await fs.rm(gitDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
