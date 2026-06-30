/**
 * Orchestrator: accepts crawl requests, creates crawl_run, runs Page Discovery and DOM Intelligence in parallel.
 */

import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";
import { db } from "../../db";
import {
  crawlRuns,
  automatedTestPages,
  pageDomVersions,
} from "@shared/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { discoverPages } from "./page-discovery";
import { extractDomContractFromUrl } from "./dom-extractor";
import type { CrawlerModeConfig, AuthenticationConfig, StartCrawlBody } from "./config";
import { CRAWLER_MODE_CONFIG } from "./config";
import type { DomContract } from "./dom-extractor";

const RUNNING = "running";
const COMPLETED = "completed";
const FAILED = "failed";

export interface CrawlProgress {
  status: string;
  pagesDiscovered: number;
  domsExtracted: number;
  currentPage?: string;
  totalPages?: number;
  phase?: string;
  message?: string;
  errorMessage?: string;
}

export interface LiveViewResult {
  url?: string;
  screenshotBase64?: string;
}

let liveViewCache: Map<string, { url: string; screenshot?: string }> = new Map();

/**
 * Resolves the Chrome/Chromium executable path and whether @sparticuz/chromium
 * is providing the binary. Three-tier priority:
 *   1. PUPPETEER_EXECUTABLE_PATH env var (explicit override for Azure / CI)
 *   2. @sparticuz/chromium — Linux-only binary for Azure App Service / Lambda (skipped on Windows/macOS
 *      where executablePath() can point at a non-existent temp path and spawn fails with ENOENT)
 *   3. puppeteer.executablePath() — the Chromium bundled with the puppeteer package
 */
async function resolveChrome(): Promise<{ executablePath: string; useSparticuz: boolean }> {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log("[automated-test] Chrome: using PUPPETEER_EXECUTABLE_PATH →", process.env.PUPPETEER_EXECUTABLE_PATH);
    return { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, useSparticuz: false };
  }

  if (process.platform === "linux") {
    try {
      const sparticuzPath = await chromium.executablePath();
      if (sparticuzPath && existsSync(sparticuzPath)) {
        console.log("[automated-test] Chrome: using @sparticuz/chromium →", sparticuzPath);
        return { executablePath: sparticuzPath, useSparticuz: true };
      }
      if (sparticuzPath) {
        console.warn(
          "[automated-test] @sparticuz/chromium path missing on disk, falling back to bundled Chromium →",
          sparticuzPath,
        );
      }
    } catch (e: any) {
      console.warn("[automated-test] @sparticuz/chromium unavailable:", e?.message ?? e);
    }
  }

  const bundled = puppeteer.executablePath();
  console.log("[automated-test] Chrome: using Puppeteer bundled Chromium →", bundled);
  return { executablePath: bundled, useSparticuz: false };
}

async function buildLaunchOpts(): Promise<Parameters<typeof puppeteer.launch>[0]> {
  const { executablePath, useSparticuz } = await resolveChrome();

  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-accelerated-2d-canvas",
    "--disable-gpu",
    "--window-size=1280,720",
    "--ignore-certificate-errors",
  ];

  const args = useSparticuz
    ? [...new Set([...chromium.args, ...baseArgs])]
    : baseArgs;

  return {
    headless: useSparticuz ? chromium.headless : true,
    executablePath,
    args,
    ignoreHTTPSErrors: true,
  };
}

export function setLiveView(crawlRunId: string, url: string, screenshotBase64?: string): void {
  liveViewCache.set(crawlRunId, { url, screenshot: screenshotBase64 });
}

export function getLiveView(crawlRunId: string): LiveViewResult | null {
  const v = liveViewCache.get(crawlRunId);
  if (!v) return null;
  return { url: v.url, screenshotBase64: v.screenshot };
}

