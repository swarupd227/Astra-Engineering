/**
 * Shared synthetic value generator used by both the test-data generation feature
 * and the automated-test form-filler.
 *
 * Covers enterprise/table patterns (amounts, dates, statuses) AND web-form patterns
 * (email, password, phone, address, name variants, etc.).
 */

import {
  SYNTHETIC_VALUE_RULES,
  NUMERIC_ID_ENTITY_KEYWORDS,
  type SyntheticValueRule,
} from "../config/synthetic-data-config";
import { FIRST_NAMES, LAST_NAMES } from "../config/synthetic-name-lists";
import { INTERNATIONAL_STREETS, WORLD_LOCATION_SLOTS } from "../config/synthetic-world-locations";
import {
  genericMonetaryAmount,
  heuristicFallbackColumnValue,
  insuranceMoneyTier,
} from "../config/synthetic-column-heuristics";

function fieldMix(rowIndex: number, fieldKey: string, salt: number): number {
  let h = (rowIndex >>> 0) ^ (Math.imul(salt, 0x9e3779b9) >>> 0);
  const s = fieldKey.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 13;
    h >>>= 0;
  }
  h = Math.imul(h ^ rowIndex, 0x85ebca6b);
  h ^= h >>> 16;
  return h >>> 0;
}

function pickByMix<T>(arr: readonly T[], rowIndex: number, fieldKey: string, salt: number): T {
  if (arr.length === 0) throw new Error("pickByMix: empty array");
  return arr[(fieldMix(rowIndex, fieldKey, salt) >>> 0) % arr.length] as T;
}

function splitFieldNameTokens(lower: string): string[] {
  const spaced = lower.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-\.]+/g, " ").trim();
  return spaced.split(/\s+/).filter(Boolean);
}

function columnMatchesPattern(lower: string, pattern: string): boolean {
  if (pattern === "id") {
    const tokens = splitFieldNameTokens(lower);
    return tokens.some((w) => w === "id") || lower.endsWith("_id");
  }
  return lower.includes(pattern);
}

function rowLocation(rowIndex: number): {
  city: string;
  stateAbbr: string;
  country: string;
  streetNum: number;
  street: string;
  zip: string;
} {
  const slot = pickByMix(WORLD_LOCATION_SLOTS, rowIndex, "__world_slot__", 0x7c01);
  const street = pickByMix(INTERNATIONAL_STREETS, rowIndex, "__world_st__", 0x7c04);
  const streetNum = 100 + ((fieldMix(rowIndex, "__world_num__", 0x7c03) >>> 0) % 9900);
  return {
    city: slot.city,
    stateAbbr: slot.region,
    country: slot.country,
    streetNum,
    street,
    zip: slot.postal,
  };
}

/**
 * Config-driven deterministic value by field name and row index.
 * Works for both table/CSV column names and HTML form field names/types/labels.
 */
