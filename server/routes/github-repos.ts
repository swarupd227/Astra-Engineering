import { Router, Request, Response } from "express";
import { Octokit } from "octokit";
import { requireAuth, autoBootstrapUser } from "../auth/middleware";
import { isAwsHosting } from "../platform/hosting";
import { getGitHubConfig, getTenantIdFromRequest } from "../services/github-config-resolver";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getGitClientForUser } from "../integrations/git/user-credential-resolver";
import { extractMarkdownFromPdfBuffer } from "../helper/brd-document-parser";

async function getChunkedPathsForRepo(repoId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ guidelineName: schema.devxVectorizedGuidelines.guidelineName, status: schema.devxVectorizedGuidelines.status })
      .from(schema.devxVectorizedGuidelines)
      .where(eq(schema.devxVectorizedGuidelines.goldenRepoId, repoId));
    return rows
      .filter((r) => (r.status || "").toLowerCase() === "vectorized")
      .map((r) => String(r.guidelineName || "").trim())
      .filter(Boolean)
      .map((p) => p.replace(/^\/+/, "").replace(/\/+/g, "/"));
  } catch {
    return [];
  }
}

const router = Router();

interface TreeNode {
  name: string;
  path: string;
  type: "folder" | "file";
  size?: number;
  children?: TreeNode[];
}

function buildNestedTree(
  flatItems: { path: string; type: "folder" | "file"; size?: number }[],
): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();

  const ensureFolder = (folderPath: string): TreeNode => {
    const existing = folderMap.get(folderPath);
    if (existing) return existing;
    const parts = folderPath.split("/");
    const node: TreeNode = {
      name: parts[parts.length - 1],
      path: folderPath,
      type: "folder",
      children: [],
    };
    folderMap.set(folderPath, node);

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = ensureFolder(parentPath);
      parent.children!.push(node);
    }
    return node;
  };

  for (const item of flatItems) {
    if (item.type === "folder") {
      ensureFolder(item.path);
      continue;
    }
    const parts = item.path.split("/");
    const node: TreeNode = {
      name: parts[parts.length - 1],
      path: item.path,
      type: "file",
      ...(typeof item.size === "number" && item.size > 0 ? { size: item.size } : {}),
    };
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = ensureFolder(parentPath);
      parent.children!.push(node);
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
    return nodes;
  };

  return sortNodes(root);
}

function getOctokit(token?: string): Octokit | null {
  const t = token?.trim();
  if (!t) return null;
  return new Octokit({ auth: t });
}

async function getPersonalGitHubOctokit(req: Request): Promise<Octokit> {
  const userId = (req as any).user?.id;
  if (!userId) {
    throw new Error("GitHub repository access requires a signed-in user.");
  }
  const client = await getGitClientForUser(userId, "github");
  const octokit = getOctokit(client.token);
  if (!octokit) {
    throw new Error("GitHub repository access requires your personal GitHub PAT/API key.");
  }
  return octokit;
}

function credentialErrorMessage(): string {
  return "GitHub token is invalid or expired. Update it in Settings → Third-Party Integrations → GitHub Connection, then use Test Connection.";
}

function isPersonalGitHubCredentialError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return (
    message.includes("personal github") ||
    message.includes("no active github credential") ||
    message.includes("github repository access requires")
  );
}

async function listGitHubRepositories(octokit: Octokit, owner: string): Promise<any[]> {
  const attempts: Array<() => Promise<any[]>> = [];

  if (owner) {
    attempts.push(async () => {
      const data = await octokit.paginate(octokit.rest.repos.listForOrg, {
        org: owner,
        sort: "updated",
        per_page: 100,
      });
      return data;
    });
    attempts.push(async () => {
      const data = await octokit.paginate(octokit.rest.repos.listForUser, {
        username: owner,
        sort: "updated",
        per_page: 100,
        type: "all",
      });
      return data;
    });
  }

  attempts.push(async () => {
    const data = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      per_page: 100,
      sort: "updated",
      affiliation: "owner,organization_member,collaborator",
    });
    return data;
  });

  let lastError: any;
  for (const attempt of attempts) {
    try {
      const repos = await attempt();
      if (repos.length > 0) return repos;
    } catch (err: any) {
      lastError = err;
      if (err?.status === 401) {
        throw new Error(credentialErrorMessage());
      }
    }
  }

  if (lastError?.status === 401) {
    throw new Error(credentialErrorMessage());
  }
  return [];
}

