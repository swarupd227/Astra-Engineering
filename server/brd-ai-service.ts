import { z } from "zod";
import { hasAzureOpenAI, hasBedrock, azureOpenAI, llmConfig } from "./llm-config";
import { NEW_API_MODEL_SUBSTRINGS } from "./llm-config-constants";
import { withAiContext } from "./observability/ai-context";
import { isPromptCacheEnabled, resolvePromptCacheKey, type PromptCacheProvider } from "./observability/prompt-cache";
import {
  createJobCachePrefix,
  logJobCacheFingerprint,
  resolvePromptCacheProvider,
  toLlmMessages,
  type JobCachePrefix,
} from "./observability/job-cache-prefix";
import { ai as sharedAiClient } from "./ai-client";

const useConfiguredLLM = (hasAzureOpenAI || hasBedrock) && !!azureOpenAI;

/** Static BRD system rules — no dates, timestamps, or per-job dynamic content. */
const STATIC_BRD_SYSTEM_PROMPT = `
You are a senior Business Analyst. Generate a professional, high-fidelity Business Requirements Document (BRD).

STRICT STRUCTURAL ENFORCEMENT (MANDATORY):
- ALL structured data MUST be rendered as Markdown pipe-tables.
- NO STRAY LINES: Do NOT include floating numbered points or list items outside of headers or tables.
- Section 1 (Document Information): EXACTLY ONE Markdown table | Attribute | Description | with 8 rows (Project Name, Document Type, Version, Prepared By, Date, Project Sponsor, Document Status, Approval Status). Prepared By is Astra.
- Section 3 (Introduction): Purpose paragraph, Scope table, and Definitions table ONLY.
- Section 5 (Stakeholders & Personas): 5.1 MUST be a table with headers | Name | Designation/Role |. 5.2 MUST be a table with headers | Persona | Role | Description |. No sub-headings like 5.2.1.
- PERSONA FIDELITY: Capture 100% of the user roles/personas described in the retrieved context. Do NOT add extra roles or generic personas that are not in the source. If only one persona exists, output exactly one row.
- Section 7 (Business Rules): EXACTLY ONE Markdown table | ID | Rule | Rationale |. No sub-headings.
- Section 8 (Data Requirements): 8.1 Data Entities table and 8.2 Data Migration bullets ONLY.
- Section 11 (Timeline): Descriptive paragraph + EXACTLY ONE table | Milestone ID | Milestone | Description | Target Date |.
- Section 12 (Appendices): 12.1 Reference Documents table and 12.2 Approval Matrix table ONLY.
- Section 13 (Guidelines): Descriptive paragraph + EXACTLY ONE table | Guideline Category | Description |.
- NO VISUAL ARTIFACTS: No diagrams or flowcharts.
`;

export interface BrdPromptPrefix {
  staticSystem: string;
  staticUser: string;
  documentDate: string;
  provider: PromptCacheProvider;
}

function buildBrdLlmMessages(
  prefix: Pick<BrdPromptPrefix, "staticSystem" | "staticUser" | "provider">,
  dynamicUser: string,
) {
  return toLlmMessages(createJobCachePrefix(prefix), dynamicUser);
}

function buildBrdDocumentDateBlock(documentDate: string, projectName: string): string {
  return `Date: ${documentDate}

CRITICAL OVERRIDE — DOCUMENT INFORMATION TABLE FORMAT:
- The "## 1. Document Information" section MUST use a two-column Markdown table with headers: | Attribute | Description |
- Include EXACTLY these rows in this order:
  | Project Name | ${projectName} |
  | Document Type | Draft |
  | Version | 1.0 |
  | Prepared By | Astra |
  | Date | ${documentDate} |
  | Project Sponsor | TBD |
  | Document Status | Draft |
  | Approval Status | Pending |
- The values for "Prepared By" MUST always be "Astra". Do NOT use any other values.`;
}

// Attribute every BRD AI call to feature=brd (use_case -> documentation_generation_count)
// without touching each call site.
const openai: any = {
  chat: {
    completions: {
      create: (params: any) =>
        withAiContext({ feature: "brd", useCase: "brd generation" }, () =>
          sharedAiClient.chat.completions.create({
            ...params,
            prompt_cache_key: params?.prompt_cache_key ?? resolvePromptCacheKey(),
          }),
        ),
    },
  },
};

export interface BRDInput {
  projectName: string;
  projectDescription: string;
  businessObjectives?: string;
  targetAudience?: string;
  keyFeatures?: string;
  constraints?: string;
  successCriteria?: string;
  timeline?: string;
  budget?: string;
  stakeholders?: string;
  existingRequirements?: string;
  generationDate?: string;
  useGoldenRepo?: boolean;
  // Section-aligned fields for stricter extraction from uploaded BRDs
  functionalRequirements?: string;
  nonFunctionalRequirements?: string;
  technicalRequirements?: string;
  integrationRequirements?: string;
  businessRules?: string;
  dataRequirements?: string;
  risksAndMitigation?: string;
  assumptions?: string;
  dependencies?: string;
  glossary?: string;
}

export interface BRDSection {
  title: string;
  content: string;
}

export interface BRDDocument {
  title: string;
  version: string;
  date: string;
  sections: BRDSection[];
  rawMarkdown: string;
  brdTemplateId?: string;

  // Optional, new: domain + traceability + quality (kept backward-compatible)
  detectedDomain?: DomainDetectionResult;
  domainProfile?: DomainProfileSummary;
  canonicalRequirements?: CanonicalRequirement[];
  rtm?: RequirementTraceabilityMatrixEntry[];
  qualityMetrics?: BrdQualityMetrics;
  acceptanceSummary?: AcceptanceSummary;
  canonicalRequirementsDebug?: CanonicalRequirementsDebug;
}

// Helper function to handle max_tokens vs max_completion_tokens for different models
function getTokensParam(deployment: string | undefined, maxTokens: number) {
  // Newer reasoning/chat models require max_completion_tokens.
  // Keep this aligned with llmClient.ts compatibility logic.
  const d = (deployment || "").toLowerCase();
  const isNewModel = NEW_API_MODEL_SUBSTRINGS.some(m => d.includes(m));

  return isNewModel
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens };
}

// Helper function to handle temperature restrictions for different models
function getTemperatureParam(deployment: string | undefined, temperature: number) {
  // Newer reasoning/chat models only support default temperature.
  // Keep this aligned with llmClient.ts compatibility logic.
  const d = (deployment || "").toLowerCase();
  const hasRestrictedTemp = NEW_API_MODEL_SUBSTRINGS.some(m => d.includes(m));

  return hasRestrictedTemp
    ? { temperature: 1 }
    : { temperature: temperature };
}

// ===============================
// Canonical 13-section BRD schema
// ===============================
//
// SINGLE SOURCE OF TRUTH for the BRD section structure used everywhere:
// - the user prompt sent to the BRD LLM,
// - the deliverables-enforcement block,
// - the post-generation quality gate (validateBrdQuality),
// - the post-generation structural validator (validateBrdStructure),
// - any future code that needs to reason about section numbering or ordering.
//
// IMPORTANT: previously these section numbers were duplicated across
// `sectionDeliverablesEnforcement`, `validateBrdQuality`, and the user
// prompt — and they had drifted. Business Rules was simultaneously
// referenced as "Section 5" (in validateBrdQuality) and "Section 7" (in
// sectionDeliverablesEnforcement); Risks was "Section 8" in one place and
// "Section 10" in another. This caused the quality gate to look up
// section 8 ("Data Requirements") when reporting on Risks, and so on.
//
// All numbers below match the user prompt structure (1..13 with subsections).
// If you need to change the structure, change it HERE and only here.
export interface CanonicalBrdSection {
  /** Section number, e.g. "1", "6.1" */
  number: string;
  /** Heading title without the leading number, e.g. "Document Information" */
  title: string;
  /** Markdown heading depth: 2 for top-level, 3 for subsections */
  level: 2 | 3;
  /** Whether this section MUST be present after generation */
  required: boolean;
}

export const CANONICAL_BRD_SECTIONS: ReadonlyArray<CanonicalBrdSection> = Object.freeze([
  { number: "1", title: "Document Information", level: 2, required: true },
  { number: "2", title: "Executive Summary", level: 2, required: true },
  { number: "3", title: "Introduction", level: 2, required: true },
  { number: "3.1", title: "Purpose", level: 3, required: true },
  { number: "3.2", title: "Scope", level: 3, required: true },
  { number: "3.3", title: "Definitions and Acronyms", level: 3, required: true },
  { number: "4", title: "Business Objectives", level: 2, required: true },
  { number: "4.1", title: "Business Goals", level: 3, required: true },
  { number: "4.2", title: "Success Criteria", level: 3, required: true },
  { number: "4.3", title: "Key Performance Indicators (KPIs)", level: 3, required: true },
  { number: "5", title: "Stakeholder Analysis", level: 2, required: true },
  { number: "5.1", title: "Key Stakeholders", level: 3, required: true },
  { number: "5.2", title: "User Personas", level: 3, required: true },
  { number: "6", title: "Requirements", level: 2, required: true },
  { number: "6.1", title: "Functional Requirements", level: 3, required: true },
  { number: "6.2", title: "Non-Functional Requirements", level: 3, required: true },
  { number: "6.3", title: "Technical Requirements", level: 3, required: true },
  { number: "6.4", title: "Integration Requirements", level: 3, required: true },
  { number: "7", title: "Business Rules", level: 2, required: true },
  { number: "8", title: "Data Requirements", level: 2, required: true },
  { number: "8.1", title: "Data Entities", level: 3, required: true },
  { number: "8.2", title: "Data Migration", level: 3, required: true },
  { number: "9", title: "Constraints and Assumptions", level: 2, required: true },
  { number: "9.1", title: "Constraints", level: 3, required: true },
  { number: "9.2", title: "Assumptions", level: 3, required: true },
  { number: "9.3", title: "Dependencies", level: 3, required: true },
  { number: "10", title: "Risks and Mitigation", level: 2, required: true },
  { number: "11", title: "Timeline and Milestones", level: 2, required: true },
  { number: "12", title: "Appendices", level: 2, required: true },
  { number: "12.1", title: "Reference Documents", level: 3, required: true },
  { number: "12.2", title: "Approval Matrix", level: 3, required: true },
  { number: "13", title: "Additional Organizational Guidelines", level: 2, required: true },
]);

/**
 * Just the top-level (level 2) sections — exactly 13 entries by construction.
 * Used as the canonical "13 sections in order" list for structural validation.
 */
export const CANONICAL_BRD_TOP_LEVEL_SECTIONS: ReadonlyArray<CanonicalBrdSection> = Object.freeze(
  CANONICAL_BRD_SECTIONS.filter((s) => s.level === 2),
);

/**
 * Look up a canonical section by its number (e.g. "6.1") or by its title
 * (e.g. "Business Rules"). Used by validators that pivot on either.
 */
export function getCanonicalSection(
  identifier: string,
): CanonicalBrdSection | undefined {
  const id = identifier.trim();
  const byNumber = CANONICAL_BRD_SECTIONS.find((s) => s.number === id);
  if (byNumber) return byNumber;
  const lower = id.toLowerCase();
  return CANONICAL_BRD_SECTIONS.find((s) => s.title.toLowerCase() === lower);
}

/**
 * Format a section reference like "Section 7 Business Rules" — used in
 * issue messages and user-facing prompts to keep them in sync.
 */
export function formatCanonicalSectionRef(identifier: string): string {
  const section = getCanonicalSection(identifier);
  if (!section) return identifier;
  return `Section ${section.number} ${section.title}`;
}

// ===============================
// Domain & traceability models
// ===============================

export interface DomainDetectionResult {
  primaryDomain: string;
  secondaryDomains: string[];
  confidence: number;
  evidence: string[];
}

export interface DomainProfileSummary {
  key: string;
  label: string;
  description: string;
  riskEmphasis: string[];
}

export interface CanonicalRequirement {
  id: string; // R1, R2, ...
  text: string;
  /**
   * High-level source category for traceability and analysis.
   * NOTE: keep general across domains.
   */
  sourceType:
  | "uploaded_doc"
  | "rag_guidance"
  | "user_input"
  | "project_description"
  | "key_features"
  | "existing_requirements";
  /**
   * Human-readable reference like file name, section heading, line range, or chunk id.
   */
  sourceRef?: string;
  /**
   * Exact or near-exact originating text snippet used for extraction.
   */
  sourceSnippet?: string;
  /**
   * Primary requirement classification (one dominant type).
   */
  requirementType:
  | "functional"
  | "non_functional"
  | "technical"
  | "integration"
  | "business_rule"
  | "data"
  | "risk"
  | "compliance"
  | "migration"
  | "validation";
  /**
   * Domain / topic tags inferred from source (e.g. ["payments","migration","messaging"]).
   */
  domainTags: string[];
  /**
   * Extraction confidence in [0,1].
   */
  confidence: number;
}

export interface RequirementTraceabilityMatrixEntry {
  sourceId: string; // canonical requirement id (R1...)
  sourceRequirement: string;
  sourceType: CanonicalRequirement["sourceType"];
  domainTags: string[];
  brdSection: string; // e.g. "4.1 Functional Requirements"
  brdRequirementId?: string; // e.g. "FR-01"
  coverageStatus: "Covered" | "Partial" | "Missing" | "Unsupported";
  notes?: string;
}

export interface BrdQualityMetrics {
  sourceCoveragePercent: number;
  unsupportedRequirementPercent: number;
  traceabilityScore: number;
  brdAccuracyScore: number;
  domainProfileComplianceScore: number;
}

export interface AcceptanceSummary {
  status: "acceptable" | "acceptable_with_gaps" | "not_acceptable";
  reasons: string[];
}

// Grouped canonical requirements views for debugging / prompt wiring
export interface CanonicalRequirementsByType {
  [requirementType: string]: CanonicalRequirement[];
}

export interface CanonicalRequirementsBySource {
  [sourceRef: string]: CanonicalRequirement[];
}

export interface CanonicalRequirementsDebug {
  totalRequirements: number;
  byType: CanonicalRequirementsByType;
  bySource: CanonicalRequirementsBySource;
  warnings: string[];
  examples: CanonicalRequirement[];
}

interface CanonicalExtractionContext {
  projectDescription?: string;
  keyFeatures?: string;
  existingRequirements?: string;
  uploadedDocumentText?: string;
  ragGuidance?: string;
  userInput?: string;
}

interface CanonicalExtractionResult {
  requirements: CanonicalRequirement[];
  byType: CanonicalRequirementsByType;
  bySource: CanonicalRequirementsBySource;
  warnings: string[];
  examples: CanonicalRequirement[];
}

/**
 * Optional generation options to reduce failure modes (token pressure + missing requirement coverage)
 */
export type BrdGenerationProgressEvent = {
  /**
   * Stable identifier for a backend phase (safe for UI mapping).
   * Example: "rag", "brd_pass1", "brd_pass2_requirements", "quality_gate".
   */
  stepKey: string;
  /** 0-100 overall completion percent. */
  percent: number;
  /** Human-friendly message describing current work. */
  message: string;
};

export interface GenerateBrdOptions {
  /**
   * If you have a canonical list of requirements (like the user's big list),
   * pass it here and we will inject it verbatim into the prompt in a "DO NOT OMIT" block.
   * This prevents accidental truncation / omission from UI fields.
   */
  mandatoryRequirementsText?: string;

  /**
   * Recommended: run two-pass generation where Section 4 tables are regenerated with explicit coverage enforcement.
   * Default: true.
   */
  twoPassRequirementsRepair?: boolean;

  /**
   * Maximum times to auto-repair requirements coverage if missing items are detected.
   * Default: 1 (usually enough).
   */
  maxRepairAttempts?: number;

  /**
   * Controls the minimum descriptive paragraph length requirement in the system prompt.
   * Default keeps your original 3–6 sentences, but you can lower to reduce token burn.
   */
  sectionDescriptionSentenceRange?: { min: number; max: number };

  /**
   * Output token limit for the main BRD generation (provider may cap this).
   * Default: 12000 (higher than your 8192 to reduce truncation risk).
   */
  brdMaxOutputTokens?: number;

  /**
   * Output token limit for requirements-only regeneration calls.
   * Default: 8000.
   */
  requirementsMaxOutputTokens?: number;

  /**
   * Enable multi-pass generation (Pass 1: skeleton + placeholders for 4 & 5-6; Pass 2: Section 4; Pass 3: Sections 5-6).
   * Default: true.
   */
  multiPassGeneration?: boolean;

  /**
   * Run validateBrdQuality after generation and attempt up to 2 targeted regenerations for failing sections.
   * Default: true.
   */
  enableQualityGate?: boolean;

  /**
   * Override temperature for the main BRD generation call only (used by generateBRDParallel).
   * When set, replaces the default 0.35. Does not affect repair/regeneration calls.
   */
  temperatureOverride?: number;

  /**
   * Optional: pre-detected domain context (e.g. from another service).
   * If omitted, generateBRD will attempt lightweight domain detection from inputs.
   */
  detectedDomainOverride?: DomainDetectionResult;

  /**
   * Optional additional context used by canonical requirement extraction. Kept
   * separate so existing callers remain backward-compatible.
   */
  canonicalExtractionContext?: {
    uploadedDocumentText?: string;
  };

  /**
   * Optional progress callback for job-based BRD generation.
   * When provided, generateBRD emits phase updates (pass1/pass2/pass3/quality gate).
   */
  onProgress?: (event: BrdGenerationProgressEvent) => void;

  /**
   * Generation mode.
   * - "create" (default): full BRD authoring pipeline. The prompt allows
   *   "missing-data filler" so the output looks complete even when the form
   *   inputs are sparse. Multi-pass repairs and quality gate run.
   * - "upload": strict-fidelity pipeline. Used when the canonical source is
   *   an uploaded document. The prompt MUST NOT add generic BA filler;
   *   missing fields stay empty/TBD. Multi-pass repairs and quality gate are
   *   skipped to avoid drifting away from the source.
   *
   *   IMPORTANT: in upload mode, callers should run
   *   `extractBrdInputFromDocumentText` first and pass the structured fields
   *   in `input`. They should NOT also forward the raw extracted markdown
   *   via `canonicalExtractionContext.uploadedDocumentText`: doing so adds a
   *   second LLM pass over the full document (often 30–80 KB) that pushes
   *   total upload time past upstream proxy timeouts on AWS API Gateway
   *   (29s) / ALB / CloudFront and surfaces as
   *   `{"message":"Service Unavailable"}` 503s.
   */
  mode?: "create" | "upload";

  /**
   * Optional cancellation check. If it returns true, the generation halts.
   */
  checkCancelled?: () => boolean;
}

/**
 * Extract content between two headings (from first heading line up to but not including the next same-or-higher level).
 * Returns trimmed content or "" if not found.
 */
function getSectionContent(markdown: string, startHeading: string): string {
  const lines = markdown.split("\n");
  const normalizedSearch = startHeading.trim().toLowerCase();
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/^#+\s/.test(t)) continue;
    const afterHash = t.replace(/^#+\s*/, "").trim().toLowerCase();
    if (afterHash === normalizedSearch || afterHash.includes(normalizedSearch) || normalizedSearch.includes(afterHash)) {
      startIdx = i + 1;
      break;
    }
    if (startHeading.includes("5") && /^##\s*5\.?\s/.test(t)) {
      startIdx = i + 1;
      break;
    }
    if (startHeading.includes("Key Performance") && /2\.3|KPI/i.test(t)) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx < 0) return "";
  const startLevel = (lines[startIdx - 1].match(/^#+/) || [""])[0].length;
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= startLevel) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join("\n").trim();
}

/**
 * Return start (inclusive) and end (exclusive) line indices for a section (heading line through end of section content).
 */
function getSectionBounds(markdown: string, startHeading: string): { startIdx: number; endIdx: number } {
  const lines = markdown.split("\n");
  const normalizedSearch = startHeading.trim().toLowerCase();
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/^#+\s/.test(t)) continue;
    const afterHash = t.replace(/^#+\s*/, "").trim().toLowerCase();
    if (afterHash === normalizedSearch || afterHash.includes(normalizedSearch) || normalizedSearch.includes(afterHash)) {
      startIdx = i;
      break;
    }
    if (startHeading.includes("5") && /^##\s*5\.?\s/.test(t)) {
      startIdx = i;
      break;
    }
    if (startHeading.includes("Key Performance") && /2\.3|KPI/i.test(t)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return { startIdx: -1, endIdx: -1 };
  const startLevel = (lines[startIdx].match(/^#+/) || [""])[0].length;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= startLevel) {
      endIdx = i;
      break;
    }
  }
  return { startIdx, endIdx };
}

/**
 * Count pipe-table data rows (lines containing | that are not separator lines like |---|).
 */
function countTableRows(content: string): number {
  const lines = content.split("\n").filter((l) => l.includes("|"));
  return lines.filter((l) => !/^[\s|\-:]+$/.test(l.trim())).length;
}

/**
 * Remove UI-only artifacts that sometimes leak into markdown (e.g. "Copy", "Edit", "AI Enhance").
 * This protects downstream repair passes and the final BRD output.
 */
function sanitizeBrdMarkdown(markdown: string): string {
  if (!markdown) return markdown;

  const uiOnlyLine = /^\s*(copy|edit|ai enhance|ai-enhance|ai enhance with diff)\s*$/i;
  const lines = markdown
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !uiOnlyLine.test(line));

  // Collapse excessive blank lines introduced by filtering.
  const cleaned: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && cleaned.length && cleaned[cleaned.length - 1].trim() === "") {
      continue;
    }
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}

function deduplicateFunctionalRequirementsSection(markdown: string): string {
  const lines = markdown.split("\n");
  const headingPattern = /^###\s*6\.1\s+Functional Requirements\s*$/i;
  const duplicateRanges: Array<[number, number]> = [];
  let firstFound = false;

  for (let i = 0; i < lines.length; i++) {
    if (headingPattern.test(lines[i])) {
      if (!firstFound) {
        firstFound = true;
        continue;
      }

      let endIdx = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (/^##\s+\d+\./.test(nextLine) || /^###\s*6\.(?!1)\d*\s+/.test(nextLine)) {
          endIdx = j;
          break;
        }
      }
      duplicateRanges.push([i, endIdx]);
      i = endIdx - 1;
    }
  }

  if (duplicateRanges.length === 0) return markdown;

  const cleanedLines = [...lines];
  for (let i = duplicateRanges.length - 1; i >= 0; i--) {
    const [start, end] = duplicateRanges[i];
    cleanedLines.splice(start, end - start);
  }
  return cleanedLines.join("\n");
}

/**
 * Check if text contains bracket placeholders like [Author Name].
 */
function hasBracketPlaceholders(text: string): boolean {
  return /\[[^\]]{2,}\]/.test(text);
}

/** Returns true if content indicates source-fidelity mode (TBD / Not specified in source). */
function hasSourceFidelityPlaceholders(content: string): boolean {
  if (!content) return false;
  return (
    /\bTBD\b/i.test(content) ||
    /Not specified in source/i.test(content) ||
    /Unknown\b/i.test(content)
  );
}

// ===========================
// Canonical requirement extraction
// ===========================

/**
 * High-fidelity canonical requirement extraction across multiple sources.
 * This is a structured extraction task, NOT summarization.
 */
