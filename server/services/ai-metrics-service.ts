/**
 * buildAiMetricsResponse — assembles the Polaris /api/ai-metrics payload entirely
 * from universal_ai_usage_logs (+ jira_team_members, productivity_targets, users).
 *
 * NO tenant filtering anywhere (tenant_id is stored but never used to scope).
 * Claude-only: chatgpt_requests / custom_tool_requests are always 0.
 */
import { getPool } from "../db";
import { computeCacheSavingsUsd } from "../observability/ai-pricing";
import { getProductivityTarget } from "../observability/productivity";
import type { AiMetricsResponse, AiMetricsTeam, AiMetricsUser } from "../routes/metrics-contract";

const TIMEZONE = "Asia/Kolkata";

export interface BuildParams {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive)
  periodType: string; // daily | weekly | monthly
  jiraInstance?: string;
  jiraProject?: string;
}

export interface PolarisJiraContextInstance {
  org_name: string;
  url: string;
  projects: Array<{ project_name?: string }>;
}

export async function listPolarisJiraContexts(): Promise<PolarisJiraContextInstance[]> {
  const connectionRows = await q<{
    org_name: string | null;
    url: string | null;
  }>(
    `SELECT
        name AS org_name,
        TRIM(TRAILING '/' FROM instance_url) AS url
       FROM jira_connections
      WHERE is_active = 1
        AND instance_url IS NOT NULL
        AND TRIM(instance_url) <> ''
      ORDER BY updated_at DESC, created_at DESC`,
    [],
  );

  const instances: PolarisJiraContextInstance[] = [];
  const instanceByGroup = new Map<string, PolarisJiraContextInstance>();
  const projectNamesByGroup = new Map<string, Set<string>>();

  function ensureInstance(urlValue: string, orgNameValue?: string | null): PolarisJiraContextInstance | null {
    const url = normalizeInstanceUrl(urlValue);
    if (!url) return null;

    const orgName = String(orgNameValue || deriveOrgNameFromUrl(url)).trim();
    const key = contextGroupKey(orgName, url);
    const existing = instanceByGroup.get(key);
    if (existing) return existing;

    const instance: PolarisJiraContextInstance = { org_name: orgName, url, projects: [] };
    instanceByGroup.set(key, instance);
    projectNamesByGroup.set(key, new Set<string>());
    instances.push(instance);
    return instance;
  }

  for (const row of connectionRows) {
    ensureInstance(String(row.url || ""), row.org_name);
  }

  const projectRows = await q<{
    org_name: string | null;
    url: string | null;
    project_name: string | null;
  }>(
    `SELECT
        jc.name AS org_name,
        TRIM(TRAILING '/' FROM COALESCE(NULLIF(sp.jira_instance_url, ''), NULLIF(js.instance_url, ''), NULLIF(jc.instance_url, ''), NULLIF(sp.organization, ''))) AS url,
        COALESCE(MAX(NULLIF(jtm.project_name, '')), sp.name) AS project_name
       FROM sdlc_projects sp
       LEFT JOIN jira_settings js
         ON js.project_id = sp.id
        AND js.is_active = 1
       LEFT JOIN jira_connections jc
         ON (
              sp.jira_connection_id IS NOT NULL
              AND jc.id COLLATE utf8mb4_unicode_ci = sp.jira_connection_id COLLATE utf8mb4_unicode_ci
            )
         OR (
              sp.jira_connection_id IS NULL
              AND js.connection_id IS NOT NULL
              AND jc.id COLLATE utf8mb4_unicode_ci = js.connection_id COLLATE utf8mb4_unicode_ci
            )
       LEFT JOIN jira_team_members jtm
         ON LOWER(TRIM(TRAILING '/' FROM jtm.instance_url)) COLLATE utf8mb4_unicode_ci =
            LOWER(TRIM(TRAILING '/' FROM COALESCE(NULLIF(sp.jira_instance_url, ''), NULLIF(js.instance_url, ''), NULLIF(jc.instance_url, ''), NULLIF(sp.organization, '')))) COLLATE utf8mb4_unicode_ci
        AND COALESCE(NULLIF(sp.jira_project_key, ''), NULLIF(js.project_key, '')) IS NOT NULL
        AND LOWER(jtm.project_key) COLLATE utf8mb4_unicode_ci =
            LOWER(COALESCE(NULLIF(sp.jira_project_key, ''), NULLIF(js.project_key, ''))) COLLATE utf8mb4_unicode_ci
      WHERE LOWER(sp.integration_type) = 'jira'
        AND LOWER(sp.status) = 'active'
        AND COALESCE(NULLIF(sp.jira_instance_url, ''), NULLIF(js.instance_url, ''), NULLIF(jc.instance_url, ''), NULLIF(sp.organization, '')) IS NOT NULL
      GROUP BY sp.id, jc.name, sp.jira_instance_url, js.instance_url, jc.instance_url, sp.organization, sp.name, sp.updated_at, sp.created_at
      ORDER BY sp.updated_at DESC, sp.created_at DESC`,
    [],
  );

  for (const row of projectRows) {
    const url = String(row.url || "").trim();
    const projectName = String(row.project_name || "").trim();
    if (!url || !projectName) continue;

    const instance = ensureInstance(url, row.org_name);
    if (!instance) continue;

    const key = contextGroupKey(instance.org_name, instance.url);
    const projectNames = projectNamesByGroup.get(key) ?? new Set<string>();
    projectNamesByGroup.set(key, projectNames);

    const projectKey = projectName.toLowerCase();
    if (projectNames.has(projectKey)) continue;
    projectNames.add(projectKey);
    instance.projects.push({ project_name: projectName });
  }

  for (const instance of instances) {
    if (instance.projects.length === 0) {
      instance.projects = [{}];
    }
  }
  return instances;
}

