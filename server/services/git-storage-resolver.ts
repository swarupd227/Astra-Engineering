/**
 * Resolves IGitStorage for a project.
 *
 * Priority order:
 *   1. project_integration_configs "repo" category (configured via project wizard / edit dialog)
 *   2. project_git_config (legacy, kept for backward compatibility)
 *   3. Tenant-level GitHub connection from Settings (env / DB)
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { projectGitConfig } from "@shared/schema";
import type { AzureConfig } from "../azure-devops-service";
import { AdoGitStorage } from "./ado-git-service";
import { GitHubGitStorage } from "./github-git-storage";
import { GitLabGitStorage } from "./gitlab-git-storage";
import { BitbucketGitStorage } from "./bitbucket-git-storage";
import type { IGitStorage } from "./git-storage-interface";
import { safeDecryptPAT } from "../crypto-utils";
import { getGitHubConfig } from "./github-config-resolver";
import { resolveProjectRepoIntegration } from "./project-integration-resolver";
import {
  getGitClientForUser,
  type GitProvider,
} from "../integrations/git/user-credential-resolver";

export type GetAzureDevOpsConfig = (
  projectName?: string,
  organization?: string
) => Promise<AzureConfig | null>;

export type GitStorageOverrides = {
  /** Repository name or ID selected in the push dialog */
  repoName?: string;
  branch?: string;
  userId?: string;
  projectId?: string;
};

