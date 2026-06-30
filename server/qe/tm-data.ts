/**
 * Test Management — aggregates execution history from multiple sources:
 * recorder-data/history.json, execution_runs (DB), and test-library.json last runs.
 */

import type { Request } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { gte, eq, desc } from 'drizzle-orm';
import { executionRuns } from '@shared/qe-schema';
import { projects } from '@shared/qe-schema';
import type { ExecutionRun, Project } from '@shared/qe-schema';
import { db } from './db';
import { storage } from './storage';
import { getRepoRoot } from '../utils/module-paths';

export interface TmHistoryEntry {
  id: string;
  testId: string;
  testName: string;
  suiteId?: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  environment: string;
  errorMessage?: string;
  screenshotPath?: string;
  videoPath?: string;
  runAt: number;
  nlSteps?: string[];
  synthetic?: boolean;
}

export interface TmProjectContext {
  projectId?: string;
  projectName?: string;
}

const THIRTY_DAYS_MS = 30 * 86400000;
const TEST_LIBRARY_FILE = path.join(getRepoRoot(), 'test-library.json');

async function safeDb<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn('[TM] DB query failed:', (err as Error)?.message);
    return fallback;
  }
}

export async function resolveTmProject(req: Request): Promise<TmProjectContext> {
  let projectId =
    typeof req.query.projectId === 'string' && req.query.projectId.trim()
      ? req.query.projectId.trim()
      : undefined;

  const sdlcProjectId =
    typeof req.query.sdlcProjectId === 'string' && req.query.sdlcProjectId.trim()
      ? req.query.sdlcProjectId.trim()
      : undefined;

  if (!projectId && sdlcProjectId) {
    const rows = await safeDb(
      () => db.select().from(projects).where(eq(projects.devxSdlcProjectId, sdlcProjectId)).limit(1),
      [] as typeof projects.$inferSelect[],
    );
    if (rows[0]?.id) projectId = rows[0].id;
  }

  if (!projectId) return {};

  const project = await safeDb(
    () => storage.getProjectById(projectId!),
    undefined as Project | undefined,
  );
  return { projectId, projectName: project?.name ?? undefined };
}

function historyFromTestLibrary(projectName?: string): TmHistoryEntry[] {
  if (!fs.existsSync(TEST_LIBRARY_FILE)) return [];
  try {
    const store = JSON.parse(fs.readFileSync(TEST_LIBRARY_FILE, 'utf8')) as {
      tests?: Array<{
        id: string;
        name: string;
        projectName?: string;
        lastRunStatus?: string;
        lastRunAt?: number | null;
        lastRunDuration?: number | null;
      }>;
    };
    const tests = store.tests ?? [];
    return tests
      .filter((t) => t.lastRunAt && t.lastRunStatus && t.lastRunStatus !== 'never')
      .filter((t) => {
        if (!projectName) return true;
        if (!t.projectName) return true;
        return t.projectName.toLowerCase() === projectName.toLowerCase();
      })
      .map((t) => ({
        id: `lib-${t.id}-${t.lastRunAt}`,
        testId: t.id,
        testName: t.name,
        status: (t.lastRunStatus === 'passed' ? 'passed' : t.lastRunStatus === 'skipped' ? 'skipped' : 'failed') as TmHistoryEntry['status'],
        duration: t.lastRunDuration ?? 0,
        environment: 'test-library',
        runAt: t.lastRunAt!,
      }));
  } catch (e) {
    console.warn('[TM] historyFromTestLibrary:', e);
    return [];
  }
}

function runAtMs(run: ExecutionRun): number {
  const ts = run.completedAt ?? run.startedAt ?? run.createdAt;
  if (!ts) return Date.now();
  return new Date(ts as Date).getTime();
}

function pushAggregateHistory(
  out: TmHistoryEntry[],
  run: ExecutionRun,
  runAtBase: number,
): boolean {
  const p = run.passedTests ?? 0;
  const f = run.failedTests ?? 0;
  const s = run.skippedTests ?? 0;
  if (p + f + s === 0) return false;

  const totalDur = run.duration ?? 0;
  const sliceDur =
    totalDur > 0 ? Math.max(1, Math.floor(totalDur / (p + f + s))) : 1000;
  const label = run.runName || run.id;

  for (let i = 0; i < p; i++) {
    out.push({
      id: `${run.id}-agg-p-${i}`,
      testId: `${run.id}:agg`,
      testName: `${label} (passed)`,
      status: 'passed',
      duration: sliceDur,
      environment: 'execution',
      runAt: runAtBase,
      synthetic: true,
    });
  }
  for (let i = 0; i < f; i++) {
    out.push({
      id: `${run.id}-agg-f-${i}`,
      testId: `${run.id}:agg`,
      testName: `${label} (failed)`,
      status: 'failed',
      duration: sliceDur,
      environment: 'execution',
      runAt: runAtBase,
      synthetic: true,
    });
  }
  for (let i = 0; i < s; i++) {
    out.push({
      id: `${run.id}-agg-s-${i}`,
      testId: `${run.id}:agg`,
      testName: `${label} (skipped)`,
      status: 'skipped',
      duration: sliceDur,
      environment: 'execution',
      runAt: runAtBase,
      synthetic: true,
    });
  }
  return true;
}

