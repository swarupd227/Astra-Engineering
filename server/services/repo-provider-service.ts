import {
  resolveProjectIntegrationLookup,
  resolveProjectRepoIntegration,
} from "./project-integration-resolver";
import { getGitClientForUser, type GitProvider } from "../integrations/git/user-credential-resolver";

export interface ProviderRepository {
  id: string;
  name: string;
  defaultBranch?: string;
  webUrl?: string;
}

export interface ProviderRepositoryCreateInput {
  name: string;
  visibility?: "private" | "public";
}

interface RepoProviderContext {
  projectId?: string;
  projectName?: string;
  userId?: string;
}

function sanitizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function sanitizeRepositorySlug(name: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PERSONAL_REPO_PROVIDERS = new Set(["github", "gitlab", "bitbucket"]);

async function resolveUserRepoConfig(
  provider: string,
  config: Record<string, string>,
  userId?: string,
  projectId?: string,
): Promise<Record<string, string>> {
  const normalizedProvider = String(provider || "").toLowerCase();
  if (!PERSONAL_REPO_PROVIDERS.has(normalizedProvider)) {
    return config;
  }

  const suppliedToken = String(
    normalizedProvider === "bitbucket"
      ? config.appPassword || config.apiToken || config.patToken || config.token || ""
      : config.patToken || config.apiToken || config.token || config.appPassword || "",
  ).trim();
  if (suppliedToken && suppliedToken !== "********" && suppliedToken !== "••••") {
    return config;
  }

  if (!userId) {
    throw new Error(`${normalizedProvider} repository access requires your personal PAT/API key.`);
  }

  const baseUrl = normalizedProvider === "gitlab"
    ? sanitizeUrl(String(config.baseUrl || "https://gitlab.com").trim())
    : undefined;
  let client;
  try {
    client = await getGitClientForUser(userId, normalizedProvider as GitProvider, baseUrl, projectId);
  } catch (projectCredentialErr) {
    if (projectId) {
      client = await getGitClientForUser(userId, normalizedProvider as GitProvider, baseUrl);
    } else {
      throw projectCredentialErr;
    }
  }

  return {
    ...config,
    baseUrl: normalizedProvider === "gitlab" ? client.baseUrl : config.baseUrl,
    patToken: client.token,
    apiToken: client.token,
    appPassword: client.token,
  };
}

async function readProviderError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text);
    const message = payload?.message || payload?.error || text;
    return typeof message === "string" ? `${response.status}: ${message}` : `${response.status}: ${JSON.stringify(message)}`;
  } catch {
    return `${response.status}: ${text.slice(0, 300)}`;
  }
}

function normalizeGitLabProjectPath(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const path = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "");
    return path;
  } catch {
    return value
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "");
  }
}

function mapGitLabProject(item: {
  id: number;
  name: string;
  web_url?: string;
  default_branch?: string;
  path_with_namespace?: string;
}): ProviderRepository {
  return {
    id: String(item.id),
    name: item.path_with_namespace || item.name,
    defaultBranch: item.default_branch,
    webUrl: item.web_url,
  };
}

function gitLabProjectRefCandidates(
  repositoryId: string,
  config: Record<string, string>,
): string[] {
  const rawRepositoryId = String(repositoryId || "").trim();
  const namespacePath = normalizeGitLabProjectPath(
    config.namespacePath || config.namespace || config.groupPath || "",
  );
  const configuredProjectPath = normalizeGitLabProjectPath(
    config.projectId || config.repository || config.repositoryId || config.projectPath || "",
  );

  const candidates = [
    rawRepositoryId,
    normalizeGitLabProjectPath(rawRepositoryId),
    configuredProjectPath,
  ];

  if (
    namespacePath &&
    rawRepositoryId &&
    !rawRepositoryId.includes("/") &&
    !/^\d+$/.test(rawRepositoryId)
  ) {
    candidates.push(`${namespacePath}/${rawRepositoryId}`);
  }

  return Array.from(new Set(candidates.map((value) => value.trim()).filter(Boolean)));
}