function normalizeAzureOrganization(value: string): string {
  let orgName = String(value || "").trim();
  if (orgName.includes("dev.azure.com")) {
    orgName = orgName
      .replace(/https?:\/\/dev\.azure\.com\//, "")
      .replace(/\/$/, "")
      .split("/")[0];
  } else if (orgName.includes("visualstudio.com")) {
    const match = orgName.match(/([^\.]+)\.visualstudio\.com/);
    if (match) orgName = match[1];
  }
  return orgName.replace(/\/+$/, "").trim();
}

function decryptConfigValue(value: string | undefined): string {
  if (!value) return "";
  return safeDecryptPAT(value) ?? value;
}

async function requirePersonalGitClient(
  overrides: GitStorageOverrides,
  provider: GitProvider,
  baseUrl?: string,
) {
  if (!overrides.userId) {
    throw new Error(
      `${provider} repository access requires the signed-in user's personal PAT/API key. No acting user was provided.`,
    );
  }

  try {
    try {
      return await getGitClientForUser(overrides.userId, provider, baseUrl, overrides.projectId);
    } catch (projectCredentialErr) {
      if (overrides.projectId) {
        return await getGitClientForUser(overrides.userId, provider, baseUrl);
      }
      throw projectCredentialErr;
    }
  } catch (err) {
    throw new Error(
      `${provider} repository access requires your personal PAT/API key. Configure and validate your ${provider} credential before using this repository.`,
    );
  }
}

/**
 * Builds IGitStorage from a resolved project_integration_configs "repo" entry.
 * Returns null if the provider is not yet supported for push.
 */
async function buildStorageFromIntegrationConfig(
  resolved: Awaited<ReturnType<typeof resolveProjectRepoIntegration>>,
  overrides: GitStorageOverrides,
  tenantId: string | null | undefined,
): Promise<IGitStorage | null> {
  if (resolved.status !== "configured") return null;

  const provider = (resolved.providerKey || "").toLowerCase();
  const cfg = resolved.config || {};

  if (provider === "github") {
    const ghFallback = await getGitHubConfig(tenantId);
    const selectedRepo = String(
      overrides.repoName || cfg.repository || cfg.repositoryName || cfg.repo || "",
    )
      .trim()
      .replace(/^(https?:\/\/)?(github\.com\/)/, "")
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    const repoParts = selectedRepo.split("/").filter(Boolean);
    const owner =
      String(cfg.ownerName || cfg.owner || repoParts[0] || "").trim() || ghFallback.owner;
    const repo =
      (repoParts.length >= 2 ? repoParts[1] : repoParts[0] || "") || ghFallback.repo;
    const client = await requirePersonalGitClient(overrides, "github");
    const token = client.token;

    const branch = overrides.branch || ghFallback.branch || "main";
    if (!owner || !repo || !token) {
      throw new Error(
        "GitHub repo tool is configured but owner, repository, or PAT is incomplete. Edit the project and reconfigure the repo tool.",
      );
    }
    console.log(`[GitStorage] Using personal GitHub PAT for push: ${owner}/${repo} [${branch}]`);
    return new GitHubGitStorage({ owner, repo, branch, token });
  }

  if (provider === "gitlab") {
    const baseUrl = String(cfg.baseUrl || cfg.url || "https://gitlab.com").trim();
    const client = await requirePersonalGitClient(overrides, "gitlab", baseUrl);
    const token = client.token;

    const projectIdForStorage = String(
      overrides.repoName || cfg.projectId || cfg.repositoryId || cfg.repository || "",
    ).trim();
    const branch = overrides.branch || "main";
    if (!token || !projectIdForStorage) {
      throw new Error(
        "GitLab repo tool is configured but project ID or PAT is incomplete. Edit the project and reconfigure the repo tool.",
      );
    }
    console.log(`[GitStorage] Using personal GitLab PAT for push: project ${projectIdForStorage} [${branch}]`);
    return new GitLabGitStorage({ baseUrl, token, projectId: projectIdForStorage, branch });
  }

  if (provider === "bitbucket") {
    const workspace = String(cfg.workspace || cfg.owner || "").trim();
    const username = String(cfg.username || cfg.userName || "").trim();
    const client = await requirePersonalGitClient(overrides, "bitbucket");
    const appPassword = client.token;

    const repositorySlug = String(
      overrides.repoName || cfg.repositorySlug || cfg.repository || cfg.repositoryName || "",
    )
      .trim()
      .replace(/^(https?:\/\/)?bitbucket\.org\//, "")
      .replace(/\.git$/, "")
      .replace(/\/$/, "")
      .split("/")
      .slice(-1)[0];
    const branch = overrides.branch || "main";
    if (!workspace || !username || !appPassword || !repositorySlug) {
      throw new Error(
        "Bitbucket repo tool is configured but workspace, username, app password, or repository slug is incomplete. Edit the project and reconfigure the repo tool.",
      );
    }
    console.log(
      `[GitStorage] Using personal Bitbucket app password for push: ${workspace}/${repositorySlug} [${branch}]`,
    );
    return new BitbucketGitStorage({ workspace, username, appPassword, repositorySlug, branch });
  }

  if (provider === "azure_repos") {
    const orgUrl = String(cfg.organizationUrl || "").trim();
    const project = String(cfg.projectName || "").trim();
    const repoName = overrides.repoName || String(cfg.repository || cfg.repositoryName || "").trim();
    const repositoryId = String(cfg.repositoryId || "").trim();
    const pat = decryptConfigValue(cfg.patToken || cfg.apiToken);
    const branch = overrides.branch || "main";
    const organization = normalizeAzureOrganization(orgUrl);
    if (!organization || !pat || !project || (!repositoryId && !repoName)) {
      throw new Error(
        "Azure Repos is configured for this project but organization URL, PAT, project, or repository is missing. Edit the project and reconfigure the repo tool.",
      );
    }
    console.log(
      `[GitStorage] Using project integration config (Azure Repos) for push: ${organization}/${project}/${repoName || repositoryId} [${branch}]`,
    );
    return new AdoGitStorage({
      organization,
      project,
      pat,
      repositoryId: repositoryId || undefined,
      repositoryName: repoName || undefined,
      branch,
    });
  }

  return null;
}

/**
 * Returns Git storage for the given project.
 *
 * Uses the repo tool configured during project creation/editing first,
 * then falls back to the legacy project_git_config, then tenant GitHub.
 */
export async function getGitStorage(
  projectId: string,
  organization?: string,
  projectName?: string,
  getAzureDevOpsConfig?: GetAzureDevOpsConfig,
  tenantId?: string | null,
  overrides?: GitStorageOverrides,
): Promise<IGitStorage> {
  const safeOverrides: GitStorageOverrides = { ...(overrides || {}), projectId };

  // 1. project_integration_configs "repo" category (set via wizard / edit dialog)
  try {
    const resolved = await resolveProjectRepoIntegration(projectId);
    const storage = await buildStorageFromIntegrationConfig(resolved, safeOverrides, tenantId);
    if (storage) return storage;
  } catch (integrationErr: any) {
    // If it's a hard "provider not supported" error, bubble it up immediately
    if (
      integrationErr?.message?.includes("repo tool is configured") ||
      integrationErr?.message?.includes("Azure Repos is configured")
    ) {
      throw integrationErr;
    }
    // Otherwise log and fall through to legacy
    console.warn("[GitStorage] project_integration_configs repo lookup failed, falling back to legacy:", integrationErr?.message);
  }

  // 2. Legacy project_git_config (backward compatibility)
  let legacyConfig: typeof projectGitConfig.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(projectGitConfig)
      .where(eq(projectGitConfig.projectId, projectId))
      .limit(1);
    legacyConfig = rows[0];
  } catch (err: any) {
    const code = err?.code ?? err?.errno;
    const isNoTable =
      code === "ER_NO_SUCH_TABLE" ||
      code === "ER_BAD_TABLE_ERROR" ||
      (typeof err?.message === "string" && err.message.includes("project_git_config"));
    if (!isNoTable) throw err;
    // Table doesn't exist — skip to tenant fallback
  }

  if (legacyConfig?.provider === "ado" && getAzureDevOpsConfig) {
    const adoConfig = await getAzureDevOpsConfig(projectName, organization);
    if (!adoConfig)
      throw new Error(
        "ADO Git is configured for this project but Azure DevOps credentials were not found. Configure PAT for this organization/project.",
      );
    return new AdoGitStorage({
      organization: adoConfig.organization,
      project: adoConfig.project,
      pat: adoConfig.pat,
      repositoryId: legacyConfig.adoRepositoryId ?? undefined,
      repositoryName: legacyConfig.adoRepositoryName ?? undefined,
      branch: legacyConfig.branch || "main",
    });
  }

  if (legacyConfig?.provider === "github") {
    const ghConfig = await getGitHubConfig(tenantId);
    const repoPath = legacyConfig.adoRepositoryName || "";
    let slug = repoPath.trim();
    slug = slug.replace(/^(https?:\/\/)?(github\.com\/)/, "");
    slug = slug.replace(/\.git$/, "").replace(/\/$/, "");
    const parts = slug.split("/").filter(Boolean);
    let owner = parts.length >= 2 ? parts[0] : "";
    let repo = parts.length >= 2 ? parts[1] : "";
    owner = owner || ghConfig.owner;
    repo = safeOverrides.repoName || repo || ghConfig.repo;
    const client = await requirePersonalGitClient(safeOverrides, "github");
    const resolvedToken = client.token;
    const branch = safeOverrides.branch || legacyConfig.branch || ghConfig.branch || "main";
    console.log(`[GitStorage] Using personal GitHub PAT with legacy project_git_config metadata for push: ${owner}/${repo} [${branch}]`);
    return new GitHubGitStorage({ owner, repo, branch, token: resolvedToken });
  }

  // 3. Tenant/env GitHub metadata fallback. Token still must be the acting user's personal PAT.
  const ghConfig = await getGitHubConfig(tenantId);
  const repo = safeOverrides.repoName || ghConfig.repo;
  const branch = safeOverrides.branch || ghConfig.branch;
  const client = await requirePersonalGitClient(safeOverrides, "github");
  console.log(`[GitStorage] Using personal GitHub PAT with tenant/env GitHub metadata for [${projectId}]: ${ghConfig.owner}/${repo}`);
  return new GitHubGitStorage({ token: client.token, owner: ghConfig.owner, repo, branch });
}

/**
 * Git storage for automation browse/preview/generation.
 * Uses project integration config first, then project_git_config, then tenant Settings GitHub
 * metadata. Repository credentials must still belong to the acting user.
 */
export async function getAutomationGitStorage(
  tenantId?: string | null,
  projectId?: string,
  organization?: string,
  projectName?: string,
  getAzureDevOpsConfig?: GetAzureDevOpsConfig,
  userId?: string,
): Promise<IGitStorage> {
  if (projectId?.trim()) {
    return getGitStorage(
      projectId.trim(),
      organization,
      projectName,
      getAzureDevOpsConfig,
      tenantId,
      userId ? { userId } : undefined,
    );
  }
  const ghConfig = await getGitHubConfig(tenantId);
  const client = await requirePersonalGitClient(userId ? { userId } : {}, "github");
  return new GitHubGitStorage({
    token: client.token,
    owner: ghConfig.owner,
    repo: ghConfig.repo,
    branch: ghConfig.branch,
  });
}