async function extractCanonicalRequirements(
  ctx: CanonicalExtractionContext,
  mandatoryRequirementsText: string,
): Promise<CanonicalExtractionResult> {
  const warnings: string[] = [];

  const sources = [
    {
      id: "project_description",
      label: "Project Description",
      sourceType: "project_description",
      text: ctx.projectDescription,
    },
    {
      id: "key_features",
      label: "Key Features",
      sourceType: "key_features",
      text: ctx.keyFeatures,
    },
    {
      id: "existing_requirements",
      label: "Existing Requirements",
      sourceType: "existing_requirements",
      text: ctx.existingRequirements,
    },
    {
      id: "mandatory_requirements",
      label: "Mandatory Requirements",
      sourceType: "existing_requirements",
      text: mandatoryRequirementsText,
    },
    {
      id: "uploaded_doc",
      label: "Uploaded Document",
      sourceType: "uploaded_doc",
      text: ctx.uploadedDocumentText,
    },
    {
      id: "rag_guidance",
      label: "RAG Guidance",
      sourceType: "rag_guidance",
      text: ctx.ragGuidance,
    },
    {
      id: "user_input",
      label: "Additional User Input",
      sourceType: "user_input",
      text: ctx.userInput,
    },
  ].filter((s) => s.text && s.text.trim().length > 0);

  const totalSourceChars = sources.reduce((sum, s) => sum + (s.text?.length || 0), 0);
  if (sources.length === 0 || totalSourceChars < 50) {
    warnings.push("Canonical extraction: insufficient source text; returning empty requirements.");
    return { requirements: [], byType: {}, bySource: {}, warnings, examples: [] };
  }

  const sourcesBlock = sources
    .map(
      (s) => `
=== SOURCE: ${s.id} ===
sourceType: ${s.sourceType}
sourceRef: ${s.label}
TEXT:
${s.text}
`,
    )
    .join("\n\n");

  const extractionPrompt = `
You are a senior requirements analyst. Extract ATOMIC, TESTABLE, SOURCE-GROUNDED requirements from the following sources.
 
- MAXIMUM EXTRACTION FIDELITY: You MUST capture 100% of the functional and technical detail provided. If the source has 22 detailed requirements, your output should have at least 22 rows. Do NOT consolidate complex, multi-step requirements into single rows.
- PRESERVE SPECIFICS: You MUST preserve essential identifiers (e.g., SSO, Intune, Salesforce, SAP), specific UI behaviors (e.g., "red microphone icon", "green checkmark", "solid red button"), and error message text.
- ATOMICITY: Each row must be a single testable requirement, but it must contain the full context of that requirement from the source.
- Do NOT invent or add content; capture exactly what is in the text.
- Preserve source cardinality. If a source requirement table/list contains N distinct requirement rows/items, your JSON MUST contain N corresponding requirement objects unless rows are exact duplicates.
- Split long paragraphs into multiple requirements when they express different obligations, rules, mappings, or constraints.
- Treat every explicit requirement row, numbered item, bullet, "shall/must/should" statement, and acceptance criterion as a separate candidate requirement.
- Create one requirement per validation rule, mapping rule, structured data requirement, conditional rule, migration/coexistence rule, reference preservation rule, error/reject handling rule, data modeling rule, integration touchpoint, role-specific rule, compliance obligation, auditability/traceability rule, etc.
- Transform source wording into extremely concise requirement sentences starting with "The system shall...".
- DO NOT collapse multiple distinct rules into a vague sentence like "Support SWIFT compliance" or "Improve integration".

- "text": the atomic requirement, extremely concise (single short sentence) and phrased as "The system shall...".
- "sourceType": one of "uploaded_doc", "rag_guidance", "user_input", "project_description", "key_features", "existing_requirements".
- "sourceRef": a short label (e.g. file name, section heading, source id).
- "sourceSnippet": the exact or near-exact originating text fragment from the source.
- "requirementType": dominant type (functional, non_functional, technical, integration, business_rule, data, risk, compliance, migration, validation).

Deduplication rules:
- Only dedupe when two requirements are materially IDENTICAL.
- DO NOT merge requirements that differ by role, message type, field, condition, process, validation, integration point, object/entity/table/reference.

You MUST extract EVERY distinct requirement item found in the source. Do NOT skip any items to save space. Do NOT merge distinct numbered or bulleted items.

Output a single JSON object with this shape:
{
  "requirements": [
    {
      "text": "...",
      "sourceType": "...",
      "sourceRef": "...",
      "sourceSnippet": "...",
      "requirementType": "..."
    }
  ]
}

SOURCES:
${sourcesBlock}
`.trim();

  const response = await openai.chat.completions.create({
    model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
    messages: [
      { role: "system", content: "You only output strict JSON objects according to the requested schema, no prose." },
      { role: "user", content: extractionPrompt },
    ],
    ...getTokensParam(llmConfig.azureOpenAIDeployment, 16000),
    ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.1),
    response_format: { type: "json_object" } as any,
  });

  const content = response.choices[0]?.message?.content || "";
  if (!content) {
    warnings.push("Canonical extraction returned empty content from LLM.");
    return { requirements: [], byType: {}, bySource: {}, warnings, examples: [] };
  }

  let parsed: any = null;
  const parseResult = parseExtractionJson(content);
  if (parseResult.ok) {
    parsed = parseResult.value;
  } else {
    warnings.push(
      `Canonical extraction: structured JSON parse failed (${parseResult.reason.kind}: ${parseResult.reason.message}); attempting array salvage.`,
    );
    console.warn(
      "[BRD-CANONICAL] JSON parse failed; attempting array-element salvage.",
      {
        reason: parseResult.reason.kind,
        message: parseResult.reason.message,
        responseLength: content.length,
        head: content.slice(0, 200),
        tail: content.slice(-200),
      },
    );
  }

  let rawReqs: any[] = Array.isArray(parsed?.requirements) ? parsed.requirements : [];

  // Array salvage: if the structural parse failed entirely, OR it succeeded
  // but produced zero requirements while the raw response clearly contains
  // a `requirements: [` array, walk the array element-by-element and
  // recover whatever the model emitted before truncation.
  if (rawReqs.length === 0 && /"requirements"\s*:\s*\[/.test(content)) {
    const arrayStart = content.indexOf("[", content.indexOf('"requirements"'));
    if (arrayStart >= 0) {
      const salvaged = salvageJsonArrayElements(content.slice(arrayStart));
      if (salvaged && salvaged.length > 0) {
        rawReqs = salvaged as any[];
        warnings.push(
          `Canonical extraction: salvaged ${rawReqs.length} requirement(s) element-by-element after structural parse failure.`,
        );
        console.warn(
          `[BRD-CANONICAL] Salvaged ${rawReqs.length} requirements via element-by-element parse.`,
        );
      }
    }
  }

  // Hard-fail only if BOTH the structural parse and the salvage produced
  // nothing — otherwise we accept the partial result and continue, which
  // is much friendlier than aborting the whole BRD upload over a
  // truncated requirement list.
  if (!parseResult.ok && rawReqs.length === 0) {
    warnings.push("Canonical extraction: no requirements recoverable from LLM response.");
    throw new Error(
      `Canonical extraction JSON parse failed (${parseResult.reason.kind}): ${parseResult.reason.message}`,
    );
  }
  const requirements: CanonicalRequirement[] = [];

  let idx = 1;
  for (const r of rawReqs) {
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text || text.length < 5) continue;

    const sourceTypeRaw = typeof r.sourceType === "string" ? r.sourceType : "user_input";
    const allowedSourceTypes: CanonicalRequirement["sourceType"][] = [
      "uploaded_doc",
      "rag_guidance",
      "user_input",
      "project_description",
      "key_features",
      "existing_requirements",
    ];
    const sourceType = (allowedSourceTypes.includes(sourceTypeRaw as any)
      ? sourceTypeRaw
      : "user_input") as CanonicalRequirement["sourceType"];

    const requirementTypeRaw = typeof r.requirementType === "string" ? r.requirementType : "functional";
    const allowedReqTypes: CanonicalRequirement["requirementType"][] = [
      "functional",
      "non_functional",
      "technical",
      "integration",
      "business_rule",
      "data",
      "risk",
      "compliance",
      "migration",
      "validation",
    ];
    const requirementType = (allowedReqTypes.includes(requirementTypeRaw as any)
      ? requirementTypeRaw
      : "functional") as CanonicalRequirement["requirementType"];

    const domainTags =
      Array.isArray(r.domainTags) && r.domainTags.length
        ? r.domainTags.filter((t: any) => typeof t === "string")
        : [];

    let confidence =
      typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1 ? r.confidence : 0.75;

    const sourceRef = typeof r.sourceRef === "string" ? r.sourceRef : undefined;
    const sourceSnippet =
      typeof r.sourceSnippet === "string" && r.sourceSnippet.trim().length > 0
        ? r.sourceSnippet.trim()
        : undefined;

    const id = `R${idx++}`;

    requirements.push({
      id,
      text,
      sourceType,
      sourceRef,
      sourceSnippet,
      requirementType,
      domainTags,
      confidence,
    });
  }

  // Two-pass deduplication:
  // Pass 1: Cross-source dedup — if RAG and another source produce the same requirement text, keep the non-RAG version
  const crossSourceSeen = new Set<string>();
  const afterCrossSourceDedup: CanonicalRequirement[] = [];
  // Sort so non-RAG sources come first (project_description, existing_requirements, etc.)
  const sortedRequirements = [...requirements].sort((a, b) => {
    const aIsRag = a.sourceType === "rag_guidance" ? 1 : 0;
    const bIsRag = b.sourceType === "rag_guidance" ? 1 : 0;
    return aIsRag - bIsRag;
  });
  for (const r of sortedRequirements) {
    const textKey = `${normalizeRequirementText(r.text)}|${r.requirementType}`;
    if (crossSourceSeen.has(textKey)) {
      continue; // Skip duplicate (regardless of source)
    }
    crossSourceSeen.add(textKey);
    afterCrossSourceDedup.push(r);
  }
  const crossDupCount = requirements.length - afterCrossSourceDedup.length;

  // Pass 2: Standard dedup within same source
  const deduped: CanonicalRequirement[] = [];
  const seen = new Set<string>();
  for (const r of afterCrossSourceDedup) {
    const key = `${normalizeRequirementText(r.text)}|${r.requirementType}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(r);
  }
  const dupCount = requirements.length - deduped.length;
  if (dupCount > 0) {
    warnings.push(`Canonical extraction: removed ${dupCount} duplicate requirement(s) (${crossDupCount} cross-source).`);
  }

  // Cap RAG-sourced requirements to prevent score dilution.
  // Non-RAG sources (project description, existing requirements) are authoritative and kept as-is.
  // RAG-sourced requirements are supplementary — keep the top 15 by confidence to avoid
  // generating more requirements than the BRD LLM can meaningfully cover.
  const MAX_RAG_REQUIREMENTS = 15;
  const nonRagReqs = deduped.filter(r => r.sourceType !== "rag_guidance");
  const ragReqs = deduped.filter(r => r.sourceType === "rag_guidance");
  let finalDeduped = deduped;
  if (ragReqs.length > MAX_RAG_REQUIREMENTS) {
    // Sort by confidence descending, keep top N
    ragReqs.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const keptRag = ragReqs.slice(0, MAX_RAG_REQUIREMENTS);
    const trimmedCount = ragReqs.length - keptRag.length;
    finalDeduped = [...nonRagReqs, ...keptRag];
    warnings.push(`Canonical extraction: capped RAG-sourced requirements from ${ragReqs.length} to ${MAX_RAG_REQUIREMENTS} (trimmed ${trimmedCount}).`);
  }

  // Groupings
  const byType: CanonicalRequirementsByType = {};
  const bySource: CanonicalRequirementsBySource = {};
  for (const r of finalDeduped) {
    if (!byType[r.requirementType]) byType[r.requirementType] = [];
    byType[r.requirementType].push(r);

    const refKey = r.sourceRef || r.sourceType;
    if (!bySource[refKey]) bySource[refKey] = [];
    bySource[refKey].push(r);
  }

  // Quality checks: vague phrasing and missing snippets
  const vaguePhrases = ["support compliance", "improve system", "enhance functionality", "manage data effectively", "ensure integration"];
  let vagueCount = 0;
  let missingSnippetCount = 0;
  for (const r of finalDeduped) {
    const lower = r.text.toLowerCase();
    if (vaguePhrases.some((p) => lower.includes(p))) {
      vagueCount++;
    }
    if (!r.sourceSnippet || r.sourceSnippet.length < 10) {
      missingSnippetCount++;
    }
  }
  if (vagueCount > 0) {
    warnings.push(`Canonical extraction: detected ${vagueCount} potentially vague requirement(s).`);
  }
  if (missingSnippetCount > 0) {
    warnings.push(
      `Canonical extraction: ${missingSnippetCount} requirement(s) missing strong sourceSnippet; traceability may be weaker.`,
    );
  }

  const examples = finalDeduped.slice(0, 10);

  return {
    requirements: finalDeduped,
    byType,
    bySource,
    warnings,
    examples,
  };
}

// ===========================
// Domain detection & profiles
// ===========================

/** Lightweight heuristic + LLM-backed domain detection for BRD generation. */
async function detectProjectDomain(
  input: BRDInput,
  canonicalRequirementsText: string,
  ragGuidance?: string,
): Promise<DomainDetectionResult> {
  const fallback: DomainDetectionResult = {
    primaryDomain: "generic_software",
    secondaryDomains: [],
    confidence: 0.5,
    evidence: [],
  };

  try {
    const contextPieces: string[] = [];
    contextPieces.push(`Project Description:\n${input.projectDescription || ""}`);
    if (input.businessObjectives) contextPieces.push(`Business Objectives:\n${input.businessObjectives}`);
    if (input.keyFeatures) contextPieces.push(`Key Features:\n${input.keyFeatures}`);
    if (input.existingRequirements) contextPieces.push(`Existing Requirements:\n${input.existingRequirements}`);
    if (canonicalRequirementsText) contextPieces.push(`Canonical Requirements:\n${canonicalRequirementsText}`);
    if (ragGuidance) contextPieces.push(`RAG Guidance:\n${ragGuidance}`);

    const domainPrompt = `
You are a domain classification expert. Determine the business/industry domain for a software project based ONLY on the provided evidence.

You MUST respond with a single JSON object and NOTHING ELSE, in this exact shape:
{
  "primaryDomain": "one_of_the_listed_keys_below",
  "secondaryDomains": ["zero_or_more_domain_keys"],
  "confidence": 0.0_to_1.0,
  "evidence": ["key_terms_or_phrases_used_for_detection"]
}

Valid domain keys (choose the closest match):
- "banking"
- "payments"
- "trade_finance"
- "insurance"
- "healthcare"
- "telecom"
- "manufacturing"
- "logistics"
- "retail"
- "government"
- "compliance_regulatory"
- "enterprise_it"
- "hr_payroll"
- "procurement"
- "crm_sales"
- "data_platform_analytics"
- "generic_software"

RULES:
- Use ONLY the evidence given; do NOT guess beyond it.
- If multiple domains apply, pick the best primaryDomain and list others in secondaryDomains.
- If evidence is weak or generic, use "generic_software" with low confidence.
- "evidence" should be short phrases (e.g. "LC", "SWIFT", "claims", "patient", "inventory", "SLA", "BOM").

EVIDENCE:
${contextPieces.join("\n\n---\n\n")}
    `.trim();

    const completion = await openai.chat.completions.create({
      model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
      messages: [
        { role: "system", content: "You only output strict JSON objects, no prose." },
        { role: "user", content: domainPrompt },
      ],
      ...getTokensParam(llmConfig.azureOpenAIDeployment, 300),
      ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0),
    });

    const raw = completion.choices[0]?.message?.content || "";
    const domainParse = parseExtractionJson(raw);
    if (!domainParse.ok) {
      console.warn(
        `[BRD-DOMAIN] Domain detection JSON parse failed (${domainParse.reason.kind}): ${domainParse.reason.message}; using fallback.`,
      );
      return fallback;
    }
    const parsed: any = domainParse.value;
    if (!parsed || typeof parsed !== "object") return fallback;
    const primary = typeof parsed.primaryDomain === "string" && parsed.primaryDomain ? parsed.primaryDomain : fallback.primaryDomain;
    const secondary = Array.isArray(parsed.secondaryDomains)
      ? parsed.secondaryDomains.filter((d: any) => typeof d === "string")
      : [];
    const confidence =
      typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : fallback.confidence;
    const evidence =
      Array.isArray(parsed.evidence) && parsed.evidence.length > 0
        ? parsed.evidence.filter((e: any) => typeof e === "string")
        : [];

    const result: DomainDetectionResult = {
      primaryDomain: primary,
      secondaryDomains: secondary,
      confidence,
      evidence,
    };

    console.log("[BRD-DOMAIN] Detected project domain:", result);
    return result;
  } catch (err) {
    console.warn("[BRD-DOMAIN] Domain detection failed, falling back to generic_software:", err);
    return fallback;
  }
}

function getDomainProfile(domain: string): DomainProfileSummary {
  const key = (domain || "generic_software").toLowerCase();
  const profiles: Record<string, DomainProfileSummary> = {
    banking: {
      key: "banking",
      label: "Banking",
      description: "Emphasize products/accounts, transactions, controls, auditability, and regulatory constraints.",
      riskEmphasis: ["regulatory_compliance", "audit_trail", "data_quality"],
    },
    payments: {
      key: "payments",
      label: "Payments",
      description: "Emphasize payment flows, settlement, reconciliation, fraud checks, and currency handling.",
      riskEmphasis: ["fraud", "settlement_failure"],
    },
    trade_finance: {
      key: "trade_finance",
      label: "Trade Finance",
      description: "Emphasize instruments (LCs, guarantees), parties, documents, and compliance checks.",
      riskEmphasis: ["document_compliance", "sanctions"],
    },
    insurance: {
      key: "insurance",
      label: "Insurance",
      description: "Emphasize policies, claims, underwriting, coverage rules, and regulatory requirements.",
      riskEmphasis: ["coverage_gaps", "regulatory_non_compliance"],
    },
    healthcare: {
      key: "healthcare",
      label: "Healthcare",
      description: "Emphasize patients, providers, encounters, privacy (HIPAA/PHI), and clinical workflows.",
      riskEmphasis: ["privacy", "safety", "compliance"],
    },
    telecom: {
      key: "telecom",
      label: "Telecom",
      description: "Emphasize plans, subscriptions, provisioning, billing, and network/service SLAs.",
      riskEmphasis: ["service_availability", "billing_accuracy"],
    },
    manufacturing: {
      key: "manufacturing",
      label: "Manufacturing",
      description: "Emphasize BOM, production steps, quality checks, inventory, and suppliers.",
      riskEmphasis: ["production_downtime", "quality_defects"],
    },
    logistics: {
      key: "logistics",
      label: "Logistics",
      description: "Emphasize shipments, routes, carriers, tracking, and warehouse operations.",
      riskEmphasis: ["delivery_delays", "loss_damage"],
    },
    retail: {
      key: "retail",
      label: "Retail",
      description: "Emphasize catalog, pricing, promotions, carts, and order & returns flows.",
      riskEmphasis: ["stock_out", "order_errors"],
    },
    government: {
      key: "government",
      label: "Government",
      description: "Emphasize programs, case management, compliance, and public services.",
      riskEmphasis: ["policy_non_compliance"],
    },
    compliance_regulatory: {
      key: "compliance_regulatory",
      label: "Compliance / Regulatory",
      description: "Emphasize policies, rules, evidence, audit trails, and approvals.",
      riskEmphasis: ["regulatory_breach"],
    },
    enterprise_it: {
      key: "enterprise_it",
      label: "Enterprise IT",
      description: "Emphasize systems, integrations, SSO, configuration, and operational SLAs.",
      riskEmphasis: ["downtime", "data_loss"],
    },
    hr_payroll: {
      key: "hr_payroll",
      label: "HR / Payroll",
      description: "Emphasize employees, positions, payroll cycles, benefits, and compliance.",
      riskEmphasis: ["payroll_errors", "compliance"],
    },
    procurement: {
      key: "procurement",
      label: "Procurement",
      description: "Emphasize suppliers, POs, approvals, contracts, and spend controls.",
      riskEmphasis: ["unauthorized_spend"],
    },
    crm_sales: {
      key: "crm_sales",
      label: "CRM / Sales",
      description: "Emphasize leads, opportunities, pipeline stages, and sales activities.",
      riskEmphasis: ["pipeline_visibility"],
    },
    data_platform_analytics: {
      key: "data_platform_analytics",
      label: "Data Platform / Analytics",
      description: "Emphasize data ingestion, modeling, governance, lineage, and analytics.",
      riskEmphasis: ["data_quality", "lineage_gaps"],
    },
    generic_software: {
      key: "generic_software",
      label: "Generic Software / Product",
      description: "Emphasize clear requirements, roles, workflows, integrations, and data entities without domain-specific assumptions.",
      riskEmphasis: ["requirement_gaps"],
    },
  };

  const profile = profiles[key] ?? profiles["generic_software"];
  console.log("[BRD-DOMAIN] Using domain profile:", profile);
  return profile;
}

/**
 * Validate BRD markdown for required section deliverables. Returns array of issue messages (empty if valid).
 * When a section uses TBD/Not specified in source (source-fidelity mode), minimum row counts are relaxed to 1 so scores stay acceptable.
 *
 * All section references below pivot through CANONICAL_BRD_SECTIONS so they
 * stay in sync with the user prompt and `sectionDeliverablesEnforcement`.
 * Previously the section numbers here had drifted (e.g. Business Rules was
 * called "Section 5" although the prompt emits it as "Section 7"), which
 * caused the auto-repair pass to look up the wrong section.
 */
export function validateBrdQuality(markdown: string, isUploadMode: boolean = false): string[] {
  const issues: string[] = [];
  const md = markdown || "";
  // Resolve canonical refs once so the strings shown to the user always
  // match the actual structure emitted by the generation prompt.
  const ref = formatCanonicalSectionRef;

  if (hasBracketPlaceholders(md)) {
    issues.push("Document contains bracket placeholders (e.g. [Author Name]). Use TBD or Unknown instead.");
  }

  const docInfo = getSectionContent(md, "Document Information");
  if (!docInfo || !docInfo.includes("|")) issues.push(`${ref("1")} must include a Document Information table (Attribute | Description).`);
  else {
    if (!/Project Name|Version|Prepared By|Date|Project Sponsor|Document Status|Approval Status/i.test(docInfo)) {
      issues.push(`${ref("1")} must include a standard Document Information table.`);
    }
  }

  const execSummary = getSectionContent(md, "Executive Summary");
  if (!execSummary) issues.push(`${ref("2")} has no content.`);
  else if (execSummary.length < 50) issues.push(`${ref("2")} should contain a more detailed project summary.`);

  // KPIs are Section 4.3.
  const kpiSection = getSectionContent(md, "Key Performance Indicators");
  const kpiRows = countTableRows(kpiSection);
  const kpiSourceLimited = hasSourceFidelityPlaceholders(kpiSection);
  if (!kpiSection || !kpiSection.includes("|")) issues.push(`${ref("4.3")} must include a KPIs table (KPI ID | KPI Name | Description | Measurement).`);
  else if (!kpiSourceLimited && kpiRows < 4) issues.push(`${ref("4.3")} table must have at least 4 KPI rows.`);

  // Stakeholders live at Section 5.1.
  const stakeholders = getSectionContent(md, "Key Stakeholders");
  if (!stakeholders || !stakeholders.includes("|")) issues.push(`${ref("5.1")} must include a stakeholder table.`);
  if (hasBracketPlaceholders(stakeholders)) issues.push(`${ref("5.1")} contains bracket placeholders.`);

  // User Personas live at Section 5.2.
  const personas = getSectionContent(md, "User Personas");
  const personaRows = countTableRows(personas);
  const hasQAPersona = /QA|Quality Assurance|Test Analyst|QA Engineer|tester|testing perspective/i.test(personas);
  if (!personas || !personas.includes("|")) issues.push(`${ref("5.2")} must include a User Personas table.`);
  else if (!isUploadMode) {
    if (personaRows < 2) issues.push(`${ref("5.2")} must include at least 2 persona rows.`);
    if (!hasQAPersona) issues.push(`${ref("5.2")} must include at least one QA perspective persona.`);
  }

  // Business Rules is Section 7 (NOT 5).
  const businessRules = getSectionContent(md, "Business Rules");
  const brRows = (businessRules.match(/\bBR-(?:[A-Z]+-\d+|\d{2,})\b/g) || []).length;
  const brSourceLimited = hasSourceFidelityPlaceholders(businessRules);
  if (!businessRules || !businessRules.includes("|")) issues.push(`${ref("7")} must include a rules table (ID | Rule | Rationale).`);
  else if (!isUploadMode && !brSourceLimited && brRows < 15) {
    issues.push(`${ref("7")} table must have at least 15 rules (BR-01..BR-15+).`);
  }

  // Data Entities is Section 8.1 (NOT 6.1).
  const dataEntities = getSectionContent(md, "Data Entities");
  const commerceKeywords = /\b(order|commerce|product|cart|checkout|invoice|payment|shipment|inventory)\b/i.test(md);
  const entityRows = countTableRows(dataEntities);
  const entitiesSourceLimited = hasSourceFidelityPlaceholders(dataEntities);
  if (!dataEntities || !dataEntities.includes("|")) issues.push(`${ref("8.1")} must include an Entity table.`);
  else if (commerceKeywords && !entitiesSourceLimited && entityRows < 10) issues.push(`${ref("8.1")} table must have at least 10 entities when requirements mention commerce/order/service (or use TBD/Not specified in source).`);

  // Risks and Mitigation is Section 10 (NOT 8).
  const risks = getSectionContent(md, "Risks and Mitigation");
  if (!risks || !risks.includes("|")) issues.push(`${ref("10")} must include a Risk Register table.`);

  // Timeline and Milestones is Section 11 (NOT 9).
  const timeline = getSectionContent(md, "Timeline and Milestones");
  if (!timeline || !timeline.includes("|")) issues.push(`${ref("11")} must include a Milestones table.`);

  // Reference Documents is Section 12.1.
  const refDocs = getSectionContent(md, "Reference Documents");
  if (!refDocs || !refDocs.includes("|")) issues.push(`${ref("12.1")} must include a Reference Documents table (Document Name | Description | Source).`);

  // Approval Matrix is Section 12.2.
  const approvalMatrix = getSectionContent(md, "Approval Matrix");
  if (!approvalMatrix || !approvalMatrix.includes("|")) issues.push(`${ref("12.2")} must include a Role | Name | Responsibility | Approval Status table.`);

  // Table Integrity Check: Detect truncated tables
  const lines = md.split("\n");
  const lastLine = lines[lines.length - 1].trim();
  if (lastLine.startsWith("|") && !lastLine.endsWith("|") && !lastLine.includes("---")) {
    issues.push("Section 6 table is truncated. CONTINUE the table starting from the last complete requirement.");
  }

  // Final Structure Audit: Ensure all 13 canonical sections exist.
  const CANONICAL_HEADINGS = [
    "Document Information", "Executive Summary", "Introduction", "Business Objectives",
    "Stakeholder Analysis", "Requirements", "Business Rules", "Data Requirements",
    "Constraints, Assumptions, and Dependencies", "Risks and Mitigation",
    "Timeline and Milestones", "Appendices", "Additional Organizational Guidelines"
  ];
  for (const heading of CANONICAL_HEADINGS) {
    // Match "## 1. Heading" or "## Heading" or "## 1 Heading"
    const pattern = new RegExp(`##\\s*\\d*\\.?\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (!pattern.test(md)) {
      issues.push(`Missing mandatory section: ${heading}`);
    }
  }

  return issues;
}

