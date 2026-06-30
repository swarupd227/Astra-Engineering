/**
 * NAT 2.0 — Reports & Analytics Aggregator
 *
 * Reads real data from MySQL (executionRuns, functionalTestRuns, projects) and
 * the test-library.json file used by the Recording Studio, rolls it up into
 * the shapes the Reports & Analytics frontend page expects, and exposes the
 * aggregations as HTTP endpoints filtered by the user-selected date range.
 *
 * All endpoints accept ?range=today|week|month|quarter. Anything else falls
 * back to 'week' so the page never crashes on a bad query string.
 *
 * Empty database returns zero counts (not 404s) so the UI can render a clean
 * empty state instead of an error.
 */

import type { Express, Request, Response } from 'express';
import { db } from './db';
import {
  executionRuns,
  executionRunTests,
  functionalTestRuns,
  functionalTestRunCases,
  autoTestRuns,
  autoTestCases,
  autoTestExecutions,
  sprintTestCases,
  projects,
} from '@shared/qe-schema';
import { gte, inArray } from 'drizzle-orm';
import { loadTests, buildCoverageReport } from './coverage';

// ─── Range helpers ────────────────────────────────────────────────────────────

type Range = 'today' | 'week' | 'month' | 'quarter';

const DAY_MS = 24 * 60 * 60 * 1000;

interface RangeWindow {
  range: Range;
  since: Date;
  previousSince: Date;     // start of the prior, equally-sized window (for deltas)
  buckets: number;         // number of buckets to emit on trend charts
  bucketMs: number;        // size of each bucket in milliseconds
  labelFormat: (d: Date) => string;
}

function parseRange(input: unknown): Range {
  const v = String(input || '').toLowerCase();
  if (v === 'today' || v === 'week' || v === 'month' || v === 'quarter') return v;
  return 'week';
}

function rangeToWindow(range: Range): RangeWindow {
  const now = Date.now();
  switch (range) {
    case 'today':
      return {
        range,
        since: new Date(now - DAY_MS),
        previousSince: new Date(now - 2 * DAY_MS),
        buckets: 24,
        bucketMs: 60 * 60 * 1000,
        labelFormat: (d) => `${d.getHours()}:00`,
      };
    case 'week':
      return {
        range,
        since: new Date(now - 7 * DAY_MS),
        previousSince: new Date(now - 14 * DAY_MS),
        buckets: 7,
        bucketMs: DAY_MS,
        labelFormat: (d) => d.toLocaleDateString('en-US', { weekday: 'short' }),
      };
    case 'month':
      return {
        range,
        since: new Date(now - 30 * DAY_MS),
        previousSince: new Date(now - 60 * DAY_MS),
        buckets: 30,
        bucketMs: DAY_MS,
        labelFormat: (d) => `${d.getMonth() + 1}/${d.getDate()}`,
      };
    case 'quarter':
      return {
        range,
        since: new Date(now - 90 * DAY_MS),
        previousSince: new Date(now - 180 * DAY_MS),
        buckets: 13,                       // ~13 weeks in a quarter
        bucketMs: 7 * DAY_MS,
        labelFormat: (d) => `Wk ${Math.ceil(d.getDate() / 7)} ${d.toLocaleDateString('en-US', { month: 'short' })}`,
      };
  }
}

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return Math.round(((current - previous) / previous) * 100);
}

const CATEGORY_PALETTE: Record<string, string> = {
  functional: '#f97316',
  workflow: '#3b82f6',
  negative: '#ef4444',
  edge: '#8b5cf6',
  textvalidation: '#06b6d4',
  security: '#06b6d4',
  accessibility: '#22c55e',
  smoke: '#eab308',
  content: '#a855f7',
  navigation: '#0ea5e9',
  form: '#14b8a6',
};

function normalizeCategory(raw: string | null | undefined): string {
  const cat = String(raw || 'functional').toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    edge_case: 'edge',
    edgecase: 'edge',
    text_validation: 'textvalidation',
    textvalidation: 'textvalidation',
  };
  return aliases[cat] || cat;
}

