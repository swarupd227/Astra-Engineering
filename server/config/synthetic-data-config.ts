/**
 * Configurable constants for synthetic test data generation.
 * Override via env: SYNTHETIC_DATA_MIN_RECORDS, SYNTHETIC_DATA_MAX_RECORDS,
 * SYNTHETIC_DATA_DEFAULT_RECORDS, SYNTHETIC_DATA_LLM_BATCH_SIZE,
 * SYNTHETIC_DATA_MAX_LLM_RECORDS, and token estimate keys below.
 */

export function getDataLimits(): {
  minRecords: number;
  maxRecords: number;
  defaultRecords: number;
} {
  const min = parseInt(process.env.SYNTHETIC_DATA_MIN_RECORDS ?? "1", 10);
  const max = parseInt(process.env.SYNTHETIC_DATA_MAX_RECORDS ?? "1000000", 10);
  const defaultVal = parseInt(process.env.SYNTHETIC_DATA_DEFAULT_RECORDS ?? "100", 10);
  return {
    minRecords: Number.isFinite(min) && min > 0 ? min : 1,
    maxRecords: Number.isFinite(max) && max >= 1 ? max : 1_000_000,
    defaultRecords: Number.isFinite(defaultVal) ? Math.max(min, Math.min(max, defaultVal)) : 100,
  };
}

export function getLLMBatchConfig(): { batchSize: number; maxRecords: number } {
  const batchSize = parseInt(process.env.SYNTHETIC_DATA_LLM_BATCH_SIZE ?? "40", 10);
  const maxRecords = parseInt(process.env.SYNTHETIC_DATA_MAX_LLM_RECORDS ?? "1000000", 10);
  return {
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 40,
    maxRecords: Number.isFinite(maxRecords) && maxRecords > 0 ? maxRecords : 1_000_000,
  };
}

export function getTokenEstimateConfig(): {
  inputPerBatch: number;
  outputPerRecordMain: number;
  outputPerRecordRoot: number;
  batchSize: number;
} {
  return {
    inputPerBatch: parseInt(process.env.SYNTHETIC_DATA_TOKEN_INPUT_PER_BATCH ?? "550", 10) || 550,
    outputPerRecordMain: parseInt(process.env.SYNTHETIC_DATA_TOKEN_OUTPUT_MAIN ?? "28", 10) || 28,
    outputPerRecordRoot: parseInt(process.env.SYNTHETIC_DATA_TOKEN_OUTPUT_ROOT ?? "20", 10) || 20,
    batchSize: parseInt(process.env.SYNTHETIC_DATA_ESTIMATE_BATCH_SIZE ?? "40", 10) || 40,
  };
}

export type SyntheticValueRule = {
  /** Substring to match in lowercased field name (or "default" for fallback). */
  pattern: string;
  type: SyntheticValueType;
  /** For type "enum" / "status" / "currency" / "gender" etc., list of values to cycle through. */
  options?: string[];
};

/** For numeric_id rule: field must contain "id" and one of these substrings. */
export const NUMERIC_ID_ENTITY_KEYWORDS = [
  "account", "customer", "loan", "policy", "order", "patient", "batch", "payment", "trade", "portfolio",
];

export type SyntheticValueType =
  | "numeric_id" | "date" | "amount" | "rate" | "term" | "status" | "enum"
  | "currency" | "name" | "code" | "gender" | "risk" | "reference"
  | "email" | "password" | "phone" | "address" | "city" | "zip"
  | "username" | "search" | "url" | "description" | "first_name" | "last_name"
  | "default";

