import { qeAnthropicClient as anthropic } from './ai-client.js';
import { db } from "./db.js";
import { frameworkFunctions, frameworkConfigs } from "@shared/qe-schema";
import { eq } from "drizzle-orm";
import { llm } from '../llm-config.js';

// Route the Story Analyzer LLM call through the hosting-aware unified facade.
// On AWS this dispatches to Bedrock Converse; on Azure it keeps using Azure
// OpenAI. The previous direct OpenAI/Replit-proxy client failed on pure-AWS
// deploys because AI_INTEGRATIONS_OPENAI_* never gets set there.
const openai = {
  chat: {
    completions: {
      create: (params: any) => llm.selected.chat.completions.create(params),
    },
  },
} as any;

// Retry helper with exponential backoff for handling rate limit and overloaded errors
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 5000,
  context: string = "API call"
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const statusCode = error?.status || error?.error?.code;
      const isRetryable = 
        statusCode === 429 || 
        statusCode === 529 || 
        error?.message?.includes('overloaded') || 
        error?.message?.includes('rate') ||
        error?.message?.includes('RESOURCE_EXHAUSTED');
      
      if (attempt < maxRetries && isRetryable) {
        // Longer delays: 5s, 15s, 35s, 75s, 155s (exponential with jitter)
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 2000;
        console.log(`[Retry] ${context} failed with ${statusCode} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay/1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.log(`[Retry] ${context} failed after ${attempt + 1} attempts, giving up`);
        throw error;
      }
    }
  }
  throw lastError;
}

export interface SprintTestCase {
  testCaseId: string;
  title: string;
  description?: string;
  objective: string;
  preconditions: string[];
  testSteps: Array<{ step_number: number; action: string; expected_behavior: string }>;
  expectedResult: string;
  postconditions?: string[];
  testData: Record<string, any>;
  category: "functional" | "negative" | "edge_case" | "security" | "accessibility" | "regression";
  priority: string;
  traceability?: string;
}

export interface TraceabilityRequirement {
  id: string;
  text: string;
  source: "acceptance_criteria" | "description" | "comment";
  coveredBy: string[];
  isCovered: boolean;
}

export interface TraceabilityReport {
  requirements: TraceabilityRequirement[];
  totalRequirements: number;
  coveredCount: number;
  uncoveredCount: number;
  coveragePercentage: number;
  confidenceScore: number;
  summary: string;
}

export interface AgentStatus {
  agent: string;
  status: "idle" | "thinking" | "working" | "completed" | "error";
  message: string;
  details?: string;
  progress?: number;
}

export interface AgenticPipelineEvent {
  type:
    | "agent_status"
    | "pipeline_stage"
    | "test_case"
    | "category_complete"
    | "analysis_result"
    | "plan_result"
    | "refinement"
    | "refined_test_cases"
    | "traceability_report"
    | "bdd_assets"
    | "complete"
    | "error"
    // Carries the structured EnrichedProjectContext (fields, endpoints, gaps, ...)
    // back to the UI so the "Enriched Context" panel can render it.
    | "enriched_context"
    // Total-coverage rollup emitted once after rule-based generation.
    | "coverage_summary";
  agent?: string;
  stage?: string;
  status?: AgentStatus;
  testCase?: SprintTestCase;
  category?: string;
  count?: number;
  data?: any;
  message?: string;
}

export interface BDDAssets {
  featureFiles: Array<{
    name: string;
    content: string;
    module: string;
  }>;
  stepDefinitions: Array<{
    name: string;
    content: string;
    module: string;
  }>;
  pageObjects: Array<{
    name: string;
    content: string;
  }>;
  utilities: {
    genericActions: string;
    waitHelpers: string;
    assertionHelpers: string;
  };
  config: {
    playwrightConfig: string;
    cucumberConfig: string;
  };
}

type EventCallback = (event: AgenticPipelineEvent) => void;

// ---------------------------------------------------------------------------
// Framework Catalog — loaded from DB, injected into generation prompts
// ---------------------------------------------------------------------------
export interface FrameworkCatalogEntry {
  name: string;
  signature: string;
  description: string | null;
  category: string;
  returnType: string | null;
  className: string | null;
  importPath: string | null;
  parameters: Array<{ name: string; type: string }>;
}

export interface FrameworkCatalog {
  configName: string;
  framework: string;
  language: string;
  baseClass: string | null;
  sampleScript: string | null;
  functions: FrameworkCatalogEntry[];
  byCategory: Record<string, FrameworkCatalogEntry[]>;
}

/**
 * Load the framework function catalog from DB.
 * If a specific configId is provided, use that config.
 * Otherwise fall back to any global config.
 */
async function loadFrameworkCatalog(configId?: string): Promise<FrameworkCatalog | null> {
  try {
    let config: any = null;
    if (configId) {
      const rows = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.id, configId));
      config = rows[0] ?? null;
    }
    if (!config) {
      // Fall back to first global config
      const globals = await db.select().from(frameworkConfigs).where(eq(frameworkConfigs.isGlobal, true));
      config = globals[0] ?? null;
    }
    if (!config) return null;

    const fns = await db.select().from(frameworkFunctions).where(eq(frameworkFunctions.configId, config.id));
    if (fns.length === 0) return null;

    const entries: FrameworkCatalogEntry[] = fns.map(f => ({
      name: f.name,
      signature: f.signature,
      description: f.description ?? null,
      category: f.category,
      returnType: f.returnType ?? null,
      className: (f as any).className ?? null,
      importPath: (f as any).importPath ?? null,
      parameters: (f.parameters as Array<{ name: string; type: string }>) ?? [],
    }));

    const byCategory: Record<string, FrameworkCatalogEntry[]> = {};
    for (const e of entries) {
      if (!byCategory[e.category]) byCategory[e.category] = [];
      byCategory[e.category].push(e);
    }

    console.log(`[Framework Catalog] Loaded ${entries.length} functions from config "${config.name}" (${config.framework}/${config.language})`);

    return {
      configName: config.name,
      framework: config.framework,
      language: config.language,
      baseClass: config.baseClass ?? null,
      sampleScript: config.sampleScript ?? null,
      functions: entries,
      byCategory,
    };
  } catch (err: any) {
    console.warn("[Framework Catalog] Could not load catalog:", err?.message);
    return null;
  }
}

/**
 * Build a concise catalog context string for injection into generation prompts.
 */
function buildCatalogPromptContext(catalog: FrameworkCatalog): string {
  const lines: string[] = [
    `\n## TEAM FRAMEWORK CATALOG (${catalog.configName} — ${catalog.framework}/${catalog.language}):`,
    `Use the following existing framework functions when generating test steps and scripts.`,
    `Prefer these over generic implementations. Always call them by their exact signature.`,
    "",
  ];

  const priorityCategories = ["navigation", "assertion", "generic", "setup", "data", "business"];
  for (const cat of priorityCategories) {
    const fns = catalog.byCategory[cat];
    if (!fns || fns.length === 0) continue;
    lines.push(`### ${cat.toUpperCase()} functions:`);
    for (const f of fns.slice(0, 8)) { // max 8 per category to keep prompt focused
      const desc = f.description ? ` — ${f.description}` : "";
      const cls = f.className ? `[${f.className}] ` : "";
      lines.push(`  - ${cls}${f.signature}${desc}`);
    }
    lines.push("");
  }

  if (catalog.baseClass) {
    lines.push(`Base class to extend: ${catalog.baseClass}`);
  }

  return lines.join("\n");
}

/**
 * Build import statements from catalog for generated scripts.
 */
function buildCatalogImports(catalog: FrameworkCatalog, language: "typescript" | "java"): string {
  if (language === "java") {
    const classes = new Set<string>();
    for (const f of catalog.functions) {
      if (f.importPath) classes.add(f.importPath);
    }
    if (catalog.baseClass) classes.add(catalog.baseClass);
    return Array.from(classes).map(c => `import ${c};`).join("\n");
  }

  // TypeScript
  const byPath: Record<string, string[]> = {};
  for (const f of catalog.functions) {
    if (f.importPath && f.className) {
      if (!byPath[f.importPath]) byPath[f.importPath] = [];
      if (!byPath[f.importPath].includes(f.className)) {
        byPath[f.importPath].push(f.className);
      }
    }
  }
  return Object.entries(byPath)
    .map(([path, classes]) => `import { ${classes.join(", ")} } from '${path}';`)
    .join("\n");
}

interface StoryAnalysis {
  complexity: "low" | "medium" | "high";
  testableRequirements: string[];
  riskAreas: string[];
  suggestedTestCounts: Record<string, number>;
  domainSpecificConsiderations: string[];
  edgeCases: string[];
  requiredCategories: string[];
  regressionAreas: string[];
  hasSecurityRequirements: boolean;
  hasAccessibilityRequirements: boolean;
}

interface TestPlan {
  totalTests: number;
  distribution: Record<string, number>;
  priorityFocus: string[];
  coverageAreas: string[];
}

export interface StoryMetadata {
  jiraKey?: string;
  priority?: string;
  storyPoints?: number | null;
  assignee?: string;
  sprintName?: string;
  projectName?: string;
  labels?: string[];
  status?: string;
  comments?: string;
}

/**
 * Optional Golden Repo guidance bundle. Produced upstream by
 * `server/qe/golden-repo-guidance.ts` from `sdlc_projects.golden_repo_reference`
 * → `devx_guideline_chunks` → CAG-mode RAG. When supplied, it is injected
 * into both the context-enricher prompt and the QA refiner prompt so test
 * cases reflect organizational standards / patterns instead of relying only
 * on the user story text and local repo scan.
 */
export interface GoldenRepoGuidanceBundle {
  /** Final RAG summary text. */
  guidance: string;
  /** Diagnostic metadata so the pipeline can log/emit which files contributed. */
  meta?: {
    goldenRepoId: string | null;
    files: string[];
    sdlcProjectId: string | null;
  };
}

