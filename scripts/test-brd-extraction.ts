/**
 * BRD extraction smoke test (Phase 4a of brd-extraction-resilience-fix).
 *
 * What this does:
 *   - Discovers .docx / .pdf files in a sample directory (default
 *     `test-fixtures/brd-samples`, override with BRD_SAMPLES_DIR env var).
 *   - For each file:
 *       1. Reads it from disk.
 *       2. Runs the same DOCX/PDF text extraction the upload route uses.
 *       3. Calls `extractBrdInputFromDocumentText` directly (the new
 *          chunked Bedrock/Claude implementation).
 *       4. Optionally runs `generateBRD` and asserts the result has
 *          exactly the 13 canonical sections, with no `Document Content`
 *          last-resort title.
 *
 * Exit code is non-zero if any sample fails its assertions, so this
 * script can be wired into CI later if desired. By default it just
 * prints a summary table.
 *
 * Run with:
 *   $env:BRD_SAMPLES_DIR="C:\path\to\samples"; npx tsx scripts/test-brd-extraction.ts
 *   # or, to skip generation (extraction only):
 *   $env:SKIP_GENERATION="1"; npx tsx scripts/test-brd-extraction.ts
 *
 * Notes:
 *   - This script imports the live BRD service modules, so it needs the
 *     same env vars / Secrets the dev server needs (DEVX_HOSTING=aws,
 *     AWS credentials, BEDROCK_MODEL_ID, etc.). Easiest way: load `.env`
 *     before invoking the script via `node -r dotenv/config ...` or
 *     simply run inside the same shell that runs `npm run dev`.
 *   - We intentionally do NOT mock the LLM. This is a smoke test that
 *     validates the real Bedrock/Claude integration — the same path
 *     that runs in production.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  extractMarkdownFromDocxBuffer,
  extractMarkdownFromPdfBuffer,
} from "../server/helper/brd-document-parser";
import {
  extractBrdInputFromDocumentText,
  generateBRD,
  type BRDInput,
} from "../server/brd-ai-service";

const SAMPLES_DIR = process.env.BRD_SAMPLES_DIR
  ? path.resolve(process.env.BRD_SAMPLES_DIR)
  : path.resolve(process.cwd(), "test-fixtures/brd-samples");
const SKIP_GENERATION = process.env.SKIP_GENERATION === "1";

interface SampleResult {
  file: string;
  ok: boolean;
  notes: string[];
  extractionMs?: number;
  generationMs?: number;
  populatedFieldCount?: number;
  sectionCount?: number;
}

async function listSampleFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    console.error(
      `[smoke] Sample directory not found or unreadable: ${dir}\n` +
        `        Set BRD_SAMPLES_DIR to a folder containing .docx/.pdf files.`,
    );
    process.exitCode = 2;
    return [];
  }
  return entries
    .filter((name) => /\.(docx|pdf)$/i.test(name))
    .map((name) => path.join(dir, name));
}

async function runSample(file: string): Promise<SampleResult> {
  const result: SampleResult = { file, ok: true, notes: [] };
  const ext = path.extname(file).toLowerCase();
  const buf = await fs.readFile(file);

  let markdown = "";
  if (ext === ".docx") {
    markdown = await extractMarkdownFromDocxBuffer(buf);
  } else if (ext === ".pdf") {
    markdown = await extractMarkdownFromPdfBuffer(buf);
  } else {
    result.ok = false;
    result.notes.push(`unsupported extension: ${ext}`);
    return result;
  }
  result.notes.push(`markdown=${markdown.length} chars`);

  if (!markdown.trim()) {
    result.ok = false;
    result.notes.push("empty markdown extracted");
    return result;
  }

  const extractStart = Date.now();
  let extracted: Partial<BRDInput>;
  try {
    extracted = await extractBrdInputFromDocumentText(markdown);
  } catch (err) {
    result.ok = false;
    result.notes.push(
      `extractBrdInputFromDocumentText threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }
  result.extractionMs = Date.now() - extractStart;

  const populated = Object.entries(extracted)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k]) => k);
  result.populatedFieldCount = populated.length;
  result.notes.push(`fields=${populated.length}: ${populated.join(",")}`);

  // Soft assertion: real BRDs should populate at least 3 fields. A 0/1
  // here means all chunks effectively returned empty — extraction
  // technically "succeeded" via Zod coercion but produced no signal.
  if (populated.length < 3) {
    result.ok = false;
    result.notes.push(
      "extraction produced fewer than 3 populated fields — chunk runs likely returned empties",
    );
  }

  if (SKIP_GENERATION) {
    return result;
  }

  const genStart = Date.now();
  try {
    const projectName =
      typeof extracted.projectName === "string" && extracted.projectName.trim()
        ? extracted.projectName
        : path.basename(file, ext);
    const projectDescription =
      typeof extracted.projectDescription === "string" &&
      extracted.projectDescription.trim()
        ? extracted.projectDescription
        : "Project description extracted from uploaded BRD document.";
    const brdInput: BRDInput = {
      ...extracted,
      projectName,
      projectDescription,
      generationDate: new Date().toISOString().split("T")[0],
    };
    const brd = await generateBRD(brdInput, undefined, { mode: "upload" });
    result.generationMs = Date.now() - genStart;
    result.sectionCount = brd.sections.length;

    // Hard assertion: exactly 13 canonical sections, no last-resort title.
    if (brd.sections.length !== 13) {
      result.ok = false;
      result.notes.push(`section count = ${brd.sections.length}, expected 13`);
    }
    const hasLastResortTitle = brd.sections.some((s) =>
      typeof s.title === "string" && s.title.trim().toLowerCase() === "document content",
    );
    if (hasLastResortTitle) {
      result.ok = false;
      result.notes.push("section title 'Document Content' present — Tier 2 fallback fired");
    }
  } catch (err) {
    result.ok = false;
    result.notes.push(
      `generateBRD threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}

async function main() {
  console.log(`[smoke] BRD extraction smoke test`);
  console.log(`[smoke] Samples directory: ${SAMPLES_DIR}`);
  console.log(`[smoke] Skip generation: ${SKIP_GENERATION}`);

  const files = await listSampleFiles(SAMPLES_DIR);
  if (files.length === 0) {
    console.error(`[smoke] No .docx/.pdf samples found. Add files to ${SAMPLES_DIR} and re-run.`);
    process.exitCode = 2;
    return;
  }
  console.log(`[smoke] Found ${files.length} sample file(s):`);
  for (const f of files) console.log(`         - ${path.basename(f)}`);

  const results: SampleResult[] = [];
  for (const file of files) {
    console.log(`\n[smoke] ===== ${path.basename(file)} =====`);
    const r = await runSample(file);
    results.push(r);
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`[smoke] ${status} ${path.basename(file)} :: ${r.notes.join("; ")}`);
    if (typeof r.extractionMs === "number") {
      console.log(
        `[smoke]      extraction=${r.extractionMs}ms` +
          (typeof r.generationMs === "number"
            ? ` generation=${r.generationMs}ms`
            : "") +
          (typeof r.sectionCount === "number"
            ? ` sections=${r.sectionCount}`
            : ""),
      );
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[smoke] ===== SUMMARY =====`);
  console.log(`[smoke] passed=${passed} failed=${failed} of ${results.length}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

const __filename = fileURLToPath(import.meta.url);
const isDirectInvocation = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(__filename) ||
    pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isDirectInvocation) {
  main().catch((err) => {
    console.error("[smoke] Uncaught error:", err);
    process.exitCode = 1;
  });
}
