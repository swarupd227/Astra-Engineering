/**
 * Code Execution Module - Public types
 * Pluggable execution in Docker for any feature (Stack Mod, Code Gen, etc.)
 */

export type StackType = "dotnet" | "python" | "java" | "node";

export interface ExecutionRequest {
  /** Unique run id for this execution */
  runId: string;
  /** Stack (determines Docker image and commands) */
  stack: StackType;
  /** Absolute path to project root on host (will be mounted into container) */
  projectPath: string;
  /** Optional: override runtime version e.g. "8.0", "3.11" */
  runtimeVersion?: string;
}

export interface RunCommandOptions {
  /** Command to run inside container (e.g. "dotnet restore", "dotnet test") */
  command: string;
  /** Working directory relative to mounted project root (default: /workspace) */
  cwd?: string;
  timeoutMs?: number;
  /** If true, stream chunks; otherwise buffer and return at end */
  stream?: boolean;
}

export interface RunCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ICodeExecutionService {
  /** Ensure the stack image exists (pull or build). */
  ensureImage(stack: StackType, runtimeVersion?: string): Promise<void>;
  /** Run a single command in a container with project mounted. */
  runCommand(request: ExecutionRequest, options: RunCommandOptions): Promise<RunCommandResult>;
}