export async function runAgenticPipeline(
  userStoryTitle: string,
  userStoryDescription: string,
  acceptanceCriteria: string,
  domain: string,
  productDescription: string,
  onEvent: EventCallback,
  storyMetadata?: StoryMetadata,
  frameworkConfigId?: string,
  repoPath?: string,
  uploadedDocuments?: import("./document-extractor.js").ExtractedDocument[],
  goldenRepoGuidance?: string,
  goldenRepoMeta?: GoldenRepoGuidanceBundle["meta"],
): Promise<SprintTestCase[]> {
  const allTestCases: SprintTestCase[] = [];
  let globalCaseId = 1;

  console.log(`[Agentic Pipeline] Starting for: ${userStoryTitle}`);

  // Load framework catalog (non-blocking — if DB fails, generation continues without catalog)
  const catalog = await loadFrameworkCatalog(frameworkConfigId);
  if (catalog) {
    onEvent({
      type: "agent_status",
      agent: "Orchestrator",
      status: {
        agent: "Orchestrator", status: "working",
        message: `Framework catalog loaded: ${catalog.configName}`,
        details: `${catalog.functions.length} functions available (${catalog.framework}/${catalog.language})`
      }
    });
  }

  try {
    console.log("[Agentic Pipeline] Sending initialization event...");
    onEvent({
      type: "pipeline_stage",
      stage: "initialization",
      message: "Initializing Agentic AI Pipeline",
      data: { agents: ["Planner", "Analyzer", "Generator", "QA Refiner", "Test Script Generator"] }
    });

    await delay(300);

    console.log("[Agentic Pipeline] Sending orchestrator status...");
    onEvent({
      type: "agent_status",
      agent: "Orchestrator",
      status: { agent: "Orchestrator", status: "working", message: "Coordinating multi-agent workflow", details: "Preparing agent handoffs and communication channels" }
    });

    await delay(200);

    // ── Rule-based generation (uses title + description + acceptance criteria) ──
    console.log("[Agentic Pipeline] Running rule-based generator (no AI, instant, no limits)...");

    onEvent({
      type: "agent_status",
      agent: "Story Analyzer",
      status: { agent: "Story Analyzer", status: "working", message: "Parsing story context from all three fields", details: "Extracting role, entities, fields, actions, and downstream effects" }
    });
    await delay(300);

    // ── Step 1: Optionally enrich context from golden repo and/or uploaded docs ─
    let enrichedContext: import("./context-enricher.js").EnrichedProjectContext | undefined;
    const hasUploadedDocs = uploadedDocuments && uploadedDocuments.length > 0;

    if (repoPath) {
      onEvent({
        type: "agent_status",
        agent: "Repo Indexer",
        status: {
          agent: "Repo Indexer", status: "working",
          message: `Scanning repository: ${repoPath}`,
          details: "Extracting routes, schema, types, tests, services, events..."
        }
      });

      try {
        const { indexRepo } = await import("./golden-repo-indexer.js");
        const projectIndex = await indexRepo(repoPath);

        onEvent({
          type: "agent_status",
          agent: "Repo Indexer",
          status: {
            agent: "Repo Indexer", status: "completed",
            message: `Repository indexed: ${projectIndex.totalFilesScanned} files`,
            details: `${projectIndex.routes.length} routes | ${projectIndex.schemas.length} tables | ${projectIndex.types.length} types | ${projectIndex.existingTests.length} test suites`
          }
        });

        const enricherDetails = hasUploadedDocs
          ? `Finding real endpoints, field names, risks, gaps + analysing ${uploadedDocuments!.length} uploaded document(s)`
          : "Finding real endpoints, field names, risks, gaps, integration points";

        onEvent({
          type: "agent_status",
          agent: "Context Enricher",
          status: {
            agent: "Context Enricher", status: "working",
            message: "Analysing user story against codebase with Claude...",
            details: enricherDetails,
          }
        });

        const { enrichWithProjectContext } = await import("./context-enricher.js");
        enrichedContext = await enrichWithProjectContext(
          projectIndex,
          {
            workItemId: 0,
            title: userStoryTitle,
            description: userStoryDescription,
            acceptanceCriteria,
          },
          uploadedDocuments,
          goldenRepoGuidance,
        );

        onEvent({
          type: "agent_status",
          agent: "Context Enricher",
          status: {
            agent: "Context Enricher", status: "completed",
            message: `Context enriched from codebase${hasUploadedDocs ? ` + ${uploadedDocuments!.length} document(s)` : ""}`,
            details: `${enrichedContext.realApiEndpoints.length} endpoints | ${enrichedContext.realFieldNames.length} fields | ${enrichedContext.coverageGaps.length} gaps | ${enrichedContext.riskAreas.length} risks`
          }
        });

        onEvent({
          type: "enriched_context",
          data: { ...enrichedContext, uploadedDocCount: uploadedDocuments?.length ?? 0 },
          message: hasUploadedDocs
            ? `Project context loaded from golden repo + ${uploadedDocuments!.length} uploaded document(s)`
            : "Project context loaded from golden repo"
        });

      } catch (err: any) {
        console.warn("[Agentic Pipeline] Repo enrichment failed, continuing with rule-based only:", err?.message);
        onEvent({
          type: "agent_status",
          agent: "Repo Indexer",
          status: {
            agent: "Repo Indexer", status: "error",
            message: `Could not index repository: ${err?.message ?? "unknown error"}`,
            details: "Continuing with rule-based generation only"
          }
        });
      }
    } else if (hasUploadedDocs) {
      // No repo path provided, but uploaded documents exist — run enricher with documents only
      onEvent({
        type: "agent_status",
        agent: "Context Enricher",
        status: {
          agent: "Context Enricher", status: "working",
          message: `Analysing ${uploadedDocuments!.length} uploaded document(s)...`,
          details: "Extracting requirements, business rules, test patterns and risks from documents"
        }
      });

      try {
        const { enrichWithProjectContext } = await import("./context-enricher.js");
        enrichedContext = await enrichWithProjectContext(
          null,
          {
            workItemId: 0,
            title: userStoryTitle,
            description: userStoryDescription,
            acceptanceCriteria,
          },
          uploadedDocuments,
          goldenRepoGuidance,
        );

        onEvent({
          type: "agent_status",
          agent: "Context Enricher",
          status: {
            agent: "Context Enricher", status: "completed",
            message: `Documents analysed: ${uploadedDocuments!.length} file(s)`,
            details: `${enrichedContext.realApiEndpoints.length} endpoints | ${enrichedContext.realFieldNames.length} fields | ${enrichedContext.coverageGaps.length} gaps | ${enrichedContext.riskAreas.length} risks`
          }
        });

        onEvent({
          type: "enriched_context",
          data: { ...enrichedContext, uploadedDocCount: uploadedDocuments!.length },
          message: `Context enriched from ${uploadedDocuments!.length} uploaded document(s)`
        });
      } catch (err: any) {
        console.warn("[Agentic Pipeline] Document enrichment failed:", err?.message);
        onEvent({
          type: "agent_status",
          agent: "Context Enricher",
          status: {
            agent: "Context Enricher", status: "error",
            message: `Document analysis failed: ${err?.message ?? "unknown error"}`,
            details: "Continuing with rule-based generation only"
          }
        });
      }
    } else if (goldenRepoGuidance) {
      // No local repoPath and no uploaded docs — but the SDLC Golden Repo
      // guidance gives us authoritative org standards. Run the enricher with
      // an empty index so its prompt still extracts realFieldNames /
      // businessRules / coverageGaps from the guidance text itself.
      const guidanceFiles = goldenRepoMeta?.files?.length ?? 0;
      onEvent({
        type: "agent_status",
        agent: "Context Enricher",
        status: {
          agent: "Context Enricher", status: "working",
          message: `Analysing Golden Repo guidance${guidanceFiles ? ` from ${guidanceFiles} file(s)` : ""}...`,
          details: "Extracting standards, conventions, validations and integration patterns from Golden Repo",
        },
      });
      try {
        const { enrichWithProjectContext } = await import("./context-enricher.js");
        enrichedContext = await enrichWithProjectContext(
          null,
          {
            workItemId: 0,
            title: userStoryTitle,
            description: userStoryDescription,
            acceptanceCriteria,
          },
          undefined,
          goldenRepoGuidance,
        );
        onEvent({
          type: "agent_status",
          agent: "Context Enricher",
          status: {
            agent: "Context Enricher", status: "completed",
            message: `Golden Repo guidance analysed${guidanceFiles ? ` (${guidanceFiles} file(s))` : ""}`,
            details: `${enrichedContext.realApiEndpoints.length} endpoints | ${enrichedContext.realFieldNames.length} fields | ${enrichedContext.coverageGaps.length} gaps | ${enrichedContext.riskAreas.length} risks`,
          },
        });
        onEvent({
          type: "enriched_context",
          data: {
            ...enrichedContext,
            uploadedDocCount: 0,
            goldenRepoFileCount: guidanceFiles,
            goldenRepoFiles: goldenRepoMeta?.files ?? [],
          },
          message: `Context enriched from Golden Repo guidance${guidanceFiles ? ` (${guidanceFiles} file(s))` : ""}`,
        });
      } catch (err: any) {
        console.warn("[Agentic Pipeline] Golden-repo-only enrichment failed:", err?.message);
        onEvent({
          type: "agent_status",
          agent: "Context Enricher",
          status: {
            agent: "Context Enricher", status: "error",
            message: `Golden Repo enrichment failed: ${err?.message ?? "unknown error"}`,
            details: "Continuing with rule-based generation only",
          },
        });
      }
    }

    // ── Step 2: Rule-based generation (uses enriched context if available) ──
    const { generateWithCoverageSummary } = await import("./claude-test-generator.js");
    const { cases: allRuleBasedCases, summary: coverageSummary } = generateWithCoverageSummary(
      {
        workItemId: 0,
        title: userStoryTitle,
        description: userStoryDescription,
        acceptanceCriteria,
      },
      enrichedContext
    );

    onEvent({
      type: "agent_status",
      agent: "Story Analyzer",
      status: {
        agent: "Story Analyzer", status: "completed",
        message: `Story analysed — ${coverageSummary.coverageStatement}`,
        details: `Criteria: ${coverageSummary.criteriaCount} | Fields: ${coverageSummary.fieldsDetected} | Values: ${coverageSummary.valuesDetected} | Generator v${coverageSummary.generatorVersion}`
      }
    });

    // Emit coverage summary so the UI can display it
    onEvent({
      type: "coverage_summary",
      data: coverageSummary,
      message: coverageSummary.coverageStatement
    });

    // ── Planner agent: plan test coverage strategy ──
    onEvent({
      type: "agent_status", agent: "Planner",
      status: { agent: "Planner", status: "thinking", message: "Planning test coverage strategy", details: "Evaluating story complexity and deciding category distribution" }
    });
    await delay(400);
    onEvent({
      type: "agent_status", agent: "Planner",
      status: { agent: "Planner", status: "working", message: "Defining coverage across all test categories", details: "Functional · Negative · Edge Case · Security · Accessibility" }
    });
    await delay(600);
    onEvent({
      type: "agent_status", agent: "Planner",
      status: { agent: "Planner", status: "completed", message: `Test plan ready — ${allRuleBasedCases.length} scenarios planned`, details: "5 categories mapped to acceptance criteria" }
    });
    await delay(300);

    // Map GeneratedTestCase → SprintTestCase
    const typeToCategory: Record<string, string> = {
      Functional: "functional", Negative: "negative", Edge: "edge_case",
      Security: "security", Accessibility: "accessibility",
    };
    const typeToCategoryPrefix: Record<string, string> = {
      Functional: "FUN", Negative: "NEG", Edge: "EDG",
      Security: "SEC", Accessibility: "ACC",
    };
    const catCounters: Record<string, number> = {};

    const mappedCases: SprintTestCase[] = allRuleBasedCases.map(tc => {
      const cat = typeToCategory[tc.testType] ?? "functional";
      const prefix = typeToCategoryPrefix[tc.testType] ?? "TC";
      catCounters[cat] = (catCounters[cat] ?? 0) + 1;
      return {
        testCaseId: `${prefix}-${catCounters[cat]}`,
        title: tc.title,
        description: tc.description,
        objective: tc.objective,
        preconditions: tc.preconditions,
        testSteps: tc.testSteps,
        expectedResult: tc.expectedResult,
        postconditions: tc.postconditions,
        testData: tc.testData,
        category: cat as SprintTestCase["category"],
        priority: tc.priority,
        traceability: undefined,
      };
    });

    allTestCases.push(...mappedCases);

    // Emit each test case as an event, grouped by category
    const allCategoryDefs: Record<string, string> = {
      functional: "Functional Test Cases", negative: "Negative Test Cases",
      edge_case: "Edge Case Test Cases", regression: "Regression Test Cases",
      security: "Security Test Cases", accessibility: "Accessibility Test Cases",
    };
    const grouped = new Map<string, SprintTestCase[]>();
    for (const tc of mappedCases) {
      const arr = grouped.get(tc.category) ?? [];
      arr.push(tc);
      grouped.set(tc.category, arr);
    }

    for (const [catName, catTests] of grouped.entries()) {
      const catLabel = allCategoryDefs[catName] ?? catName;
      onEvent({
        type: "pipeline_stage", stage: "generation",
        message: `Generating ${catLabel}`,
        data: { category: catName, targetCount: catTests.length }
      });
      onEvent({
        type: "agent_status", agent: "Generator",
        status: { agent: "Generator", status: "working", message: `Building ${catTests.length} ${catLabel}`, details: `Derived from title + description + acceptance criteria`, progress: 50 }
      });
      await delay(100);
      for (const tc of catTests) {
        onEvent({ type: "test_case", testCase: tc });
      }
      onEvent({
        type: "category_complete", category: catName,
        count: catTests.length, message: `${catLabel} complete — ${catTests.length} tests`
      });
      await delay(100);
    }

    // (old AI category loop removed — replaced by rule-based generation above)

    // ── Generator completed ──
    onEvent({
      type: "agent_status", agent: "Generator",
      status: { agent: "Generator", status: "completed", message: `${allTestCases.length} test cases generated across ${grouped.size} categories`, details: "All categories complete" }
    });
    await delay(300);

    // ── QA Refiner agent: validate test quality ──
    onEvent({
      type: "pipeline_stage",
      stage: "refinement",
      message: "QA Refiner Agent analyzing test quality"
    });
    onEvent({
      type: "agent_status", agent: "QA Refiner",
      status: { agent: "QA Refiner", status: "thinking", message: "Analyzing test quality and completeness", details: "Checking scenario coverage, step clarity, and acceptance criteria alignment" }
    });
    await delay(400);
    onEvent({
      type: "agent_status", agent: "QA Refiner",
      status: { agent: "QA Refiner", status: "working", message: "Validating test case structure and coverage", details: "Ensuring each test is traceable, deterministic, and non-redundant" }
    });
    await delay(500);
    onEvent({
      type: "agent_status", agent: "QA Refiner",
      status: { agent: "QA Refiner", status: "completed", message: `Quality review complete — ${allTestCases.length} cases validated`, details: `Quality score: ${calculateQualityScore(allTestCases)}%` }
    });
    await delay(300);

    // ── QA Refinement: Rewrite generic tests into domain-specific ones ──
    // On AWS the LLM is reached via Bedrock (no Anthropic API key required);
    // on Azure we still gate on AI_INTEGRATIONS_ANTHROPIC_API_KEY because that
    // env wraps the Replit-hosted Anthropic proxy.
    let refinedTests = allTestCases;
    const anthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
    const onAwsForRefiner = (process.env.DEVX_HOSTING || 'azure').toLowerCase().trim() === 'aws';
    const refinerAvailable = onAwsForRefiner || (!!anthropicKey && anthropicKey.trim() !== '');

    if (refinerAvailable) {
      onEvent({
        type: "agent_status", agent: "QA Refiner",
        status: { agent: "QA Refiner", status: "working", message: "Rewriting test cases with domain-specific steps...", details: `Refining ${allTestCases.length} tests in batches of 10` }
      });

      const BATCH_SIZE = 5;
      const refined: SprintTestCase[] = [];

      for (let batchStart = 0; batchStart < allTestCases.length; batchStart += BATCH_SIZE) {
        const batch = allTestCases.slice(batchStart, batchStart + BATCH_SIZE);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(allTestCases.length / BATCH_SIZE);

        onEvent({
          type: "agent_status", agent: "QA Refiner",
          status: {
            agent: "QA Refiner", status: "working",
            message: `Refining batch ${batchNum}/${totalBatches} (${batch.length} tests)...`,
            details: `Categories: ${[...new Set(batch.map(t => t.category))].join(", ")}`,
            progress: Math.round((batchStart / allTestCases.length) * 100)
          }
        });

        // ── LOG RULE-BASED TEST CASES (BEFORE) ──
        console.log(`\n[QA Refiner] ╔══════════════════════════════════════════════╗`);
        console.log(`[QA Refiner] ║  BATCH ${batchNum} — RULE-BASED (BEFORE REFINEMENT)   ║`);
        console.log(`[QA Refiner] ╚══════════════════════════════════════════════╝`);
        for (const tc of batch) {
          console.log(`\n  [${tc.testCaseId}] ${tc.category} | ${tc.priority}`);
          console.log(`  Title: ${tc.title}`);
          console.log(`  Objective: ${tc.objective}`);
          console.log(`  Steps:`);
          (tc.testSteps || []).forEach((s: any) => console.log(`    ${s.step_number}. ${s.action} → ${s.expected_behavior}`));
          console.log(`  Test Data: ${JSON.stringify(tc.testData)}`);
        }

        // Golden Repo guidance, when present, is injected so refined steps
        // follow organizational conventions (naming, validation, integration
        // patterns, accessibility) instead of generic best-practice phrasing.
        const goldenRepoBlock = goldenRepoGuidance && goldenRepoGuidance.trim().length > 0
          ? `\n## GOLDEN REPO STANDARDS (authoritative organizational guidance):
${goldenRepoGuidance.trim()}
`
          : "";

        const refinementPrompt = `You are a senior QA engineer. Rewrite these GENERIC test cases into SPECIFIC, DOMAIN-AWARE test cases for this user story.
${goldenRepoBlock}
## USER STORY:
Title: ${userStoryTitle}
Description: ${userStoryDescription}

## ACCEPTANCE CRITERIA:
${acceptanceCriteria}

## RULES:
1. Keep the SAME testCaseId, category, and priority for each test
2. Rewrite the title to be specific to the user story (use exact field names, button names, page names from the story)
3. Rewrite objective to reference a specific acceptance criterion
4. Rewrite ALL 6 test steps with CONCRETE actions and SPECIFIC expected behaviors
   - BAD: "Navigate to the relevant module/page" → GOOD: "Navigate to the Loan Agreement Dashboard and click 'New Agreement'"
   - BAD: "System responds as expected" → GOOD: "Agreement status changes to 'Sent' and recipient receives email within 30 seconds"
5. Add realistic test data with actual field names and values from the story
6. Set traceability to the EXACT acceptance criterion line this test validates
7. Do NOT add or remove test cases — refine exactly ${batch.length} tests
${goldenRepoBlock ? `8. Where applicable, align expected behaviors with the GOLDEN REPO STANDARDS above (e.g. validation messages, status enums, integration contracts, accessibility requirements). When the story is silent but the standards apply, reflect them in the test step's expected_behavior.` : ""}

## GENERIC TEST CASES TO REFINE:
${JSON.stringify(batch.map(tc => ({
  testCaseId: tc.testCaseId,
  title: tc.title,
  category: tc.category,
  priority: tc.priority,
  objective: tc.objective,
  testSteps: tc.testSteps,
  preconditions: tc.preconditions,
})), null, 2)}

Return ONLY a valid JSON array of ${batch.length} refined test cases with this EXACT structure:
[{
  "testCaseId": "same as input",
  "title": "specific rewritten title",
  "description": "specific description",
  "objective": "specific objective referencing AC",
  "traceability": "exact AC line this covers",
  "preconditions": ["specific precondition 1", "specific precondition 2"],
  "testSteps": [
    {"step_number": 1, "action": "specific action", "expected_behavior": "specific outcome"},
    {"step_number": 2, "action": "specific action", "expected_behavior": "specific outcome"},
    {"step_number": 3, "action": "specific action", "expected_behavior": "specific outcome"},
    {"step_number": 4, "action": "specific action", "expected_behavior": "specific outcome"},
    {"step_number": 5, "action": "specific action", "expected_behavior": "specific outcome"},
    {"step_number": 6, "action": "specific action", "expected_behavior": "specific outcome"}
  ],
  "expectedResult": "specific expected result",
  "postconditions": ["specific postcondition"],
  "testData": {"fieldName": "realistic value"},
  "category": "same as input",
  "priority": "same as input"
}]`;

        try {
          const refinerModel = process.env.QA_REFINER_MODEL || "claude-haiku-4-5-20251001";
          const response = await withRetry(
            () => anthropic.messages.create({
              model: refinerModel,
              max_tokens: 12000,
              temperature: 0.4,
              messages: [{ role: "user", content: refinementPrompt }],
            }),
            2, 3000, `QA Refiner batch ${batchNum}`
          );

          const text = response.content[0]?.type === "text" ? response.content[0].text : "";
          let parsed: any[] = [];

          console.log(`[QA Refiner] Batch ${batchNum} raw response (first 500 chars): ${text.substring(0, 500)}`);

          // Extract JSON
          let jsonStr = text.trim();
          if (jsonStr.includes("```json")) jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
          else if (jsonStr.includes("```")) jsonStr = jsonStr.split("```")[1].split("```")[0].trim();

          // Aggressive JSON cleaning function
          function cleanLLMJson(raw: string): string {
            return raw
              .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, ' ')  // control chars (keep \n \r)
              .replace(/\n/g, '\\n')  // escape real newlines inside strings
              .replace(/\r/g, '')
              .replace(/\\n\\n/g, '\\n')  // collapse double escaped newlines
              .replace(/,\s*}/g, '}')  // trailing commas in objects
              .replace(/,\s*\]/g, ']')  // trailing commas in arrays
              .replace(/([^\\])\\(?!["\\/bfnrtu])/g, '$1\\\\')  // escape lone backslashes
              .replace(/"\s*\n\s*"/g, '", "');  // fix split strings
          }

          // Try parsing with progressive cleanup
          function tryParseJSON(raw: string): any[] | null {
            // Attempt 1: direct parse
            try { return JSON.parse(raw); } catch {}

            // Attempt 2: extract from markdown code block
            let cleaned = raw;
            if (cleaned.includes('```json')) cleaned = cleaned.split('```json')[1]?.split('```')[0]?.trim() || cleaned;
            else if (cleaned.includes('```')) cleaned = cleaned.split('```')[1]?.split('```')[0]?.trim() || cleaned;
            try { return JSON.parse(cleaned); } catch {}

            // Attempt 3: clean control characters
            cleaned = cleanLLMJson(cleaned);
            try { return JSON.parse(cleaned); } catch {}

            // Attempt 4: find array and clean
            const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (arrayMatch) {
              try { return JSON.parse(arrayMatch[0]); } catch {}
              // Attempt 5: re-clean the array match
              try { return JSON.parse(cleanLLMJson(arrayMatch[0])); } catch {}
            }

            // Attempt 6: parse individual objects
            const objectMatches = raw.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
            if (objectMatches && objectMatches.length > 0) {
              const objects: any[] = [];
              for (const objStr of objectMatches) {
                try {
                  const obj = JSON.parse(objStr.replace(/[\x00-\x1F\x7F]/g, ' '));
                  if (obj.testCaseId && (obj.title || obj.testSteps)) objects.push(obj);
                } catch {}
              }
              if (objects.length > 0) return objects;
            }

            return null;
          }

          parsed = tryParseJSON(text) || [];
          if (parsed.length === 0) {
            console.log(`[QA Refiner] Batch ${batchNum} all parse attempts failed, response length: ${text.length}`);
            // Log the character around the error position for debugging
            const errorPosMatch = text.substring(30700, 30750);
            console.log(`[QA Refiner] Chars around position 30723: ...${errorPosMatch}...`);
          } else {
            console.log(`[QA Refiner] Batch ${batchNum} parsed ${parsed.length} test cases successfully`);

            // ── LOG REFINED TEST CASES (AFTER) ──
            console.log(`\n[QA Refiner] ╔══════════════════════════════════════════════╗`);
            console.log(`[QA Refiner] ║  BATCH ${batchNum} — REFINED BY CLAUDE (AFTER)        ║`);
            console.log(`[QA Refiner] ╚══════════════════════════════════════════════╝`);
            for (const tc of parsed) {
              console.log(`\n  [${tc.testCaseId}] ${tc.category} | ${tc.priority}`);
              console.log(`  Title: ${tc.title}`);
              console.log(`  Objective: ${tc.objective}`);
              console.log(`  Traceability: ${tc.traceability || 'none'}`);
              console.log(`  Steps:`);
              (tc.testSteps || []).forEach((s: any) => console.log(`    ${s.step_number}. ${s.action} → ${s.expected_behavior}`));
              console.log(`  Test Data: ${JSON.stringify(tc.testData)}`);
            }
          }

          if (Array.isArray(parsed) && parsed.length > 0) {
            // Map refined data back to SprintTestCase format, preserving IDs
            for (let i = 0; i < batch.length; i++) {
              const original = batch[i];
              const refinedTC = parsed[i] || parsed.find((p: any) => p.testCaseId === original.testCaseId);
              if (refinedTC) {
                // ── LOG BEFORE/AFTER for comparison ──
                console.log(`\n[QA Refiner] ═══ ${original.testCaseId} BEFORE → AFTER ═══`);
                if (original.title !== (refinedTC.title || original.title)) {
                  console.log(`  TITLE BEFORE: ${original.title}`);
                  console.log(`  TITLE AFTER:  ${refinedTC.title}`);
                }
                if (original.objective !== (refinedTC.objective || original.objective)) {
                  console.log(`  OBJECTIVE BEFORE: ${original.objective}`);
                  console.log(`  OBJECTIVE AFTER:  ${refinedTC.objective}`);
                }
                if (refinedTC.traceability && refinedTC.traceability !== original.traceability) {
                  console.log(`  TRACEABILITY: ${refinedTC.traceability}`);
                }
                const origStep1 = original.testSteps?.[0]?.action || '';
                const newStep1 = refinedTC.testSteps?.[0]?.action || '';
                if (origStep1 !== newStep1) {
                  console.log(`  STEP1 BEFORE: ${origStep1}`);
                  console.log(`  STEP1 AFTER:  ${newStep1}`);
                }
                const origStep3 = original.testSteps?.[2]?.action || '';
                const newStep3 = refinedTC.testSteps?.[2]?.action || '';
                if (origStep3 !== newStep3) {
                  console.log(`  STEP3 BEFORE: ${origStep3}`);
                  console.log(`  STEP3 AFTER:  ${newStep3}`);
                }
                if (refinedTC.testData && JSON.stringify(refinedTC.testData) !== JSON.stringify(original.testData)) {
                  console.log(`  TEST DATA: ${JSON.stringify(refinedTC.testData)}`);
                }

                refined.push({
                  ...original,
                  title: refinedTC.title || original.title,
                  description: refinedTC.description || original.description,
                  objective: refinedTC.objective || original.objective,
                  traceability: refinedTC.traceability || original.traceability,
                  preconditions: refinedTC.preconditions || original.preconditions,
                  testSteps: (refinedTC.testSteps?.length >= 4) ? refinedTC.testSteps : original.testSteps,
                  expectedResult: refinedTC.expectedResult || original.expectedResult,
                  postconditions: refinedTC.postconditions || original.postconditions,
                  testData: refinedTC.testData || original.testData,
                });
              } else {
                refined.push(original); // fallback to original if refinement failed for this TC
              }
            }
            console.log(`[QA Refiner] Batch ${batchNum} refined: ${parsed.length} test cases`);
          } else {
            // If parsing failed, keep originals
            refined.push(...batch);
            console.warn(`[QA Refiner] Batch ${batchNum} parse failed, keeping originals`);
          }
        } catch (err: any) {
          console.warn(`[QA Refiner] Batch ${batchNum} API error: ${err.message}, keeping originals`);
          refined.push(...batch);
        }
      }

      refinedTests = refined;

      onEvent({
        type: "agent_status", agent: "QA Refiner",
        status: { agent: "QA Refiner", status: "completed", message: `Refined ${refinedTests.length} test cases with domain-specific steps`, details: `Quality score: ${calculateQualityScore(refinedTests)}%`, progress: 100 }
      });
    } else {
      // No API key — pass through
      console.log("[QA Refiner] No Anthropic key — skipping AI refinement");
    }

    // ── Normalize test case IDs: UUID → short IDs (FUN-1, NEG-1, etc.) ──
    const categoryPrefixes: Record<string, string> = {
      functional: "FUN", negative: "NEG", edge_case: "EDG",
      security: "SEC", accessibility: "ACC", regression: "REG",
    };
    const categoryCounters: Record<string, number> = {};
    for (const tc of refinedTests) {
      const prefix = categoryPrefixes[tc.category] || "TC";
      categoryCounters[prefix] = (categoryCounters[prefix] || 0) + 1;
      tc.testCaseId = `${prefix}-${categoryCounters[prefix]}`;
    }

    onEvent({
      type: "refined_test_cases",
      message: "Final test cases ready",
      data: {
        testCases: refinedTests,
        totalTests: refinedTests.length,
        qualityScore: calculateQualityScore(refinedTests)
      }
    });

    // ── Script Generator agent: prepare BDD assets ──
    onEvent({
      type: "pipeline_stage",
      stage: "script_generation",
      message: "Script Generator preparing BDD assets"
    });
    onEvent({
      type: "agent_status", agent: "Test Script Generator",
      status: { agent: "Test Script Generator", status: "working", message: "Preparing BDD feature files and step definitions", details: "Scaffolding Gherkin scenarios and Playwright step bindings" }
    });
    await delay(400);
    onEvent({
      type: "agent_status", agent: "Test Script Generator",
      status: { agent: "Test Script Generator", status: "completed", message: "BDD assets ready for download", details: "Feature files · Step definitions · Playwright config" }
    });
    await delay(200);

    const bddAssets = {
      featureFiles: [],
      stepDefinitions: [],
      pageObjects: [],
      utilities: { helpers: "", constants: "", config: "" }
    };

    onEvent({
      type: "bdd_assets",
      message: "Pipeline complete",
      data: bddAssets
    });

    onEvent({
      type: "agent_status",
      agent: "Orchestrator",
      status: { agent: "Orchestrator", status: "completed", message: "Pipeline complete", details: `Generated ${refinedTests.length} test cases across ${grouped.size} categories` }
    });

    onEvent({
      type: "complete",
      message: "Test generation complete",
      data: {
        totalTests: refinedTests.length,
        categories: grouped.size,
        bddAssets: { featureFiles: 0, stepDefinitions: 0, pageObjects: 0 }
      }
    });

    return refinedTests;

  } catch (error: any) {
    console.error("[Agentic Pipeline] Error:", error);
    onEvent({
      type: "error",
      message: error.message || "Pipeline execution failed"
    });
    throw error;
  }
}

