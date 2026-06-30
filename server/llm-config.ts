/**
 * LLM configuration facade.
 *
 * Both impl modules are statically imported so the code works in ESM (dev
 * server via tsx) AND CJS (esbuild production bundle) without top-level await
 * or require(). Only the selected impl's exports are re-exported; the unused
 * module initialises harmlessly (clients are guarded by env-var checks, and
 * both SDK packages are in package.json).
 */
import { isAwsHosting } from "./platform/hosting";
import * as azureImpl from "./platform/llm/azure-impl";
import * as bedrockImpl from "./platform/llm/bedrock-impl";

const impl = isAwsHosting() ? bedrockImpl : azureImpl;

export const hasBedrock = impl.hasBedrock;
export const hasAzureOpenAI = impl.hasAzureOpenAI;
export const hasAnthropic = impl.hasAnthropic;
export const azureOpenAI = impl.azureOpenAI;
export const anthropic = impl.anthropic;
export const workflowAzureInstances = impl.workflowAzureInstances;
export const hasWorkflowInstances = impl.hasWorkflowInstances;
export const getSelectedLLM = impl.getSelectedLLM;
export const LLM = impl.LLM;
export const llm = impl.llm;
export const llmConfig = impl.llmConfig;
export const bedrockEmbeddingClient = impl.bedrockEmbeddingClient;

/** True when any chat LLM (Azure, Anthropic, or Bedrock) is configured for this hosting mode. */
export function hasAnyChatLlm(): boolean {
  return hasAnthropic || hasAzureOpenAI || hasBedrock;
}
