/**
 * Container orchestration - run project in container with install, test, parse, fix loop.
 * Depends only on code-execution. Consumers (e.g. stack-modernization) pass an adapter (IContainerExecutionContext).
 */

export type { IContainerExecutionContext, ContainerRunOutcome, ContainerTextEdit, RunContainerOptions } from "./types";
export type { StackType } from "./types";
export { runContainerExecution } from "./orchestrator";
export type { RunContainerExecutionResult } from "./orchestrator";