async function resolveProjectName(projectId: string) {
  const { project } = await resolveProjectIntegrationLookup(projectId);
  return String(project?.name || "").trim();
}

export async function listRepositoriesForProvider(
  providerKey: string,
  rawConfig: Record<string, string>,
  context: RepoProviderContext = {},
): Promise<ProviderRepository[]> {
  const provider = String(providerKey || "").toLowerCase();
  const config = await resolveUserRepoConfig(provider, rawConfig, context.userId, context.projectId);

  if (provider === "github") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const owner = String(config.ownerName || config.owner || "").trim();
    if (!token) throw new Error("GitHub token is missing in tool configuration.");
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    };

    const tryEndpoints = owner
      ? [
          `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?per_page=100&type=all`,
          `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&type=owner`,
        ]
      : ["https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member"];

    let data: Array<{
      full_name: string;
      name: string;
      html_url?: string;
      default_branch?: string;
    }> = [];
    let lastError: Error | null = null;

    for (const endpoint of tryEndpoints) {
      const response = await fetch(endpoint, { headers });
      if (!response.ok) {
        lastError = new Error("Unable to fetch GitHub repositories.");
        continue;
      }
      data = (await response.json()) as typeof data;
      break;
    }

    if (data.length === 0 && lastError) {
      throw lastError;
    }

    return data.map((item) => ({
      id: item.full_name,
      name: item.name,
      defaultBranch: item.default_branch,
      webUrl: item.html_url,
    }));
  }

  if (provider === "gitlab") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const baseUrl = sanitizeUrl(String(config.baseUrl || "https://gitlab.com").trim());
    if (!token) throw new Error("GitLab token is missing in tool configuration.");

    const headers = { "PRIVATE-TOKEN": token };
    const namespacePath = normalizeGitLabProjectPath(
      config.namespacePath || config.namespace || config.groupPath || "",
    );
    const projectPath = normalizeGitLabProjectPath(
      config.projectId || config.repository || config.repositoryId || "",
    );
    const listCandidates = Array.from(new Set([namespacePath, projectPath].filter(Boolean)));
    const errors: string[] = [];

    for (const candidate of listCandidates) {
      const groupResponse = await fetch(
        `${baseUrl}/api/v4/groups/${encodeURIComponent(candidate)}/projects?include_subgroups=true&per_page=100`,
        { headers },
      );
      if (groupResponse.ok) {
        const data = (await groupResponse.json()) as Array<{
          id: number;
          name: string;
          web_url?: string;
          default_branch?: string;
          path_with_namespace?: string;
        }>;
        return data.map(mapGitLabProject);
      }
      errors.push(`groups/${candidate}: ${await readProviderError(groupResponse)}`);

      const projectResponse = await fetch(
        `${baseUrl}/api/v4/projects/${encodeURIComponent(candidate)}`,
        { headers },
      );
      if (projectResponse.ok) {
        const project = (await projectResponse.json()) as {
          id: number;
          name: string;
          web_url?: string;
          default_branch?: string;
          path_with_namespace?: string;
        };
        return [mapGitLabProject(project)];
      }
      errors.push(`projects/${candidate}: ${await readProviderError(projectResponse)}`);
    }

    const response = await fetch(`${baseUrl}/api/v4/projects?membership=true&per_page=100`, {
      headers,
    });
    if (!response.ok) {
      const detail = await readProviderError(response);
      throw new Error(
        `Unable to fetch GitLab repositories (${detail}). ${
          errors.length ? `Namespace/project attempts: ${errors.join("; ")}` : ""
        }`.trim(),
      );
    }
    const data = (await response.json()) as Array<{
      id: number;
      name: string;
      web_url?: string;
      default_branch?: string;
      path_with_namespace?: string;
    }>;
    return data.map(mapGitLabProject);
  }

  if (provider === "bitbucket") {
    const workspace = String(config.workspace || "").trim();
    const username = String(config.username || config.userName || "").trim();
    const appPassword = String(config.appPassword || config.apiToken || "").trim();
    if (!workspace || !username || !appPassword) {
      throw new Error("Bitbucket workspace credentials are missing in tool configuration.");
    }
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
    const response = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}?pagelen=100`,
      { headers: { Authorization: auth } },
    );
    if (!response.ok) throw new Error("Unable to fetch Bitbucket repositories.");
    const data = (await response.json()) as {
      values?: Array<{
        slug: string;
        name: string;
        links?: { html?: { href?: string } };
        mainbranch?: { name?: string };
      }>;
    };
    return (data.values || []).map((item) => ({
      id: item.slug,
      name: item.name,
      defaultBranch: item.mainbranch?.name,
      webUrl: item.links?.html?.href,
    }));
  }

  if (provider === "azure_repos") {
    const orgUrl = sanitizeUrl(String(config.organizationUrl || "").trim());
    const pat = String(config.patToken || config.apiToken || "").trim();
    const projectName = String(config.projectName || context.projectName || "").trim();
    if (!orgUrl || !pat) throw new Error("Azure Repos organization URL or PAT is missing.");
    if (!projectName) {
      throw new Error("Azure Repos project name is required to list repositories.");
    }
    const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
    const response = await fetch(
      `${orgUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories?api-version=7.0`,
      { headers: { Authorization: auth } },
    );
    if (!response.ok) throw new Error("Unable to fetch Azure Repos repositories.");
    const data = (await response.json()) as {
      value?: Array<{ id: string; name: string; webUrl?: string; defaultBranch?: string }>;
    };
    return (data.value || []).map((item) => ({
      id: item.id,
      name: item.name,
      webUrl: item.webUrl,
      defaultBranch: item.defaultBranch?.replace("refs/heads/", ""),
    }));
  }

  throw new Error(`Unsupported repository provider: ${provider}`);
}

export async function createRepositoryForProvider(
  providerKey: string,
  rawConfig: Record<string, string>,
  input: ProviderRepositoryCreateInput,
  context: RepoProviderContext = {},
): Promise<ProviderRepository> {
  const provider = String(providerKey || "").toLowerCase();
  const config = await resolveUserRepoConfig(provider, rawConfig, context.userId, context.projectId);
  const repoName = String(input.name || "").trim();
  if (!repoName) {
    throw new Error("Repository name is required.");
  }

  if (provider === "github") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const owner = String(config.ownerName || config.owner || "").trim();
    if (!token) throw new Error("GitHub token is missing in tool configuration.");
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };

    const viewerResponse = await fetch("https://api.github.com/user", { headers });
    if (!viewerResponse.ok) {
      throw new Error("Unable to resolve the authenticated GitHub user.");
    }
    const viewer = (await viewerResponse.json()) as { login?: string };
    const normalizedOwner = owner || String(viewer.login || "").trim();
    const createEndpoint =
      normalizedOwner &&
      viewer.login &&
      normalizedOwner.toLowerCase() !== String(viewer.login).toLowerCase()
        ? `https://api.github.com/orgs/${encodeURIComponent(normalizedOwner)}/repos`
        : "https://api.github.com/user/repos";

    const response = await fetch(createEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: repoName,
        private: input.visibility !== "public",
        auto_init: true,
      }),
    });
    if (!response.ok) {
      throw new Error("Unable to create GitHub repository.");
    }
    const data = (await response.json()) as {
      full_name: string;
      name: string;
      html_url?: string;
      default_branch?: string;
    };
    return {
      id: data.full_name,
      name: data.name,
      defaultBranch: data.default_branch,
      webUrl: data.html_url,
    };
  }

  if (provider === "gitlab") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const baseUrl = sanitizeUrl(String(config.baseUrl || "https://gitlab.com").trim());
    if (!token) throw new Error("GitLab token is missing in tool configuration.");

    let namespaceId: number | undefined;
    const rawNamespace = String(
      config.namespaceId || config.namespacePath || config.namespace || "",
    ).trim();
    if (rawNamespace) {
      if (/^\d+$/.test(rawNamespace)) {
        namespaceId = Number(rawNamespace);
      } else {
        const namespaceResponse = await fetch(
          `${baseUrl}/api/v4/namespaces?search=${encodeURIComponent(rawNamespace)}&per_page=100`,
          { headers: { "PRIVATE-TOKEN": token } },
        );
        if (namespaceResponse.ok) {
          const namespaces = (await namespaceResponse.json()) as Array<{
            id: number;
            path?: string;
            full_path?: string;
            name?: string;
          }>;
          const match = namespaces.find((item) => {
            const path = String(item.path || "").toLowerCase();
            const fullPath = String(item.full_path || "").toLowerCase();
            const name = String(item.name || "").toLowerCase();
            const expected = rawNamespace.toLowerCase();
            return path === expected || fullPath === expected || name === expected;
          });
          namespaceId = match?.id;
        }
      }
    }

    const response = await fetch(`${baseUrl}/api/v4/projects`, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: repoName,
        path: sanitizeRepositorySlug(repoName) || repoName,
        visibility: input.visibility === "public" ? "public" : "private",
        initialize_with_readme: true,
        ...(namespaceId ? { namespace_id: namespaceId } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await readProviderError(response);
      throw new Error(`Unable to create GitLab repository (${detail}).`);
    }
    const data = (await response.json()) as {
      id: number;
      name: string;
      web_url?: string;
      default_branch?: string;
      path_with_namespace?: string;
    };
    return {
      id: String(data.id),
      name: data.path_with_namespace || data.name,
      defaultBranch: data.default_branch,
      webUrl: data.web_url,
    };
  }

  if (provider === "bitbucket") {
    const workspace = String(config.workspace || "").trim();
    const username = String(config.username || config.userName || "").trim();
    const appPassword = String(config.appPassword || config.apiToken || "").trim();
    if (!workspace || !username || !appPassword) {
      throw new Error("Bitbucket workspace credentials are missing in tool configuration.");
    }
    const slug = sanitizeRepositorySlug(repoName);
    if (!slug) {
      throw new Error("Repository name is invalid.");
    }
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
    const response = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scm: "git",
          is_private: input.visibility !== "public",
          name: repoName,
        }),
      },
    );
    if (!response.ok) {
      throw new Error("Unable to create Bitbucket repository.");
    }
    const data = (await response.json()) as {
      slug: string;
      name: string;
      links?: { html?: { href?: string } };
      mainbranch?: { name?: string };
    };
    return {
      id: data.slug,
      name: data.name,
      defaultBranch: data.mainbranch?.name,
      webUrl: data.links?.html?.href,
    };
  }

  if (provider === "azure_repos") {
    const orgUrl = sanitizeUrl(String(config.organizationUrl || "").trim());
    const pat = String(config.patToken || config.apiToken || "").trim();
    const projectName = String(config.projectName || context.projectName || "").trim();
    if (!orgUrl || !pat) throw new Error("Azure Repos organization URL or PAT is missing.");
    if (!projectName) {
      throw new Error("Azure Repos project name is required to create a repository.");
    }
    const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
    const response = await fetch(
      `${orgUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories?api-version=7.1`,
      {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: repoName }),
      },
    );
    if (!response.ok) {
      throw new Error("Unable to create Azure Repos repository.");
    }
    const data = (await response.json()) as {
      id: string;
      name: string;
      webUrl?: string;
      defaultBranch?: string;
    };
    return {
      id: data.id,
      name: data.name,
      webUrl: data.webUrl,
      defaultBranch: data.defaultBranch?.replace("refs/heads/", ""),
    };
  }

  throw new Error(`Unsupported repository provider: ${provider}`);
}