/** Config-driven rules for syntheticValue. Order matters: first match wins. */
export const SYNTHETIC_VALUE_RULES: SyntheticValueRule[] = [
  // Web-form specific patterns (checked before generic ones)
  { pattern: "email", type: "email" },
  { pattern: "password", type: "password" },
  { pattern: "passwd", type: "password" },
  { pattern: "phone", type: "phone" },
  { pattern: "mobile", type: "phone" },
  { pattern: "tel", type: "phone" },
  { pattern: "street", type: "address" },
  { pattern: "address", type: "address" },
  { pattern: "city", type: "city" },
  { pattern: "zip", type: "zip" },
  { pattern: "postal", type: "zip" },
  { pattern: "postcode", type: "zip" },
  { pattern: "username", type: "username" },
  { pattern: "user_name", type: "username" },
  { pattern: "login", type: "username" },
  { pattern: "search", type: "search" },
  { pattern: "query", type: "search" },
  { pattern: "website", type: "url" },
  { pattern: "homepage", type: "url" },
  { pattern: "description", type: "description" },
  { pattern: "notes", type: "description" },
  { pattern: "comment", type: "description" },
  { pattern: "message", type: "description" },
  { pattern: "bio", type: "description" },
  { pattern: "first", type: "first_name" },
  { pattern: "fname", type: "first_name" },
  { pattern: "given", type: "first_name" },
  { pattern: "last", type: "last_name" },
  { pattern: "lname", type: "last_name" },
  { pattern: "surname", type: "last_name" },
  // Enterprise/table patterns
  { pattern: "id", type: "numeric_id" },
  { pattern: "date", type: "date" },
  { pattern: "opened", type: "date" },
  { pattern: "start", type: "date" },
  { pattern: "end", type: "date" },
  { pattern: "created", type: "date" },
  { pattern: "visit", type: "date" },
  { pattern: "time", type: "date" },
  { pattern: "amount", type: "amount" },
  { pattern: "balance", type: "amount" },
  { pattern: "principal", type: "amount" },
  { pattern: "premium", type: "amount" },
  { pattern: "deductible", type: "amount" },
  { pattern: "copayment", type: "amount" },
  { pattern: "copay", type: "amount" },
  { pattern: "coinsurance", type: "rate" },
  { pattern: "salary", type: "amount" },
  { pattern: "wage", type: "amount" },
  { pattern: "bonus", type: "amount" },
  { pattern: "commission", type: "amount" },
  { pattern: "discount", type: "amount" },
  { pattern: "fee", type: "amount" },
  { pattern: "fare", type: "amount" },
  { pattern: "price", type: "amount" },
  { pattern: "subtotal", type: "amount" },
  { pattern: "revenue", type: "amount" },
  { pattern: "income", type: "amount" },
  { pattern: "expense", type: "amount" },
  { pattern: "payroll", type: "amount" },
  { pattern: "payout", type: "amount" },
  { pattern: "valuation", type: "amount" },
  { pattern: "margin", type: "rate" },
  { pattern: "total", type: "amount" },
  { pattern: "quantity", type: "amount" },
  { pattern: "aum", type: "amount" },
  { pattern: "notional", type: "amount" },
  { pattern: "cost", type: "amount" },
  { pattern: "rate", type: "rate" },
  { pattern: "term", type: "term" },
  { pattern: "status", type: "status", options: ["Active", "Pending", "Closed", "Settled", "Approved"] },
  {
    pattern: "coverage",
    type: "enum",
    options: [
      "Comprehensive",
      "Collision",
      "Liability",
      "Property",
      "HO-3",
      "Term Life",
      "Whole Life",
      "PPO",
      "HMO",
      "Workers Compensation",
      "Cyber",
      "Umbrella",
    ],
  },
  { pattern: "category", type: "enum", options: ["Retail", "Commercial", "Industrial", "Government", "Nonprofit", "Online"] },
  { pattern: "policyholder", type: "name" },
  { pattern: "insured", type: "name" },
  { pattern: "beneficiary", type: "name" },
  { pattern: "adjuster", type: "name" },
  { pattern: "physician", type: "name" },
  { pattern: "doctor", type: "name" },
  { pattern: "type", type: "enum", options: ["Type A", "Type B", "Online", "Branch", "API"] },
  { pattern: "channel", type: "enum", options: ["Type A", "Type B", "Online", "Branch", "API"] },
  { pattern: "method", type: "enum", options: ["Type A", "Type B", "Online", "Branch", "API"] },
  { pattern: "currency", type: "currency" },
  { pattern: "name", type: "name" },
  { pattern: "title", type: "name" },
  { pattern: "code", type: "code" },
  { pattern: "branch", type: "code" },
  { pattern: "gender", type: "gender" },
  { pattern: "risk", type: "risk" },
  { pattern: "profile", type: "risk" },
  { pattern: "reference", type: "reference" },
  { pattern: "url", type: "url" },
  { pattern: "default", type: "default" },
];