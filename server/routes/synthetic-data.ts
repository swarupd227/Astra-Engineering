import { randomInt } from "node:crypto";
import type { Express, Request, Response } from "express";
import ai from "../ai-client";
import { hasAnthropic, hasAzureOpenAI, hasBedrock, hasAnyChatLlm } from "../llm-config";
import { llmConfig } from "../llm-config";
import {
  getDataLimits,
  getLLMBatchConfig,
  getTokenEstimateConfig,
  NUMERIC_ID_ENTITY_KEYWORDS,
  SYNTHETIC_VALUE_RULES,
  type SyntheticValueRule,
} from "../config/synthetic-data-config";
import { FIRST_NAMES, LAST_NAMES } from "../config/synthetic-name-lists";
import { INTERNATIONAL_STREETS, WORLD_LOCATION_SLOTS } from "../config/synthetic-world-locations";
import {
  PRESET_ENTITIES_ALL_DOMAINS,
  presetEntitiesForDomainKey,
  type PresetEntity,
} from "../config/synthetic-preset-entities";
import {
  heuristicFallbackColumnValue,
  insuranceMoneyTier,
} from "../config/synthetic-column-heuristics";

type TestDataRecord = Record<string, unknown>;

/** Domain key → display label. Matches client DOMAIN_CONFIG; unknown keys get a derived label. */
const DOMAIN_LABELS: Record<string, string> = {
  all: "All Domains",
  insurance: "Insurance",
  retail: "Retail",
  healthcare: "Healthcare",
  manufacturing: "Manufacturing",
  finance: "Finance",
  education: "Education",
};

/** Derive a display label from a domain key (e.g. "logistics" → "Logistics", "some-domain" → "Some domain"). */
function deriveLabelFromKey(key: string): string {
  if (!key || key === "all") return "All Domains";
  return key
    .split(/[-_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getDomainLabel(domainKey: string | undefined, domainLabel?: string): string {
  if (domainLabel && typeof domainLabel === "string" && domainLabel.trim()) return domainLabel.trim();
  if (domainKey && DOMAIN_LABELS[domainKey]) return DOMAIN_LABELS[domainKey];
  if (domainKey) return deriveLabelFromKey(domainKey);
  return "General";
}

/**
 * Extract first top-level `[` … `]` span (string-aware, JSON double quotes only).
 * Avoids regex `[\s\S]*?` stopping early on `]` inside nested arrays/objects when used naively.
 */
function extractTopLevelJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Remove trailing commas before ] or } (common invalid LLM JSON). Best-effort; may run multiple passes. */
function removeTrailingCommas(jsonLike: string): string {
  let s = jsonLike;
  for (let pass = 0; pass < 8; pass++) {
    const next = s.replace(/,(\s*[\]}])/g, "$1");
    if (next === s) break;
    s = next;
  }
  return s;
}

/**
 * Extract JSON array or object from LLM response:
 * markdown fences, leading prose, trailing commas, first balanced array slice.
 */
function parseJsonFromResponse(text: string): unknown {
  let trimmed = text.trim();
  const codeMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) {
    trimmed = codeMatch[1].trim();
  }

  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  };

  let direct = tryParse(trimmed);
  if (direct != null) return direct;

  const arraySlice = extractTopLevelJsonArray(trimmed);
  if (arraySlice) {
    direct = tryParse(arraySlice);
    if (direct != null) return direct;
    direct = tryParse(removeTrailingCommas(arraySlice));
    if (direct != null) return direct;
  }

  const objStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    const extracted = extractTopLevelJsonObject(trimmed, objStart);
    if (extracted) {
      direct = tryParse(extracted);
      if (direct != null) return direct;
      direct = tryParse(removeTrailingCommas(extracted));
      if (direct != null) return direct;
    }
  }

  const message = "Could not parse JSON from model response";
  const err = new Error(message);
  (err as any).rawSnippet = trimmed.length > 800 ? `${trimmed.slice(0, 800)}…` : trimmed;
  throw err;
}

function extractTopLevelJsonObject(text: string, startIdx: number): string | null {
  if (text[startIdx] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

/**
 * Model hint for synthetic-data LLM calls. Must route correctly through {@link ai.chat.completions.create}
 * (Anthropic Azure HTTP vs Bedrock vs Azure OpenAI SDK); that helper requires a Claude-like `model` string
 * to enable the Anthropic branch — omitting it caused silent fallback to rule-based rows.
 */
function resolveSyntheticChatModel(): string {
  if (hasBedrock) {
    return process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-4-6-v1";
  }
  if (hasAnthropic) {
    return process.env.ANTHROPIC_MODEL_NAME || "claude-3-5-sonnet-20241022";
  }
  if (hasAzureOpenAI) {
    return process.env.AZURE_OPENAI_DEPLOYMENT || llmConfig.azureOpenAIDeployment || "gpt-4o-mini";
  }
  return "gpt-4o-mini";
}

/** Chat completion via shared AI facade (Bedrock / Anthropic Azure / Azure OpenAI). */
async function llmComplete(
  messages: Array<{ role: "system" | "user"; content: string }>,
  opts?: { temperature?: number; max_tokens?: number }
): Promise<string> {
  const response = await ai.chat.completions.create({
    model: resolveSyntheticChatModel(),
    messages,
    max_tokens: opts?.max_tokens ?? 8000,
    temperature: opts?.temperature ?? 0.35,
  } as Parameters<(typeof ai)["chat"]["completions"]["create"]>[0]);
  const content = (response as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
    ?.content;
  if (typeof content !== "string") throw new Error("LLM returned no text");
  return content;
}

/** Normalize column labels so LLM snake_case keys match preset "Display Name" keys. */
function normalizePresetFieldKey(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[\s\-_.]+/g, "");
}

/**
 * Copy LLM row values onto exact preset keys (models often return snake_case or wrong casing).
 * Returns null if any selected column is missing or blank after normalization.
 */
function alignPresetLlmRow(row: TestDataRecord, selectedFields: string[]): TestDataRecord | null {
  const byNorm = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    byNorm.set(normalizePresetFieldKey(k), v);
  }
  const out: TestDataRecord = {};
  for (const f of selectedFields) {
    let v: unknown = row[f];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      v = byNorm.get(normalizePresetFieldKey(f));
    }
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      return null;
    }
    out[f] = v;
  }
  return out;
}

/** Take first N raw LLM objects that align to preset columns; otherwise return null. */
function tryAlignPresetLlmBatch(
  rawRows: TestDataRecord[],
  selectedFields: string[],
  batchSize: number
): TestDataRecord[] | null {
  const aligned: TestDataRecord[] = [];
  for (const raw of rawRows) {
    const row = alignPresetLlmRow(raw, selectedFields);
    if (!row) return null;
    aligned.push(row);
    if (aligned.length >= batchSize) break;
  }
  return aligned.length === batchSize ? aligned : null;
}

export type RelatedEntitySpec = { key: string; label?: string; fields: string[] };

