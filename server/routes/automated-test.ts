/**
 * Autonomous Automated Test Generation API.
 * Mount with: import { registerAutomatedTestRoutes } from "./routes/automated-test"; registerAutomatedTestRoutes(app);
 */

import { Router, type Request, type Response, type Express } from "express";
import { db } from "../db";
import {
  crawlRuns,
  automatedTestPages,
  pageDomVersions,
  pageForms,
  pageDomElements,
  automatedTestCases,
  automatedTestScripts,
  automatedTestRuns,
  automatedTestResults,
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import {
  runCrawl,
  getCrawlProgress,
  getLiveView,
  generateTestCasesForCrawlRun,
  generatePlaywrightScriptForCrawlRun,
  runTestsForCrawlRun,
  type StartCrawlBody,
} from "../services/automated-test";
import { parseRequirementsInput, detectFormat, type RequirementsFormat } from "../services/automated-test/input-parser";
import { classifyWebsite } from "../services/automated-test/website-classifier";
import { buildObjectRepository } from "../services/automated-test/object-repository";
import { reExtractDomForCrawlRun } from "../services/automated-test/orchestrator";
import { randomUUID } from "crypto";

const router = Router();

/** POST /api/automated-test/start-crawl */
router.post("/start-crawl", async (req: Request, res: Response) => {
  try {
    const body = req.body as StartCrawlBody;
    if (!body?.baseUrl?.trim()) {
      res.status(400).json({ error: "baseUrl is required" });
      return;
    }
    const crawlRunId = randomUUID();
    await db.insert(crawlRuns).values({
      id: crawlRunId,
      baseUrl: body.baseUrl.trim(),
      environment: body.environment ?? "default",
      userRole: body.userRole ?? "default",
      status: "pending",
      config: body.mode ? { mode: body.mode, authentication: body.authentication } : undefined,
      projectId: body.projectId ?? null,
      organizationId: body.organizationId ?? null,
    });
    runCrawl(crawlRunId, body).catch((err) => console.error("[automated-test] runCrawl error:", err));
    res.json({ crawlRunId });
  } catch (err: any) {
    console.error("[automated-test] start-crawl:", err);
    res.status(500).json({ error: err?.message ?? "Failed to start crawl" });
  }
});

/** GET /api/automated-test/crawl-progress/:crawlRunId */
router.get("/crawl-progress/:crawlRunId", async (req: Request, res: Response) => {
  try {
    const { crawlRunId } = req.params;
    const progress = await getCrawlProgress(crawlRunId);
    if (!progress) {
      res.status(200).json({
        status: "not_found",
        pagesDiscovered: 0,
        domsExtracted: 0,
        message: "Crawl run not found (may have been cleared or server restarted).",
      });
      return;
    }
    res.json(progress);
  } catch (err: any) {
    console.error("[automated-test] crawl-progress:", err);
    res.status(500).json({ error: err?.message ?? "Failed to get progress" });
  }
});

/** GET /api/automated-test/discovered-pages/:crawlRunId */
router.get("/discovered-pages/:crawlRunId", async (req: Request, res: Response) => {
  try {
    const { crawlRunId } = req.params;
    const pages = await db
      .select()
      .from(automatedTestPages)
      .where(eq(automatedTestPages.crawlRunId, crawlRunId))
      .orderBy(automatedTestPages.depth, automatedTestPages.createdAt);
    const withDomCount = await Promise.all(
      pages.map(async (p) => {
        const versions = await db.select().from(pageDomVersions).where(eq(pageDomVersions.pageId, p.id)).limit(1);
        return {
          id: p.id,
          url: p.sampleUrl,
          title: p.title,
          pageType: p.pageType,
          routePattern: p.routePattern,
          depth: p.depth,
          linkCount: p.linkCount,
          formCount: p.formCount,
          elementCount: p.elementCount,
          domCount: versions.length,
        };
      })
    );
    res.json(withDomCount);
  } catch (err: any) {
    console.error("[automated-test] discovered-pages:", err);
    res.status(500).json({ error: err?.message ?? "Failed to list pages" });
  }
});

/** GET /api/automated-test/page-dom/:pageId */
router.get("/page-dom/:pageId", async (req: Request, res: Response) => {
  try {
    const { pageId } = req.params;
    const [version] = await db
      .select()
      .from(pageDomVersions)
      .where(eq(pageDomVersions.pageId, pageId))
      .orderBy(desc(pageDomVersions.extractedAt))
      .limit(1);
    if (!version) {
      res.status(404).json({ error: "No DOM contract found for this page" });
      return;
    }
    res.json(version.domContract ?? {});
  } catch (err: any) {
    console.error("[automated-test] page-dom:", err);
    res.status(500).json({ error: err?.message ?? "Failed to get page DOM" });
  }
});

/** GET /api/automated-test/live-view/:crawlRunId — returns 200 with null payload when no view (avoids 404 during polling). */
router.get("/live-view/:crawlRunId", (req: Request, res: Response) => {
  const { crawlRunId } = req.params;
  const live = getLiveView(crawlRunId);
  res.status(200).json(live ?? { screenshotBase64: null, url: null });
});

/** GET /api/automated-test/crawl-runs */
router.get("/crawl-runs", async (req: Request, res: Response) => {
  try {
    const runs = await db.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(50);
    res.json(runs.map((r) => ({ id: r.id, status: r.status, startedAt: r.startedAt, baseUrl: r.baseUrl, pagesDiscovered: r.pagesDiscovered, domVersionsCreated: r.domVersionsCreated })));
  } catch (err: any) {
    console.error("[automated-test] crawl-runs:", err);
    res.status(500).json({ error: err?.message ?? "Failed to list runs" });
  }
});

/** POST /api/automated-test/generate-test-cases */
router.post("/generate-test-cases", async (req: Request, res: Response) => {
  try {
    const { crawlRunId, useLLM, testFocus, requirementsInput } = req.body as {
      crawlRunId?: string;
      useLLM?: boolean;
      testFocus?: string;
      requirementsInput?: { format?: RequirementsFormat; content?: string };
    };
    if (!crawlRunId) {
      res.status(400).json({ error: "crawlRunId is required" });
      return;
    }
    const reqInput =
      requirementsInput?.content?.trim()
        ? { format: requirementsInput.format ?? detectFormat(requirementsInput.content), content: requirementsInput.content }
        : undefined;
    const testCases = await generateTestCasesForCrawlRun(crawlRunId, useLLM !== false, testFocus || "all", reqInput);
    res.json({ testCases });
  } catch (err: any) {
    console.error("[automated-test] generate-test-cases error:", err);
    res.status(500).json({
      error: "Failed to generate test cases",
      details: err?.message || "Unknown error",
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
    });
  }
});

/** POST /api/automated-test/parse-requirements */
router.post("/parse-requirements", async (req: Request, res: Response) => {
  try {
    const { content, format } = req.body as { content?: string; format?: string };
    if (!content?.trim()) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    const resolvedFormat = (format as RequirementsFormat | undefined) ?? detectFormat(content);
    const result = await parseRequirementsInput(content, resolvedFormat);
    res.json(result);
  } catch (err: any) {
    console.error("[automated-test] parse-requirements:", err);
    res.status(500).json({ error: err?.message ?? "Failed to parse requirements" });
  }
});

/** GET /api/automated-test/test-cases/:crawlRunId */
router.get("/test-cases/:crawlRunId", async (req: Request, res: Response) => {
  try {
    const { crawlRunId } = req.params;
    const cases = await db
      .select()
      .from(automatedTestCases)
      .where(eq(automatedTestCases.crawlRunId, crawlRunId))
      .orderBy(automatedTestCases.caseCode);
    res.json(cases.map((c) => ({ id: c.id, crawlRunId: c.crawlRunId, pageId: c.pageId, caseCode: c.caseCode, title: c.title, testType: c.testType, steps: c.steps, createdAt: c.createdAt })));
  } catch (err: any) {
    console.error("[automated-test] test-cases:", err);
    res.status(500).json({ error: err?.message ?? "Failed to list test cases" });
  }
});

/** POST /api/automated-test/generate-scripts */
router.post("/generate-scripts", async (req: Request, res: Response) => {
  try {
    const { crawlRunId, useLLM } = req.body as { crawlRunId?: string; useLLM?: boolean };
    if (!crawlRunId) {
      res.status(400).json({ error: "crawlRunId is required" });
      return;
    }
    const [runRow] = await db.select({ baseUrl: crawlRuns.baseUrl }).from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
    const baseUrl = runRow?.baseUrl ?? "http://localhost:3000";
    const { fileName, scriptContent } = await generatePlaywrightScriptForCrawlRun(crawlRunId, baseUrl, useLLM !== false);
    await db.delete(automatedTestScripts).where(eq(automatedTestScripts.crawlRunId, crawlRunId));
    await db.insert(automatedTestScripts).values({ crawlRunId, fileName, scriptContent });
    const [row] = await db.select({ id: automatedTestScripts.id }).from(automatedTestScripts).where(eq(automatedTestScripts.crawlRunId, crawlRunId)).limit(1);
    res.json({ scriptId: row?.id, fileName, scriptContent, success: true });
  } catch (err: any) {
    console.error("[automated-test] generate-scripts error:", err);
    res.status(500).json({
      error: "Failed to generate scripts",
      details: err?.message || "Unknown error",
      stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
    });
  }
});

/** POST /api/automated-test/run-tests */
router.post("/run-tests", async (req: Request, res: Response) => {
  try {
    const { crawlRunId } = req.body as { crawlRunId?: string };
    if (!crawlRunId) {
      res.status(400).json({ error: "crawlRunId is required" });
      return;
    }
    const result = await runTestsForCrawlRun(crawlRunId);
    res.json(result);
  } catch (err: any) {
    console.error("[automated-test] run-tests:", err);
    res.status(500).json({ error: err?.message ?? "Failed to run tests" });
  }
});

/** GET /api/automated-test/test-results/:testRunId */
router.get("/test-results/:testRunId", async (req: Request, res: Response) => {
  try {
    const { testRunId } = req.params;
    const [runRow] = await db.select().from(automatedTestRuns).where(eq(automatedTestRuns.id, testRunId)).limit(1);
    if (!runRow) {
      res.status(404).json({ error: "Test run not found" });
      return;
    }
    const results = await db.select().from(automatedTestResults).where(eq(automatedTestResults.testRunId, testRunId));
    res.json({
      run: { id: runRow.id, crawlRunId: runRow.crawlRunId, status: runRow.status, totalTests: runRow.totalTests, passedCount: runRow.passedCount, failedCount: runRow.failedCount, startedAt: runRow.startedAt, finishedAt: runRow.finishedAt, errorMessage: runRow.errorMessage },
      results: results.map((r) => ({ id: r.id, testCaseId: r.testCaseId, caseCode: r.caseCode, status: r.status, severity: r.severity, errorMessage: r.errorMessage, durationMs: r.durationMs })),
    });
  } catch (err: any) {
    console.error("[automated-test] test-results:", err);
    res.status(500).json({ error: err?.message ?? "Failed to get test results" });
  }
});

/** POST /api/automated-test/classify-website */
router.post("/classify-website", async (req: Request, res: Response) => {
  try {
    const { crawlRunId } = req.body as { crawlRunId?: string };
    if (!crawlRunId) {
      res.status(400).json({ error: "crawlRunId is required" });
      return;
    }
    const result = await classifyWebsite(crawlRunId);
    res.json(result);
  } catch (err: any) {
    console.error("[automated-test] classify-website:", err);
    res.status(500).json({ error: err?.message ?? "Failed to classify website" });
  }
});

/** GET /api/automated-test/object-repo/:crawlRunId */
router.get("/object-repo/:crawlRunId", async (req: Request, res: Response) => {
  try {
    const { crawlRunId } = req.params;
    const repo = await buildObjectRepository(crawlRunId);
    res.json(repo);
  } catch (err: any) {
    console.error("[automated-test] object-repo:", err);
    res.status(500).json({ error: err?.message ?? "Failed to build object repository" });
  }
});

/** POST /api/automated-test/re-extract-dom/:crawlRunId
 * Clears failed/empty DOM contracts for the run and re-extracts them.
 * Useful when the initial extraction timed out (returns immediately; extraction runs in background).
 */
router.post("/re-extract-dom/:crawlRunId", async (req: Request, res: Response) => {
  try {
    const { crawlRunId } = req.params;
    const [run] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
    if (!run) {
      res.status(404).json({ error: "Crawl run not found" });
      return;
    }
    // Start re-extraction in background — respond immediately
    reExtractDomForCrawlRun(crawlRunId).catch((err: any) =>
      console.error("[re-extract-dom] Background error:", err?.message ?? err)
    );
    res.json({ success: true, message: "DOM re-extraction started in background" });
  } catch (err: any) {
    console.error("[automated-test] re-extract-dom:", err);
    res.status(500).json({ error: err?.message ?? "Failed to start re-extraction" });
  }
});

/** DELETE /api/automated-test/clear-all */
router.delete("/clear-all", async (req: Request, res: Response) => {
  try {
    await db.delete(automatedTestResults);
    await db.delete(automatedTestRuns);
    await db.delete(automatedTestScripts);
    await db.delete(automatedTestCases);
    await db.delete(pageDomElements);
    await db.delete(pageForms);
    await db.delete(pageDomVersions);
    await db.delete(automatedTestPages);
    await db.delete(crawlRuns);
    res.json({ success: true, message: "All automated test data cleared" });
  } catch (err: any) {
    console.error("[automated-test] clear-all:", err);
    res.status(500).json({ error: err?.message ?? "Failed to clear data" });
  }
});

export function registerAutomatedTestRoutes(app: Express): void {
  app.use("/api/automated-test", router);
}

export default router;
