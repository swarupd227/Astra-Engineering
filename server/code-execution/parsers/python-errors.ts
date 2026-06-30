/**
 * Parse Python traceback and pytest output into structured issues.
 * Handles tracebacks, pytest failures, ModuleNotFoundError, ImportError, SyntaxError.
 */

import type { ParsedIssue } from "./types";

// Traceback: File "path", line N, in ...
const TRACEBACK_FILE = /File\s+["']([^"']+)["'],\s*line\s+(\d+)/g;
// pytest: FAILED path::test_name - AssertionError: message
const PYTEST_FAILED = /FAILED\s+(.+?)::(.+?)(?:\s+-\s+)?(.+)?$/gm;
// SyntaxError: File "path", line N
const SYNTAX_ERROR = /SyntaxError:\s*(.+)/;
// ModuleNotFoundError / ImportError
const MODULE_NOT_FOUND = /(?:ModuleNotFoundError|ImportError):\s*(?:No module named\s+)?['"]?([^'"]+)['"]?/;

export function parsePythonErrors(stdout: string, stderr: string): ParsedIssue[] {
  const issues: ParsedIssue[] = [];
  const combined = `${stderr}\n${stdout}`;
  const seen = new Set<string>();

  // ── Tracebacks: File "path", line N ──
  let m: RegExpExecArray | null;
  TRACEBACK_FILE.lastIndex = 0;
  while ((m = TRACEBACK_FILE.exec(combined)) !== null) {
    const file = m[1].trim();
    const line = parseInt(m[2], 10);
    // Look at the line after the traceback entry for the actual error message
    const afterIdx = m.index + m[0].length;
    const remaining = combined.slice(afterIdx);
    const nextLines = remaining.split("\n").slice(0, 3);
    let errorMsg = nextLines.find((l) => /Error:|Exception:/.test(l))?.trim();
    if (!errorMsg) errorMsg = nextLines[0]?.trim() || "Traceback";

    const key = `tb:${file}:${line}:${errorMsg.slice(0, 60)}`;
    if (!seen.has(key)) {
      seen.add(key);

      let severity: "error" | "warning" = "error";
      let errorCode: string | undefined;

      const syntaxMatch = errorMsg.match(SYNTAX_ERROR);
      if (syntaxMatch) errorCode = "SyntaxError";

      const moduleMatch = errorMsg.match(MODULE_NOT_FOUND);
      if (moduleMatch) errorCode = errorMsg.includes("ImportError") ? "ImportError" : "ModuleNotFoundError";

      issues.push({
        type: "runtime",
        severity,
        errorCode,
        file,
        line,
        message: errorMsg,
        snippet: m[0],
      });
    }
  }

  // ── pytest FAILED lines ──
  PYTEST_FAILED.lastIndex = 0;
  while ((m = PYTEST_FAILED.exec(combined)) !== null) {
    const pathPart = m[1].trim();
    const testName = m[2].trim();
    const msgPart = m[3]?.trim() ?? "";
    const message = msgPart || "Test failed";
    const key = `pytest:${pathPart}:${testName}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push({
        type: "test_failure",
        severity: "error",
        file: pathPart,
        testName,
        message,
        snippet: m[0],
      });
    }
  }

  // ── Standalone ModuleNotFoundError / ImportError without traceback ──
  const moduleLines = combined.split("\n");
  for (const rawLine of moduleLines) {
    const line = rawLine.trim();
    const modMatch = line.match(MODULE_NOT_FOUND);
    if (modMatch) {
      const key = `mod:${modMatch[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          type: "runtime",
          severity: "error",
          errorCode: line.includes("ImportError") ? "ImportError" : "ModuleNotFoundError",
          message: line,
        });
      }
    }
  }

  // ── Fallback: if nothing captured but output has Error/FAILED/Traceback ──
  if (issues.length === 0 && (combined.includes("Error") || combined.includes("FAILED") || combined.includes("Traceback"))) {
    const firstLine = combined.split("\n").find((l) => /Error|FAILED|Traceback/.test(l));
    issues.push({
      type: "runtime",
      severity: "error",
      message: firstLine?.trim() ?? combined.slice(0, 500).trim(),
      snippet: firstLine,
    });
  }

  return issues;
}