/** Suggest related entity types and their fields for a domain/entity (LLM or fallback). */
async function suggestRelatedEntitiesForEntity(
  domainKey: string,
  domainLabel: string,
  entityLabel: string
): Promise<RelatedEntitySpec[]> {
  if (hasAnyChatLlm()) {
    try {
      const systemPrompt = `You are an expert in enterprise data. Given a domain and main entity, suggest 3-6 related entity types that would be linked (e.g. customers, agents, products). For each return: key (snake_case identifier), label (short display name), and fields (array of 4-8 column names). Output only valid JSON: { "related": [ { "key": "...", "label": "...", "fields": ["Col1", "Col2", ...] }, ... ] }. No markdown.`;
      const userPrompt = `Domain: ${domainLabel}. Main entity: ${entityLabel}. Suggest 3-6 related entity types with their field names. Return only the JSON object.`;
      const content = await llmComplete([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);
      const parsed = parseJsonFromResponse(content) as { related?: RelatedEntitySpec[] };
      const raw = Array.isArray(parsed?.related) ? parsed.related : [];
      return raw
        .filter(
          (e): e is RelatedEntitySpec =>
            e != null && typeof e === "object" && typeof (e as any).key === "string" && Array.isArray((e as any).fields)
        )
        .map((e) => ({
          key: String((e as any).key).replace(/\s+/g, "_").toLowerCase() || "related",
          label: typeof (e as any).label === "string" ? (e as any).label : undefined,
          fields: (e as any).fields.map((f: unknown) => String(f)).filter(Boolean),
        }))
        .filter((e) => e.fields.length > 0);
    } catch {
      // fall through to fallback
    }
  }
  return [
    { key: "related", label: "Related", fields: ["ID", "Name", "Status", "Created At"] },
  ];
}

/**
 * LLM calls are chunked (default 40 rows per batch). Without a global row range, each batch gets the same
 * instructions and models often repeat the same names/IDs — looks like "repetition every 40 rows".
 */
function llmBatchUniquenessHint(
  batchIndex: number,
  batchSize: number,
  llmBatchSize: number,
  batchCount: number,
  totalRows: number
): string {
  const g0 = batchIndex * llmBatchSize;
  const gLast = Math.min(g0 + batchSize, totalRows) - 1;
  return (
    ` [Segment ${batchIndex + 1} of ${batchCount}; output rows ${g0 + 1}–${gLast + 1} of ${totalRows} overall. ` +
    `These rows must NOT duplicate names, emails, phones, addresses, or primary identifiers from other segments — vary everything; use this segment index to diversify IDs and text.]`
  );
}

/** Generate preset records using LLM (batches run in parallel for speed). */
async function generatePresetDataWithLLM(options: {
  domain?: string;
  entity?: string;
  selectedFields: string[];
  recordCount: number;
  columnsToPrefix?: Record<string, string>;
  includeDependencies?: boolean;
  relatedEntities?: RelatedEntitySpec[];
}): Promise<{ records: TestDataRecord[]; related: Record<string, TestDataRecord[]>; mainUsedLlm: boolean }> {
  const { domain, entity, selectedFields, recordCount, columnsToPrefix, includeDependencies, relatedEntities } = options;
  const { batchSize: LLM_BATCH_SIZE, maxRecords: MAX_LLM_RECORDS } = getLLMBatchConfig();
  const fieldsStr = JSON.stringify(selectedFields);
  const fieldsHuman = selectedFields.join(", ");
  const systemPrompt =
    "You are a synthetic QA test data generator. Respond with RFC 8259 JSON only: a single array of objects. " +
    "Use double-quoted keys and values. No markdown fences, no commentary. " +
    "Every object MUST expose a value for each requested column. Names must be plausible fictional people/places/companies — vary cultures and spellings; do not reuse the same full name twice in one batch. " +
    "Match columns by meaning if needed: you may use snake_case keys in JSON as long as each maps cleanly to one requested column (e.g. policy_holder_name ↔ Policy Holder Name).";
  const totalToGenerate = Math.min(recordCount, MAX_LLM_RECORDS);
  const batchCount = Math.ceil(totalToGenerate / LLM_BATCH_SIZE);
  const concurrency = Math.max(1, Math.min(32, parseInt(process.env.SYNTHETIC_DATA_LLM_CONCURRENCY ?? "12", 10) || 12));
  const fallbackRowSalt = randomInt(250_000, 2_100_000_000);

  const runPresetBatch = async (b: number): Promise<{ rows: TestDataRecord[]; fromLlm: boolean }> => {
    const batchSize = Math.min(LLM_BATCH_SIZE, totalToGenerate - b * LLM_BATCH_SIZE);
    if (batchSize <= 0) return { rows: [], fromLlm: false };
    const prefixInstruction = columnsToPrefix && Object.keys(columnsToPrefix).length > 0
      ? ` For these specific fields, prepend the following prefixes: ${JSON.stringify(columnsToPrefix)}.`
      : "";
    const userPrompt =
      `Generate exactly ${batchSize} synthetic records as one JSON array (length ${batchSize}). ` +
      `Domain: ${domain || "general"}. Entity: ${entity || "data"}. ` +
      `Columns (each row MUST cover every column — match these labels semantically; spelling can be snake_case): ${fieldsHuman}. ` +
      `Canonical JSON column hints (same order): ${fieldsStr}.${prefixInstruction}${llmBatchUniquenessHint(b, batchSize, LLM_BATCH_SIZE, batchCount, totalToGenerate)} ` +
      `Return only the JSON array.`;
    try {
      const content = await llmComplete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.82, max_tokens: 8192 }
      );
      try {
        const parsed = parseJsonFromResponse(content);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        const rawRows = arr.filter(
          (row): row is TestDataRecord => row != null && typeof row === "object" && !Array.isArray(row)
        ) as TestDataRecord[];
        const aligned = tryAlignPresetLlmBatch(rawRows, selectedFields, batchSize);
        if (!aligned) {
          console.warn(
            `[generatePresetDataWithLLM] Could not align ${batchSize} rows to preset columns for batch ${b} (got ${rawRows.length} raw objects); using salted synthetic fallback.`
          );
          return {
            rows: fallbackLlmBatchToSyntheticRows(
              selectedFields,
              b,
              batchSize,
              LLM_BATCH_SIZE,
              columnsToPrefix,
              fallbackRowSalt
            ),
            fromLlm: false,
          };
        }
        return { rows: aligned, fromLlm: true };
      } catch (err) {
        console.warn(
          `[generatePresetDataWithLLM] Invalid JSON from model for batch ${b}; using salted synthetic fallback.`,
          err instanceof Error ? err.message : err
        );
        return {
          rows: fallbackLlmBatchToSyntheticRows(
            selectedFields,
            b,
            batchSize,
            LLM_BATCH_SIZE,
            columnsToPrefix,
            fallbackRowSalt
          ),
          fromLlm: false,
        };
      }
    } catch (err) {
      console.warn(
        `[generatePresetDataWithLLM] LLM request failed for batch ${b}; using salted synthetic fallback.`,
        err instanceof Error ? err.message : err
      );
      return {
        rows: fallbackLlmBatchToSyntheticRows(
          selectedFields,
          b,
          batchSize,
          LLM_BATCH_SIZE,
          columnsToPrefix,
          fallbackRowSalt
        ),
        fromLlm: false,
      };
    }
  };

  const batchResults: Array<{ rows: TestDataRecord[]; fromLlm: boolean }> = [];
  for (let start = 0; start < batchCount; start += concurrency) {
    const slice: Promise<{ rows: TestDataRecord[]; fromLlm: boolean }>[] = [];
    for (let b = start; b < Math.min(start + concurrency, batchCount); b++) {
      slice.push(runPresetBatch(b));
    }
    batchResults.push(...(await Promise.all(slice)));
  }
  const records = batchResults.flatMap((br) => br.rows);
  const mainUsedLlm = batchResults.some((br) => br.fromLlm);

  const related: Record<string, TestDataRecord[]> = {};
  const specs = relatedEntities && relatedEntities.length > 0 ? relatedEntities : [];
  if (includeDependencies && specs.length > 0) {
    const count = Math.min(50, Math.max(records.length, 10));
    const relatedPromises = specs.map(async (spec) => {
      const cols = spec.fields;
      const sys = `You output only a valid JSON array of objects. No markdown. Use exact key names.`;
      const usr = `Generate ${count} synthetic records as a JSON array. Each object must have keys: ${JSON.stringify(cols)}. Return only the JSON array.`;
      try {
        const content = await llmComplete([{ role: "system", content: sys }, { role: "user", content: usr }]);
        const parsed = parseJsonFromResponse(content);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        return [spec.key, arr.filter((r): r is TestDataRecord => r != null && typeof r === "object" && !Array.isArray(r))] as const;
      } catch {
        return [spec.key, []] as const;
      }
    });
    const relatedResults = await Promise.all(relatedPromises);
    relatedResults.forEach(([key, arr]) => { related[key] = [...arr]; });
  }
  return { records, related, mainUsedLlm };
}

