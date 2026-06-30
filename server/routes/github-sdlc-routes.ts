import type { Express, Request, Response } from "express";
import { resolveProjectIntegrationCategory } from "../services/project-integration-resolver";
import {
  GithubActionsService,
  mapGithubRunStatus,
  type GithubActionsConfig,
  type GithubDeployment,
  type GithubDeploymentStatus,
  type GithubWorkflowJob,
  type GithubWorkflowRun,
} from "../services/github-actions-service";

const GITHUB_CONTEXT_ERROR =
  "GitHub Actions is not fully configured for this project. Configure GitHub for Repository and GitHub Actions for CI/CD with owner, repository, and PAT.";

function normalizeRepo(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .slice(-1)[0];
}

function mergeGithubConfig(repoCfg: Record<string, string>, cicdCfg: Record<string, string>): GithubActionsConfig {
  const owner = String(cicdCfg.ownerName || cicdCfg.owner || repoCfg.ownerName || repoCfg.owner || "").trim();
  const repository = normalizeRepo(
    String(
      cicdCfg.repository ||
        cicdCfg.repositoryName ||
        cicdCfg.repo ||
        cicdCfg.repositoryUrl ||
        repoCfg.repository ||
        repoCfg.repositoryName ||
        repoCfg.repo ||
        repoCfg.repositoryUrl ||
        "",
    ),
  );
  const token = String(cicdCfg.patToken || cicdCfg.apiToken || repoCfg.patToken || repoCfg.apiToken || "").trim();
  return { owner, repository, token };
}

async function getGithubContext(projectId: string): Promise<GithubActionsConfig | null> {
  const cicdIntegration = await resolveProjectIntegrationCategory(projectId, "cicd").catch(() => null);
  if (
    cicdIntegration?.status !== "configured" ||
    String(cicdIntegration.providerKey || "").toLowerCase() !== "github_actions"
  ) {
    return null;
  }

  const repoIntegration = await resolveProjectIntegrationCategory(projectId, "repo").catch(() => null);
  const repoCfg =
    repoIntegration?.status === "configured" && String(repoIntegration.providerKey || "").toLowerCase() === "github"
      ? repoIntegration.config || {}
      : {};
  const cicdCfg = cicdIntegration.config || {};
  const merged = mergeGithubConfig(repoCfg, cicdCfg);
  if (!merged.owner || !merged.repository || !merged.token) return null;
  return merged;
}

function asNormRun(run: GithubWorkflowRun) {
  const status = mapGithubRunStatus(run);
  const created = run.run_started_at || run.created_at || new Date(0).toISOString();
  const updated = run.updated_at || created;
  return {
    status,
    ref: String(run.head_branch || "").trim(),
    created_at: created,
    updated_at: updated,
  };
}

function mapGithubJobStatus(job: GithubWorkflowJob): string {
  const status = String(job.status || "").toLowerCase();
  const conclusion = String(job.conclusion || "").toLowerCase();
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (["failure", "timed_out", "action_required"].includes(conclusion)) return "failed";
    if (["cancelled", "skipped"].includes(conclusion)) return "canceled";
    return "completed";
  }
  if (["in_progress", "queued", "waiting", "pending"].includes(status)) return "running";
  return status || "unknown";
}

type GithubDeploymentEntry = {
  id: number | string;
  releaseId: number | string;
  releaseName: string;
  environmentId: string;
  environmentName: string;
  deploymentStatus: string;
  startedOn?: string;
  completedOn?: string;
  webUrl?: string;
};

const DEPLOYMENT_HINT_RE = /\b(deploy(ment)?|release|promot(e|ion)|rollout|ship)\b/i;
const ENVIRONMENT_HINT_RE = /\b(prod(uction)?|staging|stage|qa|uat|test|dev(elopment)?)\b/i;

function extractGithubEnvironmentName(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const match = text.match(ENVIRONMENT_HINT_RE);
    if (match?.[0]) return match[0].toLowerCase();
  }
  return "default";
}

