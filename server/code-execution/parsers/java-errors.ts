import type { ParsedIssue } from "./types";

// Maven compile error: [ERROR] /path/File.java:[10,15] error message
const MAVEN_COMPILE = /^\[ERROR\]\s+(.+?\.java):\[(\d+),(\d+)\]\s+(.+)$/;
// javac error: File.java:10: error: message
const JAVAC_ERROR = /^(.+?\.java):(\d+):\s*(error|warning):\s*(.+)$/;
// JUnit test failure: [ERROR] testMethod(com.example.TestClass) -- ...
const JUNIT_FAILURE = /^\[ERROR\]\s+(\w+)\(([^)]+)\)/;
// Maven BUILD FAILURE
const BUILD_FAILURE = /^\[ERROR\]\s+.*BUILD FAILURE/;
// Generic [ERROR] lines
const MAVEN_ERROR = /^\[ERROR\]\s+(.+)$/;

export function parseJavaErrors(stdout: string, stderr: string): ParsedIssue[] {
  const issues: ParsedIssue[] = [];
  const lines = [stdout, stderr].filter(Boolean).join("\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const compileMatch = line.match(MAVEN_COMPILE);
    if (compileMatch) {
      issues.push({
        type: "build",
        severity: "error",
        file: compileMatch[1],
        line: parseInt(compileMatch[2]),
        column: parseInt(compileMatch[3]),
        message: compileMatch[4],
      });
      continue;
    }

    const javacMatch = line.match(JAVAC_ERROR);
    if (javacMatch) {
      issues.push({
        type: "build",
        severity: javacMatch[3] as "error" | "warning",
        file: javacMatch[1],
        line: parseInt(javacMatch[2]),
        message: javacMatch[4],
      });
      continue;
    }

    const junitMatch = line.match(JUNIT_FAILURE);
    if (junitMatch) {
      issues.push({
        type: "test_failure",
        severity: "error",
        testName: `${junitMatch[2]}.${junitMatch[1]}`,
        message: line,
      });
      continue;
    }

    if (BUILD_FAILURE.test(line)) {
      continue;
    }

    const errorMatch = line.match(MAVEN_ERROR);
    if (errorMatch && !line.includes("-> [Help")) {
      const msg = errorMatch[1];
      if (msg.length > 10 && !msg.startsWith("For more information")) {
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
