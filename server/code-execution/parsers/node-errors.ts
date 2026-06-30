import type { ParsedIssue } from "./types";

// TypeScript compile error: src/file.ts(10,15): error TS2345: message
const TS_ERROR = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/;
// Node/JS runtime error: at Object.<anonymous> (/path/file.js:10:15)
const STACK_TRACE = /at\s+.+?\s+\((.+?):(\d+):(\d+)\)/;
// Jest test failure: "● Test Suite > test name"
const JEST_FAILURE = /^●\s+(.+)$/;
// ESLint/TSC error: file.ts:10:15 - error TS2345: message
const TSC_LINE = /^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s*(.+)$/;
// npm ERR!
const NPM_ERROR = /^npm ERR!\s+(.+)$/;
// Generic Error: or SyntaxError:
const JS_RUNTIME_ERROR = /^(Error|TypeError|SyntaxError|ReferenceError|RangeError):\s*(.+)$/;

export function parseNodeErrors(stdout: string, stderr: string): ParsedIssue[] {
  const issues: ParsedIssue[] = [];
  const lines = [stdout, stderr].filter(Boolean).join("\n").split("\n");
  let inJestFailure = false;
  let currentTestName = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      inJestFailure = false;
      continue;
    }

    const tsMatch = line.match(TS_ERROR);
    if (tsMatch) {
      issues.push({
        type: "build",
        severity: tsMatch[4] as "error" | "warning",
        file: tsMatch[1],
        line: parseInt(tsMatch[2]),
        column: parseInt(tsMatch[3]),
        errorCode: tsMatch[5],
        message: tsMatch[6],
      });
      continue;
    }

    const tscMatch = line.match(TSC_LINE);
    if (tscMatch) {
      issues.push({
        type: "build",
        severity: tscMatch[4] as "error" | "warning",
        file: tscMatch[1],
        line: parseInt(tscMatch[2]),
        column: parseInt(tscMatch[3]),
        errorCode: tscMatch[5],
        message: tscMatch[6],
      });
      continue;
    }

    const jestMatch = line.match(JEST_FAILURE);
    if (jestMatch) {
      inJestFailure = true;
      currentTestName = jestMatch[1];
      issues.push({
        type: "test_failure",
        severity: "error",
        testName: currentTestName,
        message: `Test failed: ${currentTestName}`,
      });
      continue;
    }

    const runtimeMatch = line.match(JS_RUNTIME_ERROR);
    if (runtimeMatch) {
      issues.push({
        type: "runtime",
        severity: "error",
        message: `${runtimeMatch[1]}: ${runtimeMatch[2]}`,
      });
      continue;
    }

    const npmMatch = line.match(NPM_ERROR);
    if (npmMatch && npmMatch[1].length > 5) {
      const msg = npmMatch[1];
      if (!msg.startsWith("A complete log") && !msg.startsWith("code ")) {
        issues.push({
          type: "build",
          severity: "error",
          message: msg,
        });
      }
    }
  }

  return issues;
}
