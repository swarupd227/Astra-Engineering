/**
 * Stack Modernization LangGraph workflow.
 * Nodes delegate to existing agents; state is persisted in stateStore keyed by analysisId.
 *
 * Completeness verification can loop back to code_upgrade if the completeness score
 * is below threshold and retries are available (max 2 retries).
 */

import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import * as z from "zod";
import {
  assessmentNode,
  buildCouplingRegistryNode,
  waitForSelectionsNode,
  validateSelectionsNode,
  fetchMigrationDocsNode,
  planningNode,
  waitForApprovalNode,
  vendorDownloadNode,
  taskPlanningNode,
  codeUpgradeNode,
  consistencyValidationNode,
  codeReviewFixNode,
  completenessVerificationNode,
  testGenerationNode,
  runAndValidateNode,
  completenessRouterFn,
} from "./nodes";

const State = z.object({
  analysisId: z.string(),
});

const builder = new StateGraph(State)
  .addNode("assessment", assessmentNode)
  .addNode("build_coupling_registry", buildCouplingRegistryNode)
  .addNode("wait_for_selections", waitForSelectionsNode)
  .addNode("validate_selections", validateSelectionsNode)
  .addNode("fetch_migration_docs", fetchMigrationDocsNode)
  .addNode("planning", planningNode)
  .addNode("wait_for_approval", waitForApprovalNode)
  .addNode("vendor_download", vendorDownloadNode)
  .addNode("task_planning", taskPlanningNode)
  .addNode("code_upgrade", codeUpgradeNode)
  .addNode("consistency_validation", consistencyValidationNode)
  .addNode("code_review_fix", codeReviewFixNode)
  .addNode("completeness_verification", completenessVerificationNode)
  .addNode("test_generation", testGenerationNode)
  .addNode("run_and_validate", runAndValidateNode)
  .addEdge(START, "assessment")
  .addEdge("assessment", "build_coupling_registry")
  .addEdge("build_coupling_registry", "wait_for_selections")
  .addEdge("wait_for_selections", "validate_selections")
  .addEdge("validate_selections", "fetch_migration_docs")
  .addEdge("fetch_migration_docs", "planning")
  .addEdge("planning", "wait_for_approval")
  .addEdge("wait_for_approval", "vendor_download")
  .addEdge("vendor_download", "task_planning")
  .addEdge("task_planning", "code_upgrade")
  .addEdge("code_upgrade", "consistency_validation")
  .addEdge("consistency_validation", "code_review_fix")
  .addEdge("code_review_fix", "completeness_verification")
  // Conditional: loop back to code_upgrade if completeness score is low, otherwise proceed
  .addConditionalEdges("completeness_verification", completenessRouterFn, {
    retry_upgrade: "code_upgrade",
    proceed: "test_generation",
  })
  .addEdge("test_generation", "run_and_validate")
  .addEdge("run_and_validate", END);

const checkpointer = new MemorySaver();
export const stackModGraph = builder.compile({ checkpointer });

export type StackModGraph = typeof stackModGraph;

/** Thread id = analysisId so we can resume the same analysis. */
export function graphConfig(analysisId: string) {
  return { configurable: { thread_id: `stack-mod-${analysisId}` } };
}