function normalizeInstanceUrl(url: string): string {
  return String(url || "").trim().replace(/\/+$/, "");
}

function contextGroupKey(orgName: string, url: string): string {
  return `${orgName.toLowerCase()}\u0000${url.toLowerCase()}`;
}

function deriveOrgNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || url;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || url;
  }
}

// ── date helpers (UTC, plain YYYY-MM-DD) ──
function toDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}
function addMonths(s: string, n: number): string {
  const d = toDate(s);
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmt(d);
}

interface Windows {
  startExclusiveStart: string; // period start (inclusive)
  endExclusive: string; // period end (exclusive)
  prevStart: string;
  prevEndExclusive: string;
  prevEndDisplay: string;
  curWeekStart: string;
  curWeekEndExclusive: string;
  prevWeekStart: string;
  prevWeekEndExclusive: string;
}

function computeWindows(startDate: string, endDate: string, periodType: string): Windows {
  const endExclusive = addDays(endDate, 1);
  // Previous period
  let prevStart: string;
  const prevEndExclusive = startDate; // previous ends the day before the period starts
  if (periodType === "monthly") {
    prevStart = addMonths(startDate, -1);
  } else {
    const spanDays = Math.round((toDate(endExclusive).getTime() - toDate(startDate).getTime()) / 86400000);
    prevStart = addDays(startDate, -spanDays);
  }
  const prevEndDisplay = addDays(startDate, -1);
  // Current/previous week are relative to TODAY (the actual calendar week,
  // Monday→today), not the period — "current week" means now.
  const todayStr = fmt(new Date());
  const dow = toDate(todayStr).getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7;
  const monday = addDays(todayStr, -sinceMonday);
  const curWeekStart = monday;
  const curWeekEndExclusive = addDays(todayStr, 1); // through end of today
  const prevWeekStart = addDays(monday, -7);
  const prevWeekEndExclusive = monday;
  return {
    startExclusiveStart: startDate,
    endExclusive,
    prevStart,
    prevEndExclusive,
    prevEndDisplay,
    curWeekStart,
    curWeekEndExclusive,
    prevWeekStart,
    prevWeekEndExclusive,
  };
}

