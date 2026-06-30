/**
 * ADO Epic Design routes: epic comments (Figma link extraction) and attachment proxy for design modal.
 */

import type { Express } from "express";
import { storage } from "../storage";
import { isEncryptionAvailable, safeDecryptPAT } from "../crypto-utils";
import type { AzureConfig } from "../azure-devops-service";

export function registerAdoEpicDesignRoutes(
  app: Express,
  deps: { getAzureDevOpsConfig: (projectName?: string, organization?: string) => Promise<AzureConfig | null> }
) {
  const { getAzureDevOpsConfig } = deps;

  // GET /api/ado/epics/:epicId/comments - fetch comments for an epic work item and extract Figma link + attachments
  app.get("/api/ado/epics/:epicId/comments", async (req, res) => {
    try {
      const { epicId } = req.params;
      const projectName = req.query.projectName as string | undefined;
      const organizationUrl = (req.query.organizationUrl || req.query.organization) as string | undefined;

      if (!epicId) {
        return res.status(400).json({ error: "epicId is required" });
      }

      const epicIdNum = parseInt(epicId, 10);
      if (isNaN(epicIdNum)) {
        return res.status(400).json({ error: "Invalid epicId" });
      }

      let azureConfig: AzureConfig | null = null;

      if (projectName && organizationUrl && typeof organizationUrl === "string") {
        if (!isEncryptionAvailable()) {
          return res.status(503).json({
            error: "Artifact organizations feature is not available",
          });
        }

        const artifactOrgs = await storage.getArtifactOrganizations();
        const targetOrg = artifactOrgs.find((org) => org.organizationUrl === organizationUrl);

        if (!targetOrg || !targetOrg.patToken) {
          return res.status(400).json({ error: "No artifact organization found with PAT" });
        }

        const pat = safeDecryptPAT(targetOrg.patToken);
        if (!pat) {
          return res.status(500).json({ error: "Failed to decrypt PAT token" });
        }

        let organizationName = "";
        if (organizationUrl.includes("dev.azure.com")) {
          const orgMatch = organizationUrl.match(/https?:\/\/dev\.azure\.com\/([^\/\?]+)/);
          organizationName = orgMatch ? orgMatch[1].trim() : "";
        } else if (organizationUrl.includes("visualstudio.com")) {
          const orgMatch = organizationUrl.match(/https?:\/\/([^\.]+)\.visualstudio\.com/);
          organizationName = orgMatch ? orgMatch[1].trim() : "";
        }

        if (!organizationName) {
          return res.status(400).json({ error: `Invalid organization URL format: ${organizationUrl}` });
        }

        azureConfig = {
          organization: organizationName,
          project: projectName as string,
          pat,
        };
      } else {
        azureConfig = await getAzureDevOpsConfig(projectName as string);
      }

      if (!azureConfig) {
        return res.json({ comments: [], figmaLink: null, attachments: [] });
      }

      const { AzureDevOpsService } = await import("../azure-devops-service");
      const adoService = new AzureDevOpsService(azureConfig);
      const [commentsResult, attachmentsRaw] = await Promise.all([
        adoService.getWorkItemComments(epicIdNum, azureConfig.project),
        adoService.getWorkItemAttachments(epicIdNum, azureConfig.project).catch(() => []),
      ]);
      const attachments = (attachmentsRaw || []).map((a: { id?: string; name?: string }) => ({
        id: (a.id || "").split("?")[0],
        name: a.name || "file",
      }));
      res.json({ ...commentsResult, attachments });
    } catch (error) {
      console.error("[ADO Epic Comments] Fatal error:", error);
      res.status(500).json({
        error: "Failed to fetch epic comments",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/ado/epics/:epicId/attachments/:attachmentId/content - proxy attachment content (for image preview)
  app.get("/api/ado/epics/:epicId/attachments/:attachmentId/content", async (req, res) => {
    try {
      const { attachmentId } = req.params;
      const fileName = (req.query.fileName as string) || "file";
      const projectName = req.query.projectName as string | undefined;
      const organizationUrl = (req.query.organizationUrl || req.query.organization) as string | undefined;

      if (!attachmentId || !projectName || !organizationUrl) {
        return res.status(400).json({
          error: "attachmentId, projectName, and organizationUrl are required",
        });
      }

      let azureConfig: AzureConfig | null = null;
      if (organizationUrl && typeof organizationUrl === "string") {
        if (!isEncryptionAvailable()) {
          return res.status(503).json({ error: "Artifact organizations feature is not available" });
        }
        const artifactOrgs = await storage.getArtifactOrganizations();
        const targetOrg = artifactOrgs.find((org: { organizationUrl?: string }) => org.organizationUrl === organizationUrl);
        if (!targetOrg?.patToken) {
          return res.status(400).json({ error: "No artifact organization found with PAT" });
        }
        const pat = safeDecryptPAT(targetOrg.patToken);
        if (!pat) return res.status(500).json({ error: "Failed to decrypt PAT" });
        let organizationName = "";
        if (organizationUrl.includes("dev.azure.com")) {
          const m = organizationUrl.match(/https?:\/\/dev\.azure\.com\/([^\/\?]+)/);
          organizationName = m ? m[1].trim() : "";
        } else if (organizationUrl.includes("visualstudio.com")) {
          const m = organizationUrl.match(/https?:\/\/([^\.]+)\.visualstudio\.com/);
          organizationName = m ? m[1].trim() : "";
        }
        if (!organizationName) return res.status(400).json({ error: "Invalid organization URL" });
        azureConfig = { organization: organizationName, project: projectName, pat };
      } else {
        azureConfig = await getAzureDevOpsConfig(projectName);
      }
      if (!azureConfig) return res.status(404).json({ error: "Azure config not found" });

      const attachmentUrl = `https://dev.azure.com/${azureConfig.organization}/${azureConfig.project}/_apis/wit/attachments/${attachmentId}?fileName=${encodeURIComponent(fileName)}&api-version=7.0`;
      const authToken = Buffer.from(`:${azureConfig.pat}`).toString("base64");
      const proxyResponse = await fetch(attachmentUrl, {
        method: "GET",
        headers: { Authorization: `Basic ${authToken}`, Accept: "application/octet-stream" },
      });
      if (!proxyResponse.ok) {
        return res.status(proxyResponse.status).send(proxyResponse.statusText || "Failed to fetch attachment");
      }
      const contentType = proxyResponse.headers.get("content-type") || "application/octet-stream";
      const buffer = Buffer.from(await proxyResponse.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(buffer);
    } catch (error) {
      console.error("[ADO Attachment Proxy] Error:", error);
      res.status(500).json({ error: "Failed to fetch attachment" });
    }
  });
}