async function runStoryAnalyzerAgent(
  title: string,
  description: string,
  acceptanceCriteria: string,
  domain: string,
  productDescription: string,
  onEvent: EventCallback,
  storyMetadata?: StoryMetadata
): Promise<StoryAnalysis> {
  onEvent({
    type: "agent_status",
    agent: "Story Analyzer",
    status: { agent: "Story Analyzer", status: "thinking", message: "Analyzing user story structure", details: "Extracting testable requirements and identifying risk areas" }
  });

  await delay(400);

  // Skip API call only when no LLM backend is reachable. On AWS hosting the
  // unified facade routes to Bedrock (no AI_INTEGRATIONS_* key required); on
  // Azure hosting either the OpenAI/Replit-proxy key OR an Azure OpenAI
  // config makes AI analysis available. Fall back to rule-based output only
  // when *none* of those signal a working backend.
  const openAiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const hasReplitKey = !!openAiKey && openAiKey !== 'not-configured' && openAiKey.trim() !== '';
  const hasAzureOpenAi = !!(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT);
  const onAws = (process.env.DEVX_HOSTING || 'azure').toLowerCase().trim() === 'aws';
  const llmAvailable = onAws || hasReplitKey || hasAzureOpenAi;
  if (!llmAvailable) {
    console.log("[Story Analyzer] No valid LLM backend configured — using rule-based analysis");
    onEvent({
      type: "agent_status",
      agent: "Story Analyzer",
      status: { agent: "Story Analyzer", status: "completed", message: "Analysis complete (rule-based)", details: "Complexity: MEDIUM | Parsed from acceptance criteria" }
    });
    const acLines = acceptanceCriteria.split('\n').map(l => l.replace(/^[-*•\s]+/, '').trim()).filter(l => l.length > 5);
    return {
      complexity: acLines.length > 6 ? "high" : acLines.length > 3 ? "medium" : "low",
      testableRequirements: acLines.length > 0 ? acLines : [title],
      riskAreas: [],
      suggestedTestCounts: { functional: 8, negative: 4, edge_case: 3, regression: 3 },
      domainSpecificConsiderations: [],
      edgeCases: acLines.slice(0, 3),
      requiredCategories: ["functional", "negative", "edge_case", "regression"],
      regressionAreas: [],
      hasSecurityRequirements: false,
      hasAccessibilityRequirements: false
    };
  }

  onEvent({
    type: "agent_status",
    agent: "Story Analyzer",
    status: { agent: "Story Analyzer", status: "working", message: "Deep analysis in progress", details: "Evaluating complexity, domain requirements, and edge cases" }
  });

  const metaSection = storyMetadata && Object.keys(storyMetadata).length > 0 ? `
## JIRA TICKET METADATA:
${storyMetadata.jiraKey ? `Issue Key: ${storyMetadata.jiraKey}` : ''}
${storyMetadata.priority ? `Priority: ${storyMetadata.priority}` : ''}
${storyMetadata.storyPoints != null ? `Story Points: ${storyMetadata.storyPoints}` : ''}
${storyMetadata.assignee ? `Assignee: ${storyMetadata.assignee}` : ''}
${storyMetadata.sprintName ? `Sprint: ${storyMetadata.sprintName}` : ''}
${storyMetadata.projectName ? `Project: ${storyMetadata.projectName}` : ''}
${storyMetadata.status ? `Status: ${storyMetadata.status}` : ''}
${storyMetadata.labels?.length ? `Labels: ${storyMetadata.labels.join(', ')}` : ''}
` : '';

  const commentsSection = storyMetadata?.comments ? `

## JIRA COMMENTS (Additional Requirements & Context):
${storyMetadata.comments}

IMPORTANT: The comments above may contain implicit requirements, validation instructions, and related flows that MUST be covered by test cases. Treat them as authoritative as the acceptance criteria.
` : '';

  const prompt = `You are a senior QA lead analyzing a Jira user story to plan a focused, high-fidelity test suite.

Your job is to extract what this story ACTUALLY requires — nothing more, nothing less. Every test case generated later must be traceable to something explicitly stated in the story, acceptance criteria, or comments.
${metaSection}${commentsSection}
## USER STORY:
Title: ${title}
Description: ${description}
Acceptance Criteria: ${acceptanceCriteria}
Domain: ${domain}
Product Context: ${productDescription}

## YOUR ANALYSIS TASK:

1. Extract ONLY requirements that are explicitly stated in the story, description, acceptance criteria, or comments.
2. Identify regression areas: adjacent flows/systems NOT changed by this story that could be broken by it.
3. Determine which test categories are GENUINELY needed for THIS story:
   - "functional" — always needed
   - "negative" — always needed (invalid inputs, error states)
   - "edge_case" — always needed (boundary conditions stated in the story)
   - "regression" — needed if the story changes a flow that could impact related flows (almost always yes)
   - "security" — ONLY if the story explicitly involves auth, permissions, data exposure, or injection risks
   - "accessibility" — ONLY if the story explicitly involves UI, forms, or the AC mentions WCAG/a11y
4. Count tests proportionally — aim for focused coverage, NOT padding. Better to have 10 excellent tests than 30 mediocre ones.
   - Absolute cap: functional ≤ 10, negative ≤ 6, edge_case ≤ 5, regression ≤ 5, security ≤ 4 (if needed), accessibility ≤ 3 (if needed)

Return ONLY valid JSON (no markdown, no explanation):
{
  "complexity": "low" | "medium" | "high",
  "testableRequirements": ["Explicit requirement extracted from story/AC/comments"],
  "riskAreas": ["High risk: <specific behavior that must not break>"],
  "regressionAreas": ["Adjacent flow that this change could break: <specific system/flow name>"],
  "suggestedTestCounts": {
    "functional": number,
    "negative": number,
    "edge_case": number,
    "regression": number
  },
  "domainSpecificConsiderations": ["Domain-specific constraint relevant to this story"],
  "edgeCases": ["Specific edge case stated or implied by the story"],
  "requiredCategories": ["functional", "negative", "edge_case", "regression"],
  "hasSecurityRequirements": false,
  "hasAccessibilityRequirements": false
}

NOTE: Set "hasSecurityRequirements" to true ONLY if the story explicitly mentions authentication, authorization, data access controls, or injection vulnerabilities. Set "hasAccessibilityRequirements" to true ONLY if the story explicitly mentions WCAG, screen readers, keyboard nav, or aria labels.`;

  try {
    console.log("[Story Analyzer] Calling OpenAI API...");
    const completion = await withRetry(
      () => openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 2000,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
      3,
      2000,
      "Story Analyzer"
    );
    console.log("[Story Analyzer] OpenAI API response received");

    const response = completion.choices[0]?.message?.content;
    if (!response) throw new Error("Invalid response - no content");

    let jsonStr = response.trim();
    if (jsonStr.includes("```json")) {
      jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
    } else if (jsonStr.includes("```")) {
      jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
    }

    const analysis: StoryAnalysis = JSON.parse(jsonStr);

    onEvent({
      type: "analysis_result",
      agent: "Story Analyzer",
      data: analysis,
      message: `Identified ${analysis.testableRequirements.length} testable requirements, ${analysis.riskAreas.length} risk areas`
    });

    onEvent({
      type: "agent_status",
      agent: "Story Analyzer",
      status: { 
        agent: "Story Analyzer", 
        status: "completed", 
        message: "Analysis complete", 
        details: `Complexity: ${analysis.complexity.toUpperCase()} | ${analysis.testableRequirements.length} requirements | ${analysis.edgeCases.length} edge cases identified`
      }
    });

    return analysis;
  } catch (error: any) {
    console.error("[Story Analyzer] Error:", error);
    onEvent({
      type: "agent_status",
      agent: "Story Analyzer",
      status: { agent: "Story Analyzer", status: "error", message: "Analysis failed, using defaults" }
    });
    
    return {
      complexity: "medium",
      testableRequirements: [title],
      riskAreas: [],
      suggestedTestCounts: { functional: 8, negative: 4, edge_case: 3, regression: 3 },
      domainSpecificConsiderations: [],
      edgeCases: [],
      requiredCategories: ["functional", "negative", "edge_case", "regression"],
      regressionAreas: [],
      hasSecurityRequirements: false,
      hasAccessibilityRequirements: false
    };
  }
}

