/**
 * Shared monetary tiers + last-resort column synthesis when no SYNTHETIC_VALUE_RULES match.
 */

import { FIRST_NAMES, LAST_NAMES } from "./synthetic-name-lists";

const DEDUCTIBLE_COPAY_TIERS = [250, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000] as const;

/** Deterministic mix for picking from small pools without importing synthetic-data.ts helpers. */
export function hashPick(rowIndex: number, fieldKey: string, modulo: number): number {
  let h = (rowIndex >>> 0) ^ 2166136261;
  const s = fieldKey.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return modulo <= 0 ? 0 : (h >>> 0) % modulo;
}

export function insuranceMoneyTier(rowIndex: number, fieldKey: string): number {
  return DEDUCTIBLE_COPAY_TIERS[hashPick(rowIndex, fieldKey + ":tier", DEDUCTIBLE_COPAY_TIERS.length)];
}

export function genericMonetaryAmount(rowIndex: number, fieldKey: string): number {
  const u = hashPick(rowIndex, fieldKey + ":amt", 1_000_000) / 1_000_000;
  return Math.round((u * 99000 + 500) * 100) / 100;
}

export function genericPercentageAmount(rowIndex: number, fieldKey: string): number {
  const u = hashPick(rowIndex, fieldKey + ":pct", 1_000_000) / 1_000_000;
  return Math.round((u * 22 + 1) * 100) / 100;
}

function syntheticPersonName(rowIndex: number, fieldKey: string): string {
  const fi = hashPick(rowIndex, fieldKey + ":fn", FIRST_NAMES.length);
  const li = hashPick(rowIndex, fieldKey + ":ln", LAST_NAMES.length);
  return `${FIRST_NAMES[fi]} ${LAST_NAMES[li]}`;
}

/**
 * Produces plausible strings or numbers — never `val_<column>_<n>` placeholders.
 */
export function heuristicFallbackColumnValue(fieldName: string, rowIndex: number): string | number | boolean {
  const lower = fieldName.toLowerCase();

  if (/\b(deductible|copay|copayment)\b/.test(lower)) {
    return insuranceMoneyTier(rowIndex, fieldName);
  }
  if (
    /\b(amount|balance|premium|salary|bonus|fee|fare|price|cost|payment|payout|credit|tax|subtotal|discount|commission|revenue|income|expense|budget|payable|receivable|valuation|payroll|withdrawal|deposit|transfer|charge|dues|grant|subsidy|penalty|fine)\b/.test(
      lower
    )
  ) {
    return genericMonetaryAmount(rowIndex, fieldName);
  }
  if (/\b(coinsurance|percentage)\b/.test(lower)) {
    return genericPercentageAmount(rowIndex, fieldName);
  }
  if (/\bout[\s\-]?of[\s\-]?pocket\b/.test(lower)) {
    return genericMonetaryAmount(rowIndex, fieldName);
  }
  if (/\bcredit\s+score\b/.test(lower)) {
    return 580 + hashPick(rowIndex, fieldName + ":fico", 221);
  }
  if (/\b(count|qty|quantity|units|volume|headcount|items|defect)\b/.test(lower)) {
    return 1 + hashPick(rowIndex, fieldName + ":qty", 500);
  }
  if (/\b(duration|hours|minutes|interval)\b/.test(lower)) {
    return 1 + hashPick(rowIndex, fieldName + ":dur", 120);
  }
  if (/\b(days|months|years)\b/.test(lower)) {
    return 1 + hashPick(rowIndex, fieldName + ":span", 36);
  }
  if (/\b(note|remark|comment|description|details|summary|reason|justification|abstract)\b/.test(lower)) {
    return `${fieldName.trim()} — synthetic narrative snippet ${rowIndex + 1}.`;
  }
  if (/\b(score|rating|rank|priority)\b/.test(lower)) {
    const opts = ["Low", "Medium", "High", "P1", "P2", "P3", "1", "2", "3", "4", "5"];
    return opts[hashPick(rowIndex, fieldName, opts.length)];
  }
  if (/\b(level|tier|band)\b/.test(lower)) {
    const opts = ["Basic", "Standard", "Premium", "Enterprise", "Gold", "Silver", "Bronze"];
    return opts[hashPick(rowIndex, fieldName, opts.length)];
  }
  if (/\b(flag|indicator)\b/.test(lower) || /\bis_\b/.test(lower)) {
    return hashPick(rowIndex, fieldName, 2) === 1;
  }
  if (
    /\b(owner|author|contact|recipient|insured|beneficiary|adjuster|counselor|instructor|vendor\s+contact)\b/.test(
      lower
    )
  ) {
    return syntheticPersonName(rowIndex, fieldName);
  }
  if (/\b(holder|policyholder)\b/.test(lower)) {
    return syntheticPersonName(rowIndex, fieldName);
  }

  const label = fieldName.replace(/[_\-]+/g, " ").trim() || "Field";
  return `${label} ${rowIndex + 1}`;
}