async function q<T = any>(sql: string, params: any[]): Promise<T[]> {
  const [rows]: any = await getPool().query(sql, params);
  return rows as T[];
}

const U = "universal_ai_usage_logs";

// Optional project filter: when a JIRA project is requested, the WHOLE response
// (usage/providers/tokens/cost/reliability/quality/use_cases/adoption) is scoped
// to that project's sdlc_projects.id via `AND project_id = ?`.
function projFilter(projectId: string | null): { clause: string; params: string[] } {
  return projectId ? { clause: " AND project_id = ?", params: [projectId] } : { clause: "", params: [] };
}

// Resolve a JIRA instance+project (key OR name) to our sdlc_projects.id — first
// from synced jira_team_members, else directly from sdlc_projects.
async function resolveProjectScope(jiraInstance: string, jiraProject: string): Promise<string | null> {
  const inst = (jiraInstance || "").replace(/\/+$/, "").trim().toLowerCase();
  const proj = (jiraProject || "").trim().toLowerCase();
  const r1 = await q(
    `SELECT MAX(project_id) AS pid FROM jira_team_members
      WHERE LOWER(TRIM(TRAILING '/' FROM instance_url)) = ?
        AND (LOWER(project_key) = ? OR LOWER(project_name) = ?)`,
    [inst, proj, proj],
  );
  if (r1[0]?.pid) return String(r1[0].pid);
  const r2 = await q(
    `SELECT id FROM sdlc_projects WHERE LOWER(jira_project_key) = ? OR LOWER(name) = ? LIMIT 1`,
    [proj, proj],
  );
  return r2[0]?.id ? String(r2[0].id) : null;
}

async function countInWindow(start: string, endExcl: string, projectId: string | null = null): Promise<number> {
  const pf = projFilter(projectId);
  const r = await q(`SELECT COUNT(*) AS c FROM ${U} WHERE created_at >= ? AND created_at < ?${pf.clause}`, [start, endExcl, ...pf.params]);
  return Number(r[0]?.c || 0);
}

async function distinctUsersInWindow(start: string, endExcl: string, projectId: string | null = null): Promise<number> {
  const pf = projFilter(projectId);
  const r = await q(
    `SELECT COUNT(DISTINCT user_id) AS c FROM ${U} WHERE user_id IS NOT NULL AND created_at >= ? AND created_at < ?${pf.clause}`,
    [start, endExcl, ...pf.params],
  );
  return Number(r[0]?.c || 0);
}

async function qualityScore(start: string, endExcl: string, projectId: string | null = null): Promise<number> {
  const pf = projFilter(projectId);
  const r = await q(
    `SELECT
       SUM(quality_decision='accepted') AS accepted,
       SUM(quality_decision='modified') AS modified,
       COUNT(*) AS total
     FROM ${U} WHERE created_at >= ? AND created_at < ?${pf.clause}`,
    [start, endExcl, ...pf.params],
  );
  const accepted = Number(r[0]?.accepted || 0);
  const modified = Number(r[0]?.modified || 0);
  const total = Number(r[0]?.total || 0);
  return total > 0 ? Math.round(((accepted + 0.5 * modified) / total) * 10000) / 100 : 0;
}

// Map a use_case (ACTION) to a Polaris use_case bucket. Driven by use_case, not
// feature_name, so e.g. a 'bug detection' action on the Backlog/Workflow screen
// still increments bug_detection_count.
function bucketForUseCase(useCase: string): keyof AiMetricsResponse["use_cases"] | null {
  const u = (useCase || "").toLowerCase();
  if (u.includes("bot quer")) return "bot_query_count";
  if (u.includes("bug detection")) return "bug_detection_count";
  if (u.includes("test plan") || u.includes("documentation") || u.includes("wiki") ||
      u.includes("brd") || u.includes("design")) return "documentation_generation_count";
  if (u.includes("artifact") || u.includes("test case") || u.includes("specs") ||
      u.includes("stack modernization")) return "artifact_generation_count";
  return null; // ai enhance / embedding / unknown → counted in totals, no named bucket
}

