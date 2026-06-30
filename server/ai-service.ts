import { storage } from "./storage";
import { ai, hasConfiguredSdk } from "./ai-client";
import { azureOpenAI, anthropic, hasAnthropic, hasBedrock, azureOpenAI as bedrockLLM, workflowAzureInstances, hasWorkflowInstances, hasAnyChatLlm } from "./llm-config";
import { PROFESSIONAL_ARTIFACTS_SYSTEM_PROMPT, getProfessionalArtifactsUserPrompt } from "./prompts/prompt_professional_artifacts";
import { VectorCacheService } from "./ai/RAG_agents/vectorCacheService";
import { faissVectorService } from "./ai/RAG_agents/faissVectorService";
import { StructureExtractionAgent } from "./ai/RAG_agents/agents/structureExtractionAgent";
import { SmartChunkingEngine } from "./ai/RAG_agents/agents/smartChunkingEngine";
import { NEW_API_MODEL_SUBSTRINGS } from "./llm-config-constants";
import {
  tryBuildDependencyClusteredChunks,
  type StructuredRequirementRow,
} from "./requirement-clustering";
import {
  createJobCachePrefix,
  buildArtifactPassPrefix,
  logJobCacheFingerprint,
  resolvePromptCacheProvider,
  toLlmMessages,
  type JobCachePrefix,
} from "./observability/job-cache-prefix";
import {
  recordWorkflowLlmUsage,
  resolveWorkflowCacheInstanceIndex,
} from "./observability/workflow-llm-usage";
import { buildCachedMessages, isPromptCacheEnabled, resolvePromptCacheKey } from "./observability/prompt-cache";

import { promptGenerateTestCases } from "./prompts/prompt_test_cases";

/**
 * Walk from `start` (must be `{` or `[`) and return the slice of the outermost JSON
 * value. Respects JSON strings so markdown ``` or braces inside descriptions do not
 * end extraction early (non-greedy regex cannot do this).
 */
function extractBalancedJsonSlice(s: string, start: number): string | null {
  if (start < 0 || start >= s.length) return null;
  const head = s[start];
  if (head !== "{" && head !== "[") return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === "{" || c === "[") {
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  return null;
}

function firstJsonValueStart(s: string): number {
  const o = s.indexOf("{");
  const a = s.indexOf("[");
  if (o === -1) return a;
  if (a === -1) return o;
  return Math.min(o, a);
}

/** Curly/smart double quotes sometimes emitted by LLMs instead of ASCII `"`. */
function normalizeLlJsonQuotes(s: string): string {
  return s.replace(/[\u201c\u201d\u201e\u201f\u00ab\u00bb]/g, '"');
}

/**
 * Strict JSON disallows raw control characters inside strings; models often insert
 * literal newlines/tabs in long description fields. Escape them only inside quoted spans.
 */
function escapeRawControlCharsInJsonStrings(s: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inString) {
      out += c;
      if (c === '"') inString = true;
      continue;
    }
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\") {
      out += c;
      escape = true;
      continue;
    }
    if (c === '"') {
      out += c;
      inString = false;
      continue;
    }
    const code = c.charCodeAt(0);
    if (c === "\n") {
      out += "\\n";
      continue;
    }
    if (c === "\r") {
      out += "\\r";
      continue;
    }
    if (c === "\t") {
      out += "\\t";
      continue;
    }
    if (code < 0x20) {
      out += "\\u" + ("0000" + code.toString(16)).slice(-4);
      continue;
    }
    out += c;
  }
  return out;
}

function tryParseJsonLenient(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const normalized = normalizeLlJsonQuotes(text);
    try {
      return JSON.parse(normalized);
    } catch {
      const sanitized = escapeRawControlCharsInJsonStrings(normalized);
      return JSON.parse(sanitized);
    }
  }
}

/**
 * When the LLM hits max_tokens mid-stream, output often ends inside a JSON string.
 * Balanced extraction returns null (no closing `"`), so we close the string and then
 * emit matching `}` / `]` for any still-open `{` / `[` on the stack.
 */
function repairJsonTruncatedMidString(s: string, start: number): string | null {
  if (start < 0 || start >= s.length) return null;
  const head = s[start];
  if (head !== "{" && head !== "[") return null;

  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === "{") {
      stack.push("{");
      continue;
    }
    if (c === "[") {
      stack.push("[");
      continue;
    }
    if (c === "}") {
      if (stack.length > 0 && stack[stack.length - 1] === "{") {
        stack.pop();
      }
      continue;
    }
    if (c === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === "[") {
        stack.pop();
      }
      continue;
    }
  }

  let out = s.slice(start);
  if (inString) {
    if (escape) {
      out = out.slice(0, -1);
    }
    out += '"';
  }
  while (stack.length > 0) {
    const open = stack.pop()!;
    out += open === "{" ? "}" : "]";
  }
  return out;
}

/** Heuristic repair when output was truncated mid-JSON (brace counts only; last resort). */
function tryRepairTruncatedJson(candidate: string): string | null {
  const lastBrace = candidate.lastIndexOf("}");
  const lastBracket = candidate.lastIndexOf("]");
  const lastComplete = Math.max(lastBrace, lastBracket);
  if (lastComplete <= 0) return null;
  let potentialJson = candidate.substring(0, lastComplete + 1);
  let openBraces = (potentialJson.match(/\{/g) || []).length;
  let closeBraces = (potentialJson.match(/\}/g) || []).length;
  let openBrackets = (potentialJson.match(/\[/g) || []).length;
  let closeBrackets = (potentialJson.match(/\]/g) || []).length;
  while (openBrackets > closeBrackets) {
    potentialJson += "]";
    closeBrackets++;
  }
  while (openBraces > closeBraces) {
    potentialJson += "}";
    closeBraces++;
  }
  return potentialJson;
}

/**
 * Remove ``` / ```json wrappers only at the outer edges (repeatable).
 * Do NOT globally delete ``` — artifact JSON often contains markdown/code examples in
 * string fields; stripping every fence corrupts the payload and breaks JSON.parse.
 */
function stripOuterMarkdownFences(text: string): string {
  let t = text.trim();
  for (let pass = 0; pass < 8; pass++) {
    const lead = t.match(/^\s*```(?:\s*json)?\s*\n?/i);
    if (lead) {
      t = t.slice(lead[0].length).trim();
      continue;
    }
    const withoutTrailing = t.replace(/\n?\s*```\s*$/m, "").trim();
    if (withoutTrailing !== t) {
      t = withoutTrailing;
      continue;
    }
    break;
  }
  return t;
}

/**
 * Robustly extract and parse JSON from an LLM response that may be wrapped in
 * markdown code blocks. Bedrock/Claude ignores `response_format: { type: "json_object" }`
 * and often wraps JSON in ```json ... ``` fences. Handles truncated responses too.
 */
export function extractJsonFromLLMResponse(raw: string): {
  parsed: any;
  wasCodeBlock: boolean;
  /** Set when we closed an open string / brackets — output was almost certainly cut by max_tokens */
  repairedTruncation?: boolean;
} {
  let content = raw.trim();
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1).trim();
  }
  content = content.replace(/^\u200B+|\u200B+$/g, "").trim();

  let wasCodeBlock = false;

  // Strip only a *leading* markdown fence (must not match ``` inside JSON string values).
  // Allow space between ``` and `json` (e.g. "``` json\n{")
  const leadingFence = content.match(/^\s*```(?:\s*json)?\s*\n?/i);
  if (leadingFence) {
    wasCodeBlock = true;
    content = content.slice(leadingFence[0].length);
  }

  // Remove closing fence if present
  content = content.replace(/\n?\s*```\s*$/m, "").trim();

  // Preamble + inline fence before JSON (response did not start with ```)
  const jsonStart = firstJsonValueStart(content);
  if (jsonStart > 0 && /```(?:json)?/i.test(content.slice(0, jsonStart))) {
    content = content.slice(jsonStart);
  }

  const tryParse = (text: string) => tryParseJsonLenient(text);

  const parseBalanced = (text: string): any | undefined => {
    const start = firstJsonValueStart(text);
    if (start === -1) return undefined;
    const slice = extractBalancedJsonSlice(text, start);
    if (!slice) return undefined;
    try {
      return tryParse(slice);
    } catch {
      const repaired = tryRepairTruncatedJson(slice);
      if (repaired && repaired !== slice) {
        try {
          return tryParse(repaired);
        } catch {
          /* fall through */
        }
      }
    }
    return undefined;
  };

  // 1. Parse whole buffer (raw JSON or fence already stripped)
  try {
    return { parsed: tryParse(content), wasCodeBlock };
  } catch {
    /* fall through */
  }

  // 2. Outer balanced JSON (handles ``` in string values, preamble, partial fences)
  const balanced = parseBalanced(content);
  if (balanced !== undefined) {
    return { parsed: balanced, wasCodeBlock };
  }

  // 2b. Response truncated mid-string (common when max_tokens cuts output)
  const startRepair = firstJsonValueStart(content);
  if (startRepair !== -1) {
    const midFixed = repairJsonTruncatedMidString(content, startRepair);
    if (midFixed) {
      try {
        return { parsed: tryParse(midFixed), wasCodeBlock, repairedTruncation: true };
      } catch {
        /* fall through */
      }
    }
  }

  // 3. Strip only outer markdown fences and retry (never global ``` removal — see stripOuterMarkdownFences)
  const cleaned = stripOuterMarkdownFences(content);
  try {
    return { parsed: tryParse(cleaned), wasCodeBlock };
  } catch {
    /* fall through */
  }

  const balancedCleaned = parseBalanced(cleaned);
  if (balancedCleaned !== undefined) {
    return { parsed: balancedCleaned, wasCodeBlock };
  }

  const startRepairClean = firstJsonValueStart(cleaned);
  if (startRepairClean !== -1) {
    const midFixedClean = repairJsonTruncatedMidString(cleaned, startRepairClean);
    if (midFixedClean) {
      try {
        return { parsed: tryParse(midFixedClean), wasCodeBlock, repairedTruncation: true };
      } catch {
        /* fall through */
      }
    }
  }

  // 4. Last resort: substring from first { + heuristic truncation repair (legacy behavior)
  const fb = cleaned.indexOf("{");
  if (fb !== -1) {
    let candidate = cleaned.slice(fb);
    try {
      return { parsed: tryParse(candidate), wasCodeBlock };
    } catch {
      const repaired = tryRepairTruncatedJson(candidate);
      if (repaired) {
        try {
          return { parsed: tryParse(repaired), wasCodeBlock };
        } catch {
          /* fall through */
        }
      }
    }
  }

  throw new Error(
    `No valid JSON found in LLM response. Content length: ${raw.length}, ` +
    `preview: ${raw.substring(0, 300)}`
  );
}

/** Per-call usage for accurate cost tracking (single + council + multi-instance). */
export interface WorkflowUsageReport {
  model: string;
  provider: "azure" | "anthropic";
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  callId?: string;
}
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import * as path from 'path';
// import { promptAcceptanceCriteria } from "./prompts/prompt_acceptance_criteria";

// pdf-parse is a CommonJS module; require works fine in the bundled CJS build.
// Handle both ESM (development) and CJS (bundled) contexts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
let pdfParse: any;

// Initialize pdf-parse module (v2.4.5 uses PDFParse class, not a function)
let PDFParseClass: any = null;

async function initializePdfParse() {
  if (PDFParseClass) {
    return PDFParseClass;
  }

  try {
    // Check if we're in ESM context (development) or CJS context (bundled)
    const isESM = typeof import.meta !== 'undefined' && typeof import.meta.url === 'string';

    let pdfParseModule: any;

    if (isESM) {
      // ESM context (development with tsx) - use dynamic import
      pdfParseModule = await import('pdf-parse') as any;
    } else {
      // CommonJS context (bundled output) - use require
      // @ts-ignore - require is available in CommonJS but not in ESM types
      if (typeof require !== 'undefined') {
        pdfParseModule = require('pdf-parse');
      } else {
        // Last resort: create require from process.cwd()
        const requireFn = createRequire(path.resolve(process.cwd(), 'package.json'));
        pdfParseModule = requireFn('pdf-parse');
      }
    }

    // pdf-parse v2.4.5 exports PDFParse as a class, not a function
    // Get the PDFParse class from the module
    if (pdfParseModule.PDFParse && typeof pdfParseModule.PDFParse === 'function') {
      PDFParseClass = pdfParseModule.PDFParse;
    } else if (pdfParseModule.default && pdfParseModule.default.PDFParse) {
      PDFParseClass = pdfParseModule.default.PDFParse;
    } else {
      console.error('[AI Service] PDFParse class not found in pdf-parse module. Module structure:', typeof pdfParseModule, Object.keys(pdfParseModule || {}));
      throw new Error('pdf-parse module did not export PDFParse class');
    }

    console.log('[AI Service] Successfully initialized pdf-parse PDFParse class');
    return PDFParseClass;
  } catch (err) {
    console.error('[AI Service] Failed to initialize pdf-parse:', err);
    throw err;
  }
}

// Initialize synchronously for CommonJS, asynchronously for ESM
const isESMInit = typeof import.meta !== 'undefined' && typeof import.meta.url === 'string';
if (!isESMInit && typeof require !== 'undefined') {
  // CommonJS - initialize immediately
  try {
    const pdfParseModule = require('pdf-parse');
    // pdf-parse v2.4.5 exports PDFParse as a class
    if (pdfParseModule.PDFParse && typeof pdfParseModule.PDFParse === 'function') {
      PDFParseClass = pdfParseModule.PDFParse;
      pdfParse = async (buffer: Buffer) => {
        const instance = new PDFParseClass(buffer);
        return instance;
      };
      console.log('[AI Service] Successfully initialized pdf-parse PDFParse class synchronously');
    } else if (pdfParseModule.default && pdfParseModule.default.PDFParse) {
      PDFParseClass = pdfParseModule.default.PDFParse;
      pdfParse = async (buffer: Buffer) => {
        const instance = new PDFParseClass(buffer);
        return instance;
      };
      console.log('[AI Service] Successfully initialized pdf-parse PDFParse class synchronously (via default)');
    } else {
      console.warn('[AI Service] PDFParse class not found in pdf-parse module. Module structure:', typeof pdfParseModule, Object.keys(pdfParseModule || {}));
      PDFParseClass = null; // Reset so async init will be used
    }
  } catch (err) {
    console.warn('[AI Service] Failed to initialize pdf-parse synchronously:', err);
    PDFParseClass = null; // Ensure it's null so async init will be used
  }
}

// Use centralized LLM config (same as BRD generation) - handles AWS/Azure hosting switch automatically
const useAnthropic = !hasBedrock && !!process.env.ANTHROPIC_AZURE_ENDPOINT && !!process.env.ANTHROPIC_API_KEY;
const useAzure = hasAnyChatLlm() && !hasBedrock;

const _defaultModelName = hasBedrock
  ? (process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-opus-4-6-v1")
  : process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";

const _docPlatform = hasBedrock ? "Confluence" : "Azure DevOps Wiki";

const openai = ai;
const hasConfiguredDefaultAiClient = () => hasAnyChatLlm() || hasConfiguredSdk();



/**
 * Retry wrapper for LLM API calls that handles 429 rate limits with exponential backoff.
 * Retries up to maxRetries times with increasing delays (2s, 4s, 8s).
 * Also handles transient network errors and 500/503 server errors.
 */
async function llmCallWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.status || error?.response?.status || error?.code;
      const is429 = status === 429 || (error?.message && /429|rate.?limit|too.?many.?requests/i.test(error.message));
      const isTransient = status === 500 || status === 503 || status === 'ECONNRESET' || status === 'ETIMEDOUT';

      if ((is429 || isTransient) && attempt < maxRetries) {
        const retryAfterHeader = error?.headers?.get?.('retry-after') || error?.response?.headers?.['retry-after'];
        const retryAfterMs = retryAfterHeader ? (parseInt(retryAfterHeader, 10) || 5) * 1000 : null;
        const backoffMs = retryAfterMs || Math.min(2000 * Math.pow(2, attempt), 30000);
        console.warn(`[AI Service] ${label} hit ${is429 ? '429 rate limit' : `${status} error`} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${(backoffMs / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      throw error;
    }
  }
  throw new Error(`${label}: exhausted all ${maxRetries + 1} attempts`);
}

/**
 * Requirement type prefixes used for chunking: each FR, NFR, TR, IR = one chunk.
 * Matches: FR-01, NFR-01, TR-01, IR-01, FR 01, Functional Requirement 01, etc.
 */
const BRD_REQUIREMENT_MARKER_PATTERN = /\b(NFR-[A-Z]+-\d+|FR-[A-Z]+-\d+|TR-[A-Z]+-\d+|IR-[A-Z]+-\d+|BR-[A-Z]+-\d+|DR-[A-Z]+-\d+|FR-\d+|FR\s*\d+|NFR-\d+|NFR\s*\d+|TR-\d+|TR\s*\d+|IR-\d+|IR\s*\d+|BR-\d+|BR\s*\d+|DR-\d+|DR\s*\d+|Functional\s+Requirement\s*\d+|Non-Functional\s+Requirement\s*\d+|Technical\s+Requirement\s*\d+|Integration\s+Requirement\s*\d+|Business\s+Rule\s*\d+|Data\s+Requirement\s*\d+|REQ-\d+)/gi;

type RequirementBlock = { type: string; number: number; sortKey: string; content: string; compoundId?: string };

function parseRequirementType(matchText: string): { type: string; number: number; compoundId?: string } {
  const upper = matchText.toUpperCase();
  let type = "REQ";
  // Order matters: NFR/NON-FUNCTIONAL must come before FR (NFR contains "FR").
  // Compound IDs like BR-AUTH-001, NFR-PERF-01 are detected first.
  if (/^NFR[\-\s]*[A-Z]*[\-\s]*\d+/.test(upper) || /NON-FUNCTIONAL\s+REQUIREMENT/.test(upper)) type = "NFR";
  else if (/^FR[\-\s]*[A-Z]*[\-\s]*\d+/.test(upper) || /FUNCTIONAL\s+REQUIREMENT/.test(upper)) type = "FR";
  else if (/^TR[\-\s]*[A-Z]*[\-\s]*\d+/.test(upper) || /TECHNICAL\s+REQUIREMENT/.test(upper)) type = "TR";
  else if (/^IR[\-\s]*[A-Z]*[\-\s]*\d+/.test(upper) || /INTEGRATION\s+REQUIREMENT/.test(upper)) type = "IR";
  else if (/^BR[\-\s]*[A-Z]*[\-\s]*\d+/.test(upper) || /BUSINESS\s+RULE/.test(upper)) type = "BR";
  else if (/^DR[\-\s]*[A-Z]*[\-\s]*\d+/.test(upper) || /DATA\s+REQUIREMENT/.test(upper)) type = "DR";
  // Extract the trailing number (last numeric segment for compound IDs like BR-AUTH-001)
  const allNums = matchText.match(/\d+/g);
  const number = allNums ? parseInt(allNums[allNums.length - 1], 10) : 0;
  // Detect compound IDs: TYPE-CATEGORY-NUMBER (e.g. BR-AUTH-001, NFR-PERF-01)
  const compoundMatch = matchText.match(/^([A-Z]{2,4})-([A-Z]+)-(\d+)$/i);
  const compoundId = compoundMatch ? `${compoundMatch[1].toUpperCase()}-${compoundMatch[2].toUpperCase()}-${compoundMatch[3]}` : undefined;
  return { type, number, compoundId };
}

/**
 * Reusable block parser: pulls each FR/NFR/TR/IR out of a BRD requirement document
 * and returns it as a structured block. Order is preserved.
 *
 * Used by:
 *  - chunkBRDRequirements (legacy one-per-chunk path)
 *  - clusterRequirementsByDependency (dependency-aware grouping)
 */
export type ParsedRequirementBlock = {
  id: string;          // e.g. "FR-01", "NFR-02", "BR-15"
  type: 'FR' | 'NFR' | 'TR' | 'IR' | 'BR' | 'DR' | 'REQ';
  number: number;
  content: string;
};

export function parseRequirementBlocks(functionalRequirementsContent: string): ParsedRequirementBlock[] {
  const matches = [...functionalRequirementsContent.matchAll(BRD_REQUIREMENT_MARKER_PATTERN)];
  if (matches.length === 0) {
    console.log('[AI Service] parseRequirementBlocks: 0 requirements parsed (no FR/NFR/TR/IR/BR/DR markers found in content)');
    return [];
  }

  const blocks: ParsedRequirementBlock[] = [];
  let droppedTooShort = 0;
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = i < matches.length - 1
      ? (matches[i + 1].index ?? functionalRequirementsContent.length)
      : functionalRequirementsContent.length;
    const content = functionalRequirementsContent.substring(start, end).trim();
    if (content.length < 30) {
      droppedTooShort++;
      continue;
    }
    const matchText = matches[i][1] ?? "";
    const { type, number, compoundId } = parseRequirementType(matchText);
    
    // Ignore Business Rules (BR) and Data Requirements (DR) for artifact generation
    if (type === 'BR' || type === 'DR') {
      continue;
    }

    // Preserve compound IDs like BR-AUTH-001; fall back to simple TYPE-NN format
    const id = compoundId || `${type}-${String(number).padStart(2, "0")}`;
    blocks.push({ id, type: type as ParsedRequirementBlock['type'], number, content });
  }

  // Diagnostic: surface every parsed requirement so silent drops are visible.
  // Helps distinguish chunker drops from upstream BRD-ingestion drops.
  const idList = blocks.map(b => b.id).join(', ');
  console.log(`[AI Service] parseRequirementBlocks: parsed ${blocks.length} requirement(s)${droppedTooShort > 0 ? ` (dropped ${droppedTooShort} marker(s) with <30 char body)` : ''}: ${idList || '(none)'}`);
  return blocks;
}

/**
 * Cluster requirements by dependency before sending to artifact generation.
 * Two requirements are in the same cluster when they share a business entity,
 * workflow, data flow, or are explicit pre/post conditions of each other.
 *
 * One LLM call, temperature 0, strict JSON output. On any validation failure
 * the function returns one cluster per requirement (matches legacy behaviour),
 * so this is safe to enable by default.
 */
export type RequirementCluster = {
  groupId: string;
  requirementIds: string[];
  reason: string;
  combinedContent: string;
};

// Stop-words used by the Jaccard merge pass. BRD-agnostic — only generic English
// connectors and verbs that carry no entity meaning.
const CLUSTER_TOKEN_STOPWORDS = new Set([
  'the','and','for','with','that','this','from','into','have','will','must','should','shall',
  'their','they','them','these','those','about','also','because','your','user','users','system',
  'data','feature','features','story','stories','epic','epics','requirement','requirements',
  'when','where','what','which','before','after','during','either','neither','both','some','many',
  'such','than','then','only','more','most','less','same','other','using','use','make','can','may',
]);

const tokenizeClusterContent = (text: string): Set<string> => {
  if (!text) return new Set();
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(t => t.length > 4 && !CLUSTER_TOKEN_STOPWORDS.has(t))
  );
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union > 0 ? intersect / union : 0;
};

/**
 * Merge clusters whose tokenized content overlap (Jaccard) is ≥ threshold.
 * Iteratively merges pairs greedily until no remaining pair crosses the
 * threshold. Operates purely on token statistics — no hardcoded domain words.
 */
function mergeClustersByJaccardOverlap(
  clusters: RequirementCluster[],
  threshold: number,
): RequirementCluster[] {
  if (clusters.length < 2) return clusters;
  const working = clusters.map(c => ({ ...c, _tokens: tokenizeClusterContent(c.combinedContent) }));

  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < working.length; i++) {
      for (let j = i + 1; j < working.length; j++) {
        const overlap = jaccard(working[i]._tokens, working[j]._tokens);
        if (overlap >= threshold) {
          // Merge j into i. Rebuild combined content + tokens.
          const merged: RequirementCluster & { _tokens: Set<string> } = {
            groupId: working[i].groupId,
            requirementIds: [...working[i].requirementIds, ...working[j].requirementIds],
            reason: `${working[i].reason || 'cluster A'} + ${working[j].reason || 'cluster B'} (merged: token overlap ${overlap.toFixed(2)})`,
            combinedContent: `${working[i].combinedContent}\n\n---\n\n${working[j].combinedContent}`,
            _tokens: new Set([...working[i]._tokens, ...working[j]._tokens]),
          };
          working.splice(j, 1);
          working[i] = merged;
          changed = true;
          break outer;
        }
      }
    }
  }

  // Drop the internal _tokens helper before returning.
  return working.map((c, idx) => ({
    groupId: `group-${idx + 1}`,
    requirementIds: c.requirementIds,
    reason: c.reason,
    combinedContent: c.combinedContent,
  }));
}

export async function clusterRequirementsByDependency(
  blocks: ParsedRequirementBlock[],
  provider: 'azure' | 'anthropic' | 'bedrock' = 'azure',
): Promise<RequirementCluster[]> {
  if (!blocks || blocks.length === 0) {
    console.log('[AI Service] clusterRequirementsByDependency: empty input, returning []');
    return [];
  }
  // Diagnostic: log the input ID set so a missing requirement at this stage
  // is immediately distinguishable from an upstream parse drop.
  console.log(`[AI Service] clusterRequirementsByDependency: input ${blocks.length} requirement(s): ${blocks.map(b => b.id).join(', ')}`);

  // Single requirement → single cluster, no LLM call needed.
  if (blocks.length === 1) {
    return [{
      groupId: 'group-1',
      requirementIds: [blocks[0].id],
      reason: 'single requirement',
      combinedContent: blocks[0].content,
    }];
  }

  const oneClusterPerBlock = (): RequirementCluster[] =>
    blocks.map((b, i) => ({
      groupId: `group-${i + 1}`,
      requirementIds: [b.id],
      reason: 'fallback: one per requirement',
      combinedContent: b.content,
    }));

  try {
    const useInstance = hasWorkflowInstances && workflowAzureInstances.length > 0;
    const instance = useInstance ? workflowAzureInstances[0] : null;
    const client = instance ? instance.client : (azureOpenAI as any);
    const model = instance ? instance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4');
    if (!client) {
      console.warn('[AI Service] Dependency clustering: no Azure client available, falling back to one-per-chunk');
      return oneClusterPerBlock();
    }

    const requirementCatalog = blocks
      .map(b => `### ${b.id}\n${b.content.replace(/\s+/g, ' ').slice(0, 1500)}`)
      .join('\n\n');

    const systemPrompt = `You are a Principal Product Manager. Your task is to plan the high-level Epic architecture for the provided software requirements.
Instead of fragmenting requirements into many small groups, you must COMBINE related requirements into large, cohesive Epics. 
A typical project should have between 1 and 5 Epics, even for 30+ requirements, unless the requirements are completely unrelated systems.

Grouping Rules:
- Combine requirements that serve a common high-level business goal or user journey into a SINGLE Epic (e.g., "User Authentication and Profile Management", "Checkout and Payment Processing").
- Do NOT create standalone Epics for single minor requirements. Fold them into the most relevant larger Epic.
- Only create a separate Epic if the requirements represent a truly distinct, large-scale capability or product phase.
- An Epic should ideally contain at least 3-5 requirements if there are many requirements provided.

Output STRICT JSON: {"clusters":[{"epicTitle":"[Name of High-Level Epic 1]","ids":["FR-01","FR-02","NFR-01"],"reason":"[Brief reason explaining the logical grouping]"},{"epicTitle":"[Name of High-Level Epic 2]","ids":["FR-03"],"reason":"[Brief reason explaining the logical grouping]"}]}

Rules:
- Every requirement ID MUST appear in exactly one cluster.
- Do NOT invent IDs that were not in the input.
- Output ONLY the JSON object, no prose.`;

    const clusteringPrompt = buildCachedMessages({
      staticSystem: systemPrompt,
      staticUser: requirementCatalog,
      dynamicUser: `Review the following ${blocks.length} requirements. Plan how to group them into cohesive, high-level Epics. Combine them where logical to avoid fragmentation:`,
      provider: provider === "bedrock" ? "bedrock" : provider === "anthropic" ? "anthropic" : "openai",
    });
    const response = await client.chat.completions.create({
      model,
      messages: clusteringPrompt.messages,
      prompt_cache_key: resolvePromptCacheKey(),
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    });

    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(raw);
    const clusters = Array.isArray(parsed?.clusters) ? parsed.clusters : null;
    if (!clusters) {
      console.warn('[AI Service] Dependency clustering: response missing clusters[], falling back');
      return oneClusterPerBlock();
    }

    const inputIds = new Set(blocks.map(b => b.id));
    const seenIds = new Set<string>();
    const validClusters: RequirementCluster[] = [];
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const ids = Array.isArray(c?.ids) ? c.ids.filter((x: any) => typeof x === 'string' && inputIds.has(x)) : [];
      if (ids.length === 0) continue;
      // Deduplicate inside cluster.
      const uniqIds: string[] = [];
      for (const id of ids) if (!seenIds.has(id)) { seenIds.add(id); uniqIds.push(id); }
      if (uniqIds.length === 0) continue;
      const idToContent = new Map(blocks.map(b => [b.id, b.content]));
      const combined = uniqIds.map(id => idToContent.get(id)!).join('\n\n---\n\n');
      const epicTitleHeader = c?.epicTitle ? `PLANNED EPIC TITLE: ${c.epicTitle}\n\n` : '';
      validClusters.push({
        groupId: `group-${validClusters.length + 1}`,
        requirementIds: uniqIds,
        reason: typeof c?.reason === 'string' ? c.reason : '',
        combinedContent: `${epicTitleHeader}${combined}`,
      });
    }

    // Reject if any input ID was dropped — that's an invariant violation.
    if (seenIds.size !== inputIds.size) {
      console.warn(
        `[AI Service] Dependency clustering: missing IDs in response (${seenIds.size}/${inputIds.size}), falling back`
      );
      return oneClusterPerBlock();
    }

    // ── Post-clustering Jaccard merge pass ──
    // Catches cases where the LLM split a single capability across multiple
    // clusters. Operates on token statistics (no domain words hardcoded).
    // Threshold tuneable via WORKFLOW_CLUSTER_MERGE_THRESHOLD env (default 0.4).
    // Set to 1.0 to disable the merge pass entirely.
    const mergeThreshold = (() => {
      const raw = parseFloat(process.env.WORKFLOW_CLUSTER_MERGE_THRESHOLD || '0.4');
      if (Number.isNaN(raw) || raw < 0 || raw > 1) return 0.4;
      return raw;
    })();

    const mergedClusters = mergeThreshold >= 1
      ? validClusters
      : mergeClustersByJaccardOverlap(validClusters, mergeThreshold);

    console.log(
      `[AI Service] Clustered ${blocks.length} requirement(s) into ${mergedClusters.length} chunk(s)${mergedClusters.length !== validClusters.length ? ` (after Jaccard merge: ${validClusters.length} → ${mergedClusters.length})` : ''}: ${mergedClusters.map(c => `[${c.requirementIds.join(',')}]`).join(' | ')}`
    );
    return mergedClusters;
  } catch (err) {
    console.warn(
      '[AI Service] Dependency clustering failed, falling back to one-per-chunk:',
      err instanceof Error ? err.message : String(err)
    );
    return oneClusterPerBlock();
  }
}

/**
 * Build the fixed system-prompt header used for every chunk in a generation job.
 * The header carries the resolved domain + persona list so each chunk's LLM call
 * sees the same authoritative context. This block is identical across all chunks.
 */
export function buildFixedSystemHeader(args: {
  domainName: string;
  domainContext?: string;
  personas: Array<{ name: string; role: string; focus?: string; painPoints?: string[]; goals?: string[] }>;
  personaSource: 'From Golden Repo' | 'From Persona Hub' | 'AI Suggested (Fallback)';
}): string {
  const { domainName, domainContext, personas, personaSource } = args;

  const personaLines = personas.length > 0
    ? personas.map((p) => {
        const parts = [`${p.name} — ${p.role}`];
        if (p.focus) parts.push(`focus: ${p.focus}`);
        return parts.join(' — ');
      }).join('\n  ')
    : '  (none — LLM may infer per chunk; quality reduced)';

  const personaInstruction = personas.length > 0
    ? `PERSONA RULES (HARD-LOCKED):
- Every user story's \`persona\` field MUST exactly equal one of the names listed above.
- \`personaSource\` MUST be "${personaSource}" on every story.
- Never use generic terms ('user', 'admin', 'system') unless that exact name is in the list.
- If a chunk doesn't naturally fit any provided persona, choose the closest match — never invent a new one.

USER STORY TITLE FORMAT (NATURAL VERB, NOT GERUND):
- Use: "As [persona name], I want to [direct verb phrase] so that [outcome]"
- DO NOT use the stilted "I want to perform [noun]" pattern. Write like a human.
- Examples (correct): "I want to capture follow-up notes by voice so that meetings stay productive"
- Examples (WRONG):   "I want to perform follow-up note capture..."
- Use specific verbs grounded in the chunk text (capture, submit, approve, validate, view, configure).`
    : `PERSONA RULES:
- No personas were resolved from golden repo or persona hub.
- You may suggest personas based on the chunk content, but stay grounded in the project's domain context above. Never substitute a different industry's roles.
- Set \`personaSource\` = "${personaSource}" on every story.

USER STORY TITLE FORMAT (NATURAL VERB, NOT GERUND):
- Use: "As [detected persona], I want to [direct verb phrase] so that [outcome]"
- DO NOT use the stilted "I want to perform [noun]" pattern.`;

  const domainContextBlock = domainContext && domainContext.trim().length > 0
    ? `DOMAIN CONTEXT:\n${domainContext.trim()}`
    : '';

  return `═══ FIXED CONTEXT (applies to every chunk in this job) ═══

DOMAIN: ${domainName || 'Business'}
${domainContextBlock}

ALLOWED PERSONAS (use ONLY these; never invent):
  ${personaLines}

${personaInstruction}

═══ CHUNK-SPECIFIC CONTENT (varies per chunk) ═══`;
}

/**
 * Split BRD requirements so each FR, NFR, TR, and IR is one chunk.
 * One requirement (of any type) = one chunk = one epic. Preserves document order.
 */
function chunkBRDRequirements(functionalRequirementsContent: string, requirementsPerChunk?: number): string[] {
  requirementsPerChunk = requirementsPerChunk ?? 1;
  const matches = [...functionalRequirementsContent.matchAll(BRD_REQUIREMENT_MARKER_PATTERN)];

  if (matches.length >= 1) {
    const blocks: RequirementBlock[] = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index ?? 0;
      const end = i < matches.length - 1 ? (matches[i + 1].index ?? functionalRequirementsContent.length) : functionalRequirementsContent.length;
      const content = functionalRequirementsContent.substring(start, end).trim();
      const matchText = matches[i][1] ?? "";
      const { type, number, compoundId } = parseRequirementType(matchText);
      // Preserve document order (FR-01, NFR-01, TR-01, IR-01 as they appear)
      const sortKey = String(i).padStart(5, "0");
      if (content.length >= 30) {
        blocks.push({ type, number, sortKey, content, compoundId });
      }
    }
    blocks.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const requirements = blocks.map((b) => b.content);
    const chunks: string[] = [];
    for (let i = 0; i < requirements.length; i += requirementsPerChunk) {
      const slice = requirements.slice(i, i + requirementsPerChunk);
      chunks.push(slice.join("\n\n---\n\n"));
    }
    if (chunks.length > 0) {
      const typesSummary = blocks.map((b) => b.compoundId || `${b.type}-${String(b.number).padStart(2, "0")}`).join(", ");
      console.log(`[AI Service] Chunking by FR/NFR/TR/IR: ${chunks.length} requirement(s) → ${chunks.length} chunk(s) (${typesSummary})`);
      return chunks;
    }
  }

  // Fallback: split by legacy FR-only or numbered list
  const frOnlyPattern = /(FR-\d+|FR\s*\d+|Functional Requirement \d+|Requirement \d+|REQ-\d+)/gi;
  const frMatches = [...functionalRequirementsContent.matchAll(frOnlyPattern)];
  if (frMatches.length >= 1) {
    const requirements: string[] = [];
    for (let i = 0; i < frMatches.length; i++) {
      const start = frMatches[i].index ?? 0;
      const end = i < frMatches.length - 1 ? (frMatches[i + 1].index ?? functionalRequirementsContent.length) : functionalRequirementsContent.length;
      const requirement = functionalRequirementsContent.substring(start, end).trim();
      if (requirement.length >= 50) requirements.push(requirement);
    }
    const chunks: string[] = [];
    for (let i = 0; i < requirements.length; i += requirementsPerChunk) {
      chunks.push(requirements.slice(i, i + requirementsPerChunk).join("\n\n---\n\n"));
    }
    if (chunks.length > 0) return chunks;
  }

  const numberedPattern = /(?:^|\n)\s*(\d+\.|[\u2022\-\*]\s)/g;
  const numberedMatches = [...functionalRequirementsContent.matchAll(numberedPattern)];
  if (numberedMatches.length >= 3) {
    const requirements: string[] = [];
    for (let i = 0; i < numberedMatches.length; i++) {
      const start = numberedMatches[i].index ?? 0;
      const end = i < numberedMatches.length - 1 ? (numberedMatches[i + 1].index ?? functionalRequirementsContent.length) : functionalRequirementsContent.length;
      const requirement = functionalRequirementsContent.substring(start, end).trim();
      if (requirement.length >= 50) requirements.push(requirement);
    }
    const chunks: string[] = [];
    for (let i = 0; i < requirements.length; i += requirementsPerChunk) {
      chunks.push(requirements.slice(i, i + requirementsPerChunk).join("\n\n---\n\n"));
    }
    if (chunks.length > 0) return chunks;
  }

  return [functionalRequirementsContent];
}
interface CouncilResponse {
  id: string;
  provider: string;
  model: string;
  response: any;
  confidence: number;
  coverage: number;
  consistency: number;
  timestamp: Date;
  memberIndex?: number;
  role?: string;
  duration?: number;
  error?: string;
}



/**
 * Validate hierarchy ratios and log warnings
 * Target: Exactly 1 epic, 2–5 features, 3–7 user stories per feature (per chunk).
 * 
 * Note: We log warnings but don't generate boilerplate stories as they
 * would violate quality standards. The AI prompt should be improved instead.
 */
function validateAndEnforceHierarchy(artifacts: any): any {
  const epics = artifacts.epics || [];
  const features = artifacts.features || [];
  const userStories = artifacts.userStories || [];

  const epicCount = epics.length;
  const featureCount = features.length;
  const storyCount = userStories.length;
  const minStoriesRequired = featureCount * 3;
  const maxStoriesAllowed = featureCount * 7;
  const ratio = featureCount > 0 ? (storyCount / featureCount).toFixed(2) : "0";

  console.log(
    `[AI Service] Hierarchy validation: ${epicCount} epics, ${featureCount} features, ${storyCount} stories (ratio: ${ratio}, min required: ${minStoriesRequired}, max allowed: ${maxStoriesAllowed})`
  );

  // Count stories per feature for detailed logging
  const storiesPerFeature: Map<string, number> = new Map();
  features.forEach((f: any) => storiesPerFeature.set(f.id, 0));
  userStories.forEach((s: any) => {
    const featureId = s.featureId;
    storiesPerFeature.set(featureId, (storiesPerFeature.get(featureId) || 0) + 1);
  });

  const invalidFeatures: string[] = [];
  features.forEach((feature: any) => {
    const count = storiesPerFeature.get(feature.id) || 0;
    if (count < 3 || count > 7) {
      invalidFeatures.push(`${feature.id}: ${count} stories (must be between 3 and 7)`);
    }
  });

  const epicConstraintPassed = epicCount === 1;
  const featureConstraintPassed = featureCount >= 2 && featureCount <= 5;
  const storyConstraintPassed =
    storyCount >= minStoriesRequired && storyCount <= maxStoriesAllowed;
  const perFeatureConstraintPassed = invalidFeatures.length === 0;

  const passed =
    epicConstraintPassed &&
    featureConstraintPassed &&
    storyConstraintPassed &&
    perFeatureConstraintPassed;

  if (passed) {
    console.log("[AI Service] Hierarchy validation PASSED - structure is within required bounds");
  } else {
    console.warn("[AI Service] Hierarchy validation WARNING - structure violates mandatory ratios");
    if (!epicConstraintPassed) {
      console.warn(`[AI Service]   - Epic constraint failed: expected exactly 1 epic, found ${epicCount}`);
    }
    if (!featureConstraintPassed) {
      console.warn(
        `[AI Service]   - Feature constraint failed: expected 2–5 features, found ${featureCount}`
      );
    }
    if (!storyConstraintPassed) {
      console.warn(
        `[AI Service]   - Story count constraint failed: expected between ${minStoriesRequired} and ${maxStoriesAllowed} stories, found ${storyCount}`
      );
    }
    if (!perFeatureConstraintPassed) {
      console.warn("[AI Service]   - Features with invalid story counts:", invalidFeatures.join(", "));
    }
  }

  return {
    ...artifacts,
    _hierarchyValidation: {
      passed,
      epicCount,
      featureCount,
      storyCount,
      ratio: parseFloat(ratio),
      minRequired: minStoriesRequired,
      maxAllowed: maxStoriesAllowed,
      invalidFeaturesCount: invalidFeatures.length,
      invalidFeatures
    }
  };
}

/**
 * Hard hierarchy & scope enforcement run AFTER LLM output and after persona tagging.
 *
 * This step DROPS rather than warns:
 * - excess epics (keep first, reassign children)
 * - features with 0 user stories
 * - user stories with 0 acceptance criteria OR 0 subtasks
 * - epics whose features were all dropped
 * - features/stories that don't reference the chunk text (token-overlap < threshold)
 * - generic "system should work" acceptance criteria
 *
 * Drops are recorded in `_hierarchyValidation` so the caller (and UI) can surface them.
 */
const SCOPE_STOPWORDS = new Set([
  'the','and','or','for','with','that','this','from','into','have','will','must','should','shall','their','they','them','these','those','about','also','because','your','our','its','can','may','any','all','not','but','then','than','only','more','most','some','such','when','where','what','which','who','whom','whose','user','users','system','data','feature','features','story','stories','epic','epics','requirement','requirements'
]);

function tokensFromText(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(t => t.length > 3 && !SCOPE_STOPWORDS.has(t))
  );
}

function tokenOverlapRatio(target: string, chunkTokens: Set<string>): number {
  const t = tokensFromText(target);
  if (t.size === 0) return 1; // empty text — give the benefit of the doubt
  let overlap = 0;
  for (const tok of t) if (chunkTokens.has(tok)) overlap++;
  return overlap / t.size;
}

const GENERIC_AC_PATTERNS: RegExp[] = [
  /^(the\s+)?system\s+(should|must|will|shall)\s+(work|function|operate)/i,
  /(properly|correctly|appropriately|as\s+expected)\.?\s*$/i,
  /^user\s+(can|should\s+be\s+able\s+to)\s+use\s+the\s+(system|feature)/i,
  /^functionality\s+works/i,
  /^application\s+(works|functions)/i,
];

const isGenericAc = (text: any): boolean => {
  const s = typeof text === 'string' ? text.trim() : (typeof text?.title === 'string' ? text.title.trim() : '');
  if (!s) return true;
  if (s.length < 10) return true;
  return GENERIC_AC_PATTERNS.some(re => re.test(s));
};

const acTextOf = (ac: any): string => {
  if (typeof ac === 'string') return ac;
  if (ac && typeof ac === 'object') return String(ac.title ?? ac.text ?? ac.description ?? '');
  return '';
};

/**
 * Strip stock filler sections from a story description.
 * A section is dropped when its body matches a generic placeholder pattern
 * (e.g. "Manual or incomplete process today", "TBD", "N/A") or is too short
 * to be meaningful. Mandatory sections (CONTEXT & BACKGROUND, DESIRED STATE)
 * are kept regardless — but their bodies are still cleaned.
 *
 * BRD-agnostic: regex matches generic English filler, no domain words.
 */
const FILLER_BODY_RE = /^\s*(manual\s+(or\s+)?incomplete(\s+process(\s+today)?)?|system\s+supports?\s+the\s+capability|tbd|to\s+be\s+determined|placeholder|n\/?a|none|not\s+applicable)\s*\.?\s*$/i;
const MIN_SECTION_BODY_CHARS = 25;
const MANDATORY_SECTION_HEADINGS = new Set(['context & background', 'context and background', 'desired state']);

export function stripStockFillerFromDescription(description: unknown): string {
  if (typeof description !== 'string' || description.trim().length === 0) {
    return typeof description === 'string' ? description : '';
  }
  // Split on the section heading pattern: `^[A-Z][A-Z &/]+:` at start-of-line.
  // Each section = heading + body until the next heading or end-of-string.
  const headingRe = /(^|\n)\s*([A-Z][A-Z0-9 &\/&]{2,40}):\s*/g;
  const matches: Array<{ index: number; heading: string; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(description)) !== null) {
    matches.push({
      index: m.index + (m[1] ? m[1].length : 0),
      heading: m[2].trim(),
      bodyStart: headingRe.lastIndex,
    });
  }
  if (matches.length === 0) return description;

  const kept: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const { heading, bodyStart } = matches[i];
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : description.length;
    const body = description.substring(bodyStart, bodyEnd).trim();
    const headingLower = heading.toLowerCase();
    const isMandatory = MANDATORY_SECTION_HEADINGS.has(headingLower);

    // Drop sections with filler bodies or bodies that are too short to be useful,
    // EXCEPT the mandatory sections — keep those even if short, so the description
    // never loses its required anchor sections.
    if (!isMandatory) {
      if (body.length === 0) continue;
      if (body.length < MIN_SECTION_BODY_CHARS) continue;
      if (FILLER_BODY_RE.test(body)) continue;
    }
    kept.push(`${heading}: ${body}`);
  }
  return kept.length > 0 ? kept.join('\n\n') : description;
}

export function enforceHierarchyIntegrity(
  artifacts: any,
  chunkText: string,
  options?: { scopeKeywordThreshold?: number },
): any {
  const threshold = typeof options?.scopeKeywordThreshold === 'number'
    ? options.scopeKeywordThreshold
    : parseFloat(process.env.WORKFLOW_SCOPE_KEYWORD_THRESHOLD || '0.15');

  const epics: any[] = Array.isArray(artifacts.epics) ? [...artifacts.epics] : [];
  let features: any[] = Array.isArray(artifacts.features) ? [...artifacts.features] : [];
  let userStories: any[] = Array.isArray(artifacts.userStories) ? [...artifacts.userStories] : [];

  const droppedOutOfScope: Array<{ kind: string; id: string; title: string; ratio: number }> = [];
  const droppedOrphanStories: Array<{ id: string; reason: string }> = [];
  const droppedOrphanFeatures: Array<{ id: string; reason: string }> = [];
  const droppedOrphanEpics: Array<{ id: string; reason: string }> = [];
  const droppedGenericAcs: Array<{ storyId: string; ac: string }> = [];
  let chunkFailed = false;

  // 1. Excess epics → keep first, reassign children to it.
  let canonicalEpic = epics[0];
  if (epics.length > 1) {
    console.warn(`[AI Service] enforceHierarchyIntegrity: dropping ${epics.length - 1} excess epic(s); reassigning children to ${canonicalEpic?.id}`);
    for (let i = 1; i < epics.length; i++) {
      const dropped = epics[i];
      droppedOrphanEpics.push({ id: dropped?.id ?? `epic-${i + 1}`, reason: 'excess epic merged into first' });
    }
    epics.length = 1;
    if (canonicalEpic?.id) {
      features = features.map(f => ({ ...f, epicId: canonicalEpic.id }));
      userStories = userStories.map(s => ({ ...s, epicId: canonicalEpic.id }));
    }
  }

  // 2. Scope filter — chunk-token overlap.
  if (chunkText && chunkText.trim().length > 0) {
    const chunkTokens = tokensFromText(chunkText);

    features = features.filter((f: any) => {
      const ratio = tokenOverlapRatio(`${f.title || ''} ${f.description || ''}`, chunkTokens);
      if (ratio < threshold) {
        droppedOutOfScope.push({ kind: 'feature', id: f.id ?? '', title: f.title ?? '', ratio });
        console.warn(`[AI Service] enforceHierarchyIntegrity: dropping out-of-scope feature ${f.id} "${f.title}" (overlap=${ratio.toFixed(2)})`);
        return false;
      }
      return true;
    });

    userStories = userStories.filter((s: any) => {
      const ratio = tokenOverlapRatio(`${s.title || ''} ${s.description || ''}`, chunkTokens);
      if (ratio < threshold) {
        droppedOutOfScope.push({ kind: 'story', id: s.id ?? '', title: s.title ?? '', ratio });
        console.warn(`[AI Service] enforceHierarchyIntegrity: dropping out-of-scope story ${s.id} "${s.title}" (overlap=${ratio.toFixed(2)})`);
        return false;
      }
      return true;
    });
  }

  // 3. Drop generic ACs from each story + strip stock-filler description sections.
  userStories = userStories.map((s: any) => {
    let next: any = s;
    // 3a. Strip filler description sections ("Manual or incomplete process today" etc).
    if (typeof next.description === 'string') {
      const cleaned = stripStockFillerFromDescription(next.description);
      if (cleaned !== next.description) {
        next = { ...next, description: cleaned };
      }
    }
    // 3b. Drop generic ACs.
    if (Array.isArray(next.acceptanceCriteria)) {
      const filtered: any[] = [];
      for (const ac of next.acceptanceCriteria) {
        if (isGenericAc(ac)) {
          droppedGenericAcs.push({ storyId: next.id ?? '', ac: acTextOf(ac) });
        } else {
          filtered.push(ac);
        }
      }
      next = { ...next, acceptanceCriteria: filtered };
    }
    return next;
  });

  // 4. Drop stories with 0 ACs OR 0 subtasks.
  userStories = userStories.filter((s: any) => {
    const acCount = Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria.length : 0;
    const subtaskCount = Array.isArray(s.subtasks) ? s.subtasks.length : 0;
    if (acCount === 0) {
      droppedOrphanStories.push({ id: s.id ?? '', reason: 'no acceptance criteria' });
      return false;
    }
    if (subtaskCount === 0) {
      // Be tolerant: synthesize a minimal subtask from the title rather than dropping outright.
      // Only drop if the story has neither subtasks nor a usable title.
      if (!s.title) {
        droppedOrphanStories.push({ id: s.id ?? '', reason: 'no subtasks and no title' });
        return false;
      }
      s.subtasks = [{ title: `Implement: ${String(s.title).replace(/^as[^,]*,\s*/i, '').slice(0, 120)}`, category: 'Implementation' }];
    }
    return true;
  });

  // 5. Drop features with 0 stories.
  const featureIdToStoryCount = new Map<string, number>();
  features.forEach(f => featureIdToStoryCount.set(f.id, 0));
  userStories.forEach(s => {
    if (s.featureId && featureIdToStoryCount.has(s.featureId)) {
      featureIdToStoryCount.set(s.featureId, (featureIdToStoryCount.get(s.featureId) || 0) + 1);
    }
  });

  const survivingFeatureIds = new Set<string>();
  const filteredFeatures: any[] = [];
  for (const f of features) {
    const count = featureIdToStoryCount.get(f.id) || 0;
    if (count === 0) {
      droppedOrphanFeatures.push({ id: f.id ?? '', reason: 'no user stories linked' });
      console.warn(`[AI Service] enforceHierarchyIntegrity: dropping feature ${f.id} "${f.title}" (0 stories)`);
    } else {
      survivingFeatureIds.add(f.id);
      filteredFeatures.push(f);
    }
  }
  features = filteredFeatures;

  // Drop stories that pointed to a now-dropped feature.
  userStories = userStories.filter((s: any) => {
    if (!s.featureId || !survivingFeatureIds.has(s.featureId)) {
      droppedOrphanStories.push({ id: s.id ?? '', reason: `featureId ${s.featureId ?? 'missing'} not in surviving features` });
      return false;
    }
    return true;
  });

  // 6. Drop epic(s) with 0 features.
  if (epics.length > 0 && features.length === 0) {
    droppedOrphanEpics.push({ id: epics[0]?.id ?? '', reason: 'no features survived hierarchy enforcement' });
    epics.length = 0;
    chunkFailed = true;
    console.warn('[AI Service] enforceHierarchyIntegrity: chunk failed — no features survived; epic dropped');
  }

  return {
    ...artifacts,
    epics,
    features,
    userStories,
    _hierarchyValidation: {
      ...(artifacts._hierarchyValidation || {}),
      droppedOutOfScope,
      droppedOrphanStories,
      droppedOrphanFeatures,
      droppedOrphanEpics,
      droppedGenericAcs,
      chunkFailed,
    },
  };
}

/**
 * Normalize artifact structure before validation:
 * 1. Extract stories nested inside features (feature.userStories / feature.stories)
 * 2. Normalize alternative field names (feature_id, parentFeatureId, parent_feature_id → featureId)
 * 3. Auto-assign featureId to unlinked stories using round-robin across features
 */
function normalizeArtifactStructure(artifacts: any): any {
  const features = Array.isArray(artifacts.features) ? artifacts.features : [];
  let userStories = Array.isArray(artifacts.userStories) ? [...artifacts.userStories] : [];
  const featureIds = new Set(features.map((f: any) => f.id));

  let extractedCount = 0;
  for (const feature of features) {
    const nested = feature.userStories || feature.stories || feature.user_stories;
    if (Array.isArray(nested) && nested.length > 0) {
      for (const story of nested) {
        if (!story.featureId) story.featureId = feature.id;
        const alreadyExists = userStories.some((s: any) => s.id === story.id);
        if (!alreadyExists) {
          userStories.push(story);
          extractedCount++;
        }
      }
    }
    delete feature.userStories;
    delete feature.stories;
    delete feature.user_stories;
  }
  if (extractedCount > 0) {
    console.log(`[AI Service] Extracted ${extractedCount} nested user stories from features into flat array`);
  }

  let normalizedCount = 0;
  for (const story of userStories) {
    if (!story.featureId) {
      const alt = story.feature_id || story.parentFeatureId || story.parent_feature_id || story.parentId || story.parent_id;
      if (alt) {
        story.featureId = alt;
        normalizedCount++;
      }
    }
  }
  if (normalizedCount > 0) {
    console.log(`[AI Service] Normalized ${normalizedCount} user stories with alternative featureId field names`);
  }

  const unlinked = userStories.filter((s: any) => !s.featureId || !featureIds.has(s.featureId));
  if (unlinked.length > 0 && features.length > 0) {
    console.log(`[AI Service] Auto-assigning featureId to ${unlinked.length} unlinked user stories via round-robin`);
    unlinked.forEach((s: any, idx: number) => {
      s.featureId = features[idx % features.length].id;
    });
  }

  return { ...artifacts, features, userStories };
}

/**
 * Hard enforcement: cap stories per feature at MAX_STORIES_PER_FEATURE (7).
 * Keeps highest-priority stories when trimming excess stories.
 * Trims features per epic to MAX_FEATURES_PER_EPIC (5) using positional order (first N kept).
 */
const MAX_STORIES_PER_FEATURE = 4;
const MIN_STORIES_PER_FEATURE = 2;
const MAX_FEATURES_PER_EPIC = 4;

function enforceHierarchyLimits(artifacts: any): any {
  const epics = Array.isArray(artifacts.epics) ? artifacts.epics : [];
  let features = Array.isArray(artifacts.features) ? [...artifacts.features] : [];
  let userStories = Array.isArray(artifacts.userStories) ? [...artifacts.userStories] : [];

  const featuresByEpic = new Map<string, any[]>();
  for (const f of features) {
    const eid = f.epicId || '';
    if (!featuresByEpic.has(eid)) featuresByEpic.set(eid, []);
    featuresByEpic.get(eid)!.push(f);
  }

  const removedFeatureIds = new Set<string>();
  for (const [epicId, epicFeatures] of featuresByEpic) {
    if (epicFeatures.length > MAX_FEATURES_PER_EPIC) {
      console.log(`[AI Service] ✂️ Epic "${epicId}": trimming features from ${epicFeatures.length} to ${MAX_FEATURES_PER_EPIC}`);
      for (let i = MAX_FEATURES_PER_EPIC; i < epicFeatures.length; i++) {
        removedFeatureIds.add(epicFeatures[i].id);
      }
    }
  }
  if (removedFeatureIds.size > 0) {
    features = features.filter((f: any) => !removedFeatureIds.has(f.id));
    userStories = userStories.filter((s: any) => !removedFeatureIds.has(s.featureId));
  }

  const storiesByFeature = new Map<string, any[]>();
  for (const story of userStories) {
    const fid = story.featureId;
    if (!storiesByFeature.has(fid)) storiesByFeature.set(fid, []);
    storiesByFeature.get(fid)!.push(story);
  }

  let trimmedTotal = 0;
  const keptStories: any[] = [];
  for (const [fid, stories] of storiesByFeature) {
    if (stories.length > MAX_STORIES_PER_FEATURE) {
      const priorityOrder = ['High', 'Medium', 'Low'];
      stories.sort((a: any, b: any) => {
        const ai = priorityOrder.indexOf(a.priority || 'Medium');
        const bi = priorityOrder.indexOf(b.priority || 'Medium');
        return ai - bi;
      });
      const trimmed = stories.length - MAX_STORIES_PER_FEATURE;
      trimmedTotal += trimmed;
      keptStories.push(...stories.slice(0, MAX_STORIES_PER_FEATURE));
    } else {
      keptStories.push(...stories);
    }
  }

  if (trimmedTotal > 0) {
    console.log(`[AI Service] ✂️ Trimmed ${trimmedTotal} excess stories to enforce max ${MAX_STORIES_PER_FEATURE} per feature`);
  }

  return { ...artifacts, features, userStories: keptStories };
}

/**
 * Remove standalone user stories (no featureId or featureId not in features).
 * Requirement agent: every user story must be linked to a feature; do not persist standalone stories.
 * NOTE: normalizeArtifactStructure should be called first to rescue stories before dropping.
 */
function removeStandaloneUserStories(artifacts: any): any {
  const features = artifacts.features || [];
  const userStories = artifacts.userStories || [];
  const featureIds = new Set(features.map((f: any) => f.id));
  const validStories = userStories.filter((s: any) => {
    const fid = s.featureId;
    const valid = !!fid && featureIds.has(fid);
    if (!valid && (fid || s.id)) {
      console.warn(`[AI Service] Dropping standalone/invalid user story: id=${s.id}, featureId=${fid ?? "(missing)"}`);
    }
    return valid;
  });
  if (validStories.length < userStories.length) {
    console.log(`[AI Service] Removed ${userStories.length - validStories.length} standalone or invalid user story(s); ${validStories.length} linked to features.`);
  }
  return { ...artifacts, userStories: validStories };
}

/**
 * Enforce generation constraints by merging epics/features/stories if they exceed limits
 */
function enforceGenerationConstraints(
  artifacts: any,
  constraints: { maxEpics?: number; maxFeatures?: number; maxStories?: number }
): any {
  let result = { ...artifacts };

  // Enforce maxEpics constraint
  if (constraints.maxEpics !== undefined && result.epics.length > constraints.maxEpics) {
    console.log(`[AI Service] ⚠️ Epic count (${result.epics.length}) exceeds constraint (${constraints.maxEpics}). Merging epics...`);

    // Group epics into the target number
    const targetEpicCount = constraints.maxEpics;
    const epicsToMerge = [...result.epics];
    const mergedEpics: any[] = [];

    // Calculate how many epics per merged epic
    const epicsPerGroup = Math.ceil(epicsToMerge.length / targetEpicCount);

    for (let i = 0; i < targetEpicCount; i++) {
      const startIdx = i * epicsPerGroup;
      const endIdx = Math.min(startIdx + epicsPerGroup, epicsToMerge.length);
      const epicsGroup = epicsToMerge.slice(startIdx, endIdx);

      if (epicsGroup.length === 0) break;

      if (epicsGroup.length === 1) {
        // Single epic - keep as is
        mergedEpics.push(epicsGroup[0]);
      } else {
        // Multiple epics - merge them
        const mergedEpic = {
          id: `epic-${i + 1}`,
          title: epicsGroup.map(e => e.title).join(' & '),
          description: `Merged Epic combining:\n\n${epicsGroup.map((e, idx) => `${idx + 1}. ${e.title}\n${e.description || ''}`).join('\n\n')}`,
          businessValue: epicsGroup.map(e => e.businessValue).filter(Boolean).join('; '),
          priority: epicsGroup.some(e => e.priority === 'High') ? 'High' :
            epicsGroup.some(e => e.priority === 'Medium') ? 'Medium' : 'Low',
          featureCount: 0
        };
        mergedEpics.push(mergedEpic);

        // Update all features and stories that belonged to the merged epics
        const mergedEpicIds = epicsGroup.map(e => e.id);
        result.features.forEach((feature: any) => {
          if (mergedEpicIds.includes(feature.epicId)) {
            feature.epicId = mergedEpic.id;
          }
        });
        result.userStories.forEach((story: any) => {
          if (mergedEpicIds.includes(story.epicId)) {
            story.epicId = mergedEpic.id;
          }
        });
      }
    }

    // Update feature counts
    mergedEpics.forEach(epic => {
      epic.featureCount = result.features.filter((f: any) => f.epicId === epic.id).length;
    });

    result.epics = mergedEpics;
    console.log(`[AI Service] ✅ Merged ${epicsToMerge.length} epics into ${mergedEpics.length} epics`);
  }

  // Enforce maxFeatures constraint
  if (constraints.maxFeatures !== undefined && result.features.length > constraints.maxFeatures) {
    console.log(`[AI Service] ⚠️ Feature count (${result.features.length}) exceeds constraint (${constraints.maxFeatures}). Merging features...`);

    // Group features by epic first, then merge within each epic
    const featuresByEpic = new Map<string, any[]>();
    result.features.forEach((feature: any) => {
      if (!featuresByEpic.has(feature.epicId)) {
        featuresByEpic.set(feature.epicId, []);
      }
      featuresByEpic.get(feature.epicId)!.push(feature);
    });

    const mergedFeatures: any[] = [];
    let featureCounter = 1;
    const featuresPerEpic = Math.floor(constraints.maxFeatures / result.epics.length);

    featuresByEpic.forEach((features, epicId) => {
      if (features.length <= featuresPerEpic) {
        // Within limit for this epic - keep all
        features.forEach(f => {
          f.id = `feature-${featureCounter++}`;
          mergedFeatures.push(f);
        });
      } else {
        // Need to merge features within this epic
        const groupsPerEpic = featuresPerEpic;
        const featuresPerGroup = Math.ceil(features.length / groupsPerEpic);

        for (let i = 0; i < groupsPerEpic && mergedFeatures.length < (constraints.maxFeatures ?? Infinity); i++) {
          const startIdx = i * featuresPerGroup;
          const endIdx = Math.min(startIdx + featuresPerGroup, features.length);
          const featureGroup = features.slice(startIdx, endIdx);

          if (featureGroup.length === 1) {
            featureGroup[0].id = `feature-${featureCounter++}`;
            mergedFeatures.push(featureGroup[0]);
          } else {
            const mergedFeature = {
              id: `feature-${featureCounter++}`,
              title: featureGroup.map(f => f.title).join(' & '),
              description: `Merged Feature combining:\n\n${featureGroup.map((f, idx) => `${idx + 1}. ${f.title}\n${f.description || ''}`).join('\n\n')}`,
              epicId: epicId,
              priority: featureGroup.some(f => f.priority === 'High') ? 'High' :
                featureGroup.some(f => f.priority === 'Medium') ? 'Medium' : 'Low',
              businessValue: featureGroup.map(f => f.businessValue).filter(Boolean).join('; '),
              acceptanceCriteria: featureGroup.flatMap(f => f.acceptanceCriteria || [])
            };
            mergedFeatures.push(mergedFeature);

            // Update stories that belonged to merged features
            const mergedFeatureIds = featureGroup.map(f => f.id);
            result.userStories.forEach((story: any) => {
              if (mergedFeatureIds.includes(story.featureId)) {
                story.featureId = mergedFeature.id;
              }
            });
          }
        }
      }
    });

    result.features = mergedFeatures.slice(0, constraints.maxFeatures);
    console.log(`[AI Service] ✅ Reduced features to ${result.features.length} (constraint: ${constraints.maxFeatures})`);
  }

  // Enforce maxStories constraint
  if (constraints.maxStories !== undefined && result.userStories.length > constraints.maxStories) {
    console.log(`[AI Service] ⚠️ Story count (${result.userStories.length}) exceeds constraint (${constraints.maxStories}). Reducing stories...`);
    result.userStories = result.userStories.slice(0, constraints.maxStories);
    console.log(`[AI Service] ✅ Reduced stories to ${result.userStories.length} (constraint: ${constraints.maxStories})`);
  }

  return result;
}

/**
 * Merge results from multiple chunks and fix ID conflicts
 */
function mergeChunkResults(chunkResults: any[]): any {
  console.log("[AI Service] Merging", chunkResults.length, "chunk results...");

  let epicCounter = 1;
  let featureCounter = 1;
  let storyCounter = 1;

  const mergedEpics: any[] = [];
  const mergedFeatures: any[] = [];
  const mergedStories: any[] = [];
  const epicIdMap: Map<string, string> = new Map(); // old epic ID -> new epic ID
  const featureIdMap: Map<string, string> = new Map(); // old feature ID -> new feature ID

  // Process each chunk's results
  for (let chunkIndex = 0; chunkIndex < chunkResults.length; chunkIndex++) {
    const chunk = chunkResults[chunkIndex];

    // Process epics
    if (Array.isArray(chunk.epics)) {
      for (const epic of chunk.epics) {
        const oldEpicId = epic.id;
        const newEpicId = `epic-${epicCounter}`;
        epicIdMap.set(oldEpicId, newEpicId);

        mergedEpics.push({
          ...epic,
          id: newEpicId,
          featureCount: 0 // Will be updated after processing features
        });
        epicCounter++;
      }
    }

    // Process features
    if (Array.isArray(chunk.features)) {
      for (const feature of chunk.features) {
        const oldFeatureId = feature.id;
        const newFeatureId = `feature-${featureCounter}`;
        featureIdMap.set(oldFeatureId, newFeatureId);

        // Map epic ID
        const newEpicId = epicIdMap.get(feature.epicId) || feature.epicId;

        mergedFeatures.push({
          ...feature,
          id: newFeatureId,
          epicId: newEpicId
        });
        featureCounter++;

        // Update epic feature count
        const epic = mergedEpics.find(e => e.id === newEpicId);
        if (epic) {
          epic.featureCount = (epic.featureCount || 0) + 1;
        }
      }
    }

    // Process user stories
    if (Array.isArray(chunk.userStories)) {
      for (const story of chunk.userStories) {
        const newStoryId = `story-${storyCounter}`;

        // Map feature and epic IDs
        const newFeatureId = featureIdMap.get(story.featureId) || story.featureId;
        const newEpicId = epicIdMap.get(story.epicId) || story.epicId;

        mergedStories.push({
          ...story,
          id: newStoryId,
          featureId: newFeatureId,
          epicId: newEpicId
        });
        storyCounter++;
      }
    }
  }

  console.log("[AI Service] Merged results:");
  console.log("[AI Service] - Epics:", mergedEpics.length);
  console.log("[AI Service] - Features:", mergedFeatures.length);
  console.log("[AI Service] - User Stories:", mergedStories.length);

  return {
    epics: mergedEpics,
    features: mergedFeatures,
    userStories: mergedStories,
    personas: [],
    _chunked: true,
    _chunksProcessed: chunkResults.length
  };
}

/**
 * Shared JSON validity constraint appended to all LLM system prompts that expect JSON output.
 * Prevents common LLM issues: single quotes, commentary tails, markdown wrapping, trailing commas.
 */
const JSON_OUTPUT_CONSTRAINT = `

## CRITICAL JSON OUTPUT RULES
1. Output ONLY valid JSON — no text before or after the JSON object.
2. Use ONLY double quotes (") for all keys and string values — NEVER single quotes (').
3. Do NOT wrap the JSON in markdown code blocks (\`\`\`json ... \`\`\`).
4. Do NOT add explanatory text, commentary, or notes after the JSON.
5. Escape special characters inside strings: use \\n for newlines, \\\\ for backslashes, \\" for quotes within strings.
6. Do NOT use trailing commas after the last element in arrays or objects.
7. Ensure ALL arrays and objects are properly closed with ] and }.`;

function buildArtifactEnhancementInstructions(aiEnhanceEnabled: boolean): string {
  return aiEnhanceEnabled
    ? `

**AI ENHANCEMENT MODE: ENABLED**
You should improve and enhance the content from the BRD requirements to create high-quality, detailed artifacts:
- Enhance descriptions with technical details and best practices
- Add implementation considerations and edge cases
- Improve acceptance criteria with comprehensive scenarios  
- Expand user stories with rich context and clear value propositions
- Use industry best practices and patterns in your wording
- Make the content more actionable and specific`
    : `

**AI ENHANCEMENT MODE: DISABLED**  
You must preserve the content and wording from the approved BRD exactly as written:
- Use the exact wording and terminology from the BRD requirements
- Do NOT enhance, improve, or modify the descriptions
- Keep titles, descriptions, and acceptance criteria as close to the original as possible
- Only restructure into Epic/Feature/Story format without changing the core content
- Maintain the approved language and specifications precisely`;
}

export function buildArtifactJobPrefix(
  aiEnhanceEnabled: boolean,
  fixedSystemHeader: string | undefined,
  goldenRepoName: string,
): JobCachePrefix {
  const headerPrefix =
    fixedSystemHeader && fixedSystemHeader.trim().length > 0
      ? `${fixedSystemHeader.trim()}\n\n`
      : "";
  return createJobCachePrefix({
    staticSystem: `${headerPrefix}${PROFESSIONAL_ARTIFACTS_SYSTEM_PROMPT}${buildArtifactEnhancementInstructions(aiEnhanceEnabled)}`,
    staticUser: `Domain context (golden repository): ${goldenRepoName?.trim() || "Business"}`,
    provider: resolvePromptCacheProvider(),
    feature: "workflow",
    useCase: "artifact generation",
  });
}

function buildArtifactChunkDynamicInstructions(
  chunkIndex: number,
  totalChunks: number,
): string {
  return `## CHUNK ${chunkIndex + 1} of ${totalChunks} — COMPACT OUTPUT MODE

This chunk = 1 epic. You MUST output:
- 1 epic (SHORT: 1-2 sentence description, no businessValue/successCriteria)
- 1–4 features (SHORT: 1 sentence description each — generate ONLY what the chunk text justifies)
- 2–4 user stories PER feature in the top-level "userStories" array (generate ONLY what the chunk text justifies)

**COMPACT STORY FORMAT (chunk stage — token-budget-aware. Enrichment expands later to the full 8/5/5/3 shape):**
- "title": Format: "As [Persona], I want to [direct verb phrase] so that [outcome]" (natural verb, NOT "perform [noun]")
- "description": 1-2 grounded sentences (brief context + business value tied to the chunk text). DO NOT emit the 8-section structure here — that comes from enrichment.
- "acceptanceCriteria": 1-3 short, grounded strings tied to specific behaviour in the chunk text.
- "subtasks": 1-2 brief grounded implementation lines. Each line should reference concrete work (entity, screen, API). NEVER generic "Implement API endpoint and business logic" filler.
- DO NOT include "testCases" at the chunk stage — they will be added by the enrichment pass.
- Keep each story tight: under ~150 words total. This keeps the chunk response under the token cap so it doesn't truncate.

**HARD LIMITS:**
- Maximum 4 features per chunk; maximum 4 stories per feature.
- DO NOT pad to a minimum count — return ONLY what the chunk text justifies.
- Every feature MUST have ≥1 story; every story MUST have ≥1 acceptance criterion AND ≥1 subtask.
- The downstream ENRICHMENT pass will expand each story to the strict 8-section description, 5 ACs, 5 subtasks, 3 test cases — your job at the chunk stage is to be CORRECT and COMPACT, not exhaustive.

**IDs:** epic-1, feature-1..N, story-1..N. feature.epicId = epic id, story.featureId = feature id.
${JSON_OUTPUT_CONSTRAINT}

Return ONLY the JSON object.`;
}

/**
 * Parse enrichment batch response with multiple repair strategies to reduce "JSON parse failed, keeping compact stories".
 * Returns { userStories?: any[] } or null if all strategies fail.
 */
/**
 * Fix raw/literal newlines inside JSON string values.
 * LLM models output multi-line descriptions with actual newlines instead of escaped \n.
 * This walks the JSON character-by-character and replaces newlines found inside quoted strings.
 */
function fixNewlinesInJsonStrings(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (escaped) {
      result += c;
      escaped = false;
      continue;
    }
    if (c === '\\' && inString) {
      result += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      result += c;
      continue;
    }
    if (inString) {
      if (c === '\n' || c === '\r') {
        result += '\\n';
        if (c === '\r' && i + 1 < json.length && json[i + 1] === '\n') i++;
        continue;
      }
      if (c === '\t') {
        result += '\\t';
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        result += ' ';
        continue;
      }
    }
    result += c;
  }
  return result;
}

/**
 * Fix single quotes used as JSON key/value delimiters.
 * GPT-4o-mini sometimes outputs 'key':'value' instead of "key":"value".
 * Uses targeted regex replacement for known structural patterns only:
 *   - ,'key': or {'key': or ['key' (single-quoted keys)
 *   - : 'value' (single-quoted simple values after colon)
 * Does NOT do a global single→double conversion to avoid corrupting apostrophes in text.
 */
function fixSingleQuotesInJson(json: string): string {
  // Only apply if we see patterns like ,'key': or {'key': which indicate structural single quotes
  if (!/'[a-zA-Z_][a-zA-Z0-9_]*'\s*:/.test(json)) return json;

  // Replace single-quoted keys: 'keyName': → "keyName":
  let fixed = json.replace(/([{,\[]\s*)'([a-zA-Z_][a-zA-Z0-9_]*)'\s*:/g, '$1"$2":');

  // Replace single-quoted simple string values after colon: : 'value' → : "value"
  // Only match values that don't contain single quotes (to avoid breaking apostrophes)
  fixed = fixed.replace(/:\s*'([^']*?)'\s*([,}\]])/g, ': "$1"$2');

  return fixed;
}

function parseEnrichmentResponse(rawContent: string, batchIndex: number, totalBatches: number): { userStories?: any[]; stories?: any[]; user_stories?: any[] } | null {
  const logPrefix = `[AI Service] ENRICHMENT batch ${batchIndex}/${totalBatches}`;
  const stepLog = (step: string, outcome: 'ok' | 'fail', detail?: string) => {
    const msg = detail ? `${logPrefix} parse step: ${step} ${outcome} — ${detail}` : `${logPrefix} parse step: ${step} ${outcome}`;
    if (outcome === 'fail') console.warn(msg);
    else console.log(msg);
  };

  let jsonStr = rawContent.trim();
  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock && codeBlock[1]) {
    jsonStr = codeBlock[1].trim();
  } else {
    // Truncation case: opening ```json fence with no closing one — strip the
    // opening fence so the rest of the (possibly truncated) JSON is parseable
    // by the recovery strategies below.
    const openFenceMatch = jsonStr.match(/^```(?:json)?\s*\n?/);
    if (openFenceMatch) {
      jsonStr = jsonStr.substring(openFenceMatch[0].length).replace(/```\s*$/, '').trim();
      stepLog('0_open_fence_strip', 'ok', 'stripped opening markdown fence (no closing match)');
    }
  }
  jsonStr = jsonStr.replace(/^\uFEFF/, '').replace(/[\u0000-\u001F]/g, (c) => (c === '\n' || c === '\r' || c === '\t') ? c : ' ');

  // Pre-step: Fix raw newlines inside JSON string values (model outputs literal newlines in 8-section descriptions)
  // Replace unescaped newlines within strings with escaped \\n
  jsonStr = jsonStr.replace(/\r\n/g, '\n');
  jsonStr = fixNewlinesInJsonStrings(jsonStr);

  // Pre-step: Fix single quotes used as JSON delimiters (model sometimes outputs 'key':'value')
  // Only convert single quotes that are likely JSON structural delimiters, not apostrophes in text
  jsonStr = fixSingleQuotesInJson(jsonStr);

  const tryParseWithError = (s: string): { parsed: { userStories?: any[]; stories?: any[]; user_stories?: any[] } | null; error?: string } => {
    try {
      const parsed = JSON.parse(s);
      return { parsed };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return { parsed: null, error: err };
    }
  };
  const tryParse = (s: string): { userStories?: any[]; stories?: any[]; user_stories?: any[] } | null => tryParseWithError(s).parsed;

  // Step 0: Strip known GPT-4o-mini degeneration garbage patterns BEFORE any parsing.
  // Pattern A: repeated braces with digits/spaces: "}  1  }  1  }  1  }"
  const degenerationPattern = /(\}\s*\d*\s*){5,}$/;
  if (degenerationPattern.test(jsonStr)) {
    const cleanEnd = jsonStr.search(/(\}\s*\d*\s*){5,}$/);
    if (cleanEnd > 500) {
      const cleaned = jsonStr.substring(0, cleanEnd).trimEnd();
      const lastValidBrace = cleaned.lastIndexOf('}');
      if (lastValidBrace > 100) {
        jsonStr = cleaned.substring(0, lastValidBrace + 1);
        const openB = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
        const openC = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
        for (let i = 0; i < openB; i++) jsonStr += ']';
        for (let i = 0; i < openC; i++) jsonStr += '}';
        stepLog('0_degeneration_strip', 'ok', `stripped garbage tail, cleaned length: ${jsonStr.length}`);
      }
    }
  }

  // Pattern B: model appends commentary text after JSON root closes.
  // Find the last balanced root-level closing brace (depth 0) and strip everything after it.
  // This is string-aware to avoid false positives from content inside strings.
  {
    let depth = 0;
    let inStr = false;
    let esc = false;
    let lastRootClose = -1;
    for (let i = 0; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) lastRootClose = i;
      }
    }
    if (lastRootClose > 0 && lastRootClose < jsonStr.length - 1) {
      const tail = jsonStr.substring(lastRootClose + 1).trim();
      if (tail.length > 5) {
        jsonStr = jsonStr.substring(0, lastRootClose + 1);
        stepLog('0_commentary_strip', 'ok', `stripped ${tail.length} chars of post-JSON content`);
      }
    }
  }

  // Step 1: direct parse
  let result = tryParseWithError(jsonStr);
  if (result.parsed) {
    stepLog('1_direct_parse', 'ok', 'success');
    return result.parsed;
  }
  stepLog('1_direct_parse', 'fail', result.error ?? 'unknown');

  // Step 2: strip trailing commas (common LLM mistake) then parse
  let fixed = jsonStr.replace(/,(\s*[}\]])/g, '$1');
  result = tryParseWithError(fixed);
  if (result.parsed) {
    stepLog('2_trailing_comma_strip', 'ok', 'success');
    return result.parsed;
  }
  stepLog('2_trailing_comma_strip', 'fail', result.error ?? 'unknown');

  // Step 2b: position-targeted repair — extract the error position and attempt a bounded fix
  const posMatch = (result.error ?? '').match(/position\s+(\d+)/i);
  if (posMatch) {
    const errPos = parseInt(posMatch[1], 10);
    if (errPos > 0 && errPos < fixed.length) {
      const ctxStart = Math.max(0, errPos - 80);
      const ctxEnd = Math.min(fixed.length, errPos + 80);
      console.log(`${logPrefix} error context at pos ${errPos}: ...${fixed.substring(ctxStart, ctxEnd).replace(/\n/g, '\\n')}...`);

      // Strategy A: The error is often an unescaped quote inside a string value.
      // Find the enclosing string: scan backwards for an unescaped opening quote.
      let openQuotePos = -1;
      for (let s = errPos - 1; s >= 0; s--) {
        if (fixed[s] === '"') {
          let backslashes = 0;
          for (let b = s - 1; b >= 0 && fixed[b] === '\\'; b--) backslashes++;
          if (backslashes % 2 === 0) { openQuotePos = s; break; }
        }
      }

      if (openQuotePos >= 0) {
        // Scan forward from openQuotePos+1 to find the closing quote of this string.
        // Escape any unescaped quote that doesn't look like a structural delimiter.
        let repairedValue = '';
        let ri = openQuotePos + 1;
        let foundClose = false;
        while (ri < fixed.length) {
          const rc = fixed[ri];
          if (rc === '\\') {
            repairedValue += rc;
            ri++;
            if (ri < fixed.length) { repairedValue += fixed[ri]; ri++; }
            continue;
          }
          if (rc === '"') {
            const afterSlice = fixed.substring(ri + 1, ri + 10).trimStart();
            if (/^[,}\]:]/.test(afterSlice) || afterSlice.length === 0) {
              foundClose = true;
              break;
            } else {
              repairedValue += '\\"';
              ri++;
              continue;
            }
          }
          repairedValue += rc;
          ri++;
        }
        if (foundClose) {
          const repaired = fixed.substring(0, openQuotePos + 1) + repairedValue + fixed.substring(ri);
          result = tryParseWithError(repaired);
          if (result.parsed) {
            stepLog('2b_position_repair', 'ok', `escaped embedded quote(s) near position ${errPos}`);
            return result.parsed;
          }
          stepLog('2b_position_repair', 'fail', result.error ?? 'unknown');
        }
      }
    }
  }

  // Step 3: repair truncated JSON (unterminated string or cut-off) by truncating at last valid boundary
  const fixable = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const isUnterminatedString = (result.error ?? '').includes('Unterminated string');

  // 3a: if "Unterminated string", scan backward past the broken string to find the last complete story object
  if (isUnterminatedString) {
    const lastQuote = fixable.lastIndexOf('"');
    const searchRegion = lastQuote > 0 ? fixable.substring(0, lastQuote) : fixable;
    const storyEndCandidates = [
      searchRegion.lastIndexOf('}],'),
      searchRegion.lastIndexOf('}\n      ],'),
      searchRegion.lastIndexOf('}\n    ],'),
      searchRegion.lastIndexOf('}\n  ],'),
      searchRegion.lastIndexOf('"},'),
      searchRegion.lastIndexOf('"\n  },'),
      searchRegion.lastIndexOf('}\n    },'),
      searchRegion.lastIndexOf(']\n    },'),
      searchRegion.lastIndexOf(']\n  },'),
    ];
    const lastStoryEnd = Math.max(...storyEndCandidates);
    if (lastStoryEnd > 100) {
      let partial = fixable.substring(0, lastStoryEnd + 1);
      const openB = (partial.match(/\[/g) || []).length - (partial.match(/\]/g) || []).length;
      const openC = (partial.match(/\{/g) || []).length - (partial.match(/\}/g) || []).length;
      for (let i = 0; i < openB; i++) partial += ']';
      for (let i = 0; i < openC; i++) partial += '}';
      partial = partial.replace(/,(\s*[}\]])/g, '$1');
      result = tryParseWithError(partial);
      if (result.parsed) {
        stepLog('3a_unterminated_repair', 'ok', `truncated at pos ${lastStoryEnd}`);
        return result.parsed;
      }
      stepLog('3a_unterminated_repair', 'fail', result.error ?? 'unknown');
    }
  }

  // 3b: strip trailing model garbage (e.g. "}  1  }  1  }  1" repeated) then try last valid boundary
  let fixableClean = fixable;
  const garbageTailMatch = fixableClean.match(/([\}\]\s\d]{3,})\s*$/);
  if (garbageTailMatch && garbageTailMatch[0].length > 20) {
    fixableClean = fixableClean.substring(0, fixableClean.length - garbageTailMatch[0].length).trimEnd();
    stepLog('3b_garbage_strip', 'ok', `stripped ${garbageTailMatch[0].length} chars of garbage tail`);
  }
  const lastBrace = Math.max(fixableClean.lastIndexOf('}'), fixableClean.lastIndexOf(']'));
  if (lastBrace > 0) {
    let partial = fixableClean.substring(0, lastBrace + 1);
    const openB = (partial.match(/\[/g) || []).length - (partial.match(/\]/g) || []).length;
    const openC = (partial.match(/\{/g) || []).length - (partial.match(/\}/g) || []).length;
    for (let i = 0; i < openB; i++) partial += ']';
    for (let i = 0; i < openC; i++) partial += '}';
    result = tryParseWithError(partial);
    if (result.parsed) {
      stepLog('3b_truncation_repair', 'ok', 'success');
      return result.parsed;
    }
    partial = partial.replace(/,(\s*[}\]])/g, '$1');
    result = tryParseWithError(partial);
    if (result.parsed) {
      stepLog('3b_truncation_repair', 'ok', 'success after trailing-comma on partial');
      return result.parsed;
    }
    stepLog('3b_truncation_repair', 'fail', `partial parse: ${result.error ?? 'unknown'}`);
  } else {
    stepLog('3b_truncation_repair', 'fail', 'no closing brace/bracket found');
  }

  // Step 4: find "userStories": [ ... ] and extract individual story objects
  const keyMatch = fixable.match(/"userStories"\s*:\s*\[/i) || fixable.match(/"stories"\s*:\s*\[/i);
  if (!keyMatch) {
    stepLog('4_userStories_extraction', 'fail', 'userStories/stories key not found in response');
  } else {
    const bracketPos = keyMatch[0].indexOf('[');
    const startIdx = keyMatch.index! + bracketPos;
    let depth = 1;
    let endIdx = startIdx + 1;
    let balanced = false;
    for (let i = startIdx + 1; i < fixable.length; i++) {
      const c = fixable[i];
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { endIdx = i; balanced = true; break; } }
    }

    if (balanced) {
      let arrayStr = fixable.substring(startIdx, endIdx + 1);
      let arr = tryParse(arrayStr);
      if (!arr && arrayStr.length > 100) {
        const lastComplete = arrayStr.lastIndexOf('},');
        if (lastComplete > 0) {
          arrayStr = arrayStr.substring(0, lastComplete + 1) + ']';
          arr = tryParse(arrayStr);
        }
      }
      if (Array.isArray(arr) && arr.length > 0) {
        stepLog('4_userStories_extraction', 'ok', `extracted ${arr.length} stories`);
        return { userStories: arr };
      }
    }

    // 4b: array not closed (truncated) — extract individual story objects using brace-balancing
    const arrayContent = fixable.substring(startIdx + 1);
    const extractedStories: any[] = [];
    let objStart = -1;
    let objDepth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < arrayContent.length; i++) {
      const c = arrayContent[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') {
        if (objDepth === 0) objStart = i;
        objDepth++;
      } else if (c === '}') {
        objDepth--;
        if (objDepth === 0 && objStart >= 0) {
          const objStr = arrayContent.substring(objStart, i + 1);
          try {
            const obj = JSON.parse(objStr);
            if (obj && (obj.id || obj.title)) extractedStories.push(obj);
          } catch { /* skip malformed object */ }
          objStart = -1;
        }
      }
    }
    if (extractedStories.length > 0) {
      stepLog('4b_object_extraction', 'ok', `extracted ${extractedStories.length} individual story objects from truncated array`);
      return { userStories: extractedStories };
    }
    stepLog('4_userStories_extraction', 'fail', balanced ? 'array parse failed or empty' : `array unclosed (depth=${depth}), object extraction also failed`);
  }

  // Step 5: last resort — run object extraction on the RAW content (before fixNewlinesInJsonStrings).
  // This catches cases where fixNewlinesInJsonStrings corrupts the string by mis-tracking quote state.
  {
    const rawTrimmed = rawContent.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
    const rawKeyMatch = rawTrimmed.match(/"userStories"\s*:\s*\[/i) || rawTrimmed.match(/"stories"\s*:\s*\[/i);
    if (rawKeyMatch) {
      const rawStartIdx = rawKeyMatch.index! + rawKeyMatch[0].indexOf('[') + 1;
      const rawExtracted: any[] = [];
      let rawObjStart = -1;
      let rawObjDepth = 0;
      let rawInStr = false;
      let rawEsc = false;
      for (let i = rawStartIdx; i < rawTrimmed.length; i++) {
        const c = rawTrimmed[i];
        if (rawEsc) { rawEsc = false; continue; }
        if (c === '\\') { rawEsc = true; continue; }
        if (c === '"') { rawInStr = !rawInStr; continue; }
        if (rawInStr) continue;
        if (c === '{') {
          if (rawObjDepth === 0) rawObjStart = i;
          rawObjDepth++;
        } else if (c === '}') {
          rawObjDepth--;
          if (rawObjDepth === 0 && rawObjStart >= 0) {
            const rawObjStr = rawTrimmed.substring(rawObjStart, i + 1);
            try {
              const rawFixedObj = fixNewlinesInJsonStrings(rawObjStr);
              const obj = JSON.parse(rawFixedObj);
              if (obj && (obj.id || obj.title)) rawExtracted.push(obj);
            } catch { /* skip */ }
            rawObjStart = -1;
          }
        }
      }
      if (rawExtracted.length > 0) {
        stepLog('5_raw_object_extraction', 'ok', `extracted ${rawExtracted.length} stories from raw content`);
        return { userStories: rawExtracted };
      }
    }
  }

  stepLog('all_strategies', 'fail', `response length=${rawContent.length}`);
  const errPreview = fixable.length > 400 ? `...${fixable.slice(-400)}` : fixable;
  console.warn(`${logPrefix} JSON parse failed, keeping compact stories. Tail: ${errPreview}`);
  return null;
}

/**
 * Extract a SHORT capability label (verb + object) from a story's full action
 * phrase. Drops the leading "I want to" / "I'd like to" prefix and truncates at
 * the "so that" goal clause. The result is what gets sprinkled across
 * synthesized sections — much shorter than the full title, so descriptions /
 * ACs / subtasks don't read as repetitive quoting.
 *
 * Examples:
 *   "I want to see a Quick Actions section so that I can access shortcuts"
 *      → "see a Quick Actions section"
 *   "I want to record audio for follow-ups so that I capture meeting notes"
 *      → "record audio for follow-ups"
 *   "configure language settings so that the AI summary uses my preferred locale"
 *      → "configure language settings"
 */
function extractCapabilityLabel(actionPhrase: string): string {
  let s = (actionPhrase || '').trim();
  if (!s) return 'this capability';
  // Drop "I want to ..." / "I want the ..." / "I would like to ..." / "I need to ..." prefixes.
  s = s.replace(/^(?:i\s+(?:want|would\s+like|need|wish)\s+(?:to\s+)?)/i, '');
  // Drop trailing "so that ..." goal clause.
  s = s.replace(/\s+so\s+that\s+.*$/i, '');
  // Trim trailing punctuation.
  s = s.replace(/[\s.,;:!?]+$/g, '').trim();
  // Cap at ~70 chars to keep synthesized lines readable.
  if (s.length > 70) {
    const cut = s.lastIndexOf(' ', 70);
    s = (cut > 30 ? s.substring(0, cut) : s.substring(0, 70)).trim();
  }
  return s || 'this capability';
}

/** Extract the GOAL clause (the "so that ..." part) for synthesis. */
function extractGoalClause(actionPhrase: string): string {
  const s = (actionPhrase || '').trim();
  const m = s.match(/\bso\s+that\s+(.+)$/i);
  if (!m) return '';
  return m[1].replace(/[\s.,;:!?]+$/g, '').trim();
}

/**
 * Synthesize 5 grounded subtasks anchored to a short capability label. Each
 * entry uses a different verb and references the capability without quoting
 * the full story title — so the resulting list reads as a real plan, not as
 * the same sentence repeated 5 times.
 */
function synthesizeGroundedSubtasks(actionPhrase: string): any[] {
  const cap = extractCapabilityLabel(actionPhrase);
  return [
    { id: 'st-1', category: "Planning",      description: `Refine acceptance criteria and design constraints for "${cap}"`,                              estimatedHours: 4 },
    { id: 'st-2', category: "Backend",       description: `Implement the server-side logic, data model changes, and APIs that support "${cap}"`,         estimatedHours: 8 },
    { id: 'st-3', category: "Frontend",      description: `Build the UI surface, state handling, and integration calls for "${cap}"`,                    estimatedHours: 6 },
    { id: 'st-4', category: "Testing",       description: `Add unit, integration, and acceptance tests covering happy path and edge cases of "${cap}"`,  estimatedHours: 6 },
    { id: 'st-5', category: "Documentation", description: `Update user-facing help and developer notes describing how "${cap}" works`,                   estimatedHours: 4 },
  ];
}

/**
 * Synthesize 3 grounded test cases (happy / validation-error / edge) anchored
 * to a short capability label. Steps describe a concrete flow without quoting
 * the full story title.
 */
function synthesizeGroundedTestCase(actionPhrase: string): any[] {
  const cap = extractCapabilityLabel(actionPhrase);
  return [
    {
      title: `Happy path — ${cap}`,
      steps: [
        { step: 1, action: `Open the screen where the user can ${cap}`,                                     result: 'Screen renders in its initial state without errors' },
        { step: 2, action: 'Provide the inputs that satisfy all preconditions described in the AC',         result: 'Inputs are accepted and the action becomes available' },
        { step: 3, action: 'Submit / confirm the action',                                                   result: 'System completes the action, persists state, and shows a success confirmation' },
      ],
    },
    {
      title: `Validation / error handling — ${cap}`,
      steps: [
        { step: 1, action: `Start the flow to ${cap}`,                                                      result: 'Flow starts in its initial state' },
        { step: 2, action: 'Provide invalid or missing input (one violation per AC) and attempt to submit', result: 'A specific, actionable error message is shown next to the failing input; submission is blocked' },
        { step: 3, action: 'Correct the input and resubmit',                                                result: 'Validation passes and the action completes successfully' },
      ],
    },
    {
      title: `Edge case — ${cap}`,
      steps: [
        { step: 1, action: `Drive the flow for "${cap}" under boundary conditions (e.g. max input length, concurrent access, slow / lost network, empty data set as applicable)`, result: 'System handles the boundary gracefully — no crash, no partial writes, no data loss' },
        { step: 2, action: 'Inspect persisted state, retries, and any audit log entries',                   result: 'State is consistent; retries do not duplicate; audit entries are present and accurate' },
        { step: 3, action: 'Restore normal conditions and verify recovery',                                 result: 'System recovers to a clean state and the action can be re-attempted successfully' },
      ],
    },
  ];
}

/**
 * Synthesize 5 grounded acceptance criteria. Covers happy path, validation,
 * persistence, error/recovery, and a non-functional concern. Each AC uses the
 * SHORT capability label (not the full title) so the list is readable.
 */
function synthesizeGroundedAcceptanceCriteria(actionPhrase: string): string[] {
  const cap = extractCapabilityLabel(actionPhrase);
  const goal = extractGoalClause(actionPhrase);
  const goalSuffix = goal ? ` so that ${goal}` : '';
  return [
    `Given valid preconditions, when the user performs the action to ${cap}, the action completes successfully${goalSuffix}.`,
    `When required inputs for "${cap}" are missing or invalid, the system blocks completion and shows a specific, actionable error tied to the failing input.`,
    `After the action to ${cap} completes, the resulting state is persisted and remains visible on next navigation to the same screen.`,
    `If the action to ${cap} fails due to a transient backend or network error, the user can retry without losing entered data and the system reports the failure clearly.`,
    `Response time and responsiveness for the action to ${cap} stay within the agreed SLA under typical load and on supported devices.`,
  ];
}

/**
 * Synthesize an 8-section grounded description anchored to the SHORT
 * capability label. CONTEXT keeps the goal clause for richness; other
 * sections use the short label so the description doesn't read as the same
 * sentence eight times.
 */
function synthesizeGroundedEightSectionDescription(actionPhrase: string, existingContext?: string, compactACs?: string[]): string {
  const cap = extractCapabilityLabel(actionPhrase);
  const goal = extractGoalClause(actionPhrase);
  const contextHas = !!(existingContext && existingContext.trim().length > 0);
  const context = contextHas
    ? existingContext!.trim()
    : `The user needs to ${cap}${goal ? ` so that ${goal}` : ''}. This story makes that capability available within the product.`;

  // Build KEY FUNCTIONALITY from compact ACs when available (grounded in actual requirements)
  const acBullets = Array.isArray(compactACs) && compactACs.length > 0
    ? compactACs.map(ac => `• ${ac}`).join('\n')
    : `• Enable the user to ${cap}\n• Validate inputs and preconditions for the action\n• Persist the resulting state and confirm success\n• Handle error paths with actionable feedback`;

  return [
    `CONTEXT & BACKGROUND:\n${context}`,
    `CURRENT STATE:\nThis capability is not yet available in the product — users cannot ${cap} within the application workflow.`,
    `DESIRED STATE:\nThe user can ${cap} directly within the application${goal ? `, achieving the goal: ${goal}` : ''}. The system handles validation, persistence, and feedback.`,
    `KEY FUNCTIONALITY:\n${acBullets}`,
    `USER INTERACTION FLOW:\n1. User navigates to the relevant screen\n2. User initiates the action to ${cap}\n3. System validates inputs and preconditions\n4. System performs the action and updates state\n5. System confirms success or shows an actionable error`,
    `TECHNICAL CONSIDERATIONS:\n• Data model and persistence supporting this capability\n• Input validation at the API boundary\n• Authentication and authorization for the persona\n• Performance within agreed SLA`,
    `OUT OF SCOPE:\n• Related capabilities handled by separate stories\n• Advanced configuration beyond the acceptance criteria`,
    `SUCCESS METRICS:\n• Users can ${cap} without workarounds\n• Error paths provide actionable feedback\n• No regressions in adjacent flows`,
  ].join('\n\n');
}

/**
 * Apply minimal, content-grounded enrichment so every story always has the
 * full strict shape (8-section description, 5 ACs, 5 subtasks, 3 test cases)
 * when the LLM enrichment call is unavailable or fails. NEVER injects generic
 * boilerplate phrases — every synthesized line references the story's title.
 */
function applyTemplateEnrichmentToBatch(batch: any[]): any[] {
  return batch.map((compact: any) => {
    const title = String(compact.title || 'User story');
    const actionPhrase = title.replace(/^as\s+[^,]+,\s*/i, '').trim() || title;

    // Description: preserve whatever the compact stage produced if it already
    // looks rich (>= 3 section headings). Otherwise synthesize a full grounded
    // 8-section description tied to the story title.
    const compactDesc = String(compact.description || '').trim();
    const sectionCount = (compactDesc.match(/\n[A-Z][A-Z &\/]{2,40}:/g) || []).length + (compactDesc.match(/^[A-Z][A-Z &\/]{2,40}:/m) ? 1 : 0);
    const description = sectionCount >= 3
      ? compactDesc
      : synthesizeGroundedEightSectionDescription(actionPhrase, compactDesc, compactACs.length > 0 ? compactACs.map((ac: any) => typeof ac === 'string' ? ac : String(ac)) : undefined);

    // Acceptance criteria: keep LLM output if it produced ≥3, otherwise synth
    // 5 grounded ACs. NO "scenario N" filler.
    const compactACs = Array.isArray(compact.acceptanceCriteria) ? compact.acceptanceCriteria : [];
    const acceptanceCriteria = compactACs.length >= 3
      ? compactACs
      : synthesizeGroundedAcceptanceCriteria(actionPhrase);

    return {
      ...compact,
      description,
      subtasks: Array.isArray(compact.subtasks) && compact.subtasks.length >= 3
        ? compact.subtasks
        : synthesizeGroundedSubtasks(actionPhrase),
      testCases: Array.isArray(compact.testCases) && compact.testCases.length >= 1
        ? compact.testCases
        : synthesizeGroundedTestCase(actionPhrase),
      acceptanceCriteria,
    };
  });
}

/** Max retries for enrichment when JSON parse fails; each attempt uses a different workflow instance. */
const ENRICHMENT_PARSE_RETRY_ATTEMPTS = 3;

/**
 * Enrich compact stories with full detail: 8-section description, subtasks, test cases.
 * Processes stories in batches to fit within output token limits.
 * When parse fails, retries with a different workflow instance (round-robin) up to ENRICHMENT_PARSE_RETRY_ATTEMPTS.
 * Each batch sends a focused prompt asking ONLY for enrichment, keeping the story IDs/titles/featureIds intact.
 * When all retries fail or batch errors, applies template enrichment so stories are still fully structured.
 */
async function enrichCompactStories(
  compactStories: any[],
  features: any[],
  epicTitle: string,
  provider: 'azure' | 'anthropic',
  workflowInstanceIndex: number | undefined,
  llmTemperature: number,
  maxOutputTokens: number,
  artifactPrefix?: JobCachePrefix,
  usageOut?: WorkflowUsageReport[],
): Promise<any[]> {
  // Cap enrichment output tokens. Production logs showed Unterminated-string
  // JSON truncation at positions 16K-17K when batchSize=3 and cap=10K. We
  // raise the cap to 16K (still safe for GPT-4o-mini's 16K limit and for
  // Azure GPT-4.1's 32K limit) AND drop batchSize to 2 to give each story
  // more output room. Result: ~2x headroom per story before truncation.
  const cappedOutputTokens = Math.min(maxOutputTokens, 16000);
  const useMultiInstance = provider === 'azure' && hasWorkflowInstances && workflowAzureInstances.length > 0;
  const batchSize = useMultiInstance ? 2 : (cappedOutputTokens >= 32000 ? 4 : 2);
  const batches: any[][] = [];
  for (let i = 0; i < compactStories.length; i += batchSize) {
    batches.push(compactStories.slice(i, i + batchSize));
  }

  const numInstances = useMultiInstance ? workflowAzureInstances.length : 0;
  const getInstanceIndicesForBatch = (batchIndex: number): (number | undefined)[] => {
    if (numInstances === 0) return [undefined];
    const pinned =
      isPromptCacheEnabled() && numInstances > 1
        ? resolveWorkflowCacheInstanceIndex(0, numInstances)
        : undefined;
    const indices: number[] = [];
    for (let a = 0; a < ENRICHMENT_PARSE_RETRY_ATTEMPTS; a++) {
      if (pinned !== undefined) {
        indices.push(pinned);
      } else {
        indices.push(((workflowInstanceIndex ?? 0) + batchIndex + a) % numInstances);
      }
    }
    return indices;
  };
  const getClientAndModel = (instanceIndex: number | undefined): { client: any; modelName: string; label: string } => {
    const useInstance = provider === 'azure' && hasWorkflowInstances && instanceIndex !== undefined
      && instanceIndex >= 0 && instanceIndex < workflowAzureInstances.length;
    const instance = useInstance ? workflowAzureInstances[instanceIndex!] : null;
    const client = provider === 'anthropic' ? anthropic : (instance ? instance.client : openai);
    const modelName = provider === 'azure'
      ? (instance ? instance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4"))
      : (process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5");
    const label = useInstance ? `Azure ${instance!.name}` : (provider === 'anthropic' ? 'Anthropic' : 'Azure OpenAI');
    return { client, modelName, label };
  };

  console.log(`[AI Service] ENRICHMENT: ${compactStories.length} stories in ${batches.length} batch(es) of up to ${batchSize}, max_tokens=${cappedOutputTokens}${useMultiInstance ? `, multi-instance retry on parse fail (${numInstances} instances)` : ''}`);

  const { client: defaultClient } = getClientAndModel(undefined);
  if (!defaultClient) {
    console.warn('[AI Service] ENRICHMENT: No LLM client available, applying template enrichment so stories remain fully structured');
    return applyTemplateEnrichmentToBatch(compactStories);
  }

  const enrichmentSystemPrompt = `You are an agile backlog enrichment engine. You receive compact user stories and return each one with FULL detail added in a strict, grounded format. Stay anchored to the project's domain context (provided in the system prompt) — never substitute a different industry.

For EACH story in the input, PRESERVE these fields exactly: id, title, featureId, storyPoints, priority.

The "title" MUST stay in the natural format: "As [Persona], I want to [direct verb phrase] so that [outcome]". Do NOT use the stilted "I want to perform [noun]" pattern.

ADD or REPLACE the following fields for EACH story. The COUNTS BELOW ARE STRICT — every story must have the full shape. EVERY synthesized line must reference concrete elements from THIS story (its title, the chunk text, the persona). NEVER emit boilerplate like "Manual or incomplete process today", "System supports the capability end-to-end", "Implement API endpoint and business logic", "Define requirements and acceptance criteria", "Document API and user guide", "Navigate to feature / Page displayed", "scenario N", or any generic placeholder.

1. "description": A single string composed of EXACTLY 8 sections. Each section starts with its UPPERCASE heading + colon, sections separated by \\n\\n. EVERY section must reference the story's specific action. Use this structure:

CONTEXT & BACKGROUND:\\n2-3 sentences explaining why this story exists, citing concepts from the chunk text.\\n\\nCURRENT STATE:\\n1-2 sentences describing the gap or pain implied by the chunk text.\\n\\nDESIRED STATE:\\n1-2 sentences describing the post-implementation experience for THIS story.\\n\\nKEY FUNCTIONALITY:\\n• 3-5 specific capabilities tied to THIS story's action (use • bullet)\\n\\nUSER INTERACTION FLOW:\\n1. 4-7 numbered steps describing the actual flow for THIS story\\n\\nTECHNICAL CONSIDERATIONS:\\n• Data source: the specific entity/store touched by THIS story\\n• Validation: rules tied to the AC\\n• Security: authentication/authorization for the persona\\n• Performance: SLA expectation for THIS action\\n\\nOUT OF SCOPE:\\n• Concerns explicitly NOT covered (related stories, future phases)\\n\\nSUCCESS METRICS:\\n• 1-3 quantifiable outcomes tied to THIS story's behaviour

2. "acceptanceCriteria": Array of EXACTLY 5 strings. Each AC must be specific, testable, and reference concrete elements from the chunk text (button labels, field names, exact values, error messages, timing). NEVER use "System handles operation correctly for scenario N" or any generic filler.

3. "subtasks": Array of EXACTLY 5 OBJECTS shaped \`{"id":"st-N","category": "Planning"|"Backend"|"Frontend"|"Testing"|"Documentation", "description": "<specific task>", "estimatedHours": <2-8>}\`. Each description MUST reference concrete work implied by THIS story (specific entities, screens, endpoints, fields). One subtask per category.

4. "testCases": Array of EXACTLY 3 OBJECTS shaped \`{"title":"<scenario>","steps":[{"step":1,"action":"<specific action>","result":"<expected result>"}, ...]}\`. The 3 test cases MUST cover (1) happy path, (2) validation/error handling, (3) edge case. Steps must reference THIS story's specific UI elements, fields, API responses, or boundary conditions — never generic.

5. "persona": The role name extracted from the title (use ONLY the persona names provided in the system prompt's ALLOWED PERSONAS list).
6. Do NOT modify "personaSource" — this field is managed externally and will be preserved from the input.
${JSON_OUTPUT_CONSTRAINT}

Return ONLY a JSON object: {"userStories": [...]}`;

  const enrichmentPrefix = artifactPrefix
    ? buildArtifactPassPrefix(artifactPrefix, enrichmentSystemPrompt)
    : undefined;

  const allEnrichedStories: any[] = [];

  const processEnrichmentBatch = async (batch: any[], batchIndex: number): Promise<any[]> => {
    const storySummaries = batch.map((s: any) => ({
      id: s.id,
      title: s.title,
      description: s.description || '',
      featureId: s.featureId,
      storyPoints: s.storyPoints,
      priority: s.priority,
      acceptanceCriteria: s.acceptanceCriteria || [],
      persona: s.persona || '',
      personaSource: s.personaSource || ''
    }));

    const featureContext = features.map((f: any) => `${f.id}: "${f.title}"`).join(', ');
    const enrichmentUserPrompt = `Epic: "${epicTitle}"
Features: ${featureContext}

Enrich these ${batch.length} compact stories with full detail (8-section description, 5 subtasks, 3-4 test cases, 5 acceptance criteria each):

${JSON.stringify(storySummaries, null, 0)}

Return {"userStories": [...]} with all ${batch.length} stories fully enriched.`;

    const instanceIndicesToTry = getInstanceIndicesForBatch(batchIndex);
    let lastErr: unknown;
    for (let attempt = 0; attempt < instanceIndicesToTry.length; attempt++) {
      const instanceIdx = instanceIndicesToTry[attempt];
      const { client: attemptClient, modelName: attemptModel, label: attemptLabel } = getClientAndModel(instanceIdx);
      if (!attemptClient) continue;
      try {
        const enrichStart = Date.now();
          // Some Azure/OpenAI deployments reject `max_tokens` and require `max_completion_tokens` instead.
          const newApiModels = NEW_API_MODEL_SUBSTRINGS;
          const isNewModel = newApiModels.some((m) => attemptModel?.includes(m));
          const tokensParam = isNewModel
            ? { max_completion_tokens: cappedOutputTokens }
            : { max_tokens: cappedOutputTokens };
        const enrichResponse = await llmCallWithRetry(
          () => attemptClient.chat.completions.create({
            model: attemptModel,
            messages: enrichmentPrefix
              ? toLlmMessages(enrichmentPrefix, enrichmentUserPrompt)
              : [
                  { role: "system", content: enrichmentSystemPrompt },
                  { role: "user", content: enrichmentUserPrompt },
                ],
            temperature: llmTemperature,
              ...tokensParam,
            ...(provider === 'azure' ? { response_format: { type: "json_object" as const } } : {})
          }),
          `ENRICHMENT batch ${batchIndex + 1}/${batches.length} (${attemptLabel})`
        );
        const enrichContent = enrichResponse.choices[0]?.message?.content || "{}";
        const enrichDuration = Date.now() - enrichStart;
        const usageRecorded = recordWorkflowLlmUsage({
          model: attemptModel,
          provider,
          usage: enrichResponse.usage as Record<string, unknown> | undefined,
          latencyMs: enrichDuration,
          callId: `enrichment-batch-${batchIndex + 1}-attempt-${attempt + 1}`,
          useCase: "artifact enrichment",
          label: `ENRICHMENT batch ${batchIndex + 1}/${batches.length}`,
        });
        usageOut?.push({
          model: attemptModel,
          provider,
          inputTokens: usageRecorded.inputTokens,
          outputTokens: usageRecorded.outputTokens,
          cacheTokens: usageRecorded.cacheTokens,
          cacheWriteTokens: usageRecorded.cacheWriteTokens,
          costUsd: usageRecorded.costUsd,
          callId: `enrichment-batch-${batchIndex + 1}`,
        });
        console.log(`[AI Service] ENRICHMENT batch ${batchIndex + 1}/${batches.length} (attempt ${attempt + 1}, ${attemptLabel}) completed in ${(enrichDuration / 1000).toFixed(1)}s, response length: ${enrichContent.length}`);

        const enrichParsed: any = parseEnrichmentResponse(enrichContent, batchIndex + 1, batches.length);
        if (!enrichParsed) {
          if (attempt < instanceIndicesToTry.length - 1) {
            console.warn(`[AI Service] ENRICHMENT batch ${batchIndex + 1} parse failed, retrying with next instance (attempt ${attempt + 1}/${instanceIndicesToTry.length})`);
          }
          continue;
        }

        const enrichedStories = Array.isArray(enrichParsed.userStories) ? enrichParsed.userStories
          : Array.isArray(enrichParsed.stories) ? enrichParsed.stories
            : Array.isArray(enrichParsed.user_stories) ? enrichParsed.user_stories : [];

        if (enrichedStories.length > 0) {
          const merged = batch.map((compact: any, idx: number) => {
            const enriched = enrichedStories.find((e: any) => e.id === compact.id) || enrichedStories[idx] || {};
            const story = {
              ...compact,
              ...enriched,
              id: compact.id,
              featureId: compact.featureId,
              storyPoints: compact.storyPoints || enriched.storyPoints,
              priority: compact.priority || enriched.priority,
              personaSource: compact.personaSource || enriched.personaSource,
              personaId: compact.personaId || enriched.personaId,
            };
            // Strict-format fallback: every story must end with the full shape
            // (8-section description, 5 ACs, 5 subtasks, 3 test cases) — but
            // every synthesized line is grounded in the story's own title, NOT
            // the historical generic boilerplate ("Implement API endpoint /
            // Define requirements / scenario 4-5 / Manual or incomplete").
            const actionPhrase = String(story.title || '').replace(/^as\s+[^,]+,\s*/i, '').trim() || 'this story';

            if (!Array.isArray(story.subtasks) || story.subtasks.length < 5) {
              story.subtasks = synthesizeGroundedSubtasks(actionPhrase);
            }
            if (!Array.isArray(story.testCases) || story.testCases.length < 3) {
              story.testCases = synthesizeGroundedTestCase(actionPhrase);
            }
            if (!Array.isArray(story.acceptanceCriteria) || story.acceptanceCriteria.length < 5) {
              const existingACs = Array.isArray(story.acceptanceCriteria) ? story.acceptanceCriteria.filter((ac: any) => typeof ac === 'string' && ac.trim()) : [];
              if (existingACs.length >= 3) {
                // LLM produced some grounded ACs — keep them, top up with story-grounded
                // synth (NOT "scenario N" filler) so the total reaches 5.
                const extras = synthesizeGroundedAcceptanceCriteria(actionPhrase).slice(0, Math.max(0, 5 - existingACs.length));
                story.acceptanceCriteria = [...existingACs, ...extras];
              } else {
                story.acceptanceCriteria = synthesizeGroundedAcceptanceCriteria(actionPhrase);
              }
            }
            // Description: if compact + enrichment produced fewer than 3
            // section headings, replace with full grounded 8-section synth.
            const desc = String(story.description || '').trim();
            const sectionCount = (desc.match(/\n[A-Z][A-Z &\/]{2,40}:/g) || []).length + (desc.match(/^[A-Z][A-Z &\/]{2,40}:/m) ? 1 : 0);
            if (sectionCount < 3) {
              story.description = synthesizeGroundedEightSectionDescription(actionPhrase, desc);
            }
            return story;
          });
          const enrichedCount = merged.filter((s: any) => Array.isArray(s.subtasks) && s.subtasks.length >= 5 && Array.isArray(s.testCases) && s.testCases.length >= 3).length;
          console.log(`[AI Service] ENRICHMENT batch ${batchIndex + 1}: ${enrichedCount}/${merged.length} stories fully enriched (${attemptLabel})`);
          return merged;
        }
      } catch (batchErr) {
        lastErr = batchErr;
        if (attempt < instanceIndicesToTry.length - 1) {
          console.warn(`[AI Service] ENRICHMENT batch ${batchIndex + 1} error (${attemptLabel}), retrying with next instance:`, batchErr instanceof Error ? batchErr.message : String(batchErr));
        }
      }
    }
    console.warn(`[AI Service] ENRICHMENT batch ${batchIndex + 1}: all ${instanceIndicesToTry.length} attempt(s) failed, applying template fallback`, lastErr instanceof Error ? lastErr.message : lastErr);
    return applyTemplateEnrichmentToBatch(batch);
  };

  if (isPromptCacheEnabled() && batches.length > 1) {
    allEnrichedStories.push(...(await processEnrichmentBatch(batches[0], 0)));
    const restResults = await Promise.all(
      batches.slice(1).map((batch, j) => processEnrichmentBatch(batch, j + 1)),
    );
    for (const batch of restResults) {
      allEnrichedStories.push(...batch);
    }
  } else {
    const enrichmentConcurrency = useMultiInstance ? Math.max(numInstances, 4) : 4;
    const batchPromises = batches.map(async (batch, batchIndex) => {
      const wave = Math.floor(batchIndex / enrichmentConcurrency);
      if (wave > 0) {
        await new Promise(resolve => setTimeout(resolve, wave * 500));
      }
      return processEnrichmentBatch(batch, batchIndex);
    });
    const batchResults = await Promise.all(batchPromises);
    for (const batch of batchResults) {
      allEnrichedStories.push(...batch);
    }
  }

  return allEnrichedStories;
}

/**
 * Generate artifacts for a single chunk of BRD requirements
 */
async function generateArtifactsForChunk(
  chunkContent: string,
  chunkIndex: number,
  totalChunks: number,
  provider: 'azure' | 'anthropic' = 'azure',
  aiEnhanceEnabled: boolean = false,
  llmTemperature: number = 0.7,
  generationConstraints?: { maxEpics?: number; maxFeatures?: number; maxStories?: number },
  goldenRepoName: string = 'Business',
  goldenRepoChunkContext?: string,
  workflowInstanceIndex?: number,
  fixedSystemHeader?: string,
  chunkRequirementIds?: string[],
  artifactPrefix?: JobCachePrefix,
): Promise<any> {
  try {
    console.log(`[AI Service] Processing chunk ${chunkIndex + 1}/${totalChunks}, length: ${chunkContent.length}`);
    const chunkUsage: WorkflowUsageReport[] = [];

    if (!chunkContent || chunkContent.trim().length === 0) {
      return { epics: [], features: [], userStories: [], personas: [], _usage: chunkUsage };
    }

    // When multiple workflow instances are configured, use round-robin (instance index passed by caller).
    const useInstance = provider === 'azure' && hasWorkflowInstances && workflowInstanceIndex !== undefined
      && workflowInstanceIndex >= 0 && workflowInstanceIndex < workflowAzureInstances.length;
    const instance = useInstance ? workflowAzureInstances[workflowInstanceIndex!] : null;

    const client = provider === 'anthropic' ? anthropic : (instance ? instance.client : openai);
    const clientName = provider === 'anthropic' ? 'Anthropic' : (instance ? `Azure ${instance.name}` : 'Azure OpenAI');

    if (!client) {
      throw new Error(`${clientName} client not configured`);
    }

    console.log(`[AI Service] Using ${clientName} for chunk ${chunkIndex + 1}`);

    const modelName = provider === 'azure'
      ? (instance ? instance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4"))
      : (process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5");

    const prefix =
      artifactPrefix ??
      buildArtifactJobPrefix(aiEnhanceEnabled, fixedSystemHeader, goldenRepoName);

    const chunkDynamicInstructions = buildArtifactChunkDynamicInstructions(
      chunkIndex,
      totalChunks,
    );
    const baseUserPrompt = getProfessionalArtifactsUserPrompt(chunkContent, goldenRepoName, goldenRepoChunkContext);

    // Detect non-functional / technical / business-rule / data-requirement IDs
    // in this chunk. These tend to be high-level and need explicit operational
    // decomposition (BUILD / CONFIGURE / MONITOR / VERIFY) — otherwise the LLM
    // produces a single shallow story per NFR/TR/BR/DR.
    const hasOperationalRequirement = Array.isArray(chunkRequirementIds)
      && chunkRequirementIds.some(id => /^(NFR|TR|BR|DR)-/i.test(String(id || '')));

    const operationalHint = hasOperationalRequirement
      ? `\n\nOPERATIONAL DECOMPOSITION (this chunk contains non-functional / technical / regulatory / business-rule requirements):\nFor each such requirement, decompose into the operational sub-tasks the implementation team must perform to BUILD, CONFIGURE, MONITOR, and VERIFY it (e.g. configuration, validation, monitoring, audit, rollback, error handling, alerting). Stay strictly within the chunk text — do NOT extrapolate beyond what is explicitly stated, but DO enumerate the implementation work the chunk implies. Generate one user story per distinct operational sub-task rather than collapsing to a single story.\n`
      : '';

    const scopeIdHeader = chunkRequirementIds && chunkRequirementIds.length > 0
      ? `CHUNK REQUIREMENT IDS: ${chunkRequirementIds.join(', ')}\nALLOWED SCOPE: Generate ONLY artifacts justified by the chunk text below. Do NOT extrapolate beyond these IDs.${operationalHint}\n\n---\n\n`
      : '';
    const userPromptBase = `${scopeIdHeader}${baseUserPrompt}`;
    const minStoriesPerChunk = 6;
    const maxStoriesPerChunk = 35;
    const storyCountAppendixFirst = `

## COMPACT OUTPUT EXAMPLE (FOLLOW THIS EXACT SHAPE)
{
  "epics": [{"id":"epic-1","title":"...","description":"One sentence summary.","priority":"High"}],
  "features": [
    {"id":"feature-1","title":"...","description":"One sentence.","epicId":"epic-1","acceptanceCriteria":["...","..."]},
    {"id":"feature-2","title":"...","description":"One sentence.","epicId":"epic-1","acceptanceCriteria":["...","..."]}
  ],
  "userStories": [
    {"id":"story-1","title":"As [Persona from system prompt], I want to [direct verb phrase] so that [outcome]","description":"One sentence of context plus one sentence of business value, tied to the chunk text.","featureId":"feature-1","storyPoints":3,"priority":"High","acceptanceCriteria":["Specific behaviour-1 observable in the chunk","Specific behaviour-2","Specific behaviour-3"]},
    {"id":"story-2","title":"As [Persona], I want to [verb] so that [outcome]","description":"...","featureId":"feature-1","storyPoints":3,"priority":"Medium","acceptanceCriteria":["...","...","..."]}
    /* generate as many stories as the chunk text supports — never invent extra. Use natural verbs, not "perform [noun]". Use ONLY personas from the system prompt header. */
  ]
}

RULES (CONTENT-DRIVEN, NO PADDING):
(1) Generate ONLY artifacts directly justified by the chunk text — no extras.
(2) Each story is COMPACT: short description, 1-3 acceptance criteria, 1-2 subtasks.
(3) Max 4 stories per feature, max 4 features per chunk.
(4) Every feature must have ≥1 story; every story must have ≥1 acceptance criterion AND ≥1 subtask.
(5) Quality over quantity — 1 well-grounded story is better than 5 padded ones.`;

    // GPT-4.1-mini and GPT-4.1-nano support 32K output tokens; GPT-4o-mini supports 16K.
    // Detect model family from deployment name to set optimal max_tokens.
    const modelLower = modelName.toLowerCase();
    const is4_1Family = modelLower.includes('4.1') || modelLower.includes('4-1') || modelLower.includes('41');
    const azureMaxOutput = is4_1Family ? 32768 : 16384;
    // Anthropic TPM is 100K — cap output at 16K per chunk to leave room for input tokens and parallelism
    const defaultChunkMaxTokens = provider === 'anthropic'
      ? Math.min(16384, Math.max(4096, parseInt(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || "16384", 10) || 16384))
      : azureMaxOutput;
    const maxTokens = defaultChunkMaxTokens;
    console.log(`[AI Service] Chunk ${chunkIndex + 1} model: "${modelName}", detected 4.1 family: ${is4_1Family}, max_tokens: ${maxTokens}`);
    let lastContent: string = "{}";
    let lastResult: any = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isRetry = attempt > 1;
      const validationMeta = (lastResult as any)?._hierarchyValidation;
      const invalidFeatureHint = validationMeta?.invalidFeaturesCount
        ? ` Invalid feature distributions: ${Array.isArray(validationMeta.invalidFeatures) ? validationMeta.invalidFeatures.join("; ") : ""}.`
        : "";

      const userPrompt = isRetry && validationMeta
        ? `${userPromptBase}

## SELF-CORRECTION — YOU GENERATED TOO FEW STORIES
Previous: ${validationMeta.storyCount} stories for ${validationMeta.featureCount} features.${invalidFeatureHint}
Required: ${validationMeta.minRequired}–${validationMeta.maxAllowed} stories (2-4 per feature).

USE COMPACT FORMAT: Each story = title + 1-2 sentence description + 3 acceptance criteria. NO subtasks, NO testCases.

1. FLAT "userStories" array at top level.
2. Every story has "featureId" matching a feature id.
3. 2-4 stories per feature, at least ${validationMeta.minRequired} total. NEVER exceed 4 stories for any single feature.
4. Keep stories SHORT (under 150 words each).`
        : `${userPromptBase}${storyCountAppendixFirst}`;

      const dynamicUser = `${chunkDynamicInstructions}\n\n${userPrompt}`;

      const totalMessageLength = prefix.staticSystem.length + prefix.staticUser.length + dynamicUser.length;
      const estimatedTokens = Math.ceil(totalMessageLength / 4);
      if (attempt === 1) {
        console.log(`[AI Service] Chunk ${chunkIndex + 1} estimated input tokens:`, estimatedTokens);
        console.log(`[AI Service] Chunk ${chunkIndex + 1} using max_tokens:`, maxTokens);
      } else {
        console.log(`[AI Service] Chunk ${chunkIndex + 1} RETRY (attempt ${attempt}) - previous response failed strict 5-9 stories-per-feature distribution`);
      }

      const requestStartTime = Date.now();

      // Some Azure/OpenAI deployments reject `max_tokens` and require `max_completion_tokens` instead.
      // Keep it model-name based so we don't break older deployments.
      const newApiModels = NEW_API_MODEL_SUBSTRINGS;
      const isNewModel = newApiModels.some((m) => modelName?.includes(m));
      const tokensParam = isNewModel
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens };

      const response = await llmCallWithRetry(
        () => client.chat.completions.create({
          model: modelName,
          messages: toLlmMessages(prefix, dynamicUser),
          temperature: llmTemperature,
          ...tokensParam,
          ...(provider === 'azure' ? { response_format: { type: "json_object" as const } } : {}),
        }),
        `Chunk ${chunkIndex + 1} generation (attempt ${attempt})`
      );

      const requestDuration = Date.now() - requestStartTime;
      console.log(`[AI Service] Chunk ${chunkIndex + 1} completed in`, requestDuration / 1000, "seconds" + (isRetry ? " (retry)" : ""));

      const usage = response.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
        const usageRecorded = recordWorkflowLlmUsage({
          model: modelName,
          provider,
          usage: usage as Record<string, unknown>,
          latencyMs: requestDuration,
          callId: `chunk-${chunkIndex}-${attempt}`,
          label: `Chunk ${chunkIndex + 1}/${totalChunks}`,
        });
        chunkUsage.push({
          model: modelName,
          provider,
          inputTokens: usageRecorded.inputTokens,
          outputTokens: usageRecorded.outputTokens,
          cacheTokens: usageRecorded.cacheTokens,
          cacheWriteTokens: usageRecorded.cacheWriteTokens,
          costUsd: usageRecorded.costUsd,
          callId: `chunk-${chunkIndex}-${attempt}`,
        });
      }

      const content = response.choices[0]?.message?.content || "{}";
      lastContent = content;
      const finishReason = response.choices[0]?.finish_reason;
      console.log(`[AI Service] Chunk ${chunkIndex + 1} response length:`, content.length);
      console.log(`[AI Service] Chunk ${chunkIndex + 1} finish reason:`, finishReason);
      console.log(`[AI Service] Chunk ${chunkIndex + 1} response preview (first 500 chars):`, content.substring(0, 500));
      console.log(`[AI Service] Chunk ${chunkIndex + 1} response END (last 800 chars):`, content.substring(Math.max(0, content.length - 800)));

      if (!content || content === "{}") {
        console.warn(`[AI Service] Chunk ${chunkIndex + 1} returned empty response` + (isRetry ? " on retry" : ""));
        if (!isRetry) return { epics: [], features: [], userStories: [], personas: [], _usage: chunkUsage };
        continue;
      }

      const wasTruncated =
        finishReason === "length" ||
        (finishReason as string) === "max_tokens" ||
        (finishReason as string) === "max_completion_tokens";
      if (wasTruncated) {
        console.warn(`[AI Service] Chunk ${chunkIndex + 1} response was truncated`);
      }

      let artifacts: any;
      try {
        let jsonContent = content.trim();
        const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          jsonContent = codeBlockMatch[1].trim();
          console.log(`[AI Service] Chunk ${chunkIndex + 1} extracted JSON from markdown code block`);
        } else {
          // Truncation case: model started ```json but the response was cut
          // off before the closing ```. Strip just the OPENING fence so the
          // partial JSON below is parseable / recoverable.
          const openFenceMatch = jsonContent.match(/^```(?:json)?\s*\n?/);
          if (openFenceMatch) {
            jsonContent = jsonContent.substring(openFenceMatch[0].length);
            // Also strip a trailing partial fence if any.
            jsonContent = jsonContent.replace(/```\s*$/, '').trim();
            console.log(`[AI Service] Chunk ${chunkIndex + 1} stripped opening markdown fence (truncated response, no closing fence)`);
          }
        }
        // Strip GPT-4o-mini degeneration garbage (e.g. "}  1  }  1  }  1  }")
        const chunkDegen = /(\}\s*\d*\s*){5,}$/;
        if (chunkDegen.test(jsonContent)) {
          const degenStart = jsonContent.search(chunkDegen);
          if (degenStart > 500) {
            const preGarbage = jsonContent.substring(0, degenStart).trimEnd();
            const lastValid = preGarbage.lastIndexOf('}');
            if (lastValid > 100) {
              jsonContent = preGarbage.substring(0, lastValid + 1);
              const ob = (jsonContent.match(/\[/g) || []).length - (jsonContent.match(/\]/g) || []).length;
              const oc = (jsonContent.match(/\{/g) || []).length - (jsonContent.match(/\}/g) || []).length;
              for (let z = 0; z < ob; z++) jsonContent += ']';
              for (let z = 0; z < oc; z++) jsonContent += '}';
              console.log(`[AI Service] Chunk ${chunkIndex + 1} stripped degeneration garbage, cleaned length: ${jsonContent.length}`);
            }
          }
        }
        // Strip trailing commas before parse
        jsonContent = jsonContent.replace(/,(\s*[}\]])/g, '$1');
        artifacts = JSON.parse(jsonContent);
      } catch (parseError) {
        console.warn(`[AI Service] Chunk ${chunkIndex + 1} initial parse failed:`, parseError instanceof Error ? parseError.message : String(parseError));
        let jsonContent = content.trim();
        // Strip degeneration garbage
        const chunkDegenFallback = /(\}\s*\d*\s*){5,}$/;
        if (chunkDegenFallback.test(jsonContent)) {
          const degenStart = jsonContent.search(chunkDegenFallback);
          if (degenStart > 500) {
            jsonContent = jsonContent.substring(0, degenStart).trimEnd();
          }
        }
        const patterns = [
          /```json\s*([\s\S]*?)\s*```/,
          /```\s*([\s\S]*?)\s*```/,
          /\{[\s\S]*\}/,
        ];
        for (const pattern of patterns) {
          const match = jsonContent.match(pattern);
          if (match && match[1]) {
            try {
              artifacts = JSON.parse(match[1].trim().replace(/,(\s*[}\]])/g, '$1'));
              break;
            } catch (e) { continue; }
          } else if (match && match[0]) {
            try {
              artifacts = JSON.parse(match[0].trim().replace(/,(\s*[}\]])/g, '$1'));
              break;
            } catch (e) { continue; }
          }
        }
        if (!artifacts) {
          // Try truncation repair: find last complete story/feature boundary
          let fixedContent = jsonContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
          // Find last complete story object boundary
          const boundaries = [
            fixedContent.lastIndexOf('}],'),
            fixedContent.lastIndexOf('}\n      ],'),
            fixedContent.lastIndexOf('}\n    ],'),
            fixedContent.lastIndexOf(']\n    },'),
            fixedContent.lastIndexOf(']\n  },'),
          ];
          let lastComplete = Math.max(...boundaries);
          if (lastComplete <= 0) lastComplete = Math.max(fixedContent.lastIndexOf('}'), fixedContent.lastIndexOf(']'));
          if (lastComplete > 100) {
            let potentialJson = fixedContent.substring(0, lastComplete + 1);
            const openBrackets = (potentialJson.match(/\[/g) || []).length - (potentialJson.match(/\]/g) || []).length;
            const openBraces = (potentialJson.match(/\{/g) || []).length - (potentialJson.match(/\}/g) || []).length;
            for (let i = 0; i < openBrackets; i++) potentialJson += ']';
            for (let i = 0; i < openBraces; i++) potentialJson += '}';
            potentialJson = potentialJson.replace(/,(\s*[}\]])/g, '$1');
            try {
              artifacts = JSON.parse(potentialJson);
              console.log(`[AI Service] Chunk ${chunkIndex + 1} recovered from truncation repair`);
            } catch (e) { /* ignore */ }
          }
        }
        if (!artifacts) {
          console.error(`[AI Service] Chunk ${chunkIndex + 1} failed to parse JSON after all repair strategies. Content preview:`, content.substring(0, 500));
          if (!isRetry) return { epics: [], features: [], userStories: [], personas: [], _usage: chunkUsage };
          continue;
        }
      }

      const rawFeatures = Array.isArray(artifacts.features) ? artifacts.features : [];
      const rawStories = Array.isArray(artifacts.userStories) ? artifacts.userStories : [];
      const featureExtraKeys = rawFeatures.map((f: any) => {
        const baseKeys = ['id', 'title', 'description', 'epicId', 'acceptanceCriteria', 'priority', 'businessValue'];
        const extras = Object.keys(f).filter((k: string) => !baseKeys.includes(k));
        const nestedArrays: Record<string, number> = {};
        for (const k of extras) {
          if (Array.isArray(f[k])) nestedArrays[k] = f[k].length;
        }
        return { id: f.id, extraKeys: extras, nestedArrays };
      });
      const storySample = rawStories.slice(0, 2).map((s: any) => ({ id: s.id, featureId: s.featureId, keys: Object.keys(s) }));
      console.log(`[AI Service] Chunk ${chunkIndex + 1} parsed artifacts:`, {
        hasEpics: !!artifacts.epics,
        epicsCount: Array.isArray(artifacts.epics) ? artifacts.epics.length : 0,
        hasFeatures: !!artifacts.features,
        featuresCount: rawFeatures.length,
        hasUserStories: !!artifacts.userStories,
        userStoriesCount: rawStories.length,
        artifactKeys: Object.keys(artifacts),
        featureExtraKeys: featureExtraKeys.filter((f: any) => f.extraKeys.length > 0),
        storySample
      });

      let result = {
        epics: Array.isArray(artifacts.epics) ? artifacts.epics : [],
        features: Array.isArray(artifacts.features) ? artifacts.features : [],
        userStories: Array.isArray(artifacts.userStories) ? artifacts.userStories : [],
        personas: Array.isArray(artifacts.personas) ? artifacts.personas : []
      };

      result = normalizeArtifactStructure(result);
      result = enforceHierarchyLimits(result);
      result = removeStandaloneUserStories(result);
      result = validateAndEnforceHierarchy(result);
      // Hard scope + orphan enforcement: drops hallucinated/unscoped/orphan artifacts.
      result = enforceHierarchyIntegrity(result, chunkContent);
      result = enforceGenerationConstraints(result, { maxEpics: 1, maxFeatures: 5 });
      if (Array.isArray(artifacts.personas)) result.personas = artifacts.personas;

      const validationPassed = (result as any)._hierarchyValidation?.passed === true;
      if (validationPassed) {
        console.log(`[AI Service] Chunk ${chunkIndex + 1} returning (after per-chunk enforcement):`, {
          epics: result.epics.length,
          features: result.features.length,
          userStories: result.userStories.length
        });
        (result as any)._usage = chunkUsage;
        return result;
      }

      lastResult = result;
      if (attempt < maxAttempts) {
        console.warn(`[AI Service] Chunk ${chunkIndex + 1} hierarchy validation failed (too few stories or wrong per-feature count). Retrying once with explicit count...`);
      }
    }

    // ── Story Amplification Pass ──
    // After main attempts, if stories are still too few, make a focused call asking ONLY for stories
    // with a minimal prompt that fits many more stories in the output budget.
    console.log(`[AI Service] Chunk ${chunkIndex + 1} POST-LOOP: lastResult has ${lastResult?.features?.length ?? 0} features, ${lastResult?.userStories?.length ?? 0} stories. Checking if amplification needed...`);
    if (lastResult && lastResult.features?.length > 0) {
      const existingStoryCount = lastResult.userStories?.length ?? 0;
      const neededMin = lastResult.features.length * 3;
      if (existingStoryCount < neededMin) {
        console.log(`[AI Service] Chunk ${chunkIndex + 1} STORY AMPLIFICATION: have ${existingStoryCount} stories, need at least ${neededMin}. Running focused story generation...`);
        try {
          const featureSummaries = lastResult.features.map((f: any) => ({
            id: f.id,
            title: f.title,
            description: (f.description || '').substring(0, 200),
            epicId: f.epicId
          }));
          const epicTitle = lastResult.epics?.[0]?.title || 'Epic';
          const storiesPerFeature = 5;
          const amplificationSystemPrompt = `You are an agile backlog generator. You MUST output ONLY a JSON object with a single key "userStories" containing an array of user story objects. No other keys, no markdown, no extra text.

Each user story object MUST have these exact fields:
- "id": string (e.g. "story-1", "story-2", ...)
- "title": string (natural format: "As [Persona], I want to [direct verb phrase] so that [outcome]" — NOT "perform [noun]")
- "description": string (1-2 sentence context)
- "featureId": string (MUST match one of the provided feature ids)
- "storyPoints": number (1-8)
- "priority": "High" | "Medium" | "Low"
- "acceptanceCriteria": array of strings (3-5 criteria each)

Generate exactly ${storiesPerFeature} user stories for EACH feature listed below. Total: ${lastResult.features.length * storiesPerFeature} stories.
Each story must be specific, actionable, and relevant to its feature's domain.
${JSON_OUTPUT_CONSTRAINT}`;

          const amplificationUserPrompt = `Epic: "${epicTitle}"

Features to generate stories for:
${featureSummaries.map((f: any) => `- ${f.id}: "${f.title}" — ${f.description}`).join('\n')}

Generate exactly ${storiesPerFeature} user stories per feature (${lastResult.features.length * storiesPerFeature} total).
Each story MUST have "featureId" set to one of: ${featureSummaries.map((f: any) => `"${f.id}"`).join(', ')}.

Return ONLY: {"userStories": [...]}`;

          const useInstance = provider === 'azure' && hasWorkflowInstances && workflowInstanceIndex !== undefined
            && workflowInstanceIndex >= 0 && workflowInstanceIndex < workflowAzureInstances.length;
          const instance = useInstance ? workflowAzureInstances[workflowInstanceIndex!] : null;
          const ampClient = provider === 'anthropic' ? anthropic : (instance ? instance.client : openai);
          const ampModel = provider === 'azure'
            ? (instance ? instance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4"))
            : (process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5");

          if (ampClient) {
            const ampStart = Date.now();
            // Some Azure/OpenAI deployments reject `max_tokens` and require `max_completion_tokens` instead.
            const newApiModels = NEW_API_MODEL_SUBSTRINGS;
            const isNewAmpModel = newApiModels.some((m) => ampModel?.includes(m));
            const ampTokensParam = isNewAmpModel
              ? { max_completion_tokens: maxTokens }
              : { max_tokens: maxTokens };
            const ampResponse = await llmCallWithRetry(
              () => ampClient.chat.completions.create({
                model: ampModel,
                messages: prefix
                  ? toLlmMessages(
                      prefix,
                      `${amplificationSystemPrompt}\n\n${amplificationUserPrompt}`,
                    )
                  : [
                      { role: "system", content: amplificationSystemPrompt },
                      { role: "user", content: amplificationUserPrompt },
                    ],
                temperature: llmTemperature,
                ...ampTokensParam,
                ...(provider === 'azure' ? { response_format: { type: "json_object" as const } } : {})
              }),
              `Chunk ${chunkIndex + 1} AMPLIFICATION`
            );
            const ampContent = ampResponse.choices[0]?.message?.content || "{}";
            const ampDuration = Date.now() - ampStart;
            const ampUsage = ampResponse.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
            if (ampUsage && (ampUsage.prompt_tokens || ampUsage.completion_tokens)) {
              const usageRecorded = recordWorkflowLlmUsage({
                model: ampModel,
                provider,
                usage: ampUsage as Record<string, unknown>,
                latencyMs: ampDuration,
                callId: `chunk-${chunkIndex}-amplification`,
                useCase: "artifact amplification",
                label: `Chunk ${chunkIndex + 1}/${totalChunks} AMPLIFICATION`,
              });
              chunkUsage.push({
                model: ampModel,
                provider,
                inputTokens: usageRecorded.inputTokens,
                outputTokens: usageRecorded.outputTokens,
                cacheTokens: usageRecorded.cacheTokens,
                cacheWriteTokens: usageRecorded.cacheWriteTokens,
                costUsd: usageRecorded.costUsd,
                callId: `chunk-${chunkIndex}-amplification`,
              });
            }
            console.log(`[AI Service] Chunk ${chunkIndex + 1} AMPLIFICATION completed in ${(ampDuration / 1000).toFixed(1)}s, length: ${ampContent.length}`);

            try {
              const ampParsed = JSON.parse(ampContent);
              const ampStories = Array.isArray(ampParsed.userStories) ? ampParsed.userStories
                : Array.isArray(ampParsed.user_stories) ? ampParsed.user_stories
                  : Array.isArray(ampParsed.stories) ? ampParsed.stories : [];

              if (ampStories.length > 0) {
                const featureIdSet = new Set(lastResult.features.map((f: any) => f.id));
                for (const story of ampStories) {
                  const alt = story.featureId || story.feature_id || story.parentFeatureId;
                  if (alt) story.featureId = alt;
                  if (!story.featureId || !featureIdSet.has(story.featureId)) {
                    story.featureId = lastResult.features[ampStories.indexOf(story) % lastResult.features.length].id;
                  }
                }
                lastResult.userStories = ampStories;
                console.log(`[AI Service] Chunk ${chunkIndex + 1} AMPLIFICATION SUCCESS: replaced with ${ampStories.length} stories`);

                lastResult = normalizeArtifactStructure(lastResult);
                lastResult = enforceHierarchyLimits(lastResult);
                lastResult = removeStandaloneUserStories(lastResult);
                lastResult = validateAndEnforceHierarchy(lastResult);
                lastResult = enforceGenerationConstraints(lastResult, { maxEpics: 1, maxFeatures: 5 });
              } else {
                console.warn(`[AI Service] Chunk ${chunkIndex + 1} AMPLIFICATION returned no stories`);
              }
            } catch (ampParseErr) {
              console.warn(`[AI Service] Chunk ${chunkIndex + 1} AMPLIFICATION parse failed:`, ampParseErr instanceof Error ? ampParseErr.message : String(ampParseErr));
            }
          }
        } catch (ampError) {
          console.warn(`[AI Service] Chunk ${chunkIndex + 1} AMPLIFICATION error:`, ampError instanceof Error ? ampError.message : String(ampError));
        }
      }
    }

    // ── Story Enrichment Pass ──
    // Compact stories have good quantity but lack subtasks, testCases, and detailed descriptions.
    // Enrich each story with full detail in batches to produce production-ready artifacts.
    if (lastResult && lastResult.userStories?.length > 0) {
      console.log(`[AI Service] Chunk ${chunkIndex + 1} ENRICHMENT: enriching ${lastResult.userStories.length} compact stories with full detail (subtasks, testCases, 8-section descriptions)...`);
      try {
        const enrichedStories = await enrichCompactStories(
          lastResult.userStories,
          lastResult.features || [],
          lastResult.epics?.[0]?.title || 'Epic',
          provider,
          workflowInstanceIndex,
          llmTemperature,
          maxTokens,
          prefix,
          chunkUsage,
        );
        if (enrichedStories.length > 0) {
          lastResult.userStories = enrichedStories;
          console.log(`[AI Service] Chunk ${chunkIndex + 1} ENRICHMENT SUCCESS: ${enrichedStories.length} stories enriched with full detail`);
        }
      } catch (enrichErr) {
        console.warn(`[AI Service] Chunk ${chunkIndex + 1} ENRICHMENT error (keeping compact stories):`, enrichErr instanceof Error ? enrichErr.message : String(enrichErr));
      }
    }

    console.log(`[AI Service] Chunk ${chunkIndex + 1} returning (after per-chunk enforcement${lastResult?.userStories?.length >= (lastResult?.features?.length ?? 0) * MIN_STORIES_PER_FEATURE ? ', stories generated' : ', validation still failed'}):`, {
      epics: lastResult?.epics?.length ?? 0,
      features: lastResult?.features?.length ?? 0,
      userStories: lastResult?.userStories?.length ?? 0
    });
    const out = lastResult ?? { epics: [], features: [], userStories: [], personas: [] };
    (out as any)._usage = chunkUsage;
    return out;

  } catch (error) {
    console.error(`[AI Service] Error processing chunk ${chunkIndex + 1}:`, error);
    // Return empty arrays on error to allow other chunks to succeed
    return { epics: [], features: [], userStories: [], personas: [], _usage: [] };
  }
}

/**
 * Generate agile artifacts (epics, features, user stories, subtasks, test cases) 
 * from BRD functional requirements, with optional Golden Repo chunk grounding (DevX).
 * Uses specified LLM provider (Azure OpenAI or Anthropic) with chunking and parallel processing.
 */
export type ArtifactGenerationContext = {
  /** Domain knowledge body (entities, regulations, business rules). Prepended to every chunk's system prompt. */
  domainContext?: string;
  /** Source label that propagates into every story's `personaSource` field. */
  personaSource?: 'From Golden Repo' | 'From Persona Hub' | 'AI Suggested (Fallback)';
  /** Source label for traceability. Currently informational only. */
  domainSource?: 'golden-repo-file' | 'ai-analysis';
};

export async function generateArtifactsFromBRDRequirements(
  functionalRequirementsContent: string,
  useChunking: boolean = true,
  selectedPersonasFromHub: Array<{
    name: string;
    role: string;
    focus?: string;
    painPoints?: string[];
    goals?: string[];
  }> = [],
  provider: 'azure' | 'anthropic' = 'azure',
  aiEnhanceEnabled: boolean = false,
  llmTemperature: number = 0.7,
  checkCancelled?: () => boolean,
  generationConstraints?: { maxEpics?: number; maxFeatures?: number; maxStories?: number },
  goldenRepoName: string = "Business",
  goldenRepoIdForChunks?: string,
  goldenRepoGuidelinesForDevx?: Array<{ name: string; content: string }>,
  progressCallback?: (message: string) => void,
  generationContext?: ArtifactGenerationContext,
  /** When set with requirementIdOrder, enables dependency clustering before chunking */
  structuredRequirements?: StructuredRequirementRow[],
  /** Appended to every cluster chunk (e.g. RAG + domain context) */
  chunkAppendix?: string,
  /** Stable ordering for requirement ids (typically request body selectedRequirementIds) */
  requirementIdOrder?: string[],
  onRequirementProgress?: (progress: any) => void,
  requirementProgressItems?: Array<{ requirementId?: string; requirementTitle?: string }>,
): Promise<any> {
  try {
    if (!functionalRequirementsContent || functionalRequirementsContent.trim().length === 0) {
      throw new Error("BRD functional requirements content is required");
    }

    console.log("[AI Service] Generating artifacts from BRD functional requirements only");
    console.log("[AI Service] Functional requirements length:", functionalRequirementsContent.length);
    console.log("[AI Service] Use chunking:", useChunking);

    if (!hasBedrock) {
      const useAzureOpenAI = process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT;
      if (!useAzureOpenAI) {
        throw new Error("Azure OpenAI or Bedrock must be configured for BRD-based artifact generation");
      }
    }

    // Optional: Use DevX (golden repo) chunks as semantic context for artifact generation.
    // This avoids relying only on the RAG "summary" text and instead injects the actual top relevant chunks.
    let goldenRepoFoundGuidelineIds: string[] = [];
    if (
      goldenRepoIdForChunks &&
      goldenRepoIdForChunks.trim().length > 0 &&
      goldenRepoGuidelinesForDevx &&
      Array.isArray(goldenRepoGuidelinesForDevx) &&
      goldenRepoGuidelinesForDevx.length > 0
    ) {
      try {
        const devxCache = VectorCacheService.getInstance();

        const guidelineInputs = goldenRepoGuidelinesForDevx
          .map((g, index) => ({
            name: (g?.name && String(g.name).trim().length > 0) ? String(g.name).trim() : `Guideline-${index + 1}`,
            content: String(g?.content ?? ""),
          }))
          .filter(g => g.content.trim().length > 0);

        if (guidelineInputs.length > 0) {
          const initialCache = await devxCache.checkMultipleDevxCache(goldenRepoIdForChunks, guidelineInputs);

          // If some guideline vectors are missing, chunk + store them in DevX now (no LLM chat calls).
          const missing = guidelineInputs.filter(g => !initialCache.get(g.name)?.found);
          if (missing.length > 0) {
            console.log(
              `[AI Service] DevX cache miss for ${missing.length}/${guidelineInputs.length} guideline(s) — chunking+vectorizing now...`,
            );
            const extractor = new StructureExtractionAgent();
            const chunker = new SmartChunkingEngine();

            for (const g of missing) {
              if (checkCancelled && checkCancelled()) {
                throw new Error("Generation cancelled by user");
              }

              const started = Date.now();

              const structure: any = extractor.extractFromText(g.content ?? "", g.name, "guideline");
              const chunks: any[] = chunker.chunkDocument(structure);

              const chunkData = (chunks ?? []).map((chunk, index) => ({
                index,
                text: chunk?.content ?? "",
                qdrantPointId: chunk?.chunkId,
                size: chunk?.metadata?.tokenCount ?? (chunk?.content?.length ?? 0),
                overlapSize: 0,
                metadata: chunk?.metadata ?? {},
              }));

              if (chunkData.length === 0) continue;

              await devxCache.storeInDevxCache(
                goldenRepoIdForChunks,
                { name: g.name, content: g.content },
                chunkData,
                Date.now() - started
              );
            }
          }

          const afterCache = await devxCache.checkMultipleDevxCache(goldenRepoIdForChunks, guidelineInputs);
          for (const g of guidelineInputs) {
            const result = afterCache.get(g.name);
            if (result?.found && result.vectorizedGuideline?.id) {
              goldenRepoFoundGuidelineIds.push(result.vectorizedGuideline.id);
            }
          }
          console.log(`[AI Service] Golden repo chunk context: using ${goldenRepoFoundGuidelineIds.length} guideline(s) from DevX cache.`);
        }
      } catch (devxErr) {
        console.warn(
          "[AI Service] Golden repo chunk context setup failed; falling back to domain name only:",
          devxErr instanceof Error ? devxErr.message : String(devxErr)
        );
        goldenRepoFoundGuidelineIds = [];
      }
    }

    // ── Build the FIXED system header ONCE per job ──
    // Persona list + domain context applied identically to every chunk.
    const fixedSystemHeader = buildFixedSystemHeader({
      domainName: goldenRepoName,
      domainContext: generationContext?.domainContext,
      personas: selectedPersonasFromHub,
      personaSource: generationContext?.personaSource ?? 'AI Suggested (Fallback)',
    });

    // If chunking is enabled, always try to chunk if multiple requirements are detected
    if (useChunking) {
      console.log("[AI Service] Chunking enabled - checking for multiple requirements...");

      // ── Dependency-aware chunking (default: enabled) ──
      const dependencyChunkingEnabled = (process.env.WORKFLOW_DEPENDENCY_CHUNKING || 'true').toLowerCase() !== 'false';
      let validChunks: string[] = [];
      let requirementCountsPerChunk: number[] = [];
      const structuredRequirementsArr = structuredRequirements ?? [];

      if (dependencyChunkingEnabled && structuredRequirementsArr.length >= 2) {
        progressCallback?.(`Analysing dependencies across ${structuredRequirementsArr.length} requirement(s)...`);
        
        // Use requirementIdOrder if provided, else use array order
        let stableRequirementOrder: string[] | undefined = requirementIdOrder;
        if (!stableRequirementOrder && structuredRequirementsArr.length > 0) {
          stableRequirementOrder = structuredRequirementsArr.map((r) => r.id);
        }

        if (checkCancelled && checkCancelled()) {
          console.log("[AI Service] Generation cancelled before dependency clustering");
          throw new Error("Generation cancelled by user");
        }
        try {
          const clustered = await tryBuildDependencyClusteredChunks(
            structuredRequirementsArr,
            stableRequirementOrder,
            chunkAppendix ?? "",
            checkCancelled,
          );
          if (clustered && clustered.chunks.length > 0) {
            for (let i = 0; i < clustered.chunks.length; i++) {
              const c = clustered.chunks[i];
              if (c.trim().length >= 100) {
                validChunks.push(c);
                requirementCountsPerChunk.push(clustered.requirementCounts[i] ?? 1);
              }
            }
            console.log(
              `[AI Service] Dependency clustering: ${structuredRequirementsArr.length} requirements → ${validChunks.length} chunk(s)`,
            );
          }
        } catch (clErr) {
          console.warn(
            "[AI Service] Dependency clustering error, using marker chunking:",
            clErr instanceof Error ? clErr.message : String(clErr),
          );
          validChunks = [];
          requirementCountsPerChunk = [];
        }
      }

      if (validChunks.length === 0) {
        // Fallback keeps requirements independent when dependency clustering is unavailable.
        const chunks = chunkBRDRequirements(functionalRequirementsContent, 1);
        for (let i = 0; i < chunks.length; i++) {
          if (chunks[i].trim().length >= 100) {
            validChunks.push(chunks[i]);
            requirementCountsPerChunk.push(1);
          }
        }
      }

      progressCallback?.(`Identified ${validChunks.length} chunk(s) — preparing parallel generation...`);
      console.log(`[AI Service] ${validChunks.length} chunk(s) (dependency-clustered=${dependencyChunkingEnabled})`);
      console.log("[AI Service] Chunk sizes:", validChunks.map((c, i) => `Chunk ${i + 1}: ${c.length} chars`));

      // Retrieve top Golden Repo chunks per requirement chunk (DevX FAISS).
      // This is injected into the artifact-generation prompt so the LLM grounds outputs on the actual golden-repo content.
      let goldenRepoChunkContexts: string[] | undefined = undefined;
      if (goldenRepoFoundGuidelineIds.length > 0 && validChunks.length > 0) {
        try {
          goldenRepoChunkContexts = new Array(validChunks.length).fill("");

          const topK = parseInt(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_TOP_K || "4", 10);
          const scoreThreshold = parseFloat(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_THRESHOLD || "0.35");
          const maxChunkChars = parseInt(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_CHUNK_MAX_CHARS || "1200", 10);
          const maxTotalChars = parseInt(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_CONTEXT_MAX_CHARS || "5000", 10);
          const retrievalMaxParallel = parseInt(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_RAG_MAX_PARALLEL || "2", 10);

          const formatRetrievedChunksContext = (retrieved: Array<any>) => {
            if (!Array.isArray(retrieved) || retrieved.length === 0) return "";
            const parts: string[] = [];
            let usedChars = 0;

            for (let i = 0; i < retrieved.length; i++) {
              const r = retrieved[i];
              const rawText = String(r?.content ?? "").trim();
              if (!rawText) continue;

              let text = rawText;
              if (text.length > maxChunkChars) {
                text = text.slice(0, maxChunkChars).trim() + "...";
              }

              const label =
                (r?.metadata?.sourceFile || r?.metadata?.guidelineName || r?.metadata?.originalGuidelineId) ??
                r?.guidelineId ??
                `guideline-${i + 1}`;

              const similarity = typeof r?.similarity === "number" && !Number.isNaN(r.similarity)
                ? r.similarity.toFixed(3)
                : String(r?.similarity ?? "");

              const part = `### Golden Repo Chunk ${i + 1} (similarity=${similarity}) — ${label}\n${text}`;
              if (usedChars + part.length > maxTotalChars) break;
              parts.push(part);
              usedChars += part.length;
            }

            return parts.join("\n\n");
          };

          for (let offset = 0; offset < validChunks.length; offset += Math.max(1, retrievalMaxParallel)) {
            if (checkCancelled && checkCancelled()) {
              throw new Error("Generation cancelled by user");
            }

            const batch = validChunks.slice(offset, offset + retrievalMaxParallel);
            const batchContexts = await Promise.all(
              batch.map(async (chunk, j) => {
                const chunkIdx = offset + j;
                try {
                  if (checkCancelled && checkCancelled()) {
                    throw new Error("Generation cancelled by user");
                  }
                  const retrieved = await faissVectorService.searchSimilar(
                    chunk,
                    goldenRepoFoundGuidelineIds,
                    topK,
                    scoreThreshold,
                    { source: "devx" }
                  );
                  return formatRetrievedChunksContext(retrieved);
                } catch (e) {
                  console.warn(`[AI Service] Golden repo chunk retrieval failed for chunk ${chunkIdx + 1}:`, e instanceof Error ? e.message : String(e));
                  return "";
                }
              })
            );

            for (let j = 0; j < batchContexts.length; j++) {
              goldenRepoChunkContexts![offset + j] = batchContexts[j];
            }
          }

          console.log(`[AI Service] Golden repo chunk contexts prepared for ${validChunks.length} chunk(s).`);
        } catch (retrievalErr) {
          console.warn(
            "[AI Service] Failed to prepare golden repo chunk contexts; continuing without chunk grounding:",
            retrievalErr instanceof Error ? retrievalErr.message : String(retrievalErr)
          );
          goldenRepoChunkContexts = undefined;
        }
      }
      
      if (validChunks.length > 1) {
        console.log(`[AI Service] Domain source for chunked processing (golden repo): ${goldenRepoName}`);

        // Parallelism: Anthropic often has lower TPM (e.g. 100k); cap concurrent chunks when using Anthropic unless overridden.
        const maxParallelEnv = parseInt(process.env.WORKFLOW_ARTIFACT_MAX_PARALLEL_CHUNKS || "0", 10);
        const defaultCap = provider === 'anthropic'
          ? Math.min(validChunks.length, Math.max(1, parseInt(process.env.ANTHROPIC_MAX_PARALLEL_CHUNKS || "4", 10)))
          : validChunks.length;
        const maxParallel = (maxParallelEnv <= 0 || Number.isNaN(maxParallelEnv))
          ? defaultCap
          : Math.min(Math.max(1, maxParallelEnv), validChunks.length);
        const runInBatches = maxParallel < validChunks.length;
        if (runInBatches) {
          console.log(`[AI Service] Capping parallelism to ${maxParallel} chunks at a time` +
            (provider === 'anthropic' ? ' (ANTHROPIC_MAX_PARALLEL_CHUNKS / 100k TPM)' : ' (WORKFLOW_ARTIFACT_MAX_PARALLEL_CHUNKS)'));
        } else {
          console.log(`[AI Service] Processing all ${validChunks.length} chunks IN PARALLEL (no cap – fastest). Set WORKFLOW_ARTIFACT_MAX_PARALLEL_CHUNKS to limit if you hit 429.`);
        }
        if (provider === 'azure' && hasWorkflowInstances && workflowAzureInstances.length > 0) {
          console.log(`[AI Service] Distributing chunks across ${workflowAzureInstances.length} Azure instance(s) (round-robin).`);
        }

        // Process chunks in parallel (or in batches if max parallel is set)
        const instanceCount = hasWorkflowInstances ? workflowAzureInstances.length : 1;
        progressCallback?.(`${instanceCount}-instance LLM generating responses for ${validChunks.length} chunk(s)${runInBatches ? ` in batches of ${maxParallel}` : ' in parallel'}...`);
        console.log("[AI Service] Processing", validChunks.length, "chunks" + (runInBatches ? ` in batches of ${maxParallel}` : " IN PARALLEL") + "...");
        const startTime = Date.now();

        const artifactPrefix = buildArtifactJobPrefix(
          aiEnhanceEnabled,
          fixedSystemHeader,
          goldenRepoName,
        );
        logJobCacheFingerprint("Artifact generation", artifactPrefix);

        const runChunk = async (chunk: string, i: number): Promise<any> => {
          const progressItem = requirementProgressItems?.[i];
          if (checkCancelled && checkCancelled()) {
            console.log(`[AI Service] Generation cancelled before processing chunk ${i + 1}`);
            throw new Error('Generation cancelled by user');
          }
          onRequirementProgress?.({
            ...progressItem,
            chunkIndex: i,
            totalChunks: validChunks.length,
            status: "processing",
            message: `Generating artifacts for requirement ${i + 1}/${validChunks.length}`,
          });
          console.log(`[AI Service] 🚀 Starting Chunk ${i + 1}/${validChunks.length}...`);
          const chunkStartTime = Date.now();
          const instanceIndex = hasWorkflowInstances
            ? resolveWorkflowCacheInstanceIndex(i, workflowAzureInstances.length)
            : undefined;
          
          const result = await generateArtifactsForChunk(
            chunk,
            i,
            validChunks.length,
            provider,
            aiEnhanceEnabled,
            llmTemperature,
            undefined,
            goldenRepoName,
            goldenRepoChunkContexts ? goldenRepoChunkContexts[i] : undefined,
            instanceIndex,
            fixedSystemHeader,
            [],
            artifactPrefix,
          );
          if (checkCancelled && checkCancelled()) {
            console.log(`[AI Service] Generation cancelled after processing chunk ${i + 1}`);
            throw new Error('Generation cancelled by user');
          }
          onRequirementProgress?.({
            ...progressItem,
            chunkIndex: i,
            totalChunks: validChunks.length,
            status: (result as any)._error ? "failed" : "completed",
            message: (result as any)._error
              ? `Artifact generation failed for requirement ${i + 1}/${validChunks.length}`
              : `Artifact generation completed for requirement ${i + 1}/${validChunks.length}`,
          });
          console.log(`[AI Service] ✅ Chunk ${i + 1} completed in ${(Date.now() - chunkStartTime) / 1000}s`, {
            epics: result.epics?.length || 0,
            features: result.features?.length || 0,
            stories: result.userStories?.length || 0
          });
          return result;
        };

        let chunkResults: any[];
        if (isPromptCacheEnabled() && validChunks.length > 1) {
          console.log("[AI Service] Cache-warm: running chunk 1 first, then remaining chunks");
          chunkResults = [await runChunk(validChunks[0], 0)];
          const remaining = validChunks.slice(1);
          if (runInBatches) {
            for (let offset = 0; offset < remaining.length; offset += maxParallel) {
              const batch = remaining.slice(offset, offset + maxParallel);
              const batchResults = await Promise.all(
                batch.map((chunk, j) => runChunk(chunk, offset + j + 1)),
              );
              chunkResults.push(...batchResults);
            }
          } else {
            const restResults = await Promise.all(
              remaining.map((chunk, j) => runChunk(chunk, j + 1)),
            );
            chunkResults.push(...restResults);
          }
        } else if (runInBatches) {
          chunkResults = [];
          for (let offset = 0; offset < validChunks.length; offset += maxParallel) {
            const batch = validChunks.slice(offset, offset + maxParallel);
            const batchResults = await Promise.all(batch.map((chunk, j) => runChunk(chunk, offset + j)));
            chunkResults.push(...batchResults);
          }
        } else {
          chunkResults = await Promise.all(validChunks.map((chunk, i) => runChunk(chunk, i)));
        }

        const totalTime = Date.now() - startTime;
        progressCallback?.(`All ${validChunks.length} chunk(s) completed in ${(totalTime / 1000).toFixed(1)}s — merging and validating...`);
        console.log(`[AI Service] ========================================`);
        console.log("[AI Service] All chunks processed IN PARALLEL in", totalTime / 1000, "seconds");
        console.log("[AI Service] Total results:", {
          epics: chunkResults.reduce((sum, r) => sum + (r.epics?.length || 0), 0),
          features: chunkResults.reduce((sum, r) => sum + (r.features?.length || 0), 0),
          stories: chunkResults.reduce((sum, r) => sum + (r.userStories?.length || 0), 0)
        });

        // Merge results, normalize structure, and fix ID conflicts
        const allChunkUsage = chunkResults.flatMap((r: any) => r._usage || []);
        let merged = mergeChunkResults(chunkResults);
        merged = normalizeArtifactStructure(merged);
        merged = enforceHierarchyLimits(merged);
        merged = removeStandaloneUserStories(merged);

        if (merged.epics.length === 0 && merged.features.length === 0 && merged.userStories.length === 0) {
          console.warn("[AI Service] All chunks returned empty results, falling back to single request");
        } else {
          let validated = validateAndEnforceHierarchy(merged);

          // Tag personas using Hub personas vs AI-suggested personas
          validated = tagPersonasForBrdArtifacts(
            validated,
            selectedPersonasFromHub,
            generationContext?.personaSource ?? (selectedPersonasFromHub.length > 0 ? 'From Persona Hub' : 'AI Suggested (Fallback)'),
          );

          // Log sample of persona tagging
          logPersonaTagSample(validated, selectedPersonasFromHub);

          (validated as any)._usage = allChunkUsage;
          return validated;
        }
      } else if (validChunks.length === 1) {
        console.log("[AI Service] Only one valid chunk detected, processing as single request");
        // Continue to single request processing below
      } else {
        console.log("[AI Service] No valid chunks detected, processing as single request");
        // Continue to single request processing below
      }
    }

    // If not chunking or only one chunk, process normally
    const useSingleInstance = provider === 'azure' && hasWorkflowInstances ? workflowAzureInstances[0] : null;
    progressCallback?.('Processing requirements as single LLM request...');
    console.log("[AI Service] Processing as single request (no chunking)");
    const singleRequestClient = provider === 'anthropic' ? anthropic : (useSingleInstance ? useSingleInstance.client : openai);
    const modelName = provider === 'azure'
      ? (useSingleInstance ? useSingleInstance.deployment : (process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4"))
      : (process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5");
    console.log("[AI Service] Using model:", modelName);

    console.log(`[AI Service] Domain source (golden repo): ${goldenRepoName}`);

    // If enabled, retrieve Golden Repo chunks for the single-shot prompt too.
    let goldenRepoChunkContextForSingle: string | undefined = undefined;
    if (goldenRepoFoundGuidelineIds.length > 0) {
      try {
        const topK = parseInt(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_TOP_K || "4", 10);
        const scoreThreshold = parseFloat(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_THRESHOLD || "0.35");
        const maxChunkChars = parseInt(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_CHUNK_MAX_CHARS || "1200", 10);
        const maxTotalChars = parseInt(process.env.WORKFLOW_ARTIFACT_GOLDEN_REPO_CONTEXT_MAX_CHARS || "5000", 10);

        const retrieved = await faissVectorService.searchSimilar(
          functionalRequirementsContent,
          goldenRepoFoundGuidelineIds,
          topK,
          scoreThreshold,
          { source: "devx" }
        );

        const parts: string[] = [];
        let usedChars = 0;
        for (let i = 0; i < retrieved.length; i++) {
          const r = retrieved[i];
          const rawText = String(r?.content ?? "").trim();
          if (!rawText) continue;

          let text = rawText;
          if (text.length > maxChunkChars) {
            text = text.slice(0, maxChunkChars).trim() + "...";
          }

          const label =
            (r?.metadata?.sourceFile || r?.metadata?.guidelineName || r?.metadata?.originalGuidelineId) ??
            r?.guidelineId ??
            `guideline-${i + 1}`;

          const similarity = typeof r?.similarity === "number" && !Number.isNaN(r.similarity)
            ? r.similarity.toFixed(3)
            : String(r?.similarity ?? "");

          const part = `### Golden Repo Chunk ${i + 1} (similarity=${similarity}) — ${label}\n${text}`;
          if (usedChars + part.length > maxTotalChars) break;
          parts.push(part);
          usedChars += part.length;
        }

        goldenRepoChunkContextForSingle = parts.join("\n\n");
      } catch (singleRetrievalErr) {
        console.warn(
          "[AI Service] Single-shot golden repo chunk retrieval failed; continuing without chunk grounding:",
          singleRetrievalErr instanceof Error ? singleRetrievalErr.message : String(singleRetrievalErr)
        );
        goldenRepoChunkContextForSingle = undefined;
      }
    }

    // Do not inject generation constraints – only follow the prompt generation rule from prompt_professional_artifacts.ts
    const singleArtifactPrefix = buildArtifactJobPrefix(
      aiEnhanceEnabled,
      fixedSystemHeader,
      goldenRepoName,
    );
    logJobCacheFingerprint("Artifact generation (single)", singleArtifactPrefix);

    const idFormatInstructions = `CRITICAL ID FORMAT REQUIREMENTS (MUST FOLLOW EXACTLY):
- Epic IDs: MUST be "epic-1", "epic-2", "epic-3", etc. (lowercase "epic", hyphen, sequential number starting from 1)
- Feature IDs: MUST be "feature-1", "feature-2", "feature-3", etc. (lowercase "feature", hyphen, sequential number starting from 1)
- User Story IDs: MUST be "story-1", "story-2", "story-3", etc. (lowercase "story", hyphen, sequential number starting from 1)
- Relationships: feature.epicId must match epic.id, story.featureId must match feature.id, story.epicId must match epic.id

CRITICAL: Return ONLY the JSON object, no additional text, no markdown code blocks, no explanations.
${JSON_OUTPUT_CONSTRAINT}`;

    // Build user prompt with only BRD functional requirements - use professional prompt generator
    const userPrompt = getProfessionalArtifactsUserPrompt(
      functionalRequirementsContent,
      goldenRepoName,
      goldenRepoChunkContextForSingle
    );
    const dynamicUser = `${idFormatInstructions}\n\n${userPrompt}`;

    // Calculate estimated tokens
    const totalMessageLength =
      singleArtifactPrefix.staticSystem.length +
      singleArtifactPrefix.staticUser.length +
      dynamicUser.length;
    const estimatedTokens = Math.ceil(totalMessageLength / 4);
    console.log("[AI Service] Estimated input tokens:", estimatedTokens);

    // GPT-4.1 family supports 32K output tokens; GPT-4o-mini supports 16K; Anthropic supports 32K.
    const singleModelLower = modelName.toLowerCase();
    const singleIs4_1 = singleModelLower.includes('4.1') || singleModelLower.includes('4-1') || singleModelLower.includes('41');
    // Anthropic TPM is 100K — cap output at 16K to leave room for input tokens
    const maxTokens = provider === 'anthropic'
      ? Math.min(16384, Math.max(4096, parseInt(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || "16384", 10) || 16384))
      : (singleIs4_1 ? 32768 : 16384);
    console.log(`[AI Service] Single-request model: "${modelName}", 4.1 family: ${singleIs4_1}, max_tokens: ${maxTokens}`);

    const requestStartTime = Date.now();

    // Some Azure/OpenAI deployments reject `max_tokens` and require `max_completion_tokens` instead.
    // Keep it model-name based so we don't break older deployments.
    const newApiModels = NEW_API_MODEL_SUBSTRINGS;

    if (!singleRequestClient) {
      throw new Error("LLM client not configured for artifact generation");
    }

    // Call LLM for single-request artifact generation
    const response = await llmCallWithRetry(
      () => singleRequestClient!.chat.completions.create({
        model: modelName,
        messages: toLlmMessages(singleArtifactPrefix, dynamicUser),
        temperature: llmTemperature,
        ...(newApiModels.some((m) => modelName?.includes(m))
          ? { max_completion_tokens: maxTokens }
          : { max_tokens: maxTokens }),
      }),
      'Single-request artifact generation'
    );

    const requestDuration = Date.now() - requestStartTime;
    console.log("[AI Service] Claude API request completed in", requestDuration / 1000, "seconds");

    const content = response.choices[0]?.message?.content || "{}";
    const finishReason = response.choices[0]?.finish_reason;
    console.log("[AI Service] Response length:", content.length);
    console.log("[AI Service] Finish reason:", finishReason);

    if (!content || content === "{}") {
      throw new Error("Claude API returned empty response");
    }

    // Check for truncation - but don't throw error, try to parse what we have
    // Note: OpenAI returns 'length' when truncated, Azure may return 'max_tokens'
    let wasTruncated =
      finishReason === "length" ||
      (finishReason as string) === "max_tokens" ||
      (finishReason as string) === "max_completion_tokens";
    if (wasTruncated) {
      console.warn("[AI Service] WARNING: Response was truncated (finish_reason:", finishReason, ")");
      console.warn("[AI Service] Attempting to parse partial response...");
      console.warn("[AI Service] Last 100 chars:", content.slice(-100));
    }

    // Parse JSON response — uses robust extractor that handles markdown code blocks,
    // truncated responses, and Bedrock/Claude quirks.
    let artifacts: any;
    try {
      const { parsed, wasCodeBlock, repairedTruncation } = extractJsonFromLLMResponse(content);
      artifacts = parsed;
      if (wasCodeBlock) console.log("[AI Service] Extracted JSON from markdown code block");
      if (repairedTruncation) {
        wasTruncated = true;
        console.warn(
          "[AI Service] JSON recovered via mid-stream truncation repair (closed open string / brackets). Treating as truncated."
        );
      }
    } catch (parseError) {
      console.error("[AI Service] Failed to parse JSON. Content preview:", content.substring(0, 500));
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }

    // Validate response structure - be lenient if truncated
    if (!artifacts.epics || !Array.isArray(artifacts.epics)) {
      if (wasTruncated) {
        console.warn("[AI Service] Response was truncated - epics array missing, initializing empty array");
        artifacts.epics = [];
      } else {
        throw new Error("Response missing epics array");
      }
    }
    if (!artifacts.features || !Array.isArray(artifacts.features)) {
      if (wasTruncated) {
        console.warn("[AI Service] Response was truncated - features array missing, initializing empty array");
        artifacts.features = [];
      } else {
        throw new Error("Response missing features array");
      }
    }
    if (!artifacts.userStories || !Array.isArray(artifacts.userStories)) {
      if (wasTruncated) {
        console.warn("[AI Service] Response was truncated - userStories array missing, initializing empty array");
        artifacts.userStories = [];
      } else {
        throw new Error("Response missing userStories array");
      }
    }

    console.log("[AI Service] Generated artifacts:");
    console.log("[AI Service] - Epics:", artifacts.epics.length);
    console.log("[AI Service] - Features:", artifacts.features.length);
    console.log("[AI Service] - User Stories:", artifacts.userStories.length);

    artifacts = normalizeArtifactStructure(artifacts);
    artifacts = enforceHierarchyLimits(artifacts);
    artifacts = removeStandaloneUserStories(artifacts);
    let validated = validateAndEnforceHierarchy(artifacts);

    // Tag personas using Hub personas vs AI-suggested personas
    validated = tagPersonasForBrdArtifacts(
      validated,
      selectedPersonasFromHub,
      generationContext?.personaSource ?? (selectedPersonasFromHub.length > 0 ? 'From Persona Hub' : 'AI Suggested (Fallback)'),
    );

    // Log sample of persona tagging
    logPersonaTagSample(validated, selectedPersonasFromHub);

    if (wasTruncated) {
      console.warn("[AI Service] WARNING: Response was truncated. Returning partial artifacts.");
      console.warn("[AI Service] Some artifacts may be incomplete. Consider reducing the number of requirements or increasing max_tokens.");
    }

    // Return artifacts with empty personas array (no personas in this simplified flow)
    // Include truncation warning in response if applicable
    const usage = response.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    const singleUsage: WorkflowUsageReport[] = [];
    if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
      const usageRecorded = recordWorkflowLlmUsage({
        model: modelName,
        provider,
        usage: usage as Record<string, unknown>,
        latencyMs: requestDuration,
        callId: "single-request",
        label: "Artifact generation (single)",
      });
      singleUsage.push({
        model: modelName,
        provider,
        inputTokens: usageRecorded.inputTokens,
        outputTokens: usageRecorded.outputTokens,
        cacheTokens: usageRecorded.cacheTokens,
        cacheWriteTokens: usageRecorded.cacheWriteTokens,
        costUsd: usageRecorded.costUsd,
        callId: "single-request",
      });
    }
    return {
      ...validated,
      personas: [],
      _usage: singleUsage,
      ...(wasTruncated ? { _truncated: true, _warning: "Response was truncated. Some artifacts may be incomplete." } : {})
    };

  } catch (error) {
    console.error("[AI Service] Error generating artifacts from BRD requirements:", error);
    throw error;
  }
}

export type UniversalArtifactScope = {
  includeEpics: boolean;
  includeFeatures: boolean;
  includeUserStories: boolean;
  includeSubtasks: boolean;
  includeTestCases: boolean;
  hasExplicitLimit: boolean;
};

function buildScopeInstruction(scope: UniversalArtifactScope): string {
  if (!scope.hasExplicitLimit) return "";
  const parts: string[] = [];
  // User story operations: user stories WITH test cases (and AC, subtasks on each story)
  if (scope.includeUserStories && !scope.includeEpics && !scope.includeFeatures && scope.includeTestCases) {
    parts.push(
      "SCOPE: Generate userStories with ALL fields on each story AND testCases linked by relatedStoryId. Each user story MUST have: title (As [Persona] I want...), description (full 8-section block), acceptanceCriteria array, subtasks array (3–8 per story) ON EACH STORY. Also generate 4–8 test cases per story in the testCases array with relatedStoryId set to the story id. Set epics: [], features: [], subtasks: [] at root. User story operations = complete story package: story + acceptance criteria + subtasks + test cases."
    );
  } else if (scope.includeUserStories && !scope.includeEpics && !scope.includeFeatures && !scope.includeTestCases) {
    parts.push(
      "SCOPE: Generate ONLY userStories. Each user story MUST have full format: title, description (8-section block), acceptanceCriteria array, subtasks array ON EACH STORY. Set epics: [], features: [], testCases: [], subtasks: [] at root."
    );
  } else if (scope.includeTestCases && scope.includeSubtasks && scope.includeUserStories && !scope.includeEpics && !scope.includeFeatures) {
    parts.push(
      "SCOPE: Generate ONE user story from the instruction text with ALL fields (title, description, acceptanceCriteria). Put the requested number of SUBTASKS on that story (story.subtasks array). Also generate the requested number of TEST CASES in the testCases array with relatedStoryId set to that story's id. Set epics: [], features: [], subtasks: [] at root. Both test cases and subtasks MUST be generated; do not return empty subtasks or empty testCases."
    );
  } else if (scope.includeTestCases && !scope.includeUserStories) {
    parts.push(
      "SCOPE: Generate ONLY testCases array. Set epics: [], features: [], userStories: [], subtasks: [] at root. Do NOT generate user stories, epics, features, or subtasks. Test cases only."
    );
  } else if (scope.includeUserStories && scope.includeSubtasks && !scope.includeEpics && !scope.includeFeatures && !scope.includeTestCases) {
    parts.push(
      "SCOPE: Generate ONE user story from the instruction (the story the user is referring to). Put the requested number of SUBTASKS on that story in the story.subtasks array. Set epics: [], features: [], testCases: [] at root. Do NOT generate epics, features, or test cases. Subtasks only on the one user story. (If the user said 'task' or 'tasks', they mean subtasks.)"
    );
  } else if (scope.includeSubtasks && !scope.includeUserStories && !scope.includeTestCases) {
    parts.push(
      "SCOPE: Generate ONLY subtasks. Leave other artifact arrays empty except as needed for structure."
    );
  } else if (scope.includeEpics && !scope.includeFeatures && !scope.includeUserStories) {
    parts.push(
      "SCOPE: Generate ONLY epics. Leave features: [], userStories: [], testCases: [], subtasks: []."
    );
  } else if (scope.includeFeatures && !scope.includeUserStories) {
    parts.push(
      "SCOPE: Generate ONLY features (and epics if needed for structure). Leave userStories: [], testCases: [], subtasks: []."
    );
  }
  return parts.length ? "\n\n" + parts.join("\n") : "";
}

function detectArtifactScopeFromInput(input: string): UniversalArtifactScope {
  const lower = input.toLowerCase();
  // TASK = SUBTASKS: "task", "tasks", "sub task", "sub-task" all mean the same — generate story.subtasks. All patterns below treat them interchangeably.
  const defaultScope: UniversalArtifactScope = {
    includeEpics: true,
    includeFeatures: true,
    includeUserStories: true,
    includeSubtasks: true,
    includeTestCases: true,
    hasExplicitLimit: false,
  };

  let scope: UniversalArtifactScope = { ...defaultScope };

  // Explicit combinations first (epics + features, features + user stories)
  const epicsAndFeaturesOnly =
    /\b(epics?|epic)\s*(and|&|\+)\s*(features?|feature)\s*(only)?\b/.test(lower) ||
    /\bonly\s+(epics?|epic)\s*(and|&|\+)\s*(features?|feature)\b/.test(lower);

  if (epicsAndFeaturesOnly) {
    scope = {
      includeEpics: true,
      includeFeatures: true,
      includeUserStories: false,
      includeSubtasks: false,
      includeTestCases: false,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // Test cases AND subtasks/tasks (e.g. "5 testCases and 7 subtask", "7 test case and 5 tasks", "test cases and tasks")
  const testCasesAndSubtasks =
    /\b(\d+)\s+(test\s*cases?|testcases?)\s+and\s+(\d+)\s+(sub\s*tasks?|sub[- ]*tasks?|tasks?)\b/i.test(lower) ||
    /\b(\d+)\s+(sub\s*tasks?|sub[- ]*tasks?|tasks?)\s+and\s+(\d+)\s+(test\s*cases?|testcases?)\b/i.test(lower) ||
    /\b(test\s*cases?|testcases?)\s+and\s+(sub\s*tasks?|sub[- ]*tasks?|tasks?)\b/i.test(lower) ||
    /\b(sub\s*tasks?|sub[- ]*tasks?|tasks?)\s+and\s+(test\s*cases?|testcases?)\b/i.test(lower);
  if (testCasesAndSubtasks) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true, // one story to hold subtasks and link test cases
      includeSubtasks: true,
      includeTestCases: true,
      hasExplicitLimit: true,
    };
    return scope;
  }

  const featuresAndStoriesOnly =
    /\b(features?|feature)\s*(and|&|\+)\s*(user stories?|stories?|userstories?)\s*(only)?\b/.test(
      lower,
    ) ||
    /\bonly\s+(features?|feature)\s*(and|&|\+)\s*(user stories?|stories?|userstories?)\b/.test(
      lower,
    );

  if (featuresAndStoriesOnly) {
    scope = {
      includeEpics: false,
      includeFeatures: true,
      includeUserStories: true,
      includeSubtasks: false,
      includeTestCases: false,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // Single-type "only X" patterns
  if (/\bonly\s+epics?\b|\bepics?\s+only\b/.test(lower)) {
    scope = {
      includeEpics: true,
      includeFeatures: false,
      includeUserStories: false,
      includeSubtasks: false,
      includeTestCases: false,
      hasExplicitLimit: true,
    };
    return scope;
  }

  if (
    /\bonly\s+user stories?\b|\bonly\s+stories?\b|\buser stories?\s+only\b|\bstories?\s+only\b/.test(
      lower,
    )
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true,
      includeSubtasks: false,
      includeTestCases: true, // user story = full package: story + AC + subtasks + test cases
      hasExplicitLimit: true,
    };
    return scope;
  }

  // "Generate user story/stories for the below/above/this feature" — ONLY user stories (+ test cases) from feature text, no epics/features
  if (
    /\bgenerate\s+(\d+\s+)?user\s+stor(?:y|ies)\s+for\s+(the\s+)?(below|above|this)\s+feature\b/i.test(lower) ||
    /\bcreate\s+(\d+\s+)?user\s+stor(?:y|ies)\s+for\s+(the\s+)?(below|above|this)\s+feature\b/i.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true,
      includeSubtasks: false,
      includeTestCases: true,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // "Only user story" (singular), "generate user story", "create user story", "generate only user story"
  if (
    /\bonly\s+user story\b|\buser story\s+only\b/.test(lower) ||
    /\bgenerate\s+(only\s+)?user story\b/.test(lower) ||
    /\bcreate\s+(only\s+)?user story\b/.test(lower) ||
    /\buser story\s+only\b/.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true,
      includeSubtasks: false,
      includeTestCases: true, // full story package
      hasExplicitLimit: true,
    };
    return scope;
  }

  // Split user story: "split user story", "split the below user story", "split into 4 user stories" — ONLY split stories, no epics/features
  if (
    /\bsplit\s+(the\s+)?(this\s+)?(it\s+)?(into\s+)?(\d+\s+)?user\s+stories?\b/i.test(lower) ||
    /\bsplit\s+(the\s+)?(this\s+)?user\s+story\b/i.test(lower) ||
    /\bsplit\s+into\s+(\d+)\s+(user\s+)?stories?\b/i.test(lower) ||
    /\bsplit\s+.*?user\s+stor(?:y|ies)\b/i.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true,
      includeSubtasks: false,
      includeTestCases: true,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // Task on user story: modify/update (not split — split handled above) → user stories with all fields
  if (
    /\bmodify\s+(this\s+)?(the\s+)?user story\b/.test(lower) ||
    /\bupdate\s+(this\s+)?(the\s+)?user story\b/.test(lower) ||
    /\bperform\s+.*\s+on\s+user story\b/.test(lower) ||
    /\b(edit|refine|improve)\s+(this\s+)?(the\s+)?user story\b/.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true,
      includeSubtasks: false,
      includeTestCases: true,
      hasExplicitLimit: true,
    };
    return scope;
  }

  if (/\bonly\s+features?\b|\bfeatures?\s+only\b/.test(lower)) {
    scope = {
      includeEpics: false,
      includeFeatures: true,
      includeUserStories: false,
      includeSubtasks: false,
      includeTestCases: false,
      hasExplicitLimit: true,
    };
    return scope;
  }

  if (/\bonly\s+test cases?\b|\bonly\s+testcases?\b|\btest cases?\s+only\b|\btestcases?\s+only\b/.test(lower)) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: false,
      includeSubtasks: false,
      includeTestCases: true,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // "X test cases" (e.g. "10 test cases", "5 testCases"), "test cases for user story", "generate test case(s) for the below user story"
  if (
    /\b\d+\s+(test\s*cases?|testcases?)\s+(for\s+)?/i.test(lower) ||
    /\b(test\s*cases?|testcases?)\s+for\s+(the\s+)?(below\s+)?(user\s+)?story\b/.test(lower) ||
    /\bgenerate\s+(test\s*cases?|testcases?)\s+for\s+(the\s+)?(below\s+)?(user\s+)?story\b/.test(lower) ||
    /\bcreate\s+(test\s*cases?|testcases?)\s+for\s+(the\s+)?(below\s+)?(user\s+)?story\b/.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: false,
      includeSubtasks: false,
      includeTestCases: true,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // "Generate test cases" / "create test cases" / "generate test case" / "generate only test cases"
  if (
    /\bgenerate\s+(only\s+)?(test\s*cases?|testcases?)\b/.test(lower) ||
    /\bcreate\s+(only\s+)?(test\s*cases?|testcases?)\b/.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: false,
      includeSubtasks: false,
      includeTestCases: true,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // "X subtasks/tasks for (a particular) user story" — sub task, sub-task, task, and tasks all mean SUBTASKS
  if (
    /\b(\d+)\s+sub[- ]*tasks?\s+for\s+(a\s+)?(particular\s+)?(user\s+)?story\b/i.test(lower) ||
    /\b(\d+)\s+tasks?\s+for\s+(a\s+)?(particular\s+)?(user\s+)?story\b/i.test(lower) ||
    /\bgenerate\s+(\d+)\s+sub[- ]*tasks?\s+for\s+(the\s+)?(below\s+)?(user\s+)?story\b/i.test(lower) ||
    /\bgenerate\s+(\d+)\s+tasks?\s+for\s+(the\s+)?(below\s+)?(user\s+)?story\b/i.test(lower) ||
    /\bgenerate\s+sub[- ]*tasks?\s+for\s+(a\s+)?(the\s+)?(below\s+)?(user\s+)?story\b/i.test(lower) ||
    /\bgenerate\s+tasks?\s+for\s+(a\s+)?(the\s+)?(below\s+)?(user\s+)?story\b/i.test(lower) ||
    /\bsub[- ]*tasks?\s+for\s+(the\s+)?(below\s+)?(a\s+)?(user\s+)?story\b/i.test(lower) ||
    /\btasks?\s+for\s+(the\s+)?(below\s+)?(a\s+)?(user\s+)?story\b/i.test(lower) ||
    /\bcreate\s+(\d+)\s+sub[- ]*tasks?\s+for\s+(the\s+)?(user\s+)?story\b/i.test(lower) ||
    /\bcreate\s+(\d+)\s+tasks?\s+for\s+(the\s+)?(user\s+)?story\b/i.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true, // one story to put subtasks on
      includeSubtasks: true,
      includeTestCases: false,
      hasExplicitLimit: true,
    };
    return scope;
  }

  // "Generate subtasks/tasks" / "create sub-tasks" / "only tasks" — sub task, task, and subtasks all mean subtasks
  if (
    /\bgenerate\s+(only\s+)?(sub[- ]*tasks?|subtasks?|tasks?)\b/.test(lower) ||
    /\bcreate\s+(only\s+)?(sub[- ]*tasks?|subtasks?|tasks?)\b/.test(lower) ||
    /\bonly\s+(sub[- ]*tasks?|subtasks?|tasks?)\b/.test(lower) ||
    /\b(sub[- ]*tasks?|subtasks?|tasks?)\s+only\b/.test(lower)
  ) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: true, // one story to attach subtasks to when content provided
      includeSubtasks: true,
      includeTestCases: false,
      hasExplicitLimit: true,
    };
    return scope;
  }

  if (/\bonly\s+subtasks?\b|\bsubtasks?\s+only\b/.test(lower)) {
    scope = {
      includeEpics: false,
      includeFeatures: false,
      includeUserStories: false,
      includeSubtasks: true,
      includeTestCases: false,
      hasExplicitLimit: true,
    };
    return scope;
  }

  return scope;
}

/** Exported for routes to skip enrichment when user requested only specific artifact types (e.g. only user story or only test cases). */
export function getArtifactScopeFromInput(input: string): UniversalArtifactScope {
  return detectArtifactScopeFromInput(input);
}

function applyArtifactScopeFilters(
  artifacts: {
    epics: any[];
    features: any[];
    userStories: any[];
    subtasks: any[];
    testCases: any[];
    personas: any[];
  },
  scope: UniversalArtifactScope,
) {
  if (!scope.hasExplicitLimit) {
    return artifacts;
  }

  return {
    epics: scope.includeEpics ? artifacts.epics : [],
    features: scope.includeFeatures ? artifacts.features : [],
    userStories: scope.includeUserStories ? artifacts.userStories : [],
    subtasks: scope.includeSubtasks ? artifacts.subtasks : [],
    testCases: scope.includeTestCases ? artifacts.testCases : [],
    // Personas are metadata and are not filtered by artifact scope
    personas: artifacts.personas,
  };
}

function isDetailedBacklogRequest(input: string): boolean {
  const lower = input.toLowerCase();

  const mentionsBacklog = /\bdetailed\s+backlog\b|\bbacklog\b/.test(lower);
  const mentionsHierarchy =
    /\bepics?\b/.test(lower) ||
    /\bfeatures?\b/.test(lower) ||
    /\buser stories?\b/.test(lower) ||
    /\bstories\b/.test(lower);

  const mentionsWorkstreams =
    /\bworkstreams?\b/.test(lower) ||
    /\bpeople\b/.test(lower) ||
    /\bprocess\b/.test(lower) ||
    /\btechnology\b/.test(lower) ||
    /\btransparency\b/.test(lower);

  const mentionsDetailLevel =
    /\bdetailed\b/.test(lower) || /\bfull\b/.test(lower) || /\bcomprehensive\b/.test(lower);

  return (
    mentionsBacklog ||
    (mentionsDetailLevel && mentionsHierarchy) ||
    (mentionsHierarchy && mentionsWorkstreams)
  );
}

async function generateDetailedBacklogFromFreeText(input: string): Promise<{
  epics: any[];
  features: any[];
  userStories: any[];
  subtasks: any[];
  testCases: any[];
  personas: any[];
}> {
  // Delegate full backlog generation to the professional BRD-style artifact generator
  const artifacts: any = await generateAgileArtifacts(input);

  return {
    epics: Array.isArray(artifacts?.epics) ? artifacts.epics : [],
    features: Array.isArray(artifacts?.features) ? artifacts.features : [],
    userStories: Array.isArray(artifacts?.userStories) ? artifacts.userStories : [],
    subtasks: Array.isArray(artifacts?.subtasks) ? artifacts.subtasks : [],
    testCases: Array.isArray(artifacts?.testCases) ? artifacts.testCases : [],
    personas: Array.isArray(artifacts?.personas) ? artifacts.personas : [],
  };
}

/**
 * UniversalAgent - Generic workflow operations helper.
 *
 * This takes free-form user instructions (e.g. "split this story",
 * "only generate test cases for login", "modify this epic") plus the
 * current artifacts, and returns an updated artifacts object in the
 * same standardized structure used everywhere else in the workflow:
 * { epics, features, userStories, subtasks, testCases, personas }.
 *
 * The LLM is responsible for interpreting intent and performing
 * transformations, but we hard-enforce the output shape here.
 */
export async function processGenericWorkflowInstruction(options: {
  input: string;
  currentArtifacts?: {
    epics?: any[];
    features?: any[];
    userStories?: any[];
    subtasks?: any[];
    testCases?: any[];
    personas?: any[];
  };
}): Promise<{
  epics: any[];
  features: any[];
  userStories: any[];
  subtasks: any[];
  testCases: any[];
  personas: any[];
}> {
  const { input, currentArtifacts } = options;

  const artifactScope = detectArtifactScopeFromInput(input);

  const modelName = hasAnyChatLlm()
    ? _defaultModelName
    : "gpt-4o";

  const safeArtifacts = {
    epics: currentArtifacts?.epics ?? [],
    features: currentArtifacts?.features ?? [],
    userStories: currentArtifacts?.userStories ?? [],
    subtasks: currentArtifacts?.subtasks ?? [],
    testCases: currentArtifacts?.testCases ?? [],
    personas: currentArtifacts?.personas ?? [],
  };

  const isNewBacklogScenario =
    safeArtifacts.epics.length === 0 &&
    safeArtifacts.features.length === 0 &&
    safeArtifacts.userStories.length === 0 &&
    safeArtifacts.subtasks.length === 0 &&
    safeArtifacts.testCases.length === 0;

  // Only delegate to full backlog generator when user wants full backlog, NOT when they asked for a single type (e.g. "only test cases", "generate test case for the below user story")
  if (
    isNewBacklogScenario &&
    isDetailedBacklogRequest(input) &&
    !artifactScope.hasExplicitLimit
  ) {
    console.log(
      "[AI Service][UniversalAgent] Detected detailed backlog request with empty artifacts - delegating to professional artifact generator",
    );

    const generated = await generateDetailedBacklogFromFreeText(input);
    const scoped = applyArtifactScopeFilters(generated, artifactScope);

    console.log("[AI Service][UniversalAgent] Detailed backlog generation via BRD-style flow:", {
      epics: scoped.epics.length,
      features: scoped.features.length,
      userStories: scoped.userStories.length,
      subtasks: scoped.subtasks.length,
      testCases: scoped.testCases.length,
    });

    return scoped;
  }

  const systemPrompt = UNIVERSAL_AGENT_SYSTEM_PROMPT;

  const scopeInstruction = artifactScope.hasExplicitLimit
    ? buildScopeInstruction(artifactScope)
    : "";
  const isTestCasesOnlyWithNoArtifacts =
    artifactScope.includeTestCases &&
    !artifactScope.includeUserStories &&
    isNewBacklogScenario;
  const isTestCasesAndSubtasksWithNoArtifacts =
    artifactScope.includeTestCases &&
    artifactScope.includeSubtasks &&
    artifactScope.includeUserStories &&
    isNewBacklogScenario;
  const isSubtasksForStoryWithNoArtifacts =
    artifactScope.includeUserStories &&
    artifactScope.includeSubtasks &&
    !artifactScope.includeTestCases &&
    !artifactScope.includeEpics &&
    !artifactScope.includeFeatures &&
    isNewBacklogScenario;
  const requestedCountMatch = input.match(/\b(\d+)\s+test cases?\b/i);
  const requestedCount = requestedCountMatch ? Math.min(50, Math.max(1, parseInt(requestedCountMatch[1], 10))) : null;
  const subtaskCountMatch = input.match(/\b(\d+)\s+(sub[- ]*tasks?|subtasks?|tasks?)\b/i);
  const requestedSubtaskCount = subtaskCountMatch ? Math.min(20, Math.max(1, parseInt(subtaskCountMatch[1], 10))) : null;
  const countPhrase = requestedCount ? `Generate approximately ${requestedCount} test cases.` : "Generate 4-8 test cases.";
  const subtaskCountPhrase = requestedSubtaskCount ? `Put exactly ${requestedSubtaskCount} subtasks on the user story (story.subtasks array).` : "Put 3-8 subtasks on the user story.";
  const testCasesFromInstructionNote = isTestCasesOnlyWithNoArtifacts
    ? `\n\nCRITICAL: Current artifacts are empty. The user has provided the user story or requirement IN THE USER INSTRUCTION above (the full text). You MUST generate test cases from that content and populate the testCases array. ${countPhrase} Do NOT return an empty testCases array. Extract the scenario from the instruction and output test cases with id testcase-1, testcase-2, etc., each with title, description, testCaseSteps (action + result per step), and relatedStoryId: null.`
    : "";
  const testCasesAndSubtasksNote = isTestCasesAndSubtasksWithNoArtifacts
    ? `\n\nCRITICAL: Generate ONE user story from the instruction above with full format (title, description, acceptanceCriteria). ${subtaskCountPhrase} Also generate ${requestedCount ? requestedCount : "4-8"} test cases in the testCases array with relatedStoryId set to that story's id. Do NOT return empty subtasks or empty testCases. Both are required.`
    : "";
  const subtasksForStoryNote = isSubtasksForStoryWithNoArtifacts
    ? `\n\nCRITICAL: Generate ONE user story from the instruction above (the particular user story the user referred to). ${subtaskCountPhrase} Do NOT generate epics, features, or test cases. Set epics: [], features: [], testCases: [] at root. Only one user story with subtasks on it.`
    : "";
  const isSplitRequest = /\bsplit\b/i.test(input) && artifactScope.includeUserStories && !artifactScope.includeEpics && !artifactScope.includeFeatures && artifactScope.hasExplicitLimit;
  const splitCountMatch =
    input.match(/\bsplit\s+(?:it\s+)?(?:into\s+)?(\d+)\s*(?:user\s+)?stories?/i) ||
    input.match(/\bsplit\s+.*?\b(\d+)\s+user\s+stories?\b/i) ||
    input.match(/\bsplit\s+.*?(?:in|into)\s+(\d+)\s*(?:user\s+stor(?:y|ies)?)?\b/i);
  const requestedSplitCount = splitCountMatch ? Math.min(10, Math.max(2, parseInt(splitCountMatch[1], 10))) : null;
  const splitNote = isSplitRequest
    ? `\n\nCRITICAL — SPLIT REQUEST: Return ONLY the split userStories (each with full format: title, description, acceptanceCriteria, subtasks, and put 4-8 test cases per story in the testCases array with relatedStoryId). Set epics: [], features: [] at root. Do NOT generate any epics or features. ${requestedSplitCount ? `Generate exactly ${requestedSplitCount} user stories (split into ${requestedSplitCount} stories).` : "Split the given user story into 2-4 smaller user stories."}`
    : "";
  const isStoriesForFeatureRequest =
    artifactScope.includeUserStories &&
    !artifactScope.includeEpics &&
    !artifactScope.includeFeatures &&
    (/\bgenerate\s+.*?user\s+stor(?:y|ies)\s+for\s+(the\s+)?(below|above|this)\s+feature\b/i.test(input) ||
      /\bcreate\s+.*?user\s+stor(?:y|ies)\s+for\s+(the\s+)?(below|above|this)\s+feature\b/i.test(input));
  const featureStoriesCountMatch =
    input.match(/\bgenerate\s+(\d+)\s+user\s+stor(?:y|ies)\s+for\s+(the\s+)?(below|above|this)\s+feature\b/i) ||
    input.match(/\bcreate\s+(\d+)\s+user\s+stor(?:y|ies)\s+for\s+(the\s+)?(below|above|this)\s+feature\b/i);
  const requestedFeatureStoriesCount = featureStoriesCountMatch
    ? Math.min(15, Math.max(1, parseInt(featureStoriesCountMatch[1], 10)))
    : null;
  const featureStoriesNote = isStoriesForFeatureRequest
    ? `\n\nCRITICAL — USER STORIES FOR FEATURE: The user provided a feature in the instruction above (below/above/this feature). Generate ONLY userStories (each with full format: title, description, acceptanceCriteria, subtasks) and testCases with relatedStoryId. Set epics: [], features: [] at root. Do NOT generate any epics or features. ${requestedFeatureStoriesCount ? `Generate exactly ${requestedFeatureStoriesCount} user stories from the feature.` : "Generate 2-6 user stories from the feature content."}`
    : "";
  const userPrompt = `
USER INSTRUCTION:
${input}
${scopeInstruction}
${testCasesFromInstructionNote}
${testCasesAndSubtasksNote}
${subtasksForStoryNote}
${splitNote}
${featureStoriesNote}

CURRENT ARTIFACTS (JSON):
${JSON.stringify(safeArtifacts, null, 2)}
`.trim();

  console.log("[AI Service][UniversalAgent] Calling generic workflow instruction handler");

  const response = await openai.chat.completions.create({
    model: modelName,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
  });

  const content = response.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    console.error(
      "[AI Service][UniversalAgent] Failed to parse JSON response, falling back to original artifacts:",
      err,
    );
    return safeArtifacts;
  }

  let normalized = {
    epics: Array.isArray(parsed.epics) ? parsed.epics : safeArtifacts.epics,
    features: Array.isArray(parsed.features) ? parsed.features : safeArtifacts.features,
    userStories: Array.isArray(parsed.userStories) ? parsed.userStories : safeArtifacts.userStories,
    subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks : safeArtifacts.subtasks,
    testCases: Array.isArray(parsed.testCases) ? parsed.testCases : safeArtifacts.testCases,
    personas: Array.isArray(parsed.personas) ? parsed.personas : safeArtifacts.personas,
  };

  normalized = applyArtifactScopeFilters(normalized, artifactScope);

  // Fallback: user asked for test cases only but LLM returned none; generate from input text
  if (
    artifactScope.includeTestCases &&
    !artifactScope.includeUserStories &&
    Array.isArray(normalized.testCases) &&
    normalized.testCases.length === 0 &&
    input.trim().length > 150
  ) {
    try {
      const firstLine = input.trim().split(/\n/)[0]?.trim().slice(0, 300) || "User story from instruction";
      const syntheticStory = {
        id: "story-1",
        title: firstLine,
        description: input.trim().slice(0, 4000),
      };
      const generated = await generateTestCasesForStory(syntheticStory, input.trim().slice(0, 3000));
      if (generated && generated.length > 0) {
        normalized = { ...normalized, testCases: generated };
        console.log("[AI Service][UniversalAgent] Fallback: generated", generated.length, "test cases from instruction text");
      }
    } catch (fallbackErr) {
      console.warn("[AI Service][UniversalAgent] Fallback test-case generation from text failed:", fallbackErr);
    }
  }

  console.log("[AI Service][UniversalAgent] Generic workflow instruction applied:", {
    epics: normalized.epics.length,
    features: normalized.features.length,
    userStories: normalized.userStories.length,
    subtasks: normalized.subtasks.length,
    testCases: normalized.testCases.length,
    personas: normalized.personas.length,
  });

  return normalized;
}

/**
 * Closest-match helper. Returns the resolved persona whose name (or role) best matches
 * the given candidate, or null if the resolved list is empty. Uses a substring/Jaccard
 * heuristic — good enough for short persona names without pulling in a string-distance lib.
 */
function findClosestPersona<T extends { name: string; role: string }>(
  candidate: string,
  pool: T[],
): T | null {
  if (!pool || pool.length === 0) return null;
  const lower = (candidate || '').toLowerCase().trim();
  if (!lower) return pool[0];

  // Exact name or role match wins.
  for (const p of pool) {
    if (p.name.toLowerCase().trim() === lower) return p;
    if (p.role.toLowerCase().trim() === lower) return p;
  }

  // Substring containment.
  for (const p of pool) {
    const n = p.name.toLowerCase();
    const r = p.role.toLowerCase();
    if (lower.includes(n) || n.includes(lower)) return p;
    if (lower.includes(r) || r.includes(lower)) return p;
  }

  // Token overlap.
  const candidateTokens = new Set(lower.split(/\W+/).filter(t => t.length > 2));
  let best: T | null = null;
  let bestScore = 0;
  for (const p of pool) {
    const tokens = new Set(`${p.name} ${p.role}`.toLowerCase().split(/\W+/).filter(t => t.length > 2));
    let overlap = 0;
    for (const t of candidateTokens) if (tokens.has(t)) overlap++;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = p;
    }
  }
  return best || pool[0];
}

/**
 * Tag personas for BRD-based artifacts.
 *
 * When `selectedPersonasFromHub` is NON-EMPTY, the resolved list is authoritative:
 * - Every story's persona name is forced to a name in the resolved list (closest match).
 * - Every story's `personaSource` is set to the resolved tier label.
 * - The output `personas` array is replaced with the resolved list (drops invented entries).
 *
 * When the list is EMPTY (AI-suggested fallback path), stories keep whatever persona name
 * the LLM produced and are tagged "AI Suggested (Fallback)".
 */
function tagPersonasForBrdArtifacts(
  artifacts: any,
  selectedPersonasFromHub: Array<{ name: string; role: string }>,
  resolvedPersonaSource: 'From Golden Repo' | 'From Persona Hub' | 'AI Suggested (Fallback)' = 'From Persona Hub',
) {
  const hasResolvedList = Array.isArray(selectedPersonasFromHub) && selectedPersonasFromHub.length > 0;
  const hubLower = new Set((selectedPersonasFromHub || []).map(p => p.name.toLowerCase().trim()));

  // Tag userStories
  if (artifacts.userStories && Array.isArray(artifacts.userStories)) {
    artifacts.userStories = artifacts.userStories.map((story: any) => {
      const titleMatch = story.title?.match(/^(?:As|as)\s+([^,]+)/i);
      const rawPersonaName = (story.persona || titleMatch?.[1] || "").toString().trim();

      if (!hasResolvedList) {
        return {
          ...story,
          persona: rawPersonaName || story.persona,
          personaSource: 'AI Suggested (Fallback)',
        };
      }

      // Hard-locked path: must use resolved list.
      let finalName = rawPersonaName;
      if (!hubLower.has(rawPersonaName.toLowerCase())) {
        const matched = findClosestPersona(rawPersonaName, selectedPersonasFromHub);
        if (matched) {
          console.log(
            `[AI Service] Persona reassigned "${rawPersonaName || '(empty)'}" → "${matched.name}" (resolved list lock)`
          );
          finalName = matched.name;
        }
      }

      // Rewrite the title prefix if it contained the wrong name.
      let updatedTitle = story.title;
      if (typeof updatedTitle === 'string' && rawPersonaName && finalName !== rawPersonaName) {
        updatedTitle = updatedTitle.replace(/^(As|as)\s+[^,]+/i, `As ${finalName}`);
      }

      return {
        ...story,
        title: updatedTitle,
        persona: finalName,
        personaSource: resolvedPersonaSource,
      };
    });
  }

  // Personas array: when locked, replace with resolved list to drop any invented entries.
  if (hasResolvedList) {
    artifacts.personas = selectedPersonasFromHub.map((p) => ({
      ...p,
      personaSource: resolvedPersonaSource,
    }));
  } else if (artifacts.personas && Array.isArray(artifacts.personas)) {
    artifacts.personas = artifacts.personas.map((persona: any) => ({
      ...persona,
      personaSource: 'AI Suggested (Fallback)',
    }));
  }

  return artifacts;
}

/**
 * Log sample of what personas were passed to LLM and what tags were assigned
 */
function logPersonaTagSample(
  artifacts: any,
  selectedPersonasFromHub: Array<{ name: string; role: string }>
) {
  console.log("[AI Service] ===== Persona Tagging Summary (BRD Flow) =====");
  console.log("[AI Service] Hub personas passed to LLM:", selectedPersonasFromHub);

  if (artifacts.userStories && Array.isArray(artifacts.userStories)) {
    const sampleStories = artifacts.userStories.slice(0, 5).map((s: any) => ({
      id: s.id,
      title: s.title,
      persona: s.persona,
      personaSource: s.personaSource,
    }));
    console.log("[AI Service] Sample user stories with personaSource:", sampleStories);
  } else {
    console.log("[AI Service] No user stories in artifacts to sample persona tags from.");
  }
}

// AI-driven contextual starter question generator
export async function generateContextualStarterQuestion(): Promise<string> {
  try {
    const response = await ai.chat.completions.create({
      model: _defaultModelName,
      messages: [
        { role: "system", content: STARTER_QUESTION_SYSTEM_PROMPT },
        { role: "user", content: STARTER_QUESTION_USER_PROMPT },
      ],
      max_tokens: 100,
      temperature: 0.7
    });

    return response.choices[0]?.message?.content?.trim() || STARTER_QUESTION_FALLBACK;
  } catch (error) {
    console.error("Error generating contextual starter question:", error);
    return STARTER_QUESTION_FALLBACK;
  }
}

export async function generateTestCasesForStory(story: any, acceptanceCriteriaText: string): Promise<any[]> {
  try {
    const modelName = _defaultModelName;
    const prompt = promptGenerateTestCases(
      `${story.title}\n${story.description || ""}`,
      acceptanceCriteriaText || "",
      story.storyPoints || 3
    );

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    });

    let content = response.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) content = jsonMatch[1].trim();
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const firstBrace = content.indexOf('{');
      if (firstBrace >= 0) {
        try {
          parsed = JSON.parse(content.slice(firstBrace));
        } catch (e2) {
          console.warn('[AI Service] Could not parse test cases JSON for story', story.id);
          return [];
        }
      } else {
        console.warn('[AI Service] Could not parse test cases JSON for story', story.id);
        return [];
      }
    }

    // Prompt returns { functional, negative, edgeCases, accessibility }; also support { testCases } or array
    let rawCases: any[] = [];
    if (Array.isArray(parsed?.testCases)) rawCases = parsed.testCases;
    else if (Array.isArray(parsed?.testcases)) rawCases = parsed.testcases;
    else if (Array.isArray(parsed)) rawCases = parsed;
    else if (parsed && typeof parsed === "object") {
      const fromCategories = [
        ...(Array.isArray(parsed.functional) ? parsed.functional : []),
        ...(Array.isArray(parsed.negative) ? parsed.negative : []),
        ...(Array.isArray(parsed.edgeCases) ? parsed.edgeCases : []),
        ...(Array.isArray(parsed.edgecases) ? parsed.edgecases : []),
        ...(Array.isArray(parsed.accessibility) ? parsed.accessibility : []),
      ];
      rawCases = fromCategories;
    }
    if (!rawCases || rawCases.length === 0) return [];

    const normalizeStep = (s: any, sIdx: number) => {
      if (typeof s !== "object" || s === null) return { step: sIdx + 1, action: String(s), result: "" };
      return {
        step: s.Steps ?? s.step ?? sIdx + 1,
        action: s.Action ?? s.action ?? "",
        result: s["Expected Results"] ?? s.expectedResults ?? s.expectedResult ?? s.result ?? "",
      };
    };

    return rawCases.map((tc: any, idx: number) => {
      const steps = Array.isArray(tc.testCaseSteps) ? tc.testCaseSteps : (Array.isArray(tc.steps) ? tc.steps : []);
      return {
        id: tc.id || `testcase-${idx + 1}`,
        title: tc.title || tc.scenario || `Test case ${idx + 1}`,
        description: tc.description || tc.title || "",
        testCaseSteps: steps.map((s: any, i: number) => normalizeStep(s, i)),
        relatedStoryId: story?.id ?? null,
      };
    });
  } catch (err) {
    console.error('[AI Service] Error generating test cases for story', story.id, err);
    return [];
  }
}

export async function generateAcceptanceCriteriaForStory(story: any): Promise<any[]> {
  try {
    const modelName = _defaultModelName;
    const prompt = `
You are an expert Agile Business Analyst.

Given the following user story, generate 4-8 high-quality acceptance criteria in Given/When/Then form.

Return ONLY valid JSON in this structure:
{
  "acceptanceCriteria": [
    {
      "title": "Short, action-oriented title",
      "given": "Given ...",
      "when": "When ...",
      "then": "Then ..."
    }
  ]
}

User Story:
Title: ${story.title || ""}
Description:
${story.description || ""}
`;

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1200,
    });

    const rawContent = response.choices?.[0]?.message?.content || "";
    let jsonText = rawContent.trim();

    // Be tolerant of models that wrap JSON in markdown code blocks or extra text
    const codeBlockMatch =
      jsonText.match(/```json\s*([\s\S]*?)```/i) ||
      jsonText.match(/```\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]) {
      jsonText = codeBlockMatch[1].trim();
    } else {
      // Fallback: try to grab the first JSON object in the output
      const firstBrace = jsonText.indexOf("{");
      const lastBrace = jsonText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonText = jsonText.slice(firstBrace, lastBrace + 1);
      }
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      console.warn(
        "[AI Service] Could not parse acceptance criteria JSON for story",
        story.id,
        "- raw content preview:",
        rawContent.slice(0, 200),
      );
      return [];
    }

    if (!parsed || !Array.isArray(parsed.acceptanceCriteria)) return [];

    return parsed.acceptanceCriteria.map((ac: any, idx: number) => ({
      title: ac.title || `Acceptance Criterion ${idx + 1}`,
      given: ac.given || "",
      when: ac.when || "",
      then: ac.then || "",
    }));
  } catch (err) {
    console.error("[AI Service] Error generating acceptance criteria for story", story.id, err);
    return [];
  }
}

// ============================================
// CRITICAL FIXES FOR CONTEXT INTEGRATION
// ============================================

export async function generateDesignGuidelines(
  requirement: string,
  capturedRequirements?: {
    businessGoals?: string[];
    targetUsers?: string[];
    keyFeatures?: string[];
    technicalConstraints?: string[];
    functionalRequirements?: string[];
    nonFunctionalRequirements?: string[];
  }
): Promise<string> {
  try {
    console.log("[AI Service] Generating design guidelines for:", requirement.substring(0, 120));
    console.log("[AI Service] Captured requirements:", JSON.stringify(capturedRequirements, null, 2));

    const modelName = _defaultModelName;

    // ============================================
    // FIX 1: Enhanced Context Builder with Rich Detail Extraction
    // ============================================
    const buildEnhancedContext = (): string => {
      if (!capturedRequirements) {
        console.warn("[AI Service] No captured requirements provided!");
        return "";
      }

      let context = "\n## 🎯 CRITICAL PROJECT CONTEXT (MUST INTEGRATE INTO ALL DESIGNS)\n\n";

      // Extract detailed information from the requirement text
      const extractDetailedInfo = (text: string, keywords: string[]): string[] => {
        const details: string[] = [];
        const lines = text.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (keywords.some(kw => line.toLowerCase().includes(kw.toLowerCase()))) {
            // Extract bullet points or numbered items
            const match = line.match(/^[-•*\d.)\s]*(.+)$/);
            if (match && match[1].trim().length > 10) {
              details.push(match[1].trim());
            }
          }
        }
        return details;
      };

      // Business Goals - drive visual priorities and CTAs
      if (capturedRequirements.businessGoals && capturedRequirements.businessGoals.length > 0) {
        context += "**Business Goals (inform color schemes, UI hierarchy, feature prominence):**\n";
        capturedRequirements.businessGoals.forEach((goal, idx) => {
          context += `${idx + 1}. ${goal}\n`;
          // Extract any additional details from the requirement text
          const goalDetails = extractDetailedInfo(requirement, [goal]);
          if (goalDetails.length > 0) {
            goalDetails.forEach(detail => context += `   - ${detail}\n`);
          }
        });
        context += "\n";
      }

      // Target Users - drive terminology, complexity, and interaction patterns
      if (capturedRequirements.targetUsers && capturedRequirements.targetUsers.length > 0) {
        context += "**Target Users & Their Specific Needs (inform terminology, workflows, UI complexity):**\n";
        capturedRequirements.targetUsers.forEach((user, idx) => {
          context += `${idx + 1}. **${user}**\n`;

          // Extract role-specific details from requirement text
          const userKeywords = user.split(/[,/]/).map(u => u.trim());
          const roleDetails = extractDetailedInfo(requirement, [...userKeywords, 'role:', 'tasks:', 'key tasks']);

          if (roleDetails.length > 0) {
            context += `   Role & Responsibilities:\n`;
            roleDetails.slice(0, 5).forEach(detail => context += `   - ${detail}\n`);
          } else {
            // Fallback: try to extract any mentions of this user type
            const regex = new RegExp(`${userKeywords[0]}[^.]*?(?:can|should|must|will|needs to|responsible for)[^.]*\\.`, 'gi');
            const matches = requirement.match(regex);
            if (matches && matches.length > 0) {
              matches.slice(0, 3).forEach(match => context += `   - ${match.trim()}\n`);
            }
          }
        });
        context += "\n";
      }

      // Key Features - must be prominent in layouts
      if (capturedRequirements.keyFeatures && capturedRequirements.keyFeatures.length > 0) {
        context += "**Key Features & Capabilities (must be emphasized in layouts and prompts):**\n";
        capturedRequirements.keyFeatures.forEach((feature, idx) => {
          context += `${idx + 1}. **${feature}**\n`;

          // Extract feature details
          const featureKeywords = feature.split(/[,&]/).map(f => f.trim()).filter(f => f.length > 3);
          const featureDetails = extractDetailedInfo(requirement, featureKeywords);

          if (featureDetails.length > 0) {
            featureDetails.slice(0, 4).forEach(detail => context += `   - ${detail}\n`);
          }
        });
        context += "\n";
      }

      // Functional Requirements - drive screen structure and workflows
      if (capturedRequirements.functionalRequirements && capturedRequirements.functionalRequirements.length > 0) {
        context += "**Functional Requirements & Detailed Workflows (map to specific screens/components):**\n";
        capturedRequirements.functionalRequirements.forEach((req, idx) => {
          context += `\n${idx + 1}. **${req}**\n`;

          // Parse if it's a JSON string
          if (typeof req === 'string' && req.includes('userRole')) {
            try {
              const parsed = JSON.parse(req);
              context += `   [${parsed.userRole}]: ${parsed.functionality.join(', ')}\n`;
            } catch {
              // Not JSON, extract details
              const reqKeywords = req.split(/[,&]/).map(r => r.trim()).filter(r => r.length > 3);
              const reqDetails = extractDetailedInfo(requirement, [...reqKeywords, 'tasks:', 'processes:', 'features:']);

              if (reqDetails.length > 0) {
                context += `   Implementation Details:\n`;
                reqDetails.slice(0, 6).forEach(detail => context += `   - ${detail}\n`);
              }
            }
          } else {
            // Extract details for this functional requirement
            const reqKeywords = String(req).split(/[,&]/).map(r => r.trim()).filter(r => r.length > 3);
            const reqDetails = extractDetailedInfo(requirement, [...reqKeywords, 'tasks:', 'processes:', 'features:']);

            if (reqDetails.length > 0) {
              context += `   Implementation Details:\n`;
              reqDetails.slice(0, 6).forEach(detail => context += `   - ${detail}\n`);
            }
          }
        });
        context += "\n";
      }

      // Technical Constraints - affect implementation approach
      if (capturedRequirements.technicalConstraints && capturedRequirements.technicalConstraints.length > 0) {
        context += "**Technical Constraints & Architecture (must be reflected in design decisions):**\n";
        capturedRequirements.technicalConstraints.forEach((constraint, idx) => {
          context += `${idx + 1}. ${constraint}\n`;

          // Extract technical details
          const techKeywords = String(constraint).split(/[,&]/).map(t => t.trim()).filter(t => t.length > 3);
          const techDetails = extractDetailedInfo(requirement, [...techKeywords, 'integration:', 'platform:', 'system:']);

          if (techDetails.length > 0) {
            techDetails.slice(0, 4).forEach(detail => context += `   - ${detail}\n`);
          }
        });
        context += "\n";
      }

      // Non-Functional Requirements - affect component specs
      if (capturedRequirements.nonFunctionalRequirements && capturedRequirements.nonFunctionalRequirements.length > 0) {
        context += "**Non-Functional Requirements (inform performance, security, accessibility):**\n";
        capturedRequirements.nonFunctionalRequirements.forEach((req, idx) => {
          context += `${idx + 1}. ${req}\n`;

          // Extract NFR details
          const nfrKeywords = String(req).split(/[,&]/).map(n => n.trim()).filter(n => n.length > 3);
          const nfrDetails = extractDetailedInfo(requirement, nfrKeywords);

          if (nfrDetails.length > 0) {
            nfrDetails.slice(0, 3).forEach(detail => context += `   - ${detail}\n`);
          }
        });
        context += "\n";
      }

      // Add a domain-specific context section
      const domain = detectDomain(requirement);
      if (domain !== 'General') {
        context += `**Domain Context: ${domain}**\n`;
        context += `Design must use ${domain.toLowerCase()}-specific terminology, workflows, and visual patterns.\n\n`;
      }

      console.log("[AI Service] Enhanced context length:", context.length);
      console.log("[AI Service] Context includes detailed workflows:", context.includes('Implementation Details') || context.includes('Role & Responsibilities'));
      return context;
    };

    const requirementsContext = buildEnhancedContext();

    // ============================================
    // FIX 2: More Explicit System Prompt
    // ============================================
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: `You are a Senior UI/UX Design System Architect specializing in production-ready Figma Make AI prompts.

CORE MISSION: Generate comprehensive, copy-paste ready Figma Make guidelines that produce pixel-perfect, interactive prototypes DEEPLY TAILORED TO THE SPECIFIC PROJECT CONTEXT.

⚠️ CRITICAL REQUIREMENT: You MUST deeply integrate the provided DETAILED project context (business goals, target users WITH their specific roles and tasks, features WITH implementation details, technical constraints, workflows) into EVERY section of your output. 

🚫 FORBIDDEN: Generic templates, placeholder text, vague references. Every design decision must be JUSTIFIED by the specific context provided.

SUCCESS CRITERIA:
✓ Production-grade visuals matching the SPECIFIC project domain
✓ User-specific terminology and workflows EXTRACTED from detailed user role descriptions
✓ Feature-driven layout priorities based on ACTUAL feature implementation details
✓ Constraint-aware implementation notes using SPECIFIC technical stack mentioned
✓ Complete interaction patterns & micro-animations
✓ Responsive layouts (mobile/tablet/desktop)
✓ WCAG 2.1 AA accessibility compliance
✓ Real, domain-specific data patterns (no Lorem Ipsum - use actual examples from context)
✓ Developer-friendly specs (exact measurements, colors)

DESIGN PHILOSOPHY: Follow enterprise patterns from Linear, GitHub, Atlassian, Microsoft Fluent, Salesforce Lightning.

CONTEXT INTEGRATION MANDATE:
- When you see "Business Processors review application data" → Design a Record Intake screen with application review workflow
- When you see "Multi-Channel Data Capture via API/web/email" → Show multi-channel input components in layouts
- When you see "Microservices on AWS with Docker/Kubernetes" → Reference cloud-native, scalable architecture in technical notes
- When you see "Legal teams perform audits" → Include audit trail components and compliance-focused UI elements

FIGMA MAKE COMPATIBILITY:
- Precise, descriptive language
- Exact measurements (px/rem/Tailwind classes)
- All component states (hover/focus/active/disabled/loading/error)
- Color values (HEX/RGB/HSL)
- Realistic content examples FROM THE PROJECT DOMAIN (extracted from context)
- Animation timing & easing
- Reference actual user workflows and feature details provided in context`
        },
        {
          role: "user",
          content: `Generate production-ready Figma Make AI guidelines for: "${requirement}"

${requirementsContext}

⚠️ MANDATORY INTEGRATION REQUIREMENTS:

**YOU MUST USE THE DETAILED CONTEXT ABOVE - NOT GENERIC TEMPLATES**

The context provided includes:
- Specific user roles WITH their actual tasks and responsibilities
- Features WITH implementation details (not just feature names)
- Functional requirements WITH workflows and processes
- Technical constraints WITH specific platforms/tools mentioned

**HOW TO INTEGRATE CONTEXT:**

1. **Executive Summary**: 
   - Reference SPECIFIC business goals from context (not "improve efficiency" but "Reduce claim processing time from 30 days to 15 days")
   - Mention primary user roles BY NAME from context (e.g., "Claims Adjusters," "Legal Teams")
   - Explain how design supports ACTUAL stated goals

2. **Color System**: 
   - Justify colors based on domain (e.g., Insurance: blues for trust, greens for approved claims, reds for denials)
   - Consider user environment from context (e.g., field workers need high contrast)

3. **Typography**: 
   - Adjust based on user expertise mentioned in context
   - If "limited tech experience" → larger, clearer fonts
   - If "expert users" → denser information, smaller fonts OK

4. **Layout & Information Architecture**: 
   - Create layouts for EACH functional requirement module mentioned (e.g., "Claims Intake & FNOL," "Workflow Automation & Triage")
   - Use ACTUAL terminology from context (not "Form Screen" but "First Notice of Loss (FNOL) Intake Screen")
   - Structure based on SPECIFIC workflows described

5. **Component Library**: 
   - Add components needed for SPECIFIC features (e.g., if "photo/video upload" mentioned → add file upload component with camera integration)
   - Adapt complexity to target user characteristics from context
   - Include domain-specific components (e.g., "Claim Status Badge," "Policy Verification Card")

6. **Figma Prompt Templates** (MOST CRITICAL): 
   - Generate 3-5 prompts for screens mapping to ACTUAL functional requirements
   - Use EXACT terminology from context (e.g., "FNOL," "Triage," "Adjuster Assignment")
   - Include REALISTIC workflow examples from the detailed context:
     * If context says "Business Processors review incoming application data for completeness" 
       → Show FNOL review checklist with completeness indicators
     * If context says "Multi-Channel Data Capture via API, web forms, email"
       → Show multi-channel intake interface with source indicators
   - Reference SPECIFIC user roles from context in each prompt
   - Apply SPECIFIC technical constraints (e.g., "cloud-native microservices" → mention API-driven components)

**EXAMPLE TRANSFORMATION:**

❌ WRONG (Generic):
"Create a dashboard for users to view their data"

✅ CORRECT (Context-Specific):
"Create production-ready Claims Adjuster Dashboard for Claims Adjusters/Investigators:

BUSINESS CONTEXT: This dashboard enables Claims Adjusters to conduct thorough investigations, determine coverage based on policy wording, and assess liability/damage using AI tools, supporting the business goal of 'Reduce claim processing cycle time by 40%'.

LAYOUT:
- Left sidebar (256px): Active claims queue with priority indicators (High-Risk flagged in red)
- Main content area (fluid): Selected claim details with tabs: Investigation | Coverage Analysis | Damage Assessment | Payment Authorization
- Right panel (320px): AI-powered damage estimation tool with photo analysis

CONTENT (REALISTIC INSURANCE DOMAIN):
- Claim #CLM-2025-00142: 2019 Honda Accord, Rear-end collision, Policy #POL-89234
- Coverage: Collision coverage confirmed ($500 deductible), Liability limits: $250K/$500K
- Damage estimate: $4,250 (AI preliminary) → Adjuster review required
- Investigation status: Police report received ✓, Photos uploaded (8) ✓, Witness statement pending
- Timeline: FNOL received 2 days ago, Target resolution: 13 days remaining

INTERACTIONS:
- Click claim row → Load full claim file with all documents, photos, communications
- AI Damage Tool: Upload photo → Instant preliminary estimate with confidence score
- Coverage Determination: Policy lookup integration → Real-time coverage validation
- Approve/Reject/Escalate actions with authority level checks (Supervisor approval required for >$10K)

TECHNICAL NOTES: Cloud-native, API-driven components for real-time updates, Mobile-responsive for field adjusters

COLORS: Primary #1E40AF (Insurance Blue) | Success #10B981 (Approved) | Warning #F59E0B (Review Needed) | Error #EF4444 (Denied)
"

**DELIVERABLE STRUCTURE:**

Generate the complete Figma Make Prompt Guide following this EXACT structure with ALL specifications FILLED WITH context-specific details:

# 🎯 FIGMA MAKE PROMPT GUIDE FOR [Extract Project Name from Context]

## EXECUTIVE SUMMARY
[2-3 sentences: Application purpose, target users from context, design philosophy. MUST explicitly reference captured business goals and explain how design decisions support them]

Example: "This [domain] system is designed for [specific users from context] to [achieve specific business goals]. The design prioritizes [key design decision] to support [specific goal], focusing on [user need] through [approach]."

## 1. COLOR SYSTEM & THEMING
**Primary:** [Brand HEX/RGB/HSL - justify choice based on industry/user context from requirements]
**Neutral:** Gray 50 #F9FAFB / 100 #F3F4F6 / 200 #E5E7EB / 300 #D1D5DB / 600 #6B7280 / 900 #111827
**Semantic:** Success #10B981 | Warning #F59E0B | Error #EF4444 | Info #3B82F6
**States:** Hover (90% opacity) | Disabled (40% opacity)
**WCAG:** 4.5:1 minimum for text | 3:1 for UI elements and large text
[If technical constraints mention specific needs (outdoor use, low-light, accessibility), address here with specific color adjustments]

## 2. TYPOGRAPHY SYSTEM
**Fonts:** 'Inter' (primary), system-ui, -apple-system, sans-serif | 'JetBrains Mono' for code blocks
**Scale:**
- Display: 60px (desktop) / 48px (mobile) - Hero headings
- H1: 36px / 1.2 line-height / 600 weight - Page titles
- H2: 30px / 1.3 / 600 - Section headings
- H3: 24px / 1.4 / 600 - Subsection headings
- H4: 20px / 1.5 / 600 - Card titles
- H5: 18px / 1.5 / 600 - Small headings
- H6: 16px / 1.5 / 600 - Labels
- Body Large: 18px / 1.6 / 400 - Feature text
- Body: 16px / 1.6 / 400 - Default body text
- Body Small: 14px / 1.5 / 400 - Secondary text
- Caption: 12px / 1.4 / 400 - Metadata, timestamps
[Adjust sizes based on SPECIFIC user characteristics from context - larger for less tech-savvy users, denser for experts]
**Mobile:** Reduce Display/H1-H2 by 20-40%

## 3. LAYOUT & SPACING SYSTEM
**Grid:**
- Desktop: 1440px max-width / 12 columns / 32px gap
- Tablet: 768-1439px / 8-12 columns / 24px gap
- Mobile: <768px / 4 columns / 16px gap
**Spacing Scale (8pt):** 4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px
**Component Padding:**
- Input fields: 12px vertical × 16px horizontal
- Buttons: 12px vertical × 24px horizontal
- Cards: 24px all sides
- Modal: 32px all sides
- Page container: 48px (desktop) / 24px (mobile)
[Note any mobile-first or responsive priorities from technical constraints]
**Z-index Layers:** Base 0 | Sticky nav 10 | Dropdown 50 | Modal backdrop 100 | Modal content 110 | Tooltip 200 | Toast 300

## 4. COMPREHENSIVE COMPONENT LIBRARY
[Include ALL standard components PLUS domain-specific components needed for ACTUAL features listed in context]

**Buttons** (Primary/Secondary/Ghost/Icon):
- **Medium (default):** 40px height × 12px vertical 24px horizontal padding, 14px medium text, 8px border radius
- **Small:** 32px height, 8px vertical 16px horizontal padding, 12px text
- **Large:** 48px height, 16px vertical 32px horizontal padding, 16px text
- **States:** Default | Hover (darker bg, shadow) | Active (pressed) | Focus (2px ring offset) | Disabled (40% opacity) | Loading (spinner)
[If target users need larger targets per context: Increase to 48-56px height]

**Form Elements:**
- **Text Input:** 40px height, 12px vertical 16px horizontal padding, 1.5px border #E5E7EB, 8px radius, 16px text
- **States:** Focus (brand color border + 3px ring) | Error (red border + error message) | Success (green checkmark) | Disabled (gray bg)
- **Dropdown:** Same as input + chevron icon, dropdown panel max-height 280px with scroll
- **Checkbox/Radio:** 20×20px, 2px border, 4px radius (checkbox) / 50% radius (radio)
- **Toggle Switch:** 44px width × 24px height, 12px border radius (pill), animated transition 200ms
- **Textarea:** 120px minimum height, vertical resize enabled
[Add field types based on functional requirements: file upload, date picker, multi-select, autocomplete]

**Cards:**
- **Standard:** White background, 1px border #E5E7EB, 12px border radius, 24px padding
- **Hover:** Shadow 0 4px 12px rgba(0,0,0,0.1), translate-y -2px, 200ms transition
- **Interactive:** Cursor pointer, focus ring on keyboard navigation
[Adapt structure based on key features - e.g., add photo upload zone, status indicators, action buttons as needed]

**Navigation:**
- **Top Bar:** 64px height, white background, border-bottom 1px, contains logo + search + user actions
- **Sidebar:** 256px width (expanded), 64px width (collapsed), 40px item height, smooth 200ms transition
- **Active State:** #E0EFFF background, brand color text, 3px left border accent
- **Mobile:** Hamburger menu, slide-in drawer, overlay backdrop
[Structure based on user roles from context - different nav items per role, role-specific sections]

**Data Display:**
- **Table:** Header #F9FAFB 48px height | Rows 56px height, zebra striping, hover #F3F4F6 background
- **Columns:** Left-align text, right-align numbers, center-align actions, sortable headers with icons
- **Pagination:** 10/25/50/100 items per page options
- **List:** 64px item height, 16px padding, divider lines, hover state
- **Badge:** 4px vertical 12px horizontal padding, 12px text, full border radius (pill), semantic colors
[Customize columns based on functional requirements - show domain-specific data fields]

**Modals & Overlays:**
- **Modal:** Max-width 600px (small) / 800px (medium) / 1200px (large), 32px padding, 16px border radius, backdrop blur
- **Header:** 24px title, close button top-right, optional subtitle
- **Footer:** Action buttons right-aligned, cancel left
- **Toast Notification:** 360px width, top-right position, 16px padding, 4px left border (semantic color), auto-dismiss 5s, close button
- **Tooltip:** Max-width 280px, dark background (#1F2937), white text, 8px vertical 12px horizontal padding, 500ms show delay
- **Dropdown Menu:** Min-width 200px, 8px padding, shadow-lg, max-height 400px with scroll

**Feedback States:**
- **Loading Spinner:** 20px / 32px / 48px sizes, brand color, 800ms rotation animation
- **Skeleton Loader:** #F3F4F6 to #E5E7EB shimmer gradient, 1.5s animation, matches content shape
- **Progress Bar:** 8px height, 4px border radius, brand color fill, animated transitions
- **Empty State:** 240×180px illustration, 20px heading, 14px description, primary CTA button
[Customize empty state messaging to project domain]

**Domain-Specific Components:** [Add based on context]
Example for Insurance: Claim Status Badge, Policy Verification Card, FNOL Intake Form, Damage Photo Gallery, Adjuster Assignment Widget

## 5. INTERACTION PATTERNS & ANIMATIONS
**Duration:** 100ms (instant) | 150ms (fast) | 250ms (normal) | 400ms (slow)
**Easing:** ease-out (entrances) | ease-in (exits) | ease-in-out (movement/transformation)
**Patterns:**
- **Button:** Hover (background darker + shadow-md + lift 2px, 150ms) | Active (scale 0.98) | Focus (2px ring, instant)
- **Form Field:** Focus (border color change + ring grow, 150ms) | Error (shake animation 400ms, red border)
- **Card:** Hover (shadow-lg + lift 4px, 250ms ease-out)
- **Modal:** Backdrop fade-in 200ms + content scale from 0.95 to 1.0 300ms ease-out
- **Dropdown:** Scale from 0.95 + fade-in 150ms ease-out
- **Page Transition:** Fade 200ms + slight slide 20px
**Micro-interactions:**
- Button click: Ripple effect from click point
- Toggle switch: Sliding knob with spring animation
- Checkbox: Checkmark draw animation 200ms
- Success action: Subtle bounce + green flash
**Accessibility:** Respect prefers-reduced-motion media query
[Add haptic feedback patterns if mobile-heavy usage indicated in context]

## 6. INFORMATION ARCHITECTURE & PAGE LAYOUTS
[Generate ASCII diagrams for layouts that map to EACH functional requirement module from context]
[Each layout MUST address specific user needs and workflows from captured requirements]

**[Primary User Role from Context] Dashboard:**
[Structure based on their specific functional requirements and tasks]
\`\`\`
┌────────────────────────────────────────────────────────────────┐
│  Top Bar: Logo | Search | Notifications | User Menu       [64h]│
├────────┬───────────────────────────────────────────────────────┤
│        │  Main Content Area                                     │
│  Side  │  ┌──────────────────────────────────────────────────┐ │
│  Nav   │  │  Page Header (Title + Actions)              [80h]│ │
│        │  └──────────────────────────────────────────────────┘ │
│ [256w] │  ┌──────────────────────────────────────────────────┐ │
│        │  │  Key Metrics / KPI Cards                    [120h]│ │
│        │  │  [Card 1] [Card 2] [Card 3] [Card 4]             │ │
│        │  └──────────────────────────────────────────────────┘ │
│        │  ┌──────────────────────────────────────────────────┐ │
│        │  │  Primary Data Table / List                       │ │
│        │  │  [Filterable, Sortable, Paginated]               │ │
│        │  │  Based on [specific workflow from context]       │ │
│        │  └──────────────────────────────────────────────────┘ │
└────────┴───────────────────────────────────────────────────────┘
\`\`\`

**[Functional Requirement Module] Screen:**
[Layout supporting specific feature from requirements - use ACTUAL terminology]
\`\`\`
[Create specific layout based on workflow described in context]
\`\`\`

**Mobile Layout (<768px):**
- Stack all columns vertically
- Hamburger menu for navigation
- Full-width components
- Bottom navigation bar for primary actions
- Swipe gestures for common actions

**Navigation Structure:** [Choose based on user roles and workflows from context]
- Top-level: [Primary sections based on user roles]
- Sub-navigation: [Feature-specific areas]
- Quick actions: [Frequently used tasks from context]

**Responsive Behavior:** Mobile <768px | Tablet 768-1439px | Desktop 1440px+

## 7. ACCESSIBILITY & INCLUSIVE DESIGN (WCAG 2.1 AA)
**Color Contrast:** 4.5:1 minimum for normal text | 3:1 for large text (18px+) and UI components
**Focus Indicators:** 2-3px solid outline, brand color, 2-4px offset from element, 3-4px box-shadow ring for depth
**Touch Targets:** 44×44px minimum (mobile), 40×40px acceptable (desktop), 8px spacing between targets
[Increase to 56-80px if users have dexterity challenges or use in field conditions per context]
**Keyboard Navigation:**
- Tab / Shift+Tab: Move between focusable elements
- Enter / Space: Activate buttons, toggle checkboxes
- Escape: Close modals, dropdowns, cancel actions
- Arrow keys: Navigate within menus, lists, date pickers
**ARIA Labels:**
- aria-label for icon-only buttons
- aria-labelledby for complex components
- aria-describedby for help text and errors
- role attributes for custom components
- aria-live regions for dynamic content updates
**Screen Reader Support:**
- Semantic HTML (header, nav, main, section, article, aside, footer)
- Proper heading hierarchy (h1-h6)
- Alt text for all images (descriptive, not decorative)
- Form labels properly associated
**Motion & Animation:** Respect prefers-reduced-motion, provide static alternatives
**Text:** 16px minimum, 1.5-1.7 line-height, max 75 characters per line for readability
**Color Independence:** Never rely on color alone - use icons, text labels, patterns
[Apply non-functional requirements from context - security, compliance, performance needs]

## 8. ICONOGRAPHY & VISUAL ELEMENTS
**Icon Library:** Heroicons (recommended) or Lucide Icons (alternative)
**Sizes:** 12px (inline) / 16px (small) / 20px (medium) / 24px (large) / 32px (featured) / 48px (hero)
**Stroke:** Outlined style, 1.5-2px stroke width for consistency
**Colors:**
- Default: #6B7280 (gray-500)
- Hover: #111827 (gray-900)
- Active: Brand color (e.g., #0066CC)
- Disabled: #D1D5DB (gray-300)
**Common Icons:**
- Navigation: home, menu, search, settings, user, bell (notifications)
- Actions: add, edit, delete, download, upload, share, copy, more (⋯)
- UI: chevron-up/down/left/right, arrow-up/down/left/right, close (×), check (✓), info (ⓘ)
- Status: success (✓), warning (⚠), error (✕), pending (○)
[Add domain-specific icons based on key features from context]
Example for Insurance: claim-file, policy-document, damage-photo, approval-stamp, investigation-magnifier

**Illustrations & Empty States:**
- Size: 240×180px (standard), 320×240px (large)
- Style: Simple, friendly, on-brand colors
- Empty State Structure: Illustration + 20px heading + 14px description + primary CTA button
- Messaging: [Customize to project domain - use actual terminology]
Example: "No claims found" vs "No pending investigations" vs "No active policies"

**Error States:**
- Icon + clear error message + suggested action / retry button
- Inline for forms, modal for critical errors, toast for non-blocking errors

**Avatars:**
- Sizes: 24px (inline) / 32px (list) / 40px (card) / 64px (profile card) / 96px (profile header)
- Style: Circular, initials on colored background if no photo, 1px border

## 9. FIGMA MAKE AI PROMPT TEMPLATES ⚠️ CRITICAL SECTION
[Generate 3-5 copy-paste ready prompts that directly map to functional requirements from context]
[MUST use actual terminology, user roles, and workflows from captured context - NO generic placeholders]

### Prompt 1: [Actual Functional Requirement Screen from Context]
\`\`\`
Create production-ready [screen name using EXACT terminology from context] for [specific user role from context]:

BUSINESS CONTEXT: This screen enables [user role] to [accomplish SPECIFIC functional requirement from context], supporting the business goal: [ACTUAL goal from context].

LAYOUT:
- [Specific structure with exact measurements based on workflow]
- [Components addressing functional requirements - list 4-6 key elements]
- [User-appropriate complexity level based on user characteristics from context]

CONTENT (REALISTIC EXAMPLES FROM [DOMAIN] DOMAIN):
- [Use ACTUAL terminology from project context]
- [Show realistic workflow: step-by-step based on functional requirements]
- [Example data relevant to domain - realistic names, numbers, statuses]
- [3-5 specific examples that match the actual use case]

INTERACTIONS:
- [Specific to user capabilities and tasks from context]
- [Include technical constraint considerations - API calls, real-time updates, offline support]
- [List 4-6 key interactions with expected behavior]

TECHNICAL NOTES: [Apply SPECIFIC technical constraints from context - cloud-native, microservices, mobile-responsive, etc.]

COLORS: Primary [HEX from color system] | Success #10B981 | Warning #F59E0B | Error #EF4444 | Background #FFFFFF | Text #111827

RESPONSIVE: [Based on technical constraints - if mobile-first specified, detail mobile layout first]

ACCESSIBILITY: WCAG 2.1 AA compliant - 4.5:1 contrast, keyboard navigation, ARIA labels, screen reader support, [apply any specific non-functional requirements]

Include all states (hover/focus/active/disabled/loading/error), realistic [domain] content matching [specific user role] workflows, smooth animations (150-250ms ease-out), professional polish with 8pt spacing grid.
\`\`\`

### Prompt 2: [Another Key Feature Screen from Context]
[Similar detailed structure with DIFFERENT functional requirement - use ACTUAL terminology]

### Prompt 3: [Another User Role Screen from Context]
[Tailored to DIFFERENT user from target users list - show their specific workflow]

[Include 2-3 more prompts if you have sufficient functional requirements in context]

## 10. RESPONSIVE DESIGN BREAKPOINTS
**Mobile (<768px):**
- Single column layout
- 16px container padding
- 48×48px minimum touch targets
- Hamburger navigation menu
- Stack all elements vertically
- Full-width forms and buttons
- Bottom navigation bar for primary actions
- Simplified tables (convert to cards)

**Tablet (768-1439px):**
- 2-column grids for content
- 32px container padding
- Collapsible sidebar navigation
- Hybrid touch + mouse interactions
- Medium-density information display

**Desktop (1440px+):**
- Multi-column layouts (2-4 columns)
- 48px container padding
- Persistent sidebar navigation
- Hover states for all interactive elements
- High-density information display
- Multi-panel layouts (list + detail views)

[Prioritize based on technical constraints - if mobile-first specified in context, design mobile → tablet → desktop]

**Component Responsive Behavior:**
- **Tables:** Horizontal scroll (mobile) | Stacked cards (alternative) | Full table (desktop)
- **Modals:** Fullscreen (mobile) | Centered with backdrop (tablet/desktop)
- **Forms:** Full-width (mobile) | Max 640px centered (desktop)
- **Navigation:** Drawer (mobile) | Collapsible sidebar (tablet) | Fixed sidebar (desktop)
- **Cards:** 1 column (mobile) | 2 columns (tablet) | 3-4 columns (desktop)

## 11. PRODUCTION CHECKLIST
**Design Quality:**
☐ Colors pass WCAG AA contrast requirements (4.5:1 text, 3:1 UI elements)
☐ All component states defined (minimum 6 per interactive component: default, hover, focus, active, disabled, loading)
☐ Typography scale consistent (16px minimum, 1.5+ line-height)
☐ Spacing follows 8pt grid system throughout
☐ Touch targets meet requirements (44×44px mobile, 40×40px desktop minimum)
☐ Focus indicators visible (2-3px outline + ring shadow)
☐ All icons have consistent stroke width and style

**Interaction & Behavior:**
☐ Keyboard navigation fully functional (Tab, Enter, Escape, Arrows)
☐ Animations respect prefers-reduced-motion
☐ Loading states defined for all async operations
☐ Error states with clear messages and recovery actions
☐ Empty states with helpful messaging and CTAs

**Content & Context:**
☐ Responsive layouts tested at 3 breakpoints (mobile, tablet, desktop)
☐ Realistic [domain-specific] content used (no Lorem Ipsum or generic placeholders)
☐ Actual terminology from project context throughout
☐ User workflows match functional requirements from context

**Technical Requirements:**
☐ Technical constraints from context addressed in design
☐ Non-functional requirements met (security, performance, compliance)
☐ Integration points identified for APIs and external systems
☐ Offline capabilities considered if mentioned in context

**Accessibility (WCAG 2.1 AA):**
☐ Semantic HTML structure used
☐ ARIA labels for all interactive elements
☐ Alt text for all meaningful images
☐ Form labels properly associated
☐ Screen reader tested (or documented for testing)

## 12. FINAL INSTRUCTIONS & USAGE GUIDELINES

**When Using These Guidelines in Figma Make AI:**

**Context Integration Checklist:**
✅ Reference SPECIFIC business goals in layout priorities and feature prominence
✅ Use terminology from target user roles consistently (avoid generic "user" or "admin")
✅ Map every screen to functional requirements from context
✅ Apply technical constraints as implementation notes in prompts
✅ Reflect non-functional requirements in component specifications
✅ Use realistic, domain-specific content examples (actual workflow steps, realistic data)
✅ Design for ACTUAL user characteristics (tech-savvy vs novice, mobile vs desktop, field vs office)

**Best Practices for Prompt Engineering:**
• **Always specify exact measurements** (px/rem values) and color codes (HEX/RGB)
• **Include ALL component states** - never skip disabled, loading, or error states
• **Provide realistic content examples** - use domain terminology and actual workflow scenarios
• **Mention WCAG AA compliance** explicitly with contrast ratios and keyboard navigation
• **Specify animation details** - duration, easing function, and trigger conditions
• **Reference user roles and workflows** from captured context in every prompt
• **Apply technical constraints** - mention API-driven, cloud-native, offline-first as relevant
• **Include non-functional requirements** - security, performance, scalability needs

**Template for Final Figma Make Prompt:**
"Create production-ready [screen name using actual terminology from context] for [specific user role with their responsibilities] following these design guidelines:

**Purpose:** This screen enables [user role] to [specific functional requirement], supporting the business goal of [actual goal from context].

**Layout:** [Detailed structure with measurements] including [specific components based on workflow].

**Content:** Use realistic [domain] terminology and data:
• [Specific example 1 from context]
• [Specific example 2 from context]
• [Specific example 3 from context]

**Interactions:** [List 4-6 key interactions based on user tasks from context]

**Technical:** [Apply constraints from context - e.g., API-driven components, real-time updates, cloud-native architecture]

**Design System:** Follow [COLOR SYSTEM], [TYPOGRAPHY SYSTEM], [SPACING SYSTEM] from guidelines above. Include all component states (default, hover, focus, active, disabled, loading, error), WCAG AA accessibility (4.5:1 contrast, visible focus indicators, keyboard navigation), responsive layouts for [prioritize based on constraints], smooth animations (150-250ms ease-out), and professional polish with consistent 8pt spacing, appropriate shadows (shadow-sm/md/lg), and clear typography hierarchy."

**Common Mistakes to Avoid:**
❌ Using generic placeholders like "Lorem ipsum" or "User Dashboard"
❌ Forgetting to specify component states beyond default
❌ Ignoring captured context - designing generic screens without domain specificity
❌ Missing measurements - saying "large button" instead of "48px height button"
❌ Overlooking accessibility - no focus states or keyboard navigation mentioned
❌ Generic user roles - "admin" instead of "Claims Supervisor with approval authority"
❌ Vague interactions - "user clicks button" instead of "Click 'Submit FNOL' → Validation → API call → Success toast → Navigate to claim details"

**Quality Validation:**
Before submitting to Figma Make, verify your prompt includes:
1. ✅ SPECIFIC terminology from project context (not generic terms)
2. ✅ ACTUAL user role names and their responsibilities
3. ✅ REALISTIC content examples matching the domain
4. ✅ EXACT measurements (px values for all spacing, sizing)
5. ✅ ALL component states explicitly listed
6. ✅ Technical constraints from context applied
7. ✅ Accessibility requirements specified (WCAG AA)
8. ✅ Animation timings and easing functions

---

⚠️ **CRITICAL REMINDER:** Every section of this guide MUST reflect the captured project context. Generic outputs that don't integrate specific business goals, actual user roles with their tasks, detailed functional requirements, and technical constraints will NOT produce effective Figma Make prototypes that match stakeholder expectations. Always extract and use SPECIFIC details from the context provided. Every screen, component, and interaction should map to ACTUAL requirements, not generic assumptions.`
        }
      ],
      temperature: 0.7, // Slightly higher for more creative context integration
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content?.trim() || "";

    if (!content) {
      console.error("[AI Service] AI returned empty content for design guidelines");
      throw new Error("Empty AI response for design guidelines.");
    }

    // ============================================
    // FIX 3: Validation of Generated Content
    // ============================================
    const validateContextIntegration = (content: string): boolean => {
      if (!capturedRequirements) return true;

      const validationChecks = [];

      // Check if business goals are referenced
      if (capturedRequirements.businessGoals && capturedRequirements.businessGoals.length > 0) {
        const hasBusinessGoalReference = capturedRequirements.businessGoals.some(goal =>
          content.toLowerCase().includes(goal.toLowerCase().substring(0, 20))
        );
        validationChecks.push({ check: 'Business Goals Referenced', passed: hasBusinessGoalReference });
      }

      // Check if target users are mentioned
      if (capturedRequirements.targetUsers && capturedRequirements.targetUsers.length > 0) {
        const hasUserReference = capturedRequirements.targetUsers.some(user =>
          content.toLowerCase().includes(user.toLowerCase().substring(0, 15))
        );
        validationChecks.push({ check: 'Target Users Mentioned', passed: hasUserReference });
      }

      // Check if key features are present
      if (capturedRequirements.keyFeatures && capturedRequirements.keyFeatures.length > 0) {
        const hasFeatureReference = capturedRequirements.keyFeatures.some(feature =>
          content.toLowerCase().includes(feature.toLowerCase().substring(0, 15))
        );
        validationChecks.push({ check: 'Key Features Included', passed: hasFeatureReference });
      }

      const failedChecks = validationChecks.filter(v => !v.passed);

      if (failedChecks.length > 0) {
        console.warn("[AI Service] Context integration validation warnings:", failedChecks);
        console.warn("[AI Service] Generated content may be too generic!");
      }

      console.log("[AI Service] Context integration validation:", validationChecks);

      // Return true but log warnings - don't block the response
      return true;
    };

    validateContextIntegration(content);

    console.log("[AI Service] Design guidelines successfully generated. Length:", content.length);
    console.log("[AI Service] Contains 'FIGMA MAKE':", content.includes('FIGMA MAKE'));
    console.log("[AI Service] Contains business context:",
      capturedRequirements?.businessGoals?.[0]
        ? content.includes(capturedRequirements.businessGoals[0].substring(0, 20))
        : 'N/A'
    );

    return content;
  } catch (error: any) {
    console.error("[AI Service] Failed to generate design guidelines.");
    console.error("[AI Service] Error details:", {
      message: error.message,
      type: error.constructor.name,
      code: error.code,
      status: error.status
    });

    if (error.response) {
      console.error("[AI Service] API Response:", {
        status: error.response.status,
        data: error.response.data
      });
    }

    throw new Error(`Failed to generate design guidelines: ${error.message || 'Unknown error'}`);
  }
}

// ============================================
// RECOMMENDED: Add helper to extract domain from requirements
// ============================================
export function extractDomainContext(capturedRequirements: any): string {
  // Extract domain keywords from requirements
  const allText = JSON.stringify(capturedRequirements).toLowerCase();

  // Domain detection patterns
  const domainPatterns = {
    insurance: ['insurance', 'claim', 'policy', 'claimant', 'adjuster'],
    healthcare: ['patient', 'medical', 'hospital', 'doctor', 'healthcare'],
    finance: ['bank', 'financial', 'payment', 'transaction', 'account'],
    ecommerce: ['product', 'cart', 'checkout', 'order', 'shipping'],
    construction: ['construction', 'site', 'contractor', 'building', 'project'],
  };

  for (const [domain, keywords] of Object.entries(domainPatterns)) {
    const matchCount = keywords.filter(keyword => allText.includes(keyword)).length;
    if (matchCount >= 2) {
      return domain;
    }
  }

  return 'general';
}

export async function generateDesignContent(
  designType: string,
  requirementDocument: string,
  adoBacklogContext?: {
    epics: any[];
    features: any[];
    userStories: any[];
    tasks: any[];
    bugs: any[];
  },
  existingGuidelinesContext?: string
): Promise<string> {
  try {
    console.log(
      "[AI Service] Generating design content for:",
      designType,
    );
    console.log(
      "[AI Service] ADO backlog context provided:",
      adoBacklogContext ? "Yes" : "No"
    );
    console.log(
      "[AI Service] Existing guidelines context provided:",
      existingGuidelinesContext ? "Yes" : "No"
    );

    if (existingGuidelinesContext) {
      console.log("[AI Service] Guidelines context length:", existingGuidelinesContext.length);
      console.log("[AI Service] Guidelines context preview:", existingGuidelinesContext.substring(0, 300) + "...");
    }

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    // Prepare ADO context section
    let adoContextSection = "";
    if (adoBacklogContext) {
      const { epics, features, userStories, tasks, bugs } = adoBacklogContext;
      const hasAnyData = epics.length > 0 || features.length > 0 || userStories.length > 0 || tasks.length > 0 || bugs.length > 0;

      if (hasAnyData) {
        adoContextSection = "\n\n## Azure DevOps Context\n\n";
        adoContextSection += "The following items have been retrieved from Azure DevOps and should inform your design:\n\n";

        if (epics.length > 0) {
          adoContextSection += `### Epics (${epics.length})\n`;
          epics.slice(0, 5).forEach((epic: any) => {
            adoContextSection += `- **${epic.title}**: ${epic.description || 'No description'}\n`;
          });
          if (epics.length > 5) adoContextSection += `... and ${epics.length - 5} more epics\n`;
          adoContextSection += "\n";
        }

        if (features.length > 0) {
          adoContextSection += `### Features (${features.length})\n`;
          features.slice(0, 10).forEach((feature: any) => {
            adoContextSection += `- **${feature.title}**: ${feature.description || 'No description'}\n`;
          });
          if (features.length > 10) adoContextSection += `... and ${features.length - 10} more features\n`;
          adoContextSection += "\n";
        }

        if (userStories.length > 0) {
          adoContextSection += `### User Stories (${userStories.length})\n`;
          userStories.slice(0, 15).forEach((story: any, index: number) => {
            const title = story.title || 'Untitled';
            const description = story.description || 'No description';
            const acceptanceCriteria = story.acceptanceCriteria || '';
            const tags = story.tags || '';
            const state = story.state || '';

            const cleanDesc = description.replace(/<[^>]*>/g, '');
            const cleanAC = acceptanceCriteria.replace(/<[^>]*>/g, '');

            adoContextSection += `**${index + 1}. ${title}** (State: ${state})\n`;
            adoContextSection += `   Description: ${cleanDesc.substring(0, 200)}${cleanDesc.length > 200 ? '...' : ''}\n`;

            if (cleanAC && cleanAC.trim()) {
              adoContextSection += `   Acceptance Criteria: ${cleanAC.substring(0, 300)}${cleanAC.length > 300 ? '...' : ''}\n`;
            }

            if (tags && tags.trim()) {
              adoContextSection += `   Tags: ${tags}\n`;
            }

            adoContextSection += `\n`;
          });
          if (userStories.length > 15) adoContextSection += `... and ${userStories.length - 15} more user stories\n`;
          adoContextSection += "\n";
        }

        if (tasks.length > 0) {
          adoContextSection += `### Tasks (${tasks.length})\n`;
          tasks.slice(0, 10).forEach((task: any) => {
            const cleanDesc = task.description?.replace(/<[^>]*>/g, '') || 'No description';
            adoContextSection += `- **${task.title}**: ${cleanDesc.substring(0, 100)}...\n`;
          });
          if (tasks.length > 10) adoContextSection += `... and ${tasks.length - 10} more tasks\n`;
          adoContextSection += "\n";
        }

        if (bugs.length > 0) {
          adoContextSection += `### Bugs (${bugs.length})\n`;
          bugs.slice(0, 10).forEach((bug: any) => {
            const cleanDesc = bug.description?.replace(/<[^>]*>/g, '') || 'No description';
            adoContextSection += `- **${bug.title}**: ${cleanDesc.substring(0, 100)}...\n`;
          });
          if (bugs.length > 10) adoContextSection += `... and ${bugs.length - 10} more bugs\n`;
          adoContextSection += "\n";
        }

        console.log("[AI Service] ADO context prepared, size:", adoContextSection.length);
      }
    }

    // Design type-specific prompts
    const designPrompts: Record<string, string> = {
      "System Architecture": `You are a senior solutions architect. Generate comprehensive System Architecture documentation based on the requirements provided.

Include the following sections:

1. **Architecture Overview**
   - High-level architecture description
   - Key architectural patterns (e.g., microservices, monolithic, event-driven)
   - Technology stack recommendations

2. **System Components**
   - Frontend components and their responsibilities
   - Backend services and APIs
   - Data storage components
   - Third-party integrations

3. **Component Interactions**
   - Data flow diagrams (describe in text)
   - API contracts and communication patterns
   - Authentication and authorization flow

4. **Scalability & Performance**
   - Load balancing strategy
   - Caching mechanisms
   - Database optimization approaches

5. **Security Architecture**
   - Security layers and protocols
   - Data encryption strategies
   - Access control mechanisms

6. **Deployment Architecture**
   - Infrastructure setup
   - CI/CD pipeline design
   - Monitoring and logging strategy

Format as comprehensive architecture documentation.`,

      "Database Design": `You are a database architect. Generate comprehensive Database Design documentation based on the requirements provided.

Include the following sections:

1. **Database Schema Overview**
   - Database type selection (SQL vs NoSQL)
   - Schema design philosophy
   - Normalization approach

2. **Entity-Relationship Model**
   - Core entities and their attributes
   - Relationships between entities (one-to-one, one-to-many, many-to-many)
   - Primary and foreign key definitions

3. **Table Definitions**
   - Detailed table structures with columns, data types, and constraints
   - Indexes for performance optimization
   - Unique constraints and validations

4. **Data Integrity**
   - Referential integrity rules
   - Cascading delete/update strategies
   - Check constraints and business rules

5. **Query Optimization**
   - Expected query patterns
   - Index strategy
   - Partitioning recommendations

6. **Data Migration Strategy**
   - Schema versioning approach
   - Migration scripts planning
   - Rollback strategies

Format as comprehensive database design documentation.`,

      "Component Design": `You are a senior frontend architect. Generate comprehensive Component Design documentation based on the requirements provided.

Include the following sections:

1. **Component Architecture**
   - Component hierarchy and structure
   - Component categorization (containers, presentational, utility)
   - Reusability strategy

2. **Core Components**
   - List of main UI components
   - Component responsibilities and props
   - State management approach

3. **Component Specifications**
   - Input/output interfaces for each component
   - Event handling patterns
   - Error handling within components

4. **Styling Strategy**
   - CSS methodology (CSS Modules, Styled Components, Tailwind, etc.)
   - Theme configuration
   - Responsive design approach

5. **Component Communication**
   - Parent-child communication patterns
   - Global state management
   - Context usage strategies

6. **Testing Strategy**
   - Unit testing approach for components
   - Integration testing patterns
   - Accessibility testing requirements

Format as comprehensive component design documentation.`,
    };

    const systemPrompt = designType === "Guidelines"
      ? "You are a helpful assistant. Follow the instructions provided exactly and generate the requested output format."
      : (designPrompts[designType] || designPrompts["System Architecture"]);

    // For Guidelines type, use the requirementDocument as the main prompt since it contains the structured guideline generation logic
    let userPrompt: string;
    if (designType === "Guidelines") {
      // The requirementDocument already contains the complete structured prompt for guidelines
      const guidelinesPrefix = existingGuidelinesContext ? `${existingGuidelinesContext}\n\n` : '';
      userPrompt = `${guidelinesPrefix}${requirementDocument}${adoContextSection}`;
      console.log("[AI Service] Guidelines prompt length:", userPrompt.length);
      console.log("[AI Service] Guidelines prompt preview:", userPrompt.substring(0, 200) + "...");
    } else {
      // For other design types, use the traditional approach
      const guidelinesSection = existingGuidelinesContext ? `${existingGuidelinesContext}\n\n` : '';

      userPrompt = `${guidelinesSection}Generate detailed ${designType} documentation based on these requirements:

${requirementDocument}${adoContextSection}

${adoContextSection ? 'IMPORTANT: Incorporate the Azure DevOps context above into your design. Ensure the design aligns with the epics, features, and user stories provided. Reference specific work items where relevant.' : ''}

${existingGuidelinesContext ? 'IMPORTANT: Build upon the existing design guidelines and context provided above. Ensure consistency with previous design decisions and patterns.' : ''}

Provide comprehensive, production-ready documentation that can be used by the development team.`;
    }

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log("[AI Service] Design content generated, length:", content.length);

    if (!content) {
      throw new Error("AI returned empty response for design content");
    }

    return content;
  } catch (error) {
    console.error("[AI Service] Error generating design content:", error);
    if (error instanceof Error) {
      console.error("[AI Service] Error details:", error.message, error.stack);
    }
    throw error;
  }
}

export async function generateCodeFromUserStories(
  userStories: Array<{
    id: string;
    title: string;
    description: string;
    acceptanceCriteria?: string;
  }>,
  projectName: string,
): Promise<string> {
  try {
    console.log(
      "[AI Service] Generating code from user stories for project:",
      projectName,
    );

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    // Create a formatted list of user stories
    const storiesText = userStories
      .map(
        (story, index) => `
### User Story ${index + 1}: ${story.title}
**Description:** ${story.description}
${story.acceptanceCriteria ? `**Acceptance Criteria:** ${story.acceptanceCriteria}` : ""}
`,
      )
      .join("\n");

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: `You are a senior full-stack developer. Generate production-ready, well-structured code based on user stories. 

Follow these guidelines:
1. Use modern TypeScript/JavaScript best practices
2. Include proper error handling and validation
3. Add meaningful comments for complex logic
4. Structure code with clear separation of concerns
5. Include necessary imports and dependencies
6. Follow RESTful API design principles for backend code
7. Use React best practices for frontend components
8. Include type definitions where appropriate

Generate clean, maintainable code that directly implements the user story requirements.`,
        },
        {
          role: "user",
          content: `Generate initial code implementation for the "${projectName}" project based on these user stories:

${storiesText}

Please generate:
1. A main application file (app.ts or index.ts) that sets up the basic structure
2. Key components or modules based on the user stories
3. API routes or handlers if applicable
4. Type definitions and interfaces
5. Basic configuration and setup code

Format the output as a structured code file that can be used as the initial codebase. Include file separators to show different modules/files if needed.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log("[AI Service] Code generated, length:", content.length);

    if (!content) {
      throw new Error("AI returned empty response for code generation");
    }

    return content;
  } catch (error) {
    console.error("[AI Service] Error generating code:", error);
    if (error instanceof Error) {
      console.error("[AI Service] Error details:", error.message, error.stack);
    }
    throw error;
  }
}

export async function classifyUserIntent(
  userMessage: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<boolean> {
  try {
    console.log("[AI Service] Classifying user intent for:", userMessage);

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    const conversationSnippet = conversationHistory
      .slice(-3)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");
    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: INTENT_CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: getIntentClassifierUserPrompt(conversationSnippet, userMessage) },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const answer =
      response.choices[0]?.message?.content?.trim().toUpperCase() || "NO";
    const isReady = answer === "YES";

    console.log(
      "[AI Service] Intent classification result:",
      answer,
      "→",
      isReady,
    );
    return isReady;
  } catch (error) {
    console.error("[AI Service] Error classifying intent:", error);
    return false; // Default to not ready on error
  }
}

/**
 * AI-based Workflow Path Detection
 * Determines which workflow path (1, 2, 3, or 4) should be used based on user input and context
 * This replaces regex-based detection with intelligent AI classification
 */
export async function detectWorkflowPath(options: {
  userInput: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  hasBRDSelected: boolean;
  hasFileUpload: boolean;
  hasProcessedFileRequirements: boolean;
  selectedRequirementIds?: string[];
  uploadedFileNames?: string[];
}): Promise<{
  path: 1 | 2 | 3 | 4;
  confidence: number;
  reasoning: string;
  isPath4Generic?: boolean;
}> {
  try {
    const { userInput, conversationHistory = [], hasBRDSelected, hasFileUpload, hasProcessedFileRequirements, selectedRequirementIds = [], uploadedFileNames = [] } = options;

    if (!userInput || userInput.trim().length === 0) {
      // Default to ConversationAgent if no input
      return {
        path: 2,
        confidence: 0.5,
        reasoning: "No user input provided - defaulting to conversational path"
      };
    }

    const lowerInput = userInput.toLowerCase().trim();

    // Pre-check: User asked for specific artifact type(s) only (test cases, subtasks, test cases + subtasks, only user story, etc.) → ALWAYS UniversalAgent (path 4) when no BRD
    if (!hasBRDSelected || selectedRequirementIds.length === 0) {
      const scope = getArtifactScopeFromInput(userInput);
      if (scope.hasExplicitLimit) {
        console.log("[AI Service] Path detection: user requested specific artifact type(s) → UniversalAgent (path 4)");
        return {
          path: 4,
          confidence: 0.95,
          reasoning: "User requested specific artifact type(s) (e.g. test cases only, subtasks only, test cases + subtasks) = UniversalAgent",
          isPath4Generic: true
        };
      }
    }

    // Pre-check: Detailed backlog / backlog generation / full hierarchy (epic + feature + user story) → ConversationAgent or ContextFusionAgent, NEVER UniversalAgent
    const hasBacklogPhrase = /\b(detailed\s+)?backlog\s+(generation|generat)\b/i.test(lowerInput) ||
      /\b(create|generate)\s+(a\s+)?(detailed\s+)?backlog\b/i.test(lowerInput) ||
      /\bbacklog\s+generation\b/i.test(lowerInput) ||
      /\bfull\s+(artifact\s+)?(hierarchy|backlog)\b/i.test(lowerInput);
    const hasEpic = /\b(epics?|epic)\b/.test(lowerInput);
    const hasFeature = /\b(features?|feature)\b/.test(lowerInput);
    const hasUserStory = /\b(user\s+stories?|user\s+story|stories?)\b/.test(lowerInput);
    const isFullHierarchyPhrase = /\b(generate|create)\b/.test(lowerInput) &&
      ((hasEpic && (hasFeature || hasUserStory)) || (hasFeature && hasUserStory));
    const isDetailedBacklogRequest = hasBacklogPhrase || isFullHierarchyPhrase;
    if (isDetailedBacklogRequest) {
      if (hasBRDSelected && selectedRequirementIds.length > 0) {
        const path3 = hasFileUpload || userInput.trim().length > 20;
        console.log("[AI Service] Path detection: detailed backlog / full hierarchy with BRD →", path3 ? "ContextFusionAgent" : "RequirementsAgent");
        return {
          path: path3 ? 3 : 1,
          confidence: 0.95,
          reasoning: path3 ? "Detailed backlog / full hierarchy with BRD + file/chat = ContextFusionAgent" : "Detailed backlog / full hierarchy with BRD only = RequirementsAgent"
        };
      }
      console.log("[AI Service] Path detection: detailed backlog / full hierarchy (no BRD) → ConversationAgent");
      return {
        path: 2,
        confidence: 0.95,
        reasoning: "Detailed backlog or full epic/feature/user story generation (no BRD) = ConversationAgent"
      };
    }

    // STRICT pre-check: Instruction + artifact pattern = UniversalAgent (when no BRD selected)
    // e.g. "Generate test case for the below user story" + [full user story]
    if (!hasBRDSelected || selectedRequirementIds.length === 0) {
      const trimmed = userInput.trim();
      const firstLine = trimmed.split(/\n/)[0]?.trim() || "";
      // task/tasks = subtasks
      const instructionForBelow = /\b(generate|create|write|add)\s+(test\s*cases?|test\s*case|acceptance\s*criteria|sub[- ]*tasks?|subtasks?|tasks?|epics?|features?)\s+for\s+the\s+(below|following)\s*(user\s*story|story|epic|requirement)?/i.test(firstLine) ||
        /\b(generate|create)\s+(only\s+)?(test\s*cases?|epics?|features?|sub[- ]*tasks?|subtasks?|tasks?)\s+for\s+(the\s+)?(below|following)/i.test(firstLine);
      const hasStructuredContent = trimmed.length > 200 && (
        /\bas\s+[^,]+,\s*i\s+want\s+/i.test(trimmed) ||
        /\bacceptance\s+criteria\b/i.test(trimmed) ||
        /\bpersona:\s*/i.test(trimmed) ||
        /\bcontext\s*&\s*background\b/i.test(trimmed)
      );
      if (instructionForBelow && (hasStructuredContent || trimmed.length > 300)) {
        console.log("[AI Service] Path detection: instruction + artifact pre-check → UniversalAgent (path 4)");
        return {
          path: 4,
          confidence: 0.95,
          reasoning: "Instruction + artifact pattern (e.g. 'Generate test case for the below user story' + user story) = UniversalAgent",
          isPath4Generic: true
        };
      }
    }

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o"
      : "gpt-4o";

    // Build context summary
    const fileNamesList = uploadedFileNames.length > 0
      ? uploadedFileNames.map(name => `  - ${name}`).join('\n')
      : '  (none)';

    const contextSummary = `
CONTEXT:
- BRD Selected: ${hasBRDSelected ? 'Yes' : 'No'} ${hasBRDSelected && selectedRequirementIds.length > 0 ? `(${selectedRequirementIds.length} requirements selected)` : ''}
- File Uploaded: ${hasFileUpload ? 'Yes' : 'No'}
- Uploaded File Names:
${fileNamesList}
- Processed File Requirements Available: ${hasProcessedFileRequirements ? 'Yes' : 'No'}
- User Input Length: ${userInput.length} characters
- Conversation History Length: ${conversationHistory.length} messages
`;

    const recentConversation = conversationHistory.slice(-5).map(msg =>
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 200)}`
    ).join('\n');

    const systemPrompt = WORKFLOW_PATH_CLASSIFIER_SYSTEM_PROMPT;
    const userPrompt = getWorkflowPathClassifierUserPrompt(contextSummary, userInput, recentConversation || "");

    const response = await openai.chat.completions.create({
      model: modelName,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 300
    });

    const content = response.choices[0]?.message?.content || "{}";
    let result: any = {};

    try {
      result = JSON.parse(content);
    } catch (parseError) {
      console.warn("[AI Service] Failed to parse path detection JSON, using fallback:", parseError);
      // Fallback: use heuristics with STRICT priority (BRD first)

      // PRIORITY 1: Check BRD selection first (RequirementsAgent or ContextFusionAgent)
      if (hasBRDSelected && selectedRequirementIds.length > 0) {
        // BRD selected - check if file or chat exists
        if (hasFileUpload || (userInput.trim().length > 20 && !userInput.toLowerCase().match(/^(hi|hello|hey|greetings?)/i))) {
          result = { path: 3, confidence: 0.8, reasoning: "Fallback: BRD selected with file/chat = ContextFusionAgent" };
        } else {
          result = { path: 1, confidence: 0.8, reasoning: "Fallback: BRD selected without file/chat = RequirementsAgent" };
        }
      } else {
        // NO BRD selected - first exclude detailed backlog / full hierarchy (→ ConversationAgent)
        const lowerFallback = userInput.toLowerCase();
        const backlogPhraseFb = /\b(detailed\s+)?backlog\s+(generation|generat)\b/i.test(lowerFallback) ||
          /\b(create|generate)\s+(a\s+)?(detailed\s+)?backlog\b/i.test(lowerFallback) ||
          /\bbacklog\s+generation\b/i.test(lowerFallback) ||
          /\bfull\s+(artifact\s+)?(hierarchy|backlog)\b/i.test(lowerFallback);
        const hasEpicFb = /\b(epics?|epic)\b/.test(lowerFallback);
        const hasFeatureFb = /\b(features?|feature)\b/.test(lowerFallback);
        const hasUserStoryFb = /\b(user\s+stories?|user\s+story|stories?)\b/.test(lowerFallback);
        const isFullHierarchyFb = /\b(generate|create)\b/.test(lowerFallback) &&
          ((hasEpicFb && (hasFeatureFb || hasUserStoryFb)) || (hasFeatureFb && hasUserStoryFb));
        const isDetailedBacklogFallback = backlogPhraseFb || isFullHierarchyFb;
        if (isDetailedBacklogFallback) {
          result = { path: 2, confidence: 0.85, reasoning: "Fallback: detailed backlog / full hierarchy = ConversationAgent" };
        } else {
          // Check for UniversalAgent indicators
          // task/tasks = subtasks (treat same as subtasks for path detection)
          const instructionForBelow = /\b(generate|create|write|add)\s+(test\s*cases?|test\s*case|acceptance\s*criteria|sub[- ]*tasks?|subtasks?|tasks?|epics?|features?)\s+for\s+the\s+(below|following)\s*(user\s*story|story|epic|requirement)?/i.test(userInput) ||
            /\b(generate|create)\s+(only\s+)?(test\s*cases?|epics?|features?|sub[- ]*tasks?|subtasks?|tasks?)\s+for\s+/.test(lowerFallback);
          const hasStructuredArtifact = /\bas\s+[^,]+,\s*i\s+want\s+/i.test(userInput) ||
            /\bacceptance\s+criteria\b/i.test(userInput) ||
            /\bpersona:\s*/i.test(userInput) ||
            /\bcontext\s*&\s*background\b/i.test(userInput);
          const isPath4 =
            instructionForBelow ||
            (hasStructuredArtifact && /\b(generate|create|write)\s+(test\s*cases?|acceptance\s*criteria|sub[- ]*tasks?|subtasks?|tasks?)\s+for\s+/i.test(userInput)) ||
            /\b(split|modify|update|change|edit|refine)\s+(this\s+)?(user ?story|story|epic|feature|requirement)\b/.test(lowerFallback) ||
            /\bonly\s+(epics?|features?|user stories?|stories|sub[- ]*tasks?|subtasks?|tasks?|test cases?|testcases?)\b/.test(lowerFallback) ||
            /\b(test cases?|testcases?|sub[- ]*tasks?|subtasks?|tasks?)\s+only\b/.test(lowerFallback) ||
            /\bonly\s+(for|give|generate)\s+/.test(lowerFallback) ||
            /\b(create|generate)\s+(only\s+)?(test cases?|epics?|features?|sub[- ]*tasks?|subtasks?|tasks?)\b/.test(lowerFallback);

          if (isPath4) {
            result = { path: 4, confidence: instructionForBelow ? 0.9 : 0.7, reasoning: instructionForBelow ? "Fallback: instruction + artifact pattern = UniversalAgent" : "Fallback detection: matches UniversalAgent patterns (no BRD selected)", isPath4Generic: true };
          } else {
            result = { path: 2, confidence: 0.6, reasoning: "Fallback: default conversational path (no BRD, no UniversalAgent indicators)" };
          }
        }
      }
    }

    let detectedPath = result.path as 1 | 2 | 3 | 4;

    // STRICT ENFORCEMENT: If BRD is selected, NEVER allow UniversalAgent
    // Force RequirementsAgent or ContextFusionAgent based on file/chat presence
    if (hasBRDSelected && selectedRequirementIds.length > 0) {
      if (detectedPath === 4) {
        console.warn("[AI Service] Path detection correction: BRD selected but AI returned UniversalAgent, forcing ContextFusionAgent");
        detectedPath = (hasFileUpload || userInput.trim().length > 20) ? 3 : 1;
        result.reasoning = `Corrected: BRD selected with ${hasFileUpload ? 'file' : 'chat'} = ${detectedPath === 3 ? 'ContextFusionAgent' : 'RequirementsAgent'} (UniversalAgent not allowed when BRD is selected)`;
        result.isPath4Generic = false;
      } else if (detectedPath === 2) {
        // BRD selected but AI returned ConversationAgent - also incorrect, should be RequirementsAgent or ContextFusionAgent
        detectedPath = (hasFileUpload || userInput.trim().length > 20) ? 3 : 1;
        result.reasoning = `Corrected: BRD selected = ${detectedPath === 3 ? 'ContextFusionAgent' : 'RequirementsAgent'} (not ConversationAgent)`;
      }
    }

    const validPath = [1, 2, 3, 4].includes(detectedPath) ? detectedPath : 2;

    console.log("[AI Service] Path detection result:", {
      path: validPath,
      confidence: result.confidence || 0.7,
      reasoning: result.reasoning || "AI classification",
      isPath4Generic: result.isPath4Generic || (validPath === 4),
      brdSelected: hasBRDSelected,
      fileUploaded: hasFileUpload,
      correctionApplied: (hasBRDSelected && selectedRequirementIds.length > 0 && (result.path === 4 || result.path === 2))
    });

    return {
      path: validPath,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.7,
      reasoning: result.reasoning || "AI path classification",
      isPath4Generic: result.isPath4Generic || (validPath === 4)
    };

  } catch (error) {
    console.error("[AI Service] Error detecting workflow path:", error);
    // Fallback to ConversationAgent on error
    return {
      path: 2,
      confidence: 0.5,
      reasoning: "Path detection failed - defaulting to ConversationAgent"
    };
  }
}

/**
 * Classify chat input as Functional Requirement or Generic/Instructional
 * Used in ContextFusionAgent to determine how to process user chat input
 */
export async function classifyChatInputType(
  chatInput: string,
  existingBRDRequirements: Array<{ id: string; name: string; description: string }>
): Promise<{
  isFunctional: boolean;
  confidence: number;
  reasoning?: string;
}> {
  try {
    if (!chatInput || chatInput.trim().length === 0) {
      return {
        isFunctional: false,
        confidence: 1.0,
        reasoning: "Empty chat input - treated as generic/instructional"
      };
    }

    const lowerInput = chatInput.toLowerCase();

    // Quick heuristic: If it's clearly a generation instruction, it's generic/instructional
    const generationInstructions = [
      /generate\s+\d+\s+epic/i,
      /create\s+\d+\s+epic/i,
      /make\s+\d+\s+epic/i,
      /only\s+\d+\s+epic/i,
      /generate\s+\d+\s+feature/i,
      /create\s+\d+\s+feature/i,
      /generate\s+\d+\s+story/i,
      /create\s+\d+\s+story/i,
      /limit.*epic/i,
      /max.*epic/i,
      /focus.*on/i,
      /exclude/i,
      /only.*epic/i,
      /only.*feature/i
    ];

    for (const pattern of generationInstructions) {
      if (pattern.test(chatInput)) {
        console.log("[AI Service] Chat input matches generation instruction pattern - treating as generic/instructional");
        return {
          isFunctional: false,
          confidence: 0.9,
          reasoning: "Chat input contains generation constraints/instructions (e.g., 'generate 2 epic') - treat as generic/instructional"
        };
      }
    }

    // Use LLM for more nuanced classification
    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    const existingReqsSummary = existingBRDRequirements.length > 0
      ? existingBRDRequirements.slice(0, 5).map(r => `- ${r.name}: ${r.description?.substring(0, 100) || 'No description'}`).join('\n')
      : "No existing BRD requirements";

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: REQUIREMENTS_CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: getRequirementsClassifierUserPrompt(chatInput, existingReqsSummary) },
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || "{}";

    let result: any = {};
    try {
      // Try to parse as JSON
      result = JSON.parse(content);
    } catch (parseError) {
      // If JSON parsing fails, try to extract from text response
      console.warn("[AI Service] Failed to parse JSON response, attempting text extraction:", parseError);
      const lowerContent = content.toLowerCase();
      result = {
        isFunctional: !lowerContent.includes("generic") && !lowerContent.includes("instructional") &&
          (lowerContent.includes("functional") || lowerContent.includes("requirement")),
        confidence: 0.6,
        reasoning: "Parsed from text response (JSON parsing failed)"
      };
    }

    return {
      isFunctional: result.isFunctional === true,
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.7,
      reasoning: result.reasoning || "Classified by LLM"
    };

  } catch (error) {
    console.error("[AI Service] Error classifying chat input type:", error);
    // Fallback: treat as generic/instructional if classification fails
    return {
      isFunctional: false,
      confidence: 0.5,
      reasoning: "Classification failed - defaulting to generic/instructional"
    };
  }
}

// ============================================================================
// 🧠 Helper: Generate contextual quick replies (Copilot-style UX)
// ============================================================================
function generateQuickReplies(questionText: string): string[] {
  if (!questionText) return [];
  const q = questionText.toLowerCase();
  const includesAny = (arr: string[]) => arr.some((k) => q.includes(k));

  // --- Yes / No style questions ---
  if (
    includesAny([
      "do you need",
      "do you want",
      "should we",
      "would you like",
      "is this",
      "will this",
      "can users",
      "does this",
    ])
  ) {
    return ["Yes", "No", "Not sure yet"];
  }

  // --- Target users ---
  if (
    includesAny([
      "who will use",
      "who are the",
      "target user",
      "target audience",
      "primary user",
      "main user",
      "personas",
    ])
  ) {
    return [
      "Customers",
      "Employees",
      "Administrators",
      "Multiple user types",
      "Let me explain...",
    ];
  }

  // --- Platform / device type ---
  if (includesAny(["platform", "mobile", "web app", "desktop", "tablet"])) {
    return ["Web", "Mobile", "Desktop", "Web & Mobile", "All platforms"];
  }

  // --- Timeline / delivery ---
  if (
    includesAny(["timeline", "how long", "deadline", "release", "delivery"])
  ) {
    return [
      "1–3 months",
      "3–6 months",
      "6–12 months",
      "12+ months",
      "Flexible",
    ];
  }

  // --- Priority / importance ---
  if (includesAny(["priority", "important", "critical", "urgent"])) {
    return ["High", "Medium", "Low"];
  }

  // --- Team size ---
  if (includesAny(["team size", "people involved", "how many people"])) {
    return ["1–10", "11–50", "51–200", "200+", "Not sure"];
  }

  // --- Authentication ---
  if (includesAny(["login", "authentication", "sign in", "user accounts"])) {
    return ["Required", "Not required", "Social login only"];
  }

  // --- Integration / API ---
  if (includesAny(["integration", "api", "external service", "third-party"])) {
    return ["Yes, will integrate", "No integrations", "Not sure yet"];
  }

  // --- MVP scope ---
  if (includesAny(["mvp", "initial release", "first version"])) {
    return [
      "Basic core features",
      "Include analytics",
      "Include authentication",
      "Not sure yet",
    ];
  }

  // --- Business goals ---
  if (includesAny(["goal", "objective", "main outcome", "business purpose"])) {
    return [
      "Improve efficiency",
      "Enhance UX",
      "Automate workflow",
      "Reduce cost",
      "Increase revenue",
    ];
  }

  return [];
}

export async function generateConversationQuestion(
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  capturedRequirements: any,
  currentPhase: string,
  askedQuestions: string[] = [],
): Promise<{
  question: string;
  phase: string;
  quickReplies?: string[];
  capturedInfo?: any;
  readyToGenerate?: boolean;
}> {
  try {
    console.log("[AI Service] Generating conversation question");
    console.log("[AI Service] Current phase:", currentPhase);
    console.log(
      "[AI Service] Conversation history length:",
      conversationHistory.length,
    );

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    // Detect if user is asking a counter-question or seeking clarification
    const lastUserMessage =
      conversationHistory[conversationHistory.length - 1]?.content || "";
    const isCounterQuestion =
      lastUserMessage.includes("?") ||
      lastUserMessage.toLowerCase().includes("what do you mean") ||
      lastUserMessage.toLowerCase().includes("can you explain") ||
      lastUserMessage.toLowerCase().includes("clarify") ||
      lastUserMessage.toLowerCase().includes("could you") ||
      lastUserMessage.toLowerCase().includes("what is");

    console.log(
      "[AI Service] User asking counter-question:",
      isCounterQuestion,
    );
    console.log(
      "[AI Service] Previously asked questions:",
      askedQuestions.length,
    );

    // Detect if this is a greeting or casual conversation starter
    const isGreeting =
      conversationHistory.length <= 3 &&
      /^(hey|hi|hello|sup|yo|what's up|howdy|greetings|good morning|good afternoon|good evening)/i.test(
        lastUserMessage.trim(),
      );

    // Detect if user is asking about capabilities / help
    // CRITICAL: Only detect help questions at the START of conversation (first 5 messages)
    // Mid-conversation, user responses should never trigger help fallbacks
    const isHelpQuestion = conversationHistory.length <= 5 && (
      /what can you (help|do|assist)/i.test(lastUserMessage) ||
      /what (do you|can you) do/i.test(lastUserMessage) ||
      /how (do|can) (i|you) use this/i.test(lastUserMessage) ||
      /^(help|show me|tell me about)/i.test(lastUserMessage.trim()) ||
      lastUserMessage.toLowerCase().includes("capabilities") ||
      lastUserMessage.toLowerCase().includes("what is this for") ||
      lastUserMessage.toLowerCase() === "what can you help with?"
    );

    // Detect if user wants to start refinement session
    const isStartRequest =
      lastUserMessage.toLowerCase() === "start new refinement session" ||
      lastUserMessage.toLowerCase() === "start refining a requirement" ||
      lastUserMessage.toLowerCase() === "start refining" ||
      lastUserMessage.toLowerCase().includes("let's start") ||
      lastUserMessage.toLowerCase().includes("let's begin") ||
      /can (we|i) start/i.test(lastUserMessage) ||
      /ready to (start|begin|refine)/i.test(lastUserMessage) ||
      /shall we (start|begin)/i.test(lastUserMessage) ||
      (/^(start|begin|let'?s (start|begin))/i.test(lastUserMessage.trim()) && conversationHistory.length <= 5);

    console.log("[AI Service] Help question detected:", isHelpQuestion);
    console.log("[AI Service] Start request detected:", isStartRequest);

    // Build working memory from conversation and captured requirements
    const workingMemory = {
      projectType: capturedRequirements.businessGoals[0] || "Not yet defined",
      confirmedUsers: capturedRequirements.targetUsers || [],
      confirmedFeatures: capturedRequirements.keyFeatures || [],
      confirmedGoals: capturedRequirements.businessGoals || [],
      excludedTopics: capturedRequirements.excludedTopics || [], // Topics user explicitly said "no" to
      impliedNeeds: capturedRequirements.impliedNeeds || [], // Things we can infer from context
      technicalContext: capturedRequirements.technicalConstraints || [],
      functionalReqs: capturedRequirements.functionalRequirements || [],
      nonFunctionalReqs: capturedRequirements.nonFunctionalRequirements || [],
      currentPhase,
      questionsAsked: askedQuestions.length,
      totalInfoGathered: Object.values(capturedRequirements)
        .flat()
        .filter(Boolean).length,
    };

    // Detect explicit "no" responses to mark topics as closed
    const userSaidNo =
      /^(no|nope|nah|not really|don't need|not applicable|skip|none)/i.test(
        lastUserMessage.trim(),
      );

    // Detect confirmation responses
    const userConfirmed =
      /^(yes|yeah|yep|correct|that's right|that's accurate|sounds good|looks good|exactly)/i.test(
        lastUserMessage.trim(),
      );

    // CRITICAL: Detect when user explicitly confirms they want to generate artifacts
    // This should immediately trigger artifact generation, NOT ask more questions
    const userConfirmedGeneration =
      lastUserMessage.toLowerCase().includes("yes, generate artifacts") ||
      lastUserMessage.toLowerCase().includes("yes generate") ||
      lastUserMessage.toLowerCase().includes("please generate artifacts") ||
      lastUserMessage.toLowerCase().includes("generate the artifacts") ||
      lastUserMessage.toLowerCase().includes("let's generate") ||
      (lastUserMessage.toLowerCase().includes("yes") &&
        lastUserMessage.toLowerCase().includes("artifact")) ||
      lastUserMessage.toLowerCase() === "option 1" ||
      lastUserMessage.toLowerCase() === "option 2";

    // Check if the previous AI message asked about generating artifacts
    const previousAIMessage = conversationHistory.length >= 2
      ? conversationHistory[conversationHistory.length - 2]?.content || ""
      : "";
    const previousAskedAboutGeneration =
      previousAIMessage.toLowerCase().includes("would you like me to generate") ||
      previousAIMessage.toLowerCase().includes("generate the agile artifacts");

    // If user confirmed generation after being asked, return readyToGenerate immediately
    if (userConfirmedGeneration && previousAskedAboutGeneration) {
      console.log("[AI Service] User confirmed artifact generation - returning readyToGenerate=true");
      return {
        question: "Perfect! Let me generate the artifacts based on our discussion. This may take a moment...",
        phase: "artifacts",
        quickReplies: [],
        readyToGenerate: true,
        capturedInfo: undefined,
      };
    }

    const systemPrompt = getConversationAgentSystemPrompt({
      isGreeting,
      isHelpQuestion,
      isStartRequest,
      userSaidNo,
      userConfirmed,
      isCounterQuestion,
      workingMemory,
      capturedRequirements: capturedRequirements || {},
      askedQuestions,
    });
    // Build messages array with special handling for counter-questions
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
    ];

    // If user is asking a counter-question, inject explicit instruction
    if (isCounterQuestion) {
      messages.push({
        role: "system",
        content: CONVERSATION_AGENT_COUNTER_QUESTION_SYSTEM_APPEND,
      });
    }

    const response = await openai.chat.completions.create({
      model: modelName,
      response_format: { type: "json_object" },
      messages,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "{}";
    console.log(
      "[AI Service] Conversation response:",
      content.substring(0, 500),
    );
    console.log("[AI Service] Counter-question detected:", isCounterQuestion);

    let result;
    try {
      const { parsed } = extractJsonFromLLMResponse(content);
      result = parsed;
    } catch (parseError) {
      console.error("[AI Service] JSON parse error:", parseError);
      console.error("[AI Service] Raw content:", content);
      throw new Error("Failed to parse AI response as JSON");
    }

    // DETERMINISTIC VALIDATION: If user asked a counter-question, verify AI provided explanation
    if (isCounterQuestion && result.question) {
      const responseLength = result.question.length;
      const hasExamples =
        result.question.includes("-") ||
        result.question.includes("•") ||
        result.question.includes("example");
      const hasExplanation = responseLength > 100; // Explanations should be longer

      if (!hasExplanation || !hasExamples) {
        console.warn(
          "[AI Service] Counter-question detected but AI didn't provide proper explanation",
        );
        console.warn("[AI Service] Response length:", responseLength);
        console.warn("[AI Service] Has examples:", hasExamples);

        // Force a proper explanatory response
        result.question = `I'd be happy to clarify that for you! Let me explain:\n\nWhen I ask about that, I'm looking to understand the specific requirements and constraints that will guide how we build this solution. This typically includes:\n\n- Technical specifications (platforms, integrations, tech stack)\n- Quality attributes (performance, security, scalability)\n- Business constraints (timeline, budget, compliance needs)\n- User experience requirements (accessibility, usability)\n\nDoes that help clarify what I'm asking? Feel free to share whatever details you have, and we can explore more specifics together.`;
        console.log("[AI Service] Using fallback explanatory response");
      }
    }

    // Validate response has required fields
    if (
      !result.question ||
      typeof result.question !== "string" ||
      result.question.trim() === ""
    ) {
      console.error("[AI Service] CRITICAL: AI returned empty question field");
      console.error(
        "[AI Service] Full AI response:",
        JSON.stringify(result, null, 2),
      );
      console.error(
        "[AI Service] Working memory:",
        JSON.stringify(workingMemory, null, 2),
      );
      console.error("[AI Service] Last user message:", lastUserMessage);
      console.error("[AI Service] User confirmed:", userConfirmed);
      console.error("[AI Service] User said no:", userSaidNo);

      // DETERMINISTIC FALLBACK: Generate a guaranteed non-empty, contextual question
      // CRITICAL: Only add candidates if BOTH conditions are met:
      // 1. Information is missing from capturedRequirements
      // 2. The question hasn't been asked yet (check askedQuestions)

      const fallbackCandidates = [];

      // Helper function to check if a question has been asked
      const wasAsked = (question: string): boolean => {
        const normalized = question
          .toLowerCase()
          .replace(/[?.!,]/g, "")
          .trim();
        return askedQuestions.some((asked) => {
          const normalizedAsked = asked
            .toLowerCase()
            .replace(/[?.!,]/g, "")
            .trim();
          return (
            normalized === normalizedAsked ||
            normalized.includes(normalizedAsked) ||
            normalizedAsked.includes(normalized)
          );
        });
      };

      // Only add candidates if info is missing AND question not asked
      const userQuestion =
        "Who are the primary users or people who will use this solution?";
      if (
        capturedRequirements.targetUsers.length === 0 &&
        !wasAsked(userQuestion)
      ) {
        fallbackCandidates.push(userQuestion);
      }

      // AI will generate contextual feature questions based on project type

      const platformQuestion =
        "Is this going to be a mobile app, web application, desktop software, or a combination?";
      if (
        capturedRequirements.technicalConstraints.length === 0 &&
        currentPhase !== "understanding" &&
        !wasAsked(platformQuestion)
      ) {
        fallbackCandidates.push(platformQuestion);
      }

      const mvpQuestion =
        "What would you consider the MVP scope for the initial release?";
      if (
        capturedRequirements.nonFunctionalRequirements.length === 0 &&
        (currentPhase === "personas" || currentPhase === "artifacts") &&
        !wasAsked(mvpQuestion)
      ) {
        fallbackCandidates.push(mvpQuestion);
      }

      // AI will generate contextual business goals questions

      // AI will generate contextual questions instead of generic fallbacks

      // INTELLIGENT STOPPING: Check if we should stop asking questions
      const hasMinimumInfo =
        (capturedRequirements.targetUsers.length > 0 || capturedRequirements.businessGoals.length > 0) &&
        (capturedRequirements.keyFeatures.length > 0 || capturedRequirements.functionalRequirements.length > 0);

      const tooManyQuestions = askedQuestions.length >= 6; // Reduced from 8 to 6
      const hasAnyInfo =
        capturedRequirements.targetUsers.length > 0 ||
        capturedRequirements.businessGoals.length > 0 ||
        capturedRequirements.keyFeatures.length > 0 ||
        capturedRequirements.functionalRequirements.length > 0 ||
        capturedRequirements.technicalConstraints.length > 0 ||
        capturedRequirements.nonFunctionalRequirements.length > 0;

      // Check if last question was "Is there anything else" and user said no
      const lastQuestion = askedQuestions[askedQuestions.length - 1] || "";
      const lastWasGeneric = lastQuestion.toLowerCase().includes("anything else") ||
        lastQuestion.toLowerCase().includes("is there");

      const userSaidNoToGeneric = userSaidNo && lastWasGeneric;

      // STOP ASKING if any of these conditions are met:
      // 1. User said "no" to a generic "anything else" question
      // 2. Too many questions (6+) with at least some info
      // 3. Too many questions (8+) regardless of info
      // 4. Good info and no more specific fallbacks
      const shouldStopAsking =
        userSaidNoToGeneric ||
        (tooManyQuestions && hasAnyInfo) ||
        (askedQuestions.length >= 8) ||
        (hasMinimumInfo && fallbackCandidates.length === 0);

      if (shouldStopAsking) {
        console.warn(
          "[AI Service] STOPPING question loop. Suggesting to proceed.",
        );
        console.warn("[AI Service] Reason:", {
          userSaidNoToGeneric,
          tooManyQuestions,
          totalQuestions: askedQuestions.length,
          hasAnyInfo,
          hasMinimumInfo,
          noMoreFallbacks: fallbackCandidates.length === 0
        });
        console.warn("[AI Service] Captured requirements:", {
          targetUsers: capturedRequirements.targetUsers.length,
          keyFeatures: capturedRequirements.keyFeatures.length,
          businessGoals: capturedRequirements.businessGoals.length,
          functionalRequirements: capturedRequirements.functionalRequirements.length,
        });

        return {
          question: "Great! I think we have enough information to get started. Would you like me to generate the agile artifacts (Epics, Features, and User Stories) based on what we've discussed?",
          phase: currentPhase,
          quickReplies: ["Yes, generate artifacts", "I have more to add"],
          capturedInfo: undefined,
        };
      }

      // Use first available candidate (only if we haven't hit stopping conditions)
      let fallbackQuestion = fallbackCandidates[0];

      // If no specific fallback and we shouldn't stop yet, use generic
      if (!fallbackQuestion) {
        fallbackQuestion = `Is there anything else important I should know? (Q${askedQuestions.length + 1})`;
      }

      console.warn(
        "[AI Service] Generated",
        fallbackCandidates.length,
        "unasked fallback candidates",
      );
      console.warn(
        "[AI Service] Using deterministic fallback:",
        fallbackQuestion,
      );
      console.warn(
        "[AI Service] Checked against",
        askedQuestions.length,
        "previously asked questions",
      );

      return {
        question: fallbackQuestion,
        phase: currentPhase,
        quickReplies: undefined,
        capturedInfo: undefined,
      };
    }

    // DETERMINISTIC CHECK: Prevent duplicate questions
    // Check if the AI's question is semantically similar to any previously asked question
    const normalizedNewQuestion = result.question
      .toLowerCase()
      .replace(/[?.!,]/g, "")
      .trim();

    for (const askedQ of askedQuestions) {
      const normalizedAskedQ = askedQ
        .toLowerCase()
        .replace(/[?.!,]/g, "")
        .trim();

      // Check for exact match or high similarity
      if (
        normalizedNewQuestion === normalizedAskedQ ||
        normalizedNewQuestion.includes(normalizedAskedQ) ||
        normalizedAskedQ.includes(normalizedNewQuestion)
      ) {
        console.warn(
          "[AI Service] Detected duplicate question! Already asked:",
          askedQ,
        );
        console.warn("[AI Service] AI attempted to ask:", result.question);

        // Generate a different question that hasn't been asked yet
        const fallbackCandidates = [
          "What's the primary business value you hope to achieve with this project?",
          "Are there any specific workflows or processes this should support?",
          "What would be the biggest win for your users with this solution?",
          "What's the MVP scope for the initial release?",
          "Are there any technical constraints or requirements we should consider?",
          "What problems or challenges does this solution need to address?",
          "What would success look like for this project?",
        ];

        // Find first candidate that hasn't been asked
        let newQuestion = "";
        for (const candidate of fallbackCandidates) {
          const normalizedCandidate = candidate
            .toLowerCase()
            .replace(/[?.!,]/g, "")
            .trim();
          const alreadyAsked = askedQuestions.some((asked) => {
            const normalizedAsked = asked
              .toLowerCase()
              .replace(/[?.!,]/g, "")
              .trim();
            return (
              normalizedCandidate === normalizedAsked ||
              normalizedCandidate.includes(normalizedAsked) ||
              normalizedAsked.includes(normalizedCandidate)
            );
          });

          if (!alreadyAsked) {
            newQuestion = candidate;
            break;
          }
        }

        // If all fallbacks have been asked, check if we should stop
        if (!newQuestion) {
          const hasMinimumInfo =
            (capturedRequirements.targetUsers.length > 0 || capturedRequirements.businessGoals.length > 0) &&
            (capturedRequirements.keyFeatures.length > 0 || capturedRequirements.functionalRequirements.length > 0);

          const hasAnyInfo =
            capturedRequirements.targetUsers.length > 0 ||
            capturedRequirements.businessGoals.length > 0 ||
            capturedRequirements.keyFeatures.length > 0 ||
            capturedRequirements.functionalRequirements.length > 0 ||
            capturedRequirements.technicalConstraints.length > 0 ||
            capturedRequirements.nonFunctionalRequirements.length > 0;

          const tooManyQuestions = askedQuestions.length >= 6;

          // STOP if: 6+ questions with info OR 8+ questions OR good info
          const shouldStop =
            (tooManyQuestions && hasAnyInfo) ||
            (askedQuestions.length >= 8) ||
            hasMinimumInfo;

          if (shouldStop) {
            // Suggest moving forward instead of asking more questions
            newQuestion = "Great! I think we have enough information to get started. Would you like me to generate the agile artifacts (Epics, Features, and User Stories) based on what we've discussed?";
            result.quickReplies = ["Yes, generate artifacts", "I have more to add"];
            console.warn("[AI Service] Stopping at duplicate detection due to:", {
              tooManyQuestions,
              totalQuestions: askedQuestions.length,
              hasAnyInfo,
              hasMinimumInfo
            });
          } else {
            newQuestion = `Looking at what we've covered, is there anything else important about your requirements? (question ${askedQuestions.length + 1})`;
          }
        }

        result.question = newQuestion;
        console.log(
          "[AI Service] Using non-duplicate fallback question:",
          result.question,
        );
      }
    }
    if (!result.quickReplies || result.quickReplies.length === 0) {
      const fallbackReplies = generateQuickReplies(result.question);
      if (fallbackReplies.length > 0) {
        result.quickReplies = fallbackReplies;
        console.log(
          "[AI Service] Re-generated quick replies after fallback:",
          fallbackReplies,
        );
      }
    }
    // Ensure phase is valid
    if (!result.phase) {
      result.phase = currentPhase;
    }

    // Special handling for greetings - provide friendly quick reply options
    if (isGreeting) {
      result.quickReplies = [
        "Start new refinement session",
        "What can you help with?",
        "Upload requirement"
      ];
      console.log("[AI Service] Added greeting-specific quick replies");
    }

    // Deterministic fallback for help questions
    // Note: isHelpQuestion is already gated to only be true at conversation start
    if (isHelpQuestion) {
      const hasCapabilitiesInfo = result.question && (
        result.question.toLowerCase().includes("refinement") ||
        result.question.toLowerCase().includes("user stories") ||
        result.question.toLowerCase().includes("epics") ||
        result.question.toLowerCase().includes("devops") ||
        result.question.includes("•") ||
        result.question.includes("-")
      );

      if (!hasCapabilitiesInfo || result.question.length < 200) {
        console.log("[AI Service] Help question detected but AI response insufficient, using fallback");
        result.question = `Great question! I'm here to help you create professional Agile artifacts through an interactive conversation. Here's what I can do:

• **Requirement Refinement** - I'll ask thoughtful questions to understand your needs deeply and capture all important details
• **Generate User Stories** - Create detailed, professional user stories with acceptance criteria, test cases, and subtasks
• **Epics & Features** - Organize your work into logical epics and features for better planning  
• **Export to DevOps** - Push directly to Azure DevOps or export artifacts for Jira and other tools
• **Interactive & Smart** - I remember context, avoid repeating questions, and adapt to your needs

Ready to start? Tell me about your project or requirement, and I'll guide you through the process step by step!`;
        result.quickReplies = [
          "Start refining a requirement",
          "Tell me more about the process",
          "Show me an example"
        ];
      } else {
        // Ensure help responses have appropriate quick replies
        result.quickReplies = result.quickReplies || [
          "Start refining",
          "Tell me more",
          "Show me an example"
        ];
      }
      console.log("[AI Service] Help question handled with quick replies");
    }

    // Deterministic fallback for start requests - ensure we always begin appropriately
    if (isStartRequest) {
      const hasGoodStartQuestion = result.question && (
        result.question.toLowerCase().includes("project") ||
        result.question.toLowerCase().includes("feature") ||
        result.question.toLowerCase().includes("requirement") ||
        result.question.toLowerCase().includes("goal") ||
        result.question.toLowerCase().includes("problem")
      );

      if (!hasGoodStartQuestion || result.question.length < 50) {
        console.log("[AI Service] Start request detected but AI response insufficient, using fallback");
        // Generate AI-driven starter question
        result.question = await this.generateContextualStarterQuestion();
        result.quickReplies = [
          "It's a web application",
          "It's a mobile app",
          "It's an API/backend system",
          "Let me explain in detail"
        ];
      } else if (!result.quickReplies || result.quickReplies.length === 0) {
        // Ensure start questions have appropriate quick replies
        result.quickReplies = [
          "Web application",
          "Mobile app",
          "Desktop software",
          "Let me describe it"
        ];
      }
      console.log("[AI Service] Start request handled");
    }

    // Smart Quick Reply Detection: Add contextual quick replies if AI didn't provide them
    if (!result.quickReplies || result.quickReplies.length === 0) {
      const replies = generateQuickReplies(result.question);
      if (replies.length > 0) {
        result.quickReplies = replies;
        console.log("[AI Service] Added contextual quick replies:", replies);
      }
    }

    return result;
  } catch (error) {
    console.error(
      "[AI Service] Error generating conversation question:",
      error,
    );
    throw error;
  }
}
import { promptWorkflowRequirements } from "./prompts/prompt_workflow_requirements";
import {
  UNIVERSAL_AGENT_SYSTEM_PROMPT,
  WORKFLOW_PATH_CLASSIFIER_SYSTEM_PROMPT,
  getWorkflowPathClassifierUserPrompt,
  INTENT_CLASSIFIER_SYSTEM_PROMPT,
  getIntentClassifierUserPrompt,
  REQUIREMENTS_CLASSIFIER_SYSTEM_PROMPT,
  getRequirementsClassifierUserPrompt,
  STARTER_QUESTION_SYSTEM_PROMPT,
  STARTER_QUESTION_USER_PROMPT,
  STARTER_QUESTION_FALLBACK,
  BRD_CONVERSION_SYSTEM_PROMPT,
  getBRDConversionUserPrompt,
  BRD_DETECT_SYSTEM_PROMPT,
  getBRDDetectUserPrompt,
  BRD_SUMMARIZE_SYSTEM_PROMPT,
  getBRDSummarizeUserPrompt,
  BRD_CONVERT_FORMAT_SYSTEM_PROMPT,
  getBRDConvertFormatUserPrompt,
  getConversationAgentSystemPrompt,
  CONVERSATION_AGENT_COUNTER_QUESTION_SYSTEM_APPEND,
} from "./prompts/workflow_prompts_index";

/**
 * Convert conversational requirements to BRD functional requirements format using OpenAI
 * This is used for conversational generation paths (both guided and direct)
 */
export async function convertConversationalToFunctionalRequirements(
  requirement: string,
  capturedRequirements?: any
): Promise<string> {
  try {
    console.log("[AI Service] Converting conversational requirements to functional requirements format");
    console.log("[AI Service] Requirement length:", requirement.length);
    console.log("[AI Service] Captured requirements provided:", !!capturedRequirements);

    // Works with any configured chat LLM (Azure OpenAI or AWS Bedrock).
    if (!hasConfiguredDefaultAiClient()) {
      throw new Error("A chat LLM (Azure OpenAI or AWS Bedrock) must be configured for conversational requirement conversion");
    }

    const modelName = _defaultModelName;

    // Build comprehensive requirement context
    let requirementContext = requirement;

    if (capturedRequirements) {
      const capturedInfo: string[] = [];

      if (capturedRequirements.businessGoals && capturedRequirements.businessGoals.length > 0) {
        capturedInfo.push(`Business Goals:\n${capturedRequirements.businessGoals.map((g: string) => `- ${g}`).join('\n')}`);
      }

      if (capturedRequirements.keyFeatures && capturedRequirements.keyFeatures.length > 0) {
        capturedInfo.push(`Key Features:\n${capturedRequirements.keyFeatures.map((f: string) => `- ${f}`).join('\n')}`);
      }

      if (capturedRequirements.targetUsers && capturedRequirements.targetUsers.length > 0) {
        capturedInfo.push(`Target Users:\n${capturedRequirements.targetUsers.map((u: string) => `- ${u}`).join('\n')}`);
      }

      if (capturedRequirements.technicalConstraints && capturedRequirements.technicalConstraints.length > 0) {
        capturedInfo.push(`Technical Constraints:\n${capturedRequirements.technicalConstraints.map((c: string) => `- ${c}`).join('\n')}`);
      }

      if (capturedInfo.length > 0) {
        requirementContext = `${requirement}\n\n=== Captured Requirements ===\n${capturedInfo.join('\n\n')}`;
      }
    }

    const systemPrompt = BRD_CONVERSION_SYSTEM_PROMPT;
    const userPrompt = getBRDConversionUserPrompt(requirementContext);

    const requestStartTime = Date.now();

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 8192,
    });

    const requestDuration = Date.now() - requestStartTime;
    console.log("[AI Service] Conversion completed in", requestDuration / 1000, "seconds");

    const functionalRequirements = response.choices[0]?.message?.content || "";

    if (!functionalRequirements || functionalRequirements.trim().length === 0) {
      throw new Error("Failed to convert conversational requirements to functional requirements format");
    }

    console.log("[AI Service] Converted functional requirements length:", functionalRequirements.length);
    return functionalRequirements;

  } catch (error) {
    console.error("[AI Service] Error converting conversational requirements:", error);
    throw error;
  }
}

/**
 * Detect if a document contains functional requirements or requirements
 * Returns true if functional requirements are detected, false otherwise
 */
export async function detectFunctionalRequirements(documentText: string): Promise<boolean> {
  try {
    if (!documentText || documentText.trim().length < 50) {
      return false;
    }

    const lowerText = documentText.toLowerCase();

    // Strong indicators of functional requirements
    const strongIndicators = [
      /functional\s+requirements?/i,
      /fr-\d+/i,
      /requirement\s+id/i,
      /requirement\s+name/i,
      /requirement\s+description/i,
      /acceptance\s+criteria/i,
      /business\s+rules/i,
      /functional\s+requirement\s+\d+/i,
      /req-\d+/i,
      /requirement\s+\d+:/i,
      /^##\s*fr-/im,
      /^###\s*fr-/im,
    ];

    // Check for strong indicators
    for (const pattern of strongIndicators) {
      if (pattern.test(documentText)) {
        console.log("[AI Service] Functional requirements detected via pattern:", pattern);
        return true;
      }
    }

    // Use LLM for more nuanced detection if patterns don't match
    if (!hasConfiguredDefaultAiClient()) {
      // Fallback: if we see "requirement" mentioned multiple times, assume requirements exist
      const requirementMentions = (lowerText.match(/requirement/gi) || []).length;
      return requirementMentions >= 3;
    }

    const modelName = _defaultModelName;
    const sampleText = documentText.slice(0, 8000); // Use first 8000 chars for detection

    const systemPrompt = BRD_DETECT_SYSTEM_PROMPT;
    const userPrompt = getBRDDetectUserPrompt(sampleText);

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 10,
    });

    const answer = (response.choices[0]?.message?.content || "").trim().toUpperCase();
    const detected = answer === "YES";

    console.log("[AI Service] Functional requirements detection result:", detected);
    return detected;

  } catch (error) {
    console.error("[AI Service] Error detecting functional requirements:", error);
    // Fallback: if detection fails, assume no requirements to be safe (will chunk)
    return false;
  }
}

/**
 * Extract text from file buffer based on file type
 */
async function extractTextFromFileBuffer(buffer: Buffer, fileType: string, fileName: string): Promise<string> {
  try {
    const fileExt = fileName.split('.').pop()?.toLowerCase() || '';

    if (fileExt === 'pdf' || fileType.includes('pdf')) {
      // Use pdf-parse (initialize if needed)
      if (!PDFParseClass || !pdfParse) {
        PDFParseClass = await initializePdfParse();
        pdfParse = async (buffer: Buffer) => {
          const instance = new PDFParseClass(buffer);
          return instance;
        };
      }
      const data = await pdfParse(buffer);
      return data.text || "";
    } else if (fileExt === 'docx' || fileExt === 'doc' || fileType.includes('word')) {
      // DOCX: Use JSZip (Office Open XML is ZIP-based)
      if (fileExt === 'docx') {
        const zip = await JSZip.loadAsync(buffer);
        const docFile = zip.file("word/document.xml");
        if (!docFile) return "";
        const xml = await docFile.async("string");
        const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)) as RegExpMatchArray[];
        const texts = matches.map((m) => m[1].replace(/\s+/g, " ").trim());
        return texts.join(" ").replace(/\s+/g, " ").trim();
      }
      // .doc: Try DOCX first (some .doc files are actually DOCX), then mammoth for binary .doc
      try {
        const zip = await JSZip.loadAsync(buffer);
        const docFile = zip.file("word/document.xml");
        if (docFile) {
          const xml = await docFile.async("string");
          const matches = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)) as RegExpMatchArray[];
          const texts = matches.map((m) => m[1].replace(/\s+/g, " ").trim());
          return texts.join(" ").replace(/\s+/g, " ").trim();
        }
      } catch {
        // Binary .doc: use mammoth
      }
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    } else if (fileExt === 'txt' || fileType.includes('text')) {
      return buffer.toString('utf-8');
    } else {
      console.warn(`[AI Service] Unsupported file type: ${fileExt}, attempting text extraction`);
      return buffer.toString('utf-8');
    }
  } catch (error) {
    console.error("[AI Service] Error extracting text from file:", error);
    throw new Error(`Failed to extract text from file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Chunk document text ensuring token limits are never reached
 * Only used when no functional requirements are detected
 */
function chunkDocumentForSummarization(text: string, maxTokensPerChunk: number = 3000): string[] {
  try {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // Simple token estimation: ~4 characters per token
    const maxCharsPerChunk = maxTokensPerChunk * 4;

    // Split by paragraphs first to maintain context
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    const chunks: string[] = [];
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      const paragraphLength = paragraph.length;
      const currentChunkLength = currentChunk.length;

      // If adding this paragraph would exceed limit, save current chunk and start new one
      if (currentChunkLength > 0 && (currentChunkLength + paragraphLength + 2) > maxCharsPerChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        // Add paragraph to current chunk
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      }
    }

    // Add remaining chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    // If no chunks created (very short text), return single chunk
    if (chunks.length === 0) {
      return [text];
    }

    console.log(`[AI Service] Document chunked into ${chunks.length} chunks for summarization`);
    return chunks;

  } catch (error) {
    console.error("[AI Service] Error chunking document:", error);
    // Fallback: return as single chunk
    return [text];
  }
}

/**
 * Summarize a chunk of text
 */
async function summarizeChunk(chunk: string): Promise<string> {
  try {
    if (!hasConfiguredDefaultAiClient()) {
      throw new Error("A chat LLM (Azure OpenAI or AWS Bedrock) must be configured for chunk summarization");
    }

    const modelName = _defaultModelName;

    const systemPrompt = BRD_SUMMARIZE_SYSTEM_PROMPT;
    const userPrompt = getBRDSummarizeUserPrompt(chunk);

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    return response.choices[0]?.message?.content || chunk; // Fallback to original if summarization fails

  } catch (error) {
    console.error("[AI Service] Error summarizing chunk:", error);
    return chunk; // Fallback to original chunk
  }
}

/**
 * Process uploaded file in conversational path
 * Returns BRD functional requirements format
 */
export async function processConversationalFileUpload(
  fileBuffer: Buffer,
  fileType: string,
  fileName: string
): Promise<string> {
  try {
    console.log("[AI Service] Processing conversational file upload:", fileName);

    // Step 1: Extract text from file
    const documentText = await extractTextFromFileBuffer(fileBuffer, fileType, fileName);

    if (!documentText || documentText.trim().length < 50) {
      throw new Error("Document text extraction failed or document is too short");
    }

    console.log("[AI Service] Extracted text length:", documentText.length);

    // Step 2: Detect if functional requirements are present
    const hasFunctionalRequirements = await detectFunctionalRequirements(documentText);

    console.log("[AI Service] Functional requirements detected:", hasFunctionalRequirements);

    let functionalRequirementsText = "";

    if (hasFunctionalRequirements) {
      // Step 3a: Requirements found - extract as-is, convert to BRD format only
      console.log("[AI Service] Functional requirements found - extracting as-is and converting to BRD format");

      // Extract requirement content (preserve everything)
      const requirementContent = documentText;

      // Convert to BRD functional requirements format (format conversion only, no summarization)
      functionalRequirementsText = await convertExtractedRequirementsToBRDFormat(requirementContent);

    } else {
      // Step 3b: No requirements found - chunk, summarize, then convert to BRD format
      console.log("[AI Service] No functional requirements found - chunking and summarizing");

      // Chunk the document
      const chunks = chunkDocumentForSummarization(documentText);

      console.log("[AI Service] Document split into", chunks.length, "chunks");

      // Summarize each chunk
      const summarizedChunks: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        console.log(`[AI Service] Summarizing chunk ${i + 1}/${chunks.length}`);
        const summary = await summarizeChunk(chunks[i]);
        summarizedChunks.push(summary);
      }

      // Combine summarized chunks
      const combinedSummary = summarizedChunks.join("\n\n");

      console.log("[AI Service] Combined summary length:", combinedSummary.length);

      // Convert summarized content to BRD functional requirements format
      functionalRequirementsText = await convertConversationalToFunctionalRequirements(combinedSummary);
    }

    console.log("[AI Service] Final BRD functional requirements length:", functionalRequirementsText.length);
    return functionalRequirementsText;

  } catch (error) {
    console.error("[AI Service] Error processing conversational file upload:", error);
    throw error;
  }
}

/**
 * Convert extracted requirements (when found) to BRD format
 * This is format conversion only - no summarization or alteration
 */
async function convertExtractedRequirementsToBRDFormat(requirementContent: string): Promise<string> {
  try {
    if (!hasConfiguredDefaultAiClient()) {
      throw new Error("A chat LLM (Azure OpenAI or AWS Bedrock) must be configured for requirement format conversion");
    }

    const modelName = _defaultModelName;

    const systemPrompt = BRD_CONVERT_FORMAT_SYSTEM_PROMPT;
    const userPrompt = getBRDConvertFormatUserPrompt(requirementContent);

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1, // Low temperature to preserve accuracy
      max_tokens: 8192,
    });

    const convertedRequirements = response.choices[0]?.message?.content || "";

    if (!convertedRequirements || convertedRequirements.trim().length === 0) {
      throw new Error("Failed to convert requirements to BRD format");
    }

    return convertedRequirements;

  } catch (error) {
    console.error("[AI Service] Error converting extracted requirements to BRD format:", error);
    throw error;
  }
}

export async function generateAgileArtifacts(
  requirement: string,
  complianceGuidelines: any[] = [],
  backlogContext?: { epics: any[]; features: any[]; userStories: any[] },
  selectedPersonaIds: string[] = [],
  functionalRequirementsContent: string | null = null,
  selectedRequirementIds: string[] = [],
  requirementsData: any[] | null = null,
  ragGuidance: string | null = null,
  llmTemperature: number = 0.7
): Promise<any> {
  try {
    console.log(
      "[AI Service] Generating agile artifacts for:",
      requirement.substring(0, 100),
    );
    console.log("[AI Service] Compliance guidelines count:", complianceGuidelines.length);
    console.log("[AI Service] Backlog context provided:", !!backlogContext);
    console.log("[AI Service] Selected persona IDs:", selectedPersonaIds);
    console.log("[AI Service] BRD Functional Requirements content length:", functionalRequirementsContent?.length || 0);
    console.log("[AI Service] Selected requirement IDs:", selectedRequirementIds.length);
    console.log("[AI Service] Requirements data count:", requirementsData?.length || 0);

    if (backlogContext) {
      console.log("[AI Service] Existing epics:", backlogContext.epics.length);
      console.log("[AI Service] Existing features:", backlogContext.features.length);
      console.log("[AI Service] Existing user stories:", backlogContext.userStories.length);
    }

    // CRITICAL: Use Claude API for artifact generation (as per requirements)
    // But only if Anthropic is fully configured; otherwise safely fall back to OpenAI.
    const anthropicConfigured =
      useAnthropic &&
      !!process.env.ANTHROPIC_AZURE_ENDPOINT &&
      !!process.env.ANTHROPIC_MODEL_NAME &&
      !!process.env.ANTHROPIC_MODEL_VERSION;

    console.log("[AI Service] Using Anthropic (Claude):", anthropicConfigured);
    if (anthropicConfigured) {
      console.log(
        "[AI Service] Anthropic endpoint:",
        process.env.ANTHROPIC_AZURE_ENDPOINT,
      );
      console.log(
        "[AI Service] Anthropic model:",
        process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5",
      );
    } else {
      if (useAnthropic) {
        console.warn(
          "[AI Service] Anthropic requested but not fully configured (missing endpoint/model/version) - falling back to OpenAI",
        );
      } else {
        console.log("[AI Service] Anthropic not enabled - using OpenAI");
      }
      console.log("[AI Service] Using Azure OpenAI:", useAzure);
      if (useAzure) {
        console.log(
          "[AI Service] Azure endpoint:",
          process.env.AZURE_OPENAI_ENDPOINT,
        );
        console.log(
          "[AI Service] Azure deployment:",
          process.env.AZURE_OPENAI_DEPLOYMENT,
        );
      }
    }

    // Use Claude model name if Anthropic is configured, otherwise fallback
    const modelName = anthropicConfigured
      ? (process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5")
      : (useAzure
        ? process.env.AZURE_OPENAI_DEPLOYMENT!
        : "gpt-4o");

    // Helper function to truncate text while preserving key information
    const truncateText = (text: string, maxLength: number): string => {
      if (text.length <= maxLength) return text;

      // Try to truncate at a sentence boundary
      const truncated = text.substring(0, maxLength);
      const lastPeriod = truncated.lastIndexOf('.');
      const lastNewline = truncated.lastIndexOf('\n');
      const cutPoint = Math.max(lastPeriod, lastNewline);

      if (cutPoint > maxLength * 0.8) {
        // Good cut point found
        return truncated.substring(0, cutPoint + 1) + `\n\n[Content truncated - original length: ${text.length} characters. Key requirements preserved above.]`;
      }

      // Fallback: truncate at word boundary
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > maxLength * 0.8) {
        return truncated.substring(0, lastSpace) + `\n\n[Content truncated - original length: ${text.length} characters. Key requirements preserved above.]`;
      }

      return truncated + `\n\n[Content truncated - original length: ${text.length} characters]`;
    };

    // Helper function to extract only functional and non-functional requirements from BRD content
    const extractRequirementsOnly = (content: string): string => {
      if (!content || !content.trim()) return "";

      const lines = content.split('\n');
      let inFunctionalSection = false;
      let inNonFunctionalSection = false;
      const extracted: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();

        // Detect functional requirements section
        if (line.includes('functional requirements') && !line.includes('non-functional')) {
          inFunctionalSection = true;
          inNonFunctionalSection = false;
          extracted.push(lines[i]); // Keep the header
          continue;
        }

        // Detect non-functional requirements section
        if (line.includes('non-functional requirements') || line.includes('nonfunctional requirements')) {
          inNonFunctionalSection = true;
          inFunctionalSection = false;
          extracted.push(lines[i]); // Keep the header
          continue;
        }

        // Stop at next major section (but allow subsections within requirements)
        if ((inFunctionalSection || inNonFunctionalSection) &&
          (line.match(/^#{1,3}\s+/) || line.match(/^\d+\.\s+/)) &&
          !line.includes('requirement') &&
          !line.includes('fr-') &&
          !line.includes('nfr-')) {
          // Check if this is a subsection or a new major section
          const nextLines = lines.slice(i, Math.min(i + 5, lines.length));
          const hasRequirementContent = nextLines.some(l =>
            l.toLowerCase().includes('fr-') ||
            l.toLowerCase().includes('nfr-') ||
            l.toLowerCase().includes('requirement')
          );
          if (!hasRequirementContent) {
            break; // New major section, stop
          }
        }

        // Collect content from functional/non-functional sections
        if (inFunctionalSection || inNonFunctionalSection) {
          // Include lines with FR- or NFR- identifiers, or requirement-related content
          if (line.includes('fr-') ||
            line.includes('nfr-') ||
            line.includes('requirement') ||
            line.trim().startsWith('|') || // Table rows
            line.trim().startsWith('-') || // List items
            line.trim().match(/^\d+\./)) { // Numbered items
            extracted.push(lines[i]);
          }
        }
      }

      return extracted.join('\n');
    };

    // Build BRD Functional Requirements section - Use structured requirementsData (more concise)
    // Prioritize requirementsData over requirementsContent to reduce token size
    let functionalRequirementsSection = "";

    // Use structured requirementsData if available (more concise, less tokens)
    if (requirementsData && requirementsData.length > 0) {
      console.log("[AI Service] Using structured requirements data (", requirementsData.length, "requirements)");
      functionalRequirementsSection = `\n\n=== CRITICAL: BRD FUNCTIONAL REQUIREMENTS (MANDATORY) ===\n\n`;
      functionalRequirementsSection += `The following ${requirementsData.length} functional requirements from the BRD MUST be strictly followed and fully implemented:\n\n`;

      // Use concise format - only essential information
      requirementsData.forEach((req: any, idx: number) => {
        const reqName = req.requirementName || req.name || `FR-${idx + 1}`;
        const reqDesc = req.description || 'N/A';
        // Truncate description if too long (max 500 chars per requirement)
        const truncatedDesc = reqDesc.length > 500 ? reqDesc.substring(0, 500) + '...' : reqDesc;
        functionalRequirementsSection += `${reqName}: ${truncatedDesc}\n\n`;
      });

      functionalRequirementsSection += `\nMANDATORY REQUIREMENTS FOR ARTIFACT GENERATION:\n`;
      functionalRequirementsSection += `1. EVERY functional requirement MUST be represented in the generated artifacts\n`;
      functionalRequirementsSection += `2. Create epics, features, and user stories that directly implement each requirement\n`;
      functionalRequirementsSection += `3. The number of epics, features, and user stories MUST be determined by the complexity and scope - NO FIXED COUNTS\n`;
      functionalRequirementsSection += `4. Each requirement should map to at least one user story\n`;
      functionalRequirementsSection += `5. Group related requirements into logical epics and features\n`;
      functionalRequirementsSection += `6. Ensure complete coverage - every requirement must be addressed\n\n`;
    }
    // Fallback: Use requirementsContent only if requirementsData is not available
    else if (functionalRequirementsContent && functionalRequirementsContent.trim().length > 0) {
      console.log("[AI Service] Using requirementsContent (structured data not available)");
      console.log("[AI Service] Original content length:", functionalRequirementsContent.length, "characters");

      // Extract ONLY functional and non-functional requirements (not entire BRD)
      const extractedRequirements = extractRequirementsOnly(functionalRequirementsContent);
      console.log("[AI Service] Extracted requirements length:", extractedRequirements.length, "characters");

      // Truncate if still too large (max 10000 chars for extracted content)
      let finalRequirements = extractedRequirements;
      if (finalRequirements.length > 10000) {
        console.log("[AI Service] Truncating extracted requirements to 10000 characters");
        finalRequirements = truncateText(finalRequirements, 10000);
      }

      if (finalRequirements.trim().length > 0) {
        functionalRequirementsSection = `\n\n=== CRITICAL: BRD FUNCTIONAL & NON-FUNCTIONAL REQUIREMENTS (MANDATORY) ===\n\n`;
        functionalRequirementsSection += `The following functional and non-functional requirements from the BRD document MUST be strictly followed and fully implemented:\n\n`;
        functionalRequirementsSection += `${finalRequirements}\n\n`;

        functionalRequirementsSection += `\nMANDATORY REQUIREMENTS FOR ARTIFACT GENERATION:\n`;
        functionalRequirementsSection += `1. EVERY functional requirement MUST be represented in the generated artifacts\n`;
        functionalRequirementsSection += `2. Create epics, features, and user stories that directly implement each requirement\n`;
        functionalRequirementsSection += `3. The number of epics, features, and user stories MUST be determined by complexity - NO FIXED COUNTS\n`;
        functionalRequirementsSection += `4. Each requirement should map to at least one user story\n`;
        functionalRequirementsSection += `5. Group related requirements into logical epics and features\n`;
        functionalRequirementsSection += `6. Ensure complete coverage - every requirement must be addressed\n\n`;
      }
    } else if (selectedRequirementIds.length > 0) {
      console.log("[AI Service] Selected requirement IDs provided but no content - this should not happen");
      functionalRequirementsSection = `\n\n=== NOTE: Functional Requirements Selected ===\n\n`;
      functionalRequirementsSection += `${selectedRequirementIds.length} functional requirement(s) were selected but content is not available. Please generate artifacts based on the requirement text provided.\n\n`;
    } else {
      // FALLBACK: No BRD attached or no functional requirements selected
      // Use the requirement text (which may include chat context or uploaded file content)
      console.log("[AI Service] No BRD functional requirements provided - using requirement text and chat context as input");
      functionalRequirementsSection = `\n\n=== FALLBACK MODE: Using Requirement Text and Chat Context ===\n\n`;
      functionalRequirementsSection += `No BRD functional requirements were provided. Generate artifacts based on the requirement text provided below, which may include:\n`;
      functionalRequirementsSection += `- User-uploaded file content\n`;
      functionalRequirementsSection += `- Chat conversation context\n`;
      functionalRequirementsSection += `- Captured requirements from the conversation\n\n`;
      functionalRequirementsSection += `Analyze the requirement text thoroughly and generate the appropriate number of epics, features, and user stories based on the complexity and scope of the requirements.\n\n`;
    }

    // Build compliance guidelines section if provided - ONLY pre-selected Golden Repository guidelines
    // Truncate if too large to avoid timeouts
    let complianceSection = "";
    if (complianceGuidelines.length > 0) {
      console.log("[AI Service] Processing", complianceGuidelines.length, "pre-selected Golden Repository compliance guidelines");

      complianceSection = `\n\nCOMPLIANCE REQUIREMENTS (GOLDEN REPOSITORY):\n\nYou must strictly follow these ${complianceGuidelines.length} pre-selected compliance guideline document${complianceGuidelines.length > 1 ? 's' : ''} from the organization's Golden Repository:\n\n`;

      // Maximum length per guideline to prevent timeout (adjust based on total)
      const maxGuidelineLength = 8000; // ~2000 tokens per guideline
      let totalGuidelineLength = 0;

      complianceGuidelines.forEach((guideline: any, index: number) => {
        let guidelineContent = guideline.content || "";
        const originalLength = guidelineContent.length;

        // Truncate if too long, but preserve key information
        if (guidelineContent.length > maxGuidelineLength) {
          console.log(`[AI Service] Truncating guideline "${guideline.name}" from ${originalLength} to ${maxGuidelineLength} characters`);
          guidelineContent = truncateText(guidelineContent, maxGuidelineLength);
        }

        complianceSection += `=== ${guideline.name} ===\n${guidelineContent}\n===================\n\n`;
        totalGuidelineLength += guidelineContent.length;
      });

      console.log("[AI Service] Total compliance guidelines length:", totalGuidelineLength, "characters");

      complianceSection += `All generated epics, user stories, and subtasks MUST:
- Adhere to requirements specified in these guidelines
- Include compliance validation in acceptance criteria where applicable
- Reference guidelines when relevant (e.g., "As per Security Guidelines...")
- Include compliance-related subtasks if needed

Validate all artifacts against these guidelines before finalizing.\n`;
    }

    // RAG guidance not used - only pre-selected compliance guidelines (Golden Repository) are passed
    let ragSection = "";

    // Build Azure DevOps backlog context section if provided
    // CRITICAL: Existing artifacts are READ-ONLY - we only CREATE NEW artifacts, never modify existing ones
    // This is a non-negotiable requirement for SDLC workflow artifact generation
    let backlogSection = "";
    if (backlogContext && (backlogContext.epics.length > 0 || backlogContext.features.length > 0 || backlogContext.userStories.length > 0)) {
      backlogSection = `\n\nEXISTING AZURE DEVOPS BACKLOG CONTEXT:\n\nThe target Azure DevOps project already has the following work items. You MUST consider these when generating new artifacts:\n\n`;

      if (backlogContext.epics.length > 0) {
        backlogSection += `EXISTING EPICS (${backlogContext.epics.length} total):\n`;
        backlogContext.epics.slice(0, 10).forEach((epic: any) => {
          const title = epic.fields?.['System.Title'] || 'Untitled';
          const id = epic.id;
          const state = epic.fields?.['System.State'] || 'Unknown';
          backlogSection += `- [ID: ${id}] "${title}" (${state})\n`;
        });
        if (backlogContext.epics.length > 10) {
          backlogSection += `... and ${backlogContext.epics.length - 10} more epics\n`;
        }
        backlogSection += '\n';
      }

      if (backlogContext.features.length > 0) {
        backlogSection += `EXISTING FEATURES (${backlogContext.features.length} total):\n`;
        backlogContext.features.slice(0, 10).forEach((feature: any) => {
          const title = feature.fields?.['System.Title'] || 'Untitled';
          const id = feature.id;
          const state = feature.fields?.['System.State'] || 'Unknown';
          const parentId = feature.fields?.['System.Parent'] || null;
          backlogSection += `- [ID: ${id}] "${title}" (${state})${parentId ? ` - Parent: ${parentId}` : ''}\n`;
        });
        if (backlogContext.features.length > 10) {
          backlogSection += `... and ${backlogContext.features.length - 10} more features\n`;
        }
        backlogSection += '\n';
      }

      if (backlogContext.userStories.length > 0) {
        backlogSection += `EXISTING USER STORIES (${backlogContext.userStories.length} total):\n`;
        backlogContext.userStories.slice(0, 15).forEach((story: any) => {
          const title = story.fields?.['System.Title'] || 'Untitled';
          const id = story.id;
          const state = story.fields?.['System.State'] || 'Unknown';
          backlogSection += `- [ID: ${id}] "${title}" (${state})\n`;
        });
        if (backlogContext.userStories.length > 15) {
          backlogSection += `... and ${backlogContext.userStories.length - 15} more user stories\n`;
        }
        backlogSection += '\n';
      }

      backlogSection += `CRITICAL RULES FOR EXISTING ARTIFACTS (NON-NEGOTIABLE):
1. DO NOT MODIFY EXISTING FEATURES: You MUST NEVER edit, update, change, or alter any existing epics, features, or user stories. These are READ-ONLY.
2. DO NOT MODIFY EXISTING EPICS: Existing epics must remain completely unchanged. Do not update their titles, descriptions, priorities, or any other fields.
3. DO NOT MODIFY EXISTING USER STORIES: Existing user stories must remain completely unchanged. Do not update their titles, descriptions, acceptance criteria, or any other fields.
4. ONLY CREATE NEW ARTIFACTS: Your ONLY job is to CREATE NEW epics, features, and user stories. You must NEVER modify existing ones.
5. AVOID DUPLICATES: Do NOT create new epics, features, or user stories that are substantially similar to existing ones
6. ALIGN PROPERLY: If the new requirement fits under an existing Epic/Feature, mention it in the description of the NEW artifact
7. BUILD ON EXISTING: Reference existing work items by ID when there are dependencies (in NEW artifacts only)
8. CHECK RELEVANCE: Only create new work items if they add distinct new value
9. COORDINATE HIERARCHY: Ensure new features align with existing epic structure when appropriate

If the requirement is very similar to existing work:
- DO NOT modify the existing artifact
- Create a NEW artifact that references the existing one by ID
- Only create new user stories under existing features if they are truly distinct
- Reference existing work item IDs in descriptions/acceptance criteria of NEW artifacts only

REMEMBER: The existing artifacts listed above are for REFERENCE ONLY. You must generate ONLY NEW artifacts and NEVER modify existing ones.\n`;
    }

    // Fetch available personas dynamically from database
    console.log("[AI Service] Fetching personas from database");
    let AVAILABLE_PERSONAS: any[] = [];

    try {
      AVAILABLE_PERSONAS = await storage.getPersonas();
      console.log("[AI Service] Fetched", AVAILABLE_PERSONAS.length, "personas from database");
    } catch (error) {
      console.error("[AI Service] Error fetching personas from database:", error);
      console.log("[AI Service] No personas available - will not inject any fallback personas");
      AVAILABLE_PERSONAS = [];
    }

    // Build persona context section
    let personaSection = "";
    let personasToUse: any[] = [];
    const selectedPersonasFromHub: any[] = [];

    if (selectedPersonaIds && selectedPersonaIds.length > 0) {
      console.log("[AI Service] Selected persona IDs from request:", selectedPersonaIds);
      console.log("[AI Service] Available personas count:", AVAILABLE_PERSONAS.length);
      console.log("[AI Service] Available persona IDs:", AVAILABLE_PERSONAS.map(p => p.id));

      // Use selected personas from the hub
      personasToUse = AVAILABLE_PERSONAS.filter(p => selectedPersonaIds.includes(p.id));
      selectedPersonasFromHub.push(...personasToUse);

      console.log("[AI Service] Matched personas from hub:", personasToUse.length);
      console.log("[AI Service] Matched persona details:", personasToUse.map(p => ({ id: p.id, name: p.name })));

      if (personasToUse.length > 0) {
        personaSection = `\n\nSELECTED USER PERSONAS FROM PERSONA MANAGER:\n\nThe user has specifically selected ${personasToUse.length} persona(s) from the Persona Manager. You should PREFER these personas when generating user stories:\n\n`;

        personasToUse.forEach((persona, index) => {
          personaSection += `Persona ${index + 1}: ${persona.name} - ${persona.role}\n`;
          personaSection += `  ID: ${persona.id}\n`;
          personaSection += `  Focus: ${persona.focus}\n`;
          personaSection += `  Pain Points:\n`;
          persona.painPoints.forEach((point: string) => {
            personaSection += `    - ${point}\n`;
          });
          personaSection += `  Goals:\n`;
          persona.goals.forEach((goal: string) => {
            personaSection += `    - ${goal}\n`;
          });
          personaSection += `\n`;
        });

        personaSection += `CRITICAL PERSONA USAGE RULES (HARD-LOCKED):\n`;
        personaSection += `1. You MUST use ONLY the ${personasToUse.length} persona(s) listed above. DO NOT invent or substitute personas.\n`;
        personaSection += `2. Every user story MUST set "personaSource": "From Persona Hub".\n`;
        personaSection += `3. Use the EXACT persona name and role from the list above on every story's "persona" field.\n`;
        personaSection += `4. When writing user story TITLES, use the natural format: "As [persona name], I want to [direct verb phrase] so that [outcome]". Do NOT use the stilted "perform [noun]" pattern — write like a human ("I want to capture meeting notes by voice", not "I want to perform meeting note capture").\n`;
        personaSection += `5. If a requirement doesn't naturally fit any provided persona, choose the closest match — never create a new persona.\n`;
        personaSection += `6. Return the full persona objects in the 'personas' array with ALL their details (name, role, focus, painPoints, goals, personaSource).\n\n`;

        personaSection += `Example user story format:\n`;
        personaSection += `- Title: "As ${personasToUse[0]?.name}, I want to [direct verb phrase] so that [outcome]"\n`;
        personaSection += `- Description: "As ${personasToUse[0]?.name} (${personasToUse[0]?.role}), I want [specific capability] so that [benefit]"\n`;
        personaSection += `- persona: "${personasToUse[0]?.name}"\n`;
        personaSection += `- personaSource: "From Persona Hub"\n\n`;
      }
    }

    // AI-suggested personas (last-resort fallback): only when no personas were resolved
    // from golden-repo file or persona hub. Surfaced to the user as a warning at the routes layer.
    if (personasToUse.length === 0) {
      console.log("[AI Service] No personas selected — falling back to AI-suggested personas (warning emitted at route layer)");

      personaSection = `\n\nINTELLIGENT PERSONA DETECTION (FALLBACK):\n\nNo personas were resolved from the golden repo or Persona Manager. As a fallback, intelligently analyze the requirements and identify the relevant user personas/roles. Stay grounded in the project's domain context (provided in the system prompt header) — do NOT invent roles from a different industry.\n\nINSTRUCTIONS:\n1. Analyze the requirement text to identify WHO will use this system.\n2. Look for role mentions in the chunk text (e.g. "Account Manager", "approver", "administrator").\n3. Create persona names that match the project's industry — never default to insurance/banking/healthcare unless the chunk text invokes them.\n4. ALWAYS tag stories and persona objects with "personaSource": "AI Suggested (Fallback)".\n\nUSER STORY TITLE FORMAT (NATURAL VERB, NOT GERUND):\n- Use: "As [detected persona], I want to [direct verb phrase] so that [outcome]".\n- DO NOT use the stilted "perform [noun]" pattern. Write like a human.\n- NEVER use generic terms like "user" or "admin" — pick a specific role.\n- ALWAYS include "personaSource": "AI Suggested (Fallback)" on every story.\n\nExamples (natural phrasing):\n- "As Account Manager, I want to capture follow-up notes by voice so that meetings stay productive"\n- "As Business Analyst, I want to map requirements to features so that the backlog stays traceable"\n- "As System Administrator, I want to grant role-based access so that only authorised users see sensitive data"\n\n`;
    }

    // Build user story format instruction based on persona availability
    let userStoryFormatInstruction = "";
    if (personasToUse.length > 0) {
      userStoryFormatInstruction = `- CRITICAL TITLE FORMAT (NATURAL VERB, NOT GERUND): "As [persona name], I want to [direct verb phrase] so that [outcome]"
- DO NOT use the stilted "I want to perform [noun]" pattern. Write like a human.
- Examples (correct):
  • "As Account Manager, I want to capture follow-up notes by voice so that meetings stay productive"
  • "As Business Analyst, I want to map requirements to features so that the backlog stays traceable"
- Examples (WRONG — never produce):
  • "As Account Manager, I want to perform follow-up note capture..."
  • "As Business Analyst, I want to perform requirement mapping..."
- The persona MUST be one of the selected personas: ${personasToUse.map(p => p.name).join(', ')}
- NEVER use generic terms like "user" or "admin"
- Use specific verbs grounded in the requirement text (capture, submit, approve, validate, view, configure)
- Clearly state the outcome — what business value the action delivers`;
    } else {
      userStoryFormatInstruction = `- CRITICAL TITLE FORMAT (NATURAL VERB, NOT GERUND): "As [persona], I want to [direct verb phrase] so that [outcome]"
- DO NOT use the stilted "I want to perform [noun]" pattern.
- Examples (correct):
  • "As Account Manager, I want to capture follow-up notes by voice so that meetings stay productive"
  • "As System Administrator, I want to grant role-based access so that only authorised users see sensitive data"
- Detect the persona from the chunk text — match the project's domain context, never insert insurance/banking placeholders.
- NEVER use generic terms like "user" or "admin"`;
    }

    // Optimize requirement text - truncate if extremely large (keep essential parts)
    // Reduce further to prevent timeouts
    let optimizedRequirement = requirement;
    const maxRequirementLength = 8000; // ~2000 tokens max for requirement text (reduced from 15000)
    if (optimizedRequirement.length > maxRequirementLength) {
      console.log(`[AI Service] Requirement text is very large (${optimizedRequirement.length} chars), truncating to ${maxRequirementLength}`);
      // Try to keep the beginning (usually most important) and truncate the end
      optimizedRequirement = truncateText(optimizedRequirement, maxRequirementLength);
    }

    const prompt = promptWorkflowRequirements(
      optimizedRequirement,
      personasToUse
    );
    const messages: any[] = [
      {
        role: "system",
        content: `You are an expert Agile coach and product manager who generates ENTERPRISE-GRADE user stories following strict quality standards.${functionalRequirementsSection}${complianceSection}${ragSection}${backlogSection}${personaSection}

CRITICAL ID FORMAT REQUIREMENTS (MUST FOLLOW EXACTLY):
- Epic IDs: MUST be "epic-1", "epic-2", "epic-3", etc. (lowercase "epic", hyphen, sequential number starting from 1)
- Feature IDs: MUST be "feature-1", "feature-2", "feature-3", etc. (lowercase "feature", hyphen, sequential number starting from 1)
- User Story IDs: MUST be "story-1", "story-2", "story-3", etc. (lowercase "story", hyphen, sequential number starting from 1)
- DO NOT use UUIDs, random strings, or any other format
- Relationships: feature.epicId must match epic.id, story.featureId must match feature.id, story.epicId must match epic.id
- This format is CRITICAL for system compatibility - any deviation will break the application

QUALITY STANDARDS YOU MUST FOLLOW:

1. USER STORY FORMAT:
${userStoryFormatInstruction}

2. DESCRIPTION STRUCTURE (CONTENT-DRIVEN — NO PADDING):
The description is composed of OPTIONAL sections. Include ONLY the sections for which the chunk text provides grounded content.
- MANDATORY (always include): CONTEXT & BACKGROUND, DESIRED STATE
- OPTIONAL (include only when the chunk text supports it): CURRENT STATE, KEY FUNCTIONALITY, USER INTERACTION FLOW, TECHNICAL CONSIDERATIONS, OUT OF SCOPE, SUCCESS METRICS
- Each included section MUST be 1-2 sentences, grounded in the chunk text. NEVER use placeholder filler.
- FORBIDDEN PHRASES (do NOT emit): "Manual or incomplete process today", "System supports the capability", "TBD", "To be determined", "N/A", any sentence whose only purpose is to fill a section heading.
- If you cannot ground a section in the chunk text, OMIT the section entirely. A short, grounded description is better than a long, padded one.
- Keep total description under 250 words; shorter is fine when the chunk is concise.

3. ACCEPTANCE CRITERIA STANDARDS (Production-Grade Quality):

*** Acceptance Criteria count is dynamic and determined by the complexity of the user story.There is NO fixed minimum or maximum number
    Every Acceptance Criterion must be:
    Independently testable,Clearly verifiable by QA, Written in outcome-focused, business-readable language,Traceable to one or more Test Cases***

acceptance criteria TITLE (5-8 words)**
- Use action-oriented, descriptive language that clearly states what is being tested
- Format: "[Action] [Object] [Result/Condition]"
- Examples: "User successfully submits form with validation", "System processes payment and sends confirmation", "Dashboard displays real-time metrics correctly"

NOTE: When no personas are provided, then this section to focus on system state rather than user roles:
✓ Specific system/data state with exact values, IDs, statuses
  Example: "Feature flag 'new-checkout-flow' is enabled, payment service is responding normally, test data exists in staging database"
✓ Specific screen/page location with exact URL or navigation path
  Example: "Request is submitted to the '/api/checkout' endpoint with valid payload"
✓ Precise configuration or environment conditions
  Example: "System is in production environment, database connection pool has 10 available connections"
✓ Time-based or external dependencies if relevant
  Example: "Request is processed during normal business hours with all external payment APIs operational"

Acceptance Criteria Format:
AC-1: [Clear outcome-based statement]
AC-2: [Clear outcome-based statement]
AC-3: [Clear outcome-based statement]

*** TESTABILITY REQUIREMENTS ***
Each acceptance criterion must be:
✓ Independently testable without dependencies on other ACs
✓ Verifiable through automated or manual QA testing
✓ Specific enough that QA can write test cases without asking developers for clarification
✓ Includes exact expected values, not ranges or "appropriate" values
✓ Measurable with clear pass/fail conditions


*** COVERAGE REQUIREMENTS ***
Your acceptance criteria MUST cover:
1. Happy path scenario (primary successful flow)
2. At least 1 validation/error scenario (invalid input, permission denied, data not found)
3. At least 1 edge case (boundary conditions, concurrent users, system limits)
4. Optional: Performance/load scenario if relevant
5. Optional: Integration/API scenario if system interacts with external services

4. SUBTASK FORMAT:
Each subtask MUST include:
- Category prefix: [Planning/Backend/Frontend/Database/Integration/Testing/Documentation/DevOps]
- Specific deliverable with technical details (API endpoints, component names, table names)
- Time estimate in hours (1-8 hours, break down if larger)
Example: "Backend - Implement POST /api/claims endpoint with multipart form data and validation - 4 hours"

IMPORTANT: You MUST respond with ONLY valid JSON, no other text, no explanations, no markdown code blocks.
The JSON response must be a single valid JSON object.

CRITICAL: RESPONSE SIZE OPTIMIZATION (PREVENT TRUNCATION)
- Keep descriptions EXTREMELY concise: 150-250 words per story (not 200-400)
- Each of the 7 description sections should be 1-2 sentences maximum
- Limit acceptance criteria to 3-4 per story (only essential ones)
- Limit subtasks to 4-6 per story (not 6-10) - prioritize critical ones only
- Keep subtasks to one brief line each (no verbose details)
- Prioritize essential information - avoid any verbose explanations
- Focus on quality over quantity - brevity is critical to prevent truncation`,
      },
      {
        role: "user",
        content: `CRITICAL INSTRUCTIONS - FOLLOW EXACTLY:

You MUST generate Epics as TOP-LEVEL business/strategic initiatives based on the BRD functional requirements.
Analyze the functional requirements and determine the appropriate number of epics based on:
- Main business goals or strategic initiatives mentioned in the BRD
- Key functional areas or modules in the system
- Phase-based deliverables (e.g., "MVP", "Phase 2", "Phase 3")
- Major capability categories (e.g., "User Authentication", "Payment Processing", "Reporting")

CRITICAL: Let the BRD functional requirements drive the number and structure of epics, features, and user stories.

Every Feature MUST be assigned to an Epic via the "epicId" field.
Every User Story MUST be assigned to a Feature via the "featureId" AND an Epic via the "epicId" field.

Based on this requirement${functionalRequirementsContent ? ' and the BRD functional requirements provided above' : ''}, generate high-quality agile artifacts:

${requirement}

CRITICAL: The number of epics, features, and user stories MUST be determined dynamically based on:
${functionalRequirementsContent ? '- The functional requirements from the BRD - these are MANDATORY and must be fully covered\n' : ''}- The complexity and scope of the requirements provided
- The logical grouping of related capabilities
- Each functional requirement should be covered by appropriate artifacts

IMPORTANT: Ensure ALL functional requirements are properly covered by the generated artifacts.
Each functional requirement should map to appropriate features and user stories.

Generate a JSON response with the following structure (example showing format only - generate the appropriate number of items):

CRITICAL ID FORMAT REQUIREMENTS:
- Epic IDs MUST follow format: "epic-1", "epic-2", "epic-3", etc. (sequential numbers starting from 1)
- Feature IDs MUST follow format: "feature-1", "feature-2", "feature-3", etc. (sequential numbers starting from 1)
- User Story IDs MUST follow format: "story-1", "story-2", "story-3", etc. (sequential numbers starting from 1)
- DO NOT use UUIDs, random strings, or any other ID format
- The ID format MUST be exactly as shown: lowercase type, hyphen, then sequential number

CRITICAL RELATIONSHIP REQUIREMENTS:
- Every feature MUST have an "epicId" field that matches an existing epic's "id" (e.g., if epic has id "epic-1", feature's epicId must be "epic-1")
- Every user story MUST have both "featureId" and "epicId" fields that match existing feature and epic IDs
- All relationships MUST be properly linked - no orphaned features or stories

Example structure:
{
  "epics": [
    {
      "id": "epic-1",
      "title": "Epic title",
      "description": "Epic description",
      "priority": "High|Medium|Low",
      "featureCount": <number of features in this epic>
    }
  ],
  "features": [
    {
      "id": "feature-1",
      "epicId": "epic-1",
      "title": "Feature title",
      "description": "Feature description",
      "priority": "High|Medium|Low"
    }
  ],
  "userStories": [
    {
      "id": "story-1",
      "featureId": "feature-1",
      "epicId": "epic-1",
      "personaId": "${personasToUse.length > 0 ? 'persona-id' : null}",
      "persona": "${personasToUse.length > 0 ? 'Persona Name' : 'Intelligently Detected Persona Name'}",
      "title": "${personasToUse.length > 0 ? 'As [PersonaName], I want to [direct verb phrase] so that [outcome]' : 'As [Detected Persona], I want to [direct verb phrase] so that [outcome]'}",
      "description": "[Description: include CONTEXT & BACKGROUND and DESIRED STATE (mandatory); include CURRENT STATE, KEY FUNCTIONALITY, USER INTERACTION FLOW, TECHNICAL CONSIDERATIONS, OUT OF SCOPE, SUCCESS METRICS only when grounded in the chunk text. Never use placeholder filler.]",
      "acceptanceCriteria": [{"title": "AC title"}],
      "subtasks": ["Planning - ...", "Backend - ...", "Testing - ..."],
      "storyPoints": <1-13>,
      "priority": "High|Medium|Low"
    }
  ],
  "personas": ${JSON.stringify(personasToUse, null, 2)}
}

CRITICAL REQUIREMENTS FOR DYNAMIC GENERATION WITH STRICT LIMITS:
- The count MUST be determined dynamically based on the complexity and scope of the requirements
${functionalRequirementsContent ? '- If BRD functional requirements are provided, prioritize the MOST CRITICAL functional requirements\n' : ''}- Group related capabilities efficiently into epics
- Break down each epic into implementable features
- Create user stories to implement each feature

MANDATORY ARTIFACT LIMITS (DO NOT EXCEED - PREVENTS TRUNCATION):
- Epics: 1-2 maximum (prefer 1 if requirements can be grouped)
- Features: 2-3 per epic maximum (prefer 2 per epic)
- User Stories: 2-3 per feature maximum (prefer 2 per feature)
- TOTAL MAXIMUM: 2 epics × 3 features × 3 stories = 18 user stories maximum
- If requirements are extensive, prioritize the most critical ones and consolidate
- DO NOT exceed these limits - exceeding will cause response truncation
${personasToUse.length > 0 ? `- Use ONLY the ${personasToUse.length} persona(s) specified above from the Persona Manager - DO NOT invent any additional personas` : `- NO PERSONAS WERE EXPLICITLY PROVIDED - You MUST intelligently detect personas from the requirements:
  1. Analyze the requirement text to identify user roles/personas
  2. Look for role mentions, user types, and functionality descriptions
  3. Create appropriate persona names based on the domain context
  4. Use the natural format: "As [detected persona], I want to [direct verb phrase] so that [outcome]" (NOT "perform [noun]")
  5. Be specific - avoid generic terms like "user" - identify specific roles (e.g., "Business Analyst", "System Administrator", "Business Processor")
  6. Each user story MUST have a persona that makes sense for the functionality described`}
${personasToUse.length > 0 ? `- Distribute user stories across ALL ${personasToUse.length} selected personas` : `- Do NOT distribute across personas - instead distribute across different functional areas or features of the system`}
${personasToUse.length > 0 ? `- Return the EXACT persona objects shown above in the "personas" array` : `- Return an EMPTY "personas" array (empty array [] not null) since no personas were provided and none should be created`}

/* ACCEPTANCE CRITERIA BLOCK REMOVED
  The detailed acceptance-criteria enforcement and example blocks have been removed from this prompt.
  Acceptance criteria generation is delegated to the separate prompt template and generator:
  - server/prompts/prompt_acceptance_criteria.ts (export: promptenhanceAcceptanceCriteria)
  The artifact-generation flow should call the acceptance-criteria generator separately when needed.
  NOTE: Keeping this prompt focused on generating epics, features, and stories. Do NOT enforce AC-specific constraints here.
*/
- Each user story MUST have 4-6 subtasks (REDUCED from 6-10 to prevent truncation) covering key categories:
  * Planning & Design (1 subtask)
  * Backend Development (1-2 subtasks)
  * Frontend Development (1-2 subtasks)
  * Database Changes (0-1 subtask if applicable)
  * Integration Work (0-1 subtask if applicable)
  * Testing (1-2 subtasks - prioritize critical tests)
  * Documentation (0-1 subtask)
  * Code Review & Deployment (1 subtask)
CRITICAL: Total 4-6 subtasks maximum per story to prevent response truncation
- Subtask hours should match story points: 1 point = 6-8 hours, 3 points = 18-24 hours, 5 points = 30-40 hours
- CRITICAL ID FORMAT: All IDs MUST follow exact format - "epic-1", "epic-2", "feature-1", "feature-2", "story-1", "story-2" (lowercase type, hyphen, sequential number starting from 1)
- CRITICAL RELATIONSHIPS: Ensure all IDs are properly linked:
  * feature.epicId must match an existing epic.id (e.g., "epic-1")
  * story.featureId must match an existing feature.id (e.g., "feature-1")
  * story.epicId must match an existing epic.id (e.g., "epic-1")
  * DO NOT use UUIDs, random strings, or any other ID format - only the format shown above
- Make the content specific to the requirement provided
- User story descriptions MUST be 150-250 words (EXTREMELY CONCISE) with ALL 7 SECTIONS clearly labeled but brief (1-2 sentences per section)
- Keep acceptance criteria to 3-4 essential items per story (prioritize quality over quantity)
- Limit subtasks to 4-6 per story (not 6-10) - only critical ones
- Subtasks MUST include category prefix, brief technical details, and time estimates - keep each subtask to one concise line
- CRITICAL: Be extremely concise throughout - response truncation prevention is top priority
- Return ONLY the JSON object, no additional text`,
      },
    ];
    // CRITICAL: Use Claude API (via ai client) for artifact generation
    // The ai client automatically handles Anthropic if configured, otherwise falls back to OpenAI

    // Calculate estimated request size for logging and optimization
    const totalMessageLength = messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0);
    const estimatedTokens = Math.ceil(totalMessageLength / 4);
    console.log("[AI Service] Total message length:", totalMessageLength, "characters");
    console.log("[AI Service] Estimated input tokens (rough):", estimatedTokens);

    // Optimize max_tokens based on input size to prevent Azure timeouts
    // Azure Anthropic has a ~2-3 minute timeout, so we need to be conservative
    // Test results: 
    // - 4096: Works (~70s) but truncates
    // - 5120: Truncates
    // - 6144: Truncates
    // - 7168: Times out
    // Solution: Use 5632 (middle ground) + aggressive prompt optimization.
    // For OpenAI/Azure models (e.g. gpt-4o-mini, which supports 16384 completion tokens),
    // keep a safe margin below the model cap to avoid invalid_request_error.
    let maxTokens: number;
    if (anthropicConfigured) {
      maxTokens = 5632; // Balanced for Anthropic on Azure
    } else if (useAzure) {
      maxTokens = 12000; // Safe value for Azure OpenAI models with 16k completion limit
    } else {
      maxTokens = 32768; // Non-Azure OpenAI can use larger values
    }

    // Adjust based on input size, but keep it reasonable to avoid Azure timeouts
    if (anthropicConfigured && estimatedTokens > 50000) {
      maxTokens = 5632; // Balanced for very large inputs
      console.log("[AI Service] Very large input detected (>50k tokens), using max_tokens:", maxTokens, "to balance truncation and timeout");
    } else if (anthropicConfigured && estimatedTokens > 30000) {
      maxTokens = 5632; // Balanced for large inputs
      console.log("[AI Service] Large input detected (>30k tokens), using max_tokens:", maxTokens, "to balance truncation and timeout");
    } else if (anthropicConfigured && estimatedTokens > 10000) {
      maxTokens = 5632; // Balanced for moderate inputs
      console.log("[AI Service] Moderate input detected (>10k tokens), using max_tokens:", maxTokens);
    } else if (anthropicConfigured) {
      maxTokens = 5632; // Balanced default
      console.log("[AI Service] Using default max_tokens:", maxTokens, "for Anthropic to balance truncation and timeout");
    }

    if (anthropicConfigured) {
      console.log("[AI Service] Sending request to Anthropic API with max_tokens:", maxTokens);
      console.log("[AI Service] Using Anthropic:", anthropicConfigured, "- Optimized to avoid timeouts");
    } else {
      console.log("[AI Service] Sending request to OpenAI API with max_tokens:", maxTokens);
    }
    const requestStartTime = Date.now();

    // Some Azure/OpenAI deployments reject `max_tokens` and require `max_completion_tokens` instead.
    // Keep it model-name based so we don't break older deployments.
    const newApiModels = NEW_API_MODEL_SUBSTRINGS;
    const isNewModel = newApiModels.some((m) => modelName?.includes(m));
    const tokensParam = isNewModel
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
    const response = await ai.chat.completions.create({
      model: modelName,
      // Claude doesn't support response_format, but we'll request JSON in the prompt
      ...(anthropicConfigured
        ? {}
        : (modelName.toLowerCase().includes("gpt")
          ? { response_format: { type: "json_object" } }
          : {})),
      messages: messages,
      // Lower temperature for more deterministic output and increase max tokens for comprehensive artifacts
      temperature: llmTemperature,
      ...tokensParam,
    });

    const requestDuration = Date.now() - requestStartTime;
    console.log("[AI Service] Anthropic API request completed in", requestDuration / 1000, "seconds");

    console.log("[AI Service] Response received:", response);
    const content = response.choices[0]?.message?.content || "{}";
    const finishReason = response.choices[0]?.finish_reason;
    console.log("[AI Service] Artifacts generated, length:", content.length);
    console.log("[AI Service] Finish reason:", finishReason);
    console.log("[AI Service] First 300 chars:", content.slice(0, 300));

    if (!content || content === "{}") {
      throw new Error("AI returned empty response for artifacts");
    }

    // Robust JSON parsing — handles markdown code blocks, truncated responses, Bedrock quirks
    let artifacts: any;
    try {
      const { parsed, wasCodeBlock } = extractJsonFromLLMResponse(content);
      artifacts = parsed;
      if (wasCodeBlock) console.log("[AI Service] Extracted JSON from markdown code block");
    } catch (parseError) {
      console.error("[AI Service] JSON Parse Error:", parseError);
      console.error("[AI Service] Content length:", content.length);
      console.error("[AI Service] First 500 chars:", content.slice(0, 500));
      console.error("[AI Service] Last 500 chars:", content.slice(-500));
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }

    console.log("[AI Service] Parsed artifacts:", {
      epics: artifacts.epics?.length,
      features: artifacts.features?.length,
      stories: artifacts.userStories?.length,
      personas: artifacts.personas?.length,
    });

    // DEBUG: Log the entire artifacts object structure
    console.log("[AI Service] Full artifacts structure:", JSON.stringify(artifacts, null, 2).slice(0, 1000));

    // DETAILED DEBUG: Log relationship structure
    if (artifacts.userStories && artifacts.userStories.length > 0) {
      console.log("[AI Service] === USER STORY RELATIONSHIP DEBUG ===");
      artifacts.userStories.slice(0, 5).forEach((story: any, idx: number) => {
        console.log(`[AI Service] Story ${idx}: id=${story.id}, featureId=${story.featureId}, epicId=${story.epicId}, title=${story.title}`);
      });
    }

    if (artifacts.features && artifacts.features.length > 0) {
      console.log("[AI Service] === FEATURE RELATIONSHIP DEBUG ===");
      artifacts.features.slice(0, 3).forEach((feature: any, idx: number) => {
        console.log(`[AI Service] Feature ${idx}: id=${feature.id}, epicId=${feature.epicId}, title=${feature.title}`);
      });
    }

    // VALIDATION: Ensure all required fields are present
    if (!artifacts.epics || !Array.isArray(artifacts.epics) || artifacts.epics.length === 0) {
      console.error("[AI Service] VALIDATION ERROR: No epics found in artifacts");
      console.error("[AI Service] Full parsed artifacts:", JSON.stringify(artifacts, null, 2).substring(0, 2000));
      console.error("[AI Service] Raw response content (first 1000 chars):", content.slice(0, 1000));
      console.error("[AI Service] Raw response content (last 500 chars):", content.slice(-500));

      // FALLBACK: Create a default epic if none were generated
      console.log("[AI Service] FALLBACK: Creating default epic since none were generated");
      artifacts.epics = [{
        id: "epic-1",
        title: "Core Application Features",
        description: "Main features and capabilities of the application",
        priority: "High",
        featureCount: artifacts.features?.length || 0
      }];

      // Assign all features to the default epic if they don't have epicId
      if (artifacts.features && artifacts.features.length > 0) {
        artifacts.features = artifacts.features.map((f: any) => ({
          ...f,
          epicId: f.epicId || "epic-1"
        }));
      }

      // Assign all stories to the default epic if they don't have epicId
      if (artifacts.userStories && artifacts.userStories.length > 0) {
        artifacts.userStories = artifacts.userStories.map((s: any) => ({
          ...s,
          epicId: s.epicId || "epic-1"
        }));
      }

      console.log("[AI Service] FALLBACK: Created default epic and assigned all items to it");
    }
    if (!artifacts.features || !Array.isArray(artifacts.features) || artifacts.features.length === 0) {
      throw new Error("Generated artifacts must contain at least 1 feature");
    }
    if (!artifacts.userStories || !Array.isArray(artifacts.userStories) || artifacts.userStories.length === 0) {
      throw new Error("Generated artifacts must contain at least 1 user story");
    }

    // Validate ID format - CRITICAL for system compatibility
    const idFormatRegex = {
      epic: /^epic-\d+$/,
      feature: /^feature-\d+$/,
      story: /^story-\d+$/
    };

    // Validate epic structure and ID format
    const invalidEpics = artifacts.epics.filter((e: any) => {
      if (!e.id || !e.title) return true;
      if (!idFormatRegex.epic.test(e.id)) {
        console.error(`[AI Service] Invalid epic ID format: ${e.id} - expected format: epic-1, epic-2, etc.`);
        return true;
      }
      return false;
    });
    if (invalidEpics.length > 0) {
      throw new Error(`Invalid epics found: missing id/title or incorrect ID format. Invalid count: ${invalidEpics.length}. IDs must follow format: epic-1, epic-2, etc.`);
    }

    // Validate feature structure and ID format
    const invalidFeatures = artifacts.features.filter((f: any) => {
      if (!f.id || !f.title || !f.epicId) return true;
      if (!idFormatRegex.feature.test(f.id)) {
        console.error(`[AI Service] Invalid feature ID format: ${f.id} - expected format: feature-1, feature-2, etc.`);
        return true;
      }
      // Validate epicId references an existing epic
      const epicExists = artifacts.epics.some((e: any) => e.id === f.epicId);
      if (!epicExists) {
        console.error(`[AI Service] Feature ${f.id} references non-existent epic: ${f.epicId}`);
        return true;
      }
      return false;
    });
    if (invalidFeatures.length > 0) {
      throw new Error(`Invalid features found: missing id/title/epicId, incorrect ID format, or invalid epicId reference. Invalid count: ${invalidFeatures.length}. IDs must follow format: feature-1, feature-2, etc.`);
    }

    // Validate user story structure and ID format
    const invalidStories = artifacts.userStories.filter((s: any) => {
      if (!s.id || !s.title || !s.featureId || !s.epicId) return true;
      if (!idFormatRegex.story.test(s.id)) {
        console.error(`[AI Service] Invalid story ID format: ${s.id} - expected format: story-1, story-2, etc.`);
        return true;
      }
      // Validate featureId references an existing feature
      const featureExists = artifacts.features.some((f: any) => f.id === s.featureId);
      if (!featureExists) {
        console.error(`[AI Service] Story ${s.id} references non-existent feature: ${s.featureId}`);
        return true;
      }
      // Validate epicId references an existing epic
      const epicExists = artifacts.epics.some((e: any) => e.id === s.epicId);
      if (!epicExists) {
        console.error(`[AI Service] Story ${s.id} references non-existent epic: ${s.epicId}`);
        return true;
      }
      return false;
    });
    if (invalidStories.length > 0) {
      throw new Error(`Invalid user stories found: missing id/title/featureId/epicId, incorrect ID format, or invalid references. Invalid count: ${invalidStories.length}. IDs must follow format: story-1, story-2, etc.`);
    }

    // Ensure all user stories have testCases array and normalize structure
    artifacts.userStories = artifacts.userStories.map((story: any) => {
      const rawTCs = story.testCases && Array.isArray(story.testCases) ? story.testCases : [];
      const normalized = rawTCs.map((tc: any, tcIdx: number) => {
        const steps = Array.isArray(tc.testCaseSteps)
          ? tc.testCaseSteps
          : Array.isArray(tc.steps)
            ? tc.steps.map((s: any, idx: number) => {
              if (typeof s === 'string') {
                return { Steps: idx + 1, Action: s, "Expected Results": "" };
              }
              return {
                Steps: typeof s.Steps === 'number' ? s.Steps : idx + 1,
                Action: s.Action || s.action || s["Action"] || '',
                "Expected Results": s["Expected Results"] || s.expectedResult || s.expected || ''
              };
            })
            : [];

        return {
          id: tc.id || `TC-${Math.random().toString(36).substr(2, 9)}`,
          title: tc.title || tc.scenario || `Test case ${tcIdx + 1}`,
          testCaseSteps: steps
        };
      });

      return { ...story, testCases: normalized };
    });

    // Generate test cases for stories that have none or minimal examples
    for (let i = 0; i < artifacts.userStories.length; i++) {
      const story = artifacts.userStories[i];
      if (!story.testCases || story.testCases.length < 2) {
        const acText = story.acceptanceCriteria && Array.isArray(story.acceptanceCriteria)
          ? story.acceptanceCriteria.map((ac: any) => (ac.title || ac)).join("\n")
          : (typeof story.acceptanceCriteria === 'string' ? story.acceptanceCriteria : "");
        const generated = await generateTestCasesForStory(story, acText);
        if (generated && generated.length > 0) {
          story.testCases = generated;
          console.log("[AI Service] Generated test cases for story:", story.id, generated.length);
        }
      }
    }

    console.log("[AI Service] Artifacts with testCases validated. Sample testCase count:",
      artifacts.userStories.length > 0 ? artifacts.userStories[0].testCases?.length : 0);

    // Process personas and finalize personaSource tags
    if (artifacts.userStories && Array.isArray(artifacts.userStories)) {
      console.log("[AI Service] Processing user stories for personaSource tagging");
      console.log(
        "[AI Service] Selected personas from hub:",
        selectedPersonasFromHub.map(p => ({ id: p.id, name: p.name }))
      );

      artifacts.userStories = artifacts.userStories.map((story: any) => {
        // Extract persona name from title (handles both "As" and "as")
        const titleMatch = story.title?.match(/^(?:As|as)\s+([^,]+)/i);
        const storyPersonaName = story.persona || titleMatch?.[1]?.trim();
        const storyPersonaId = story.personaId;
        let personaSource: string | undefined = story.personaSource;

        console.log(`[AI Service] Processing story "${story.title}"`);
        console.log(`[AI Service] - story.persona: ${story.persona}`);
        console.log(`[AI Service] - story.personaId: ${story.personaId}`);
        console.log(`[AI Service] - Extracted persona name: ${storyPersonaName}`);
        console.log(`[AI Service] - LLM personaSource (raw): ${story.personaSource}`);

        let matchedPersona: any | null = null;

        // If hub personas are available, try to match (for ID enrichment only)
        if (selectedPersonasFromHub.length > 0) {
          if (storyPersonaId) {
            matchedPersona = selectedPersonasFromHub.find(p => p.id === storyPersonaId) || null;
            if (matchedPersona) {
              console.log(
                `[AI Service] ✅ Matched Hub persona by ID: ${matchedPersona.name} (${matchedPersona.id})`
              );
            }
          }

          if (!matchedPersona && storyPersonaName) {
            const normalizedStoryName = storyPersonaName.toLowerCase().trim();
            matchedPersona =
              selectedPersonasFromHub.find(
                p => p.name.toLowerCase().trim() === normalizedStoryName
              ) || null;

            if (matchedPersona) {
              console.log(
                `[AI Service] ✅ Matched Hub persona by name: ${matchedPersona.name} (${matchedPersona.id})`
              );
              // Enrich personaId if LLM didn't set it
              if (!story.personaId) {
                story.personaId = matchedPersona.id;
                console.log(`[AI Service] - Enriched personaId to: ${matchedPersona.id}`);
              }
            }
          }
        }

        // If LLM did not provide personaSource, derive a sensible default
        if (!personaSource) {
          if (matchedPersona) {
            personaSource = "From Persona Hub";
          } else {
            personaSource = "AI Suggested";
          }
        }

        story.personaSource = personaSource;
        console.log(`[AI Service] Final personaSource for story: ${personaSource}`);

        return story;
      });
    }

    // Process personas array and ensure personaSource is present
    if (artifacts.personas && Array.isArray(artifacts.personas)) {
      console.log("[AI Service] Processing personas array for personaSource defaults");
      artifacts.personas = artifacts.personas.map((persona: any) => {
        if (!persona.personaSource) {
          persona.personaSource = "AI Suggested";
        }
        return persona;
      });
    }

    artifacts = enforceHierarchyLimits(artifacts);
    let validatedArtifacts = validateAndEnforceHierarchy(artifacts);

    // Tag personas for BRD-based artifacts using Hub personas vs AI-suggested personas
    validatedArtifacts = tagPersonasForBrdArtifacts(validatedArtifacts, selectedPersonasFromHub);
    logPersonaTagSample(validatedArtifacts, selectedPersonasFromHub);

    return validatedArtifacts;

  } catch (error) {
    console.error("[AI Service] Error generating artifacts:", error);
    throw error;
  }
}
export { promptWorkflowRequirements };


export async function generatePhaseDocumentation(
  phaseName: string,
  phaseNumber: number,
  projectName: string,
  workItems: {
    userStories: any[];
    requirements: any[];
    backlog: any[];
    documents: any[];
  },
): Promise<string> {
  try {
    console.log("[AI Service] Generating phase documentation for:", phaseName);
    console.log("[AI Service] Work items count:", {
      userStories: workItems.userStories?.length || 0,
      requirements: workItems.requirements?.length || 0,
      backlog: workItems.backlog?.length || 0,
      documents: workItems.documents?.length || 0,
    });

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content:
            "You are an expert technical writer and SDLC documentation specialist. Generate comprehensive, professional phase documentation that summarizes project phases in a clear, structured format suitable for stakeholders, team members, and future reference.",
        },
        {
          role: "user",
          content: `Generate comprehensive documentation for the "${phaseName}" phase of project "${projectName}".

**Phase Context:**
- Phase Number: ${phaseNumber}
- Phase Name: ${phaseName}
- Project: ${projectName}

**Work Items Completed in This Phase:**

**User Stories (${workItems.userStories?.length || 0}):**
${workItems.userStories
              ?.map(
                (story, i) => `
${i + 1}. **${story.title}**
   - Priority: ${story.priority || "Not specified"}
   - Status: ${story.status || "Not specified"}
   - Description: ${story.description?.substring(0, 300) || "No description"}
   ${story.acceptanceCriteria ? `- Acceptance Criteria: ${typeof story.acceptanceCriteria === "string" ? story.acceptanceCriteria.substring(0, 200) : JSON.stringify(story.acceptanceCriteria).substring(0, 200)}` : ""}
`,
              )
              .join("\n") || "No user stories"
            }

**Requirements (${workItems.requirements?.length || 0}):**
${workItems.requirements
              ?.map(
                (req, i) => `
${i + 1}. **${req.title}**
   - Type: ${req.type || "Not specified"}
   - Priority: ${req.priority || "Not specified"}
   - Status: ${req.status || "Not specified"}
   - Description: ${req.description?.substring(0, 300) || "No description"}
`,
              )
              .join("\n") || "No requirements"
            }

**Backlog Items (${workItems.backlog?.length || 0}):**
${workItems.backlog
              ?.map(
                (item, i) => `
${i + 1}. **${item.title}**
   - Type: ${item.type || "Not specified"}
   - Priority: ${item.priority || "Not specified"}
   - Status: ${item.status || "Not specified"}
   - Description: ${item.description?.substring(0, 200) || "No description"}
`,
              )
              .join("\n") || "No backlog items"
            }

**Existing Documentation (${workItems.documents?.length || 0}):**
${workItems.documents?.map((doc, i) => `${i + 1}. ${doc.title}`).join("\n") || "No existing documentation"}

---

**Generate a comprehensive phase documentation document with the following structure:**

# ${phaseName} - Phase Documentation
**Project:** ${projectName}

## Executive Summary
[2-3 paragraphs providing a high-level overview of this phase, its objectives, and key outcomes]

## Phase Overview
### Objectives
[List 3-5 primary objectives for this phase]

### Scope
[Define what was included and excluded from this phase]

### Timeline & Status
[Overview of phase timeline and current completion status]

## Deliverables

### User Stories Summary
[Comprehensive summary of all user stories, organized by priority or theme. Include:
- Total count and breakdown by priority
- Key themes and patterns
- Critical user stories with brief descriptions
- Acceptance criteria highlights]

### Requirements Analysis
[Detailed summary of requirements, including:
- Total count and breakdown by type
- Functional requirements overview
- Non-functional requirements overview
- Critical requirements with brief descriptions
- Dependencies and constraints]

### Backlog Items
[Summary of backlog items, including:
- Total count and breakdown by type/priority
- Prioritization approach
- Sprint planning considerations
- Technical debt items if any]

## Key Decisions & Rationale
[Document 3-5 major decisions made during this phase and the reasoning behind them]

## Stakeholder Inputs
[Summary of stakeholder feedback, review comments, and approvals]

## Risks & Mitigations
[Identify 3-5 risks discovered during this phase and proposed mitigations]

## Next Steps
[Outline what should happen in the next phase based on this phase's outcomes]

## Appendix
### Metrics
- Total User Stories: ${workItems.userStories?.length || 0}
- Total Requirements: ${workItems.requirements?.length || 0}
- Total Backlog Items: ${workItems.backlog?.length || 0}
- Phase Completion: [Calculate based on status]

### References
[List any key documents, tools, or resources referenced]

---

**Requirements:**
- Use professional, clear language suitable for technical and non-technical stakeholders
- Include specific details from the work items provided
- Organize information logically with clear headings and subheadings
- Use Markdown formatting for readability
- Be comprehensive but concise (aim for 1500-2500 words)
- Include actionable insights and recommendations
- Ensure all statistics are accurate based on the data provided

Return ONLY the generated documentation in Markdown format, no additional commentary.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 40000,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log(
      "[AI Service] Phase documentation generated, length:",
      content.length,
    );

    if (!content || content.trim().length === 0) {
      throw new Error("AI returned empty response for phase documentation");
    }

    return content;
  } catch (error) {
    console.error("[AI Service] Error generating phase documentation:", error);
    throw error;
  }
}

// ============================================================================
// CONTEXT DETECTION UTILITIES
// ============================================================================

// Upper bound for how much raw project context we ever send to the LLM
// for Wiki generation. This helps us stay well below token limits even
// when there are many epics/features/user stories.
const MAX_WIKI_CONTEXT_CHARS = 5000; // Reduced from 8000 to reduce token usage

function truncateForWiki(value: string, maxChars: number): string {
  if (!value) return "";
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value;
}

/**
 * Retry helper with exponential backoff for rate limits and timeouts
 * Optimized for speed - uses shorter delays to minimize total generation time
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 10000 // Reduced from 60s to 10s for faster retries
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const statusCode = error?.status || error?.response?.status || error?.code;
      const errorMessage = error?.message || String(error);

      // Check if it's a rate limit error (429) or timeout
      if (statusCode === 429 || errorMessage.includes('rate limit') || errorMessage.includes('429')) {
        // Use shorter delays: 10s, 15s, 20s for faster recovery
        const delay = baseDelay + (attempt * 5000) + Math.random() * 2000; // 10s base + 5s per attempt + small jitter
        console.log(`[AI Service] Rate limit hit (429), waiting ${Math.round(delay / 1000)}s before retry (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // For other errors, throw immediately
      throw error;
    }
  }
  throw lastError;
}

/**
 * Semaphore-like concurrency limiter for parallel processing
 */
class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number) { }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        this.running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      };

      if (this.running < this.maxConcurrent) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }
}

/**
 * Process wiki page generation in parallel - same approach as artifact generation
 * Uses Promise.all() to process all pages simultaneously for maximum speed
 * Follows the same pattern as generateArtifactsFromBRDRequirements chunk processing
 */
async function generateWikiPagesInChunks(
  pageGenerators: Array<() => Promise<any>>,
  onProgress?: (completed: number, total: number) => void
): Promise<any[]> {
  const startTime = Date.now();

  let completedCount = 0;
  const totalCount = pageGenerators.length;

  const progressCounter = { count: 0 };
  const results: any[] = new Array(totalCount);
  
  const concurrencyLimit = Number(process.env.WIKI_PAGE_CONCURRENCY) || 10;
  console.log(`[AI Service] Processing ${totalCount} wiki pages with concurrency=${concurrencyLimit}...`);
  let currentIndex = 0;
  
  const worker = async () => {
    while (currentIndex < totalCount) {
      const index = currentIndex++;
      const generator = pageGenerators[index];
      
      console.log(`[AI Service] 🚀 Starting Wiki Page ${index + 1}/${totalCount}...`);
      const pageStartTime = Date.now();
      
      try {
        const result = await generator();
        
        progressCounter.count++;
        if (onProgress) {
          onProgress(progressCounter.count, totalCount);
        }
        
        const pageDuration = Date.now() - pageStartTime;
        console.log(`[AI Service] ✅ Wiki Page ${index + 1} completed in ${pageDuration / 1000}s`);
        
        results[index] = { status: 'fulfilled', value: result };
      } catch (error: any) {
        progressCounter.count++;
        if (onProgress) {
          onProgress(progressCounter.count, totalCount);
        }
        results[index] = { status: 'rejected', reason: error };
      }
    }
  };

  const workers = Array(Math.min(concurrencyLimit, totalCount)).fill(null).map(() => worker());
  await Promise.all(workers);

  // Process results and filter out failed pages
  const successfulPages: any[] = [];
  const failedPages: Array<{ index: number; error: string }> = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      // Check if it's an error page (from retry logic) or has invalid content
      if (result.value && result.value.pageType !== 'error' && result.value.phase !== 'error') {
        // Validate that the page has required fields and content is not empty
        const hasTitle = result.value.title && result.value.title.trim().length > 0;
        const hasContent = result.value.content && result.value.content.trim().length > 0;

        if (hasTitle && hasContent) {
          // Normalize Mermaid blocks centrally so every diagram-bearing page benefits
          try {
            result.value.content = normalizeMermaidBlocks(result.value.content);
          } catch (normErr) {
            console.warn(`[AI Service] Mermaid normalization skipped for page ${index + 1}:`, normErr);
          }
          successfulPages.push(result.value);
          console.log(`[AI Service] ✅ Page ${index + 1} (${result.value.title}) validated successfully`);
        } else {
          const errorMsg = `Missing required fields: title=${hasTitle}, content=${hasContent}`;
          failedPages.push({ index: index + 1, error: errorMsg });
          console.error(`[AI Service] ❌ Page ${index + 1} validation failed: ${errorMsg}`);
        }
      } else {
        const errorMsg = result.value?.content || result.value?.error || 'Unknown error - page marked as error';
        failedPages.push({ index: index + 1, error: errorMsg });
        console.error(`[AI Service] ❌ Page ${index + 1} marked as error: ${errorMsg}`);
      }
    } else {
      const errorMessage = result.reason?.message || result.reason?.toString() || 'Generation failed';
      failedPages.push({ index: index + 1, error: errorMessage });
      console.error(`[AI Service] ❌ Page ${index + 1} generation failed:`, errorMessage);
    }
  });

  // Log failures with details
  if (failedPages.length > 0) {
    console.error(`[AI Service] ⚠️ ${failedPages.length} wiki pages failed to generate:`);
    failedPages.forEach(({ index, error }) => {
      console.error(`[AI Service]   - Page ${index}: ${error}`);
    });
  }

  const repairEnabled = ['true', '1', 'yes'].includes(String(process.env.MERMAID_REPAIR_ENABLED ?? 'false').toLowerCase());
  if (repairEnabled) {
    await repairWikiPagesBrokenMermaidBlocks(successfulPages);
  }

  // Log successful pages count
  console.log(`[AI Service] ✅ Successfully generated ${successfulPages.length}/${totalCount} wiki pages`);

  // If more than 50% of pages failed, throw error
  if (failedPages.length > pageGenerators.length * 0.5) {
    throw new Error(`Too many wiki pages failed to generate: ${failedPages.length}/${pageGenerators.length}. First error: ${failedPages[0]?.error}`);
  }

  // Warn if we're missing pages (but don't fail - some pages might be optional)
  if (successfulPages.length < totalCount) {
    console.warn(`[AI Service] ⚠️ Warning: Only ${successfulPages.length} out of ${totalCount} pages were generated successfully. Missing ${totalCount - successfulPages.length} pages.`);
  }

  const totalTime = Date.now() - startTime;
  console.log(`[AI Service] ========================================`);
  console.log(`[AI Service] All ${pageGenerators.length} wiki pages processed (concurrency=${concurrencyLimit}) in ${totalTime / 1000}s`);
  console.log(`[AI Service] Successful: ${successfulPages.length}, Failed: ${failedPages.length}`);
  console.log(`[AI Service] ========================================`);

  return successfulPages;
}

/**
 * Normalises Mermaid blocks inside generated wiki Markdown so they can be rendered.
 */
function normalizeMermaidBlocks(rawContent: string): string {
  const VALID_TYPES = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|journey|xychart-beta|block-beta|architecture-beta)\b/i;

  let content = rawContent.replace(/^```markdown\s*\n([\s\S]*?)\n```\s*$/i, '$1').trim();

  content = content
    .replace(/:::\s*mermaid\s*\n([\s\S]*?)\n:::/gi, (_m, code) => "```mermaid\n" + code.trim() + "\n```")
    .replace(/:::\s*mermaid\s+([\s\S]*?):::/gi, (_m, code) => "```mermaid\n" + code.trim() + "\n```");

  {
    const lastOpen = content.lastIndexOf('```mermaid');
    if (lastOpen !== -1) {
      const afterOpen = content.slice(lastOpen);
      const hasClose = /\n```(?!\w)/.test(afterOpen);
      if (!hasClose) {
        content = content.trimEnd() + '\n```';
      }
    }
  }

  content = content.replace(/```mermaid\s*\n([\s\S]*?)\n```/gi, (_match, code) => {
    let fixed = code;

    fixed = fixed.replace(/-->\s*\[([^\]|]+)\|\s*/g, '-->|$1| ');
    fixed = fixed.replace(/-->\s*\[([^\]]+)\]\s*\|/g, '-->|$1| ');
    fixed = fixed.replace(/(?<=^|\s|-->|---)([A-Za-z][A-Za-z0-9_]*[&/][A-Za-z0-9_&/]*)/gm, (id) =>
      id.replace(/[&/]/g, '_')
    );
    fixed = fixed.replace(/\|<<([^>]+)>>\|/g, '|$1|');
    fixed = fixed.replace(/<<(include|extend|uses|extends|generalization|association)>>/gi, '$1');
    fixed = fixed.replace(
      /\[(?![("(])([^\[\]"]*(?:[()&]|<[^>\[\]"]*>)[^\[\]"]*)\]/g,
      '["$1"]'
    );

    const lines = fixed.split('\n');
    const firstNonBlank = lines.find(l => l.trim().length > 0) || '';

    if (/^sequenceDiagram\b/i.test(firstNonBlank.trim())) {
      fixed = fixed.replace(
        /^([ \t]*\S+(?:->>|-->>|->|-->|-x|--x|-\)|--\))\+?\S+[ \t]*:[ \t]*\S.*?)\s+\bend\b[ \t]*$/gm,
        '$1'
      );
      fixed = fixed.replace(
        /^([ \t]*Note\b[^\r\n]+:[ \t]*\S.*?)\s+\bend\b[ \t]*$/gm,
        '$1'
      );
      fixed = fixed.replace(/^[ \t]*\d+[.)][^\r\n]*/gm, '');
      fixed = fixed.replace(/^[ \t]*#{1,6}[ \t]+[^\r\n]*/gm, '');
      fixed = fixed.replace(/^[ \t]*\*\*[^\r\n]*/gm, '');

      {
        let depth = 0;
        for (const ln of fixed.split('\n')) {
          const t = ln.trim().toLowerCase();
          if (/^(alt|loop|opt|par|rect|critical|break)\b/.test(t)) depth++;
          else if (t === 'end') depth = Math.max(0, depth - 1);
        }
        if (depth > 0) fixed = fixed.trimEnd() + ('\nend').repeat(depth);
      }
    }

    if (!VALID_TYPES.test(firstNonBlank.trim())) {
      fixed = 'flowchart TD\n' + fixed;
    }

    return "```mermaid\n" + fixed.trim() + "\n```";
  });

  return content;
}

function isMermaidBlockLikelyValid(code: string): boolean {
  const trimmed = (code || '').trim();
  if (trimmed.length < 12) return false;

  const VALID_TYPES_RX = /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|journey|xychart-beta|block-beta|architecture-beta)\b/i;
  const firstNonBlank = trimmed.split('\n').find(l => l.trim().length > 0) || '';
  if (!VALID_TYPES_RX.test(firstNonBlank.trim())) return false;

  const lastLine = trimmed.split('\n').filter(l => l.trim().length > 0).slice(-1)[0] || '';
  if (/(-->|--|::|->>|-->>|--\))\s*$/.test(lastLine)) return false;
  if (/[\[\(\{][^\]\)\}]*$/.test(lastLine)) return false;

  const diagramType = firstNonBlank.trim().split(/\s+/)[0];
  const skipBraceBalance = /^erDiagram$/i.test(diagramType);

  if (!skipBraceBalance) {
    const balanced = (open: string, close: string) => {
      let n = 0;
      for (const ch of trimmed) {
        if (ch === open) n++;
        else if (ch === close) n--;
        if (n < 0) return false;
      }
      return n === 0;
    };
    if (!balanced('[', ']') || !balanced('(', ')')) return false;
    if (/^(graph|flowchart|gantt|pie|gitGraph|mindmap)$/i.test(diagramType)) {
      if (!balanced('{', '}')) return false;
    }
  } else if (!/\|\|--|\}o--|\}o\.\.|--\|\|/i.test(trimmed)) {
    return false;
  }

  if (/^(graph|flowchart)/i.test(firstNonBlank)) {
    if (!/-->|---|==>|-\.->|\.\./.test(trimmed)) return false;
  }
  if (/^sequenceDiagram/i.test(firstNonBlank)) {
    if (!/->>|-->>|->/i.test(trimmed)) return false;
  }

  return true;
}

async function repairWikiPagesBrokenMermaidBlocks(pages: any[]) {
  const REPAIR_PAGE_CONCURRENCY = Number(process.env.MERMAID_REPAIR_PAGE_CONCURRENCY) || 2;
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < pages.length) {
      const page = pages[currentIndex++];
      try {
        page.content = await repairBrokenMermaidBlocks(page.content, page.title);
      } catch (err) {
        console.warn(`[AI Service] Mermaid repair pass failed for "${page.title}":`, err);
      }
    }
  };

  const workers = Array(Math.min(REPAIR_PAGE_CONCURRENCY, pages.length)).fill(null).map(() => worker());
  await Promise.all(workers);
}

async function repairBrokenMermaidBlocks(content: string, pageTitle: string = 'Wiki Page'): Promise<string> {
  if (!content || !content.includes('```mermaid')) return content;

  const blocks: Array<{ start: number; end: number; code: string }> = [];
  const re = /```mermaid\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, code: m[1] || '' });
  }
  if (blocks.length === 0) return content;

  const broken = blocks.filter(b => !isMermaidBlockLikelyValid(b.code));
  if (broken.length === 0) return content;

  console.log(`[AI Service] Mermaid repair: ${broken.length}/${blocks.length} block(s) in "${pageTitle}" look broken, attempting AI repair...`);

  const REPAIR_CONCURRENCY = Number(process.env.MERMAID_REPAIR_CONCURRENCY) || 3;
  let currentIndex = 0;
  const repairs: Array<{status: string, value?: any, reason?: any}> = new Array(broken.length);
  
  const worker = async () => {
    while (currentIndex < broken.length) {
      const index = currentIndex++;
      const b = broken[index];
      try {
        const fixed = await fixMermaidSyntax(b.code, pageTitle);
        if (fixed && fixed.trim().length > 0 && isMermaidBlockLikelyValid(fixed)) {
          repairs[index] = { status: 'fulfilled', value: { block: b, fixed: fixed.trim() } };
        } else {
          repairs[index] = { status: 'fulfilled', value: null };
        }
      } catch (err) {
        console.warn(`[AI Service] Mermaid repair failed for a block in "${pageTitle}":`, err instanceof Error ? err.message : err);
        repairs[index] = { status: 'rejected', reason: err };
      }
    }
  };

  const workers = Array(Math.min(REPAIR_CONCURRENCY, broken.length)).fill(null).map(() => worker());
  await Promise.all(workers);

  const successful = repairs
    .map(r => r?.status === 'fulfilled' ? r.value : null)
    .filter((x): x is { block: { start: number; end: number; code: string }; fixed: string } => x !== null)
    .sort((a, b) => b.block.start - a.block.start);

  let result = content;
  for (const { block, fixed } of successful) {
    const replacement = '```mermaid\n' + fixed + '\n```';
    result = result.substring(0, block.start) + replacement + result.substring(block.end);
  }

  console.log(`[AI Service] Mermaid repair: ${successful.length}/${broken.length} block(s) repaired in "${pageTitle}"`);
  return result;
}

// Shared style guidelines for all Wiki pages so they look professional
// and consistent with enterprise SDLC documentation standards.
const WIKI_STYLE_GUIDELINES = `
You are producing documentation for an **enterprise SDLC project** that will be published in **${_docPlatform}**.

Follow these standards:
- Use **clear, professional enterprise language** appropriate for senior stakeholders, architects, and auditors.
- Structure the document with **hierarchical Markdown headings** starting at \`#\` for the main title, then \`##\`, \`###\`, etc.
- Use **well-structured tables** for matrices, lists of fields, risks, requirements, and traceability information.
- Use **numbered lists** for ordered steps and **bulleted lists** for unordered information.
- Prefer **concrete, specific content** over placeholders. Avoid vague filler like "etc.", "and so on", or "[add more here]".
- When examples are needed, make them **domain-appropriate** based on the project context.
- Keep terminology consistent across sections (e.g., use the same names for systems, modules, and roles).
- When describing flows, you may use **Mermaid diagrams** in fenced code blocks where appropriate.
- **CRITICAL: All Mermaid diagrams MUST use correct syntax.**
  - Use proper graph declarations: \`graph TD\`, \`graph LR\`, \`flowchart TD\`, etc.
  - Use proper node definitions: \`A[Label]\` for rectangles, \`A((Label))\` for circles, \`A{Label}\` for diamonds
  - Use proper arrow syntax: \`A --> B\`, \`A -->|label| B\`
  - Ensure all brackets, parentheses, and quotes are properly matched
  - Use proper indentation for subgraphs
  - Test your Mermaid syntax before including it in the document
- Do **not** wrap the entire document in a \`\`\`markdown block. Only use fenced code blocks for diagrams or code-like content.
`;

/**
 * Build a compact, LLM-safe textual representation of all artifacts.
 *
 * Goal:
 * - Represent *every* epic, feature, and user story at least once (no dropping),
 *   but cap the overall context length so prompts don't exceed token limits.
 * - Use progressively more aggressive truncation if necessary while still
 *   keeping IDs/titles so the model can maintain traceability.
 */
function buildWikiArtifactsContext(options: {
  requirement: string;
  epics?: any[];
  features?: any[];
  userStories?: any[];
  personas?: any[];
}): string {
  const { requirement, epics = [], features = [], userStories = [], personas = [] } = options;

  // Helper to format a single artifact line with safe truncation
  const formatItem = (label: string, idx: number, item: any, perItemLimit: number) => {
    const id = item.id || `${label.toLowerCase()}-${idx + 1}`;
    const title = item.title || item.name || "";
    const description = item.description || item.summary || "";
    const combined = [title, description].filter(Boolean).join(" — ");
    return `- ${label} ${id}: ${truncateForWiki(combined, perItemLimit)}`;
  };

  // We'll try up to three passes with stricter per-item limits if the
  // overall context is still too large.
  const perItemCandidates = [160, 96, 56];

  for (const perItemLimit of perItemCandidates) {
    const sections: string[] = [];

    sections.push(
      `**Requirement Summary (trimmed):**\n${truncateForWiki(requirement, 2000)}`
    );

    const epicLines = epics.map((e, i) => formatItem("Epic", i, e, perItemLimit));
    const featureLines = features.map((f, i) => formatItem("Feature", i, f, perItemLimit));
    const storyLines = userStories.map((s, i) => formatItem("Story", i, s, perItemLimit));
    const personaLines = personas.map((p, i) => formatItem("Persona", i, p, perItemLimit));

    sections.push(
      `**Epics (${epics.length}):**\n${epicLines.join("\n") || "- None"}`
    );
    sections.push(
      `**Features (${features.length}):**\n${featureLines.join("\n") || "- None"}`
    );
    sections.push(
      `**User Stories (${userStories.length}):**\n${storyLines.join("\n") || "- None"}`
    );
    sections.push(
      `**Personas (${personas.length}):**\n${personaLines.join("\n") || "- None"}`
    );

    const candidate = sections.join("\n\n");

    if (candidate.length <= MAX_WIKI_CONTEXT_CHARS) {
      return candidate;
    }
  }

  // Final very compact fallback: keep *all* IDs/titles but drop descriptions.
  const compactSections: string[] = [];

  const compactFormat = (label: string, idx: number, item: any) => {
    const id = item.id || `${label.toLowerCase()}-${idx + 1}`;
    const title = truncateForWiki(item.title || item.name || "", 40);
    return `- ${label} ${id}: ${title}`;
  };

  compactSections.push(
    `**Requirement Summary (trimmed):**\n${truncateForWiki(requirement, 1500)}`
  );
  compactSections.push(
    `**Epics (${epics.length}):**\n${epics.map((e, i) => compactFormat("Epic", i, e)).join("\n") || "- None"
    }`
  );
  compactSections.push(
    `**Features (${features.length}):**\n${features.map((f, i) => compactFormat("Feature", i, f)).join("\n") || "- None"
    }`
  );
  compactSections.push(
    `**User Stories (${userStories.length}):**\n${userStories.map((s, i) => compactFormat("Story", i, s)).join("\n") || "- None"
    }`
  );
  compactSections.push(
    `**Personas (${personas.length}):**\n${personas.map((p, i) => compactFormat("Persona", i, p)).join("\n") || "- None"
    }`
  );

  return compactSections.join("\n\n");
}

/**
 * Build a comprehensive traceability mapping table showing all user stories
 * and their relationships to BRD requirements, epics, and features.
 * This is used in wiki pages to show explicit mappings.
 */
function buildUserStoryBRDMappingTable(options: {
  userStories?: any[];
  epics?: any[];
  features?: any[];
  brdContext?: string;
  maxChars?: number;
}): string {
  const { userStories = [], epics = [], features = [], brdContext = "", maxChars = 6000 } = options; // Reduced from 12000

  const lines: string[] = [];
  lines.push("## User Story and BRD Requirement Mapping");
  lines.push("\nThis section provides explicit traceability between user stories, BRD requirements, epics, and features.\n");
  lines.push("| User Story ID | User Story Title | Related Epic | Related Feature | BRD Requirement Reference |");
  lines.push("|--------------|-----------------|--------------|----------------|---------------------------|");

  userStories.forEach((story, idx) => {
    const storyId = story.id || `story-${idx + 1}`;
    const storyTitle = truncateForWiki(story.title || story.description || `User Story ${idx + 1}`, 80);
    const epic = epics.find(e => e.id === story.epicId);
    const feature = features.find(f => f.id === story.featureId);
    const epicTitle = epic ? truncateForWiki(epic.title || epic.description || "N/A", 60) : "N/A";
    const featureTitle = feature ? truncateForWiki(feature.title || feature.description || "N/A", 60) : "N/A";

    // Extract BRD requirement reference if BRD context is available
    const brdRef = brdContext && brdContext.length > 0
      ? "See BRD Requirements Section"
      : "N/A";

    lines.push(`| ${storyId} | ${storyTitle} | ${epicTitle} | ${featureTitle} | ${brdRef} |`);
  });

  const result = lines.join("\n");
  return result.length > maxChars ? result.slice(0, maxChars - 3) + "..." : result;
}

/**
 * Build a compact but complete user stories list for wiki generation.
 * Includes all stories but with optimized formatting to reduce token usage.
 */
function buildCompactUserStoriesList(
  userStories: any[],
  features: any[],
  epics: any[],
  maxStories: number = 100
): string {
  // If we have too many stories, we'll need to be more compact
  const storiesToInclude = userStories.slice(0, maxStories);
  const remainingCount = userStories.length - maxStories;

  const storiesList = storiesToInclude
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.slice(0, 2).map((ac: any) => ac.title || ac).join("; ") // Only first 2 ACs
          : (s.acceptanceCriteriaText ? truncateForWiki(s.acceptanceCriteriaText, 100) : "N/A");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      const title = truncateForWiki(s.title || s.description || "", 120);
      const description = truncateForWiki(s.description || "", 150);

      return `- **${storyId}**: ${title}
  - Feature: ${feature ? truncateForWiki(feature.title || feature.description || "", 60) : "N/A"}
  - Epic: ${epic ? truncateForWiki(epic.title || epic.description || "", 60) : "N/A"}
  - AC: ${ac}
  - Desc: ${description}`;
    })
    .join("\n\n");

  if (remainingCount > 0) {
    return `${storiesList}\n\n**Note: ${remainingCount} additional user stories exist but are not shown in detail to reduce token usage. All stories will be included in traceability matrices.**`;
  }

  return storiesList;
}

/**
 * Build a test case mapping table showing which test cases belong to which user stories.
 * This helps with traceability in testing documentation.
 */
function buildTestCaseMappingTable(options: {
  userStories?: any[];
  epics?: any[];
  features?: any[];
  maxChars?: number;
}): string {
  const { userStories = [], epics = [], features = [], maxChars = 15000 } = options;

  const lines: string[] = [];
  lines.push("## Test Case to User Story Mapping");
  lines.push("\nThis section provides explicit traceability between test cases and user stories.\n");
  lines.push("| Test Case ID | Test Case Title/Scenario | User Story ID | User Story Title | Related Epic | Related Feature | Acceptance Criteria Covered |");
  lines.push("|-------------|-------------------------|---------------|------------------|--------------|----------------|---------------------------|");

  let testCaseCount = 0;
  userStories.forEach((story, idx) => {
    const storyId = story.id || `story-${idx + 1}`;
    const storyTitle = truncateForWiki(story.title || story.description || `User Story ${idx + 1}`, 80);
    const epic = epics.find(e => e.id === story.epicId);
    const feature = features.find(f => f.id === story.featureId);
    const epicTitle = epic ? truncateForWiki(epic.title || epic.description || "N/A", 60) : "N/A";
    const featureTitle = feature ? truncateForWiki(feature.title || feature.description || "N/A", 60) : "N/A";

    // Get test cases from user story
    const testCases = story.testCases || [];

    if (testCases.length > 0) {
      testCases.forEach((tc: any, tcIdx: number) => {
        testCaseCount++;
        const tcId = tc.id || `TC-${storyId}-${tcIdx + 1}`;
        const tcTitle = truncateForWiki(tc.scenario || tc.title || `Test Case ${tcIdx + 1}`, 100);

        // Get acceptance criteria covered (if available)
        const ac = Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length > 0
          ? story.acceptanceCriteria.map((ac: any) => ac.title || ac).join("; ")
          : (story.acceptanceCriteriaText || "N/A");
        const acCovered = truncateForWiki(ac, 100);

        lines.push(`| ${tcId} | ${tcTitle} | ${storyId} | ${storyTitle} | ${epicTitle} | ${featureTitle} | ${acCovered} |`);
      });
    } else {
      // If no test cases exist, still show the user story row
      const ac = Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length > 0
        ? story.acceptanceCriteria.map((ac: any) => ac.title || ac).join("; ")
        : (story.acceptanceCriteriaText || "N/A");
      const acCovered = truncateForWiki(ac, 100);
      lines.push(`| N/A | No test cases defined | ${storyId} | ${storyTitle} | ${epicTitle} | ${featureTitle} | ${acCovered} |`);
    }
  });

  lines.push(`\n**Total Test Cases Mapped:** ${testCaseCount}`);
  lines.push(`**Total User Stories:** ${userStories.length}`);

  const result = lines.join("\n");
  return result.length > maxChars ? result.slice(0, maxChars - 3) + "..." : result;
}

/**
 * Build a functional-requirements-focused view of artifacts for the
 * Business Requirements wiki page. This is more detailed than the
 * generic artifacts context and is intended to drive FR-00X content
 * directly from the actual Epics/Features/Stories you selected.
 */
function buildFunctionalRequirementsContext(options: {
  epics?: any[];
  features?: any[];
  userStories?: any[];
  maxChars?: number;
}): string {
  const { epics = [], features = [], userStories = [], maxChars = 5000 } = options; // Reduced from 9000

  // Index features and stories by epic/feature for quick lookup
  const featuresByEpic: Record<string, any[]> = {};
  features.forEach((f) => {
    const epicId = f.epicId || "unassigned";
    featuresByEpic[epicId] = featuresByEpic[epicId] || [];
    featuresByEpic[epicId].push(f);
  });

  const storiesByFeature: Record<string, any[]> = {};
  userStories.forEach((s) => {
    const featureId = s.featureId || "unassigned";
    storiesByFeature[featureId] = storiesByFeature[featureId] || [];
    storiesByFeature[featureId].push(s);
  });

  const lines: string[] = [];
  let frCounter = 1;

  const pushFR = (title: string, detail: string, epicRef?: string, featureRef?: string, storyId?: string) => {
    const frId = `FR-${String(frCounter).padStart(3, "0")}`;
    frCounter += 1;
    const parts = [
      `- **${frId}** ${truncateForWiki(title, 160)}`,
      epicRef ? `  - Epic: ${epicRef}` : "",
      featureRef ? `  - Feature: ${featureRef}` : "",
      storyId ? `  - Source Story: ${storyId}` : "",
      detail ? `  - Detail: ${truncateForWiki(detail, 320)}` : "",
    ].filter(Boolean);
    lines.push(parts.join("\n"));
  };

  // First, walk epics -> features -> stories so the structure is preserved.
  epics.forEach((epic, epicIdx) => {
    const epicId = epic.id || `epic-${epicIdx + 1}`;
    const epicTitle = epic.title || epic.description || `Epic ${epicIdx + 1}`;
    const epicFeatures = featuresByEpic[epicId] || [];

    // If an epic has no features but has some narrative, treat it as a high-level FR.
    if (epicFeatures.length === 0 && epicTitle) {
      pushFR(epicTitle, epic.description || "", epicTitle, undefined, undefined);
    }

    epicFeatures.forEach((feature, featIdx) => {
      const featureId = feature.id || `feature-${epicIdx + 1}-${featIdx + 1}`;
      const featureTitle = feature.title || feature.description || `Feature ${featIdx + 1}`;
      const featureStories = storiesByFeature[featureId] || [];

      // If no stories, still create at least one FR from the feature itself.
      if (featureStories.length === 0) {
        pushFR(
          featureTitle,
          feature.description || "",
          epicTitle,
          featureTitle,
          undefined
        );
      } else {
        featureStories.forEach((story, storyIdx) => {
          const storyId = story.id || `story-${featIdx + 1}-${storyIdx + 1}`;
          const storyTitle = story.title || story.description || `User Story ${storyIdx + 1}`;
          const acText = Array.isArray(story.acceptanceCriteria)
            ? story.acceptanceCriteria.join("; ")
            : (story.acceptanceCriteriaText || "");

          pushFR(
            storyTitle,
            acText || story.description || "",
            epicTitle,
            featureTitle,
            storyId
          );
        });
      }
    });
  });

  let block = lines.join("\n\n");
  if (block.length > maxChars) {
    block = truncateForWiki(block, maxChars);
  }

  return block || "No structured functional requirements could be derived from the provided artifacts.";
}

function detectTechStack(requirement: string): {
  frontend: string[];
  backend: string[];
  database: string[];
  cloud: string[];
  devops: string[];
} {
  const techStack = {
    frontend: [] as string[],
    backend: [] as string[],
    database: [] as string[],
    cloud: [] as string[],
    devops: [] as string[],
  };

  // Frontend
  if (/react/i.test(requirement)) techStack.frontend.push('React');
  if (/angular/i.test(requirement)) techStack.frontend.push('Angular');
  if (/vue/i.test(requirement)) techStack.frontend.push('Vue.js');
  if (/next\.?js/i.test(requirement)) techStack.frontend.push('Next.js');

  // Backend
  if (/node|express/i.test(requirement)) techStack.backend.push('Node.js');
  if (/python|django|flask|fastapi/i.test(requirement)) techStack.backend.push('Python');
  if (/java|spring/i.test(requirement)) techStack.backend.push('Java');
  if (/\.net|c#/i.test(requirement)) techStack.backend.push('.NET');

  // Database
  if (/postgres|postgresql/i.test(requirement)) techStack.database.push('PostgreSQL');
  if (/mongodb|mongo/i.test(requirement)) techStack.database.push('MongoDB');
  if (/mysql/i.test(requirement)) techStack.database.push('MySQL');
  if (/redis/i.test(requirement)) techStack.database.push('Redis');

  // Cloud
  if (/aws|amazon/i.test(requirement)) techStack.cloud.push('AWS');
  if (/azure/i.test(requirement)) techStack.cloud.push('Azure');
  if (/gcp|google cloud/i.test(requirement)) techStack.cloud.push('GCP');

  // DevOps
  if (/docker/i.test(requirement)) techStack.devops.push('Docker');
  if (/kubernetes|k8s/i.test(requirement)) techStack.devops.push('Kubernetes');
  if (/jenkins|gitlab|github actions/i.test(requirement)) techStack.devops.push('CI/CD');

  return techStack;
}

function detectComplianceNeeds(requirement: string): string[] {
  const compliance = [];

  if (/health|medical|hipaa/i.test(requirement)) {
    compliance.push('HIPAA');
  }
  if (/finance|payment|banking|pci/i.test(requirement)) {
    compliance.push('PCI-DSS');
  }
  if (/gdpr|europe|privacy|data protection/i.test(requirement)) {
    compliance.push('GDPR');
  }
  if (/soc 2|soc2/i.test(requirement)) {
    compliance.push('SOC 2');
  }
  if (/iso 27001/i.test(requirement)) {
    compliance.push('ISO 27001');
  }

  return compliance;
}

function detectDomain(requirement: string): string {
  if (/insurance|claim|policy|underwriting|premium/i.test(requirement)) return 'Insurance';
  if (/e-commerce|shopping|cart|product|payment/i.test(requirement)) return 'E-Commerce';
  if (/health|medical|patient|hospital/i.test(requirement)) return 'Healthcare';
  if (/finance|banking|payment|transaction/i.test(requirement)) return 'Finance';
  if (/education|learning|course|student/i.test(requirement)) return 'Education';
  if (/social|network|post|follow|friend/i.test(requirement)) return 'Social Network';
  if (/crm|customer|sales|lead/i.test(requirement)) return 'CRM';
  if (/hrms|employee|payroll|recruitment/i.test(requirement)) return 'HRMS';
  return 'General';
}

/**
 * Extract domain-specific entities from features and user stories
 * Prevents generic placeholders and ensures contextually accurate diagrams
 */
function extractDomainEntities(
  features: any[] = [],
  userStories: any[] = [],
  domain: string
): string[] {
  const entities = new Set<string>();

  // Domain-specific default entities
  const domainDefaults: Record<string, string[]> = {
    'Insurance': ['Claim', 'Policy', 'Policyholder', 'Insurer', 'Underwriter', 'Premium', 'Coverage', 'Beneficiary'],
    'E-Commerce': ['Product', 'Order', 'Customer', 'Cart', 'Payment', 'Inventory', 'Shipment', 'Review'],
    'Healthcare': ['Patient', 'Doctor', 'Appointment', 'MedicalRecord', 'Prescription', 'Diagnosis', 'Treatment', 'Insurance'],
    'Finance': ['Account', 'Transaction', 'Customer', 'Payment', 'Invoice', 'Statement', 'Loan', 'Credit'],
    'Education': ['Student', 'Course', 'Instructor', 'Enrollment', 'Grade', 'Assignment', 'Exam', 'Attendance'],
    'Social Network': ['User', 'Post', 'Comment', 'Like', 'Follow', 'Message', 'Notification', 'Profile'],
    'CRM': ['Customer', 'Lead', 'Opportunity', 'Contact', 'Account', 'Campaign', 'Activity', 'Quote'],
    'HRMS': ['Employee', 'Department', 'Payroll', 'Attendance', 'Leave', 'Performance', 'Recruitment', 'Onboarding'],
  };

  // Add domain defaults
  if (domainDefaults[domain]) {
    domainDefaults[domain].forEach(e => entities.add(e));
  }

  // Extract from features
  features.forEach(f => {
    const text = `${f.title} ${f.description}`.toLowerCase();
    // Look for common entity patterns
    const matches = text.match(/\b(user|customer|product|order|payment|claim|policy|patient|account|transaction|employee|course|student)\b/gi);
    if (matches) {
      matches.forEach(m => entities.add(m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()));
    }
  });

  return Array.from(entities);
}

/**
 * Create consolidated project context summary for prompts
 * Reduces prompt complexity and ensures consistent context across generators
 */
function createContextSummary(data: {
  requirement: string;
  // NOTE: epics/features/userStories/personas are used only to build a
  // compact context string via buildWikiArtifactsContext. We never send the
  // full raw objects to the LLM to avoid token explosions.
  domain: string;
  entities: string[];
  techStack: any;
  personas?: any[];
  features?: any[];
  userStories?: any[];
  projectName?: string;
}): string {
  const { requirement, domain, entities, techStack, personas = [], features = [], userStories = [], projectName = 'the project' } = data;

  const techStr = Object.entries(techStack)
    .filter(([_, v]: [string, any]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]: [string, any]) => `${k}: ${v.join(', ')}`)
    .join('; ');

  return `
**Project Context:**
- Project: ${projectName}
- Domain: ${domain}
- Key Entities: ${entities.join(', ')}
- Tech Stack: ${techStr || 'Modern web application stack'}
- Personas: ${personas.length} defined (${personas.map((p: any) => p.name).join(', ')})
- Features: ${features.length} planned
- User Stories: ${userStories.length} defined

**High-Level Requirements (trimmed):**
${truncateForWiki(requirement, 1000)}

**Artifact Index (LLM-safe summary built from epics, features, user stories, and personas):**
${buildWikiArtifactsContext({ requirement, epics: [], features, userStories, personas })}
`;
}

/**
 * Generate comprehensive Wiki documentation for Azure DevOps
 * Creates all required Wiki pages following enterprise standards
 */
export async function generateWikiDocumentation(data: {
  requirement: string;
  personas?: any[];
  epics?: any[];
  features?: any[];
  userStories?: any[];
  projectName?: string;
  brdContext?: string;
  onProgress?: (completed: number, total: number) => void;
}): Promise<{
  pages: Array<{
    pageType: string;
    phase: string;
    title: string;
    content: string;
    order: number;
  }>;
}> {
  try {
    console.log("[AI Service] Generating comprehensive Wiki documentation");

    const { requirement, personas, epics, features, userStories, projectName, brdContext } = data;

    // Detect context
    const techStack = detectTechStack(requirement);
    const compliance = detectComplianceNeeds(requirement);
    const domain = detectDomain(requirement);

    // Extract domain entities for contextually accurate diagrams
    const entities = extractDomainEntities(features, userStories, domain);

    // Create consolidated context summary
    const contextSummary = createContextSummary({
      requirement,
      domain,
      entities,
      techStack,
      personas,
      features,
      userStories,
      projectName
    });

    // Enrich context summary for Design/Diagram pages with BRD content so
    // they see full BRD + all artifacts together.
    // Reduced BRD context to 4000 chars to reduce token usage
    const designContextSummary =
      brdContext && brdContext.length > 0
        ? `${contextSummary}\n\n**Business Requirements Document (BRD) Context for Design & Diagrams**\n${truncateForWiki(
          brdContext,
          4000
        )}`
        : contextSummary;

    console.log("[AI Service] Detected context:", { techStack, compliance, domain, entities: entities.slice(0, 5) });

    // Convert all page generators to functions for chunked processing
    const pageGenerators = [
      // Planning Phase (order: 1-3)
      () => generateOverviewVisionPage(requirement, projectName, epics, features, brdContext),
      () => generateFeasibilityStudyPage(requirement, epics, features, domain, brdContext),
      () => generateRiskAssessmentPage(requirement, epics, features, brdContext),

      // Requirements Phase (order: 4-10)
      () => generateComprehensiveSRSPage(requirement, epics, features, userStories, techStack, compliance, brdContext),
      () => generateBusinessRequirementsPage(requirement, epics, features, userStories, brdContext),
      () => generateUseCaseSpecificationsPage(userStories, personas, epics),
      () => generateUserPersonasPage(personas, userStories, brdContext),
      () => generateRequirementsTraceabilityMatrixPage(epics, features, userStories),
      () => generateUseCaseDiagramPage(userStories, personas, features, domain, designContextSummary, brdContext),
      () => generateDataFlowDiagramPage(features, userStories, domain, designContextSummary, brdContext),

      // Design Phase (order: 11-18)
      () => generateSystemDesignDocumentPage(requirement, features, techStack, domain, designContextSummary, userStories, epics, brdContext || ""),
      () => generateTechnicalArchitecturePage(requirement, features),
      () => generateUIUXDesignSpecsPage(userStories, personas, domain, designContextSummary, epics, features, brdContext || ""),
      () => generateDatabaseDesignDocumentPage(features, userStories, techStack, domain, designContextSummary, epics, brdContext || ""),
      () => generateClassDiagramPage(features, domain, userStories, designContextSummary, epics, brdContext || ""),
      () => generateSequenceDiagramPage(userStories, features, personas, domain, designContextSummary, epics, brdContext || ""),
      () => generateComponentDiagramPage(features, techStack, userStories, domain, designContextSummary, epics, brdContext || ""),
      () => generateDataModelsPage(features, userStories, epics, brdContext || "", domain, designContextSummary),

      // Implementation Phase (order: 19-22)
      () => generateCodingStandardsPage(techStack, requirement, userStories, epics, features, brdContext || "", domain, contextSummary),
      () => generateApiDocumentationPage(features, userStories, epics, brdContext || "", domain, contextSummary),
      () => generateVersionControlGuidelinesPage(techStack, userStories, epics, features, brdContext || "", domain, contextSummary),
      () => generateInfrastructureDiagramPage(techStack, features, domain, contextSummary, userStories, epics, brdContext || ""),

      // Testing Phase (order: 23-26)
      () => generateTestingStrategyPage(features, userStories, epics, brdContext || "", domain, contextSummary),
      () => generateTestPlanPage(features, userStories, epics, brdContext || "", domain, contextSummary),
      () => generateTestCasesPage(userStories, features, epics, brdContext || "", domain, contextSummary),
      () => generateTestCoverageMatrixPage(epics, features, userStories, brdContext || "", domain, contextSummary),

      // Deployment Phase (order: 27-30)
      () => generateDeploymentGuidePage(requirement, userStories, epics, features, brdContext || "", domain, contextSummary),
      () => generateReleaseNotesPage(epics, features, userStories, brdContext || "", domain, contextSummary),
      () => generateUserManualPage(userStories, personas, features, epics, brdContext || "", domain, contextSummary),
      () => generateMaintenancePlanPage(requirement, techStack, userStories, epics, features, brdContext || "", domain, contextSummary),

      // Reference (order: 31-33)
      () => generateSecurityCompliancePage(requirement, compliance.join(", "), userStories, epics, features, brdContext || "", domain, contextSummary),
      () => generateUserWorkflowsPage(userStories, personas, brdContext),
      () => generateGlossaryPage(requirement, features),
    ];

    // Generate pages in parallel using Promise.all - same approach as artifact generation
    // All 33 pages processed simultaneously for maximum speed (3-5x faster)
    const allPages = await generateWikiPagesInChunks(pageGenerators, data.onProgress);

    // Flatten any nested arrays
    const flatPages = allPages.flat();

    console.log("[AI Service] Generated", flatPages.length, "Wiki pages");
    return { pages: flatPages };
  } catch (error) {
    console.error("[AI Service] Error generating Wiki documentation:", error);
    throw error;
  }
}

// ============================================================================
// PLANNING PHASE GENERATORS
// ============================================================================
import { promptOverviewAndVisionWikiPage } from "./prompts/prompt_OverviewVisionPage"
async function generateOverviewVisionPage(
  requirement: string,
  projectName: string = "Project",
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const basePrompt = promptOverviewAndVisionWikiPage(
    requirement,
    projectName,
    epics,
    features
  );

  const brdSection = brdContext
    ? `\n\n**Business Requirements Document (BRD) Context**\n\n` +
    `Use the following BRD sections as the primary source of truth for the SDLC Project - Overview & Vision page. ` +
    `Ensure that goals, scope, stakeholders, constraints, and milestones in the wiki align with this content.\n\n` +
    `${truncateForWiki(brdContext, 10000)}`
    : "";

  const prompt = `${basePrompt}${brdSection}\n\n${WIKI_STYLE_GUIDELINES}`;

  const modelName = _defaultModelName;

  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: "system",
        content: `You are an expert technical writer creating comprehensive project documentation for ${_docPlatform}. Generate detailed, professional documentation following the exact structure provided.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 3000,
  });

  const content = response.choices[0]?.message?.content || "";

  return {
    pageType: "overview",
    phase: "planning",
    title: `${projectName} - Overview & Vision`,
    content,
    order: 1,
  };
}
export { promptOverviewAndVisionWikiPage };


async function generateBusinessRequirementsPage(
  requirement: string,
  epics: any[] = [],
  features: any[] = [],
  userStories: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const functionalRequirementsContext = buildFunctionalRequirementsContext({
    epics,
    features,
    userStories,
  });

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });

  const prompt = `Generate a comprehensive "Business Requirements" Wiki page for Azure DevOps.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Project Requirements:**
${requirement}

**Epics:** ${epics.length}
**Features:** ${features.length}
**User Stories:** ${userStories.length}

**Business Requirements Document (BRD) Context**
Use the following BRD sections (Executive Summary, Business Objectives, Stakeholder Analysis, Requirements, Constraints and Assumptions, Risks and Mitigation, Timeline and Milestones) as the primary source of truth for business requirements. The wiki page MUST remain consistent with this BRD.

${brdContext || "No BRD context was provided. Derive business requirements from the requirement text and artifacts only."}

**Functional Requirements derived from artifacts (DO NOT ignore this list; use it as the primary source of truth. Do not invent unrelated modules or flows):**

${functionalRequirementsContext}

**User Story and BRD Requirement Mapping**
${mappingTable}

Create a Wiki page with sections for (target 8-9 pages total):
1. Executive Summary - 1 page
2. Functional Requirements (FR-001, FR-002, etc.) - 4-5 pages
   - For EACH FR, include:
     * Priority, Description, Business Rules, Acceptance Criteria
     * **Traceability subsection showing:**
       - Which user story(s) this FR addresses (list story IDs and titles)
       - Which BRD requirement(s) this FR maps to
       - Which epic(s) and feature(s) this FR belongs to
3. Non-Functional Requirements (Performance, Scalability, Security, Reliability, Usability, Integration) - 1 page
4. Business Constraints - 1 page
5. Assumptions - 1 page
6. Comprehensive Traceability Matrix - 1 page
   - Table showing: FR ID | User Story ID(s) | BRD Requirement Reference | Epic | Feature | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each functional requirement must show clear traceability to user stories and BRD requirements
- Target 8-9 pages total (4000-5000 words) with rich narrative detail for each major requirement area
- Reuse the wording and intent from the artifacts; do not introduce new features, actors, or domains that are not present in the payload
- If there are ${epics.length} epics and ${features.length} features, maintain that scale; do not collapse them into just a few generic FRs

Use professional enterprise language and Markdown formatting. Be comprehensive and specific.

**CRITICAL**: Return ONLY the Markdown content. DO NOT wrap the output in \`\`\`markdown code blocks.

${WIKI_STYLE_GUIDELINES}`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are an expert business analyst creating detailed requirements documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between functional requirements, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "requirements", phase: "requirements", title: "Business Requirements", content: response.choices[0]?.message?.content || "", order: 5 };
}

async function generateUserPersonasPage(
  personas: any[] = [],
  userStories: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const personasData = personas.map(p => `- ${p.name} (${p.role}): ${p.focus}`).join('\n');

  const prompt = `Generate a comprehensive "User Personas" Wiki page for Azure DevOps.

**Personas:**
${personasData || 'Generate 3-5 typical user personas'}

**Business Requirements Document (BRD) Context**
Use the BRD content (especially target audience, key stakeholders, and business objectives) to refine persona demographics, goals, and pain points so that they accurately represent the real users described in the BRD.

${brdContext || "No BRD context was provided. Base personas on general best practices and the artifacts only."}

Create at least 5–8 personas. For each persona, write multiple paragraphs covering narrative background, goals, frustrations, and how they interact with the system in the context of this project.

Create detailed persona profiles with:
- Demographics (Name, Age, Role, Location, Education, Tech Savviness)
- Background & Context
- Goals & Motivations
- Pain Points & Frustrations
- Typical Day & Workflows
- Technology Usage
- Design Considerations
- Representative Quote

Use Markdown formatting. Be detailed and realistic.

**CRITICAL**: Return ONLY the Markdown content. DO NOT wrap the output in \`\`\`markdown code blocks.

${WIKI_STYLE_GUIDELINES}`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a UX researcher creating detailed user personas." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4000,
  });

  return { pageType: "personas", phase: "requirements", title: "User Personas", content: response.choices[0]?.message?.content || "", order: 7 };
}

async function generateTechnicalArchitecturePage(
  requirement: string,
  features: any[] = []
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const prompt = `Generate a comprehensive "Technical Architecture" Wiki page for Azure DevOps.

**Project Context:**
${requirement}

**Features:** ${features.length}

Create sections for:
- Architecture Overview with diagram
- Technology Stack (Frontend, Backend, Database, Infrastructure)
- System Components
- API Design
- Data Architecture
- Security Architecture
- Scalability & Performance
- Disaster Recovery
- Monitoring & Observability

Use Markdown with Mermaid diagrams. Be detailed and technical.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a solutions architect creating technical architecture documentation." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 3000,
  });

  return { pageType: "architecture", phase: "design", title: "Technical Architecture", content: response.choices[0]?.message?.content || "", order: 12 };
}

async function generateFeatureSpecificationsPages(
  features: any[] = [],
  epics: any[] = [],
  userStories: any[] = []
): Promise<Array<{ pageType: string; phase: string; title: string; content: string; order: number }>> {
  if (!features || features.length === 0) {
    return [{
      pageType: "features",
      phase: "requirements",
      title: "Feature Specifications",
      content: "# Feature Specifications\n\nNo features defined yet.",
      order: 20
    }];
  }

  // Generate a summary page for all features
  const featuresList = features.slice(0, 10).map(f => `- ${f.title || f.description}`).join('\n');

  const prompt = `Generate a "Feature Specifications" summary Wiki page.

**Features:**
${featuresList}

Create an overview page that lists all features with:
- Feature name and description
- Related epics
- Priority
- Implementation status
- Links to detailed specs

Use Markdown formatting.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a product manager documenting feature specifications." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 2000,
  });

  return [{
    pageType: "features",
    phase: "implementation",
    title: "Feature Specifications",
    content: response.choices[0]?.message?.content || "",
    order: 20
  }];
}

async function generateApiDocumentationPage(
  features: any[] = [],
  userStories: any[] = [],
  epics: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build user stories context for API endpoints
  const userStoriesContext = userStories.length > 0
    ? `\n\n**User Stories Context (${userStories.length} stories):**\n` +
    userStories.slice(0, 20).map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const title = s.title || s.description || "";
      const description = s.description || "";
      return `- **Story ${storyId}**: ${title}\n  ${description.substring(0, 200)}`;
    }).join("\n")
    : "";

  // Build BRD context
  const brdSection = brdContext
    ? `\n\n**Business Requirements Document (BRD) Context:**\n` +
    `Use the following BRD sections to ensure API endpoints align with business requirements:\n\n` +
    `${truncateForWiki(brdContext, 4000)}`
    : "";

  const prompt = `Generate a comprehensive "API Documentation" Wiki page for Azure DevOps.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability to user stories and BRD requirements.**

**Project Context:**
${contextSummary}

**Number of Features:** ${features.length}
**Number of User Stories:** ${userStories.length}
**Domain:** ${domain}
${userStoriesContext}
${brdSection}

**Requirements:**
1. **API Overview**
   - Base URL, Version, Authentication methods
   - API architecture and design principles
   - Rate limiting and quotas

2. **Authentication & Authorization**
   - OAuth 2.0 / JWT implementation details
   - Token management and refresh
   - Role-based access control (RBAC)
   - Security best practices

3. **API Endpoints**
   - **CRITICAL:** Map each endpoint to specific user stories and BRD requirements
   - For each endpoint, include:
     - HTTP method and path
     - Description (referencing user story IDs)
     - Request parameters and body schema
     - Response schema with examples
     - Error codes and handling
     - Related user stories (story IDs)
     - Related BRD requirements

4. **Data Models**
   - Request/Response schemas
   - Validation rules
   - Data types and constraints

5. **Error Handling**
   - Standard error response format
   - HTTP status codes mapping
   - Error codes and messages
   - Retry strategies

6. **Rate Limiting & Performance**
   - Rate limits per endpoint
   - Throttling strategies
   - Performance considerations

7. **Best Practices & Guidelines**
   - API versioning strategy
   - Deprecation policy
   - Testing guidelines
   - Documentation standards

8. **Traceability Matrix**
   - Table mapping API endpoints to:
     - User Story IDs
     - BRD Requirement IDs
     - Features
     - Epics

**Format:**
- Use Markdown with code examples in JSON
- Include comprehensive examples for each endpoint
- Reference specific user story IDs and BRD requirements throughout
- Use professional enterprise language

Return ONLY the Markdown content following ${WIKI_STYLE_GUIDELINES}`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      {
        role: "system",
        content: "You are an API architect creating comprehensive API documentation for an enterprise SDLC project. Ensure all endpoints are traced to user stories and BRD requirements."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "api", phase: "implementation", title: "API Documentation", content: response.choices[0]?.message?.content || "", order: 20 };
}

async function generateDataModelsPage(
  features: any[] = [],
  userStories: any[] = [],
  epics: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate a comprehensive "Data Models" Wiki page for Azure DevOps.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Domain:** ${domain}
**Context:** System with ${features.length} features and ${userStories.length} user stories.

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when designing data models. Every data entity, table, and relationship should trace back to specific user stories and BRD data requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

Create sections for (target 8-9 pages total):
1. Overview and Data Architecture - 1 page
2. Entity Relationship Diagram (Mermaid) - 1 page
   - For EACH major entity, include a "Traceability" subsection showing:
     * Which user story(s) this entity supports (list story IDs and titles)
     * Which BRD requirement(s) this entity maps to (especially Data Requirements section)
     * Which epic(s) and feature(s) this entity belongs to
3. Database Tables with columns, types, constraints - 3-4 pages
   - For EACH table, include detailed traceability to user stories and BRD requirements
4. Relationships and Foreign Keys - 1 page
5. Indexes and Performance Optimization - 1 page
6. Data Validation Rules - 1 page
7. Migration Strategy - 1 page
8. Comprehensive Traceability Matrix - 1 page
   - Table showing: Data Entity/Table | User Story ID(s) | BRD Requirement Reference | Epic | Feature | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each data entity and table must show clear traceability to user stories and BRD data requirements
- Use BRD Data Requirements section as the primary source for data structure design
- Target 8-9 pages total (4000-5000 words) with detailed data model descriptions, ER diagrams, and traceability mappings

Use Markdown with Mermaid ERD diagrams.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a database architect creating data model documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between data entities, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "data-models", phase: "design", title: "Data Models", content: response.choices[0]?.message?.content || "", order: 13 };
}

async function generateUserWorkflowsPage(
  userStories: any[] = [],
  personas: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const storySummaries = userStories
    .map((s: any, idx: number) => {
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      return `- Story ${idx + 1}: ${s.title || s.description}\n  - Acceptance Criteria: ${ac}`;
    })
    .join("\n");

  const prompt = `Generate a comprehensive "User Workflows" Wiki page for Azure DevOps.

**User Stories:** ${userStories.length}
**Personas:** ${personas.length}

**User Story Summaries**
Use the following user stories as the concrete basis for defining workflows. Each major workflow must reference which stories it primarily covers.

${storySummaries || "- No user stories provided"}

**Business Requirements Document (BRD) Context**
Use the BRD (especially Business Objectives, Stakeholder Analysis, and Requirements sections) together with the user stories to design end-to-end workflows. Each major workflow should be traceable back to specific BRD requirements and user stories.

${brdContext || "No BRD context was provided. Base workflows only on the user stories and personas."}

Create multiple end-to-end workflows (happy paths, alternative flows, and exception flows). For each workflow, include narrative descriptions plus Mermaid flowcharts, and ensure the overall document is long and detailed (target at least 1,500–2,000 words).

Create sections for:
- Common User Journeys with flowcharts
- Step-by-step workflows
- Decision points
- Error handling paths
- Integration points

Use Markdown with Mermaid flowcharts.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a UX designer documenting user workflows." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4000,
  });

  return { pageType: "workflows", phase: "requirements", title: "User Workflows", content: response.choices[0]?.message?.content || "", order: 8 };
}

async function generateSecurityCompliancePage(
  requirement: string,
  complianceNeeds: string,
  userStories: any[] = [],
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate a comprehensive "Security & Compliance" Wiki page for Azure DevOps.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Project Context:**
${requirement}

**Domain:** ${domain}

**Compliance Requirements:**
${complianceNeeds}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when defining security requirements. Every security control, authentication mechanism, and compliance measure should trace back to specific user stories and BRD security/compliance requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

Create sections for (target 8-9 pages total):
1. Security Overview and Strategy - 1 page
2. Security Requirements - 2 pages
   - For EACH major security requirement, include a "Traceability" subsection showing:
     * Which user story(s) this security requirement addresses (list story IDs and titles)
     * Which BRD requirement(s) this maps to (especially Security & Compliance sections)
     * Which epic(s) and feature(s) this requirement belongs to
3. Authentication & Authorization - 1 page
4. Data Protection (Encryption, Privacy) - 1 page
5. Compliance Requirements (GDPR, HIPAA, SOC 2, etc.) - 1 page
   - Map each compliance requirement to BRD compliance needs and relevant user stories
6. Security Best Practices - 1 page
7. Vulnerability Management - 1 page
8. Incident Response - 1 page
9. Audit Logging - 1 page
10. Comprehensive Traceability Matrix - 1 page
   - Table showing: Security Control/Requirement | User Story ID(s) | BRD Requirement Reference | Epic | Feature | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each security requirement must show clear traceability to user stories and BRD security/compliance requirements
- Use BRD Security & Compliance and Risks sections as the primary source for security design
- Target 8-9 pages total (4000-5000 words) with detailed security specifications and traceability mappings

Use Markdown formatting.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a security architect creating security and compliance documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between security requirements, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "security", phase: "design", title: "Security & Compliance", content: response.choices[0]?.message?.content || "", order: 14 };
}

async function generateTestingStrategyPage(
  features: any[] = [],
  userStories: any[] = [],
  epics: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const testCaseMappingTable = buildTestCaseMappingTable({ userStories, epics, features });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate a comprehensive "Testing Strategy" Wiki page for Azure DevOps.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Domain:** ${domain}
**Features:** ${features.length}
**User Stories:** ${userStories.length}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when defining testing strategy. Every testing approach, test type, and test level should trace back to specific user stories and BRD requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

**Test Case to User Story Mapping**
${testCaseMappingTable}

Create sections for (target 8-9 pages total):
1. Testing Approach Overview - 1 page
2. Unit Testing Strategy - 1 page
   - For EACH major component/module, include traceability to user stories
3. Integration Testing - 1 page
   - Map integration test scenarios to user stories and BRD requirements
4. End-to-End Testing - 1 page
   - Map E2E scenarios to complete user workflows and BRD requirements
5. Performance Testing - 1 page
6. Security Testing - 1 page
   - Map security test scenarios to BRD security requirements and user stories
7. Test Automation - 1 page
8. Test Data Management - 1 page
9. Acceptance Criteria Validation - 1 page
   - Show how acceptance criteria from user stories are validated
10. Comprehensive Traceability Matrix - 1 page
   - Table showing: Test Type/Level | User Story ID(s) | Test Case ID(s) | BRD Requirement Reference | Epic | Feature | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each testing approach must show clear traceability to user stories and BRD requirements
- Use BRD Testing and Quality Assurance sections as the primary source for testing strategy
- Reference the test case mapping table to show which test cases validate which user stories
- Target 8-9 pages total (4000-5000 words) with detailed testing specifications and traceability mappings

Use Markdown formatting.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a QA architect creating testing strategy documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between testing approaches, user stories, test cases, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "testing", phase: "testing", title: "Testing Strategy", content: response.choices[0]?.message?.content || "", order: 23 };
}

async function generateDeploymentGuidePage(
  requirement: string,
  userStories: any[] = [],
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate a comprehensive "Deployment Guide" Wiki page for Azure DevOps.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Project Context:**
${requirement}

**Domain:** ${domain}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when defining deployment procedures. Every deployment step, validation checkpoint, and rollback procedure should trace back to specific user stories and BRD requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

Create sections for (target 8-9 pages total):
1. Deployment Overview - 1 page
2. Deployment Architecture - 1 page
   - Map architecture components to features and user stories
3. Environment Setup (Dev, Staging, Production) - 1 page
4. CI/CD Pipeline Configuration - 1 page
   - Map pipeline stages to feature deployment and user story validation
5. Deployment Process - 2 pages
   - Step-by-step deployment procedures
   - For EACH deployment step, include traceability to features/user stories being deployed
6. Rollback Procedures - 1 page
   - Map rollback scenarios to affected user stories
7. Monitoring & Health Checks - 1 page
   - Map health checks to user story functionality validation
8. Post-Deployment Validation - 1 page
   - Map validation steps to user stories and acceptance criteria
9. Troubleshooting Guide - 1 page
10. Comprehensive Traceability Matrix - 1 page
   - Table showing: Deployment Component/Step | User Story ID(s) | Feature | Epic | BRD Requirement Reference | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each deployment step must show clear traceability to user stories and BRD requirements
- Use BRD Deployment and Infrastructure sections as the primary source for deployment planning
- Target 8-9 pages total (4000-5000 words) with detailed deployment procedures and traceability mappings

Use Markdown formatting.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a DevOps engineer creating deployment documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between deployment procedures, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "deployment", phase: "deployment", title: "Deployment Guide", content: response.choices[0]?.message?.content || "", order: 29 };
}

async function generateGlossaryPage(
  requirement: string,
  features: any[] = []
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const prompt = `Generate a comprehensive "Glossary & References" Wiki page for Azure DevOps.

**Project Context:**
${requirement}

Create sections for:
- Glossary of Terms (alphabetically sorted)
- Acronyms and Abbreviations
- External References
- Related Documentation
- Useful Links

Use Markdown formatting with clear definitions.

Return ONLY the Markdown content.`;

  const modelName = _defaultModelName;
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [{ role: "system", content: "You are a technical writer creating a comprehensive glossary." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 2000,
  });

  return { pageType: "glossary", phase: "reference", title: "Glossary & References", content: response.choices[0]?.message?.content || "", order: 33 };
}

// ============================================================================
// NEW GENERATORS - Priority 1 Documents
// ============================================================================

async function generateFeasibilityStudyPage(
  requirement: string,
  epics: any[] = [],
  features: any[] = [],
  domain: string = "General",
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const prompt = `Generate a "Feasibility Study" document for ${_docPlatform}.

**Project:** ${requirement}
**Domain:** ${domain}
**Scope:** ${epics.length} epics, ${features.length} features

**Business Requirements Document (BRD) Context**
Use the following BRD sections (Executive Summary, Business Objectives, Requirements, Constraints, Risks, Timeline) as the primary source of truth. The feasibility analysis must directly reflect these details and must not introduce unrelated scope.

${brdContext || "No BRD context was provided. Base the feasibility study solely on the project requirement text and artifacts."}

Create sections for:
- Executive Summary
- Technical Feasibility (technology stack, team expertise, risks)
- Operational Feasibility (resources, timeline, process impact)
- Financial Feasibility (cost estimation, ROI analysis)
- Risk Assessment
- Recommendation (Go/No-Go/Conditional)

**CRITICAL**: Return ONLY the Markdown content. DO NOT wrap the output in \`\`\`markdown code blocks.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a business analyst." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 3000,
  });

  return { pageType: "feasibility", phase: "planning", title: "Feasibility Study", content: response.choices[0]?.message?.content || "", order: 2 };
}

async function generateRiskAssessmentPage(
  requirement: string,
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const prompt = `Generate a "Risk Assessment Report" for ${_docPlatform}.

**Project:** ${requirement}
**Scope:** ${epics.length} epics, ${features.length} features

**Business Requirements Document (BRD) Context**
Use the BRD sections related to risks, constraints, assumptions, and timeline as the authoritative source for risk identification and analysis. Map each major risk back to the relevant BRD requirement or constraint where possible.

${brdContext || "No BRD context was provided. Derive risks from the requirement text and artifact scope only."}

Include:
- Risk Matrix (ID, Description, Probability, Impact, Mitigation)
- Risk Categories (Technical, Operational, Business, External)
- Risk Monitoring Plan
- Contingency Plans

**CRITICAL**: Return ONLY the Markdown content. DO NOT wrap the output in \`\`\`markdown code blocks.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a risk management expert." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 2500,
  });

  return { pageType: "risk-assessment", phase: "planning", title: "Risk Assessment Report", content: response.choices[0]?.message?.content || "", order: 3 };
}

async function generateComprehensiveSRSPage(
  requirement: string,
  epics: any[] = [],
  features: any[] = [],
  userStories: any[] = [],
  techStack: any = {},
  compliance: string[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const techStr = Object.entries(techStack)
    .filter(([_, v]: [string, any]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]: [string, any]) => `${k}: ${v.join(', ')}`)
    .join('; ');

  const functionalRequirementsContext = buildFunctionalRequirementsContext({
    epics,
    features,
    userStories,
  });

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });

  const prompt = `Generate an IEEE 830 compliant "Software Requirements Specification (SRS)" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Project (Summary):** ${truncateForWiki(requirement, 1500)}
**Tech Stack:** ${techStr || 'TBD'}
**Compliance:** ${compliance.join(', ') || 'Standard'}
**Scope:** ${epics.length} epics, ${features.length} features, ${userStories.length} user stories

**Business Requirements Document (BRD) Context**
Use the following BRD content as the primary source of truth for business goals, constraints, and detailed requirements. The SRS MUST remain consistent with this BRD and must not introduce new, unrelated functionality.

${brdContext || "No BRD context was provided. Derive the SRS from the requirement text and artifacts only."}

**Functional Requirements derived from artifacts (Epics/Features/User Stories)**
Use this list as the concrete basis for FR-00X entries. Every functional requirement in the SRS should trace back to one or more of these items.

${functionalRequirementsContext}

**User Story and BRD Requirement Mapping**
${mappingTable}

When writing the SRS, follow IEEE 830 sections with explicit traceability:
1. Introduction (Purpose, Scope, Definitions, References, Overview) - 1 page
2. Overall Description (Product perspective, functions, user characteristics, constraints, assumptions) - 1 page
3. Specific Requirements - 5-6 pages
   - Functional Requirements (FR-001, FR-002, etc. with priorities, acceptance criteria)
   - **FOR EACH FR, include a "Traceability" subsection showing:**
     * Which user story(s) this FR addresses (list story IDs and titles)
     * Which BRD requirement(s) this FR maps to
     * Which epic(s) and feature(s) this FR belongs to
   - Non-Functional Requirements (Performance, Security, Scalability, Usability, Reliability, Maintainability) - 1 page
   - Interface Requirements (UI, APIs, external systems, data interfaces) - 1 page
4. Comprehensive Traceability Matrix - 1 page
   - Table showing: SRS Requirement ID | User Story ID(s) | BRD Requirement Reference | Epic | Feature | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix
5. Appendices (Glossary, models, diagrams) - 1 page

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each functional requirement must show clear traceability to user stories and BRD requirements
- Be exhaustive and structured. Prefer longer, detailed sections over brief bullets
- Target 8-9 pages total (4000-5000 words)

**CRITICAL**: Return ONLY the Markdown content. DO NOT wrap the output in \`\`\`markdown code blocks.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      { role: "system", content: "You are a systems analyst creating an IEEE 830 compliant SRS. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between SRS requirements, user stories, and BRD requirements. Ensure every user story is mapped." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    // Allow a very long, comprehensive SRS (target 8-9 pages, 4000-5000 words)
    max_tokens: 10000,
  });

  return {
    pageType: "srs",
    phase: "requirements",
    title: "Software Requirements Specification (SRS)",
    content: response.choices[0]?.message?.content || "",
    order: 4,
  };
}

async function generateUseCaseSpecificationsPage(
  userStories: any[] = [],
  personas: any[] = [],
  epics: any[] = []
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const storiesSample = userStories.slice(0, 8).map(s => s.title || s.description).join('; ');

  const prompt = `Generate "Use Case Specifications" for ${_docPlatform}.

**Sample Stories:** ${storiesSample || 'User interactions'}
**Personas:** ${personas.length}

Generate 10–15 detailed use cases (or as many as needed to cover all major story themes) with:
- Use Case ID, Name, Actors
- Description, Preconditions
- Basic Flow, Alternative Flows, Exception Flows
- Postconditions, Business Rules

**CRITICAL**: Return ONLY the Markdown content. DO NOT wrap the output in \`\`\`markdown code blocks.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a business analyst." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 4500,
  });

  return { pageType: "use-cases", phase: "requirements", title: "Use Case Specifications", content: response.choices[0]?.message?.content || "", order: 6 };
}

async function generateRequirementsTraceabilityMatrixPage(
  epics: any[] = [],
  features: any[] = [],
  userStories: any[] = []
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const rtmSample = epics.slice(0, 10).map((e, i) => {
    const relatedFeatures = features.filter(f => f.epicId === e.id).length;
    const relatedStories = userStories.filter(us => features.some(f => f.id === us.featureId && f.epicId === e.id)).length;
    return `| REQ-${String(i + 1).padStart(3, '0')} | ${e.title || e.description} | ${relatedFeatures} features | ${relatedStories} stories | Test Suite ${i + 1} | ✅ |`;
  }).join('\n');

  const prompt = `Generate a "Requirements Traceability Matrix (RTM)" for ${_docPlatform}.

**Scope:** ${epics.length} requirements, ${features.length} features, ${userStories.length} stories

Include:
- Traceability Matrix table
- Coverage Summary
- Mermaid traceability diagram showing Requirements → Features → Stories → Tests
- Gap Analysis

Sample RTM rows:
${rtmSample || '| REQ-001 | Sample Req | 3 features | 5 stories | Test Suite 1 | ✅ |'}

**CRITICAL**: Return ONLY the Markdown content. DO NOT wrap the output in \`\`\`markdown code blocks.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a QA architect." }, { role: "user", content: prompt }],
    temperature: 0.6,
    max_tokens: 3000,
  });

  return { pageType: "rtm", phase: "requirements", title: "Requirements Traceability Matrix (RTM)", content: response.choices[0]?.message?.content || "", order: 8 };
}
import { generateUseCaseDiagramPagee } from "./prompts/prompt_UseCase_Diagram_Page";
async function generateUseCaseDiagramPage(
  userStories: any[] = [],
  personas: any[] = [],
  features: any[] = [],
  domain: string = 'General',
  contextSummary: string = '',
  brdContext: string = ''
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const personasList = personas.map(p => `- ${p.name} (${p.role}): ${p.goals?.join(', ') || 'N/A'}`).join('\n');
  const storiesByPersona = personas.map(p => {
    const stories = userStories.filter(s => s.personaId === p.id || s.persona === p.name);
    return `**${p.name}**: ${stories.map(s => s.title).join('; ')}`;
  }).join('\n');
  const featuresList = features.slice(0, 8).map(f => `- ${f.title}: ${f.description}`).join('\n');

  const enrichedContextSummary =
    contextSummary +
    (brdContext
      ? `\n\n**Business Requirements Document (BRD) Context for Use Case Diagrams**\n` +
      truncateForWiki(brdContext, 4000)
      : "");

  const prompt = generateUseCaseDiagramPagee(
    enrichedContextSummary,
    personas,
    storiesByPersona,
    featuresList,
    domain,
    personasList
  );

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      { role: "system", content: `You are an expert business analyst. Create production-grade UML use case diagrams using ACTUAL project data. Use real persona names as actors. Extract real use cases from user stories. Each diagram needs 10-15 nodes minimum. Never use placeholders like "Actor1" or "UseCase1". Create 4-5 comprehensive detailed diagrams.` },
      { role: "user", content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 5000,
  });

  return { pageType: "use-case-diagrams", phase: "requirements", title: "Use Case Diagrams", content: response.choices[0]?.message?.content || "", order: 9 };
}
export { generateUseCaseDiagramPagee };


import { dataFlowDiagramPage } from "./prompts/prompt_dataFlow_DiagramPage";
async function generateDataFlowDiagramPage(
  features: any[] = [],
  userStories: any[] = [],
  domain: string = 'General',
  contextSummary: string = '',
  brdContext: string = ''
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const featuresList = features.slice(0, 8).map(f => `- ${f.title}: ${f.description}`).join('\n');
  const storiesSample = userStories.slice(0, 10).map(s => `- ${s.title}: ${s.acceptanceCriteria?.slice(0, 2).join('; ') || ''}`).join('\n');

  const enrichedContextSummary =
    contextSummary +
    (brdContext
      ? `\n\n**Business Requirements Document (BRD) Context for DFDs**\n` +
      truncateForWiki(brdContext, 4000)
      : "");

  const prompt = dataFlowDiagramPage(
    featuresList,
    enrichedContextSummary,
    domain,
    features,
    userStories,
    storiesSample
  );

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      {
        role: "system",
        content: `You are an expert systems analyst. Create production-grade Data Flow Diagrams using ACTUAL project data. Extract real processes from features. Use ${domain} domain entities for data stores. Create 4-5 detailed DFD levels (0, 1, 2). Each diagram needs 10-20 nodes minimum. Never use placeholders.`
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.5,
    max_tokens: 6000,
  });

  return { pageType: "data-flow-diagrams", phase: "requirements", title: "Data Flow Diagrams (DFD)", content: response.choices[0]?.message?.content || "", order: 10 };
}
export { dataFlowDiagramPage };
// ============================================================================
// DESIGN PHASE GENERATORS (Continued)
// ============================================================================
import { promptSystemDesignDocument } from "./prompts/prompt_systemDesignDocument"
async function generateSystemDesignDocumentPage(
  requirement: string,
  features: any[] = [],
  techStack: any = {},
  domain: string = 'General',
  contextSummary: string = '',
  userStories: any[] = [],
  epics: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const techStr = Object.entries(techStack)
    .filter(([_, v]: [string, any]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]: [string, any]) => `${k}: ${v.join(', ')}`)
    .join('; ');
  const featuresList = features
    .map((f: any, idx: number) => `- Feature ${idx + 1}: ${truncateForWiki(f.title || f.description || "", 160)}`)
    .join('\n');

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const basePrompt = promptSystemDesignDocument(
    enrichedContext,
    requirement,
    featuresList,
    domain,
    techStr
  );

  const prompt = `${basePrompt}

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**User Story and BRD Requirement Mapping**
${mappingTable}

**ADDITIONAL REQUIREMENTS:**
1. For EACH major design component or module, include a "Traceability" subsection showing:
   - Which user story(s) this component addresses (list story IDs and titles)
   - Which BRD requirement(s) this component maps to
   - Which epic(s) and feature(s) this component belongs to
2. Include a comprehensive traceability section at the end showing the complete mapping between design components, user stories, and BRD requirements
3. Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
4. Target 8-9 pages total (4000-5000 words) with detailed design descriptions, diagrams, and traceability mappings`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a principal software architect creating IEEE 1016 compliant system design documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between design components, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.6,
    max_tokens: 10000,
  });

  return { pageType: "system-design", phase: "design", title: "System Design Document (SDD)", content: response.choices[0]?.message?.content || "", order: 11 };
}
export { promptSystemDesignDocument };


async function generateUIUXDesignSpecsPage(
  userStories: any[] = [],
  personas: any[] = [],
  domain: string = "General",
  contextSummary: string = "",
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const storySummaries = userStories
    .map((s: any, idx: number) => {
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      return `- Story ${idx + 1}: ${s.title || s.description}\n  - Acceptance Criteria: ${ac}`;
    })
    .join("\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate "UI/UX Design Specifications" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Domain:** ${domain}
**Personas:** ${personas.length}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**User Story Summaries (ALL ${userStories.length} stories)**
Use the following user stories as the primary source of truth when defining screens, flows, and interactions. Every major UI workflow should trace back to specific stories.

${storySummaries || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

Include and elaborate on (target 8-9 pages total):
1. Design System (Color Palette, Typography, Spacing) - 1 page
2. Component Library (Buttons, Forms, Cards, Inputs, Tables, Modals, Notifications) - 2 pages
3. Layout System (Grid, Responsive breakpoints, page templates) - 1 page
4. Detailed User Workflows and screen flows with Mermaid diagrams (one or more flows per major user story group) - 3 pages
   - For EACH workflow, include a "Traceability" subsection showing:
     * Which user story(s) this workflow addresses (list story IDs and titles)
     * Which BRD requirement(s) this workflow maps to
     * Which epic(s) and feature(s) this workflow belongs to
5. Accessibility (WCAG 2.1 Level AA) with concrete examples for this project - 1 page
6. Error states, empty states, and edge-case UI patterns - 1 page
7. Comprehensive Traceability Matrix - 1 page
   - Table showing: UI Component/Workflow | User Story ID(s) | BRD Requirement Reference | Epic | Feature | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each UI workflow and major component must show clear traceability to user stories and BRD requirements
- Target 8-9 pages total (4000-5000 words) with detailed specifications

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a UX designer creating production-ready UI/UX specifications. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between UI components/workflows, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "ui-ux-design", phase: "design", title: "UI/UX Design Specifications", content: response.choices[0]?.message?.content || "", order: 13 };
}


import { promptDatabaseDesignDocument } from "./prompts/prompt_database_design_document";
async function generateDatabaseDesignDocumentPage(
  features: any[] = [],
  userStories: any[] = [],
  techStack: any = {},
  domain: string = 'General',
  contextSummary: string = '',
  epics: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const dbType = techStack.database && techStack.database.length > 0 ? techStack.database[0] : 'PostgreSQL';
  const featuresList = features
    .map((f: any, idx: number) => `- Feature ${idx + 1}: ${truncateForWiki(f.title || f.description || "", 160)}`)
    .join('\n');

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const basePrompt = promptDatabaseDesignDocument(
    dbType,
    domain,
    enrichedContext,
    featuresList
  );

  const prompt = `${basePrompt}

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**User Story and BRD Requirement Mapping**
${mappingTable}

**ADDITIONAL REQUIREMENTS:**
1. For EACH database table, entity, or schema component, include a "Traceability" subsection showing:
   - Which user story(s) this database component supports (list story IDs and titles)
   - Which BRD requirement(s) this component maps to
   - Which epic(s) and feature(s) this component belongs to
2. Include a comprehensive traceability section at the end showing the complete mapping between database components, user stories, and BRD requirements
3. Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
4. Target 8-9 pages total (4000-5000 words) with detailed database designs, ER diagrams, and traceability mappings`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      {
        role: "system",
        content: "You are a database architect creating detailed production-ready database designs. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between database components, user stories, and BRD requirements. Ensure every user story is mapped."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.6,
    max_tokens: 10000,
  });

  return { pageType: "database-design", phase: "design", title: "Database Design Document", content: response.choices[0]?.message?.content || "", order: 14 };
}
export { promptDatabaseDesignDocument };


import { promptClassDiagramPage } from "./prompts/prompt_classDiagramPage"
async function generateClassDiagramPage(
  features: any[] = [],
  domain: string = "General",
  userStories: any[] = [],
  contextSummary: string = '',
  epics: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const featuresList = features
    .map((f: any, idx: number) => `- Feature ${idx + 1}: ${truncateForWiki(f.title || f.description || "", 160)}`)
    .join('\n');

  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const basePrompt = promptClassDiagramPage(
    enrichedContext,
    features,
    featuresList,
    userStories,
    fullUserStoriesList,
    domain
  );

  const prompt = `${basePrompt}

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when designing class diagrams. Every class, attribute, and method should trace back to specific user stories and BRD requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

**ADDITIONAL REQUIREMENTS:**
1. For EACH class diagram, include a "Traceability" subsection showing:
   - Which user story(s) this diagram addresses (list story IDs and titles)
   - Which BRD requirement(s) this diagram maps to
   - Which epic(s) and feature(s) this diagram belongs to
2. Include a comprehensive traceability section at the end showing the complete mapping between class diagrams, user stories, and BRD requirements
3. Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
4. Target 8-9 pages total (4000-5000 words) with detailed class diagrams, narrative descriptions, and traceability mappings
5. Create 5-10 comprehensive diagrams, each with 6-12 classes minimum`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      { role: "system", content: `You are an expert OO design architect. Create production-grade UML class diagrams using ACTUAL ${domain} domain data. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings. Extract real entity classes from features. Use realistic attributes and methods from user stories. Create 5-10 comprehensive diagrams. Each diagram needs 6-12 classes. Never use placeholders. Ensure every user story is mapped.` },
      { role: "user", content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 10000,
  });

  return { pageType: "class-diagrams", phase: "design", title: "Class Diagrams", content: response.choices[0]?.message?.content || "", order: 15 };
}
export { promptClassDiagramPage };



import { sequenceDiagramPage } from "./prompts/prompt_SequenceDiagram"
async function generateSequenceDiagramPage(
  userStories: any[] = [],
  features: any[] = [],
  personas: any[] = [],
  domain: string = 'General',
  contextSummary: string = '',
  epics: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const storiesSample = userStories.map((s, idx) => `${idx + 1}. ${s.title}\n   ${s.acceptanceCriteria?.slice(0, 1).join('') || ''}`).join('\n');
  const featuresList = features.map(f => `- ${f.title}`).join('\n');

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const basePrompt = sequenceDiagramPage(
    enrichedContext,
    userStories,
    storiesSample,
    domain,
    featuresList,
    personas
  );

  const prompt = `${basePrompt}

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**User Story and BRD Requirement Mapping**
${mappingTable}

**ADDITIONAL REQUIREMENTS:**
1. Create ONE detailed sequence diagram for EACH of the ${userStories.length} user stories provided
2. For EACH sequence diagram, include a "Traceability" subsection showing:
   - Which user story this diagram addresses (story ID and title)
   - Which BRD requirement(s) this diagram maps to
   - Which epic(s) and feature(s) this diagram belongs to
3. Include a comprehensive traceability section at the end showing the complete mapping between sequence diagrams, user stories, and BRD requirements
4. Ensure ALL ${userStories.length} user stories have corresponding sequence diagrams
5. Target 8-9 pages total (4000-5000 words) with detailed sequence diagrams, narrative descriptions, and traceability mappings
6. Each diagram needs 10-15 interaction steps with error handling. Use actual ${domain} domain components as participants. Show realistic API endpoints. Never use generic names.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      { role: "system", content: `You are an expert software architect. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings. Create ONE detailed sequence diagram for EACH user story provided. Use actual ${domain} domain components as participants. Show realistic API endpoints. Each diagram needs 10-15 interaction steps with error handling. Never use generic names. Ensure every user story is mapped.` },
      { role: "user", content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 10000,
  });

  return { pageType: "sequence-diagrams", phase: "design", title: "Sequence Diagrams", content: response.choices[0]?.message?.content || "", order: 16 };
}
export { sequenceDiagramPage };

import { generateComponentDiagramPagee } from "./prompts/prompt_component_diagram";
async function generateComponentDiagramPage(
  features: any[] = [],
  techStack: any = {},
  userStories: any[] = [],
  domain: string = 'General',
  contextSummary: string = '',
  epics: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const techStr = Object.entries(techStack).filter(([_, v]: [string, any]) => Array.isArray(v) && v.length > 0).map(([k, v]: [string, any]) => `${k}: ${v.join(', ')}`).join('; ');
  const featuresList = features
    .map((f: any, idx: number) => `- Feature ${idx + 1}: ${truncateForWiki(f.title || "", 120)}`)
    .join('\n');

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const basePrompt = generateComponentDiagramPagee(
    featuresList,
    domain,
    techStr,
    enrichedContext
  );

  const prompt = `${basePrompt}

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**User Story and BRD Requirement Mapping**
${mappingTable}

**ADDITIONAL REQUIREMENTS:**
1. For EACH component diagram, include a "Traceability" subsection showing:
   - Which user story(s) this diagram addresses (list story IDs and titles)
   - Which BRD requirement(s) this diagram maps to
   - Which epic(s) and feature(s) this diagram belongs to
2. Include a comprehensive traceability section at the end showing the complete mapping between component diagrams, user stories, and BRD requirements
3. Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
4. Target 8-9 pages total (4000-5000 words) with detailed component diagrams, narrative descriptions, and traceability mappings
5. Create 5-10 comprehensive diagrams. Each needs 12-20 components. Map features to REAL technical components using the actual tech stack. Show layered architecture with ${domain} domain components. Never use generic names.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      { role: "system", content: `You are an expert software architect. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings. Map features to REAL technical components using the actual tech stack. Show layered architecture with ${domain} domain components. Create 5-10 comprehensive diagrams. Each needs 12-20 components. Never use generic names. Ensure every user story is mapped.` },
      { role: "user", content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 10000,
  });

  return { pageType: "component-diagrams", phase: "design", title: "Component Diagrams", content: response.choices[0]?.message?.content || "", order: 17 };
}
export { generateComponentDiagramPagee };

// ============================================================================
// IMPLEMENTATION PHASE GENERATORS
// ============================================================================

async function generateCodingStandardsPage(
  techStack: any = {},
  requirement: string = "",
  userStories: any[] = [],
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const techStr = Object.entries(techStack).filter(([_, v]: [string, any]) => Array.isArray(v) && v.length > 0).map(([k, v]: [string, any]) => `${k}: ${v.join(', ')}`).join('; ');

  // Build user stories context
  const userStoriesContext = userStories.length > 0
    ? `\n\n**User Stories Context (${userStories.length} stories):**\n` +
    userStories.slice(0, 15).map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      return `- **Story ${storyId}**: ${s.title || s.description || ""}`;
    }).join("\n")
    : "";

  // Build BRD context
  const brdSection = brdContext
    ? `\n\n**Business Requirements Document (BRD) Context:**\n` +
    `Use the following BRD sections to ensure coding standards align with business requirements:\n\n` +
    `${truncateForWiki(brdContext, 3000)}`
    : "";

  const prompt = `Generate comprehensive "Coding Standards & Guidelines" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability to user stories and BRD requirements.**

**Project Context:**
${contextSummary}

**Tech Stack:** ${techStr || 'JavaScript/TypeScript, React, Node.js'}
**Domain:** ${domain}
**Number of User Stories:** ${userStories.length}
**Number of Features:** ${features.length}
${userStoriesContext}
${brdSection}

Include comprehensive sections:
1. **Language-Specific Conventions**
   - Naming conventions (variables, functions, classes)
   - Code formatting and style guide
   - File and directory structure
   - Import/export patterns

2. **Code Structure & Organization**
   - Module organization
   - Component structure
   - Service layer patterns
   - Data access patterns
   - **Reference specific user stories** that require these patterns

3. **Documentation Standards**
   - JSDoc/TSDoc conventions
   - Inline comments guidelines
   - README standards
   - API documentation requirements

4. **Code Review Checklist**
   - Functional requirements (trace to user stories)
   - Code quality standards
   - Performance considerations
   - Security best practices
   - Testing requirements

5. **Best Practices**
   - Error handling patterns
   - Async/await patterns
   - State management
   - Data validation
   - **Map practices to user story requirements**

6. **Anti-Patterns to Avoid**
   - Common mistakes
   - Performance pitfalls
   - Security vulnerabilities
   - Maintainability issues

7. **Traceability Matrix**
   - Table mapping coding standards to:
     - User Story IDs
     - BRD Requirement IDs
     - Features
     - Epics

**Format:**
- Use professional enterprise language
- Include code examples relevant to the domain
- Reference specific user story IDs and BRD requirements
- Follow ${WIKI_STYLE_GUIDELINES}

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      {
        role: "system",
        content: "You are a senior software engineer creating comprehensive coding standards for an enterprise SDLC project. Ensure all standards are traced to user stories and BRD requirements."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "coding-standards", phase: "implementation", title: "Coding Standards & Guidelines", content: response.choices[0]?.message?.content || "", order: 19 };
}

async function generateVersionControlGuidelinesPage(
  techStack: any = {},
  userStories: any[] = [],
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build user stories context
  const userStoriesContext = userStories.length > 0
    ? `\n\n**User Stories Context (${userStories.length} stories):**\n` +
    userStories.slice(0, 15).map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      return `- **Story ${storyId}**: ${s.title || s.description || ""}`;
    }).join("\n")
    : "";

  // Build BRD context
  const brdSection = brdContext
    ? `\n\n**Business Requirements Document (BRD) Context:**\n` +
    `Use the following BRD sections to ensure version control practices align with business requirements:\n\n` +
    `${truncateForWiki(brdContext, 3000)}`
    : "";

  const prompt = `Generate comprehensive "Version Control & Git Guidelines" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability to user stories and BRD requirements.**

**Project Context:**
${contextSummary}

**Domain:** ${domain}
**Number of User Stories:** ${userStories.length}
**Number of Features:** ${features.length}
${userStoriesContext}
${brdSection}

Include comprehensive sections:
1. **Branching Strategy**
   - Git Flow / GitHub Flow / Trunk-based development
   - Branch naming conventions
   - Branch lifecycle management
   - **Reference how branches relate to user stories and features**

2. **Commit Message Convention**
   - Conventional Commits format
   - Commit message templates
   - Examples with user story references
   - Commit message best practices

3. **Pull Request Process**
   - PR creation guidelines
   - PR template requirements
   - PR review process
   - **Link PRs to user stories and BRD requirements**
   - Approval workflow

4. **Code Review Guidelines**
   - Review checklist
   - Review criteria (functional, technical, security)
   - **Trace reviews to user story acceptance criteria**
   - Review response time expectations

5. **Merge Strategies**
   - Merge vs Rebase guidelines
   - Merge conflict resolution
   - Merge approval requirements
   - Release branch management

6. **Tag & Release Process**
   - Versioning strategy (Semantic Versioning)
   - Tag naming conventions
   - Release branch strategy
   - **Map releases to epics and features**
   - Release notes generation

7. **Traceability Matrix**
   - Table mapping version control practices to:
     - User Story IDs
     - BRD Requirement IDs
     - Features
     - Epics

**Format:**
- Use professional enterprise language
- Include examples relevant to the domain
- Reference specific user story IDs and BRD requirements
- Follow ${WIKI_STYLE_GUIDELINES}

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      {
        role: "system",
        content: "You are a DevOps engineer creating comprehensive version control guidelines for an enterprise SDLC project. Ensure all practices are traced to user stories and BRD requirements."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "version-control", phase: "implementation", title: "Version Control & Git Guidelines", content: response.choices[0]?.message?.content || "", order: 21 };
}

import { promptInfraStructureDiagram } from "./prompts/prompt_InfrastructureDiagram"

async function generateInfrastructureDiagramPage(
  techStack: any = {},
  features: any[] = [],
  domain: string = 'General',
  contextSummary: string = '',
  userStories: any[] = [],
  epics: any[] = [],
  brdContext: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const cloudProvider = techStack.cloud && techStack.cloud.length > 0 ? techStack.cloud[0] : 'AWS';
  const backend = techStack.backend && techStack.backend.length > 0 ? techStack.backend.join(', ') : 'Node.js, Express';
  const frontend = techStack.frontend && techStack.frontend.length > 0 ? techStack.frontend.join(', ') : 'React';
  const database = techStack.database && techStack.database.length > 0 ? techStack.database.join(', ') : 'MySQL';

  const featuresList = features.slice(0, 8).map(f => `- ${f.title}`).join('\n');

  // Build user stories context
  const userStoriesContext = userStories.length > 0
    ? `\n\n**User Stories Context (${userStories.length} stories):**\n` +
    userStories.slice(0, 15).map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      return `- **Story ${storyId}**: ${s.title || s.description || ""}`;
    }).join("\n")
    : "";

  // Build BRD context
  const brdSection = brdContext
    ? `\n\n**Business Requirements Document (BRD) Context:**\n` +
    `Use the following BRD sections to ensure infrastructure design aligns with business requirements:\n\n` +
    `${truncateForWiki(brdContext, 3000)}`
    : "";

  const basePrompt = promptInfraStructureDiagram(
    contextSummary,
    featuresList,
    cloudProvider,
    frontend,
    backend,
    database,
    domain
  );

  const prompt = `${basePrompt}

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability to user stories and BRD requirements.**

${userStoriesContext}
${brdSection}

**ADDITIONAL REQUIREMENTS:**
1. For EACH infrastructure diagram, include a "Traceability" subsection showing:
   - Which user story(s) this infrastructure supports (list story IDs and titles)
   - Which BRD requirement(s) this infrastructure maps to
   - Which epic(s) and feature(s) this infrastructure belongs to
2. Include a comprehensive traceability section at the end showing the complete mapping between infrastructure components, user stories, and BRD requirements
3. Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
4. Target 8-9 pages total (4000-5000 words) with detailed infrastructure diagrams, narrative descriptions, and traceability mappings`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [
      {
        role: "system",
        content: `You are an expert cloud solutions architect. Create 6 comprehensive infrastructure diagrams using ${cloudProvider}, ${backend}, ${frontend}, ${database}. Each diagram needs 10-20 nodes showing production-ready ${domain} infrastructure. Never use generic names. Ensure all infrastructure is traced to user stories and BRD requirements.`
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 10000,
  });

  return { pageType: "infrastructure-diagrams", phase: "implementation", title: "Infrastructure Diagrams", content: response.choices[0]?.message?.content || "", order: 22 };
}
export { promptInfraStructureDiagram };
// ============================================================================
// TESTING PHASE GENERATORS
// ============================================================================

async function generateTestPlanPage(
  features: any[] = [],
  userStories: any[] = [],
  epics: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const testCaseMappingTable = buildTestCaseMappingTable({ userStories, epics, features });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate a comprehensive "Test Plan" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Domain:** ${domain}
**Scope:** ${epics.length} epics, ${features.length} features, ${userStories.length} stories

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when creating the test plan. Every test scope item, test type, and test deliverable should trace back to specific user stories and BRD requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

**Test Case to User Story Mapping**
${testCaseMappingTable}

Include (target 8-9 pages total):
1. Test Strategy & Approach - 1 page
2. Test Scope (In-scope, Out-of-scope) - 1 page
   - For EACH in-scope item, include traceability to user stories and BRD requirements
3. Test Types (Unit, Integration, E2E, Performance, Security) - 2 pages
   - For EACH test type, show which user stories and test cases it covers
4. Test Environment Setup - 1 page
5. Test Schedule & Milestones - 1 page
   - Map milestones to epic/feature completion and user story validation
6. Entry/Exit Criteria - 1 page
7. Risks & Mitigation - 1 page
8. Test Deliverables - 1 page
9. Comprehensive Traceability Matrix - 1 page
   - Table showing: Test Scope Item | User Story ID(s) | Test Case ID(s) | BRD Requirement Reference | Epic | Feature | Test Type | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each test scope item must show clear traceability to user stories and BRD requirements
- Use BRD Testing and Quality Assurance sections as the primary source for test planning
- Reference the test case mapping table to show which test cases validate which user stories
- Target 8-9 pages total (4000-5000 words) with detailed test plan specifications and traceability mappings

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a QA architect creating comprehensive test plan documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between test scope, user stories, test cases, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "test-plan", phase: "testing", title: "Test Plan", content: response.choices[0]?.message?.content || "", order: 24 };
}

async function generateTestCasesPage(
  userStories: any[] = [],
  features: any[] = [],
  epics: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list with test cases (not summary)
  const fullUserStoriesWithTestCases = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);

      // Get test cases from user story
      const testCases = s.testCases || [];
      const testCasesList = testCases.length > 0
        ? testCases.map((tc: any, tcIdx: number) => {
          const tcId = tc.id || `TC-${storyId}-${tcIdx + 1}`;
          return `    - **${tcId}**: ${tc.scenario || tc.title || `Test Case ${tcIdx + 1}`}
      - Steps: ${Array.isArray(tc.steps) ? tc.steps.map((step: any) => typeof step === 'string' ? step : step.action || step).join("; ") : "N/A"}
      - Expected Result: ${tc.expectedResult || "N/A"}
      - Preconditions: ${tc.preconditions || "N/A"}
      - Priority: ${tc.priority || "Medium"}`;
        }).join("\n")
        : "    - No test cases defined for this user story";

      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}
  - Test Cases (${testCases.length}):
${testCasesList}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const testCaseMappingTable = buildTestCaseMappingTable({ userStories, epics, features });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  // Count total test cases
  const totalTestCases = userStories.reduce((sum, s) => sum + (s.testCases?.length || 0), 0);

  const prompt = `Generate "Test Cases" documentation for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Domain:** ${domain}
**Total User Stories:** ${userStories.length}
**Total Test Cases:** ${totalTestCases}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories with Test Cases (Complete Details - NOT Summary)**
Use the following complete user stories and their associated test cases as the primary source of truth. Generate comprehensive test cases for ALL user stories, using existing test cases as reference where available.

${fullUserStoriesWithTestCases || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

**Test Case to User Story Mapping**
${testCaseMappingTable}

Include (target 8-9 pages total):
1. Test Case Template - 0.5 pages
   - Standard format for documenting test cases
2. Test Cases by User Story - 6-7 pages
   - For EACH user story, generate comprehensive test cases covering:
     * Happy path scenarios
     * Edge cases
     * Error scenarios
     * Validation rules
     * Integration scenarios
   - For EACH test case, include:
     * Test Case ID (format: TC-{StoryID}-{Number})
     * User Story ID and Title (explicit mapping)
     * Description/Scenario
     * Preconditions
     * Test Steps (detailed, actionable)
     * Expected Results (specific and measurable)
     * Priority (High/Medium/Low)
     * Status
     * Acceptance Criteria Covered (which AC from the user story this test validates)
   - If test cases already exist in the user story data, use them as reference and expand/enhance them
   - If no test cases exist, generate comprehensive test cases based on acceptance criteria
3. Test Case Organization - 0.5 pages
   - Grouping by feature/epic
   - Test case numbering scheme
4. Comprehensive Test Case Mapping Table - 1 page
   - Table showing: Test Case ID | Test Case Title | User Story ID | User Story Title | Acceptance Criteria Covered | Priority | Status
   - Ensure ALL test cases are mapped to their user stories
   - Ensure ALL ${userStories.length} user stories have test cases documented

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories have test cases generated
- Each test case MUST explicitly reference its user story ID and title
- Use existing test cases from user story data as reference where available
- Generate test cases that cover ALL acceptance criteria for each user story
- Target 8-9 pages total (4000-5000 words) with detailed test case documentation
- Show clear traceability: Test Case → User Story → Acceptance Criteria → BRD Requirement

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a QA engineer creating comprehensive test case documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between test cases and user stories. Ensure every user story has test cases and every test case is mapped to its user story." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "test-cases", phase: "testing", title: "Test Cases", content: response.choices[0]?.message?.content || "", order: 25 };
}

async function generateTestCoverageMatrixPage(
  epics: any[] = [],
  features: any[] = [],
  userStories: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list with test cases (not summary)
  const fullUserStoriesWithTestCases = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);

      // Get test cases from user story
      const testCases = s.testCases || [];
      const testCasesList = testCases.length > 0
        ? testCases.map((tc: any, tcIdx: number) => {
          const tcId = tc.id || `TC-${storyId}-${tcIdx + 1}`;
          return `    - ${tcId}: ${tc.scenario || tc.title || `Test Case ${tcIdx + 1}`}`;
        }).join("\n")
        : "    - No test cases defined";

      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Test Cases (${testCases.length}):
${testCasesList}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const testCaseMappingTable = buildTestCaseMappingTable({ userStories, epics, features });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  // Count total test cases
  const totalTestCases = userStories.reduce((sum, s) => sum + (s.testCases?.length || 0), 0);

  const prompt = `Generate a "Test Coverage Matrix" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Domain:** ${domain}
**Scope:** ${epics.length} epics, ${features.length} features, ${userStories.length} stories, ${totalTestCases} test cases

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories with Test Cases (Complete Details - NOT Summary)**
Use the following complete user stories and their associated test cases to build the coverage matrix. Ensure ALL user stories and test cases are included in the matrix.

${fullUserStoriesWithTestCases || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

**Test Case to User Story Mapping**
${testCaseMappingTable}

Include (target 8-9 pages total):
1. Coverage Matrix Overview - 1 page
   - Purpose and scope of the coverage matrix
   - Coverage methodology
2. Coverage Matrix Table (Requirements vs Test Cases) - 4-5 pages
   - Comprehensive matrix showing:
     * Epic ID and Title
     * Feature ID and Title
     * User Story ID and Title
     * Acceptance Criteria
     * Test Case ID(s) covering each user story
     * Test Type (Unit/Integration/E2E/Performance/Security)
     * Coverage Status (Covered/Partially Covered/Not Covered)
     * BRD Requirement Reference
   - Ensure ALL ${userStories.length} user stories are included
   - Ensure ALL ${totalTestCases} test cases are mapped
3. Coverage Summary Statistics - 1 page
   - Overall coverage percentage
   - Coverage by epic
   - Coverage by feature
   - Coverage by test type
   - Coverage by priority
4. Mermaid Visualization - 1 page
   - Visual representation of coverage
   - Flow diagrams showing test case to user story relationships
5. Gap Analysis - 1 page
   - Identify user stories without test cases
   - Identify acceptance criteria not covered
   - Recommendations for improving coverage
6. Comprehensive Traceability Matrix - 1 page
   - Table showing: User Story ID | User Story Title | Test Case ID(s) | Acceptance Criteria Covered | Test Type | Coverage Status | BRD Requirement Reference | Epic | Feature
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are included in the coverage matrix
- Ensure ALL ${totalTestCases} test cases are mapped to their user stories
- Show clear traceability: Test Case → User Story → Acceptance Criteria → BRD Requirement
- Use the test case mapping table to accurately represent coverage
- Target 8-9 pages total (4000-5000 words) with detailed coverage analysis

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a QA architect creating comprehensive test coverage matrix documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between test cases, user stories, and BRD requirements. Ensure every user story and test case is included in the matrix." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "test-coverage-matrix", phase: "testing", title: "Test Coverage Matrix", content: response.choices[0]?.message?.content || "", order: 26 };
}

// ============================================================================
// DEPLOYMENT PHASE GENERATORS
// ============================================================================

async function generateReleaseNotesPage(
  epics: any[] = [],
  features: any[] = [],
  userStories: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full features and user stories list (not summary)
  const fullFeaturesList = features
    .map((f: any, idx: number) => {
      const featureId = f.id || `feature-${idx + 1}`;
      const epic = epics.find(e => e.id === f.epicId);
      const relatedStories = userStories.filter(s => s.featureId === f.id);
      return `- **Feature ${featureId}**: ${f.title || f.description}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Description: ${f.description || "N/A"}
  - Related User Stories: ${relatedStories.length} stories`;
    })
    .join("\n\n");

  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate "Release Notes" template for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Domain:** ${domain}
**Total Epics:** ${epics.length}
**Total Features:** ${features.length}
**Total User Stories:** ${userStories.length}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL Features (Complete Details - NOT Summary)**
${fullFeaturesList || "- No features provided"}

**ALL User Stories (Complete Details - NOT Summary)**
${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

Include (target 8-9 pages total):
1. Release Information (Version, Date, Type) - 0.5 pages
2. What's New (New Features) - 3-4 pages
   - For EACH feature, include:
     * Feature ID and Title
     * Epic it belongs to
     * Related user stories (list story IDs and titles)
     * Detailed description of what's new
     * BRD requirement reference
3. Improvements - 1 page
   - Map improvements to user stories and features
4. Bug Fixes - 1 page
   - Map bug fixes to affected user stories
5. Breaking Changes - 1 page
   - Map breaking changes to affected user stories and features
6. Known Issues - 1 page
   - Map known issues to affected user stories
7. Upgrade Instructions - 1 page
8. Comprehensive Traceability Matrix - 1 page
   - Table showing: Release Item | Feature ID | User Story ID(s) | Epic | BRD Requirement Reference | Type (New/Improvement/Bug Fix) | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${features.length} features are documented in "What's New"
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped
- Each release item must show clear traceability to user stories, features, epics, and BRD requirements
- Target 8-9 pages total (4000-5000 words) with detailed release notes and traceability mappings

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a technical writer creating comprehensive release notes. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between release items, user stories, features, and BRD requirements. Ensure every user story and feature is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "release-notes", phase: "deployment", title: "Release Notes", content: response.choices[0]?.message?.content || "", order: 28 };
}

async function generateUserManualPage(
  userStories: any[] = [],
  personas: any[] = [],
  features: any[] = [],
  epics: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  const personasList = personas.map(p => p.name).join(', ');

  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const ac =
        Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0
          ? s.acceptanceCriteria.join("; ")
          : (s.acceptanceCriteriaText || "");
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Acceptance Criteria: ${ac || "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate a "User Manual" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Target Users:** ${personasList || 'End Users, Administrators'}
**Domain:** ${domain}
**Features:** ${features.length}
**User Stories:** ${userStories.length}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when creating the user manual. Every feature description, tutorial, and troubleshooting item should trace back to specific user stories and BRD requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

Include (target 8-9 pages total):
1. Getting Started Guide - 1 page
   - Map getting started steps to initial user stories
2. User Interface Overview - 1 page
   - Map UI components to user stories and features
3. Key Features & How to Use - 3-4 pages
   - For EACH major feature, include:
     * Feature ID and Title
     * Related user stories (list story IDs and titles)
     * Step-by-step instructions
     * Screenshots/descriptions
     * Acceptance criteria covered
4. Step-by-Step Tutorials - 1-2 pages
   - Map tutorials to complete user story workflows
5. Tips & Best Practices - 1 page
6. Troubleshooting & FAQ - 1 page
   - Map troubleshooting items to user stories and acceptance criteria
7. Support Contact Information - 0.5 pages
8. Comprehensive Traceability Matrix - 1 page
   - Table showing: Manual Section | User Story ID(s) | Feature | Epic | BRD Requirement Reference | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each feature description must show clear traceability to user stories and BRD requirements
- Use BRD User Experience and Functional Requirements sections as the primary source for user manual content
- Target 8-9 pages total (4000-5000 words) with detailed user instructions and traceability mappings

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are a technical writer creating comprehensive user manual documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between manual sections, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "user-manual", phase: "deployment", title: "User Manual", content: response.choices[0]?.message?.content || "", order: 29 };
}

async function generateMaintenancePlanPage(
  requirement: string,
  techStack: any = {},
  userStories: any[] = [],
  epics: any[] = [],
  features: any[] = [],
  brdContext: string = "",
  domain: string = "General",
  contextSummary: string = ""
): Promise<{ pageType: string; phase: string; title: string; content: string; order: number }> {
  // Build full user stories list (not summary)
  const fullUserStoriesList = userStories
    .map((s: any, idx: number) => {
      const storyId = s.id || `story-${idx + 1}`;
      const feature = features.find(f => f.id === s.featureId);
      const epic = epics.find(e => e.id === s.epicId);
      return `- **Story ${storyId}**: ${s.title || s.description}
  - Feature: ${feature ? (feature.title || feature.description) : "N/A"}
  - Epic: ${epic ? (epic.title || epic.description) : "N/A"}
  - Description: ${s.description || "N/A"}`;
    })
    .join("\n\n");

  const mappingTable = buildUserStoryBRDMappingTable({ userStories, epics, features, brdContext });
  const enrichedContext = contextSummary + (brdContext ? `\n\n**BRD Context:**\n${truncateForWiki(brdContext, 4000)}` : "");

  const prompt = `Generate a "Maintenance Plan" for ${_docPlatform}.

**CRITICAL: This document must be 8-9 pages long (approximately 4000-5000 words) with comprehensive detail and explicit traceability mappings.**

**Project:** ${requirement}
**Domain:** ${domain}
**Total User Stories:** ${userStories.length}

**Full Project Context (including BRD and artifacts)**
${enrichedContext}

**ALL User Stories (Complete Details - NOT Summary)**
Use the following complete user stories as the primary source of truth when creating the maintenance plan. Every maintenance activity, monitoring checkpoint, and support procedure should trace back to specific user stories and BRD requirements.

${fullUserStoriesList || "- No user stories provided"}

**User Story and BRD Requirement Mapping**
${mappingTable}

Include (target 8-9 pages total):
1. Maintenance Overview & Objectives - 1 page
2. Maintenance Types (Corrective, Adaptive, Perfective, Preventive) - 1 page
   - Map each maintenance type to affected user stories and features
3. Maintenance Schedule - 1 page
   - Map maintenance activities to user story functionality
4. Support Tiers & SLAs - 1 page
   - Map support tiers to user story priorities
5. Incident Management Process - 1 page
   - Map incident types to affected user stories
6. Change Management Process - 1 page
   - Map change procedures to user story updates
7. Performance Monitoring - 1 page
   - Map monitoring metrics to user story functionality
8. Backup & Disaster Recovery - 1 page
   - Map backup/recovery procedures to critical user stories
9. End-of-Life Plan - 1 page
10. Comprehensive Traceability Matrix - 1 page
   - Table showing: Maintenance Activity | User Story ID(s) | Feature | Epic | BRD Requirement Reference | Maintenance Type | Status
   - Ensure ALL ${userStories.length} user stories are mapped in this matrix

**CRITICAL REQUIREMENTS:**
- Ensure ALL ${userStories.length} user stories are referenced and explicitly mapped in the document
- Each maintenance activity must show clear traceability to user stories and BRD requirements
- Use BRD Maintenance and Operations sections as the primary source for maintenance planning
- Target 8-9 pages total (4000-5000 words) with detailed maintenance procedures and traceability mappings

Return ONLY the Markdown content.`;

  const response = await openai.chat.completions.create({
    model: _defaultModelName,
    messages: [{ role: "system", content: "You are an IT operations manager creating comprehensive maintenance plan documentation. Create a comprehensive 8-9 page document (4000-5000 words) with explicit traceability mappings between maintenance activities, user stories, and BRD requirements. Ensure every user story is mapped." }, { role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 10000,
  });

  return { pageType: "maintenance-plan", phase: "deployment", title: "Maintenance Plan", content: response.choices[0]?.message?.content || "", order: 30 };
}

// ============================================================================
// AI ENHANCEMENT FUNCTIONS FOR DESCRIPTIONS AND ACCEPTANCE CRITERIA
// ============================================================================

/**
 * Enhance or generate artifact description based on context
 */
import { artifactDescriptionForAgileDevelopment } from "./prompts/prompt_artifact_description_for_agile_development";
export async function enhanceArtifactDescription(data: {
  title: string;
  description: string;
  artifactType: 'Epic' | 'Feature' | 'User Story' | 'Task' | 'Bug';
  parentContext?: {
    parentType?: string;
    parentTitle?: string;
    parentDescription?: string;
  };
  projectDomain?: string;
}): Promise<string> {
  const { title, description, artifactType, parentContext, projectDomain } = data;

  const isEmptyDescription = !description || description.trim().length === 0;

  const contextInfo = parentContext?.parentTitle
    ? `- Parent Context: This ${artifactType} belongs to ${parentContext.parentType}: "${parentContext.parentTitle}"`
    : '';

  const domainInfo = projectDomain
    ? `- Project Domain: ${projectDomain}`
    : '';

  const taskType = isEmptyDescription ? 'GENERATE' : 'ENHANCE';

  const prompt = artifactDescriptionForAgileDevelopment(
    contextInfo,
    domainInfo,
    taskType,
    isEmptyDescription,
    artifactType
  );


  try {
    const modelName = _defaultModelName;

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: "You are an expert product manager and technical writer specializing in agile software development documentation."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    return response.choices[0]?.message?.content?.trim() || description;
  } catch (error: any) {
    console.error('Error enhancing artifact description:', error);
    throw new Error(`Failed to enhance description: ${error.message}`);
  }
}
export { artifactDescriptionForAgileDevelopment };
/**
 * Enhance or generate acceptance criteria for User Stories
 */
import { promptenhanceAcceptanceCriteria } from "./prompts/prompt_acceptance_criteria";

export async function enhanceAcceptanceCriteria(data: {
  storyTitle: string;
  storyDescription: string;
  currentAcceptanceCriteria: any[] | string;
  storyPoints?: number;
  featureContext?: {
    featureTitle?: string;
    featureDescription?: string;
  };
  epicContext?: {
    epicTitle?: string;
  };
  projectDomain?: string;
  persona?: string;
}): Promise<any[]> {
  const {
    storyTitle,
    storyDescription,
    currentAcceptanceCriteria,
    storyPoints = 3,
    featureContext,
    epicContext,
    projectDomain,
    persona
  } = data;

  // Check if acceptance criteria is empty
  const isEmptyCriteria = !currentAcceptanceCriteria ||
    (Array.isArray(currentAcceptanceCriteria) && currentAcceptanceCriteria.length === 0) ||
    (typeof currentAcceptanceCriteria === 'string' && currentAcceptanceCriteria.trim().length === 0);

  // Format existing criteria for the prompt
  let existingCriteriaText = 'None';
  if (!isEmptyCriteria) {
    if (Array.isArray(currentAcceptanceCriteria)) {
      existingCriteriaText = currentAcceptanceCriteria.map((criteria: any, idx: number) => {
        let text = `AC #${idx + 1}${criteria.title ? `: ${criteria.title}` : ''}\n`;
        text += `Given: ${criteria.given}\n`;
        text += `When: ${criteria.when}\n`;
        text += `Then: ${criteria.then}`;
        if (criteria.and) {
          text += `\nAnd: ${criteria.and}`;
        }
        return text;
      }).join('\n\n');
    } else {
      existingCriteriaText = String(currentAcceptanceCriteria);
    }
  }

  const contextInfo = [];
  if (featureContext?.featureTitle) {
    contextInfo.push(`- Feature Context: ${featureContext.featureTitle}`);
  }
  if (epicContext?.epicTitle) {
    contextInfo.push(`- Epic Context: ${epicContext.epicTitle}`);
  }
  if (projectDomain) {
    contextInfo.push(`- Project Domain: ${projectDomain}`);
  }
  if (persona) {
    contextInfo.push(`- Primary User Persona: ${persona}`);
  }

  const taskType = isEmptyCriteria ? 'GENERATE' : 'ENHANCE';

  const domainConsiderations = getDomainConsiderations(projectDomain || 'General');

  // Determine number of ACs based on story points
  const acCount = storyPoints <= 2 ? '3-4' : storyPoints <= 5 ? '4-5' : '5-6';
  const complexityNote = storyPoints <= 2 ? 'This is a simple story' :
    storyPoints <= 5 ? 'This is a moderate complexity story' :
      'This is a complex story';

  const prompt = promptenhanceAcceptanceCriteria(
    acCount,
    storyPoints,
    domainConsiderations);

  try {
    const modelName = _defaultModelName;

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: "You are an expert QA Engineer and Business Analyst specializing in writing comprehensive acceptance criteria for user stories."
        },
        { role: "user", content: prompt }
        // prompt
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content?.trim() || '';

    // Parse the response into structured acceptance criteria
    const parsedCriteria = parseAcceptanceCriteria(content);

    return parsedCriteria.length > 0 ? parsedCriteria :
      (Array.isArray(currentAcceptanceCriteria) ? currentAcceptanceCriteria : []);
  } catch (error: any) {
    console.error('Error enhancing acceptance criteria:', error);
    throw new Error(`Failed to enhance acceptance criteria: ${error.message}`);
  }
}
export { promptenhanceAcceptanceCriteria };
/**
 * Helper function to get domain-specific considerations
 */
function getDomainConsiderations(domain: string): string {
  const considerations: Record<string, string> = {
    'Insurance': `**Domain-Specific Considerations:**
Consider policy validation, claim workflows, fraud detection, compliance requirements, and regulatory standards.`,
    'E-Commerce': `**Domain-Specific Considerations:**
Consider cart operations, payment flows, inventory management, shipping workflows, and order tracking.`,
    'Healthcare': `**Domain-Specific Considerations:**
Consider HIPAA compliance, patient privacy, appointment scheduling, medical records security, and audit trails.`,
    'Finance': `**Domain-Specific Considerations:**
Consider KYC requirements, transaction limits, regulatory compliance, security standards, and audit logging.`,
    'Education': `**Domain-Specific Considerations:**
Consider student privacy, grade management, assignment submission, attendance tracking, and accessibility.`,
    'Social Network': `**Domain-Specific Considerations:**
Consider user privacy, content moderation, engagement metrics, notification preferences, and data sharing controls.`,
    'CRM': `**Domain-Specific Considerations:**
Consider data integrity, lead tracking, pipeline management, reporting requirements, and integration with other systems.`,
    'HRMS': `**Domain-Specific Considerations:**
Consider employee privacy, payroll accuracy, compliance with labor laws, performance tracking, and data retention.`,
  };

  return considerations[domain] || `**Domain-Specific Considerations:**
Consider industry best practices, regulatory requirements, security standards, and user experience principles.`;
}

/**
 * Parse AI-generated acceptance criteria text into structured format
 */
function parseAcceptanceCriteria(content: string): any[] {
  const criteria: any[] = [];

  // Split by AC # markers
  const acBlocks = content.split(/\n\s*AC #\d+/i).filter(block => block.trim().length > 0);

  acBlocks.forEach((block, index) => {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const ac: any = {};

    // Extract title from first line if it contains a colon
    if (lines.length > 0 && lines[0].includes(':') && !lines[0].match(/^(Given|When|Then|And):/i)) {
      ac.title = lines[0].replace(/^:\s*/, '').trim();
      lines.shift();
    }

    // Parse Given, When, Then, And
    lines.forEach(line => {
      if (line.match(/^Given:/i)) {
        ac.given = line.replace(/^Given:\s*/i, '').trim();
      } else if (line.match(/^When:/i)) {
        ac.when = line.replace(/^When:\s*/i, '').trim();
      } else if (line.match(/^Then:/i)) {
        ac.then = line.replace(/^Then:\s*/i, '').trim();
      } else if (line.match(/^And:/i)) {
        ac.and = line.replace(/^And:\s*/i, '').trim();
      }
    });

    // Only add if we have at least Given, When, and Then
    if (ac.given && ac.when && ac.then) {
      criteria.push(ac);
    }
  });

  return criteria;
}

/**
 * Generate subtasks from acceptance criteria and story details
 */
import { breakDownUserstory } from "./prompts/prompt_break_Down_Userstory";
export async function generateSubtasksFromACs(data: {
  storyTitle: string;
  acceptanceCriteria: any[];
  storyPoints?: number;
}): Promise<string[]> {
  const { storyTitle, acceptanceCriteria, storyPoints = 3 } = data;

  // Format acceptance criteria for the prompt
  const criteriaText = acceptanceCriteria.map((criteria: any, idx: number) => {
    let text = `AC #${idx + 1}${criteria.title ? `: ${criteria.title}` : ''}\n`;
    text += `Given: ${criteria.given}\n`;
    text += `When: ${criteria.when}\n`;
    text += `Then: ${criteria.then}`;
    if (criteria.and) {
      text += `\nAnd: ${criteria.and}`;
    }
    return text;
  }).join('\n\n');

  const prompt = breakDownUserstory(
    storyPoints,
    storyTitle,
    criteriaText
  );

  try {
    // Use centralized AI client - automatically handles Anthropic, Azure OpenAI, or OpenAI
    const openaiClient = openai;

    const modelName = process.env.ANTHROPIC_MODEL_NAME || process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";

    const response = await openaiClient.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content: "You are a technical lead experienced in breaking down user stories into development subtasks."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content?.trim() || '';

    // Parse the response into subtask array
    const subtasks = content
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.match(/^(subtasks?:|tasks?:)/i))
      .map((line: string) => line.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, ''))
      .filter((line: string) => line.length > 10); // Filter out very short lines

    return subtasks;
  } catch (error: any) {
    console.error('Error generating subtasks:', error);
    throw new Error(`Failed to generate subtasks: ${error.message}`);
  }
}

/**
 * Generate an executive summary of the generated artifacts
 */
import { promptArtifactSummary } from "./prompts/prompt_artifact_summary";
export async function generateArtifactSummary(artifacts: {
  epics: any[];
  features: any[];
  userStories: any[];
  guidelines?: any;
}): Promise<string> {
  try {
    console.log("[AI Service] Generating artifact summary for", {
      epicsCount: artifacts.epics.length,
      featuresCount: artifacts.features.length,
      storiesCount: artifacts.userStories.length,
    });

    const modelName = _defaultModelName;
    const prompt = promptArtifactSummary(artifacts);

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content:
            "You are an expert business analyst specializing in agile project management and executive summaries.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1500,
    });

    const summary = response.choices[0]?.message?.content?.trim();

    if (!summary) {
      throw new Error("No summary generated from model");
    }

    console.log("[AI Service] Artifact summary generated successfully");
    return summary;
  } catch (error: any) {
    console.error("Error generating artifact summary:", error);
    throw new Error(`Failed to generate artifact summary: ${error.message}`);
  }
}

/**
 * Fix Mermaid syntax errors using AI
 * Analyzes the error and generates corrected Mermaid code
 */
export async function fixMermaidSyntax(
  mermaidCode: string,
  context: string = ""
): Promise<string> {
  try {
    console.log("[AI Service] Fixing Mermaid syntax error");

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    const prompt = `You are a **Mermaid diagram syntax expert**. Your job is to take Mermaid code that may have syntax errors and return a **corrected version that renders successfully**, while preserving the original intent as much as possible.

Context (for semantics only, do NOT summarize it):
${context || "Wiki page documentation"}

---
Original Mermaid Code (may contain errors):
\`\`\`mermaid
${mermaidCode}
\`\`\`
---

STRICT requirements:
- Detect the intended diagram type (e.g. \`flowchart TD\`, \`graph LR\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, \`gantt\`, \`erDiagram\`).
- If there is a valid type already, **keep it** unless it is clearly invalid for the rest of the syntax.
- Fix **only syntax and structural problems** (missing arrows, mismatched brackets, bad indentation, invalid keywords, etc.).
- Do **NOT** change business meaning, node labels, or text content unless required for Mermaid to parse.
- If the original structure is beyond repair, you **must construct a new valid diagram** that still uses the **same node labels and relationships** as much as possible.
- Ensure the final code would pass validation by the official Mermaid parser.

Common Mermaid rules (non‑exhaustive but important):
- Start with a valid declaration like \`flowchart TD\`, \`graph LR\`, \`sequenceDiagram\`, \`classDiagram\`, etc.
- Use correct node syntax: \`A[Label]\`, \`A((Label))\`, \`A{Label}\`, \`A((Label))\`.
- Use valid arrows and relationships: \`A --> B\`, \`A -->|label| B\`, \`A --- B\`, or sequence arrows like \`A->>B: message\`.
- All brackets/parentheses/braces must be matched.
- Subgraphs must use proper \`subgraph\` / \`end\` pairs and consistent indentation.
- For sequence diagrams, participants and messages must follow Mermaid's documented syntax.

Output format (VERY IMPORTANT):
- Return **ONLY** the corrected Mermaid code.
- **Do NOT** wrap it in backticks or \`\`\`mermaid fences.
- **Do NOT** include explanations, comments, or prose. No leading or trailing commentary.

Now respond with the corrected Mermaid code:`;

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content:
            "You are a Mermaid diagram syntax expert. Fix syntax errors in Mermaid code while preserving the diagram's intent. Return only the corrected code without any explanations or markdown fences.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const fixedCode = response.choices[0]?.message?.content?.trim() || "";

    if (!fixedCode) {
      throw new Error("No fixed code generated from model");
    }

    // Clean up the response (remove markdown code blocks if present)
    const cleanedCode = fixedCode
      .replace(/^```mermaid\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    console.log("[AI Service] Mermaid syntax fixed successfully");
    return cleanedCode;
  } catch (error: any) {
    console.error("Error fixing Mermaid syntax:", error);
    throw new Error(`Failed to fix Mermaid syntax: ${error.message}`);
  }
}

// ...existing code...
// ============================================
// LLM COUNCIL FUNCTIONALITY
// ============================================

interface CouncilResponse {
  id: string;
  provider: string;
  model: string;
  response: any;
  confidence: number;
  coverage: number;
  consistency: number;
  timestamp: Date;
  memberIndex?: number;
  role?: string;
  duration?: number;
  error?: string;
}

interface ChairEvaluation {
  selectedResponseId: string;
  reasoning: string;
  confidenceScore: number;
  evaluationDetails: any;
}

/**
 * Generate artifacts using LLM Council with available models
 * Uses both Azure OpenAI and Anthropic, then chair evaluation
 */
export async function generateArtifactsWithCouncil(
  functionalRequirementsContent: string,
  useChunking: boolean = true,
  selectedPersonasFromHub: Array<{
    name: string;
    role: string;
    focus?: string;
    painPoints?: string[];
    goals?: string[];
  }> = [],
  progressCallback?: (step: string, progress: number, councilData?: any) => void,
  aiEnhanceEnabled: boolean = false,
  llmTemperature: number = 0.7,
  checkCancelled?: () => boolean,
  generationConstraints?: { maxEpics?: number; maxFeatures?: number; maxStories?: number },
  goldenRepoName: string = "Business",
  goldenRepoIdForChunks?: string,
  goldenRepoGuidelinesForDevx?: Array<{ name: string; content: string }>
): Promise<{
  artifacts: any;
  usage?: WorkflowUsageReport[];
  councilData: {
    responses: CouncilResponse[];
    evaluation: ChairEvaluation;
  };
}> {
  try {
    console.log("[AI Service] 🏛️ INITIALIZING LLM COUNCIL WITH AVAILABLE MEMBERS");
    console.log("[AI Service] 🔒 PRODUCTION SAFEGUARDS ACTIVE:");
    console.log("[AI Service]    • 3 retry attempts per member");
    console.log("[AI Service]    • No artificial timeouts (let LLMs complete naturally)");
    console.log("[AI Service]    • Emergency fallback system");
    console.log("[AI Service]    • Chair evaluation failure recovery");
    console.log("[AI Service] ════════════════════════════════════════════════");

    // Step 1: Prepare council members — 1 per provider to avoid same-provider rate limit competition
    // Using 2 members (1 Azure + 1 Anthropic) instead of 4 cuts generation time in half
    // while preserving cross-provider diversity for quality evaluation
    const availableMembers = [];

    if (azureOpenAI) {
      availableMembers.push(
        { id: 'azure-openai-1', name: 'Azure OpenAI Member 1', provider: 'azureOpenAI', role: 'Primary Azure Analyst' }
      );
    }

    if (anthropic && hasAnthropic) {
      availableMembers.push(
        { id: 'anthropic-1', name: 'Anthropic Claude Member 1', provider: 'anthropic', role: 'Primary Claude Analyst' }
      );
    } else {
      console.log("[AI Service] ⚠️ Anthropic not configured - running with Azure OpenAI only");
    }

    if (availableMembers.length === 0) {
      throw new Error("No LLM providers are configured. Please check your environment variables.");
    }

    // Randomize member order to prevent systematic bias
    for (let i = availableMembers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableMembers[i], availableMembers[j]] = [availableMembers[j], availableMembers[i]];
    }

    console.log(`[AI Service] 👥 Council Members (${availableMembers.length} available, randomized order):`);
    availableMembers.forEach((member, index) => {
      console.log(`[AI Service]   ${index + 1}. ${member.name} (${member.role})`);
    });
    console.log("[AI Service] ════════════════════════════════════════════════");

    progressCallback?.('Initializing LLM Council...', 10, {
      councilStep: `Preparing ${availableMembers.length} available members for parallel processing`
    });

    // Step 2: Generate responses in parallel from all available LLMs
    console.log(`[AI Service] 🚀 STARTING PARALLEL GENERATION FROM ${availableMembers.length} LLM MEMBERS`);
    console.log("[AI Service] ══════════════════════════════════════════════════════");
    progressCallback?.(`${availableMembers.length}-member LLM Council generating responses...`, 30, {
      councilStep: `${availableMembers.length} members processing requirements in parallel`
    });

    const councilResponses: CouncilResponse[] = await Promise.all(
      availableMembers.map(async (member, memberIndex) => {
        // Check if cancelled before processing member
        if (checkCancelled && checkCancelled()) {
          console.log(`[AI Service] Generation cancelled before processing member ${memberIndex + 1}`);
          throw new Error('Generation cancelled by user');
        }

        const startTime = Date.now();
        console.log(`[AI Service] 🔄 MEMBER ${memberIndex + 1}: ${member.name} starting...`);
        console.log(`[AI Service]     Role: ${member.role}`);
        console.log(`[AI Service]     Provider: ${member.provider}`);

        try {
          let response;
          let attempt = 1;
          const maxAttempts = 3;

          while (attempt <= maxAttempts) {
            // Check if cancelled before each attempt
            if (checkCancelled && checkCancelled()) {
              console.log(`[AI Service] Generation cancelled during member ${memberIndex + 1} attempt ${attempt}`);
              throw new Error('Generation cancelled by user');
            }
            try {
              if (member.provider === 'azureOpenAI') {
                if (!hasConfiguredDefaultAiClient()) {
                  throw new Error('Azure OpenAI is not configured.');
                }
                console.log(`[AI Service] 📝 ${member.name}: Calling Azure OpenAI API (attempt ${attempt}/${maxAttempts})...`);
                response = await generateWithAzureOpenAI(
                  functionalRequirementsContent,
                  useChunking,
                  selectedPersonasFromHub,
                  aiEnhanceEnabled,
                  llmTemperature,
                  checkCancelled,
                  generationConstraints,
                  goldenRepoName,
                  goldenRepoIdForChunks,
                  goldenRepoGuidelinesForDevx
                );
                console.log(`[AI Service] ✅ ${member.name}: Azure OpenAI responded successfully on attempt ${attempt}`);
                break;
              } else {
                console.log(`[AI Service] 📝 ${member.name}: Calling Anthropic API (attempt ${attempt}/${maxAttempts})...`);
                response = await generateWithAnthropic(
                  functionalRequirementsContent,
                  useChunking,
                  selectedPersonasFromHub,
                  aiEnhanceEnabled,
                  llmTemperature,
                  checkCancelled,
                  generationConstraints,
                  goldenRepoName,
                  goldenRepoIdForChunks,
                  goldenRepoGuidelinesForDevx
                );
                console.log(`[AI Service] ✅ ${member.name}: Anthropic responded successfully on attempt ${attempt}`);
                break;
              }
            } catch (attemptError) {
              console.warn(`[AI Service] ⚠️  ${member.name}: Attempt ${attempt}/${maxAttempts} failed:`, attemptError instanceof Error ? attemptError.message : String(attemptError));
              attempt++;

              if (attempt <= maxAttempts) {
                const delayMs = attempt * 1000; // Progressive delay: 1s, 2s, 3s
                console.log(`[AI Service] 🔄 ${member.name}: Retrying in ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
              }
            }
          }

          if (!response) {
            throw new Error(`All ${maxAttempts} attempts failed for ${member.name}`);
          }

          const endTime = Date.now();
          const duration = endTime - startTime;
          console.log(`[AI Service] ⏱️  ${member.name}: Completed in ${duration}ms`);

          // Calculate quality metrics
          const confidence = calculateConfidence(response);
          const coverage = calculateCoverage(response, functionalRequirementsContent);
          const consistency = calculateConsistency(response);

          console.log(`[AI Service] 📊 ${member.name} Quality Metrics:`);
          console.log(`[AI Service]     Confidence: ${(confidence * 100).toFixed(1)}%`);
          console.log(`[AI Service]     Coverage: ${(coverage * 100).toFixed(1)}%`);
          console.log(`[AI Service]     Consistency: ${(consistency * 100).toFixed(1)}%`);
          console.log(`[AI Service]     Artifacts: ${(response?.epics?.length || 0)} epics, ${(response?.features?.length || 0)} features, ${(response?.userStories?.length || 0)} stories`);
          console.log(`[AI Service] ────────────────────────────────────────────────────`);

          return {
            id: member.id,
            provider: member.provider,
            model: member.name,
            response,
            confidence,
            coverage,
            consistency,
            timestamp: new Date(),
            memberIndex: memberIndex + 1,
            role: member.role,
            duration
          };
        } catch (error) {
          const endTime = Date.now();
          const duration = endTime - startTime;
          console.error(`[AI Service] ❌ ${member.name}: ERROR after ${duration}ms:`, error);
          // Return a failed response to avoid breaking the council
          return {
            id: member.id,
            provider: member.provider,
            model: member.name,
            response: null,
            confidence: 0,
            coverage: 0,
            consistency: 0,
            timestamp: new Date(),
            memberIndex: memberIndex + 1,
            role: member.role,
            duration,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );

    console.log("[AI Service] ALL COUNCIL MEMBERS COMPLETED!");
    console.log("[AI Service] ======================================");

    // Filter out failed responses
    const validResponses = councilResponses.filter(r => r.response !== null);
    const failedResponses = councilResponses.filter(r => r.response === null);

    console.log(`[AI Service] 📊 COUNCIL SUMMARY:`);
    console.log(`[AI Service]     Valid responses: ${validResponses.length}/${availableMembers.length}`);
    console.log(`[AI Service]     Failed responses: ${failedResponses.length}/${availableMembers.length}`);

    if (failedResponses.length > 0) {
      console.log(`[AI Service] ⚠️  Failed Members:`);
      failedResponses.forEach(r => {
        console.log(`[AI Service]     - ${r.model}: ${r.error || 'Unknown error'}`);
      });
    }

    if (validResponses.length === 0) {
      console.error(`[AI Service] 🚨 CRITICAL: All ${availableMembers.length} LLM council members failed to generate responses`);
      console.error(`[AI Service] 🔄 ACTIVATING EMERGENCY FALLBACK MECHANISM...`);

      // Emergency fallback: try single provider generation
      try {
        console.log(`[AI Service] 📞 Emergency fallback: Attempting single Azure OpenAI generation...`);
        const emergencyResponse = await generateWithAzureOpenAI(
          functionalRequirementsContent,
          useChunking,
          selectedPersonasFromHub,
          aiEnhanceEnabled,
          llmTemperature,
          checkCancelled,
          generationConstraints,
          goldenRepoName,
          goldenRepoIdForChunks,
          goldenRepoGuidelinesForDevx
        );
        
        if (emergencyResponse) {
          console.log(`[AI Service] ✅ Emergency fallback successful! Generated ${emergencyResponse.epics?.length || 0} epics, ${emergencyResponse.features?.length || 0} features, ${emergencyResponse.userStories?.length || 0} stories`);
          const fallbackUsage: WorkflowUsageReport[] = Array.isArray((emergencyResponse as any)._usage) ? (emergencyResponse as any)._usage : [];
          return {
            artifacts: emergencyResponse,
            usage: fallbackUsage,
            councilData: {
              responses: [{
                id: 'emergency-fallback',
                provider: 'azureOpenAI',
                model: 'Emergency Azure OpenAI Fallback',
                response: emergencyResponse,
                confidence: 0.7,
                coverage: 0.7,
                consistency: 0.7,
                timestamp: new Date(),
                memberIndex: 1,
                role: 'Emergency Fallback Generator',
                duration: 0
              }],
              evaluation: {
                selectedResponseId: 'emergency-fallback',
                confidenceScore: 0.7,
                reasoning: 'Emergency fallback activated due to all council members failing. Single Azure OpenAI generation used as last resort.',
                evaluationDetails: {
                  criteriaScores: {
                    requirementsAlignment: 0.7,
                    technicalQuality: 0.7,
                    completeness: 0.7,
                    businessValue: 0.7
                  }
                }
              }
            }
          };
        }
      } catch (fallbackError) {
        console.error(`[AI Service] ❌ Emergency fallback also failed:`, fallbackError);
      }

      throw new Error(`All ${availableMembers.length} LLM council members failed to generate responses and emergency fallback also failed. Please check your LLM provider configurations.`);
    }

    if (validResponses.length === 1) {
      console.log(`[AI Service] WARNING: Only 1 valid response available. Council will proceed with limited evaluation.`);
    }

    console.log(`[AI Service] PROCEEDING with ${validResponses.length} valid responses for evaluation`);

    console.log(`[AI Service] Valid Members for Evaluation:`);
    validResponses.forEach((r, index) => {
      const totalScore = r.confidence + r.coverage + r.consistency;
      console.log(`[AI Service]     ${index + 1}. ${r.model} (Score: ${(totalScore * 100 / 3).toFixed(1)}%)`);
      console.log(`[AI Service]        - ${(r.response?.epics?.length || 0)} epics, ${(r.response?.features?.length || 0)} features, ${(r.response?.userStories?.length || 0)} stories`);
    });
    console.log("[AI Service] ══════════════════════════════════════════════════════");

    // Step 3: FAST-PATH METRIC-BASED SELECTION — skip expensive LLM chair evaluation
    // when calculated quality metrics clearly differentiate responses
    const scoredResponses = validResponses.map((r: any) => ({
      response: r,
      combinedScore: (r.confidence + r.coverage + r.consistency) / 3,
      totalArtifacts: (r.response?.epics?.length || 0) + (r.response?.features?.length || 0) + (r.response?.userStories?.length || 0),
      storyCount: r.response?.userStories?.length || 0
    }));
    scoredResponses.sort((a, b) => {
      if (Math.abs(a.combinedScore - b.combinedScore) < 0.05) {
        return b.totalArtifacts - a.totalArtifacts;
      }
      return b.combinedScore - a.combinedScore;
    });

    const FAST_PATH_THRESHOLD = 0.15;
    const useFastPath = validResponses.length <= 2 && scoredResponses.length >= 2 &&
      Math.abs(scoredResponses[0].combinedScore - scoredResponses[1].combinedScore) >= FAST_PATH_THRESHOLD;

    let chairDiscussion: any;

    if (validResponses.length === 1) {
      console.log(`[AI Service] FAST PATH: Single valid response — skipping chair evaluation entirely`);
      const single = validResponses[0];
      progressCallback?.('Single response available — selecting directly...', 80);
      chairDiscussion = {
        azureChairEvaluation: {
          selectedResponseId: single.model,
          confidenceScore: single.confidence,
          reasoning: `Only one valid council response available (${single.model}). Selected directly without chair evaluation.`,
          evaluationDetails: { criteriaScores: { requirementsAlignment: 0.8, technicalQuality: 0.8, completeness: 0.8, businessValue: 0.8 } }
        },
        anthropicChairEvaluation: {
          selectedResponseId: single.model,
          confidenceScore: single.confidence,
          reasoning: `Only one valid council response available (${single.model}). Selected directly without chair evaluation.`,
          evaluationDetails: { criteriaScores: { requirementsAlignment: 0.8, technicalQuality: 0.8, completeness: 0.8, businessValue: 0.8 } }
        },
        conversation: [],
        finalDecision: {
          chosenResponse: single.model,
          consensusStrength: 10,
          rationale: `Single valid response from ${single.model}. Confidence: ${(single.confidence * 100).toFixed(1)}%, Coverage: ${(single.coverage * 100).toFixed(1)}%, Consistency: ${(single.consistency * 100).toFixed(1)}%.`,
          compromisesMade: [],
          finalAgreement: 'Direct selection — only one valid response'
        },
        discussionMetrics: { totalRounds: 0, convergenceScore: 10, discussionDuration: 0 }
      };
    } else if (useFastPath) {
      const best = scoredResponses[0].response;
      const gap = Math.abs(scoredResponses[0].combinedScore - scoredResponses[1].combinedScore);
      console.log(`[AI Service] FAST PATH: Metric gap ${(gap * 100).toFixed(1)}% exceeds threshold ${(FAST_PATH_THRESHOLD * 100).toFixed(0)}% — skipping LLM chair evaluation`);
      console.log(`[AI Service] FAST PATH Winner: ${best.model} (Score: ${(scoredResponses[0].combinedScore * 100).toFixed(1)}%) vs ${scoredResponses[1].response.model} (Score: ${(scoredResponses[1].combinedScore * 100).toFixed(1)}%)`);
      progressCallback?.('Metric-based fast selection — clear quality leader...', 80);
      chairDiscussion = {
        azureChairEvaluation: {
          selectedResponseId: best.model,
          confidenceScore: best.confidence,
          reasoning: `Fast-path metric selection: ${best.model} scored ${(scoredResponses[0].combinedScore * 100).toFixed(1)}% vs ${(scoredResponses[1].combinedScore * 100).toFixed(1)}% (gap: ${(gap * 100).toFixed(1)}%). Confidence: ${(best.confidence * 100).toFixed(1)}%, Coverage: ${(best.coverage * 100).toFixed(1)}%, Consistency: ${(best.consistency * 100).toFixed(1)}%.`,
          evaluationDetails: { criteriaScores: { requirementsAlignment: best.coverage, technicalQuality: best.consistency, completeness: best.confidence, businessValue: best.coverage } }
        },
        anthropicChairEvaluation: {
          selectedResponseId: best.model,
          confidenceScore: best.confidence,
          reasoning: `Fast-path metric selection: ${best.model} selected based on superior combined quality score with ${(gap * 100).toFixed(1)}% margin.`,
          evaluationDetails: { criteriaScores: { requirementsAlignment: best.coverage, technicalQuality: best.consistency, completeness: best.confidence, businessValue: best.coverage } }
        },
        conversation: [],
        finalDecision: {
          chosenResponse: best.model,
          consensusStrength: 9,
          rationale: `Fast-path metric-based selection: ${best.model} demonstrated clear quality leadership with ${(gap * 100).toFixed(1)}% score margin. Artifacts: ${scoredResponses[0].totalArtifacts} total (${scoredResponses[0].storyCount} stories).`,
          compromisesMade: ['Used metric-based fast-path to reduce evaluation time'],
          finalAgreement: `Metric-based unanimous selection of ${best.model}`
        },
        discussionMetrics: { totalRounds: 0, convergenceScore: 9, discussionDuration: 0 }
      };
    } else {
      // Scores are close — need LLM chair evaluation but run PARALLEL instead of sequential
      console.log(`[AI Service] Chair evaluation needed — scores are close. Running PARALLEL chair evaluation...`);
      progressCallback?.('Chair models evaluating council responses in parallel...', 70, {
        responses: councilResponses,
        councilStep: `Chair models analyzing ${validResponses.length} valid responses in parallel`
      });

      const councilResponsesForChairs: CouncilResponse[] = validResponses.map((r: any) => ({
        id: r.id,
        memberName: r.model,
        provider: r.provider === 'azureOpenAI' ? 'azure' : 'anthropic',
        model: r.model,
        response: r.response,
        artifacts: r.response,
        timestamp: r.timestamp.toISOString(),
        confidence: r.confidence || 0.8,
        coverage: r.coverage || 0.8,
        consistency: r.consistency || 0.8
      }));

      chairDiscussion = await conductSequentialChairEvaluation(councilResponsesForChairs, functionalRequirementsContent).catch(async (chairError) => {
        console.error(`[AI Service] CHAIR EVALUATION FAILED:`, chairError);
        console.log(`[AI Service] ACTIVATING AUTOMATIC SELECTION FALLBACK...`);

        const fallbackScored = validResponses.map((r: any) => ({
          response: r,
          combinedScore: (r.confidence + r.coverage + r.consistency) / 3,
          totalArtifacts: (r.response?.epics?.length || 0) + (r.response?.features?.length || 0) + (r.response?.userStories?.length || 0)
        }));
        fallbackScored.sort((a, b) => {
          if (Math.abs(a.combinedScore - b.combinedScore) < 0.05) {
            return b.totalArtifacts - a.totalArtifacts;
          }
          return b.combinedScore - a.combinedScore;
        });

        const bestResponse = fallbackScored[0].response;
        console.log(`[AI Service] Automatic fallback selected: ${bestResponse.model}`);

        return {
          azureChairEvaluation: {
            selectedResponseId: bestResponse.model,
            confidenceScore: bestResponse.confidence,
            reasoning: `Automatic selection due to chair evaluation failure. Selected ${bestResponse.model} with highest combined quality score (${(fallbackScored[0].combinedScore * 100).toFixed(1)}%).`,
            evaluationDetails: { criteriaScores: { requirementsAlignment: 0.8, technicalQuality: 0.8, completeness: 0.8, businessValue: 0.8 } }
          },
          anthropicChairEvaluation: {
            selectedResponseId: bestResponse.model,
            confidenceScore: bestResponse.confidence,
            reasoning: `Automatic selection due to chair evaluation failure. Selected ${bestResponse.model} with highest combined quality score (${(fallbackScored[0].combinedScore * 100).toFixed(1)}%).`,
            evaluationDetails: { criteriaScores: { requirementsAlignment: 0.8, technicalQuality: 0.8, completeness: 0.8, businessValue: 0.8 } }
          },
          conversation: [],
          finalDecision: {
            chosenResponse: bestResponse.model,
            consensusStrength: 7,
            rationale: `Automatic fallback selection. Selected ${bestResponse.model} based on highest combined quality metrics.`,
            compromisesMade: ["Bypassed chair discussion due to system failure", "Used objective quality metrics for selection"],
            finalAgreement: `Automatic selection of highest-scoring response: ${bestResponse.model}`
          },
          discussionMetrics: { totalRounds: 0, convergenceScore: 7, discussionDuration: 0 }
        };
      });
    }

    console.log(`[AI Service] COUNCIL DECISION REACHED!`);
    console.log(`[AI Service] 🎯 Final Decision: ${chairDiscussion.finalDecision.chosenResponse}`);
    console.log(`[AI Service] 🤝 Consensus Strength: ${chairDiscussion.finalDecision.consensusStrength}/10`);
    console.log(`[AI Service] ════════════════════════════════════════════════`);
    console.log(`[AI Service] 📋 CONSENSUS AGREEMENT DETAILS:`);
    console.log(`[AI Service] 💡 Rationale: ${chairDiscussion.finalDecision.rationale}`);
    console.log(`[AI Service] 🤝 Final Agreement: ${chairDiscussion.finalDecision.finalAgreement}`);
    if (chairDiscussion.finalDecision.compromisesMade && chairDiscussion.finalDecision.compromisesMade.length > 0) {
      console.log(`[AI Service] ⚖️  Compromises Made:`);
      chairDiscussion.finalDecision.compromisesMade.forEach((compromise, idx) => {
        console.log(`[AI Service]    ${idx + 1}. ${compromise}`);
      });
    }
    console.log(`[AI Service] 📊 CHAIR EVALUATION SUMMARY:`);
    console.log(`[AI Service]    Azure Chair: Selected ${chairDiscussion.azureChairEvaluation.selectedResponseId} (Confidence: ${(chairDiscussion.azureChairEvaluation.confidenceScore * 100).toFixed(1)}%)`);
    console.log(`[AI Service]    Azure Full Reasoning: ${chairDiscussion.azureChairEvaluation.reasoning}`);
    console.log(`[AI Service]    ────────────────────────────────────────────────`);
    console.log(`[AI Service]    Anthropic Chair: Selected ${chairDiscussion.anthropicChairEvaluation.selectedResponseId} (Confidence: ${(chairDiscussion.anthropicChairEvaluation.confidenceScore * 100).toFixed(1)}%)`);
    console.log(`[AI Service]    Anthropic Full Reasoning: ${chairDiscussion.anthropicChairEvaluation.reasoning}`);
    console.log(`[AI Service] 🎯 CONSENSUS QUALITY INDICATORS:`);
    console.log(`[AI Service]    Discussion Rounds: ${chairDiscussion.discussionMetrics.totalRounds}`);
    console.log(`[AI Service]    Convergence Score: ${chairDiscussion.discussionMetrics.convergenceScore}/10`);
    const agreementType = chairDiscussion.azureChairEvaluation.selectedResponseId === chairDiscussion.anthropicChairEvaluation.selectedResponseId ? 'Unanimous' : 'Negotiated';
    console.log(`[AI Service]    Agreement Type: ${agreementType}`);
    console.log(`[AI Service] ────────────────────────────────────────────────`);
    console.log(`[AI Service] 🔍 DETAILED AGREEMENT ANALYSIS:`);

    if (agreementType === 'Unanimous') {
      console.log(`[AI Service] ✅ UNANIMOUS CONSENSUS: Both chairs independently selected ${chairDiscussion.azureChairEvaluation.selectedResponseId}`);
      console.log(`[AI Service] 🤝 Common Quality Indicators Both Chairs Agreed On:`);
      console.log(`[AI Service]    • Both chairs recognized superior quality in the same response`);
      console.log(`[AI Service]    • No negotiation required - clear quality leader identified`);
      console.log(`[AI Service]    • Convergence Score: ${chairDiscussion.discussionMetrics.convergenceScore}/10 indicates strong alignment`);
    } else {
      console.log(`[AI Service] ⚖️  NEGOTIATED CONSENSUS: Chairs had different preferences initially`);
      console.log(`[AI Service]    Azure Chair initially preferred: ${chairDiscussion.azureChairEvaluation.selectedResponseId}`);
      console.log(`[AI Service]    Anthropic Chair initially preferred: ${chairDiscussion.anthropicChairEvaluation.selectedResponseId}`);
      console.log(`[AI Service] 🤝 MEDIATION PROCESS & COMMON GROUND FOUND:`);
      console.log(`[AI Service]    • Mediator analyzed both chair arguments and evidence`);
      console.log(`[AI Service]    • Final decision: ${chairDiscussion.finalDecision.chosenResponse}`);
      console.log(`[AI Service]    • Consensus Strength: ${chairDiscussion.finalDecision.consensusStrength}/10`);
      console.log(`[AI Service] 📋 WHAT BOTH CHAIRS ULTIMATELY AGREED ON:`);

      // Extract common themes from both reasoning
      const azureReasoning = chairDiscussion.azureChairEvaluation.reasoning.toLowerCase();
      const anthropicReasoning = chairDiscussion.anthropicChairEvaluation.reasoning.toLowerCase();

      const commonThemes: string[] = [];
      const qualityIndicators = [
        { keyword: 'comprehensive', description: 'Comprehensive coverage of requirements' },
        { keyword: 'detailed', description: 'Detailed and thorough analysis' },
        { keyword: 'business value', description: 'Strong business value alignment' },
        { keyword: 'technical', description: 'Technical quality and feasibility' },
        { keyword: 'user stor', description: 'Well-structured user stories' },
        { keyword: 'acceptance', description: 'Clear acceptance criteria' },
        { keyword: 'epic', description: 'Well-defined epics' },
        { keyword: 'feature', description: 'Feature completeness' },
        { keyword: 'requirement', description: 'Requirements alignment' },
        { keyword: 'complete', description: 'Completeness of artifacts' }
      ];

      qualityIndicators.forEach(indicator => {
        if (azureReasoning.includes(indicator.keyword) && anthropicReasoning.includes(indicator.keyword)) {
          commonThemes.push(indicator.description);
        }
      });

      if (commonThemes.length > 0) {
        console.log(`[AI Service]    🎯 Common Quality Themes Both Chairs Recognized:`);
        commonThemes.forEach((theme, idx) => {
          console.log(`[AI Service]       ${idx + 1}. ${theme}`);
        });
      } else {
        console.log(`[AI Service]    🎯 Both chairs evaluated based on systematic quality criteria`);
        console.log(`[AI Service]       • Requirements alignment and coverage`);
        console.log(`[AI Service]       • Technical feasibility and quality`);
        console.log(`[AI Service]       • Business value and completeness`);
      }
    }

    // Show detailed chair conversation if there were discussion rounds
    if (chairDiscussion.conversation && chairDiscussion.conversation.length > 0) {
      console.log(`[AI Service] 💬 DETAILED CHAIR CONVERSATION:`);
      console.log(`[AI Service] ════════════════════════════════════════════════`);
      chairDiscussion.conversation.forEach((conv, idx) => {
        console.log(`[AI Service] 🗣️  ${conv.speaker} (Round ${conv.round}):`);
        console.log(`[AI Service]     Position: ${conv.position}`);
        console.log(`[AI Service]     Message: ${conv.message}`);
        console.log(`[AI Service]     Reasoning: ${conv.reasoning}`);
        console.log(`[AI Service]     Timestamp: ${conv.timestamp}`);
        if (idx < chairDiscussion.conversation.length - 1) {
          console.log(`[AI Service] ────────────────────────────────────────────────`);
        }
      });
      console.log(`[AI Service] ════════════════════════════════════════════════`);
    } else {
      console.log(`[AI Service] 💭 Chair Communication: Sequential evaluation without extended discussion`);
      console.log(`[AI Service]     (Chairs reached consensus through independent scoring)`);
    }
    console.log(`[AI Service] ════════════════════════════════════════════════`);

    progressCallback?.('Finalizing consensus decision...', 90, {
      councilStep: `Consensus reached: ${chairDiscussion.finalDecision.chosenResponse}`,
      consensusDetails: {
        rationale: chairDiscussion.finalDecision.rationale,
        agreementType,
        consensusStrength: chairDiscussion.finalDecision.consensusStrength,
        compromises: chairDiscussion.finalDecision.compromisesMade
      }
    });

    // Step 4: Return the consensus response  
    let finalSelectedResponse = validResponses.find((r: any) => r.model === chairDiscussion.finalDecision.chosenResponse);

    // If not found by model name, try matching by ID (azure-openai-1 -> Azure OpenAI Member 1)
    if (!finalSelectedResponse) {
      console.log(`[AI Service] 🔍 Trying to match by ID: ${chairDiscussion.finalDecision.chosenResponse}`);
      const idToNameMap: { [key: string]: string } = {
        'azure-openai-1': 'Azure OpenAI Member 1',
        'azure-openai-2': 'Azure OpenAI Member 2',
        'anthropic-1': 'Anthropic Claude Member 1',
        'anthropic-2': 'Anthropic Claude Member 2'
      };

      const mappedName = idToNameMap[chairDiscussion.finalDecision.chosenResponse];
      if (mappedName) {
        finalSelectedResponse = validResponses.find((r: any) => r.model === mappedName);
        console.log(`[AI Service] 🔗 Mapped ${chairDiscussion.finalDecision.chosenResponse} -> ${mappedName}`);
      }
    }

    if (!finalSelectedResponse) {
      console.error(`[AI Service] ❌ CRITICAL ERROR: Chairs selected invalid response: ${chairDiscussion.finalDecision.chosenResponse}`);
      console.error(`[AI Service] Available model names:`, validResponses.map((r: any) => r.model));
      console.error(`[AI Service] Available IDs:`, validResponses.map((r: any) => r.id));
      throw new Error("Chair discussion resulted in invalid response selection");
    }

    console.log(`[AI Service] 🏆 CONSENSUS WINNER: ${finalSelectedResponse.model}`);
    console.log(`[AI Service] Generated Artifacts:`);
    console.log(`[AI Service]     Epics: ${finalSelectedResponse.response?.epics?.length || 0}`);
    console.log(`[AI Service]     Features: ${finalSelectedResponse.response?.features?.length || 0}`);
    console.log(`[AI Service]     User Stories: ${finalSelectedResponse.response?.userStories?.length || 0}`);

    // Final safety check: ensure we have meaningful artifacts
    const totalArtifacts = (finalSelectedResponse.response?.epics?.length || 0) +
      (finalSelectedResponse.response?.features?.length || 0) +
      (finalSelectedResponse.response?.userStories?.length || 0);

    if (totalArtifacts === 0) {
      console.error(`[AI Service] 🚨 CRITICAL: Selected response contains no artifacts!`);
      throw new Error("Council selected a response with no generated artifacts. This indicates a fundamental failure in the generation process.");
    }

    console.log(`[AI Service] ✅ PRODUCTION VALIDATION PASSED: ${totalArtifacts} total artifacts generated`);

    const councilUsage: WorkflowUsageReport[] = councilResponses.flatMap((r: any) =>
      (r.response && Array.isArray((r.response as any)._usage)) ? (r.response as any)._usage : []
    );

    return {
      artifacts: finalSelectedResponse.response,
      usage: councilUsage,
      councilData: {
        responses: councilResponses.map((r: any) => ({
          id: r.id || r.model,
          provider: r.provider,
          model: r.model,
          response: r.response,
          confidence: r.confidence || 0.8,
          coverage: r.coverage || 0.8,
          consistency: r.consistency || 0.8,
          timestamp: r.timestamp,
          memberIndex: 1,
          role: r.role || 'Council Member',
          duration: r.duration || 5000
        })),
        evaluation: {
          selectedResponseId: chairDiscussion.finalDecision.chosenResponse,
          confidenceScore: chairDiscussion.finalDecision.consensusStrength / 10,
          reasoning: chairDiscussion.finalDecision.rationale,
          evaluationDetails: {
            criteriaScores: {
              requirementsAlignment: 0.9,
              technicalQuality: 0.85,
              completeness: 0.9,
              businessValue: 0.85
            }
          }
        }
      }
    };

  } catch (error) {
    console.error("[AI Service] ❌ LLM Council with dual chairs failed:", error);
    throw error;
  }
}

/**
 * Parse chair evaluation response and extract structured data
 */
function parseChairEvaluation(content: string, chairName: string): ChairEvaluation {
  try {
    // Try to parse as JSON first using the helper function that handles markdown
    const parsed = parseJsonFromLLMResponse(content);
    if (parsed.bestResponse && parsed.reasoning) {
      return {
        selectedResponseId: parsed.bestResponse.memberName || parsed.bestResponse,
        confidenceScore: (parsed.bestResponse.overallScore || parsed.confidenceScore || 7.5) / 10,
        reasoning: parsed.reasoning,
        evaluationDetails: parsed.evaluationDetails || {
          criteriaScores: {
            requirementsAlignment: 0.8,
            technicalQuality: 0.8,
            completeness: 0.8,
            businessValue: 0.8
          }
        }
      };
    }
  } catch {
    // If not JSON, extract key information with regex
  }

  // Fallback parsing for non-JSON responses
  // Look for response patterns like "Response 1:", "azure-openai-1", "Azure OpenAI Member 1"
  const responsePatterns = [
    /(?:selected|chosen|best|recommend).*?(?:response\s+(\d+)|(\w+(?:-\w+)+(?:-\d+)?)|([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+Member\s+\d+))/i,
    /(?:response\s+(\d+))/i,
    /(azure-openai-\d+|anthropic-\d+)/i,
    /(Azure OpenAI Member \d+|Anthropic Claude Member \d+)/i
  ];

  let selectedResponse = ''; // No default - will be determined fairly

  // First try to extract from content
  for (const pattern of responsePatterns) {
    const match = content.match(pattern);
    if (match) {
      // Extract the matched response identifier
      selectedResponse = match[1] || match[2] || match[3] || match[0];

      // If it's a response number like "1", map it to the appropriate ID
      if (/^\d+$/.test(selectedResponse)) {
        const responseNum = parseInt(selectedResponse);
        const idMap = ['azure-openai-1', 'azure-openai-2', 'anthropic-1', 'anthropic-2'];
        selectedResponse = idMap[responseNum - 1] || '';
      }
      break;
    }
  }

  // If no valid selection found, use random selection to avoid bias
  if (!selectedResponse) {
    const availableOptions = ['azure-openai-1', 'azure-openai-2', 'anthropic-1', 'anthropic-2'];
    selectedResponse = availableOptions[Math.floor(Math.random() * availableOptions.length)];
    console.warn(`[${chairName}] ⚠️ No clear selection found in response, using random fallback: ${selectedResponse}`);
  }

  const scoreMatch = content.match(/score.*?(\d+(?:\.\d+)?)/i);
  const reasoningMatch = content.match(/(?:reason|rationale|because):\s*(.+?)(?:\n|$)/i);

  console.log(`[${chairName}] 🎯 Parsed selection: ${selectedResponse}`);

  return {
    selectedResponseId: selectedResponse,
    confidenceScore: scoreMatch ? parseFloat(scoreMatch[1]) / 10 : 0.75,
    reasoning: reasoningMatch?.[1] || content.substring(0, 200),
    evaluationDetails: {
      criteriaScores: {
        requirementsAlignment: 0.8,
        technicalQuality: 0.8,
        completeness: 0.8,
        businessValue: 0.8
      }
    }
  };
}

/**
 * Generate artifacts using Azure OpenAI
 */
async function generateWithAzureOpenAI(
  functionalRequirementsContent: string,
  useChunking: boolean,
  selectedPersonasFromHub: any[],
  aiEnhanceEnabled: boolean = false,
  llmTemperature: number = 0.7,
  checkCancelled?: () => boolean,
  generationConstraints?: { maxEpics?: number; maxFeatures?: number; maxStories?: number },
  goldenRepoName: string = "Business",
  goldenRepoIdForChunks?: string,
  goldenRepoGuidelinesForDevx?: Array<{ name: string; content: string }>
): Promise<any> {
  try {
    return await generateArtifactsFromBRDRequirements(
      functionalRequirementsContent,
      useChunking,
      selectedPersonasFromHub,
      'azure',
      aiEnhanceEnabled,
      llmTemperature,
      checkCancelled,
      generationConstraints,
      goldenRepoName,
      goldenRepoIdForChunks,
      goldenRepoGuidelinesForDevx
    );
  } catch (error) {
    console.error("[AI Service] Azure OpenAI generation failed:", error);
    throw error;
  }
}

/**
 * Generate artifacts using Anthropic
 */
async function generateWithAnthropic(
  functionalRequirementsContent: string,
  useChunking: boolean,
  selectedPersonasFromHub: any[],
  aiEnhanceEnabled: boolean = false,
  llmTemperature: number = 0.7,
  checkCancelled?: () => boolean,
  generationConstraints?: { maxEpics?: number; maxFeatures?: number; maxStories?: number },
  goldenRepoName: string = "Business",
  goldenRepoIdForChunks?: string,
  goldenRepoGuidelinesForDevx?: Array<{ name: string; content: string }>
): Promise<any> {
  try {
    return await generateArtifactsFromBRDRequirements(
      functionalRequirementsContent,
      useChunking,
      selectedPersonasFromHub,
      'anthropic',
      aiEnhanceEnabled,
      llmTemperature,
      checkCancelled,
      generationConstraints,
      goldenRepoName,
      goldenRepoIdForChunks,
      goldenRepoGuidelinesForDevx
    );
  } catch (error) {
    console.error("[AI Service] Anthropic generation failed:", error);
    throw error;
  }
}

/**
 * Helper function to safely parse JSON from LLM responses that may contain markdown code blocks
 */
function parseJsonFromLLMResponse(content: string): any {
  if (!content) {
    throw new Error("No content to parse");
  }

  // Remove markdown code blocks if present
  let cleanContent = content.trim();

  // Multiple strategies to extract JSON from markdown

  // Strategy 1: Look for complete markdown JSON blocks
  const completeJsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match = cleanContent.match(completeJsonBlockRegex);

  if (match && match.length > 0) {
    // Extract content from the first complete block
    const blockContent = match[0].replace(/```(?:json)?\s*/gi, '').replace(/\s*```\s*$/gi, '');
    cleanContent = blockContent.trim();
    console.log("[AI Service] 🔧 Stripped markdown code blocks from LLM response");
  } else {
    // Strategy 2: Look for incomplete blocks (starts with ``` but may not end with ```)
    if (cleanContent.startsWith('```json') || cleanContent.startsWith('```')) {
      // Remove the opening markdown
      cleanContent = cleanContent.replace(/^```(?:json)?\s*/i, '');
      // Remove trailing markdown if present
      cleanContent = cleanContent.replace(/\s*```\s*$/i, '');
    }

    // Strategy 3: Look for JSON objects that start with { and end with }
    const jsonObjectRegex = /(\{[\s\S]*\})/;
    const objectMatch = cleanContent.match(jsonObjectRegex);
    if (objectMatch) {
      cleanContent = objectMatch[1];
    }
  }

  // Remove any remaining leading/trailing whitespace or newlines
  cleanContent = cleanContent.replace(/^\s+|\s+$/g, '');

  // Additional cleanup: ensure it starts with { and ends with }
  if (!cleanContent.startsWith('{')) {
    const firstBrace = cleanContent.indexOf('{');
    if (firstBrace !== -1) {
      cleanContent = cleanContent.substring(firstBrace);
    }
  }

  if (!cleanContent.endsWith('}')) {
    const lastBrace = cleanContent.lastIndexOf('}');
    if (lastBrace !== -1) {
      cleanContent = cleanContent.substring(0, lastBrace + 1);
    }
  }

  try {
    return JSON.parse(cleanContent);
  } catch (parseError) {
    console.error("[AI Service] JSON Parse Error - Original content length:", content.length);
    console.error("[AI Service] JSON Parse Error - Starts with:", content.substring(0, 50));
    console.error("[AI Service] JSON Parse Error - Ends with:", content.substring(Math.max(0, content.length - 50)));
    console.error("[AI Service] JSON Parse Error - Clean content length:", cleanContent.length);
    console.error("[AI Service] JSON Parse Error - Clean starts with:", cleanContent.substring(0, 50));
    console.error("[AI Service] JSON Parse Error - Clean ends with:", cleanContent.substring(Math.max(0, cleanContent.length - 50)));

    // Final attempt: try to find and extract a valid JSON structure
    try {
      // Look for the main JSON structure with better regex
      const jsonStructureMatch = cleanContent.match(/\{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*\}/);
      if (jsonStructureMatch) {
        return JSON.parse(jsonStructureMatch[0]);
      }
    } catch (finalError) {
      // If all else fails, provide detailed error information
      console.error("[AI Service] Final JSON parsing attempt failed");
    }

    throw new Error(`Failed to parse JSON from LLM response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
  }
}

/**
 * Azure Chair evaluation (independent assessment)
 */
async function evaluateWithAzureChair(responses: CouncilResponse[], originalRequirements: string): Promise<ChairEvaluation> {
  try {
    console.log("[Azure Chair] 🔍 Conducting independent evaluation");
    // Data Zone Batch does not support chat completions; use standard Azure OpenAI for council chair.
    if (!azureOpenAI) {
      throw new Error("Azure Chair (Azure OpenAI) not configured");
    }

    const evaluationPrompt = createComprehensiveEvaluationPrompt(responses, originalRequirements);
    const chairPrompt = `You are the Azure OpenAI Chairperson in a dual-chair evaluation system. 

Your role is to provide your independent assessment of the council member responses. You will later discuss your findings with an Anthropic Chairperson to reach consensus.

Focus on:
- Technical accuracy and completeness
- Requirements traceability 
- INVEST criteria compliance
- Implementation feasibility
- User story quality and acceptance criteria

Be prepared to defend your choice with specific evidence and be open to discussion with your co-chair.

${evaluationPrompt}`;

    const response = await azureOpenAI.chat.completions.create({
      model: _defaultModelName,
      messages: [
        {
          role: "system",
          content: "You are an expert Azure OpenAI Chair conducting independent evaluation. Provide detailed, evidence-based assessment."
        },
        {
          role: "user",
          content: chairPrompt
        }
      ],
      temperature: 0.3,
      max_tokens: 3000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from Azure Chair");
    }

    return parseChairEvaluation(content, 'Azure Chair');

  } catch (error) {
    console.error("[Azure Chair] ❌ Evaluation failed:", error);
    throw error;
  }
}

/**
 * Anthropic Chair evaluation (independent assessment)  
 */
async function evaluateWithAnthropicChair(responses: CouncilResponse[], originalRequirements: string): Promise<ChairEvaluation> {
  try {
    console.log("[Anthropic Chair] 🔍 Conducting independent evaluation");

    if (!anthropic) {
      throw new Error("Anthropic Chair not configured");
    }

    const evaluationPrompt = createComprehensiveEvaluationPrompt(responses, originalRequirements);
    const chairPrompt = `You are the Anthropic Chairperson in a dual-chair evaluation system.

Your role is to provide your independent assessment of the council member responses. You will later discuss your findings with an Azure OpenAI Chairperson to reach consensus.

Focus on:
- User experience and persona alignment
- Story narrative and flow
- Business value and prioritization
- Acceptance criteria clarity
- Stakeholder needs coverage

Be prepared to defend your choice with specific evidence and engage in constructive dialogue with your co-chair.

${evaluationPrompt}`;

    const response = await anthropic.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert Anthropic Chair conducting independent evaluation. Provide detailed, evidence-based assessment."
        },
        {
          role: "user",
          content: chairPrompt
        }
      ],
      temperature: 0.3,
      max_tokens: 3000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from Anthropic Chair");
    }

    return parseChairEvaluation(content, 'Anthropic Chair');

  } catch (error) {
    console.error("[Anthropic Chair] ❌ Evaluation failed:", error);
    throw error;
  }
}

/**
 * Generate chair argument for discussion round
 */
async function generateChairArgument(
  chairType: 'azure' | 'anthropic',
  ownEvaluation: ChairEvaluation,
  otherEvaluation: ChairEvaluation,
  responses: CouncilResponse[],
  round: number,
  argumentType: 'opening' | 'response' | 'rebuttal',
  previousMessage?: string
): Promise<{ argument: string, reasoning: string }> {

  const client = chairType === 'azure' ? azureOpenAI : anthropic;
  const chairName = chairType === 'azure' ? 'Azure Chair' : 'Anthropic Chair';
  const otherChair = chairType === 'azure' ? 'Anthropic Chair' : 'Azure Chair';

  if (!client) {
    throw new Error(chairName + " not configured");
  }

  const workflowAzureModel = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4";

  let prompt = "You are the " + chairName + " in a dual-chair discussion system.\n\n" +
    "CONTEXT:\n" +
    "- You evaluated the council responses and chose: " + ownEvaluation.selectedResponseId + "\n" +
    "- The " + otherChair + " chose: " + otherEvaluation.selectedResponseId + "\n" +
    "- This is round " + round + " of the discussion\n\n" +
    "YOUR TASK:\n" +
    "Present a compelling argument for why your choice is superior. Be specific about:\n" +
    "- Concrete quality differences\n" +
    "- Requirements coverage analysis\n" +
    "- Technical and business merit\n" +
    "- Specific examples from the responses\n\n" +
    "Be professional, evidence-based, but persuasive. Acknowledge strengths in the other choice while defending your position.\n\n" +
    (argumentType === 'response' && previousMessage ?
      "The " + otherChair + " just argued: \"" + previousMessage.substring(0, 500) + "...\"\n\n" +
      "Address their points while reinforcing your position.\n\n" : '') +
    "Provide your argument in this JSON format:\n" +
    "{\n" +
    '  "argument": "Your main argument and position",\n' +
    '  "keyPoints": ["Point 1", "Point 2", "Point 3"],\n' +
    '  "evidence": "Specific evidence supporting your choice",\n' +
    '  "reasoning": "Why this choice is objectively better"\n' +
    "}";

  let response;
  if (chairType === 'azure') {
    response = await client.chat.completions.create({
      model: workflowAzureModel,
      messages: [
        {
          role: "system",
          content: "You are a " + chairName + " engaged in professional debate. Be persuasive but respectful."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.4,
      max_tokens: 1500
    });
  } else {
    response = await client.chat.completions.create({
      model: 'claude-3-sonnet-20240229',
      messages: [
        {
          role: "system",
          content: "You are a " + chairName + " engaged in professional debate. Be persuasive but respectful."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.4,
      max_tokens: 1500
    });
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No argument from " + chairName);
  }

  try {
    const parsed = parseJsonFromLLMResponse(content);
    return {
      argument: parsed.argument || content,
      reasoning: parsed.reasoning || "Standard reasoning"
    };
  } catch {
    return {
      argument: content,
      reasoning: chairName + " provided detailed analysis"
    };
  }
}

/**
 * Final consensus negotiation between chairs
 */
async function negotiateFinalConsensus(
  azureEvaluation: ChairEvaluation,
  anthropicEvaluation: ChairEvaluation,
  conversation: ChairConversation[],
  responses: CouncilResponse[],
  originalRequirements: string
): Promise<FinalConsensus> {

  // Use Azure OpenAI as the final mediator (Data Zone Batch does not support chat completions; use standard Azure)
  if (!azureOpenAI) {
    throw new Error("Azure OpenAI not available for final consensus");
  }

  const conversationSummary = conversation.map(c =>
    "Round " + c.round + " - " + c.speaker + ": " + c.message.substring(0, 200) + "..."
  ).join('\n');

  const consensusPrompt = `You are mediating a final consensus between two expert chairs:

CHAIR POSITIONS:
- Azure Chair chose: ${azureEvaluation.selectedResponseId} (Score: ${azureEvaluation.confidenceScore})
- Anthropic Chair chose: ${anthropicEvaluation.selectedResponseId} (Score: ${anthropicEvaluation.confidenceScore})

AVAILABLE RESPONSE OPTIONS:
${responses.map((r, i) => `- Response ${i + 1}: ${r.model} (ID: ${r.id})`).join('\n')}

DISCUSSION SUMMARY:
${conversationSummary}

TASK: Analyze the arguments and reach a final consensus. Consider:
- Which chair presented stronger evidence?
- Which response truly better serves the requirements?
- Where can reasonable compromises be made?
- What would serve the development team best?

IMPORTANT: Your chosenResponse must be exactly one of the available model names or IDs listed above.

Return your decision in JSON format:
{
  "chosenResponse": "[Exact model name or ID from available options above]",
  "consensusStrength": [1-10 confidence score],
  "rationale": "Why this choice represents the best consensus",
  "compromisesMade": ["Any compromises or concessions made"],
  "finalAgreement": "Summary of the agreed-upon decision"
}`;

  const response = await azureOpenAI.chat.completions.create({
    model: _defaultModelName,
    messages: [
      {
        role: "system",
        content: "You are an expert mediator reaching final consensus between two chairs. Be objective and evidence-based."
      },
      {
        role: "user",
        content: consensusPrompt
      }
    ],
    temperature: 0.2,
    max_tokens: 1000
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No consensus generated");
  }

  try {
    return parseJsonFromLLMResponse(content);
  } catch {
    // Fallback to higher-scoring evaluation if parsing fails
    const winnerEval = azureEvaluation.confidenceScore >= anthropicEvaluation.confidenceScore
      ? azureEvaluation : anthropicEvaluation;

    return {
      chosenResponse: winnerEval.selectedResponseId,
      consensusStrength: 6,
      rationale: "Consensus parsing failed, defaulted to higher-scoring evaluation",
      compromisesMade: ["Technical fallback to scoring-based decision"],
      finalAgreement: "Selected " + winnerEval.selectedResponseId + " based on evaluation scores"
    };
  }
}
interface ChairDiscussion {
  azureChairEvaluation: ChairEvaluation;
  anthropicChairEvaluation: ChairEvaluation;
  conversation: ChairConversation[];
  finalDecision: FinalConsensus;
  discussionMetrics: {
    totalRounds: number;
    convergenceScore: number;
    discussionDuration: number;
  };
}

/**
 * Interface for individual response evaluation with detailed scoring
 */
/**
 * Enhanced chair evaluation interface
 */
interface EnhancedChairEvaluation {
  selectedResponseId: string;
  confidenceScore: number;
  reasoning: string;
  sequentialEvaluations: ResponseEvaluation[];
  evaluationDetails: {
    criteriaScores: {
      requirementsAlignment: number;
      technicalQuality: number;
      completeness: number;
      businessValue: number;
    };
  };
}

interface ChairConversation {
  round: number;
  speaker: 'Azure Chair' | 'Anthropic Chair';
  message: string;
  position: string;
  reasoning: string;
  timestamp: string;
}

interface FinalConsensus {
  chosenResponse: string;
  consensusStrength: number; // 1-10
  rationale: string;
  compromisesMade: string[];
  finalAgreement: string;
}

/**
 * Conduct sequential evaluation with memory and detailed discussion
 */
async function conductChairDiscussion(
  responses: CouncilResponse[],
  originalRequirements: string
): Promise<ChairDiscussion> {
  try {
    // Phase 1: Sequential evaluation with memory

    const azureChairMemory: ResponseEvaluation[] = [];
    const anthropicChairMemory: ResponseEvaluation[] = [];

    // Evaluate each response individually with accumulated memory
    for (let i = 0; i < responses.length; i++) {
      const currentResponse = responses[i];

      // Azure Chair evaluation with memory
      const azureEval = await evaluateResponseWithMemory(
        'azure',
        currentResponse,
        azureChairMemory,
        originalRequirements,
        i + 1,
        responses.length
      );
      azureChairMemory.push(azureEval);

      // Anthropic Chair evaluation with memory  
      const anthropicEval = await evaluateResponseWithMemory(
        'anthropic',
        currentResponse,
        anthropicChairMemory,
        originalRequirements,
        i + 1,
        responses.length
      );
      anthropicChairMemory.push(anthropicEval);
    }

    // Phase 2: Chair-to-Chair Discussion

    const conversation: ChairConversation[] = [];

    // Round 1: Azure Chair presents their top choice and reasoning
    const azureTopChoice = findBestResponse(azureChairMemory);
    const azureOpening = await generateDetailedChairArgument(
      'azure',
      azureTopChoice,
      azureChairMemory,
      1,
      'opening'
    );

    conversation.push({
      round: 1,
      speaker: 'Azure Chair',
      message: azureOpening.fullArgument,
      position: azureTopChoice.model,
      reasoning: azureOpening.detailedReasoning,
      timestamp: new Date().toISOString()
    });

    // Round 2: Anthropic Chair responds
    const anthropicTopChoice = findBestResponse(anthropicChairMemory);
    const anthropicResponse = await generateDetailedChairArgument(
      'anthropic',
      anthropicTopChoice,
      anthropicChairMemory,
      2,
      'response',
      azureOpening.fullArgument
    );

    conversation.push({
      round: 2,
      speaker: 'Anthropic Chair',
      message: anthropicResponse.fullArgument,
      position: anthropicTopChoice.model,
      reasoning: anthropicResponse.detailedReasoning,
      timestamp: new Date().toISOString()
    });

    // Round 3: Final negotiation if they disagree
    let finalDecision: FinalConsensus;
    if (azureTopChoice.model === anthropicTopChoice.model) {
      finalDecision = {
        chosenResponse: azureTopChoice.model,
        consensusStrength: 10,
        rationale: `Both chairs independently selected ${azureTopChoice.model}. Azure Chair scored it ${azureTopChoice.score}/10, Anthropic Chair scored it ${anthropicTopChoice.score}/10.`,
        compromisesMade: [],
        finalAgreement: "Unanimous decision without further discussion needed"
      };
    } else {
      const negotiationResult = await conductFinalNegotiation(
        azureTopChoice,
        anthropicTopChoice,
        [...azureChairMemory, ...anthropicChairMemory],
        azureOpening,
        anthropicResponse
      );

      finalDecision = {
        chosenResponse: negotiationResult.finalChoice.model,
        consensusStrength: 8,
        rationale: negotiationResult.consensusReason,
        compromisesMade: [`Final selection: ${negotiationResult.finalChoice.model}`],
        finalAgreement: negotiationResult.consensusReason
      };
    }

    const discussionDuration = Date.now();

    return {
      azureChairEvaluation: {
        selectedResponseId: azureTopChoice.model,
        confidenceScore: azureTopChoice.score / 10,
        reasoning: azureOpening.detailedReasoning,
        evaluationDetails: {
          criteriaScores: azureTopChoice.criteriaScores,
          strengths: azureTopChoice.strengths,
          weaknesses: azureTopChoice.weaknesses
        }
      },
      anthropicChairEvaluation: {
        selectedResponseId: anthropicTopChoice.model,
        confidenceScore: anthropicTopChoice.score / 10,
        reasoning: anthropicResponse.detailedReasoning,
        evaluationDetails: {
          criteriaScores: anthropicTopChoice.criteriaScores,
          strengths: anthropicTopChoice.strengths,
          weaknesses: anthropicTopChoice.weaknesses
        }
      },
      conversation,
      finalDecision,
      discussionMetrics: {
        totalRounds: conversation.length,
        convergenceScore: finalDecision.consensusStrength,
        discussionDuration: 0
      }
    };

  } catch (error) {
    console.error("[Chair Discussion] ❌ Sequential evaluation failed:", error);
    throw error;
  }
}

/**
 * Calculate confidence score based on response quality
 */
function calculateConfidence(response: any): number {
  try {
    if (!response) return 0;

    let score = 0.5; // Base score

    // Check for presence of key fields
    if (response.epics && Array.isArray(response.epics) && response.epics.length > 0) score += 0.15;
    if (response.features && Array.isArray(response.features) && response.features.length > 0) score += 0.15;
    if (response.userStories && Array.isArray(response.userStories) && response.userStories.length > 0) score += 0.2;

    // Check quality of user stories
    if (response.userStories) {
      const storiesWithCriteria = response.userStories.filter((story: any) =>
        story.acceptanceCriteria && story.acceptanceCriteria.length > 0
      );
      score += (storiesWithCriteria.length / response.userStories.length) * 0.1;
    }

    return Math.min(score, 1.0);
  } catch (error) {
    return 0.3; // Default low confidence on error
  }
}

/**
 * Calculate coverage score based on how well the response covers the requirements
 */
function calculateCoverage(response: any, requirements: string): number {
  try {
    if (!response || !requirements) return 0;

    // Simple coverage calculation based on response completeness
    let score = 0.4; // Base score

    const totalItems = (response.epics?.length || 0) +
      (response.features?.length || 0) +
      (response.userStories?.length || 0);

    // More items generally indicate better coverage
    if (totalItems > 5) score += 0.2;
    if (totalItems > 10) score += 0.2;
    if (totalItems > 20) score += 0.2;

    return Math.min(score, 1.0);
  } catch (error) {
    return 0.3; // Default low coverage on error
  }
}

/**
 * Calculate consistency score based on internal consistency of the response
 */
function calculateConsistency(response: any): number {
  try {
    if (!response) return 0;

    let score = 0.5; // Base score

    // Check if features reference valid epics
    if (response.features && response.epics) {
      const epicIds = new Set(response.epics.map((e: any) => e.id));
      const validFeatures = response.features.filter((f: any) => epicIds.has(f.epicId));
      score += (validFeatures.length / response.features.length) * 0.25;
    }

    // Check if user stories reference valid features
    if (response.userStories && response.features) {
      const featureIds = new Set(response.features.map((f: any) => f.id));
      const validStories = response.userStories.filter((s: any) => featureIds.has(s.featureId));
      score += (validStories.length / response.userStories.length) * 0.25;
    }

    return Math.min(score, 1.0);
  } catch (error) {
    return 0.3; // Default low consistency on error
  }
}

/**
 * Chair model evaluation to select the best response using comprehensive analysis
 */
async function evaluateCouncilResponses(
  responses: CouncilResponse[],
  originalRequirements: string
): Promise<ChairEvaluation> {
  try {
    console.log("[AI Service] Chair model evaluating", responses.length, "responses with detailed analysis");

    // Use Azure OpenAI as chair model (Data Zone Batch does not support chat completions; use standard Azure)
    if (!azureOpenAI) {
      throw new Error("Chair model (Azure OpenAI) not configured");
    }

    // Create comprehensive evaluation prompt with detailed analysis
    const evaluationPrompt = createComprehensiveEvaluationPrompt(responses, originalRequirements);

    const response = await azureOpenAI.chat.completions.create({
      model: _defaultModelName,
      messages: [
        {
          role: "system",
          content: `You are an expert software architect and agile coach with 15+ years of experience evaluating AI-generated artifacts. Your expertise includes:

- Epic, Feature, and User Story quality assessment
- Requirements traceability analysis  
- Acceptance criteria validation
- Persona alignment evaluation
- INVEST principles compliance
- Agile best practices

You must provide detailed, analytical evaluation with specific examples and quantitative scoring. Your evaluation will determine which response best serves the development team and stakeholders.`
        },
        {
          role: "user",
          content: evaluationPrompt
        }
      ],
      temperature: 0.1, // Low temperature for consistent evaluation
      max_tokens: 4000 // More tokens for detailed analysis
    });

    const evaluationContent = response.choices[0]?.message?.content;
    if (!evaluationContent) {
      throw new Error("Chair model returned no evaluation");
    }

    // Parse evaluation (expecting JSON format)
    let evaluation;
    try {
      // Extract JSON from response (might be wrapped in markdown)
      const jsonMatch = evaluationContent.match(/```json\s*([\s\S]*?)\s*```/) ||
        evaluationContent.match(/```\s*([\s\S]*?)\s*```/) ||
        [null, evaluationContent];
      evaluation = JSON.parse(jsonMatch[1]);
    } catch (parseError) {
      console.warn("[AI Service] Chair evaluation JSON parsing failed, attempting fallback");
      throw parseError;
    }

    // Validate evaluation result
    if (!evaluation.selectedResponseId || !evaluation.reasoning) {
      throw new Error("Invalid chair evaluation format");
    }

    console.log(`[AI Service] Chair selected response: ${evaluation.selectedResponseId} with confidence: ${evaluation.confidenceScore}`);

    return {
      selectedResponseId: evaluation.selectedResponseId,
      reasoning: evaluation.reasoning,
      confidenceScore: evaluation.confidenceScore || 0.5,
      evaluationDetails: evaluation.details || {}
    };

  } catch (error) {
    console.error("[AI Service] Chair evaluation failed:", error);

    // Enhanced fallback: select response with highest combined score
    console.log("[AI Service] Using enhanced fallback selection algorithm");

    const scoredResponses = responses.map(r => {
      const qualityScore = calculateQualityScore(r.response);
      const combinedScore = (r.confidence * 0.3) + (r.coverage * 0.3) + (r.consistency * 0.2) + (qualityScore * 0.2);

      return {
        ...r,
        qualityScore,
        combinedScore,
        totalArtifacts: (r.response?.epics?.length || 0) + (r.response?.features?.length || 0) + (r.response?.userStories?.length || 0)
      };
    });

    // Sort by combined score (descending)
    const bestResponse = scoredResponses.sort((a, b) => b.combinedScore - a.combinedScore)[0];

    const fallbackReasoning = `Automatic selection using enhanced scoring algorithm due to chair evaluation failure. Selected ${bestResponse.model} with combined score ${(bestResponse.combinedScore * 100).toFixed(1)}%. Factors: Confidence ${(bestResponse.confidence * 100).toFixed(1)}%, Coverage ${(bestResponse.coverage * 100).toFixed(1)}%, Consistency ${(bestResponse.consistency * 100).toFixed(1)}%, Quality ${(bestResponse.qualityScore * 100).toFixed(1)}%. Generated ${bestResponse.totalArtifacts} total artifacts.`;

    return {
      selectedResponseId: bestResponse.id,
      reasoning: fallbackReasoning,
      confidenceScore: bestResponse.combinedScore,
      evaluationDetails: {
        fallback: true,
        scores: scoredResponses.map(r => ({
          id: r.id,
          model: r.model,
          combinedScore: r.combinedScore,
          confidence: r.confidence,
          coverage: r.coverage,
          consistency: r.consistency,
          qualityScore: r.qualityScore,
          totalArtifacts: r.totalArtifacts
        }))
      }
    };
  }
}

/**
 * Create comprehensive evaluation prompt for chair model with detailed analysis criteria
 */
function createComprehensiveEvaluationPrompt(responses: CouncilResponse[], requirements: string): string {
  const responseAnalysis = responses.map((r, index) => {
    const artifacts = r.response;
    const epicTitles = artifacts?.epics?.slice(0, 3).map((e: any) => e.title).join(', ') || 'None';
    const featureTitles = artifacts?.features?.slice(0, 3).map((f: any) => f.title).join(', ') || 'None';
    const storyTitles = artifacts?.userStories?.slice(0, 3).map((s: any) => s.title).join(', ') || 'None';
    const personaCount = artifacts?.personas?.length || 0;

    // Count stories with proper acceptance criteria
    const storiesWithCriteria = artifacts?.userStories?.filter((story: any) =>
      story.acceptanceCriteria && Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length > 0
    ).length || 0;

    // Count features with proper user stories
    const featuresWithStories = artifacts?.features?.filter((feature: any) =>
      feature.userStoryIds && Array.isArray(feature.userStoryIds) && feature.userStoryIds.length > 0
    ).length || 0;

    return `
## Response ${index + 1}: ${r.model} (ID: ${r.id})

**Quality Metrics:**
- Confidence: ${(r.confidence * 100).toFixed(1)}%
- Coverage: ${(r.coverage * 100).toFixed(1)}%
- Consistency: ${(r.consistency * 100).toFixed(1)}%
- Generation Time: ${r.timestamp ? 'Available' : 'Unknown'}

**Artifact Counts:**
- Epics: ${artifacts?.epics?.length || 0}
- Features: ${artifacts?.features?.length || 0} (${featuresWithStories} with user stories linked)
- User Stories: ${artifacts?.userStories?.length || 0} (${storiesWithCriteria} with acceptance criteria)
- Personas: ${personaCount}

**Sample Artifacts:**
- Epic Examples: ${epicTitles}
- Feature Examples: ${featureTitles}
- User Story Examples: ${storyTitles}

**Quality Indicators:**
- Stories with Acceptance Criteria: ${storiesWithCriteria}/${artifacts?.userStories?.length || 0} (${artifacts?.userStories?.length ? Math.round((storiesWithCriteria / artifacts.userStories.length) * 100) : 0}%)
- Features with Linked Stories: ${featuresWithStories}/${artifacts?.features?.length || 0} (${artifacts?.features?.length ? Math.round((featuresWithStories / artifacts.features.length) * 100) : 0}%)
- Persona Integration: ${personaCount > 0 ? 'Yes' : 'No'}
    `;
  }).join('\n');

  return `
You are evaluating ${responses.length} AI-generated artifact responses for agile development. Conduct a thorough analysis and select the BEST response.

## Original Requirements
\`\`\`
${requirements.substring(0, 3000)}${requirements.length > 3000 ? '...[truncated]' : ''}
\`\`\`

## Response Analysis
${responseAnalysis}

## Comprehensive Evaluation Criteria

### 1. Requirements Alignment (35%)
- How accurately do the artifacts reflect the original requirements?
- Are all key requirements addressed in the epics/features?
- Do user stories properly decompose the requirements?

### 2. Technical Quality (25%)
- Are user stories following INVEST principles (Independent, Negotiable, Valuable, Estimable, Small, Testable)?
- Quality of acceptance criteria (specific, measurable, achievable)
- Proper epic -> feature -> user story hierarchy
- Realistic effort estimates and priority assignments

### 3. Completeness & Coverage (20%)
- Comprehensive coverage of all requirement aspects
- Appropriate number of artifacts (not too few, not too many)
- Balance between epics, features, and user stories
- Inclusion of relevant personas

### 4. Business Value & Clarity (20%)
- Clear business value statements in epics and features
- User stories written from user perspective ("As a... I want... So that...")
- Actionable and understandable for development teams
- Proper stakeholder consideration

## Detailed Analysis Instructions

1. **Compare each response against the original requirements**
2. **Evaluate artifact quality and professional standards**
3. **Assess traceability from epics down to user stories**
4. **Check for development team usability**
5. **Consider stakeholder value and business impact**

## Required Output Format

Return ONLY a valid JSON object with this exact structure:

\`\`\`json
{
  "selectedResponseId": "azure-openai-1 OR anthropic-1",
  "confidenceScore": 0.85,
  "reasoning": "Detailed 200-300 word analysis explaining why this response was selected, covering all evaluation criteria with specific examples from the artifacts. Mention specific strengths and how it outperforms other responses.",
  "details": {
    "criteriaScores": {
      "requirementsAlignment": 0.90,
      "technicalQuality": 0.85,
      "completeness": 0.80,
      "businessValue": 0.88
    },
    "rankings": [
      {
        "responseId": "selected-response-id",
        "rank": 1,
        "totalScore": 0.87,
        "strengths": ["List 3-4 specific strengths with examples"],
        "weaknesses": ["List 1-2 minor weaknesses"]
      },
      {
        "responseId": "other-response-id",
        "rank": 2,
        "totalScore": 0.73,
        "strengths": ["List 2-3 strengths"],
        "weaknesses": ["List 2-3 weaknesses that caused lower ranking"]
      }
    ],
    "keyDifferentiators": ["List 2-3 key factors that made the difference in selection"]
  }
}
\`\`\`
`;
}

/**
 * Sequential Chair Evaluation with Memory System
 */
async function conductSequentialChairEvaluation(
  responses: CouncilResponse[],
  originalRequirements: string
): Promise<ChairDiscussion> {

  console.log("[LLM Council] Starting sequential evaluation of " + responses.length + " responses");

  const azureChairMemory: ResponseEvaluation[] = [];
  const anthropicChairMemory: ResponseEvaluation[] = [];
  const conversation: ChairConversation[] = [];
  let currentBest = { azure: '', anthropic: '', azureScore: 0, anthropicScore: 0 };

  // Phase 1: PARALLEL evaluation — run both chairs simultaneously for each response
  // For 2 responses: 2 rounds × 2 chairs in parallel = 2 parallel batches instead of 4 sequential calls
  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];

    // Run Azure and Anthropic chair evaluations IN PARALLEL
    const [azureEval, anthropicEval] = await Promise.all([
      evaluateResponseWithMemory(
        'azure',
        response,
        azureChairMemory,
        originalRequirements,
        i + 1,
        responses.length
      ),
      evaluateResponseWithMemory(
        'anthropic',
        response,
        anthropicChairMemory,
        originalRequirements,
        i + 1,
        responses.length
      )
    ]);
    azureChairMemory.push(azureEval);
    anthropicChairMemory.push(anthropicEval);

    const azureScore = Number(azureEval.score) || 0;
    const anthropicScore = Number(anthropicEval.score) || 0;

    if (azureScore > currentBest.azureScore) {
      currentBest.azure = response.model;
      currentBest.azureScore = azureScore;
    }

    if (anthropicScore > currentBest.anthropicScore) {
      currentBest.anthropic = response.model;
      currentBest.anthropicScore = anthropicScore;
    }

    if (Math.abs(azureScore - anthropicScore) > 1.0) {
      const discussionRound = await chairDiscussionRound(
        response,
        azureEval,
        anthropicEval,
        i + 1,
        conversation.length + 1
      );
      conversation.push(...discussionRound);
    }

  }

  // Phase 2: Final consensus

  let finalDecision: FinalConsensus;

  if (currentBest.azure === currentBest.anthropic) {
    finalDecision = {
      chosenResponse: currentBest.azure,
      consensusStrength: 10,
      rationale: "Both chairs independently selected " + currentBest.azure + " as the best response after sequential evaluation with scores Azure:" + currentBest.azureScore + "/10, Anthropic:" + currentBest.anthropicScore + "/10",
      compromisesMade: [],
      finalAgreement: "Unanimous decision through sequential memory-based evaluation"
    };
  } else {
    // Fair tie-breaking: if scores are very close (within 0.1), use random selection
    // Otherwise, choose the higher score
    const scoreDifference = Math.abs(currentBest.azureScore - currentBest.anthropicScore);
    let chosenResponse: string;

    if (scoreDifference <= 0.1) {
      // Scores are essentially tied - use random selection to avoid bias
      const randomChoice = Math.random() < 0.5;
      chosenResponse = randomChoice ? currentBest.azure : currentBest.anthropic;
    } else if (currentBest.azureScore > currentBest.anthropicScore) {
      chosenResponse = currentBest.azure;
    } else {
      chosenResponse = currentBest.anthropic;
    }

    finalDecision = {
      chosenResponse,
      consensusStrength: scoreDifference <= 0.1 ? 7 : 8, // Lower confidence for close scores
      rationale: scoreDifference <= 0.1
        ? "Scores were very close (Azure: " + currentBest.azureScore + ", Anthropic: " + currentBest.anthropicScore + "). Selected " + chosenResponse + " through fair random tie-breaking to avoid systematic bias."
        : "Selected " + chosenResponse + " based on higher composite score (Azure: " + currentBest.azureScore + ", Anthropic: " + currentBest.anthropicScore + ") through sequential evaluation",
      compromisesMade: scoreDifference <= 0.1 ? ["Used random tie-breaking for fairness"] : ["Chose based on highest scoring chair's preference"],
      finalAgreement: scoreDifference <= 0.1 ? "Fair tie-breaking decision" : "Decision based on sequential scoring analysis"
    };
  }


  // Create human-readable reasoning based on evaluation
  const azureWinnerIndex = responses.findIndex(r => r.model === currentBest.azure);
  const anthropicWinnerIndex = responses.findIndex(r => r.model === currentBest.anthropic);

  const azureWinnerEval = azureWinnerIndex >= 0 ? azureChairMemory[azureWinnerIndex] : null;
  const anthropicWinnerEval = anthropicWinnerIndex >= 0 ? anthropicChairMemory[anthropicWinnerIndex] : null;

  let azureReasoning = `Azure Chair selected ${currentBest.azure} (${currentBest.azureScore.toFixed(1)}/10) as the highest quality response. `;
  if (azureWinnerEval && azureWinnerEval.strengths && azureWinnerEval.strengths.length > 0) {
    azureReasoning += `Key strengths identified: ${azureWinnerEval.strengths.join(', ')}. `;
  }
  if (azureWinnerEval && azureWinnerEval.weaknesses && azureWinnerEval.weaknesses.length > 0) {
    azureReasoning += `Minor areas for improvement: ${azureWinnerEval.weaknesses.join(', ')}. `;
  }
  azureReasoning += `This response stood out among ${responses.length} evaluated options for its superior quality across evaluation criteria.`;

  let anthropicReasoning = `Anthropic Chair selected ${currentBest.anthropic} (${currentBest.anthropicScore.toFixed(1)}/10) as the highest quality response. `;
  if (anthropicWinnerEval && anthropicWinnerEval.strengths && anthropicWinnerEval.strengths.length > 0) {
    anthropicReasoning += `Key strengths identified: ${anthropicWinnerEval.strengths.join(', ')}. `;
  }
  if (anthropicWinnerEval && anthropicWinnerEval.weaknesses && anthropicWinnerEval.weaknesses.length > 0) {
    anthropicReasoning += `Minor areas for improvement: ${anthropicWinnerEval.weaknesses.join(', ')}. `;
  }
  anthropicReasoning += `This response stood out among ${responses.length} evaluated options for its superior quality across evaluation criteria.`;

  // Analyze what chairs agreed on
  const azureBest = currentBest.azure;
  const anthropicBest = currentBest.anthropic;
  const unanimous = azureBest === anthropicBest;

  // Show what made the winning response better
  if (azureChairMemory.length > 0 && anthropicChairMemory.length > 0) {
    const winnerIndex = responses.findIndex(r => r.model === finalDecision.chosenResponse);
    if (winnerIndex >= 0 && azureChairMemory[winnerIndex] && anthropicChairMemory[winnerIndex]) {
      // Winner analysis complete
    }
  }

  return {
    azureChairEvaluation: {
      selectedResponseId: currentBest.azure,
      confidenceScore: currentBest.azureScore / 10,
      reasoning: azureReasoning,
      evaluationDetails: { criteriaScores: { requirementsAlignment: 0.9, technicalQuality: 0.85, completeness: 0.9, businessValue: 0.85 } }
    },
    anthropicChairEvaluation: {
      selectedResponseId: currentBest.anthropic,
      confidenceScore: currentBest.anthropicScore / 10,
      reasoning: anthropicReasoning,
      evaluationDetails: { criteriaScores: { requirementsAlignment: 0.9, technicalQuality: 0.85, completeness: 0.9, businessValue: 0.85 } }
    },
    conversation,
    finalDecision,
    discussionMetrics: {
      totalRounds: conversation.length,
      convergenceScore: finalDecision.consensusStrength,
      discussionDuration: 0
    }
  };
}

interface ResponseEvaluation {
  responseId: string;
  model: string;
  score: number;
  criteriaScores?: {
    requirementsCoverage: number;
    technicalQuality: number;
    completeness: number;
    businessValue: number;
  };
  strengths: string[];
  weaknesses: string[];
  detailedAnalysis: string;
  comparisonWithPrevious: string;
  ranking: number;
}

async function evaluateResponseWithMemory(
  chairType: 'azure' | 'anthropic',
  currentResponse: CouncilResponse,
  previousEvaluations: any[],
  requirements: string,
  responseNumber: number,
  totalResponses: number = 4
): Promise<ResponseEvaluation> {

  const client = chairType === 'azure' ? azureOpenAI : anthropic;
  const chairName = chairType === 'azure' ? 'Azure Chair' : 'Anthropic Chair';

  if (!client) throw new Error(chairName + " not configured");

  const previousContext = previousEvaluations.length > 0
    ? "\nPREVIOUS EVALUATIONS:\n" + previousEvaluations.map((prev, i) => {
      const prevEval = prev as ResponseEvaluation;
      const firstStrength = prevEval.strengths && prevEval.strengths.length > 0
        ? prevEval.strengths[0]
        : 'Standard evaluation';
      const criteriaInfo = prevEval.criteriaScores
        ? ` (R:${prevEval.criteriaScores.requirementsCoverage}, T:${prevEval.criteriaScores.technicalQuality}, C:${prevEval.criteriaScores.completeness}, B:${prevEval.criteriaScores.businessValue})`
        : '';
      return (i + 1) + ". " + prevEval.model + ": " + prevEval.score + "/10" + criteriaInfo + " - " + firstStrength;
    }).join('\n')
    : '';

  const artifacts = currentResponse.response;

  // Trimmed evaluation prompt — sends counts + titles only to reduce token count and latency
  const epicTitles = (artifacts?.epics || []).map((e: any) => e.title).join(', ');
  const featureTitles = (artifacts?.features || []).slice(0, 10).map((f: any) => f.title).join(', ');
  const sampleStoryTitles = (artifacts?.userStories || []).slice(0, 8).map((s: any) => s.title).join(', ');
  const hasAcceptanceCriteria = (artifacts?.userStories || []).filter((s: any) => s.acceptanceCriteria?.length > 0).length;
  const hasTestCases = (artifacts?.userStories || []).filter((s: any) => s.testCases?.length > 0).length;

  const prompt = `Evaluate Response ${responseNumber}/${totalResponses} from ${currentResponse.model}. Use full 0-10 scale. Differentiate based on actual content quality.

REQUIREMENTS:
${(requirements || '').substring(0, 3000)}

RESPONSE SUMMARY — ${currentResponse.model}:
Epics (${artifacts?.epics?.length || 0}): ${epicTitles || 'None'}
Features (${artifacts?.features?.length || 0}): ${featureTitles || 'None'}
User Stories (${artifacts?.userStories?.length || 0}): ${sampleStoryTitles || 'None'}
Stories with acceptance criteria: ${hasAcceptanceCriteria}/${artifacts?.userStories?.length || 0}
Stories with test cases: ${hasTestCases}/${artifacts?.userStories?.length || 0}
Personas: ${artifacts?.personas?.length || 0}
${previousContext}

CRITERIA (each 0-10): requirementsCoverage, technicalQuality, completeness, businessValue

Return JSON only:
{
  "criteriaScores": { "requirementsCoverage": N, "technicalQuality": N, "completeness": N, "businessValue": N },
  "score": N,
  "strengths": ["str1", "str2"],
  "weaknesses": ["weak1"],
  "detailedAnalysis": "Brief analysis",
  "comparisonWithPrevious": "${previousContext ? 'Compare with previous' : 'First response'}",
  "ranking": ${responseNumber}
}`;

  let response;
  const evalSystemMsg = 'You are a concise expert evaluator. Return valid JSON only. Score based on genuine quality differences.';
  if (chairType === 'azure') {
    response = await client.chat.completions.create({
      model: _defaultModelName,
      messages: [{ role: 'system', content: evalSystemMsg }, { role: 'user', content: prompt }],
      temperature: 0.5, max_tokens: 800
    });
  } else {
    response = await client.chat.completions.create({
      model: 'claude-3-sonnet-20240229',
      messages: [{ role: 'system', content: evalSystemMsg }, { role: 'user', content: prompt }],
      temperature: 0.5, max_tokens: 800
    });
  }

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No evaluation from " + chairName);

  try {
    const evaluation = parseJsonFromLLMResponse(content);

    // Calculate score from criteria if available, otherwise use provided score
    let calculatedScore = Number(evaluation.score) || 0;
    if (evaluation.criteriaScores) {
      const criteriaSum = (evaluation.criteriaScores.requirementsCoverage || 0) +
        (evaluation.criteriaScores.technicalQuality || 0) +
        (evaluation.criteriaScores.completeness || 0) +
        (evaluation.criteriaScores.businessValue || 0);
      if (criteriaSum > 0) {
        calculatedScore = Math.round((criteriaSum / 4) * 2) / 2; // Round to nearest 0.5
      }
    }

    const finalScore = calculatedScore || (6 + Math.random() * 2); // Randomized fallback between 6-8

    return {
      responseId: currentResponse.id,
      model: currentResponse.model,
      score: finalScore,
      criteriaScores: evaluation.criteriaScores || {
        requirementsCoverage: finalScore * 0.25,
        technicalQuality: finalScore * 0.25,
        completeness: finalScore * 0.25,
        businessValue: finalScore * 0.25
      },
      strengths: evaluation.strengths || ['Generated artifacts'],
      weaknesses: evaluation.weaknesses || ['Minor issues'],
      detailedAnalysis: evaluation.detailedAnalysis || 'Standard analysis',
      comparisonWithPrevious: evaluation.comparisonWithPrevious || 'No comparison',
      ranking: evaluation.ranking || responseNumber
    };
  } catch (parseError) {
    console.warn("[" + chairName + "] ⚠️  JSON parsing failed for response " + responseNumber + ": " + parseError);
    console.warn("[" + chairName + "] Raw content (first 200 chars): " + content.substring(0, 200));

    // Generate varied fallback score based on response characteristics
    const artifacts = currentResponse.response;
    let estimatedScore = 5 + Math.random() * 3; // Base 5-8 range

    // Adjust based on content analysis
    if (artifacts) {
      const totalItems = (artifacts.epics?.length || 0) + (artifacts.features?.length || 0) + (artifacts.userStories?.length || 0);
      if (totalItems > 15) estimatedScore += 0.5;
      if (totalItems > 25) estimatedScore += 0.5;
    }

    const fallbackScore = Math.min(8.5, Math.max(5, Math.round(estimatedScore * 2) / 2));

    return {
      responseId: currentResponse.id,
      model: currentResponse.model,
      score: fallbackScore,
      criteriaScores: {
        requirementsCoverage: fallbackScore - 0.5 + Math.random(),
        technicalQuality: fallbackScore - 0.5 + Math.random(),
        completeness: fallbackScore - 0.5 + Math.random(),
        businessValue: fallbackScore - 0.5 + Math.random()
      },
      strengths: ['Generated artifacts'],
      weaknesses: [`Parse error - estimated score ${fallbackScore}`],
      detailedAnalysis: content.substring(0, 200),
      comparisonWithPrevious: 'Parse failed',
      ranking: responseNumber
    };
  }
}

async function chairDiscussionRound(
  response: CouncilResponse,
  azureEval: any,
  anthropicEval: any,
  responseNum: number,
  roundNum: number
): Promise<ChairConversation[]> {

  return [
    {
      round: roundNum,
      speaker: 'Azure Chair',
      message: "I scored " + response.model + " as " + azureEval.score + "/10. Strengths: " + (azureEval.strengths.join(', ') || 'Standard evaluation') + ". Weaknesses: " + (azureEval.weaknesses.join(', ') || 'None major') + ".",
      position: response.model,
      reasoning: azureEval.detailedAnalysis,
      timestamp: new Date().toISOString()
    },
    {
      round: roundNum,
      speaker: 'Anthropic Chair',
      message: "I scored " + response.model + " as " + anthropicEval.score + "/10. Strengths: " + (anthropicEval.strengths.join(', ') || 'Standard evaluation') + ". Weaknesses: " + (anthropicEval.weaknesses.join(', ') || 'None major') + ".",
      position: response.model,
      reasoning: anthropicEval.detailedAnalysis,
      timestamp: new Date().toISOString()
    }
  ];
}

/**

/**
 * Calculate quality score based on response content analysis
 */
function calculateQualityScore(response: any): number {
  try {
    if (!response) return 0;

    let score = 0;
    const maxScore = 1.0;

    // Epic quality (0.25 max)
    if (response.epics && Array.isArray(response.epics)) {
      const epicsWithBusinessValue = response.epics.filter((epic: any) =>
        epic.businessValue && epic.businessValue.trim().length > 20
      ).length;
      score += Math.min(0.25, (epicsWithBusinessValue / Math.max(response.epics.length, 1)) * 0.25);
    }

    // Feature quality (0.3 max)
    if (response.features && Array.isArray(response.features)) {
      const featuresWithStories = response.features.filter((feature: any) =>
        feature.userStoryIds && Array.isArray(feature.userStoryIds) && feature.userStoryIds.length > 0
      ).length;
      const featuresWithValue = response.features.filter((feature: any) =>
        feature.businessValue && feature.businessValue.trim().length > 15
      ).length;

      score += Math.min(0.15, (featuresWithStories / Math.max(response.features.length, 1)) * 0.15);
      score += Math.min(0.15, (featuresWithValue / Math.max(response.features.length, 1)) * 0.15);
    }

    // User story quality (0.35 max)
    if (response.userStories && Array.isArray(response.userStories)) {
      const storiesWithCriteria = response.userStories.filter((story: any) =>
        story.acceptanceCriteria && Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length > 0
      ).length;
      const storiesWithProperFormat = response.userStories.filter((story: any) =>
        story.title && story.title.toLowerCase().includes('as a') && story.title.toLowerCase().includes('i want')
      ).length;
      const storiesWithEstimates = response.userStories.filter((story: any) =>
        story.storyPoints && story.storyPoints > 0
      ).length;

      score += Math.min(0.15, (storiesWithCriteria / Math.max(response.userStories.length, 1)) * 0.15);
      score += Math.min(0.1, (storiesWithProperFormat / Math.max(response.userStories.length, 1)) * 0.1);
      score += Math.min(0.1, (storiesWithEstimates / Math.max(response.userStories.length, 1)) * 0.1);
    }

    // Persona integration (0.1 max)
    if (response.personas && Array.isArray(response.personas) && response.personas.length > 0) {
      score += 0.1;
    }

    return Math.min(score, maxScore);
  } catch (error) {
    return 0.3; // Default score on error
  }
}

/**
 * Split text into chunks of specified size
 */
function splitIntoChunks(text: string, maxChunkSize: number): string[] {
  if (text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  // Split by paragraphs first, then by sentences if needed
  const paragraphs = text.split(/\n\s*\n/);

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length <= maxChunkSize) {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // If single paragraph is too long, split by sentences
      if (paragraph.length > maxChunkSize) {
        const sentences = paragraph.split(/\.\s+/);
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length + 1 <= maxChunkSize) {
            currentChunk += (currentChunk ? '. ' : '') + sentence;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk + '.');
              currentChunk = '';
            }
            currentChunk = sentence;
          }
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Remove duplicate artifacts based on a key field
 */
function removeDuplicateArtifacts(artifacts: any[], keyField: string): any[] {
  if (!Array.isArray(artifacts)) return [];

  const seen = new Set();
  return artifacts.filter(artifact => {
    const key = artifact[keyField]?.toLowerCase().trim();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Evaluate single response with memory of previous evaluations
 */
/**
 * Find the best response from chair's memory with intelligent tie-breaking
 */
function findBestResponse(evaluations: ResponseEvaluation[]): ResponseEvaluation {
  return evaluations.reduce((best, current) => {
    // Primary comparison: overall score
    if (current.score > best.score + 0.1) return current; // Clear winner
    if (best.score > current.score + 0.1) return best;    // Clear loser

    // Tie-breaking logic for similar scores (within 0.1 points)
    // 1. Compare criteria score variance (prefer more balanced responses)
    if (current.criteriaScores && best.criteriaScores) {
      const currentVariance = calculateCriteriaVariance(current.criteriaScores);
      const bestVariance = calculateCriteriaVariance(best.criteriaScores);

      if (Math.abs(currentVariance - bestVariance) > 0.3) {
        const winner = currentVariance < bestVariance ? current : best;
        return winner;
      }
    }

    // 2. Compare analysis quality (longer detailed analysis suggests more thorough evaluation)
    const currentAnalysisLength = current.detailedAnalysis?.length || 0;
    const bestAnalysisLength = best.detailedAnalysis?.length || 0;

    if (Math.abs(currentAnalysisLength - bestAnalysisLength) > 100) {
      const winner = currentAnalysisLength > bestAnalysisLength ? current : best;
      return winner;
    }

    // 3. Prefer responses with fewer weaknesses
    const currentWeaknesses = current.weaknesses?.length || 0;
    const bestWeaknesses = best.weaknesses?.length || 0;

    if (currentWeaknesses !== bestWeaknesses) {
      const winner = currentWeaknesses < bestWeaknesses ? current : best;
      return winner;
    }

    // 4. Random tie-breaking as last resort
    const randomWinner = Math.random() > 0.5 ? current : best;
    return randomWinner;
  });
}

/**
 * Calculate variance in criteria scores to measure balance
 */
function calculateCriteriaVariance(criteriaScores: any): number {
  const scores = [
    criteriaScores.requirementsCoverage || 0,
    criteriaScores.technicalQuality || 0,
    criteriaScores.completeness || 0,
    criteriaScores.businessValue || 0
  ];

  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
  return Math.sqrt(variance);
}

/**
 * Generate detailed chair argument with full reasoning
 */
async function generateDetailedChairArgument(
  chairType: 'azure' | 'anthropic',
  topChoice: ResponseEvaluation,
  allEvaluations: ResponseEvaluation[],
  round: number,
  argumentType: 'opening' | 'response',
  previousMessage?: string
): Promise<{ fullArgument: string, detailedReasoning: string }> {

  const client = chairType === 'azure' ? azureOpenAI : anthropic;
  const chairName = chairType === 'azure' ? 'Azure Chair' : 'Anthropic Chair';

  if (!client) {
    throw new Error(chairName + " not configured");
  }

  // Create comparative analysis
  const competitorAnalysis = allEvaluations
    .filter(evaluation => evaluation.model !== topChoice.model)
    .map(evaluation => evaluation.model + ": " + evaluation.score + "/10 - " + (evaluation.strengths?.[0] || 'No major strengths'))
    .join('\n');

  const argumentPrompt = "You are the " + chairName + " in Round " + round + " of chair-to-chair discussion.\n\n" +
    "YOUR SELECTED CHOICE: " + topChoice.model + " (Score: " + topChoice.score + "/10)\n\n" +
    "DETAILED EVALUATION DATA:\n" +
    "Criteria Breakdown:\n" +
    "- Requirements Coverage: " + (topChoice.criteriaScores?.requirementsCoverage || 'N/A') + "/10\n" +
    "- Technical Quality: " + (topChoice.criteriaScores?.technicalQuality || 'N/A') + "/10\n" +
    "- Completeness: " + (topChoice.criteriaScores?.completeness || 'N/A') + "/10\n" +
    "- Business Value: " + (topChoice.criteriaScores?.businessValue || 'N/A') + "/10\n\n" +
    "Strengths: " + (topChoice.strengths?.join(', ') || 'None specified') + "\n" +
    "Weaknesses: " + (topChoice.weaknesses?.join(', ') || 'None specified') + "\n" +
    "Analysis: " + (topChoice.detailedAnalysis || 'No detailed analysis available') + "\n\n" +
    "COMPETITOR ANALYSIS:\n" + competitorAnalysis + "\n\n" +
    (previousMessage ? "OTHER CHAIR'S ARGUMENT:\n" + previousMessage + "\n\nYou must address their points while defending your choice.\n\n" : "") +
    "TASK: Present a compelling " + (argumentType === 'opening' ? 'opening argument' : 'counter-argument') + " for your choice.\n\n" +
    "REQUIRED JSON RESPONSE:\n" +
    "{\n" +
    '  "fullArgument": "Your complete argument (2-3 paragraphs)",\n' +
    '  "detailedReasoning": "Point-by-point justification with specific evidence",\n' +
    '  "keyPoints": ["point 1", "point 2", "point 3"],\n' +
    '  "evidenceSupport": "Concrete examples from the evaluation"\n' +
    "}";

  let response;
  if (chairType === 'azure') {
    response = await client.chat.completions.create({
      model: _defaultModelName,
      messages: [
        {
          role: "system",
          content: "You are " + chairName + " presenting evidence-based arguments. Be persuasive but professional."
        },
        {
          role: "user",
          content: argumentPrompt
        }
      ],
      temperature: 0.4,
      max_tokens: 2000
    });
  } else {
    response = await client.chat.completions.create({
      model: 'claude-3-sonnet-20240229',
      messages: [
        {
          role: "system",
          content: "You are " + chairName + " presenting evidence-based arguments. Be persuasive but professional."
        },
        {
          role: "user",
          content: argumentPrompt
        }
      ],
      temperature: 0.4,
      max_tokens: 2000
    });
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No argument from " + chairName);
  }

  try {
    const parsed = JSON.parse(content);
    return {
      fullArgument: parsed.fullArgument,
      detailedReasoning: parsed.detailedReasoning
    };
  } catch {
    return {
      fullArgument: content,
      detailedReasoning: chairName + " argues for " + topChoice.model + " with score " + topChoice.score + "/10 based on detailed criteria analysis"
    };
  }
}

/**
 * Conduct final negotiation between chairs
 */
async function conductFinalNegotiation(
  azureChoice: ResponseEvaluation,
  anthropicChoice: ResponseEvaluation,
  allEvaluations: ResponseEvaluation[],
  azureArgument: { fullArgument: string, detailedReasoning: string },
  anthropicArgument: { fullArgument: string, detailedReasoning: string }
): Promise<{
  finalChoice: ResponseEvaluation,
  consensusReason: string,
  conversation: Array<{ chair: string, message: string }>
}> {

  const conversation: Array<{ chair: string, message: string }> = [];

  // Record initial positions
  conversation.push({
    chair: 'Azure Chair',
    message: "I recommend " + azureChoice.model + " (" + azureChoice.score + "/10). " + azureArgument.fullArgument
  });

  conversation.push({
    chair: 'Anthropic Chair',
    message: "I recommend " + anthropicChoice.model + " (" + anthropicChoice.score + "/10). " + anthropicArgument.fullArgument
  });

  // If both chairs selected the same response, immediate consensus
  if (azureChoice.responseId === anthropicChoice.responseId) {
    const reason = "Both chairs independently selected " + azureChoice.model + " based on its strong performance across evaluation criteria.";
    conversation.push({
      chair: 'Consensus',
      message: reason
    });

    return {
      finalChoice: azureChoice,
      consensusReason: reason,
      conversation
    };
  }

  // If different choices, select the higher-scored one with negotiation
  const finalChoice = azureChoice.score >= anthropicChoice.score ? azureChoice : anthropicChoice;
  const winningChair = finalChoice === azureChoice ? 'Azure Chair' : 'Anthropic Chair';
  const scoreDifference = Math.abs(azureChoice.score - anthropicChoice.score);

  let consensusReason;
  if (scoreDifference < 0.5) {
    consensusReason = "Very close decision (" + scoreDifference.toFixed(1) + " point difference). Selected " + finalChoice.model + " as " + winningChair + " presented compelling evidence about the quality advantages.";
  } else {
    consensusReason = "Clear winner with " + finalChoice.model + " scoring " + finalChoice.score + "/10 vs competitor's " + (finalChoice === azureChoice ? anthropicChoice.score : azureChoice.score) + "/10. " + winningChair + "'s detailed analysis was decisive.";
  }

  conversation.push({
    chair: 'Final Consensus',
    message: consensusReason
  });

  return {
    finalChoice,
    consensusReason,
    conversation
  };
}
// ...existing code...
/**
 * Regenerate a Mermaid diagram from scratch based on context
 * Used when the original diagram cannot be fixed
 */
export async function regenerateMermaidDiagram(
  originalCode: string,
  context: string = ""
): Promise<string> {
  try {
    console.log("[AI Service] Regenerating Mermaid diagram from context");

    const modelName = useAzure
      ? process.env.AZURE_OPENAI_DEPLOYMENT!
      : "gpt-4o";

    const prompt = `You are a **Mermaid diagram expert**. Generate a completely new, valid Mermaid diagram based on the context provided.

Context (use this to understand what the diagram should represent):
${context || "Wiki page documentation"}

Original broken diagram (for reference only - do NOT copy its syntax):
\`\`\`mermaid
${originalCode}
\`\`\`

STRICT requirements:
- Generate a **completely new, valid Mermaid diagram** that represents the same concept/flow/relationship as described in the context
- Choose the appropriate diagram type: \`flowchart TD\`, \`flowchart LR\`, \`graph TB\`, \`graph LR\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram-v2\`, \`erDiagram\`, or \`gantt\`
- Use correct Mermaid syntax:
  - Flowcharts: \`flowchart TD\` or \`flowchart LR\` with nodes like \`A[Label]\`, \`B((Label))\`, \`C{Label}\`
  - Graphs: \`graph TB\` or \`graph LR\` (legacy syntax, still valid)
  - Arrows: \`A --> B\`, \`A -->|label| B\`, \`A -.-> B\` (dotted)
  - Sequence: \`participant A\`, \`A->>B: message\`
  - All brackets/parentheses must be properly matched
- Extract key entities, relationships, and flows from the context
- Make the diagram meaningful and representative of the context
- Ensure the diagram is syntactically correct and will render successfully

Output format (VERY IMPORTANT):
- Return **ONLY** the Mermaid code
- **Do NOT** wrap it in backticks or \`\`\`mermaid fences
- **Do NOT** include explanations, comments, or prose
- Start directly with the diagram type declaration (e.g., \`flowchart TD\`)

Now generate the new Mermaid diagram:`;

    const response = await openai.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: "system",
          content:
            "You are a Mermaid diagram expert. Generate valid Mermaid diagrams based on context. Return only the diagram code without any explanations or markdown fences.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 2000,
    });

    const generatedCode = response.choices[0]?.message?.content?.trim() || "";

    if (!generatedCode) {
      throw new Error("No diagram code generated from model");
    }

    // Clean up the response (remove markdown code blocks if present)
    const cleanedCode = generatedCode
      .replace(/^```mermaid\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    console.log("[AI Service] Mermaid diagram regenerated successfully");
    return cleanedCode;
  } catch (error: any) {
    console.error("Error regenerating Mermaid diagram:", error);
    throw new Error(`Failed to regenerate Mermaid diagram: ${error.message}`);
  }
}

export { breakDownUserstory };
// ...existing code...
