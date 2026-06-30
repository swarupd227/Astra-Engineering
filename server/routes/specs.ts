/**
 * Specs generation routes: generate, poll, list, push, sync, export, and enhance specs files.
 * POST/GET /api/sdlc/projects/:projectId/specs/*
 * GET /api/sdlc/specs/generate/status/:jobId
 */

import type { Express, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, inArray, isNull, max, or } from "drizzle-orm";
import { createHash } from "crypto";
import { storage } from "../storage";
import { safeDecryptPAT } from "../crypto-utils";
import { SpecsPushService } from "../services/specs-push-service";
import { findRepositoryOrganization } from "../services/golden-repo-service";
import { randomUUID } from "crypto";
import { getTenantIdFromRequest } from "../services/github-config-resolver";
import { autoBootstrapUser, requireActivity, requireAuth } from "../auth/middleware";
import { asyncJobManager } from "../lib/async-job-manager";
import { setAiContext } from "../observability/ai-context";
import {
  getProviderFileContent,
  listProviderBranches,
  listProviderRepositories,
  listProviderTree,
} from "../services/repo-provider-service";
import { extractGoldenRepoUiDesignPackage } from "../services/specs-generator/golden-ui-design-extractor";

// Specs Generation Job Management (chunked per feature)
interface SpecsGenerationJob {
  jobId: string;
  projectId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  step: string;
  createdAt: Date;
  completedAt?: Date;
  result?: {
    totalFeatures: number;
    processedFeatures: number;
    files: Array<{
      featureId: number;
      featureTitle: string;
      specsContent: string;
      requirementsContent: string;
      tddTestsContent?: string;
    }>;
  };
  error?: string;
}

const specsGenerationJobs = new Map<string, SpecsGenerationJob>();

// In-process FIFO queue for specs generation jobs (unified queue for all requests)
interface SpecsQueueItem {
  jobId: string;
  projectId: string;
  userId?: string;
  tenantId?: string | null;
  enableTdd?: boolean;
  skipIdempotent?: boolean;
  specsArchitectureStyle?: "monolith" | "microservices";
  specsDeliveryOrder?: "ui-first" | "api-first" | null;
  features: Array<{
    id: number;
    title: string;
    state?: string;
    description?: string;
    userStories: Array<{
      id: number;
      title: string;
      state?: string;
      description?: string;
      acceptanceCriteria?: string;
      storyPoints?: number | null;
    }>;
  }>;
}

const specsJobQueue: SpecsQueueItem[] = [];
let specsJobProcessing = false;

function normalizeArchitectureStyle(value: unknown): "monolith" | "microservices" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "microservices" || normalized === "microservice") return "microservices";
  return "monolith";
}

function parseArchitectureStyle(
  value: unknown,
): "monolith" | "microservices" | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "monolith" || normalized === "monolithic") return "monolith";
  if (normalized === "microservices" || normalized === "microservice") return "microservices";
  return null;
}

function normalizeDeliveryOrder(
  architectureStyle: "monolith" | "microservices",
  value: unknown,
): "ui-first" | "api-first" | null {
  if (architectureStyle !== "microservices") return null;
  const normalized = String(value ?? "").trim().toLowerCase().replace("_", "-");
  return normalized === "api-first" || normalized === "apifirst" ? "api-first" : "ui-first";
}

function parseDeliveryOrder(value: unknown): "ui-first" | "api-first" | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace("_", "-");
  if (normalized === "api-first" || normalized === "apifirst") return "api-first";
  if (normalized === "ui-first" || normalized === "uifirst") return "ui-first";
  return null;
}