export async function buildAiMetricsResponse(params: BuildParams): Promise<AiMetricsResponse> {
  const w = computeWindows(params.startDate, params.endDate, params.periodType);
  const inPeriod: [string, string] = [w.startExclusiveStart, w.endExclusive];

  // When a JIRA project is requested, scope the WHOLE response to that project's
  // usage (project_id). Lazy re-sync first so membership + project_id are fresh.
  let projectScope: string | null = null;
  const scoped = !!(params.jiraInstance && params.jiraProject);
  if (scoped) {
    try {
      const { lazyResyncIfStale } = await import("../integrations/jira/team-sync-service");
      await lazyResyncIfStale(params.jiraInstance!, params.jiraProject!);
    } catch { /* non-fatal — serve existing mapping */ }
    projectScope = await resolveProjectScope(params.jiraInstance!, params.jiraProject!);
  }
  const pf = projFilter(projectScope);

  // ── usage / reliability counts ──
  const totalRequests = await countInWindow(...inPeriod, projectScope);
  const currentWeek = await countInWindow(w.curWeekStart, w.curWeekEndExclusive, projectScope);
  const previousWeek = await countInWindow(w.prevWeekStart, w.prevWeekEndExclusive, projectScope);

  // ── providers (grouped) ──
  const providerRows = await q(
    `SELECT provider,
            COUNT(*) AS requests,
            SUM(request_status='success') AS successful,
            SUM(request_status='failed') AS failed,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cache_tokens),0) AS cache_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd
     FROM ${U} WHERE created_at >= ? AND created_at < ?${pf.clause}
     GROUP BY provider`,
    [...inPeriod, ...pf.params],
  );
  const providers = providerRows.map((r) => ({
    provider: String(r.provider),
    requests: Number(r.requests),
    successful_requests: Number(r.successful),
    failed_requests: Number(r.failed),
    input_tokens: Number(r.input_tokens),
    output_tokens: Number(r.output_tokens),
    cache_tokens: Number(r.cache_tokens),
    cost_usd: Math.round(Number(r.cost_usd) * 1e6) / 1e6,
  }));

  // ── tokens / cost / reliability totals ──
  const totalsRow = (await q(
    `SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cache_tokens),0) AS cache_tokens,
            COALESCE(SUM(total_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd,
            SUM(request_status='success') AS successful,
            SUM(request_status='failed') AS failed
     FROM ${U} WHERE created_at >= ? AND created_at < ?${pf.clause}`,
    [...inPeriod, ...pf.params],
  ))[0];

  // ── quality (grouped) ──
  const qRow = (await q(
    `SELECT SUM(quality_decision='accepted') AS accepted,
            SUM(quality_decision='modified') AS modified,
            SUM(quality_decision='rejected') AS rejected,
            SUM(quality_decision='unrated') AS unrated,
            COUNT(*) AS total
     FROM ${U} WHERE created_at >= ? AND created_at < ?${pf.clause}`,
    [...inPeriod, ...pf.params],
  ))[0];
  const prevQualityScore = await qualityScore(w.prevStart, w.prevEndExclusive, projectScope);

  // ── use_cases (grouped by use_case ACTION) ──
  const useCaseRows = await q(
    `SELECT use_case AS use_case, COUNT(*) AS c
     FROM ${U} WHERE created_at >= ? AND created_at < ?${pf.clause}
     GROUP BY use_case`,
    [...inPeriod, ...pf.params],
  );
  const useCases = {
    bot_query_count: 0,
    artifact_generation_count: 0,
    bug_detection_count: 0,
    documentation_generation_count: 0,
    code_accepted_count: 0, // code-gen not logged
  };
  for (const r of useCaseRows) {
    const bucket = bucketForUseCase(String(r.use_case));
    if (bucket) useCases[bucket] += Number(r.c);
  }

  // ── adoption ── (active_users scoped to the project; eligible is org-wide)
  const activeUsers = await distinctUsersInWindow(...inPeriod, projectScope);
  const eligible = Number((await q(`SELECT COUNT(*) AS c FROM users WHERE is_deleted = 0`, []))[0]?.c || 0);
  const prevActiveUsers = await distinctUsersInWindow(w.prevStart, w.prevEndExclusive, projectScope);

  // ── productivity ──
  const targetSavedHours = await getProductivityTarget(params.periodType, params.startDate, params.endDate);

  // ── comparison ──
  const prevTotalRequests = await countInWindow(w.prevStart, w.prevEndExclusive, projectScope);

  // ── teams / users ──
  // Scoped (jira_instance+project): teams[] + project-scoped users[].
  // Unscoped: teams[] empty, users[] = all active users (team_id = null).
  let teams: AiMetricsTeam[] = [];
  let usersOut: AiMetricsUser[] = [];
  if (scoped) {
    ({ teams, users: usersOut } = await buildTeamsAndUsers(params, w, inPeriod));
  } else {
    usersOut = await buildGlobalUsers(w, inPeriod);
  }

  return {
    period: {
      start_date: params.startDate,
      end_date: params.endDate,
      period_type: params.periodType,
      timezone: TIMEZONE,
    },
    usage: {
      total_requests: totalRequests,
      chatgpt_requests: 0,
      claude_requests: totalRequests,
      custom_tool_requests: 0,
      current_week_requests: currentWeek,
      previous_week_requests: previousWeek,
    },
    providers,
    tokens: {
      input_tokens: Number(totalsRow.input_tokens),
      output_tokens: Number(totalsRow.output_tokens),
      cache_tokens: Number(totalsRow.cache_tokens),
      total_tokens: Number(totalsRow.total_tokens),
    },
    cost: {
      total_cost_usd: Math.round(Number(totalsRow.cost_usd) * 1e6) / 1e6,
      cache_savings_usd: computeCacheSavingsUsd({
        model: "claude-opus-4",
        cacheTokens: Number(totalsRow.cache_tokens),
      }),
      currency: "USD",
    },
    reliability: {
      total_requests: totalRequests,
      successful_requests: Number(totalsRow.successful || 0),
      failed_requests: Number(totalsRow.failed || 0),
    },
    quality: {
      accepted_outputs: Number(qRow.accepted || 0),
      modified_outputs: Number(qRow.modified || 0),
      rejected_outputs: Number(qRow.rejected || 0),
      unrated_outputs: Number(qRow.unrated || 0),
      total_outputs: Number(qRow.total || 0),
      previous_period_quality_score: prevQualityScore,
    },
    use_cases: useCases,
    adoption: {
      active_users: activeUsers,
      total_eligible_users: eligible,
      previous_period_active_users: prevActiveUsers,
    },
    productivity: { target_saved_hours: targetSavedHours },
    teams,
    users: usersOut,
    comparison: {
      previous_period_start_date: w.prevStart,
      previous_period_end_date: w.prevEndDisplay,
      previous_total_requests: prevTotalRequests,
      previous_quality_score: prevQualityScore,
      previous_active_users: prevActiveUsers,
    },
  };
}

