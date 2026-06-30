/**
 * SDLC routes for Bitbucket Cloud Pipelines (mirrors GitLab routes under project-git-config).
 */

import type { Express, Request, Response } from "express";
import { eq, or } from "drizzle-orm";
import { developmentRepositories, goldenRepositories, sdlcProjects } from "@shared/schema";
import { db } from "../db";
import { resolveProjectIntegrationCategory } from "../services/project-integration-resolver";
import {
  BitbucketCiService,
  bitbucketNumericId,
  listBitbucketWorkspaceRepositories,
  mapBitbucketPipelineStatus,
  type BitbucketPipelineRun,
} from "../services/bitbucket-ci-service";

type BitbucketPipelineSteps = Awaited<ReturnType<BitbucketCiService["listPipelineSteps"]>>;

export interface BitbucketSdlcContext {
  workspace: string;
  repositorySlug: string;
  username: string;
  appPassword: string;
}

const BITBUCKET_CONTEXT_ERROR =
  "Bitbucket is not fully configured for this project (workspace, credentials, and repository slug). In Edit project → tool configuration, set Bitbucket for Repository and Bitbucket Pipelines for CI/CD, and ensure a repository is identifiable (golden repository from project setup, repository URL/name on the golden repo, or repository slug in the Bitbucket tool fields).";

function withBitbucketAuthHint(message: string): string {
  const msg = String(message || "");
  if (msg.includes("Bitbucket API 401") || msg.includes("Bitbucket repo discovery 401")) {
    return `${msg} Check credentials: use Bitbucket username (handle), not email, plus valid app password and workspace.`;
  }
  if (msg.includes("Bitbucket API 403") || msg.includes("Bitbucket repo discovery 403")) {
    return `${msg} App password is missing required scopes (repository read, pipeline read/write).`;
  }
  return msg;
}

function normalizeRepositorySlug(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^(https?:\/\/)?bitbucket\.org\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .slice(-1)[0];
}

function mergeBitbucketConfig(repoCfg: Record<string, string>, cicdCfg: Record<string, string>) {
  const workspace = String(cicdCfg.workspace || repoCfg.workspace || repoCfg.owner || "").trim();
  const username = String(cicdCfg.username || cicdCfg.userName || repoCfg.username || repoCfg.userName || "").trim();
  const appPassword = String(
    cicdCfg.appPassword ||
      cicdCfg.patToken ||
      cicdCfg.apiToken ||
      repoCfg.appPassword ||
      repoCfg.patToken ||
      repoCfg.apiToken ||
      "",
  ).trim();
  const repositorySlug = normalizeRepositorySlug(
    String(
      repoCfg.repositorySlug ||
        repoCfg.repository ||
        repoCfg.repositoryName ||
        repoCfg.repoSlug ||
        repoCfg.repo ||
        repoCfg.repositoryUrl ||
        cicdCfg.repositorySlug ||
        cicdCfg.repository ||
        cicdCfg.repositoryName ||
        cicdCfg.repoSlug ||
        cicdCfg.repo ||
        cicdCfg.repositoryUrl ||
        "",
    ),
  );
  return { workspace, username, appPassword, repositorySlug };
}

/**
 * When tool config omits repository slug, infer it from project setup:
 * golden repo reference, linked golden repo name, golden_repositories (repository_id from create flow),
 * then development_repositories, then SDLC project name if it looks like a repo slug.
 */
async function resolveBitbucketRepositorySlugFromDb(projectId: string): Promise<string> {
  const slugFrom = (name?: string | null, url?: string | null) =>
    normalizeRepositorySlug(String(name || url || "").trim());

  const [project] = await db
    .select({
      id: sdlcProjects.id,
      repository_id: sdlcProjects.repository_id,
      linkedGoldenRepoName: sdlcProjects.linkedGoldenRepoName,
      linkedGoldenRepoProject: sdlcProjects.linkedGoldenRepoProject,
      goldenRepoReference: sdlcProjects.goldenRepoReference,
      name: sdlcProjects.name,
      projectRef: sdlcProjects.projectId,
    })
    .from(sdlcProjects)
    .where(or(eq(sdlcProjects.id, projectId), eq(sdlcProjects.projectId, projectId)))
    .limit(1);
  if (!project?.id) return "";

  const ref = project.goldenRepoReference as { repoName?: string; repoId?: string } | null | undefined;
  if (ref?.repoName) {
    const s = slugFrom(ref.repoName, null);
    if (s) return s;
  }
  if (project.linkedGoldenRepoName) {
    const s = slugFrom(project.linkedGoldenRepoName, null);
    if (s) return s;
  }

  if (project.repository_id) {
    const [golden] = await db
      .select({
        name: goldenRepositories.name,
        repositoryUrl: goldenRepositories.repositoryUrl,
      })
      .from(goldenRepositories)
      .where(eq(goldenRepositories.id, project.repository_id))
      .limit(1);
    if (golden) {
      const s = slugFrom(golden.name, golden.repositoryUrl);
      if (s) return s;
    }

    const [dev] = await db
      .select({
        name: developmentRepositories.name,
        repositoryUrl: developmentRepositories.repositoryUrl,
      })
      .from(developmentRepositories)
      .where(eq(developmentRepositories.id, project.repository_id))
      .limit(1);
    if (dev) {
      const s = slugFrom(dev.name ?? undefined, dev.repositoryUrl ?? undefined);
      if (s) return s;
    }
  }

  const [linkedDev] = await db
    .select({
      name: developmentRepositories.name,
      repositoryUrl: developmentRepositories.repositoryUrl,
    })
    .from(developmentRepositories)
    .where(eq(developmentRepositories.projectId, project.id))
    .limit(1);
  if (linkedDev) {
    const s = slugFrom(linkedDev.name ?? undefined, linkedDev.repositoryUrl ?? undefined);
    if (s) return s;
  }

  const projectName = String(project.name || "").trim();
  if (projectName && /^[a-z0-9][a-z0-9._-]*$/i.test(projectName)) {
    const s = normalizeRepositorySlug(projectName);
    if (s) return s;
  }

  const projectRef = String(project.projectRef || "").trim();
  if (projectRef && /^[a-z0-9][a-z0-9._-]*$/i.test(projectRef)) {
    const s = normalizeRepositorySlug(projectRef);
    if (s) return s;
  }

  const linkedProject = String(project.linkedGoldenRepoProject || "").trim();
  if (linkedProject && /^[a-z0-9][a-z0-9._-]*$/i.test(linkedProject)) {
    const s = normalizeRepositorySlug(linkedProject);
    if (s) return s;
  }

  return "";
}