/** Generate one table's records using LLM (batches run in parallel). */
async function generateTableDataWithLLM(
  tableName: string,
  columns: Array<{ name: string; type?: string }>,
  recordCount: number,
  columnsToPrefix?: Record<string, string>
): Promise<TestDataRecord[]> {
  const { batchSize: LLM_BATCH_SIZE, maxRecords: MAX_LLM_RECORDS } = getLLMBatchConfig();
  const colNames = columns.map((c) => c.name);
  const systemPrompt = `You are a synthetic test data generator for relational data. Schemas are often uploaded from SQL (.sql DDL with CREATE TABLE); the API sends column names as structured data, not a JSON schema document for you to echo back. Respond with RFC 8259–compliant JSON only: a single array of objects. Use double quotes for all keys and string values. No trailing commas. No comments, markdown, or SQL. No NaN or Infinity—use strings or null if needed. Each object uses exactly the column names given. Realistic fake values only. When the user message indicates multiple segments, each segment must use different names, emails, phones, and IDs than other segments — never repeat the same list of example rows across segments.`;
  const total = Math.min(recordCount, MAX_LLM_RECORDS);
  const batchCount = Math.ceil(total / LLM_BATCH_SIZE);
  const concurrency = Math.max(1, Math.min(32, parseInt(process.env.SYNTHETIC_DATA_LLM_CONCURRENCY ?? "12", 10) || 12));

  const runOneBatch = async (b: number): Promise<TestDataRecord[]> => {
    const batchSize = Math.min(LLM_BATCH_SIZE, total - b * LLM_BATCH_SIZE);
    if (batchSize <= 0) return [];
    const prefixInstruction = columnsToPrefix && Object.keys(columnsToPrefix).length > 0
      ? ` For these specific fields, prepend the following prefixes: ${JSON.stringify(columnsToPrefix)}.`
      : "";
    const userPrompt = `Table name (as in the user's .sql / relational schema): "${tableName}". Column names (from CREATE TABLE or equivalent): ${JSON.stringify(colNames)}. Generate exactly ${batchSize} synthetic data rows. Return one JSON array only [...] with ${batchSize} objects. Property names must match the column names exactly (double-quoted). No extra text before or after the array.${prefixInstruction}${llmBatchUniquenessHint(b, batchSize, LLM_BATCH_SIZE, batchCount, total)}`;
    return llmComplete([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }])
      .then((content) => {
        try {
          const parsed = parseJsonFromResponse(content);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          return arr.filter((row): row is TestDataRecord => row != null && typeof row === "object" && !Array.isArray(row)) as TestDataRecord[];
        } catch (err) {
          console.warn(
            `[generateTableDataWithLLM] Invalid JSON from model for table "${tableName}" batch ${b}; using deterministic synthetic values.`,
            err instanceof Error ? err.message : err
          );
          return fallbackLlmBatchToSyntheticRows(colNames, b, batchSize, LLM_BATCH_SIZE, columnsToPrefix);
        }
      })
      .catch((err) => {
        console.warn(
          `[generateTableDataWithLLM] LLM request failed for table "${tableName}" batch ${b}; using deterministic synthetic values.`,
          err instanceof Error ? err.message : err
        );
        return fallbackLlmBatchToSyntheticRows(colNames, b, batchSize, LLM_BATCH_SIZE, columnsToPrefix);
      });
  };

  const batchResults: TestDataRecord[][] = [];
  for (let start = 0; start < batchCount; start += concurrency) {
    const slice: Promise<TestDataRecord[]>[] = [];
    for (let b = start; b < Math.min(start + concurrency, batchCount); b++) {
      slice.push(runOneBatch(b));
    }
    batchResults.push(...(await Promise.all(slice)));
  }
  return batchResults.flat();
}

const SYNTHETIC_DOMAINS = [
  "example.com", "testmail.org", "sample.net", "demo.io", "fakecorp.com", "mail.test", "inbox.dev", "sandbox.email",
  "demo.co.in", "samplemail.in",
] as const;
const SYNTHETIC_TLDS = ["com", "net", "org", "io", "co", "app", "dev", "in"] as const;

type SyntheticLocation = {
  city: string;
  stateAbbr: string;
  country: string;
  streetNum: number;
  street: string;
  zip: string;
};

/** CamelCase / snake_case → word tokens for column-name semantics (avoids matching "state" inside "statement"). */
function splitFieldNameTokens(lower: string): string[] {
  const spaced = lower.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-\.]+/g, " ").trim();
  return spaced.split(/\s+/).filter(Boolean);
}

/** Rule pattern match; `id` is token-based so columns like "valid" do not hit numeric_id. */
function columnMatchesPattern(lower: string, pattern: string): boolean {
  if (pattern === "id") {
    const tokens = splitFieldNameTokens(lower);
    return tokens.some((w) => w === "id") || lower.endsWith("_id");
  }
  return lower.includes(pattern);
}

/** Business/document identifiers — should not fall back to account-style masking when user toggles Mask. */
function isLikelyNonPiiBusinessKey(columnName: string): boolean {
  const lower = columnName.toLowerCase();
  const tokens = splitFieldNameTokens(lower);
  if (tokens.includes("phone") || tokens.includes("mobile") || tokens.includes("fax")) return false;
  if ((tokens.includes("account") || tokens.includes("acct")) && (tokens.includes("number") || /\bnumber\b/.test(lower)))
    return false;
  if (/\brouting\b/.test(lower) || /\biban\b/.test(lower) || /\bswift\b/.test(lower)) return false;
  if (/\bcard\b/.test(lower) && /\bnumber\b/.test(lower)) return false;
  if (/\bssn\b/.test(lower) || /\bsocial\b/.test(lower)) return false;
  if (tokens.includes("id")) return true;
  if (
    /\b(invoice|policy|order|claim|ticket|confirmation|reference|tracking|license|plate|vin|transaction|batch)\b/.test(
      lower
    ) &&
    (/\bnumber\b/.test(lower) || tokens.includes("num"))
  ) {
    return true;
  }
  if ((/\bpo\b/.test(lower) || /\bpurchase\s+order\b/.test(lower)) && /\bnumber\b/.test(lower)) return true;
  return false;
}

/** Stable 32-bit mix of row index + field name + salt — avoids short cycles from rowIndex % N. */
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
  return arr[fieldMix(rowIndex, fieldKey, salt) % arr.length] as T;
}

function mixUnit(rowIndex: number, fieldKey: string, salt: number): number {
  return (fieldMix(rowIndex, fieldKey, salt) % 1_000_000) / 1_000_000;
}

/** One coherent international place per row (India, Americas, EU, Asia-Pacific, Africa, etc.). */
function locationSeed(rowIndex: number): SyntheticLocation {
  const slot = pickByMix(WORLD_LOCATION_SLOTS, rowIndex, "__loc_city__", 0x7c01);
  const streetNum = 1 + (fieldMix(rowIndex, "__loc__", 0x7c03) % 9999);
  const street = pickByMix(INTERNATIONAL_STREETS, rowIndex, "__loc_st__", 0x7c04);
  return {
    city: slot.city,
    stateAbbr: slot.region,
    country: slot.country,
    streetNum,
    street,
    zip: slot.postal,
  };
}

function isFirstOnlyNameField(lower: string): boolean {
  if (/\b(first_name|fname|givenname|firstname)\b/.test(lower)) return true;
  if (/\bfirst[\s_]?name\b/.test(lower)) return true;
  if (lower === "fname" || lower === "given") return true;
  return lower.includes("first") && lower.includes("name") && !lower.includes("last");
}

function isLastOnlyNameField(lower: string): boolean {
  if (/\b(last_name|lname|surname|lastname)\b/.test(lower)) return true;
  if (/\blast[\s_]?name\b/.test(lower)) return true;
  if (lower === "lname" || lower === "surname") return true;
  return lower.includes("last") && lower.includes("name") && !lower.includes("first");
}

