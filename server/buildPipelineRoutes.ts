import type { Express, Request, Response } from "express";
import { db } from "./db";
import { storage } from "./storage";
import { sdlcSettings } from "@shared/schema";
import { AzureDevOpsService, type AzureConfig } from "./azure-devops-service";
import { safeDecryptPAT } from "./crypto-utils";

// Replicate the same priority-based ADO config lookup used in routes.ts
async function getBuildPipelineAdoConfig(
  projectName?: string,
  organization?: string
): Promise<AzureConfig | null> {
  // 1. Artifact Organizations (Hub Artifacts settings)
  try {
    const artifactOrgs = await storage.getArtifactOrganizations();
    const strictMatch = !!(projectName || organization);

    let targetOrg;
    if (organization || projectName) {
      targetOrg = artifactOrgs.find((org) => {
        let orgName = org.organizationUrl;
        if (orgName.includes("dev.azure.com")) {
          orgName = orgName
            .replace(/https?:\/\/dev\.azure\.com\//, "")
            .replace(/\/$/, "")
            .split("/")[0];
        } else if (orgName.includes("visualstudio.com")) {
          const match = orgName.match(/([^.]+)\.visualstudio\.com/);
          if (match) orgName = match[1];
        }
        orgName = orgName.replace(/\/+$/, "").trim();

        if (organization) {
          return (
            (orgName === organization ||
              orgName.toLowerCase() === organization.toLowerCase()) &&
            !!org.patToken
          );
        }
        if (projectName) {
          return (
            (org.projectName === projectName ||
              org.projectName?.toLowerCase() === projectName.toLowerCase()) &&
            !!org.patToken
          );
        }
        return false;
      });
      if (!targetOrg && strictMatch) targetOrg = undefined;
    }
    if (!targetOrg && !strictMatch) {
      targetOrg = artifactOrgs.find((org) => org.patToken);
    }

    if (targetOrg?.patToken) {
      const decryptedPAT = safeDecryptPAT(targetOrg.patToken);
      if (decryptedPAT) {
        let orgName = targetOrg.organizationUrl;
        if (orgName.includes("dev.azure.com")) {
          orgName = orgName
            .replace(/https?:\/\/dev\.azure\.com\//, "")
            .replace(/\/$/, "")
            .split("/")[0];
        } else if (orgName.includes("visualstudio.com")) {
          const match = orgName.match(/([^.]+)\.visualstudio\.com/);
          if (match) orgName = match[1];
        }
        orgName = orgName.replace(/\/+$/, "").trim();
        return {
          organization: orgName,
          project: projectName || targetOrg.projectName,
          pat: decryptedPAT,
        };
      }
    }
  } catch (err) {
    console.error("[buildPipelineRoutes] Error fetching Artifact Orgs:", err);
  }

  // 2. SDLC settings in database
  try {
    const settings = await db.select().from(sdlcSettings).limit(1);
    if (settings.length > 0) {
      const s = settings[0];
      if (
        s.organizationName &&
        s.projectName &&
        s.patToken &&
        (!projectName ||
          s.projectName === projectName ||
          s.projectName?.toLowerCase() === projectName?.toLowerCase())
      ) {
        const decryptedPAT = safeDecryptPAT(s.patToken);
        if (decryptedPAT) {
          let orgName = s.organizationName;
          if (orgName.includes("dev.azure.com")) {
            orgName = orgName
              .replace(/https?:\/\/dev\.azure\.com\//, "")
              .replace(/\/$/, "");
          }
          orgName = orgName.replace(/\/+$/, "");
          return { organization: orgName, project: s.projectName, pat: decryptedPAT };
        }
      }
    }
  } catch (err) {
    // silently fall through
  }

  // 3. Environment variables
  const envOrg =
    process.env.ADO_ORG ||
    process.env.ADO_ORGANIZATION ||
    process.env.ADO_ORG_URL;
  const envProject = process.env.ADO_PROJECT || process.env.ADO_PROJECT_NAME;
  const envPat = process.env.ADO_PAT || process.env.ADO_TOKEN;
  if (envOrg && envProject && envPat) {
    if (
      !projectName ||
      envProject === projectName ||
      envProject?.toLowerCase() === projectName?.toLowerCase()
    ) {
      const orgCandidate = envOrg.replace(/\/$/, "").split("/").pop()!;
      return { organization: orgCandidate, project: envProject, pat: envPat };
    }
  }

  // 4. Golden Repository orgs
  try {
    const goldenOrgs = await storage.getGoldenRepoOrganizations();
    let firstOrg = projectName
      ? goldenOrgs.find(
          (o) =>
            (o.projectName === projectName ||
              o.projectName?.toLowerCase() === projectName.toLowerCase()) &&
            o.patToken
        )
      : undefined;
    if (!firstOrg && !projectName) firstOrg = goldenOrgs[0];
    if (firstOrg?.patToken) {
      const decryptedPAT = safeDecryptPAT(firstOrg.patToken);
      if (decryptedPAT) {
        const org = firstOrg.organizationUrl
          .replace(/https?:\/\/dev\.azure\.com\//, "")
          .replace(/\/$/, "");
        return { organization: org, project: firstOrg.projectName, pat: decryptedPAT };
      }
    }
  } catch (err) {
    // silently fall through
  }

  return null;
}

export function registerBuildPipelineRoutes(app: Express): void {
  // ==============================
  // Build & Pipeline Action APIs
  // ==============================

  /**
   * POST /api/sdlc/projects/:projectId/ado/queue-build
   * Queues (runs) a build for a specific pipeline in ADO.
   * Body: { pipelineId: number, branchName: string, organization?: string, projectName?: string }
   */
  app.post(
    "/api/sdlc/projects/:projectId/ado/queue-build",
    async (req: Request, res: Response) => {
      try {
        const { pipelineId, branchName, organization: bodyOrg, projectName: bodyProject } =
          req.body as {
            pipelineId: number;
            branchName: string;
            organization?: string;
            projectName?: string;
          };

        if (!pipelineId || !branchName) {
          return res
            .status(400)
            .json({ error: "pipelineId and branchName are required" });
        }

        const azureConfig = await getBuildPipelineAdoConfig(
          bodyProject,
          bodyOrg
        );

        if (!azureConfig) {
          return res.status(400).json({
            error:
              "Azure DevOps not configured. Please configure in Settings > Central Settings.",
          });
        }

        const adoService = new AzureDevOpsService(azureConfig);
        const result = await adoService.queueBuild(
          Number(pipelineId),
          branchName,
          bodyProject
        );

        res.setHeader("Content-Type", "application/json");
        res.json(result);
      } catch (error: any) {
        console.error("[buildPipelineRoutes] Error queuing build:", error);
        const msg = error.message || "Failed to queue build";
        res.setHeader("Content-Type", "application/json");
        if (msg.includes("<!DOCTYPE") || msg.includes("<html")) {
          return res.status(500).json({
            error:
              "Azure DevOps API returned an error. Please check your PAT token and organization/project configuration.",
          });
        }
        res.status(500).json({ error: msg });
      }
    }
  );

  /**
   * POST /api/sdlc/projects/:projectId/ado/create-pipeline
   * Creates a new YAML-based pipeline definition in ADO.
   * Body: { name, repositoryId, repositoryName, branchName, yamlPath, organization?, projectName? }
   */
  app.post(
    "/api/sdlc/projects/:projectId/ado/create-pipeline",
    async (req: Request, res: Response) => {
      try {
        const {
          name,
          repositoryId,
          repositoryName,
          branchName,
          yamlPath,
          organization: bodyOrg,
          projectName: bodyProject,
        } = req.body as {
          name: string;
          repositoryId: string;
          repositoryName: string;
          branchName: string;
          yamlPath: string;
          organization?: string;
          projectName?: string;
        };

        if (!name || !repositoryId || !repositoryName || !branchName || !yamlPath) {
          return res.status(400).json({
            error:
              "name, repositoryId, repositoryName, branchName and yamlPath are required",
          });
        }

        const azureConfig = await getBuildPipelineAdoConfig(
          bodyProject,
          bodyOrg
        );

        if (!azureConfig) {
          return res.status(400).json({
            error:
              "Azure DevOps not configured. Please configure in Settings > Central Settings.",
          });
        }

        const adoService = new AzureDevOpsService(azureConfig);
        const result = await adoService.createPipelineDefinition(
          name,
          repositoryId,
          repositoryName,
          branchName,
          yamlPath,
          bodyProject
        );

        res.setHeader("Content-Type", "application/json");
        res.json(result);
      } catch (error: any) {
        console.error(
          "[buildPipelineRoutes] Error creating pipeline:",
          error
        );
        const msg = error.message || "Failed to create pipeline";
        res.setHeader("Content-Type", "application/json");
        if (msg.includes("<!DOCTYPE") || msg.includes("<html")) {
          return res.status(500).json({
            error:
              "Azure DevOps API returned an error. Please check your PAT token and organization/project configuration.",
          });
        }
        res.status(500).json({ error: msg });
      }
    }
  );

  /**
   * GET /api/sdlc/projects/:projectId/ado/build-branches/:repositoryId
   * Fetch branches for a repository. Does NOT require the SDLC project to exist —
   * resolves ADO credentials purely from artifact organisations / env vars.
   * Query params: organization?, projectName?
   */
  app.get(
    "/api/sdlc/projects/:projectId/ado/build-branches/:repositoryId",
    async (req: Request, res: Response) => {
      try {
        const { repositoryId } = req.params;
        const { organization: queryOrg, projectName: queryProject } = req.query;

        const azureConfig = await getBuildPipelineAdoConfig(
          queryProject as string | undefined,
          queryOrg as string | undefined
        );

        if (!azureConfig) {
          return res.status(400).json({
            error:
              "Azure DevOps not configured. Please configure in Settings > Central Settings.",
          });
        }

        const url = `https://dev.azure.com/${azureConfig.organization}/${azureConfig.project}/_apis/git/repositories/${repositoryId}/refs?filter=heads/&api-version=7.0`;
        const authToken = Buffer.from(`:${azureConfig.pat}`).toString("base64");

        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Basic ${authToken}`,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch branches: ${response.statusText}`);
        }

        const data = await response.json();
        const branches = (data.value || []).map((ref: any) => ({
          name: ref.name.replace("refs/heads/", ""),
          objectId: ref.objectId,
        }));

        res.setHeader("Content-Type", "application/json");
        res.json(branches);
      } catch (error: any) {
        console.error("[buildPipelineRoutes] Error fetching branches:", error);
        const msg = error.message || "Failed to fetch branches";
        res.setHeader("Content-Type", "application/json");
        res.status(500).json({ error: msg });
      }
    }
  );
}