async function resolveSdlcProjectId(projectIdOrExternalId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.sdlcProjects.id })
    .from(schema.sdlcProjects)
    .where(
      or(
        eq(schema.sdlcProjects.id, projectIdOrExternalId),
        eq(schema.sdlcProjects.projectId, projectIdOrExternalId),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function computeInputHash(feature: SpecsQueueItem["features"][number]): string {
  const payload = JSON.stringify({
    id: feature.id,
    title: feature.title,
    stories: [...(feature.userStories ?? [])]
      .sort((a, b) => a.id - b.id)
      .map((s) => ({ id: s.id, title: s.title, ac: s.acceptanceCriteria ?? "" })),
  });
  return createHash("sha256").update(payload).digest("hex");
}

function buildProjectScopedFileId(projectId: string, key: string): string {
  return createHash("sha1").update(`${projectId}:${key}`).digest("hex").slice(0, 36);
}

function buildFeatureFileId(projectId: string, featureId: number, fileType: string): string {
  return buildProjectScopedFileId(projectId, `feature:${featureId}:${fileType}`);
}

function buildPathFileId(projectId: string, filePath: string): string {
  return buildProjectScopedFileId(projectId, `path:${filePath}`);
}

export async function clearStaleSpecsGenerationLocks(): Promise<void> {
  try {
    await db.update(schema.sdlcProjects)
      .set({ isGenerating: false })
      .where(eq(schema.sdlcProjects.isGenerating, true));
  } catch (err: unknown) {
    console.error("[SDLC Specs] Failed to clear stale generation locks:", err);
  }
}

async function processSpecsQueue() {
  if (specsJobProcessing) return;
  specsJobProcessing = true;

  while (specsJobQueue.length > 0) {
    const item = specsJobQueue.shift();
    if (!item) break;

    const { jobId, projectId, userId, tenantId, features, enableTdd, skipIdempotent, specsArchitectureStyle, specsDeliveryOrder } = item;
    const job = specsGenerationJobs.get(jobId);
    if (!job) {
      continue;
    }

    try {
      // Set generation lock
      await db.update(schema.sdlcProjects)
        .set({ isGenerating: true })
        .where(eq(schema.sdlcProjects.id, projectId));

      job.status = "processing";
      job.step = "Initializing specs generation...";
      job.progress = 5;
      specsGenerationJobs.set(jobId, job);

      const { SpecsGenerator } = await import("../services/specs-generator");
      const generator = new SpecsGenerator();

      await generator.generateForFeatures(features, !!enableTdd, async (result, index, total) => {
        const featureTitle =
          result.featureTitle || `Feature ${result.featureId}`;
        const baseSlug =
          featureTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || `feature-${result.featureId}`;
        const basePath = `specs/${baseSlug}`;

        // Persist this feature's files immediately (delete old files first for regeneration)
        try {
          // ── Idempotency check ─────────────────────────────────────────────
          const originalFeature = features.find((f) => f.id === result.featureId);
          const inputHash = originalFeature ? computeInputHash(originalFeature) : null;

          // Fetch existing specs row (for idempotency check + version)
          const [existingSpec] = await db
            .select({ inputHash: schema.sdlcSpecsFiles.inputHash, specVersion: schema.sdlcSpecsFiles.specVersion })
            .from(schema.sdlcSpecsFiles)
            .where(and(
              eq(schema.sdlcSpecsFiles.projectId, projectId),
              eq(schema.sdlcSpecsFiles.featureId, result.featureId),
              eq(schema.sdlcSpecsFiles.fileType, "specs"),
            ))
            .limit(1);

          if (skipIdempotent && inputHash && existingSpec?.inputHash === inputHash) {
            // Inputs unchanged — skip regeneration, reuse existing content
            const progressJob = specsGenerationJobs.get(jobId);
            if (progressJob) {
              const processedFeatures = index + 1;
              progressJob.step = `Skipped "${featureTitle}" (no changes)`;
              progressJob.progress = Math.max(progressJob.progress, Math.min(95, Math.round((processedFeatures / total) * 100)));
              specsGenerationJobs.set(jobId, progressJob);
            }
            return; // Skip DB write
          }

          const nextVersion = (existingSpec?.specVersion ?? 0) + 1;

          await db
            .delete(schema.sdlcSpecsFiles)
            .where(
              and(
                eq(schema.sdlcSpecsFiles.projectId, projectId),
                eq(schema.sdlcSpecsFiles.featureId, result.featureId),
              ),
            );

          // Find original feature with user stories for metadata storage
          const userStoriesData = originalFeature?.userStories?.map((s) => ({
            id: s.id,
            title: s.title,
            state: s.state,
            description: s.description,
            acceptanceCriteria: s.acceptanceCriteria,
            storyPoints: s.storyPoints,
          })) ?? null;

          const rows: Array<{
            id: string;
            projectId: string;
            featureId: number;
            featureTitle: string;
            fileType: string;
            fileName: string;
            path: string;
            content: string;
            userStoriesJson?: any;
            inputHash?: string | null;
            specVersion?: number;
          }> = [
            {
              id: buildFeatureFileId(projectId, result.featureId, "specs"),
              projectId,
              featureId: result.featureId,
              featureTitle,
              fileType: "specs",
              fileName: "specs.md",
              path: `${basePath}/specs.md`,
              content: result.specsContent,
              userStoriesJson: userStoriesData,
              inputHash,
              specVersion: nextVersion,
            },
            {
              id: buildFeatureFileId(projectId, result.featureId, "requirements"),
              projectId,
              featureId: result.featureId,
              featureTitle,
              fileType: "requirements",
              fileName: "requirements.md",
              path: `${basePath}/requirements.md`,
              content: result.requirementsContent,
              specVersion: nextVersion,
            },
          ];
          if (result.tddTestsContent) {
            rows.push({
              id: buildFeatureFileId(projectId, result.featureId, "tdd-tests"),
              projectId,
              featureId: result.featureId,
              featureTitle,
              fileType: "tdd-tests",
              fileName: "tdd-tests.md",
              path: `${basePath}/tdd-tests.md`,
              content: result.tddTestsContent,
              specVersion: nextVersion,
            });
          }
          console.log("[DEBUG SAVE] Saving files with IDs:", rows.map(r => r.id));
          await db.insert(schema.sdlcSpecsFiles).values(rows);
        } catch (dbError) {
          console.error(
            "[SDLC Specs][Job] Failed to persist generated specs to database:",
            dbError
          );
        }

        // Update job result incrementally
        const current = specsGenerationJobs.get(jobId);
        if (!current) {
          return;
        }

        const processedFeatures = index + 1;
        const progress = Math.max(
          current.progress,
          Math.min(95, Math.round((processedFeatures / total) * 100))
        );

        const filesEntry: {
          featureId: number;
          featureTitle: string;
          specsContent: string;
          requirementsContent: string;
          tddTestsContent?: string;
        } = {
          featureId: result.featureId,
          featureTitle: result.featureTitle,
          specsContent: result.specsContent,
          requirementsContent: result.requirementsContent,
          tddTestsContent: result.tddTestsContent,
        };

        const existingFiles = current.result?.files ?? [];
        const withoutDuplicate = existingFiles.filter(
          (f) => f.featureId !== result.featureId
        );

        current.status = "processing";
        current.step = `Generated specs for feature "${featureTitle}"`;
        current.progress = progress;
        current.result = {
          totalFeatures: total,
          processedFeatures,
          files: [...withoutDuplicate, filesEntry],
        };

        specsGenerationJobs.set(jobId, current);
      }, (step, progress) => {
        const progressJob = specsGenerationJobs.get(jobId);
        if (progressJob) {
          progressJob.step = step;
          progressJob.progress = Math.max(progressJob.progress, Math.min(95, progress + 5));
          specsGenerationJobs.set(jobId, progressJob);
        }
      });

      // Generate .devx/ context files and per-feature prompt.md
      // Uses ALL specs in the DB (not just current batch) for a complete picture
      try {
        const { generateDevxContext } = await import("../services/specs-generator/devx-context-generator");

        // Fetch project metadata
        const projectRows = await db
          .select()
          .from(schema.sdlcProjects)
          .where(eq(schema.sdlcProjects.id, projectId))
          .limit(1);
        const project = projectRows[0];

        // Fetch ALL specs files for this project (not just current batch)
        const allSpecsFiles = await db
          .select()
          .from(schema.sdlcSpecsFiles)
          .where(
            and(
              eq(schema.sdlcSpecsFiles.projectId, projectId),
              inArray(schema.sdlcSpecsFiles.fileType, ["specs", "requirements", "tdd-tests"]),
            ),
          );

        // Group by featureId to build complete feature list and results
        const featureMap = new Map<number, {
          featureId: number;
          featureTitle: string;
          specsContent: string;
          requirementsContent: string;
          tddTestsContent?: string;
          userStories: Array<{ id: number; title: string; state?: string; storyPoints?: number | null }>;
        }>();

        for (const file of allSpecsFiles) {
          if (!featureMap.has(file.featureId)) {
            // Read user stories from DB (stored on specs file type) or fall back to current batch
            const storedStories = file.userStoriesJson as any[] | null;
            const batchFeature = features.find((f) => f.id === file.featureId);
            const userStories = storedStories?.map((s: any) => ({
              id: s.id,
              title: s.title,
              state: s.state,
              storyPoints: s.storyPoints,
            })) ?? batchFeature?.userStories?.map((s) => ({
              id: s.id,
              title: s.title,
              state: s.state,
              storyPoints: s.storyPoints,
            })) ?? [];
            featureMap.set(file.featureId, {
              featureId: file.featureId,
              featureTitle: file.featureTitle,
              specsContent: "",
              requirementsContent: "",
              userStories,
            });
          }
          const entry = featureMap.get(file.featureId)!;
          if (file.fileType === "specs") entry.specsContent = file.content;
          else if (file.fileType === "requirements") entry.requirementsContent = file.content;
          else if (file.fileType === "tdd-tests") entry.tddTestsContent = file.content;
        }

        const allFeatures = Array.from(featureMap.values()).map((f) => ({
          id: f.featureId,
          title: f.featureTitle,
          userStories: f.userStories,
        }));

        const allResults = Array.from(featureMap.values()).map((f) => ({
          featureId: f.featureId,
          featureTitle: f.featureTitle,
          specsContent: f.specsContent,
          requirementsContent: f.requirementsContent,
          tddTestsContent: f.tddTestsContent,
        }));

        const goldenRepoReference =
          project?.goldenRepoReference &&
          typeof project.goldenRepoReference === "object"
            ? (project.goldenRepoReference as {
                repoId?: string;
                repoName?: string;
                filePaths?: string[];
                provider?: string;
                repoUrl?: string;
                defaultBranch?: string;
              })
            : null;

        const hasAnyGoldenContext = Boolean(
          goldenRepoReference?.repoId ||
          goldenRepoReference?.repoName ||
          project?.linkedGoldenRepoName ||
          project?.linkedGoldenRepoOrg ||
          project?.linkedGoldenRepoProject,
        );

        const goldenRepoContext = hasAnyGoldenContext
          ? {
              repoId: goldenRepoReference?.repoId,
              repoName: goldenRepoReference?.repoName ?? project?.linkedGoldenRepoName ?? undefined,
              organization: project?.linkedGoldenRepoOrg ?? undefined,
              project: project?.linkedGoldenRepoProject ?? undefined,
              provider: goldenRepoReference?.provider,
              repoUrl: goldenRepoReference?.repoUrl,
              defaultBranch: goldenRepoReference?.defaultBranch,
              tenantId,
              selectedPaths: Array.isArray(goldenRepoReference?.filePaths)
                ? goldenRepoReference.filePaths
                : [],
            }
          : undefined;

        const goldenRepoUiDesignPackage = await extractGoldenRepoUiDesignPackage(
          goldenRepoContext,
          userId,
        );
        const enrichedGoldenRepoContext = goldenRepoContext
          ? {
              ...goldenRepoContext,
              uiDesignPackage: goldenRepoUiDesignPackage,
            }
          : undefined;

        const devxFiles = await generateDevxContext({
          projectName: project?.name || "Project",
          projectDescription: project?.description ?? undefined,
          organization: project?.organization ?? undefined,
          specsArchitectureStyle: normalizeArchitectureStyle(specsArchitectureStyle ?? project?.specsArchitectureStyle),
          specsDeliveryOrder: normalizeDeliveryOrder(
            normalizeArchitectureStyle(specsArchitectureStyle ?? project?.specsArchitectureStyle),
            specsDeliveryOrder ?? project?.specsDeliveryOrder,
          ),
          features: allFeatures,
          results: allResults,
          enableTdd: !!enableTdd,
          goldenRepoContext: enrichedGoldenRepoContext,
        });

        // Generate .devx/ context files and prompt.md for current batch features
        if (devxFiles.length > 0) {
          const currentBatchFeatureIds = features.map((f) => f.id);
          const filesToInsert = devxFiles.filter((f) =>
            f.fileType === "devx-context" || currentBatchFeatureIds.includes(f.featureId),
          );

          if (filesToInsert.length > 0) {
            await db
              .delete(schema.sdlcSpecsFiles)
              .where(
                and(
                  eq(schema.sdlcSpecsFiles.projectId, projectId),
                  eq(schema.sdlcSpecsFiles.fileType, "devx-context"),
                ),
              );

            const values = filesToInsert.map((f) => ({
              id:
                f.fileType === "devx-context"
                  ? buildPathFileId(projectId, f.path)
                  : buildFeatureFileId(projectId, f.featureId, f.fileType),
              projectId,
              featureId: f.featureId,
              featureTitle: f.featureTitle,
              fileType: f.fileType,
              fileName: f.fileName,
              path: f.path,
              content: f.content,
            }));

            await db.insert(schema.sdlcSpecsFiles).values(values);
            console.log("[DEBUG SAVE] Safely inserted .devx/ files with IDs:", values.map(v => v.id));
          }
        }

        console.log(`[SDLC Specs] Generated ${devxFiles.length} .devx/ context files`);
      } catch (devxError) {
        console.warn("[SDLC Specs] Failed to generate .devx/ context files:", devxError);
        // Non-fatal — specs were already generated successfully
      }

      const finalJob = specsGenerationJobs.get(jobId);
      if (finalJob) {
        finalJob.status = "completed";
        finalJob.progress = 100;
        finalJob.step = "Specs generation completed";
        finalJob.completedAt = new Date();
        specsGenerationJobs.set(jobId, finalJob);
      }
    } catch (error: any) {
      console.error(
        "[SDLC Specs][Job] Failed to generate specs from backlog:",
        error
      );
      const current = specsGenerationJobs.get(item.jobId);
      if (current) {
        current.status = "failed";
        current.progress = current.progress || 0;
        current.step = "Specs generation failed";
        current.error =
          error?.message ||
          "Failed to generate specs and requirements from selected features.";
        current.completedAt = new Date();
        specsGenerationJobs.set(item.jobId, current);
      }
    } finally {
      // Always release generation lock
      await db.update(schema.sdlcProjects)
        .set({ isGenerating: false })
        .where(eq(schema.sdlcProjects.id, projectId))
        .catch((err: unknown) => console.error("[SDLC Specs] Failed to release generation lock:", err));
    }
  }

  specsJobProcessing = false;
}

// Cleanup old completed/failed specs jobs (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [jobId, job] of specsGenerationJobs.entries()) {
    if (
      (job.status === "completed" || job.status === "failed") &&
      job.completedAt &&
      job.completedAt.getTime() < oneHourAgo
    ) {
      specsGenerationJobs.delete(jobId);
    }
  }
}, 15 * 60 * 1000);

