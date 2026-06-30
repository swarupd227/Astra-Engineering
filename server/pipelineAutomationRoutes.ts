import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { storage } from "./storage";
import { safeDecryptPAT, encryptPAT, decryptPAT } from "./crypto-utils";
import { AzureDevOpsService, type AzureConfig } from "./azure-devops-service";
import { requireAuth } from "./auth/middleware";
import { createUserAzureService } from "./services/user-azure-service";
import { sdlcService } from "./sdlc/service";
import { db } from "./db";
import * as sharedSchema from "@shared/schema";
import { and, eq } from "drizzle-orm";
import {
  createPipelineTemplateSchema,
  orchestratePipelineSchema,
  upsertPipelineSecretSchema,
  type PipelineTemplateSpec,
} from "@shared/pipeline-automation";

const provisioningInstances = sharedSchema.provisioningInstances;
const pipelineTemplates = (sharedSchema as any).pipelineTemplates;
const pipelineTemplateVersions = (sharedSchema as any).pipelineTemplateVersions;
const pipelineSecrets = (sharedSchema as any).pipelineSecrets;
const pipelineCreationAudit = (sharedSchema as any).pipelineCreationAudit;

type PipelineTemplateRecord = {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  scope: "project" | "organization" | "global";
  projectId?: string;
  organization?: string;
  latestVersion: number;
  versions: Array<{
    version: number;
    spec: PipelineTemplateSpec;
    createdAt: string;
    published: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
};

type SecretRecord = {
  id: string;
  key: string;
  valueEncrypted: string;
  scope: "project" | "organization" | "global";
  projectId?: string;
  organization?: string;
  environment?: string;
  createdAt: string;
  updatedAt: string;
};

const templateStore = new Map<string, PipelineTemplateRecord>();
const secretStore = new Map<string, SecretRecord>();
const pipelineAuditStore: Array<Record<string, unknown>> = [];

async function getAdoConfig(
  projectName?: string,
  organization?: string,
): Promise<AzureConfig | null> {
  try {
    const artifactOrgs = await storage.getArtifactOrganizations();
    const normalizeOrgName = (organizationUrl: string) => {
      let orgName = organizationUrl || "";
      if (orgName.includes("dev.azure.com")) {
        orgName = orgName.replace(/https?:\/\/dev\.azure\.com\//, "").split("/")[0];
      } else if (orgName.includes("visualstudio.com")) {
        const m = orgName.match(/([^.]+)\.visualstudio\.com/);
        if (m) orgName = m[1];
      }
      return orgName.trim().replace(/\/+$/, "");
    };

    const exactTarget = artifactOrgs.find((org) => {
      const orgName = normalizeOrgName(org.organizationUrl || "");
      const orgMatch = !organization || orgName.toLowerCase() === organization.toLowerCase();
      const projMatch = !projectName || (org.projectName || "").toLowerCase() === projectName.toLowerCase();
      return orgMatch && projMatch && !!org.patToken;
    });

    const target = exactTarget ?? artifactOrgs.find((org) => {
      const orgName = normalizeOrgName(org.organizationUrl || "");
      const orgMatch = !organization || orgName.toLowerCase() === organization.toLowerCase();
      return orgMatch && !!org.patToken;
    });

    if (target?.patToken) {
      const pat = safeDecryptPAT(target.patToken);
      if (pat) {
        const orgName = normalizeOrgName(target.organizationUrl || "");
        return { organization: orgName, project: projectName || target.projectName, pat };
      }
    }
  } catch {
    // Continue to env fallback
  }

  const envOrg = process.env.ADO_ORG || process.env.ADO_ORGANIZATION;
  const envProject = process.env.ADO_PROJECT || process.env.ADO_PROJECT_NAME;
  const envPat = process.env.ADO_PAT || process.env.ADO_TOKEN;
  if (envOrg && envProject && envPat) {
    if (!projectName || envProject.toLowerCase() === projectName.toLowerCase()) {
      return { organization: envOrg, project: envProject, pat: envPat };
    }
  }
  return null;
}

function extractOrgProjectFromUrl(url?: string | null): { organization?: string; projectName?: string } {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname.includes("dev.azure.com")) {
      const [org, proj] = parts;
      return { organization: org, projectName: proj };
    }
    if (parsed.hostname.includes("visualstudio.com")) {
      const org = parsed.hostname.split(".")[0];
      const proj = parts[0];
      return { organization: org, projectName: proj };
    }
  } catch {
    // ignored: malformed URL
  }
  return {};
}