/**
 * Result of a structural validation pass over BRD markdown.
 * - `valid` is true when the document contains exactly the 13 canonical
 *   top-level sections (## 1..## 13) in the canonical order, with no
 *   missing/duplicate/extra top-level sections.
 * - `issues` lists human-readable descriptions of every structural defect.
 * - `missingSections`/`extraSections`/`outOfOrderSections` give the LLM
 *   targeted, machine-actionable hints when we ask it to repair.
 */
export interface BrdStructureValidationResult {
  valid: boolean;
  issues: string[];
  missingSections: CanonicalBrdSection[];
  extraSections: string[];
  outOfOrderSections: string[];
}

/**
 * Validate that `markdown` contains exactly the 13 canonical top-level
 * BRD sections in canonical order. This is intentionally separate from
 * `validateBrdQuality` (which checks deliverables WITHIN sections): a
 * well-structured doc can still fail content-level checks, and a
 * content-rich doc can still be missing or reordering sections.
 */
export function validateBrdStructure(markdown: string): BrdStructureValidationResult {
  const issues: string[] = [];
  const missingSections: CanonicalBrdSection[] = [];
  const extraSections: string[] = [];
  const outOfOrderSections: string[] = [];

  // Collect every level-2 heading line ("## …"), preserving order.
  const lines = (markdown || "").split("\n");
  const topLevelHeadings: Array<{ index: number; lineNumber: number; text: string; sectionNumber?: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    const headingText = m[1].trim();
    const numMatch = headingText.match(/^(\d+(?:\.\d+)*)\s*[\.\)]?\s+/);
    topLevelHeadings.push({
      index: topLevelHeadings.length,
      lineNumber: i + 1,
      text: headingText,
      sectionNumber: numMatch ? numMatch[1] : undefined,
    });
  }

  // Build a map of which canonical sections we found and where.
  const canonicalNumbers = CANONICAL_BRD_TOP_LEVEL_SECTIONS.map((s) => s.number);
  const foundIndexes = new Map<string, number>(); // canonicalNumber -> first heading index
  for (const heading of topLevelHeadings) {
    if (heading.sectionNumber && canonicalNumbers.includes(heading.sectionNumber)) {
      if (!foundIndexes.has(heading.sectionNumber)) {
        foundIndexes.set(heading.sectionNumber, heading.index);
      }
    }
  }

  for (const section of CANONICAL_BRD_TOP_LEVEL_SECTIONS) {
    if (!foundIndexes.has(section.number)) {
      missingSections.push(section);
      issues.push(
        `Missing required top-level section "## ${section.number}. ${section.title}".`,
      );
    }
  }

  // Detect extra top-level sections (that aren't in the canonical 13).
  for (const heading of topLevelHeadings) {
    const isCanonical =
      heading.sectionNumber && canonicalNumbers.includes(heading.sectionNumber);
    if (!isCanonical) {
      // Allow purely non-numbered top-level headings like a leading title only when
      // they appear before any canonical section. Otherwise treat as extra.
      const firstCanonicalIdx = Math.min(
        ...Array.from(foundIndexes.values()),
        Number.POSITIVE_INFINITY,
      );
      if (heading.index >= firstCanonicalIdx) {
        extraSections.push(heading.text);
        issues.push(`Unexpected extra top-level section "## ${heading.text}".`);
      }
    }
  }

  // Detect out-of-order canonical sections (we expect strictly increasing
  // canonical order: 1, 2, 3, …, 13).
  let lastCanonicalRank = -1;
  for (const heading of topLevelHeadings) {
    if (!heading.sectionNumber || !canonicalNumbers.includes(heading.sectionNumber)) continue;
    const rank = canonicalNumbers.indexOf(heading.sectionNumber);
    if (rank <= lastCanonicalRank) {
      outOfOrderSections.push(heading.text);
      const expected = canonicalNumbers[lastCanonicalRank + 1] || "<end>";
      issues.push(
        `Section ${heading.sectionNumber} appears out of canonical order (expected next: Section ${expected}).`,
      );
    } else {
      lastCanonicalRank = rank;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    missingSections,
    extraSections,
    outOfOrderSections,
  };
}

/**
 * Scoring context for scoreBrdQuality (e.g. mandatory list for coverage penalty).
 */
export interface ScoreBrdQualityContext {
  mandatoryRequirementsText?: string;
  /** Precomputed missing requirement count; if not set and mandatoryRequirementsText is set, it will be computed. */
  missingCount?: number;
}

/**
 * Score BRD markdown quality (higher is better). Used by generateBRDParallel to pick the best of two variants.
 * When sections use TBD/Not specified in source (source-fidelity), row-count penalties are not applied so client scores stay acceptable.
 * - Start: 100
 * - Each validation issue: -10
 * - Bracket placeholder present: -20
 * - Requirement coverage missing > 0: -30
 * - Business Rules table < 15 rows: -15 (skipped if section has TBD/Not specified in source)
 * - KPI table < 6 rows: -15 (skipped if section has TBD/Not specified in source)
 */
export function scoreBrdQuality(
  markdown: string,
  context?: ScoreBrdQualityContext,
): number {
  let score = 100;
  const issues = validateBrdQuality(markdown);
  score -= issues.length * 10;

  if (/\[[^\]]{2,}\]/.test(markdown)) score -= 20;

  let missingCount = context?.missingCount;
  if (missingCount === undefined && context?.mandatoryRequirementsText?.trim()) {
    const given = splitRequirementsList(context.mandatoryRequirementsText);
    const extracted = extractRequirementRowsFromMarkdown(markdown);
    missingCount = findMissingRequirements(given, extracted.all).length;
  }
  if (missingCount !== undefined && missingCount > 0) score -= 30;

  const businessRules = getSectionContent(markdown, "Business Rules");
  const brRows = (businessRules.match(/\bBR-(?:[A-Z]+-\d+|\d+)\b/g) || []).length;
  const brSourceLimited = hasSourceFidelityPlaceholders(businessRules);
  if (!brSourceLimited && brRows < 15) score -= 15;

  const kpiSection = getSectionContent(markdown, "Key Performance Indicators");
  const kpiRows = countTableRows(kpiSection);
  const kpiSourceLimited = hasSourceFidelityPlaceholders(kpiSection);
  if (!kpiSourceLimited && kpiRows < 6) score -= 15;

  return Math.max(0, score);
}

/**
 * Normalize requirement text for comparison (simple and explainable)
 */
function normalizeRequirementText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\r/g, "")
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9\s\-\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split user "Given Requirements" text into individual items.
 * Supports:
 * - lines starting with "-" "*" "•"
 * - numbered lists
 * - plain lines
 */
export function splitRequirementsList(requirementsText: string): string[] {
  const raw = (requirementsText || "").replace(/\r/g, "").trim();
  if (!raw) return [];

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const items: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) continue;
    if (/^\|?\s*[-:\s|]+\|?\s*$/.test(line)) continue;

    let cleaned = line;
    if (line.includes("|")) {
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      const lowerCells = cells.map((c) => c.toLowerCase());
      const looksLikeHeader = lowerCells.some((c) =>
        /^(id|requirement|requirement description|description|priority|type|status)$/.test(c),
      );
      if (looksLikeHeader) continue;

      const [first, second, third] = cells;
      if (second && /\b(FR|NFR|TR|IR|REQ|R|BR)-?\d+\b/i.test(first || "")) {
        cleaned = [first, second, third].filter(Boolean).join(" ");
      } else if (second && cells.length >= 3) {
        cleaned = cells.join(" ");
      }
    }

    cleaned = cleaned
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[\).\]]\s+/, "")
      .trim();

    if (/^(functional|non-functional|technical|integration|business|user)\s+requirements?$/i.test(cleaned)) {
      continue;
    }

    if (cleaned.length >= 3) items.push(cleaned);
  }

  // De-dupe (normalized)
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const it of items) {
    const n = normalizeRequirementText(it);
    if (!n) continue;
    if (!seen.has(n)) {
      seen.add(n);
      uniq.push(it);
    }
  }
  return uniq;
}

/**
 * Transform extracted existingRequirements (or merged with mandatory block) into a numbered
 * canonical list (R1., R2., ...) for the BRD prompt. Used so every Section 4 row can map to an R-item.
 */
export function toCanonicalRequirementsList(requirementsText: string): string {
  const items = splitRequirementsList(requirementsText || "");
  const filtered = items.filter(
    (line) =>
      line.length >= 5 &&
      !/^=+$/.test(line.trim()) &&
      !/^MANDATORY REQUIREMENTS|DO NOT OMIT|Include each item/i.test(line.trim()),
  );
  if (filtered.length === 0) {
    return "R1. (No requirements specified in source.)";
  }
  return filtered.map((item, i) => `R${i + 1}. ${item.trim()}`).join("\n");
}

/**
 * Extract all requirement descriptions from markdown tables in Section 4 (FR/NFR/TR/IR).
 * This is intentionally robust but simple (no heavy markdown parser).
 */
export function extractRequirementRowsFromMarkdown(markdown: string): {
  functional: string[];
  nonFunctional: string[];
  technical: string[];
  integration: string[];
  all: string[];
} {
  const text = markdown || "";
  const lines = text.split("\n");

  const rows: string[] = [];
  for (const line of lines) {
    // markdown pipe row likely contains an ID like FR-01, NFR-01, BR-AUTH-001 etc.
    if (!line.includes("|")) continue;

    const maybeId =
      /\b(FR-\d+|NFR-\d+|TR-\d+|IR-\d+|BR-(?:[A-Z]+-\d+|\d+)|DR-\d+)\b/.test(line);
    if (!maybeId) continue;

    // Split columns; expect: | ID | Requirement Description |
    const parts = line
      .split("|")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    // Typically [ID, desc]
    if (parts.length >= 2) {
      const id = parts[0];
      const desc = parts[1];
      if (desc && desc.length > 5) {
        rows.push(`${id}::${desc}`);
      }
    }
  }

  const functional: string[] = [];
  const nonFunctional: string[] = [];
  const technical: string[] = [];
  const integration: string[] = [];
  const businessRulesArr: string[] = [];
  const dataReqs: string[] = [];

  for (const r of rows) {
    const [id, desc] = r.split("::");
    if (!id || !desc) continue;
    if (id.startsWith("FR-")) functional.push(desc);
    else if (id.startsWith("NFR-")) nonFunctional.push(desc);
    else if (id.startsWith("TR-")) technical.push(desc);
    else if (id.startsWith("IR-")) integration.push(desc);
    else if (id.startsWith("BR-")) businessRulesArr.push(desc);
    else if (id.startsWith("DR-")) dataReqs.push(desc);
  }

  const all = [...functional, ...nonFunctional, ...technical, ...integration, ...businessRulesArr, ...dataReqs];
  return { functional, nonFunctional, technical, integration, all };
}

/** Build a simple RTM mapping canonical requirements to BRD requirement rows. */
function buildRequirementTraceabilityMatrix(
  canonical: CanonicalRequirement[],
  extracted: ReturnType<typeof extractRequirementRowsFromMarkdown>,
): RequirementTraceabilityMatrixEntry[] {
  const entries: RequirementTraceabilityMatrixEntry[] = [];
  const allGenerated = extracted.all || [];

  // Map canonical requirements -> coverage
  for (const c of canonical) {
    const normSource = normalizeRequirementText(c.text);
    let coverage: RequirementTraceabilityMatrixEntry["coverageStatus"] = "Missing";
    let note: string | undefined;

    const match = allGenerated.find((desc) => {
      const n = normalizeRequirementText(desc);
      return n && normSource && (n.includes(normSource) || normSource.includes(n));
    });

    if (match) {
      coverage = "Covered";
    }

    entries.push({
      sourceId: c.id,
      sourceRequirement: c.text,
      sourceType: c.sourceType,
      domainTags: c.domainTags,
      brdSection: "4. Requirements",
      brdRequirementId: undefined,
      coverageStatus: coverage,
      notes: note,
    });
  }

  return entries;
}

/** Second-level quality metrics derived from RTM and domain profile. */
function evaluateBrdQualityV2(
  canonical: CanonicalRequirement[],
  rtm: RequirementTraceabilityMatrixEntry[],
  domainProfile: DomainProfileSummary,
): BrdQualityMetrics {
  const total = canonical.length || 1;
  const covered = rtm.filter((e) => e.coverageStatus === "Covered").length;
  const missing = rtm.filter((e) => e.coverageStatus === "Missing").length;

  const sourceCoveragePercent = (covered / total) * 100;
  const unsupportedRequirementPercent = 0; // Reserved for future: detect unsupported Section 4 rows explicitly

  // Simple traceability score: coverage with small penalty for missing
  const traceabilityScore = Math.max(
    0,
    Math.min(100, sourceCoveragePercent - missing * 1.5),
  );

  // Domain profile compliance: slightly stricter for compliance-heavy domains
  const complianceHeavy = ["banking", "payments", "trade_finance", "insurance", "healthcare", "compliance_regulatory"].includes(
    domainProfile.key,
  );
  const baseCompliance = complianceHeavy ? 70 : 80;
  const domainProfileComplianceScore = Math.max(
    0,
    Math.min(100, baseCompliance + (traceabilityScore - 70) * 0.4),
  );

  // BRD accuracy as an aggregate of traceability and domain compliance
  const brdAccuracyScore = Math.round(
    (traceabilityScore * 0.6 + domainProfileComplianceScore * 0.4),
  );

  return {
    sourceCoveragePercent,
    unsupportedRequirementPercent,
    traceabilityScore: Math.round(traceabilityScore),
    brdAccuracyScore,
    domainProfileComplianceScore: Math.round(domainProfileComplianceScore),
  };
}

/** Domain-adaptive acceptance decision for enterprise clients. */
function evaluateClientAcceptance(
  quality: BrdQualityMetrics,
  domainProfile: DomainProfileSummary,
): AcceptanceSummary {
  const complianceHeavy = ["banking", "payments", "trade_finance", "insurance", "healthcare", "compliance_regulatory"].includes(
    domainProfile.key,
  );

  const minCoverage = complianceHeavy ? 85 : 75;
  const minAccuracy = complianceHeavy ? 85 : 75;

  const reasons: string[] = [];

  if (quality.sourceCoveragePercent < minCoverage) {
    reasons.push(
      `Source coverage below threshold for ${domainProfile.label} (${quality.sourceCoveragePercent.toFixed(
        1,
      )}% vs ${minCoverage}%).`,
    );
  }
  if (quality.brdAccuracyScore < minAccuracy) {
    reasons.push(
      `BRD accuracy score below threshold (${quality.brdAccuracyScore} vs ${minAccuracy}).`,
    );
  }

  let status: AcceptanceSummary["status"];
  if (!reasons.length) {
    status = "acceptable";
  } else if (
    quality.sourceCoveragePercent >= minCoverage - 10 &&
    quality.brdAccuracyScore >= minAccuracy - 10
  ) {
    status = "acceptable_with_gaps";
  } else {
    status = "not_acceptable";
  }

  return {
    status,
    reasons,
  };
}

/**
 * Compare a given requirements list against the BRD extracted rows to find missing items.
 * Matching approach:
 * - normalized substring match in either direction to keep it explainable.
 */
export function findMissingRequirements(
  givenRequirements: string[],
  generatedRequirements: string[],
): string[] {
  const genNorm = generatedRequirements.map(normalizeRequirementText);
  const missing: string[] = [];

  for (const req of givenRequirements) {
    const r = normalizeRequirementText(req);
    if (!r) continue;

    const found = genNorm.some((g) => g.includes(r) || r.includes(g));
    if (!found) missing.push(req);
  }

  return missing;
}

// =============================================================================
// BRD field extraction (Bedrock/Claude-aware, chunked)
//
// Why this is structured the way it is — the short version:
//
//   - The deployed LLM is AWS Bedrock + Anthropic Claude. The OpenAI-shaped
//     `openai` import is a façade (see [server/platform/llm/bedrock-impl.ts]).
//   - Bedrock silently caps `maxTokens` at 4096 (≈16K chars). A single LLM
//     call producing all 21 BRD fields, 12 of them as Markdown pipe-tables,
//     does NOT fit in 4096 tokens for real-world BRDs and Claude responds
//     with prose-only or no JSON at all.
//   - `response_format: { type: "json_object" }` is silently ignored on
//     Bedrock — there is no JSON-mode enforcement at the protocol level.
//
// The fix uses three independent techniques together:
//   1. Split the work into THREE smaller chunked calls (metadata /
//      requirements / other-tables) so each chunk's full JSON output fits
//      well inside 4096 tokens.
//   2. Force JSON shape via prompt engineering:
//        - System-prompt opener mandates first-char-`{` / last-char-`}`.
//        - Claude assistant pre-fill: end the message list with
//          `{ role: "assistant", content: "{" }` so the model continues
//          from `{` and cannot open with prose. We re-prepend `{` to the
//          response before parsing.
//        - `stop` sequences bound the response so Claude can't slide into
//          post-JSON commentary that would break the parser.
//   3. Coerce non-strings to "" via Zod preprocess (so `null`, numbers,
//      booleans, etc. don't fail validation), and try a one-pass JSON
//      repair (close unbalanced quotes/braces, drop trailing commas)
//      before reporting parse failure.
//
// Failure policy: `Promise.allSettled` over the three chunks. Any single
// chunk's success contributes its fields. Total failure (0 of 3 chunks
// succeed) throws — the upload route's smart fallback will then run
// `generateBRD` on the raw text.
// =============================================================================

/**
 * String-or-coerce-to-empty Zod field.
 *
 * The previous strict `z.string().default("")` failed validation when
 * Claude emitted `null` for an empty optional field (extremely common).
 * The preprocess coerces `null`, `undefined`, numbers, booleans, arrays
 * and objects to a string — empty for nullish, `String(x)` otherwise —
 * so a single ill-typed value can no longer make the whole extraction
 * fail Zod. Content-level placeholder filtering still happens in the
 * `sanitize()` step at the end of the public function.
 */
const stringField = z.preprocess(
  (v) => (v == null ? "" : typeof v === "string" ? v : String(v)),
  z.string(),
);

/**
 * Zod schemas — one per chunk + a merged schema kept for callers that
 * already had a handle on the full input shape (e.g. tests, type lookups).
 */
const chunkAMetadataSchema = z
  .object({
    projectName: stringField,
    projectDescription: stringField,
    targetAudience: stringField,
    keyFeatures: stringField,
    constraints: stringField,
    assumptions: stringField,
    dependencies: stringField,
    budget: stringField,
  })
  .passthrough();

const chunkBRequirementsSchema = z
  .object({
    functionalRequirements: stringField,
    nonFunctionalRequirements: stringField,
    technicalRequirements: stringField,
    integrationRequirements: stringField,
  })
  .passthrough();

const chunkDVerbatimSchema = z
  .object({
    existingRequirements: stringField,
  })
  .passthrough();

const chunkCOtherSchema = z
  .object({
    businessObjectives: stringField,
    successCriteria: stringField,
    stakeholders: stringField,
    businessRules: stringField,
    dataRequirements: stringField,
    risksAndMitigation: stringField,
    glossary: stringField,
    timeline: stringField,
  })
  .passthrough();

const extractedBrdInputSchema = z
  .object({
    projectName: stringField,
    projectDescription: stringField,
    businessObjectives: stringField,
    successCriteria: stringField,
    targetAudience: stringField,
    stakeholders: stringField,
    keyFeatures: stringField,
    functionalRequirements: stringField,
    nonFunctionalRequirements: stringField,
    technicalRequirements: stringField,
    integrationRequirements: stringField,
    businessRules: stringField,
    dataRequirements: stringField,
    risksAndMitigation: stringField,
    constraints: stringField,
    assumptions: stringField,
    dependencies: stringField,
    glossary: stringField,
    timeline: stringField,
    budget: stringField,
    existingRequirements: stringField,
  })
  .passthrough();

type ExtractedBrdInput = z.infer<typeof extractedBrdInputSchema>;

/**
 * Best-effort repair for almost-but-not-quite-valid JSON returned by an
 * LLM. Targets the common Claude/Bedrock and Azure OpenAI failure modes:
 *   - Trailing commas before `}` or `]`.
 *   - Missing commas between adjacent `}{`, `][`, `}[`, `]{`.
 *   - Unescaped newlines / tabs / carriage returns inside strings (the
 *     direct cause of `Expected ',' or ']' after array element` errors
 *     when a string field contains a literal newline).
 *   - ASCII control characters mid-stream.
 *   - Output truncated mid-string (odd number of unescaped `"`).
 *   - Output truncated with unbalanced `{` / `[`. Closes them in stack
 *     order (LIFO) so a truncated array is closed with `]` not `}`.
 *
 * The repair is a single pass over the input followed by stack-based
 * closure. If the repaired string still fails to parse, the caller
 * reports a `parse_invalid_json` reason and moves on to the corrective
 * re-prompt or the array-salvage fallback.
 */
function repairTruncatedJson(raw: string): string {
  // 1. Strip ASCII control chars that JSON does not accept (keep \t, \n,
  //    \r — those are handled by the in-string escaper below).
  let s = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

  // 2. Walk the string once, tracking string state and the brace/bracket
  //    stack. While walking we (a) escape unescaped \n / \t / \r inside
  //    strings and (b) record the order of unclosed openers so step 5
  //    can close them with the right closer.
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escapeNext = false;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escapeNext) {
      out += ch;
      escapeNext = false;
      continue;
    }
    if (ch === "\\" && inString) {
      out += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { continue; }
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
      continue;
    }
    if (ch === "{" || ch === "[") stack.push(ch as "{" | "[");
    else if (ch === "}" || ch === "]") stack.pop();
    out += ch;
  }
  s = out;

  // 3. If the walk ended inside a string, close it.
  if (inString) s += '"';

  // 4. Repair structural commas (outside strings — safe because step 2
  //    has already escaped any in-string newlines).
  s = s.replace(/,(\s*[}\]])/g, "$1"); // trailing commas
  s = s.replace(/}(\s*){/g, "},$1{");   // missing comma between objects
  s = s.replace(/](\s*)\[/g, "],$1[");   // missing comma between arrays
  s = s.replace(/}(\s*)\[/g, "},$1[");   // object then array
  s = s.replace(/](\s*){/g, "],$1{");    // array then object

  // 5. Close unbalanced openers in LIFO order so a truncated array is
  //    closed with `]` not `}`.
  while (stack.length > 0) {
    const opener = stack.pop();
    s += opener === "{" ? "}" : "]";
  }
  return s;
}