async function runsToHistory(runs: ExecutionRun[]): Promise<TmHistoryEntry[]> {
  const out: TmHistoryEntry[] = [];
  const maxRuns = 50;
  const maxDetailFetches = 10;
  let detailFetches = 0;

  for (const run of runs.slice(0, maxRuns)) {
    const runAtBase = runAtMs(run);
    const p = run.passedTests ?? 0;
    const f = run.failedTests ?? 0;
    const s = run.skippedTests ?? 0;

    // Fast path: row already has pass/fail/skip counts — skip N+1 DB lookups (avoids ALB/CloudFront timeouts).
    if (p + f + s > 0) {
      pushAggregateHistory(out, run, runAtBase);
      continue;
    }

    if (detailFetches >= maxDetailFetches) continue;
    detailFetches++;

    let full: Awaited<ReturnType<typeof storage.getExecutionRunById>>;
    try {
      full = await storage.getExecutionRunById(run.id);
    } catch (err) {
      console.warn('[TM] getExecutionRunById failed:', run.id, (err as Error)?.message);
      full = undefined;
    }

    if (full?.tests?.length) {
      for (const t of full.tests) {
        if (t.status === 'pending' || t.status === 'running') continue;
        const st: TmHistoryEntry['status'] =
          t.status === 'passed' ? 'passed' : t.status === 'skipped' ? 'skipped' : 'failed';
        const ts = t.completedAt ?? t.createdAt;
        const runAt = ts ? new Date(ts as Date).getTime() : runAtBase;
        out.push({
          id: `exec-${t.id}`,
          testId: t.testCaseId,
          testName: t.testName,
          status: st,
          duration: t.duration ?? 0,
          environment: 'execution',
          errorMessage: t.errorMessage ?? undefined,
          runAt,
        });
      }
    } else {
      pushAggregateHistory(out, run, runAtBase);
    }
  }
  return out;
}

async function historyFromExecutionRuns(projectId?: string): Promise<TmHistoryEntry[]> {
  try {
    if (projectId) {
      const scoped = await safeDb(
        () => storage.getExecutionRunsByProjectId(projectId),
        [] as ExecutionRun[],
      );
      if (scoped.length > 0) return runsToHistory(scoped.slice(0, 50));
    }
    const since = new Date(Date.now() - THIRTY_DAYS_MS);
    const all = await safeDb(
      () =>
        db
          .select()
          .from(executionRuns)
          .where(gte(executionRuns.createdAt, since))
          .orderBy(desc(executionRuns.createdAt))
          .limit(200),
      [] as ExecutionRun[],
    );
    return runsToHistory(all);
  } catch (e) {
    console.warn('[TM] historyFromExecutionRuns:', e);
    return [];
  }
}

export async function buildTmHistory(
  fileHistory: TmHistoryEntry[],
  req: Request,
): Promise<TmHistoryEntry[]> {
  try {
    const ctx = await resolveTmProject(req);
    const library = historyFromTestLibrary(ctx.projectName);
    const execution = await historyFromExecutionRuns(ctx.projectId);

    const byId = new Map<string, TmHistoryEntry>();
    for (const h of [...fileHistory, ...library, ...execution]) {
      byId.set(h.id, h);
    }
    return [...byId.values()].sort((a, b) => a.runAt - b.runAt);
  } catch (err) {
    console.warn('[TM] buildTmHistory failed:', (err as Error)?.message);
    return [...fileHistory].sort((a, b) => a.runAt - b.runAt);
  }
}