function getGitLabNextPage(response: globalThis.Response): number | null {
  const nextPageHeader = response.headers.get("x-next-page")?.trim();
  if (nextPageHeader) {
    const parsed = Number.parseInt(nextPageHeader, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const linkHeader = response.headers.get("link");
  if (!linkHeader) {
    return null;
  }

  const nextLink = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/i.test(part));

  if (!nextLink) {
    return null;
  }

  const match = nextLink.match(/<([^>]+)>/);
  if (!match?.[1]) {
    return null;
  }

  try {
    const nextUrl = new URL(match[1]);
    const parsed = Number.parseInt(nextUrl.searchParams.get("page") || "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeGitHubRepository(repo: any) {
  return {
    id: String(repo.id),
    name: repo.name,
    description: repo.description || "",
    url: repo.html_url,
    defaultBranch: repo.default_branch,
    language: repo.language,
    size: repo.size,
    updatedAt: repo.updated_at,
    commitCount: 0,
    contributors: [],
    contributorCount: 0,
    lastCommit: null,
    provider: "github",
  };
}

function normalizeGitLabRepository(project: any) {
  return {
    id: String(project.id),
    name: project.path_with_namespace || project.name || project.path,
    description: project.description || "",
    url: project.web_url,
    defaultBranch: project.default_branch || "main",
    language: "",
    size: 0,
    updatedAt: project.last_activity_at || project.updated_at,
    commitCount: 0,
    contributors: [],
    contributorCount: 0,
    lastCommit: null,
    provider: "gitlab",
  };
}

function normalizeAdoRepository(repo: any, organization: string, projectName: string) {
  return {
    id: repo.id,
    name: repo.name,
    organization,
    project: projectName,
    organizationName: projectName || "Organization",
    description: repo.project?.description || "",
    url: repo.url,
    webUrl: repo.webUrl,
    defaultBranch: repo.defaultBranch?.replace("refs/heads/", "") || "main",
    size: repo.size || 0,
    commitCount: 0,
    contributors: [],
    contributorCount: 0,
    lastCommit: null,
    provider: "ado",
  };
}

async function fetchGitLabGoldenProjects(
  baseUrl: string,
  token: string,
  groupOrNamespace?: string,
): Promise<any[]> {
  const headers = { "PRIVATE-TOKEN": token };

  const tryFetchJsonArray = async (baseUrlWithParams: string): Promise<any[] | null> => {
    try {
      const allResults: any[] = [];
      let page = 1;
      let sawSuccessfulPage = false;
      while (true) {
        const url = new URL(baseUrlWithParams);
        url.searchParams.set("page", String(page));
        const resp = await fetch(url.toString(), { headers });
        if (!resp.ok) {
          return sawSuccessfulPage ? allResults : null;
        }
        sawSuccessfulPage = true;
        const data = await resp.json();
        if (!Array.isArray(data)) {
          return sawSuccessfulPage ? allResults : null;
        }
        if (data.length === 0) {
          break;
        }
        allResults.push(...data);
        const nextPage = getGitLabNextPage(resp);
        if (!nextPage || nextPage === page) {
          break;
        }
        page = nextPage;
      }
      return sawSuccessfulPage ? allResults : null;
    } catch {
      return null;
    }
  };

  const namespace = (groupOrNamespace || "").trim();
  if (namespace) {
    const groupUrl = `${baseUrl}/api/v4/groups/${encodeURIComponent(namespace)}/projects?per_page=100&include_subgroups=true&order_by=updated_at&sort=desc`;
    const byGroup = await tryFetchJsonArray(groupUrl);
    console.log("[GitLab Fetch] group query result:", byGroup?.length ?? "null (failed)", "url:", groupUrl);
    if (byGroup && byGroup.length > 0) {
      return byGroup;
    }

    const userUrl = `${baseUrl}/api/v4/users/${encodeURIComponent(namespace)}/projects?per_page=100&order_by=updated_at&sort=desc`;
    const byUser = await tryFetchJsonArray(userUrl);
    console.log("[GitLab Fetch] user query result:", byUser?.length ?? "null (failed)", "url:", userUrl);
    if (byUser && byUser.length > 0) {
      return byUser;
    }
  }

  const membershipUrl = `${baseUrl}/api/v4/projects?membership=true&per_page=100&order_by=updated_at&sort=desc`;
  const byMembership = await tryFetchJsonArray(membershipUrl);
  console.log("[GitLab Fetch] membership query result:", byMembership?.length ?? "null (failed)", "url:", membershipUrl);
  return byMembership || [];
}

async function fetchUnifiedGitHubGoldenRepositories(token: string | null | undefined, owner: string): Promise<any[]> {
  const octokit = getOctokit(token || undefined);
  if (!octokit) {
    return [];
  }

  const repos = await listGitHubRepositories(octokit, owner || "");
  return repos.map(normalizeGitHubRepository);
}

async function fetchUnifiedGitLabGoldenRepositories(
  baseUrl: string,
  token: string,
  groupOrNamespace?: string,
): Promise<any[]> {
  const projects = await fetchGitLabGoldenProjects(baseUrl, token, groupOrNamespace);
  return projects.map(normalizeGitLabRepository);
}

async function fetchUnifiedAdoGoldenRepositories(settings: {
  organizationUrl: string;
  projectName: string;
  apiVersion: string;
}, pat: string): Promise<any[]> {
  let normalizedOrgUrl = settings.organizationUrl.trim();
  if (!normalizedOrgUrl.endsWith("/")) normalizedOrgUrl += "/";

  const authHeader = `Basic ${Buffer.from(`:${pat.trim()}`).toString("base64")}`;
  const repos: any[] = [];
  let continuationToken: string | null = null;

  do {
    const queryParams = new URLSearchParams({
      "api-version": settings.apiVersion,
      "$top": "1000",
    });
    if (continuationToken) {
      queryParams.set("continuationToken", continuationToken);
    }

    const reposUrl = `${normalizedOrgUrl}_apis/git/repositories?${queryParams.toString()}`;
    const reposResponse = await fetch(reposUrl, {
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
    });

    if (!reposResponse.ok) {
      throw new Error(`ADO golden repository fetch failed with status ${reposResponse.status}`);
    }

    const reposData = await reposResponse.json();
    const batch = Array.isArray(reposData?.value) ? reposData.value : [];
    repos.push(...batch);

    continuationToken =
      String(
        reposData?.continuationToken ||
          reposResponse.headers.get("x-ms-continuationtoken") ||
          "",
      ).trim() || null;
  } while (continuationToken);

  const orgName = normalizedOrgUrl
    .replace(/https?:\/\/dev\.azure\.com\//, "")
    .replace(/\/$/, "")
    .split("/")[0] || "";

  return repos
    .filter((repo: any) => repo.project?.name === settings.projectName)
    .map((repo: any) => normalizeAdoRepository(repo, orgName, settings.projectName));
}

router.get("/api/github/repositories", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = await getTenantIdFromRequest(req);
    const ghConfig = await getGitHubConfig(tenantId);
    const octokit = await getPersonalGitHubOctokit(req);
    const owner = (ghConfig.owner || "").trim();

    if (!octokit) {
      return res.status(400).json({
        error: "GitHub is not configured for your user",
        details: "Configure and validate your personal GitHub PAT/API key before loading repositories.",
        repositories: [],
        count: 0,
      });
    }

    let repos = await listGitHubRepositories(octokit, owner);

    if (repos.length === 0 && ghConfig.repo) {
      repos = [
        {
          id: `default:${ghConfig.repo}`,
          name: ghConfig.repo,
          description: "Default repository from Settings",
          html_url: owner ? `https://github.com/${owner}/${ghConfig.repo}` : "",
          default_branch: ghConfig.branch || "main",
          private: true,
        },
      ];
    }

    const repositories = repos.map((repo: any) => ({
      id: String(repo.id),
      name: repo.name,
      description: repo.description || "",
      url: repo.html_url,
      defaultBranch: repo.default_branch,
      language: repo.language,
      stars: repo.stargazers_count,
      size: repo.size,
      updatedAt: repo.updated_at,
      private: repo.private,
      provider: "github",
    }));

    res.json({ repositories, count: repositories.length });
  } catch (error: any) {
    console.error("[GitHub Repos] Error listing repositories:", error.message);
    const status = isPersonalGitHubCredentialError(error)
      ? 428
      : error?.status === 401 || error?.message?.includes("invalid or expired")
        ? 401
        : 500;
    res.status(status).json({
      error: "Failed to fetch GitHub repositories",
      details: error.message,
      repositories: [],
      count: 0,
    });
  }
});

router.get("/api/github/repository/:owner/:repo/tree", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const octokit = await getPersonalGitHubOctokit(req);
    if (!octokit) {
      return res.json({ tree: [] });
    }

    const { owner, repo } = req.params;
    const branch = (req.query.branch as string) || "main";

    const { data } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: "true",
    });

    const flatItems = data.tree
      .filter((item: any) => item.type === "blob" || item.type === "tree")
      .map((item: any) => ({
        path: item.path as string,
        type: (item.type === "tree" ? "folder" : "file") as "folder" | "file",
        size: typeof item.size === "number" && item.size > 0 ? item.size : undefined,
      }));

    const tree = buildNestedTree(flatItems);

    // Look up chunked paths by repo name (what the chunk route uses as repoId for GitHub golden repos)
    const chunkedPaths = await getChunkedPathsForRepo(repo);
    const chunkedSet = new Set(chunkedPaths.map((p) => p.toLowerCase()));

    const collectFilePaths = (nodes: ReturnType<typeof buildNestedTree>, acc: string[]) => {
      for (const node of nodes) {
        if (node.type === "file") acc.push(node.path.replace(/^\/+/, "").replace(/\/+/g, "/"));
        if (node.type === "folder" && node.children) collectFilePaths(node.children, acc);
      }
    };
    const allFilePaths: string[] = [];
    collectFilePaths(tree, allFilePaths);
    const allChunked = allFilePaths.length > 0 && allFilePaths.every((p) => chunkedSet.has(p.toLowerCase()));

    res.json({ tree, chunkedPaths, allChunked });
  } catch (error: any) {
    console.error("[GitHub Repos] Error fetching tree:", error.message);
    res.status(isPersonalGitHubCredentialError(error) ? 428 : 500).json({
      error: "Failed to fetch repository tree",
      details: error.message,
    });
  }
});

