/**
 * Terminal analysis: parse stdout/stderr and interpret test result (no LLM).
 * Also extracts test counts from dotnet test / pytest output.
 */

import type { ParsedIssue } from "../../code-execution/parsers";
import { parseBuildAndTestErrors } from "../../code-execution/parsers";
import type { StackType } from "../../code-execution/types";

export interface TestCounts {
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  testsSkipped: number;
}

export interface TerminalAnalysisResult {
  passed: boolean;
  parsedIssues: ParsedIssue[];
  summary?: string;
  testCounts?: TestCounts;
}

/**
 * Parse test counts from dotnet test output:
 *   "Total tests: 42. Passed: 40. Failed: 1. Skipped: 1."
 *   or "Passed!  - Failed:  0, Passed:  3, Skipped:  0, Total:  3"
 */
function parseDotnetTestCounts(text: string): TestCounts | undefined {
  // Format 1: "Total tests: N. Passed: N. Failed: N. Skipped: N."
  const m1 = text.match(/Total\s*tests?:\s*(\d+)[\s.,]+Passed:\s*(\d+)[\s.,]+Failed:\s*(\d+)[\s.,]+Skipped:\s*(\d+)/i);
  if (m1) {
    return { testsRun: parseInt(m1[1]), testsPassed: parseInt(m1[2]), testsFailed: parseInt(m1[3]), testsSkipped: parseInt(m1[4]) };
  }
  // Format 2: "Passed! - Failed: 0, Passed: 3, Skipped: 0, Total: 3"
  const m2 = text.match(/Failed:\s*(\d+),\s*Passed:\s*(\d+),\s*Skipped:\s*(\d+),\s*Total:\s*(\d+)/i);
  if (m2) {
    return { testsRun: parseInt(m2[4]), testsPassed: parseInt(m2[2]), testsFailed: parseInt(m2[1]), testsSkipped: parseInt(m2[3]) };
  }
  return undefined;
}

/**
 * Parse test counts from pytest output:
 *   "5 passed, 2 failed, 1 skipped"
 *   "===== 5 passed in 1.23s ====="
 */
function parsePytestCounts(text: string): TestCounts | undefined {
  const passed = text.match(/(\d+)\s+passed/i);
  const failed = text.match(/(\d+)\s+failed/i);
  const skipped = text.match(/(\d+)\s+skipped/i);
  const errors = text.match(/(\d+)\s+error/i);
  if (!passed && !failed && !skipped && !errors) return undefined;
  const p = passed ? parseInt(passed[1]) : 0;
  const f = (failed ? parseInt(failed[1]) : 0) + (errors ? parseInt(errors[1]) : 0);
  const s = skipped ? parseInt(skipped[1]) : 0;
  return { testsRun: p + f + s, testsPassed: p, testsFailed: f, testsSkipped: s };
}

function parseMavenTestCounts(text: string): TestCounts | undefined {
  // Maven Surefire: "Tests run: 10, Failures: 2, Errors: 1, Skipped: 3"
  const m = text.match(/Tests\s+run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i);
  if (!m) return undefined;
  const run = parseInt(m[1]);
  const fail = parseInt(m[2]) + parseInt(m[3]);
  const skip = parseInt(m[4]);
  return { testsRun: run, testsPassed: run - fail - skip, testsFailed: fail, testsSkipped: skip };
}

function parseJestTestCounts(text: string): TestCounts | undefined {
  // Jest: "Tests:  5 passed, 2 failed, 7 total"  or  "Tests:  5 passed, 5 total"
  const m = text.match(/Tests:\s+(?:(\d+)\s+failed,?\s*)?(?:(\d+)\s+skipped,?\s*)?(?:(\d+)\s+passed,?\s*)?(\d+)\s+total/i);
  if (!m) return undefined;
  const total = parseInt(m[4]);
  const fail = m[1] ? parseInt(m[1]) : 0;
  const skip = m[2] ? parseInt(m[2]) : 0;
  const pass = m[3] ? parseInt(m[3]) : total - fail - skip;
  return { testsRun: total, testsPassed: pass, testsFailed: fail, testsSkipped: skip };
}

const NO_TESTS_PATTERNS = [
  /no test is available/i,
  /no test source files were specified/i,
  /a total of 0 test files matched/i,
  /no test matches the given testcase filter/i,
  /test run aborted/i,
  /no tests found/i,
  /no tests were found/i,
  /no tests to run/i,
];

function detectNoTestsDiscovered(stdout: string, stderr: string): boolean {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  return NO_TESTS_PATTERNS.some((p) => p.test(combined));
}

export function parseTestCounts(stack: StackType, stdout: string, stderr: string): TestCounts | undefined {
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  if (stack === "dotnet") return parseDotnetTestCounts(combined);
  if (stack === "python") return parsePytestCounts(combined);
  if (stack === "java") return parseMavenTestCounts(combined);
  if (stack === "node") return parseJestTestCounts(combined);
  return parseDotnetTestCounts(combined) || parsePytestCounts(combined) || parseMavenTestCounts(combined) || parseJestTestCounts(combined);
}

export function analyzeTerminalOutput(
  stack: StackType,
  exitCode: number,
  stdout: string,
  stderr: string
): TerminalAnalysisResult {
  const parsedIssues = parseBuildAndTestErrors(stack, stdout, stderr);
  const hasFailure = parsedIssues.some(
    (p) => p.type === "build" || p.type === "test_failure" || p.type === "runtime"
  );

  let testCounts = parseTestCounts(stack, stdout, stderr);
  const noTestsDetected = detectNoTestsDiscovered(stdout, stderr);

  if (!testCounts && noTestsDetected) {
    testCounts = { testsRun: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0 };
  }

  const zeroTestsRan = testCounts != null && testCounts.testsRun === 0;
  const passed = exitCode === 0 && !hasFailure && !zeroTestsRan && !noTestsDetected;

  let summary: string | undefined;
  if (zeroTestsRan || noTestsDetected) {
    summary = "No tests were discovered or executed. Check that test projects are compiled and test methods are properly attributed.";
  } else if (passed) {
    summary = testCounts
      ? `All tests passed. (${testCounts.testsPassed} passed, ${testCounts.testsFailed} failed, ${testCounts.testsSkipped} skipped)`
      : "All tests passed.";
  } else {
    summary = exitCode !== 0
      ? `Exit code ${exitCode}. ${parsedIssues.length} issue(s) parsed.`
      : `${parsedIssues.length} issue(s) parsed.`;
    if (testCounts) summary += ` (${testCounts.testsPassed} passed, ${testCounts.testsFailed} failed, ${testCounts.testsSkipped} skipped)`;
  }
  return { passed, parsedIssues, summary, testCounts };
}
