import { parseQeApiJson, qeApiFetch } from "./qe-api-fetch";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface TmOverviewMetrics {
  totalRuns: number;
  executionsLast30?: number;
  passRate30: number;
  passedLast30: number;
  failedLast30: number;
  skippedLast30?: number;
  totalTests: number;
  flakyCount: number;
  suiteCount: number;
  requirementCount: number;
  linkedTests: number;
  requirementsWithCoverage?: number;
  coverage: number;
  avgDurationSec: number;
  lastRunAt: number | null;
}

export interface TmTrendPoint {
  date: string;
  passed: number;
  failed: number;
  skipped?: number;
  total: number;
  passRate: number | null;
}

export interface TmFlakinessEntry {
  testId: string;
  testName: string;
  stability: number;
  isFlaky: boolean;
  runCount: number;
  lastStatus: string;
  lastRunAt: number;
}

export interface TmHistoryEntry {
  id: string;
  testId: string;
  testName: string;
  suiteId?: string;
  status: string;
  duration: number;
  environment: string;
  errorMessage?: string;
  runAt: number;
  synthetic?: boolean;
}

export type TmOverviewData = {
  metrics: TmOverviewMetrics;
  trends: TmTrendPoint[];
  flakiness: TmFlakinessEntry[];
  history: TmHistoryEntry[];
  fetchedAt: number;
  source: "tm-api" | "legacy-fallback";
};

interface ExecutionRunRow {
  id: string;
  runName?: string | null;
  passedTests?: number | null;
  failedTests?: number | null;
  skippedTests?: number | null;
  duration?: number | null;
  createdAt?: string | Date | null;
  completedAt?: string | Date | null;
  startedAt?: string | Date | null;
}

function runTimestamp(run: ExecutionRunRow): number {
  const ts = run.completedAt ?? run.startedAt ?? run.createdAt;
  if (!ts) return Date.now();
  return new Date(ts).getTime();
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function executionRunsToHistory(runs: ExecutionRunRow[]): TmHistoryEntry[] {
  const out: TmHistoryEntry[] = [];
  for (const run of runs.slice(0, 200)) {
    const runAtBase = runTimestamp(run);
    const p = run.passedTests ?? 0;
    const f = run.failedTests ?? 0;
    const s = run.skippedTests ?? 0;
    if (p + f + s === 0) continue;

    const totalDur = run.duration ?? 0;
    const sliceDur = totalDur > 0 ? Math.max(1, Math.floor(totalDur / (p + f + s))) : 1000;
    const label = run.runName || run.id;

    for (let i = 0; i < p; i++) {
      out.push({
        id: `${run.id}-agg-p-${i}`,
        testId: `${run.id}:agg`,
        testName: `${label} (passed)`,
        status: "passed",
        duration: sliceDur,
        environment: "execution",
        runAt: runAtBase,
        synthetic: true,
      });
    }
    for (let i = 0; i < f; i++) {
      out.push({
        id: `${run.id}-agg-f-${i}`,
        testId: `${run.id}:agg`,
        testName: `${label} (failed)`,
        status: "failed",
        duration: sliceDur,
        environment: "execution",
        runAt: runAtBase,
        synthetic: true,
      });
    }
    for (let i = 0; i < s; i++) {
      out.push({
        id: `${run.id}-agg-s-${i}`,
        testId: `${run.id}:agg`,
        testName: `${label} (skipped)`,
        status: "skipped",
        duration: sliceDur,
        environment: "execution",
        runAt: runAtBase,
        synthetic: true,
      });
    }
  }
  return out.sort((a, b) => a.runAt - b.runAt);
}

function historyForTestStats(history: TmHistoryEntry[]): TmHistoryEntry[] {
  const real = history.filter((h) => !h.synthetic);
  return real.length > 0 ? real : history;
}

function computeFlakiness(testId: string, history: TmHistoryEntry[]): number {
  const last10 = history.filter((h) => h.testId === testId).slice(-10);
  if (last10.length === 0) return 0;
  const passed = last10.filter((h) => h.status === "passed").length;
  return Math.round((passed / last10.length) * 100);
}

function buildTrends(history: TmHistoryEntry[]): TmTrendPoint[] {
  const days: Record<string, { passed: number; failed: number; skipped: number; total: number }> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days[localDateKey(d)] = { passed: 0, failed: 0, skipped: 0, total: 0 };
  }

  for (const h of history) {
    const key = localDateKey(new Date(h.runAt));
    if (!days[key]) continue;
    days[key].total++;
    if (h.status === "passed") days[key].passed++;
    else if (h.status === "failed") days[key].failed++;
    else days[key].skipped++;
  }

  return Object.entries(days).map(([date, d]) => ({
    date,
    passed: d.passed,
    failed: d.failed,
    skipped: d.skipped,
    total: d.total,
    passRate: d.total > 0 ? Math.round((d.passed / d.total) * 100) : 0,
  }));
}

