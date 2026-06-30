/**
 * Unifies autonomous test cases from all generation pipelines for Execution Mode:
 * - /autonomous-testing → crawl_runs + automated_test_cases (main app DB)
 * - /functional-testing → auto_test_runs + auto_test_cases (QE DB)
 * - legacy functional_test_runs (QE storage)
 */
import { eq, desc, inArray, and, or, isNull, sql } from "drizzle-orm";
import { db as qeDb } from "./db";
import { db as appDb } from "../db";
import { autoTestRuns, autoTestCases } from "@shared/qe-schema";
import { crawlRuns, automatedTestCases } from "@shared/schema";
import type { FunctionalTestRun } from "@shared/qe-schema";

export interface ExecutionAutonomousTestCase {
  id: string;
  testCaseId: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  testSteps: Array<{ stepNumber: number; action: string; expectedResult: string }>;
  expectedResult: string;
  preconditions: string[];
  testData: null;
  testType: string;
  pageUrl?: string | null;
  source: "autonomous";
}

export interface ExecutionAutonomousRun {
  id: string;
  websiteUrl: string;
  domain: string;
  status: string;
  totalTestCases: number;
  createdAt: Date;
  completedAt: Date | null;
  projectId: string | null;
}

function mapAutoTestCase(tc: typeof autoTestCases.$inferSelect): ExecutionAutonomousTestCase {
  return {
    id: tc.id,
    testCaseId: tc.id,
    title: tc.title,
    description: tc.description || "",
    category: tc.category,
    priority: tc.priority || "P2",
    testSteps: (tc.steps || []).map((s: string, i: number) => ({
      stepNumber: i + 1,
      action: s,
      expectedResult: "",
    })),
    expectedResult: tc.expectedResult || "",
    preconditions: [],
    testData: null,
    testType: tc.category,
    pageUrl: tc.pageUrl,
    source: "autonomous",
  };
}

function mapCrawlTestCase(
  tc: typeof automatedTestCases.$inferSelect,
): ExecutionAutonomousTestCase {
  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  return {
    id: tc.id,
    testCaseId: tc.caseCode || tc.id,
    title: tc.title,
    description: "",
    category: normalizeCrawlCategory(tc.testType),
    priority: "P2",
    testSteps: steps.map((s, i) => ({
      stepNumber: i + 1,
      action: typeof s === "string" ? s : s.action || "",
      expectedResult: typeof s === "string" ? "" : s.expectedResult || "",
    })),
    expectedResult: "",
    preconditions: [],
    testData: null,
    testType: normalizeCrawlCategory(tc.testType),
    source: "autonomous",
  };
}

function normalizeCrawlCategory(testType: string): string {
  const t = (testType || "functional").toLowerCase();
  if (t === "ui" || t === "form_submit" || t === "navigation" || t === "action") return "functional";
  return t;
}

/** Load cases for a specific autonomous run id (crawl or auto_test), ignoring project scope. */
async function loadCasesForFunctionalRunId(
  functionalRunId: string,
): Promise<ExecutionAutonomousTestCase[]> {
  try {
    const [crawlRun] = await appDb
      .select()
      .from(crawlRuns)
      .where(eq(crawlRuns.id, functionalRunId))
      .limit(1);
    if (crawlRun) {
      const cases = await appDb
        .select()
        .from(automatedTestCases)
        .where(eq(automatedTestCases.crawlRunId, crawlRun.id));
      if (cases.length > 0) {
        return cases.map(mapCrawlTestCase);
      }
    }
  } catch (err) {
    console.warn("[autonomous-execution-bridge] direct crawl run lookup failed:", err);
  }

  const [autoRun] = await qeDb
    .select()
    .from(autoTestRuns)
    .where(eq(autoTestRuns.id, functionalRunId))
    .limit(1);
  if (autoRun) {
    const cases = await qeDb
      .select()
      .from(autoTestCases)
      .where(eq(autoTestCases.runId, autoRun.id));
    return cases.map(mapAutoTestCase);
  }

  return [];
}

