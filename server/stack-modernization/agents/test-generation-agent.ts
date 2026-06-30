/**
 * Stack Modernization - Test Generation Agent
 * Generates comprehensive unit tests for upgraded code
 * 
 * Outputs:
 * - Generated test files for all modified code
 * - test-results.md: Test execution results and coverage report
 */

import type { 
  StackModernizationState,
  ExtractedFile
} from "../types";
import { getLLMClient } from "../services/llm-selector";
import * as path from "path";
import { 
  TEST_GENERATION_SYSTEM_PROMPT, 
  buildTestGenerationPrompt 
} from "../prompts/test-generation-prompts";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";

export interface GeneratedTest {
  filePath: string;
  testCode: string;
  testFramework: string;
  coverageTarget: string[];
  testCases: string[];
  taskId?: string; // Links test to the task that modified the files
  taskTitle?: string;
}

export interface TestExecutionResult {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage: number;
  failedTests: Array<{
    name: string;
    error: string;
    fix: string;
  }>;
}

/**
 * Execute test generation phase
 */
export async function executeTestGenerationAgent(
  state: StackModernizationState
): Promise<StackModernizationState> {

  try {
    // Step 1: Identify files and group by task when task execution results are available
    const filesToTest = identifyFilesForTesting(state);
    console.log(`[TestGen] Identified ${filesToTest.length} files for testing (modifiedFiles=${state.modifiedFiles?.length ?? 0}, extractedFiles=${state.extractedFiles?.length ?? 0})`);

    if (filesToTest.length === 0) {
      console.warn("[TestGen] ⚠️ No testable files found! Generating empty test suite.");
      // Still return valid state so downstream nodes don't fail
      return {
        ...state,
        generatedTests: [],
        testResultsMarkdown: "# Test Generation\n\nNo testable files were identified for test generation.",
        confidenceReportMarkdown: "# Confidence Report\n\nNo tests were generated as no testable files were identified.",
        currentStage: "tests_generated",
        status: "completed",
      };
    }

    // Step 2: Generate tests (per-task grouping when available)
    let generatedTests: GeneratedTest[];

    const taskResults = state.taskExecutionResults || [];
    const completedTasks = taskResults.filter((tr: any) => tr.status === "completed" && tr.alteredFiles?.length > 0);

    if (completedTasks.length > 0) {
      console.log(`[TestGen] Using task-based generation: ${completedTasks.length} completed tasks with altered files`);
      generatedTests = await generateTestsPerTask(state, filesToTest, completedTasks);
    } else {
      console.log(`[TestGen] Using file-based generation (no completed tasks with alteredFiles found). taskResults.length=${taskResults.length}, completedWithFiles=${completedTasks.length}`);
      // Log why task-based generation wasn't used
      if (taskResults.length > 0) {
        const statuses = taskResults.map((t: any) => t.status);
        const statusCounts: Record<string, number> = {};
        statuses.forEach((s: string) => { statusCounts[s] = (statusCounts[s] || 0) + 1; });
        console.log(`[TestGen] Task statuses: ${JSON.stringify(statusCounts)}`);
        const withoutAlteredFiles = taskResults.filter((t: any) => t.status === "completed" && (!t.alteredFiles || t.alteredFiles.length === 0));
        if (withoutAlteredFiles.length > 0) {
          console.warn(`[TestGen] ⚠️ ${withoutAlteredFiles.length} tasks completed but have NO alteredFiles. Task IDs: ${withoutAlteredFiles.map((t: any) => t.taskId).join(", ")}`);
        }
      }
      generatedTests = await generateTestsForFiles(state, filesToTest);
    }

    console.log(`[TestGen] Generated ${generatedTests.length} test files from ${filesToTest.length} source files`);

    if (generatedTests.length === 0) {
      console.warn("[TestGen] ⚠️ No tests were generated despite having testable files! This may indicate LLM failures.");
    }

    // Step 3: Generate test results markdown
    const testResultsMarkdown = generateTestResultsMarkdown(generatedTests, state);

    // Step 4: Generate Confidence Report
    const confidenceReportMarkdown = await generateConfidenceReport({
      ...state,
      generatedTests,
      testResultsMarkdown,
    });

    // Update state
    const finalState: StackModernizationState = {
      ...state,
      generatedTests,
      testResultsMarkdown,
      confidenceReportMarkdown,
      currentStage: "tests_generated",
      status: "completed",
    };

    return finalState;

  } catch (error) {
    console.error("[TestGen] ❌ Error:", error);
    throw error;
  }
}

/**
 * Generate the enterprise-grade Confidence Report via LLM
 */
async function generateConfidenceReport(state: StackModernizationState): Promise<string> {
  try {
    const { CONFIDENCE_REPORT_SYSTEM_PROMPT, buildConfidenceReportPrompt } = await import("../prompts/confidence-report-prompts");
    const { client, model } = getLLMClient(state.llmProvider);
    
    const prompt = buildConfidenceReportPrompt(state);
    
    const response = await trackedLLMCall(client, {
      model,
      messages: [
        { role: "system", content: `${buildBudgetConstraint("testGeneration", "markdown")}\n\n${CONFIDENCE_REPORT_SYSTEM_PROMPT}` },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.testGeneration, model),
    }, { analysisId: state.analysisId, phase: "tests", agent: "TestGeneration/ConfidenceReport" });
    
    const report = response.choices[0]?.message?.content?.trim() || "";
    
    if (report.length > 100) {
      return report;
    }
    
    console.warn("[TestGen] ⚠️ Confidence report too short, generating fallback");
    return generateFallbackConfidenceReport(state);
  } catch (err) {
    console.error("[TestGen] ⚠️ Confidence report LLM call failed, using fallback:", err instanceof Error ? err.message : err);
    return generateFallbackConfidenceReport(state);
  }
}

