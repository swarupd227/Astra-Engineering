/**
 * Container orchestration - context interface and types.
 * No dependency on stack-modernization; reusable by any consumer.
 */

import type { ParsedIssue } from "../code-execution/parsers";
import type { StackType } from "../code-execution/types";

export type { StackType };

/** Minimal text edit (consumer adapter maps to its own format if needed). */
export interface ContainerTextEdit {
  filePath: string;
  oldContent?: string;
  newContent: string;
  startLine?: number;
  endLine?: number;
  fullContent?: string;
}

/** Outcome of a container run (passed, failed, skipped, error, running). */
export interface ContainerRunOutcome {
  status: string;
  lastLogs?: string;
  exitCode?: number;
  testSummary?: string;
  testsRun?: number;
  testsPassed?: number;
  testsFailed?: number;
  testsSkipped?: number;
}

/**
 * Execution context (adapter) for container orchestration.
 * Implemented by stack-modernization (writes to validationRun, stateStore) or other consumers.
 */
export interface IContainerExecutionContext {
  /** Prepare project dir and return absolute path (e.g. for stack-mod: prepareProjectDir + return path). */
  getProjectPath(): Promise<string>;
  /** Resolved stack (dotnet | python). */
  getStack(): Promise<StackType>;
  /** Optional runtime version (e.g. "8.0", "3.11"). */
  getRuntimeVersion(): Promise<string | undefined>;
  /** Append to terminal/project logs (e.g. validationRun.lastLogs). */
  appendLogs(text: string): void | Promise<void>;
  /** Set final run outcome (status, lastLogs, exitCode, testSummary). */
  setOutcome(result: ContainerRunOutcome): void | Promise<void>;
  /** Read file contents by relative paths; return map path -> content. */
  getFileContents(paths: string[]): Promise<Record<string, string>>;
  /** Request fixes from parsed issues; return edits (e.g. calls proposeFixes in stack-mod). */
  requestFixes(
    parsedIssues: ParsedIssue[],
    lastStdout: string,
    lastStderr: string,
    fileContents: Record<string, string>,
    options?: { forceFullFile?: boolean }
  ): Promise<ContainerTextEdit[]>;
  /** Apply edits to project dir (e.g. applyPatchesToProject in stack-mod). */
  applyEdits(edits: ContainerTextEdit[]): Promise<void>;
}

export interface RunContainerOptions {
  maxAttempts?: number;
}
