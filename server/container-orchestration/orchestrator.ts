/**
 * Container execution orchestrator: init -> dependency install -> build/run -> analyze -> [fix -> retry].
 * Uses only IContainerExecutionContext and code-execution; no stack-modernization imports.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { IContainerExecutionContext, RunContainerOptions } from "./types";
import type { ICodeExecutionService } from "../code-execution";
import type { ExecutionRequest } from "../code-execution";
import type { ParsedIssue } from "../code-execution/parsers";
import { runTechStackInit } from "./agents/tech-stack-init";
import { runDependencyInstall } from "./agents/dependency-install-agent";
import { runBuildAndTest } from "./agents/build-run-agent";
import { analyzeTerminalOutput } from "./agents/terminal-analysis";

const DEFAULT_MAX_ATTEMPTS = 8;

export interface RunContainerExecutionResult {
  passed: boolean;
  attempts: number;
  message?: string;
}

/**
 * Detect "A compatible .NET SDK was not found" errors and fix by deleting
 * the offending global.json. Returns true if a fix was applied.
 */
async function tryFixSdkNotFound(output: string, projectPath: string): Promise<boolean> {
  if (!output.includes("A compatible .NET SDK was not found")) return false;

  const globalJsonMatch = output.match(/global\.json file:\s*(.+)/i);
  if (globalJsonMatch) {
    const gjPath = globalJsonMatch[1].trim();
    try {
      await fs.unlink(gjPath);
      console.log(`[Orchestrator] Deleted pinned global.json: ${gjPath}`);
      return true;
    } catch { /* already deleted or not found */ }
  }

  await deleteGlobalJsonRecursive(projectPath, 5);
  return true;
}

async function deleteGlobalJsonRecursive(dir: string, depth: number): Promise<void> {
  if (depth <= 0) return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await deleteGlobalJsonRecursive(full, depth - 1);
    } else if (e.name.toLowerCase() === "global.json") {
      try {
        const raw = await fs.readFile(full, "utf8");
        const json = JSON.parse(raw);
        if (json.sdk?.version) {
          await fs.unlink(full);
          console.log(`[Orchestrator] Deleted global.json pinning SDK ${json.sdk.version}: ${full}`);
        }
      } catch { /* ignore */ }
    }
  }
}

// Regex patterns for extracting file paths from raw build/test output
const FILE_PATH_PATTERNS = [
  // MSBuild: path(line,col):
  /([A-Za-z]:\\[^\s(]+|\/[^\s(]+)\((\d+),(\d+)\)/g,
  // NuGet bracket ref: [C:\path\to\Project.csproj]
  /\[([A-Za-z]:\\[^\]]+\.csproj)\]/g,
  // Stack trace: in C:\path\File.cs:line 42
  /\s+in\s+([A-Za-z]:\\[^:]+|\/[^:]+):line\s+(\d+)/g,
  // Python: File "path", line N
  /File\s+["']([^"']+)["'],\s*line\s+(\d+)/g,
];

/**
 * Extract all file paths mentioned anywhere in stdout+stderr
 * using multiple regex patterns. Returns a deduplicated set.
 */
function extractFilePathsFromOutput(stdout: string, stderr: string, projectPath: string): Set<string> {
  const combined = `${stdout}\n${stderr}`;
  const paths = new Set<string>();
  const projectPathNorm = projectPath.replace(/\\/g, "/").replace(/\/$/, "");

  for (const pattern of FILE_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(combined)) !== null) {
      let filePath = m[1].replace(/\\/g, "/").trim();
      if (filePath.toLowerCase().startsWith(projectPathNorm.toLowerCase() + "/")) {
        filePath = filePath.slice(projectPathNorm.length + 1);
      }
      if (filePath && !filePath.includes("*") && filePath.length < 300) {
        paths.add(filePath);
      }
    }
  }

  return paths;
}

/**
 * Normalize parsed issue file paths: absolute Windows paths -> relative to projectPath.
 */
function normalizeIssuePaths(issues: ParsedIssue[], projectPath: string): void {
  const projectPathNorm = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  for (const issue of issues) {
    if (issue.file) {
      let f = issue.file.replace(/\\/g, "/");
      if (f.toLowerCase().startsWith(projectPathNorm.toLowerCase() + "/")) {
        f = f.slice(projectPathNorm.length + 1);
      }
      issue.file = f;
    }
  }
}

/**
 * For issues with a line number, extract a context window from file content
 * and attach it as the issue's snippet.
 */