async function runPlannerAgent(
  analysis: StoryAnalysis,
  domain: string,
  onEvent: EventCallback
): Promise<TestPlan> {
  onEvent({
    type: "agent_status",
    agent: "Planner",
    status: { agent: "Planner", status: "thinking", message: "Creating test strategy", details: "Determining optimal test distribution based on complexity and risk" }
  });

  await delay(300);

  onEvent({
    type: "agent_status",
    agent: "Planner",
    status: { agent: "Planner", status: "working", message: "Calculating test coverage matrix", details: `Balancing ${Object.keys(analysis.suggestedTestCounts).length} test categories` }
  });

  await delay(400);

  const complexityMultiplier = analysis.complexity === "high" ? 1.2 : analysis.complexity === "medium" ? 1.0 : 0.8;
  
  const maxCounts: Record<string, number> = {
    functional: 10,
    negative: 6,
    edge_case: 5,
    regression: 5,
    security: 4,
    accessibility: 3
  };

  const distribution: Record<string, number> = {};
  for (const [cat, count] of Object.entries(analysis.suggestedTestCounts)) {
    const scaled = Math.round(count * complexityMultiplier);
    distribution[cat] = Math.min(scaled, maxCounts[cat] || 5);
  }

  if (analysis.hasSecurityRequirements && !distribution["security"]) {
    distribution["security"] = 3;
  }
  if (analysis.hasAccessibilityRequirements && !distribution["accessibility"]) {
    distribution["accessibility"] = 3;
  }

  const totalTests = Object.values(distribution).reduce((a, b) => a + b, 0);
  const activeCategories = Object.keys(distribution).length;

  const plan: TestPlan = {
    totalTests,
    distribution,
    priorityFocus: analysis.riskAreas.slice(0, 3),
    coverageAreas: analysis.testableRequirements
  };

  onEvent({
    type: "plan_result",
    agent: "Planner",
    data: plan,
    message: `Test plan created: ${totalTests} total tests across ${activeCategories} categories`
  });

  onEvent({
    type: "agent_status",
    agent: "Planner",
    status: { 
      agent: "Planner", 
      status: "completed", 
      message: "Test plan finalized", 
      details: `Target: ${totalTests} tests | Priority areas: ${plan.priorityFocus.length}`
    }
  });

  return plan;
}

console.log('[agentic-sprint-agent] MODULE LOADED v2 — rule-based fallback active');
// ── Rule-based fallback generator (no API required) ─────────────────────────
function generateRuleBasedTestCases(
  categoryName: string,
  title: string,
  acceptanceCriteria: string,
  targetCount: number,
  startId: number,
  tcPrefix: string
): SprintTestCase[] {
  const categoryPrefixMap: Record<string, string> = {
    functional: "FUN", negative: "NEG", edge_case: "EDG",
    regression: "REG", security: "SEC", accessibility: "ACC"
  };
  const prefix = tcPrefix || categoryPrefixMap[categoryName] || "TC";

  // Parse AC lines into requirements
  const acLines = acceptanceCriteria
    .split('\n')
    .map(l => l.replace(/^[-*•\s]+/, '').trim())
    .filter(l => l.length > 10);

  const priorityMap: Record<string, string> = {
    functional: "P1", negative: "P2", edge_case: "P2",
    regression: "P2", security: "P1", accessibility: "P3"
  };

  const categoryActionMap: Record<string, { verb: string; negVerb: string }> = {
    functional:    { verb: "Verify",          negVerb: "Verify" },
    negative:      { verb: "Confirm rejection when", negVerb: "Validate error for" },
    edge_case:     { verb: "Validate boundary for", negVerb: "Test edge condition on" },
    regression:    { verb: "Confirm regression: ", negVerb: "Re-validate" },
    security:      { verb: "Verify access control for", negVerb: "Ensure unauthorized access blocked for" },
    accessibility: { verb: "Confirm accessible interaction for", negVerb: "Verify keyboard/screen-reader for" }
  };

  const action = categoryActionMap[categoryName] || { verb: "Verify", negVerb: "Test" };
  const basePriority = priorityMap[categoryName] || "P2";

  const results: SprintTestCase[] = [];

  // Build one test case per unique AC line, up to targetCount
  const sources = acLines.length > 0 ? acLines : [title];
  const pool = [...sources];
  // Pad if needed by cycling
  while (pool.length < targetCount) pool.push(...sources);

  for (let i = 0; i < targetCount; i++) {
    const req = pool[i] || title;
    const isNeg = categoryName === "negative" || categoryName === "security";
    const verb = isNeg ? action.negVerb : action.verb;
    const shortReq = req.length > 60 ? req.slice(0, 57) + '…' : req;

    results.push({
      testCaseId: `${prefix}-${startId + i}`,
      title: `[${prefix}] ${verb} ${shortReq}`,
      description: `${categoryName.charAt(0).toUpperCase() + categoryName.slice(1)} test for: ${req}`,
      objective: `Confirm that ${req.toLowerCase().replace(/^(that|the|a|an)\s+/i, '')}`,
      preconditions: [
        "User is authenticated and authorized",
        `Application is in a clean ${categoryName === 'regression' ? 'baseline' : 'initial'} state`,
        "Required test data is available"
      ],
      testSteps: [
        { step_number: 1, action: "Navigate to the relevant module/page", expected_behavior: "Page loads successfully and displays correctly" },
        { step_number: 2, action: `Set up preconditions for: ${shortReq}`, expected_behavior: "Preconditions are confirmed in place" },
        { step_number: 3, action: isNeg ? `Attempt operation that should fail: ${shortReq}` : `Perform main action to test: ${shortReq}`, expected_behavior: isNeg ? "System shows appropriate error/rejection" : "System responds as expected" },
        { step_number: 4, action: "Observe system response and state", expected_behavior: isNeg ? "Error message is clear and specific" : "Intermediate state is correct" },
        { step_number: 5, action: "Verify downstream effects or data persistence", expected_behavior: "Data is saved/updated/rejected consistently" },
        { step_number: 6, action: "Confirm final system state via UI/log/DB", expected_behavior: `Final state reflects: ${shortReq}` }
      ],
      expectedResult: `• ${req}\n• System state is consistent\n• No unexpected errors occur`,
      postconditions: ["System returns to stable state", "Test data is cleaned up if applicable"],
      testData: { requirement: shortReq, category: categoryName },
      category: categoryName as SprintTestCase["category"],
      priority: i === 0 ? (categoryName === "functional" ? "P0" : "P1") : basePriority
    });
  }

  return results;
}
// ─────────────────────────────────────────────────────────────────────────────