function normalizeCandidate(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^bitbucket\.org\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, "-");
}

async function canAccessBitbucketRepository(
  workspace: string,
  username: string,
  appPassword: string,
  repositorySlug: string,
): Promise<boolean> {
  if (!workspace || !username || !appPassword || !repositorySlug) return false;
  const res = await fetch(
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repositorySlug)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`,
        Accept: "application/json",
      },
    },
  );
  return res.ok;
}

async function discoverBitbucketRepositorySlug(
  workspace: string,
  username: string,
  appPassword: string,
  candidates: string[],
): Promise<string> {
  if (!workspace || !username || !appPassword) return "";
  const repos = await listBitbucketWorkspaceRepositories(username, appPassword, workspace, { pagelen: 100 }).catch(() => []);
  if (!repos.length) return "";
  if (repos.length === 1) return repos[0].slug;

  const wanted = new Set(
    candidates
      .map((c) => normalizeRepositorySlug(c))
      .filter(Boolean)
      .map((c) => normalizeCandidate(c)),
  );
  if (!wanted.size) return "";

  const exact = repos.find((r) => {
    const slug = normalizeCandidate(r.slug);
    const name = normalizeCandidate(r.name || "");
    const full = normalizeCandidate(r.full_name || "");
    return wanted.has(slug) || wanted.has(name) || wanted.has(full);
  });
  if (exact) return exact.slug;

  const fuzzy = repos.find((r) => {
    const slug = normalizeCandidate(r.slug);
    const name = normalizeCandidate(r.name || "");
    return Array.from(wanted).some((w) => slug.includes(w) || name.includes(w) || w.includes(slug));
  });
  return fuzzy?.slug || "";
}

function getRepositoryOverrideFromRequest(req?: Request): string {
  if (!req) return "";
  const fromQuery = typeof req.query?.repositorySlug === "string" ? req.query.repositorySlug : "";
  const fromBody =
    req.body && typeof req.body === "object" && typeof (req.body as Record<string, unknown>).repositorySlug === "string"
      ? String((req.body as Record<string, unknown>).repositorySlug)
      : "";
  return normalizeRepositorySlug(fromQuery || fromBody);
}

export async function getBitbucketContext(projectId: string, req?: Request): Promise<BitbucketSdlcContext | null> {
  const cicdIntegration = await resolveProjectIntegrationCategory(projectId, "cicd").catch(() => null);
  if (
    cicdIntegration?.status !== "configured" ||
    String(cicdIntegration.providerKey || "").toLowerCase() !== "bitbucket_pipelines"
  ) {
    return null;
  }

  const repoIntegration = await resolveProjectIntegrationCategory(projectId, "repo").catch(() => null);
  const repoCfg =
    repoIntegration?.status === "configured" && String(repoIntegration.providerKey || "").toLowerCase() === "bitbucket"
      ? repoIntegration.config || {}
      : {};
  const cicdCfg = cicdIntegration.config || {};

  const merged = mergeBitbucketConfig(repoCfg, cicdCfg);
  let repositorySlug = getRepositoryOverrideFromRequest(req) || merged.repositorySlug;
  const projectNameHint = typeof req?.query?.projectName === "string" ? req.query.projectName : "";
  const queryProjectIdHint = typeof req?.query?.projectId === "string" ? req.query.projectId : "";

  if (!repositorySlug) {
    repositorySlug = normalizeRepositorySlug(await resolveBitbucketRepositorySlugFromDb(projectId));
  }

  // If inferred slug is missing OR not accessible, attempt workspace discovery.
  if (
    !repositorySlug ||
    !(await canAccessBitbucketRepository(merged.workspace, merged.username, merged.appPassword, repositorySlug))
  ) {
    repositorySlug = normalizeRepositorySlug(
      await discoverBitbucketRepositorySlug(merged.workspace, merged.username, merged.appPassword, [
        repositorySlug,
        projectNameHint,
        queryProjectIdHint,
        String((repoCfg as Record<string, unknown>).repositoryName || ""),
        String((repoCfg as Record<string, unknown>).repository || ""),
        String((cicdCfg as Record<string, unknown>).repositoryName || ""),
        String((cicdCfg as Record<string, unknown>).repository || ""),
      ]),
    );
  }
  if (!merged.workspace || !merged.username || !merged.appPassword || !repositorySlug) {
    return null;
  }
  return { workspace: merged.workspace, username: merged.username, appPassword: merged.appPassword, repositorySlug };
}

type NormPipeline = { status: string; ref: string; created_at: string; updated_at: string };

function bbToNorm(p: BitbucketPipelineRun): NormPipeline {
  const status = mapBitbucketPipelineStatus(p);
  const ref = String(p.target?.ref_name || "").trim();
  const created_at = p.created_on || new Date(0).toISOString();
  const updated_at = p.completed_on || p.created_on || created_at;
  return { status, ref, created_at, updated_at };
}

function normPipelineTime(p: NormPipeline): Date {
  return new Date(p.updated_at || p.created_at || 0);
}

function normSuccess(p: NormPipeline) {
  return (p.status || "").toLowerCase() === "success";
}

function normFailed(p: NormPipeline) {
  const s = (p.status || "").toLowerCase();
  return s === "failed" || s === "canceled" || s === "cancelled";
}

function normInProgress(p: NormPipeline) {
  const s = (p.status || "").toLowerCase();
  return ["running", "pending"].includes(s);
}

function buildMonitoringFromNormPipelines(pipelines: NormPipeline[]) {
  const now = new Date();
  const last7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prev7Start = new Date(last7.getTime() - 7 * 24 * 60 * 60 * 1000);

  const inRange = (p: NormPipeline, from: Date) => {
    const t = normPipelineTime(p);
    return t >= from && t <= now;
  };

  const recent30 = pipelines.filter((p) => inRange(p, last30));
  const last7List = recent30.filter((p) => inRange(p, last7));
  const prev7List = recent30.filter((p) => {
    const t = normPipelineTime(p);
    return t >= prev7Start && t < last7;
  });

  const succeeded = recent30.filter(normSuccess).length;
  const failed = recent30.filter(normFailed).length;
  const inProgress = recent30.filter(normInProgress).length;
  const totalBuilds = recent30.length;
  const successRate = totalBuilds > 0 ? Math.round((succeeded / totalBuilds) * 100) : 0;

  const last7Rate =
    last7List.length > 0 ? Math.round((last7List.filter(normSuccess).length / last7List.length) * 100) : 0;
  const prev7Rate =
    prev7List.length > 0 ? Math.round((prev7List.filter(normSuccess).length / prev7List.length) * 100) : 0;
  const buildTrend = last7Rate - prev7Rate;

  const distinctRefs = new Set(recent30.map((p) => (p.ref || "").trim()).filter(Boolean));
  const cores = totalBuilds > 0 ? Math.min(12, Math.max(1, distinctRefs.size || 1)) : 0;

  let systemStatus = "Healthy";
  if (successRate < 70 && totalBuilds > 0) systemStatus = "Warning";
  if (successRate < 50 && totalBuilds > 0) systemStatus = "Critical";

  const totalTests = totalBuilds;
  const passRate = successRate;

  return {
    systemStatus,
    services: {
      running: inProgress,
      total: Math.max(totalBuilds, inProgress),
    },
    cpu: {
      usage: successRate,
      trend: buildTrend,
      cores,
    },
    memory: {
      usage: passRate,
      trend: passRate - 85,
      total: totalTests,
      used: succeeded,
      free: failed,
    },
    builds: {
      total: totalBuilds,
      succeeded,
      failed,
      inProgress,
      successRate,
    },
    tests: {
      total: totalTests,
      passed: succeeded,
      failed,
      passRate,
    },
    agents: {
      total: 0,
      online: 0,
      offline: 0,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildSystemStatusFromNormPipelines(pipelines: NormPipeline[]) {
  const now = new Date();
  const last7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prev7Start = new Date(last7.getTime() - 7 * 24 * 60 * 60 * 1000);

  const inRange = (p: NormPipeline, from: Date) => {
    const t = normPipelineTime(p);
    return t >= from && t <= now;
  };

  const recent30 = pipelines.filter((p) => inRange(p, last30));
  const last7List = recent30.filter((p) => inRange(p, last7));
  const prev7List = recent30.filter((p) => {
    const t = normPipelineTime(p);
    return t >= prev7Start && t < last7;
  });

  const buildSuccessRate =
    last7List.length > 0
      ? (last7List.filter(normSuccess).length / last7List.length) * 100
      : recent30.length === 0
        ? 100
        : (recent30.filter(normSuccess).length / recent30.length) * 100;

  const last7Success = last7List.filter(normSuccess).length;
  const last7Failed = last7List.filter(normFailed).length;
  const prev7Rate =
    prev7List.length > 0
      ? (prev7List.filter(normSuccess).length / prev7List.length) * 100
      : buildSuccessRate;

  let trend: "improving" | "stable" | "degrading" = "stable";
  if (buildSuccessRate > prev7Rate + 5) trend = "improving";
  else if (buildSuccessRate < prev7Rate - 5) trend = "degrading";

  const overallHealth = buildSuccessRate;
  let healthStatus: "healthy" | "warning" | "critical" = "healthy";
  if (overallHealth < 50 && recent30.length > 0) healthStatus = "critical";
  else if (overallHealth < 80 && recent30.length > 0) healthStatus = "warning";

  const failedRecent = recent30.filter(
    (p) => normFailed(p) && inRange(p, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
  );

  return {
    overallHealth: {
      status: healthStatus,
      percentage: overallHealth,
      buildSuccessRate,
      releaseSuccessRate: buildSuccessRate,
    },
    deploymentStability: {
      last7Days: {
        total: last7List.length,
        succeeded: last7Success,
        failed: last7Failed,
        successRate: last7List.length > 0 ? (last7Success / last7List.length) * 100 : 0,
      },
      last30Days: {
        total: recent30.length,
        successRate:
          recent30.length > 0 ? (recent30.filter(normSuccess).length / recent30.length) * 100 : 0,
      },
      trend,
    },
    alerts: {
      active: failedRecent.length,
      resolved: last7List.filter(normSuccess).length,
      pendingApprovals: 0,
    },
    bugs: {
      open: 0,
      closed: 0,
      total: 0,
      criticalOpen: 0,
    },
    performanceIndicators: {
      buildSuccessRate,
      averageBuildDuration: 0,
      testPassRate: buildSuccessRate,
      agentAvailability: 0,
    },
    systemStatus: {
      isOperatingNormally: overallHealth >= 80 || recent30.length === 0,
      hasCriticalIssues: healthStatus === "critical",
      recentChangesInstability: trend === "degrading" && last7Failed > 0,
    },
  };
}

function mapStepStatus(step: { state?: { name?: string; result?: { name?: string } } }): string {
  const n = (step.state?.name || "").toUpperCase();
  const r = (step.state?.result?.name || "").toUpperCase();
  if (n === "COMPLETED" && r === "SUCCESSFUL") return "success";
  if (n === "COMPLETED" && (r === "FAILED" || r === "ERROR")) return "failed";
  if (n === "IN_PROGRESS" || n === "PENDING") return "running";
  return (step.state?.name || "unknown").toLowerCase();
}

type BitbucketDeploymentEntry = {
  id: string;
  releaseId: number;
  releaseName: string;
  environmentId: string;
  environmentName: string;
  deploymentStatus: string;
  startedOn?: string;
  completedOn?: string;
};

const DEPLOYMENT_HINT_RE = /\b(deploy(ment)?|release|promot(e|ion)|rollout|ship)\b/i;
const ENVIRONMENT_HINT_RE = /\b(prod(uction)?|staging|stage|qa|uat|test|dev(elopment)?)\b/i;

function looksLikeDeploymentStep(step: { name?: string } & Record<string, unknown>): boolean {
  const name = String(step.name || "").toLowerCase();
  const deployment = (step as Record<string, unknown>).deployment;
  return !!deployment || DEPLOYMENT_HINT_RE.test(name) || ENVIRONMENT_HINT_RE.test(name);
}

function extractDeploymentName(step: Record<string, unknown>): string {
  const deployment = step.deployment;
  if (typeof deployment === "string" && deployment.trim()) return deployment.trim();
  if (deployment && typeof deployment === "object") {
    const depObj = deployment as Record<string, unknown>;
    const candidate = depObj.name ?? depObj.environment ?? depObj.slug ?? depObj.uuid;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const stepName = String(step.name || "").trim();
  const envMatch = stepName.match(ENVIRONMENT_HINT_RE);
  if (envMatch?.[0]) return envMatch[0].toLowerCase();
  return "default";
}

async function listBitbucketDeploymentEntries(bb: BitbucketCiService): Promise<BitbucketDeploymentEntry[]> {
  const pipelines = await bb.listPipelines(50);
  const deploymentRows = await Promise.all(
    pipelines.map(async (pl) => {
      try {
        const steps = await bb.listPipelineSteps(pl.uuid);
        const pipelineId = bitbucketNumericId(pl);
        const releaseName = String(pl.target?.ref_name || "").trim() || `Pipeline #${pipelineId}`;
        return steps
          .filter((rawStep) => looksLikeDeploymentStep(rawStep as Record<string, unknown>))
          .map((rawStep, idx) => {
            const step = rawStep as Record<string, unknown>;
            const envName = extractDeploymentName(step);
            const status = mapStepStatus(rawStep);
            const stepId = typeof rawStep.uuid === "string" && rawStep.uuid.trim() ? rawStep.uuid : `${pl.uuid}-${idx}`;
            return {
              id: String(stepId),
              releaseId: pipelineId,
              releaseName,
              environmentId: envName.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-"),
              environmentName: envName,
              deploymentStatus: status,
              startedOn: rawStep.started_on || pl.created_on,
              completedOn: rawStep.completed_on || pl.completed_on || undefined,
            } satisfies BitbucketDeploymentEntry;
          });
      } catch {
        return [] as BitbucketDeploymentEntry[];
      }
    }),
  );
  return deploymentRows.flat();
}

