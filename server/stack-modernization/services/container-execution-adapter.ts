/**
 * Stack modernization adapter for container orchestration.
 * Implements IContainerExecutionContext using stateStore, prepareProjectDir, proposeFixes, applyPatchesToProject.
 */

import * as path from "path";
import * as fs from "fs/promises";
import type { IContainerExecutionContext, ContainerRunOutcome, ContainerTextEdit } from "../../container-orchestration/types";
import type { ParsedIssue } from "../../code-execution/parsers";
import type { StackType } from "../../code-execution/types";
import { stateStore } from "./state-store";
import { prepareProjectDir } from "./prepare-project-dir";
import { proposeFixes } from "../agents/fix-validation-agent";
import { applyPatchesToProject, type TextEdit } from "./patch-applier";

function normalizeStackName(raw: string | undefined): StackType | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === "dotnet" || lower === ".net" || lower === "csharp" || lower === "c#") return "dotnet";
  if (lower === "python") return "python";
  if (lower === "java" || lower === "maven" || lower === "gradle" || lower === "spring" || lower === "spring boot") return "java";
  if (lower === "node" || lower === "nodejs" || lower === "javascript" || lower === "typescript" || lower === "react" || lower === "angular" || lower === "vue" || lower === "express" || lower === "nextjs") return "node";
  return null;
}

function resolveStackFromState(state: any): { stack: StackType; runtimeVersion?: string } | null {
  const framework = state.repositoryTree?.framework;
  let stack = normalizeStackName(framework);
  if (stack) {
    const langKey = stack === "node" ? "javascript" : stack;
    const version = state.repoProfile?.runtimeInfo?.find((r: any) => r.language === stack || r.language === langKey || r.language === framework);
    return {
      stack,
      runtimeVersion: version?.version ? String(version.version).replace(/^v/, "").split(".").slice(0, 2).join(".") : undefined,
    };
  }
  const pt = state.repoProfile?.projectType;
  stack = normalizeStackName(pt);
  if (stack) {
    const langKey = stack === "node" ? "javascript" : stack;
    const version = state.repoProfile?.runtimeInfo?.find((r: any) => r.language === stack || r.language === langKey || r.language === pt);
    return {
      stack,
      runtimeVersion: version?.version ? String(version.version).replace(/^v/, "").split(".").slice(0, 2).join(".") : undefined,
    };
  }
  // Fallback: infer from techStack string
  const ts = ((state as any).techStack ?? "").toLowerCase();
  stack = normalizeStackName(ts);
  if (stack) return { stack };
  // Fallback: infer from generated test file extensions
  const tests = state.generatedTests ?? [];
  if (tests.some((t: any) => (t.filePath || "").endsWith(".cs"))) return { stack: "dotnet" };
  if (tests.some((t: any) => (t.filePath || "").endsWith(".py"))) return { stack: "python" };
  if (tests.some((t: any) => (t.filePath || "").endsWith(".java"))) return { stack: "java" };
  if (tests.some((t: any) => /\.(js|ts|jsx|tsx)$/.test(t.filePath || ""))) return { stack: "node" };
  return null;
}