export function syntheticValue(
  fieldName: string,
  rowIndex: number,
  prefix?: string
): string | number | boolean {
  const withPrefix = (v: string | number | boolean): string | number | boolean => {
    if (!prefix || typeof v === "boolean") return v;
    return `${prefix}${v}`;
  };

  const seed = rowIndex * 31 + fieldName.length;
  const r = (): number => Math.sin(seed + rowIndex * 0.1) * 0.5 + 0.5;
  const id = (): number =>
    (prefix ? parseInt(prefix.replace(/\D/g, "").slice(0, 4) || "0", 10) * 10000 : 0) +
    rowIndex +
    1;
  const lower = fieldName.toLowerCase();
  const tokens = splitFieldNameTokens(lower);
  const loc = rowLocation(rowIndex);

  if (tokens.some((w) => w === "country" || w === "countries" || w === "nation")) {
    return prefix ? `${prefix}${loc.country}` : loc.country;
  }
  if (tokens.some((w) => w === "state" || w === "states" || w === "province")) {
    return prefix ? `${prefix}${loc.stateAbbr}` : loc.stateAbbr;
  }

  const rule = SYNTHETIC_VALUE_RULES.find((ru) => {
    if (ru.pattern === "default") return false;
    if (!columnMatchesPattern(lower, ru.pattern)) return false;
    if (ru.type === "numeric_id") {
      return (
        NUMERIC_ID_ENTITY_KEYWORDS.some((k) => lower.includes(k)) ||
        tokens.some((w) => w === "id") ||
        lower.endsWith("_id")
      );
    }
    return true;
  }) as SyntheticValueRule | undefined;

  if (!rule) return withPrefix(heuristicFallbackColumnValue(fieldName, rowIndex));

  switch (rule.type) {
    // --- Web-form types ---
    case "email":
      return `testuser${rowIndex + 1}@example.com`;
    case "password":
      return `Test@${1000 + rowIndex}!`;
    case "phone":
      return `+1-555-${String(1000 + (rowIndex % 9000)).padStart(4, "0")}`;
    case "address":
      return `${loc.streetNum} ${loc.street}, ${loc.city}, ${loc.stateAbbr}`;
    case "city":
      return loc.city;
    case "zip":
      return loc.zip;
    case "username":
      return `testuser_${rowIndex + 1}`;
    case "search":
      return `sample search term ${rowIndex + 1}`;
    case "url":
      return `https://example${rowIndex + 1}.com`;
    case "description":
      return `Sample description text for test record ${rowIndex + 1}.`;
    case "first_name":
      return pickByMix(FIRST_NAMES, rowIndex, lower, 0xf1a);
    case "last_name":
      return pickByMix(LAST_NAMES, rowIndex, lower, 0xf1b);

    // --- Enterprise/table types ---
    case "numeric_id":
      return id();
    case "date": {
      const anchor = new Date(1965 + (rowIndex % 56), rowIndex % 12, (rowIndex % 28) + 1);
      if (/\bupdated\b/.test(lower)) {
        const addDays = 1 + (rowIndex % (365 * 20));
        const next = new Date(anchor.getTime() + addDays * 86_400_000);
        return next.toISOString().slice(0, 10);
      }
      if (/\bcreated\b/.test(lower)) {
        return anchor.toISOString().slice(0, 10);
      }
      const d = new Date(2020 + (rowIndex % 4), rowIndex % 12, (rowIndex % 28) + 1);
      return d.toISOString().slice(0, 10);
    }
    case "amount": {
      if (/\bdeductible\b/.test(lower) || /\bcopay\b/.test(lower) || /\bcopayment\b/.test(lower)) {
        return withPrefix(insuranceMoneyTier(rowIndex, fieldName));
      }
      return withPrefix(genericMonetaryAmount(rowIndex, fieldName));
    }
    case "rate":
      return Math.round((r() * 0.08 + 0.02) * 10000) / 10000;
    case "term":
      return ([12, 24, 36, 48, 60] as const)[rowIndex % 5];
    case "status": {
      const opts = rule.options ?? ["Active", "Pending", "Closed", "Settled", "Approved"];
      return opts[rowIndex % opts.length];
    }
    case "enum": {
      const opts = rule.options ?? ["Option A", "Option B"];
      return opts[rowIndex % opts.length];
    }
    case "currency": {
      const opts = rule.options ?? ["USD", "EUR", "GBP"];
      return opts[rowIndex % opts.length];
    }
    case "name":
      return `${pickByMix(FIRST_NAMES, rowIndex, lower, 0xf2a)} ${pickByMix(LAST_NAMES, rowIndex, lower, 0xf2b)}`;
    case "code":
      return `BR${String(1000 + rowIndex).slice(0, 4)}`;
    case "gender": {
      const opts = rule.options ?? ["M", "F", "O"];
      return opts[rowIndex % opts.length];
    }
    case "risk": {
      const opts = rule.options ?? ["Low", "Medium", "High"];
      return opts[rowIndex % opts.length];
    }
    case "reference":
      return `REF-${Date.now().toString(36)}-${rowIndex}`;
    default:
      return withPrefix(heuristicFallbackColumnValue(fieldName, rowIndex));
  }
}