/**
 * Global per-user breakdown (no JIRA scope): every user with activity in the
 * period, team_id = null. Lets unassigned users still appear in users[].
 */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Rich per-user breakdown over the period.
 *   scope = null            → all active users (global)
 *   scope = { projectId }   → usage generated FOR that project (project-wise)
 *   scope = { userIds }     → usage by those users
 * Only users with activity in the period are returned. Includes per-user provider
 * breakdown, tokens, cost, reliability, and name/email.
 */
async function buildUserRows(
  scope: { userIds?: string[]; projectId?: string } | null,
  teamId: string | null,
  teamName: string | null,
  w: Windows,
  inPeriod: [string, string],
): Promise<AiMetricsUser[]> {
  let scopeClause = "";
  let scopeParams: any[] = [];
  if (scope?.userIds) {
    if (scope.userIds.length === 0) return [];
    scopeClause = `AND user_id IN (${scope.userIds.map(() => "?").join(",")})`;
    scopeParams = scope.userIds;
  } else if (scope?.projectId) {
    scopeClause = `AND project_id = ?`;
    scopeParams = [scope.projectId];
  }

  const totals = await q(
    `SELECT user_id,
            COUNT(*) AS requests,
            SUM(request_status='success') AS successful,
            SUM(request_status='failed') AS failed,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cache_tokens),0) AS cache_tokens,
            COALESCE(SUM(total_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd,
            SUM(created_at >= ? AND created_at < ?) AS weekly_uses,
            DATE_FORMAT(MIN(created_at), '%Y-%m-%d') AS first_use,
            DATE_FORMAT(MAX(created_at), '%Y-%m-%d') AS last_use
       FROM ${U}
      WHERE user_id IS NOT NULL AND created_at >= ? AND created_at < ? ${scopeClause}
      GROUP BY user_id`,
    [w.curWeekStart, w.curWeekEndExclusive, inPeriod[0], inPeriod[1], ...scopeParams],
  );
  if (totals.length === 0) return [];

  const userIds = totals.map((t) => String(t.user_id));
  const ph = userIds.map(() => "?").join(",");

  // per-user × provider (apply the same project scope so numbers match the totals)
  const provProjClause = scope?.projectId ? "AND project_id = ?" : "";
  const provRows = await q(
    `SELECT user_id, provider,
            COUNT(*) AS requests,
            SUM(request_status='success') AS successful,
            SUM(request_status='failed') AS failed,
            COALESCE(SUM(input_tokens),0) AS input_tokens,
            COALESCE(SUM(output_tokens),0) AS output_tokens,
            COALESCE(SUM(cache_tokens),0) AS cache_tokens,
            COALESCE(SUM(total_tokens),0) AS total_tokens,
            COALESCE(SUM(cost_usd),0) AS cost_usd
       FROM ${U}
      WHERE user_id IN (${ph}) AND created_at >= ? AND created_at < ? ${provProjClause}
      GROUP BY user_id, provider`,
    [...userIds, inPeriod[0], inPeriod[1], ...(scope?.projectId ? [scope.projectId] : [])],
  );
  const provByUser = new Map<string, any[]>();
  for (const p of provRows) {
    const k = String(p.user_id);
    if (!provByUser.has(k)) provByUser.set(k, []);
    provByUser.get(k)!.push(p);
  }

  // names / emails (literal IN comparison is collation-safe)
  const nameRows = await q(`SELECT id, email, display_name FROM users WHERE id IN (${ph})`, userIds);
  const nameByUser = new Map<string, { email: string | null; name: string | null }>();
  for (const r of nameRows) nameByUser.set(String(r.id), { email: r.email ?? null, name: r.display_name ?? null });

  return totals.map((t) => {
    const id = String(t.user_id);
    const nm = nameByUser.get(id);
    return {
      user_id: id,
      user_name: nm?.name ?? undefined,
      email: nm?.email ?? undefined,
      team_id: teamId,
      team_name: teamName,
      weekly_ai_uses: Number(t.weekly_uses || 0),
      period_ai_uses: Number(t.requests || 0),
      total_requests: Number(t.requests || 0),
      successful_requests: Number(t.successful || 0),
      failed_requests: Number(t.failed || 0),
      input_tokens: Number(t.input_tokens),
      output_tokens: Number(t.output_tokens),
      cache_tokens: Number(t.cache_tokens),
      total_tokens: Number(t.total_tokens),
      total_cost_usd: round6(Number(t.cost_usd)),
      currency: "USD",
      providers: (provByUser.get(id) || []).map((p) => ({
        provider: String(p.provider),
        requests: Number(p.requests),
        successful_requests: Number(p.successful),
        failed_requests: Number(p.failed),
        input_tokens: Number(p.input_tokens),
        output_tokens: Number(p.output_tokens),
        cache_tokens: Number(p.cache_tokens),
        total_tokens: Number(p.total_tokens),
        cost_usd: round6(Number(p.cost_usd)),
      })),
      first_ai_use_date: t.first_use ? String(t.first_use) : null,
      last_ai_use_date: t.last_use ? String(t.last_use) : null,
    };
  });
}