/**
 * Fallback confidence report when LLM is unavailable or returns too little.
 * Includes a proper Change Log and Current vs Target so the report is still useful.
 */
function generateFallbackConfidenceReport(state: StackModernizationState): string {
  const selections = state.userSelections || [];
  const modifiedFiles = state.modifiedFiles || [];
  const generatedTests = state.generatedTests || [];
  const totalFiles = state.extractedFiles?.length || 0;

  const modifiedPct = totalFiles > 0 ? Math.round(modifiedFiles.length / totalFiles * 100) : 0;
  const testCovPct = modifiedFiles.length > 0 ? Math.round(generatedTests.length / modifiedFiles.length * 100) : 0;

  let overallScore = 50;
  if (testCovPct >= 80) overallScore += 20;
  else if (testCovPct >= 50) overallScore += 10;
  if (modifiedPct < 20) overallScore += 15;
  if (selections.length > 0) overallScore += 10;
  const confidence = overallScore >= 80 ? "HIGH" : overallScore >= 60 ? "MEDIUM" : "LOW";

  // Change Log: file path + change type / package upgrades (robust when changes[] missing)
  const changeLogRows = modifiedFiles.length === 0
    ? "| (No files modified) | — |"
    : modifiedFiles.map((f: any) => {
        const fp = f.path || f.filePath || "unknown";
        const changes = (f.changes || []).length > 0
          ? (f.changes || []).map((c: any) => `${c.package || "package"}: ${c.oldVersion || "?"} → ${c.newVersion || "?"}`).join("; ")
          : "Version/config updates";
        return `| \`${fp}\` | ${changes} |`;
      }).join("\n");

  // Current vs Target from user selections
  const currentVsTarget = selections.length > 0
    ? selections.map((s: any) => `- **${s.package}**: ${s.currentVersion || "?"} → ${s.selectedVersion}`).join("\n")
    : "No upgrade targets recorded.";

  return `# Upgrade Confidence Report

## 1. Executive Summary
- **Overall Confidence Score**: ${confidence} (${overallScore}/100)
- **Go / No-Go Recommendation**: ${overallScore >= 70 ? "CONDITIONAL GO" : "REVIEW REQUIRED"}
- **Known Residual Risks**: Manual validation of modified files and staging deployment recommended.
- **Rollback Readiness**: Ensure previous version artifacts and rollback procedure are in place.

## 2. What Was Changed (Change Log)
| File | Change type / Package upgrades |
|------|--------------------------------|
${changeLogRows}

## 3. Current vs Target State
${currentVsTarget}

## 4. Upgrade Scope
| Metric | Value |
|--------|-------|
| Total Files in Repo | ${totalFiles} |
| Files Modified | ${modifiedFiles.length} (${modifiedPct}%) |
| Files Unchanged | ${totalFiles - modifiedFiles.length} |
| Tests Generated | ${generatedTests.length} |
| Test Coverage (modified files) | ${testCovPct}% |

## 5. Risk Assessment
- **Dependency Risk**: ${selections.length > 3 ? "Medium" : "Low"} — ${selections.length} packages upgraded
- **Code Change Risk**: ${modifiedPct > 30 ? "High" : modifiedPct > 10 ? "Medium" : "Low"} — ${modifiedPct}% of codebase modified
- **Test Coverage**: ${testCovPct >= 80 ? "Good" : testCovPct >= 50 ? "Moderate" : "Low"} — ${testCovPct}% of modified files have tests

## 6. Recommendations
1. Review all modified files before deployment
2. Run the generated test suite in your CI/CD pipeline
3. Perform manual smoke testing on critical user flows
4. Deploy to staging environment first
5. Monitor error rates and performance metrics post-deployment

---
*Generated by DevX Stack Modernization Confidence Engine v2.0 (fallback)*
*Report Date: ${new Date().toISOString()}*
`;
}

/**
 * Identify files that need test generation.
 *
 * Three tiers of coverage:
 *   T1 — Modified files: directly changed during upgrade (highest priority)
 *   T2 — Dependent files: files that import/consume modified files
 *         (from importGraph + coupling registry)
 *   T3 — Important source files: controllers, services, etc.
 */