function enrichIssueSnippets(issues: ParsedIssue[], fileContents: Record<string, string>): void {
  for (const issue of issues) {
    if (!issue.file || !issue.line) continue;
    const content = fileContents[issue.file];
    if (!content) continue;
    const lines = content.split("\n");
    const start = Math.max(0, issue.line - 6);
    const end = Math.min(lines.length, issue.line + 5);
    const window = lines.slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === issue.line ? " >>>" : "    ";
        return `${marker} ${lineNum}: ${l}`;
      })
      .join("\n");
    issue.snippet = window;
  }
}

/**
 * Run the full container execution flow: ensure image, install deps, run tests;
 * on failure request fixes via context, apply edits, and retry up to maxAttempts.
 */
export async function runContainerExecution(
  ctx: IContainerExecutionContext,
  codeExecution: ICodeExecutionService,
  options: RunContainerOptions = {}
): Promise<RunContainerExecutionResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const runId = `container-${Date.now()}`;

  await ctx.appendLogs(`[Orchestrator] Initializing tech stack...\n`);
  const { projectPath, stack, runtimeVersion } = await runTechStackInit(ctx, codeExecution);
  await ctx.appendLogs(`[Orchestrator] Stack: ${stack}, Runtime: ${runtimeVersion || "auto"}, Path: ${projectPath}\n`);

  if (stack === "dotnet") {
    await deleteGlobalJsonRecursive(projectPath, 5);
  }

  const request: ExecutionRequest = {
    runId,
    stack,
    projectPath,
    runtimeVersion,
  };

  let attempt = 0;
  let lastStdout = "";
  let lastStderr = "";
  let lastExitCode: number | undefined;
  let lastParsedIssues: ParsedIssue[] = [];
  let lastSummary: string | undefined;
  let lastTestCounts: import("./agents/terminal-analysis").TestCounts | undefined;

  // Error regression tracking: detect when partial patches make things worse
  let prevErrorCount = Infinity;
  let regressionStreak = 0;
  let forceFullFile = false;

  while (attempt < maxAttempts) {
    attempt++;
    await ctx.appendLogs(`\n[Orchestrator] ── Attempt ${attempt}/${maxAttempts} ──\n`);

    // ── RESTORE ──
    await ctx.appendLogs(`[DependencyInstallAgent] Running dependency restore...\n`);
    const installResult = await runDependencyInstall(ctx, codeExecution, request);
    lastStdout = installResult.stdout;
    lastStderr = installResult.stderr;

    if (installResult.exitCode !== 0) {
      lastExitCode = installResult.exitCode;
      const combinedOutput = [lastStdout, lastStderr].filter(Boolean).join("\n");

      const sdkFixed = await tryFixSdkNotFound(combinedOutput, projectPath);
      if (sdkFixed && attempt < maxAttempts) {
        await ctx.appendLogs(`[Orchestrator] Detected SDK version conflict from global.json — removed pin. Retrying...\n`);
        continue;
      }

      const analysis = analyzeTerminalOutput(stack, installResult.exitCode, lastStdout, lastStderr);
      lastParsedIssues = analysis.parsedIssues;
      lastSummary = analysis.summary;
      await ctx.appendLogs(`[TerminalAnalysis] Restore failed (exit ${installResult.exitCode}), ${lastParsedIssues.length} issue(s) parsed.\n`);
      for (const issue of lastParsedIssues.slice(0, 5)) {
        await ctx.appendLogs(`  • [${issue.type}] ${issue.file ? issue.file + ": " : ""}${issue.message.slice(0, 120)}\n`);
      }
      if (lastParsedIssues.length === 0 && attempt < maxAttempts) {
        await ctx.appendLogs(`[Orchestrator] No parseable issues from restore — retrying...\n`);
        continue;
      }
    } else {
      await ctx.appendLogs(`[DependencyInstallAgent] Restore succeeded.\n`);

      // ── BUILD & TEST ──
      await ctx.appendLogs(`[BuildRunAgent] Running build and tests...\n`);
      const testResult = await runBuildAndTest(ctx, codeExecution, request);
      lastStdout = (installResult.stdout + "\n" + testResult.stdout).trim();
      lastStderr = (installResult.stderr + "\n" + testResult.stderr).trim();
      lastExitCode = testResult.exitCode;
      const analysis = analyzeTerminalOutput(stack, testResult.exitCode, lastStdout, lastStderr);
      lastParsedIssues = analysis.parsedIssues;
      lastSummary = analysis.summary;
      lastTestCounts = analysis.testCounts;

      if (analysis.passed) {
        // Check for remaining warnings even when tests pass
        const warnings = lastParsedIssues.filter(i => i.severity === "warning");
        if (warnings.length > 0) {
          await ctx.appendLogs(`[AgentMonitor] Tests passed with ${warnings.length} warning(s):\n`);
          for (const w of warnings.slice(0, 10)) {
            await ctx.appendLogs(`  ⚠ ${w.file ? w.file + ":" + (w.line ?? "?") + " " : ""}${w.message.slice(0, 120)}\n`);
          }
        }
        await ctx.appendLogs(`[TerminalAnalysis] All tests passed!\n`);
        await ctx.setOutcome({
          status: "passed",
          lastLogs: [lastStdout, lastStderr].filter(Boolean).join("\n"),
          exitCode: 0,
          testSummary: lastSummary,
          testsRun: analysis.testCounts?.testsRun,
          testsPassed: analysis.testCounts?.testsPassed,
          testsFailed: analysis.testCounts?.testsFailed,
          testsSkipped: analysis.testCounts?.testsSkipped,
        });
        return { passed: true, attempts: attempt };
      }

      await ctx.appendLogs(`[TerminalAnalysis] Build/test failed (exit ${testResult.exitCode}), ${lastParsedIssues.length} issue(s) parsed.\n`);
      for (const issue of lastParsedIssues.slice(0, 5)) {
        await ctx.appendLogs(`  • [${issue.type}] ${issue.file ? issue.file + ":" + (issue.line ?? "?") + " " : ""}${issue.message.slice(0, 120)}\n`);
      }
    }

    // ── ERROR REGRESSION DETECTION ──
    const currentErrorCount = lastParsedIssues.length;
    if (attempt > 1 && currentErrorCount >= prevErrorCount) {
      regressionStreak++;
      await ctx.appendLogs(`[Orchestrator] ⚠ Error count not improving: ${prevErrorCount} → ${currentErrorCount} (regression streak: ${regressionStreak})\n`);
      if (regressionStreak >= 2 && !forceFullFile) {
        forceFullFile = true;
        await ctx.appendLogs(`[Orchestrator] 🔄 Switching to full-file replacement strategy — partial patches are not converging\n`);
      }
    } else if (attempt > 1 && currentErrorCount < prevErrorCount) {
      if (regressionStreak > 0) regressionStreak = 0;
      await ctx.appendLogs(`[Orchestrator] ✓ Error count improving: ${prevErrorCount} → ${currentErrorCount}\n`);
    }
    prevErrorCount = currentErrorCount;

    // ── REQUEST FIXES ──
    if (attempt >= maxAttempts) {
      await ctx.appendLogs(`[Orchestrator] Max attempts (${maxAttempts}) reached. Failing.\n`);

      // Log remaining issues as recommendations
      if (lastParsedIssues.length > 0) {
        await ctx.appendLogs(`\n[AgentMonitor] ── Remaining Issues (${lastParsedIssues.length}) ──\n`);
        for (const issue of lastParsedIssues) {
          await ctx.appendLogs(`  • [${issue.type}] ${issue.file ? issue.file + ":" + (issue.line ?? "?") + " " : ""}${issue.message.slice(0, 200)}\n`);
        }
        await ctx.appendLogs(`[AgentMonitor] Recommendation: Review the above issues manually or re-run with updated code.\n`);
      }

      await ctx.setOutcome({
        status: "failed",
        lastLogs: [lastStdout, lastStderr].filter(Boolean).join("\n"),
        exitCode: lastExitCode,
        testSummary: lastSummary ?? `Failed after ${maxAttempts} attempts.`,
        testsRun: lastTestCounts?.testsRun,
        testsPassed: lastTestCounts?.testsPassed,
        testsFailed: lastTestCounts?.testsFailed,
        testsSkipped: lastTestCounts?.testsSkipped,
      });
      return {
        passed: false,
        attempts: attempt,
        message: `Failed after ${maxAttempts} attempts.`,
      };
    }

    await ctx.appendLogs(`[FixValidationAgent] Analyzing errors and identifying affected files...\n`);

    // Step 1: Normalize parsed issue paths to relative
    normalizeIssuePaths(lastParsedIssues, projectPath);

    // Step 2: Extract ALL file paths from raw output (secondary pass)
    const allFilePaths = extractFilePathsFromOutput(lastStdout, lastStderr, projectPath);
    for (const issue of lastParsedIssues) {
      if (issue.file) allFilePaths.add(issue.file);
    }

    // Separate .csproj from source files for logging clarity
    const csprojPaths = Array.from(allFilePaths).filter(p => p.endsWith(".csproj"));
    const srcPaths = Array.from(allFilePaths).filter(p => !p.endsWith(".csproj"));
    await ctx.appendLogs(`[FixValidationAgent] Found ${allFilePaths.size} file(s) referenced in output (${csprojPaths.length} project file(s), ${srcPaths.length} source file(s)).\n`);
    for (const fp of csprojPaths) {
      await ctx.appendLogs(`  📦 ${fp}\n`);
    }
    for (const fp of srcPaths.slice(0, 10)) {
      await ctx.appendLogs(`  📄 ${fp}\n`);
    }
    if (srcPaths.length > 10) {
      await ctx.appendLogs(`  ... and ${srcPaths.length - 10} more source file(s)\n`);
    }

    // Step 3: Read ALL referenced files from disk
    const fileContents = await ctx.getFileContents(Array.from(allFilePaths));
    const readCount = Object.values(fileContents).filter(c => c.length > 0).length;
    await ctx.appendLogs(`[FixValidationAgent] Read ${readCount} file(s) from disk.\n`);

    // Step 4: Enrich issue snippets with line-context windows
    enrichIssueSnippets(lastParsedIssues, fileContents);

    // Step 5: Request fixes from LLM with full context
    const fixStrategy = forceFullFile ? " (full-file replacement mode)" : "";
    await ctx.appendLogs(`[FixValidationAgent] Requesting LLM fixes for ${lastParsedIssues.length} issue(s)${fixStrategy}...\n`);
    const edits = await ctx.requestFixes(lastParsedIssues, lastStdout, lastStderr, fileContents, { forceFullFile });
    if (!edits.length) {
      await ctx.appendLogs(`[FixValidationAgent] LLM returned 0 edits on attempt ${attempt}.\n`);
      if (attempt >= maxAttempts) {
        await ctx.appendLogs(`[FixValidationAgent] No fixes proposed after ${attempt} attempts — failing.\n`);
        await ctx.setOutcome({
          status: "failed",
          lastLogs: [lastStdout, lastStderr].filter(Boolean).join("\n"),
          exitCode: lastExitCode,
          testSummary: "No fixes proposed.",
        });
        return { passed: false, attempts: attempt, message: "No fixes proposed." };
      }
      await ctx.appendLogs(`[FixValidationAgent] Will retry on next attempt...\n`);
      continue;
    }

    // Step 6: Log detailed edits before applying
    const fullFileEdits = edits.filter(e => e.fullContent);
    const patchEdits = edits.filter(e => !e.fullContent);
    await ctx.appendLogs(`[FixValidationAgent] Applying ${edits.length} edit(s): ${fullFileEdits.length} full-file replacement(s), ${patchEdits.length} patch(es)\n`);
    for (const edit of edits) {
      if (edit.fullContent) {
        await ctx.appendLogs(`  📝 ${edit.filePath} (FULL FILE REPLACEMENT, ${edit.fullContent.length} chars)\n`);
      } else {
        const lineInfo = edit.startLine ? ` (line ${edit.startLine}-${edit.endLine ?? edit.startLine})` : "";
        await ctx.appendLogs(`  ✏️ ${edit.filePath}${lineInfo}\n`);
        if (edit.oldContent) {
          const oldPreview = edit.oldContent.split("\n").slice(0, 3).join("\n").slice(0, 120);
          const newPreview = edit.newContent.split("\n").slice(0, 3).join("\n").slice(0, 120);
          await ctx.appendLogs(`     OLD: ${oldPreview}${edit.oldContent.length > 120 ? "..." : ""}\n`);
          await ctx.appendLogs(`     NEW: ${newPreview}${edit.newContent.length > 120 ? "..." : ""}\n`);
        }
      }
    }

    await ctx.applyEdits(edits);
    await ctx.appendLogs(`[Orchestrator] Edits applied — retrying...\n`);
  }

  // Final recommendations if loop exhausted
  if (lastParsedIssues.length > 0) {
    await ctx.appendLogs(`\n[AgentMonitor] ── Remaining Issues (${lastParsedIssues.length}) ──\n`);
    for (const issue of lastParsedIssues) {
      await ctx.appendLogs(`  • [${issue.type}] ${issue.file ? issue.file + ":" + (issue.line ?? "?") + " " : ""}${issue.message.slice(0, 200)}\n`);
    }
  }

  await ctx.setOutcome({
    status: "failed",
    lastLogs: [lastStdout, lastStderr].filter(Boolean).join("\n"),
    exitCode: lastExitCode,
    testSummary: lastSummary ?? `Failed after ${maxAttempts} attempts.`,
    testsRun: lastTestCounts?.testsRun,
    testsPassed: lastTestCounts?.testsPassed,
    testsFailed: lastTestCounts?.testsFailed,
    testsSkipped: lastTestCounts?.testsSkipped,
  });
  return {
    passed: false,
    attempts: maxAttempts,
    message: `Failed after ${maxAttempts} attempts.`,
  };
}