async function buildGlobalUsers(w: Windows, inPeriod: [string, string]): Promise<AiMetricsUser[]> {
  return buildUserRows(null, null, null, w, inPeriod);
}

async function buildTeamsAndUsers(
  params: BuildParams,
  w: Windows,
  inPeriod: [string, string],
): Promise<{ teams: AiMetricsTeam[]; users: AiMetricsUser[] }> {
  const cleanInstance = (params.jiraInstance || "").replace(/\/+$/, "").trim().toLowerCase();
  const proj = (params.jiraProject || "").trim().toLowerCase();

  // Resolve the team(s) for instance + project (match key OR name). `project_id`
  // is our sdlc_projects.id — the same value tagged on usage rows generated FOR
  // the project. `total_members` is the JIRA roster (membership), unchanged.
  const teamRows = await q(
    `SELECT project_key,
            MAX(project_name) AS project_name,
            MAX(project_id)   AS project_id,
            COUNT(*)          AS total_members
       FROM jira_team_members
      WHERE LOWER(TRIM(TRAILING '/' FROM instance_url)) = ?
        AND (LOWER(project_key) = ? OR LOWER(project_name) = ?)
      GROUP BY project_key`,
    [cleanInstance, proj, proj],
  );
  if (teamRows.length === 0) return { teams: [], users: [] };

  const teams: AiMetricsTeam[] = [];
  const users: AiMetricsUser[] = [];

  for (const tr of teamRows) {
    const teamId = String(tr.project_key);
    const teamName = String(tr.project_name || teamId);
    const projectId = tr.project_id ? String(tr.project_id) : null;

    let activeUsers = 0, totalRequests = 0, accepted = 0, modified = 0, rejected = 0, cost = 0;

    // Project-wise: attribute usage by the project it was generated FOR
    // (universal_ai_usage_logs.project_id), not by team membership. So a BRD made
    // for this project counts ONLY here — no double-counting across a user's teams.
    if (projectId) {
      const agg = (await q(
        `SELECT COUNT(*) AS requests,
                COUNT(DISTINCT user_id) AS active_users,
                SUM(quality_decision='accepted') AS accepted,
                SUM(quality_decision='modified') AS modified,
                SUM(quality_decision='rejected') AS rejected,
                COALESCE(SUM(cost_usd),0) AS cost_usd
           FROM ${U}
          WHERE project_id = ? AND created_at >= ? AND created_at < ?`,
        [projectId, inPeriod[0], inPeriod[1]],
      ))[0];
      totalRequests = Number(agg.requests || 0);
      activeUsers = Number(agg.active_users || 0);
      accepted = Number(agg.accepted || 0);
      modified = Number(agg.modified || 0);
      rejected = Number(agg.rejected || 0);
      cost = round6(Number(agg.cost_usd || 0));

      const teamUsers = await buildUserRows({ projectId }, teamId, teamName, w, inPeriod);
      users.push(...teamUsers);
    }

    teams.push({
      team_id: teamId,
      team_name: teamName,
      active_users: activeUsers,
      total_members: Number(tr.total_members || 0),
      total_requests: totalRequests,
      accepted_outputs: accepted,
      modified_outputs: modified,
      rejected_outputs: rejected,
      cost_usd: cost,
    });
  }

  return { teams, users };
}
