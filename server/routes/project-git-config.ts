/**
 * Project Git config routes: test artifacts repository (GitHub or ADO).
 * GET/POST/PUT/DELETE /api/projects/:projectId/git-config
 */

import type { Express, Request, Response } from "express";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { projectGitConfig } from "@shared/schema";
import { randomUUID } from "crypto";
import { encryptPAT, safeDecryptPAT } from "../crypto-utils";
import { AdoGitStorage } from "./ado-git-service";
import { GitHubGitStorage } from "./github-git-storage";
import { getGitHubConfig, getTenantIdFromRequest } from "../services/github-config-resolver";

export function registerProjectGitConfigRoutes(app: Express): void {
  // GET - Read project git config
  app.get("/api/projects/:projectId/git-config", async (req: Request, res: Response) => {
    const projectId = req.params.projectId;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    try {
      const rows = await db.select().from(projectGitConfig).where(eq(projectGitConfig.projectId, projectId)).limit(1);
      const config = rows[0] ?? null;
      return res.json(config);
    } catch (e: any) {
      if (e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146) {
        return res.json(null);
      }
      const msg = e instanceof Error ? e.message : "Unknown error";
      return res.status(500).json({ error: "Failed to get project git config", details: msg });
    }
  });

  // POST - Push BDD Assets to GitHub
  app.post("/api/bdd-assets/push-to-github", async (req: Request, res: Response) => {
    const { featureFiles, stepDefFiles, userStory, organization, projectName, branch: reqBranch, targetPath } = req.body;

    if (!featureFiles || !stepDefFiles || !userStory) {
      return res.status(400).json({
        error: "Missing required parameters: featureFiles, stepDefFiles, userStory",
      });
    }

    try {
      const tenantId = await getTenantIdFromRequest(req);
      const ghCfg = await getGitHubConfig(tenantId);
      const githubConfig = {
        token: ghCfg.token,
        owner: ghCfg.owner,
        repo: ghCfg.repo,
        branch: reqBranch || ghCfg.branch,
        basePath: targetPath || 'test-artifacts'
      };

      if (!githubConfig.token || !githubConfig.owner || !githubConfig.repo) {
        throw new Error(
          `GitHub not configured. Go to Settings > Third-Party Integrations to set up your GitHub connection.`
        );
      }
      const { BDDAssetsManager } = await import("../services/bdd-assets-manager");
      const manager = new BDDAssetsManager();

      // Organize files into folder structure with organization and project
      const structure = manager.organizeBDDAssets(featureFiles, stepDefFiles, userStory, organization, projectName);

      // Push to GitHub
      const result = await manager.pushToGitHub(structure, githubConfig);

      if (!result.success) {
        throw new Error(result.error || "GitHub push failed");
      }
      return res.json({
        success: true,
        commitSha: result.commitSha,
        folderStructure: structure.rootFolder,
        repoUrl: `https://github.com/${githubConfig.owner}/${githubConfig.repo}/tree/${githubConfig.branch}`,
        message: `BDD assets pushed to GitHub successfully`
      });
    } catch (error) {
      console.error("[API] Error pushing BDD assets to GitHub:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({
        error: "Failed to push BDD assets to GitHub",
        details: msg,
      });
    }
  });

  // PUT - Update project git config
  app.put("/api/projects/:projectId/git-config", async (req: Request, res: Response) => {
    const projectId = req.params.projectId;
    const body = req.body as { 
      provider?: "github" | "ado"; 
      branch?: string; 
      basePath?: string; 
      adoRepositoryId?: string; 
      adoRepositoryName?: string;
      token?: string;
    };
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    const provider = (body.provider === "github" || body.provider === "ado") ? body.provider : "ado";
    const branch = (typeof body.branch === "string" && body.branch.trim()) ? body.branch.trim() : "main";
    const basePath = typeof body.basePath === "string" && body.basePath.trim() ? body.basePath.trim() : null;
    const adoRepositoryId = typeof body.adoRepositoryId === "string" && body.adoRepositoryId.trim() ? body.adoRepositoryId.trim() : null;
    const adoRepositoryName = typeof body.adoRepositoryName === "string" && body.adoRepositoryName.trim() ? body.adoRepositoryName.trim() : null;
    
    // Encrypt the token if provided
    const encryptedToken = body.token ? encryptPAT(body.token) : undefined;

    try {
      const existing = await db.select().from(projectGitConfig).where(eq(projectGitConfig.projectId, projectId)).limit(1);
      const payload: any = {
        projectId,
        provider,
        branch,
        basePath,
        adoRepositoryId,
        adoRepositoryName,
        updatedAt: new Date(),
      };
      
      // Only update token if it was provided in the request
      if (encryptedToken !== undefined) {
        payload.token = encryptedToken;
      }

      if (existing.length > 0) {
        await db.update(projectGitConfig).set(payload).where(eq(projectGitConfig.projectId, projectId));
      } else {
        await db.insert(projectGitConfig).values({ ...payload, id: randomUUID() });
      }
      const [row] = await db.select().from(projectGitConfig).where(eq(projectGitConfig.projectId, projectId)).limit(1);
      return res.json(row);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTableMissing =
        e?.code === "ER_NO_SUCH_TABLE" ||
        e?.errno === 1146 ||
        (typeof e?.message === "string" && (e.message.includes("doesn't exist") || e.message.includes("Unknown table") || e.message.includes("project_git_config")));
      console.error("[API] PUT git-config error:", { code: e?.code, errno: e?.errno, message: msg, isTableMissing });
      const code = isTableMissing ? 503 : 500;
      const details = isTableMissing
        ? "project_git_config table is missing. Run the migration: migrations/manual/add-project-git-config-table.sql"
        : msg;
      return res.status(code).json({ error: "Failed to save project git config", details });
    }
  });

  // DELETE - Remove project git config
  app.delete("/api/projects/:projectId/git-config", async (req: Request, res: Response) => {
    const projectId = req.params.projectId;
    if (!projectId) return res.status(400).json({ error: "projectId required" });
    try {
      await db.delete(projectGitConfig).where(eq(projectGitConfig.projectId, projectId));
      return res.json({ success: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return res.status(500).json({ error: "Failed to delete project git config", details: msg });
    }
  });
}