export async function listProviderRepositories(projectId: string, userId?: string): Promise<ProviderRepository[]> {
  const repo = await resolveProjectRepoIntegration(projectId);
  if (repo.status !== "configured") {
    throw new Error(repo.message || "Repository integration is not configured.");
  }

  const projectName = String(repo.config?.projectName || (await resolveProjectName(projectId)) || "").trim();
  return listRepositoriesForProvider(String(repo.providerKey || ""), repo.config || {}, {
    projectId,
    projectName,
    userId,
  });
}

export async function listProviderBranches(
  projectId: string,
  repositoryId: string,
  userId?: string,
): Promise<Array<{ name: string; objectId?: string }>> {
  const repo = await resolveProjectRepoIntegration(projectId);
  if (repo.status !== "configured") {
    throw new Error(repo.message || "Repository integration is not configured.");
  }
  const provider = String(repo.providerKey || "").toLowerCase();
  const config = await resolveUserRepoConfig(provider, repo.config || {}, userId, projectId);

  if (provider === "github") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const [owner, repoName] = repositoryId.split("/");
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/branches?per_page=100`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{ name: string; commit?: { sha?: string } }>;
    return data.map((b) => ({ name: b.name, objectId: b.commit?.sha }));
  }

  if (provider === "gitlab") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const baseUrl = sanitizeUrl(String(config.baseUrl || "https://gitlab.com").trim());
    const errors: string[] = [];
    for (const projectRef of gitLabProjectRefCandidates(repositoryId, config)) {
      const response = await fetch(
        `${baseUrl}/api/v4/projects/${encodeURIComponent(projectRef)}/repository/branches?per_page=100`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!response.ok) {
        errors.push(`${projectRef}: ${await readProviderError(response)}`);
        continue;
      }
      const data = (await response.json()) as Array<{ name: string; commit?: { id?: string } }>;
      return data.map((b) => ({ name: b.name, objectId: b.commit?.id }));
    }
    throw new Error(
      `Unable to fetch GitLab branches for "${repositoryId}". ${
        errors.length ? errors.join("; ") : "No GitLab project reference could be resolved."
      } Ensure your GitLab token has read_repository or api scope and access to the repository.`,
    );
  }

  if (provider === "bitbucket") {
    const workspace = String(config.workspace || "").trim();
    const username = String(config.username || config.userName || "").trim();
    const appPassword = String(config.appPassword || config.apiToken || "").trim();
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
    const response = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repositoryId)}/refs/branches?pagelen=100`,
      { headers: { Authorization: auth } },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as { values?: Array<{ name: string; target?: { hash?: string } }> };
    return (data.values || []).map((b) => ({ name: b.name, objectId: b.target?.hash }));
  }

  if (provider === "azure_repos") {
    const orgUrl = sanitizeUrl(String(config.organizationUrl || "").trim());
    const pat = String(config.patToken || config.apiToken || "").trim();
    const projectName = String(config.projectName || (await resolveProjectName(projectId)) || "").trim();
    const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
    const response = await fetch(
      `${orgUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/refs?filter=heads/&api-version=7.0`,
      { headers: { Authorization: auth } },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as { value?: Array<{ name: string; objectId: string }> };
    return (data.value || []).map((b) => ({
      name: b.name.replace("refs/heads/", ""),
      objectId: b.objectId,
    }));
  }

  return [];
}

