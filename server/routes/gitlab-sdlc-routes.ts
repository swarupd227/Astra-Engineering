import type { Express, Request, Response } from "express";
import { resolveProjectIntegrationCategory } from "../services/project-integration-resolver";
import { getGitClientForUser } from "../integrations/git/user-credential-resolver";
import { GitLabService, type GitLabPipeline } from "../services/gitlab-service";
import { autoBootstrapUser, requireAuth } from "../auth/middleware";

type GitlabContext = {
  baseUrl: string;
  projectRef: string;
  token: string;
  source: "repo" | "cicd" | "merged";
  credentialSource: "integration_config" | "user_project" | "user_global";
};

const GITLAB_CONTEXT_ERROR =
  "GitLab is not fully configured for this project. Configure GitLab for Repository with baseUrl, projectId/repository path, and your personal PAT token. Add GitLab CI/CD config when you need separate CI settings.";

function mapGitLabPipelineStatus(pipeline: Pick<GitLabPipeline, "status">): string {
  const status = String(pipeline.status || "").toLowerCase();
  if (["success", "passed"].includes(status)) return "success";
  if (["failed", "canceled", "cancelled", "skipped"].includes(status)) return "failed";
  if (["running", "pending", "created", "waiting_for_resource", "preparing"].includes(status)) return "running";
  return status || "unknown";
}

function normalizeBaseUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "").replace(/\/api\/v4$/i, "");
}

function normalizeProjectRef(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/[^/]+\/?/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function mergeGitlabConfig(
  repoCfg: Record<string, string>,
  cicdCfg: Record<string, string>,
  preferredSource: "repo" | "cicd" = "repo",
): GitlabContext {
  const primaryCfg = preferredSource === "cicd" ? cicdCfg : repoCfg;
  const fallbackCfg = preferredSource === "cicd" ? repoCfg : cicdCfg;
  const baseUrl = normalizeBaseUrl(String(primaryCfg.baseUrl || fallbackCfg.baseUrl || "https://gitlab.com"));
  const projectRef = normalizeProjectRef(
    String(
      primaryCfg.projectId ||
        primaryCfg.repository ||
        primaryCfg.repositoryName ||
        primaryCfg.namespacePath ||
        fallbackCfg.projectId ||
        fallbackCfg.repository ||
        fallbackCfg.repositoryName ||
        fallbackCfg.namespacePath ||
        "",
    ),
  );
  const token = String(primaryCfg.patToken || primaryCfg.apiToken || fallbackCfg.patToken || fallbackCfg.apiToken || "").trim();
  return {
    baseUrl,
    projectRef,
    token,
    source: projectRef ? preferredSource : "merged",
    credentialSource: "integration_config",
  };
}

async function getGitlabContext(
  projectId: string,
  userId?: string | null,
  preferredSource: "repo" | "cicd" = "repo",
): Promise<GitlabContext | null> {
  const cicdIntegration = await resolveProjectIntegrationCategory(projectId, "cicd").catch(() => null);
  const hasGitlabCi =
    cicdIntegration?.status === "configured" &&
    String(cicdIntegration.providerKey || "").toLowerCase() === "gitlab_ci";

  const repoIntegration = await resolveProjectIntegrationCategory(projectId, "repo").catch(() => null);
  const repoCfg =
    repoIntegration?.status === "configured" && String(repoIntegration.providerKey || "").toLowerCase() === "gitlab"
      ? repoIntegration.config || {}
      : {};
  if (!hasGitlabCi && Object.keys(repoCfg).length === 0) {
    return null;
  }
  const cicdCfg = hasGitlabCi ? cicdIntegration.config || {} : {};

  const merged = mergeGitlabConfig(repoCfg, cicdCfg, preferredSource);
  if (userId) {
    try {
      const client = await getGitClientForUser(userId, "gitlab", merged.baseUrl, projectId);
      merged.token = client.token;
      merged.credentialSource = "user_project";
      if (!merged.baseUrl) merged.baseUrl = client.baseUrl;
    } catch {
      try {
        const client = await getGitClientForUser(userId, "gitlab", merged.baseUrl);
        merged.token = client.token;
        merged.credentialSource = "user_global";
        if (!merged.baseUrl) merged.baseUrl = client.baseUrl;
      } catch {
        // Fall back to any token stored directly on the integration config below.
      }
    }
  }
  if (!merged.baseUrl || !merged.projectRef || !merged.token) return null;
  return merged;
}

function gitlabFetchErrorResponse(error: unknown, fallbackMessage: string, ctx?: GitlabContext | null) {
  const status = typeof (error as any)?.status === "number" ? (error as any).status : 500;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return {
    status,
    body: {
      error:
        status === 403
          ? `${message}. The GitLab token used for this project cannot read this GitLab project. Reconnect GitLab with the required access.`
          : message,
      gitlabContext: ctx
        ? {
            baseUrl: ctx.baseUrl,
            projectRef: ctx.projectRef,
            source: ctx.source,
            credentialSource: ctx.credentialSource,
          }
        : undefined,
    },
  };
}

function createGitlabClient(ctx: GitlabContext): GitLabService {
  const normalizedBase = normalizeBaseUrl(ctx.baseUrl);
  const apiBase = `${normalizedBase || "https://gitlab.com"}/api/v4`;
  return new GitLabService(ctx.token, apiBase);
}

function isMissingGitlabCiConfigError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /missing\s+ci\s+config\s+file/i.test(message);
}

function isGitlabIdentityVerificationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /identity\s+verification\s+is\s+required/i.test(message);
}

function normalizeGitlabRun(run: GitLabPipeline) {
  return {
    status: mapGitLabPipelineStatus(run),
    ref: String(run.ref || "").trim(),
    created_at: run.created_at || new Date(0).toISOString(),
    updated_at: run.updated_at || run.created_at || new Date(0).toISOString(),
  };
}

type GitlabDeploymentEntry = {
  id: number | string;
  releaseId: number | string;
  releaseName: string;
  environmentId: string;
  environmentName: string;
  deploymentStatus: string;
  startedOn?: string;
  completedOn?: string;
};

const DEPLOYMENT_HINT_RE = /\b(deploy(ment)?|release|promot(e|ion)|rollout|ship)\b/i;
const ENVIRONMENT_HINT_RE = /\b(prod(uction)?|staging|stage|qa|uat|test|dev(elopment)?)\b/i;

function extractGitlabEnvironmentName(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const match = text.match(ENVIRONMENT_HINT_RE);
    if (match?.[0]) return match[0].toLowerCase();
  }
  return "default";
}

async function listGitlabDeploymentEntries(gl: GitLabService, projectRef: string): Promise<GitlabDeploymentEntry[]> {
  const nativeDeployments = await gl.getDeployments(projectRef).catch(() => []);
  const apiFirst = nativeDeployments.map((d) => ({
    id: d.id,
    releaseId: d.id,
    releaseName: d.deployable?.name || `Deployment #${d.id}`,
    environmentId: String(d.environment?.name || "default")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gi, "-"),
    environmentName: d.environment?.name || "default",
    deploymentStatus: mapGitLabPipelineStatus({ status: d.status } as GitLabPipeline),
    startedOn: d.created_at,
    completedOn: d.updated_at || d.created_at,
  }));
  if (apiFirst.length > 0) return apiFirst;

  const pipelines = (await gl.getPipelines(projectRef).catch(() => [])).slice(0, 40);
  const jobsRows = await Promise.all(
    pipelines.map(async (pipeline) => {
      try {
        const jobs = await gl.getPipelineJobs(projectRef, Number(pipeline.id || 0));
        return [Number(pipeline.id || 0), Array.isArray(jobs) ? jobs : []] as const;
      } catch {
        return [Number(pipeline.id || 0), [] as any[]] as const;
      }
    }),
  );
  const jobsByPipelineId = new Map<number, any[]>(jobsRows);

  return pipelines
    .flatMap((pipeline) => {
      const jobs = jobsByPipelineId.get(Number(pipeline.id || 0)) || [];
      const releaseName = `Pipeline #${pipeline.id}`;
      return jobs
        .filter((job) => {
          const name = String(job?.name || "");
          const stage = String(job?.stage || "");
          const environment = String(job?.environment?.name || job?.environment || "");
          const combined = `${name} ${stage} ${environment}`;
          return DEPLOYMENT_HINT_RE.test(combined) || ENVIRONMENT_HINT_RE.test(combined);
        })
        .map((job, idx) => {
          const status = mapGitLabPipelineStatus({ status: String(job?.status || "") });
          const environmentName = extractGitlabEnvironmentName(
            String(job?.environment?.name || job?.environment || ""),
            String(job?.name || ""),
            String(job?.stage || ""),
            String(pipeline.ref || ""),
          );
          return {
            id: String(job?.id || `${pipeline.id}-${idx}`),
            releaseId: Number(pipeline.id || 0),
            releaseName,
            environmentId: environmentName.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-"),
            environmentName,
            deploymentStatus: status,
            startedOn: job?.started_at || pipeline.created_at,
            completedOn: job?.finished_at || pipeline.updated_at || pipeline.created_at,
          } satisfies GitlabDeploymentEntry;
        });
    })
    .filter(Boolean);
}