/**
 * Last-ditch salvage for an array-of-objects shape where one element is
 * malformed (e.g. truncated mid-object, the `Expected ',' or ']' after
 * array element` failure mode). Walks the array character-by-character
 * tracking nesting and string state, splits at top-level `,` boundaries,
 * and tries to JSON.parse each element independently. Returns whichever
 * elements parse cleanly. Returns `null` if the input doesn't look like
 * an array at all.
 *
 * This is intentionally separate from `repairTruncatedJson` because it
 * silently drops elements rather than guessing structure — only suitable
 * for callers that prefer a partial result over a hard failure (e.g.
 * canonical requirement extraction, where 90 of 100 requirements is far
 * better than zero).
 */
function salvageJsonArrayElements(raw: string): unknown[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  // Work with whatever is between the outermost `[ ]` (or what looks
  // like it after truncation — we'll splice on top-level commas).
  const body = raw.slice(start + 1, end >= 0 ? end : raw.length);

  const elements: string[] = [];
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escapeNext) { buf += ch; escapeNext = false; continue; }
    if (ch === "\\" && inString) { buf += ch; escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; buf += ch; continue; }
    if (inString) { buf += ch; continue; }
    if (ch === "{" || ch === "[") { depth++; buf += ch; continue; }
    if (ch === "}" || ch === "]") { depth--; buf += ch; continue; }
    if (ch === "," && depth === 0) {
      elements.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) elements.push(buf);

  const out: unknown[] = [];
  for (const elem of elements) {
    const trimmed = elem.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Try a per-element repair pass before giving up on the element.
      try {
        out.push(JSON.parse(repairTruncatedJson(trimmed)));
      } catch {
        // Element is unrecoverable — drop it silently. Caller logs
        // overall salvage stats.
      }
    }
  }
  return out;
}

/**
 * Discriminated reason codes for parse / validation failure. Surfacing
 * these verbatim in logs and thrown errors lets a future reader tell
 * "the model returned no JSON at all" from "the JSON parsed but Zod
 * rejected a field shape" — previously both flowed through a single
 * `failed Zod validation` log line that lied about which stage actually
 * failed.
 */
type ExtractionParseReason =
  | { kind: "parse_no_json"; message: string }
  | { kind: "parse_invalid_json"; message: string }
  | { kind: "zod_invalid"; message: string };

/**
 * JSON parser with one-pass repair. Returns a discriminated result so the
 * caller can distinguish "no JSON at all" from "JSON parsed but is
 * structurally wrong".
 *
 * Note: the assistant pre-fill technique elides the leading `{` from
 * the response Claude emits. `callExtractionLlm` re-prepends it before
 * passing the content here, so this function always receives a string
 * that *should* start with `{`.
 */
function parseExtractionJson(
  content: string,
): { ok: true; value: unknown } | { ok: false; reason: ExtractionParseReason } {
  let raw = content.trim();
  // Strip a single ```json ... ``` fence if Claude added one despite instructions.
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch && codeBlockMatch[1]) raw = codeBlockMatch[1].trim();

  // First, try a clean parse.
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (firstErr) {
    // Second, look for a `{...}` substring (handles cases where Claude
    // prefixed prose despite our enforcement, or trailed extra text).
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return { ok: true, value: JSON.parse(jsonMatch[0]) };
      } catch {
        try {
          return { ok: true, value: JSON.parse(repairTruncatedJson(jsonMatch[0])) };
        } catch (repairErr) {
          return {
            ok: false,
            reason: {
              kind: "parse_invalid_json",
              message: repairErr instanceof Error ? repairErr.message : String(repairErr),
            },
          };
        }
      }
    }
    // Third, no `}` at all — try repairing the raw content (likely truncated
    // mid-output). If that fails, give up with a `parse_no_json` reason.
    if (raw.includes("{")) {
      try {
        return { ok: true, value: JSON.parse(repairTruncatedJson(raw)) };
      } catch {
        // fall through
      }
    }
    return {
      ok: false,
      reason: {
        kind: "parse_no_json",
        message:
          "No JSON object found in extraction response (no '{' substring or repair failed).",
      },
    };
  }
}

/**
 * Shared opener every chunk's system prompt starts with — the strict
 * Claude/Bedrock JSON contract. Lifted into a constant so all three
 * chunks use the same wording (and so it's easy to tighten in one place).
 */
const CLAUDE_JSON_CONTRACT = `CRITICAL OUTPUT CONTRACT:
- Your ENTIRE response MUST be exactly one JSON object — nothing else.
- The very first character of your response MUST be '{' (an opening brace).
- The very last character of your response MUST be '}' (a closing brace).
- Do NOT emit any character before the opening '{' (no whitespace, no "Here is", no "Sure,", no headers).
- Do NOT emit any character after the closing '}' (no commentary, no "Let me know", no signature).
- Do NOT wrap the JSON in markdown code fences (\`\`\`json or \`\`\`). Output the raw JSON bytes directly.
- If a key has no source content, set it to "" — do NOT skip the key, do NOT explain why, just emit "".
- Every value MUST be a string. Do NOT use null, numbers, booleans, arrays, or objects as values.
- Inside string values, escape literal newlines as \\n and literal quotes as \\". Do not include unescaped control characters.

ABSOLUTE RULES:
- Use ONLY the actual document text. Do NOT invent, paraphrase, summarize, infer, or fill from general knowledge.
- Preserve the original wording from the source. Light formatting normalization (whitespace, table structure) is allowed; rewording is NOT.
- Do NOT use placeholders like "TBD", "N/A", or "To be defined". An empty string "" is the correct empty value.

If you are about to write any character that is not '{' as your first character, STOP and start over with '{'.`;

const SHARED_EXTRACTION_SYSTEM = `You are an expert Business Analyst extracting structured fields from a Business Requirements Document.

${CLAUDE_JSON_CONTRACT}

The next user message contains chunk-specific field instructions. Follow them exactly.`;

function extractionChunkInstructions(fullSystemPrompt: string): string {
  const idx = fullSystemPrompt.indexOf(CLAUDE_JSON_CONTRACT);
  if (idx === -1) return fullSystemPrompt.trim();
  return fullSystemPrompt.slice(idx + CLAUDE_JSON_CONTRACT.length).trim();
}

/**
 * Generic LLM call helper used by all three chunks.
 *
 * History note: an earlier revision used Anthropic-style assistant
 * pre-fill (`{ role: "assistant", content: "{" }` as the last message)
 * to force Claude to begin its response with `{`. That technique is
 * rejected by the deployed Bedrock variant in this account with the
 * error
 *
 *   "This model does not support assistant message prefill.
 *    The conversation must end with a user message."
 *
 * It also fails most non-Anthropic models the same way. So we no longer
 * use prefill; instead we rely on:
 *   - A very strict system contract (`CLAUDE_JSON_CONTRACT`) that
 *     repeats the "first character must be '{'" rule four times.
 *   - `stop` sequences that terminate Claude before it slides into
 *     post-JSON commentary (`Thank you`, `Note:`, `Let me know`, a
 *     trailing markdown header, or a fenced code block).
 *   - The robust `parseExtractionJson` + `repairTruncatedJson` pair
 *     downstream, which handles preamble prose, fenced output, and
 *     truncation if the model still slips.
 *
 * `maxTokens: 4096` matches Bedrock's hard cap; anything higher is
 * silently reduced. We make the cap explicit so reviewers see it.
 *
 * Throws only on truly empty completions, which the chunk runner
 * treats as a parse-stage failure with a `parse_no_json` reason.
 */
async function callExtractionLlm(opts: {
  extractionPrefix: JobCachePrefix;
  chunkInstructions: string;
  correctiveInstruction?: string;
  maxTokens?: number;
  images?: Array<{ data: string; mediaType: string }>;
}): Promise<string> {
  const reminder =
    "Reminder: respond with a single JSON object only, starting with '{' and ending with '}'. No preamble, no fences, no trailing text.";
  const dynamicUser = opts.correctiveInstruction
    ? `${opts.chunkInstructions}\n\n${opts.correctiveInstruction}\n\n${reminder}`
    : `${opts.chunkInstructions}\n\n${reminder}`;

  const documentText = opts.extractionPrefix.staticUser;
  const userContent: any[] = [{ type: "text", text: documentText }];

  if (opts.images && opts.images.length > 0) {
    const imagesToProcess = opts.images.slice(0, 10);
    for (const img of imagesToProcess) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType,
          data: img.data,
        },
      });
    }
  }

  const cached = toLlmMessages(opts.extractionPrefix, dynamicUser);

  const messages: Array<{ role: "system" | "user"; content: any; cachePoint?: boolean }> = [
    { role: "system", content: cached[0]?.content ?? opts.extractionPrefix.staticSystem, cachePoint: cached[0]?.cachePoint },
    {
      role: "user",
      content:
        cached.length > 2
          ? [
              ...(Array.isArray(cached[1]?.content)
                ? cached[1].content
                : [{ type: "text", text: String(cached[1]?.content || documentText) }]),
              ...userContent.filter((b) => b.type === "image"),
              { type: "text", text: dynamicUser },
            ]
          : userContent.length > 1
            ? [...userContent, { type: "text", text: dynamicUser }]
            : cached[1]?.content ?? documentText,
      cachePoint: cached[1]?.cachePoint,
    },
  ];

  if (cached.length > 2 && userContent.length === 1) {
    messages.push({
      role: "user",
      content: dynamicUser,
    });
  }
  const response = await openai.chat.completions.create({
    model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
    messages,
    ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.1),
    ...getTokensParam(llmConfig.azureOpenAIDeployment, opts.maxTokens ?? 4096),
    stop: ["\n\n```", "\nThank you", "\n\n# ", "\n\nNote:", "\n\nLet me know"],
  } as any);
  const content = response.choices[0]?.message?.content || "";
  if (!content.trim()) {
    throw new Error("Empty completion returned by extraction model");
  }
  // No prefill, so the response is whatever the model chose to emit.
  // `parseExtractionJson` strips fenced blocks, scans for the first
  // `{...}` substring, and falls back to `repairTruncatedJson` — so a
  // little leading prose or a stray markdown fence is tolerated.
  return content.trimStart();
}

/**
 * Run a single chunk: vanilla call → optional corrective re-prompt.
 *
 * Returns either the validated chunk data or a structured failure with
 * a head/tail snippet of the model response (for log forensics — Phase 1c).
 * The corrective re-prompt explicitly tells Claude what went wrong on the
 * first attempt (parse_no_json / parse_invalid_json / zod_invalid), so
 * the retry is targeted instead of a vague "try again" plea.
 */
async function runExtractionChunk<T extends Record<string, unknown>>(opts: {
  chunkName: string;
  extractionPrefix: JobCachePrefix;
  chunkInstructions: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  images?: Array<{ data: string; mediaType: string }>;
}): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  const tryParseAndValidate = (
    content: string,
  ): { ok: true; data: T } | { ok: false; reason: ExtractionParseReason } => {
    const parsed = parseExtractionJson(content);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    const validation = opts.schema.safeParse(parsed.value);
    if (!validation.success) {
      const formatted = validation.error.issues
        .slice(0, 8)
        .map((iss) => `${iss.path.join(".") || "<root>"}: ${iss.message}`)
        .join("; ");
      return {
        ok: false,
        reason: { kind: "zod_invalid", message: formatted },
      };
    }
    return { ok: true, data: validation.data };
  };

  const logFailure = (
    attempt: "first" | "retry",
    response: string,
    reason: ExtractionParseReason,
  ) => {
    const head = response.slice(0, 200);
    const tail = response.slice(Math.max(0, response.length - 200));
    console.warn(
      `[BRD AI][extract:${opts.chunkName}] ${attempt} attempt failed (kind=${reason.kind}): ${reason.message}`,
      {
        responseLength: response.length,
        head,
        tail,
      },
    );
  };

  // Attempt 1 — vanilla.
  let firstReason: ExtractionParseReason | null = null;
  let firstResponse = "";
  try {
    firstResponse = await callExtractionLlm({
      extractionPrefix: opts.extractionPrefix,
      chunkInstructions: opts.chunkInstructions,
      maxTokens: opts.maxTokens,
      images: opts.images,
    });
    const r = tryParseAndValidate(firstResponse);
    if (r.ok) {
      console.log(
        `[BRD AI][extract:${opts.chunkName}] first attempt succeeded (response=${firstResponse.length} chars)`,
      );
      return r;
    }
    firstReason = r.reason;
    logFailure("first", firstResponse, firstReason);
  } catch (firstErr) {
    firstReason = {
      kind: "parse_no_json",
      message:
        firstErr instanceof Error ? firstErr.message : String(firstErr),
    };
    console.warn(
      `[BRD AI][extract:${opts.chunkName}] first attempt threw before producing JSON:`,
      firstReason.message,
    );
  }

  // Attempt 2 — corrective re-prompt with reason-specific guidance.
  const correctiveInstruction = (() => {
    switch (firstReason.kind) {
      case "parse_no_json":
        return [
          "Your previous response did not contain a JSON object at all.",
          "Your ENTIRE next response MUST be a single JSON object — start with '{' and end with '}'.",
          "Do NOT write any prose, apology, explanation, or markdown fence.",
        ].join(" ");
      case "parse_invalid_json":
        return [
          `Your previous response could not be parsed as JSON: ${firstReason.message}.`,
          "Return a SHORTER but well-formed JSON object — even if you have to truncate long table values.",
          "Quote every key and string value with double quotes; never include unescaped newlines inside string literals.",
          "Make sure every '{' and '[' has a matching closer.",
        ].join(" ");
      case "zod_invalid":
        return [
          `Your previous response had invalid field shapes: ${firstReason.message}.`,
          "EVERY value MUST be a string (use \"\" when the source has no content for that key).",
          "Do NOT use null, numbers, booleans, arrays, or objects as values.",
          "Use exactly the keys defined in the system instructions; do not rename them.",
        ].join(" ");
    }
  })();

  let retryResponse = "";
  try {
    retryResponse = await callExtractionLlm({
      extractionPrefix: opts.extractionPrefix,
      chunkInstructions: opts.chunkInstructions,
      correctiveInstruction,
      maxTokens: opts.maxTokens,
      images: opts.images,
    });
    const r = tryParseAndValidate(retryResponse);
    if (r.ok) {
      console.log(
        `[BRD AI][extract:${opts.chunkName}] corrective re-prompt succeeded (response=${retryResponse.length} chars)`,
      );
      return r;
    }
    logFailure("retry", retryResponse, r.reason);
    return {
      ok: false,
      reason: `${r.reason.kind}: ${r.reason.message}`,
    };
  } catch (retryErr) {
    const message =
      retryErr instanceof Error ? retryErr.message : String(retryErr);
    console.warn(
      `[BRD AI][extract:${opts.chunkName}] corrective re-prompt threw:`,
      message,
    );
    return { ok: false, reason: `parse_no_json: ${message}` };
  }
}

/**
 * Build the user-prompt body fragment that wraps the source document.
 * Identical for every chunk so we don't drift in framing between calls.
 */
function buildExtractionUserPrompt(documentText: string): string {
  return `Extract the requested fields from the following document text. Return ONLY a JSON object with the exact keys specified in the system instructions.

----- START OF DOCUMENT -----
${documentText}
----- END OF DOCUMENT -----`;
}

/**
 * Extract structured BRDInput-style fields from a raw BRD document.
 *
 * Runs three concurrent Bedrock/Claude calls (project-metadata,
 * requirements-tables, other-tables) and merges their results. Total
 * failure (zero chunks succeed) throws — the upload route's smart
 * fallback (Phase 3) then runs `generateBRD` on the raw text so the
 * user still gets a 13-section BRD.
 */