router.get("/api/github/repository/:owner/:repo/file", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const octokit = await getPersonalGitHubOctokit(req);
    if (!octokit) {
      return res.status(404).json({ error: "GitHub not configured" });
    }

    const { owner, repo } = req.params;
    const filePath = req.query.path as string;
    const branch = (req.query.branch as string) || "main";

    if (!filePath) {
      return res.status(400).json({ error: "path query parameter is required" });
    }

    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branch,
    });

    if (Array.isArray(data)) {
      return res.status(400).json({ error: "Path is a directory, not a file" });
    }

    const buffer = Buffer.from((data as any).content, "base64");
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    const content = isPdf
      ? await extractMarkdownFromPdfBuffer(buffer)
      : buffer.toString("utf-8");
    res.json({
      content,
      path: filePath,
      size: (data as any).size || buffer.length,
      convertedFrom: isPdf ? "pdf" : undefined,
    });
  } catch (error: any) {
    if (error.status === 404) {
      return res.status(404).json({ error: "File not found" });
    }
    console.error("[GitHub Repos] Error fetching file:", error.message);
    res.status(isPersonalGitHubCredentialError(error) ? 428 : 500).json({
      error: "Failed to fetch file",
      details: error.message,
    });
  }
});

router.get("/api/github/repository/:owner/:repo/download", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const octokit = await getPersonalGitHubOctokit(req);
    if (!octokit) {
      return res.status(404).json({ error: "GitHub not configured" });
    }

    const { owner, repo } = req.params;
    const branch = (req.query.branch as string) || "main";

    const { data } = await octokit.rest.repos.downloadZipballArchive({
      owner,
      repo,
      ref: branch,
    }) as any;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${repo}.zip"`);
    res.send(Buffer.from(data as ArrayBuffer));
  } catch (error: any) {
    console.error("[GitHub Repos] Error downloading repo:", error.message);
    res.status(isPersonalGitHubCredentialError(error) ? 428 : 500).json({
      error: "Failed to download repository",
      details: error.message,
    });
  }
});