function buildMetrics(history: TmHistoryEntry[]): TmOverviewMetrics {
  const last30 = history.filter((h) => h.runAt > Date.now() - THIRTY_DAYS_MS);
  const passed30 = last30.filter((h) => h.status === "passed").length;
  const failed30 = last30.filter((h) => h.status === "failed").length;
  const skipped30 = last30.filter((h) => h.status === "skipped").length;
  const passRate30 = last30.length > 0 ? Math.round((passed30 / last30.length) * 100) : 0;

  const statsSource = historyForTestStats(history);
  const testIds = [...new Set(statsSource.map((h) => h.testId))];
  const flakyCount = testIds.filter((id) => {
    const s = computeFlakiness(id, statsSource);
    return s > 0 && s < 80;
  }).length;

  const withDuration = last30.filter((h) => h.duration > 0);
  const avgDurationSec =
    withDuration.length > 0
      ? Math.round(withDuration.reduce((a, b) => a + b.duration, 0) / withDuration.length / 1000)
      : 0;

  return {
    totalRuns: history.length,
    executionsLast30: last30.length,
    passRate30,
    passedLast30: passed30,
    failedLast30: failed30,
    skippedLast30: skipped30,
    totalTests: testIds.length,
    flakyCount,
    suiteCount: 0,
    requirementCount: 0,
    linkedTests: 0,
    requirementsWithCoverage: 0,
    coverage: 0,
    avgDurationSec,
    lastRunAt: history.length > 0 ? history[history.length - 1].runAt : null,
  };
}

function buildFlakiness(history: TmHistoryEntry[]): TmFlakinessEntry[] {
  const source = historyForTestStats(history);
  const testIds = [...new Set(source.map((h) => h.testId))];
  return testIds
    .map((testId) => {
      const entries = source.filter((h) => h.testId === testId);
      const last = entries[entries.length - 1];
      const stability = computeFlakiness(testId, source);
      return {
        testId,
        testName: last?.testName || testId,
        stability,
        isFlaky: stability > 0 && stability < 80,
        runCount: entries.length,
        lastStatus: last?.status || "unknown",
        lastRunAt: last?.runAt || 0,
      };
    })
    .sort((a, b) => a.stability - b.stability);
}

function emptyOverview(): TmOverviewData {
  const metrics: TmOverviewMetrics = {
    totalRuns: 0,
    executionsLast30: 0,
    passRate30: 0,
    passedLast30: 0,
    failedLast30: 0,
    skippedLast30: 0,
    totalTests: 0,
    flakyCount: 0,
    suiteCount: 0,
    requirementCount: 0,
    linkedTests: 0,
    requirementsWithCoverage: 0,
    coverage: 0,
    avgDurationSec: 0,
    lastRunAt: null,
  };
  return {
    metrics,
    trends: buildTrends([]),
    flakiness: [],
    history: [],
    fetchedAt: Date.now(),
    source: "legacy-fallback",
  };
}

async function resolveProjectId(
  projectId?: string,
  sdlcProjectId?: string,
): Promise<string | undefined> {
  if (projectId) return projectId;
  if (!sdlcProjectId) return undefined;

  const res = await qeApiFetch("/api/qe/project-list");
  if (!res.ok) return undefined;
  const projects = await parseQeApiJson<Array<{ id: string; devxSdlcProjectId?: string | null }>>(res);
  const match = projects.find((p) => p.devxSdlcProjectId === sdlcProjectId);
  return match?.id;
}

async function buildLegacyTmOverview(
  projectId?: string,
  sdlcProjectId?: string,
): Promise<TmOverviewData> {
  const resolvedProjectId = await resolveProjectId(projectId, sdlcProjectId);
  if (!resolvedProjectId) return emptyOverview();

  const res = await qeApiFetch(
    `/api/execution-runs?projectId=${encodeURIComponent(resolvedProjectId)}`,
  );
  if (!res.ok) return emptyOverview();

  const payload = await parseQeApiJson<{ success?: boolean; runs?: ExecutionRunRow[] }>(res);
  const history = executionRunsToHistory(payload.runs || []);
  if (history.length === 0) return emptyOverview();

  return {
    metrics: buildMetrics(history),
    trends: buildTrends(history),
    flakiness: buildFlakiness(history),
    history: [...history].slice(-50).reverse(),
    fetchedAt: Date.now(),
    source: "legacy-fallback",
  };
}

export async function fetchTmOverview(
  tmQuery: string,
  projectId?: string,
  sdlcProjectId?: string,
): Promise<TmOverviewData> {
  const url = `/api/tm/overview${tmQuery}${tmQuery ? "&" : "?"}_=${Date.now()}`;
  const res = await qeApiFetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });

  if (!res.ok) {
    return buildLegacyTmOverview(projectId, sdlcProjectId);
  }

  const data = await parseQeApiJson<{
    metrics?: TmOverviewMetrics;
    trends?: TmTrendPoint[];
    flakiness?: TmFlakinessEntry[];
    history?: TmHistoryEntry[];
    fetchedAt?: number;
  }>(res);

  if (!data?.metrics || typeof data.metrics.totalRuns !== "number") {
    return buildLegacyTmOverview(projectId, sdlcProjectId);
  }

  return {
    metrics: data.metrics,
    trends: Array.isArray(data.trends) ? data.trends : [],
    flakiness: Array.isArray(data.flakiness) ? data.flakiness : [],
    history: Array.isArray(data.history) ? data.history : [],
    fetchedAt: typeof data.fetchedAt === "number" ? data.fetchedAt : Date.now(),
    source: "tm-api",
  };
}