async function loadAutoTestRunCases(
  projectId?: string,
  functionalRunId?: string,
  includeUnscopedRuns = true,
): Promise<ExecutionAutonomousTestCase[]> {
  // auto_test_runs are not linked to QE projects; omit them from strict project exports.
  if (projectId && !includeUnscopedRuns) {
    return [];
  }

  const autoRuns = await qeDb
    .select()
    .from(autoTestRuns)
    .where(eq(autoTestRuns.status, "done"))
    .orderBy(desc(autoTestRuns.createdAt))
    .limit(50);

  const out: ExecutionAutonomousTestCase[] = [];
  for (const run of autoRuns) {
    if (functionalRunId && functionalRunId !== "all" && run.id !== functionalRunId) continue;
    const cases = await qeDb.select().from(autoTestCases).where(eq(autoTestCases.runId, run.id));
    out.push(...cases.map(mapAutoTestCase));
  }
  return out;
}

async function loadCrawlRunCases(
  projectId?: string,
  functionalRunId?: string,
  includeUnscopedRuns = true,
): Promise<ExecutionAutonomousTestCase[]> {
  try {
    const conditions = [];
    if (projectId) {
      if (includeUnscopedRuns) {
        // Execution Mode: include unscoped crawls so SDLC/NAT runs still appear.
        conditions.push(or(eq(crawlRuns.projectId, projectId), isNull(crawlRuns.projectId)));
      } else {
        // Import/Export: only runs explicitly linked to the selected project.
        conditions.push(eq(crawlRuns.projectId, projectId));
      }
    }

    const runs = await appDb
      .select()
      .from(crawlRuns)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(crawlRuns.startedAt))
      .limit(50);

    const out: ExecutionAutonomousTestCase[] = [];
    for (const run of runs) {
      if (functionalRunId && functionalRunId !== "all" && run.id !== functionalRunId) continue;
      const cases = await appDb
        .select()
        .from(automatedTestCases)
        .where(eq(automatedTestCases.crawlRunId, run.id));
      if (cases.length === 0) continue;
      out.push(...cases.map(mapCrawlTestCase));
    }
    return out;
  } catch (err) {
    console.warn("[autonomous-execution-bridge] crawl run lookup failed:", err);
    return [];
  }
}

/** All autonomous test cases across pipelines (de-duplicated by id). */
export async function fetchAutonomousExecutionTestCases(options: {
  projectId?: string;
  functionalRunId?: string;
  /** When false and projectId is set, exclude global/unscoped autonomous runs. */
  includeUnscopedRuns?: boolean;
}): Promise<ExecutionAutonomousTestCase[]> {
  const { projectId, functionalRunId, includeUnscopedRuns = true } = options;

  if (functionalRunId && functionalRunId !== "all") {
    const direct = await loadCasesForFunctionalRunId(functionalRunId);
    if (direct.length > 0) {
      return direct;
    }
  }

  const [autoCases, crawlCases] = await Promise.all([
    loadAutoTestRunCases(projectId, functionalRunId, includeUnscopedRuns),
    loadCrawlRunCases(projectId, functionalRunId, includeUnscopedRuns),
  ]);

  const byId = new Map<string, ExecutionAutonomousTestCase>();
  for (const tc of [...autoCases, ...crawlCases]) {
    byId.set(tc.id, tc);
  }
  return Array.from(byId.values());
}

export async function fetchAutonomousExecutionRuns(
  projectId?: string,
  options?: { includeUnscopedRuns?: boolean },
): Promise<ExecutionAutonomousRun[]> {
  const includeUnscopedRuns = options?.includeUnscopedRuns ?? true;
  const runs: ExecutionAutonomousRun[] = [];

  if (!projectId || includeUnscopedRuns) {
    const autoRuns = await qeDb
      .select()
      .from(autoTestRuns)
      .where(eq(autoTestRuns.status, "done"))
      .orderBy(desc(autoTestRuns.createdAt))
      .limit(50);

    for (const run of autoRuns) {
      const cases = await qeDb.select().from(autoTestCases).where(eq(autoTestCases.runId, run.id));
      if (cases.length === 0) continue;
      runs.push({
        id: run.id,
        websiteUrl: run.url,
        domain: "general",
        status: "completed",
        totalTestCases: cases.length,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        projectId: null,
      });
    }
  }

  try {
    const conditions = [];
    if (projectId) {
      if (includeUnscopedRuns) {
        conditions.push(or(eq(crawlRuns.projectId, projectId), isNull(crawlRuns.projectId)));
      } else {
        conditions.push(eq(crawlRuns.projectId, projectId));
      }
    }

    const crawlRows = await appDb
      .select()
      .from(crawlRuns)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(crawlRuns.startedAt))
      .limit(50);

    for (const run of crawlRows) {
      const cases = await appDb
        .select({ count: sql<number>`count(*)` })
        .from(automatedTestCases)
        .where(eq(automatedTestCases.crawlRunId, run.id));
      const count = Number(cases[0]?.count ?? 0);
      if (count === 0) continue;
      runs.push({
        id: run.id,
        websiteUrl: run.baseUrl,
        domain: "general",
        status: run.status === "completed" ? "completed" : run.status,
        totalTestCases: count,
        createdAt: run.startedAt,
        completedAt: run.finishedAt,
        projectId: run.projectId,
      });
    }
  } catch (err) {
    console.warn("[autonomous-execution-bridge] crawl runs list failed:", err);
  }

  return runs;
}

