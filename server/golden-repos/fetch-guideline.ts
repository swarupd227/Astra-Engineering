import { Octokit } from "octokit";
import type { GoldenRepoReference } from "./validate-reference";
import { getGitLabConfig, gitlabFetch } from "../routes/gitlab-repos";
import { getGitClientForUser } from "../integrations/git/user-credential-resolver";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function parseGitHubOwnerRepo(repoUrl?: string, repoName?: string): { owner: string; repo: string } {
  if (repoUrl) {
    try {
      const parts = new URL(repoUrl).pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
    } catch {
      /* ignore */
    }
  }
  return { owner: "", repo: repoName || "" };
}

async function getGoldenGitHubOctokit(userId: string | null | undefined): Promise<Octokit | null> {
  if (!userId) return null;
  const client = await getGitClientForUser(userId, "github");
  return new Octokit({ auth: client.token });
}

export async function fetchGoldenRepoFileContent(options: {
  ref: Pick<GoldenRepoReference, "repoId" | "provider" | "repoUrl" | "repoName" | "defaultBranch">;
  filePath: string;
  tenantId?: string | null;
  userId?: string | null;
  linkedGoldenRepoOrg?: string | null;
  linkedGoldenRepoProject?: string | null;
  adoFetch?: (filePath: string) => Promise<string | null>;
}): Promise<string | null> {
  const path = normalizePath(options.filePath);
  if (!path) return null;

  const provider = options.ref.provider || "ado";
  const repoId = String(options.ref.repoId).trim();

  if (provider === "gitlab") {
    let client: { baseUrl: string; token: string };
    try {
      const config = await getGitLabConfig(options.tenantId ?? null);
      if (config?.token) {
        client = { baseUrl: config.baseUrl, token: config.token };
      } else {
        client = await getGitClientForUser(options.userId || "", "gitlab", config?.baseUrl);
      }
    } catch {
      return null;
    }

    let branch = options.ref.defaultBranch || "main";
    try {
      const projectInfo: any = await gitlabFetch(
        client.baseUrl,
        `/projects/${encodeURIComponent(repoId)}`,
        client.token,
      );
      branch = projectInfo.default_branch || branch;
    } catch {
      /* use main */
    }

    try {
      const encodedPath = encodeURIComponent(path);
      const data: any = await gitlabFetch(
        client.baseUrl,
        `/projects/${encodeURIComponent(repoId)}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        client.token,
      );
      return Buffer.from(data.content, "base64").toString("utf-8");
    } catch (err) {
      console.warn("[GoldenRepoFetch] GitLab file fetch failed", {
        repoId,
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  if (provider === "github") {
    const octokit = await getGoldenGitHubOctokit(options.userId);
    if (!octokit) return null;

    const { owner, repo } = parseGitHubOwnerRepo(options.ref.repoUrl, options.ref.repoName);
    if (!owner || !repo) return null;

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
      });
      if (Array.isArray(data)) return null;
      return Buffer.from((data as { content: string }).content, "base64").toString("utf-8");
    } catch (err) {
      console.warn("[GoldenRepoFetch] GitHub file fetch failed", {
        owner,
        repo,
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  if (options.adoFetch) {
    return options.adoFetch(path);
  }

  return null;
}