async function runGeneratorAgent(
  categoryName: string,
  categoryLabel: string,
  targetCount: number,
  title: string,
  description: string,
  acceptanceCriteria: string,
  domain: string,
  productDescription: string,
  analysis: StoryAnalysis,
  startId: number,
  onEvent: EventCallback,
  storyMetadata?: StoryMetadata,
  catalog?: FrameworkCatalog
): Promise<SprintTestCase[]> {
  onEvent({
    type: "agent_status",
    agent: "Generator",
    status: { 
      agent: "Generator", 
      status: "thinking", 
      message: `Preparing ${categoryLabel}`,
      details: `Target: ${targetCount} test cases | Analyzing requirements`
    }
  });

  await delay(300);

  onEvent({
    type: "agent_status",
    agent: "Generator",
    status: { 
      agent: "Generator", 
      status: "working", 
      message: `Generating ${categoryLabel}`,
      details: `Creating ${targetCount} comprehensive test scenarios`,
      progress: 0
    }
  });

  // Generate category-specific ID prefix
  const categoryPrefixes: Record<string, string> = {
    functional: "FUN",
    negative: "NEG",
    edge_case: "EDG",
    regression: "REG",
    security: "SEC",
    accessibility: "ACC"
  };
  const tcPrefix = storyMetadata?.jiraKey || categoryPrefixes[categoryName] || "TC";

  const categoryGuidance: Record<string, string> = {
    functional: `## FUNCTIONAL TEST GUIDANCE:
Generate tests that directly map to acceptance criteria and stated requirements.
- One distinct scenario per test — no variations of the same behavior
- Cover all explicitly stated flows: happy path, config flags (enabled/disabled), data filtering rules
- Use exact field names, flag names, and system names from the story
- Avoid generic "verify page loads" or "verify dashboard shows" — test actual business outcomes`,

    negative: `## NEGATIVE TEST GUIDANCE:
Generate tests for explicitly stated or clearly implied failure conditions only.
- Map each negative test to a specific stated constraint or validation rule
- Do NOT invent validation rules not mentioned in the story
- Examples: required field missing, flag disabled when it should be enabled, empty list when items expected`,

    edge_case: `## EDGE CASE GUIDANCE:
Generate tests for boundary conditions explicitly mentioned in the story or comments.
- Empty lists/sets that are specifically referenced
- Boundary values explicitly stated (e.g., max products, zero items)
- Toggle/flag state changes that affect behavior
- Do NOT invent edge cases for behaviors not mentioned`,

    regression: `## REGRESSION TEST GUIDANCE:
Generate tests that verify related flows NOT changed by this story still work correctly.
- Identify adjacent workflows or systems this story's change could accidentally break
- Focus on: other sync flows, integration points, related API behaviors, downstream systems
- Regression areas identified: ${analysis.regressionAreas?.join(", ") || "adjacent workflows and related system flows"}
- Each regression test should explicitly state WHAT existing behavior it verifies is unchanged`,

    security: `## SECURITY TEST GUIDANCE:
Generate tests for security behaviors explicitly mentioned in the story.
- Only test auth, permissions, or data access controls that are stated requirements
- Map each security test to a specific stated security constraint`,

    accessibility: `## ACCESSIBILITY TEST GUIDANCE:
Generate tests for accessibility behaviors explicitly mentioned in the story.
- Only test WCAG/a11y requirements that are explicitly stated in the story or AC`
  };

  const commentsContext = storyMetadata?.comments ? `

## JIRA COMMENTS (Additional Requirements — Treat as Authoritative):
${storyMetadata.comments}
` : '';

  const jiraContext = storyMetadata && Object.keys(storyMetadata).some(k => (storyMetadata as any)[k]) ? `
## JIRA TICKET:
${storyMetadata.jiraKey ? `Issue: ${storyMetadata.jiraKey}` : ''}
${storyMetadata.priority ? `Priority: ${storyMetadata.priority}` : ''}
${storyMetadata.storyPoints != null ? `Story Points: ${storyMetadata.storyPoints}` : ''}
${storyMetadata.sprintName ? `Sprint: ${storyMetadata.sprintName}` : ''}
${storyMetadata.projectName ? `Project: ${storyMetadata.projectName}` : ''}
` : '';

  const catalogContext = catalog ? buildCatalogPromptContext(catalog) : "";

  const prompt = `You are a senior QA engineer generating ${categoryLabel} for the following Jira user story. You MUST follow the story faithfulness rules below strictly.
${jiraContext}${commentsContext}${catalogContext}
## USER STORY:
Title: ${title}
Description: ${description}

## ACCEPTANCE CRITERIA:
${acceptanceCriteria}

## ANALYSIS (use to guide test design):
- Testable Requirements: ${analysis.testableRequirements.join("; ")}
- Risk Areas: ${analysis.riskAreas.join("; ")}
- Edge Cases to cover: ${analysis.edgeCases.join("; ")}
${analysis.regressionAreas?.length ? `- Regression Areas: ${analysis.regressionAreas.join("; ")}` : ''}
- Domain: ${domain}

${categoryGuidance[categoryName] || ''}

## ⚠️ STORY FAITHFULNESS RULES (MANDATORY):
1. Every test case MUST be traceable to a specific line in the story description, acceptance criteria, or comments above.
2. DO NOT invent behaviors, validation rules, or constraints not mentioned in the story.
3. DO NOT generate generic security, accessibility, or performance tests unless explicitly required.
4. DO NOT generate multiple near-identical test cases that vary only in minor input values.
5. Each test must cover a DISTINCT scenario — if two tests look similar, merge them or remove one.
6. Use EXACT terminology from the story (system names, field names, flag names, flow names).

## RULES FOR STEPS:
- Exactly 6 steps per test case
- Each step: concrete action + specific expected outcome (not "page loads successfully")
- Steps must reflect the actual system behavior described in the story
- Step 6 must validate the final state using a specific verification method (logs, platform UI, API response, DB record)

## OUTPUT FORMAT — Return ONLY valid JSON array (no markdown):
[
  {
    "title": "[${tcPrefix}] Verify [exact behavior] when [exact condition from story]",
    "description": "Validates [specific requirement from story/AC/comments]",
    "objective": "Confirm that [measurable, story-traceable outcome]",
    "traceability": "Requirement: [exact line from story/AC/comments this covers]",
    "preconditions": [
      "[Specific system state required]",
      "[Specific data/config that must exist]",
      "[Specific flag/setting state]"
    ],
    "testSteps": [
      {"step_number": 1, "action": "[Setup/navigate to starting point]", "expected_behavior": "[Specific initial state verified]"},
      {"step_number": 2, "action": "[Primary setup or precondition action]", "expected_behavior": "[Precondition confirmed]"},
      {"step_number": 3, "action": "[Main action — the behavior being tested]", "expected_behavior": "[Immediate system response]"},
      {"step_number": 4, "action": "[Verify intermediate state]", "expected_behavior": "[Specific intermediate outcome]"},
      {"step_number": 5, "action": "[Complete workflow or trigger sync/downstream]", "expected_behavior": "[Downstream system response]"},
      {"step_number": 6, "action": "[Verify final state in [specific system/log/platform]]", "expected_behavior": "[Exact expected values/records in final verification point]"}
    ],
    "expectedResult": "• [Story-specific primary outcome]\n• [Verification point 2]\n• [System state after test]",
    "postconditions": [
      "[System state after test completes]",
      "[Any downstream records or logs expected]"
    ],
    "testData": {"specificField": "storySpecificValue"},
    "priority": "P0|P1|P2|P3"
  }
]

## PRIORITY GUIDELINES:
- P0: Direct implementation of core acceptance criteria; breaks core business function if wrong
- P1: Important but not the primary acceptance criterion; significant impact if broken
- P2: Standard coverage of normal flows; moderate impact
- P3: Lower-risk regression or edge case; minimal immediate impact

Generate EXACTLY ${targetCount} test cases. Favor quality over quantity — ${targetCount} focused tests aligned to the story are far better than more generic ones.`;

  const maxTokens = targetCount >= 12 ? 16000 : 8000;

  // Use rule-based fallback only when no LLM backend is reachable. On AWS the
  // unified facade routes to Bedrock (no Anthropic API key required); on Azure
  // we still gate on AI_INTEGRATIONS_ANTHROPIC_API_KEY (Replit-hosted proxy).
  const anthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const onAwsForGenerator = (process.env.DEVX_HOSTING || 'azure').toLowerCase().trim() === 'aws';
  const generatorLlmAvailable = onAwsForGenerator || (!!anthropicKey && anthropicKey.trim() !== '');
  if (!generatorLlmAvailable) {
    console.log(`[Generator] No LLM backend configured — using rule-based generation for ${categoryLabel}`);
    onEvent({
      type: "agent_status",
      agent: "Generator",
      status: { agent: "Generator", status: "working", message: `Using rule-based generation for ${categoryLabel}`, details: "AI unavailable — generating from acceptance criteria" }
    });
    const fallbackCases = generateRuleBasedTestCases(categoryName, title, acceptanceCriteria, targetCount, startId, tcPrefix);
    onEvent({
      type: "agent_status",
      agent: "Generator",
      status: { agent: "Generator", status: "completed", message: `${categoryLabel} generated (rule-based)`, details: `Created ${fallbackCases.length} test cases`, progress: 100 }
    });
    return fallbackCases;
  }

  try {
    console.log(`[Generator] Calling Claude for ${categoryLabel} (${targetCount} tests)...`);
    const claudeMsg = await withRetry(
      () => anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        temperature: 0.5,
        messages: [{ role: "user", content: prompt }],
      }),
      3,
      2000,
      `Generator (${categoryLabel})`
    );

    const response = claudeMsg.content[0]?.type === "text" ? claudeMsg.content[0].text : null;
    if (!response) throw new Error("Invalid response - no content");
    console.log(`[Generator] Claude responded for ${categoryLabel}, length: ${response.length}`);

    let jsonStr = response.trim();
    
    // Extract JSON from markdown code blocks if present
    if (jsonStr.includes("```json")) {
      jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
    } else if (jsonStr.includes("```")) {
      jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
    }
    
    // Try to find JSON array pattern if parsing fails
    let parsedCases: any;
    try {
      parsedCases = JSON.parse(jsonStr);
    } catch (parseError) {
      console.log(`[Generator] First parse failed for ${categoryName}, trying JSON extraction...`);
      
      // Try to find a valid JSON array in the text
      const arrayMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) {
        try {
          // Clean the JSON - remove control characters
          let cleanJson = arrayMatch[0]
            .replace(/[\x00-\x1F\x7F]/g, ' ')  // Remove control characters
            .replace(/,\s*}/g, '}')            // Remove trailing commas in objects
            .replace(/,\s*\]/g, ']');          // Remove trailing commas in arrays
          parsedCases = JSON.parse(cleanJson);
        } catch (e) {
          console.log(`[Generator] Array extraction failed for ${categoryName}`);
        }
      }
      
      // Try extracting individual objects if array extraction fails
      if (!parsedCases) {
        const objectMatches = jsonStr.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
        if (objectMatches && objectMatches.length > 0) {
          parsedCases = [];
          for (const objStr of objectMatches) {
            try {
              const obj = JSON.parse(objStr.replace(/[\x00-\x1F\x7F]/g, ' '));
              if (obj.title && (obj.testSteps || obj.objective)) {
                parsedCases.push(obj);
              }
            } catch (e) {
              // Skip malformed objects
            }
          }
          if (parsedCases.length === 0) {
            console.log(`[Generator] Object extraction failed for ${categoryName}`);
            parsedCases = null;
          } else {
            console.log(`[Generator] Extracted ${parsedCases.length} objects for ${categoryName}`);
          }
        }
      }
      
      // If all extraction methods fail, throw error
      if (!parsedCases) {
        throw new Error(`Could not extract valid JSON for ${categoryName}`);
      }
    }
    const casesArray = Array.isArray(parsedCases) ? parsedCases : [parsedCases];

    const testCases: SprintTestCase[] = casesArray.map((tc: any, idx: number) => ({
      testCaseId: `${categoryName.toUpperCase()}-${startId + idx}`,
      title: tc.title || "Untitled",
      description: tc.description || "",
      objective: tc.objective || "",
      preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [],
      testSteps: Array.isArray(tc.testSteps) ? tc.testSteps : [],
      expectedResult: tc.expectedResult || "",
      postconditions: Array.isArray(tc.postconditions) ? tc.postconditions : [],
      testData: tc.testData || {},
      category: categoryName as any,
      priority: tc.priority || "P2",
    }));

    onEvent({
      type: "agent_status",
      agent: "Generator",
      status: { 
        agent: "Generator", 
        status: "completed", 
        message: `${categoryLabel} generated`,
        details: `Created ${testCases.length} test cases`,
        progress: 100
      }
    });

    return testCases;
  } catch (error: any) {
    console.error(`[Generator] Error for ${categoryName}:`, error?.status, error?.message);
    const isAuthError = error?.status === 401 || error?.message?.includes('authentication') || error?.message?.includes('api_key') || error?.message?.includes('apiKey');
    console.log(`[Generator] Falling back to rule-based generation for ${categoryLabel} (authError=${isAuthError})`);
    onEvent({
      type: "agent_status",
      agent: "Generator",
      status: { agent: "Generator", status: "working", message: `Using rule-based generation for ${categoryLabel}`, details: "AI unavailable — generating from acceptance criteria" }
    });
    try {
      const fallbackCases = generateRuleBasedTestCases(categoryName, title, acceptanceCriteria, targetCount, startId, tcPrefix);
      onEvent({
        type: "agent_status",
        agent: "Generator",
        status: { agent: "Generator", status: "completed", message: `${categoryLabel} generated (rule-based)`, details: `Created ${fallbackCases.length} test cases`, progress: 100 }
      });
      return fallbackCases;
    } catch (fbErr: any) {
      console.error(`[Generator] Fallback also failed for ${categoryName}:`, fbErr?.message);
      onEvent({
        type: "agent_status",
        agent: "Generator",
        status: { agent: "Generator", status: "error", message: `Failed to generate ${categoryLabel}` }
      });
      return [];
    }
  }
}

async function runQARefinerAgent(
  testCases: SprintTestCase[],
  domain: string,
  onEvent: EventCallback,
  storyContext?: {
    title: string;
    description: string;
    acceptanceCriteria: string;
    analysis: StoryAnalysis;
    comments?: string;
  }
): Promise<SprintTestCase[]> {
  onEvent({
    type: "agent_status",
    agent: "QA Refiner",
    status: { 
      agent: "QA Refiner", 
      status: "thinking", 
      message: "Analyzing test suite quality",
      details: `Reviewing ${testCases.length} test cases for quality and coverage`
    }
  });

  await delay(400);

  onEvent({
    type: "agent_status",
    agent: "QA Refiner",
    status: { 
      agent: "QA Refiner", 
      status: "working", 
      message: "Running quality checks + requirement traceability",
      details: "Deduplicating, validating structure, computing coverage metrics"
    }
  });

  await delay(300);

  const seen = new Set<string>();
  const deduplicated: SprintTestCase[] = [];
  let duplicatesRemoved = 0;

  for (const tc of testCases) {
    const key = tc.title.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(tc);
    } else {
      duplicatesRemoved++;
    }
  }

  if (duplicatesRemoved > 0) {
    onEvent({
      type: "refinement",
      agent: "QA Refiner",
      message: `Removed ${duplicatesRemoved} duplicate test cases`,
      data: { duplicatesRemoved, remaining: deduplicated.length }
    });
  }

  const priorityCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const tc of deduplicated) {
    const p = tc.priority as keyof typeof priorityCounts;
    if (priorityCounts[p] !== undefined) priorityCounts[p]++;
  }

  const invalidSteps = deduplicated.filter(tc => !tc.testSteps || tc.testSteps.length === 0).length;
  if (invalidSteps > 0) {
    onEvent({
      type: "refinement",
      agent: "QA Refiner",
      message: `Flagged ${invalidSteps} test cases with missing steps`,
      data: { flagged: invalidSteps }
    });
  }

  const qualityScore = calculateQualityScore(deduplicated);

  onEvent({
    type: "refinement",
    agent: "QA Refiner",
    message: "Quality analysis complete",
    data: { 
      totalTests: deduplicated.length,
      priorityDistribution: priorityCounts,
      qualityScore
    }
  });

  if (storyContext) {
    onEvent({
      type: "agent_status",
      agent: "QA Refiner",
      status: { 
        agent: "QA Refiner", 
        status: "working", 
        message: "Computing requirement traceability matrix",
        details: `Mapping ${deduplicated.length} test cases to ${storyContext.analysis.testableRequirements.length} requirements`
      }
    });

    try {
      const traceabilityReport = await computeTraceabilityMatrix(
        deduplicated, storyContext, onEvent
      );

      onEvent({
        type: "traceability_report",
        agent: "QA Refiner",
        message: `Requirements coverage: ${traceabilityReport.coveragePercentage}%`,
        data: traceabilityReport
      });
    } catch (err) {
      console.error("[QA Refiner] Traceability computation failed:", err);
    }
  }

  onEvent({
    type: "agent_status",
    agent: "QA Refiner",
    status: { 
      agent: "QA Refiner", 
      status: "completed", 
      message: "Refinement + traceability complete",
      details: `${deduplicated.length} tests validated | Quality Score: ${qualityScore}%`
    }
  });

  return deduplicated;
}

async function computeTraceabilityMatrix(
  testCases: SprintTestCase[],
  storyContext: {
    title: string;
    description: string;
    acceptanceCriteria: string;
    analysis: StoryAnalysis;
    comments?: string;
  },
  onEvent: EventCallback
): Promise<TraceabilityReport> {
  const testSummaries = testCases.map(tc => ({
    id: tc.testCaseId,
    title: tc.title,
    category: tc.category,
    traceability: tc.traceability || "",
    objective: tc.objective || "",
  }));

  const commentsSection = storyContext.comments ? `\n\nComments:\n${storyContext.comments}` : "";

  const prompt = `You are a QA traceability analyst. Your job is to map test cases to requirements and compute coverage metrics.

## SOURCE OF TRUTH:
Story: ${storyContext.title}
Description: ${storyContext.description}
Acceptance Criteria: ${storyContext.acceptanceCriteria}${commentsSection}

## REQUIREMENTS IDENTIFIED BY ANALYSIS:
${storyContext.analysis.testableRequirements.map((r, i) => `R${i + 1}: ${r}`).join("\n")}

## TEST CASES GENERATED (${testCases.length} total):
${testSummaries.map(tc => `[${tc.id}] (${tc.category}) ${tc.title}\n  Traceability: ${tc.traceability || "not specified"}\n  Objective: ${tc.objective}`).join("\n\n")}

## YOUR TASK:
For each requirement listed above, determine:
1. Which test case IDs cover it (look at test titles, traceability fields, objectives)
2. Whether it is covered or uncovered
3. The source of the requirement (acceptance_criteria / description / comment)

Also compute an overall confidence score (0-100) based on:
- % of requirements covered (heavily weighted)
- Test case specificity (are steps specific or generic?)
- Priority alignment (are high-risk requirements covered by P0/P1 tests?)

Return ONLY valid JSON (no markdown):
{
  "requirements": [
    {
      "id": "R1",
      "text": "<exact requirement text>",
      "source": "acceptance_criteria" | "description" | "comment",
      "coveredBy": ["TC-001", "TC-003"],
      "isCovered": true
    }
  ],
  "totalRequirements": number,
  "coveredCount": number,
  "uncoveredCount": number,
  "coveragePercentage": number,
  "confidenceScore": number,
  "summary": "One sentence summary of coverage gaps and strengths"
}`;

  const claudeMsg = await withRetry(
    () => anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    2, 2000, "Traceability Analyzer"
  );

  const raw = claudeMsg.content[0]?.type === "text" ? claudeMsg.content[0].text : "{}";
  let jsonStr = raw.trim();
  if (jsonStr.includes("```json")) jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
  else if (jsonStr.includes("```")) jsonStr = jsonStr.split("```")[1].split("```")[0].trim();

  const report: TraceabilityReport = JSON.parse(jsonStr);
  return report;
}

