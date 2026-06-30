/**
 * Stack Modernization - State Management
 * LangGraph state initialization and management
 */

import { randomUUID } from "crypto";
import type { StackModernizationState, ModernizationType, LLMProvider } from "./types";

/**
 * Initialize a new Stack Modernization state
 */
export function initializeState(
  modernizationType: ModernizationType,
  llmProvider: LLMProvider,
  userId: string,
  tenantId: string,
  tempDir: string
): StackModernizationState {
  return {
    sessionId: randomUUID(),
    analysisId: randomUUID(),
    modernizationType,
    llmProvider,
    userId,
    tenantId,
    uploadedFiles: [],
    extractedFiles: [],
    tempDir,
    currentStage: "initialized",
    progress: 0,
    status: "initiated",
    errors: [],
    activityLog: [],
    startedAt: new Date(),
  };
}

/**
 * Update state progress
 * Only sets status to "in_progress" if not already in a final state
 */
export function updateProgress(
  state: StackModernizationState,
  stage: string,
  progress: number
): StackModernizationState {
  // Only preserve completed or failed status (not awaiting_user_selection - that can be resumed)
  const preserveStatus = ['completed', 'failed'].includes(state.status);
  
  return {
    ...state,
    currentStage: stage,
    progress,
    status: preserveStatus ? state.status : "in_progress",
  };
}

/**
 * Mark state as completed
 */
export function completeState(
  state: StackModernizationState
): StackModernizationState {
  return {
    ...state,
    status: "completed",
    progress: 100,
    completedAt: new Date(),
  };
}

/**
 * Mark state as failed
 */
export function failState(
  state: StackModernizationState,
  error: string
): StackModernizationState {
  return {
    ...state,
    status: "failed",
    errors: [...state.errors, error],
    completedAt: new Date(),
  };
}

/**
 * Add error to state without failing
 */
export function addError(
  state: StackModernizationState,
  error: string
): StackModernizationState {
  return {
    ...state,
    errors: [...state.errors, error],
  };
}

/**
 * Add activity log entry
 */
export function logActivity(
  state: StackModernizationState,
  agent: string,
  action: string,
  details?: string,
  status: "info" | "success" | "warning" | "error" = "info"
): StackModernizationState {
  return {
    ...state,
    activityLog: [
      ...state.activityLog,
      {
        timestamp: new Date(),
        agent,
        action,
        details,
        status
      }
    ]
  };
}