/** Config-driven deterministic value by field name and row index. */
function syntheticValue(fieldName: string, rowIndex: number, columnsToPrefix?: Record<string, string>): string | number | boolean {
  const prefix = columnsToPrefix?.[fieldName];
  const id = (): number => (parseInt((prefix || "").replace(/\D/g, "").slice(0, 4) || "0", 10) * 10000) + rowIndex + 1;
  const lower = fieldName.toLowerCase();

  const applyPrefix = (val: string | number | boolean): string | number | boolean => {
    if (!prefix) return val;
    if (typeof val === "boolean") return val;
    return `${prefix}${val}`;
  };

  const fieldTokens = splitFieldNameTokens(lower);
  const hasCountryToken = fieldTokens.some((w) => w === "country" || w === "countries" || w === "nation");
  const hasStateToken = fieldTokens.some((w) => w === "state" || w === "states" || w === "province");
  const loc = locationSeed(rowIndex);

  if (hasCountryToken) {
    return applyPrefix(loc.country);
  }
  if (hasStateToken) {
    return applyPrefix(loc.stateAbbr);
  }

  const syntheticDocumentNumber = (): string | null => {
    if (!/\bnumber\b/.test(lower) && !fieldTokens.includes("num")) return null;
    if (/\baccount\b/.test(lower) || /\bacct\b/.test(lower)) return null;
    if (/\brouting\b/.test(lower) || /\biban\b/.test(lower) || /\bswift\b/.test(lower)) return null;
    if (/\bcard\b/.test(lower)) return null;
    if (/\bphone\b/.test(lower) || /\bmobile\b/.test(lower) || /\bfax\b/.test(lower)) return null;
    const year = 2019 + (fieldMix(rowIndex, lower, 0xdbc0) % 8);
    const seq = 100000 + (fieldMix(rowIndex, lower, 0xdbc1) % 900000);
    if (/\binvoice\b/.test(lower)) return `INV-${year}-${seq}`;
    if (/\bpolicy\b/.test(lower)) return `POL-${year}-${seq}`;
    if (/\border\b/.test(lower)) return `ORD-${year}-${seq}`;
    if (/\bclaim\b/.test(lower)) return `CLM-${year}-${seq}`;
    if (/\bticket\b/.test(lower)) return `TKT-${year}-${seq}`;
    if (/\btracking\b/.test(lower)) return `TRK-${year}-${seq}-${fieldMix(rowIndex, lower, 0xdbc2).toString(36).toUpperCase().slice(0, 4)}`;
    if (/\bpo\b/.test(lower) || /\bpurchase\s+order\b/.test(lower)) return `PO-${year}-${seq}`;
    if (/\bconfirmation\b/.test(lower)) return `CNF-${year}-${seq}`;
    if (/\breference\b/.test(lower)) return `REF-${year}-${seq}`;
    return `DOC-${year}-${seq}`;
  };
  const docNo = syntheticDocumentNumber();
  if (docNo !== null) return applyPrefix(docNo);

  const firstN = (): string => pickByMix(FIRST_NAMES, rowIndex, lower, 0xa11);
  const lastN = (): string => pickByMix(LAST_NAMES, rowIndex, lower, 0xb22);
  const fullName = (): string => `${firstN()} ${lastN()}`;

  const piiType = getPiiType(lower);
  if (piiType) {
    switch (piiType) {
      case "name": {
        if (isFirstOnlyNameField(lower)) return applyPrefix(firstN());
        if (isLastOnlyNameField(lower)) return applyPrefix(lastN());
        return applyPrefix(fullName());
      }
      case "email": {
        const dom = pickByMix(SYNTHETIC_DOMAINS, rowIndex, lower, 0xe01);
        const local = `u${fieldMix(rowIndex, lower, 0xe02).toString(36)}${rowIndex}_${fieldMix(rowIndex, lower, 0xe03).toString(36).slice(0, 10)}`;
        return applyPrefix(`${local}@${dom}`);
      }
      case "phone": {
        const area = String(200 + (fieldMix(rowIndex, lower, 0xf01) % 799)).padStart(3, "0");
        const exch = String(200 + (fieldMix(rowIndex, lower, 0xf02) % 799)).padStart(3, "0");
        const line = String(1000 + (fieldMix(rowIndex, lower, 0xf03) % 9000)).padStart(4, "0");
        return applyPrefix(`+1-${area}-${exch}-${line}`);
      }
      case "ssn": {
        const a = String(1 + (fieldMix(rowIndex, lower, 0x501) % 899)).padStart(3, "0");
        const b = String(1 + (fieldMix(rowIndex, lower, 0x502) % 99)).padStart(2, "0");
        const c = String(1 + (fieldMix(rowIndex, lower, 0x503) % 9999)).padStart(4, "0");
        return applyPrefix(`${a}-${b}-${c}`);
      }
      case "address": {
        return applyPrefix(`${loc.streetNum} ${loc.street}, ${loc.city}, ${loc.stateAbbr}`);
      }
      case "card": {
        const p1 = 4000 + (fieldMix(rowIndex, lower, 0xc01) % 1000);
        const p2 = fieldMix(rowIndex, lower, 0xc02) % 10000;
        const p3 = fieldMix(rowIndex, lower, 0xc03) % 10000;
        const p4 = fieldMix(rowIndex, lower, 0xc04) % 10000;
        return applyPrefix(
          `${p1}-${String(p2).padStart(4, "0")}-${String(p3).padStart(4, "0")}-${String(p4).padStart(4, "0")}`
        );
      }
      case "dob": {
        const year = 1940 + (fieldMix(rowIndex, lower, 0xd01) % 65);
        const month = 1 + (fieldMix(rowIndex, lower, 0xd02) % 12);
        const dim = new Date(year, month, 0).getDate();
        const day = 1 + (fieldMix(rowIndex, lower, 0xd03) % dim);
        const mo = String(month).padStart(2, "0");
        const da = String(day).padStart(2, "0");
        return applyPrefix(`${year}-${mo}-${da}`);
      }
      case "ip":
        return applyPrefix(
          `10.${fieldMix(rowIndex, lower, 0x101) % 256}.${fieldMix(rowIndex, lower, 0x102) % 256}.${fieldMix(rowIndex, lower, 0x103) % 256}`
        );
      case "account":
        return applyPrefix(
          `ACC${fieldMix(rowIndex, lower, 0xac1).toString(16).toUpperCase().slice(0, 8)}${rowIndex}`
        );
      case "password":
        return applyPrefix(`Pw!${fieldMix(rowIndex, lower, 0x701).toString(36)}x${rowIndex}Z`);
    }
  }
  // ── Generic rule matching ─────────────────────────────────────────────────

  const rule = SYNTHETIC_VALUE_RULES.find((ru) => {
    if (ru.pattern === "default") return false;
    if (!columnMatchesPattern(lower, ru.pattern)) return false;
    if (ru.type === "numeric_id") {
      return (
        NUMERIC_ID_ENTITY_KEYWORDS.some((k) => lower.includes(k)) ||
        splitFieldNameTokens(lower).some((w) => w === "id") ||
        lower.endsWith("_id")
      );
    }
    return true;
  }) as SyntheticValueRule | undefined;

  if (!rule) return applyPrefix(heuristicFallbackColumnValue(fieldName, rowIndex));

  switch (rule.type) {
    case "numeric_id":
      return applyPrefix(id());
    case "date": {
      const anchorY = 1965 + (fieldMix(rowIndex, "__date_row__", 0x701) % 56);
      const anchorM = fieldMix(rowIndex, "__date_row__", 0x702) % 12;
      const dimA = new Date(anchorY, anchorM + 1, 0).getDate();
      const anchorD = 1 + (fieldMix(rowIndex, "__date_row__", 0x703) % dimA);
      const anchor = new Date(anchorY, anchorM, anchorD);
      const anchorIso = (): string => anchor.toISOString().slice(0, 10);

      if (/\bupdated\b/.test(lower)) {
        const addDays = 1 + (fieldMix(rowIndex, lower, 0x704) % (365 * 25));
        const next = new Date(anchor.getTime() + addDays * 86_400_000);
        return applyPrefix(next.toISOString().slice(0, 10));
      }
      if (/\bcreated\b/.test(lower)) {
        return applyPrefix(anchorIso());
      }

      const y = 1965 + (fieldMix(rowIndex, lower, 0x705) % 56);
      const m = fieldMix(rowIndex, lower, 0x706) % 12;
      const dim = new Date(y, m + 1, 0).getDate();
      const d = 1 + (fieldMix(rowIndex, lower, 0x707) % dim);
      const dt = new Date(y, m, d);
      return applyPrefix(dt.toISOString().slice(0, 10));
    }
    case "amount": {
      if (/\bdeductible\b/.test(lower) || /\bcopay\b/.test(lower) || /\bcopayment\b/.test(lower)) {
        return applyPrefix(insuranceMoneyTier(rowIndex, fieldName));
      }
      return applyPrefix(Math.round((mixUnit(rowIndex, lower, 0x801) * 90000 + 1000) * 100) / 100);
    }
    case "rate":
      return applyPrefix(Math.round((mixUnit(rowIndex, lower, 0x802) * 0.08 + 0.02) * 10000) / 10000);
    case "term":
      return applyPrefix(pickByMix([12, 24, 36, 48, 60] as const, rowIndex, lower, 0x803));
    case "status": {
      const opts = rule.options ?? ["Active", "Pending", "Closed", "Settled", "Approved"];
      return applyPrefix(pickByMix(opts, rowIndex, lower, 0x804));
    }
    case "enum": {
      const opts = rule.options ?? ["Option A", "Option B"];
      return applyPrefix(pickByMix(opts, rowIndex, lower, 0x805));
    }
    case "currency": {
      const opts = rule.options ?? ["USD", "EUR", "GBP"];
      return applyPrefix(pickByMix(opts, rowIndex, lower, 0x806));
    }
    case "name":
      return applyPrefix(fullName());
    case "first_name":
      return applyPrefix(firstN());
    case "last_name":
      return applyPrefix(lastN());
    case "email": {
      const dom = pickByMix(SYNTHETIC_DOMAINS, rowIndex, lower, 0xe11);
      const local = `u${fieldMix(rowIndex, lower, 0xe12).toString(36)}${rowIndex}_${fieldMix(rowIndex, lower, 0xe13).toString(36).slice(0, 10)}`;
      return applyPrefix(`${local}@${dom}`);
    }
    case "password":
      return applyPrefix(`Pw!${fieldMix(rowIndex, lower, 0x711).toString(36)}x${rowIndex}Z`);
    case "phone": {
      const area = String(200 + (fieldMix(rowIndex, lower, 0xf11) % 799)).padStart(3, "0");
      const exch = String(200 + (fieldMix(rowIndex, lower, 0xf12) % 799)).padStart(3, "0");
      const line = String(1000 + (fieldMix(rowIndex, lower, 0xf13) % 9000)).padStart(4, "0");
      return applyPrefix(`+1-${area}-${exch}-${line}`);
    }
    case "address": {
      return applyPrefix(`${loc.streetNum} ${loc.street}, ${loc.city}, ${loc.stateAbbr}`);
    }
    case "city":
      return applyPrefix(loc.city);
    case "zip":
      return applyPrefix(loc.zip);
    case "username":
      return applyPrefix(`user_${fieldMix(rowIndex, lower, 0xb01).toString(36)}_${rowIndex}`);
    case "search":
      return applyPrefix(`query ${fieldMix(rowIndex, lower, 0xb02).toString(36)} ${rowIndex}`);
    case "url": {
      const host = `example.${pickByMix(SYNTHETIC_TLDS, rowIndex, lower, 0xb03)}`;
      return applyPrefix(`https://${host}/p/${fieldMix(rowIndex, lower, 0xb04).toString(16)}/${rowIndex}`);
    }
    case "description":
      return applyPrefix(
        `Synthetic description #${rowIndex + 1} (ref ${fieldMix(rowIndex, lower, 0xb05).toString(16).toUpperCase()}).`
      );
    case "code": {
      const n = 100000 + (fieldMix(rowIndex, lower, 0xcd1) % 900000);
      return applyPrefix(`BR${String(n)}`);
    }
    case "gender": {
      const opts = rule.options ?? ["M", "F", "O"];
      return applyPrefix(pickByMix(opts, rowIndex, lower, 0x807));
    }
    case "risk": {
      const opts = rule.options ?? ["Low", "Medium", "High"];
      return applyPrefix(pickByMix(opts, rowIndex, lower, 0x808));
    }
    case "reference":
      return applyPrefix(`REF-${fieldMix(rowIndex, lower, 0x909).toString(16).toUpperCase()}-${rowIndex}`);
    default:
      return applyPrefix(heuristicFallbackColumnValue(fieldName, rowIndex));
  }
}

