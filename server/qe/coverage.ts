/**
 * NAT 2.0 — Coverage Reporter
 * Analyses the test library to compute flow coverage %, identify gaps,
 * and stream Claude-generated insights about what to test next.
 */

import type { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { qeAnthropicClient as insightsClient } from './ai-client.js';
import { getRepoRoot } from '../utils/module-paths';

const PROJECT_ROOT = getRepoRoot();
const STORE_FILE = path.join(PROJECT_ROOT, 'test-library.json');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordedTest {
  id: string;
  folderId: string;
  name: string;
  url: string;
  script?: string;
  nlSteps: string[];
  tags: string[];
  lastRunStatus: 'passed' | 'failed' | 'never';
  lastRunAt: number | null;
  lastRunDuration: number | null;
}

export interface PageCoverage {
  path: string;
  domain: string;
  testCount: number;
  passCount: number;
  failCount: number;
  neverCount: number;
  lastRunAt: number | null;
  testNames: string[];
}

export interface DomainCoverage {
  domain: string;
  testCount: number;
  passRate: number;
  pageCount: number;
}

export interface CoverageReport {
  totalTests: number;
  totalDiscoveredPages: number;
  coveredPages: number;
  coveragePct: number;           // (coveredPages / totalDiscoveredPages) * 100
  passRate: number;              // passing / (passing + failing) across all run tests
  executedRate: number;          // tests that have been run at least once
  byPage: PageCoverage[];
  byDomain: DomainCoverage[];
  uncoveredPages: string[];      // pages seen via navigation with no dedicated test
  generatedAt: number;
}

// ─── Anthropic client ─────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function loadTests(): RecordedTest[] {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      return (data.tests || []) as RecordedTest[];
    }
  } catch {}
  return [];
}

