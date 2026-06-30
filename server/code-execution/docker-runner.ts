/**
 * Docker runner: run a single command in a container with project mounted.
 * Uses docker CLI via child_process (execFile to avoid shell PATH issues on Windows).
 * On Windows, resolves Docker Desktop path so it works when "docker" is not in PATH.
 */

import { exec, execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import type { ExecutionRequest, RunCommandOptions, RunCommandResult, StackType } from "./types";
import { getProfile } from "./profiles";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const MOUNT_SOURCE = "/workspace";
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min

/** Cached absolute path to docker executable (never "docker" on Windows). */
let cachedDockerPath: string | null = null;

/** Windows: Docker Desktop install locations (checked so we never rely on process PATH). */
function getWindowsDockerPaths(): string[] {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const paths = [
    path.join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe"),
    path.join(programFiles, "Docker", "Docker", "docker.exe"),
    path.join(programFilesX86, "Docker", "Docker", "resources", "bin", "docker.exe"),
  ];
  if (localAppData) {
    paths.push(
      path.join(localAppData, "Docker", "Docker", "resources", "bin", "docker.exe"),
      path.join(localAppData, "Docker", "Docker", "docker.exe")
    );
  }
  return paths;
}

/** On Windows, search PATH for docker.exe to get a full path. */
function findDockerInPath(): string | null {
  if (process.platform !== "win32") return null;
  const pathEnv = process.env.PATH ?? "";
  const sep = process.platform === "win32" ? ";" : ":";
  for (const dir of pathEnv.split(sep)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const exe = path.join(trimmed, "docker.exe");
    try {
      if (fs.existsSync(exe)) return exe;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Resolve the absolute path to the docker executable. On Windows we never return
 * "docker" so the shell is never used to look it up; we use execFile with this path.
 */
export async function getDockerPath(): Promise<string> {
  if (cachedDockerPath !== null) return cachedDockerPath;
  const isWin = process.platform === "win32";

  // 0) Optional: explicit path from env (e.g. DOCKER_PATH or DOCKER_EXE for custom installs)
  const envPath = process.env.DOCKER_PATH ?? process.env.DOCKER_EXE;
  if (envPath) {
    const p = path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
    if (fs.existsSync(p)) {
      try {
        await execFileAsync(p, ["--version"], { timeout: 5000, encoding: "utf8" });
        cachedDockerPath = p;
        return cachedDockerPath;
      } catch {
        // fall through
      }
    }
  }

  // 1) Windows: try known Docker Desktop paths first
  if (isWin) {
    const winPaths = getWindowsDockerPaths();
    for (const p of winPaths) {
      if (fs.existsSync(p)) {
        try {
          await execFileAsync(p, ["--version"], { timeout: 5000, encoding: "utf8" });
          cachedDockerPath = p;
          return cachedDockerPath;
        } catch {
          continue;
        }
      }
    }
    // 2) Windows: search process PATH for docker.exe
    const inPath = findDockerInPath();
    if (inPath) {
      try {
        await execFileAsync(inPath, ["--version"], { timeout: 5000, encoding: "utf8" });
        cachedDockerPath = inPath;
        return cachedDockerPath;
      } catch {
        // fall through
      }
    }
    // 3) Windows: run "where docker.exe" with PATH that includes default Docker locations
    //    (Node often starts with a minimal PATH; this finds Docker if it's in a standard install)
    const extraPaths = [
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "resources", "bin"),
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker"),
    ].join(";");
    const pathEnv = (process.env.PATH ?? "") + ";" + extraPaths;
    try {
      const { stdout } = await execAsync("where docker.exe", {
        timeout: 5000,
        encoding: "utf8",
        env: { ...process.env, PATH: pathEnv },
      });
      const firstLine = (stdout || "").split(/[\r\n]+/).map((s) => s.trim()).find((s) => s.endsWith(".exe"));
      if (firstLine && fs.existsSync(firstLine)) {
        try {
          await execFileAsync(firstLine, ["--version"], { timeout: 5000, encoding: "utf8" });
          cachedDockerPath = firstLine;
          return cachedDockerPath;
        } catch {
          // fall through
        }
      }
    } catch {
      // where failed or no valid path
    }
    throw new Error(
      "Docker was not found. Please install Docker Desktop from https://www.docker.com/products/docker-desktop/ and start it. " +
        "If Docker is already installed, set the DOCKER_PATH environment variable to the full path to docker.exe (e.g. DOCKER_PATH=C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe), then restart this application."
    );
  }

  // 3) Non-Windows: try "docker" from PATH via execFile (need to resolve to full path)
  try {
    await execAsync("docker --version", { timeout: 5000, encoding: "utf8" });
  } catch {
    throw new Error(
      "Docker is not available. Please install Docker and ensure the docker command is in PATH, or start Docker Desktop."
    );
  }
  // Use "docker" only on non-Windows; exec will resolve it
  cachedDockerPath = "docker";
  return cachedDockerPath;
}

/** Clear cached docker path (e.g. after Docker install). */
export function clearDockerPathCache(): void {
  cachedDockerPath = null;
}

/** Run docker with args using execFile (no shell PATH lookup). */
async function runDockerArgs(dockerPath: string, args: string[], timeoutMs: number, maxBuffer?: number): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === "win32" && dockerPath !== "docker") {
    const { stdout, stderr } = await execFileAsync(dockerPath, args, {
      timeout: timeoutMs,
      maxBuffer: maxBuffer ?? 10 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout: stdout || "", stderr: stderr || "" };
  }
  const cmd = [dockerPath, ...args].join(" ");
  const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: maxBuffer ?? 10 * 1024 * 1024, encoding: "utf8" });
  return { stdout: stdout || "", stderr: stderr || "" };
}