/** Use HTTP for well-known test domains to avoid SSL/cert issues in headless Chromium. */
function normalizeCrawlBaseUrl(url: string): string {
  const u = url.replace(/\/$/, "") || url;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname?.toLowerCase();
    if (host === "example.com" || host === "www.example.com") {
      return `http://${parsed.hostname || "example.com"}${parsed.pathname || ""}${parsed.search || ""}`.replace(/\/$/, "") || `http://${host}`;
    }
  } catch (_) {}
  return u;
}

export async function runCrawl(crawlRunId: string, body: StartCrawlBody): Promise<void> {
  const mode = body.mode || "quick";
  const config = CRAWLER_MODE_CONFIG[mode];
  const rawUrl = body.baseUrl.replace(/\/$/, "") || body.baseUrl;
  const baseUrl = normalizeCrawlBaseUrl(rawUrl);
  if (baseUrl !== rawUrl) {
    console.log("[automated-test] Using HTTP for test domain:", baseUrl);
  }
  const userRole = body.userRole || "default";
  const auth = body.authentication;

  console.log("[automated-test] Crawl started:", { crawlRunId, baseUrl, mode });

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    await db.update(crawlRuns).set({ status: RUNNING }).where(eq(crawlRuns.id, crawlRunId));

    browser = await puppeteer.launch(await buildLaunchOpts());
    console.log("[automated-test] Browser launched, starting page discovery for", baseUrl);

    const discoveryFinishedRef = { value: false };

    const discoveryPromise = discoverPages(
      browser,
      baseUrl,
      config,
      auth,
      userRole,
      crawlRunId,
      async (page) => {
        const pageType = (page as { pageType?: string }).pageType ?? "page";
        const pageSignatureHash = (page as { pageSignatureHash?: string }).pageSignatureHash ?? null;
        const existing = await db.select().from(automatedTestPages).where(
          and(
            eq(automatedTestPages.crawlRunId, crawlRunId),
            eq(automatedTestPages.routePattern, page.routePattern),
            eq(automatedTestPages.userRole, userRole)
          )
        ).limit(1);
        let id: string;
        if (existing.length > 0) {
          id = existing[0].id;
          await db.update(automatedTestPages).set({
            sampleUrl: page.url,
            title: page.title ?? null,
            pageType,
            pageSignatureHash,
            linkCount: page.linkCount,
            formCount: page.formCount,
          }).where(eq(automatedTestPages.id, id));
        } else {
          await db.insert(automatedTestPages).values({
            crawlRunId,
            pageType,
            routePattern: page.routePattern,
            sampleUrl: page.url,
            userRole,
            title: page.title ?? null,
            pageSignatureHash: pageSignatureHash ?? undefined,
            depth: page.depth,
            parentPageId: page.parentPageId ?? null,
            linkCount: page.linkCount,
            formCount: page.formCount,
            elementCount: 0,
          });
          const inserted = await db.select({ id: automatedTestPages.id }).from(automatedTestPages).where(
            and(eq(automatedTestPages.crawlRunId, crawlRunId), eq(automatedTestPages.routePattern, page.routePattern), eq(automatedTestPages.userRole, userRole))
          ).limit(1);
          id = inserted[0]?.id ?? crypto.randomUUID();
          const [run] = await db.select({ pagesDiscovered: crawlRuns.pagesDiscovered }).from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
          await db.update(crawlRuns).set({
            pagesDiscovered: (run?.pagesDiscovered ?? 0) + 1,
          }).where(eq(crawlRuns.id, crawlRunId));
        }
        return id;
      },
      (currentUrl, screenshotBase64) => setLiveView(crawlRunId, currentUrl, screenshotBase64)
    ).then(() => {
      discoveryFinishedRef.value = true;
    });

    const crawlStartTime = Date.now();
    const domWorker = async () => {
      const pollMs = config.domWorkerPollIntervalMs;
      let iterations = 0;
      while (iterations < config.maxDomWorkerIterations && Date.now() - crawlStartTime < config.maxCrawlDurationMs) {
        const run = await db.select().from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
        if (run[0]?.status !== RUNNING && run[0]?.status !== "running") break;

        const pages = await db.select().from(automatedTestPages).where(eq(automatedTestPages.crawlRunId, crawlRunId));
        const pageIds = pages.map((p) => p.id);
        const doneIds = new Set<string>();
        if (pageIds.length > 0) {
          const versions = await db.select({ pageId: pageDomVersions.pageId }).from(pageDomVersions).where(inArray(pageDomVersions.pageId, pageIds));
          versions.forEach((r) => doneIds.add(r.pageId));
        }
        const toProcess = pages.filter((p) => !doneIds.has(p.id));
        if (toProcess.length === 0 && discoveryFinishedRef.value) break;
        if (toProcess.length === 0) {
          await new Promise((r) => setTimeout(r, pollMs));
          iterations++;
          continue;
        }
        const page = toProcess[0];

        // Attempt DOM extraction with one automatic retry (5s delay) before giving up.
        let contract: Awaited<ReturnType<typeof extractDomContractFromUrl>> | null = null;
        let lastExtractErr: any = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            contract = await extractDomContractFromUrl(browser, page.sampleUrl, auth, config.domExtractionTimeoutMs);
            break;
          } catch (err: any) {
            lastExtractErr = err;
            console.warn(`[automated-test] DOM extract attempt ${attempt}/2 failed for`, page.sampleUrl, err?.message ?? err);
            if (attempt === 1) {
              // Wait 5s before retrying — gives rate-limited sites time to recover
              await new Promise((r) => setTimeout(r, 5000));
            }
          }
        }

        if (contract) {
          try {
            const elementCount = (contract.forms?.length ?? 0) * 2 + (contract.actions?.length ?? 0);
            await db.insert(pageDomVersions).values({
              pageId: page.id,
              versionNumber: 1,
              domContract: contract as unknown as Record<string, unknown>,
              extractedAt: new Date(),
            });
            await db.update(automatedTestPages).set({ elementCount }).where(eq(automatedTestPages.id, page.id));
            const [r] = await db.select({ domVersionsCreated: crawlRuns.domVersionsCreated }).from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
            await db.update(crawlRuns).set({ domVersionsCreated: (r?.domVersionsCreated ?? 0) + 1 }).where(eq(crawlRuns.id, crawlRunId));
          } catch (dbErr: any) {
            console.error("[automated-test] DOM insert failed", dbErr?.message ?? dbErr);
          }
        } else {
          // Both attempts failed — store empty fallback so the page isn't retried forever
          console.warn("[automated-test] DOM extract gave up for", page.sampleUrl, lastExtractErr?.message ?? lastExtractErr);
          try {
            const fallbackContract = { pageMeta: { title: "", url: page.sampleUrl }, forms: [], actions: [] };
            await db.insert(pageDomVersions).values({
              pageId: page.id,
              versionNumber: 1,
              domContract: fallbackContract as unknown as Record<string, unknown>,
              extractedAt: new Date(),
            });
            await db.update(automatedTestPages).set({ elementCount: 0 }).where(eq(automatedTestPages.id, page.id));
            const [r] = await db.select({ domVersionsCreated: crawlRuns.domVersionsCreated }).from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
            await db.update(crawlRuns).set({ domVersionsCreated: (r?.domVersionsCreated ?? 0) + 1 }).where(eq(crawlRuns.id, crawlRunId));
          } catch (fallbackErr: any) {
            console.error("[automated-test] Fallback DOM insert failed", fallbackErr?.message ?? fallbackErr);
          }
        }
        iterations++;
      }
    };

    await Promise.all([discoveryPromise, domWorker()]);
    const [runAfter] = await db.select({ pagesDiscovered: crawlRuns.pagesDiscovered }).from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
    await db.update(crawlRuns).set({
      status: COMPLETED,
      finishedAt: new Date(),
      errorMessage: (runAfter?.pagesDiscovered ?? 0) === 0 ? "Discovery finished with 0 pages. Check base URL and network." : null,
    }).where(eq(crawlRuns.id, crawlRunId));
    liveViewCache.delete(crawlRunId);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error("[automated-test] Crawl failed:", msg);
    await db.update(crawlRuns).set({
      status: FAILED,
      finishedAt: new Date(),
      errorMessage: msg,
    }).where(eq(crawlRuns.id, crawlRunId));
    liveViewCache.delete(crawlRunId);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
  }
}

