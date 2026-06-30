/**
 * Code Execution Module - Public API
 * Pluggable: run project in Docker or on host (USE_LOCAL_CODE_EXECUTION). No fix logic, no RAG.
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { StackType, ExecutionRequest, RunCommandOptions, RunCommandResult, ICodeExecutionService } from "./types";
import { runDockerCommand, ensureDockerImage, checkDockerAvailable } from "./docker-runner";
import { runLocalCommand } from "./local-runner";

export { checkDockerAvailable } from "./docker-runner";

export type { StackType, ExecutionRequest, RunCommandOptions, RunCommandResult, ICodeExecutionService } from "./types";
export { getProfile } from "./profiles";

const execAsync = promisify(exec);

const ENABLE_CODE_EXECUTION = process.env.ENABLE_CODE_EXECUTION !== "false";
const USE_LOCAL_CODE_EXECUTION = process.env.USE_LOCAL_CODE_EXECUTION === "true";

/** Set to true when Docker was not found and we fell back to local (so runCommand uses local too). */
let fallbackToLocal = false;

/** "docker" | "local" for optional logging in orchestrator. */
export function getExecutionMode(): "docker" | "local" {
  return USE_LOCAL_CODE_EXECUTION || fallbackToLocal ? "local" : "docker";
}

/** Verify the given stack runtime is available on the host (for local mode). */
async function verifyLocalRuntime(stack: StackType): Promise<void> {
  const isWin = process.platform === "win32";
  if (stack === "dotnet") {
    try {
      await execAsync("dotnet --version", { timeout: 15_000, encoding: "utf8" });
    } catch (err: any) {
      const msg = (err.stderr ?? err.message ?? "").toString();
      throw new Error(
        "Local code execution is enabled but dotnet was not found in PATH or timed out. Please install .NET SDK and try again. " + (msg ? msg.slice(0, 100) : "")
      );
    }
    return;
  }
  if (stack === "python") {
    const commands = isWin ? ["py --version", "python --version"] : ["python3 --version", "python --version"];
    let lastErr: string = "";
    for (const cmd of commands) {
      try {
        await execAsync(cmd, { timeout: 15_000, encoding: "utf8" });
        return;
      } catch (err: any) {
        lastErr = (err.stderr ?? err.message ?? "").toString();
      }
    }
    throw new Error(
      "Local code execution is enabled but python was not found in PATH. Please install Python and try again. " + (lastErr ? lastErr.slice(0, 100) : "")
    );
  }
  if (stack === "java") {
    const javaCommands = isWin
      ? ["java -version", "mvn --version"]
      : ["java -version", "mvn --version"];
    let lastErr: string = "";
    for (const cmd of javaCommands) {
      try {
        await execAsync(cmd, { timeout: 15_000, encoding: "utf8" });
      } catch (err: any) {
        lastErr = (err.stderr ?? err.message ?? "").toString();
        if (lastErr.includes("version")) {
          // java -version writes to stderr on some JDKs — that's OK
          continue;
        }
        throw new Error(
          `Local code execution is enabled but '${cmd.split(" ")[0]}' was not found in PATH. Please install JDK and Maven. ` + (lastErr ? lastErr.slice(0, 100) : "")
        );
      }
    }
    return;
  }
  if (stack === "node") {
    try {
      await execAsync("node --version", { timeout: 15_000, encoding: "utf8" });
    } catch (err: any) {
      const msg = (err.stderr ?? err.message ?? "").toString();
      throw new Error(
        "Local code execution is enabled but node was not found in PATH. Please install Node.js and try again. " + (msg ? msg.slice(0, 100) : "")
      );
    }
    return;
  }
  throw new Error(`Unknown stack for local execution: ${stack}`);
}

class CodeExecutionService implements ICodeExecutionService {
  async ensureImage(stack: StackType, runtimeVersion?: string): Promise<void> {
    if (!ENABLE_CODE_EXECUTION) {
      throw new Error("Code execution is disabled (ENABLE_CODE_EXECUTION=false)");
    }
    if (USE_LOCAL_CODE_EXECUTION || fallbackToLocal) {
      await verifyLocalRuntime(stack);
      return;
    }
    // Fast Docker probe: 3s timeout on `docker --version`. If Docker isn't available, skip immediately.
    try {
      await Promise.race([
        execAsync("docker --version", { timeout: 3000, encoding: "utf8" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Docker probe timeout")), 3000)),
      ]);
    } catch {
      console.log("[CodeExecution] Docker not available (fast probe failed). Using local runtime.");
      fallbackToLocal = true;
      await verifyLocalRuntime(stack);
      return;
    }
    try {
      await ensureDockerImage(stack, runtimeVersion);
    } catch (err: any) {
      const msg = (err?.message ?? String(err)).toLowerCase();
      if (msg.includes("docker was not found") || msg.includes("docker is not available") || msg.includes("not recognized") || msg.includes("is docker running") || msg.includes("timeout")) {
        fallbackToLocal = true;
        await verifyLocalRuntime(stack);
        return;
      }
      throw err;
    }
  }

  async runCommand(request: ExecutionRequest, options: RunCommandOptions): Promise<RunCommandResult> {
    if (!ENABLE_CODE_EXECUTION) {
      throw new Error("Code execution is disabled (ENABLE_CODE_EXECUTION=false)");
    }
    if (USE_LOCAL_CODE_EXECUTION || fallbackToLocal) {
      return runLocalCommand(request, options);
    }
    return runDockerCommand(request, options);
  }
}

export const codeExecutionService: ICodeExecutionService = new CodeExecutionService();

/** Check if code execution is enabled (flag set; Docker or local used depending on USE_LOCAL_CODE_EXECUTION). */
export function isCodeExecutionEnabled(): boolean {
  return ENABLE_CODE_EXECUTION;
}