export async function extractBrdInputFromDocumentText(
  documentText: string,
  images?: Array<{ data: string; mediaType: string }>,
): Promise<Partial<BRDInput>> {
  const hasVisionImages = !!images && images.length > 0;

  // A short/empty text layer is normally a hard error, but image-based source
  // documents (scanned PDFs, Miro-board exports) legitimately have no text —
  // their content lives entirely in the attached page images, which the
  // vision-capable model reads directly.
  if ((!documentText || documentText.trim().length < 50) && !hasVisionImages) {
    throw new Error("Document text is too short for BRD field extraction");
  }

  const effectiveDocumentText =
    documentText && documentText.trim().length >= 50
      ? documentText
      : "(No extractable text layer was found in this document. Read the requirements directly from the attached page image(s) and extract the requested fields from what you can see.)";

  const userPrompt = buildExtractionUserPrompt(effectiveDocumentText);

  // ===== Chunk A — project metadata (lightweight prose) =====
  const chunkASystemPrompt = `You are an expert Business Analyst extracting STRUCTURED METADATA fields from a Business Requirements Document.

${CLAUDE_JSON_CONTRACT}

EXTRACT THESE EXACT KEYS:

1. "projectName" — Project or system name from the title page, header, or first mention. "" if not present.
2. "projectDescription" — Concise project overview or executive summary copied from source. "" if not present.
3. "targetAudience" — End users, user groups, personas, or intended audience descriptions copied from source. For personas, preserve only the personas explicitly listed or described in the source document; do NOT infer or add adjacent roles such as Admin, QA, Support, Approver, or Customer unless the source states them. If the source has exactly one persona, return exactly that one persona. "" if not present.
4. "keyFeatures" — High-level capabilities and major features as a bullet list, copied from source. Do NOT include detailed requirements (those are extracted separately). "" if not present.
5. "constraints" — Hard constraints from source: regulatory, budget limits, technology mandates, contractual obligations. Bullet list format. Do NOT include assumptions or dependencies.
6. "assumptions" — Statements assumed to be true, copied from source. Bullet list format. Do NOT merge with constraints.
7. "dependencies" — External dependencies stated in source. Bullet list format. Do NOT merge with constraints.
8. "budget" — Budget figures, cost estimates, funding sources. "" if not present.

OUTPUT EXACTLY: { "projectName": "...", "projectDescription": "...", "targetAudience": "...", "keyFeatures": "...", "constraints": "...", "assumptions": "...", "dependencies": "...", "budget": "..." }`;

  // ===== Chunk B — requirements text =====
  // Upload BRDs are source-of-truth documents. Extract requirement sections
  // faithfully into their matching fields so generation can reuse those
  // tables/rows directly instead of re-authoring or re-counting them.
  const chunkBSystemPrompt = `You are an expert Business Analyst extracting REQUIREMENT TEXT from a Business Requirements Document.

${CLAUDE_JSON_CONTRACT}

EXTRACT THESE EXACT KEYS:

"functionalRequirements" — ALL requirements explicitly under source sections/headings/tables that mean Functional Requirements, User Requirements, Business Functional Requirements, Features, Capabilities, or similar. Format as a Markdown pipe-table with exactly 2 columns: | ID | Requirement Description |. The Requirement Description should be concise but MUST be complete, maintaining all core context and specific technical/UI details from the source. Do NOT preserve long paragraphs or extra columns like 'Priority' from the source. Preserve source IDs. "" if not present.

"nonFunctionalRequirements" — ALL requirements explicitly under source sections/headings/tables that mean Non-Functional Requirements, NFRs, Performance, Security, Compliance, Accessibility, Reliability, Scalability, Availability, Usability, Audit, or similar. Format as a Markdown pipe-table with exactly 2 columns: | ID | Requirement Description |. The Requirement Description should be concise but MUST be complete, maintaining all core context. Do NOT preserve extra columns like 'Priority'. "" if not present.

"technicalRequirements" — ALL requirements explicitly under source sections/headings/tables that mean Technical Requirements, Architecture, Data, Platform, Configuration, Environment, Standards, or implementation constraints. Format as a Markdown pipe-table with exactly 2 columns: | ID | Requirement Description |. The Requirement Description should be concise but MUST be complete, maintaining all core context. "" if not present.

"integrationRequirements" — ALL requirements explicitly under source sections/headings/tables that mean Integration Requirements, Interfaces, APIs, External Systems, Data Exchange, Inbound/Outbound feeds, System Architecture, Authentication, API Strategy, Third Party Services, backend service interfaces, proxy/service routing, SSO/session tokens, mock APIs, internal APIs, external platforms, or similar. If these headings appear under or near an Integration Requirements section, keep them together in this field. Format as a Markdown pipe-table with exactly 2 columns: | ID | Requirement Description |. The Requirement Description should be concise but MUST be complete, maintaining all core context. "" if not present.

COUNT AND FORMAT FIDELITY:
- For each source requirement section, preserve the same number of distinct requirement items/rows in the extracted output.
- If the source has N functional requirements, the "functionalRequirements" value must contain N functional requirement items/rows.
- If the source has N non-functional requirements, the "nonFunctionalRequirements" value must contain N non-functional requirement items/rows.

OUTPUT EXACTLY: { "functionalRequirements": "...", "nonFunctionalRequirements": "...", "technicalRequirements": "...", "integrationRequirements": "..." }`;

  // ===== Chunk D — verbatim requirements context =====
  // This chunk captures the raw text of ALL requirements to ensure no loss of detail
  // during the high-fidelity canonical extraction pass later in the pipeline.
  const chunkDSystemPrompt = `You are an expert Business Analyst capturing VERBATIM REQUIREMENT TEXT from a Business Requirements Document.

${CLAUDE_JSON_CONTRACT}

EXTRACT THIS EXACT KEY:

"existingRequirements" — A faithful raw-text capture of EVERY requirement in the source document across ALL requirement categories. Include all explicit requirement tables, numbered lists, bullet lists, acceptance criteria, and detailed requirement narrative from ANY section of the document. Preserve the source's original headings, numbering, IDs, sub-bullets, table rows, and wording verbatim. Do NOT paraphrase, summarize, merge, split, infer, omit, or reorder items. If requirements are scattered across multiple headings or sections, concatenate them in their source order, separated by blank lines, with their original heading labels. If the source contains zero requirement-like statements, return "".

OUTPUT EXACTLY: { "existingRequirements": "..." }`;

  // ===== Chunk C — other tables =====
  const chunkCSystemPrompt = `You are an expert Business Analyst extracting STRUCTURED FIELDS from a Business Requirements Document.

${CLAUDE_JSON_CONTRACT}

EXTRACT THESE EXACT KEYS (most are Markdown pipe-tables):

"businessObjectives" — Strategic goals, KPIs, success metrics, business rationale.
  Format: | Goal | Rationale | KPI | Target |
  Cells with no source content stay blank. Do NOT include requirements.

"successCriteria" — Measurable acceptance criteria, go-live conditions.
  Format: | Criteria | Description |

"stakeholders" — Named stakeholders.
  Format: | Stakeholder | Role | Interest | Influence | Responsibilities |
  Leave cells blank when source does not state that attribute.

"businessRules" — Business logic, validation rules, conditions, workflow rules, operational constraints.
  Format: | ID | Rule | Rationale |
  - Use BR-01, BR-02 etc. if document has no IDs.
  - Do NOT include requirements or risks.

"dataRequirements" — Data entities, attributes, relationships, source systems, data migration plans, data quality rules.
  Format: | Entity | Key Attributes | Relationships | Source System | Notes |

"risksAndMitigation" — Risks, likelihood, impact, mitigation strategies, owners.
  Format: | Risk | Likelihood | Impact | Mitigation | Owner |
  Do NOT include constraints or assumptions.

"glossary" — Definitions, acronyms, abbreviations, domain-specific terms.
  Format: | Term | Definition |

"timeline" — Milestones, phases, dates, deadlines, delivery schedule.
  Format: | Milestone | Date/Range | Deliverable | Owner | Notes |

For every table-typed field: include header + separator row. One source item = one row. If the source has ZERO items, return "" (NOT a header-only empty table).

OUTPUT EXACTLY: { "businessObjectives": "...", "successCriteria": "...", "stakeholders": "...", "businessRules": "...", "dataRequirements": "...", "risksAndMitigation": "...", "glossary": "...", "timeline": "..." }`;

  const extractionPrefix = createJobCachePrefix({
    staticSystem: SHARED_EXTRACTION_SYSTEM,
    staticUser: userPrompt,
    feature: "brd",
    useCase: "extraction",
  });
  logJobCacheFingerprint("BRD extraction", extractionPrefix);

  const chunkAInstructions = extractionChunkInstructions(chunkASystemPrompt);
  const chunkBInstructions = extractionChunkInstructions(chunkBSystemPrompt);
  const chunkCInstructions = extractionChunkInstructions(chunkCSystemPrompt);
  const chunkDInstructions = extractionChunkInstructions(chunkDSystemPrompt);

  const sharedChunkOpts = { extractionPrefix, images };

  const runMetadata = () =>
    Promise.resolve(
      runExtractionChunk({
        chunkName: "metadata",
        chunkInstructions: chunkAInstructions,
        schema: chunkAMetadataSchema,
        ...sharedChunkOpts,
      }),
    ).then(
      (r) => ({ status: "fulfilled" as const, value: r }),
      (reason) => ({ status: "rejected" as const, reason }),
    );
  const runRest = () =>
    Promise.allSettled([
      runExtractionChunk({
        chunkName: "requirements-tables",
        chunkInstructions: chunkBInstructions,
        schema: chunkBRequirementsSchema,
        ...sharedChunkOpts,
      }),
      runExtractionChunk({
        chunkName: "other-tables",
        chunkInstructions: chunkCInstructions,
        schema: chunkCOtherSchema,
        ...sharedChunkOpts,
      }),
      runExtractionChunk({
        chunkName: "verbatim-context",
        chunkInstructions: chunkDInstructions,
        schema: chunkDVerbatimSchema,
        maxTokens: 4096,
        ...sharedChunkOpts,
      }),
    ]);

  let chunkAResult: PromiseSettledResult<{ ok: true; data: any } | { ok: false; reason: string }>;
  let chunkBResult: PromiseSettledResult<{ ok: true; data: any } | { ok: false; reason: string }>;
  let chunkCResult: PromiseSettledResult<{ ok: true; data: any } | { ok: false; reason: string }>;
  let chunkDResult: PromiseSettledResult<{ ok: true; data: any } | { ok: false; reason: string }>;
  if (isPromptCacheEnabled()) {
    console.log(
      `[BRD AI] Starting chunked extraction (cache-warm metadata, then 3 parallel; documentText=${documentText.length} chars)`,
    );
    chunkAResult = await runMetadata();
    [chunkBResult, chunkCResult, chunkDResult] = await runRest();
  } else {
    console.log(
      `[BRD AI] Starting chunked extraction (cache disabled, running 4 chunks in parallel; documentText=${documentText.length} chars)`,
    );
    [chunkAResult, chunkBResult, chunkCResult, chunkDResult] = await Promise.allSettled([
      runExtractionChunk({
        chunkName: "metadata",
        chunkInstructions: chunkAInstructions,
        schema: chunkAMetadataSchema,
        ...sharedChunkOpts,
      }),
      runExtractionChunk({
        chunkName: "requirements-tables",
        chunkInstructions: chunkBInstructions,
        schema: chunkBRequirementsSchema,
        ...sharedChunkOpts,
      }),
      runExtractionChunk({
        chunkName: "other-tables",
        chunkInstructions: chunkCInstructions,
        schema: chunkCOtherSchema,
        ...sharedChunkOpts,
      }),
      runExtractionChunk({
        chunkName: "verbatim-context",
        chunkInstructions: chunkDInstructions,
        schema: chunkDVerbatimSchema,
        maxTokens: 4096,
        ...sharedChunkOpts,
      }),
    ]);
  }

  // Merge: each chunk's data is independently optional. We accumulate the
  // union of all fields seen, preferring later values only if the earlier
  // chunk left a key empty (extremely unlikely since chunks own disjoint
  // key sets, but defensive coding here).
  const merged: Record<string, unknown> = {};
  const successes: string[] = [];
  const failures: string[] = [];

  const absorb = (
    chunkName: string,
    settled:
      | PromiseFulfilledResult<{ ok: true; data: any } | { ok: false; reason: string }>
      | PromiseRejectedResult,
  ) => {
    if (settled.status === "rejected") {
      failures.push(`${chunkName}: rejected (${String(settled.reason)})`);
      return;
    }
    const inner = settled.value;
    if (!inner.ok) {
      failures.push(`${chunkName}: ${inner.reason}`);
      return;
    }
    successes.push(chunkName);
    for (const [k, v] of Object.entries(inner.data)) {
      if (typeof v === "string" && v.length > 0) {
        merged[k] = v;
      } else if (!(k in merged)) {
        merged[k] = v;
      }
    }
  };

  absorb("metadata", chunkAResult);
  absorb("requirements-tables", chunkBResult);
  absorb("other-tables", chunkCResult);
  absorb("verbatim-context", chunkDResult);

  if (successes.length === 0) {
    const summary = failures.join(" | ");
    console.error(
      `[BRD AI] All extraction chunks failed: ${summary}`,
    );
    throw new Error(
      `BRD extraction failed across all chunks. Reasons: ${summary}`,
    );
  }

  if (failures.length > 0) {
    console.warn(
      `[BRD AI] Partial extraction (succeeded: ${successes.join(",")}; failed: ${failures.join(" | ")}). Proceeding with partial input.`,
    );
  } else {
    console.log(
      `[BRD AI] All ${successes.length} extraction chunks succeeded.`,
    );
  }

  // ===== Sanitize: drop empty pipe-tables and obvious placeholder strings.
  const str = (key: string) =>
    typeof merged[key] === "string" ? (merged[key] as string) : "";

  const isEmptyMarkdownTable = (value: string): boolean => {
    const lines = value.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    const looksLikeHeader = /^\|.+\|$/.test(lines[0]);
    const looksLikeSeparator = /^\|?\s*[-:\s|]+\|?\s*$/.test(lines[1]);
    if (!looksLikeHeader || !looksLikeSeparator) return false;
    const dataRows = lines.slice(2).filter((line) => {
      const cells = line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      return cells.some((c) => c.length > 0);
    });
    return dataRows.length === 0;
  };

  const PLACEHOLDER_PATTERN = /^(tbd|n\/a|na|none|not\s+(specified|provided|applicable|available|defined|stated)|to\s+be\s+defined|to\s+be\s+determined|unknown)\.?$/i;

  const sanitize = (key: string): string => {
    const raw = str(key);
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (PLACEHOLDER_PATTERN.test(trimmed)) return "";
    if (isEmptyMarkdownTable(trimmed)) return "";
    return raw;
  };

  const result: Partial<BRDInput> = {
    projectName: sanitize("projectName"),
    projectDescription: sanitize("projectDescription"),
    businessObjectives: sanitize("businessObjectives"),
    successCriteria: sanitize("successCriteria"),
    targetAudience: sanitize("targetAudience"),
    stakeholders: sanitize("stakeholders"),
    keyFeatures: sanitize("keyFeatures"),
    functionalRequirements: sanitize("functionalRequirements"),
    nonFunctionalRequirements: sanitize("nonFunctionalRequirements"),
    technicalRequirements: sanitize("technicalRequirements"),
    integrationRequirements: sanitize("integrationRequirements"),
    businessRules: sanitize("businessRules"),
    dataRequirements: sanitize("dataRequirements"),
    risksAndMitigation: sanitize("risksAndMitigation"),
    constraints: sanitize("constraints"),
    assumptions: sanitize("assumptions"),
    dependencies: sanitize("dependencies"),
    glossary: sanitize("glossary"),
    timeline: sanitize("timeline"),
    budget: sanitize("budget"),
    existingRequirements: sanitize("existingRequirements"),
  };

  const extractSourceSectionByHeading = (sourceText: string, headingPatterns: RegExp[]): string => {
    const lines = (sourceText || "").replace(/\r/g, "").split("\n");
    const startIdx = lines.findIndex((line) => {
      const normalizedLine = line.replace(/^#{1,6}\s*/, "").trim();
      return headingPatterns.some((pattern) => pattern.test(normalizedLine));
    });
    if (startIdx < 0) return "";

    const nextMajorHeadingPatterns = [
      /^(functional|user|business functional)\s+requirements?\b/i,
      /^non[-\s]?functional\s+requirements?\b/i,
      /^technical\s+requirements?\b/i,
      /^business\s+rules?\b/i,
      /^data\s+requirements?\b/i,
      /^(constraints|assumptions|dependencies)\b/i,
      /^risks?\b/i,
      /^timeline\b/i,
      /^appendix|^appendices\b/i,
      /^additional\s+organizational\s+guidelines?\b/i,
      /^\d+(?:\.\d+){0,2}[.)]?\s+\S+/,
    ];

    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const normalizedLine = lines[i].replace(/^#{1,6}\s*/, "").trim();
      if (!normalizedLine) continue;
      const isMajorHeading =
        /^#{1,6}\s+/.test(lines[i]) ||
        nextMajorHeadingPatterns.some((pattern) => pattern.test(normalizedLine));
      const isIntegrationSubheading =
        /^(system architecture|authentication|api strategy|third[-\s]?party services?)\b/i.test(normalizedLine);
      if (isMajorHeading && !isIntegrationSubheading) {
        endIdx = i;
        break;
      }
    }

    return lines.slice(startIdx, endIdx).join("\n").trim();
  };

  if (!result.integrationRequirements) {
    const directIntegrationSection = extractSourceSectionByHeading(documentText, [
      /^integration\s+requirements?\b/i,
      /^interfaces?\s+and\s+integrations?\b/i,
      /^external\s+systems?\b/i,
    ]);
    if (directIntegrationSection) {
      result.integrationRequirements = directIntegrationSection;
      console.warn(
        "[BRD AI] Filled integrationRequirements from direct source section fallback.",
      );
    }
  }

  const fieldLengths: Record<string, number> = {};
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === "string" && v.length > 0) fieldLengths[k] = v.length;
  }
  console.log(
    "[BRD AI] Extracted BRD input fields (post-sanitize):",
    fieldLengths,
  );

  return result;
}

/**
 * Build a single text block from BRD form input for RAG content (e.g. processBrdWithGuidelines).
 */
export function buildBrdContentFromInput(input: BRDInput): string {
  const lines: string[] = [
    `**Project Name:** ${input.projectName}`,
    "",
    "**Project Description:**",
    input.projectDescription,
  ];
  if (input.businessObjectives) lines.push("", "**Business Objectives:**", input.businessObjectives);
  if (input.targetAudience) lines.push("", "**Target Audience:**", input.targetAudience);
  if (input.keyFeatures) lines.push("", "**Key Features:**", input.keyFeatures);
  if (input.constraints) lines.push("", "**Constraints:**", input.constraints);
  if (input.successCriteria) lines.push("", "**Success Criteria:**", input.successCriteria);
  if (input.timeline) lines.push("", "**Timeline:**", input.timeline);
  if (input.budget) lines.push("", "**Budget:**", input.budget);
  if (input.stakeholders) lines.push("", "**Stakeholders:**", input.stakeholders);
  if (input.existingRequirements) lines.push("", "**Existing Requirements/Context:**", input.existingRequirements);
  return lines.join("\n");
}

/**
 * Generate a comprehensive Business Requirements Document using AI.
 * Fixes:
 * - Optional mandatory requirements injection
 * - Larger token budget
 * - Two-pass requirements repair (4.1–4.4)
 * - Coverage validation + auto-repair
 */