export function registerBitbucketSdlcRoutes(app: Express): void {
  app.get("/api/sdlc/projects/:projectId/bitbucket/repositories", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const projectKey = typeof req.query.projectKey === "string" ? req.query.projectKey.trim() : "";
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const pagelenRaw = typeof req.query.pagelen === "string" ? Number(req.query.pagelen) : 100;
      const pagelen = Number.isFinite(pagelenRaw) ? pagelenRaw : 100;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const repos = await listBitbucketWorkspaceRepositories(ctx.username, ctx.appPassword, ctx.workspace, {
        pagelen,
        projectKey,
        search,
      });
      return res.json({
        value: repos.map((r) => ({
          slug: r.slug,
          name: r.name || r.slug,
          full_name: r.full_name || `${ctx.workspace}/${r.slug}`,
          projectKey: r.projectKey || "",
          projectName: r.projectName || "",
        })),
      });
    } catch (e) {
      const msg = withBitbucketAuthHint(e instanceof Error ? e.message : "Failed to list Bitbucket repositories");
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/context-status", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        const repoIntegration = await resolveProjectIntegrationCategory(projectId, "repo").catch(() => null);
        const cicdIntegration = await resolveProjectIntegrationCategory(projectId, "cicd").catch(() => null);
        const repoCfg =
          repoIntegration?.status === "configured" &&
          String(repoIntegration.providerKey || "").toLowerCase() === "bitbucket"
            ? repoIntegration.config || {}
            : {};
        const cicdCfg =
          cicdIntegration?.status === "configured" &&
          String(cicdIntegration.providerKey || "").toLowerCase() === "bitbucket_pipelines"
            ? cicdIntegration.config || {}
            : {};
        const merged = mergeBitbucketConfig(repoCfg, cicdCfg);
        const dbSlug = normalizeRepositorySlug(await resolveBitbucketRepositorySlugFromDb(projectId));
        const hasCreds = !!(merged.workspace && merged.username && merged.appPassword);
        const hint = !hasCreds
          ? "Open Edit project → tool configuration and set Bitbucket for Repository and Bitbucket Pipelines for CI/CD with workspace, username, and app password."
          : !merged.repositorySlug && !dbSlug
            ? "Credentials are saved but no repository slug was inferred. Pick a golden repository when creating the project, or add the Bitbucket repo slug in the project’s Bitbucket tool fields. Ensure the golden repo’s name or repository URL matches your Bitbucket repo."
            : "Bitbucket context is incomplete. Verify app password scopes (repository read, pipelines read/write) and that the workspace and repository slug match Bitbucket.";
        return res.json({ hasConfig: false, hint });
      }
      return res.json({
        hasConfig: true,
        workspace: ctx.workspace,
        repositorySlug: ctx.repositorySlug,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to resolve Bitbucket context";
      return res.status(500).json({ error: msg, hasConfig: false });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/builds", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const pipelines = await bb.listPipelines(20);
      const pipelineWindow = pipelines.slice(0, 20);
      const stepRows = await Promise.all(
        pipelineWindow.map(async (pl) => {
          try {
            const steps = await bb.listPipelineSteps(pl.uuid);
            return [pl.uuid, steps] as [string, BitbucketPipelineSteps];
          } catch {
            return [pl.uuid, [] as BitbucketPipelineSteps] as [string, BitbucketPipelineSteps];
          }
        }),
      );
      const stepsByUuid = new Map<string, BitbucketPipelineSteps>(stepRows);
      const runs = pipelineWindow.map((pl) => {
        const steps = (stepsByUuid.get(pl.uuid) || []).map((step, idx: number) => ({
          id: String(step.uuid || `${pl.uuid}-${idx}`),
          name: String(step.name || `Step ${idx + 1}`),
          status: mapStepStatus(step),
          result: mapStepStatus(step),
          stageName: "default",
          stageId: "default",
          startTime: step.started_on || undefined,
          finishTime: step.completed_on || undefined,
          duration:
            step.started_on && step.completed_on
              ? Math.max(0, new Date(step.completed_on).getTime() - new Date(step.started_on).getTime())
              : undefined,
          logUrl: step.links?.html?.href || undefined,
        }));
        const nid = bitbucketNumericId(pl);
        const refName = String(pl.target?.ref_name || "").trim();
        const pattern = String(pl.target?.selector?.pattern || "").trim();
        const defName = pattern ? `Bitbucket ${pattern}` : refName ? `Bitbucket ${refName}` : `Pipeline #${nid}`;
        return {
          id: nid,
          buildNumber: `#${nid}`,
          status: mapBitbucketPipelineStatus(pl),
          result: mapBitbucketPipelineStatus(pl),
          queueTime: pl.created_on,
          startTime: pl.created_on,
          finishTime: pl.completed_on || pl.created_on,
          sourceBranch: refName ? `refs/heads/${refName}` : undefined,
          definition: {
            id: nid,
            name: defName,
          },
          jobs: steps,
          webUrl: pl.links?.html?.href,
        };
      });
      return res.json({ value: runs });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket builds";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/build-publish-summary", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const pipelines = await bb.listPipelines(50);
      const completed = pipelines.filter((p) => {
        const s = (p.state?.name || "").toUpperCase();
        return s === "COMPLETED" || s === "ERROR";
      });
      const succeeded = completed.filter((p) => (p.state?.result?.name || "").toUpperCase() === "SUCCESSFUL");
      const failed = completed.filter((p) => {
        const r = (p.state?.result?.name || "").toUpperCase();
        return r === "FAILED" || r === "ERROR";
      });
      const successRatePercent =
        completed.length > 0 ? Math.round((succeeded.length / completed.length) * 100) : 0;
      return res.json({
        publishedArtifacts: 0,
        buildsCheckedForArtifacts: completed.length,
        buildsWithArtifacts: 0,
        completedBuilds: completed.length,
        succeededBuilds: succeeded.length,
        failedBuilds: failed.length,
        successRatePercent,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket summary";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/branches", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const branches = await bb.listBranches();
      return res.json(branches);
    } catch (e) {
      const msg = withBitbucketAuthHint(e instanceof Error ? e.message : "Failed to fetch Bitbucket branches");
      console.error("[bitbucket-sdlc-routes] branches:", msg);
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/ci-file", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
      const file =
        typeof req.query.file === "string" && req.query.file.trim()
          ? req.query.file.trim()
          : "bitbucket-pipelines.yml";
      if (!ref) {
        return res.status(400).json({ error: "ref query parameter is required" });
      }
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const content = await bb.tryGetFileContent(ref, file);
      if (content === null) {
        return res.json({ content: "", missing: true, file, ref });
      }
      return res.json({ content, missing: false, file, ref });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to read CI file";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/ci-yaml-files", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
      if (!ref) {
        return res.status(400).json({ error: "ref query parameter is required" });
      }
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const nodes = await bb.listRootSrcNodes(ref);
      const names = new Set<string>(["bitbucket-pipelines.yml"]);
      for (const node of nodes) {
        if (node.type !== "commit_file") continue;
        const lower = node.path.toLowerCase();
        if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
          names.add(node.path);
        }
      }
      return res.json({ value: Array.from(names).sort() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to list CI YAML files";
      return res.status(500).json({ error: msg });
    }
  });

  app.post("/api/sdlc/projects/:projectId/bitbucket/ci/lint", async (_req: Request, res: Response) => {
    return res.json({
      valid: true,
      status: "skipped",
      errors: [],
      warnings: [
        {
          message:
            "Bitbucket Cloud does not expose a server-side YAML lint API in this integration. Validate in the Bitbucket UI or locally.",
        },
      ],
    });
  });

  app.post("/api/sdlc/projects/:projectId/bitbucket/ci-yaml", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { branchName, filePath, content, commitMessage, triggerPipeline, pipelineName } = (req.body || {}) as {
        branchName?: string;
        filePath?: string;
        content?: string;
        commitMessage?: string;
        triggerPipeline?: boolean;
        pipelineName?: string;
      };
      if (!branchName?.trim()) {
        return res.status(400).json({ error: "branchName is required" });
      }
      const path = (filePath || "bitbucket-pipelines.yml").trim().replace(/^\/+/, "");
      if (typeof content !== "string") {
        return res.status(400).json({ error: "content must be a string" });
      }
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const cleanPipelineName = typeof pipelineName === "string" ? pipelineName.trim() : "";
      const msg = commitMessage?.trim() || `Update ${path} via DevX Pipeline Studio`;
      await bb.commitFileToBranch(branchName.trim(), path, content, msg);
      let pipeline: BitbucketPipelineRun | null = null;
      if (triggerPipeline) {
        pipeline = await bb.triggerPipeline(branchName.trim(), cleanPipelineName || null);
      }
      const webUrl = pipeline?.links?.html?.href || "";
      const nid = pipeline ? bitbucketNumericId(pipeline) : 0;
      return res.json({
        ok: true,
        filePath: path,
        branch: branchName.trim(),
        logicalPipelineName: cleanPipelineName || undefined,
        pipeline: pipeline
          ? {
              id: nid,
              web_url: webUrl,
              status: mapBitbucketPipelineStatus(pipeline),
            }
          : null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save CI YAML";
      console.error("[bitbucket-sdlc-routes] ci-yaml:", e);
      return res.status(500).json({ error: msg });
    }
  });

  app.post("/api/sdlc/projects/:projectId/bitbucket/queue-build", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { branchName, pipelineRunId, customPipelineName, pipelineName } = (req.body || {}) as {
        branchName?: string;
        pipelineRunId?: number;
        customPipelineName?: string;
        pipelineName?: string;
      };
      if (!branchName?.trim()) {
        return res.status(400).json({ error: "branchName is required" });
      }
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const ref = branchName.trim();
      const custom =
        String(customPipelineName || pipelineName || "")
          .trim()
          .replace(/\s+/g, " ") || "";

      let referencePipelineRunId: number | undefined;
      if (pipelineRunId != null && Number.isFinite(pipelineRunId) && pipelineRunId > 0) {
        const pipelines = await bb.listPipelines(50);
        const match = pipelines.find((p) => bitbucketNumericId(p) === Math.floor(pipelineRunId));
        if (!match) {
          return res.status(400).json({ error: `No pipeline run found matching build #${pipelineRunId}.` });
        }
        const existingRef = String(match.target?.ref_name || "").trim();
        if (existingRef !== ref) {
          return res.status(400).json({
            error: `Pipeline #${pipelineRunId} ran on "${existingRef}", not "${ref}". Choose a run for this branch or start a new run.`,
          });
        }
        referencePipelineRunId = bitbucketNumericId(match);
      }

      const triggered = await bb.triggerPipeline(ref, custom || null);
      const nid = bitbucketNumericId(triggered);
      const webUrl = triggered.links?.html?.href || "";
      return res.json({
        id: nid,
        buildNumber: nid,
        status: mapBitbucketPipelineStatus(triggered),
        ref: triggered.target?.ref_name,
        logicalPipelineName: custom || undefined,
        referencePipelineRunId,
        _links: webUrl ? { web: { href: webUrl } } : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to queue Bitbucket pipeline";
      console.error("[bitbucket-sdlc-routes] queue-build:", e);
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/pipelines", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const pipelines = await bb.listPipelines(50);
      type Entry = {
        id: number;
        name: string;
        path: string;
        url?: string;
        entryKind: "run" | "placeholder";
      };
      let data: Entry[] = pipelines.map((p) => {
        const nid = bitbucketNumericId(p);
        const ref = String(p.target?.ref_name || "").trim();
        const pattern = String(p.target?.selector?.pattern || "").trim();
        return {
          id: nid,
          name: pattern ? `Pipeline ${pattern} (#${nid})` : `Pipeline #${nid}`,
          path: ref,
          url: p.links?.html?.href,
          entryKind: "run" as const,
        };
      });
      if (data.length === 0) {
        data = [
          {
            id: -1,
            name: `${ctx.repositorySlug} — new pipeline (no prior runs yet)`,
            path: "main",
            url: `https://bitbucket.org/${ctx.workspace}/${ctx.repositorySlug}/pipelines`,
            entryKind: "placeholder",
          },
        ];
      }
      return res.json({ value: data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket pipelines";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/deployments", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const value = await listBitbucketDeploymentEntries(bb);
      return res.json({ value });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket deployments";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/deployment-summary", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const deployments = await listBitbucketDeploymentEntries(bb);
      const successfulReleases = deployments.filter((d) => d.deploymentStatus === "success").length;
      const failedReleases = deployments.filter((d) => d.deploymentStatus === "failed" || d.deploymentStatus === "canceled").length;
      const pendingReleases = deployments.filter((d) => d.deploymentStatus === "running" || d.deploymentStatus === "pending").length;
      return res.json({
        totalReleases: deployments.length,
        successfulReleases,
        failedReleases,
        pendingReleases,
        recentReleases: deployments.slice(0, 10),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket deployment summary";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/backlog-context", async (_req: Request, res: Response) => {
    return res.json({ stateCounts: {} });
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/test-runs", async (_req: Request, res: Response) => {
    return res.json({ value: [] });
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/releases", async (_req: Request, res: Response) => {
    return res.json({ value: [] });
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/release-artifacts", async (_req: Request, res: Response) => {
    return res.json({ value: [] });
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/monitoring", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const pipelines = await bb.listPipelines(50);
      const norm = pipelines.map(bbToNorm);
      return res.json(buildMonitoringFromNormPipelines(norm));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket monitoring";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/maintenance/system-status", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const pipelines = await bb.listPipelines(50);
      const norm = pipelines.map(bbToNorm);
      return res.json(buildSystemStatusFromNormPipelines(norm));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket system status";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/maintenance/pipeline-health", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const pipelines = await bb.listPipelines(50);
      const norm = pipelines.map(bbToNorm);
      const completed = norm.filter((p) => !normInProgress(p));
      const succeeded = completed.filter(normSuccess).length;
      const failed = completed.filter(normFailed).length;
      const successRate = completed.length > 0 ? (succeeded / completed.length) * 100 : 0;
      return res.json({
        successRate,
        totalRuns: pipelines.length,
        failedRuns: failed,
        succeededRuns: succeeded,
        stabilityRating: successRate >= 90 ? "excellent" : successRate >= 75 ? "good" : successRate >= 50 ? "fair" : "poor",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket pipeline health";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/maintenance/deployment-trends", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const ctx = await getBitbucketContext(projectId, req);
      if (!ctx) {
        return res.status(400).json({ error: BITBUCKET_CONTEXT_ERROR });
      }
      const bb = new BitbucketCiService(ctx);
      const deployments = await listBitbucketDeploymentEntries(bb);

      const now = Date.now();
      const msInDay = 24 * 60 * 60 * 1000;
      const isSuccess = (d: BitbucketDeploymentEntry) => d.deploymentStatus === "success";
      const isFailed = (d: BitbucketDeploymentEntry) => d.deploymentStatus === "failed" || d.deploymentStatus === "canceled";
      const isPending = (d: BitbucketDeploymentEntry) => d.deploymentStatus === "running" || d.deploymentStatus === "pending";
      const asTime = (value?: string) => (value ? new Date(value).getTime() : 0);

      const totalDeployments = deployments.length;
      const successfulDeployments = deployments.filter(isSuccess).length;
      const failedDeployments = deployments.filter(isFailed).length;
      const pendingDeployments = deployments.filter(isPending).length;
      const successRate = totalDeployments > 0 ? (successfulDeployments / totalDeployments) * 100 : 0;
      const failureRate = totalDeployments > 0 ? (failedDeployments / totalDeployments) * 100 : 0;

      const deploymentFrequency = {
        last7Days: deployments.filter((d) => now - asTime(d.startedOn || d.completedOn) <= 7 * msInDay).length,
        last30Days: deployments.filter((d) => now - asTime(d.startedOn || d.completedOn) <= 30 * msInDay).length,
        last90Days: deployments.filter((d) => now - asTime(d.startedOn || d.completedOn) <= 90 * msInDay).length,
        trend: "stable" as const,
      };

      const durations = deployments
        .map((d) => {
          const start = asTime(d.startedOn);
          const end = asTime(d.completedOn);
          if (!start || !end || end <= start) return 0;
          return (end - start) / (60 * 1000);
        })
        .filter((m) => m > 0);
      const averageDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

      const weekKey = (d: BitbucketDeploymentEntry) => {
        const t = asTime(d.startedOn || d.completedOn);
        const date = t ? new Date(t) : new Date();
        const day = date.getUTCDay();
        const diff = day === 0 ? -6 : 1 - day;
        date.setUTCDate(date.getUTCDate() + diff);
        date.setUTCHours(0, 0, 0, 0);
        return date.toISOString();
      };
      const weeklyMap = new Map<string, { total: number; successful: number; failed: number; durations: number[] }>();
      deployments.forEach((d) => {
        const key = weekKey(d);
        const existing = weeklyMap.get(key) || { total: 0, successful: 0, failed: 0, durations: [] };
        existing.total += 1;
        if (isSuccess(d)) existing.successful += 1;
        if (isFailed(d)) existing.failed += 1;
        const start = asTime(d.startedOn);
        const end = asTime(d.completedOn);
        if (start && end && end > start) existing.durations.push((end - start) / (60 * 1000));
        weeklyMap.set(key, existing);
      });
      const weeklyTrends = Array.from(weeklyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, values]) => ({
          week,
          total: values.total,
          successful: values.successful,
          failed: values.failed,
          successRate: values.total > 0 ? (values.successful / values.total) * 100 : 0,
        }));
      const durationWeeklyAverage = Array.from(weeklyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([week, values]) => ({
          week,
          averageDuration:
            values.durations.length > 0
              ? values.durations.reduce((a, b) => a + b, 0) / values.durations.length
              : 0,
        }));

      const envMap = new Map<string, { total: number; successful: number; failed: number; durations: number[] }>();
      deployments.forEach((d) => {
        const envName = d.environmentName || "default";
        const existing = envMap.get(envName) || { total: 0, successful: 0, failed: 0, durations: [] };
        existing.total += 1;
        if (isSuccess(d)) existing.successful += 1;
        if (isFailed(d)) existing.failed += 1;
        const start = asTime(d.startedOn);
        const end = asTime(d.completedOn);
        if (start && end && end > start) existing.durations.push((end - start) / (60 * 1000));
        envMap.set(envName, existing);
      });
      const environmentFailureRates = Array.from(envMap.entries()).map(([environment, values]) => {
        const avgDuration =
          values.durations.length > 0 ? values.durations.reduce((a, b) => a + b, 0) / values.durations.length : 0;
        const envSuccessRate = values.total > 0 ? (values.successful / values.total) * 100 : 0;
        const envFailureRate = values.total > 0 ? (values.failed / values.total) * 100 : 0;
        return {
          environment,
          totalDeployments: values.total,
          successful: values.successful,
          failed: values.failed,
          successRate: envSuccessRate,
          failureRate: envFailureRate,
          averageDuration: avgDuration,
        };
      });
      const envWithMostFailures =
        environmentFailureRates
          .slice()
          .sort((a, b) => b.failed - a.failed)
          .map((e) => e.environment)[0] || "N/A";

      return res.json({
        overallMetrics: {
          totalDeployments,
          successfulDeployments,
          failedDeployments,
          pendingDeployments,
          successRate,
          failureRate,
          averageDuration,
          totalRollbacks: 0,
          rollbackRate: 0,
        },
        deploymentFrequency,
        durationTrends: {
          averageDuration,
          trend: "stable",
          weeklyAverage: durationWeeklyAverage,
        },
        rollbackOccurrences: {
          total: 0,
          byEnvironment: [],
          recentRollbacks: [],
        },
        environmentFailureRates,
        weeklyTrends,
        insights: {
          deploymentsBecomingMoreDependable: successRate >= 70,
          deployingFrequentlyEnough: deploymentFrequency.last30Days > 0,
          environmentWithMostFailures: envWithMostFailures,
          productionStable:
            environmentFailureRates
              .filter((e) => /prod|production/i.test(e.environment))
              .every((e) => e.failed === 0),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Bitbucket deployment trends";
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/maintenance/alerts", async (_req: Request, res: Response) => {
    return res.json({ totalAlerts: 0, activeAlerts: 0, resolvedAlerts: 0, statistics: {} });
  });

  app.get("/api/sdlc/projects/:projectId/bitbucket/maintenance/bugs", async (_req: Request, res: Response) => {
    return res.json({ totalBugs: 0, resolvedBugs: 0, criticalBugs: 0, highPriorityBugs: 0, statistics: {} });
  });
}
