/**
 * Local runner: run a single command on the host (no Docker).
 * Used when USE_LOCAL_CODE_EXECUTION=true so Run & Validate works without Docker.
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import type { ExecutionRequest, RunCommandOptions, RunCommandResult } from "./types";

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB

/**
 * If the command is dotnet and cwd (or any ancestor up to projectRoot) has global.json
 * that pins an SDK, either patch rollForward or delete the file entirely.
 *
 * Strategy: delete global.json if it pins an SDK we don't have. rollForward: "latestMajor"
 * should work but on some SDK configurations it still fails — deleting is the safest fix.
 */
async function ensureGlobalJsonCompatible(cwd: string, command: string): Promise<void> {
  if (!command.trimStart().toLowerCase().startsWith("dotnet ")) return;

  let dir = cwd;
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    const globalPath = path.join(dir, "global.json");
    try {
      const raw = await fs.readFile(globalPath, "utf8");
      const json = JSON.parse(raw) as { sdk?: { version?: string; rollForward?: string; allowPrerelease?: boolean } };
      if (json.sdk?.version) {
        // Delete the file entirely — it's a temp directory so safe to do
        // This is more reliable than rollForward which can still fail on some SDK setups
        await fs.unlink(globalPath);
        console.log(`[LocalRunner] Deleted global.json at ${globalPath} (pinned ${json.sdk.version})`);
        return;
      }
    } catch {
      // no global.json here, walk up
    }
    dir = path.dirname(dir);
  }
}

/**
 * Run a command in the project directory on the host. Same contract as Docker path.
 */
export async function runLocalCommand(
  request: ExecutionRequest,
  options: RunCommandOptions
): Promise<RunCommandResult> {
  const cwdRaw = path.join(request.projectPath, options.cwd || "");
  const cwd = cwdRaw.replace(/\//g, path.sep);
  await ensureGlobalJsonCompatible(cwd, options.command);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  let timedOut = false;
  try {
    const { stdout, stderr } = await execAsync(options.command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: DEFAULT_MAX_BUFFER,
      encoding: "utf8",
    });
    return {
      exitCode: 0,
      stdout: stdout || "",
      stderr: stderr || "",
      timedOut: false,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    if (err.killed && err.signal === "SIGTERM") timedOut = true;
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return {
      exitCode,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? ""),
      timedOut,
      durationMs,
    };
  }
}