function looksLikeGithubDeploymentRun(
  run: GithubWorkflowRun,
  jobs: GithubWorkflowJob[],
): { looksLikeDeployment: boolean; environmentName: string } {
  const runName = String(run.name || "");
  const runDisplay = String(run.display_title || "");
  const runBranch = String(run.head_branch || "");
  const candidateTexts = [runName, runDisplay, runBranch, ...jobs.map((job) => String(job.name || ""))];
  const hasDeploymentHint = candidateTexts.some((v) => DEPLOYMENT_HINT_RE.test(v));
  const hasEnvironmentHint = candidateTexts.some((v) => ENVIRONMENT_HINT_RE.test(v));
  const environmentName = extractGithubEnvironmentName(...candidateTexts);
  return {
    looksLikeDeployment: hasDeploymentHint || (hasEnvironmentHint && jobs.length > 0),
    environmentName,
  };
}

function mapGithubDeploymentStatus(state: string): "success" | "failed" | "pending" | "running" | "canceled" | "unknown" {
  const s = String(state || "").toLowerCase();
  if (["success", "inactive"].includes(s)) return "success";
  if (["failure", "error"].includes(s)) return "failed";
  if (["queued", "pending", "waiting"].includes(s)) return "pending";
  if (["in_progress"].includes(s)) return "running";
  if (["cancelled"].includes(s)) return "canceled";
  return "unknown";
}

function withGithubDeployHint(message: string): string {
  const text = String(message || "");
  if (text.includes("GitHub API 403") || text.includes("GitHub API 401")) {
    return `${text} Ensure PAT has repo access and deployments read/write permissions (classic PAT: repo scope; fine-grained PAT: Actions/Contents/Deployments permissions).`;
  }
  return text;
}

async function listGithubDeploymentEntriesApiFirst(gh: GithubActionsService): Promise<GithubDeploymentEntry[]> {
  const deployments = await gh.listDeployments(100);
  if (!deployments.length) return [];
  const entries: GithubDeploymentEntry[] = [];
  for (const d of deployments) {
    const statuses = await gh.listDeploymentStatuses(d.id, 20).catch(() => [] as GithubDeploymentStatus[]);
    const latest = statuses[0];
    const mapped = mapGithubDeploymentStatus(String(latest?.state || ""));
    entries.push({
      id: d.id,
      releaseId: d.id,
      releaseName: `Deployment #${d.id}`,
      environmentId: String(d.id),
      environmentName: String(latest?.environment || d.environment || d.original_environment || "default"),
      deploymentStatus: mapped,
      startedOn: latest?.created_at || d.created_at,
      completedOn: latest?.updated_at || d.updated_at || d.created_at,
      webUrl: latest?.target_url,
    });
  }
  return entries;
}

async function listGithubDeploymentEntriesFallback(gh: GithubActionsService): Promise<GithubDeploymentEntry[]> {
  const runs = await gh.listWorkflowRuns(80);
  const runsWindow = runs.slice(0, 40);
  const jobsRows = await Promise.all(
    runsWindow.map(async (run) => {
      try {
        const jobs = await gh.listWorkflowJobs(Number(run.id || 0), 100);
        return [Number(run.id || 0), jobs] as const;
      } catch {
        return [Number(run.id || 0), [] as GithubWorkflowJob[]] as const;
      }
    }),
  );
  const jobsByRunId = new Map<number, GithubWorkflowJob[]>(jobsRows);

  return runsWindow
    .map((run) => {
      const jobs = jobsByRunId.get(Number(run.id || 0)) || [];
      const inferred = looksLikeGithubDeploymentRun(run, jobs);
      if (!inferred.looksLikeDeployment) return null;
      return {
        id: run.id,
        releaseId: run.id,
        releaseName: run.name || `Run #${run.id}`,
        environmentId: inferred.environmentName.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-"),
        environmentName: inferred.environmentName,
        deploymentStatus: mapGithubRunStatus(run),
        startedOn: run.run_started_at || run.created_at,
        completedOn: run.updated_at,
        webUrl: run.html_url,
      } satisfies GithubDeploymentEntry;
    })
    .filter((entry): entry is GithubDeploymentEntry => !!entry);
}

async function listGithubDeploymentEntries(gh: GithubActionsService): Promise<GithubDeploymentEntry[]> {
  const primary = await listGithubDeploymentEntriesApiFirst(gh).catch(() => [] as GithubDeploymentEntry[]);
  if (primary.length > 0) return primary;
  return listGithubDeploymentEntriesFallback(gh);
}