function fallbackLlmBatchToSyntheticRows(
  fieldNames: string[],
  batchIndex: number,
  batchSize: number,
  llmBatchSize: number,
  columnsToPrefix?: Record<string, string>,
  /** Offsets row indices so AI-request fallback ≠ deterministic preset rows (same pool, different picks). */
  rowOffsetSalt = 0
): TestDataRecord[] {
  const rows: TestDataRecord[] = [];
  for (let r = 0; r < batchSize; r++) {
    const rowIndex = batchIndex * llmBatchSize + r + rowOffsetSalt;
    const row: TestDataRecord = {};
    for (const name of fieldNames) {
      row[name] = syntheticValue(name, rowIndex, columnsToPrefix);
    }
    rows.push(row);
  }
  return rows;
}


/** Generate preset-entity records and optional related sheets. */
function generatePresetData(options: {
  selectedFields: string[];
  recordCount: number;
  dataPrefix?: string;
  columnsToPrefix?: Record<string, string>;
  includeDependencies?: boolean;
  entityLabel?: string;
  relatedEntities?: RelatedEntitySpec[];
}): { records: TestDataRecord[]; related: Record<string, TestDataRecord[]> } {
  const { selectedFields, recordCount, columnsToPrefix, includeDependencies, relatedEntities } = options;
  const records: TestDataRecord[] = [];
  for (let i = 0; i < recordCount; i++) {
    const row: TestDataRecord = {};
    for (const field of selectedFields) {
      row[field] = syntheticValue(field, i, columnsToPrefix);
    }
    records.push(row);
  }
  const related: Record<string, TestDataRecord[]> = {};
  const specs = relatedEntities && relatedEntities.length > 0 ? relatedEntities : [];
  if (includeDependencies && specs.length > 0) {
    const count = Math.min(100, Math.max(recordCount, 20));
    for (const spec of specs) {
      const fields = spec.fields.length > 0 ? spec.fields : ["ID", "Name"];
      const arr: TestDataRecord[] = [];
      for (let i = 0; i < count; i++) {
        const row: TestDataRecord = {};
        for (const f of fields) row[f] = syntheticValue(f, i, columnsToPrefix);
        arr.push(row);
      }
      related[spec.key] = arr;
    }
  }
  return { records, related };
}

type PiiType = "email" | "phone" | "ssn" | "name" | "address" | "card" | "dob" | "ip" | "account" | "password" | null;

function getPiiType(columnName: string): PiiType {
  if (!columnName) return null;
  // Handle camelCase (firstName -> first Name) before normalizing separators
  const spaced = columnName.replace(/([a-z])([A-Z])/g, '$1 $2');
  const norm = spaced.toLowerCase().replace(/[_\-\.]+/g, " ").trim();
  // Split into individual tokens for exact-token checks
  const tokens = norm.split(/\s+/);
  const has = (...words: string[]) => words.some(w => tokens.includes(w));

  if (/email/.test(norm)) return "email";
  if (has("phone", "mobile", "cell", "fax", "tel", "contact") || /phone|mobile|contact/.test(norm)) return "phone";
  if (has("ssn") || (has("social") && has("security", "sec"))) return "ssn";
  if (has("password", "passwd", "pwd", "passphrase") || /password|passwd/.test(norm)) return "password";
  if (((has("credit", "debit") && has("card")) || has("pan") || /\bcard\b/.test(norm)) && !has("type", "status", "network", "brand", "issuer", "provider", "name", "holder")) return "card";
  if (has("dob") || (has("date") && has("birth")) || (has("birth") && has("date"))) return "dob";
  if (has("ip") && !has("zip", "tip", "slip")) return "ip";
  if (has("address", "street", "addr", "location") || /address|street|location/.test(norm)) return "address";
  // account only if NOT just an ID/status/type (e.g. account_id → numeric, account_number → account)
  if ((has("account", "acct")) && !has("id", "status", "type")) return "account";
  if (has("name") || (has("first", "last", "full", "middle") && tokens.some(t => t === "name"))) return "name";
  return null;
}

function isPiiColumn(name: string): boolean {
  return getPiiType(name) !== null;
}

/** Fallback value-based detection for when column names (like "Contact Info") obscure the PII type. */
function guessPiiTypeFromValue(value: unknown): PiiType {
  if (typeof value !== "string" || !value) return null;
  const v = value.trim();
  // Email check
  if (/[\w.+\-]+@[\w.+\-]+\.[a-zA-Z]{2,}/.test(v)) return "email";
  // Phone check (allows standard US (555) 123-4567 or Intl +44)
  if (/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(v)) return "phone";
  // SSN check (XXX-XX-XXXX)
  if (/\d{3}-\d{2}-\d{4}/.test(v)) return "ssn";
  // IPv4 check
  if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(v)) return "ip";
  // Card check (4111-1111-1111-1234)
  if (/\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}/.test(v)) return "card";
  return null;
}

