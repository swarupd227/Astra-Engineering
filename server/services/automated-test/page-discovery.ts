/**
 * Page Discovery Agent: crawl with Puppeteer, optional auth, signature-based dedupe,
 * route pattern normalization, navigational extraction (scroll, expand, data-href), retries.
 */

import puppeteer, { type Browser, type Page } from "puppeteer";
import type { CrawlerModeConfig } from "./config";
import type { AuthenticationConfig } from "./config";
import { createHash } from "crypto";

export interface DiscoveredPage {
  id: string;
  url: string;
  title?: string;
  routePattern: string;
  pageType: string;
  depth: number;
  linkCount: number;
  formCount: number;
  parentPageId?: string;
  pageSignatureHash?: string;
}

export interface PageDiscoveryResult {
  pages: DiscoveredPage[];
  currentUrl?: string;
  currentScreenshotBase64?: string;
}

function normalizeUrl(u: string, base?: string): string {
  try {
    const resolved = base ? new URL(u, base) : new URL(u);
    resolved.hash = "";
    return resolved.toString().replace(/\/$/, "") || "/";
  } catch {
    return u;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_REGEX = /^\d+$/;

/** Replace numeric path segments with :id, UUID-like with :uuid, long alphanumeric (20+) with :hash. */
function getRoutePattern(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "") || "/";
    const parts = path.split("/").filter(Boolean);
    const out = parts.map((seg) => {
      if (NUMERIC_REGEX.test(seg)) return ":id";
      if (seg.length >= 32 && UUID_REGEX.test(seg)) return ":uuid";
      if (seg.length >= 20 && /^[a-zA-Z0-9_.-]+$/.test(seg)) return ":hash";
      return seg;
    });
    return "/" + out.join("/");
  } catch {
    return url;
  }
}

/** Infer page type from URL, title, h1 (e.g. cart, checkout, login). Fallback: route with slashes → underscores. */
function inferPageType(url: string, title: string, h1: string, routePattern: string): string {
  const lower = `${(url || "").toLowerCase()} ${(title || "").toLowerCase()} ${(h1 || "").toLowerCase()}`;
  if (/\bcart\b/.test(lower)) return "cart";
  if (/\bcheckout\b/.test(lower)) return "checkout";
  if (/\blogin\b|sign\s*in|signin\b/.test(lower)) return "login";
  if (/\blogout\b|sign\s*out/.test(lower)) return "logout";
  if (/\bregister\b|sign\s*up|signup\b/.test(lower)) return "register";
  if (/\bhome\b|dashboard\b/.test(lower)) return "home";
  if (/\bproduct\b|detail\b/.test(lower)) return "product";
  if (/\blist\b|search\b|browse\b/.test(lower)) return "list";
  if (routePattern && routePattern !== "/") {
    return routePattern.replace(/^\//, "").replace(/\//g, "_").replace(/:/g, "") || "page";
  }
  return "page";
}

/** Stable signature: title, h1, first 3 CTAs sorted, route. Hash for in-memory dedupe. */
function pageSignatureHash(sig: { title: string; h1: string; primaryCta: string[]; route: string }): string {
  const stable = JSON.stringify({
    title: (sig.title || "").trim().slice(0, 200),
    h1: (sig.h1 || "").trim().slice(0, 200),
    primaryCta: (sig.primaryCta || []).slice(0, 3).sort(),
    route: sig.route || "",
  });
  return createHash("sha256").update(stable).digest("hex");
}

/** Extract a readable message from any thrown value (Error.message, cause, or string). */
function getErrorMessage(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message?.trim();
    if (msg) return msg;
    const cause = (e as any).cause;
    if (cause instanceof Error && cause.message?.trim()) return cause.message.trim();
    if (typeof cause === "string") return cause;
  }
  const o = e as Record<string, unknown>;
  if (o && typeof o.message === "string" && o.message.trim()) return o.message.trim();
  if (o && typeof o.description === "string" && o.description.trim()) return o.description.trim();
  if (typeof e === "string" && e.trim()) return e.trim();
  // Fallback: stringify object to capture any message-like property (e.g. Puppeteer protocol errors)
  if (o && typeof o === "object") {
    const parts: string[] = [];
    for (const k of ["message", "description", "msg", "error", "text", "reason"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) parts.push(v.trim());
    }
    if (parts.length) return parts.join(" ");
  }
  const s = String(e).trim();
  return s && s !== "[object Object]" ? s : "Unknown error";
}

