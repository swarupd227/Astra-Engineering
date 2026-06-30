/**
 * Tech stack init: resolve project path, stack, runtime version; ensure Docker image.
 * Uses only context and code-execution (no stack-mod types).
 */

import type { IContainerExecutionContext } from "../types";
import type { ICodeExecutionService } from "../../code-execution";
import { getExecutionMode } from "../../code-execution";
import type { StackType } from "../../code-execution/types";

export interface TechStackInitResult {
  projectPath: string;
  stack: StackType;
  runtimeVersion: string | undefined;
}

export async function runTechStackInit(
  ctx: IContainerExecutionContext,
  codeExecution: ICodeExecutionService
): Promise<TechStackInitResult> {
  await ctx.appendLogs("Preparing project directory...\n");
  const projectPath = await ctx.getProjectPath();
  await ctx.appendLogs("Detecting stack...\n");
  const stack = await ctx.getStack();
  const runtimeVersion = await ctx.getRuntimeVersion();

  await ctx.appendLogs(`Verifying ${stack} runtime...\n`);
  await codeExecution.ensureImage(stack, runtimeVersion);

  const mode = getExecutionMode();
  await ctx.appendLogs(mode === "local" ? "Using local runtime (Docker skipped).\nProject prepared.\n" : "Image ready.\nProject prepared.\n");
  return { projectPath, stack, runtimeVersion };
}
