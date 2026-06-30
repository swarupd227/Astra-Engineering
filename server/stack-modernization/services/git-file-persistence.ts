import { AdoGitStorage } from "../../services/ado-git-service";
import type { IGitStorage } from "../../services/git-storage-interface";

const MOD_BASE = "_modernization";
const SOURCE_DIR = `${MOD_BASE}/source-files`;
const MODIFIED_DIR = `${MOD_BASE}/modified-files`;
const ORIGINAL_DIR = `${MOD_BASE}/original-files`;
const TESTS_DIR = `${MOD_BASE}/generated-tests`;
const REPORTS_DIR = `${MOD_BASE}/reports`;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

async function pushWithRetry(
  storage: IGitStorage,
  files: Array<{ path: string; content: string }>,
  commitMessage: string,
  label: string,
): Promise<void> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await storage.pushMultipleFiles(files, "", commitMessage);
      return;
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || String(err);
      console.warn(`[git-file-persistence] ${label} push attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${msg}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

async function verifyPushLanded(storage: IGitStorage, dirPath: string): Promise<boolean> {
  try {
    const entries = await storage.listDirectoryContents(dirPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export function sanitizeBranchSegment(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export function buildBranchName(
  adoOrg: string,
  adoProjectName: string,
  analysisId: string,
): string {
  const org = sanitizeBranchSegment(adoOrg);
  const project = sanitizeBranchSegment(adoProjectName);
  return `devx/mod/${org}/${project}/${analysisId}`;
}

export async function resolveGitStorageForAnalysis(
  adoOrg: string,
  adoProjectName: string,
  analysisId: string,
  adoConfig: {
    organization: string;
    project: string;
    pat: string;
    repositoryId?: string;
    repositoryName?: string;
  },
): Promise<{ storage: IGitStorage; branch: string }> {
  const branch = buildBranchName(adoOrg, adoProjectName, analysisId);
  const storage = new AdoGitStorage({ ...adoConfig, branch });
  return { storage, branch };
}

export async function pushModifiedFilesToGit(
  storage: IGitStorage,
  modifiedFiles: Array<{
    path: string;
    content: string;
    originalContent?: string;
  }>,
  commitMessage?: string,
): Promise<number> {
  try {
    const files: Array<{ path: string; content: string }> = [];

    for (const f of modifiedFiles) {
      files.push({ path: `${MODIFIED_DIR}/${f.path}`, content: f.content });
      if (f.originalContent !== undefined) {
        files.push({
          path: `${ORIGINAL_DIR}/${f.path}`,
          content: f.originalContent,
        });
      }
    }

    if (files.length === 0) return 0;

    await pushWithRetry(
      storage,
      files,
      commitMessage ?? "Add modernization modified files",
      "modified-files",
    );
    return modifiedFiles.length;
  } catch (err: any) {
    console.error("[git-file-persistence] Failed to push modified files after retries:", err?.message || err);
    return 0;
  }
}

export async function pushTestFilesToGit(
  storage: IGitStorage,
  generatedTests: Array<{ filePath: string; testCode: string }>,
  commitMessage?: string,
): Promise<number> {
  try {
    if (generatedTests.length === 0) return 0;

    const files = generatedTests.map((t) => ({
      path: `${TESTS_DIR}/${t.filePath}`,
      content: t.testCode,
    }));

    await pushWithRetry(
      storage,
      files,
      commitMessage ?? "Add modernization generated tests",
      "test-files",
    );
    return generatedTests.length;
  } catch (err: any) {
    console.error("[git-file-persistence] Failed to push test files after retries:", err?.message || err);
    return 0;
  }
}

export async function pushReportsToGit(
  storage: IGitStorage,
  reports: Record<string, string>,
  commitMessage?: string,
): Promise<number> {
  try {
    const entries = Object.entries(reports);
    if (entries.length === 0) return 0;

    const files = entries.map(([name, content]) => ({
      path: `${REPORTS_DIR}/${name}`,
      content,
    }));

    await pushWithRetry(
      storage,
      files,
      commitMessage ?? "Add modernization reports",
      "reports",
    );
    return entries.length;
  } catch (err: any) {
    console.error("[git-file-persistence] Failed to push reports after retries:", err?.message || err);
    return 0;
  }
}

export async function pushExtractedFilesToGit(
  storage: IGitStorage,
  extractedFiles: Array<{ relativePath: string; content: string }>,
  commitMessage?: string,
): Promise<number> {
  try {
    if (extractedFiles.length === 0) return 0;

    const MAX_BATCH = 200;
    let pushed = 0;

    for (let i = 0; i < extractedFiles.length; i += MAX_BATCH) {
      const batch = extractedFiles.slice(i, i + MAX_BATCH);
      const files = batch.map((f) => ({
        path: `${SOURCE_DIR}/${f.relativePath}`,
        content: f.content,
      }));

      const batchNum = Math.floor(i / MAX_BATCH) + 1;
      await pushWithRetry(
        storage,
        files,
        commitMessage ?? `[DevX] Source files batch ${batchNum}`,
        `source-files-batch-${batchNum}`,
      );
      pushed += batch.length;
    }

    const verified = await verifyPushLanded(storage, SOURCE_DIR);
    if (!verified) {
      console.error(`[git-file-persistence] Source files push completed but verification FAILED — files may be missing on branch`);
    }

    return pushed;
  } catch (err: any) {
    console.error("[git-file-persistence] Failed to push extracted files after retries:", err?.message || err);
    return 0;
  }
}

async function listFilesRecursively(
  storage: IGitStorage,
  dirPath: string,
): Promise<Array<{ name: string; path: string }>> {
  const entries = await storage.listDirectoryContents(dirPath);
  const results: Array<{ name: string; path: string }> = [];

  for (const entry of entries) {
    if (entry.type === "file") {
      results.push({ name: entry.name, path: entry.path });
    } else if (entry.type === "dir") {
      const nested = await listFilesRecursively(storage, entry.path);
      results.push(...nested);
    }
  }

  return results;
}

function stripPrefix(fullPath: string, prefix: string): string {
  const normalized = fullPath.startsWith("/") ? fullPath.slice(1) : fullPath;
  const normalizedPrefix = prefix.startsWith("/")
    ? prefix.slice(1)
    : prefix;
  if (normalized.startsWith(normalizedPrefix + "/")) {
    return normalized.slice(normalizedPrefix.length + 1);
  }
  return normalized;
}

export async function loadFilesFromGit(storage: IGitStorage): Promise<{
  modifiedFiles: Array<{
    path: string;
    content: string;
    originalContent?: string;
  }>;
  generatedTests: Array<{ filePath: string; testCode: string }>;
  reports: Record<string, string>;
  extractedFiles: Array<{ relativePath: string; content: string }>;
}> {
  const empty = { modifiedFiles: [], generatedTests: [], reports: {}, extractedFiles: [] };

  try {
    const modifiedMap = new Map<
      string,
      { content: string; originalContent?: string }
    >();

    try {
      const modFiles = await listFilesRecursively(storage, MODIFIED_DIR);
      for (const f of modFiles) {
        const content = await storage.getFileContent(f.path);
        const relativePath = stripPrefix(f.path, MODIFIED_DIR);
        modifiedMap.set(relativePath, { content });
      }
    } catch {
      // directory doesn't exist — leave empty
    }

    try {
      const origFiles = await listFilesRecursively(storage, ORIGINAL_DIR);
      for (const f of origFiles) {
        const content = await storage.getFileContent(f.path);
        const relativePath = stripPrefix(f.path, ORIGINAL_DIR);
        const existing = modifiedMap.get(relativePath);
        if (existing) {
          existing.originalContent = content;
        } else {
          modifiedMap.set(relativePath, {
            content: "",
            originalContent: content,
          });
        }
      }
    } catch {
      // directory doesn't exist
    }

    const modifiedFiles = Array.from(modifiedMap.entries()).map(
      ([path, data]) => ({ path, ...data }),
    );

    let generatedTests: Array<{ filePath: string; testCode: string }> = [];
    try {
      const testFiles = await listFilesRecursively(storage, TESTS_DIR);
      generatedTests = await Promise.all(
        testFiles.map(async (f) => {
          const testCode = await storage.getFileContent(f.path);
          const filePath = stripPrefix(f.path, TESTS_DIR);
          return { filePath, testCode };
        }),
      );
    } catch {
      // directory doesn't exist
    }

    const reports: Record<string, string> = {};
    try {
      const reportFiles = await listFilesRecursively(storage, REPORTS_DIR);
      for (const f of reportFiles) {
        const content = await storage.getFileContent(f.path);
        const name = stripPrefix(f.path, REPORTS_DIR);
        reports[name] = content;
      }
    } catch {
      // directory doesn't exist
    }

    let extractedFiles: Array<{ relativePath: string; content: string }> = [];
    try {
      const sourceFiles = await listFilesRecursively(storage, SOURCE_DIR);
      extractedFiles = await Promise.all(
        sourceFiles.map(async (f) => {
          const content = await storage.getFileContent(f.path);
          const relativePath = stripPrefix(f.path, SOURCE_DIR);
          return { relativePath, content };
        }),
      );
    } catch {
      // directory doesn't exist
    }

    return { modifiedFiles, generatedTests, reports, extractedFiles };
  } catch (err) {
    console.warn("[git-file-persistence] Failed to load files from Git:", err);
    return empty;
  }
}
