import { Router, Request, Response } from "express";
import { requireAuth, autoBootstrapUser } from "../auth/middleware";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import mammoth from "mammoth";
import { extractMarkdownFromPdfBuffer } from "../helper/brd-document-parser";
import { getTenantIdFromRequest } from "../services/github-config-resolver";
import {
  getGitlabClientForUser,
  UserGitlabCredentialMissingError,
  UserGitlabCredentialInvalidError,
} from "../integrations/gitlab/user-credential-resolver";

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

function getUserId(req: Request): string | null {
  return (req as any).user?.id ?? null;
}

/**
 * Resolve the acting user's GitLab credential.
 * Returns null only when there is no authenticated user.
 */
async function getUserGitLabConfig(req: Request) {
  const userId = getUserId(req);
  if (!userId) return null;
  const client = await getGitlabClientForUser(userId);
  return { token: client.token, baseUrl: client.baseUrl };
}

async function getGitLabConfig(tenantId: string | null) {
  if (!tenantId) return null;
  const rows = await db
    .select()
    .from(schema.integrations)
    .where(
      and(
        eq(schema.integrations.tenantId, tenantId),
        eq(schema.integrations.integrationType, "golden_gitlab"),
        eq(schema.integrations.status, "active"),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  return {
    token: rows[0].apiKey,
    group: rows[0].appKey || "",
    baseUrl: (rows[0].baseUrl || "https://gitlab.com").replace(/\/+$/, ""),
  };
}

function shouldUseGoldenGitLabConfig(req: Request): boolean {
  const isGoldenRepo = String(req.query.isGoldenRepo || "").toLowerCase() === "true";
  return Boolean(
    isGoldenRepo ||
      req.query.linkedGoldenRepoOrg ||
      req.query.linkedGoldenRepoProject,
  );
}

async function getGitLabConfigForRepositoryRequest(req: Request) {
  if (shouldUseGoldenGitLabConfig(req)) {
    const tenantId = await getTenantIdFromRequest(req);
    const goldenConfig = await getGitLabConfig(tenantId);
    if (goldenConfig?.token) {
      return goldenConfig;
    }
  }

  return getUserGitLabConfig(req);
}

function handleGitlabError(res: Response, error: any) {
  if (error instanceof UserGitlabCredentialMissingError) {
    return res.status(428).json({ code: error.code, message: error.message });
  }
  if (error instanceof UserGitlabCredentialInvalidError) {
    return res.status(401).json({ code: error.code, message: error.message });
  }
  return null;
}

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

async function gitlabFetch(baseUrl: string, path: string, token: string) {
  const url = `${baseUrl}/api/v4${path}`;
  const resp = await fetch(url, {
    headers: { "PRIVATE-TOKEN": token },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`GitLab API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

router.get("/api/gitlab/repository/:projectId/tree", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    let resolvedConfig = null;
    let userError = null;
    try {
      resolvedConfig = await getGitLabConfigForRepositoryRequest(req);
    } catch (err) {
      userError = err;
    }

    const config = resolvedConfig;
    if (!config) {
      if (userError) throw userError;
      return res.json({ tree: [] });
    }

    const tryGitlabFetch = async (path: string) => {
      return await gitlabFetch(config.baseUrl, path, config.token);
    };

    const { projectId } = req.params;
    let branch = (req.query.branch as string) || "";
    if (!branch) {
      try {
        const projectInfo: any = await tryGitlabFetch(`/projects/${encodeURIComponent(projectId)}`);
        branch = projectInfo.default_branch || "main";
      } catch {
        branch = "main";
      }
    }

    let allItems: any[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const items: any[] = await tryGitlabFetch(
        `/projects/${encodeURIComponent(projectId)}/repository/tree?recursive=true&per_page=${perPage}&page=${page}&ref=${encodeURIComponent(branch)}`
      );
      allItems = allItems.concat(items);
      if (items.length < perPage) break;
      page++;
    }

    const flatItems = allItems.map((item: any) => ({
      path: item.path as string,
      type: (item.type === "tree" ? "folder" : "file") as "folder" | "file",
      size: typeof item.size === "number" && item.size > 0 ? item.size : undefined,
    }));

    const tree = buildNestedTree(flatItems);

    // Add chunking status from DevX guideline cache (same as ADO tree endpoint)
    const chunkedPaths = await getChunkedPathsForRepo(projectId);
    const chunkedSet = new Set(chunkedPaths.map((p) => p.toLowerCase()));

    const collectFilePaths = (nodes: TreeNode[], acc: string[]) => {
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
    if (handleGitlabError(res, error)) return;
    console.error("[GitLab Repos] Error fetching tree:", error.message);
    res.status(500).json({ error: "Failed to fetch repository tree", details: error.message });
  }
});

router.get("/api/gitlab/repository/:projectId/file", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    let userConfig = null;
    let userError = null;
    try {
      userConfig = await getGitLabConfigForRepositoryRequest(req);
    } catch (err) {
      userError = err;
    }

    const config = userConfig;
    if (!config) {
      if (userError) throw userError;
      return res.status(404).json({ error: "GitLab not configured" });
    }

    const tryGitlabFetch = async (path: string) => {
      return await gitlabFetch(config.baseUrl, path, config.token);
    };

    const { projectId } = req.params;
    const filePath = req.query.path as string;
    let branch = (req.query.branch as string) || "";
    if (!branch) {
      try {
        const projectInfo: any = await tryGitlabFetch(`/projects/${encodeURIComponent(projectId)}`);
        branch = projectInfo.default_branch || "main";
      } catch {
        branch = "main";
      }
    }

    if (!filePath) {
      return res.status(400).json({ error: "path query parameter is required" });
    }

    const encodedPath = encodeURIComponent(filePath);
    const data: any = await tryGitlabFetch(
      `/projects/${encodeURIComponent(projectId)}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`
    );

    const buffer = Buffer.from(data.content, "base64");
    const isPdf = filePath.toLowerCase().endsWith(".pdf");
    const content = isPdf
      ? await extractMarkdownFromPdfBuffer(buffer)
      : buffer.toString("utf-8");
    res.json({
      content,
      path: filePath,
      size: data.size || buffer.length,
      convertedFrom: isPdf ? "pdf" : undefined,
    });
  } catch (error: any) {
    if (handleGitlabError(res, error)) return;
    if (error.message?.includes("404")) {
      return res.status(404).json({ error: "File not found" });
    }
    console.error("[GitLab Repos] Error fetching file:", error.message);
    res.status(500).json({ error: "Failed to fetch file", details: error.message });
  }
});

router.post("/api/gitlab/fork-repository", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getUserGitLabConfig(req);
    if (!config) {
      return res.status(404).json({ error: "GitLab not configured" });
    }

    const { sourceProjectId, namespacePath, newName, newPath } = req.body;

    if (!sourceProjectId) {
      return res.status(400).json({ error: "sourceProjectId is required" });
    }

    const body: Record<string, string> = {};
    if (namespacePath) body.namespace_path = namespacePath;
    if (newName) body.name = newName;
    if (newPath) body.path = newPath;

    const url = `${config.baseUrl}/api/v4/projects/${encodeURIComponent(sourceProjectId)}/fork`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": config.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text);
        detail = parsed.message || parsed.error || detail;
      } catch { /* keep raw text */ }
      return res.status(resp.status).json({ error: `GitLab fork failed: ${detail}` });
    }

    const forked = await resp.json();
    return res.json({
      success: true,
      id: String(forked.id),
      name: forked.name,
      webUrl: forked.web_url,
    });
  } catch (error: any) {
    if (handleGitlabError(res, error)) return;
    console.error("[GitLab Repos] Error forking repository:", error.message);
    res.status(500).json({ error: "Failed to fork repository", details: error.message });
  }
});

router.get("/api/gitlab/repository/:projectId/download", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getGitLabConfigForRepositoryRequest(req);
    if (!config) {
      return res.status(404).json({ error: "GitLab not configured" });
    }

    const { projectId } = req.params;

    // Resolve the actual default branch from the project to avoid branch mismatches
    let branch = (req.query.branch as string) || "";
    if (!branch) {
      try {
        const projectInfo: any = await gitlabFetch(config.baseUrl, `/projects/${encodeURIComponent(projectId)}`, config.token);
        branch = projectInfo.default_branch || "main";
      } catch {
        branch = "main";
      }
    }

    const encodedSha = encodeURIComponent(branch);
    const encodedId = encodeURIComponent(projectId);

    // Try multiple URL formats — some self-hosted GitLab instances don't support
    // the `.zip` path suffix and require a `format` query parameter instead.
    const urlCandidates = [
      `${config.baseUrl}/api/v4/projects/${encodedId}/repository/archive?sha=${encodedSha}&format=zip`,
      `${config.baseUrl}/api/v4/projects/${encodedId}/repository/archive.zip?sha=${encodedSha}`,
      `${config.baseUrl}/api/v4/projects/${encodedId}/repository/archive.tar.gz?sha=${encodedSha}`,
    ];

    let lastStatus = 0;
    for (const url of urlCandidates) {
      const resp = await fetch(url, {
        headers: {
          "PRIVATE-TOKEN": config.token,
          "Accept": "application/octet-stream, application/zip, */*",
        },
        redirect: "follow",
      });

      if (resp.ok) {
        const buffer = Buffer.from(await resp.arrayBuffer());
        const isGzip = url.endsWith(".tar.gz");
        const contentType = isGzip ? "application/gzip" : "application/zip";
        const filename = isGzip ? "repository.tar.gz" : "repository.zip";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(buffer);
      }

      lastStatus = resp.status;
      // Only retry on 406 (Not Acceptable) — other errors are definitive
      if (resp.status !== 406) {
        const text = await resp.text().catch(() => "");
        throw new Error(`GitLab archive download failed: ${resp.status} — ${text.slice(0, 200)}`);
      }
    }

    throw new Error(`GitLab archive download failed: all formats returned ${lastStatus}`);
  } catch (error: any) {
    if (handleGitlabError(res, error)) return;
    console.error("[GitLab Repos] Error downloading repo:", error.message);
    res.status(500).json({ error: "Failed to download repository", details: error.message });
  }
});

router.post("/api/gitlab/repository/:projectId/upload", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await getUserGitLabConfig(req);
    if (!config) {
      return res.status(404).json({ error: "GitLab not configured" });
    }

    const { projectId } = req.params;
    const { files: fileData, branch: reqBranch } = req.body;

    if (!fileData || !Array.isArray(fileData) || fileData.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    // Resolve branch from project if not provided
    let branch = (reqBranch as string) || "";
    if (!branch) {
      try {
        const projectInfo: any = await gitlabFetch(config.baseUrl, `/projects/${encodeURIComponent(projectId)}`, config.token);
        branch = projectInfo.default_branch || "main";
      } catch {
        branch = "main";
      }
    }

    const decodeToBuffer = (raw: string): Buffer | null => {
      try {
        if (raw.startsWith("data:")) {
          const commaIdx = raw.indexOf(",");
          const b64 = commaIdx >= 0 ? raw.slice(commaIdx + 1) : "";
          if (!b64) return null;
          return Buffer.from(b64, "base64");
        }
        if (!raw.trim()) return null;
        return Buffer.from(raw, "base64");
      } catch {
        return null;
      }
    };

    const storedPaths: string[] = [];

    for (const file of fileData) {
      let targetPath: string = file.path || "";
      if (!targetPath) {
        targetPath = `/${file.name || "file"}`;
      }
      if (!targetPath.startsWith("/")) targetPath = `/${targetPath}`;
      targetPath = targetPath.replace(/\\/g, "/");

      let textContent = "";
      if (file.content) {
        const lowerName = (file.name || "").toLowerCase();
        const lowerPath = targetPath.toLowerCase();
        const isPdf = lowerName.endsWith(".pdf") || lowerPath.endsWith(".pdf");
        const isTxt = lowerName.endsWith(".txt") || lowerPath.endsWith(".txt");
        const isDocx = lowerName.endsWith(".docx") || lowerPath.endsWith(".docx");

        const buffer = decodeToBuffer(file.content);
        if (!buffer) {
          textContent = file.content;
        } else if (isPdf) {
          try {
            textContent = await extractMarkdownFromPdfBuffer(buffer);
            targetPath = targetPath.replace(/\.pdf$/i, ".md");
          } catch {
            textContent = "_PDF parse failed. Please re-upload a text-searchable PDF._";
            targetPath = targetPath.replace(/\.pdf$/i, ".md");
          }
        } else if (isDocx) {
          try {
            const result = await mammoth.extractRawText({ buffer });
            textContent = result.value || "";
            targetPath = targetPath.replace(/\.docx$/i, ".md");
          } catch {
            textContent = "_DOCX parse failed._";
            targetPath = targetPath.replace(/\.docx$/i, ".md");
          }
        } else if (isTxt) {
          textContent = buffer.toString("utf8");
          targetPath = targetPath.replace(/\.txt$/i, ".md");
        } else {
          textContent = buffer.toString("utf8");
        }
      }

      // Strip leading slash for GitLab file path in URL
      const gitlabFilePath = targetPath.replace(/^\/+/, "");
      const encodedFilePath = encodeURIComponent(gitlabFilePath);

      const filePayload = {
        branch,
        content: textContent,
        commit_message: `Upload ${gitlabFilePath} via DevX`,
        encoding: "text",
      };

      // Try POST (create); fall back to PUT (update) if file already exists
      const baseFileUrl = `${config.baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encodedFilePath}`;
      let uploadResp = await fetch(baseFileUrl, {
        method: "POST",
        headers: { "PRIVATE-TOKEN": config.token, "Content-Type": "application/json" },
        body: JSON.stringify(filePayload),
      });

      if (!uploadResp.ok && uploadResp.status === 400) {
        // File may already exist — try updating
        uploadResp = await fetch(baseFileUrl, {
          method: "PUT",
          headers: { "PRIVATE-TOKEN": config.token, "Content-Type": "application/json" },
          body: JSON.stringify(filePayload),
        });
      }

      if (!uploadResp.ok) {
        const text = await uploadResp.text().catch(() => "");
        throw new Error(`Failed to upload ${gitlabFilePath}: ${uploadResp.status} — ${text.slice(0, 200)}`);
      }

      storedPaths.push(targetPath);
    }

    return res.json({ success: true, files: storedPaths });
  } catch (error: any) {
    if (handleGitlabError(res, error)) return;
    console.error("[GitLab Repos] Error uploading file:", error.message);
    res.status(500).json({ error: "Failed to upload file", details: error.message });
  }
});

export { getGitLabConfig, gitlabFetch };

export function registerGitLabRepoRoutes(app: any) {
  app.use(router);
  console.log("[GitLab Routes] Registered GitLab repository routes");
}