export async function generateBRD(
  input: BRDInput,
  ragGuidance?: string,
  options?: GenerateBrdOptions,
): Promise<BRDDocument> {
  console.log("[BRD-GEN] Starting BRD generation for:", input.projectName);
  console.log("[BRD-GEN] Received generationDate from client:", input.generationDate || "NOT PROVIDED");
  console.log("[BRD-GEN] Current server date:", new Date().toISOString().split("T")[0]);

  const isUploadMode = options?.mode === "upload";

  const opts: Required<
    Omit<
      GenerateBrdOptions,
      "temperatureOverride" | "detectedDomainOverride" | "canonicalExtractionContext" | "onProgress" | "checkCancelled"
    >
  > & {
    temperatureOverride?: number;
    detectedDomainOverride?: DomainDetectionResult;
    canonicalExtractionContext?: GenerateBrdOptions["canonicalExtractionContext"];
    onProgress?: GenerateBrdOptions["onProgress"];
  } = {
    mandatoryRequirementsText: options?.mandatoryRequirementsText || "",
    twoPassRequirementsRepair: isUploadMode ? false : (options?.twoPassRequirementsRepair ?? true),
    maxRepairAttempts: options?.maxRepairAttempts ?? 1,
    sectionDescriptionSentenceRange: options?.sectionDescriptionSentenceRange || { min: 3, max: 6 },
    brdMaxOutputTokens: options?.brdMaxOutputTokens ?? 20000,
    requirementsMaxOutputTokens: options?.requirementsMaxOutputTokens ?? 20000,
    // In upload mode we deliberately disable multi-pass repairs and the
    // quality gate. Those passes re-prompt the LLM with canonical lists and
    // BA "best-practice" instructions and tend to drift away from the actual
    // uploaded document. Strict fidelity > polish for uploads.
    multiPassGeneration: options?.multiPassGeneration ?? true,
    enableQualityGate: options?.enableQualityGate ?? (isUploadMode ? false : true),
    temperatureOverride: options?.temperatureOverride,
    detectedDomainOverride: options?.detectedDomainOverride,
    canonicalExtractionContext: options?.canonicalExtractionContext,
    onProgress: options?.onProgress,
    mode: options?.mode ?? "create",
  };

  if (isUploadMode) {
    console.log("[BRD-GEN] Upload mode active — strict-fidelity prompts, no multi-pass repairs, no quality gate.");
  }

  const emitProgress = (event: BrdGenerationProgressEvent) => {
    try {
      if (options?.checkCancelled?.()) {
        throw new Error("BRD Generation Cancelled");
      }
      opts.onProgress?.(event);
    } catch (err) {
      if (err instanceof Error && err.message === "BRD Generation Cancelled") {
        throw err;
      }
      // Progress reporting must never break BRD generation
    }
  };

  // Use provided generation date from client or fall back to current server date
  const documentDate = input.generationDate || new Date().toISOString().split("T")[0];
  console.log("[BRD-GEN] Using date in prompt:", documentDate);

  // SANITIZATION: Force all requirement tables into 2-column format (| ID | Description |)
  // This strips Priority or Traceability columns before they reach the LLM.
  const sanitizeToTwoColumns = (tableText?: string) => {
    if (!tableText) return tableText;
    const lines = tableText.split("\n");
    return lines
      .map((line) => {
        if (!line.includes("|")) return line;
        const parts = line
          .split("|")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        if (parts.length >= 3) {
          // If it's a separator line like |---|---|---|
          if (line.includes("---")) return "|---|---|";
          // Take first two columns (ID and Description)
          return `| ${parts[0]} | ${parts[1]} |`;
        }
        return line;
      })
      .join("\n");
  };

  input.functionalRequirements = sanitizeToTwoColumns(input.functionalRequirements);
  input.nonFunctionalRequirements = sanitizeToTwoColumns(input.nonFunctionalRequirements);
  input.technicalRequirements = sanitizeToTwoColumns(input.technicalRequirements);
  input.integrationRequirements = sanitizeToTwoColumns(input.integrationRequirements);

  // Ensure the mandatory requirements list is not lost.
  // We keep input.existingRequirements intact and append a protected block.
  const mandatoryBlock = opts.mandatoryRequirementsText?.trim()
    ? `\n\n========================\nMANDATORY REQUIREMENTS (DO NOT OMIT)\nThe following list MUST be fully represented in Section 6 Requirements tables (6.1–6.4). Include each item as a requirement row.\n========================\n${opts.mandatoryRequirementsText.trim()}\n`
    : "";

  const mergedExistingRequirements = `${input.existingRequirements || ""}${mandatoryBlock}`.trim();
  const canonicalExtractionContext = {
    projectDescription: input.projectDescription,
    keyFeatures: input.keyFeatures,
    existingRequirements: input.existingRequirements,
    uploadedDocumentText: opts.canonicalExtractionContext?.uploadedDocumentText,
    ragGuidance: ragGuidance,
    userInput: [
      input.businessObjectives,
      input.successCriteria,
      input.constraints,
      input.timeline,
      input.budget,
      input.stakeholders,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  // 1) Try high-fidelity canonical extraction across all sources.
  // 2) Fall back to legacy splitRequirementsList-based extraction when needed.
  let canonicalRequirements: CanonicalRequirement[] = [];
  let canonicalRequirementsList = "";
  let canonicalDebug: CanonicalRequirementsDebug | undefined;

  // SUPPLEMENT: Ensure any requirements already extracted into tables (Chunk B)
  // are included in the canonical list, even if the second-pass extraction truncated.
  const alreadyExtracted = extractRequirementRowsFromMarkdown(
    `${input.functionalRequirements || ""}\n${input.nonFunctionalRequirements || ""}\n${input.technicalRequirements || ""}\n${input.integrationRequirements || ""}`
  );

  const rebuildCanonicalRequirementsList = () => {
    canonicalRequirementsList = canonicalRequirements
      .map((r, i) => `${r.id || `R${i + 1}`}. ${r.text}`)
      .join("\n");
  };

  if (isUploadMode && alreadyExtracted.all.length > 0) {
    emitProgress({ stepKey: "canonical_extract_done", percent: 15, message: "Canonical requirements extracted" });
    const uploadCanonical: CanonicalRequirement[] = [];
    const seen = new Set<string>();
    const addUploadRequirements = (
      items: string[],
      requirementType: CanonicalRequirement["requirementType"],
      sourceRef: string,
    ) => {
      for (const item of items) {
        const text = item.trim();
        const normalized = normalizeRequirementText(text);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        uploadCanonical.push({
          id: `R${uploadCanonical.length + 1}`,
          text,
          sourceType: "existing_requirements",
          sourceRef,
          sourceSnippet: text,
          requirementType,
          domainTags: [],
          confidence: 0.95,
        });
      }
    };

    addUploadRequirements(alreadyExtracted.functional, "functional", "Extracted Functional Requirements");
    addUploadRequirements(alreadyExtracted.nonFunctional, "non_functional", "Extracted Non-Functional Requirements");
    addUploadRequirements(alreadyExtracted.technical, "technical", "Extracted Technical Requirements");
    addUploadRequirements(alreadyExtracted.integration, "integration", "Extracted Integration Requirements");
    addUploadRequirements(splitRequirementsList(opts.mandatoryRequirementsText || ""), "functional", "Mandatory Requirements");

    canonicalRequirements = uploadCanonical;
    rebuildCanonicalRequirementsList();
    canonicalDebug = {
      totalRequirements: canonicalRequirements.length,
      byType: canonicalRequirements.reduce<CanonicalRequirementsByType>((acc, req) => {
        (acc[req.requirementType] ||= []).push(req);
        return acc;
      }, {}),
      bySource: { "Upload structured extraction": canonicalRequirements },
      warnings: ["Upload mode reused structured extraction output instead of running a second large LLM canonical extraction."],
      examples: canonicalRequirements.slice(0, 5),
    };
    console.log("[BRD-CANONICAL] Upload mode reused structured extraction:", {
      total: canonicalRequirements.length,
      functional: alreadyExtracted.functional.length,
      nonFunctional: alreadyExtracted.nonFunctional.length,
      technical: alreadyExtracted.technical.length,
      integration: alreadyExtracted.integration.length,
    });
  } else {
    try {
      emitProgress({ stepKey: "canonical_extract", percent: 8, message: "Extracting canonical requirements" });
      const extraction = await extractCanonicalRequirements(
        canonicalExtractionContext,
        opts.mandatoryRequirementsText || "",
      );
      canonicalRequirements = extraction.requirements;
      canonicalDebug = {
        totalRequirements: extraction.requirements.length,
        byType: extraction.byType,
        bySource: extraction.bySource,
        warnings: extraction.warnings,
        examples: extraction.examples,
      };

      rebuildCanonicalRequirementsList();

      emitProgress({ stepKey: "canonical_extract_done", percent: 15, message: "Canonical requirements extracted" });
      console.log("[BRD-CANONICAL] Extraction summary:", {
        total: extraction.requirements.length,
        byType: Object.fromEntries(
          Object.entries(extraction.byType).map(([k, v]) => [k, v.length]),
        ),
        bySource: Object.fromEntries(
          Object.entries(extraction.bySource).map(([k, v]) => [k, v.length]),
        ),
        warnings: extraction.warnings,
      });
      if (extraction.examples.length > 0) {
        console.log("[BRD-CANONICAL] Sample extracted requirements:", extraction.examples.slice(0, 5));
      }
    } catch (err) {
      console.warn(
        "[BRD-CANONICAL] Extraction failed, falling back to legacy list:",
        err instanceof Error ? err.message : String(err),
      );
      const legacyList = toCanonicalRequirementsList(mergedExistingRequirements);
      canonicalRequirementsList = legacyList;
      canonicalRequirements = legacyList
        .split("\n")
        .map((line) => line.trim())
        .map((line) => {
          const match = line.match(/^R(\d+)\.\s*(.+)$/);
          if (!match) return null;
          const id = `R${match[1]}`;
          const text = match[2].trim();
          if (!text || text === "(No requirements specified in source.)") return null;
          return {
            id,
            text,
            sourceType: "existing_requirements" as const,
            sourceRef: "existingRequirements",
            sourceSnippet: text,
            requirementType: "functional" as const,
            domainTags: [],
            confidence: 0.7,
          } as CanonicalRequirement;
        })
        .filter((x): x is CanonicalRequirement => !!x);
    }
  }

  if (alreadyExtracted.all.length > 0) {
    let addedCount = 0;
    for (const row of alreadyExtracted.all) {
      const rowNorm = normalizeRequirementText(row);
      if (!rowNorm) continue;
      const isRepresented = canonicalRequirements.some(req => {
        const reqNorm = normalizeRequirementText(req.text);
        const snippetNorm = normalizeRequirementText(req.sourceSnippet || "");
        return (reqNorm && (reqNorm.includes(rowNorm) || rowNorm.includes(reqNorm))) ||
               (snippetNorm && (snippetNorm.includes(rowNorm) || rowNorm.includes(snippetNorm)));
      });
      if (!isRepresented) {
        canonicalRequirements.push({
          id: "",
          text: row.trim(),
          sourceType: "existing_requirements",
          sourceRef: "Initial Extraction",
          sourceSnippet: row.trim(),
          requirementType: "functional",
          domainTags: [],
          confidence: 0.9,
        });
        addedCount++;
      }
    }
    if (addedCount > 0) {
      console.log(`[BRD-CANONICAL] Supplemented ${addedCount} requirement(s) from initial extraction tables.`);
      // Re-index IDs
      canonicalRequirements = canonicalRequirements.map((req, idx) => ({
        ...req,
        id: `R${idx + 1}`,
      }));
      canonicalRequirementsList = canonicalRequirements
        .map((r) => `${r.id}. ${r.text}`)
        .join("\n");
    }
  }

  // Mandatory requirements are a coverage contract, especially for uploaded
  // BRDs where users expect every explicit source row to survive generation.
  // The LLM extractor can occasionally consolidate or skip rows, so supplement
  // its output with any mandatory items that are not materially represented.
  const mandatoryItems = splitRequirementsList(opts.mandatoryRequirementsText || "");
  if (mandatoryItems.length > 0) {
    const missingMandatoryItems = mandatoryItems.filter((item) => {
      const mandatoryNorm = normalizeRequirementText(item);
      if (!mandatoryNorm) return false;
      return !canonicalRequirements.some((req) => {
        const reqNorm = normalizeRequirementText(req.text);
        const snippetNorm = normalizeRequirementText(req.sourceSnippet || "");
        return (
          (reqNorm && (reqNorm.includes(mandatoryNorm) || mandatoryNorm.includes(reqNorm))) ||
          (snippetNorm && (snippetNorm.includes(mandatoryNorm) || mandatoryNorm.includes(snippetNorm)))
        );
      });
    });

    if (missingMandatoryItems.length > 0) {
      console.warn(
        `[BRD-CANONICAL] Supplementing ${missingMandatoryItems.length}/${mandatoryItems.length} mandatory requirement item(s) missed by canonical extraction.`,
      );
      for (const item of missingMandatoryItems) {
        canonicalRequirements.push({
          id: "",
          text: item.trim(),
          sourceType: "existing_requirements",
          sourceRef: "Mandatory Requirements",
          sourceSnippet: item.trim(),
          requirementType: "functional",
          domainTags: [],
          confidence: 0.95,
        });
      }
    }

    canonicalRequirements = canonicalRequirements.map((req, idx) => ({
      ...req,
      id: `R${idx + 1}`,
    }));
    canonicalRequirementsList = canonicalRequirements
      .map((r) => `${r.id}. ${r.text}`)
      .join("\n");

    if (canonicalDebug) {
      canonicalDebug.totalRequirements = canonicalRequirements.length;
      canonicalDebug.warnings = [
        ...(canonicalDebug.warnings || []),
        ...(missingMandatoryItems.length > 0
          ? [`Supplemented ${missingMandatoryItems.length} mandatory requirement item(s) missed by extraction.`]
          : []),
      ];
    }
  }

  // Domain detection (or override) and profile selection
  if (options?.checkCancelled?.()) throw new Error("BRD Generation Cancelled");
  const detectedDomain: DomainDetectionResult =
    options?.detectedDomainOverride ||
    (await detectProjectDomain(input, canonicalRequirementsList, ragGuidance));
  const domainProfile = getDomainProfile(detectedDomain.primaryDomain);

  // Build the SECTION DELIVERABLES ENFORCEMENT block from CANONICAL_BRD_SECTIONS.
  // Pre-Phase 3b this prompt fragment had hand-written headers like "## 1. Introduction"
  // that disagreed with the user-prompt structure (Introduction is canonical Section 3).
  // Now every header is derived from the canonical list so they cannot drift.
  const sectionDeliverablesEnforcement = `
========================
SECTION DELIVERABLES ENFORCEMENT (REQUIRED ARTIFACTS)
========================
After the required descriptive paragraph, each section MUST include the following concrete artifacts. Use "TBD", "Unknown", or "Not specified in source" when the source does not provide enough information; NEVER use bracket placeholders like [Author Name] or [Date]. If the source does not provide enough information for a section, do NOT invent content—use TBD/Unknown/Not specified in source inside the required artifact/table/list.

## ${formatCanonicalSectionRef("1")}
- Use a two-column Markdown table with headers: | Attribute | Description |
- Include EXACTLY these rows in this order: Project Name, Document Type, Version, Prepared By, Date, Project Sponsor, Document Status, Approval Status.
- "Document Type" MUST be "Business Requirements Document (BRD)".
- "Prepared By" MUST be "Astra".
- Use TBD for factual unknowns.

## ${formatCanonicalSectionRef("2")}
- Provide a concise, professional executive summary (2-4 paragraphs) covering the project's background, core value proposition, and intended business outcomes. 
- Do NOT include bulleted subsections for Objectives, Scope, or Deliverables here; those belong exclusively in Sections 3 and 4.

## ${formatCanonicalSectionRef("3")} (and 3.1–3.3)
- 3.1 Purpose: 2–3 narrative paragraphs defining the purpose of the BRD and the project.
- 3.2 Scope: Markdown pipe-table | Scope Type | Description |. Use "In Scope" and "Out of Scope" as scope types.
- 3.3 Definitions and Acronyms: Markdown pipe-table | Term / Acronym | Definition |.

## ${formatCanonicalSectionRef("4")} (and 4.1–4.3)
- 4.1 Business Goals: Markdown pipe-table | Goal ID | Business Goal | Description |. Use BG-NN for IDs.
- 4.2 Success Criteria: Markdown pipe-table | Success ID | Success Criterion | Measurement Method |. Use SC-NN for IDs.
- 4.3 Key Performance Indicators (KPIs): Markdown pipe-table | KPI ID | KPI Name | Description | Measurement |. Use KPI-NN for IDs.

## ${formatCanonicalSectionRef("5")} (and 5.1–5.2)
- 5.1 Stakeholders: EXACTLY ONE Markdown pipe-table | Role | Responsibility |
- 5.2 User Personas: EXACTLY ONE Markdown pipe-table | Persona | Description | Goals | Pain Points |. 
- STRICT: Do NOT create sub-headings like 5.2.1, 5.2.2.
- UPLOAD MODE: Include ONLY personas explicitly stated in the source. Do NOT invent extra roles.

## ${formatCanonicalSectionRef("6")} (and 6.1–6.4)
- All four subsections use Markdown pipe-tables: | ID | Requirement Description | Priority |
- 6.1 Functional Requirements: IDs FR-NN. 6.2 Non-Functional: IDs NFR-NN. 6.3 Technical: IDs TR-NN. 6.4 Integration: IDs IR-NN. Priority is High, Medium, or Low.
- GRANULARITY — EVERY requirement from the source (R-items) MUST be represented by at least one row in Section 6. The Requirement Description should be concise but MUST be complete and capture all technical and UI details provided in the source. Do NOT skip any R-items.
- CLEAN OUTPUT: Do NOT include source reference tags like (R1), (R42), [R1], or similar IDs in the final Requirement Description text. These IDs are for your internal tracking only.
- Total Section 6 rows across 6.1-6.4 MUST be at least 1.0x the number of provided R-items. Do NOT consolidate multiple R-items into a single row if it results in loss of detail.
- Do NOT duplicate the same capability across multiple rows or sections (a capability belongs in exactly one of 6.1, 6.2, 6.3, or 6.4).
- Map every row to one or more R-items. Do NOT fabricate requirements that don't map to an R-item or RAG guidance. Use "Not specified in source" for the Requirement Description ONLY when truly unavoidable.

## ${formatCanonicalSectionRef("7")}
- ONE SINGLE Markdown pipe-table | ID | Rule | Rationale |. IDs BR-NN.
- STRICT: Do NOT create any sub-headings (like 7.1, 7.2) or category summary tables. All content must be directly under the main Section 7 heading.
- If the source is silent, provide a single table with "TBD" rows.

## ${formatCanonicalSectionRef("8")} (and 8.1–8.2)
- 8.1 Data Entities: Markdown pipe-table | Entity | Key Attributes | Relationships | Source System | Notes |.
- 8.1 CONCISENESS: Each cell in the Data Entities table MUST be extremely concise (maximum one short sentence). Do NOT write paragraphs or detailed attribute lists.
- 8.2 Data Migration: bullet list only.
- STRICT: Do NOT create any other subsections or sub-subheadings like 8.1.1, 8.1.2, or 8.3. Output ONLY 8.1 and 8.2.

## ${formatCanonicalSectionRef("9")} (and 9.1–9.3)
- 9.1 Constraints: Markdown pipe-table | Constraint ID | Constraint | Description |. Use C-NN for IDs.
- 9.2 Assumptions: Markdown pipe-table | Assumption ID | Assumption | Description |. Use A-NN for IDs.
- 9.3 Dependencies: Markdown pipe-table | Dependency ID | Dependency | Description |. Use D-NN for IDs.

## ${formatCanonicalSectionRef("10")}
- Risk Register: Markdown pipe-table | Risk ID | Risk Description | Impact | Mitigation Strategy |. Use RSK-NN for IDs.

## ${formatCanonicalSectionRef("11")}
- After a short descriptive paragraph, output EXACTLY ONE Markdown pipe-table | Milestone ID | Milestone | Description | Target Date |. Use M-NN for IDs.
- STRICT: Do NOT add sub-headings or extra tables.

## ${formatCanonicalSectionRef("12")} (and 12.1–12.2)
- Main Section 12 heading should have a short descriptive paragraph.
- 12.1 Reference Documents: EXACTLY ONE Markdown pipe-table | Document Name | Description | Source |.
- 12.2 Approval Matrix: EXACTLY ONE Markdown pipe-table | Role | Name | Responsibility | Approval Status |. 
- MANDATORY ROWS for 12.2: You MUST include exactly 4 rows: Project Sponsor, Business Owner, IT Delivery Lead, and QA Lead. Use "TBD" for Names. 
- FORMAT: Start with headers, then the separator line (|---|---|---|---|), then the 4 data rows.
- STRICT: Do NOT create any other subsections or sub-subheadings like 12.1.1 or 12.3.

## ${formatCanonicalSectionRef("13")}
- After a short descriptive paragraph, output EXACTLY ONE Markdown pipe-table | Guideline Category | Description |. Otherwise the section MUST contain: "None provided."
- STRICT: Do NOT add sub-headings or extra tables. All content must be directly under the main Section 13 heading.
`;

  const domainContextInstructions = `
========================
DETECTED DOMAIN CONTEXT
========================
Primary domain: ${detectedDomain.primaryDomain} (confidence ${(detectedDomain.confidence * 100).toFixed(1)}%)
Secondary domains: ${detectedDomain.secondaryDomains.join(", ") || "none"}
Evidence terms: ${detectedDomain.evidence.join(", ") || "none"}

Domain profile emphasis:
- ${domainProfile.description}
- Key risk emphasis: ${domainProfile.riskEmphasis.join(", ")}

You MUST:
- Preserve important domain-specific terminology, identifiers, and codes from the source.
- Avoid injecting domain assumptions that are not explicitly supported by the evidence.
- Prefer TBD/Unknown/Not specified in source over generic filler when the source is silent.
`;

  const selectedBrdTemplateId = "gold_1_0";
  const templateInstructions = `
BRD TEMPLATE MODE: GOLD 1.0 (STRUCTURE ONLY)
- Use the Gold 1.0 template as a section/format blueprint only.
- NEVER copy template/example text content.
- Generate new content strictly from PROJECT INFORMATION, CANONICAL SOURCE REQUIREMENTS, and ORGANIZATIONAL GUIDELINES.
- If source data is missing, write "TBD", "Unknown", or "Not specified in source".
`;

  const CONTENT_POLICY = isUploadMode
    ? `
UPLOAD CONTENT POLICY (ABSOLUTE FIDELITY):
- Treat the uploaded document as the SINGLE SOURCE OF TRUTH. 
- Section 1: Table with 8 rows. Author MUST be Astra.
- Section 5. Stakeholder Analysis: Extract all names and roles. Capture 100% of the stakeholders identified in the source.
- Section 5.2 User Personas: Include ONLY the personas explicitly identified in the source. If the source only identifies one persona, output exactly ONE row. Do NOT invent extra roles like Admin, QA, or Superuser unless they are explicitly named in the source.
- Section 6: Identify and include EVERY distinct requirement. You MUST strip ALL source reference tags like (R20), (R1), [R1], or any original source numbering from the Requirement Description column.
- SECTION 6 FIDELITY: Ensure 100% coverage of all requirements found in the source. Do NOT skip, merge, or omit any functional or technical requirements.
- TABLE INTEGRITY: If the table cuts off, the system will force a repair to finish it.
- Section 9: Extract all Assumptions/Constraints from the source.
- Section 10-13 RIGIDITY: Section 10, 11, and 13 MUST have EXACTLY ONE table each. Section 12 MUST have exactly two (12.1 and 12.2). No sub-headings like 11.1.1.
- TERMINATION GUARD: Generate all 13 sections. Append missing sections if needed.
`
    : `
CREATE CONTENT POLICY (PROFESSIONAL BA FILLER):
- You MAY add conservative generic BA filler to complete the mandatory tables.
- Table cell content (especially Section 6 and 8.1) MUST be extremely concise (single short sentence/line per cell). Do NOT write paragraphs.
- Requirement descriptions MUST be extremely concise (single short sentence).
- Author MUST be Astra.
`;

  const systemPrompt = `${STATIC_BRD_SYSTEM_PROMPT}
${CONTENT_POLICY}
`;

  const brdStaticUser = `
Generate a complete Business Requirements Document (BRD) STRICTLY following the structure below.

Structure:

1. Document Information

2. Executive Summary

3. Introduction
   3.1 Purpose
   3.2 Scope
   3.3 Definitions and Acronyms

4. Business Objectives
   4.1 Business Goals
   4.2 Success Criteria
   4.3 Key Performance Indicators (KPIs)

5. Stakeholder Analysis
   5.1 Key Stakeholders
   5.2 User Personas

6. Requirements
   6.1 Functional Requirements
   6.2 Non-Functional Requirements
   6.3 Technical Requirements
   6.4 Integration Requirements

7. Business Rules

8. Data Requirements
   8.1 Data Entities
   8.2 Data Migration

9. Constraints and Assumptions
   9.1 Constraints
   9.2 Assumptions
   9.3 Dependencies

10. Risks and Mitigation

11. Timeline and Milestones

12. Appendices
    12.1 Reference Documents
    12.2 Approval Matrix

13. Additional Organizational Guidelines

---

Strict Instructions for Generation:

* Use ONLY the provided context from retrieval.
* Do NOT mix content between sections.
* Each section must be clearly separated with headings.
* Even if data is missing, DO NOT remove sections.
  → Write "TBD" for missing content.
* Maintain professional BRD language.
* Ensure:

  * Functional, Non-Functional, Technical, and Integration requirements are separate
  * Business Rules are not merged with requirements
  * Data Requirements are not merged with other sections
* Do NOT reorder sections.
* Do NOT skip sections.
* Do NOT summarize the entire document into one block.
* Do NOT include stray numbered points (bleeding) between sections.

${templateInstructions}
${!isUploadMode ? sectionDeliverablesEnforcement : ""}

---

OUTPUT FORMAT (plain text):

- Use markdown headings EXACTLY as:
  - \`## 1. Document Information\`
  - \`## 2. Executive Summary\`
  - \`## 3. Introduction\` with \`### 3.1\`, \`### 3.2\`, \`### 3.3\`
  - ...continue exactly through \`## 13. Additional Organizational Guidelines\`
- Do NOT wrap the output in code fences.

---

RETRIEVED CONTEXT (use only this; do not invent facts):

PROJECT INFORMATION:
- Project Name: ${input.projectName}
- Project Description: ${input.projectDescription}
${input.businessObjectives ? `- Business Objectives (input): ${input.businessObjectives}\n` : ""}${input.targetAudience ? `- Target Audience (input): ${input.targetAudience}\n` : ""}${input.constraints ? `- Constraints (input): ${input.constraints}\n` : ""}${input.successCriteria ? `- Success Criteria (input): ${input.successCriteria}\n` : ""}${input.timeline ? `- Timeline (input): ${input.timeline}\n` : ""}${input.budget ? `- Budget (input): ${input.budget}\n` : ""}${input.stakeholders ? `- Stakeholders (input): ${input.stakeholders}\n` : ""}${input.keyFeatures ? `- Key Features (input): ${input.keyFeatures}\n` : ""}
SECTION-SPECIFIC EXTRACTED CONTENT (already in the required table format — use DIRECTLY in the corresponding BRD section, preserving IDs, rows, and pipe-table structure):
${input.functionalRequirements ? `[Section 6.1 — Functional Requirements] (table: ID | Requirement Description | Priority):\n${input.functionalRequirements}\n\n` : ""}${input.nonFunctionalRequirements ? `[Section 6.2 — Non-Functional Requirements] (table: ID | Requirement Description | Priority):\n${input.nonFunctionalRequirements}\n\n` : ""}${input.technicalRequirements ? `[Section 6.3 — Technical Requirements] (table: ID | Requirement Description | Priority):\n${input.technicalRequirements}\n\n` : ""}${input.integrationRequirements ? `[Section 6.4 — Integration Requirements] (table: ID | Requirement Description | Priority):\n${input.integrationRequirements}\n\n` : ""}${input.businessRules ? `[Section 7 — Business Rules] (table: ID | Rule | Rationale):\n${input.businessRules}\n\n` : ""}${input.dataRequirements ? `[Section 8 — Data Requirements] (table: Entity | Key Attributes | Relationships | Source System | Notes):\n${input.dataRequirements}\n\n` : ""}${input.risksAndMitigation ? `[Section 10 — Risks and Mitigation] (table: Risk ID | Risk Description | Impact | Mitigation Strategy):\n${input.risksAndMitigation}\n\n` : ""}${input.assumptions ? `[Section 9.2 — Assumptions] (table: Assumption ID | Assumption | Description):\n${input.assumptions}\n\n` : ""}${input.dependencies ? `[Section 9.3 — Dependencies] (table: Dependency ID | Dependency | Description):\n${input.dependencies}\n\n` : ""}${input.glossary ? `[Section 3.3 — Glossary / Definitions and Acronyms] (table: Term / Acronym | Definition):\n${input.glossary}\n\n` : ""}

IMPORTANT: Do NOT copy the "SECTION-SPECIFIC EXTRACTED CONTENT" reference block verbatim into the final BRD output. Use these extracted tables only to populate the matching canonical BRD sections, and do not output any extra duplicate tables or block headings outside the canonical section headings.

CANONICAL SOURCE REQUIREMENTS (traceability; if none exist for a section, write TBD):
${canonicalRequirementsList}

${ragGuidance ? `ORGANIZATIONAL GUIDELINES (retrieved):\n${ragGuidance}\n` : "ORGANIZATIONAL GUIDELINES (retrieved):\nTBD\n"}
`;

  const pass1PlaceholderInstruction = `
CRITICAL — PLACEHOLDERS FOR SECTIONS 6, 7, 8 ONLY:
- For "## 6. Requirements" and ALL its subsections (### 6.1 through ### 6.4), output ONLY each heading followed by this single line: "This section will be generated in Pass 2."
- For "## 7. Business Rules", output ONLY the heading and: "This section will be generated in Pass 3."
- For "## 8. Data Requirements" and its subsections (### 8.1, ### 8.2), output ONLY each heading and: "This section will be generated in Pass 3."
- CRITICAL: DO NOT use placeholders for "## 2. Executive Summary" - it MUST be fully generated in Pass 1 with comprehensive content.
- Generate ALL other sections (Document Information, Executive Summary, Sections 1–5, 9–13, Additional Organizational Guidelines) in full with their required deliverables as specified.
- STRICT: Section 1 (Document Information) MUST end immediately after the table. Do NOT add extra numbered lists or feature descriptions below the table.
- STRICT: Section 3 (Introduction) and its subsections MUST contain only purpose, scope, and definitions. Do NOT add workflow diagrams, feature lists, or redundant project overviews here.
- STRICT: Section 7 (Business Rules) MUST contain EXACTLY ONE table. Do NOT create subsections or additional headings like "7.1 General Rules".
- STRICT: Section 12 (Appendices) MUST be "Not specified in source document." unless the source document explicitly contains appendix items. Do NOT invent "Appendix C", workflow flows, or ASCII diagrams (Gantt, architecture, etc.).
${isUploadMode
      ? `- For "## 2. Executive Summary", write the summary STRICTLY from the source document's overview/executive-summary content. If the source has no such content, write exactly "Not specified in source document." Do NOT elaborate, paraphrase, or invent.`
      : `- For "## 2. Executive Summary", write a comprehensive summary based on ALL input even if brief; NEVER leave as TBD if project description is provided.`}
`;

  const useMultiPass = opts.multiPassGeneration;

  const brdPromptPrefix: BrdPromptPrefix = {
    staticSystem: systemPrompt,
    staticUser: brdStaticUser,
    documentDate,
    provider: resolvePromptCacheProvider(),
  };
  logJobCacheFingerprint("BRD generation", createJobCachePrefix(brdPromptPrefix));

  const pass1DynamicUser = `${buildBrdDocumentDateBlock(documentDate, input.projectName)}

${useMultiPass
    ? `PASS 1 — GENERATE EVERYTHING EXCEPT FULL CONTENT FOR SECTIONS 6, 7, 8
${pass1PlaceholderInstruction}`
    : "Generate the complete BRD now, following the structure and context above."}`;

  const pass1Messages = buildBrdLlmMessages(brdPromptPrefix, pass1DynamicUser);

  // Log RAG guidance (chunk data) before sending to BRD LLM
  if (ragGuidance) {
    const ragPreview = ragGuidance.slice(0, 400) + (ragGuidance.length > 400 ? "..." : "");
    console.log("[BRD-GEN] RAG guidance being sent to BRD LLM — length:", ragGuidance.length);
    console.log("[BRD-GEN] RAG guidance preview:", ragPreview);
  } else {
    console.log("[BRD-GEN] No RAG guidance — BRD LLM prompt has no organizational RAG block");
  }

  const mainTemperature = opts.temperatureOverride ?? 0.35;

  // ============================================================
  // UPLOAD-MODE CHUNKED GENERATION
  //
  // The deployed model on this account is Bedrock/Claude, which
  // hard-caps response length at 4096 output tokens. A 13-section BRD
  // does not fit in that cap as a single response — earlier runs
  // produced output that ended around section 7, leaving sections
  // 8–13 missing and forcing the structural-validate / repair pass to
  // regenerate them after the fact (slow on Bedrock latencies).
  //
  // Instead, when in upload mode we generate the BRD as 3 parallel
  // chunks (A: sections 1-5, B: 6-7, C: 8-13) and concatenate the
  // results. Each chunk easily fits inside the 4096-token cap. The
  // remaining pipeline (sanitize → structural validate → optional
  // repair → quality gate) is unchanged, so behaviour is identical
  // when chunking succeeds and the existing repair safety-net still
  // kicks in if any chunk fails.
  //
  // We deliberately keep the non-upload (form-based) path on its
  // existing single-shot + multi-pass strategy — that path already
  // ============================================================
  // STABLE SINGLE-SHOT GENERATION + SMART REPAIR
  //
  // We use a single-shot first pass to ensure the template is contextually
  // unified and sections are correctly placed (preventing "context bleeding").
  //
  // For Upload Mode, we then run a dedicated "Pass 2" to populate or 
  // replace Section 6 (Requirements) to ensure 100% extraction fidelity 
  // without truncation issues.
  // ============================================================

  emitProgress({
    stepKey: "brd_generate",
    percent: 35,
    message: "Generating BRD",
  });

  if (options?.checkCancelled?.()) throw new Error("BRD Generation Cancelled");

  const response = await openai.chat.completions.create({
    model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
    messages: pass1Messages,
    ...getTokensParam(llmConfig.azureOpenAIDeployment, opts.brdMaxOutputTokens),
    ...getTemperatureParam(llmConfig.azureOpenAIDeployment, mainTemperature),
  });

  let rawMarkdown = response.choices[0]?.message?.content || "";
  if (!rawMarkdown) {
    throw new Error("No content generated from AI");
  }

  rawMarkdown = sanitizeBrdMarkdown(rawMarkdown);

  // If Upload Mode, we MUST run Pass 2 to ensure requirements aren't truncated
  // or if the user explicitly requested multi-pass.
  const needsRequirementsRepair = useMultiPass;

  if (needsRequirementsRepair) {
    emitProgress({
      stepKey: "brd_pass2_requirements",
      percent: 55,
      message: "Populating Section 6: Requirements (High-Fidelity Extraction)",
    });

    // We replace the (possibly truncated) Section 6 with a full extraction
    rawMarkdown = await repairSection6Requirements(
      rawMarkdown,
      input,
      canonicalRequirements,
      opts.requirementsMaxOutputTokens,
      isUploadMode,
      undefined,
      options?.checkCancelled,
      brdPromptPrefix,
    );
    rawMarkdown = sanitizeBrdMarkdown(rawMarkdown);

    // For Upload mode, we also ensure Sections 7 & 8 are fully populated from context
    if (isUploadMode && useMultiPass) {
      emitProgress({
        stepKey: "brd_pass3_rules_data",
        percent: 75,
        message: "Finalizing Business Rules & Data Requirements",
      });
      const extractedReqs = extractRequirementRowsFromMarkdown(rawMarkdown);
      rawMarkdown = await repairSections7and8(
        rawMarkdown,
        input,
        extractedReqs.all,
        ragGuidance,
        opts.brdMaxOutputTokens,
        brdPromptPrefix,
      );
      rawMarkdown = sanitizeBrdMarkdown(rawMarkdown);
    }
  } else if (opts.twoPassRequirementsRepair && (opts.mandatoryRequirementsText?.trim() || mergedExistingRequirements)) {
    emitProgress({
      stepKey: "brd_repair_requirements",
      percent: 65,
      message: "Repairing Requirements tables",
    });
    rawMarkdown = await repairSection6Requirements(
      rawMarkdown,
      input,
      canonicalRequirements,
      opts.requirementsMaxOutputTokens,
      isUploadMode,
      undefined,
      options?.checkCancelled,
      brdPromptPrefix,
    );
    rawMarkdown = sanitizeBrdMarkdown(rawMarkdown);
  }

  // Ensure the mandatory requirements list is not lost.
  let givenMandatoryList = splitRequirementsList(opts.mandatoryRequirementsText || "");

  // In Upload Mode, we automatically treat ALL extracted canonical requirements as mandatory 
  // to ensure 100% coverage in the final document.
  if (isUploadMode && canonicalRequirements.length > 0) {
    const canonicalTextList = canonicalRequirements.map(r => r.text);
    // Combine with any user-provided mandatory text, deduplicating
    const combined = Array.from(new Set([...givenMandatoryList, ...canonicalTextList]));
    givenMandatoryList = combined;
  }

  if (givenMandatoryList.length > 0) {
    let attempt = 0;
    while (attempt <= opts.maxRepairAttempts) {
      const extracted = extractRequirementRowsFromMarkdown(rawMarkdown);
      const missing = findMissingRequirements(givenMandatoryList, extracted.all);

      emitProgress({
        stepKey: "coverage_check",
        percent: 78,
        message: missing.length === 0
          ? "Coverage check complete"
          : `Coverage check: fixing ${missing.length} missing items`,
      });
      console.log("[BRD AI] Coverage check:", {
        givenCount: givenMandatoryList.length,
        generatedCount: extracted.all.length,
        missingCount: missing.length,
        attempt,
      });

      if (missing.length === 0) break;

      if (attempt === opts.maxRepairAttempts) {
        console.warn("[BRD AI] Requirements still missing after repair attempts. Returning best-effort BRD.");
        break;
      }

      rawMarkdown = await repairSection6Requirements(
        rawMarkdown,
        input,
        canonicalRequirements,
        opts.requirementsMaxOutputTokens,
        isUploadMode,
        missing,
        options?.checkCancelled,
        brdPromptPrefix,
      );
      rawMarkdown = sanitizeBrdMarkdown(rawMarkdown);

      attempt++;
    }
  }

  if (opts.enableQualityGate) {
    emitProgress({ stepKey: "quality_gate", percent: 85, message: "Running quality checks" });
    let issues = validateBrdQuality(rawMarkdown, isUploadMode);
    let repairAttempt = 0;
    const maxQualityRepairs = 2;
    const issueToSection = ISSUE_TO_SECTION;
    while (issues.length > 0 && repairAttempt < maxQualityRepairs) {
      emitProgress({
        stepKey: "quality_gate_repair",
        percent: 88,
        message: `Repairing quality issues (attempt ${repairAttempt + 1}/${maxQualityRepairs})`,
      });
      const sectionsToFix = new Set<string>();
      for (const issue of issues) {
        for (const { pattern, section } of issueToSection) {
          if (typeof pattern === "string" ? issue.includes(pattern) : pattern.test(issue)) {
            sectionsToFix.add(section);
            break;
          }
        }
      }
      for (const sectionTitle of sectionsToFix) {
        const bounds = getSectionBounds(rawMarkdown, sectionTitle);
        if (bounds.startIdx < 0) continue;
        const lines = rawMarkdown.split("\n");
        const currentContent = lines.slice(bounds.startIdx, bounds.endIdx).join("\n");
        const fixInstructions = issues.filter((i) => i.toLowerCase().includes(sectionTitle.toLowerCase().slice(0, 15))).join(". ");
        try {
          const newContent = await regenerateBRDSection(
            sectionTitle,
            input,
            currentContent,
            isUploadMode,
            `Fix the following issues. Output ONLY the complete section content with required artifacts. Do not use [bracket] placeholders; use TBD. Issues: ${fixInstructions}`,
          );
          rawMarkdown =
            lines.slice(0, bounds.startIdx).join("\n") +
            "\n" +
            sanitizeBrdMarkdown(newContent) +
            "\n" +
            lines.slice(bounds.endIdx).join("\n");
        } catch (err) {
          console.warn("[BRD AI] Quality gate regeneration failed for section:", sectionTitle, err);
        }
      }
      repairAttempt++;
      rawMarkdown = sanitizeBrdMarkdown(rawMarkdown);
      issues = validateBrdQuality(rawMarkdown);
      if (issues.length > 0) console.log("[BRD AI] Quality gate: remaining issues after attempt", repairAttempt, issues);
    }
  }

  emitProgress({
    stepKey: "structure_validate",
    percent: 90,
    message: "Validating canonical 13-section structure",
  });
  rawMarkdown = deduplicateFunctionalRequirementsSection(rawMarkdown);
  let structuralCheck = validateBrdStructure(rawMarkdown);
  if (!structuralCheck.valid) {
    console.warn(
      "[BRD AI] Structural validation found defects:",
      structuralCheck.issues.slice(0, 6),
    );
    try {
      emitProgress({
        stepKey: "structure_repair",
        percent: 91,
        message: "Repairing canonical 13-section structure",
      });
      const repaired = await repairBrdStructure(rawMarkdown, structuralCheck, input, isUploadMode);
      if (repaired) {
        const reChecked = validateBrdStructure(repaired);
        if (reChecked.valid || reChecked.issues.length < structuralCheck.issues.length) {
          rawMarkdown = sanitizeBrdMarkdown(repaired);
          structuralCheck = reChecked;
          console.log(
            "[BRD AI] Structural repair improved structure. Remaining issues:",
            structuralCheck.issues.length,
          );
        } else {
          console.warn(
            "[BRD AI] Structural repair did not reduce issue count. Keeping original markdown.",
          );
        }
      }
    } catch (repairErr) {
      console.warn("[BRD AI] Structural repair pass failed:", repairErr);
    }
  }

  emitProgress({ stepKey: "finalize", percent: 92, message: "Finalizing BRD structure" });
  rawMarkdown = sanitizeBrdMarkdown(rawMarkdown);
  let sections = parseBRDSections(rawMarkdown);

  sections = sections.sort((a, b) => {
    const numA = parseInt(a.title.replace(/^#+\s+(\d+)[.\s].*/, '$1'), 10);
    const numB = parseInt(b.title.replace(/^#+\s+(\d+)[.\s].*/, '$1'), 10);
    const isNumA = !isNaN(numA);
    const isNumB = !isNaN(numB);
    if (isNumA && isNumB) return numA - numB;
    if (isNumA) return -1;
    if (isNumB) return 1;
    return a.title.localeCompare(b.title);
  });

  const extractedReqRows = extractRequirementRowsFromMarkdown(rawMarkdown);
  const rtm = buildRequirementTraceabilityMatrix(
    canonicalRequirements,
    extractedReqRows,
  );
  const qualityMetrics = evaluateBrdQualityV2(
    canonicalRequirements,
    rtm,
    domainProfile,
  );
  const acceptanceSummary = evaluateClientAcceptance(
    qualityMetrics,
    domainProfile,
  );

  rawMarkdown = sections
    .map(s => {
      const prefix = s.title.startsWith('#') ? '' : '## ';
      return `${prefix}${s.title}\n\n${s.content.trim()}`;
    })
    .join('\n\n---\n\n');

  const brdDocument: BRDDocument = {
    title: `Business Requirements Document: ${input.projectName}`,
    version: "1.0",
    date: documentDate,
    sections,
    rawMarkdown,
    brdTemplateId: selectedBrdTemplateId,
    ...(detectedDomain ? { detectedDomain } : {}),
    ...(domainProfile ? { domainProfile } : {}),
    ...(canonicalRequirements.length ? { canonicalRequirements } : {}),
    ...(rtm.length ? { rtm } : {}),
    ...(qualityMetrics ? { qualityMetrics } : {}),
    ...(acceptanceSummary ? { acceptanceSummary } : {}),
    ...(canonicalDebug ? { canonicalRequirementsDebug: canonicalDebug } : {}),
  };

  console.log("[BRD-QUALITY] Metrics:", qualityMetrics);
  console.log("[BRD-RTM] RTM entries:", rtm.length);
  console.log("[BRD-GEN] Acceptance:", acceptanceSummary);
  console.log("[BRD-GEN] Successfully generated BRD with", sections.length, "sections");
  return brdDocument;
}

async function appendMissingSectionsIndividually(
  fullMarkdown: string,
  defects: BrdStructureValidationResult,
  input: BRDInput,
  isUploadMode = false,
): Promise<string | null> {
  if (defects.missingSections.length === 0) return null;

  const lines = fullMarkdown.split("\n");
  const headingRe = /^##\s+(\d+)\.\s+(.+?)\s*$/;
  const presentByNumber = new Map<string, { headingLine: string; bodyLines: string[] }>();
  let preamble: string[] = [];
  let current: { number: string; headingLine: string; bodyLines: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      if (current) {
        presentByNumber.set(current.number, {
          headingLine: current.headingLine,
          bodyLines: current.bodyLines,
        });
      }
      current = { number: m[1], headingLine: line, bodyLines: [] };
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) {
    presentByNumber.set(current.number, {
      headingLine: current.headingLine,
      bodyLines: current.bodyLines,
    });
  }

  const generatedByNumber = new Map<string, string>();

  console.log(
    `[BRD AI] Regenerating ${defects.missingSections.length} missing canonical section(s) in parallel: ${defects.missingSections
      .map((s) => `${s.number}. ${s.title}`)
      .join(" | ")}`,
  );
  const sectionStartedAt = Date.now();

  const sectionResults = await Promise.allSettled(
    defects.missingSections.map(async (missing) => {
      const sectionLabel = `## ${missing.number}. ${missing.title}`;
      const instructions =
        `Generate ONLY the content for the BRD section titled "${missing.title}" ` +
        `(canonical number ${missing.number}). Begin your response with the markdown ` +
        `heading "${sectionLabel}" and then the section body. Do NOT include any other ` +
        `top-level sections or preamble. Use any factual content available in the project ` +
        `context; if a sub-deliverable has no source content, write a short professional ` +
        `placeholder paragraph noting it will be confirmed during stakeholder review. Do ` +
        `NOT use bracketed placeholders like [TBD].` +
        (isUploadMode && missing.number === "5"
          ? ` Upload mode persona fidelity: for Section 5.2 User Personas, include ONLY personas explicitly stated in the uploaded source context. If the source has one persona, output one persona only. Do NOT add Admin, QA, Support, Manager, Approver, or Customer personas unless explicitly stated.`
          : "");
      const generated = await regenerateBRDSection(
        `${missing.number}. ${missing.title}`,
        input,
        "",
        isUploadMode,
        instructions,
      );
      const sanitized = sanitizeBrdMarkdown(generated || "").trim();
      if (!sanitized) return { number: missing.number, content: null as string | null };
      const startsWithHeading = new RegExp(
        `^##\\s+${missing.number.replace(".", "\\.")}\\.`,
        "m",
      ).test(sanitized);
      const finalSection = startsWithHeading
        ? sanitized
        : `${sectionLabel}\n\n${sanitized}`;
      return { number: missing.number, content: finalSection };
    }),
  );

  for (let i = 0; i < sectionResults.length; i++) {
    const missing = defects.missingSections[i];
    const result = sectionResults[i];
    if (result.status === "fulfilled") {
      if (result.value.content) {
        generatedByNumber.set(result.value.number, result.value.content);
      }
    } else {
      console.warn(
        `[BRD AI] Failed to generate missing section ${missing.number} (${missing.title}):`,
        result.reason,
      );
    }
  }

  console.log(
    `[BRD AI] Parallel missing-section regeneration completed in ${Math.round(
      (Date.now() - sectionStartedAt) / 1000,
    )}s — recovered ${generatedByNumber.size}/${defects.missingSections.length} sections.`,
  );

  if (generatedByNumber.size === 0) return null;

  const out: string[] = [];
  if (preamble.length > 0) out.push(preamble.join("\n").trimEnd());
  const seenNumbers = new Set<string>();
  for (const canonical of CANONICAL_BRD_TOP_LEVEL_SECTIONS) {
    if (presentByNumber.has(canonical.number)) {
      const existing = presentByNumber.get(canonical.number)!;
      out.push(`${existing.headingLine}\n${existing.bodyLines.join("\n").trimEnd()}`.trimEnd());
      seenNumbers.add(canonical.number);
    } else if (generatedByNumber.has(canonical.number)) {
      out.push(generatedByNumber.get(canonical.number)!.trimEnd());
      seenNumbers.add(canonical.number);
    }
  }
  for (const [num, section] of presentByNumber.entries()) {
    if (seenNumbers.has(num)) continue;
    out.push(`${section.headingLine}\n${section.bodyLines.join("\n").trimEnd()}`.trimEnd());
  }
  return out.join("\n\n");
}

