/**
 * ============================================================
 *  CENTRALIZED LLM MODEL CONFIGURATION
 * ============================================================
 *
 *  ⚡ TO SWITCH MODELS — ONLY EDIT THIS FILE ⚡
 *
 *  All model IDs, cost tables, token limits, and capability
 *  flags are derived from the constants below. No other file
 *  needs to be touched when upgrading the GPT model version.
 *
 *  HOW TO UPGRADE (example: gpt-5.4 → gpt-5.5)
 *  ─────────────────────────────────────────────
 *  1. Update GPT_MODEL_ID below (e.g. "gpt-5.5")
 *  2. Update GPT_DEPLOYMENT_FALLBACK if needed (Azure deployment name)
 *  3. Update GPT_COST_PER_1K_INPUT / GPT_COST_PER_1K_OUTPUT if pricing changed
 *  4. Update GPT_TOKEN_LIMIT_INPUT / GPT_TOKEN_LIMIT_OUTPUT if limits changed
 *  5. Restart the server — done!
 * ============================================================
 */

// ── Primary GPT model identifier (the value sent in API calls / used in UI) ──
export const GPT_MODEL_ID = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.4";

// ── Secondary model ──────────────────────────────────────────────────────────
export const CLAUDE_MODEL_ID = process.env.ANTHROPIC_MODEL_NAME || "claude-opus-4-1";

// ── Azure deployment name fallback (used if AZURE_OPENAI_DEPLOYMENT is not set) ──
// This is the name of the deployment you created in Azure AI Foundry.
// It does NOT need to match GPT_MODEL_ID exactly.
export const GPT_DEPLOYMENT_FALLBACK = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.4-chat";

// ── Bedrock model identifier (AWS mode) ──────────────────────────────────────
export const BEDROCK_CONST_MODEL_ID = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-4-6-v1";

// ── Default model used across all services when no provider is specified ──
const _isAws = (process.env.DEVX_HOSTING || "").toLowerCase() === "aws";
export const DEFAULT_MODEL_ID: string = _isAws ? "bedrock" : GPT_MODEL_ID;

// ── Pricing (USD per 1K tokens) ──────────────────────────────────────────────
export const GPT_COST_PER_1K_INPUT  = Number(process.env.GPT_COST_PER_1K_INPUT) || 0.0025;
export const GPT_COST_PER_1K_OUTPUT = Number(process.env.GPT_COST_PER_1K_OUTPUT) || 0.01;

export const CLAUDE_COST_PER_1K_INPUT  = Number(process.env.CLAUDE_COST_PER_1K_INPUT) || 0.015;
export const CLAUDE_COST_PER_1K_OUTPUT = Number(process.env.CLAUDE_COST_PER_1K_OUTPUT) || 0.075;

// ── Token limits ─────────────────────────────────────────────────────────────
export const GPT_TOKEN_LIMIT_INPUT  = Number(process.env.AZURE_OPENAI_MAX_INPUT_TOKENS) || 128000;
export const GPT_TOKEN_LIMIT_OUTPUT = Number(process.env.AZURE_OPENAI_MAX_COMPLETION_TOKENS) || 32768;

export const CLAUDE_TOKEN_LIMIT_INPUT  = Number(process.env.ANTHROPIC_MAX_INPUT_TOKENS) || 200000;
export const CLAUDE_TOKEN_LIMIT_OUTPUT = Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS) || 32000;

// ── Default context windows (chars) used in code-generation budgeting ────────
export const GPT_CHAR_BUDGET    = Number(process.env.GPT_CHAR_BUDGET) || 200000;
export const CLAUDE_CHAR_BUDGET = Number(process.env.CLAUDE_CHAR_BUDGET) || 350000;

// ── File content budget per model (characters) ───────────────────────────────
export const GPT_FILE_CONTENT_BUDGET    = Number(process.env.GPT_FILE_CONTENT_BUDGET) || 100000;
export const CLAUDE_FILE_CONTENT_BUDGET = Number(process.env.CLAUDE_FILE_CONTENT_BUDGET) || 120000;

// ── Test-generation file budget per model (characters) ───────────────────────
export const GPT_TEST_FILE_BUDGET    = Number(process.env.GPT_TEST_FILE_BUDGET) || 45000;
export const CLAUDE_TEST_FILE_BUDGET = Number(process.env.CLAUDE_TEST_FILE_BUDGET) || 60000;

// ── Allowlist of supported model IDs for API route validation ────────────────
export const SUPPORTED_LLM_PROVIDERS: string[] = [GPT_MODEL_ID, CLAUDE_MODEL_ID, "bedrock"];

// ── List of deployment name substrings that require max_completion_tokens ────
// (instead of the legacy max_tokens parameter)
export const NEW_API_MODEL_SUBSTRINGS: string[] = [
  GPT_MODEL_ID,
  "gpt-5.3-chat",   // legacy deployment name — keep for backwards compat
  "gpt-4o-2024-08-06",
  "gpt-4o-mini-2024-07-18",
];

// ── Derived convenience maps (consumed by services) ──────────────────────────

/** Cost table keyed by model ID — used by llm-call-tracker.ts */
export const MODEL_COST_MAP: Record<string, { input: number; output: number }> = {
  [GPT_MODEL_ID]:    { input: GPT_COST_PER_1K_INPUT,   output: GPT_COST_PER_1K_OUTPUT   },
  [CLAUDE_MODEL_ID]: { input: CLAUDE_COST_PER_1K_INPUT, output: CLAUDE_COST_PER_1K_OUTPUT },
  bedrock:           { input: CLAUDE_COST_PER_1K_INPUT, output: CLAUDE_COST_PER_1K_OUTPUT },
};

/** Token limit table keyed by model ID — used by token-manager.ts */
export const MODEL_TOKEN_MAP: Record<string, { input: number; output: number }> = {
  [GPT_MODEL_ID]:    { input: GPT_TOKEN_LIMIT_INPUT,   output: GPT_TOKEN_LIMIT_OUTPUT   },
  [CLAUDE_MODEL_ID]: { input: CLAUDE_TOKEN_LIMIT_INPUT, output: CLAUDE_TOKEN_LIMIT_OUTPUT },
  bedrock:           { input: CLAUDE_TOKEN_LIMIT_INPUT, output: CLAUDE_TOKEN_LIMIT_OUTPUT },
  default:           { input: 60000,                    output: 8000                      },
};

/** Char budget map keyed by model ID — used by code-generation-loop.ts */
export const MODEL_CHAR_BUDGET_MAP: Record<string, number> = {
  [GPT_MODEL_ID]:    GPT_CHAR_BUDGET,
  [CLAUDE_MODEL_ID]: CLAUDE_CHAR_BUDGET,
  bedrock:           CLAUDE_CHAR_BUDGET,
};

/** File content budget map keyed by model ID — used by code-upgrade-prompts.ts */
export const MODEL_FILE_CONTENT_BUDGET_MAP: Record<string, number> = {
  [GPT_MODEL_ID]:    GPT_FILE_CONTENT_BUDGET,
  [CLAUDE_MODEL_ID]: CLAUDE_FILE_CONTENT_BUDGET,
  bedrock:           CLAUDE_FILE_CONTENT_BUDGET,
};

/** Test file budget map keyed by model ID — used by test-generation-prompts.ts */
export const MODEL_TEST_FILE_BUDGET_MAP: Record<string, number> = {
  [GPT_MODEL_ID]:    GPT_TEST_FILE_BUDGET,
  [CLAUDE_MODEL_ID]: CLAUDE_TEST_FILE_BUDGET,
  bedrock:           CLAUDE_TEST_FILE_BUDGET,
};
