/**
 * Parse .NET build and test output into structured issues.
 * Covers MSBuild compile errors/warnings, NuGet restore errors (NU*),
 * test failures with stack traces, and runtime errors.
 *
 * Windows paths (C:\...) contain colons, so simple [^:]+ patterns break.
 * We use line-by-line parsing with ` : error ` / ` : warning ` as separators.
 */

import type { ParsedIssue } from "./types";

// MSBuild with line/col: path(line,col): error|warning CODE: message
const MSBUILD_DIAG = /^(.+?)\((\d+),(\d+)\)\s*:\s*(error|warning)\s+(\w+)\s*:\s*(.+)$/;
// MSBUILD top-level: MSBUILD : error MSB1009: ...
const MSBUILD_TOPLEVEL = /^\s*MSBUILD\s*:\s*error\s+(\w+)\s*:\s*(.+)$/;
// NuGet project reference in brackets: ... [C:\path\to\Project.csproj]
const NUGET_PROJECT_REF = /\[([^\]]+\.csproj)\]\s*$/;
// Test stack trace: in C:\path\File.cs:line 42
const STACK_TRACE_LINE = /\s+in\s+(.+?):line\s+(\d+)/;

/**
 * Split a line at ` : error CODE: ` or ` : warning CODE: ` boundary.
 */
function splitDiagLine(line: string): {
  filePart: string;
  severity: "error" | "warning";
  errorCode: string;
  message: string;
  csprojRef?: string;
} | null {
  let idx = line.indexOf(" : error ");
  let severity: "error" | "warning" = "error";
  if (idx < 0) {
    idx = line.indexOf(" : warning ");
    if (idx < 0) return null;
    severity = "warning";
  }
  const separator = severity === "error" ? " : error " : " : warning ";
  const filePart = line.slice(0, idx).trim();
  const rest = line.slice(idx + separator.length);
  const codeMatch = rest.match(/^(\w+)\s*:\s*(.*)/);
  if (!codeMatch) return null;

  let msg = codeMatch[2].trim();
  let csprojRef: string | undefined;
  const bracketMatch = msg.match(NUGET_PROJECT_REF);
  if (bracketMatch) {
    csprojRef = bracketMatch[1].trim();
    msg = msg.replace(NUGET_PROJECT_REF, "").trim();
  } else {
    const lineBracket = line.match(NUGET_PROJECT_REF);
    if (lineBracket) csprojRef = lineBracket[1].trim();
  }

  return { filePart, severity, errorCode: codeMatch[1], message: msg, csprojRef };
}

export function parseDotNetErrors(stdout: string, stderr: string): ParsedIssue[] {
  const issues: ParsedIssue[] = [];
  const combined = `${stderr}\n${stdout}`;
  const seen = new Set<string>();
  const lines = combined.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // ── MSBUILD top-level (no file) ──
    const topLevel = MSBUILD_TOPLEVEL.exec(line);
    if (topLevel) {
      const key = `top:${topLevel[1]}:${topLevel[2].slice(0, 60)}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          type: "build",
          severity: "error",
          errorCode: topLevel[1],
          message: `${topLevel[1]}: ${topLevel[2].trim()}`,
        });
      }
      continue;
    }

    // ── MSBuild with line/col: path(line,col): error|warning CODE: message ──
    const msbuild = MSBUILD_DIAG.exec(line);
    if (msbuild) {
      const sev = msbuild[4] as "error" | "warning";
      const key = `${msbuild[5]}:${msbuild[1]}:${msbuild[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        let msg = msbuild[6].replace(/\s*\[.+\]\s*$/, "").trim();
        issues.push({
          type: "build",
          severity: sev,
          errorCode: msbuild[5],
          file: msbuild[1].trim(),
          line: parseInt(msbuild[2], 10),
          column: parseInt(msbuild[3], 10),
          message: msg,
        });
      }
      continue;
    }

    // ── Generic " : error CODE: " / " : warning CODE: " lines ──
    const parsed = splitDiagLine(line);
    if (parsed) {
      if (rawLine.startsWith("  ") && parsed.filePart === parsed.errorCode) continue;

      const key = `${parsed.errorCode}:${parsed.filePart.slice(-40)}:${parsed.message.slice(0, 60)}`;
      if (!seen.has(key)) {
        seen.add(key);
        // Use the csproj reference as the file if the filePart doesn't look like a file path
        const filePath = parsed.filePart || parsed.csprojRef || undefined;
        issues.push({
          type: "build",
          severity: parsed.severity,
          errorCode: parsed.errorCode,
          file: filePath,
          message: `${parsed.errorCode}: ${parsed.message}`,
        });
      }
      continue;
    }
  }

  // ── Test failures: "Failed TestName [duration]" ──
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^\s*Failed\s+/i.test(line) && !/Failed to (restore|build|load)/i.test(line)) {
      const testNameMatch = line.match(/Failed\s+(.+?)(?:\s+\[|\s*$)/);
      const testName = testNameMatch ? testNameMatch[1].trim() : undefined;
      let message = line;
      if (lines[i + 1]) message += "\n" + lines[i + 1].trim();

      // Look ahead for stack trace to find the file + line
      let testFile: string | undefined;
      let testLine: number | undefined;
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const stLine = lines[j];
        const stMatch = STACK_TRACE_LINE.exec(stLine);
        if (stMatch) {
          testFile = stMatch[1].trim();
          testLine = parseInt(stMatch[2], 10);
          break;
        }
        // Stop scanning if we hit another "Failed" or empty divider
        if (/^\s*Failed\s+/i.test(stLine.trim()) || stLine.trim() === "") break;
      }

      const key = `test:${testName ?? message.slice(0, 60)}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({
          type: "test_failure",
          severity: "error",
          file: testFile,
          line: testLine,
          message,
          testName,
          snippet: line,
        });
      }
    }
  }

  return issues;
}