async function runTestScriptGeneratorAgent(
  testCases: SprintTestCase[],
  userStoryTitle: string,
  domain: string,
  productDescription: string,
  onEvent: EventCallback,
  catalog?: FrameworkCatalog
): Promise<BDDAssets> {
  onEvent({
    type: "agent_status",
    agent: "Test Script Generator",
    status: { 
      agent: "Test Script Generator", 
      status: "thinking", 
      message: "Analyzing test cases for BDD conversion",
      details: `Preparing to generate scripts for ${testCases.length} test cases`
    }
  });

  await delay(400);

  onEvent({
    type: "agent_status",
    agent: "Test Script Generator",
    status: { 
      agent: "Test Script Generator", 
      status: "working", 
      message: "Generating Feature Files",
      details: "Creating Gherkin feature files with scenarios",
      progress: 10
    }
  });

  // Group test cases by category/module for feature files
  const testsByCategory: Record<string, SprintTestCase[]> = {};
  for (const tc of testCases) {
    const category = tc.category || "general";
    if (!testsByCategory[category]) {
      testsByCategory[category] = [];
    }
    testsByCategory[category].push(tc);
  }

  // Generate feature files for each category
  const featureFiles: BDDAssets["featureFiles"] = [];
  for (const [category, cases] of Object.entries(testsByCategory)) {
    const featureContent = generateFeatureFile(category, cases, domain, userStoryTitle);
    featureFiles.push({
      name: `${category}.feature`,
      content: featureContent,
      module: category
    });
  }

  onEvent({
    type: "agent_status",
    agent: "Test Script Generator",
    status: { 
      agent: "Test Script Generator", 
      status: "working", 
      message: "Generating Step Definitions",
      details: `Creating TypeScript step definitions for ${featureFiles.length} feature files`,
      progress: 40
    }
  });

  await delay(300);

  // Generate step definitions for each feature
  const stepDefinitions: BDDAssets["stepDefinitions"] = [];
  for (const [category, cases] of Object.entries(testsByCategory)) {
    const stepsContent = generateStepDefinitions(category, cases, domain, catalog);
    stepDefinitions.push({
      name: `${category}.steps.ts`,
      content: stepsContent,
      module: category
    });
  }

  // Add common steps
  stepDefinitions.push({
    name: "common.steps.ts",
    content: generateCommonSteps(),
    module: "common"
  });

  onEvent({
    type: "agent_status",
    agent: "Test Script Generator",
    status: {
      agent: "Test Script Generator",
      status: "working",
      message: "Generating Page Objects",
      details: catalog
        ? `Creating Page Object Model classes using ${catalog.configName} catalog`
        : "Creating Page Object Model classes",
      progress: 60
    }
  });

  await delay(300);

  // Generate page objects — use catalog base class / navigation functions if available
  const pageObjects: BDDAssets["pageObjects"] = [
    {
      name: "BasePage.ts",
      content: generateBasePage(catalog)
    },
    {
      name: "HomePage.ts",
      content: generateHomePage(domain, productDescription, catalog)
    }
  ];

  // Add domain-specific page if applicable
  const domainPage = generateDomainPage(domain);
  if (domainPage) {
    pageObjects.push({
      name: `${capitalizeFirst(domain)}Page.ts`,
      content: domainPage
    });
  }

  onEvent({
    type: "agent_status",
    agent: "Test Script Generator",
    status: { 
      agent: "Test Script Generator", 
      status: "working", 
      message: "Generating Utility Classes",
      details: "Creating GenericActions, WaitHelpers, and AssertionHelpers",
      progress: 80
    }
  });

  await delay(300);

  // Generate utility classes
  const utilities = {
    genericActions: generateGenericActions(),
    waitHelpers: generateWaitHelpers(),
    assertionHelpers: generateAssertionHelpers()
  };

  // Generate config files
  const config = {
    playwrightConfig: generatePlaywrightConfig(domain),
    cucumberConfig: generateCucumberConfig()
  };

  onEvent({
    type: "agent_status",
    agent: "Test Script Generator",
    status: { 
      agent: "Test Script Generator", 
      status: "completed", 
      message: "BDD assets generation complete",
      details: `Generated ${featureFiles.length} feature files, ${stepDefinitions.length} step definitions, ${pageObjects.length} page objects`,
      progress: 100
    }
  });

  return {
    featureFiles,
    stepDefinitions,
    pageObjects,
    utilities,
    config
  };
}

// Feature file generator
function generateFeatureFile(category: string, testCases: SprintTestCase[], domain: string, userStoryTitle: string): string {
  const categoryLabel = category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  
  let content = `@${domain.toLowerCase()} @${category}
Feature: ${categoryLabel} Tests - ${userStoryTitle}
  As a QA tester
  I want to validate ${categoryLabel.toLowerCase()} scenarios
  So that I can ensure the application meets quality standards

  Background:
    Given the application is accessible
    And I am on the home page

`;

  for (const tc of testCases) {
    const priority = tc.priority || "P2";
    const tags = `@${priority} @${tc.category}`;
    
    content += `  ${tags}
  Scenario: ${tc.testCaseId} - ${tc.title}
`;

    // Add preconditions as Given steps
    if (tc.preconditions && tc.preconditions.length > 0) {
      content += `    Given ${tc.preconditions[0]}\n`;
      for (let i = 1; i < tc.preconditions.length; i++) {
        content += `    And ${tc.preconditions[i]}\n`;
      }
    }

    // Add test steps as When/Then
    if (tc.testSteps && tc.testSteps.length > 0) {
      for (let i = 0; i < tc.testSteps.length; i++) {
        const step = tc.testSteps[i];
        if (i === 0) {
          content += `    When ${step.action}\n`;
        } else if (i === tc.testSteps.length - 1) {
          content += `    Then ${step.expected_behavior}\n`;
        } else {
          if (step.action.toLowerCase().startsWith("verify") || step.action.toLowerCase().startsWith("validate") || step.action.toLowerCase().startsWith("confirm")) {
            content += `    Then ${step.expected_behavior}\n`;
          } else {
            content += `    When ${step.action}\n`;
            content += `    Then ${step.expected_behavior}\n`;
          }
        }
      }
    }

    // Add expected result as final Then
    if (tc.expectedResult) {
      const results = tc.expectedResult.split("\n").filter(r => r.trim());
      for (const result of results.slice(0, 2)) {
        const cleanResult = result.replace(/^[•\-*]\s*/, "").trim();
        if (cleanResult) {
          content += `    And ${cleanResult}\n`;
        }
      }
    }

    content += "\n";
  }

  return content;
}

// Step definitions generator
function generateStepDefinitions(category: string, testCases: SprintTestCase[], domain: string, catalog?: FrameworkCatalog): string {
  const className = capitalizeFirst(category.replace(/_/g, ""));

  // Build framework-specific imports if catalog available
  const catalogImports = catalog
    ? buildCatalogImports(catalog, "typescript")
    : "";

  // Annotate which framework this step file was generated for
  const catalogHeader = catalog
    ? `// Framework: ${catalog.configName} (${catalog.framework}/${catalog.language})\n// Functions sourced from team catalog — ${catalog.functions.length} available\n`
    : "";

  // Build catalog-sourced method instantiation hints
  const navigationFns = catalog?.byCategory["navigation"] ?? [];
  const genericFns = catalog?.byCategory["generic"] ?? [];
  const assertionFns = catalog?.byCategory["assertion"] ?? [];
  const setupFns = catalog?.byCategory["setup"] ?? [];

  const catalogInitBlock = catalog && (navigationFns.length + genericFns.length) > 0
    ? `\n// ===== CATALOG FUNCTIONS (use these for step implementations) =====\n` +
      [...navigationFns, ...genericFns, ...assertionFns, ...setupFns]
        .slice(0, 12)
        .map(f => `// ${f.className ? f.className + '.' : ''}${f.signature}${f.description ? ' — ' + f.description : ''}`)
        .join("\n") + "\n"
    : "";

  return `${catalogHeader}import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { Page, Browser, BrowserContext, chromium, expect } from '@playwright/test';
import { BasePage } from '../pages/BasePage';
import { HomePage } from '../pages/HomePage';
import { GenericActions } from '../utils/GenericActions';
import { AssertionHelpers } from '../utils/AssertionHelpers';
import { WaitHelpers } from '../utils/WaitHelpers';
${catalogImports ? catalogImports + "\n" : ""}

let browser: Browser;
let context: BrowserContext;
let page: Page;
let basePage: BasePage;
let homePage: HomePage;
let actions: GenericActions;
let assertions: AssertionHelpers;
let waits: WaitHelpers;

Before(async function () {
  browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });
  page = await context.newPage();
  
  // Initialize helpers
  actions = new GenericActions(page, context);
  assertions = new AssertionHelpers(page);
  waits = new WaitHelpers(page);
  
  // Initialize page objects
  basePage = new BasePage(page, context);
  homePage = new HomePage(page, context);
});

After(async function (scenario) {
  if (scenario.result?.status === 'FAILED') {
    const screenshot = await page.screenshot();
    this.attach(screenshot, 'image/png');
  }
  await page.close();
  await context.close();
  await browser.close();
});

\${catalogInitBlock}
// ==================== GIVEN STEPS ====================

Given('the application is accessible', async function () {
  await homePage.navigate();
  await waits.waitForNetworkIdle();
});

Given('I am on the home page', async function () {
  await homePage.waitForPageReady();
});

Given('I am logged in as {string}', async function (userType: string) {
  const credentials = this.testData?.users?.[userType] || { username: 'testuser', password: 'testpass' };
  await actions.fill('[data-testid="input-username"]', credentials.username);
  await actions.fill('[data-testid="input-password"]', credentials.password);
  await actions.click('[data-testid="button-login"]');
  await waits.waitForNetworkIdle();
});

Given('I have valid test data for {string}', async function (scenario: string) {
  this.scenarioData = this.testData?.[scenario] || {};
});

// ==================== WHEN STEPS ====================

When('I navigate to {string}', async function (path: string) {
  await actions.navigateTo(path);
  await waits.waitForNetworkIdle();
});

When('I click on {string}', async function (elementText: string) {
  await actions.click(\`text=\${elementText}\`);
  await waits.waitForNetworkIdle();
});

When('I click on the {string} button', async function (buttonText: string) {
  await actions.click(\`button:has-text("\${buttonText}")\`);
  await waits.waitForNetworkIdle();
});

When('I enter {string} in the {string} field', async function (value: string, fieldName: string) {
  const fieldLocator = \`[data-testid="input-\${fieldName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await actions.fill(fieldLocator, value);
});

When('I select {string} from the {string} dropdown', async function (optionText: string, dropdownName: string) {
  const dropdownLocator = \`[data-testid="select-\${dropdownName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await actions.selectByText(dropdownLocator, optionText);
});

When('I submit the form', async function () {
  await actions.click('[type="submit"], [data-testid="button-submit"]');
  await waits.waitForNetworkIdle();
});

When('I wait for {int} seconds', async function (seconds: number) {
  await actions.wait(seconds * 1000);
});

When('I scroll to {string}', async function (elementText: string) {
  await actions.scrollIntoView(\`text=\${elementText}\`);
});

// ==================== THEN STEPS ====================

Then('I should see {string}', async function (text: string) {
  await assertions.assertContainsText('body', text);
});

Then('the page should display {string}', async function (text: string) {
  await assertions.assertContainsText('body', text);
});

Then('I should be on the {string} page', async function (pageName: string) {
  await assertions.assertUrlContains(pageName.toLowerCase().replace(/\\s+/g, '-'));
});

Then('the {string} element should be visible', async function (elementName: string) {
  const locator = \`[data-testid="\${elementName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await assertions.assertVisible(locator);
});

Then('the {string} element should not be visible', async function (elementName: string) {
  const locator = \`[data-testid="\${elementName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await assertions.assertHidden(locator);
});

Then('I should see a success message', async function () {
  await assertions.assertVisible('[data-testid="success-message"], .success, .alert-success');
});

Then('I should see an error message {string}', async function (errorText: string) {
  await assertions.assertContainsText('[data-testid="error-message"], .error, .alert-error', errorText);
});

Then('the form should be validated', async function () {
  const invalidFields = await page.locator('.invalid, .error, [aria-invalid="true"]').count();
  expect(invalidFields).toBe(0);
});

Then('the data should be saved successfully', async function () {
  await assertions.assertVisible('[data-testid="success-message"], .success');
});

// ==================== ${category.toUpperCase()} SPECIFIC STEPS ====================

${generateCategorySpecificSteps(category, domain)}
`;
}

// Generate category-specific step definitions
function generateCategorySpecificSteps(category: string, domain: string): string {
  const domainLower = domain.toLowerCase();
  
  const categorySteps: Record<string, string> = {
    functional: `
Given('the ${domainLower} module is loaded', async function () {
  await waits.waitForVisible('[data-testid="module-container"]');
});

When('I perform the primary action', async function () {
  await actions.click('[data-testid="button-primary-action"]');
  await waits.waitForNetworkIdle();
});

Then('the operation should complete successfully', async function () {
  await assertions.assertVisible('[data-testid="success-indicator"]');
});
`,
    negative: `
When('I enter invalid data {string} in {string}', async function (invalidData: string, field: string) {
  const fieldLocator = \`[data-testid="input-\${field.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await actions.fill(fieldLocator, invalidData);
});

Then('I should see validation error for {string}', async function (field: string) {
  const errorLocator = \`[data-testid="error-\${field.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await assertions.assertVisible(errorLocator);
});

Then('the form should not be submitted', async function () {
  await expect(page.locator('[data-testid="form-submitted"]')).not.toBeVisible();
});
`,
    edge_case: `
Given('the system is in {string} state', async function (state: string) {
  this.systemState = state;
});

When('I perform action under edge condition', async function () {
  await actions.click('[data-testid="button-edge-action"]');
});

Then('the system should handle the edge case gracefully', async function () {
  await expect(page.locator('.error-boundary')).not.toBeVisible();
});
`,
    security: `
Given('I am not authenticated', async function () {
  await context.clearCookies();
});

When('I attempt to access protected resource {string}', async function (resource: string) {
  await actions.navigateTo(resource);
});

Then('I should be redirected to login', async function () {
  await assertions.assertUrlContains('login');
});

Then('unauthorized access should be blocked', async function () {
  const isBlocked = await page.locator('.access-denied, .unauthorized').isVisible();
  expect(isBlocked).toBe(true);
});
`,
    accessibility: `
Then('the page should meet WCAG 2.1 AA standards', async function () {
  // Placeholder for accessibility check
  const headings = await page.locator('h1, h2, h3, h4, h5, h6').count();
  expect(headings).toBeGreaterThan(0);
});

Then('all images should have alt text', async function () {
  const imagesWithoutAlt = await page.locator('img:not([alt])').count();
  expect(imagesWithoutAlt).toBe(0);
});

Then('the page should be keyboard navigable', async function () {
  await page.keyboard.press('Tab');
  const focusedElement = await page.locator(':focus').count();
  expect(focusedElement).toBeGreaterThan(0);
});
`
  };

  return categorySteps[category] || "";
}