router.post("/api/github/fork-repository", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const octokit = await getPersonalGitHubOctokit(req);
    if (!octokit) {
      return res.status(404).json({ error: "GitHub not configured" });
    }

    const { owner, repo, organization, newName } = req.body;

    if (!owner || !repo) {
      return res.status(400).json({ error: "owner and repo are required" });
    }

    const forkParams: any = { owner, repo };
    if (organization) forkParams.organization = organization;
    if (newName) forkParams.name = newName;

    const { data: forked } = await octokit.rest.repos.createFork(forkParams);

    return res.json({
      success: true,
      id: String(forked.id),
      name: forked.name,
      webUrl: forked.html_url,
    });
  } catch (error: any) {
    console.error("[GitHub Repos] Error forking repository:", error.message);
    const status = isPersonalGitHubCredentialError(error) ? 428 : error?.status === 422 ? 422 : 500;
    res.status(status).json({ error: "Failed to fork repository", details: error.message });
  }
});

const goldenReposCache = new Map<string, { data: any[], count: number, provider: string, expires: number }>();

router.get("/api/golden-repositories", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const domain = typeof req.query.domain === "string" ? req.query.domain : "";
  const page = Number.parseInt(String(req.query.page || ""), 10);
  const pageSize = Number.parseInt(String(req.query.pageSize || ""), 10);

  const applyPaginationAndSearch = (repos: any[]) => {
    let filtered = repos;
    if (search && search.trim() !== "") {
      const query = search.toLowerCase();
      filtered = filtered.filter((repo) =>
        repo.name?.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query) ||
        repo.url?.toLowerCase().includes(query) ||
        String(repo.id).toLowerCase().includes(query)
      );
    }
    
    if (domain && domain !== "all") {
      const normalizedDomain = domain.toLowerCase();
      filtered = filtered.filter((repo) => {
        const repoDomain = (repo.domain || "general").toLowerCase();
        const nameMatches = repo.name?.toLowerCase().includes(normalizedDomain);
        const tagMatches = Array.isArray(repo.tags) && repo.tags.some(
          (tag: any) => typeof tag === "string" && tag.toLowerCase().includes(normalizedDomain)
        );
        return repoDomain === normalizedDomain || nameMatches || tagMatches;
      });
    }
    
    const totalCount = filtered.length;

    if (!isNaN(page) && !isNaN(pageSize) && page > 0 && pageSize > 0) {
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      filtered = filtered.slice(startIndex, endIndex);
    }
    
    return { repositories: filtered, totalCount };
  };

  const logResponseSummary = (provider: string, source: "cache" | "live") => {
    console.log("[Golden Repos] Response summary", {
      provider,
      source,
      search: search || null,
      domain: domain || "all",
      page: Number.isNaN(page) ? null : page,
      pageSize: Number.isNaN(pageSize) ? null : pageSize,
    });
  };

  try {
    const tenantId = await getTenantIdFromRequest(req);
    const userId = (req as any).user?.id;
    console.log("[Golden Repos] tenantId resolved:", tenantId, "userId:", userId);

    const cacheKey = `${tenantId || 'default'}-${userId || 'default'}`;
    const cached = goldenReposCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      console.log(`[Golden Repos] Returning cached results for ${cacheKey}`);
      const result = applyPaginationAndSearch(cached.data);
      console.log("[Golden Repos] Cached dataset stats", {
        provider: cached.provider,
        totalFetched: cached.data.length,
        filteredCount: result.totalCount,
        returnedCount: result.repositories.length,
      });
      logResponseSummary(cached.provider, "cache");
      return res.json({ repositories: result.repositories, count: result.totalCount, provider: cached.provider });
    }

    let allFetchedRepos: any[] = [];
    let providerName = "unknown";

    const gitRows = tenantId
      ? await db
          .select()
          .from(schema.integrations)
          .where(
            and(
              eq(schema.integrations.tenantId, tenantId),
              inArray(schema.integrations.integrationType, ["golden_github", "golden_gitlab"]),
              eq(schema.integrations.status, "active"),
            ),
          )
          .limit(1)
      : [];

    console.log("[Golden Repos] Git integration rows found:", gitRows.length, gitRows.map(r => ({ type: r.integrationType, hasToken: !!r.apiKey, group: r.appKey, baseUrl: r.baseUrl })));

    if (gitRows.length > 0) {
      const row = gitRows[0];

      if (row.integrationType === "golden_github") {
        const owner = row.appKey || "";

        if (!row.apiKey) {
          return res.json({ repositories: [], count: 0, provider: "github" });
        }
        const repositories = await fetchUnifiedGitHubGoldenRepositories(row.apiKey, owner);

        providerName = "github";
        allFetchedRepos = repositories;
        
        goldenReposCache.set(cacheKey, { data: allFetchedRepos, count: allFetchedRepos.length, provider: providerName, expires: Date.now() + 5 * 60 * 1000 });
        const result = applyPaginationAndSearch(allFetchedRepos);
        console.log("[Golden Repos] Live dataset stats", {
          provider: providerName,
          totalFetched: allFetchedRepos.length,
          filteredCount: result.totalCount,
          returnedCount: result.repositories.length,
        });
        logResponseSummary(providerName, "live");
        return res.json({ repositories: result.repositories, count: result.totalCount, provider: providerName });
      }

      if (row.integrationType === "golden_gitlab") {
        const baseUrl = (row.baseUrl || "https://gitlab.com").replace(/\/+$/, "");
        const token = row.apiKey;
        const group = row.appKey || "";

        console.log("[Golden Repos] GitLab config - baseUrl:", baseUrl, "group:", group, "hasToken:", !!token);

        if (!token) {
          console.warn("[Golden Repos] GitLab token missing, returning empty");
          return res.json({ repositories: [], count: 0, provider: "gitlab" });
        }

        const repositories = await fetchUnifiedGitLabGoldenRepositories(baseUrl, token, group);
        console.log("[Golden Repos] GitLab projects fetched:", repositories.length);

        providerName = "gitlab";
        allFetchedRepos = repositories;

        goldenReposCache.set(cacheKey, { data: allFetchedRepos, count: allFetchedRepos.length, provider: providerName, expires: Date.now() + 5 * 60 * 1000 });
        const result = applyPaginationAndSearch(allFetchedRepos);
        console.log("[Golden Repos] Live dataset stats", {
          provider: providerName,
          totalFetched: allFetchedRepos.length,
          filteredCount: result.totalCount,
          returnedCount: result.repositories.length,
        });
        logResponseSummary(providerName, "live");
        return res.json({ repositories: result.repositories, count: result.totalCount, provider: providerName });
      }
    }

    const { storage } = await import("../storage");
    const { getGoldenRepoPAT } = await import("../services/golden-repo-service");
    const { isEncryptionAvailable } = await import("../crypto-utils");

    if (!isEncryptionAvailable()) {
      return res.json({ repositories: [], count: 0, provider: "ado" });
    }

    const settings = await storage.getAdoSettings();
    if (!settings) {
      return res.json({ repositories: [], count: 0, provider: "ado" });
    }

    const decryptedPat = await getGoldenRepoPAT();
    if (!decryptedPat) {
      return res.json({ repositories: [], count: 0, provider: "ado" });
    }

    let repositories: any[] = [];
    try {
      repositories = await fetchUnifiedAdoGoldenRepositories(settings, decryptedPat);
    } catch (error: any) {
      console.warn("[Golden Repos] ADO unified fetch failed:", error?.message || error);
      return res.json({ repositories: [], count: 0, provider: "ado" });
    }

    providerName = "ado";
    allFetchedRepos = repositories;

    goldenReposCache.set(cacheKey, { data: allFetchedRepos, count: allFetchedRepos.length, provider: providerName, expires: Date.now() + 5 * 60 * 1000 });
    const result = applyPaginationAndSearch(allFetchedRepos);
    console.log("[Golden Repos] Live dataset stats", {
      provider: providerName,
      totalFetched: allFetchedRepos.length,
      filteredCount: result.totalCount,
      returnedCount: result.repositories.length,
    });
    logResponseSummary(providerName, "live");
    res.json({ repositories: result.repositories, count: result.totalCount, provider: providerName });
  } catch (error: any) {
    console.error("[Golden Repos] Error in unified listing:", error.message);
    res.status(500).json({
      error: "Failed to fetch golden repositories",
      details: error.message,
    });
  }
});

