/**
 * Runs generated Playwright spec and records results into automated_test_runs and automated_test_results.
 */

import { mkdir, writeFile, readFile, rm, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { db } from "../../db";
import {
  automatedTestRuns,
  automatedTestResults,
  automatedTestCases,
  automatedTestScripts,
  crawlRuns,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const CASE_CODE_REGEX = /^(TC-\d+):\s*/;

/**
 * Convert an ESM Playwright spec to CommonJS so it can run as a plain .js file
 * without requiring "type": "module" in package.json.
 * Uses `playwright/test` (the installed package) rather than `@playwright/test`
 * which is not installed as a separate package in this project.
 */
function toCommonJS(script: string): string {
  return script
    // ESM import from @playwright/test or playwright/test → CJS require from playwright/test
    .replace(
      /^\s*import\s*\{([^}]+)\}\s*from\s*['"]@playwright\/test['"]\s*;?\s*$/m,
      (_, names: string) => `const { ${names.trim()} } = require('playwright/test');`
    )
    .replace(
      /^\s*import\s*\{([^}]+)\}\s*from\s*['"]playwright\/test['"]\s*;?\s*$/m,
      (_, names: string) => `const { ${names.trim()} } = require('playwright/test');`
    )
    // Already-CJS but wrong package name → fix to playwright/test
    .replace(/require\(['"]@playwright\/test['"]\)/g, `require('playwright/test')`)
    .replace(/^\s*export\s+default\s+/m, "module.exports = ");
}

function extractCaseCode(title: string): string | null {
  const m = title?.match(CASE_CODE_REGEX);
  return m ? m[1] : null;
}

// Also update the DB query to match REQ-TC codes alongside DOM-TC codes

/** Recursively collect all test results from Playwright JSON report (any nesting).
 *
 * Playwright JSON structure (playwright package):
 *   root.suites[].specs[].tests[].results[]
 *
 * The case-code title lives on the SPEC object; the results[] lives on the TEST object
 * one level deeper — they are NEVER on the same object. So we must look at
 * spec.tests[0].results[0] when we find a spec with a matching title.
 */
function parseJsonReport(content: string): Array<{ caseCode: string; status: string; durationMs?: number; errorMessage?: string }> {
  const results: Array<{ caseCode: string; status: string; durationMs?: number; errorMessage?: string }> = [];
  const seen = new Set<string>();
  try {
    const report = JSON.parse(content) as object;

    function getFirstResult(o: Record<string, unknown>): Record<string, unknown> | undefined {
      // Direct results[] on this object (some report versions put them here)
      if (Array.isArray(o.results) && o.results.length > 0) {
        return o.results[0] as Record<string, unknown>;
      }
      // Playwright standard: results live one level down in tests[0].results[0]
      if (Array.isArray(o.tests) && o.tests.length > 0) {
        const firstTest = o.tests[0] as Record<string, unknown>;
        if (Array.isArray(firstTest.results) && firstTest.results.length > 0) {
          return firstTest.results[0] as Record<string, unknown>;
        }
      }
      return undefined;
    }

    function visit(obj: unknown): void {
      if (!obj || typeof obj !== "object") return;
      const o = obj as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title : "";
      const caseCode = extractCaseCode(title);

      if (caseCode && !seen.has(caseCode)) {
        const res = getFirstResult(o);
        if (res) {
          seen.add(caseCode);
          const status = res.status === "passed" ? "passed" : "failed";
          const durationMs = typeof res.duration === "number" ? Math.round(res.duration) : undefined;
          const err = res.error as Record<string, unknown> | undefined;
          const errorMessage = typeof err?.message === "string" ? err.message : undefined;
          results.push({ caseCode, status, durationMs, errorMessage });
        }
      }

      if (Array.isArray(o.suites)) for (const s of o.suites) visit(s);
      if (Array.isArray(o.specs)) for (const s of o.specs) visit(s);
      if (Array.isArray(o.tests)) for (const t of o.tests) visit(t);
      if (o.spec && typeof o.spec === "object") visit(o.spec);
    }

    visit(report);
  } catch (_) {
    // ignore parse errors
  }
  return results;
}

async function resolvePlaywrightCommand(): Promise<{ command: string; args: string[] }> {
  // Try known CLI paths in priority order.
  // This project uses the `playwright` package (not `@playwright/test`).
  const candidates = [
    join(process.cwd(), "node_modules", "playwright", "cli.js"),
    join(process.cwd(), "node_modules", "@playwright", "test", "cli.js"),
    join(process.cwd(), "node_modules", "playwright-core", "cli.js"),
  ];

  for (const p of candidates) {
    try {
      await access(p);
      return { command: "node", args: [p, "test"] };
    } catch {
      // not found, try next
    }
  }

  throw new Error(
    `Playwright CLI not found. Expected one of:\n${candidates.join("\n")}\nRun: npm install playwright`
  );
}

export async function runTestsForCrawlRun(crawlRunId: string): Promise<{
  testRunId: string;
  status: string;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  errorMessage?: string;
}> {
  const [runRow] = await db.select().from(crawlRuns).where(eq(crawlRuns.id, crawlRunId)).limit(1);
  if (!runRow) throw new Error("Crawl run not found");
  const baseUrl = runRow.baseUrl ?? "http://localhost:3000";

  const [scriptRow] = await db
    .select()
    .from(automatedTestScripts)
    .where(eq(automatedTestScripts.crawlRunId, crawlRunId))
    .limit(1);
  if (!scriptRow?.scriptContent) {
    throw new Error("No Playwright script found for this crawl run. Generate scripts first.");
  }

  const cases = await db
    .select({ id: automatedTestCases.id, caseCode: automatedTestCases.caseCode })
    .from(automatedTestCases)
    .where(eq(automatedTestCases.crawlRunId, crawlRunId));

  const testRunId = randomUUID();
  const workDir = join(tmpdir(), `devx-autonomous-${crawlRunId.slice(0, 8)}-${randomUUID().slice(0, 6)}`);
  const configPath = join(workDir, "playwright.config.js");
  const specPath = join(workDir, "tests", "autonomous.spec.js");
  const resultsPath = join(workDir, "test-results.json");

  await db.insert(automatedTestRuns).values({
    id: testRunId,
    crawlRunId,
    status: "running",
    totalTests: cases.length,
    passedCount: 0,
    failedCount: 0,
  });

  try {
    await mkdir(join(workDir, "tests"), { recursive: true });
    
    console.log(`[test-runner] Using baseURL: ${baseUrl}`);
    console.log(`[test-runner] Test cases count: ${cases.length}`);
    
    await writeFile(
      configPath,
      `// @ts-check
const { defineConfig, devices } = require('playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [
    ['json', { outputFile: './test-results.json' }]
  ],
  use: { 
    headless: true,
    ignoreHTTPSErrors: true,
    navigationTimeout: 15000,
    actionTimeout: 10000,
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
`,
      "utf-8"
    );
    await writeFile(specPath, toCommonJS(scriptRow.scriptContent), "utf-8");

    // Declare stdout and stderr in the correct scope
    let stderr = "";
    let stdout = "";

    await new Promise<void>(async (resolve) => {
      console.log(`[test-runner] Running REAL Playwright tests...`);

      const { command, args } = await resolvePlaywrightCommand();

      // Use --reporter=json + PLAYWRIGHT_JSON_OUTPUT_NAME (absolute path) so results
      // are always written to a known file regardless of cwd/config resolution quirks.
      // This is more reliable than parsing stdout, which Playwright may write to the
      // terminal directly on Windows instead of going through the piped stream.
      const fullArgs = [...args, "--config", configPath, "--reporter=json"];

      console.log(`[test-runner] Command: ${command} ${fullArgs.join(" ")}`);

      const proc = spawn(command, fullArgs, {
        cwd: workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_OPTIONS: "--no-warnings",
          NODE_PATH: join(process.cwd(), "node_modules"),
          // Playwright JSON reporter writes to this file when --reporter=json is used
          PLAYWRIGHT_JSON_OUTPUT_NAME: resultsPath,
        },
      });

      proc.stderr?.on("data", (d) => { stderr += d.toString(); });
      proc.stdout?.on("data", (d) => { stdout += d.toString(); });

      proc.on("error", (err) => {
        console.error(`[test-runner] Process error:`, err);
        resolve();
      });

      proc.on("close", (code) => {
        console.log(`[test-runner] Playwright exit code: ${code}`);
        if (stderr) console.log(`[test-runner] stderr:`, stderr.slice(0, 500));
        resolve();
      });
    });

    let passedCount = 0;
    let failedCount = 0;
    const caseCodeToId = new Map(cases.map((c) => [c.caseCode ?? "", c.id]));

    // Read from the absolute results path set via PLAYWRIGHT_JSON_OUTPUT_NAME.
    // Fall back to stdout JSON if the file wasn't written for any reason.
    let jsonContent = "";
    try {
      jsonContent = await readFile(resultsPath, "utf-8");
      console.log(`[test-runner] Read results file (${jsonContent.length} bytes)`);
    } catch {
      // File not written — try extracting JSON from stdout
      if (stdout.includes("{")) {
        const start = stdout.indexOf("{");
        const end = stdout.lastIndexOf("}");
        if (end > start) jsonContent = stdout.substring(start, end + 1);
      }
      if (!jsonContent) {
        console.log(`[test-runner] No results file and no JSON in stdout — marking all as failed`);
        jsonContent = "{}";
      }
    }

    try {
      const parsed = parseJsonReport(jsonContent);
      console.log(`[test-runner] Parsed ${parsed.length} test results`);
      if (parsed.length === 0 && jsonContent.length > 10) {
        console.log(`[test-runner] DEBUG JSON (first 1000 chars):`, jsonContent.slice(0, 1000));
      }

      for (const p of parsed) {
        const testCaseId = caseCodeToId.get(p.caseCode);
        if (!testCaseId) continue;
        if (p.status === "passed") passedCount++;
        else failedCount++;
        await db.insert(automatedTestResults).values({
          testRunId,
          testCaseId,
          caseCode: p.caseCode,
          status: p.status,
          severity: p.status === "failed" ? "high" : undefined,
          errorMessage: p.errorMessage ?? null,
          durationMs: p.durationMs ?? null,
        });
      }

      // If parseJsonReport found nothing, mark every case as failed with the real error
      if (parsed.length === 0) {
        failedCount = cases.length;
        for (const c of cases) {
          await db.insert(automatedTestResults).values({
            testRunId,
            testCaseId: c.id,
            caseCode: c.caseCode,
            status: "failed",
            errorMessage: stderr || "Results file was empty or unparseable",
            durationMs: null,
          });
        }
      }
    } catch (parseErr) {
      console.error(`[test-runner] Error processing test results:`, parseErr);
      failedCount = cases.length;
      for (const c of cases) {
        await db.insert(automatedTestResults).values({
          testRunId,
          testCaseId: c.id,
          caseCode: c.caseCode,
          status: "failed",
          errorMessage: `Parse error: ${parseErr}`,
          durationMs: null,
        });
      }
    }

    const status = failedCount === 0 ? "passed" : "failed";
    await db
      .update(automatedTestRuns)
      .set({
        status,
        passedCount,
        failedCount,
        finishedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(automatedTestRuns.id, testRunId));

    return {
      testRunId,
      status,
      totalTests: cases.length,
      passedCount,
      failedCount,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[test-runner] Error during test execution:`, msg);
    
    // Set proper error status
    failedCount = cases.length;
    passedCount = 0;
    
    await db
      .update(automatedTestRuns)
      .set({ 
        status: "failed", 
        passedCount: 0,
        failedCount: cases.length,
        finishedAt: new Date(), 
        errorMessage: msg 
      })
      .where(eq(automatedTestRuns.id, testRunId));
      
    return {
      testRunId,
      status: "failed",
      totalTests: cases.length,
      passedCount: 0,
      failedCount: cases.length,
      errorMessage: msg,
    };
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch (_) {}
  }
}