export function registerSpecsRoutes(app: Express): void {
  /**
   * List Git repositories for specs push using the project's configured repo tool
   * (GitLab, GitHub, Bitbucket, or Azure Repos) from project_integration_configs.
   */
  app.get(
    "/api/sdlc/projects/:projectId/specs/git-repositories",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const repositories = await listProviderRepositories(projectId, (req as any).user?.id);
        return res.json({
          repositories: repositories.map((r) => ({
            id: r.id,
            name: r.name,
            defaultBranch: r.defaultBranch || "main",
            webUrl: r.webUrl,
          })),
        });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to list project git repositories:", error);
        return res.status(400).json({
          error: error?.message || "Failed to list repositories for this project.",
        });
      }
    },
  );

  /**
   * List branches for a repository (used by push dialog).
   */
  app.get(
    "/api/sdlc/projects/:projectId/specs/branches",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { repositoryId, organization, projectName } = req.query;

        if (!repositoryId) {
          return res.status(400).json({ error: "repositoryId is required" });
        }

        // Project-scoped Git (GitLab / GitHub / Bitbucket / Azure Repos via tool config)
        if (!organization || !projectName) {
          const branches = await listProviderBranches(
            projectId,
            String(repositoryId),
            (req as any).user?.id,
          );
          return res.json({ branches });
        }

        const artifactOrgs = await storage.getArtifactOrganizations();
        const extractOrgName = (url: string): string => {
          let orgName = url;
          if (orgName.includes("dev.azure.com")) {
            orgName = orgName.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "").split("/")[0];
          } else if (orgName.includes("visualstudio.com")) {
            const match = orgName.match(/([^\.]+)\.visualstudio\.com/);
            if (match) orgName = match[1];
          }
          return orgName.replace(/\/+$/, "").trim();
        };

        const targetOrg = artifactOrgs.find((org) => {
          const orgName = extractOrgName(org.organizationUrl);
          return orgName.toLowerCase() === (organization as string).toLowerCase() && org.patToken;
        });

        if (!targetOrg?.patToken) {
          return res.json({ branches: [] });
        }

        const decryptedPAT = safeDecryptPAT(targetOrg.patToken);
        if (!decryptedPAT) {
          return res.json({ branches: [] });
        }

        let adoBaseUrl = targetOrg.organizationUrl.replace(/\/+$/, "");
        if (!adoBaseUrl.startsWith("http")) {
          adoBaseUrl = `https://dev.azure.com/${adoBaseUrl}`;
        }

        const authHeader = `Basic ${Buffer.from(`:${decryptedPAT}`).toString("base64")}`;
        const refsUrl = `${adoBaseUrl}/${encodeURIComponent(projectName as string)}/_apis/git/repositories/${repositoryId}/refs?filter=heads/&api-version=7.0`;

        const refsResp = await fetch(refsUrl, {
          headers: { Authorization: authHeader },
        });

        if (!refsResp.ok) {
          return res.json({ branches: [] });
        }

        const refsData = await refsResp.json();
        const branches = (refsData.value || []).map((ref: any) => ({
          name: ref.name.replace("refs/heads/", ""),
          objectId: ref.objectId,
        }));

        return res.json({ branches });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to fetch branches:", error);
        return res.status(400).json({
          error: error?.message || "Failed to fetch branches.",
          branches: [],
        });
      }
    }
  );

  /**
   * Fetch a single file's content from the ADO repo (for diff view).
   */
  app.get(
    "/api/sdlc/projects/:projectId/specs/repo-file",
    async (req: Request, res: Response) => {
      try {
        const { path: filePath, repositoryId, organization, projectName } = req.query;

        if (!filePath || !repositoryId || !organization || !projectName) {
          return res.status(400).json({ error: "path, repositoryId, organization, and projectName are required" });
        }

        const artifactOrgs = await storage.getArtifactOrganizations();
        const extractOrgName = (url: string): string => {
          let orgName = url;
          if (orgName.includes("dev.azure.com")) {
            orgName = orgName.replace(/https?:\/\/dev\.azure\.com\//, "").replace(/\/$/, "").split("/")[0];
          } else if (orgName.includes("visualstudio.com")) {
            const match = orgName.match(/([^\.]+)\.visualstudio\.com/);
            if (match) orgName = match[1];
          }
          return orgName.replace(/\/+$/, "").trim();
        };

        const targetOrg = artifactOrgs.find((org) => {
          const orgName = extractOrgName(org.organizationUrl);
          return orgName.toLowerCase() === (organization as string).toLowerCase() && org.patToken;
        });

        if (!targetOrg?.patToken) {
          return res.status(404).json({ error: "ADO organization not found." });
        }

        const decryptedPAT = safeDecryptPAT(targetOrg.patToken);
        if (!decryptedPAT) {
          return res.status(400).json({ error: "Failed to decrypt ADO PAT token." });
        }

        let adoBaseUrl = targetOrg.organizationUrl.replace(/\/+$/, "");
        if (!adoBaseUrl.startsWith("http")) {
          adoBaseUrl = `https://dev.azure.com/${adoBaseUrl}`;
        }

        const authHeader = `Basic ${Buffer.from(`:${decryptedPAT}`).toString("base64")}`;
        const normalizedPath = (filePath as string).startsWith("/") ? filePath as string : `/${filePath}`;
        const fileUrl = `${adoBaseUrl}/${encodeURIComponent(projectName as string)}/_apis/git/repositories/${repositoryId}/items?path=${encodeURIComponent(normalizedPath)}&$format=text&api-version=7.0`;

        const fileResp = await fetch(fileUrl, {
          headers: { Authorization: authHeader },
        });

        if (!fileResp.ok) {
          return res.status(fileResp.status).json({ error: "Failed to fetch file from repo." });
        }

        const content = await fileResp.text();
        return res.json({ content });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to fetch repo file:", error);
        return res.status(500).json({ error: error?.message || "Failed to fetch file from repo." });
      }
    }
  );

  /**
   * Backfill user_stories_json for all features that don't have it.
   * Accepts the full feature+stories array from the client (ADO data).
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/backfill-stories",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { features } = req.body as {
          features: Array<{
            id: number;
            userStories: Array<{
              id: number;
              title: string;
              state?: string;
              description?: string;
              acceptanceCriteria?: string;
              storyPoints?: number | null;
            }>;
          }>;
        };

        if (!projectId || !Array.isArray(features)) {
          return res.status(400).json({ error: "projectId and features[] are required" });
        }

        let updatedCount = 0;
        for (const feature of features) {
          if (!feature.userStories?.length) continue;

          const storiesData = feature.userStories.map((s) => ({
            id: s.id,
            title: s.title,
            state: s.state,
            description: s.description,
            acceptanceCriteria: s.acceptanceCriteria,
            storyPoints: s.storyPoints,
          }));

          // Update specs-type rows for this feature that don't have stories yet
          const rows = await db
            .select({ id: schema.sdlcSpecsFiles.id, userStoriesJson: schema.sdlcSpecsFiles.userStoriesJson })
            .from(schema.sdlcSpecsFiles)
            .where(
              and(
                eq(schema.sdlcSpecsFiles.projectId, projectId),
                eq(schema.sdlcSpecsFiles.featureId, feature.id),
                eq(schema.sdlcSpecsFiles.fileType, "specs"),
              ),
            );

          for (const row of rows) {
            // Always update if client sends stories — overwrite stale/empty data
            await db
              .update(schema.sdlcSpecsFiles)
              .set({ userStoriesJson: storiesData })
              .where(eq(schema.sdlcSpecsFiles.id, row.id));
            updatedCount++;
          }
        }

        return res.json({ success: true, updatedCount });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to backfill stories:", error);
        return res.status(500).json({ error: error?.message || "Failed to backfill stories." });
      }
    }
  );

  /**
   * Delete a single specs file by ID.
   */
  app.delete(
    "/api/sdlc/projects/:projectId/specs/files/:fileId",
    async (req: Request, res: Response) => {
      try {
        const { projectId, fileId } = req.params;
        if (!projectId || !fileId) {
          return res.status(400).json({ error: "projectId and fileId are required" });
        }

        await db
          .delete(schema.sdlcSpecsFiles)
          .where(
            and(
              eq(schema.sdlcSpecsFiles.id, fileId),
              eq(schema.sdlcSpecsFiles.projectId, projectId),
            ),
          );

        return res.json({ success: true });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to delete specs file:", error);
        return res.status(500).json({ error: error?.message || "Failed to delete file." });
      }
    }
  );

  /**
   * Generate specs.md and requirements.md for selected Features & User Stories using Azure OpenAI.
   *
   * The client sends an array of "features", each containing its selected user stories.
   * We treat each feature as a separate "chunk" and generate two markdown files per feature:
   * - specs.md          (full specification)
   * - requirements.md   (requirements quality checklist)
   *
   * The templates in server/specs_format/spec.md and
   * server/specs_format/checklists/requirements.md are used as structural guides.
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/generate-from-backlog",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { features } = req.body as {
          features?: Array<{
            id: number;
            title: string;
            state?: string;
            description?: string;
            userStories?: Array<{
              id: number;
              title: string;
              state?: string;
              description?: string;
              acceptanceCriteria?: string;
              storyPoints?: number | null;
            }>;
          }>;
        };

        if (!projectId) {
          return res
            .status(400)
            .json({ error: "projectId is required in route params" });
        }
        // Project-wise attribution: tag specs AI usage with this SDLC project id.
        setAiContext({ projectId, feature: "specs" });

        if (!Array.isArray(features) || features.length === 0) {
          return res.status(400).json({
            error:
              "No features provided. Please send a non-empty 'features' array.",
          });
        }

        const { SpecsGenerator } = await import("../services/specs-generator");
        const generator = new SpecsGenerator();

        const normalizedFeatures = features.map((f) => ({
          id: Number(f.id),
          title: String(f.title || `Feature ${f.id}`),
          state: f.state,
          description: f.description,
          userStories: (f.userStories || []).map((s) => ({
            id: Number(s.id),
            title: String(s.title || `User Story ${s.id}`),
            state: s.state,
            description: s.description,
            acceptanceCriteria: s.acceptanceCriteria,
            storyPoints:
              typeof s.storyPoints === "number" ? s.storyPoints : null,
          })),
        }));

        const results = await generator.generateForFeatures(
          normalizedFeatures
        );

        // Persist generated files to database so they can be restored later
        try {
          const rows = results.flatMap((r) => {
            const featureTitle = r.featureTitle || `Feature ${r.featureId}`;
            const baseSlug = featureTitle
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "") || `feature-${r.featureId}`;
            const basePath = `specs/${baseSlug}`;

            return [
              {
                id: buildFeatureFileId(projectId, r.featureId, "specs"),
                projectId,
                featureId: r.featureId,
                featureTitle,
                fileType: "specs",
                fileName: "specs.md",
                path: `${basePath}/specs.md`,
                content: r.specsContent,
              },
              {
                id: buildFeatureFileId(projectId, r.featureId, "requirements"),
                projectId,
                featureId: r.featureId,
                featureTitle,
                fileType: "requirements",
                fileName: "requirements.md",
                path: `${basePath}/requirements.md`,
                content: r.requirementsContent,
              },
            ];
          });

          if (rows.length > 0) {
            // Delete old files for regenerated features before inserting
            const featureIds = [...new Set(rows.map((r) => r.featureId))];
            await db
              .delete(schema.sdlcSpecsFiles)
              .where(
                and(
                  eq(schema.sdlcSpecsFiles.projectId, projectId),
                  inArray(schema.sdlcSpecsFiles.featureId, featureIds),
                ),
              );
            console.log("[DEBUG SAVE] Regenerating files with IDs:", rows.map(r => r.id));
            await db.insert(schema.sdlcSpecsFiles).values(rows);
          }
        } catch (dbError) {
          console.error(
            "[SDLC Specs] Failed to persist generated specs to database:",
            dbError
          );
          // Don't fail the whole request if persistence fails
        }

        return res.json({
          projectId,
          totalFeatures: results.length,
          files: results.map((r) => ({
            featureId: r.featureId,
            featureTitle: r.featureTitle,
            specsContent: r.specsContent,
            requirementsContent: r.requirementsContent,
          })),
        });
      } catch (error: any) {
        console.error(
          "[SDLC Specs] Failed to generate specs from backlog:",
          error
        );
        const message =
          error?.message ||
          "Failed to generate specs and requirements from selected features.";
        return res.status(500).json({ error: message });
      }
    }
  );

  // Async (job-based) specs generation with polling, chunked per feature
  app.post(
    "/api/sdlc/projects/:projectId/specs/generate-from-backlog/async",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { features, enableTdd, skipIdempotent, specsArchitectureStyle, specsDeliveryOrder } = req.body as {
          features?: Array<{
            id: number;
            title: string;
            state?: string;
            description?: string;
            userStories?: Array<{
              id: number;
              title: string;
              state?: string;
              description?: string;
              acceptanceCriteria?: string;
              storyPoints?: number | null;
            }>;
          }>;
          enableTdd?: boolean;
          skipIdempotent?: boolean;
          specsArchitectureStyle?: "monolith" | "microservices";
          specsDeliveryOrder?: "ui-first" | "api-first" | null;
        };

        if (!projectId) {
          return res
            .status(400)
            .json({ error: "projectId is required in route params" });
        }
        // Project-wise attribution: tag specs AI usage with this SDLC project id.
        setAiContext({ projectId, feature: "specs" });

        if (!Array.isArray(features) || features.length === 0) {
          return res.status(400).json({
            error:
              "No features provided. Please send a non-empty 'features' array.",
          });
        }

        const normalizedFeatures = features.map((f) => ({
          id: Number(f.id),
          title: String(f.title || `Feature ${f.id}`),
          state: f.state,
          description: f.description,
          userStories: (f.userStories || []).map((s) => ({
            id: Number(s.id),
            title: String(s.title || `User Story ${s.id}`),
            state: s.state,
            description: s.description,
            acceptanceCriteria: s.acceptanceCriteria,
            storyPoints:
              typeof s.storyPoints === "number" ? s.storyPoints : null,
          })),
        }));

        const normalizedArchitectureStyle = normalizeArchitectureStyle(specsArchitectureStyle);
        const normalizedDeliveryOrder = normalizeDeliveryOrder(normalizedArchitectureStyle, specsDeliveryOrder);

        // Concurrent lock check
        const [projectRow] = await db
          .select({ isGenerating: schema.sdlcProjects.isGenerating })
          .from(schema.sdlcProjects)
          .where(eq(schema.sdlcProjects.id, projectId))
          .limit(1);
        if (projectRow?.isGenerating) {
          return res.status(409).json({ error: "A generation is already in progress for this project. Please wait for it to complete." });
        }

        const jobId = randomUUID();
        const job: SpecsGenerationJob = {
          jobId,
          projectId,
          status: "pending",
          progress: 0,
          step: "Queued...",
          createdAt: new Date(),
          result: {
            totalFeatures: normalizedFeatures.length,
            processedFeatures: 0,
            files: [],
          },
        };

        specsGenerationJobs.set(jobId, job);

        // Persist generation preferences at project level
        if (enableTdd !== undefined || specsArchitectureStyle !== undefined || specsDeliveryOrder !== undefined) {
          try {
            const updateData: Record<string, unknown> = {};
            if (enableTdd !== undefined) updateData.enableTdd = !!enableTdd;
            if (specsArchitectureStyle !== undefined) {
              updateData.specsArchitectureStyle = normalizedArchitectureStyle;
              updateData.specsDeliveryOrder = normalizedDeliveryOrder;
            } else if (specsDeliveryOrder !== undefined) {
              updateData.specsDeliveryOrder = normalizedDeliveryOrder;
            }
            await db
              .update(schema.sdlcProjects)
              .set(updateData)
              .where(eq(schema.sdlcProjects.id, projectId));
          } catch (tddErr) {
            console.error(
              "[SDLC Specs] Failed to persist specs preferences:",
              tddErr
            );
          }
        }

        // Enqueue into unified in-process queue (A, B, ... all go through here)
        specsJobQueue.push({
          jobId,
          projectId,
          userId: (req as any).user?.id,
          tenantId: await getTenantIdFromRequest(req),
          enableTdd: !!enableTdd,
          skipIdempotent: skipIdempotent !== false, // default true
          specsArchitectureStyle: normalizedArchitectureStyle,
          specsDeliveryOrder: normalizedDeliveryOrder,
          features: normalizedFeatures,
        });

        void processSpecsQueue();

        res.json({
          success: true,
          jobId,
          status: job.status,
          message:
            "Specs generation started. Use /api/sdlc/specs/generate/status/:jobId to poll for results.",
        });
      } catch (error: any) {
        console.error(
          "[SDLC Specs] Failed to start async specs generation from backlog:",
          error
        );
        const message =
          error?.message ||
          "Failed to start async specs and requirements generation from selected features.";
        return res.status(500).json({ error: message });
      }
    }
  );

  app.patch(
    "/api/sdlc/projects/:projectId/specs/preferences",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const resolvedProjectId = await resolveSdlcProjectId(projectId);
        if (!resolvedProjectId) {
          return res.status(404).json({ error: "Project not found" });
        }
        const parsedStyle = parseArchitectureStyle(req.body?.specsArchitectureStyle);
        if (!parsedStyle) {
          return res.status(400).json({ error: "specsArchitectureStyle is required (monolith|microservices)" });
        }
        const deliveryOrder = normalizeDeliveryOrder(parsedStyle, req.body?.specsDeliveryOrder);
        if (parsedStyle === "microservices" && !req.body?.specsDeliveryOrder) {
          return res.status(400).json({ error: "specsDeliveryOrder is required when specsArchitectureStyle is microservices" });
        }
        const enableTdd = req.body?.enableTdd;

        const updateData: Record<string, unknown> = {
          specsArchitectureStyle: parsedStyle,
          specsDeliveryOrder: deliveryOrder,
        };
        if (typeof enableTdd === "boolean") {
          updateData.enableTdd = enableTdd;
        }

        await db
          .update(schema.sdlcProjects)
          .set(updateData)
          .where(eq(schema.sdlcProjects.id, resolvedProjectId));

        return res.json({
          success: true,
          specsArchitectureStyle: parsedStyle,
          specsDeliveryOrder: deliveryOrder,
          ...(typeof enableTdd === "boolean" ? { enableTdd } : {}),
        });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to save specs preferences:", error);
        return res.status(500).json({ error: error?.message || "Failed to save specs preferences" });
      }
    },
  );

  // Polling endpoint for specs generation status
  app.get(
    "/api/sdlc/specs/generate/status/:jobId",
    async (req: Request, res: Response) => {
      try {
        const { jobId } = req.params;
        const job = specsGenerationJobs.get(jobId);

        if (!job) {
          console.error(
            `[SDLC Specs][Job] Status request for non-existent job: ${jobId}`
          );
          return res.status(404).json({ error: "Job not found", jobId });
        }

        if (job.status === "failed") {
          const errorMessage =
            job.error ||
            "Specs generation failed for selected features from backlog.";
          console.error(`[SDLC Specs][Job] Job ${jobId} failed: ${errorMessage}`);
          return res.status(500).json({
            jobId: job.jobId,
            projectId: job.projectId,
            status: job.status,
            progress: job.progress,
            step: job.step,
            createdAt: job.createdAt.toISOString(),
            completedAt: job.completedAt?.toISOString(),
            result: job.result,
            error: errorMessage,
          });
        }

        return res.json({
          jobId: job.jobId,
          projectId: job.projectId,
          status: job.status,
          progress: job.progress,
          step: job.step,
          createdAt: job.createdAt.toISOString(),
          completedAt: job.completedAt?.toISOString(),
          result: job.result,
          error: job.error,
        });
      } catch (error: any) {
        console.error(
          `[SDLC Specs][Job] Error getting job status for jobId ${req.params.jobId}:`,
          error
        );
        res.status(500).json({
          error: "Failed to get specs generation job status",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  /**
   * Fetch previously generated specs/requirements files for an SDLC project.
   * Used to rebuild the file tree and "Generated" indicators.
   */
  app.get(
    "/api/sdlc/projects/:projectId/specs/files",
    // requireActivity("SDLC_SPECS_VIEW"), // TODO: Re-enable after setting up activities
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        if (!projectId) {
          return res
            .status(400)
            .json({ error: "projectId is required in route params" });
        }
        const resolvedProjectId = await resolveSdlcProjectId(projectId);
        const projectIdFilter = resolvedProjectId && resolvedProjectId !== projectId
          ? or(
              eq(schema.sdlcSpecsFiles.projectId, resolvedProjectId),
              eq(schema.sdlcSpecsFiles.projectId, projectId),
            )
          : eq(schema.sdlcSpecsFiles.projectId, projectId);

        let [rows, projectRows] = await Promise.all([
          db
            .select()
            .from(schema.sdlcSpecsFiles)
            .where(projectIdFilter),
          db
            .select({
              id: schema.sdlcProjects.id,
              name: schema.sdlcProjects.name,
              description: schema.sdlcProjects.description,
              organization: schema.sdlcProjects.organization,
              linkedGoldenRepoOrg: schema.sdlcProjects.linkedGoldenRepoOrg,
              linkedGoldenRepoProject: schema.sdlcProjects.linkedGoldenRepoProject,
              linkedGoldenRepoName: schema.sdlcProjects.linkedGoldenRepoName,
              goldenRepoReference: schema.sdlcProjects.goldenRepoReference,
              enableTdd: schema.sdlcProjects.enableTdd,
              specsArchitectureStyle: schema.sdlcProjects.specsArchitectureStyle,
              specsDeliveryOrder: schema.sdlcProjects.specsDeliveryOrder,
            })
            .from(schema.sdlcProjects)
            .where(
              resolvedProjectId
                ? eq(schema.sdlcProjects.id, resolvedProjectId)
                : eq(schema.sdlcProjects.id, projectId),
            )
            .limit(1),
        ]);

        const hasDevxContext = rows.some((r) => r.fileType === "devx-context");
        if (!hasDevxContext) {
          const specLikeRows = rows.filter((r) =>
            r.fileType === "specs" || r.fileType === "requirements" || r.fileType === "tdd-tests",
          );
          if (specLikeRows.length > 0) {
            const byFeature = new Map<number, {
              featureId: number;
              featureTitle: string;
              specsContent: string;
              requirementsContent: string;
              tddTestsContent?: string;
              userStories: Array<{ id: number; title: string; state?: string; storyPoints?: number | null }>;
            }>();

            for (const file of specLikeRows) {
              if (!byFeature.has(file.featureId)) {
                const storedStories = file.userStoriesJson as any[] | null;
                const userStories = storedStories?.map((s: any) => ({
                  id: s.id,
                  title: s.title,
                  state: s.state,
                  storyPoints: s.storyPoints,
                })) ?? [];
                byFeature.set(file.featureId, {
                  featureId: file.featureId,
                  featureTitle: file.featureTitle,
                  specsContent: "",
                  requirementsContent: "",
                  userStories,
                });
              }
              const entry = byFeature.get(file.featureId)!;
              if (file.fileType === "specs") entry.specsContent = file.content;
              else if (file.fileType === "requirements") entry.requirementsContent = file.content;
              else if (file.fileType === "tdd-tests") entry.tddTestsContent = file.content;
            }

            const allFeatures = Array.from(byFeature.values()).map((f) => ({
              id: f.featureId,
              title: f.featureTitle,
              userStories: f.userStories,
            }));
            const allResults = Array.from(byFeature.values()).map((f) => ({
              featureId: f.featureId,
              featureTitle: f.featureTitle,
              specsContent: f.specsContent,
              requirementsContent: f.requirementsContent,
              tddTestsContent: f.tddTestsContent,
            }));

            const { generateDevxContext } = await import("../services/specs-generator/devx-context-generator");
            const projectInfo = projectRows[0];
            const goldenRepoReference =
              projectInfo?.goldenRepoReference &&
              typeof projectInfo.goldenRepoReference === "object"
                ? (projectInfo.goldenRepoReference as {
                    repoId?: string;
                    repoName?: string;
                    filePaths?: string[];
                    provider?: string;
                    repoUrl?: string;
                    defaultBranch?: string;
                  })
                : null;

            const hasAnyGoldenContext = Boolean(
              goldenRepoReference?.repoId ||
              goldenRepoReference?.repoName ||
              projectInfo?.linkedGoldenRepoName ||
              projectInfo?.linkedGoldenRepoOrg ||
              projectInfo?.linkedGoldenRepoProject,
            );
            const specsTenantId = await getTenantIdFromRequest(req);

            const goldenRepoContext = hasAnyGoldenContext
              ? {
                  repoId: goldenRepoReference?.repoId,
                  repoName: goldenRepoReference?.repoName ?? projectInfo?.linkedGoldenRepoName ?? undefined,
                  organization: projectInfo?.linkedGoldenRepoOrg ?? undefined,
                  project: projectInfo?.linkedGoldenRepoProject ?? undefined,
                  provider: goldenRepoReference?.provider,
                  repoUrl: goldenRepoReference?.repoUrl,
                  defaultBranch: goldenRepoReference?.defaultBranch,
                  tenantId: specsTenantId,
                  selectedPaths: Array.isArray(goldenRepoReference?.filePaths)
                    ? goldenRepoReference.filePaths
                    : [],
                }
              : undefined;

            const goldenRepoUiDesignPackage = await extractGoldenRepoUiDesignPackage(
              goldenRepoContext,
              (req as any).user?.id,
            );
            const enrichedGoldenRepoContext = goldenRepoContext
              ? {
                  ...goldenRepoContext,
                  uiDesignPackage: goldenRepoUiDesignPackage,
                }
              : undefined;

            const devxFiles = await generateDevxContext({
              projectName: projectInfo?.name || "Project",
              projectDescription: projectInfo?.description ?? undefined,
              organization: projectInfo?.organization ?? undefined,
              specsArchitectureStyle: normalizeArchitectureStyle(projectInfo?.specsArchitectureStyle),
              specsDeliveryOrder: normalizeDeliveryOrder(
                normalizeArchitectureStyle(projectInfo?.specsArchitectureStyle),
                projectInfo?.specsDeliveryOrder,
              ),
              features: allFeatures,
              results: allResults,
              enableTdd: !!projectInfo?.enableTdd,
              goldenRepoContext: enrichedGoldenRepoContext,
            });

            const devxOnly = devxFiles.filter((f) => f.fileType === "devx-context");
            if (devxOnly.length > 0) {
              await db
                .delete(schema.sdlcSpecsFiles)
                .where(
                  and(
                    eq(schema.sdlcSpecsFiles.projectId, resolvedProjectId ?? projectId),
                    eq(schema.sdlcSpecsFiles.fileType, "devx-context"),
                  ),
                );

              const values = devxOnly.map((f) => ({
                id: buildPathFileId(resolvedProjectId ?? projectId, f.path),
                projectId: resolvedProjectId ?? projectId,
                featureId: f.featureId,
                featureTitle: f.featureTitle,
                fileType: f.fileType,
                fileName: f.fileName,
                path: f.path,
                content: f.content,
              }));
              await db.insert(schema.sdlcSpecsFiles).values(values);
              rows = await db
                .select()
                .from(schema.sdlcSpecsFiles)
                .where(projectIdFilter);
            }
          }
        }

        console.log("[DEBUG FILES] projectId:", projectId);
        console.log("[DEBUG FILES] Found files count:", rows.length);
        console.log("[DEBUG FILES] File IDs in database:", rows.map(r => r.id));

        return res.json({
          projectId,
          files: rows,
          enableTdd: projectRows[0]?.enableTdd ?? false,
          specsArchitectureStyle: parseArchitectureStyle(projectRows[0]?.specsArchitectureStyle),
          specsDeliveryOrder: parseDeliveryOrder(projectRows[0]?.specsDeliveryOrder),
        });
      } catch (error: any) {
        console.error(
          "[SDLC Specs] Failed to load specs files from database:",
          error
        );
        const message =
          error?.message || "Failed to load generated specs and requirements.";
        return res.status(500).json({ error: message });
      }
    }
  );

  /**
   * Mark specific specs files as pushed to ADO.
   * Stores content hash and repo commit ID for sync tracking.
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/mark-pushed",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { featureIds } = req.body as { featureIds: number[] };

        if (!projectId || !Array.isArray(featureIds) || featureIds.length === 0) {
          return res
            .status(400)
            .json({ error: "projectId and featureIds[] are required" });
        }

        // Fetch files to compute content hashes
        const files = await db
          .select()
          .from(schema.sdlcSpecsFiles)
          .where(
            and(
              eq(schema.sdlcSpecsFiles.projectId, projectId),
              inArray(schema.sdlcSpecsFiles.featureId, featureIds),
            ),
          );

        const { createHash } = await import("crypto");
        for (const file of files) {
          const contentHash = createHash("sha256").update(file.content, "utf8").digest("hex");
          await db
            .update(schema.sdlcSpecsFiles)
            .set({ pushedToAdo: true, contentHash, updatedAt: new Date() })
            .where(eq(schema.sdlcSpecsFiles.id, file.id));
        }

        return res.json({ success: true, markedCount: files.length });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to mark specs as pushed:", error);
        return res.status(500).json({ error: error?.message || "Failed to mark specs as pushed." });
      }
    }
  );

  /**
   * Generic push endpoint: pushes selected specs files to the project's configured repository.
   * Works for both ADO and Jira (via external Git config).
   *
   * ASYNC-JOB PATTERN: Multi-file Git pushes routinely exceed AWS API Gateway's
   * 29s request timeout (which surfaces as a 503 Service Unavailable with
   * `content-length: 33` — the gateway's own timeout body). This route
   * registers a job, returns 202 + jobId immediately, and runs the actual
   * push in the background. The client polls
   * `GET /api/jobs/specs-push/status/:jobId` until completion.
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/push",
    autoBootstrapUser,
    requireAuth,
    // requireActivity("SDLC_SPECS_PUSH"), // TODO: Re-enable after setting up activities
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { fileIds, basePath, branch, commitMessage, repoName } = req.body as {
          fileIds: string[];
          basePath?: string;
          branch?: string;
          commitMessage?: string;
          repoId?: string;
          repoName?: string;
        };

        console.log("[DEBUG PUSH] projectId:", projectId);
        console.log("[DEBUG PUSH] fileIds received:", fileIds);

        if (!projectId || !Array.isArray(fileIds) || fileIds.length === 0) {
          return res.status(400).json({ error: "projectId and fileIds[] are required" });
        }

        const specsTenantId = await getTenantIdFromRequest(req);
        const authUser = (req as any).user;
        const pushService = new SpecsPushService();

        const { jobId } = asyncJobManager.start(
          "specs-push",
          async ({ updateProgress }) => {
            updateProgress(10, `Pushing ${fileIds.length} specs file(s) to repository`);
            const result = await pushService.pushSpecsToRepo(projectId, fileIds, {
              basePath,
              branch,
              commitMessage,
              tenantId: specsTenantId,
              userId: authUser?.id,
              repoName: typeof repoName === "string" ? repoName.trim() : undefined,
            });
            if (!result.success) {
              throw new Error(result.error || "Failed to push specs to repository.");
            }
            updateProgress(100, `Pushed ${result.pushedCount} file(s) successfully`);
            // Quality: specs pushed → mark the latest unrated specs AI row accepted.
            try {
              const { markAccepted } = await import("../observability/quality");
              markAccepted({ userId: (req as any).user?.id, feature: "specs" });
            } catch { /* non-fatal */ }
            return result;
          },
          `Pushing ${fileIds.length} specs file(s) to repository`,
        );

        return res.status(202).json({
          success: true,
          jobId,
          status: "processing",
          message: `Push started. Poll /api/jobs/specs-push/status/${jobId} for status.`,
        });
      } catch (error: any) {
        console.error("[SDLC Specs] Generic push failed:", error);
        return res.status(500).json({
          success: false,
          error: error?.message || "Failed to push specs to repository.",
        });
      }
    }
  );

  /**
   * Sync status: compare local DB specs files with the project's configured repo
   * (GitHub / GitLab / Bitbucket / Azure Repos), resolved from integration config.
   * Returns per-file sync status without fetching full content from repo.
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/sync-status",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { repositoryId, basePath = "specs", branch } = req.body as {
          repositoryId?: string;
          basePath?: string;
          branch?: string;
        };

        if (!projectId || !repositoryId) {
          return res.status(400).json({
            error: "projectId and repositoryId are required",
          });
        }

        // 1. Fetch local DB files
        const localFiles = await db
          .select()
          .from(schema.sdlcSpecsFiles)
          .where(eq(schema.sdlcSpecsFiles.projectId, projectId));

        const buildLocalOnlyResponse = () => ({
          syncResults: localFiles.map((f) => ({
            path: f.path,
            status: "local-only" as const,
            localFileId: f.id,
            featureId: f.featureId,
            featureTitle: f.featureTitle,
            fileName: f.fileName,
            fileType: f.fileType,
          })),
          repoIsEmpty: true,
        });

        // 2. Fetch repo tree via the project's configured provider
        //    (GitHub / GitLab / Bitbucket / Azure Repos).
        let repoItems: Array<{ path: string; objectId: string }> = [];
        let repoIsEmpty = false;
        try {
          const tree = await listProviderTree(projectId, repositoryId, basePath, branch, (req as any).user?.id);
          repoItems = tree.files;
          repoIsEmpty = tree.repoIsEmpty;
        } catch (err) {
          // No repo provider configured (or unsupported) — everything is local-only.
          console.warn("[SDLC Sync] Provider tree fetch failed:", err);
          return res.json(buildLocalOnlyResponse());
        }

        // 3. Build maps keyed by normalized path (skip devx-context files — they're always regenerated)
        const localByPath = new Map<string, typeof localFiles[0]>();
        // Auto-generated .devx/ files that are always rebuilt (skip from sync)
        const autoGeneratedDevxPaths = new Set([
          "specs/.devx/README.md",
          "specs/.devx/features.json",
          "specs/.devx/project.md",
          "specs/.devx/architecture.md",
          "specs/.devx/workflow.md",
          "specs/.devx/instruction.md",
          "specs/.devx/skills/ui-skill/golden-ui-design-system.md",
          "specs/.devx/skills/ui-skill/golden-ui-design-sources.md",
        ]);
        for (const f of localFiles) {
          if (autoGeneratedDevxPaths.has(f.path)) continue;
          const normalizedPath = f.path.startsWith("/") ? f.path.slice(1) : f.path;
          const existing = localByPath.get(normalizedPath);
          // Prefer the row with repoCommitId, or the most recently updated
          if (!existing || (f.repoCommitId && !existing.repoCommitId) || f.updatedAt > existing.updatedAt) {
            localByPath.set(normalizedPath, f);
          }
        }

        const repoByPath = new Map<string, { objectId: string; path: string }>();
        for (const item of repoItems) {
          const normalizedPath = (item.path || "").replace(/^\/+/, "");
          // Skip auto-generated .devx/ files from sync
          if (autoGeneratedDevxPaths.has(normalizedPath)) continue;
          repoByPath.set(normalizedPath, { objectId: item.objectId, path: normalizedPath });
        }

        // 5. Compare and determine status
        const { createHash } = await import("crypto");
        const syncResults: any[] = [];
        const allPaths = new Set([...localByPath.keys(), ...repoByPath.keys()]);

        // For files needing content comparison (no repoCommitId stored), batch fetch from repo
        const needsContentFetch: string[] = [];
        for (const path of allPaths) {
          const local = localByPath.get(path);
          const repo = repoByPath.get(path);

          if (local && !repo) {
            syncResults.push({
              path,
              status: "local-only",
              localFileId: local.id,
              featureId: local.featureId,
              featureTitle: local.featureTitle,
              fileName: local.fileName,
              fileType: local.fileType,
            });
          } else if (!local && repo) {
            syncResults.push({
              path,
              status: "repo-only",
              repoObjectId: repo.objectId,
              fileName: path.split("/").pop() || "",
            });
          } else if (local && repo) {
            if (local.repoCommitId) {
              // We have a stored repo commit ID — compare
              if (local.repoCommitId === repo.objectId) {
                // Repo hasn't changed. Check if local changed since push.
                const currentHash = createHash("sha256").update(local.content, "utf8").digest("hex");
                if (local.contentHash && local.contentHash === currentHash) {
                  syncResults.push({ path, status: "in-sync", localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType });
                } else {
                  syncResults.push({ path, status: "modified-locally", localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType });
                }
              } else {
                // Repo changed. Did local also change?
                const currentHash = createHash("sha256").update(local.content, "utf8").digest("hex");
                if (local.contentHash && local.contentHash === currentHash) {
                  syncResults.push({ path, status: "modified-in-repo", localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType });
                } else {
                  syncResults.push({ path, status: "conflict", localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType });
                }
              }
            } else if (local.pushedToAdo) {
              // Pushed but no repoCommitId (pre-sync era). Need content comparison.
              needsContentFetch.push(path);
            } else {
              // Never pushed, but file exists in repo (someone else pushed it?)
              needsContentFetch.push(path);
            }
          }
        }

        // Batch fetch repo content for files needing direct comparison (max 10 concurrent)
        const chunkSize = 10;
        for (let i = 0; i < needsContentFetch.length; i += chunkSize) {
          const chunk = needsContentFetch.slice(i, i + chunkSize);
          const results = await Promise.all(
            chunk.map(async (path) => {
              const local = localByPath.get(path)!;
              const repo = repoByPath.get(path)!;
              try {
                const fetchedContent = await getProviderFileContent(projectId, repositoryId, path, branch, (req as any).user?.id);
                if (fetchedContent === null) {
                  return { path, status: "conflict" as const, localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType };
                }
                const repoContent = fetchedContent.replace(/\r\n/g, "\n").trim();
                const localContent = local.content.replace(/\r\n/g, "\n").trim();
                const isSame = repoContent === localContent;
                if (isSame) {
                  // Store repoCommitId so future syncs skip content fetch
                  await db
                    .update(schema.sdlcSpecsFiles)
                    .set({ repoCommitId: repo.objectId, contentHash: createHash("sha256").update(local.content, "utf8").digest("hex"), pushedToAdo: true })
                    .where(eq(schema.sdlcSpecsFiles.id, local.id));
                  return { path, status: "in-sync" as const, localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType };
                } else {
                  return { path, status: "conflict" as const, localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType };
                }
              } catch {
                return { path, status: "conflict" as const, localFileId: local.id, repoObjectId: repo.objectId, featureId: local.featureId, featureTitle: local.featureTitle, fileName: local.fileName, fileType: local.fileType };
              }
            }),
          );
          syncResults.push(...results);
        }

        return res.json({ syncResults, repoIsEmpty });
      } catch (error: any) {
        console.error("[SDLC Sync] sync-status failed:", error);
        return res.status(500).json({ error: error?.message || "Sync status check failed." });
      }
    }
  );

  /**
   * Pull specific files from the project's configured repo (GitHub / GitLab /
   * Bitbucket / Azure Repos) into the local DB.
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/sync-pull",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { repositoryId, branch, files } = req.body as {
          repositoryId?: string;
          branch?: string;
          files?: Array<{ path: string; repoObjectId: string; action: "pull" | "accept-repo" }>;
        };

        if (!projectId || !repositoryId || !files?.length) {
          return res.status(400).json({ error: "Missing required fields." });
        }

        const { createHash } = await import("crypto");
        const pulled: string[] = [];

        for (const file of files) {
          try {
            const repoContent = await getProviderFileContent(projectId, repositoryId, file.path, branch, (req as any).user?.id);
            if (repoContent === null) continue;
            const contentHash = createHash("sha256").update(repoContent, "utf8").digest("hex");
            const fileName = file.path.split("/").pop() || "file.md";
            const fileType = fileName.includes("requirements")
              ? "requirements"
              : fileName.includes("tdd")
                ? "tdd-tests"
                : "specs";

            // Try to extract feature info from path: specs/<slug>/<file>.md
            const pathParts = file.path.split("/");
            const slug = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : "";

            // Check if a local file already exists at this path
            const existing = await db
              .select()
              .from(schema.sdlcSpecsFiles)
              .where(
                and(
                  eq(schema.sdlcSpecsFiles.projectId, projectId),
                  eq(schema.sdlcSpecsFiles.path, file.path),
                ),
              );

            if (existing.length > 0) {
              // Delete duplicates, keep only the first
              if (existing.length > 1) {
                const dupIds = existing.slice(1).map((e) => e.id);
                await db
                  .delete(schema.sdlcSpecsFiles)
                  .where(inArray(schema.sdlcSpecsFiles.id, dupIds));
              }
              // Update the kept row
              await db
                .update(schema.sdlcSpecsFiles)
                .set({
                  content: repoContent,
                  contentHash,
                  repoCommitId: file.repoObjectId,
                  pushedToAdo: true,
                  updatedAt: new Date(),
                })
                .where(eq(schema.sdlcSpecsFiles.id, existing[0].id));
            } else {
              // Insert new file pulled from repo
              await db.insert(schema.sdlcSpecsFiles).values({
                id: buildPathFileId(projectId, file.path),
                projectId,
                featureId: 0,
                featureTitle: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Unknown",
                fileType,
                fileName,
                path: file.path,
                content: repoContent,
                contentHash,
                repoCommitId: file.repoObjectId,
                pushedToAdo: true,
              });
            }

            pulled.push(file.path);
          } catch (err) {
            console.warn(`[SDLC Sync] Failed to pull file ${file.path}:`, err);
          }
        }

        return res.json({ success: true, pulledCount: pulled.length, files: pulled });
      } catch (error: any) {
        console.error("[SDLC Sync] sync-pull failed:", error);
        return res.status(500).json({ error: error?.message || "Pull from repo failed." });
      }
    }
  );

  /**
   * Download all generated specs/requirements for a project as a ZIP archive.
   * Preserves the logical folder structure defined by sdlc_specs_files.path.
   */
  app.get(
    "/api/sdlc/projects/:projectId/specs/export-zip",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        if (!projectId) {
          return res
            .status(400)
            .json({ error: "projectId is required in route params" });
        }

        const files = await db
          .select({
            path: schema.sdlcSpecsFiles.path,
            content: schema.sdlcSpecsFiles.content,
          })
          .from(schema.sdlcSpecsFiles)
          .where(eq(schema.sdlcSpecsFiles.projectId, projectId));

        if (!files.length) {
          return res.status(404).json({
            error:
              "No generated specs or requirements were found for this project.",
          });
        }

        const { default: archiver } = await import("archiver");

        const safeProjectId = String(projectId).replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        );
        const zipFilename = `specs-${safeProjectId}.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${zipFilename}"`
        );

        const archive = archiver("zip", {
          zlib: { level: 9 },
        });

        archive.on("error", (err: Error) => {
          console.error("[SDLC Specs] ZIP archive error:", err);
          try {
            if (!res.headersSent) {
              res
                .status(500)
                .json({ error: "Failed to generate specs ZIP archive." });
            } else {
              res.end();
            }
          } catch {
            // Ignore secondary errors while ending response
          }
        });

        archive.pipe(res);

        for (const file of files) {
          const relativePath =
            typeof file.path === "string" && file.path.trim().length > 0
              ? file.path
              : "specs/unnamed/spec.md";
          const content =
            typeof file.content === "string" ? file.content : "";
          archive.append(content, { name: relativePath });
        }

        await archive.finalize();
      } catch (error: any) {
        console.error(
          "[SDLC Specs] Failed to export specs ZIP archive:",
          error
        );
        if (!res.headersSent) {
          const message =
            error?.message || "Failed to export specs ZIP archive.";
          return res.status(500).json({ error: message });
        }
        res.end();
      }
    }
  );

  /**
   * Download Specs-to-Code bundle for a project:
   * - plugin (vsix)
   * - plugin guide
   * - linked golden repo content as extracted files (no nested zip) when available
   */
  app.get(
    "/api/sdlc/projects/:projectId/specs-to-code/download-bundle",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const includeWithoutGoldenRepo =
          String(req.query.includeWithoutGoldenRepo || "").toLowerCase() ===
          "true";

        if (!projectId) {
          return res
            .status(400)
            .json({ error: "projectId is required in route params" });
        }

        const [project] = await db
          .select({
            id: schema.sdlcProjects.id,
            name: schema.sdlcProjects.name,
            goldenRepoReference: schema.sdlcProjects.goldenRepoReference,
            linkedGoldenRepoOrg: schema.sdlcProjects.linkedGoldenRepoOrg,
            linkedGoldenRepoProject: schema.sdlcProjects.linkedGoldenRepoProject,
          })
          .from(schema.sdlcProjects)
          .where(
            or(
              eq(schema.sdlcProjects.id, projectId),
              eq(schema.sdlcProjects.projectId, projectId),
            ),
          )
          .limit(1);

        if (!project) {
          return res.status(404).json({
            error:
              "Project not found. Ensure a matching SDLC project exists for the provided projectId.",
          });
        }

        const goldenRepoReference =
          project.goldenRepoReference &&
          typeof project.goldenRepoReference === "object"
            ? (project.goldenRepoReference as {
                repoId?: string;
                repoName?: string;
              })
            : null;
        const repoId = goldenRepoReference?.repoId?.trim() || "";
        const hasLinkedGoldenRepo = Boolean(repoId);

        if (!hasLinkedGoldenRepo && !includeWithoutGoldenRepo) {
          return res.status(409).json({
            code: "GOLDEN_REPO_NOT_LINKED",
            goldenRepoLinked: false,
            message:
              "Golden repo is not linked for this project. Do you want to continue without it?",
          });
        }

        // Resolve static asset paths robustly for both local dev and deployed AWS.
        // Probe candidate directories in order until the file is found.
        const pluginFilename = "nous-ai-vscode-1.0.0.vsix";
        const guideFilename = "Plugin_Guide.md";

        const resolveAssetPath = async (filename: string): Promise<string> => {
          const candidates = [
            // AWS EC2 deployment path - files are actually here!
            path.join("/opt/devx/dist", filename),
            // Current working directory (most common)
            path.join(process.cwd(), filename),
            // Dist directory (for built applications)
            path.join(process.cwd(), "dist", filename),
            // Relative to current module (only in ES modules)
            ...(typeof import.meta !== 'undefined' && import.meta.url 
              ? [path.join(path.dirname(new URL(import.meta.url).pathname), filename)] 
              : []),
            // AWS EC2 deployment paths (CRITICAL: /opt/devx/ is where files actually are!)
            path.join("/opt/devx", filename),
            path.join("/app", filename),
            path.join("/opt/app", filename),
            path.join("/home/ec2-user/app", filename),
            // Parent directory (in case files are one level up)
            path.join(process.cwd(), "..", filename),
            // Server directory (if files are in server folder)
            path.join(process.cwd(), "server", filename),
            path.join(process.cwd(), "dist", "server", filename),
            // Root level deployment paths
            path.join("/", filename),
          ];
          
          console.log(`[Specs Bundle] Resolving asset: ${filename}`);
          console.log(`[Specs Bundle] Current working directory: ${process.cwd()}`);
          
          for (const candidate of candidates) {
            try {
              await fs.access(candidate);
              console.log(`[Specs Bundle] Found ${filename} at: ${candidate}`);
              return candidate;
            } catch {
              // try next candidate
            }
          }
          
          console.error(`[Specs Bundle] Asset not found: ${filename}`);
          console.error(`[Specs Bundle] Searched paths: ${candidates.join(", ")}`);
          throw new Error(
            `Required file "${filename}" not found. Searched: ${candidates.join(", ")}`,
          );
        };

        const pluginPath = await resolveAssetPath(pluginFilename);
        const guidePath = await resolveAssetPath(guideFilename);

        const { default: archiver } = await import("archiver");
        const safeProjectName = String(project.name || projectId)
          .trim()
          .replace(/[^a-zA-Z0-9._-]+/g, "-")
          .replace(/^-+|-+$/g, "");
        const zipFilename = `specs-to-code-bundle-${safeProjectName || projectId}.zip`;

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${zipFilename}"`,
        );

        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("error", (err: Error) => {
          console.error("[Specs Bundle] ZIP archive error:", err);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to generate bundle ZIP." });
            return;
          }
          res.end();
        });

        archive.pipe(res);
        archive.file(pluginPath, { name: "plugin/nous-ai-vscode-1.0.0.vsix" });
        archive.file(guidePath, { name: "guide/Plugin_Guide.md" });

        if (hasLinkedGoldenRepo) {
          const repoInfo = await findRepositoryOrganization(repoId);
          if (!repoInfo) {
            throw new Error(
              "Golden repo is linked but could not be resolved in configured Azure DevOps settings.",
            );
          }

          const { organization: org, repository: repoData, authHeader } = repoInfo;
          const targetBranch =
            repoData.defaultBranch?.replace("refs/heads/", "") || "main";

          const zipUrl = `${org.organizationUrl}/${org.projectName}/_apis/git/repositories/${repoId}/items?path=/&versionDescriptor.version=${targetBranch}&$format=zip&api-version=${org.apiVersion}`;
          const zipResponse = await fetch(zipUrl, {
            headers: {
              Authorization: authHeader,
              Accept: "application/zip",
            },
            redirect: "follow",
          });

          if (!zipResponse.ok) {
            throw new Error(
              `Failed to download linked golden repo archive (${zipResponse.status}).`,
            );
          }

          const zipBuffer = Buffer.from(await zipResponse.arrayBuffer());
          const AdmZip = (await import("adm-zip")).default;
          const downloadedZip = new AdmZip(zipBuffer);
          const entries = downloadedZip.getEntries();

          const fileEntries = entries.filter((entry) => !entry.isDirectory);
          const firstSegments = new Set(
            fileEntries
              .map((entry) => entry.entryName.replace(/^\/+/, "").split("/")[0])
              .filter(Boolean),
          );
          const stripCommonRoot = firstSegments.size === 1;

          const repoRootName = String(
            goldenRepoReference?.repoName || repoData?.name || "golden-repo",
          )
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "golden-repo";

          for (const entry of fileEntries) {
            const normalizedEntryPath = entry.entryName.replace(/^\/+/, "");
            const relativePath = stripCommonRoot
              ? normalizedEntryPath.split("/").slice(1).join("/")
              : normalizedEntryPath;
            const finalRelativePath = relativePath || path.basename(normalizedEntryPath);
            archive.append(entry.getData(), {
              name: `golden-repo/${repoRootName}/${finalRelativePath}`,
            });
          }
        }

        await archive.finalize();
      } catch (error: any) {
        console.error("[Specs Bundle] Failed to create bundle:", error);
        if (!res.headersSent) {
          return res
            .status(500)
            .json({ error: error?.message || "Failed to build download bundle." });
        }
        res.end();
      }
    },
  );

  /**
   * AI-enhance an existing specs.md or requirements.md file for a project.
   * Returns enhanced markdown; caller is responsible for applying/saving.
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/enhance",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { content, fileType } = req.body as {
          content?: string;
          fileType?: "specs" | "requirements" | string;
        };

        if (!projectId) {
          return res
            .status(400)
            .json({ error: "projectId is required in route params" });
        }

        if (!content || typeof content !== "string" || content.trim().length < 10) {
          return res.status(400).json({
            error:
              "Valid markdown content is required for enhancement (minimum length 10).",
          });
        }

        const normalizedType =
          typeof fileType === "string"
            ? fileType.toLowerCase()
            : "specs";

        const isRequirements = normalizedType === "requirements";

        const { llm, llmConfig } = await import("../llm-config");

        const systemPromptLines: string[] = [];
        if (isRequirements) {
          systemPromptLines.push(
            "You are an expert requirements engineer.",
            "You improve Markdown requirements quality checklists.",
            "You keep the checklist structure but improve clarity, testability, and consistency.",
            "Do not add implementation details; keep the tone concise and objective."
          );
        } else {
          systemPromptLines.push(
            "You are an expert product requirements and specification writer.",
            "You improve Markdown product specs to be clearer, more complete, and fully testable.",
            "Keep the existing headings and general layout.",
            "IMPORTANT: Preserve the metadata block at the top of the spec (# Feature:, Status:, Owner:, Last Updated:) exactly as-is — do not modify or remove it.",
            "Focus on tightening language, resolving vague statements, and making acceptance criteria explicit.",
            "Do not introduce technology-specific implementation details."
          );
        }

        const systemPrompt = systemPromptLines.join("\n");

        const userPrompt = [
          "Here is an existing Markdown document.",
          "Enhance it while preserving its structure and intent.",
          "",
          "Return ONLY the improved Markdown, no explanations.",
          "",
          "----- ORIGINAL MARKDOWN -----",
          content,
        ].join("\n");

        const response = await llm.azureOpenAI.chat.completions.create({
          model: process.env.BEDROCK_MODEL_ID || process.env.AZURE_OPENAI_DEPLOYMENT || (llmConfig as any)?.azureOpenAIDeployment || "gpt-4-turbo",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.25,
          max_tokens: 6000,
        });

        const enhanced =
          response.choices?.[0]?.message?.content?.trim() || content;

        return res.json({
          projectId,
          fileType: isRequirements ? "requirements" : "specs",
          enhancedContent: enhanced,
        });
      } catch (error: any) {
        console.error("[SDLC Specs] Failed to enhance specs content:", error);
        const message =
          error?.message || "Failed to enhance specs or requirements content.";
        return res.status(500).json({ error: message });
      }
    }
  );

  /**
   * Validate a feature selection before generation.
   * Checks for: empty selection, concurrent lock, 0-story features, duplicates,
   * missing dependencies (auto-expanded), and idempotent features.
   * POST /api/sdlc/projects/:projectId/specs/validate-selection
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/validate-selection",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        const { features } = req.body as {
          features?: Array<{
            id: number;
            title: string;
            description?: string;
            userStories?: Array<{
              id: number;
              title: string;
              acceptanceCriteria?: string;
            }>;
          }>;
        };

        if (!projectId) return res.status(400).json({ error: "projectId is required" });
        if (!Array.isArray(features) || features.length === 0) {
          return res.json({
            valid: false,
            errors: [{ type: "empty_selection", message: "No features selected. Please select at least one feature." }],
            warnings: [],
            idempotentFeatures: [],
            autoAdded: [],
          });
        }

        type ValidationIssue = { featureId?: number; featureTitle?: string; type: string; message: string };
        const errors: ValidationIssue[] = [];
        const warnings: ValidationIssue[] = [];
        const autoAdded: { id: number; title: string; reason: string }[] = [];

        // 1. Concurrent lock check
        const [projectRow] = await db
          .select({ isGenerating: schema.sdlcProjects.isGenerating })
          .from(schema.sdlcProjects)
          .where(eq(schema.sdlcProjects.id, projectId))
          .limit(1);
        if (projectRow?.isGenerating) {
          errors.push({ type: "already_generating", message: "A generation is already in progress for this project." });
          return res.json({ valid: false, errors, warnings, idempotentFeatures: [], autoAdded });
        }

        // 2. Duplicate feature IDs
        const seenIds = new Set<number>();
        for (const f of features) {
          if (seenIds.has(f.id)) {
            errors.push({ featureId: f.id, featureTitle: f.title, type: "duplicate", message: `Feature "${f.title}" appears more than once in the selection.` });
          }
          seenIds.add(f.id);
        }

        // 3. Features with 0 user stories
        for (const f of features) {
          if (!f.userStories || f.userStories.length === 0) {
            warnings.push({ featureId: f.id, featureTitle: f.title, type: "no_stories", message: `"${f.title}" has no user stories — the generated spec may be generic.` });
          }
        }

        // 4. Auto-expand missing dependencies (LLM-based)
        // Fetch all known features for this project from existing specs
        const allKnownSpecsRows = await db
          .select({ featureId: schema.sdlcSpecsFiles.featureId, featureTitle: schema.sdlcSpecsFiles.featureTitle })
          .from(schema.sdlcSpecsFiles)
          .where(and(
            eq(schema.sdlcSpecsFiles.projectId, projectId),
            eq(schema.sdlcSpecsFiles.fileType, "specs"),
          ));

        // Build a map of id → title for all known features NOT already selected
        const selectedIds = new Set<number>(features.map((f) => f.id));
        const candidateFeatures = new Map<number, string>(); // featureId → title
        for (const row of allKnownSpecsRows) {
          if (!selectedIds.has(row.featureId)) {
            candidateFeatures.set(row.featureId, row.featureTitle);
          }
        }

        const autoAddedIds = new Set<number>();
        const autoAddedFeatures: Array<{ id: number; title: string; description?: string; userStories?: any[] }> = [];

        if (candidateFeatures.size > 0) {
          const { callLlm } = await import("../services/specs-generator/llm-caller");

          // Pre-fetch already-generated spec content for all selected features
          // so the LLM can see the richer dependency context in the spec output
          const selectedFeatureIds = features.map((f) => f.id);
          const existingSpecsContent = await db
            .select({ featureId: schema.sdlcSpecsFiles.featureId, content: schema.sdlcSpecsFiles.content })
            .from(schema.sdlcSpecsFiles)
            .where(and(
              eq(schema.sdlcSpecsFiles.projectId, projectId),
              eq(schema.sdlcSpecsFiles.fileType, "specs"),
              inArray(schema.sdlcSpecsFiles.featureId, selectedFeatureIds),
            ));
          const specContentByFeatureId = new Map<number, string>();
          for (const row of existingSpecsContent) {
            specContentByFeatureId.set(row.featureId, row.content);
          }

          // BFS: start with selected features, expand transitively
          const queue = [...features];
          const visitedForExpansion = new Set<number>(features.map((f) => f.id));

          while (queue.length > 0) {
            const current = queue.shift()!;

            const generatedSpecContent = specContentByFeatureId.get(current.id);
            const featureContext = [
              `Feature: ${current.title}`,
              current.description ? `Description: ${current.description}` : "",
              (current.userStories ?? []).length > 0
                ? `User Stories:\n${(current.userStories ?? []).map((s) =>
                    `  - ${s.title}${s.acceptanceCriteria ? `\n    AC: ${s.acceptanceCriteria}` : ""}`
                  ).join("\n")}`
                : "",
              generatedSpecContent
                ? `\nAlready-Generated Spec (excerpt):\n${generatedSpecContent.slice(0, 3000)}`
                : "",
            ].filter(Boolean).join("\n");

            const candidateList = [...candidateFeatures.entries()]
              .filter(([id]) => !autoAddedIds.has(id))
              .map(([id, title]) => `  - id:${id} | ${title}`)
              .join("\n");

            if (!candidateList) break; // all candidates already added

            const systemPrompt = `You are a software architect analyzing feature dependencies in a software project.
Given a feature's description and user stories, identify which OTHER features from the candidate list are explicitly required or referenced.

Rules:
- Only include features that are explicitly mentioned, directly depended upon, or required for this feature to work
- Do NOT include features that are merely similar or tangentially related
- Return ONLY a JSON array of feature IDs (numbers), e.g. [12, 47] or [] if none
- Return [] if uncertain`;

            const userPrompt = `${featureContext}

Candidate features that may be dependencies (not yet selected):
${candidateList}

Which of the above candidate features does "${current.title}" explicitly depend on or reference? Return a JSON array of IDs only.`;

            let referencedIds: number[] = [];
            try {
              const llmResponse = await callLlm({ systemPrompt, userPrompt, temperature: 0, maxTokens: 200 });
              const match = llmResponse.match(/\[[\d,\s]*\]/);
              if (match) {
                referencedIds = JSON.parse(match[0]).filter((id: any) => typeof id === "number");
              }
            } catch (llmErr) {
              console.error(`[SDLC Specs] LLM dependency detection failed for "${current.title}":`, llmErr);
            }

            for (const depId of referencedIds) {
              if (autoAddedIds.has(depId) || selectedIds.has(depId)) continue;
              const depTitle = candidateFeatures.get(depId);
              if (!depTitle) continue;

              // Fetch full feature data from DB (include content for transitive dep scanning)
              const [depSpecRow] = await db
                .select({
                  featureId: schema.sdlcSpecsFiles.featureId,
                  featureTitle: schema.sdlcSpecsFiles.featureTitle,
                  userStoriesJson: schema.sdlcSpecsFiles.userStoriesJson,
                  content: schema.sdlcSpecsFiles.content,
                })
                .from(schema.sdlcSpecsFiles)
                .where(and(
                  eq(schema.sdlcSpecsFiles.projectId, projectId),
                  eq(schema.sdlcSpecsFiles.featureId, depId),
                  eq(schema.sdlcSpecsFiles.fileType, "specs"),
                ))
                .limit(1);

              if (depSpecRow) {
                const depFeature = {
                  id: depSpecRow.featureId,
                  title: depSpecRow.featureTitle,
                  userStories: (depSpecRow.userStoriesJson as any[]) ?? [],
                };
                autoAdded.push({ id: depFeature.id, title: depFeature.title, reason: `Required by "${current.title}"` });
                autoAddedIds.add(depFeature.id);
                selectedIds.add(depFeature.id);
                candidateFeatures.delete(depId); // no longer a candidate
                autoAddedFeatures.push(depFeature);

                // Cache the spec content for this auto-added feature so transitive
                // expansion also benefits from the richer generated spec context
                if (depSpecRow.content) {
                  specContentByFeatureId.set(depFeature.id, depSpecRow.content);
                }

                // Only enqueue for transitive expansion if not already visited
                if (!visitedForExpansion.has(depFeature.id)) {
                  visitedForExpansion.add(depFeature.id);
                  queue.push(depFeature);
                }
              }
            }
          }
        }

        // 5. Idempotency preview — compute inputHash for all features (original + auto-added)
        const allFeatures = [...features, ...autoAddedFeatures];
        const idempotentFeatures: number[] = [];

        if (allFeatures.length > 0) {
          const existingRows = await db
            .select({ featureId: schema.sdlcSpecsFiles.featureId, inputHash: schema.sdlcSpecsFiles.inputHash })
            .from(schema.sdlcSpecsFiles)
            .where(and(
              eq(schema.sdlcSpecsFiles.projectId, projectId),
              eq(schema.sdlcSpecsFiles.fileType, "specs"),
              inArray(schema.sdlcSpecsFiles.featureId, allFeatures.map((f) => f.id)),
            ));

          const existingHashMap = new Map<number, string | null>();
          for (const row of existingRows) {
            existingHashMap.set(row.featureId, row.inputHash ?? null);
          }

          for (const f of allFeatures) {
            const inputHash = computeInputHash({
              id: f.id,
              title: f.title,
              userStories: (f.userStories ?? []).map((s: any) => ({
                id: s.id,
                title: s.title,
                acceptanceCriteria: s.acceptanceCriteria ?? s.ac ?? "",
              })),
            });
            const stored = existingHashMap.get(f.id);
            if (stored && stored !== "legacy" && stored === inputHash) {
              idempotentFeatures.push(f.id);
            }
          }
        }

        return res.json({
          valid: errors.length === 0,
          errors,
          warnings,
          idempotentFeatures,
          autoAdded,
        });
      } catch (error: any) {
        console.error("[SDLC Specs] Validation failed:", error);
        return res.status(500).json({ error: error?.message || "Validation failed." });
      }
    }
  );

  /**
   * Backfill input_hash for existing specs that predate the orchestrator.
   * Sets input_hash = 'legacy' so idempotency check skips them on next generation.
   * POST /api/sdlc/projects/:projectId/specs/backfill-registry
   */
  app.post(
    "/api/sdlc/projects/:projectId/specs/backfill-registry",
    async (req: Request, res: Response) => {
      try {
        const { projectId } = req.params;
        if (!projectId) return res.status(400).json({ error: "projectId is required" });

        const result = await db
          .update(schema.sdlcSpecsFiles)
          .set({ inputHash: "legacy" })
          .where(and(
            eq(schema.sdlcSpecsFiles.projectId, projectId),
            eq(schema.sdlcSpecsFiles.fileType, "specs"),
            isNull(schema.sdlcSpecsFiles.inputHash),
          ));

        return res.json({ success: true, updatedCount: (result as any)?.[0]?.affectedRows ?? 0 });
      } catch (error: any) {
        console.error("[SDLC Specs] Backfill registry failed:", error);
        return res.status(500).json({ error: error?.message || "Backfill failed." });
      }
    }
  );
}