function formatCategoryLabel(key: string): string {
  const labels: Record<string, string> = {
    functional: 'Functional',
    workflow: 'Workflow',
    negative: 'Negative',
    edge: 'Edge Case',
    textvalidation: 'Text Validation',
    security: 'Security',
    accessibility: 'Accessibility',
    smoke: 'Smoke',
    content: 'Content',
    navigation: 'Navigation',
    form: 'Form',
  };
  return labels[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function incrementCategoryCounts(
  counts: Record<string, number>,
  items: Array<{ category?: string | null }>,
) {
  for (const item of items) {
    const key = normalizeCategory(item.category);
    counts[key] = (counts[key] || 0) + 1;
  }
}

function categoryCountsToChartData(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({
      name: formatCategoryLabel(name),
      value,
      color: CATEGORY_PALETTE[name] || '#94a3b8',
    }))
    .sort((a, b) => b.value - a.value);
}

// Bucket a list of timestamps into N evenly-spaced buckets ending at `now`.
function bucketize<T>(
  items: T[],
  getTs: (item: T) => number,
  win: RangeWindow,
): Array<{ label: string; bucketStart: number; items: T[] }> {
  const now = Date.now();
  const out: Array<{ label: string; bucketStart: number; items: T[] }> = [];
  for (let i = win.buckets - 1; i >= 0; i--) {
    const bucketStart = now - (i + 1) * win.bucketMs;
    const bucketEnd = now - i * win.bucketMs;
    const inBucket = items.filter((x) => {
      const ts = getTs(x);
      return ts >= bucketStart && ts < bucketEnd;
    });
    out.push({
      label: win.labelFormat(new Date(bucketStart)),
      bucketStart,
      items: inBucket,
    });
  }
  return out;
}

// ─── Safe DB helpers ──────────────────────────────────────────────────────────
// All DB calls are wrapped so a transient connection issue doesn't 500 the page.

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn('[reports] DB query failed, returning fallback:', (err as Error)?.message);
    return fallback;
  }
}

async function getExecutionRunsSince(since: Date) {
  return safe(
    () => db.select().from(executionRuns).where(gte(executionRuns.createdAt, since)),
    [] as any[],
  );
}

async function getFunctionalRunsSince(since: Date) {
  return safe(
    () => db.select().from(functionalTestRuns).where(gte(functionalTestRuns.createdAt, since)),
    [] as any[],
  );
}

async function getAllProjects() {
  return safe(() => db.select().from(projects), [] as any[]);
}

async function getFunctionalRunCasesByRunIds(runIds: string[]) {
  if (runIds.length === 0) return [] as any[];
  return safe(
    () => db.select().from(functionalTestRunCases).where(inArray(functionalTestRunCases.runId, runIds)),
    [] as any[],
  );
}

async function getExecutionRunTestsByRunIds(runIds: string[]) {
  if (runIds.length === 0) return [] as any[];
  return safe(
    () => db.select().from(executionRunTests).where(inArray(executionRunTests.runId, runIds)),
    [] as any[],
  );
}

async function getAutoTestRunsSince(since: Date) {
  return safe(
    () => db.select().from(autoTestRuns).where(gte(autoTestRuns.createdAt, since)),
    [] as any[],
  );
}

async function getAutoTestCasesByRunIds(runIds: string[]) {
  if (runIds.length === 0) return [] as any[];
  return safe(
    () => db.select().from(autoTestCases).where(inArray(autoTestCases.runId, runIds)),
    [] as any[],
  );
}

async function getAutoTestExecutionsSince(since: Date) {
  return safe(
    () => db.select().from(autoTestExecutions).where(gte(autoTestExecutions.executedAt, since)),
    [] as any[],
  );
}

async function getSprintTestCasesSince(since: Date) {
  return safe(
    () => db.select().from(sprintTestCases).where(gte(sprintTestCases.createdAt, since)),
    [] as any[],
  );
}

async function collectCategoryCountsSince(since: Date): Promise<Record<string, number>> {
  const [funcRuns, autoRuns, sprintCases] = await Promise.all([
    getFunctionalRunsSince(since),
    getAutoTestRunsSince(since),
    getSprintTestCasesSince(since),
  ]);
  const [funcCases, autoCases] = await Promise.all([
    getFunctionalRunCasesByRunIds(funcRuns.map((r: any) => r.id)),
    getAutoTestCasesByRunIds(autoRuns.map((r: any) => r.id)),
  ]);
  const counts: Record<string, number> = {};
  incrementCategoryCounts(counts, funcCases as any[]);
  incrementCategoryCounts(counts, autoCases as any[]);
  incrementCategoryCounts(counts, sprintCases as any[]);
  return counts;
}

