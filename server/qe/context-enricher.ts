import { createQeAnthropicClient } from './ai-client.js';
import type { ProjectIndex } from "./golden-repo-indexer.js";
import type { UserStoryInput } from "./claude-test-generator.js";
import type { ExtractedDocument } from "./document-extractor.js";

// ─── Enriched context returned by Claude ─────────────────────────────────────

export interface EnrichedProjectContext {
  /** Actual API endpoints in the codebase relevant to this story */
  realApiEndpoints: string[];
  /** Real database column / form field names from the schema */
  realFieldNames: string[];
  /** Concrete valid test data values — enums, status codes, type codes */
  realTestDataValues: string[];
  /** UI component names, data-testid attributes, CSS selectors */
  realSelectors: string[];
  /** Services, events, external calls triggered by this story's actions */
  integrationTouchpoints: string[];
  /** Important test scenarios NOT in acceptance criteria but present in codebase */
  coverageGaps: string[];
  /** Technical risks or missing checks found in the codebase */
  riskAreas: string[];
  /** Validation functions / business logic rules relevant to this story */
  businessRules: string[];
  /** Names of existing tests that already cover this story (avoid duplicates) */
  alreadyCoveredBy: string[];
}

const EMPTY_CONTEXT: EnrichedProjectContext = {
  realApiEndpoints: [], realFieldNames: [], realTestDataValues: [],
  realSelectors: [], integrationTouchpoints: [], coverageGaps: [],
  riskAreas: [], businessRules: [], alreadyCoveredBy: [],
};

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enrichWithProjectContext(
  index: ProjectIndex | null,
  story: UserStoryInput,
  uploadedDocuments?: ExtractedDocument[],
  /**
   * Optional summary text retrieved from the SDLC Golden Repo (via
   * `server/qe/golden-repo-guidance.ts`). When present it is injected as a
   * dedicated section into the enricher prompt so the LLM treats it as the
   * authoritative source for org-level standards (validation rules, naming
   * conventions, integration patterns), distinct from the project codebase
   * index (which is current source) and uploaded documents (which are
   * ad-hoc references for this story).
   */
  goldenRepoGuidance?: string,
): Promise<EnrichedProjectContext> {
  const anthropic = createQeAnthropicClient();

  // Build a minimal empty index when no repo was scanned but documents were provided
  const effectiveIndex: ProjectIndex = index ?? {
    projectPath: "(no repo scanned)",
    totalFilesScanned: 0,
    indexedAt: new Date().toISOString(),
    routes: [],
    schemas: [],
    types: [],
    existingTests: [],
    services: [],
    eventPatterns: [],
    validationFunctions: [],
    envVariables: [],
  };

  const contextSummary = formatIndexForPrompt(effectiveIndex);
  const documentSection = formatDocumentsForPrompt(uploadedDocuments);
  const guidanceSection = formatGoldenRepoGuidanceForPrompt(goldenRepoGuidance);

  const prompt = buildPrompt(contextSummary, story, documentSection, guidanceSection);

  try {
    const docCount = uploadedDocuments?.length ?? 0;
    console.log(
      `[ContextEnricher] Calling Claude to analyse project context` +
      (docCount > 0 ? ` + ${docCount} uploaded document(s)` : "") + "..."
    );
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[ContextEnricher] No JSON in response, using empty context");
      return EMPTY_CONTEXT;
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<EnrichedProjectContext>;

    // Validate and sanitise — every field must be a string array
    const safe = (v: unknown): string[] =>
      Array.isArray(v) ? (v as unknown[]).filter(x => typeof x === "string") as string[] : [];

    const enriched: EnrichedProjectContext = {
      realApiEndpoints:     safe(parsed.realApiEndpoints),
      realFieldNames:       safe(parsed.realFieldNames),
      realTestDataValues:   safe(parsed.realTestDataValues),
      realSelectors:        safe(parsed.realSelectors),
      integrationTouchpoints: safe(parsed.integrationTouchpoints),
      coverageGaps:         safe(parsed.coverageGaps),
      riskAreas:            safe(parsed.riskAreas),
      businessRules:        safe(parsed.businessRules),
      alreadyCoveredBy:     safe(parsed.alreadyCoveredBy),
    };

    console.log(
      `[ContextEnricher] Enriched: ${enriched.realApiEndpoints.length} endpoints | ` +
      `${enriched.realFieldNames.length} fields | ${enriched.realTestDataValues.length} test values | ` +
      `${enriched.coverageGaps.length} gaps | ${enriched.riskAreas.length} risks`
    );
    return enriched;
  } catch (err: any) {
    console.warn("[ContextEnricher] Failed, falling back to rule-based only:", err?.message ?? err);
    return EMPTY_CONTEXT;
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(
  contextSummary: string,
  story: UserStoryInput,
  documentSection?: string,
  goldenRepoGuidanceSection?: string,
): string {
  const docBlock = documentSection ? `\n${documentSection}\n` : "";
  // The Golden Repo block is placed BEFORE the codebase index so the model
  // treats org standards as the authoritative reference. Empty string when
  // no guidance was loaded.
  const guidanceBlock = goldenRepoGuidanceSection ? `\n${goldenRepoGuidanceSection}\n` : "";

  return `You are a senior test architect analysing a user story against a real codebase and supporting reference documents.
${guidanceBlock}
PROJECT CODEBASE INDEX:
${contextSummary}
${docBlock}
USER STORY:
Title: ${story.title}
Description: ${story.description}
Acceptance Criteria:
${story.acceptanceCriteria}

Analyse the user story AGAINST the Golden Repo guidance (if provided), the codebase index, and any uploaded reference documents above, then return a JSON object.

{
  "realApiEndpoints": ["actual API endpoints from the codebase relevant to this story — format: METHOD /path"],
  "realFieldNames": ["actual database column names or form field names from the schema relevant to this story"],
  "realTestDataValues": ["concrete valid test data — enum values, type codes, status values from the schema"],
  "realSelectors": ["UI component names, data-testid values, or CSS class names if identifiable from the codebase"],
  "integrationTouchpoints": ["services, events, or external calls that will be triggered by this story's actions"],
  "coverageGaps": ["important scenarios NOT in the acceptance criteria but visible in the codebase or Golden Repo guidance that should be tested"],
  "riskAreas": ["specific technical risks or missing validations found in the codebase or violations of Golden Repo standards related to this story"],
  "businessRules": ["validation functions, schema constraints, or business logic rules in the code, AND any standards/conventions from the Golden Repo guidance, that apply to this story"],
  "alreadyCoveredBy": ["names of existing tests that already cover this exact functionality — will be used to avoid duplicates"]
}

Rules:
- Prefer items found in the Golden Repo guidance or codebase index above — do NOT invent things
- If nothing is found for a field, return an empty array []
- Keep each item under 120 characters
- Return ONLY valid JSON — no explanation, no markdown fences`;
}

// ─── Golden Repo guidance formatter ──────────────────────────────────────────

function formatGoldenRepoGuidanceForPrompt(guidance?: string): string {
  if (!guidance || guidance.trim().length === 0) return "";
  return `## GOLDEN REPO ORGANIZATIONAL GUIDANCE
The following is authoritative organizational guidance retrieved from the project's Golden Repo. Treat it as the source of truth for naming conventions, validation rules, integration patterns, security standards, and accessibility requirements. When the codebase below contradicts this guidance, the contradiction itself is a riskArea.

${guidance.trim()}`;
}

// ─── Uploaded-document formatter ─────────────────────────────────────────────

function formatDocumentsForPrompt(docs?: ExtractedDocument[]): string {
  if (!docs || docs.length === 0) return "";

  const lines: string[] = ["## Uploaded Context Documents"];

  for (const doc of docs) {
    lines.push(`\n### ${doc.fileName}  [${doc.fileType} | ${doc.charCount} chars${doc.truncated ? " | truncated" : ""}]`);
    lines.push(doc.content);
  }

  return lines.join("\n");
}

// ─── Index formatter ──────────────────────────────────────────────────────────

function formatIndexForPrompt(index: ProjectIndex): string {
  const lines: string[] = [
    `Project: ${index.projectPath}`,
    `Scanned: ${index.totalFilesScanned} files  |  Indexed: ${index.indexedAt}`,
  ];

  if (index.routes.length > 0) {
    lines.push("\n── API ROUTES ──");
    index.routes.slice(0, 50).forEach(r =>
      lines.push(`  ${r.method.padEnd(7)} ${r.path}  (${r.file})`)
    );
  }

  if (index.schemas.length > 0) {
    lines.push("\n── DATABASE SCHEMA ──");
    index.schemas.slice(0, 20).forEach(t => {
      lines.push(`  TABLE ${t.name}  (${t.file})`);
      t.columns.slice(0, 12).forEach(c => lines.push(`    · ${c.name}: ${c.type}`));
    });
  }

  if (index.types.length > 0) {
    lines.push("\n── TYPES & ENUMS ──");
    index.types.slice(0, 30).forEach(t => {
      const summary = t.fields.slice(0, 6).join(" | ");
      lines.push(`  ${t.kind.toUpperCase()} ${t.name}: ${summary}  (${t.file})`);
    });
  }

  if (index.existingTests.length > 0) {
    lines.push("\n── EXISTING TESTS ──");
    index.existingTests.slice(0, 25).forEach(ts => {
      lines.push(`  [${ts.type}] ${ts.file}`);
      ts.tests.slice(0, 6).forEach(t => lines.push(`    - ${t}`));
    });
  }

  if (index.services.length > 0) {
    lines.push("\n── SERVICES / REPOSITORIES ──");
    index.services.slice(0, 15).forEach(s => {
      lines.push(`  CLASS ${s.name}  (${s.file})`);
      lines.push(`    Methods: ${s.methods.slice(0, 8).join(", ")}`);
    });
  }

  if (index.eventPatterns.length > 0) {
    lines.push("\n── EVENT PATTERNS ──");
    index.eventPatterns.slice(0, 20).forEach(e => lines.push(`  emit("${e}")`));
  }

  if (index.validationFunctions.length > 0) {
    lines.push("\n── VALIDATION FUNCTIONS ──");
    index.validationFunctions.slice(0, 15).forEach(v => lines.push(`  ${v}()`));
  }

  if (index.envVariables.length > 0) {
    lines.push("\n── ENV VARIABLES ──");
    index.envVariables.slice(0, 20).forEach(e => lines.push(`  process.env.${e}`));
  }

  return lines.join("\n");
}