export function registerGithubSdlcRoutes(app: Express): void {
  app.get("/api/sdlc/projects/:projectId/github/context-status", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.json({ hasConfig: false, hint: GITHUB_CONTEXT_ERROR });
      return res.json({ hasConfig: true, owner: ctx.owner, repository: ctx.repository });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to resolve GitHub context";
      return res.status(500).json({ hasConfig: false, error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/branches", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      return res.json(await gh.listBranches());
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch GitHub branches" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/pipelines", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const workflows = await gh.listWorkflows(100);
      let value = workflows
        .filter((w) => Number(w.id || 0) > 0)
        .map((w) => ({
          id: Number(w.id || 0),
          name: w.name || `Workflow #${w.id}`,
          path: String(w.path || ""),
          url: `https://github.com/${ctx.owner}/${ctx.repository}/actions/workflows/${encodeURIComponent(String(w.path || ""))}`,
          entryKind: "workflow" as const,
        }));
      if (value.length === 0) {
        value = [
          {
            id: -1,
            name: `${ctx.owner}/${ctx.repository} — no workflows found`,
            path: ".github/workflows",
            url: `https://github.com/${ctx.owner}/${ctx.repository}/actions`,
            entryKind: "placeholder" as const,
          },
        ];
      }
      return res.json({ value });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch GitHub workflow runs" });
    }
  });

  app.post("/api/sdlc/projects/:projectId/github/queue-build", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const { branchName, pipelineRunId } = (req.body || {}) as { branchName?: string; pipelineRunId?: number };
      if (!branchName?.trim()) return res.status(400).json({ error: "branchName is required" });
      const gh = new GithubActionsService(ctx);
      let workflowId: number | null = null;
      if (pipelineRunId != null && Number.isFinite(pipelineRunId) && pipelineRunId > 0) {
        const requested = Math.floor(pipelineRunId);
        const workflows = await gh.listWorkflows(100);
        const matchedWorkflow = workflows.find((w) => Number(w.id || 0) === requested);
        if (matchedWorkflow) {
          workflowId = requested;
        } else {
          const run = await gh.getWorkflowRun(requested);
          workflowId = typeof run.workflow_id === "number" ? run.workflow_id : null;
        }
      }
      if (!workflowId) {
        const workflows = await gh.listWorkflows(20);
        workflowId = workflows[0]?.id ?? null;
      }
      if (!workflowId) return res.status(400).json({ error: "No GitHub workflow found to dispatch." });
      await gh.dispatchWorkflow(workflowId, branchName.trim());
      return res.json({
        id: Date.now(),
        buildNumber: Date.now(),
        status: "queued",
        ref: branchName.trim(),
      });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to queue GitHub workflow" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/builds", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const runs = await gh.listWorkflowRuns(30);
      const runsWindow = runs.slice(0, 20);
      const jobsRows = await Promise.all(
        runsWindow.map(async (run) => {
          try {
            const jobs = await gh.listWorkflowJobs(Number(run.id || 0), 100);
            return [Number(run.id || 0), jobs] as const;
          } catch {
            return [Number(run.id || 0), [] as GithubWorkflowJob[]] as const;
          }
        }),
      );
      const jobsByRunId = new Map<number, GithubWorkflowJob[]>(jobsRows);
      return res.json({
        value: runsWindow.map((r) => ({
          ...(() => {
            const rawJobs = jobsByRunId.get(Number(r.id || 0)) || [];
            const mappedJobs = rawJobs.map((job, idx) => ({
              id: String(job.id || `${r.id}-${idx}`),
              name: String(job.name || `Job ${idx + 1}`),
              status: mapGithubJobStatus(job),
              result: mapGithubJobStatus(job),
              stageName: String(r.name || "Workflow"),
              stageId: String(r.workflow_id || r.id || "workflow"),
              startTime: job.started_at || undefined,
              finishTime: job.completed_at || undefined,
              logUrl: job.html_url || undefined,
            }));
            return { jobs: mappedJobs };
          })(),
          id: Number(r.id || 0),
          buildNumber: `#${r.id}`,
          status: mapGithubRunStatus(r),
          result: mapGithubRunStatus(r),
          queueTime: r.created_at,
          startTime: r.run_started_at || r.created_at,
          finishTime: r.updated_at,
          sourceBranch: r.head_branch ? `refs/heads/${r.head_branch}` : undefined,
          definition: { id: Number(r.workflow_id || r.id || 0), name: r.name || `Run #${r.id}` },
          webUrl: r.html_url,
        })),
      });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch GitHub builds" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/build-publish-summary", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const runs = await gh.listWorkflowRuns(50);
      const completed = runs.filter((r) => String(r.status || "").toLowerCase() === "completed");
      const succeeded = completed.filter((r) => String(r.conclusion || "").toLowerCase() === "success").length;
      const failed = completed.filter((r) => ["failure", "cancelled", "timed_out"].includes(String(r.conclusion || "").toLowerCase())).length;
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
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch GitHub summary" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/ci-file", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
      const file = typeof req.query.file === "string" && req.query.file.trim() ? req.query.file.trim() : ".github/workflows/ci.yml";
      if (!ref) return res.status(400).json({ error: "ref query parameter is required" });
      const gh = new GithubActionsService(ctx);
      const content = await gh.tryGetFileContent(ref, file);
      if (content === null) return res.json({ content: "", missing: true, file, ref });
      return res.json({ content, missing: false, file, ref });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to read workflow file" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/ci-yaml-files", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const ref = typeof req.query.ref === "string" ? req.query.ref.trim() : "";
      if (!ref) return res.status(400).json({ error: "ref query parameter is required" });
      const gh = new GithubActionsService(ctx);
      return res.json({ value: await gh.listRepoYamlFiles(ref) });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to list workflow yaml files" });
    }
  });

  app.post("/api/sdlc/projects/:projectId/github/ci/lint", async (_req: Request, res: Response) => {
    return res.json({
      valid: true,
      status: "skipped",
      errors: [],
      warnings: [{ message: "Server-side GitHub Actions lint is not available in this integration." }],
    });
  });

  app.post("/api/sdlc/projects/:projectId/github/ci-yaml", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const { branchName, filePath, content, commitMessage, triggerPipeline } = (req.body || {}) as {
        branchName?: string;
        filePath?: string;
        content?: string;
        commitMessage?: string;
        triggerPipeline?: boolean;
      };
      if (!branchName?.trim()) return res.status(400).json({ error: "branchName is required" });
      if (typeof content !== "string") return res.status(400).json({ error: "content must be a string" });
      const path = (filePath || ".github/workflows/ci.yml").trim().replace(/^\/+/, "");
      const gh = new GithubActionsService(ctx);
      await gh.upsertFile(branchName.trim(), path, content, commitMessage?.trim() || `Update ${path} via DevX Pipeline Studio`);
      let queued = null as null | { status: string };
      if (triggerPipeline) {
        const workflows = await gh.listWorkflows(20);
        if (workflows[0]?.id) {
          await gh.dispatchWorkflow(workflows[0].id, branchName.trim());
          queued = { status: "queued" };
        }
      }
      return res.json({ ok: true, filePath: path, branch: branchName.trim(), pipeline: queued });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to save workflow yaml" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/deployments", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const value = await listGithubDeploymentEntries(gh);
      return res.json({ value: value.map((d) => ({ ...d })) });
    } catch (e) {
      const msg = withGithubDeployHint(e instanceof Error ? e.message : "Failed to fetch GitHub deployments");
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/deployment-summary", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const deployments = await listGithubDeploymentEntries(gh);
      const successfulReleases = deployments.filter((r) => r.deploymentStatus === "success").length;
      const failedReleases = deployments.filter((r) => r.deploymentStatus === "failed").length;
      const pendingReleases = deployments.filter((r) => ["running", "pending"].includes(r.deploymentStatus)).length;
      return res.json({
        totalReleases: deployments.length,
        successfulReleases,
        failedReleases,
        pendingReleases,
        recentReleases: deployments.slice(0, 10),
      });
    } catch (e) {
      const msg = withGithubDeployHint(e instanceof Error ? e.message : "Failed to fetch GitHub deployment summary");
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/monitoring", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const runs = (await gh.listWorkflowRuns(50)).map(asNormRun);
      const succeeded = runs.filter((r) => r.status === "success").length;
      const failed = runs.filter((r) => r.status === "failed").length;
      const inProgress = runs.filter((r) => r.status === "running" || r.status === "pending").length;
      const totalBuilds = runs.length;
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
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch GitHub monitoring" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/maintenance/system-status", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const runs = (await gh.listWorkflowRuns(50)).map(asNormRun);
      const total = runs.length;
      const success = runs.filter((r) => r.status === "success").length;
      const successRate = total > 0 ? (success / total) * 100 : 100;
      const status = successRate < 50 ? "critical" : successRate < 80 ? "warning" : "healthy";
      return res.json({
        overallHealth: {
          status,
          percentage: successRate,
          buildSuccessRate: successRate,
          releaseSuccessRate: successRate,
        },
        deploymentStability: {
          last7Days: { total, succeeded: success, failed: total - success, successRate },
          last30Days: { total, successRate },
          trend: "stable",
        },
        alerts: { active: 0, resolved: 0, pendingApprovals: 0 },
        bugs: { open: 0, closed: 0, total: 0, criticalOpen: 0 },
        performanceIndicators: {
          buildSuccessRate: successRate,
          averageBuildDuration: 0,
          testPassRate: successRate,
          agentAvailability: 0,
        },
        systemStatus: {
          isOperatingNormally: status === "healthy",
          hasCriticalIssues: status === "critical",
          recentChangesInstability: false,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch GitHub system status" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/maintenance/pipeline-health", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const runs = await gh.listWorkflowRuns(50);
      const succeededRuns = runs.filter((r) => mapGithubRunStatus(r) === "success").length;
      const failedRuns = runs.filter((r) => mapGithubRunStatus(r) === "failed").length;
      const successRate = runs.length > 0 ? (succeededRuns / runs.length) * 100 : 0;
      return res.json({
        successRate,
        totalRuns: runs.length,
        failedRuns,
        succeededRuns,
        stabilityRating: successRate >= 90 ? "excellent" : successRate >= 75 ? "good" : successRate >= 50 ? "fair" : "poor",
      });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch GitHub pipeline health" });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/maintenance/deployment-trends", async (req: Request, res: Response) => {
    try {
      const ctx = await getGithubContext(req.params.projectId);
      if (!ctx) return res.status(400).json({ error: GITHUB_CONTEXT_ERROR });
      const gh = new GithubActionsService(ctx);
      const deployments = await listGithubDeploymentEntries(gh);
      const successfulDeployments = deployments.filter((r) => r.deploymentStatus === "success").length;
      const failedDeployments = deployments.filter((r) => r.deploymentStatus === "failed").length;
      return res.json({
        overallMetrics: {
          totalDeployments: deployments.length,
          successfulDeployments,
          failedDeployments,
        },
      });
    } catch (e) {
      const msg = withGithubDeployHint(e instanceof Error ? e.message : "Failed to fetch GitHub deployment trends");
      return res.status(500).json({ error: msg });
    }
  });

  app.get("/api/sdlc/projects/:projectId/github/backlog-context", async (_req: Request, res: Response) =>
    res.json({ stateCounts: {} }),
  );
  app.get("/api/sdlc/projects/:projectId/github/test-runs", async (_req: Request, res: Response) => res.json({ value: [] }));
  app.get("/api/sdlc/projects/:projectId/github/releases", async (_req: Request, res: Response) => res.json({ value: [] }));
  app.get("/api/sdlc/projects/:projectId/github/release-artifacts", async (_req: Request, res: Response) =>
    res.json({ value: [] }),
  );
  app.get("/api/sdlc/projects/:projectId/github/maintenance/alerts", async (_req: Request, res: Response) =>
    res.json({ totalAlerts: 0, activeAlerts: 0, resolvedAlerts: 0, statistics: {} }),
  );
  app.get("/api/sdlc/projects/:projectId/github/maintenance/bugs", async (_req: Request, res: Response) =>
    res.json({ totalBugs: 0, resolvedBugs: 0, criticalBugs: 0, highPriorityBugs: 0, statistics: {} }),
  );
}