/** Apply type-aware PII masking that preserves partial data for usability. */
function maskPiiValue(value: unknown, piiType: PiiType, piiTypesToMask?: string[]): unknown {
  if (piiType === null || value == null) return value;

  if (Array.isArray(value)) {
    return value.map((v) => maskPiiValue(v, piiType, piiTypesToMask));
  }

  if (typeof value === "object" && value !== null) {
    const maskedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Pass parent type down unless we want to do strict inference
      maskedObj[k] = maskPiiValue(v, piiType, piiTypesToMask);
    }
    return maskedObj;
  }

  const str = String(value);
  if (!str || str.length === 0) return value;

  if (piiTypesToMask && !piiTypesToMask.includes(piiType)) {
    return value;
  }

  switch (piiType) {
    case "email": {
      // j***@example.com — show first char of local + full domain
      const atIndex = str.indexOf("@");
      if (atIndex > 0) {
        const local = str.slice(0, atIndex);
        const domain = str.slice(atIndex);
        return local[0] + "***" + domain;
      }
      return str[0] + "***@***.com";
    }
    case "phone": {
      // ***-***-1234 — show last 4 digits
      const digits = str.replace(/\D/g, "");
      if (digits.length >= 4) {
        return "***-***-" + digits.slice(-4);
      }
      return "***-***-" + digits;
    }
    case "ssn": {
      // ***-**-1234 — show last 4 digits
      const digits = str.replace(/\D/g, "");
      if (digits.length >= 4) {
        return "***-**-" + digits.slice(-4);
      }
      return "***-**-" + str.slice(-2);
    }
    case "name": {
      // "Jo*** Do***" — show first 2 chars of each word
      const words = str.split(/\s+/);
      return words
        .map((w) => (w.length <= 2 ? w : w.slice(0, 2) + "***"))
        .join(" ");
    }
    case "address": {
      // "*** Main St, Ci***" — mask house number, partial city
      const parts = str.split(/,\s*/);
      return parts
        .map((part, i) => {
          const words = part.trim().split(/\s+/);
          if (i === 0 && words.length > 1) {
            // mask first word (house number), keep street type
            return "***" + " " + words.slice(1).map((w) => (w.length <= 3 ? w : w.slice(0, 3) + "***")).join(" ");
          }
          return words.map((w) => (w.length <= 2 ? w : w.slice(0, 2) + "***")).join(" ");
        })
        .join(", ");
    }
    case "card": {
      const alnum = str.match(/[a-zA-Z0-9]/g) || [];
      const visibleCount = alnum.length > 6 ? 4 : Math.max(1, Math.floor(alnum.length / 2));
      let visibleLeft = visibleCount;
      const chars = str.split("");
      for (let i = chars.length - 1; i >= 0; i--) {
        if (/[a-zA-Z0-9]/.test(chars[i])) {
          if (visibleLeft > 0) {
            visibleLeft--;
          } else {
            chars[i] = "*";
          }
        }
      }
      return chars.join("");
    }
    case "dob": {
      // **/**/1990 — mask day and month, show year
      const yearMatch = str.match(/(\d{4})/);
      if (yearMatch) {
        return "**/**/" + yearMatch[1];
      }
      return "**/**/" + str.slice(-4);
    }
    case "ip": {
      // 192.***.***.45 — show first and last octet
      const parts = str.split(".");
      if (parts.length === 4) {
        return parts[0] + ".***.***." + parts[3];
      }
      return str.slice(0, 3) + "***" + str.slice(-2);
    }
    case "account": {
      // ****1234 — show last 4 chars
      if (str.length > 4) {
        return "****" + str.slice(-4);
      }
      return "****" + str;
    }
    case "password":
      // Fully masked
      return "••••••••";
    default:
      return str.length > 1 ? str[0] + "***" + (str.length > 4 ? str.slice(-1) : "") : str;
  }
}

/** Generate data from schema; optionally obfuscate table names and mask PII. */
function generateFromSchema(options: {
  tables: Array<{ name: string; columns: Array<{ name: string; type?: string }> }>;
  recordCount: number;
  dataPrefix?: string;
  columnsToPrefix?: Record<string, string>;
  enableMasking?: boolean;
  piiTypesToMask?: string[];
  piiColumnsToMask?: string[];
  columnsToMask?: string[];
}): {
  records: TestDataRecord[];
  related: Record<string, TestDataRecord[]>;
  recordsByTable: Record<string, TestDataRecord[]>;
  obfuscationMap: Array<{ originalName: string; obfuscatedName: string; columns: Array<{ originalName: string; obfuscatedName: string; pii: boolean }> }>;
} {
  const { tables, recordCount, columnsToPrefix, enableMasking } = options;
  const recordsByTable: Record<string, TestDataRecord[]> = {};
  const obfuscationMap: Array<{ originalName: string; obfuscatedName: string; columns: Array<{ originalName: string; obfuscatedName: string; pii: boolean }> }> = [];
  const obfuscate = (name: string, _index: number): string => name;
  const obfuscateCol = (name: string, _index: number): string => name;

  tables.forEach((table, ti) => {
    const obfuscatedName = obfuscate(table.name, ti);
    const columnsMap = table.columns.map((c, ci) => ({
      originalName: c.name,
      obfuscatedName: obfuscateCol(c.name, ci),
      pii: false, // Disable automatic PII detection
    }));
    obfuscationMap.push({ originalName: table.name, obfuscatedName, columns: columnsMap });
    const arr: TestDataRecord[] = [];
    for (let i = 0; i < recordCount; i++) {
      const row: TestDataRecord = {};
      columnsMap.forEach((colMap) => {
        let val: unknown = syntheticValue(colMap.originalName, i, columnsToPrefix);
        if (enableMasking) {
          const explicitMask = options.columnsToMask?.includes(`${table.name}.${colMap.originalName}`);
          if (explicitMask) {
            // Use genuine PII type if possible for better formatting, otherwise generic mask
            const pType = getPiiType(colMap.originalName) || "account";
            val = maskPiiValue(val, pType, options.piiTypesToMask);
          }
        }
        row[colMap.obfuscatedName] = val;
      });
      arr.push(row);
    }
    recordsByTable[obfuscatedName] = arr;
  });

  const firstKey = obfuscationMap[0]?.obfuscatedName ?? "main";
  const records = recordsByTable[firstKey] ?? [];
  const related: Record<string, TestDataRecord[]> = {};
  obfuscationMap.slice(1).forEach(({ obfuscatedName }) => {
    const arr = recordsByTable[obfuscatedName];
    if (arr) related[obfuscatedName] = arr;
  });

  return { records, related, recordsByTable, obfuscationMap };
}

export type SuggestedEntity = {
  id: string;
  label: string;
  count: number;
  fields: string[];
};

function presetEntityToSuggested(e: PresetEntity): SuggestedEntity {
  return {
    id: e.id,
    label: e.label,
    count: e.fields.length,
    fields: e.fields,
  };
}