async function resolveProjectScopedAdoContext(
  projectId: string,
  projectName?: string,
  organization?: string,
): Promise<{ resolvedProjectName?: string; resolvedOrganization?: string }> {
  if (projectName && organization) {
    return { resolvedProjectName: projectName, resolvedOrganization: organization };
  }
  if (!projectId || projectId === "default") {
    return { resolvedProjectName: projectName, resolvedOrganization: organization };
  }

  try {
    const project = await sdlcService.getProject(projectId);
    const fromUrl = extractOrgProjectFromUrl(project?.adoProjecturl || "");
    return {
      resolvedProjectName: projectName || project?.projectId || project?.name || fromUrl.projectName,
      resolvedOrganization: organization || project?.organization || fromUrl.organization,
    };
  } catch {
    return { resolvedProjectName: projectName, resolvedOrganization: organization };
  }
}

function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

export function registerPipelineAutomationRoutes(app: Express): void {
  app.get("/api/sdlc/projects/:projectId/ado/pipeline-automation/yaml-files", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const repoId = String(req.query.repoId || "");
      const branchName = String(req.query.branchName || "");
      const projectName = String(req.query.projectName || "");
      const organization = String(req.query.organization || "");
      if (!repoId || !branchName) {
        return res.status(400).json({ error: "repoId and branchName are required" });
      }

      const { resolvedProjectName, resolvedOrganization } = await resolveProjectScopedAdoContext(
        projectId,
        projectName || undefined,
        organization || undefined,
      );
      const adoConfig = await getAdoConfig(resolvedProjectName, resolvedOrganization);
      if (!adoConfig) {
        return res.status(400).json({
          error: `Azure DevOps not configured for organization "${resolvedOrganization || "unknown"}" and project "${resolvedProjectName || "unknown"}"`,
        });
      }

      const ado = new AzureDevOpsService(adoConfig);
      const tree = await ado.getRepositoryTree(repoId, "/", "Full", branchName);
      const items = Array.isArray(tree?.value) ? tree.value : [];
      const yamlFiles = items
        .filter((item: any) => {
          const filePath = String(item?.path || "");
          const isYaml = /\.(ya?ml)$/i.test(filePath);
          const isTree = String(item?.gitObjectType || "").toLowerCase() === "tree";
          const isFolder = item?.isFolder === true;
          return isYaml && !isTree && !isFolder;
        })
        .map((item: any) => String(item.path))
        .sort((a: string, b: string) => {
          const aClean = a.replace(/^\/+/, "");
          const bClean = b.replace(/^\/+/, "");
          const aRoot = !aClean.includes("/");
          const bRoot = !bClean.includes("/");
          if (aRoot && !bRoot) return -1;
          if (!aRoot && bRoot) return 1;
          const aPriority = aClean.toLowerCase() === "azure-pipelines.yml" ? -1 : 0;
          const bPriority = bClean.toLowerCase() === "azure-pipelines.yml" ? -1 : 0;
          if (aPriority !== bPriority) return aPriority - bPriority;
          const depthDiff = aClean.split("/").length - bClean.split("/").length;
          return depthDiff !== 0 ? depthDiff : aClean.localeCompare(bClean);
        });

      return res.json({ value: yamlFiles, count: yamlFiles.length });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to list YAML files" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/ado/pipeline-automation/yaml-preview", requireAuth, async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const repoId = String(req.query.repoId || "");
      const branchName = String(req.query.branchName || "");
      const yamlPath = String(req.query.yamlPath || "");
      const projectName = String(req.query.projectName || "");
      const organization = String(req.query.organization || "");
      if (!repoId || !branchName || !yamlPath) {
        return res.status(400).json({ error: "repoId, branchName and yamlPath are required" });
      }
      const { resolvedProjectName, resolvedOrganization } = await resolveProjectScopedAdoContext(
        projectId,
        projectName || undefined,
        organization || undefined,
      );
      const adoConfig = await getAdoConfig(resolvedProjectName, resolvedOrganization);
      if (!adoConfig) {
        return res.status(400).json({
          error: `Azure DevOps not configured for organization "${resolvedOrganization || "unknown"}" and project "${resolvedProjectName || "unknown"}"`,
        });
      }
      const ado = new AzureDevOpsService(adoConfig);
      const content = await ado.getFileContent(repoId, yamlPath, branchName);
      return res.json({ path: yamlPath, content });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Failed to preview YAML" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/ado/pipeline-templates", requireAuth, async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const organization = String(req.query.organization || "");
    try {
      const baseTemplates = await db.select().from(pipelineTemplates);
      const versions = await db.select().from(pipelineTemplateVersions);
      const value = baseTemplates
        .filter((t) => {
          if (t.scope === "global") return true;
          if (t.scope === "organization") {
            return !!organization && (t.organization || "").toLowerCase() === organization.toLowerCase();
          }
          return t.projectId === projectId;
        })
        .map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description || undefined,
          tags: t.tags || [],
          scope: t.scope,
          projectId: t.projectId || undefined,
          organization: t.organization || undefined,
          latestVersion: t.latestVersion,
          versions: versions
            .filter((v) => v.templateId === t.id)
            .map((v) => ({
              version: v.version,
              spec: (v.spec || {}) as PipelineTemplateSpec,
              createdAt: new Date(v.createdAt).toISOString(),
              published: !!v.published,
            })),
          createdAt: new Date(t.createdAt).toISOString(),
          updatedAt: new Date(t.updatedAt).toISOString(),
        }));
      return res.json({ value });
    } catch {
      const templates = Array.from(templateStore.values()).filter((t) => {
        if (t.scope === "global") return true;
        if (t.scope === "organization") return !!organization && t.organization?.toLowerCase() === organization.toLowerCase();
        return t.projectId === projectId;
      });
      return res.json({ value: templates });
    }
  });

  app.post("/api/sdlc/projects/:projectId/ado/pipeline-templates", requireAuth, async (req: Request, res: Response) => {
    const parsed = createPipelineTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid template payload", details: parsed.error.flatten() });
    }
    const { projectId } = req.params;
    const { organization } = req.body as { organization?: string };
    const now = new Date().toISOString();
    const id = randomUUID();
    const template: PipelineTemplateRecord = {
      id,
      name: parsed.data.name,
      description: parsed.data.description,
      tags: parsed.data.tags || [],
      scope: parsed.data.scope,
      projectId: parsed.data.scope === "project" ? projectId : undefined,
      organization: parsed.data.scope === "organization" ? organization : undefined,
      latestVersion: 1,
      versions: [{ version: 1, spec: parsed.data.spec, createdAt: now, published: false }],
      createdAt: now,
      updatedAt: now,
    };
    templateStore.set(id, template);
    try {
      await db.insert(pipelineTemplates).values({
        id,
        projectId: template.projectId || null,
        organization: template.organization || null,
        name: template.name,
        description: template.description || null,
        scope: template.scope,
        tags: template.tags,
        latestVersion: 1,
        createdBy: (req as any).user?.id || null,
      });
      await db.insert(pipelineTemplateVersions).values({
        id: randomUUID(),
        templateId: id,
        version: 1,
        spec: template.versions[0].spec as any,
        published: false,
        createdBy: (req as any).user?.id || null,
      });
    } catch {
      // fallback already in-memory
    }
    pipelineAuditStore.push({
      id: randomUUID(),
      projectId,
      actorUserId: (req as any).user?.id || null,
      action: "TEMPLATE_CREATE",
      templateId: id,
      createdAt: now,
    });
    try {
      await db.insert(pipelineCreationAudit).values({
        id: randomUUID(),
        projectId,
        actorUserId: (req as any).user?.id || null,
        action: "TEMPLATE_CREATE",
        mode: "templateMode",
        templateId: id,
        metadata: { source: "pipelineAutomationRoutes" },
      });
    } catch {
      // non-blocking audit fallback
    }
    return res.status(201).json(template);
  });

  app.post("/api/sdlc/projects/:projectId/ado/pipeline-templates/:templateId/versions", requireAuth, async (req: Request, res: Response) => {
    const template = templateStore.get(req.params.templateId);
    if (!template) return res.status(404).json({ error: "Template not found" });
    const parsed = createPipelineTemplateSchema.shape.spec.safeParse(req.body.spec);
    if (!parsed.success) return res.status(400).json({ error: "Invalid spec", details: parsed.error.flatten() });
    const version = template.latestVersion + 1;
    template.latestVersion = version;
    template.updatedAt = new Date().toISOString();
    template.versions.push({
      version,
      spec: parsed.data,
      createdAt: template.updatedAt,
      published: false,
    });
    templateStore.set(template.id, template);
    try {
      await db
        .update(pipelineTemplates)
        .set({
          latestVersion: version,
          updatedAt: new Date(),
        })
        .where(eq(pipelineTemplates.id, template.id));
      await db.insert(pipelineTemplateVersions).values({
        id: randomUUID(),
        templateId: template.id,
        version,
        spec: parsed.data as any,
        published: false,
        createdBy: (req as any).user?.id || null,
      });
    } catch {
      // fallback already in-memory
    }
    pipelineAuditStore.push({
      id: randomUUID(),
      projectId: req.params.projectId,
      actorUserId: (req as any).user?.id || null,
      action: "TEMPLATE_VERSION_CREATE",
      templateId: template.id,
      templateVersion: version,
      createdAt: template.updatedAt,
    });
    return res.status(201).json(template);
  });

  app.patch("/api/sdlc/projects/:projectId/ado/pipeline-templates/:templateId/publish", requireAuth, async (req: Request, res: Response) => {
    const template = templateStore.get(req.params.templateId);
    if (!template) return res.status(404).json({ error: "Template not found" });
    const version = Number(req.body.version || template.latestVersion);
    template.versions = template.versions.map((v) => ({ ...v, published: v.version === version }));
    template.updatedAt = new Date().toISOString();
    templateStore.set(template.id, template);
    try {
      const versions = await db
        .select()
        .from(pipelineTemplateVersions)
        .where(eq(pipelineTemplateVersions.templateId, template.id));
      for (const v of versions) {
        await db
          .update(pipelineTemplateVersions)
          .set({ published: v.version === version })
          .where(eq(pipelineTemplateVersions.id, v.id));
      }
      await db
        .update(pipelineTemplates)
        .set({ updatedAt: new Date() })
        .where(eq(pipelineTemplates.id, template.id));
    } catch {
      // fallback already in-memory
    }
    pipelineAuditStore.push({
      id: randomUUID(),
      projectId: req.params.projectId,
      actorUserId: (req as any).user?.id || null,
      action: "TEMPLATE_PUBLISH",
      templateId: template.id,
      templateVersion: version,
      createdAt: template.updatedAt,
    });
    return res.json(template);
  });

  app.get("/api/sdlc/projects/:projectId/ado/pipeline-secrets", requireAuth, async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const organization = String(req.query.organization || "");
    try {
      const rows = await db.select().from(pipelineSecrets);
      const value = rows
        .filter((s) => {
          if (s.scope === "global") return true;
          if (s.scope === "organization") return !!organization && (s.organization || "").toLowerCase() === organization.toLowerCase();
          return s.projectId === projectId;
        })
        .map((s) => ({
          id: s.id,
          key: s.key,
          scope: s.scope,
          projectId: s.projectId || undefined,
          organization: s.organization || undefined,
          environment: s.environment || undefined,
          valuePreview: maskSecret(decryptPAT(s.valueEncrypted) || ""),
          createdAt: new Date(s.createdAt).toISOString(),
          updatedAt: new Date(s.updatedAt).toISOString(),
        }));
      return res.json({ value });
    } catch {
      const secrets = Array.from(secretStore.values())
        .filter((s) => {
          if (s.scope === "global") return true;
          if (s.scope === "organization") return !!organization && s.organization?.toLowerCase() === organization.toLowerCase();
          return s.projectId === projectId;
        })
        .map((s) => ({
          id: s.id,
          key: s.key,
          scope: s.scope,
          projectId: s.projectId,
          organization: s.organization,
          environment: s.environment,
          valuePreview: maskSecret(decryptPAT(s.valueEncrypted) || ""),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
      return res.json({ value: secrets });
    }
  });

  app.post("/api/sdlc/projects/:projectId/ado/pipeline-secrets", requireAuth, async (req: Request, res: Response) => {
    const parsed = upsertPipelineSecretSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid secret payload", details: parsed.error.flatten() });
    }
    const { projectId } = req.params;
    const now = new Date().toISOString();
    const existing = Array.from(secretStore.values()).find((s) =>
      s.key === parsed.data.key &&
      s.scope === parsed.data.scope &&
      (s.projectId || "") === (parsed.data.projectId || (parsed.data.scope === "project" ? projectId : "")) &&
      (s.organization || "") === (parsed.data.organization || "")
    );
    if (existing) {
      existing.valueEncrypted = encryptPAT(parsed.data.value) || "";
      existing.environment = parsed.data.environment;
      existing.updatedAt = now;
      secretStore.set(existing.id, existing);
      try {
        await db
          .update(pipelineSecrets)
          .set({
            valueEncrypted: existing.valueEncrypted,
            environment: existing.environment || null,
            updatedAt: new Date(),
          })
          .where(eq(pipelineSecrets.id, existing.id));
      } catch {
        // in-memory fallback retained
      }
      pipelineAuditStore.push({
        id: randomUUID(),
        projectId,
        actorUserId: (req as any).user?.id || null,
        action: "SECRET_ROTATE",
        metadata: { key: existing.key, scope: existing.scope },
        createdAt: now,
      });
      return res.json({ id: existing.id, key: existing.key, updatedAt: existing.updatedAt });
    }
    const id = randomUUID();
    const record: SecretRecord = {
      id,
      key: parsed.data.key,
      valueEncrypted: encryptPAT(parsed.data.value) || "",
      scope: parsed.data.scope,
      projectId: parsed.data.scope === "project" ? (parsed.data.projectId || projectId) : undefined,
      organization: parsed.data.scope === "organization" ? parsed.data.organization : undefined,
      environment: parsed.data.environment,
      createdAt: now,
      updatedAt: now,
    };
    secretStore.set(id, record);
    try {
      await db.insert(pipelineSecrets).values({
        id,
        key: record.key,
        valueEncrypted: record.valueEncrypted,
        scope: record.scope,
        projectId: record.projectId || null,
        organization: record.organization || null,
        environment: record.environment || null,
        createdBy: (req as any).user?.id || null,
      });
    } catch {
      // in-memory fallback retained
    }
    pipelineAuditStore.push({
      id: randomUUID(),
      projectId,
      actorUserId: (req as any).user?.id || null,
      action: "SECRET_CREATE",
      metadata: { key: record.key, scope: record.scope },
      createdAt: now,
    });
    return res.status(201).json({ id: record.id, key: record.key, createdAt: record.createdAt });
  });

  app.post("/api/sdlc/projects/:projectId/ado/pipeline-automation/orchestrate", requireAuth, async (req: Request, res: Response) => {
    const parsed = orchestratePipelineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid orchestration payload", details: parsed.error.flatten() });
    }

    try {
      const input = parsed.data;
      const adoConfig = await getAdoConfig(input.projectName, input.organization);
      if (!adoConfig) {
        return res.status(400).json({
          error: "Azure DevOps not configured. Configure artifact organization or environment variables.",
        });
      }
      const ado = new AzureDevOpsService(adoConfig);

      let effective = input;
      if (input.mode === "templateMode") {
        const template = input.templateId ? templateStore.get(input.templateId) : null;
        if (!template) return res.status(404).json({ error: "Template not found for templateMode" });
        const version = input.templateVersion || template.latestVersion;
        const versionRecord = template.versions.find((v) => v.version === version);
        if (!versionRecord) return res.status(404).json({ error: "Template version not found" });
        effective = {
          ...effective,
          mode: versionRecord.spec.baseMode,
          pipelineName: effective.pipelineName || versionRecord.spec.defaultPipelineName,
          yamlPath: effective.yamlPath || versionRecord.spec.yamlPath,
          secretKeys: [...new Set([...(effective.secretKeys || []), ...(versionRecord.spec.secretRefs || [])])],
        };
      }

      const resolvedSecrets: Record<string, string> = {};
      for (const key of effective.secretKeys || []) {
        const found = Array.from(secretStore.values()).find((s) => s.key === key);
        if (found) resolvedSecrets[key] = decryptPAT(found.valueEncrypted) || "";
      }

      let pipelineResult: any = null;
      if (effective.mode === "yamlRepoMode" || effective.mode === "yamlGeneratedMode") {
        if (!effective.pipelineName || !effective.repoId || !effective.repoName || !effective.branchName || !effective.yamlPath) {
          return res.status(400).json({
            error: "pipelineName, repoId, repoName, branchName, yamlPath are required for yaml modes",
          });
        }
        if (effective.mode === "yamlRepoMode") {
          // Existing YAML path mode: validate YAML exists in repo/branch before creating definition.
          await ado.getFileContent(effective.repoId, effective.yamlPath, effective.branchName);
        }
        // If user generated YAML in DevX, persist it to ADO first.
        if (effective.mode === "yamlGeneratedMode" && effective.generatedYaml) {
          await ado.pushMultipleFiles({
            repositoryId: effective.repoId,
            branchName: effective.branchName,
            files: [{ path: effective.yamlPath, content: effective.generatedYaml }],
            commitMessage: `chore: add generated pipeline yaml (${effective.pipelineName})`,
            authorName: "Astra Platform",
          });
        }
        pipelineResult = await ado.createPipelineDefinition(
          effective.pipelineName,
          effective.repoId,
          effective.repoName,
          effective.branchName,
          effective.yamlPath,
          effective.projectName,
        );
        if (effective.runAfterCreate && pipelineResult?.id) {
          const runResult = await ado.queueBuild(
            Number(pipelineResult.id),
            effective.branchName,
            effective.projectName,
          );
          pipelineResult = { ...pipelineResult, queuedRun: runResult };
        }
      } else if (effective.mode === "existingPipelineMode") {
        if (!effective.existingPipelineId || !effective.branchName) {
          return res.status(400).json({
            error: "existingPipelineId and branchName are required for existingPipelineMode",
          });
        }
        const runResult = await ado.queueBuild(
          Number(effective.existingPipelineId),
          effective.branchName,
          effective.projectName,
        );
        pipelineResult = { id: effective.existingPipelineId, queuedRun: runResult };
      } else if (effective.mode === "cloneDefinitionMode") {
        return res.status(501).json({
          error: "cloneDefinitionMode is not fully implemented yet in this release",
        });
      }

      const infraActions: string[] = [];
      if (effective.infraBootstrapOption !== "none") {
        infraActions.push(`requested:${effective.infraBootstrapOption}`);
        const armToken = (req.headers["x-azure-token"] as string) || "";
        const tenantId = (req.headers["x-tenant-id"] as string) || "";
        const cfg = effective.infraConfig;
        if (cfg?.subscriptionId && cfg?.resourceGroupName && cfg?.location && armToken) {
          const userAzureService = createUserAzureService(armToken, tenantId);
          await userAzureService.createResourceGroup(
            cfg.subscriptionId,
            cfg.resourceGroupName,
            cfg.location,
          );
          infraActions.push(`resourceGroupCreated:${cfg.resourceGroupName}`);
          // Variableization defaults returned to the UI for future runs.
          effective.variableInputs = {
            ...effective.variableInputs,
            AZ_SUBSCRIPTION_ID: cfg.subscriptionId,
            AZ_RESOURCE_GROUP: cfg.resourceGroupName,
            AZ_LOCATION: cfg.location,
          };
          if (cfg.appServiceName) {
            effective.variableInputs.AZ_APP_SERVICE_NAME = cfg.appServiceName;
          }
          if (cfg.staticWebAppName) {
            effective.variableInputs.AZ_SWA_NAME = cfg.staticWebAppName;
          }
          if (cfg.databaseName) {
            effective.variableInputs.AZ_DB_NAME = cfg.databaseName;
          }
          if (cfg.databaseServerName) {
            effective.variableInputs.AZ_DB_SERVER = cfg.databaseServerName;
          }
          if (cfg.dbMigrationEnabled) {
            infraActions.push("dbMigrationEnabled:true");
          }
          if (effective.runAfterCreate && effective.existingPipelineId && effective.branchName) {
            const autoRun = await ado.queueBuild(
              Number(effective.existingPipelineId),
              effective.branchName,
              effective.projectName,
            );
            infraActions.push(`autoTriggerQueued:${autoRun?.id || "ok"}`);
          }
        } else if (effective.infraConfig?.resourceGroupName) {
          infraActions.push(`resourceGroupPlanned:${effective.infraConfig.resourceGroupName}`);
        }
      }

      if (input.saveAsTemplate && input.saveTemplatePayload) {
        const now = new Date().toISOString();
        const id = randomUUID();
        const tpl: PipelineTemplateRecord = {
          id,
          name: input.saveTemplatePayload.name,
          description: input.saveTemplatePayload.description,
          tags: input.saveTemplatePayload.tags || [],
          scope: input.saveTemplatePayload.scope,
          projectId: input.saveTemplatePayload.scope === "project" ? req.params.projectId : undefined,
          organization: input.organization,
          latestVersion: 1,
          versions: [{ version: 1, spec: input.saveTemplatePayload.spec, createdAt: now, published: false }],
          createdAt: now,
          updatedAt: now,
        };
        templateStore.set(id, tpl);
      }

      pipelineAuditStore.push({
        id: randomUUID(),
        projectId: req.params.projectId,
        actorUserId: (req as any).user?.id || null,
        action: "PIPELINE_ORCHESTRATE",
        mode: input.mode,
        templateId: input.templateId || null,
        templateVersion: input.templateVersion || null,
        createdAt: new Date().toISOString(),
      });
      try {
        await db.insert(pipelineCreationAudit).values({
          id: randomUUID(),
          projectId: req.params.projectId,
          actorUserId: (req as any).user?.id || null,
          action: "PIPELINE_ORCHESTRATE",
          mode: String(input.mode),
          templateId: input.templateId || null,
          templateVersion: input.templateVersion || null,
          metadata: {
            infraOption: effective.infraBootstrapOption,
            hasSecrets: (effective.secretKeys || []).length > 0,
          },
        });
      } catch {
        // fallback to in-memory audit
      }

      return res.json({
        status: "ok",
        mode: input.mode,
        executedMode: effective.mode,
        pipeline: pipelineResult,
        resolvedVariables: {
          ...effective.variableInputs,
          ...Object.fromEntries(Object.keys(resolvedSecrets).map((k) => [k, "***"])),
        },
        infra: {
          option: effective.infraBootstrapOption,
          actions: infraActions,
        },
      });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Pipeline orchestration failed" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/ado/pipeline-automation/audit", requireAuth, async (req: Request, res: Response) => {
    const projectId = req.params.projectId;
    const value = pipelineAuditStore.filter((a) => a.projectId === projectId);
    return res.json({ value });
  });

  app.get("/api/sdlc/projects/:projectId/ado/pipeline-automation/infra-resources", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const rows = await db
      .select()
      .from(provisioningInstances)
      .where(and(eq(provisioningInstances.userId, userId), eq(provisioningInstances.status, "ready")));

    const value = rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscriptionId,
      resourceGroupName: r.resourceGroupName,
      appServiceName: r.appServiceName,
      databaseName: r.databaseName,
      databaseServerName: r.databaseServerName,
      environment: r.environment,
      region: r.region,
      serviceType: r.serviceType,
      url: r.url,
    }));
    return res.json({ value });
  });
}