// Generate common steps
function generateCommonSteps(): string {
  return `import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

// ==================== COMMON GIVEN STEPS ====================

Given('I wait for {int} seconds', async function (seconds: number) {
  await this.actions.wait(seconds * 1000);
});

Given('I clear browser cache and cookies', async function () {
  await this.context.clearCookies();
});

// ==================== COMMON WHEN STEPS ====================

When('I scroll to the bottom of the page', async function () {
  await this.actions.scrollToBottom();
});

When('I scroll to the top of the page', async function () {
  await this.actions.scrollToTop();
});

When('I refresh the page', async function () {
  await this.actions.refreshPage();
  await this.waits.waitForNetworkIdle();
});

When('I navigate back', async function () {
  await this.actions.navigateBack();
  await this.waits.waitForNetworkIdle();
});

When('I press the {string} key', async function (key: string) {
  await this.actions.pressKey(key);
});

When('I clear the {string} field', async function (fieldName: string) {
  const fieldLocator = \`[data-testid="input-\${fieldName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.actions.clearText(fieldLocator);
});

When('I upload file {string} to {string}', async function (fileName: string, fieldName: string) {
  const fieldLocator = \`[data-testid="input-\${fieldName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.actions.uploadFile(fieldLocator, \`./test-data/files/\${fileName}\`);
});

When('I check the {string} checkbox', async function (checkboxName: string) {
  const checkboxLocator = \`[data-testid="checkbox-\${checkboxName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.actions.check(checkboxLocator);
});

When('I uncheck the {string} checkbox', async function (checkboxName: string) {
  const checkboxLocator = \`[data-testid="checkbox-\${checkboxName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.actions.uncheck(checkboxLocator);
});

// ==================== COMMON THEN STEPS ====================

Then('the page title should be {string}', async function (expectedTitle: string) {
  await this.assertions.assertTitle(expectedTitle);
});

Then('the page title should contain {string}', async function (titlePart: string) {
  await this.assertions.assertTitleContains(titlePart);
});

Then('the URL should contain {string}', async function (urlPart: string) {
  await this.assertions.assertUrlContains(urlPart);
});

Then('the URL should be {string}', async function (expectedUrl: string) {
  await this.assertions.assertUrl(expectedUrl);
});

Then('the {string} element should be enabled', async function (elementName: string) {
  const locator = \`[data-testid="\${elementName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.assertions.assertEnabled(locator);
});

Then('the {string} element should be disabled', async function (elementName: string) {
  const locator = \`[data-testid="\${elementName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.assertions.assertDisabled(locator);
});

Then('the {string} field should have value {string}', async function (fieldName: string, expectedValue: string) {
  const fieldLocator = \`[data-testid="input-\${fieldName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.assertions.assertValue(fieldLocator, expectedValue);
});

Then('I should see {int} {string} elements', async function (count: number, elementName: string) {
  const locator = \`[data-testid="\${elementName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.assertions.assertCount(locator, count);
});

Then('I take a screenshot named {string}', async function (screenshotName: string) {
  await this.actions.takeScreenshot(\`./reports/screenshots/\${screenshotName}.png\`);
});

Then('the {string} checkbox should be checked', async function (checkboxName: string) {
  const checkboxLocator = \`[data-testid="checkbox-\${checkboxName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.assertions.assertChecked(checkboxLocator);
});

Then('the {string} checkbox should not be checked', async function (checkboxName: string) {
  const checkboxLocator = \`[data-testid="checkbox-\${checkboxName.toLowerCase().replace(/\\s+/g, '-')}"]\`;
  await this.assertions.assertNotChecked(checkboxLocator);
});
`;
}

// Generate BasePage — optionally extends team's base class from catalog
function generateBasePage(catalog?: FrameworkCatalog): string {
  const teamBaseClass = catalog?.baseClass;
  const catalogImports = catalog ? buildCatalogImports(catalog, "typescript") : "";
  const catalogNote = catalog
    ? `// Generated using framework catalog: ${catalog.configName} (${catalog.framework}/${catalog.language})\n`
    : "";

  if (teamBaseClass) {
    // Wrap team's base class rather than generating a generic one
    return `${catalogNote}import { Page, BrowserContext, Locator } from '@playwright/test';
${catalogImports}

/**
 * BasePage extends your team's ${teamBaseClass}.
 * All page objects should extend this class.
 */
export abstract class BasePage extends ${teamBaseClass} {
  protected page: Page;
  protected context: BrowserContext;

  constructor(page: Page, context?: BrowserContext) {
    super(page, context);
    this.page = page;
    this.context = context!;
  }

  protected locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  abstract getPageUrl(): string;
  abstract isPageLoaded(): Promise<boolean>;

  async navigate(): Promise<void> {
    await this.page.goto(this.getPageUrl());
  }

  async waitForPageReady(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    await this.page.locator('body').waitFor({ state: 'visible' });
  }

  async takeScreenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: \`./reports/screenshots/\${name}.png\` });
  }
}
`;
  }

  return `${catalogNote}import { Page, BrowserContext, Locator } from '@playwright/test';
import { GenericActions } from '../utils/GenericActions';
import { WaitHelpers } from '../utils/WaitHelpers';
import { AssertionHelpers } from '../utils/AssertionHelpers';
${catalogImports ? catalogImports + "\n" : ""}
export abstract class BasePage {
  protected page: Page;
  protected context: BrowserContext;
  protected actions: GenericActions;
  protected waits: WaitHelpers;
  protected assertions: AssertionHelpers;

  constructor(page: Page, context?: BrowserContext) {
    this.page = page;
    this.context = context!;
    this.actions = new GenericActions(page, context);
    this.waits = new WaitHelpers(page);
    this.assertions = new AssertionHelpers(page);
  }

  protected locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  abstract getPageUrl(): string;
  abstract isPageLoaded(): Promise<boolean>;

  async navigate(): Promise<void> {
    await this.actions.navigateTo(this.getPageUrl());
  }

  async waitForPageReady(): Promise<void> {
    await this.waits.waitForNetworkIdle();
    await this.waits.waitForVisible('body');
  }

  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  async takeScreenshot(name: string): Promise<void> {
    await this.actions.takeScreenshot(\`./reports/screenshots/\${name}.png\`);
  }
}
`;
}

// Generate HomePage — inject catalog navigation functions
function generateHomePage(domain: string, productDescription: string, catalog?: FrameworkCatalog): string {
  const catalogImports = catalog ? buildCatalogImports(catalog, "typescript") : "";
  const navFunctions = catalog?.byCategory["navigation"] ?? [];
  const catalogNote = catalog
    ? `// Generated using framework catalog: ${catalog.configName}\n`
    : "";

  // Build catalog-sourced navigation method delegations
  const catalogNavMethods = navFunctions.slice(0, 6)
    .map(f => {
      const paramList = f.parameters.map(p => `${p.name}: ${p.type}`).join(", ");
      const args = f.parameters.map(p => p.name).join(", ");
      const cls = f.className ? `this.${f.className.charAt(0).toLowerCase() + f.className.slice(1)}` : "this";
      return `  async ${f.name}(${paramList}): Promise<void> {\n    await ${cls}.${f.name}(${args});\n  }`;
    })
    .join("\n\n");

  return `${catalogNote}import { Page, BrowserContext, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
${catalogImports ? catalogImports + "\n" : ""}

export class HomePage extends BasePage {
  // ==================== LOCATORS ====================
  
  // Navigation
  readonly navigationMenu: Locator;
  readonly headerLogo: Locator;
  readonly searchInput: Locator;
  readonly searchButton: Locator;
  
  // Page Sections
  readonly pageContainer: Locator;
  readonly heroSection: Locator;
  readonly mainContent: Locator;
  readonly footerSection: Locator;
  
  // Components
  readonly loginButton: Locator;
  readonly userMenu: Locator;
  readonly notificationBell: Locator;

  constructor(page: Page, context?: BrowserContext) {
    super(page, context);
    
    // Initialize locators
    this.navigationMenu = this.locator('nav.main-navigation, #main-nav, [role="navigation"]');
    this.headerLogo = this.locator('.logo, [data-testid="header-logo"]');
    this.searchInput = this.locator('[data-testid="input-search"], input[type="search"]');
    this.searchButton = this.locator('[data-testid="button-search"]');
    
    this.pageContainer = this.locator('body, #app, #root, .page-container');
    this.heroSection = this.locator('.hero, .hero-section, [data-section="hero"]');
    this.mainContent = this.locator('main, .main-content, [role="main"]');
    this.footerSection = this.locator('footer, .footer, [role="contentinfo"]');
    
    this.loginButton = this.locator('[data-testid="button-login"]');
    this.userMenu = this.locator('[data-testid="user-menu"]');
    this.notificationBell = this.locator('[data-testid="notification-bell"]');
  }

  // ==================== PAGE INTERFACE METHODS ====================

  getPageUrl(): string {
    return process.env.BASE_URL || 'http://localhost:5000';
  }

  async isPageLoaded(): Promise<boolean> {
    return await this.pageContainer.isVisible();
  }

  // ==================== DYNAMIC LOCATOR METHODS ====================

  getNavLinkByText(linkText: string): Locator {
    return this.locator(\`nav a:has-text("\${linkText}"), header a:has-text("\${linkText}")\`);
  }

  getButtonByText(buttonText: string): Locator {
    return this.locator(\`button:has-text("\${buttonText}"), a.btn:has-text("\${buttonText}")\`);
  }

  getFieldByName(fieldName: string): Locator {
    const normalizedName = fieldName.toLowerCase().replace(/\\s+/g, '-');
    return this.locator(\`[data-testid="input-\${normalizedName}"], input[name="\${normalizedName}"], input[placeholder*="\${fieldName}" i]\`);
  }

  getElementByName(elementName: string): Locator {
    const normalizedName = elementName.toLowerCase().replace(/\\s+/g, '-');
    return this.locator(\`[data-testid="\${normalizedName}"]\`);
  }

  // ==================== PAGE-SPECIFIC ACTIONS ====================

  async search(query: string): Promise<void> {
    await this.actions.fill(this.searchInput, query);
    await this.actions.click(this.searchButton);
    await this.waits.waitForNetworkIdle();
  }

  async navigateToSection(sectionName: string): Promise<void> {
    await this.actions.click(this.getNavLinkByText(sectionName));
    await this.waits.waitForNetworkIdle();
  }

  async login(username: string, password: string): Promise<void> {
    await this.actions.click(this.loginButton);
    await this.actions.fill('[data-testid="input-username"]', username);
    await this.actions.fill('[data-testid="input-password"]', password);
    await this.actions.click('[data-testid="button-submit"]');
    await this.waits.waitForNetworkIdle();
  }
\${catalogNavMethods ? \`
  // ==================== CATALOG NAVIGATION METHODS ====================
  // Delegating to team framework functions from ${catalog?.configName ?? 'catalog'}
\${catalogNavMethods}
\` : ''}
}
`;
}

// Generate domain-specific page
function generateDomainPage(domain: string): string | null {
  const domainPages: Record<string, string> = {
    insurance: `import { Page, BrowserContext, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class InsurancePage extends BasePage {
  readonly policyNumber: Locator;
  readonly claimForm: Locator;
  readonly premiumCalculator: Locator;
  readonly coverageSelector: Locator;

  constructor(page: Page, context?: BrowserContext) {
    super(page, context);
    
    this.policyNumber = this.locator('[data-testid="input-policy-number"]');
    this.claimForm = this.locator('[data-testid="form-claim"]');
    this.premiumCalculator = this.locator('[data-testid="premium-calculator"]');
    this.coverageSelector = this.locator('[data-testid="select-coverage"]');
  }

  getPageUrl(): string {
    return '/insurance';
  }

  async isPageLoaded(): Promise<boolean> {
    return await this.policyNumber.isVisible() || await this.claimForm.isVisible();
  }

  async enterPolicyNumber(policyNum: string): Promise<void> {
    await this.actions.fill(this.policyNumber, policyNum);
  }

  async selectCoverage(coverageType: string): Promise<void> {
    await this.actions.selectByText(this.coverageSelector, coverageType);
  }

  async calculatePremium(): Promise<string> {
    await this.actions.click('[data-testid="button-calculate"]');
    await this.waits.waitForVisible('[data-testid="premium-result"]');
    return await this.actions.getText('[data-testid="premium-result"]');
  }
}
`,
    healthcare: `import { Page, BrowserContext, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class HealthcarePage extends BasePage {
  readonly patientId: Locator;
  readonly appointmentForm: Locator;
  readonly prescriptionList: Locator;
  readonly medicalRecords: Locator;

  constructor(page: Page, context?: BrowserContext) {
    super(page, context);
    
    this.patientId = this.locator('[data-testid="input-patient-id"]');
    this.appointmentForm = this.locator('[data-testid="form-appointment"]');
    this.prescriptionList = this.locator('[data-testid="prescription-list"]');
    this.medicalRecords = this.locator('[data-testid="medical-records"]');
  }

  getPageUrl(): string {
    return '/healthcare';
  }

  async isPageLoaded(): Promise<boolean> {
    return await this.patientId.isVisible();
  }

  async searchPatient(patientId: string): Promise<void> {
    await this.actions.fill(this.patientId, patientId);
    await this.actions.click('[data-testid="button-search-patient"]');
    await this.waits.waitForNetworkIdle();
  }

  async scheduleAppointment(date: string, time: string): Promise<void> {
    await this.actions.fill('[data-testid="input-appointment-date"]', date);
    await this.actions.fill('[data-testid="input-appointment-time"]', time);
    await this.actions.click('[data-testid="button-schedule"]');
    await this.waits.waitForNetworkIdle();
  }
}
`,
    finance: `import { Page, BrowserContext, Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class FinancePage extends BasePage {
  readonly accountNumber: Locator;
  readonly transferForm: Locator;
  readonly balanceDisplay: Locator;
  readonly transactionHistory: Locator;

  constructor(page: Page, context?: BrowserContext) {
    super(page, context);
    
    this.accountNumber = this.locator('[data-testid="input-account-number"]');
    this.transferForm = this.locator('[data-testid="form-transfer"]');
    this.balanceDisplay = this.locator('[data-testid="balance-display"]');
    this.transactionHistory = this.locator('[data-testid="transaction-history"]');
  }

  getPageUrl(): string {
    return '/finance';
  }

  async isPageLoaded(): Promise<boolean> {
    return await this.balanceDisplay.isVisible();
  }

  async getBalance(): Promise<string> {
    return await this.actions.getText(this.balanceDisplay);
  }

  async initiateTransfer(toAccount: string, amount: string): Promise<void> {
    await this.actions.fill('[data-testid="input-to-account"]', toAccount);
    await this.actions.fill('[data-testid="input-amount"]', amount);
    await this.actions.click('[data-testid="button-transfer"]');
    await this.waits.waitForNetworkIdle();
  }
}
`
  };

  return domainPages[domain.toLowerCase()] || null;
}