export function createContainerExecutionAdapter(analysisId: string): IContainerExecutionContext {
  let projectPathCache: string | null = null;

  function getState() {
    const state = stateStore.get(analysisId);
    if (!state) throw new Error(`State not found for analysis ${analysisId}`);
    return state;
  }

  return {
    async getProjectPath() {
      if (projectPathCache != null) return projectPathCache;
      const state = getState();
      if ((state as any).currentRunDirectory) {
        try {
          await fs.access((state as any).currentRunDirectory);
          projectPathCache = (state as any).currentRunDirectory;
          return projectPathCache;
        } catch {
          // directory gone or inaccessible, fall through to prepare
        }
      }
      projectPathCache = await prepareProjectDir(state);
      (state as any).currentRunDirectory = projectPathCache;
      stateStore.save(state);
      return projectPathCache;
    },

    async getStack() {
      const state = getState();
      const resolved = resolveStackFromState(state);
      if (!resolved) throw new Error("Unsupported stack for container execution");
      return resolved.stack;
    },

    async getRuntimeVersion() {
      const state = getState();
      const resolved = resolveStackFromState(state);
      return resolved?.runtimeVersion;
    },

    appendLogs(text: string) {
      const state = getState();
      const current = (state as any).validationRun;
      const nextLogs = (current?.lastLogs ?? "") + text;
      (state as any).validationRun = {
        runId: current?.runId ?? "",
        status: current?.status ?? "running",
        lastLogs: nextLogs,
        exitCode: current?.exitCode,
        testSummary: current?.testSummary,
      };
      stateStore.save(state);
    },

    setOutcome(result: ContainerRunOutcome) {
      const state = getState();
      const current = (state as any).validationRun;
      const lastLogs = ((current?.lastLogs ?? result.lastLogs ?? "").trim() || result.lastLogs) ?? "";
      (state as any).validationRun = {
        runId: current?.runId ?? `validate-${analysisId}`,
        status: result.status,
        lastLogs,
        exitCode: result.exitCode,
        testSummary: result.testSummary,
        testsRun: result.testsRun,
        testsPassed: result.testsPassed,
        testsFailed: result.testsFailed,
        testsSkipped: result.testsSkipped,
      };
      stateStore.save(state);
    },

    async getFileContents(paths: string[]) {
      const root = await this.getProjectPath();
      const out: Record<string, string> = {};
      for (const p of paths) {
        try {
          const normalized = p.replace(/\\/g, "/");
          // If path is absolute (e.g. NuGet error output), try it directly first
          let full: string;
          if (path.isAbsolute(p)) {
            full = p;
          } else {
            full = path.join(root, normalized);
          }
          out[p] = await fs.readFile(full, "utf8");
        } catch {
          out[p] = "";
        }
      }
      return out;
    },

    async requestFixes(
      parsedIssues: ParsedIssue[],
      lastStdout: string,
      lastStderr: string,
      fileContents: Record<string, string>,
      options?: { forceFullFile?: boolean }
    ): Promise<ContainerTextEdit[]> {
      const state = getState();
      const projectPath = await this.getProjectPath();
      const stack = await this.getStack();
      const input: any = {
        state,
        projectPath,
        stack,
        parsedIssues,
        lastStdout,
        lastStderr,
        fileContents,
      };
      if (options?.forceFullFile) input.forceFullFile = true;
      const edits = await proposeFixes(input);
      return edits as ContainerTextEdit[];
    },

    async applyEdits(edits: ContainerTextEdit[]) {
      const projectPath = await this.getProjectPath();
      const modified = await applyPatchesToProject(projectPath, edits as TextEdit[]);
      const state = getState();
      const byPath = new Map(((state as any).modifiedFiles ?? []).map((f: any) => [(f.path ?? f.filePath), f]));
      for (const { path: p, content } of modified) {
        const norm = p.replace(/\\/g, "/");
        byPath.set(norm, { path: norm, content, originalContent: byPath.get(norm)?.originalContent ?? content });
      }
      (state as any).modifiedFiles = Array.from(byPath.values());
      stateStore.save(state);

      // Log applied edits so they appear in the terminal
      if (modified.length > 0) {
        const fullFileSet = new Set(edits.filter(e => (e as any).fullContent).map(e => e.filePath.replace(/\\/g, "/")));
        const logLines = modified.map(m => {
          const label = fullFileSet.has(m.path) ? "Replaced (full file)" : "Patched";
          return `  ✅ ${label}: ${m.path}`;
        }).join("\n");
        this.appendLogs(`[FixAgent] ${modified.length} file(s) written to disk:\n${logLines}\n`);
      }
    },
  };
}
