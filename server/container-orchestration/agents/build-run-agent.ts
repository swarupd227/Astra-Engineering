/**
 * Build and run: run profile test command in container; append logs via context.
 * For dotnet, finds .sln so ALL test projects (including GeneratedTests) are discovered.
 * Falls back to finding individual .csproj when no .sln exists.
 */

import * as path from "path";
import * as fs from "fs/promises";
import type { IContainerExecutionContext } from "../types";
import type { ICodeExecutionService, ExecutionRequest } from "../../code-execution";
import type { StackType } from "../../code-execution/types";
import { getProfile } from "../../code-execution/profiles";
import { findDotnetTarget } from "./dependency-install-agent";

const TEST_TIMEOUT_MS = 300_000;

export interface BuildRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function findSlnFile(projectPath: string, depth = 3): Promise<string | null> {
  async function walk(dir: string, d: number): Promise<string | null> {
    if (d <= 0) return null;
    const entries = await fs.readdir(path.join(projectPath, dir), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (!e.isDirectory() && e.name.toLowerCase().endsWith(".sln")) return rel;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const found = await walk(rel, d - 1);
        if (found) return found;
      }
    }
    return null;
  }
  return walk("", depth);
}

export async function runBuildAndTest(
  ctx: IContainerExecutionContext,
  codeExecution: ICodeExecutionService,
  request: ExecutionRequest
): Promise<BuildRunResult> {
  const stack = request.stack as StackType;
  const profile = getProfile(stack, request.runtimeVersion);
  let testCommand = profile.testCommand;
  let cwd = "";

  if (stack === "dotnet") {
    const slnFile = await findSlnFile(request.projectPath);
    if (slnFile) {
      const slnDir = slnFile.includes("/") ? slnFile.replace(/\/[^/]*$/, "") : "";
      testCommand = `dotnet test ${path.basename(slnFile)}`;
      if (slnDir) cwd = slnDir;
    } else {
      const target = await findDotnetTarget(request.projectPath);
      if (target) {
        const targetDir = target.replace(/\/[^/]*$/, "");
        const targetArg = targetDir ? path.basename(target) : target;
        testCommand = `dotnet test ${targetArg}`;
        if (targetDir) cwd = targetDir;
      }
    }
  }

  let combinedStdout = "";
  let combinedStderr = "";
  let combinedExit = 0;

  // For dotnet: prioritize the DevX_testScripts project directly so we always
  // run the generated tests. Fall back to sln/csproj-level test if no DevX project found.
  if (stack === "dotnet") {
    const devxCsproj = await findDevXTestProject(request.projectPath);
    if (devxCsproj) {
      // Step 1: Restore dependencies for the DevX test project
      await ctx.appendLogs(`[BuildRunAgent] Restoring DevX_testScripts dependencies...\n`);
      const restoreResult = await codeExecution.runCommand(request, {
        command: `dotnet restore ${devxCsproj}`,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      if (restoreResult.stdout) await ctx.appendLogs(restoreResult.stdout + "\n");
      if (restoreResult.exitCode !== 0) {
        await ctx.appendLogs(`[BuildRunAgent] DevX restore failed (exit ${restoreResult.exitCode})\n`);
        if (restoreResult.stderr) await ctx.appendLogs(restoreResult.stderr + "\n");
      }

      // Step 2: Build the test project to surface compilation errors early
      await ctx.appendLogs(`[BuildRunAgent] Building DevX_testScripts...\n`);
      const buildResult = await codeExecution.runCommand(request, {
        command: `dotnet build ${devxCsproj} --no-restore`,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      if (buildResult.stdout) await ctx.appendLogs(buildResult.stdout + "\n");
      if (buildResult.exitCode !== 0) {
        await ctx.appendLogs(`[BuildRunAgent] DevX build failed (exit ${buildResult.exitCode})\n`);
        if (buildResult.stderr) await ctx.appendLogs(buildResult.stderr + "\n");
        combinedStdout = buildResult.stdout;
        combinedStderr = buildResult.stderr;
        combinedExit = buildResult.exitCode;
        return { exitCode: combinedExit, stdout: combinedStdout, stderr: combinedStderr };
      }

      // Step 3: Run the generated tests
      await ctx.appendLogs(`[BuildRunAgent] Running generated tests from DevX_testScripts...\n`);
      const devxResult = await codeExecution.runCommand(request, {
        command: `dotnet test ${devxCsproj} --no-build`,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      combinedStdout = devxResult.stdout;
      combinedStderr = devxResult.stderr;
      combinedExit = devxResult.exitCode;
      if (devxResult.stdout) await ctx.appendLogs(devxResult.stdout + "\n");
      if (devxResult.stderr) await ctx.appendLogs(devxResult.stderr + "\n");
    } else {
      await ctx.appendLogs(`[BuildRunAgent] No DevX_testScripts project found — falling back to solution-level test.\n`);
      const result = await codeExecution.runCommand(request, {
        command: testCommand,
        cwd: cwd || undefined,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      combinedStdout = result.stdout;
      combinedStderr = result.stderr;
      combinedExit = result.exitCode;
      const text = [combinedStdout, combinedStderr].filter(Boolean).join("\n");
      if (text) await ctx.appendLogs(text + "\n");
    }
  } else if (stack === "java") {
    // For Java: run tests from DevX_testScripts Maven project or fall back to root
    const devxPom = await findDevXJavaTestProject(request.projectPath);
    if (devxPom) {
      await ctx.appendLogs(`[BuildRunAgent] Found DevX_testScripts Maven project — running JUnit tests...\n`);
      const result = await codeExecution.runCommand(request, {
        command: `mvn test -f ${devxPom}`,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      combinedStdout = result.stdout;
      combinedStderr = result.stderr;
      combinedExit = result.exitCode;
      if (result.stdout) await ctx.appendLogs(result.stdout + "\n");
      if (result.stderr) await ctx.appendLogs(result.stderr + "\n");
    } else {
      await ctx.appendLogs(`[BuildRunAgent] No DevX_testScripts pom.xml — running tests from project root\n`);
      const result = await codeExecution.runCommand(request, {
        command: testCommand,
        cwd: cwd || undefined,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      combinedStdout = result.stdout;
      combinedStderr = result.stderr;
      combinedExit = result.exitCode;
      const text = [combinedStdout, combinedStderr].filter(Boolean).join("\n");
      if (text) await ctx.appendLogs(text + "\n");
    }
  } else if (stack === "node") {
    // For Node.js: run Jest tests from DevX_testScripts or fall back to root
    const devxPkgExists = await fileExistsFn(path.join(request.projectPath, "DevX_testScripts", "package.json"));
    if (devxPkgExists) {
      await ctx.appendLogs(`[BuildRunAgent] Found DevX_testScripts — running Jest tests...\n`);
      // First try npx jest from DevX_testScripts, then fallback to npm test
      const result = await codeExecution.runCommand(request, {
        command: "npx jest --verbose --no-cache",
        cwd: "DevX_testScripts",
        timeoutMs: TEST_TIMEOUT_MS,
      });
      combinedStdout = result.stdout;
      combinedStderr = result.stderr;
      combinedExit = result.exitCode;
      if (result.stdout) await ctx.appendLogs(result.stdout + "\n");
      if (result.stderr) await ctx.appendLogs(result.stderr + "\n");
    } else {
      // No separate test project — run tests from root targeting DevX_testScripts
      const devxDir = path.join(request.projectPath, "DevX_testScripts");
      let finalCmd = testCommand;
      try {
        await fs.access(devxDir);
        finalCmd = `npx jest DevX_testScripts --verbose --no-cache`;
        await ctx.appendLogs(`[BuildRunAgent] Found DevX_testScripts dir — running Jest on generated tests\n`);
      } catch {
        await ctx.appendLogs(`[BuildRunAgent] No DevX_testScripts — using default test command\n`);
      }
      const result = await codeExecution.runCommand(request, {
        command: finalCmd,
        cwd: cwd || undefined,
        timeoutMs: TEST_TIMEOUT_MS,
      });
      combinedStdout = result.stdout;
      combinedStderr = result.stderr;
      combinedExit = result.exitCode;
      const text = [combinedStdout, combinedStderr].filter(Boolean).join("\n");
      if (text) await ctx.appendLogs(text + "\n");
    }
  } else {
    // For Python and other stacks: check if DevX_testScripts folder exists and target it explicitly
    let finalTestCmd = testCommand;
    if (stack === "python") {
      const devxDir = path.join(request.projectPath, "DevX_testScripts");
      try {
        await fs.access(devxDir);
        finalTestCmd = `python -m pytest DevX_testScripts/ -v --tb=short || pytest DevX_testScripts/ -v --tb=short`;
        await ctx.appendLogs(`[BuildRunAgent] Found DevX_testScripts — running pytest on generated tests\n`);
      } catch {
        await ctx.appendLogs(`[BuildRunAgent] No DevX_testScripts found — using default test command\n`);
      }
    }
    const result = await codeExecution.runCommand(request, {
      command: finalTestCmd,
      cwd: cwd || undefined,
      timeoutMs: TEST_TIMEOUT_MS,
    });
    combinedStdout = result.stdout;
    combinedStderr = result.stderr;
    combinedExit = result.exitCode;
    const text = [combinedStdout, combinedStderr].filter(Boolean).join("\n");
    if (text) await ctx.appendLogs(text + "\n");
  }

  return {
    exitCode: combinedExit,
    stdout: combinedStdout,
    stderr: combinedStderr,
  };
}

async function fileExistsFn(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function findDevXJavaTestProject(projectPath: string): Promise<string | null> {
  const candidate = "DevX_testScripts/pom.xml";
  try {
    await fs.access(path.join(projectPath, candidate));
    return candidate;
  } catch { /* skip */ }
  // Recursive search
  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth <= 0) return null;
    const entries = await fs.readdir(path.join(projectPath, dir), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory() && e.name.toLowerCase() === "devx_testscripts") {
        try {
          await fs.access(path.join(projectPath, rel, "pom.xml"));
          return `${rel}/pom.xml`.replace(/\\/g, "/");
        } catch { /* continue */ }
      }
      if (e.isDirectory()) {
        const inner = await walk(rel, depth - 1);
        if (inner) return inner;
      }
    }
    return null;
  }
  return walk("", 4);
}

async function findDevXTestProject(projectPath: string): Promise<string | null> {
  const candidates = [
    "DevX_testScripts/DevX_testScripts.csproj",
    "DevX_testScripts\\DevX_testScripts.csproj",
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(path.join(projectPath, candidate));
      return candidate.replace(/\\/g, "/");
    } catch { /* skip */ }
  }
  // Recursive search
  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth <= 0) return null;
    const entries = await fs.readdir(path.join(projectPath, dir), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (!e.isDirectory() && e.name === "DevX_testScripts.csproj") return rel;
      if (e.isDirectory() && e.name.toLowerCase() === "devx_testscripts") {
        const inner = await walk(rel, depth - 1);
        if (inner) return inner;
      }
    }
    return null;
  }
  return walk("", 4);
}