/** Resolve start URL from stored field or Playwright script (recorder often leaves url empty). */
function resolveTestUrl(test: RecordedTest): string {
  const trimmed = (test.url || '').trim();
  if (trimmed) return trimmed;
  const fromScript = test.script?.match(/page\.goto\(\s*['"]([^'"]+)['"]/);
  return fromScript?.[1]?.trim() || '';
}

function pathFromUrl(url: string): string {
  if (!url) return '/';
  try {
    const p = new URL(url).pathname;
    return p || '/';
  } catch {
    // might be a path already
    return url.startsWith('/') ? url : '/';
  }
}

function normalizePath(p: string): string {
  // strip trailing slash (keep root '/'), lowercase
  return (p.replace(/\/$/, '') || '/').toLowerCase();
}

/**
 * Extract page paths from NL step text.
 * Looks for "Page loaded: https://...", "Navigate to /path", and bare https:// URLs.
 */
function extractPagesFromSteps(nlSteps: string[]): string[] {
  const pages: string[] = [];
  for (const step of nlSteps) {
    // "Page loaded: https://..." or "Page loaded — \"Title\"" (recorder NL steps)
    const m1 = step.match(/[Pp]age\s+loaded[:\s—\-]+https?:\/\/[^\s/]+(\/[^\s"'#?]*)/);
    if (m1) pages.push(m1[1]);

    // "Navigate to /checkout" or "navigated to /dashboard"
    const m2 = step.match(/[Nn]avigate[d]?\s+to\s+(?:https?:\/\/[^\s/]+)?(\/[^\s"'#?]+)/);
    if (m2) pages.push(m2[1]);

    // any https URL with a non-trivial path
    const urls = step.match(/https?:\/\/[^\s"'#?]+/g);
    if (urls) {
      for (const u of urls) {
        try {
          const p = new URL(u).pathname;
          if (p && p !== '/') pages.push(p);
        } catch {}
      }
    }
  }
  return [...new Set(pages.map(normalizePath).filter(p => p.length > 0 && p !== '/'))];
}

function deriveFlowDomain(url: string, nlSteps: string[]): string {
  const text = (url + ' ' + nlSteps.join(' ')).toLowerCase();
  if (/login|sign[\s-]?in|auth|password|logout/.test(text)) return 'auth';
  if (/checkout|cart|purchase|payment|order|billing/.test(text)) return 'checkout';
  if (/register|sign[\s-]?up|create[\s-]?account/.test(text)) return 'registration';
  if (/search|filter|find|query/.test(text)) return 'search';
  if (/dashboard|home|landing|overview/.test(text)) return 'dashboard';
  if (/product|item|catalog|listing|sku/.test(text)) return 'catalog';
  if (/profile|account|settings|preference/.test(text)) return 'profile';
  if (/contact|support|help|ticket|feedback/.test(text)) return 'support';
  if (/report|analytic|stat|chart|metric/.test(text)) return 'reporting';
  if (/admin|manage|config|setup/.test(text)) return 'admin';
  // fall back to first meaningful URL segment
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length > 0) return parts[0].replace(/[-_]/g, ' ');
  } catch {}
  return 'general';
}

// ─── Core report builder ──────────────────────────────────────────────────────

export function buildCoverageReport(tests: RecordedTest[]): CoverageReport {
  if (tests.length === 0) {
    return {
      totalTests: 0, totalDiscoveredPages: 0, coveredPages: 0,
      coveragePct: 0, passRate: 0, executedRate: 0,
      byPage: [], byDomain: [], uncoveredPages: [], generatedAt: Date.now()
    };
  }

  // All pages that have at least one dedicated test starting from them
  const startPathToTests = new Map<string, RecordedTest[]>();
  // All pages discovered anywhere (start + navigation)
  const allDiscovered = new Set<string>();
  // Pages seen ONLY via navigation (no test starts there)
  const navOnlyPaths = new Set<string>();

  for (const test of tests) {
    const testUrl = resolveTestUrl(test);
    const startPath = normalizePath(pathFromUrl(testUrl));

    // Record as covered (has a dedicated test) — include homepage '/'
    allDiscovered.add(startPath);
    if (!startPathToTests.has(startPath)) startPathToTests.set(startPath, []);
    startPathToTests.get(startPath)!.push(test);

    // Navigation pages seen in steps
    for (const p of extractPagesFromSteps(test.nlSteps)) {
      allDiscovered.add(p);
      if (!startPathToTests.has(p)) navOnlyPaths.add(p);
    }
  }

  const totalDiscoveredPages = allDiscovered.size || tests.length;
  const coveredPages = startPathToTests.size || tests.length;
  const coveragePct = Math.min(100, Math.round((coveredPages / totalDiscoveredPages) * 100));

  // Pass rate (only across tests that have actually been run)
  const runTests = tests.filter(t => t.lastRunStatus !== 'never');
  const passRate = runTests.length > 0
    ? Math.round((runTests.filter(t => t.lastRunStatus === 'passed').length / runTests.length) * 100)
    : 0;
  const executedRate = Math.round((runTests.length / tests.length) * 100);

  // Per-page breakdown
  const byPage: PageCoverage[] = [];
  for (const [pagePath, pageTests] of startPathToTests.entries()) {
    byPage.push({
      path: pagePath,
      domain: deriveFlowDomain(resolveTestUrl(pageTests[0]!) || pagePath, pageTests[0]?.nlSteps || []),
      testCount: pageTests.length,
      passCount: pageTests.filter(t => t.lastRunStatus === 'passed').length,
      failCount: pageTests.filter(t => t.lastRunStatus === 'failed').length,
      neverCount: pageTests.filter(t => t.lastRunStatus === 'never').length,
      lastRunAt: Math.max(0, ...pageTests.map(t => t.lastRunAt || 0)) || null,
      testNames: pageTests.map(t => t.name),
    });
  }
  byPage.sort((a, b) => b.testCount - a.testCount);

  // Domain rollup
  const domainMap = new Map<string, { tests: RecordedTest[]; paths: Set<string> }>();
  for (const test of tests) {
    const testUrl = resolveTestUrl(test);
    const domain = deriveFlowDomain(testUrl, test.nlSteps);
    if (!domainMap.has(domain)) domainMap.set(domain, { tests: [], paths: new Set() });
    const entry = domainMap.get(domain)!;
    entry.tests.push(test);
    entry.paths.add(normalizePath(pathFromUrl(testUrl)));
  }

  const byDomain: DomainCoverage[] = Array.from(domainMap.entries()).map(([domain, { tests: dt, paths }]) => {
    const ran = dt.filter(t => t.lastRunStatus !== 'never');
    return {
      domain,
      testCount: dt.length,
      passRate: ran.length > 0
        ? Math.round((ran.filter(t => t.lastRunStatus === 'passed').length / ran.length) * 100)
        : 0,
      pageCount: paths.size || 1,
    };
  }).sort((a, b) => b.testCount - a.testCount);

  // Pages seen in navigation that have no dedicated test (top 20)
  const uncoveredPages = Array.from(navOnlyPaths)
    .filter(p => !startPathToTests.has(p))
    .slice(0, 20);

  return {
    totalTests: tests.length,
    totalDiscoveredPages,
    coveredPages,
    coveragePct,
    passRate,
    executedRate,
    byPage,
    byDomain,
    uncoveredPages,
    generatedAt: Date.now(),
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerCoverageRoutes(app: Express) {

  // GET /api/coverage/report — full structured report (JSON)
  app.get('/api/coverage/report', (_req: Request, res: Response) => {
    const tests = loadTests();
    res.json(buildCoverageReport(tests));
  });

  // GET /api/coverage/insights — SSE stream of Claude gap analysis
  app.get('/api/coverage/insights', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
    };

    const tests = loadTests();

    if (tests.length === 0) {
      send({ type: 'chunk', text: 'No tests in the library yet. Start recording user flows to get coverage insights.' });
      send({ type: 'done' });
      res.end();
      return;
    }

    const report = buildCoverageReport(tests);

    // Build context for Claude
    const lines: string[] = [
      `Web Application Test Suite — Coverage Analysis`,
      ``,
      `METRICS`,
      `  Total tests: ${report.totalTests}`,
      `  Pages covered: ${report.coveredPages} / ${report.totalDiscoveredPages} (${report.coveragePct}%)`,
      `  Tests executed: ${report.executedRate}% of total`,
      `  Pass rate (executed tests): ${report.passRate}%`,
      ``,
      `TESTED PAGES (${report.byPage.length} unique pages)`,
      ...report.byPage.map(p =>
        `  ${p.path} [${p.domain}] — ${p.testCount} test(s): ${p.passCount} pass, ${p.failCount} fail, ${p.neverCount} never run`
        + `\n    Tests: ${p.testNames.slice(0, 3).join(' | ')}`
      ),
      ``,
      `DOMAIN BREAKDOWN`,
      ...report.byDomain.map(d =>
        `  ${d.domain}: ${d.testCount} tests across ${d.pageCount} page(s), ${d.passRate}% pass rate`
      ),
      ``,
      `PAGES SEEN IN NAVIGATION BUT NO DEDICATED TEST`,
      ...(report.uncoveredPages.length > 0
        ? report.uncoveredPages.map(p => `  ${p}`)
        : ['  None detected']),
      ``,
      `TEST STEP SUMMARIES (first 15 tests)`,
      ...tests.slice(0, 15).map(t =>
        `  "${t.name}" [${t.lastRunStatus}]: `
        + t.nlSteps.slice(0, 6).map(s => s.replace(/^Step \d+:\s*/, '')).join(' → ')
      ),
    ];

    const prompt = `You are a QA coverage analyst reviewing a web application test suite.\n\n${lines.join('\n')}\n\nProvide a concise coverage analysis with exactly these four sections:\n\n## ✅ Well Covered\nList the flows and pages that have solid test coverage. Be specific.\n\n## 🚨 Critical Gaps\nList important user flows, edge cases, or pages with zero or insufficient coverage. Be specific — name the flows missing, not just categories.\n\n## ⚠️ Risk Areas\nHighlight tests that consistently fail, tests never executed, or domains with low pass rates.\n\n## 🎯 Top 5 Recordings to Do Next\nList 5 concrete, actionable test scenarios the user should record next, ordered by priority. For each: one sentence describing exactly what to record.\n\nBe direct and specific. Reference actual page paths and test names from the data.`;

    try {
      const stream = insightsClient.messages.stream({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          send({ type: 'chunk', text: event.delta.text });
        }
      }
    } catch (err: any) {
      send({ type: 'chunk', text: `\n\nAnalysis unavailable: ${err.message}` });
    }

    send({ type: 'done' });
    res.end();
  });
}