async function repairBrdStructure(
  fullMarkdown: string,
  defects: BrdStructureValidationResult,
  input?: BRDInput,
  isUploadMode = false,
): Promise<string | null> {
  if (
    input &&
    defects.missingSections.length > 0 &&
    defects.extraSections.length === 0 &&
    defects.outOfOrderSections.length === 0
  ) {
    try {
      const augmented = await appendMissingSectionsIndividually(
        fullMarkdown,
        defects,
        input,
        isUploadMode,
      );
      if (augmented) return augmented;
    } catch (err) {
      console.warn(
        "[BRD AI] Section-at-a-time repair failed; falling through to whole-document repair.",
        err,
      );
    }
  }

  const canonicalList = CANONICAL_BRD_TOP_LEVEL_SECTIONS
    .map((s) => `## ${s.number}. ${s.title}`)
    .join("\n");

  const missingList = defects.missingSections.length
    ? defects.missingSections
      .map((s) => `- "## ${s.number}. ${s.title}"`)
      .join("\n")
    : "(none)";
  const extraList = defects.extraSections.length
    ? defects.extraSections.map((t) => `- "## ${t}"`).join("\n")
    : "(none)";
  const outOfOrderList = defects.outOfOrderSections.length
    ? defects.outOfOrderSections.map((t) => `- "## ${t}"`).join("\n")
    : "(none)";

  const systemPrompt = `You are an expert Business Analyst. Your ONLY job is to fix the TOP-LEVEL SECTION STRUCTURE of an existing Business Requirements Document.

STRICT RULES:
- The document MUST contain EXACTLY these 13 top-level sections, in this exact order, using level-2 markdown headings (## ):
${canonicalList}
- Preserve ALL existing factual content (paragraphs, tables, lists, IDs, requirement rows, traceability, narratives) verbatim wherever possible.
- DO NOT invent new requirements, IDs, names, dates, owners, metrics, or stakeholders.
${isUploadMode ? `- UPLOAD MODE PERSONA FIDELITY: Do NOT invent or expand personas. Section 5.2 User Personas must keep only personas already present in the existing markdown/source context; if there is one persona, keep one persona only.` : ""}
- DO NOT delete content. If you encounter a top-level section that is NOT in the canonical list, RELOCATE it as a subsection (### …) under the most appropriate canonical section. Never discard its content.
- If a canonical section is entirely absent and there is no relevant content to reuse, insert it as an empty section with a short professional placeholder paragraph (1–2 sentences) explaining that details will be confirmed during stakeholder review. Do NOT use bracketed placeholders like [TBD].
- Subsection numbering (e.g., 6.1, 6.2, 12.1, 12.2) and existing subsection headings MUST remain intact unless they conflict with the canonical top-level numbering.
- Output ONLY the corrected markdown for the entire BRD. No prose, no JSON, no commentary.`;

  const userPrompt = `The current BRD has structural defects:

Missing canonical sections:
${missingList}

Extra (non-canonical) top-level sections to absorb as subsections:
${extraList}

Out-of-order canonical sections (must be reordered to canonical 1..13 sequence):
${outOfOrderList}

Below is the FULL existing BRD markdown. Repair its top-level structure as instructed and return the COMPLETE corrected markdown:

---BEGIN CURRENT BRD---
${fullMarkdown}
---END CURRENT BRD---`;

  try {
    const resp = await openai.chat.completions.create({
      model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...getTokensParam(llmConfig.azureOpenAIDeployment, 16000),
      ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.1),
    });
    const repaired = resp.choices[0]?.message?.content?.trim() || "";
    if (!repaired || repaired.length < Math.floor(fullMarkdown.length * 0.5)) {
      console.warn(
        "[BRD AI] Structural repair response too short or empty; ignoring.",
        { originalLength: fullMarkdown.length, repairedLength: repaired.length },
      );
      return null;
    }
    return repaired;
  } catch (err) {
    console.warn("[BRD AI] repairBrdStructure LLM call failed:", err);
    return null;
  }
}


/**
 * Regenerate 6.1–6.4 tables with explicit requirement inclusion.
 */
