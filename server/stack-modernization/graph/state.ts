/**
 * LangGraph state for Stack Modernization workflow.
 * Heavy data lives in stateStore keyed by analysisId; graph state stays minimal for checkpointing.
 */

import * as z from "zod";

export const StackModGraphStateSchema = {
  analysisId: z.string(),
};

export type StackModGraphState = { analysisId: string };