/** Check if Docker daemon is reachable. */
export async function checkDockerAvailable(): Promise<{ ok: boolean; message: string }> {
  let dockerPath: string;
  try {
    dockerPath = await getDockerPath();
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  try {
    if (process.platform === "win32" && dockerPath !== "docker") {
      await execFileAsync(dockerPath, ["info"], { timeout: 10_000, encoding: "utf8" });
    } else {
      await execAsync("docker info", { timeout: 10_000, encoding: "utf8" });
    }
    return { ok: true, message: "Docker is available." };
  } catch (err: any) {
    const stderr = (err.stderr ?? err.message ?? "").toString();
    if (/Cannot connect to the Docker daemon|Is the docker daemon running|error during connect/i.test(stderr)) {
      return {
        ok: false,
        message:
          "Docker is not running. Please start Docker Desktop (Windows/Mac) or start the Docker service (Linux), then try Run & Validate again.",
      };
    }
    if (err.code === "ENOENT" || /docker.*not found|command not found|not recognized/i.test(stderr)) {
      return {
        ok: false,
        message:
          "Docker was not found. Please install Docker Desktop from https://www.docker.com/products/docker-desktop/ and start it. If already installed, restart this application after starting Docker Desktop.",
      };
    }
    return {
      ok: false,
      message: `Docker check failed: ${stderr.trim() || err.message || "Unknown error"}. Please ensure Docker is running.`,
    };
  }
}

/**
 * Run a command in a one-off container with project path mounted at /workspace.
 * Returns full stdout, stderr, exit code, and duration.
 */
export async function runDockerCommand(
  request: ExecutionRequest,
  options: RunCommandOptions
): Promise<RunCommandResult> {
  const dockerPath = await getDockerPath();
  const profile = getProfile(request.stack, request.runtimeVersion);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ? `${MOUNT_SOURCE}/${options.cwd.replace(/^\/+/, "")}` : MOUNT_SOURCE;
  const projectPath = request.projectPath.replace(/\\/g, "/");
  const args = [
    "run", "--rm",
    "-v", `${projectPath}:${MOUNT_SOURCE}`,
    "-w", cwd,
    "--network", "none",
    profile.image,
    "sh", "-c", options.command,
  ];
  const start = Date.now();
  let timedOut = false;
  const useExecFile = process.platform === "win32" && dockerPath !== "docker";
  try {
    let stdout: string;
    let stderr: string;
    if (useExecFile) {
      const result = await runDockerArgs(dockerPath, args, timeoutMs);
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      const cmd = [dockerPath, ...args].join(" ");
      const out = await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" });
      stdout = out.stdout || "";
      stderr = out.stderr || "";
    }
    return {
      exitCode: 0,
      stdout,
      stderr,
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

/**
 * Pull the image for the given stack so it exists locally.
 * Fails fast with an actionable message if Docker is not running.
 */
export async function ensureDockerImage(stack: StackType, runtimeVersion?: string): Promise<void> {
  const check = await checkDockerAvailable();
  if (!check.ok) {
    throw new Error(check.message);
  }
  const dockerPath = await getDockerPath();
  const profile = getProfile(stack, runtimeVersion);
  const useExecFile = process.platform === "win32" && dockerPath !== "docker";
  try {
    if (useExecFile) {
      await runDockerArgs(dockerPath, ["pull", profile.image], 300_000);
    } else {
      await execAsync(`${dockerPath} pull ${profile.image}`, { timeout: 300_000, encoding: "utf8" });
    }
  } catch (err: any) {
    console.warn(`[CodeExecution] Failed to pull ${profile.image}:`, err);
    const stderr = (err.stderr ?? err.message ?? "").toString();
    if (/Cannot connect to the Docker daemon|Is the docker daemon running|error during connect/i.test(stderr)) {
      throw new Error(
        "Docker is not running. Please start Docker Desktop (Windows/Mac) or start the Docker service (Linux), then try Run & Validate again."
      );
    }
    throw new Error(
      `Could not pull the build image (${profile.image}). Check your network connection and try again. Original error: ${stderr.trim().slice(0, 200) || err.message}`
    );
  }
}