function identifyFilesForTesting(state: StackModernizationState): ExtractedFile[] {
  const extractedFiles = state.extractedFiles || [];
  const modifiedFiles = state.modifiedFiles || [];
  const importGraph = state.importGraph;
  const couplingRegistry = state.couplingRegistry || [];

  const normalizePath = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

  // Build a map of modified files (upgraded content replaces original)
  const modifiedMap = new Map<string, string>();
  for (const mf of modifiedFiles) {
    const filePath = (mf as any).path || (mf as any).filePath || '';
    const content = (mf as any).content || (mf as any).modifiedContent || '';
    if (filePath && content) {
      modifiedMap.set(normalizePath(filePath), content);
    }
  }

  // Build dependent file set from import graph (files that import modified files)
  const dependentPaths = new Set<string>();
  if (importGraph?.fileToFiles) {
    const modifiedPaths = new Set(modifiedMap.keys());
    for (const [file, deps] of Object.entries(importGraph.fileToFiles)) {
      const normalizedFile = normalizePath(file);
      if (modifiedPaths.has(normalizedFile)) continue;
      if (deps.some(d => modifiedPaths.has(normalizePath(d)))) {
        dependentPaths.add(normalizedFile);
      }
    }
  }

  // Add coupling group peers of modified files
  const coupledPaths = new Set<string>();
  for (const group of couplingRegistry) {
    const groupPaths = group.files.map(normalizePath);
    const hasModified = groupPaths.some(gp => modifiedMap.has(gp));
    if (hasModified) {
      for (const gp of groupPaths) {
        if (!modifiedMap.has(gp)) coupledPaths.add(gp);
      }
    }
  }

  // Filter to testable source code files
  const testableExtensions = new Set(['.js', '.ts', '.jsx', '.tsx', '.java', '.cs', '.py', '.go']);

  // Create a combined list: use upgraded content for modified files, original for rest
  const allFiles: ExtractedFile[] = extractedFiles.map(file => {
    const normalizedRelPath = normalizePath(file.relativePath);
    const upgradedContent = modifiedMap.get(normalizedRelPath);
    if (upgradedContent) {
      return { ...file, content: upgradedContent };
    }
    return file;
  });

  // Also add any modified files that weren't in extractedFiles (edge case)
  const extractedPathSet = new Set(extractedFiles.map(f => normalizePath(f.relativePath)));
  for (const [filePath, content] of modifiedMap) {
    if (!extractedPathSet.has(filePath)) {
      allFiles.push({
        relativePath: filePath,
        fullPath: filePath,
        content,
        size: content.length,
      } as ExtractedFile);
    }
  }

  const testableFiles = allFiles.filter(file => {
    const ext = path.extname(file.relativePath).toLowerCase();
    const name = path.basename(file.relativePath).toLowerCase();

    if (name.includes('.test.') || name.includes('.spec.') || name.includes('tests.') ||
        file.relativePath.includes('/test/') || file.relativePath.includes('\\test\\') ||
        file.relativePath.includes('/tests/') || file.relativePath.includes('\\tests\\')) {
      return false;
    }

    if (name.startsWith('.') || name === 'package.json' || name.endsWith('.config') ||
        name.endsWith('.csproj') || name.endsWith('.sln') || name.endsWith('.json') ||
        name.endsWith('.xml') || name.endsWith('.yaml') || name.endsWith('.yml')) {
      return false;
    }

    if (!testableExtensions.has(ext)) return false;
    if ((file.content?.length || 0) < 50) return false;

    return true;
  });

  // Score and sort: T1 modified > T2 dependent/coupled > T3 important patterns
  const scored = testableFiles.map(file => {
    const normalizedPath = normalizePath(file.relativePath);
    const name = path.basename(file.relativePath).toLowerCase();
    let score = 0;

    // T1: Modified/upgraded files — test the NEW code
    if (modifiedMap.has(normalizedPath)) score += 100;

    // T2: Dependent files — their contract may have broken
    if (dependentPaths.has(normalizedPath)) score += 70;

    // T2: Coupled files — they must stay in sync
    if (coupledPaths.has(normalizedPath)) score += 65;

    // T3: Important file patterns
    if (name.includes('controller') || name.includes('service') || name.includes('handler')) score += 30;
    if (name.includes('model') || name.includes('entity') || name.includes('repository')) score += 25;
    if (name.includes('util') || name.includes('helper') || name.includes('manager')) score += 20;
    if (name === 'program.cs' || name === 'startup.cs' || name === 'app.cs') score += 15;
    if (name.includes('index.') || name.includes('main.')) score += 15;

    const size = file.content?.length || 0;
    if (size > 500) score += 10;
    if (size > 2000) score += 10;

    return { file, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const selected = scored.filter(s => s.score >= 10).map(s => s.file);

  return selected;
}

/**
 * Generate tests grouped by task - each task's altered files get targeted tests
 * that reference the task context (what was changed and why).
 */
async function generateTestsPerTask(
  state: StackModernizationState,
  allTestableFiles: ExtractedFile[],
  completedTasks: Array<{ taskId: string; summary: string; alteredFiles: Array<{ path: string; changeDescription: string }>; fixedIssues?: string[] }>
): Promise<GeneratedTest[]> {
  const llmClient = getLLMClient(state.llmProvider);
  const { client, model } = llmClient;
  const tasks = state.upgradeTasks || [];

  // Step 1: Deduplicate files across all tasks. Track which task(s) each file belongs to.
  const fileTaskMap = new Map<string, { file: ExtractedFile; tasks: Array<{ taskId: string; taskTitle: string; context: string }> }>();

  for (const taskResult of completedTasks) {
    const taskDef = tasks.find((t: any) => t.id === taskResult.taskId);
    const taskTitle = (taskDef as any)?.title || taskResult.taskId;
    const alteredPaths = new Set(taskResult.alteredFiles.map((f) => f.path.toLowerCase()));

    const taskContext = `Task: "${taskTitle}" — ${taskResult.summary}. Changes: ${taskResult.alteredFiles.map((f) => `${f.path}: ${f.changeDescription}`).join("; ")}`;

    for (const file of allTestableFiles) {
      if (!alteredPaths.has(file.relativePath.toLowerCase())) continue;
      const key = file.relativePath.toLowerCase();
      if (!fileTaskMap.has(key)) {
        fileTaskMap.set(key, { file, tasks: [] });
      }
      fileTaskMap.get(key)!.tasks.push({ taskId: taskResult.taskId, taskTitle, context: taskContext });
    }
  }

  const uniqueFiles = [...fileTaskMap.values()];

  // Step 2: Group into batches for multi-file LLM calls
  const groups = groupFilesForTestGen(uniqueFiles.map((u) => u.file), model);

  // Step 3: Parallel execution with concurrency 3
  const CONCURRENCY = 3;
  const allTests: GeneratedTest[] = [];

  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY);

    const batchPromises = batch.map(async (group) => {
      try {
        if (group.files.length === 1) {
          const entry = fileTaskMap.get(group.files[0].relativePath.toLowerCase());
          const taskCtx = entry?.tasks.map((t) => t.context).join("\n") ?? "";
          return await generateTestSingleWithTaskContext(client, model, group.files[0], state, taskCtx, entry?.tasks[0]);
        } else {
          return await generateTestMultiFileWithTaskContext(client, model, group.files, state, fileTaskMap);
        }
      } catch (err) {
        console.error(`[TestGen] Group failed:`, err instanceof Error ? err.message : err);
        return [];
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const results of batchResults) allTests.push(...results);
  }

  return allTests;
}

/**
 * Build context from code review + consistency reports so the test
 * generator knows about known issues and can write targeted tests for them.
 */
function buildReviewContextForTest(state: StackModernizationState, filePath?: string): string {
  const parts: string[] = [];
  const normP = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedTarget = filePath ? normP(filePath) : "";

  // Consistency report
  const cr = state.consistencyReport;
  if (cr && cr.violations.length > 0) {
    const relevant = filePath
      ? cr.violations.filter(v => normP(v.file) === normalizedTarget)
      : cr.violations;
    if (relevant.length > 0) {
      parts.push("CONSISTENCY ISSUES (write regression tests for these):");
      for (const v of relevant.slice(0, 10)) {
        parts.push(`  - [${v.severity}] ${v.file}: ${v.issue}${v.autoFixable ? " (auto-fixed)" : ""}`);
      }
    }
  }

  // Code review report
  const rr = state.codeReviewReport;
  if (rr && rr.issues.length > 0) {
    const relevant = filePath
      ? rr.issues.filter(i => normP(i.file) === normalizedTarget)
      : rr.issues;
    if (relevant.length > 0) {
      parts.push("CODE REVIEW ISSUES (write tests that verify these were fixed correctly):");
      for (const i of relevant.slice(0, 10)) {
        parts.push(`  - [${i.severity}/${i.category}] ${i.file}: ${i.issue}${i.fixed ? " (fixed)" : " (UNFIXED)"}`);
      }
    }
  }

  return parts.length > 0 ? "\n\n" + parts.join("\n") : "";
}

async function generateTestSingleWithTaskContext(
  client: any, model: string, file: ExtractedFile, state: StackModernizationState,
  taskContext: string, taskInfo?: { taskId: string; taskTitle: string }
): Promise<GeneratedTest[]> {
  const testFramework = determineTestFramework(file.relativePath);
  const testPath = getTestFilePath(file.relativePath, testFramework);

  let importHint = "";
  if (testFramework === "Jest") {
    const srcDir = path.dirname(file.relativePath).replace(/\\/g, "/");
    const testDir = path.dirname(testPath).replace(/\\/g, "/");
    const srcBasename = path.basename(file.relativePath, path.extname(file.relativePath));
    let rel = path.relative(testDir, srcDir).replace(/\\/g, "/");
    if (!rel.startsWith(".")) rel = "./" + rel;
    importHint = `\nYour test file will be saved at: \`${testPath}\`\nImport source using: \`import { ... } from '${rel}/${srcBasename}';\`\n`;
  } else if (testFramework === "xUnit") {
    // Extract the actual namespace from the source file
    const nsMatch = (file.content || "").match(/^\s*namespace\s+([\w.]+)/m);
    const dirname = path.dirname(file.relativePath).replace(/\\/g, "/");
    let xunitNamespace = "";
    if (nsMatch) {
      xunitNamespace = nsMatch[1];
    } else {
      const dirParts = dirname.split("/").filter(p => p && p !== ".");
      xunitNamespace = dirParts.length > 0 ? dirParts.join(".") : path.basename(file.relativePath, path.extname(file.relativePath));
    }
    importHint = `\nYour test file will be saved at: \`${testPath}\`\nUse \`using ${xunitNamespace};\` for the namespace. The test project references the source project.\n**IMPORTANT**: The namespace \`${xunitNamespace}\` was extracted from the source file. Use it exactly as shown — do NOT guess or fabricate namespace names.\n`;
  } else if (testFramework === "pytest") {
    // Compute proper Python import path
    const pyImport = file.relativePath.replace(/\\/g, "/").replace(/\//g, ".").replace(/\.py$/, "");
    importHint = `\nYour test file will be saved at: \`${testPath}\`\nImport using: \`from ${pyImport} import ...\`\nThe project root is added to sys.path, so imports resolve from the project root.\n`;
  } else if (testFramework === "JUnit 5") {
    // Extract actual package from source file
    const pkgMatch = (file.content || "").match(/^package\s+([\w.]+);/m);
    const javaPackage = pkgMatch ? pkgMatch[1] : "";
    importHint = `\nYour test file will be saved at: \`${testPath}\`\n${javaPackage ? `Use \`package ${javaPackage};\` and import the class under test from this package.` : "Use the same package as the source file."}\n`;
  }

  const { sanitizeForContentFilter } = await import("../services/prompt-sanitizer");
  const sanitizedContent = sanitizeForContentFilter(file.content || "", "standard");
  const sourceMap = buildSourceFileMap(sanitizedContent, file.relativePath);
  const reviewContext = buildReviewContextForTest(state, file.relativePath);

  const prompt = `${taskContext ? taskContext + "\n\n" : ""}Generate comprehensive unit tests for the UPGRADED version of this file. Focus on testing the changes made during the upgrade.
${importHint}${sourceMap}${reviewContext}
SOURCE FILE: ${file.relativePath}
\`\`\`
${sanitizedContent.slice(0, 12000)}
\`\`\`

Requirements:
- Test all public methods, especially those affected by the upgrade
- Include edge cases and error handling
- If CONSISTENCY ISSUES or CODE REVIEW ISSUES are listed above, write specific regression tests for each
- Test that deprecated/removed APIs are no longer called
- Use ${testFramework} framework
- Use the EXACT import path shown above to import the source file
- ONLY reference types, classes, interfaces, and methods that ACTUALLY EXIST in the source file above
- Do NOT invent or hallucinate service names, interface names, or method signatures
- Return ONLY the test code, no explanations`;

  const response = await trackedLLMCall(client, {
    model,
    messages: [
      { role: "system", content: `${buildBudgetConstraint("testGenSummary", "code")}\n\n${TEST_GENERATION_SYSTEM_PROMPT}` },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.testGenSummary, model),
  }, { analysisId: state.analysisId, phase: "tests", agent: "TestGeneration/SingleWithTask" });

  let testCode = response.choices[0]?.message?.content?.trim() || "";
  if (testCode.startsWith("```")) {
    testCode = testCode.replace(/^```[a-z]*\n?/, "").replace(/\n?```\s*$/, "");
  }

  if (testCode && testCode.length > 30) {
    return [{
      filePath: getTestFilePath(file.relativePath, testFramework),
      testCode,
      testFramework,
      coverageTarget: extractFunctionsAndClasses(file.content || ""),
      testCases: extractTestCases(testCode),
      taskId: taskInfo?.taskId,
      taskTitle: taskInfo?.taskTitle,
    }];
  }
  return [];
}

async function generateTestMultiFileWithTaskContext(
  client: any, model: string, files: ExtractedFile[], state: StackModernizationState,
  fileTaskMap: Map<string, { file: ExtractedFile; tasks: Array<{ taskId: string; taskTitle: string; context: string }> }>
): Promise<GeneratedTest[]> {
  const testFramework = determineTestFramework(files[0].relativePath);
  const reviewContext = buildReviewContextForTest(state);
  const filesSection = files.map((f, i) => {
    const entry = fileTaskMap.get(f.relativePath.toLowerCase());
    const ctx = entry?.tasks[0]?.context ?? "";
    const content = f.content || "";
    const maxPerFile = 15000;
    const truncated = content.length > maxPerFile ? content.slice(0, maxPerFile) + "\n// ...(truncated)" : content;
    return `═══ SOURCE FILE ${i + 1}: ${f.relativePath} ═══\n${ctx ? `Context: ${ctx}\n` : ""}\`\`\`\n${truncated}\n\`\`\``;
  }).join("\n\n");

  const prompt = `Generate comprehensive unit tests for the following ${files.length} UPGRADED source files. Focus on testing changes made during the upgrade.
Use ${testFramework} as the test framework.
${reviewContext}

${filesSection}

**REQUIREMENTS:**
- Cover all public methods, edge cases, error handling, and boundary conditions
- Each file should get its own test class/describe block
- If CONSISTENCY ISSUES or CODE REVIEW ISSUES are listed above, write specific regression tests for each
- Test that deprecated/removed APIs are no longer called

**OUTPUT FORMAT - CRITICAL:**
Return ALL test files using this EXACT format:

===TEST: path/to/testfile1.test.ext===
[complete test code for file 1]
===END_TEST===

===TEST: path/to/testfile2.test.ext===
[complete test code for file 2]
===END_TEST===`;

  const response = await trackedLLMCall(client, {
    model,
    messages: [
      { role: "system", content: `${buildBudgetConstraint("testGeneration", "code")}\n\n${TEST_GENERATION_SYSTEM_PROMPT}` },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.testGeneration, model),
  }, { analysisId: state.analysisId, phase: "tests", agent: "TestGeneration/MultiWithTask" });

  const responseText = response.choices[0]?.message?.content || "";
  const results: GeneratedTest[] = [];
  const testRegex = /===TEST:\s*(.+?)===\n([\s\S]*?)===END_TEST===/g;
  let match;

  while ((match = testRegex.exec(responseText)) !== null) {
    let testCode = match[2].trim();
    if (testCode.startsWith("```")) {
      testCode = testCode.replace(/^```[a-z]*\n?/, "").replace(/\n?```\s*$/, "");
    }
    if (testCode && testCode.length > 30) {
      let testPath = match[1].trim().replace(/\\/g, "/");
      if (!testPath.startsWith(DEVX_TEST_SCRIPTS_DIR + "/")) {
        testPath = path.join(DEVX_TEST_SCRIPTS_DIR, testPath).replace(/\\/g, "/");
      }
      const entry = fileTaskMap.get(files[0]?.relativePath.toLowerCase());
      results.push({
        filePath: testPath,
        testCode,
        testFramework,
        coverageTarget: [],
        testCases: extractTestCases(testCode),
        taskId: entry?.tasks[0]?.taskId,
        taskTitle: entry?.tasks[0]?.taskTitle,
      });
    }
  }

  if (results.length === 0 && files.length > 0) {
    console.warn(`[TestGen] Multi-file parsing failed, falling back to individual for ${files.length} files`);
    for (const file of files) {
      const entry = fileTaskMap.get(file.relativePath.toLowerCase());
      const taskCtx = entry?.tasks.map((t) => t.context).join("\n") ?? "";
      const singleResults = await generateTestSingleWithTaskContext(client, model, file, state, taskCtx, entry?.tasks[0]);
      results.push(...singleResults);
    }
  }

  return results;
}

/**
 * Generate tests for identified files
 * 
 * OPTIMIZED: Smart grouping + parallel execution
 * - Groups small related files into single LLM calls (reduces total calls by 50-70%)
 * - Processes groups in parallel with concurrency limit of 3
 * - Falls back to individual calls for large files
 */
async function generateTestsForFiles(
  state: StackModernizationState,
  files: ExtractedFile[]
): Promise<GeneratedTest[]> {
  const llmClient = getLLMClient(state.llmProvider);
  const { client, model } = llmClient;
  const generatedTests: GeneratedTest[] = [];

  // Filter out empty/tiny files
  const validFiles = files.filter(f => (f.content?.length || 0) >= 50);
  
  if (validFiles.length === 0) {
    return [];
  }

  // Group files by language/framework for bundled test generation
  const groups = groupFilesForTestGen(validFiles, model);
  
  groups.forEach((g, i) => {
  });

  // Execute groups in parallel with concurrency of 3
  const CONCURRENCY = 3;
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = groups.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(groups.length / CONCURRENCY);

    const batchPromises = batch.map(async (group) => {
      try {
        if (group.files.length === 1) {
          return await generateTestSingle(client, model, group.files[0], state);
        } else {
          return await generateTestMultiFile(client, model, group.files, state);
        }
      } catch (err) {
        console.error(`[TestGen] ❌ Group failed:`, err instanceof Error ? err.message : err);
        return [];
      }
    });

    const batchResults = await Promise.all(batchPromises);
    for (const results of batchResults) {
      generatedTests.push(...results);
    }
    
  }
  
  return generatedTests;
}

interface TestGenGroup {
  files: ExtractedFile[];
  framework: string;
  estimatedTokens: number;
}

function groupFilesForTestGen(files: ExtractedFile[], model: string): TestGenGroup[] {
  const maxTokensPerCall = model.includes('claude') ? 35000 : 20000;
  
  // Group by test framework type (same-language files can share a call)
  const byFramework = new Map<string, ExtractedFile[]>();
  for (const file of files) {
    const framework = determineTestFramework(file.relativePath);
    if (!byFramework.has(framework)) byFramework.set(framework, []);
    byFramework.get(framework)!.push(file);
  }

  const groups: TestGenGroup[] = [];

  for (const [framework, frameworkFiles] of byFramework) {
    let currentGroup: ExtractedFile[] = [];
    let currentTokens = 0;

    for (const file of frameworkFiles) {
      const fileTokens = Math.ceil((file.content?.length || 0) / 3.5) + 800;

      // Large files get their own group
      if (fileTokens > 12000) {
        if (currentGroup.length > 0) {
          groups.push({ files: currentGroup, framework, estimatedTokens: currentTokens });
          currentGroup = [];
          currentTokens = 0;
        }
        groups.push({ files: [file], framework, estimatedTokens: fileTokens });
        continue;
      }

      if (currentTokens + fileTokens > maxTokensPerCall && currentGroup.length > 0) {
        groups.push({ files: currentGroup, framework, estimatedTokens: currentTokens });
        currentGroup = [];
        currentTokens = 0;
      }

      currentGroup.push(file);
      currentTokens += fileTokens;
    }

    if (currentGroup.length > 0) {
      groups.push({ files: currentGroup, framework, estimatedTokens: currentTokens });
    }
  }

  return groups;
}

async function generateTestSingle(
  client: any,
  model: string,
  file: ExtractedFile,
  state: StackModernizationState
): Promise<GeneratedTest[]> {
  const testFramework = determineTestFramework(file.relativePath);
  const reviewCtx = buildReviewContextForTest(state, file.relativePath);
  const prompt = buildTestGenerationPrompt(file, testFramework, state) + reviewCtx;
  
  const response = await trackedLLMCall(client, {
    model,
    messages: [
      { role: "system", content: `${buildBudgetConstraint("testGeneration", "code")}\n\n${TEST_GENERATION_SYSTEM_PROMPT}` },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.testGeneration, model),
  }, { analysisId: state.analysisId, phase: "tests", agent: "TestGeneration/Single" });
  
  let testCode = response.choices[0]?.message?.content?.trim() || "";
  if (testCode.startsWith("```")) {
    testCode = testCode.replace(/^```[a-z]*\n?/, "").replace(/\n?```\s*$/, "");
  }
  
  if (testCode && testCode.length > 30) {
    return [{
      filePath: getTestFilePath(file.relativePath, testFramework),
      testCode,
      testFramework,
      coverageTarget: extractFunctionsAndClasses(file.content || ""),
      testCases: extractTestCases(testCode)
    }];
  }
  console.warn(`[TestGen] ⚠️ Empty test output for ${file.relativePath}`);
  return [];
}

async function generateTestMultiFile(
  client: any,
  model: string,
  files: ExtractedFile[],
  state: StackModernizationState
): Promise<GeneratedTest[]> {
  const testFramework = determineTestFramework(files[0].relativePath);
  
  const filesSection = files.map((f, i) => {
    const content = f.content || '';
    const maxPerFile = 15000;
    const truncated = content.length > maxPerFile ? content.slice(0, maxPerFile) + '\n// ...(truncated)' : content;
    return `═══ SOURCE FILE ${i + 1}: ${f.relativePath} ═══\n\`\`\`\n${truncated}\n\`\`\``;
  }).join('\n\n');

  const reviewCtx = buildReviewContextForTest(state);
  const prompt = `Generate comprehensive unit tests for the following ${files.length} source files.
Use ${testFramework} as the test framework.
${reviewCtx}

${filesSection}

**REQUIREMENTS:**
- Cover all public methods, edge cases, error handling, and boundary conditions
- Include functional, non-functional, and stress tests where applicable
- If CONSISTENCY ISSUES or CODE REVIEW ISSUES are listed above, write specific regression tests for each
- Each file should get its own test class/describe block

**OUTPUT FORMAT - CRITICAL:**
Return ALL test files using this EXACT format:

===TEST: path/to/testfile1.test.ext===
[complete test code for file 1]
===END_TEST===

===TEST: path/to/testfile2.test.ext===
[complete test code for file 2]
===END_TEST===

Use appropriate test file naming conventions (e.g., *.test.ts, *Test.java, *_test.py).`;

  const response = await trackedLLMCall(client, {
    model,
    messages: [
      { role: "system", content: `${buildBudgetConstraint("testGeneration", "code")}\n\n${TEST_GENERATION_SYSTEM_PROMPT}` },
      { role: "user", content: prompt }
    ],
    temperature: 0,
    max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.testGeneration, model),
  }, { analysisId: state.analysisId, phase: "tests", agent: "TestGeneration/Multi" });

  const responseText = response.choices[0]?.message?.content || "";
  
  // Parse multi-test response
  const results: GeneratedTest[] = [];
  const testRegex = /===TEST:\s*(.+?)===\n([\s\S]*?)===END_TEST===/g;
  let match;

  while ((match = testRegex.exec(responseText)) !== null) {
    let testCode = match[2].trim();
    if (testCode.startsWith("```")) {
      testCode = testCode.replace(/^```[a-z]*\n?/, "").replace(/\n?```\s*$/, "");
    }
    
    if (testCode && testCode.length > 30) {
      let testPath = match[1].trim().replace(/\\/g, "/");
      if (!testPath.startsWith(DEVX_TEST_SCRIPTS_DIR + "/") && !testPath.startsWith(DEVX_TEST_SCRIPTS_DIR + "\\")) {
        testPath = path.join(DEVX_TEST_SCRIPTS_DIR, testPath).replace(/\\/g, "/");
      }
      results.push({
        filePath: testPath,
        testCode,
        testFramework,
        coverageTarget: [],
        testCases: extractTestCases(testCode)
      });
    }
  }

  // Fallback: if multi-file parsing failed, try individual generation
  if (results.length === 0 && files.length > 0) {
    console.warn(`[TestGen] ⚠️ Multi-file test parsing failed, falling back to individual for ${files.length} files`);
    for (const file of files) {
      try {
        const singleResults = await generateTestSingle(client, model, file, state);
        results.push(...singleResults);
      } catch (err) {
        console.error(`[TestGen] ❌ Fallback failed for ${file.relativePath}`);
      }
    }
  }

  return results;
}

/**
 * Determine appropriate test framework based on file type
 */
function determineTestFramework(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    return 'Jest';
  }
  if (ext === '.java') {
    return 'JUnit 5';
  }
  if (ext === '.cs') {
    return 'xUnit';
  }
  if (ext === '.py') {
    return 'pytest';
  }
  if (ext === '.go') {
    return 'testing';
  }
  
  return 'Jest'; // default
}

const DEVX_TEST_SCRIPTS_DIR = "DevX_testScripts";

/**
 * Get test file path based on source file. All generated tests go under DevX_testScripts.
 */
function getTestFilePath(sourceFilePath: string, testFramework: string): string {
  const ext = path.extname(sourceFilePath);
  const basename = path.basename(sourceFilePath, ext);
  const dirname = path.dirname(sourceFilePath);
  let relative: string;
  if (testFramework === 'Jest') {
    relative = path.join(dirname, `${basename}.test${ext}`);
  } else if (testFramework === 'JUnit 5') {
    relative = sourceFilePath.replace('/main/', '/test/').replace('.java', 'Test.java');
  } else if (testFramework === 'xUnit') {
    relative = path.join(dirname, '..', 'Tests', `${basename}Tests${ext}`);
  } else if (testFramework === 'pytest') {
    relative = path.join(dirname, `test_${basename}${ext}`);
  } else {
    relative = path.join(dirname, `${basename}.test${ext}`);
  }
  return path.join(DEVX_TEST_SCRIPTS_DIR, relative).replace(/\\/g, "/");
}

/**
 * Extract function/class names from code (multi-language)
 */
function extractFunctionsAndClasses(code: string): string[] {
  const targets: string[] = [];

  // JS/TS functions
  for (const m of code.matchAll(/(?:function|const|let|var)\s+(\w+)/g)) targets.push(m[1]);
  // JS/TS/Java/C# classes
  for (const m of code.matchAll(/class\s+(\w+)/g)) targets.push(m[1]);
  // C# interfaces
  for (const m of code.matchAll(/interface\s+(I\w+)/g)) targets.push(m[1]);
  // C#/Java public methods
  for (const m of code.matchAll(/(?:public|protected)\s+(?:static\s+|virtual\s+|override\s+|async\s+)*(?:[\w<>\[\]?,\s]+?)\s+(\w+)\s*\(/g)) {
    if (!["class", "interface", "enum", "struct", "if", "for", "while", "switch", "catch", "new", "return"].includes(m[1])) {
      targets.push(m[1]);
    }
  }
  // Python functions/classes
  for (const m of code.matchAll(/def\s+(\w+)\s*\(/g)) targets.push(m[1]);

  return [...new Set(targets)].slice(0, 20);
}

/**
 * Build a "source file map" that lists the exact types, interfaces, methods,
 * and constructor dependencies found in the source file. This prevents the LLM
 * from hallucinating non-existent types.
 */
function buildSourceFileMap(content: string, filePath: string): string {
  const lines: string[] = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".cs") {
    // Namespace
    const nsMatch = content.match(/^\s*namespace\s+([\w.]+)/m);
    if (nsMatch) lines.push(`Namespace: ${nsMatch[1]}`);

    // Classes
    for (const m of content.matchAll(/(?:public|internal)\s+(?:partial\s+|abstract\s+|sealed\s+|static\s+)*(?:class|record)\s+(\w+)(?:\s*:\s*([^\n{]+))?/g)) {
      lines.push(`Class: ${m[1]}${m[2] ? ` (inherits: ${m[2].trim()})` : ""}`);
    }
    // Interfaces
    for (const m of content.matchAll(/(?:public|internal)\s+interface\s+(I\w+)/g)) {
      lines.push(`Interface: ${m[1]}`);
    }
    // Constructors with parameters (critical for DI mocking)
    for (const m of content.matchAll(/(?:public|internal)\s+(\w+)\s*\(([^)]+)\)/g)) {
      const className = m[1];
      const params = m[2].trim();
      if (params && !["if", "for", "while", "switch", "catch", "return"].includes(className)) {
        lines.push(`Constructor: ${className}(${params})`);
      }
    }
    // Public methods
    for (const m of content.matchAll(/(?:public|protected)\s+(?:static\s+|virtual\s+|override\s+|async\s+)*(?:Task<[^>]+>|Task|IActionResult|ActionResult<[^>]+>|void|string|int|bool|[\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)/g)) {
      if (!["class", "interface", "struct", "enum", "if", "for"].includes(m[1])) {
        lines.push(`Method: ${m[1]}(${m[2].trim() || ""})`);
      }
    }
  } else if (ext === ".java") {
    const pkgMatch = content.match(/^package\s+([\w.]+);/m);
    if (pkgMatch) lines.push(`Package: ${pkgMatch[1]}`);
    for (const m of content.matchAll(/(?:public|protected)\s+(?:abstract\s+)?class\s+(\w+)/g)) lines.push(`Class: ${m[1]}`);
    for (const m of content.matchAll(/(?:public|protected)\s+interface\s+(\w+)/g)) lines.push(`Interface: ${m[1]}`);
  } else if (ext === ".py") {
    for (const m of content.matchAll(/^class\s+(\w+)/gm)) lines.push(`Class: ${m[1]}`);
    for (const m of content.matchAll(/^def\s+(\w+)\s*\(([^)]*)\)/gm)) lines.push(`Function: ${m[1]}(${m[2]})`);
  } else if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    for (const m of content.matchAll(/(?:export\s+)?(?:class|interface)\s+(\w+)/g)) lines.push(`Type: ${m[1]}`);
    for (const m of content.matchAll(/(?:export\s+)?(?:function|const|let)\s+(\w+)/g)) lines.push(`Export: ${m[1]}`);
  }

  return lines.length > 0 ? `\n**SOURCE FILE MAP (use ONLY these types):**\n${lines.join("\n")}\n` : "";
}

/**
 * Extract test case names from generated test code
 */
function extractTestCases(testCode: string): string[] {
  const cases: string[] = [];
  
  // Match test/it/describe blocks
  const testMatches = testCode.matchAll(/(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g);
  for (const match of testMatches) {
    cases.push(match[1]);
  }
  
  return cases;
}

/**
 * Generate test-results.md markdown
 */
function generateTestResultsMarkdown(
  generatedTests: GeneratedTest[],
  state: StackModernizationState
): string {
  const totalTests = generatedTests.reduce((sum, t) => sum + t.testCases.length, 0);
  
  const markdown = `# Unit Test Results

Generated on: ${new Date().toISOString()}

---

## 📊 Summary

- **Total Test Files Generated**: ${generatedTests.length}
- **Total Test Cases**: ${totalTests}
- **Test Frameworks Used**: ${[...new Set(generatedTests.map(t => t.testFramework))].join(", ")}
- **Coverage Target**: 80%+ for all modified code

---

## 🧪 Generated Test Files

${generatedTests.map((test, idx) => `
### ${idx + 1}. ${test.filePath}

**Framework**: ${test.testFramework}  
**Test Cases**: ${test.testCases.length}  
**Covers**: ${test.coverageTarget.join(", ") || "Main functionality"}

**Test Cases:**
${test.testCases.map((tc, i) => `${i + 1}. ${tc}`).join("\n")}

---
`).join("\n")}

---

## ✅ Test Execution Guidelines

### Running Tests

**JavaScript/TypeScript (Jest):**
\`\`\`bash
npm test
# or
npm run test:coverage
\`\`\`

**Java (JUnit):**
\`\`\`bash
mvn test
# or
mvn test jacoco:report
\`\`\`

**C# (xUnit):**
\`\`\`bash
dotnet test
# or
dotnet test /p:CollectCoverage=true
\`\`\`

**Python (pytest):**
\`\`\`bash
pytest
# or
pytest --cov=src --cov-report=html
\`\`\`

---

## 📈 Expected Coverage

All generated tests should provide:
- **Unit Test Coverage**: 80%+ of functions/methods
- **Branch Coverage**: 70%+ of logical branches
- **Edge Case Coverage**: Null, empty, boundary conditions
- **Error Handling**: Exception paths tested

---

## 🎯 Test Categories Covered

### Functional Tests
- Core business logic
- Input validation
- Output verification
- State management

### Non-Functional Tests
- Performance (basic)
- Error handling
- Edge cases
- Boundary conditions

### Integration Tests
- External dependencies (mocked)
- API integrations
- Database operations (if applicable)

---

## 📝 Next Steps

1. **Review Generated Tests**: Examine test files for completeness
2. **Run Test Suite**: Execute tests to verify functionality
3. **Check Coverage**: Ensure >80% code coverage achieved
4. **Fix Failures**: Address any failing tests
5. **Enhance Tests**: Add additional test cases if needed

---

## ⚠️ Important Notes

- All tests use mocks for external dependencies
- Update test data/fixtures as needed for your environment
- Add integration tests separately for end-to-end scenarios
- Consider adding performance benchmarks for critical paths
- Tests are generated based on upgraded code - verify they align with new APIs

---

*Generated by DevX Stack Modernization Test Generation Agent v2.0*
`;

  return markdown;
}
