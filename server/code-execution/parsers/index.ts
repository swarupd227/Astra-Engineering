import type { StackType } from "../types";
import type { ParsedIssue } from "./types";
import { parseDotNetErrors } from "./dotnet-errors";
import { parsePythonErrors } from "./python-errors";
import { parseJavaErrors } from "./java-errors";
import { parseNodeErrors } from "./node-errors";

export type { ParsedIssue } from "./types";

export function parseBuildAndTestErrors(
  stack: StackType,
  stdout: string,
  stderr: string
): ParsedIssue[] {
  switch (stack) {
    case "dotnet":
      return parseDotNetErrors(stdout, stderr);
    case "python":
      return parsePythonErrors(stdout, stderr);
    case "java":
      return parseJavaErrors(stdout, stderr);
    case "node":
      return parseNodeErrors(stdout, stderr);
    default:
      return [];
  }
}
