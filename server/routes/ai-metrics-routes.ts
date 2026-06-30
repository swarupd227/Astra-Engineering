import type { Express, Request, Response } from "express";
import { requirePolarisAuth, type PolarisRequest } from "../auth/polaris-auth";
import { autoBootstrapUser, requireAuth } from "../auth/middleware";
import { syncJiraTeam, setJiraUserOverride, syncAllProjects } from "../integrations/jira/team-sync-service";
import { upsertProductivityTarget } from "../observability/productivity";
import { buildAiMetricsResponse, listPolarisJiraContexts } from "../services/ai-metrics-service";
import { markQualityAwait } from "../observability/quality";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PERIODS = new Set(["daily", "weekly", "monthly"]);

/**
 * Polaris AI-metrics endpoint. Guarded by Polaris M2M JWT auth (DevX = verifier).
 *
 * NOTE: Step 2 ships an auth-guarded STUB. The full aggregation
 * (buildAiMetricsResponse) lands in Step 8.
 */
export function registerAiMetricsRoutes(app: Express) {
  app.get("/api/ai-metrics/jira-context", requirePolarisAuth, async (_req: PolarisRequest, res: Response) => {
    try {
      const instances = await listPolarisJiraContexts();
      res.json({ instances });
    } catch (e: any) {
      console.error("[ai-metrics:jira-context] failed:", e?.message || e);
      res.status(500).json({ error: "jira_context_failed", message: e?.message || String(e) });
    }
  });

  app.get("/api/ai-metrics", requirePolarisAuth, async (req: PolarisRequest, res: Response) => {
    try {
      const startDate = String(req.query.start_date || "");
      const endDate = String(req.query.end_date || "");
      const periodType = String(req.query.period_type || "");
      const jiraInstance = req.query.jira_instance ? String(req.query.jira_instance) : undefined;
      const jiraProject = req.query.jira_project ? String(req.query.jira_project) : undefined;

      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return res.status(400).json({ error: "bad_request", message: "start_date and end_date must be YYYY-MM-DD" });
      }
      if (startDate > endDate) {
        return res.status(400).json({ error: "bad_request", message: "start_date must be <= end_date" });
      }
      if (!VALID_PERIODS.has(periodType)) {
        return res.status(400).json({ error: "bad_request", message: "period_type must be daily | weekly | monthly" });
      }

      const payload = await buildAiMetricsResponse({ startDate, endDate, periodType, jiraInstance, jiraProject });
      res.json(payload);
    } catch (e: any) {
      console.error("[ai-metrics] failed:", e?.message || e);
      res.status(500).json({ error: "metrics_failed", message: e?.message || String(e) });
    }
  });

  // Internal admin: trigger a JIRA team sync for an instance + project (name/key).
  app.post(
    "/api/internal/jira-team-sync",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { jira_instance, jira_project } = req.body || {};
        if (!jira_instance) {
          return res.status(400).json({ error: "jira_instance is required" });
        }
        const result = await syncJiraTeam({ instanceUrl: jira_instance, project: jira_project });
        res.json({ ok: true, ...result });
      } catch (e: any) {
        res.status(500).json({ error: "sync_failed", message: e?.message || String(e) });
      }
    },
  );

  // Quality signal from the UI: call when the user accepts / edits / discards an
  // AI output (any surface). Maps to the most recent unrated row for the user, or
  // a specific correlation_id (= artifactId) when provided.
  app.post(
    "/api/ai-quality",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { decision, correlation_id, feature } = req.body || {};
        if (!["accepted", "modified", "rejected"].includes(decision)) {
          return res.status(400).json({ error: "decision must be accepted | modified | rejected" });
        }
        const affected = await markQualityAwait(decision, {
          correlationId: correlation_id,
          userId: (req as any).user?.id,
          feature,
        });
        res.json({ ok: true, updated: affected });
      } catch (e: any) {
        res.status(500).json({ error: "quality_failed", message: e?.message || String(e) });
      }
    },
  );

  // Internal admin / org-onboarding: sync ALL active JIRA projects (optionally one
  // instance). Call this when an org is added to fetch every project's members.
  app.post(
    "/api/internal/jira-sync-all",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { jira_instance } = req.body || {};
        const result = await syncAllProjects(jira_instance || undefined);
        res.json({ ok: true, ...result });
      } catch (e: any) {
        res.status(500).json({ error: "sync_all_failed", message: e?.message || String(e) });
      }
    },
  );

  // Internal admin: manually map a JIRA accountId -> users.id (sticky override).
  app.post(
    "/api/internal/jira-user-map",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { jira_instance, jira_account_id, user_id } = req.body || {};
        if (!jira_instance || !jira_account_id || !user_id) {
          return res
            .status(400)
            .json({ error: "jira_instance, jira_account_id, user_id are required" });
        }
        await setJiraUserOverride({
          instanceUrl: jira_instance,
          jiraAccountId: jira_account_id,
          userId: user_id,
          createdBy: (req as any).user?.id,
        });
        res.json({ ok: true });
      } catch (e: any) {
        res.status(500).json({ error: "map_failed", message: e?.message || String(e) });
      }
    },
  );

  // Internal admin: set a productivity target_saved_hours for a period.
  app.post(
    "/api/internal/productivity-target",
    autoBootstrapUser,
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { period_type, period_start, period_end, target_saved_hours } = req.body || {};
        if (!period_type || !period_start || !period_end || target_saved_hours == null) {
          return res.status(400).json({
            error: "period_type, period_start, period_end, target_saved_hours are required",
          });
        }
        await upsertProductivityTarget({
          periodType: period_type,
          periodStart: period_start,
          periodEnd: period_end,
          targetSavedHours: Number(target_saved_hours),
        });
        res.json({ ok: true });
      } catch (e: any) {
        res.status(500).json({ error: "target_failed", message: e?.message || String(e) });
      }
    },
  );
}