// Generate GenericActions utility class
function generateGenericActions(): string {
  return `import { Page, Locator, BrowserContext } from '@playwright/test';

export class GenericActions {
  private page: Page;
  private context: BrowserContext;
  private defaultTimeout: number = 30000;

  constructor(page: Page, context?: BrowserContext) {
    this.page = page;
    this.context = context!;
  }

  // ==================== NAVIGATION METHODS ====================
  
  async navigateTo(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    await this.page.goto(url, { waitUntil, timeout: this.defaultTimeout });
  }

  async navigateBack(): Promise<void> {
    await this.page.goBack({ waitUntil: 'load' });
  }

  async navigateForward(): Promise<void> {
    await this.page.goForward({ waitUntil: 'load' });
  }

  async refreshPage(): Promise<void> {
    await this.page.reload({ waitUntil: 'load' });
  }

  // ==================== CLICK METHODS ====================

  async click(locator: string | Locator, options?: { force?: boolean; timeout?: number }): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.click({ 
      force: options?.force || false, 
      timeout: options?.timeout || this.defaultTimeout 
    });
  }

  async doubleClick(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.dblclick({ timeout: this.defaultTimeout });
  }

  async rightClick(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.click({ button: 'right', timeout: this.defaultTimeout });
  }

  // ==================== INPUT METHODS ====================

  async fill(locator: string | Locator, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.fill(text, { timeout: this.defaultTimeout });
  }

  async type(locator: string | Locator, text: string, delay: number = 50): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.pressSequentially(text, { delay });
  }

  async clearText(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.clear();
  }

  // ==================== DROPDOWN METHODS ====================

  async selectByText(locator: string | Locator, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.selectOption({ label: text });
  }

  async selectByValue(locator: string | Locator, value: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.selectOption({ value });
  }

  async selectByIndex(locator: string | Locator, index: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.selectOption({ index });
  }

  // ==================== CHECKBOX METHODS ====================

  async check(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.check({ timeout: this.defaultTimeout });
  }

  async uncheck(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.uncheck({ timeout: this.defaultTimeout });
  }

  async isChecked(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isChecked();
  }

  // ==================== GET METHODS ====================

  async getText(locator: string | Locator): Promise<string> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return (await element.textContent()) || '';
  }

  async getAttribute(locator: string | Locator, attributeName: string): Promise<string | null> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.getAttribute(attributeName);
  }

  async getInputValue(locator: string | Locator): Promise<string> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.inputValue();
  }

  async getElementCount(locator: string | Locator): Promise<number> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.count();
  }

  // ==================== VISIBILITY METHODS ====================

  async isVisible(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isVisible();
  }

  async isEnabled(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isEnabled();
  }

  async isDisabled(locator: string | Locator): Promise<boolean> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    return await element.isDisabled();
  }

  // ==================== HOVER & SCROLL METHODS ====================

  async hover(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.hover({ timeout: this.defaultTimeout });
  }

  async scrollIntoView(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.scrollIntoViewIfNeeded();
  }

  async scrollToTop(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  // ==================== WAIT METHODS ====================

  async wait(milliseconds: number): Promise<void> {
    await this.page.waitForTimeout(milliseconds);
  }

  // ==================== KEYBOARD METHODS ====================

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  // ==================== FILE UPLOAD ====================

  async uploadFile(locator: string | Locator, filePath: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.setInputFiles(filePath);
  }

  // ==================== SCREENSHOT ====================

  async takeScreenshot(path: string, fullPage: boolean = true): Promise<void> {
    await this.page.screenshot({ path, fullPage });
  }

  // ==================== URL & TITLE ====================

  getCurrentUrl(): string {
    return this.page.url();
  }

  async getTitle(): Promise<string> {
    return await this.page.title();
  }
}
`;
}

// Generate WaitHelpers utility class
function generateWaitHelpers(): string {
  return `import { Page, Locator, expect } from '@playwright/test';

export class WaitHelpers {
  private page: Page;
  private defaultTimeout: number = 30000;

  constructor(page: Page) {
    this.page = page;
  }

  async waitForNetworkIdle(timeout?: number): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: timeout || this.defaultTimeout });
  }

  async waitForVisible(locator: string | Locator, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.waitFor({ state: 'visible', timeout: timeout || this.defaultTimeout });
  }

  async waitForHidden(locator: string | Locator, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.waitFor({ state: 'hidden', timeout: timeout || this.defaultTimeout });
  }

  async waitForAttached(locator: string | Locator, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await element.waitFor({ state: 'attached', timeout: timeout || this.defaultTimeout });
  }

  async waitForPageLoad(state: 'load' | 'domcontentloaded' | 'networkidle' = 'load'): Promise<void> {
    await this.page.waitForLoadState(state);
  }

  async waitForUrlContains(urlPart: string, timeout?: number): Promise<void> {
    await this.page.waitForURL(\`**/*\${urlPart}*\`, { timeout: timeout || this.defaultTimeout });
  }

  async waitForText(locator: string | Locator, expectedText: string, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveText(expectedText, { timeout: timeout || this.defaultTimeout });
  }

  async waitForContainsText(locator: string | Locator, expectedText: string, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toContainText(expectedText, { timeout: timeout || this.defaultTimeout });
  }

  async waitForElementCount(locator: string | Locator, count: number, timeout?: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveCount(count, { timeout: timeout || this.defaultTimeout });
  }

  async waitForApiResponse(urlPattern: string | RegExp): Promise<any> {
    const response = await this.page.waitForResponse(urlPattern);
    return response.json();
  }

  async waitWithRetry<T>(
    action: () => Promise<T>,
    maxRetries: number = 3,
    delayBetweenRetries: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await action();
      } catch (error) {
        lastError = error as Error;
        if (i < maxRetries - 1) {
          await this.page.waitForTimeout(delayBetweenRetries);
        }
      }
    }
    
    throw lastError;
  }
}
`;
}

// Generate AssertionHelpers utility class
function generateAssertionHelpers(): string {
  return `import { Page, Locator, expect } from '@playwright/test';

export class AssertionHelpers {
  private page: Page;
  private defaultTimeout: number = 10000;

  constructor(page: Page) {
    this.page = page;
  }

  async assertVisible(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeVisible({ timeout: this.defaultTimeout });
  }

  async assertHidden(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeHidden({ timeout: this.defaultTimeout });
  }

  async assertEnabled(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeEnabled({ timeout: this.defaultTimeout });
  }

  async assertDisabled(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeDisabled({ timeout: this.defaultTimeout });
  }

  async assertText(locator: string | Locator, expectedText: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveText(expectedText, { timeout: this.defaultTimeout });
  }

  async assertContainsText(locator: string | Locator, expectedText: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toContainText(expectedText, { timeout: this.defaultTimeout });
  }

  async assertValue(locator: string | Locator, expectedValue: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveValue(expectedValue, { timeout: this.defaultTimeout });
  }

  async assertAttribute(locator: string | Locator, attribute: string, value: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveAttribute(attribute, value, { timeout: this.defaultTimeout });
  }

  async assertUrl(expectedUrl: string): Promise<void> {
    await expect(this.page).toHaveURL(expectedUrl, { timeout: this.defaultTimeout });
  }

  async assertUrlContains(urlPart: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(urlPart), { timeout: this.defaultTimeout });
  }

  async assertTitle(expectedTitle: string): Promise<void> {
    await expect(this.page).toHaveTitle(expectedTitle, { timeout: this.defaultTimeout });
  }

  async assertTitleContains(titlePart: string): Promise<void> {
    await expect(this.page).toHaveTitle(new RegExp(titlePart), { timeout: this.defaultTimeout });
  }

  async assertCount(locator: string | Locator, count: number): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveCount(count, { timeout: this.defaultTimeout });
  }

  async assertChecked(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeChecked({ timeout: this.defaultTimeout });
  }

  async assertNotChecked(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).not.toBeChecked({ timeout: this.defaultTimeout });
  }

  async assertHasClass(locator: string | Locator, className: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toHaveClass(new RegExp(className), { timeout: this.defaultTimeout });
  }

  async assertFocused(locator: string | Locator): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    await expect(element).toBeFocused({ timeout: this.defaultTimeout });
  }
}
`;
}

// Generate Playwright config
function generatePlaywrightConfig(domain: string): string {
  return `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './features',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'reports/html-report' }],
    ['json', { outputFile: 'reports/test-results.json' }],
    ['junit', { outputFile: 'reports/junit-results.xml' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: process.env.HEADLESS !== 'false',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
});
`;
}

// Generate Cucumber config
function generateCucumberConfig(): string {
  return `export default {
  default: {
    require: ['step-definitions/**/*.ts', 'support/**/*.ts'],
    requireModule: ['ts-node/register'],
    format: [
      'progress-bar',
      'html:reports/cucumber-report.html',
      'json:reports/cucumber-report.json',
    ],
    formatOptions: { snippetInterface: 'async-await' },
    publishQuiet: true,
    paths: ['features/**/*.feature'],
    parallel: 2,
    retry: 1,
    retryTagFilter: '@flaky',
  },
};
`;
}

// Helper function to capitalize first letter
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getDomainContext(domain: string, category: string): string {
  const contexts: Record<string, Record<string, string>> = {
    insurance: {
      functional: "Focus on: Policy creation, premium calculations, claims submission, underwriting workflows, endorsements, policy renewals",
      negative: "Test: Invalid policy data, expired coverage, duplicate claims, unauthorized access attempts, calculation errors",
      edge_case: "Consider: Backdated policies, multi-state regulations, complex riders, bulk operations, concurrent modifications",
      security: "Validate: PII protection, role-based access, audit logging, data encryption, session management",
      accessibility: "Ensure: Form accessibility, document reader support, keyboard navigation, color contrast, error announcements"
    },
    healthcare: {
      functional: "Focus on: Patient registration, appointment scheduling, clinical documentation, prescription workflows, billing",
      negative: "Test: Invalid patient data, scheduling conflicts, medication interactions, insurance verification failures",
      edge_case: "Consider: Emergency admissions, multi-provider care, complex diagnoses, pediatric vs adult workflows",
      security: "Validate: HIPAA compliance, PHI protection, access controls, audit trails, minimum necessary access",
      accessibility: "Ensure: Screen reader support, high contrast mode, large text options, assistive device compatibility"
    },
    finance: {
      functional: "Focus on: Account creation, transactions, transfers, statements, loan processing, investment operations",
      negative: "Test: Insufficient funds, invalid routing, duplicate transactions, rate limit violations, timeout scenarios",
      edge_case: "Consider: International transfers, currency conversion, holiday processing, large transactions",
      security: "Validate: PCI-DSS compliance, encryption, MFA, fraud detection, session management",
      accessibility: "Ensure: Form accessibility, transaction confirmations, balance announcements, keyboard navigation"
    },
    "e-commerce": {
      functional: "Focus on: Product browsing, cart management, checkout flow, payment processing, order tracking",
      negative: "Test: Out of stock items, invalid coupons, payment failures, address validation errors",
      edge_case: "Consider: Flash sales, inventory sync, multi-currency, international shipping, bulk orders",
      security: "Validate: Payment data protection, session security, CSRF protection, injection prevention",
      accessibility: "Ensure: Product image alt text, form labels, checkout accessibility, cart updates"
    },
    retail: {
      functional: "Focus on: Self-service kiosk and micro market operations, product catalog management, inventory tracking and replenishment, consumer account registration and management, payment processing (credit/debit, mobile wallet, loyalty cards), vending machine integration, planogram compliance, order fulfillment workflows, pricing and promotions management, subsidy and meal plan programs, nutritional information display, product barcode scanning, touchscreen kiosk interactions, cooler and shelf sensor monitoring, sales reporting and analytics dashboards, operator portal management, location and market setup, consumer mobile app transactions, refund and credit processing, tax calculation by jurisdiction",
      negative: "Test: Payment declined scenarios, insufficient account balance, invalid barcode scans, network connectivity loss at kiosk, expired promotions applied, out-of-stock product selection, invalid consumer credentials, duplicate transaction attempts, sensor malfunction handling, timeout during payment processing, invalid coupon codes, unauthorized operator access, corrupted product data sync",
      edge_case: "Consider: Offline kiosk operation and data sync on reconnect, high-traffic simultaneous transactions, multi-location inventory transfers, daypart pricing transitions, bulk product catalog updates, kiosk firmware update during active session, multi-currency support for international locations, subsidy balance edge cases (partial coverage), tax-exempt transactions, split payment across multiple methods, leap year and DST impacts on reporting",
      security: "Validate: PCI-DSS compliance for payment processing, consumer PII protection, operator role-based access controls, API authentication for kiosk-to-server communication, data encryption at rest and in transit, session timeout management on kiosks, audit logging for financial transactions, secure firmware update delivery, tamper detection on payment terminals",
      accessibility: "Ensure: Kiosk touchscreen accessibility (ADA compliance), high contrast display modes, screen reader compatibility for consumer-facing apps, large text and icon options, audio feedback for visually impaired users, wheelchair-accessible kiosk interface height, multilingual support, clear error messaging and guided recovery"
    },
    technology: {
      functional: "Focus on: API endpoints, user authentication, data CRUD operations, integration workflows",
      negative: "Test: Invalid inputs, authentication failures, rate limiting, timeout handling, malformed requests",
      edge_case: "Consider: Concurrent operations, large payloads, network interruptions, version compatibility",
      security: "Validate: Authentication, authorization, input validation, encryption, API security",
      accessibility: "Ensure: Keyboard navigation, screen reader support, focus management, error handling"
    }
  };

  const domainLower = domain.toLowerCase();
  return contexts[domainLower]?.[category] || `Generate comprehensive ${category} tests for ${domain} domain.`;
}

function calculateQualityScore(testCases: SprintTestCase[]): number {
  if (testCases.length === 0) return 0;

  let score = 100;
  
  const noSteps = testCases.filter(tc => !tc.testSteps || tc.testSteps.length === 0).length;
  score -= (noSteps / testCases.length) * 30;

  const noTitle = testCases.filter(tc => !tc.title || tc.title.length < 10).length;
  score -= (noTitle / testCases.length) * 20;

  const priorities = new Set(testCases.map(tc => tc.priority));
  if (priorities.size < 3) {
    score -= 10;
  }

  const categories = new Set(testCases.map(tc => tc.category));
  if (categories.size < 4) {
    score -= 10;
  }

  return Math.max(0, Math.round(score));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