/** Local calendar date key (avoids UTC vs local mismatch dropping trend points). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildTrendsFromHistory(history: TmHistoryEntry[]) {
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
    if (h.status === 'passed') days[key].passed++;
    else if (h.status === 'failed') days[key].failed++;
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

export interface TmMetricsPayload {
  totalRuns: number;
  executionsLast30: number;
  passRate30: number;
  passedLast30: number;
  failedLast30: number;
  skippedLast30: number;
  totalTests: number;
  flakyCount: number;
  avgDurationSec: number;
  lastRunAt: number | null;
}

export function buildTmMetrics(
  history: TmHistoryEntry[],
  flakyCount: number,
  totalTests: number,
): TmMetricsPayload {
  const last30 = history.filter((h) => h.runAt > Date.now() - THIRTY_DAYS_MS);
  const passed30 = last30.filter((h) => h.status === 'passed').length;
  const failed30 = last30.filter((h) => h.status === 'failed').length;
  const skipped30 = last30.filter((h) => h.status === 'skipped').length;
  const passRate30 =
    last30.length > 0 ? Math.round((passed30 / last30.length) * 100) : 0;

  const withDuration = last30.filter((h) => h.duration > 0);
  const avgDurationSec =
    withDuration.length > 0
      ? Math.round(
          withDuration.reduce((a, b) => a + b.duration, 0) / withDuration.length / 1000,
        )
      : 0;

  return {
    totalRuns: history.length,
    executionsLast30: last30.length,
    passRate30,
    passedLast30: passed30,
    failedLast30: failed30,
    skippedLast30: skipped30,
    totalTests,
    flakyCount,
    avgDurationSec,
    lastRunAt: history.length > 0 ? history[history.length - 1].runAt : null,
  };
}

export function computeFlakiness(testId: string, history: TmHistoryEntry[]): number {
  const last10 = history.filter((h) => h.testId === testId).slice(-10);
  if (last10.length === 0) return 0;
  const passed = last10.filter((h) => h.status === 'passed').length;
  return Math.round((passed / last10.length) * 100);
}

/** Prefer real per-test rows; fall back to synthetic aggregates when that is all we have. */
export function historyForTestStats(history: TmHistoryEntry[]): TmHistoryEntry[] {
  const real = history.filter((h) => !h.synthetic);
  return real.length > 0 ? real : history;
}

export function computeTestCounts(history: TmHistoryEntry[]): {
  totalTests: number;
  flakyCount: number;
} {
  const source = historyForTestStats(history);
  const testIds = [...new Set(source.map((h) => h.testId))];
  const flakyCount = testIds.filter((id) => {
    const s = computeFlakiness(id, source);
    return s > 0 && s < 80;
  }).length;
  return { totalTests: testIds.length, flakyCount };
}

export function buildFlakinessReport(history: TmHistoryEntry[]) {
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
        lastStatus: last?.status,
        lastRunAt: last?.runAt,
      };
    })
    .sort((a, b) => a.stability - b.stability);
}

export interface TmOverviewPayload {
  metrics: TmMetricsPayload & {
    suiteCount: number;
    requirementCount: number;
    linkedTests: number;
    requirementsWithCoverage: number;
    coverage: number;
  };
  trends: ReturnType<typeof buildTrendsFromHistory>;
  flakiness: ReturnType<typeof buildFlakinessReport>;
  history: TmHistoryEntry[];
  fetchedAt: number;
}

export type TmOverviewRtmFields = {
  suiteCount: number;
  requirementCount: number;
  linkedTests: number;
  requirementsWithCoverage: number;
  coverage: number;
};

export function buildEmptyTmOverviewPayload(
  rtm: Partial<TmOverviewRtmFields> = {},
): TmOverviewPayload {
  const history: TmHistoryEntry[] = [];
  const { totalTests, flakyCount } = computeTestCounts(history);
  const core = buildTmMetrics(history, flakyCount, totalTests);
  return {
    metrics: {
      ...core,
      suiteCount: rtm.suiteCount ?? 0,
      requirementCount: rtm.requirementCount ?? 0,
      linkedTests: rtm.linkedTests ?? 0,
      requirementsWithCoverage: rtm.requirementsWithCoverage ?? 0,
      coverage: rtm.coverage ?? 0,
    },
    trends: buildTrendsFromHistory(history),
    flakiness: [],
    history: [],
    fetchedAt: Date.now(),
  };
}

export async function buildTmOverviewPayload(
  req: Request,
  fileHistory: TmHistoryEntry[],
  rtm: TmOverviewRtmFields,
): Promise<TmOverviewPayload> {
  const history = await buildTmHistory(fileHistory, req);
  const { totalTests, flakyCount } = computeTestCounts(history);
  const core = buildTmMetrics(history, flakyCount, totalTests);
  return {
    metrics: { ...core, ...rtm },
    trends: buildTrendsFromHistory(history),
    flakiness: buildFlakinessReport(history),
    history: [...history].slice(-50).reverse(),
    fetchedAt: Date.now(),
  };
}