function isInTimeWindow(ts: Date | string | null | undefined, since: Date, until?: Date): boolean {
  if (!ts) return false;
  const ms = new Date(ts).getTime();
  if (ms < since.getTime()) return false;
  if (until && ms >= until.getTime()) return false;
  return true;
}

async function countGeneratedTestCasesBetween(since: Date, until?: Date): Promise<number> {
  const [funcRuns, autoRuns, sprintCases] = await Promise.all([
    getFunctionalRunsSince(since),
    getAutoTestRunsSince(since),
    getSprintTestCasesSince(since),
  ]);
  const funcInWindow = funcRuns.filter((r: any) => isInTimeWindow(r.createdAt, since, until));
  const autoInWindow = autoRuns.filter((r: any) => isInTimeWindow(r.createdAt, since, until));
  const sprintInWindow = sprintCases.filter((c: any) => isInTimeWindow(c.createdAt, since, until));

  const funcRunAggregate = funcInWindow.reduce((sum: number, r: any) => sum + (r.totalTestCases || 0), 0);
  const [funcCases, autoCases] = await Promise.all([
    getFunctionalRunCasesByRunIds(funcInWindow.map((r: any) => r.id)),
    getAutoTestCasesByRunIds(autoInWindow.map((r: any) => r.id)),
  ]);
  const funcTotal = Math.max(funcRunAggregate, funcCases.length);
  return funcTotal + autoCases.length + sprintInWindow.length;
}