/** Retry with exponential backoff for retryable errors (timeout, connection, network). */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseMs: number }
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= opts.retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || String(e)).toLowerCase();
      const retryable = msg.includes("timeout") || msg.includes("net::") || msg.includes("connection") || msg.includes("econnreset") || msg.includes("navigation");
      if (!retryable || i === opts.retries) throw e;
      await new Promise((r) => setTimeout(r, opts.baseMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

export async function discoverPages(
  browser: Browser,
  baseUrl: string,
  config: CrawlerModeConfig,
  auth: AuthenticationConfig | undefined,
  userRole: string,
  crawlRunId: string,
  onPageDiscovered: (page: Omit<DiscoveredPage, "id"> & { pageSignatureHash?: string }) => Promise<string>,
  onProgress?: (currentUrl: string, screenshotBase64?: string) => void
): Promise<DiscoveredPage[]> {
  const base = baseUrl.replace(/\/$/, "") || baseUrl;
  const visitedSignatures = new Set<string>();
  const queuedUrls = new Set<string>();
  const queue: { url: string; depth: number; parentPageId?: string }[] = [{ url: normalizeUrl(base, base), depth: 0 }];
  queuedUrls.add(normalizeUrl(base, base));
  const results: DiscoveredPage[] = [];
  const startTime = Date.now();

  const page = await browser.newPage();
  try {
    page.on("pageerror", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[automated-test] Page script error (continuing):", msg?.slice(0, 100));
    });
    page.setDefaultNavigationTimeout(config.pageLoadTimeoutMs);
    page.setDefaultTimeout(30000);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    if (userRole !== "guest" && auth?.authUrl && auth.username && auth.password) {
      await page.goto(auth.authUrl, { waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
      await page.waitForSelector('input[type="text"], input[name="username"], input[name="email"], input[type="email"]', { timeout: 5000 }).catch(() => {});
      await page.type('input[type="text"], input[name="username"], input[type="email"], input[name="email"]', auth.username, { delay: 50 }).catch(() => {});
      await page.type('input[type="password"], input[name="password"]', auth.password, { delay: 50 }).catch(() => {});
      await page.click('button[type="submit"], input[type="submit"]').catch(() => {});
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((el) => /sign\s*in|login/i.test((el.textContent || "").trim()));
        if (b) (b as HTMLElement).click();
      }).catch(() => {});
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    }

    while (
      queue.length > 0 &&
      results.length < config.maxPages &&
      Date.now() - startTime < config.maxCrawlDurationMs
    ) {
      const item = queue.shift()!;
      const { url, depth, parentPageId } = item;
      if (depth > config.maxDepth) continue;

      let title = "";
      let h1 = "";
      let primaryCta: string[] = [];
      let routePattern = "";
      let sigHash = "";
      let formCount = 0;

      let loadError: Error | null = null;
      let lastLoadErrorMsg = "";
      const isFirstPage = results.length === 0;
      if (isFirstPage) {
        console.log("[automated-test] Navigating to first page:", url);
      }
      const loaded = await withRetry(
        async () => {
          try {
            const timeout = isFirstPage ? 120000 : Math.min(config.pageLoadTimeoutMs, 90000);
            // Use "load" for all pages (not "domcontentloaded") so JavaScript-rendered
            // navigation links are present in the DOM before link extraction runs.
            // "domcontentloaded" fires on the raw HTML skeleton before any SPA framework
            // has had a chance to render — causing hrefs to come back empty and stopping
            // the crawl after the first page.
            await page.goto(url, { waitUntil: "load", timeout });
            await page.waitForSelector("body", { timeout: 20000 }).catch(() => {});
            // Settle delay: give the SPA time to finish hydrating and rendering nav links.
            // First page gets 1500ms; subsequent pages get 800ms (load already waited for
            // most resources, 800ms is enough for React/Vue/Angular to paint navigation).
            await new Promise((r) => setTimeout(r, isFirstPage ? 1500 : 800));
            title = await page.title().catch(() => "");
            h1 = await page
              .evaluate(() => {
                try {
                  const el = document.querySelector("h1");
                  return el ? (el.textContent || "").trim().slice(0, 300) : "";
                } catch {
                  return "";
                }
              })
              .catch(() => "");
            primaryCta = await page
              .evaluate(() => {
                try {
                  const texts: string[] = [];
                  const sel = "button, [role=\"button\"], a[href]";
                  const nodes = document.querySelectorAll(sel);
                  for (let i = 0; i < nodes.length; i++) {
                    const el = nodes[i];
                    const t = (el.textContent || "").trim().slice(0, 80);
                    if (t && !texts.includes(t)) texts.push(t);
                  }
                  return texts.slice(0, 5);
                } catch {
                  return [];
                }
              })
              .catch(() => []);
            routePattern = getRoutePattern(url);
            sigHash = pageSignatureHash({ title, h1, primaryCta, route: routePattern });
            return true;
          } catch (inner: unknown) {
            const msg = getErrorMessage(inner);
            const err = inner as Error;
            const fallback =
              err?.stack?.split("\n")?.[0]?.trim() ||
              (typeof inner === "object" && inner !== null ? `[${inner.constructor?.name ?? "Object"}]` : String(inner).slice(0, 200)) ||
              "unknown";
            const detail = (msg && msg !== "Unknown error" ? msg : fallback) || "no details";
            console.error("[automated-test] First page load threw:", detail, "raw type:", err?.constructor?.name);
            throw new Error(`Load failed: ${detail}`);
          }
        },
        { retries: 3, baseMs: 2000 }
      ).catch((e: unknown) => {
        const errMsg = getErrorMessage(e);
        const safeMsg =
          errMsg && errMsg !== "Unknown error"
            ? errMsg
            : `Crawl error (${(e as Error)?.constructor?.name ?? typeof e})`;
        lastLoadErrorMsg = safeMsg;
        loadError = new Error(safeMsg);
        console.error("[automated-test] Page load failed:", url, "→", safeMsg);
        if (isFirstPage) {
          console.error("[automated-test] Raw error:", (e as Error)?.constructor?.name, "message:", (e as Error)?.message, "string:", String(e).slice(0, 400));
        }
        return false;
      });

      if (isFirstPage && loaded) {
        console.log("[automated-test] First page loaded successfully:", url);
      }

      if (!loaded) {
        if (results.length === 0) {
          const loadErr = loadError as Error | null;
          const detail = lastLoadErrorMsg.trim() || loadErr?.message?.trim() || getErrorMessage(loadErr ?? undefined) || "First page could not be loaded";
          console.error("[automated-test] First page failed to load. Detail:", detail);
          throw new Error(
            `First page failed to load: ${detail}. Check base URL, network, and that the server can reach the target.`
          );
        }
        continue;
      }

      if (visitedSignatures.has(sigHash)) continue;
      visitedSignatures.add(sigHash);

      const pageType = inferPageType(url, title, h1, routePattern);

      await page
        .evaluate(() => {
          try {
            window.scrollTo(0, document.body.scrollHeight);
          } catch (_) {}
        })
        .catch(() => {});

      await new Promise((r) => setTimeout(r, 300));

      await page
        .evaluate(() => {
          try {
            const els = document.querySelectorAll("[aria-expanded=\"false\"]");
            for (let i = 0; i < els.length; i++) {
              const el = els[i];
              if (typeof (el as HTMLElement).click === "function") (el as HTMLElement).click();
            }
          } catch (_) {}
        })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 200));

      // Use a plain JS string (not a TS function) so esbuild never transforms it.
      // Passing a TypeScript function to page.evaluate() causes esbuild to inject
      // __name() helper calls for named arrow functions; those helpers aren't defined
      // in the browser scope, silently crashing the evaluate and returning [].
      const linkExtractScript = `(function(base) {
        try {
          function rd(hostname) {
            var parts = hostname.split(".");
            return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
          }
          var baseRD = rd(new URL(base).hostname);
          var seen = {};
          var out = [];
          var filtered = [];
          var links = document.querySelectorAll("a[href]");
          for (var i = 0; i < links.length; i++) {
            var h = links[i].href;
            if (!h || h.indexOf("javascript:") === 0 || h.indexOf("mailto:") === 0 ||
                h.indexOf("tel:") === 0 || h.indexOf("data:") === 0) { filtered.push({h:h,r:"protocol"}); continue; }
            var hashOnly = h.replace(/^[^#]*/, "") === h || h === base + "#" || (h.indexOf("#") !== -1 && h.split("#")[0] === "");
            if (hashOnly) { filtered.push({h:h,r:"hash-only"}); continue; }
            try {
              var u = new URL(h, base);
              u.hash = "";
              var s = u.toString().replace(/\\/$/, "") || "/";
              if (seen[s]) { filtered.push({h:h,r:"dup"}); continue; }
              seen[s] = true;
              var linkRD = rd(u.hostname);
              if (linkRD !== baseRD) { filtered.push({h:h,r:"ext:"+linkRD}); continue; }
              out.push(s);
            } catch(e) { filtered.push({h:h,r:"err:"+e.message}); }
          }
          var dataEls = document.querySelectorAll("[data-href],[data-url],[data-link]");
          for (var j = 0; j < dataEls.length; j++) {
            var dh = dataEls[j].getAttribute("data-href") || dataEls[j].getAttribute("data-url") || dataEls[j].getAttribute("data-link") || "";
            if (!dh) continue;
            try {
              var du = new URL(dh, base);
              du.hash = "";
              var ds = du.toString().replace(/\\/$/, "") || "/";
              if (seen[ds]) continue;
              seen[ds] = true;
              if (rd(du.hostname) !== baseRD) continue;
              out.push(ds);
            } catch(e) {}
          }
          return { passed: out, filtered: filtered.slice(0, 20), totalAnchors: links.length };
        } catch(e) {
          return { passed: [], filtered: [], totalAnchors: -1, error: e.message };
        }
      })(${JSON.stringify(base)})`;

      const linkResult = await page.evaluate(linkExtractScript).catch((e: any) => ({ passed: [] as string[], filtered: [] as { h: string; r: string }[], totalAnchors: -1, error: String(e?.message ?? e) })) as { passed: string[]; filtered: { h: string; r: string }[]; totalAnchors: number; error?: string };

      console.log(`[automated-test] Link extraction for ${url}: totalAnchors=${linkResult.totalAnchors} passed=${linkResult.passed.length}`, linkResult.error ? `ERROR: ${linkResult.error}` : "", linkResult.filtered.length ? `filtered sample: ${JSON.stringify(linkResult.filtered.slice(0, 5))}` : "");

      const allHrefs = linkResult.passed;

      // Count forms across all frames (iframes can embed forms not visible from the main document)
      const frameCounts = await Promise.allSettled(
        page.frames().map((frame) =>
          frame.evaluate(() => document.querySelectorAll("form").length).catch(() => 0)
        )
      );
      formCount = frameCounts.reduce(
        (sum, r) => sum + (r.status === "fulfilled" ? (r.value as number) : 0),
        0
      );

      let id: string;
      try {
        id = await onPageDiscovered({
          url: normalizeUrl(url, base),
          title: title || undefined,
          routePattern,
          pageType,
          depth,
          parentPageId,
          linkCount: allHrefs.length,
          formCount,
          pageSignatureHash: sigHash,
        });
      } catch (storeErr: unknown) {
        const msg = storeErr instanceof Error ? storeErr.message : String(storeErr);
        console.error("[automated-test] onPageDiscovered failed:", url, msg);
        if (results.length === 0) {
          throw new Error(`Failed to store first page: ${msg}`);
        }
        throw storeErr;
      }

      results.push({
        id,
        url: normalizeUrl(url, base),
        title: title || undefined,
        routePattern,
        pageType,
        depth,
        linkCount: allHrefs.length,
        formCount,
        parentPageId,
        pageSignatureHash: sigHash,
      });

      if (onProgress) {
        const screenshot = await page.screenshot({ encoding: "base64", type: "png" }).catch(() => undefined);
        onProgress(url, typeof screenshot === "string" ? screenshot : undefined);
      }

      const toEnqueue = allHrefs.slice(0, config.maxClicksPerPage);
      for (const href of toEnqueue) {
        const norm = normalizeUrl(href, base);
        if (queuedUrls.has(norm)) continue;
        queuedUrls.add(norm);
        queue.push({ url: norm, depth: depth + 1, parentPageId: id });
      }
    }
  } finally {
    await page.close();
  }
  return results;
}