export function registerGitlabSdlcRoutes(app: Express): void {
  app.get("/api/sdlc/projects/:projectId/gitlab/context-status", async (req: Request, res: Response) => {
    try {
      const preferredSource = req.query.source === "cicd" ? "cicd" : "repo";
      const ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, preferredSource);
      if (!ctx) return res.json({ hasConfig: false, hint: GITLAB_CONTEXT_ERROR });
      return res.json({
        hasConfig: true,
        baseUrl: ctx.baseUrl,
        projectRef: ctx.projectRef,
        source: ctx.source,
        credentialSource: ctx.credentialSource,
      });
    } catch (e) {
      return res.status(500).json({ hasConfig: false, error: e instanceof Error ? e.message : "Failed to resolve GitLab context" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/branches", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "repo");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      return res.json(await gl.getBranches(ctx.projectRef));
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab branches", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/pipelines", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const runs = await gl.getPipelines(ctx.projectRef);
      type GitlabPipelineEntry = {
        id: number;
        name: string;
        path: string;
        url?: string;
        entryKind: "run" | "placeholder";
      };
      let value: GitlabPipelineEntry[] = runs.map((r) => ({
        id: Number(r.id || 0),
        name: `Pipeline #${r.id}`,
        path: String(r.ref || ""),
        url: r.web_url,
        entryKind: "run" as const,
      }));
      if (value.length === 0) {
        value = [{ id: -1, name: `${ctx.projectRef} — no pipelines found`, path: "main", entryKind: "placeholder" as const }];
      }
      return res.json({ value });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab pipelines", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.post("/api/sdlc/projects/:projectId/gitlab/queue-build", async (req: Request, res: Response) => {
    try {
      const ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const { branchName, pipelineRunId, variables, pipelineVariables } = (req.body || {}) as {
        branchName?: string;
        pipelineRunId?: number;
        variables?: Array<{ key: string; value: string }>;
        pipelineVariables?: Array<{ key: string; value: string }>;
      };
      if (!branchName?.trim()) return res.status(400).json({ error: "branchName is required" });
      const gl = createGitlabClient(ctx);
      const ciConfig = await gl.tryGetRawFile(ctx.projectRef, ".gitlab-ci.yml", branchName.trim());
      if (!ciConfig) {
        return res.status(400).json({
          error: "Missing GitLab CI config file. Save a pipeline to .gitlab-ci.yml on this branch before triggering a run.",
        });
      }
      if (pipelineRunId != null && Number.isFinite(pipelineRunId) && pipelineRunId > 0) {
        const existing = await gl.getPipeline(ctx.projectRef, Math.floor(pipelineRunId));
        if (String(existing.ref || "").trim() !== branchName.trim()) {
          return res.status(400).json({
            error: `Pipeline #${pipelineRunId} ran on "${existing.ref || "unknown"}", not "${branchName.trim()}".`,
          });
        }
      }
      const queued = await gl.createPipeline(
        ctx.projectRef,
        branchName.trim(),
        Array.isArray(variables) ? variables : Array.isArray(pipelineVariables) ? pipelineVariables : [],
      );
      return res.json({
        id: queued.id,
        buildNumber: queued.id,
        status: mapGitLabPipelineStatus(queued),
        ref: queued.ref,
        _links: queued.web_url ? { web: { href: queued.web_url } } : undefined,
      });
    } catch (e) {
      if (isMissingGitlabCiConfigError(e)) {
        return res.status(400).json({
          error: "Missing GitLab CI config file. Save a pipeline to .gitlab-ci.yml on this branch before triggering a run.",
        });
      }
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to queue GitLab pipeline" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/builds", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gitlabContext = ctx;
      const gl = createGitlabClient(ctx);
      const pipelines = await gl.getPipelines(gitlabContext.projectRef);
      const pipelinesWindow = pipelines.slice(0, 20);
      const jobsRows = await Promise.all(
        pipelinesWindow.map(async (pipeline) => {
          try {
            const jobs = await gl.getPipelineJobs(gitlabContext.projectRef, Number(pipeline.id || 0));
            return [Number(pipeline.id || 0), Array.isArray(jobs) ? jobs : []] as const;
          } catch {
            return [Number(pipeline.id || 0), [] as any[]] as const;
          }
        }),
      );
      const jobsByPipelineId = new Map<number, any[]>(jobsRows);
      return res.json({
        value: pipelinesWindow.map((p) => ({
          ...(() => {
            const rawJobs = jobsByPipelineId.get(Number(p.id || 0)) || [];
            const mappedJobs = rawJobs.map((job, idx) => {
              const status = mapGitLabPipelineStatus({ status: String(job?.status || "") });
              return {
                id: String(job?.id || `${p.id}-${idx}`),
                name: String(job?.name || `Job ${idx + 1}`),
                status,
                result: status,
                stageName: String(job?.stage || "default"),
                stageId: String(job?.stage || "default"),
                startTime: job?.started_at || undefined,
                finishTime: job?.finished_at || undefined,
                logUrl: job?.web_url || undefined,
              };
            });
            return { jobs: mappedJobs };
          })(),
          id: Number(p.id || 0),
          buildNumber: `#${p.id}`,
          status: mapGitLabPipelineStatus(p),
          result: mapGitLabPipelineStatus(p),
          sourceBranch: p.ref ? `refs/heads/${p.ref}` : undefined,
          queueTime: p.created_at,
          startTime: p.created_at,
          finishTime: p.updated_at || p.created_at,
          definition: { id: Number(p.id || 0), name: `Pipeline #${p.id}` },
          webUrl: p.web_url,
        })),
      });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab builds", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/build-publish-summary", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const runs = await gl.getPipelines(ctx.projectRef);
      const norm = runs.map(normalizeGitlabRun);
      const completed = norm.filter((r) => ["success", "failed", "canceled"].includes(r.status));
      const succeeded = completed.filter((r) => r.status === "success").length;
      const failed = completed.filter((r) => r.status === "failed" || r.status === "canceled").length;
      return res.json({
        publishedArtifacts: 0,
        buildsCheckedForArtifacts: completed.length,
        buildsWithArtifacts: 0,
        completedBuilds: completed.length,
        succeededBuilds: succeeded,
        failedBuilds: failed,
        successRatePercent: completed.length > 0 ? Math.round((succeeded / completed.length) * 100) : 0,
      });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab summary", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/deployments", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const value = await listGitlabDeploymentEntries(gl, ctx.projectRef);
      return res.json({ value });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab deployments", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/deployment-summary", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const deployments = await listGitlabDeploymentEntries(gl, ctx.projectRef);
      const successfulReleases = deployments.filter((d) => d.deploymentStatus === "success").length;
      const failedReleases = deployments.filter((d) => d.deploymentStatus === "failed").length;
      const pendingReleases = deployments.filter((d) => ["running", "pending"].includes(d.deploymentStatus)).length;
      return res.json({
        totalReleases: deployments.length,
        successfulReleases,
        failedReleases,
        pendingReleases,
        recentReleases: deployments.slice(0, 10),
      });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab deployment summary", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/monitoring", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const norm = (await gl.getPipelines(ctx.projectRef)).map(normalizeGitlabRun);
      const succeeded = norm.filter((r) => r.status === "success").length;
      const failed = norm.filter((r) => r.status === "failed").length;
      const inProgress = norm.filter((r) => r.status === "running").length;
      const totalBuilds = norm.length;
      const successRate = totalBuilds > 0 ? Math.round((succeeded / totalBuilds) * 100) : 0;
      return res.json({
        systemStatus: successRate >= 80 ? "Healthy" : successRate >= 50 ? "Warning" : "Critical",
        services: { running: inProgress, total: Math.max(totalBuilds, inProgress) },
        cpu: { usage: successRate, trend: 0, cores: Math.max(1, Math.min(12, totalBuilds || 1)) },
        memory: { usage: successRate, trend: 0, total: totalBuilds, used: succeeded, free: failed },
        builds: { total: totalBuilds, succeeded, failed, inProgress, successRate },
        tests: { total: totalBuilds, passed: succeeded, failed, passRate: successRate },
        agents: { total: 0, online: 0, offline: 0 },
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab monitoring", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/maintenance/system-status", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const norm = (await gl.getPipelines(ctx.projectRef)).map(normalizeGitlabRun);
      const total = norm.length;
      const success = norm.filter((r) => r.status === "success").length;
      const successRate = total > 0 ? (success / total) * 100 : 100;
      const status = successRate < 50 ? "critical" : successRate < 80 ? "warning" : "healthy";
      return res.json({
        overallHealth: { status, percentage: successRate, buildSuccessRate: successRate, releaseSuccessRate: successRate },
        deploymentStability: { last7Days: { total, succeeded: success, failed: total - success, successRate }, last30Days: { total, successRate }, trend: "stable" },
        alerts: { active: 0, resolved: 0, pendingApprovals: 0 },
        bugs: { open: 0, closed: 0, total: 0, criticalOpen: 0 },
        performanceIndicators: { buildSuccessRate: successRate, averageBuildDuration: 0, testPassRate: successRate, agentAvailability: 0 },
        systemStatus: { isOperatingNormally: status === "healthy", hasCriticalIssues: status === "critical", recentChangesInstability: false },
      });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab system status", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/maintenance/pipeline-health", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const norm = (await gl.getPipelines(ctx.projectRef)).map(normalizeGitlabRun);
      const succeededRuns = norm.filter((r) => r.status === "success").length;
      const failedRuns = norm.filter((r) => r.status === "failed").length;
      const successRate = norm.length > 0 ? (succeededRuns / norm.length) * 100 : 0;
      return res.json({
        successRate,
        totalRuns: norm.length,
        failedRuns,
        succeededRuns,
        stabilityRating: successRate >= 90 ? "excellent" : successRate >= 75 ? "good" : successRate >= 50 ? "fair" : "poor",
      });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab pipeline health", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/maintenance/deployment-trends", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const gl = createGitlabClient(ctx);
      const deployments = await listGitlabDeploymentEntries(gl, ctx.projectRef);
      const successfulDeployments = deployments.filter((d) => d.deploymentStatus === "success").length;
      const failedDeployments = deployments.filter((d) => d.deploymentStatus === "failed").length;
      const totalDeployments = deployments.length;
      return res.json({
        overallMetrics: {
          totalDeployments,
          successfulDeployments,
          failedDeployments,
          pendingDeployments: Math.max(0, totalDeployments - successfulDeployments - failedDeployments),
          successRate: totalDeployments > 0 ? (successfulDeployments / totalDeployments) * 100 : 0,
          failureRate: totalDeployments > 0 ? (failedDeployments / totalDeployments) * 100 : 0,
          averageDuration: 0,
          totalRollbacks: 0,
          rollbackRate: 0,
        },
        environmentFailureRates: [],
      });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to fetch GitLab deployment trends", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/ci-file", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
      const file = typeof req.query.file === "string" && req.query.file.trim() ? req.query.file.trim() : ".gitlab-ci.yml";
      if (!ref) return res.status(400).json({ error: "ref query parameter is required" });
      const gl = createGitlabClient(ctx);
      const content = await gl.tryGetRawFile(ctx.projectRef, file, ref);
      if (content === null) return res.json({ content: "", missing: true, file, ref });
      return res.json({ content, missing: false, file, ref });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to read GitLab CI file", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/ci-yaml-files", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
      if (!ref) return res.status(400).json({ error: "ref query parameter is required" });
      const gl = createGitlabClient(ctx);
      const nodes = await gl.listDirectoryContents(ctx.projectRef, "", ref);
      const names = new Set<string>([".gitlab-ci.yml"]);
      for (const node of nodes) {
        if (node.type !== "file") continue;
        const p = String(node.path || "");
        if (p.toLowerCase().endsWith(".yml") || p.toLowerCase().endsWith(".yaml")) names.add(p);
      }
      return res.json({ value: Array.from(names).sort() });
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to list GitLab YAML files", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.post("/api/sdlc/projects/:projectId/gitlab/ci/lint", async (req: Request, res: Response) => {
    let ctx: GitlabContext | null = null;
    try {
      ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      const gl = createGitlabClient(ctx);
      return res.json(await gl.lintCiConfig(ctx.projectRef, content));
    } catch (e) {
      const response = gitlabFetchErrorResponse(e, "Failed to lint GitLab CI config", ctx);
      return res.status(response.status).json(response.body);
    }
  });

  app.post("/api/sdlc/projects/:projectId/gitlab/ci-yaml", autoBootstrapUser, requireAuth, async (req: Request, res: Response) => {
    let savedFilePath = ".gitlab-ci.yml";
    let savedBranchName = "";
    let didSaveFile = false;
    try {
      const ctx = await getGitlabContext(req.params.projectId, (req as any).user?.id, "cicd");
      if (!ctx) return res.status(400).json({ error: GITLAB_CONTEXT_ERROR });
      const { branchName, filePath, content, commitMessage, triggerPipeline, variables, pipelineVariables } = (req.body || {}) as {
        branchName?: string;
        filePath?: string;
        content?: string;
        commitMessage?: string;
        triggerPipeline?: boolean;
        variables?: Array<{ key: string; value: string }>;
        pipelineVariables?: Array<{ key: string; value: string }>;
      };
      if (!branchName?.trim()) return res.status(400).json({ error: "branchName is required" });
      if (typeof content !== "string") return res.status(400).json({ error: "content must be a string" });
      const path = (filePath || ".gitlab-ci.yml").trim().replace(/^\/+/, "");
      savedFilePath = path;
      savedBranchName = branchName.trim();
      const gl = createGitlabClient(ctx);
      await gl.upsertFile(ctx.projectRef, path, content, savedBranchName, commitMessage?.trim() || `Update ${path} via DevX Pipeline Studio`);
      didSaveFile = true;
      let pipeline: GitLabPipeline | null = null;
      if (triggerPipeline) {
        pipeline = await gl.createPipeline(
          ctx.projectRef,
          savedBranchName,
          Array.isArray(variables) ? variables : Array.isArray(pipelineVariables) ? pipelineVariables : [],
        );
      }
      return res.json({
        ok: true,
        filePath: path,
        branch: savedBranchName,
        pipeline: pipeline ? { id: pipeline.id, status: mapGitLabPipelineStatus(pipeline), web_url: pipeline.web_url } : null,
      });
    } catch (e) {
      if (isGitlabIdentityVerificationError(e)) {
        return res.status(403).json({
          error:
            "GitLab saved the CI YAML but blocked pipeline execution because identity verification is required for the GitLab account or namespace. Complete identity verification in GitLab, then trigger the pipeline again.",
          code: "GITLAB_IDENTITY_VERIFICATION_REQUIRED",
          fileSaved: didSaveFile,
          filePath: savedFilePath,
          branch: didSaveFile ? savedBranchName : undefined,
        });
      }
      if (isMissingGitlabCiConfigError(e)) {
        return res.status(400).json({
          error: "GitLab could not start the pipeline because it cannot find a CI config file on this branch. Save the YAML as .gitlab-ci.yml, then trigger again.",
        });
      }
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to save GitLab CI yaml" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/gitlab/backlog-context", async (_req: Request, res: Response) => res.json({ stateCounts: {} }));
  app.get("/api/sdlc/projects/:projectId/gitlab/test-runs", async (_req: Request, res: Response) => res.json({ value: [] }));
  app.get("/api/sdlc/projects/:projectId/gitlab/releases", async (_req: Request, res: Response) => res.json({ value: [] }));
  app.get("/api/sdlc/projects/:projectId/gitlab/release-artifacts", async (_req: Request, res: Response) => res.json({ value: [] }));
  app.get("/api/sdlc/projects/:projectId/gitlab/maintenance/alerts", async (_req: Request, res: Response) => res.json({ totalAlerts: 0, activeAlerts: 0, resolvedAlerts: 0, statistics: {} }));
  app.get("/api/sdlc/projects/:projectId/gitlab/maintenance/bugs", async (_req: Request, res: Response) => res.json({ totalBugs: 0, resolvedBugs: 0, criticalBugs: 0, highPriorityBugs: 0, statistics: {} }));
}
