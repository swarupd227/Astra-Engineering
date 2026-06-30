/**
 * Dependency install: run profile install command in container; append logs via context.
 * Skips install when no dependency manifest is found (e.g. no requirements.txt, .csproj/.sln);
 * build/test will still run and can fail, returning a failed attempt.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { IContainerExecutionContext } from "../types";
import type { ICodeExecutionService, ExecutionRequest } from "../../code-execution";
import type { StackType } from "../../code-execution/types";
import { getProfile } from "../../code-execution/profiles";

const INSTALL_TIMEOUT_MS = 300_000;

export interface DependencyInstallResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function hasManifest(projectPath: string, stack: StackType): Promise<boolean> {
  try {
    if (stack === "dotnet") {
      const target = await findDotnetTarget(projectPath);
      return target != null;
    }
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const names = entries.map((e) => e.name.toLowerCase());
    if (stack === "python") {
      return (
        names.includes("requirements.txt") ||
        names.includes("pyproject.toml") ||
        names.includes("setup.py")
      );
    }
    if (stack === "java") {
      return names.includes("pom.xml") || names.includes("build.gradle") || names.includes("build.gradle.kts");
    }
    if (stack === "node") {
      return names.includes("package.json");
    }
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

/** Recursively find libman.json under project root (max 5 levels). Returns relative path or null. */
async function findLibManJson(projectPath: string): Promise<string | null> {
  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth <= 0) return null;
    const fullPath = path.join(projectPath, dir);
    const entries = await fs.readdir(fullPath, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const found = await walk(rel, depth - 1);
        if (found) return found;
      } else if (e.name.toLowerCase() === "libman.json") {
        return rel.replace(/\\/g, "/");
      }
    }
    return null;
  }
  return walk("", 5);
}

/** Recursively find .sln or .csproj under project root (max 5 levels). Returns relative path with forward slashes. */
export async function findDotnetTarget(projectPath: string): Promise<string | null> {
  const maxDepth = 5;
  let sln: string | null = null;
  let csproj: string | null = null;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth <= 0) return;
    const fullPath = path.join(projectPath, dir);
    const entries = await fs.readdir(fullPath, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      const relNorm = rel.replace(/\\/g, "/");
      if (e.isDirectory()) {
        await walk(rel, depth - 1);
      } else {
        const lower = e.name.toLowerCase();
        if (lower.endsWith(".sln") && !sln) sln = relNorm;
        if (lower.endsWith(".csproj") && !csproj && !lower.includes("test")) csproj = relNorm;
      }
    }
  }

  await walk("", maxDepth);
  return sln ?? csproj;
}