async function repairSection6Requirements(
  fullBmd: string,
  projectContext: BRDInput,
  canonicalRequirements: CanonicalRequirement[],
  maxTokens: number,
  isUploadMode: boolean,
  missingItems?: string[],
  checkCancelled?: () => boolean,
  promptPrefix?: BrdPromptPrefix,
): Promise<string> {
  if (checkCancelled?.()) {
    throw new Error("BRD Generation Cancelled");
  }
  // Split requirements by type to feed into specialized parallel calls
  const functionalReqs = canonicalRequirements.filter(r => r.requirementType === "functional");
  const otherReqs = canonicalRequirements.filter(r => r.requirementType !== "functional");

  const functionalList = functionalReqs.map(r => `${r.id}. ${r.text}`).join("\n");
  const othersList = otherReqs.map(r => `${r.id}. ${r.text}`).join("\n");

  const baseSystemPrompt = `You are an expert Business Analyst. You will regenerate Requirements subsections for an existing BRD.

CRITICAL — SOURCE FIDELITY & FORMATTING:
- Do not introduce new requirements unless they map to an R-item below or to RAG guidance. Every Section 6 row must map to one or more R-items.
- Each subsection MUST start with a professional descriptive paragraph (3–6 sentences).
- Markdown table format: | ID | Requirement Description |
- You MUST use the following ID formats:
  - Functional (6.1): FR-01, FR-02, ...
  - Non-Functional (6.2): NFR-01, NFR-02, ...
  - Technical (6.3): TR-01, TR-02, ...
  - Integration (6.4): IR-01, IR-02, ...
- You MUST include EVERY R-item provided below.
- ID CHECKLIST: You MUST have a row for every ID in this list: ${canonicalRequirements.map(r => r.id).join(', ')}.
- CLEAN DESCRIPTION: Do NOT include the R-IDs (e.g., R1, R2) in the "Requirement Description" column of the output table. Use them ONLY to ensure you have mapped every requirement.
- CONTENT FIDELITY: Ensure all details and UI specifics for every requirement are captured in the Description. Do NOT consolidate or split rows incorrectly.
- Do not fabricate requirements; use TBD or "Not specified in source" only when truly unavoidable.`;

  const dynamic61 = `Date: ${promptPrefix?.documentDate || "TBD"}

PASS 2 — SECTION 6.1 FUNCTIONAL REQUIREMENTS

SPECIFIC INSTRUCTIONS FOR 6.1 FUNCTIONAL REQUIREMENTS:
- Output ONLY the markdown content for "### 6.1 Functional Requirements".
- Format: Paragraph -> h3 heading "### 6.1 Functional Requirements" -> bulleted list of key functional themes -> Markdown pipe-table.
- Ensure 100% coverage of the Functional R-items provided.

CANONICAL FUNCTIONAL REQUIREMENTS (R-items):
${functionalList || "(None specified)"}

${missingItems && missingItems.length ? `MISSING ITEMS TO RECOVER:\n${missingItems.join("\n")}` : ""}

Return ONLY Section 6.1 content.`;

  const dynamicOther = `Date: ${promptPrefix?.documentDate || "TBD"}

PASS 2 — SECTIONS 6.2, 6.3, 6.4

SPECIFIC INSTRUCTIONS FOR 6.2, 6.3, 6.4:
- Output ONLY the markdown content for subsections 6.2 (Non-Functional), 6.3 (Technical), and 6.4 (Integration).
- Format for each: Paragraph -> h3 heading (e.g. ### 6.2 Non-Functional Requirements) -> Markdown pipe-table.
- Do NOT include bulleted lists for 6.2-6.4; tables only after paragraphs.

CANONICAL NON-FUNCTIONAL/TECHNICAL/INTEGRATION REQUIREMENTS (R-items):
${othersList || "(None specified)"}

Return ONLY Section 6.2, 6.3, and 6.4 content.`;

  const messages61 = promptPrefix
    ? buildBrdLlmMessages(
        {
          staticSystem: promptPrefix.staticSystem,
          staticUser: promptPrefix.staticUser,
          provider: promptPrefix.provider,
        },
        `${baseSystemPrompt}\n\n${dynamic61}`,
      )
    : [
        { role: "system", content: baseSystemPrompt },
        { role: "user", content: `Project Name: ${projectContext.projectName}\nProject Description: ${projectContext.projectDescription}\n\n${dynamic61}` },
      ];

  const messagesOther = promptPrefix
    ? buildBrdLlmMessages(
        {
          staticSystem: promptPrefix.staticSystem,
          staticUser: promptPrefix.staticUser,
          provider: promptPrefix.provider,
        },
        `${baseSystemPrompt}\n\n${dynamicOther}`,
      )
    : [
        { role: "system", content: baseSystemPrompt },
        { role: "user", content: `Project Name: ${projectContext.projectName}\nProject Description: ${projectContext.projectDescription}\n\n${dynamicOther}` },
      ];

  console.log(`[BRD-GEN] Repairing Section 6 in parallel (Functional: ${functionalReqs.length} items; Others: ${otherReqs.length} items)`);

  const [res61, resOther] = await Promise.all([
    openai.chat.completions.create({
      model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
      messages: messages61,
      ...getTokensParam(llmConfig.azureOpenAIDeployment, maxTokens),
      ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.2),
    }),
    openai.chat.completions.create({
      model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
      messages: messagesOther,
      ...getTokensParam(llmConfig.azureOpenAIDeployment, maxTokens),
      ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.2),
    }),
  ]);

  const content61 = res61.choices[0]?.message?.content?.trim() || "";
  const contentOther = resOther.choices[0]?.message?.content?.trim() || "";

  if (!content61 && !contentOther) return fullBmd;

  const newReqContent = `${content61}\n\n${contentOther}`.trim();

  // Replace existing 6.1–6.4 block while preserving ## 6 Requirements heading
  const section6Match = fullBmd.match(/\n##\s*6\.?\s+Requirements/i);
  const sub61Match = fullBmd.match(/\n###\s*6\.1/);
  const section7Match = fullBmd.match(/\n##\s*7\.?\s+Business Rules/i);

  if ((section6Match || sub61Match) && section7Match) {
    let startIdx = -1;
    if (section6Match) {
      // Find the end of the line containing "## 6. Requirements" to preserve the heading
      const lineEndIdx = fullBmd.indexOf("\n", section6Match.index! + 1);
      startIdx = lineEndIdx !== -1 ? lineEndIdx : section6Match.index!;
    } else if (sub61Match) {
      startIdx = sub61Match.index!;
    }

    const endIdx = section7Match.index!;
    if (startIdx !== -1 && endIdx > startIdx) {
      return fullBmd.slice(0, startIdx) + "\n\n" + newReqContent + "\n\n" + fullBmd.slice(endIdx);
    }
  }

  // Fallback
  const fallbackStart = fullBmd.indexOf("### 6.1");
  const fallbackEnd = fullBmd.indexOf("## 7.");
  if (fallbackStart !== -1 && fallbackEnd !== -1 && fallbackEnd > fallbackStart) {
    return fullBmd.slice(0, fallbackStart) + newReqContent + "\n\n" + fullBmd.slice(fallbackEnd);
  }

  return fullBmd + "\n\n" + newReqContent;
}

/**
 * Pass 3: Generate Sections 7 (Business Rules) and 8 (Data Requirements) with required deliverables.
 * Replaces from ## 7 to before ## 9 in the full markdown.
 */
async function repairSections7and8(
  fullBmd: string,
  projectContext: BRDInput,
  requirementsExtracted: string[],
  ragGuidance: string | undefined,
  maxTokens: number,
  promptPrefix?: BrdPromptPrefix,
): Promise<string> {
  const sectionRepairSystem = `You are an expert Business Analyst. Generate ONLY the following sections for an existing BRD.

SOURCE FIDELITY — Do not introduce new requirements, business rules, entities, constraints, integrations, or KPIs unless explicitly present in the original source or RAG guidance. Derive content only from the extracted requirements and RAG guidance below; use TBD or "Not specified in source" where the source is silent.

## 7. Business Rules
- After a 3–6 sentence descriptive paragraph, output EXACTLY ONE markdown table: | ID | Rule | Rationale |
- Business Rules must be derived from explicit source logic, conditions, validations, workflows, or operational statements.
- STRICT: Do NOT create any sub-headings (like 7.1, 7.2, 7.3) or category summary tables. All content must be directly under the main Section 7 heading. Ignore any sub-structure found in retrieved RAG context.
- Include only as many rules as the source supports; use TBD rows if the source does not provide enough.

## 8. Data Requirements
### 8.1 Data Entities
- After a descriptive paragraph, output a table: | Entity | Key Attributes | Relationships | Source System | Notes |
- Data Entities must be derived from explicit domain objects, tables, records, or business objects mentioned in the source or RAG guidance. Do not invent generic entities. Include as many entities as the source supports.
- STRICT: Do NOT create sub-subheadings like 8.1.1, 8.1.2, or include volumetric/classification tables.

### 8.2 Data Migration
- After a descriptive paragraph, list Data Migration approach as bullet points only where supported by the source; use TBD or "Not specified in source" where unknown.
- STRICT: Do NOT add Section 8.3 or any other subsections. Output ONLY 8.1 and 8.2.

Do NOT use bracket placeholders like [Entity]. Use TBD or concrete names from the source.

STRICT FORMATTING RULE:
- All structured data (Business Rules, Data Entities) MUST be rendered as Markdown pipe-tables.
- Do not output plain text lists or bullet points for these sections.
- NO VISUAL ARTIFACTS: Do NOT generate ASCII diagrams, Gantt charts, architecture diagrams, or flowcharts.

Output ONLY these sections (## 7 through end of ### 8.2).`;

  const dynamicUser = `Date: ${promptPrefix?.documentDate || "TBD"}

PASS 3 — SECTIONS 7 AND 8

Extracted requirements (for context):
${requirementsExtracted.slice(0, 80).map((r) => `- ${r}`).join("\n")}
${requirementsExtracted.length > 80 ? "\n... (and more)" : ""}

${ragGuidance ? `RAG Guidance to reflect where relevant:\n${ragGuidance}\n` : ""}

Generate Sections 7 and 8 only. Return ONLY the markdown for ## 7. Business Rules through ### 8.2 Data Migration (inclusive).`;

  const messages = promptPrefix
    ? buildBrdLlmMessages(
        {
          staticSystem: promptPrefix.staticSystem,
          staticUser: promptPrefix.staticUser,
          provider: promptPrefix.provider,
        },
        `${sectionRepairSystem}\n\n${dynamicUser}`,
      )
    : [
        { role: "system", content: sectionRepairSystem },
        {
          role: "user",
          content: `Project: ${projectContext.projectName}\nDescription: ${projectContext.projectDescription}\n\n${dynamicUser}`,
        },
      ];

  const resp = await openai.chat.completions.create({
    model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
    messages,
    ...getTokensParam(llmConfig.azureOpenAIDeployment, Math.min(maxTokens, 6000)),
    ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.3),
  });

  const newContent = resp.choices[0]?.message?.content?.trim() || "";
  if (!newContent) return fullBmd;

  const start7 = fullBmd.search(/\n##\s*7\.?\s/);
  const start9 = fullBmd.search(/\n##\s*9\.?\s/);
  if (start7 !== -1 && start9 !== -1 && start9 > start7) {
    return fullBmd.slice(0, start7) + "\n" + newContent + "\n\n" + fullBmd.slice(start9);
  }
  return fullBmd + "\n\n" + newContent;
}

/**
 * Common BRD heading keywords used to detect section boundaries in unstructured text.
 */
const BRD_HEADING_KEYWORDS = /^(Executive\s+Summary|Introduction|Overview|Purpose|Scope|Background|Business\s+Objectives|Objectives|Success\s+Criteria|Stakeholder|Target\s+Audience|Key\s+Features|Requirements|Functional\s+Requirements|Non[- ]?Functional\s+Requirements|Technical\s+Requirements|Integration\s+Requirements|Business\s+Rules|Data\s+Requirements|Data\s+Entities|Data\s+Migration|Constraints|Assumptions|Dependencies|Risks?\s+(and|&)\s+Mitigation|Risk\s+Register|Timeline|Milestones|Budget|Appendix|Appendices|Glossary|Definitions|Acronyms|Approval\s+Matrix|Organizational\s+Guidelines|Document\s+Information|User\s+Personas|KPIs?|Key\s+Performance)/i;

/**
 * Parse markdown content into structured sections.
 * Detects markdown headings (#/##), numbered sections (1. / 1.1), ALL-CAPS lines,
 * and common BRD keywords as section boundaries.
 */
export function parseBRDSections(markdown: string): BRDSection[] {
  const sections: BRDSection[] = [];
  const lines = markdown.split("\n");

  let currentSection: BRDSection | null = null;
  let contentBuffer: string[] = [];

  const h1HeaderPattern = /^#\s+(.+)$/;
  const h2HeaderPattern = /^##\s+(.+)$/;
  const numberedSectionPattern = /^(\d+\.(?:\d+\.?)*)\s+([A-Z].{2,})$/;
  const allCapsPattern = /^[A-Z][A-Z\s\-&/,()]{4,}$/;

  const flushSection = () => {
    if (currentSection) {
      currentSection.content = contentBuffer.join("\n").trim();
      if (currentSection.content || sections.length === 0) {
        sections.push(currentSection);
      }
    }
  };

  const startNewSection = (title: string, line: string) => {
    flushSection();
    const cleaned = title.replace(/\*\*:?\s*$/g, "").replace(/^\*\*|\*\*$/g, "").trim();
    currentSection = { title: cleaned, content: "" };
    contentBuffer = [line];
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      if (currentSection) contentBuffer.push(line);
      continue;
    }

    const h1Match = trimmedLine.match(h1HeaderPattern);
    const h2Match = trimmedLine.match(h2HeaderPattern);

    if (h1Match) {
      startNewSection(h1Match[1], line);
      continue;
    }
    if (h2Match) {
      startNewSection(h2Match[1], line);
      continue;
    }

    // Numbered section pattern: "1. Introduction", "6.1 Functional Requirements"
    const numMatch = trimmedLine.match(numberedSectionPattern);
    if (numMatch && trimmedLine.length < 120) {
      startNewSection(trimmedLine, line);
      continue;
    }

    // ALL CAPS line that looks like a heading (short, standalone)
    if (allCapsPattern.test(trimmedLine) && trimmedLine.length < 80) {
      startNewSection(trimmedLine, line);
      continue;
    }

    // Common BRD heading keyword at start of line (not already a heading)
    if (BRD_HEADING_KEYWORDS.test(trimmedLine) && trimmedLine.length < 100) {
      startNewSection(trimmedLine, line);
      continue;
    }

    if (currentSection || (sections.length === 0 && trimmedLine)) {
      if (!currentSection) {
        currentSection = { title: "Introduction", content: "" };
      }
      contentBuffer.push(line);
    }
  }

  flushSection();
  return sections;
}

/**
 * Generate a specific section of the BRD with more detail
 */
export async function regenerateBRDSection(
  sectionTitle: string,
  projectContext: BRDInput,
  currentContent: string,
  isUploadMode: boolean,
  additionalInstructions?: string,
): Promise<string> {
  console.log("[BRD AI] Regenerating section:", sectionTitle);

  const CONTENT_POLICY = isUploadMode
    ? `
UPLOAD CONTENT POLICY (ABSOLUTE FIDELITY):
- Treat the uploaded document as the SINGLE SOURCE OF TRUTH. 
- Section 1: Table with 8 rows. Author MUST be Astra.
- Section 5. Stakeholder Analysis: Scan the source for all mentioned names, roles, and designations. You MUST include every identified stakeholder in the 5.1 table.
- Section 5.2 User Personas: Extract ONLY the primary and secondary personas found in the text. Do NOT hallucinate extra roles.
- Section 6: Identify EVERY distinct functional and technical requirement in the source. You MUST create at least one row per identified requirement. Capture 100% of UI and technical detail.
- Section 9: Locate any content related to Assumptions, Constraints, or Dependencies (even if under a different heading in the source) and place it here.
- NO HALLUCINATIONS: Do NOT add personas or "BA filler" that is not in the source.
- TERMINATION GUARD: Generate all 13 sections. Append missing sections if needed.
`
    : `
CREATE CONTENT POLICY (PROFESSIONAL BA FILLER):
- You MAY add conservative generic BA filler to complete the mandatory tables.
- Requirement descriptions MUST be extremely concise (single short sentence).
- Author MUST be Astra.
`;

  const systemPrompt = `
You are a senior Business Analyst. Generate a professional, high-fidelity Business Requirements Document (BRD) section.
 
STRICT STRUCTURAL ENFORCEMENT (MANDATORY):
- ALL structured data MUST be rendered as Markdown pipe-tables.
- NO STRAY LINES: Do NOT include floating numbered points or list items outside of headers or tables.
- Section 1 (Document Information): EXACTLY ONE Markdown table | Attribute | Description | with 8 rows. Prepared By is Astra.
- Section 5 (Stakeholders & Personas): 5.1 MUST be a table with headers | Name | Designation/Role |. 5.2 MUST be a table with headers | Persona | Role | Description |. Include ONLY the specific personas found in the source document. If only one exists, output exactly one row. Do NOT add "Admin" or other roles unless explicitly stated. No sub-headings like 5.2.1.
- Section 6 (Functional Requirements): Table format | ID | Requirement Description |. You MUST strip all source reference tags like (R1), (R20), or [Ref] from the description. No truncation allowed.
- Section 10, 11, 13: EXACTLY ONE table each. No sub-headings (11.1, 11.1.1).
- Section 12: EXACTLY TWO tables (12.1 and 12.2) ONLY.
 
${CONTENT_POLICY}
`;

  const userPrompt = `Regenerate the following BRD section with more detail and professional quality:

**Section:** ${sectionTitle}

**Project Context:**
- Project Name: ${projectContext.projectName}
- Description: ${projectContext.projectDescription}
${projectContext.businessObjectives ? `- Business Objectives: ${projectContext.businessObjectives}` : ""}
${projectContext.keyFeatures ? `- Key Features: ${projectContext.keyFeatures}` : ""}

**Current Content:**
${currentContent}

${additionalInstructions ? `**Additional Instructions:**\n${additionalInstructions}` : ""}

Generate an improved version of this section with more detail, clearer language, and better structure. Return only the content for this section, not the full document.`;

  try {
    const response = await openai.chat.completions.create({
      model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...getTokensParam(llmConfig.azureOpenAIDeployment, 4096),
      ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.7),
    });

    const content = response.choices[0]?.message?.content || "";
    if (!content) throw new Error("No content generated from AI");

    console.log("[BRD AI] Successfully regenerated section:", sectionTitle);
    return content;
  } catch (error) {
    console.error("[BRD AI] Error regenerating section:", error);
    throw new Error("Failed to regenerate section. Please try again.");
  }
}

/**
 * Enhance a single text field with AI to make it more detailed and professional
 */
export async function enhanceFieldText(
  fieldName: string,
  currentText: string,
  projectName?: string,
): Promise<string> {
  console.log("[BRD AI] Enhancing field:", fieldName);

  const fieldDescriptions: Record<string, string> = {
    projectDescription:
      "a detailed project description that clearly explains the purpose, scope, and value proposition",
    businessObjectives:
      "clear, measurable business objectives using SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)",
    successCriteria:
      "specific, quantifiable success criteria that can be used to measure project outcomes",
    targetAudience:
      "a comprehensive target audience analysis including user personas, demographics, and needs",
    stakeholders:
      "a thorough stakeholder analysis including roles, interests, and influence levels",
    keyFeatures:
      "a detailed list of key features with clear descriptions of functionality and user benefits",
    existingRequirements:
      "well-structured requirements with clear acceptance criteria and priority levels",
    constraints:
      "a comprehensive list of constraints including technical, budget, timeline, and regulatory limitations",
  };

  const fieldDescription = fieldDescriptions[fieldName] || "professional, detailed content";

  const systemPrompt = `You are an expert Business Analyst with extensive experience in requirements gathering and documentation. Your task is to enhance and enrich the provided text to create ${fieldDescription}.

Guidelines:
- Maintain the original intent and key points
- Add professional language and structure
- Include specific details and examples where appropriate
- Use bullet points or numbered lists for clarity when appropriate
- Keep the content concise but comprehensive
- Do not add markdown headers (##) - just return the enhanced content`;

  const userPrompt = `Enhance the following text for a Business Requirements Document:

${projectName ? `**Project:** ${projectName}\n` : ""}
**Field:** ${fieldName.replace(/([A-Z])/g, " $1").trim()}

**Original Text:**
${currentText}

Provide an enhanced, more detailed and professional version of this content. Return only the enhanced text without any preamble or explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: useConfiguredLLM ? (llmConfig.azureOpenAIDeployment || "gpt-4") : "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...getTokensParam(llmConfig.azureOpenAIDeployment, 1024),
      ...getTemperatureParam(llmConfig.azureOpenAIDeployment, 0.7),
    });

    const content = response.choices[0]?.message?.content || "";
    if (!content) throw new Error("No content generated from AI");

    console.log("[BRD AI] Successfully enhanced field:", fieldName);
    return content.trim();
  } catch (error) {
    console.error("[BRD AI] Error enhancing field:", error);
    throw new Error("Failed to enhance text. Please try again.");
  }
}

/**
 * Map validation issue messages to section titles for targeted repair.
 */
const ISSUE_TO_SECTION: Array<{ pattern: string | RegExp; section: string }> = [
  { pattern: "Document Information", section: "Document Information" },
  { pattern: "Executive Summary", section: "Executive Summary" },
  { pattern: "Key Performance Indicators", section: "4.3 Key Performance Indicators (KPIs)" },
  { pattern: "Key Stakeholders", section: "5.1 Key Stakeholders" },
  { pattern: "User Personas", section: "5.2 User Personas" },
  { pattern: "Business Rules", section: "7. Business Rules" },
  { pattern: "Data Entities", section: "8.1 Data Entities" },
  { pattern: "Risks and Mitigation", section: "10. Risks and Mitigation" },
  { pattern: "Timeline and Milestones", section: "11. Timeline and Milestones" },
  { pattern: "Reference Documents", section: "12.1 Reference Documents" },
  { pattern: "Approval Matrix", section: "12.2 Approval Matrix" },
  { pattern: "bracket placeholders", section: "Document Information" },
];

/**
 * Regenerate only the sections that failed validation (max one repair cycle).
 * Replaces section blocks in markdown using heading matching.
 */
export async function repairFailedSectionsParallel(
  markdown: string,
  issues: string[],
  input: BRDInput,
  isUploadMode: boolean,
  ragGuidance?: string,
): Promise<string> {
  const sectionsToFix = new Set<string>();
  for (const issue of issues) {
    for (const { pattern, section } of ISSUE_TO_SECTION) {
      const matches =
        typeof pattern === "string"
          ? issue.includes(pattern)
          : (pattern as RegExp).test(issue);
      if (matches) {
        sectionsToFix.add(section);
        break;
      }
    }
  }

  let result = markdown;

  for (const sectionTitle of sectionsToFix) {
    const bounds = getSectionBounds(result, sectionTitle);
    const lineArr = result.split("\n");
    const currentContent = lineArr.slice(bounds.startIdx, bounds.endIdx).join("\n");
    const fixInstructions = issues
      .filter((i) =>
        i.toLowerCase().includes(sectionTitle.toLowerCase().slice(0, 15)),
      )
      .join(". ");
    try {
      const newContent = await regenerateBRDSection(
        sectionTitle,
        input,
        currentContent,
        isUploadMode,
        `Fix the following issues. Output ONLY the complete section content with required artifacts. Do not use [bracket] placeholders. ${isUploadMode ? 'STRICT FIDELITY: Capture ONLY the personas and stakeholders present in the original source document. Do NOT hallucinate extra roles, names, or "Best Practice" personas.' : ''} Issues: ${fixInstructions}`,
      );

      if (bounds.startIdx >= 0) {
        result =
          lineArr.slice(0, bounds.startIdx).join("\n") +
          "\n" +
          newContent +
          "\n" +
          lineArr.slice(bounds.endIdx).join("\n");
      } else {
        // APPEND if missing
        result = result.trim() + "\n\n" + newContent;
      }
    } catch (err) {
      console.warn("[BRD AI Parallel] Repair failed for section:", sectionTitle, err);
    }
  }

  return result;
}

/**
 * Extract Section 4 (### 4.1 to before ## 5) from markdown for deterministic merge.
 */
function extractSection4Block(markdown: string): string {
  const startIdx = markdown.indexOf("### 4.1");
  const endMatch = markdown.match(/\n## 5\.?\s/);
  const endIdx = endMatch ? markdown.indexOf(endMatch[0]) : -1;
  if (startIdx === -1) return "";
  if (endIdx === -1 || endIdx <= startIdx) return markdown.slice(startIdx);
  return markdown.slice(startIdx, endIdx).trim();
}

/**
 * Run two full BRD generations in parallel (stable vs creative), score them, select the best,
 * optionally repair failed sections and merge the stronger Section 4. Returns a single BRDDocument.
 */
export async function generateBRDParallel(
  input: BRDInput,
  ragGuidance?: string,
  options?: GenerateBrdOptions,
): Promise<BRDDocument> {
  const isUploadMode = options?.mode === "upload";
  const stableOptions: GenerateBrdOptions = {
    ...options,
    temperatureOverride: 0.25,
  };
  const creativeOptions: GenerateBrdOptions = {
    ...options,
    temperatureOverride: 0.55,
  };

  const [stableDoc, creativeDoc] = await Promise.all([
    generateBRD(input, ragGuidance, stableOptions),
    generateBRD(input, ragGuidance, creativeOptions),
  ]);

  const mandatoryText = options?.mandatoryRequirementsText?.trim() || "";
  const givenList = mandatoryText ? splitRequirementsList(mandatoryText) : [];

  const stableExtracted = extractRequirementRowsFromMarkdown(stableDoc.rawMarkdown);
  const creativeExtracted = extractRequirementRowsFromMarkdown(creativeDoc.rawMarkdown);
  const stableMissing = mandatoryText
    ? findMissingRequirements(givenList, stableExtracted.all).length
    : 0;
  const creativeMissing = mandatoryText
    ? findMissingRequirements(givenList, creativeExtracted.all).length
    : 0;

  const stableScore = scoreBrdQuality(stableDoc.rawMarkdown, {
    mandatoryRequirementsText: mandatoryText || undefined,
    missingCount: stableMissing,
  });
  const creativeScore = scoreBrdQuality(creativeDoc.rawMarkdown, {
    mandatoryRequirementsText: mandatoryText || undefined,
    missingCount: creativeMissing,
  });

  console.log("[BRD AI Parallel] Stable score:", stableScore);
  console.log("[BRD AI Parallel] Creative score:", creativeScore);

  const selectedLabel = stableScore >= creativeScore ? "Stable" : "Creative";
  console.log("[BRD AI Parallel] Selected:", selectedLabel);

  let selectedMarkdown =
    stableScore >= creativeScore ? stableDoc.rawMarkdown : creativeDoc.rawMarkdown;
  const selectedDoc = stableScore >= creativeScore ? stableDoc : creativeDoc;
  const otherDoc = stableScore >= creativeScore ? creativeDoc : stableDoc;
  const selectedExtracted = stableScore >= creativeScore ? stableExtracted : creativeExtracted;
  const otherExtracted = stableScore >= creativeScore ? creativeExtracted : stableExtracted;
  const selectedMissing = stableScore >= creativeScore ? stableMissing : creativeMissing;
  const otherMissing = stableScore >= creativeScore ? creativeMissing : stableMissing;

  // Deterministic merge of Section 4: use the block with more requirement rows and fewer missing
  const selectedSection4 = extractSection4Block(selectedMarkdown);
  const otherSection4 = extractSection4Block(otherDoc.rawMarkdown);
  const selectedReqCount = selectedExtracted.all.length;
  const otherReqCount = otherExtracted.all.length;
  const useOtherSection4 =
    otherSection4.length > 0 &&
    (otherReqCount > selectedReqCount || (otherReqCount === selectedReqCount && otherMissing < selectedMissing));

  if (useOtherSection4) {
    const startIdx = selectedMarkdown.indexOf("### 4.1");
    const endMatch = selectedMarkdown.match(/\n## 5\.?\s/);
    const endIdx = endMatch ? selectedMarkdown.indexOf(endMatch[0]) : -1;
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      selectedMarkdown =
        selectedMarkdown.slice(0, startIdx) +
        otherSection4 +
        "\n\n" +
        selectedMarkdown.slice(endIdx);
    }
  }

  let issues = validateBrdQuality(selectedMarkdown, isUploadMode);
  if (issues.length > 0) {
    selectedMarkdown = await repairFailedSectionsParallel(
      selectedMarkdown,
      issues,
      input,
      isUploadMode,
      ragGuidance,
    );
    issues = validateBrdQuality(selectedMarkdown, isUploadMode);
    if (issues.length > 0) {
      console.log("[BRD AI Parallel] Remaining issues after repair:", issues.length);
    }
  }

  const documentDate =
    input.generationDate || new Date().toISOString().split("T")[0];
  const selectedBrdTemplateId = "gold_1_0";
  return {
    title: selectedDoc.title,
    version: selectedDoc.version,
    date: documentDate,
    sections: parseBRDSections(selectedMarkdown),
    rawMarkdown: selectedMarkdown,
    brdTemplateId: selectedBrdTemplateId,
  };
}

/**
 * Summarize up to 2 Confluence Word export documents into a concise reference
 * text block for use as `ragGuidance` during BRD generation.
 *
 * Each document is supplied as extracted plain text (from mammoth/docx parser)
 * plus optional images (Confluence diagrams, screenshots, mockups) extracted
 * from the .docx container.
 *
 * The output is a single string (≤5 000 words) that the BRD generation prompt
 * uses under its "ORGANIZATIONAL GUIDELINES / REFERENCE CONTEXT" block.
 *
 * NEVER throws — always returns a string (may be empty on failure).
 */
export async function summarizeConfluenceDocuments(
  documents: Array<{
    filename: string;
    text: string;
    images?: Array<{ data: string; mediaType: string }>;
  }>,
): Promise<string> {
  if (!documents || documents.length === 0) return "";

  // Build the combined input for the LLM.
  // Truncate each document text to 30 000 chars (≈ 7 500 tokens) so we stay
  // well within Claude's context window even with 2 documents + images.
  const MAX_CHARS_PER_DOC = 30_000;
  const parts: string[] = [];
  for (const doc of documents) {
    const truncated =
      doc.text.length > MAX_CHARS_PER_DOC
        ? doc.text.slice(0, MAX_CHARS_PER_DOC) + "\n\n[...document truncated for brevity...]"
        : doc.text;
    parts.push(
      `=== Confluence Page: ${doc.filename} ===\n${truncated}`,
    );
  }
  const combinedText = parts.join("\n\n");

  // Gather all images from all documents (cap at 10 to stay within vision limits)
  const allImages: Array<{ data: string; mediaType: string }> = [];
  for (const doc of documents) {
    if (doc.images && doc.images.length > 0) {
      allImages.push(...doc.images);
      if (allImages.length >= 10) break;
    }
  }

  const systemPrompt = `You are an expert Business Analyst. Your task is to read one or more Confluence page exports and produce a CONCISE reference summary for a Business Requirements Document (BRD) writer.

SUMMARIZATION RULES:
1. Extract and preserve VERBATIM: requirement IDs, system names, field names, specific numbers, SLA values, API names, data entity names, and technical constraints.
2. Preserve the structure of any requirement tables — include ID and description columns faithfully.
3. Summarize diagrams and screenshots: describe what each shows in 1-2 sentences (e.g. "The architecture diagram shows a 3-tier system with a React frontend, Node.js API layer, and PostgreSQL database").
4. Omit: navigation elements, boilerplate Confluence headers/footers, revision history, and any content that is clearly not requirement-related.
5. Output format: use Markdown with clear headings matching the source sections. Max 5 000 words total.
6. Do NOT invent or infer requirements not present in the source.`;

  const userContent: any[] = [
    {
      type: "text",
      text: `Please summarize the following Confluence page export(s) as BRD reference context:\n\n${combinedText}`,
    },
  ];

  // Attach images if any exist (Claude vision)
  for (const img of allImages.slice(0, 10)) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${img.mediaType};base64,${img.data}`,
        detail: "low",
      },
    });
  }

  try {
    console.log(
      `[BRD-Confluence] Summarizing ${documents.length} document(s) (${combinedText.length} chars, ${allImages.length} images)`,
    );
    const deployment = llmConfig.azureOpenAIDeployment;
    const response = await openai.chat.completions.create({
      model: deployment || "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      ...getTokensParam(deployment, 6000),
      ...getTemperatureParam(deployment, 0.2),
    });
    const summary =
      (response.choices?.[0]?.message?.content as string | undefined) ?? "";
    console.log(
      `[BRD-Confluence] Summary generated: ${summary.length} chars`,
    );
    return summary.trim();
  } catch (err) {
    // Non-fatal: BRD generation should continue without the Confluence context.
    console.error(
      "[BRD-Confluence] Failed to summarize Confluence documents; continuing without reference:",
      err instanceof Error ? err.message : String(err),
    );
    return "";
  }
}

export default {
  generateBRD,
  generateBRDParallel,
  regenerateBRDSection,
  enhanceFieldText,
  parseBRDSections,
  validateBrdQuality,
  scoreBrdQuality,
  repairFailedSectionsParallel,
  splitRequirementsList,
  extractRequirementRowsFromMarkdown,
  findMissingRequirements,
  summarizeConfluenceDocuments,
};