/**
 * Re-extracts DOM contracts for pages whose previous extraction produced empty results
 * (elementCount = 0 or missing dom contract). Used to recover from timeout failures.
 */
export async function reExtractDomForCrawlRun(crawlRunId: string): Promise<void> {
  const pages = await db.select().from(automatedTestPages).where(eq(automatedTestPages.crawlRunId, crawlRunId));
  if (pages.length === 0) {
    console.log("[re-extract-dom] No pages found for run", crawlRunId);
    return;
  }

  // Find pages whose DOM contract is empty (forms=[] and actions=[])
  const pagesToRetry: typeof pages = [];
  for (const page of pages) {
    const [v] = await db
      .select({ domContract: pageDomVersions.domContract, id: pageDomVersions.id })
      .from(pageDomVersions)
      .where(eq(pageDomVersions.pageId, page.id))
      .orderBy(desc(pageDomVersions.extractedAt))
      .limit(1);
    const contract = v?.domContract as any;
    const hasData = (contract?.forms?.length ?? 0) > 0 || (contract?.actions?.length ?? 0) > 0;
    if (!hasData) {
      pagesToRetry.push(page);
      // Delete the empty record so the re-insertion works cleanly
      if (v?.id) {
        await db.delete(pageDomVersions).where(eq(pageDomVersions.id, v.id));
      }
    }
  }

  if (pagesToRetry.length === 0) {
    console.log("[re-extract-dom] All pages already have DOM contracts, nothing to retry");
    return;
  }

  console.log(`[re-extract-dom] Re-extracting DOM for ${pagesToRetry.length} pages in run ${crawlRunId}`);

  const browser = await puppeteer.launch(await buildLaunchOpts());
  try {
    for (const page of pagesToRetry) {
      let contract: DomContract | null = null;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          contract = await extractDomContractFromUrl(browser, page.sampleUrl, undefined, 60 * 1000);
          break;
        } catch (err: any) {
          lastErr = err;
          console.warn(`[re-extract-dom] Attempt ${attempt}/2 failed for ${page.sampleUrl}:`, err?.message ?? err);
          if (attempt === 1) await new Promise((r) => setTimeout(r, 5000));
        }
      }

      const toStore = contract ?? { pageMeta: { title: "", url: page.sampleUrl }, forms: [], actions: [] };
      const elementCount = (toStore.forms?.length ?? 0) * 2 + (toStore.actions?.length ?? 0);
      await db.insert(pageDomVersions).values({
        pageId: page.id,
        versionNumber: 1,
        domContract: toStore as unknown as Record<string, unknown>,
        extractedAt: new Date(),
      });
      await db.update(automatedTestPages).set({ elementCount }).where(eq(automatedTestPages.id, page.id));
      console.log(`[re-extract-dom] ${page.sampleUrl} → ${elementCount} elements`);
    }
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  console.log("[re-extract-dom] Done for run", crawlRunId);
}

export async function getCrawlProgress(crawlRunId: string): Promise<CrawlProgress | null> {
  const [run] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
  if (!run) return null;
  const totalPages = run.pagesDiscovered ?? 0;
  const live = getLiveView(crawlRunId);
  return {
    status: run.status,
    pagesDiscovered: run.pagesDiscovered ?? 0,
    domsExtracted: run.domVersionsCreated ?? 0,
    currentPage: live?.url,
    totalPages,
    phase: run.status === RUNNING ? "crawling" : run.status === COMPLETED ? "completed" : "failed",
    message: run.status === RUNNING ? `Discovered ${run.pagesDiscovered} pages, extracted ${run.domVersionsCreated} DOMs` : undefined,
    errorMessage: run.errorMessage ?? undefined,
  };
}