export async function runDependencyInstall(
  ctx: IContainerExecutionContext,
  codeExecution: ICodeExecutionService,
  request: ExecutionRequest
): Promise<DependencyInstallResult> {
  const stack = request.stack as StackType;
  const hasDepManifest = await hasManifest(request.projectPath, stack);
  if (!hasDepManifest) {
    await ctx.appendLogs("No dependency manifest found (e.g. requirements.txt, .csproj/.sln). Skipping install.\n");
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  const profile = getProfile(stack, request.runtimeVersion);
  let installCommand = profile.installCommand;
  let cwd = "";
  if (stack === "dotnet") {
    const target = await findDotnetTarget(request.projectPath);
    if (target) {
      const targetDir = target.replace(/\/[^/]*$/, "");
      const targetArg = targetDir ? path.basename(target) : target;
      installCommand = `dotnet restore ${targetArg}`;
      if (targetDir) cwd = targetDir;
    }
  } else if (stack === "java") {
    // For Java Maven: first install the main project, then install DevX_testScripts
    const hasPom = await fileExists(path.join(request.projectPath, "pom.xml"));
    const hasGradle = await fileExists(path.join(request.projectPath, "build.gradle")) || await fileExists(path.join(request.projectPath, "build.gradle.kts"));
    if (hasPom) {
      installCommand = "mvn install -DskipTests -q";
    } else if (hasGradle) {
      installCommand = "gradle build -x test";
    }
  } else if (stack === "node") {
    installCommand = "npm install";
  }
  const result = await codeExecution.runCommand(request, {
    command: installCommand,
    cwd: cwd || undefined,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
  const text = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (text) await ctx.appendLogs(text + "\n");

  // For Java projects: install DevX_testScripts dependencies after main project installs
  if (stack === "java" && result.exitCode === 0) {
    const devxPomPath = path.join(request.projectPath, "DevX_testScripts", "pom.xml");
    if (await fileExists(devxPomPath)) {
      await ctx.appendLogs("\n[DependencyInstallAgent] Found DevX_testScripts/pom.xml — installing test dependencies...\n");
      try {
        const devxResult = await codeExecution.runCommand(request, {
          command: "mvn install -DskipTests -q",
          cwd: "DevX_testScripts",
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        const devxText = [devxResult.stdout, devxResult.stderr].filter(Boolean).join("\n");
        if (devxText) await ctx.appendLogs(devxText + "\n");
        if (devxResult.exitCode !== 0) {
          await ctx.appendLogs(`[DependencyInstallAgent] DevX_testScripts install failed (exit ${devxResult.exitCode})\n`);
        } else {
          await ctx.appendLogs("[DependencyInstallAgent] DevX_testScripts dependencies installed.\n");
        }
      } catch (err) {
        await ctx.appendLogs(`[DependencyInstallAgent] DevX_testScripts install error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  // For Node.js projects: install DevX_testScripts dependencies
  if (stack === "node" && result.exitCode === 0) {
    const devxPkgPath = path.join(request.projectPath, "DevX_testScripts", "package.json");
    if (await fileExists(devxPkgPath)) {
      await ctx.appendLogs("\n[DependencyInstallAgent] Found DevX_testScripts/package.json — installing test dependencies...\n");
      try {
        const devxResult = await codeExecution.runCommand(request, {
          command: "npm install",
          cwd: "DevX_testScripts",
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        const devxText = [devxResult.stdout, devxResult.stderr].filter(Boolean).join("\n");
        if (devxText) await ctx.appendLogs(devxText + "\n");
        if (devxResult.exitCode !== 0) {
          await ctx.appendLogs(`[DependencyInstallAgent] DevX_testScripts install failed (exit ${devxResult.exitCode})\n`);
        } else {
          await ctx.appendLogs("[DependencyInstallAgent] DevX_testScripts dependencies installed.\n");
        }
      } catch (err) {
        await ctx.appendLogs(`[DependencyInstallAgent] DevX_testScripts install error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  // For .NET projects: run libman restore if libman.json exists (restores client-side CSS/JS/fonts)
  if (stack === "dotnet" && result.exitCode === 0) {
    const libmanPath = await findLibManJson(request.projectPath);
    if (libmanPath) {
      const libmanDir = libmanPath.includes("/")
        ? libmanPath.replace(/\/[^/]*$/, "")
        : "";
      await ctx.appendLogs("\n[DependencyInstallAgent] Found libman.json — restoring client-side libraries...\n");

      // Try `dotnet tool restore` first (installs local tools like Microsoft.Web.LibraryManager.Cli)
      try {
        const toolRestore = await codeExecution.runCommand(request, {
          command: "dotnet tool restore",
          cwd: libmanDir || undefined,
          timeoutMs: 60_000,
        });
        const toolText = [toolRestore.stdout, toolRestore.stderr].filter(Boolean).join("\n");
        if (toolText) await ctx.appendLogs(toolText + "\n");
      } catch {
        // dotnet tool restore may fail if no .config/dotnet-tools.json — that's fine
      }

      // Run libman restore
      try {
        const libmanResult = await codeExecution.runCommand(request, {
          command: "libman restore",
          cwd: libmanDir || undefined,
          timeoutMs: 120_000,
        });
        const libmanText = [libmanResult.stdout, libmanResult.stderr].filter(Boolean).join("\n");
        if (libmanText) await ctx.appendLogs(libmanText + "\n");
        if (libmanResult.exitCode !== 0) {
          await ctx.appendLogs("[DependencyInstallAgent] libman restore failed (exit " + libmanResult.exitCode + "). Client-side libraries may be missing.\n");
        } else {
          await ctx.appendLogs("[DependencyInstallAgent] libman restore succeeded — client-side libraries restored.\n");
        }
      } catch (err) {
        await ctx.appendLogs(`[DependencyInstallAgent] libman restore not available: ${err instanceof Error ? err.message : String(err)}. Client-side libraries may need manual restoration.\n`);
      }
    }
  }

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