export async function listProviderCommits(
  projectId: string,
  repositoryId: string,
  limit = 50,
  userId?: string,
): Promise<Array<{ commitId: string; comment: string; author?: string; date?: string }>> {
  const repo = await resolveProjectRepoIntegration(projectId);
  if (repo.status !== "configured") {
    throw new Error(repo.message || "Repository integration is not configured.");
  }
  const provider = String(repo.providerKey || "").toLowerCase();
  const config = await resolveUserRepoConfig(provider, repo.config || {}, userId, projectId);

  if (provider === "github") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const [owner, repoName] = repositoryId.split("/");
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/commits?per_page=${Math.max(1, limit)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as Array<{
      sha: string;
      commit?: { message?: string; author?: { name?: string; date?: string } };
    }>;
    return data.map((commit) => ({
      commitId: commit.sha,
      comment: commit.commit?.message || "",
      author: commit.commit?.author?.name,
      date: commit.commit?.author?.date,
    }));
  }

  if (provider === "gitlab") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const baseUrl = sanitizeUrl(String(config.baseUrl || "https://gitlab.com").trim());
    for (const projectRef of gitLabProjectRefCandidates(repositoryId, config)) {
      const response = await fetch(
        `${baseUrl}/api/v4/projects/${encodeURIComponent(projectRef)}/repository/commits?per_page=${Math.max(1, limit)}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (!response.ok) continue;
      const data = (await response.json()) as Array<{
        id: string;
        title: string;
        author_name?: string;
        authored_date?: string;
      }>;
      return data.map((commit) => ({
        commitId: commit.id,
        comment: commit.title,
        author: commit.author_name,
        date: commit.authored_date,
      }));
    }
    return [];
  }

  if (provider === "bitbucket") {
    const workspace = String(config.workspace || "").trim();
    const username = String(config.username || config.userName || "").trim();
    const appPassword = String(config.appPassword || config.apiToken || "").trim();
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
    const response = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repositoryId)}/commits?pagelen=${Math.max(1, limit)}`,
      { headers: { Authorization: auth } },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      values?: Array<{
        hash: string;
        message: string;
        date?: string;
        author?: { user?: { display_name?: string }; raw?: string };
      }>;
    };
    return (data.values || []).map((commit) => ({
      commitId: commit.hash,
      comment: commit.message,
      author: commit.author?.user?.display_name || commit.author?.raw,
      date: commit.date,
    }));
  }

  if (provider === "azure_repos") {
    const orgUrl = sanitizeUrl(String(config.organizationUrl || "").trim());
    const pat = String(config.patToken || config.apiToken || "").trim();
    const projectName = String(config.projectName || (await resolveProjectName(projectId)) || "").trim();
    const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
    const response = await fetch(
      `${orgUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/commits?$top=${Math.max(1, limit)}&api-version=7.0`,
      { headers: { Authorization: auth } },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      value?: Array<{
        commitId: string;
        comment?: string;
        author?: { name?: string; date?: string };
      }>;
    };
    return (data.value || []).map((commit) => ({
      commitId: commit.commitId,
      comment: commit.comment || "",
      author: commit.author?.name,
      date: commit.author?.date,
    }));
  }

  return [];
}