export async function resolveAutonomousTestCasesByIds(
  ids: string[],
): Promise<
  Array<{
    testCaseId: string;
    title: string;
    category: string;
    priority: string;
    steps: Array<{ action: string; expected?: string }>;
  }>
> {
  if (ids.length === 0) return [];

  const resolved = new Map<
    string,
    {
      testCaseId: string;
      title: string;
      category: string;
      priority: string;
      steps: Array<{ action: string; expected?: string }>;
    }
  >();

  const autoRows = await qeDb
    .select()
    .from(autoTestCases)
    .where(inArray(autoTestCases.id, ids));
  for (const tc of autoRows) {
    resolved.set(tc.id, {
      testCaseId: tc.id,
      title: tc.title,
      category: tc.category,
      priority: tc.priority || "P2",
      steps: (tc.steps || []).map((s: string) => ({ action: s })),
    });
  }

  const missing = ids.filter((id) => !resolved.has(id));
  if (missing.length > 0) {
    try {
      const crawlRows = await appDb
        .select()
        .from(automatedTestCases)
        .where(inArray(automatedTestCases.id, missing));
      for (const tc of crawlRows) {
        const steps = Array.isArray(tc.steps) ? tc.steps : [];
        resolved.set(tc.id, {
          testCaseId: tc.id,
          title: tc.title,
          category: normalizeCrawlCategory(tc.testType),
          priority: "P2",
          steps: steps.map((s) => ({
            action: typeof s === "string" ? s : s.action || "",
            expected: typeof s === "string" ? undefined : s.expectedResult,
          })),
        });
      }
    } catch (err) {
      console.warn("[autonomous-execution-bridge] resolve crawl cases failed:", err);
    }
  }

  return ids.filter((id) => resolved.has(id)).map((id) => resolved.get(id)!);
}

export function mapLegacyFunctionalRunCases(
  testCases: Array<{
    id: string;
    name: string;
    objective?: string | null;
    category: string;
    priority?: string | null;
    testSteps?: Array<{ action: string; expectedResult?: string }> | null;
    expectedResult?: string | null;
    preconditions?: string[] | null;
    testData?: unknown;
  }>,
): ExecutionAutonomousTestCase[] {
  return testCases.map((tc) => ({
    id: tc.id,
    testCaseId: tc.id,
    title: tc.name,
    description: tc.objective || "",
    category: tc.category,
    priority: tc.priority || "P2",
    testSteps: (tc.testSteps || []).map((s, i) => ({
      stepNumber: i + 1,
      action: s.action,
      expectedResult: s.expectedResult || "",
    })),
    expectedResult: tc.expectedResult || "",
    preconditions: tc.preconditions || [],
    testData: null,
    testType: tc.category,
    source: "autonomous",
  }));
}

export function mergeLegacyFunctionalRuns(
  mappedAutoRuns: ExecutionAutonomousRun[],
  oldRuns: FunctionalTestRun[],
): ExecutionAutonomousRun[] {
  const seen = new Set(mappedAutoRuns.map((r) => r.id));
  const legacy = oldRuns
    .filter((r) => r.status === "completed" && (r.totalTestCases || 0) > 0 && !seen.has(r.id))
    .map((r) => ({
      id: r.id,
      websiteUrl: r.websiteUrl,
      domain: r.domain || "general",
      status: r.status,
      totalTestCases: r.totalTestCases || 0,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      projectId: r.projectId,
    }));
  return [...mappedAutoRuns, ...legacy];
}