async function countGeneratedTestCasesSince(since: Date): Promise<number> {
  return countGeneratedTestCasesBetween(since);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerReportsRoutes(app: Express) {

  /**
   * GET /api/qe/reports/overview?range=...
   * KPIs for the four cards at the top of the Overview tab.
   */
  app.get('/api/qe/reports/overview', async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const win = rangeToWindow(range);

    const [testCasesGenerated, testCasesGeneratedPrev, execRuns, prevExecRuns, autoExecRuns, prevAutoExecRuns, library] =
      await Promise.all([
        countGeneratedTestCasesSince(win.since),
        countGeneratedTestCasesBetween(win.previousSince, win.since),
        getExecutionRunsSince(win.since),
        safe(() => db.select().from(executionRuns).where(gte(executionRuns.createdAt, win.previousSince)), [] as any[]),
        getAutoTestExecutionsSince(win.since),
        getAutoTestExecutionsSince(win.previousSince),
        Promise.resolve(loadTests()),
      ]);

    // Filter previous-window arrays so they only contain the OLDER half.
    const prevExecOlder = prevExecRuns.filter((r: any) => r.createdAt && new Date(r.createdAt).getTime() < win.since.getTime());
    const prevAutoExecOlder = prevAutoExecRuns.filter(
      (r: any) => r.executedAt && new Date(r.executedAt).getTime() < win.since.getTime(),
    );

    const executionsRun = execRuns.length + autoExecRuns.length;
    const executionsRunPrev = prevExecOlder.length + prevAutoExecOlder.length;

    const totalPassed =
      execRuns.reduce((sum: number, r: any) => sum + (r.passedTests || 0), 0) +
      autoExecRuns.reduce((sum: number, r: any) => sum + (r.passed || 0), 0);
    const totalFailed =
      execRuns.reduce((sum: number, r: any) => sum + (r.failedTests || 0), 0) +
      autoExecRuns.reduce((sum: number, r: any) => sum + (r.failed || 0), 0);
    const passRate = totalPassed + totalFailed > 0
      ? Math.round((totalPassed / (totalPassed + totalFailed)) * 1000) / 10
      : 0;
    const prevTotalPassed =
      prevExecOlder.reduce((sum: number, r: any) => sum + (r.passedTests || 0), 0) +
      prevAutoExecOlder.reduce((sum: number, r: any) => sum + (r.passed || 0), 0);
    const prevTotalFailed =
      prevExecOlder.reduce((sum: number, r: any) => sum + (r.failedTests || 0), 0) +
      prevAutoExecOlder.reduce((sum: number, r: any) => sum + (r.failed || 0), 0);
    const passRatePrev = prevTotalPassed + prevTotalFailed > 0
      ? Math.round((prevTotalPassed / (prevTotalPassed + prevTotalFailed)) * 1000) / 10
      : 0;

    // Coverage from the recorder test library.
    const coverageReport = buildCoverageReport(library);
    const coverage = Math.round(coverageReport.coveragePct * 10) / 10;

    res.json({
      range,
      testCasesGenerated,
      testCasesGeneratedDelta: percentDelta(testCasesGenerated, testCasesGeneratedPrev),
      executionsRun,
      executionsRunDelta: percentDelta(executionsRun, executionsRunPrev),
      passRate,
      passRateDelta: percentDelta(passRate, passRatePrev),
      coverage,
      coverageTarget: 85,
    });
  });

  /**
   * GET /api/qe/reports/trend?range=...
   * Two-line chart: test cases generated and executions run, bucketed.
   */
  app.get('/api/qe/reports/trend', async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const win = rangeToWindow(range);

    const [funcRuns, autoRuns, execRuns, autoExecRuns] = await Promise.all([
      getFunctionalRunsSince(win.since),
      getAutoTestRunsSince(win.since),
      getExecutionRunsSince(win.since),
      getAutoTestExecutionsSince(win.since),
    ]);

    const autoRunIds = autoRuns.map((r: any) => r.id);
    const autoCases = await getAutoTestCasesByRunIds(autoRunIds);
    const autoCasesByRun = new Map<string, any[]>();
    for (const c of autoCases as any[]) {
      const list = autoCasesByRun.get(c.runId) || [];
      list.push(c);
      autoCasesByRun.set(c.runId, list);
    }

    const generationEvents: Array<{ ts: number; count: number }> = [];
    for (const r of funcRuns as any[]) {
      const ts = new Date(r.createdAt).getTime();
      generationEvents.push({ ts, count: r.totalTestCases || 0 });
    }
    for (const r of autoRuns as any[]) {
      const ts = new Date(r.createdAt).getTime();
      generationEvents.push({ ts, count: (autoCasesByRun.get(r.id) || []).length });
    }

    const funcBuckets = bucketize(generationEvents, (e) => e.ts, win);
    const execBuckets = bucketize(
      [...(execRuns as any[]), ...(autoExecRuns as any[])],
      (r: any) => new Date(r.createdAt || r.executedAt).getTime(),
      win,
    );

    const data = funcBuckets.map((fb, i) => ({
      day: fb.label,
      testCases: fb.items.reduce((sum: number, e: { count: number }) => sum + e.count, 0),
      executions: execBuckets[i]?.items.length || 0,
    }));

    res.json({ range, data });
  });

  /**
   * GET /api/qe/reports/type-distribution?range=...
   * Pie chart: workflow / functional / negative / edge / textValidation counts.
   * Sources from functional_test_run_cases.category, which is the canonical
   * categorisation when test cases are generated.
   */
  app.get('/api/qe/reports/type-distribution', async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const win = rangeToWindow(range);

    const counts = await collectCategoryCountsSince(win.since);
    const data = categoryCountsToChartData(counts);

    res.json({ range, data });
  });

  /**
   * GET /api/qe/reports/execution-results?range=...
   * Bar chart: pass / fail / skip breakdown per project.
   */
  app.get('/api/qe/reports/execution-results', async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const win = rangeToWindow(range);

    const [execRuns, autoExecRuns, allProjects] = await Promise.all([
      getExecutionRunsSince(win.since),
      getAutoTestExecutionsSince(win.since),
      getAllProjects(),
    ]);

    const projectName = new Map<string, string>();
    for (const p of allProjects as any[]) projectName.set(p.id, p.name);

    const byProject = new Map<string, { passed: number; failed: number; skipped: number }>();
    for (const r of execRuns as any[]) {
      const key = r.projectId || 'unknown';
      const existing = byProject.get(key) || { passed: 0, failed: 0, skipped: 0 };
      existing.passed  += r.passedTests  || 0;
      existing.failed  += r.failedTests  || 0;
      existing.skipped += r.skippedTests || 0;
      byProject.set(key, existing);
    }
    if (autoExecRuns.length > 0) {
      const key = 'autonomous';
      const existing = byProject.get(key) || { passed: 0, failed: 0, skipped: 0 };
      for (const r of autoExecRuns as any[]) {
        existing.passed += r.passed || 0;
        existing.failed += r.failed || 0;
        existing.skipped += r.skipped || 0;
      }
      byProject.set(key, existing);
    }

    const data = Array.from(byProject.entries())
      .map(([projectId, counts]) => ({
        project: projectId === 'autonomous'
          ? 'Autonomous Testing'
          : (projectName.get(projectId) || 'Untitled Project'),
        ...counts,
      }))
      .filter((r) => r.passed + r.failed + r.skipped > 0)
      .sort((a, b) => (b.passed + b.failed + b.skipped) - (a.passed + a.failed + a.skipped));

    res.json({ range, data });
  });

  /**
   * GET /api/qe/reports/execution-summary?range=...
   * Three KPIs at the top of the Execution Reports tab.
   */
  app.get('/api/qe/reports/execution-summary', async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const win = rangeToWindow(range);

    const [execRuns, autoExecRuns] = await Promise.all([
      getExecutionRunsSince(win.since),
      getAutoTestExecutionsSince(win.since),
    ]);

    let totalRuns = execRuns.length + autoExecRuns.length;
    let passed = 0, failed = 0, skipped = 0;
    let totalDurationMs = 0, runsWithDuration = 0;
    for (const r of execRuns as any[]) {
      passed  += r.passedTests  || 0;
      failed  += r.failedTests  || 0;
      skipped += r.skippedTests || 0;
      if (typeof r.duration === 'number' && r.duration > 0) {
        totalDurationMs += r.duration;
        runsWithDuration++;
      }
    }
    for (const r of autoExecRuns as any[]) {
      passed += r.passed || 0;
      failed += r.failed || 0;
      skipped += r.skipped || 0;
      if (r.completedAt && r.executedAt) {
        const durationMs = new Date(r.completedAt).getTime() - new Date(r.executedAt).getTime();
        if (durationMs > 0) {
          totalDurationMs += durationMs;
          runsWithDuration++;
        }
      }
    }

    const avgDurationMs = runsWithDuration > 0 ? Math.round(totalDurationMs / runsWithDuration) : 0;
    const avgDurationLabel = avgDurationMs === 0
      ? '—'
      : avgDurationMs < 60000
        ? `${(avgDurationMs / 1000).toFixed(1)}s`
        : `${Math.floor(avgDurationMs / 60000)}m ${Math.round((avgDurationMs % 60000) / 1000)}s`;

    res.json({
      range,
      totalRuns,
      passed,
      failed,
      skipped,
      avgDurationMs,
      avgDurationLabel,
    });
  });

  /**
   * GET /api/qe/reports/execution-history?range=...&limit=20
   * Table rows for the "Execution History" panel.
   */
  app.get('/api/qe/reports/execution-history', async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const win = rangeToWindow(range);
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit ?? '20'), 10) || 20));

    const [execRuns, autoExecRuns, allProjects] = await Promise.all([
      getExecutionRunsSince(win.since),
      getAutoTestExecutionsSince(win.since),
      getAllProjects(),
    ]);

    const projectName = new Map<string, string>();
    for (const p of allProjects as any[]) projectName.set(p.id, p.name);

    const formatDuration = (durationMs: number) =>
      durationMs === 0
        ? '—'
        : durationMs < 60000
          ? `${(durationMs / 1000).toFixed(1)}s`
          : `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`;

    const execRows = (execRuns as any[]).map((r: any) => ({
      id: r.id,
      sortTs: new Date(r.createdAt).getTime(),
      date: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
      project: projectName.get(r.projectId) || 'Untitled Project',
      source: r.executionMode === 'headed' ? 'Autonomous' : 'User Stories',
      tests: r.totalTests || 0,
      passed: r.passedTests || 0,
      failed: r.failedTests || 0,
      duration: formatDuration(r.duration || 0),
      status: r.status,
    }));

    const autoRows = (autoExecRuns as any[]).map((r: any) => {
      const durationMs =
        r.completedAt && r.executedAt
          ? new Date(r.completedAt).getTime() - new Date(r.executedAt).getTime()
          : 0;
      return {
        id: r.id,
        sortTs: new Date(r.executedAt).getTime(),
        date: r.executedAt ? new Date(r.executedAt).toISOString().slice(0, 10) : '',
        project: 'Autonomous Testing',
        source: 'Autonomous',
        tests: r.total || 0,
        passed: r.passed || 0,
        failed: r.failed || 0,
        duration: formatDuration(durationMs),
        status: r.status,
      };
    });

    const data = [...execRows, ...autoRows]
      .sort((a, b) => b.sortTs - a.sortTs)
      .slice(0, limit)
      .map(({ sortTs: _sortTs, ...row }) => row);

    res.json({ range, data });
  });

  /**
   * GET /api/qe/reports/coverage-by-project?range=...
   * Coverage tab: per-project rollup.
   * Coverage % is computed from the recorder test library (pages-covered ratio).
   */
  app.get('/api/qe/reports/coverage-by-project', async (req: Request, res: Response) => {
    const range = parseRange(req.query.range);
    const win = rangeToWindow(range);

    const [funcRuns, autoRuns, allProjects] = await Promise.all([
      getFunctionalRunsSince(win.since),
      getAutoTestRunsSince(win.since),
      getAllProjects(),
    ]);

    const projectName = new Map<string, string>();
    for (const p of allProjects as any[]) projectName.set(p.id, p.name);

    const autoRunIds = autoRuns.map((r: any) => r.id);
    const autoCases = await getAutoTestCasesByRunIds(autoRunIds);
    const autoCasesByRun = new Map<string, number>();
    for (const c of autoCases as any[]) {
      autoCasesByRun.set(c.runId, (autoCasesByRun.get(c.runId) || 0) + 1);
    }

    // Roll up functional runs by project: count of distinct stories
    // (functional runs ~= one user story or one website per run), and total
    // test cases generated. Coverage % is best-effort — falls back to the
    // global recorder coverage if we have no per-project signal.
    const recorderCoverage = buildCoverageReport(loadTests()).coveragePct;

    const byProject = new Map<string, { stories: number; testCases: number }>();
    for (const r of funcRuns as any[]) {
      const key = r.projectId || 'unknown';
      const existing = byProject.get(key) || { stories: 0, testCases: 0 };
      existing.stories += 1;
      existing.testCases += r.totalTestCases || 0;
      byProject.set(key, existing);
    }
    if (autoRuns.length > 0) {
      const key = 'autonomous';
      const existing = byProject.get(key) || { stories: 0, testCases: 0 };
      existing.stories += autoRuns.length;
      existing.testCases += autoCases.length;
      byProject.set(key, existing);
    }

    const data = Array.from(byProject.entries())
      .map(([projectId, counts]) => ({
        project: projectId === 'autonomous'
          ? 'Autonomous Testing'
          : (projectName.get(projectId) || 'Untitled Project'),
        source: 'Autonomous',
        stories: counts.stories,
        testCases: counts.testCases,
        coverage: Math.round(recorderCoverage),
      }))
      .sort((a, b) => b.testCases - a.testCases);

    res.json({ range, data });
  });

  /**
   * GET /api/qe/reports/coverage-summary
   * KPIs at the top of the Coverage Reports tab. Not date-filtered — coverage
   * is a current-state metric, not a range metric.
   */
  app.get('/api/qe/reports/coverage-summary', async (_req: Request, res: Response) => {
    const library = loadTests();
    const cov = buildCoverageReport(library);

    res.json({
      overallCoverage: Math.round(cov.coveragePct * 10) / 10,
      userStoriesCovered: cov.coveredPages,
      userStoriesTotal: cov.totalDiscoveredPages,
      testCases: cov.totalTests,
      coverageGaps: cov.uncoveredPages.length,
    });
  });

  console.log('[reports] Routes registered: /api/qe/reports/{overview,trend,type-distribution,execution-results,execution-summary,execution-history,coverage-by-project,coverage-summary}');
}