export interface ProviderTreeFile {
  path: string;
  objectId: string;
}

export interface ProviderTreeResult {
  files: ProviderTreeFile[];
  repoIsEmpty: boolean;
}

interface RepoProviderContextResolved {
  provider: string;
  config: Record<string, string>;
  projectName: string;
}

/** Resolve the project's configured repo provider + credentials once. Throws when not configured. */
async function resolveRepoProviderContext(
  projectId: string,
  userId?: string,
): Promise<RepoProviderContextResolved> {
  const repo = await resolveProjectRepoIntegration(projectId);
  if (repo.status !== "configured") {
    throw new Error(repo.message || "Repository integration is not configured.");
  }
  const provider = String(repo.providerKey || "").toLowerCase();
  const config = await resolveUserRepoConfig(provider, repo.config || {}, userId, projectId);
  const projectName = String(
    config.projectName || (await resolveProjectName(projectId)) || "",
  ).trim();
  return { provider, config, projectName };
}

/**
 * List files (blobs) under `basePath` in a repository, provider-agnostically.
 * Returns a stable per-file `objectId` (git blob sha / ADO objectId / commit hash)
 * used for change detection by the SDLC spec sync.
 */
export async function listProviderTree(
  projectId: string,
  repositoryId: string,
  basePath = "",
  branch?: string,
  userId?: string,
): Promise<ProviderTreeResult> {
  const { provider, config, projectName } = await resolveRepoProviderContext(projectId, userId);
  const normalizedBase = String(basePath || "").replace(/^\/+|\/+$/g, "");
  const underBase = (p: string) =>
    !normalizedBase || p === normalizedBase || p.startsWith(`${normalizedBase}/`);

  if (provider === "github") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const [owner, repoName] = repositoryId.split("/");
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    };
    let ref = branch?.trim();
    if (!ref) {
      const repoResp = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
        { headers },
      );
      if (repoResp.ok) {
        ref = String(((await repoResp.json()) as { default_branch?: string }).default_branch || "").trim();
      }
    }
    ref = ref || "main";
    const treeResp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { headers },
    );
    if (!treeResp.ok) return { files: [], repoIsEmpty: true };
    const data = (await treeResp.json()) as {
      tree?: Array<{ path: string; type: string; sha: string }>;
    };
    const files = (data.tree || [])
      .filter((t) => t.type === "blob" && underBase(t.path))
      .map((t) => ({ path: t.path, objectId: t.sha }));
    return { files, repoIsEmpty: files.length === 0 };
  }

  if (provider === "gitlab") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const baseUrl = sanitizeUrl(String(config.baseUrl || "https://gitlab.com").trim());
    for (const projectRef of gitLabProjectRefCandidates(repositoryId, config)) {
      const files: ProviderTreeFile[] = [];
      let page = 1;
      let firstPageLoaded = false;
      for (;;) {
        const params = new URLSearchParams({
          recursive: "true",
          per_page: "100",
          page: String(page),
        });
        if (normalizedBase) params.set("path", normalizedBase);
        if (branch?.trim()) params.set("ref", branch.trim());
        const resp = await fetch(
          `${baseUrl}/api/v4/projects/${encodeURIComponent(projectRef)}/repository/tree?${params.toString()}`,
          { headers: { "PRIVATE-TOKEN": token } },
        );
        if (!resp.ok) {
          if (!firstPageLoaded) break;
          break;
        }
        firstPageLoaded = true;
        const data = (await resp.json()) as Array<{ id: string; path: string; type: string }>;
        for (const item of data) {
          if (item.type === "blob") files.push({ path: item.path, objectId: item.id });
        }
        const nextPage = Number(resp.headers.get("x-next-page") || "");
        if (!nextPage) break;
        page = nextPage;
      }
      if (firstPageLoaded) {
        return { files, repoIsEmpty: files.length === 0 };
      }
    }
    return { files: [], repoIsEmpty: true };
  }

  if (provider === "azure_repos") {
    const orgUrl = sanitizeUrl(String(config.organizationUrl || "").trim());
    const pat = String(config.patToken || config.apiToken || "").trim();
    const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
    const scopeQuery = normalizedBase
      ? `&scopePath=${encodeURIComponent(`/${normalizedBase}`)}`
      : "";
    const treeResp = await fetch(
      `${orgUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items?recursionLevel=full${scopeQuery}&api-version=7.0`,
      { headers: { Authorization: auth } },
    );
    if (!treeResp.ok) return { files: [], repoIsEmpty: true };
    const data = (await treeResp.json()) as {
      value?: Array<{ path: string; isFolder?: boolean; objectId: string }>;
    };
    const files = (data.value || [])
      .filter((item) => !item.isFolder)
      .map((item) => ({ path: (item.path || "").replace(/^\/+/, ""), objectId: item.objectId }))
      .filter((f) => underBase(f.path));
    return { files, repoIsEmpty: files.length === 0 };
  }

  if (provider === "bitbucket") {
    const workspace = String(config.workspace || "").trim();
    const username = String(config.username || config.userName || "").trim();
    const appPassword = String(config.appPassword || config.apiToken || "").trim();
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
    let ref = branch?.trim();
    if (!ref) {
      const repoResp = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repositoryId)}`,
        { headers: { Authorization: auth } },
      );
      if (repoResp.ok) {
        ref = String(((await repoResp.json()) as { mainbranch?: { name?: string } }).mainbranch?.name || "").trim();
      }
    }
    ref = ref || "main";
    const files: ProviderTreeFile[] = [];
    let url: string | undefined = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repositoryId)}/src/${encodeURIComponent(ref)}/${normalizedBase ? `${normalizedBase}/` : ""}?pagelen=100&max_depth=100`;
    while (url) {
      const resp: globalThis.Response = await fetch(url, { headers: { Authorization: auth } });
      if (!resp.ok) {
        if (!files.length) return { files: [], repoIsEmpty: true };
        break;
      }
      const data = (await resp.json()) as {
        values?: Array<{ path: string; type: string; commit?: { hash?: string } }>;
        next?: string;
      };
      for (const item of data.values || []) {
        if (item.type === "commit_file") {
          files.push({ path: item.path, objectId: item.commit?.hash || item.path });
        }
      }
      url = data.next;
    }
    return { files, repoIsEmpty: files.length === 0 };
  }

  throw new Error(`Unsupported repository provider: ${provider}`);
}