/** Suggest data entities for a domain using LLM (context-based, not hardcoded). */
async function suggestEntitiesForDomain(
  domainKey: string,
  domainLabel: string
): Promise<SuggestedEntity[]> {
  const isAllDomains = domainKey === "all" || !domainKey;
  if (isAllDomains) {
    return PRESET_ENTITIES_ALL_DOMAINS.map(presetEntityToSuggested);
  }

  const systemPrompt = `You are an expert in enterprise data and test data design. Given an industry domain, you suggest common data entities that teams typically need synthetic test data for (e.g. policy admin, claims, orders, patient records). For each entity return: id (kebab-case, no spaces), label (short display name), count (approximate number of columns, 15-35), and fields (array of 8-14 realistic column/field names as strings, suitable for CSV/JSON). Every entity MUST include a primary-key column whose name ends with "ID" or is exactly "ID". When the entity involves people, organizations, policies, orders, shipments, facilities, or billing, include geographic columns where appropriate: an address/street-style field plus City, State, and Country (use those exact words in column names when possible). Be strongly specific to the given domain. Output only valid JSON in this exact shape: { "entities": [ { "id": "...", "label": "...", "count": 20, "fields": ["Field A", "Field B", ...] }, ... ] }. No markdown, no explanation.`;
  const userPrompt = `Domain key: "${domainKey}". Domain label: "${domainLabel}". Suggest 8-14 data entities that are specific to this industry. Return only the JSON object with an "entities" array.`;
  const content = await llmComplete([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
  const parsed = parseJsonFromResponse(content) as { entities?: SuggestedEntity[] };
  const raw = Array.isArray(parsed?.entities) ? parsed.entities : [];
  return raw
    .filter(
      (e): e is SuggestedEntity =>
        e != null &&
        typeof e === "object" &&
        typeof (e as any).id === "string" &&
        typeof (e as any).label === "string" &&
        Array.isArray((e as any).fields)
    )
    .map((e) => ({
      id: String((e as any).id).replace(/\s+/g, "-").toLowerCase() || "entity",
      label: String((e as any).label),
      count: Number((e as any).count) || (e as any).fields?.length || 20,
      fields: Array.isArray((e as any).fields)
        ? (e as any).fields.map((f: unknown) => String(f))
        : [],
    }))
    .filter((e) => e.fields.length > 0);
}

/** Fallback when LLM is unavailable: full preset catalog for "all", domain-scoped presets otherwise. */
function fallbackEntitiesForDomain(domainKey: string, domainLabel: string): SuggestedEntity[] {
  if (!domainKey || domainKey === "all") {
    return PRESET_ENTITIES_ALL_DOMAINS.map(presetEntityToSuggested);
  }
  const scoped = presetEntitiesForDomainKey(domainKey);
  if (scoped.length > 0) return scoped.map(presetEntityToSuggested);
  const label = domainLabel || domainKey || "General";
  return [
    {
      id: `${domainKey}-data`,
      label: `${label} data`,
      count: 8,
      fields: ["ID", "Name", "Type", "Status", "City", "State", "Country", "Created At"],
    },
  ];
}

// ==================== Synthetic-data generation helpers (shared by sync + async endpoints) ====================
//
// AWS API Gateway has a hard ~30s integration timeout that buffers responses
// end-to-end. LLM-backed generation routinely exceeds that, so the same logic
// is exposed as a polling job (POST /start, GET /status/:jobId). Sync endpoints
// remain for backward compatibility with environments that don't sit behind a
// timeout-bound proxy. Same pattern used for the Java migration polling flow.

type SyntheticGenPresetBody = {
  domain?: string;
  domainKey?: string;
  entity?: string;
  entityId?: string;
  selectedFields?: string[];
  useAi?: boolean;
  recordCount?: number;
  dataPrefix?: string;
  columnsToPrefix?: Record<string, string>;
  enableMasking?: boolean;
  piiTypesToMask?: string[];
  piiColumnsToMask?: string[];
  includeDependencies?: boolean;
};

type SyntheticGenPresetResult = {
  records: TestDataRecord[];
  related: Record<string, TestDataRecord[]>;
  syntheticGeneration: { mode: "llm" | "rules"; aiRequested: boolean; llmConfigured: boolean };
};

async function runGenerateTestDataPreset(body: SyntheticGenPresetBody): Promise<SyntheticGenPresetResult> {
  const limits = getDataLimits();
  const recordCount = Math.min(
    limits.maxRecords,
    Math.max(limits.minRecords, Number(body.recordCount) ?? limits.defaultRecords)
  );
  const selectedFields = Array.isArray(body.selectedFields) && body.selectedFields.length > 0
    ? body.selectedFields
    : ["ID", "Name", "Status", "Created At"];
  let relatedEntities: RelatedEntitySpec[] | undefined;
  if (body.includeDependencies !== false && (body.entity || body.domainKey)) {
    const domainKey = typeof body.domainKey === "string" ? body.domainKey : "all";
    const domainLabel = body.domain ?? getDomainLabel(body.domainKey, body.domain);
    relatedEntities = await suggestRelatedEntitiesForEntity(domainKey, domainLabel, body.entity ?? "data");
  }
  let records: TestDataRecord[];
  let related: Record<string, TestDataRecord[]>;
  const aiRequested = body.useAi === true;
  const llmConfigured = hasAnyChatLlm();
  let generationMode: "llm" | "rules" = "rules";
  if (aiRequested && llmConfigured) {
    const domainForPrompt = body.domain ?? getDomainLabel(body.domainKey, body.domain);
    const result = await generatePresetDataWithLLM({
      domain: domainForPrompt,
      entity: body.entity,
      selectedFields,
      recordCount,
      columnsToPrefix: body.columnsToPrefix,
      includeDependencies: body.includeDependencies !== false,
      relatedEntities,
    });
    records = result.records;
    related = result.related;
    generationMode = result.mainUsedLlm ? "llm" : "rules";
  } else {
    const result = generatePresetData({
      selectedFields,
      recordCount,
      columnsToPrefix: body.columnsToPrefix,
      includeDependencies: body.includeDependencies !== false,
      entityLabel: body.entity,
      relatedEntities,
    });
    records = result.records;
    related = result.related;
  }
  if (body.enableMasking) {
    const piiTypeMap: Record<string, PiiType> = {};
    const maskValues = (dataArray: TestDataRecord[]) => {
      if (!dataArray || !dataArray.length) return dataArray;
      return dataArray.map(row => {
        const newRow: TestDataRecord = {};
        for (const [k, v] of Object.entries(row)) {
          if (!(k in piiTypeMap)) {
            piiTypeMap[k] = getPiiType(k);
          }
          let finalVal = v;
          const staticType = piiTypeMap[k];
          let pType = staticType;
          const isExplicitlyMasked = body.piiColumnsToMask?.includes(k);

          if (isExplicitlyMasked) {
            if (isLikelyNonPiiBusinessKey(k)) {
              pType = null;
            } else {
              pType = staticType ?? guessPiiTypeFromValue(v) ?? null;
            }
          } else if (body.piiColumnsToMask && !body.piiColumnsToMask.includes(k)) {
            pType = null;
          } else {
            const guessed = guessPiiTypeFromValue(v);
            if (guessed) pType = guessed;
          }

          if (pType) {
            finalVal = maskPiiValue(v, pType, body.piiTypesToMask);
          }
          newRow[k] = finalVal;
        }
        return newRow;
      });
    };
    records = maskValues(records);
    for (const [relKey, arr] of Object.entries(related)) {
      related[relKey] = maskValues(arr);
    }
  }
  return {
    records,
    related,
    syntheticGeneration: { mode: generationMode, aiRequested, llmConfigured },
  };
}

type SyntheticGenSchemaBody = {
  schema?: { tables?: Array<{ name: string; columns: Array<{ name: string; type?: string }> }> };
  recordCount?: number;
  dataPrefix?: string;
  columnsToPrefix?: Record<string, string>;
  enableMasking?: boolean;
  piiTypesToMask?: string[];
  piiColumnsToMask?: string[];
  columnsToMask?: string[];
  useAi?: boolean;
};

type SyntheticGenSchemaResult = {
  records: TestDataRecord[];
  related: Record<string, TestDataRecord[]>;
  recordsByTable: Record<string, TestDataRecord[]>;
  obfuscationMap: Array<{ originalName: string; obfuscatedName: string; columns: Array<{ originalName: string; obfuscatedName: string; pii: boolean }> }>;
  syntheticGeneration: { mode: "llm" | "rules"; aiRequested: boolean; llmConfigured: boolean };
};

// Throws on validation failure. Caller is responsible for translating to HTTP status.
async function runGenerateTestDataFromSchema(body: SyntheticGenSchemaBody): Promise<SyntheticGenSchemaResult> {
  const tables = body.schema?.tables ?? [];
  if (tables.length === 0) {
    throw new Error("Schema must contain at least one table with columns");
  }
  const limits = getDataLimits();
  const recordCount = Math.min(
    limits.maxRecords,
    Math.max(limits.minRecords, Number(body.recordCount) ?? limits.defaultRecords)
  );
  const enableMasking = body.enableMasking !== false;
  const aiRequested = body.useAi === true;
  const llmConfigured = hasAnyChatLlm();
  if (aiRequested && llmConfigured) {
    const obfuscate = (name: string, _index: number): string => name;
    const obfuscateCol = (name: string, _index: number): string => name;
    const obfuscationMap = tables.map((table, ti) => ({
      originalName: table.name,
      obfuscatedName: obfuscate(table.name, ti),
      columns: table.columns.map((c, ci) => ({
        originalName: c.name,
        obfuscatedName: obfuscateCol(c.name, ci),
        pii: isPiiColumn(c.name),
      })),
    }));
    const tablePromises = tables.map((table, ti) =>
      generateTableDataWithLLM(table.name, table.columns, recordCount, body.columnsToPrefix).then((arr) => {
        const mapEntry = obfuscationMap[ti];
        const remappedArr = arr.map((row) => {
          const newRow: TestDataRecord = {};
          for (const [key, val] of Object.entries(row)) {
            const colMap = mapEntry.columns.find((c) => c.originalName === key);
            const isPiiCol = colMap ? colMap.pii : isPiiColumn(key);
            void isPiiCol;
            let finalVal = val;
            if (enableMasking) {
              const explicitMask = body.columnsToMask?.includes(`${table.name}.${key}`);
              if (explicitMask) {
                const pType = getPiiType(key) || "account";
                finalVal = maskPiiValue(val, pType, body.piiTypesToMask);
              }
            }
            newRow[colMap ? colMap.obfuscatedName : key] = finalVal;
          }
          return newRow;
        });
        return {
          key: mapEntry.obfuscatedName,
          arr: remappedArr,
        };
      })
    );
    const tableResults = await Promise.all(tablePromises);
    const recordsByTable: Record<string, TestDataRecord[]> = {};
    tableResults.forEach(({ key, arr }) => { recordsByTable[key] = arr; });
    const firstKey = obfuscationMap[0]?.obfuscatedName ?? "main";
    const records = recordsByTable[firstKey] ?? [];
    const related: Record<string, TestDataRecord[]> = {};
    obfuscationMap.slice(1).forEach(({ obfuscatedName }) => {
      const arr = recordsByTable[obfuscatedName];
      if (arr) related[obfuscatedName] = arr;
    });
    return {
      records,
      related,
      recordsByTable,
      obfuscationMap,
      syntheticGeneration: { mode: "llm", aiRequested, llmConfigured },
    };
  }
  const result = generateFromSchema({
    tables,
    recordCount,
    columnsToPrefix: body.columnsToPrefix,
    enableMasking,
    piiTypesToMask: body.piiTypesToMask,
    piiColumnsToMask: body.piiColumnsToMask,
    columnsToMask: body.columnsToMask,
  });
  return {
    records: result.records,
    related: result.related,
    recordsByTable: result.recordsByTable,
    obfuscationMap: result.obfuscationMap,
    syntheticGeneration: { mode: "rules", aiRequested, llmConfigured },
  };
}

// ==================== Synthetic-data background-job store ====================

type SyntheticGenPhase = "processing" | "complete" | "error";
interface SyntheticGenJob {
  id: string;
  phase: SyntheticGenPhase;
  result?: SyntheticGenPresetResult | SyntheticGenSchemaResult;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

const syntheticGenJobs = new Map<string, SyntheticGenJob>();
const SYNTHETIC_GEN_JOB_TTL_MS = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of syntheticGenJobs.entries()) {
    if (now - job.createdAt > SYNTHETIC_GEN_JOB_TTL_MS) {
      syntheticGenJobs.delete(id);
    }
  }
}, 5 * 60 * 1000).unref?.();