/** Live golden repo count for dashboard — GitHub/GitLab integrations first, then ADO settings. */
export async function getLiveGoldenRepositoriesCount(
  tenantId: string | null,
): Promise<number> {
  const gitRows = tenantId
    ? await db
        .select()
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.tenantId, tenantId),
            inArray(schema.integrations.integrationType, ["golden_github", "golden_gitlab"]),
            eq(schema.integrations.status, "active"),
          ),
        )
        .limit(1)
    : [];

  if (gitRows.length > 0) {
    const row = gitRows[0];

    if (row.integrationType === "golden_github") {
      const octokit = getOctokit(row.apiKey);
      const owner = row.appKey || "";
      if (!octokit || !owner) return 0;
      try {
        const repos = await listGitHubRepositories(octokit, owner);
        return repos.length;
      } catch (err: any) {
        console.warn("[Golden Repos] Live count (GitHub) failed:", err?.message || err);
        return 0;
      }
    }

    if (row.integrationType === "golden_gitlab") {
      const baseUrl = (row.baseUrl || "https://gitlab.com").replace(/\/+$/, "");
      const token = row.apiKey;
      const group = row.appKey || "";
      if (!token) return 0;
      try {
        const projects = await fetchGitLabGoldenProjects(baseUrl, token, group);
        return projects.length;
      } catch (err: any) {
        console.warn("[Golden Repos] Live count (GitLab) failed:", err?.message || err);
        return 0;
      }
    }
  }

  const { storage } = await import("../storage");
  return storage.getGoldenRepositoriesCountFromAdoSettings();
}

export function registerGitHubRepoRoutes(app: any) {
  app.use(router);
  if (isAwsHosting()) {
    console.log("[GitHub Routes] Registered GitHub repository routes");
  }
}
