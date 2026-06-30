/**
 * Static Bedrock price map + cost computation for the universal AI usage ledger.
 *
 * Rates are USD per 1,000,000 tokens. Bedrock Converse reports cached-read input
 * (`cacheReadInputTokens`) SEPARATELY from regular `inputTokens`, so we bill them
 * apart — no `max(input - cache, 0)` subtraction is needed here:
 *
 *   cost_usd = (input_tokens   * inputPerM
 *             + cache_tokens   * cachedInputPerM
 *             + output_tokens  * outputPerM) / 1_000_000   (rounded to 6 dp)
 *
 * where input_tokens = non-cached billable input, cache_tokens = cached-read input.
 */

export interface ModelRate {
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
}

// Matched in order; first hit wins. Keyed off the Bedrock model id.
const RATE_TABLE: Array<{ match: RegExp; rate: ModelRate }> = [
  // Claude Opus 4.x / 3 (our configured default: us.anthropic.claude-opus-4-6-v1)
  { match: /claude-(opus-4|3-opus|opus-3)/i, rate: { inputPerM: 15, cachedInputPerM: 1.5, outputPerM: 75 } },
  // Claude Sonnet 4.x / 3.7 / 3.5
  { match: /(claude-sonnet-4|claude-3-7-sonnet|claude-3-5-sonnet|sonnet)/i, rate: { inputPerM: 3, cachedInputPerM: 0.3, outputPerM: 15 } },
  // Claude 3.5 Haiku
  { match: /claude-3[.-]5-haiku/i, rate: { inputPerM: 0.8, cachedInputPerM: 0.08, outputPerM: 4 } },
  // Claude 3 Haiku
  { match: /(claude-3-haiku|haiku)/i, rate: { inputPerM: 0.25, cachedInputPerM: 0.03, outputPerM: 1.25 } },
  // Amazon Titan Text Embeddings v2 (input only)
  { match: /(titan-embed|titan-embed-text|amazon\.titan-embed)/i, rate: { inputPerM: 0.02, cachedInputPerM: 0, outputPerM: 0 } },
];

// Default to Opus pricing (the configured generation model) so cost is never zero
// for an unrecognised Claude model id.
const DEFAULT_RATE: ModelRate = { inputPerM: 15, cachedInputPerM: 1.5, outputPerM: 75 };

export function getModelRate(model: string): ModelRate {
  const m = (model || "").toLowerCase();
  for (const { match, rate } of RATE_TABLE) {
    if (match.test(m)) return rate;
  }
  return DEFAULT_RATE;
}

export function computeCacheSavingsUsd(params: {
  model: string;
  cacheTokens: number;
}): number {
  const cacheTokens = Math.max(params.cacheTokens, 0);
  if (cacheTokens === 0) return 0;
  const r = getModelRate(params.model);
  const savedPerM = Math.max(r.inputPerM - r.cachedInputPerM, 0);
  return Math.round((cacheTokens * savedPerM) / 1_000_000 * 1_000_000) / 1_000_000;
}

export function computeCostUsd(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}): number {
  const r = getModelRate(params.model);
  const cost =
    (Math.max(params.inputTokens, 0) * r.inputPerM +
      Math.max(params.cacheTokens, 0) * r.cachedInputPerM +
      Math.max(params.outputTokens, 0) * r.outputPerM) /
    1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 dp
}