function createSyntheticGenJob(): SyntheticGenJob {
  const id = "sgjob_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const job: SyntheticGenJob = { id, phase: "processing", createdAt: Date.now() };
  syntheticGenJobs.set(id, job);
  return job;
}

function runSyntheticGenInBackground(
  job: SyntheticGenJob,
  fn: () => Promise<SyntheticGenPresetResult | SyntheticGenSchemaResult>,
): void {
  void (async () => {
    try {
      const result = await fn();
      job.result = result;
      job.phase = "complete";
      job.completedAt = Date.now();
    } catch (err: any) {
      job.error = err?.message || String(err);
      job.phase = "error";
      job.completedAt = Date.now();
      console.error("[SyntheticGen] Job error:", job.id, err);
    }
  })();
}

export function registerAlternateRoutes(app: Express): void {
  app.get("/api/testing/data-limits", (_req: Request, res: Response) => {
    try {
      const limits = getDataLimits();
      const tokenEstimate = getTokenEstimateConfig();
      res.json({
        minRecords: limits.minRecords,
        maxRecords: limits.maxRecords,
        defaultRecords: limits.defaultRecords,
        tokenEstimate: {
          inputPerBatch: tokenEstimate.inputPerBatch,
          outputPerRecordMain: tokenEstimate.outputPerRecordMain,
          outputPerRecordRoot: tokenEstimate.outputPerRecordRoot,
          batchSize: tokenEstimate.batchSize,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to get limits" });
    }
  });

  app.post("/api/testing/suggest-related-entities", async (req: Request, res: Response) => {
    try {
      const body = req.body as { domainKey?: string; domainLabel?: string; entityLabel?: string };
      const domainKey = typeof body.domainKey === "string" ? body.domainKey : "all";
      const domainLabel = getDomainLabel(domainKey, body.domainLabel);
      const entityLabel = typeof body.entityLabel === "string" ? body.entityLabel : "data";
      const related = await suggestRelatedEntitiesForEntity(domainKey, domainLabel, entityLabel);
      res.json({ related });
    } catch {
      res.json({ related: [{ key: "related", label: "Related", fields: ["ID", "Name", "Status", "Created At"] }] });
    }
  });

  app.post("/api/testing/suggest-entities", async (req: Request, res: Response) => {
    try {
      const body = req.body as { domainKey?: string; domainLabel?: string };
      const domainKey = typeof body.domainKey === "string" ? body.domainKey : "all";
      const domainLabel = getDomainLabel(domainKey, body.domainLabel);
      if (hasAnyChatLlm()) {
        const entities = await suggestEntitiesForDomain(domainKey, domainLabel);
        if (entities.length > 0) {
          return res.json({ entities });
        }
      }
      const entities = fallbackEntitiesForDomain(domainKey, domainLabel);
      res.json({ entities });
    } catch (err) {
      const body = req.body as { domainKey?: string; domainLabel?: string };
      const domainKey = typeof body?.domainKey === "string" ? body.domainKey : "all";
      const domainLabel = getDomainLabel(domainKey, body?.domainLabel);
      const entities = fallbackEntitiesForDomain(domainKey, domainLabel);
      res.json({ entities });
    }
  });

  // Sync endpoints — kept for backward compatibility with environments that
  // don't sit behind a 30s-bound proxy (e.g. local dev, on-prem). On AWS API
  // Gateway these will 503 for any LLM-enabled call; the polling endpoints
  // below are the supported path there.
  app.post("/api/testing/generate-test-data", async (req: Request, res: Response) => {
    try {
      const result = await runGenerateTestDataPreset(req.body as SyntheticGenPresetBody);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate test data";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/testing/generate-test-data-from-schema", async (req: Request, res: Response) => {
    try {
      const body = req.body as SyntheticGenSchemaBody;
      if (!body?.schema?.tables?.length) {
        return res.status(400).json({ error: "Schema must contain at least one table with columns" });
      }
      const result = await runGenerateTestDataFromSchema(body);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate test data from schema";
      res.status(500).json({ error: message });
    }
  });

  // ==================== Async polling endpoints (AWS-friendly) ====================
  //
  // POST /start kicks off the generation in the background and returns a jobId
  // immediately. The client polls GET /status/:jobId every ~1.5s; each poll
  // response is small and well under the API Gateway integration timeout.

  app.post("/api/testing/generate-test-data/start", (req: Request, res: Response) => {
    try {
      const body = req.body as SyntheticGenPresetBody;
      const job = createSyntheticGenJob();
      console.log("[SyntheticGen] Preset job created:", job.id, "useAi:", body?.useAi === true);
      runSyntheticGenInBackground(job, () => runGenerateTestDataPreset(body));
      res.json({ success: true, jobId: job.id });
    } catch (error: any) {
      console.error("[SyntheticGen] Preset start error:", error);
      res.status(500).json({ success: false, error: error?.message || "Failed to start generation" });
    }
  });

  app.post("/api/testing/generate-test-data-from-schema/start", (req: Request, res: Response) => {
    try {
      const body = req.body as SyntheticGenSchemaBody;
      // Validate synchronously so the client gets a clear 400 instead of a
      // background job that immediately fails.
      if (!body?.schema?.tables?.length) {
        return res.status(400).json({ success: false, error: "Schema must contain at least one table with columns" });
      }
      const job = createSyntheticGenJob();
      console.log("[SyntheticGen] Schema job created:", job.id, "tables:", body.schema!.tables!.length, "useAi:", body?.useAi === true);
      runSyntheticGenInBackground(job, () => runGenerateTestDataFromSchema(body));
      res.json({ success: true, jobId: job.id });
    } catch (error: any) {
      console.error("[SyntheticGen] Schema start error:", error);
      res.status(500).json({ success: false, error: error?.message || "Failed to start generation" });
    }
  });

  // Shared status endpoint for both kinds of generation jobs. Client polls
  // this; payload is tiny while processing, full result once complete.
  app.get("/api/testing/generate-test-data/status/:jobId", (req: Request, res: Response) => {
    const job = syntheticGenJobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: "Job not found or expired" });
    }
    res.json({
      success: true,
      jobId: job.id,
      phase: job.phase,
      ...(job.phase === "complete" && job.result ? { result: job.result } : {}),
      ...(job.phase === "error" ? { error: job.error } : {}),
    });
  });
}