/** Fetch a single file's raw text content from a repository, provider-agnostically. */
export async function getProviderFileContent(
  projectId: string,
  repositoryId: string,
  filePath: string,
  branch?: string,
  userId?: string,
): Promise<string | null> {
  const { provider, config, projectName } = await resolveRepoProviderContext(projectId, userId);
  const cleanPath = String(filePath || "").replace(/^\/+/, "");

  if (provider === "github") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const [owner, repoName] = repositoryId.split("/");
    const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
    const ref = branch?.trim();
    const resp = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/contents/${encodedPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" } },
    );
    if (!resp.ok) return null;
    return await resp.text();
  }

  if (provider === "gitlab") {
    const token = String(config.patToken || config.apiToken || "").trim();
    const baseUrl = sanitizeUrl(String(config.baseUrl || "https://gitlab.com").trim());
    let ref = branch?.trim();
    if (!ref) {
      for (const projectRef of gitLabProjectRefCandidates(repositoryId, config)) {
        const projResp = await fetch(
          `${baseUrl}/api/v4/projects/${encodeURIComponent(projectRef)}`,
          { headers: { "PRIVATE-TOKEN": token } },
        );
        if (projResp.ok) {
          ref = String(((await projResp.json()) as { default_branch?: string }).default_branch || "").trim();
          break;
        }
      }
    }
    ref = ref || "main";
    for (const projectRef of gitLabProjectRefCandidates(repositoryId, config)) {
      const resp = await fetch(
        `${baseUrl}/api/v4/projects/${encodeURIComponent(projectRef)}/repository/files/${encodeURIComponent(cleanPath)}/raw?ref=${encodeURIComponent(ref)}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (resp.ok) return await resp.text();
    }
    return null;
  }

  if (provider === "azure_repos") {
    const orgUrl = sanitizeUrl(String(config.organizationUrl || "").trim());
    const pat = String(config.patToken || config.apiToken || "").trim();
    const auth = `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
    const resp = await fetch(
      `${orgUrl}/${encodeURIComponent(projectName)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/items?path=${encodeURIComponent(`/${cleanPath}`)}&$format=text&api-version=7.0`,
      { headers: { Authorization: auth } },
    );
    if (!resp.ok) return null;
    return await resp.text();
  }

  if (provider === "bitbucket") {
    const workspace = String(config.workspace || "").trim();
    const username = String(config.username || config.userName || "").trim();
    const appPassword = String(config.appPassword || config.apiToken || "").trim();
    const auth = `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`;
    let ref = branch?.trim();
    if (!ref) {
      const repoResp = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repositoryId)}`,
        { headers: { Authorization: auth } },
      );
      if (repoResp.ok) {
        ref = String(((await repoResp.json()) as { mainbranch?: { name?: string } }).mainbranch?.name || "").trim();
      }
    }
    ref = ref || "main";
    const resp = await fetch(
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repositoryId)}/src/${encodeURIComponent(ref)}/${cleanPath}`,
      { headers: { Authorization: auth } },
    );
    if (!resp.ok) return null;
    return await resp.text();
  }

  return null;
}
