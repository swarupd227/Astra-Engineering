import {
  hasBedrock,
  workflowAzureInstances,
  hasWorkflowInstances,
} from "./llm-config";
import { ai as sharedAiClient } from "./ai-client";

const LLM_CALL_TIMEOUT_MS = hasBedrock ? 300_000 : 180_000;

const QA_JSON_OUTPUT_CONSTRAINT = `

## CRITICAL JSON OUTPUT RULES
1. Output ONLY valid JSON — no text before or after the JSON object.
2. Use ONLY double quotes (") for all keys and string values — NEVER single quotes (').
3. Do NOT wrap the JSON in markdown code blocks.
4. Do NOT add explanatory text, commentary, or notes after the JSON.
5. Escape special characters inside strings: use \\n for newlines, \\\\ for backslashes, \\" for quotes within strings.
6. Do NOT use trailing commas after the last element in arrays or objects.
7. Ensure ALL arrays and objects are properly closed with ] and }.`;

/**
 * Robust JSON parser for QA agent LLM responses.
 * Handles common LLM output issues: markdown wrapping, trailing commas,
 * degeneration patterns, single quotes, commentary tails, raw newlines.
 */
function robustJsonParse(raw: string, label: string): any {
  let jsonStr = raw.trim();

  // Strip markdown code blocks (closed)
  const codeBlock = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlock && codeBlock[1]) {
    jsonStr = codeBlock[1].trim();
  } else {
    // Handle unclosed code fence (Bedrock truncated response — no closing ```)
    const openFence = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]+)/);
    if (openFence && openFence[1]) {
      jsonStr = openFence[1].trim();
    }
  }

  // Strip degeneration garbage: "}  1  }  1  }" patterns
  const degenPattern = /(\}\s*\d*\s*){5,}$/;
  if (degenPattern.test(jsonStr)) {
    const dStart = jsonStr.search(degenPattern);
    if (dStart > 100) {
      jsonStr = jsonStr.substring(0, dStart).trimEnd();
      const lb = jsonStr.lastIndexOf('}');
      if (lb > 0) jsonStr = jsonStr.substring(0, lb + 1);
    }
  }

  // Strip commentary tail: find last balanced root-level closing brace (string-aware)
  {
    let depth = 0, inStr = false, esc = false, lastRootClose = -1;
    for (let i = 0; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && inStr) { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) lastRootClose = i; }
    }
    if (lastRootClose > 0 && lastRootClose < jsonStr.length - 1) {
      const tail = jsonStr.substring(lastRootClose + 1).trim();
      if (tail.length > 5) {
        jsonStr = jsonStr.substring(0, lastRootClose + 1);
        console.log(`[QA] ${label}: stripped ${tail.length} chars of post-JSON content`);
      }
    }
  }

  // Fix single-quoted keys: 'keyName': → "keyName":
  if (/'[a-zA-Z_][a-zA-Z0-9_]*'\s*:/.test(jsonStr)) {
    jsonStr = jsonStr.replace(/([{,\[]\s*)'([a-zA-Z_][a-zA-Z0-9_]*)'\s*:/g, '$1"$2":');
    jsonStr = jsonStr.replace(/:\s*'([^']*?)'\s*([,}\]])/g, ': "$1"$2');
  }

  // Fix raw newlines inside JSON strings
  {
    let result = '', inS = false, escd = false;
    for (let i = 0; i < jsonStr.length; i++) {
      const c = jsonStr[i];
      if (escd) { result += c; escd = false; continue; }
      if (c === '\\' && inS) { result += c; escd = true; continue; }
      if (c === '"') { inS = !inS; result += c; continue; }
      if (inS && (c === '\n' || c === '\r')) {
        if (c === '\r' && jsonStr[i + 1] === '\n') i++;
        result += '\\n';
        continue;
      }
      result += c;
    }
    jsonStr = result;
  }

  // Remove trailing commas
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

  // Try parse
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Last resort: try to close unclosed brackets
    const openB = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
    const openC = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
    let patched = jsonStr;
    for (let i = 0; i < openB; i++) patched += ']';
    for (let i = 0; i < openC; i++) patched += '}';
    try {
      return JSON.parse(patched);
    } catch (e2) {
      console.error(`[QA] ${label}: robust JSON parse failed — ${(e2 as Error).message}`);
      return null;
    }
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms,
      ),
    ),
  ]);
}

async function qaLlmCallWithRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (error: any) {
      const status = error?.status || error?.response?.status || error?.code;
      const is429 = status === 429 || (error?.message && /429|rate.?limit|too.?many.?requests/i.test(error.message));
      const isTransient = status === 500 || status === 503 || status === 'ECONNRESET' || status === 'ETIMEDOUT';
      const isTimeout = error?.message?.includes?.('timed out');

      if ((is429 || isTransient) && attempt < maxRetries) {
        const retryAfterHeader = error?.headers?.get?.('retry-after') || error?.response?.headers?.['retry-after'];
        const retryAfterMs = retryAfterHeader ? (parseInt(retryAfterHeader, 10) || 5) * 1000 : null;
        const backoffMs = retryAfterMs || Math.min(2000 * Math.pow(2, attempt), 30000);
        console.warn(`[Quality Agent] ${label} hit ${is429 ? '429 rate limit' : `${status} error`} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${(backoffMs / 1000).toFixed(1)}s...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      if (isTimeout && !is429 && !isTransient) {
        throw error;
      }
      throw error;
    }
  }
  throw new Error(`${label}: exhausted all ${maxRetries + 1} attempts`);
}

let qaRoundRobinIndex = 0;
function getNextInstance(): {
  client: any;
  deployment: string;
  name: string;
} | null {
  if (!hasWorkflowInstances || workflowAzureInstances.length === 0) return null;
  const instance =
    workflowAzureInstances[qaRoundRobinIndex % workflowAzureInstances.length];
  qaRoundRobinIndex++;
  return instance;
}

/** Number of workflow instances (0 if not configured). */
const qaNumInstances = hasWorkflowInstances ? workflowAzureInstances.length : 0;

/**
 * Get client for a specific task index. When multiple instances exist, assigns taskIndex % N
 * so load is spread evenly and we avoid bursting one instance (reduces 429 token limit).
 */
function getClientForTaskIndex(taskIndex: number): {
  client: any;
  model: string;
  instanceName: string;
} {
  if (qaNumInstances > 0) {
    const instance = workflowAzureInstances[taskIndex % qaNumInstances];
    return {
      client: instance.client,
      model: instance.deployment,
      instanceName: instance.name,
    };
  }
  if (openai) {
    return {
      client: openai,
      model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4",
      instanceName: "default",
    };
  }
  throw new Error("No Azure OpenAI client available for Quality Agent");
}

function getClientAndModel(): {
  client: any;
  model: string;
  instanceName: string;
} {
  const instance = getNextInstance();
  if (instance) {
    return {
      client: instance.client,
      model: instance.deployment,
      instanceName: instance.name,
    };
  }
  if (openai) {
    return {
      client: openai,
      model: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4",
      instanceName: "default",
    };
  }
  throw new Error("No Azure OpenAI client available for Quality Agent");
}

/**
 * Batch size for parallel LLM calls.
 * Azure: one per deployment instance to avoid per-deployment TPM bursts.
 * Bedrock: supports concurrent requests at account level, so allow up to 4 in parallel.
 */
const qaConcurrencyLimit = hasBedrock
  ? Math.max(qaNumInstances, 4)
  : (qaNumInstances > 0 ? qaNumInstances : 4);

/** Run items in batches of qaConcurrencyLimit to avoid rate limits. */
async function runInBatches<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += qaConcurrencyLimit) {
    const batch = items.slice(i, i + qaConcurrencyLimit);
    const batchResults = await Promise.all(
      batch.map((item, j) => fn(item, i + j)),
    );
    results.push(...batchResults);
  }
  return results;
}

/** Retry once on 429 using retry-after (or 35s). */
async function with429Retry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = 3,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.response?.status || err?.code;
      const is429 = status === 429 || err?.code === "RateLimitReached" || (err?.message && /429|rate.?limit|too.?many.?requests/i.test(err.message));
      const isTransient = status === 500 || status === 503 || status === 'ECONNRESET' || status === 'ETIMEDOUT';

      if ((is429 || isTransient) && attempt < maxRetries) {
        const retryAfter = err?.headers?.get?.("retry-after") ?? null;
        const retryAfterMs = retryAfter ? Math.min(Number(retryAfter) * 1000 || 5000, 60000) : null;
        const backoffMs = retryAfterMs || Math.min(2000 * Math.pow(2, attempt), 30000);

        if (is429 && qaNumInstances > 1) {
          const fallbackInstance = getNextInstance();
          if (fallbackInstance) {
            console.warn(
              `[Quality Agent] 429 on ${label} (attempt ${attempt + 1}/${maxRetries + 1}), switching to instance ${fallbackInstance.name} after ${(backoffMs / 1000).toFixed(1)}s backoff...`,
            );
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
        }

        console.warn(
          `[Quality Agent] ${is429 ? '429 rate limit' : `${status} error`} on ${label} (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${(backoffMs / 1000).toFixed(1)}s...`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: exhausted all ${maxRetries + 1} attempts`);
}

const openai = sharedAiClient;

interface MandatoryArchitecturalLayer {
  id: string;
  name: string;
  keywords: string[];
  description: string;
}

const MANDATORY_ARCHITECTURAL_LAYERS: MandatoryArchitecturalLayer[] = [
  {
    id: "domain-operational-layers",
    name: "Domain-Specific Operational Layers",
    keywords: [
      "operational",
      "workflow",
      "business process",
      "processing",
      "adjudication",
      "intake",
      "lifecycle",
      "administration",
    ],
    description:
      "Stories that model domain-specific operational workflows (e.g., claims adjudication, patient intake, loan underwriting), not just generic CRUD operations.",
  },
  {
    id: "capability-modeling",
    name: "Capability-Driven Modeling",
    keywords: [
      "capability",
      "engine",
      "assessment",
      "evaluation",
      "decision",
      "analysis",
      "recommendation",
      "intelligence",
      "detection",
    ],
    description:
      'Features describing WHAT the system does as business capabilities (e.g., "Risk Assessment Engine"), not just workflow steps.',
  },
  {
    id: "business-configuration",
    name: "Business-Facing Configuration Depth",
    keywords: [
      "configuration",
      "configurable",
      "rule engine",
      "business rule",
      "parameter",
      "tenant",
      "customization",
      "admin panel",
      "settings management",
    ],
    description:
      "Stories for business-rule-driven configurability: rule engines, configurable workflows, parameter-driven logic, tenant-specific customization, admin configuration UIs.",
  },
  {
    id: "dashboard-analytics",
    name: "Dashboard & Analytic UX Depth",
    keywords: [
      "dashboard",
      "analytics",
      "visualization",
      "chart",
      "report",
      "kpi",
      "metrics",
      "drill-down",
      "rollup",
      "aggregation",
      "trend",
      "export",
    ],
    description:
      "Stories for executive/operational dashboards, hierarchical data visualization (org→region→branch), operational data rollups, analytic UI modeling, chart types, filter systems, scheduled reports.",
  },
  {
    id: "security-architecture",
    name: "Formal Security Architecture",
    keywords: [
      "security",
      "rbac",
      "access control",
      "permission",
      "authentication",
      "authorization",
      "encryption",
      "mfa",
      "sso",
      "token",
      "api security",
    ],
    description:
      "Stories for RBAC with fine-grained permissions, data encryption, authentication flows (SSO, MFA), security audit logging, API security (rate limiting, input validation, CORS).",
  },
  {
    id: "audit-modeling",
    name: "Audit Modeling",
    keywords: [
      "audit",
      "audit trail",
      "audit log",
      "change history",
      "data lineage",
      "compliance report",
      "immutable log",
      "regulatory audit",
      "sox",
      "soc2",
    ],
    description:
      "Stories for complete audit trail (who/what/when/where), immutable audit log storage, audit report generation, data lineage tracking, regulatory audit readiness (SOC2, SOX, HIPAA).",
  },
  {
    id: "integration-strategy",
    name: "Platform-Level Integration Strategy",
    keywords: [
      "integration",
      "api gateway",
      "webhook",
      "event-driven",
      "batch sync",
      "import",
      "export",
      "pipeline",
      "partner api",
      "third-party",
      "service mesh",
    ],
    description:
      "Stories for API gateway, third-party integrations (webhooks, event-driven, batch sync), data import/export pipelines, integration monitoring and error handling, partner API management.",
  },
  {
    id: "operational-resilience",
    name: "Operational Resilience (Availability & Performance)",
    keywords: [
      "resilience",
      "availability",
      "performance",
      "monitoring",
      "health check",
      "circuit breaker",
      "caching",
      "disaster recovery",
      "backup",
      "load testing",
      "sla",
      "scalability",
    ],
    description:
      "Stories for health monitoring/alerting, graceful degradation, performance benchmarks/SLA targets, caching strategy, disaster recovery, load testing and capacity planning.",
  },
  {
    id: "workflow-system",
    name: "Workflow System Architecture",
    keywords: [
      "workflow",
      "approval chain",
      "approval",
      "escalation",
      "state machine",
      "multi-actor",
      "notification",
      "sla enforcement",
      "workflow template",
      "orchestration",
    ],
    description:
      "Stories for multi-step workflow orchestration, multi-actor approval chains (sequential/parallel/conditional), escalation logic (time/threshold/authority-based), workflow status tracking and SLA enforcement.",
  },
  {
    id: "architecture-compatibility",
    name: "Architecture Compatibility Layer",
    keywords: [
      "api versioning",
      "backward compatibility",
      "migration",
      "schema evolution",
      "multi-tenant",
      "feature flag",
      "cross-platform",
      "progressive rollout",
      "compatibility",
    ],
    description:
      "Stories for API versioning, data migration and schema evolution, multi-tenant architecture, feature flagging and progressive rollout, cross-platform compatibility.",
  },
];

function checkArchitecturalLayerCoverage(
  artifacts: any,
): {
  layerId: string;
  layerName: string;
  covered: boolean;
  matchingArtifacts: string[];
}[] {
  const allTexts: string[] = [];
  for (const epic of artifacts.epics || []) {
    allTexts.push(`${epic.title || ""} ${epic.description || ""}`);
  }
  for (const feature of artifacts.features || []) {
    allTexts.push(`${feature.title || ""} ${feature.description || ""}`);
  }
  for (const story of artifacts.userStories || []) {
    allTexts.push(
      `${story.title || ""} ${story.description || ""} ${(story.acceptanceCriteria || []).join(" ")}`,
    );
  }
  const combinedText = allTexts.join(" ").toLowerCase();

  return MANDATORY_ARCHITECTURAL_LAYERS.map((layer) => {
    const matchingKeywords = layer.keywords.filter((kw) =>
      combinedText.includes(kw.toLowerCase()),
    );
    const covered = matchingKeywords.length >= 2;
    return {
      layerId: layer.id,
      layerName: layer.name,
      covered,
      matchingArtifacts: matchingKeywords,
    };
  });
}

interface ParsedRequirement {
  id: string;
  name: string;
  description: string;
  priority: string;
  source: string;
}

interface RequirementCoverage {
  requirementId: string;
  requirementName: string;
  requirementDescription: string;
  covered: boolean;
  coveringStories: string[];
  coveringFeatures: string[];
  coverageStrength: "full" | "partial" | "none";
}

function normalizeTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function areSimilarTitles(
  a: string,
  b: string,
  threshold: number = 0.75,
): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return true;
  if (na.length > 10 && nb.length > 10) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  const wordsA = new Set(na.split(" "));
  const wordsB = new Set(nb.split(" "));
  if (wordsA.size < 3 || wordsB.size < 3) return na === nb;
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && intersection / union >= threshold;
}

function buildSummary(item: any): string {
  const parts: string[] = [];
  if (item.title) parts.push(String(item.title));
  if (item.description) {
    const desc =
      typeof item.description === "string"
        ? item.description
        : JSON.stringify(item.description);
    parts.push(desc.substring(0, 300));
  }
  return parts.join(" ").toLowerCase();
}

function areSemanticallyDuplicate(
  a: any,
  b: any,
  requireBothSignals: boolean = false,
): boolean {
  const titleMatch = areSimilarTitles(a.title || "", b.title || "", 0.75);
  if (titleMatch && !requireBothSignals) return true;

  const summaryA = buildSummary(a);
  const summaryB = buildSummary(b);
  const kwA = extractKeywords(summaryA);
  const kwB = extractKeywords(summaryB);
  if (kwA.size < 4 || kwB.size < 4) return titleMatch;
  const intersection = [...kwA].filter((k) => kwB.has(k)).length;
  const union = new Set([...kwA, ...kwB]).size;
  const descriptionMatch = union > 0 && intersection / union >= 0.65;

  if (requireBothSignals) {
    return titleMatch && descriptionMatch;
  }
  return titleMatch || descriptionMatch;
}

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "out",
    "off",
    "over",
    "under",
    "again",
    "further",
    "then",
    "once",
    "and",
    "but",
    "or",
    "nor",
    "not",
    "so",
    "than",
    "too",
    "very",
    "just",
    "that",
    "this",
    "these",
    "those",
    "it",
    "its",
    "i",
    "me",
    "my",
    "we",
    "our",
    "you",
    "your",
    "he",
    "she",
    "they",
    "them",
    "their",
    "what",
    "which",
    "who",
    "when",
    "where",
    "how",
    "all",
    "each",
    "every",
    "both",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "only",
    "own",
    "same",
    "also",
    "must",
    "user",
    "system",
    "able",
    "want",
    "ensure",
    "provide",
    "allow",
    "enable",
    "support",
    "include",
    // 2-letter noise words (kept short words > 1 char for domain acronyms like UI, DB, ID)
    "if", "up", "us", "am", "an", "go", "no", "so", "or", "it", "be", "do", "he", "me", "my", "we",
  ]);
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1); // keep 2-letter terms (UI, DB, ID, etc.)
  return new Set(words.filter((w) => !stopWords.has(w)));
}

function parseBRDRequirements(
  requirementsContent: string,
): ParsedRequirement[] {
  const requirements: ParsedRequirement[] = [];
  if (!requirementsContent || requirementsContent.trim().length === 0)
    return requirements;

  const reqPattern =
    /## Requirement:\s*(.+?)(?:\n|\r\n)(?:.*?\*\*ID:\*\*\s*(\S+))?(?:.*?\*\*Description:\*\*\s*([\s\S]*?))?(?=## Requirement:|---|\n=== |$)/gi;
  let match;
  while ((match = reqPattern.exec(requirementsContent)) !== null) {
    const name = (match[1] || "").trim();
    const id = (match[2] || `req-${requirements.length + 1}`).trim();
    const description = (match[3] || name)
      .trim()
      .replace(/\*\*Priority:\*\*.*$/gm, "")
      .replace(/\*\*Status:\*\*.*$/gm, "")
      .replace(/\*\*Source BRD:\*\*.*$/gm, "")
      .replace(/\*\*Project ID:\*\*.*$/gm, "")
      .replace(/\*\*ID:\*\*.*$/gm, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (name) {
      requirements.push({ id, name, description, priority: "", source: "brd" });
    }
  }

  if (requirements.length === 0) {
    // Match ALL requirement type prefixes: FR, NFR, TR, IR, BR, DR, REQ + verbose forms
    // Compound IDs (e.g. BR-AUTH-001, NFR-PERF-01) must come BEFORE simple IDs in alternation
    const compoundOrSimple = `NFR-[A-Z]+-\\d+|FR-[A-Z]+-\\d+|TR-[A-Z]+-\\d+|IR-[A-Z]+-\\d+|BR-[A-Z]+-\\d+|DR-[A-Z]+-\\d+|NFR-?\\d+|FR-?\\d+|TR-?\\d+|IR-?\\d+|BR-?\\d+|DR-?\\d+|REQ-?\\d+`;
    const verboseForms = `Non-Functional Requirement \\d+|Functional Requirement \\d+|Technical Requirement \\d+|Integration Requirement \\d+|Business Rule \\d+|Data Requirement \\d+|Requirement \\d+`;
    const allReqPattern = new RegExp(
      `(?:${compoundOrSimple}|${verboseForms})[:\\s]*(.+?)(?=(?:${compoundOrSimple}|${verboseForms})|$)`,
      'gi'
    );
    while ((match = allReqPattern.exec(requirementsContent)) !== null) {
      const text = (match[0] || "").trim();
      const desc = (match[1] || "").trim();
      // Extract ID — compound first (BR-AUTH-001), then simple (FR-01)
      const idMatch = text.match(/^(NFR-[A-Z]+-\d+|FR-[A-Z]+-\d+|TR-[A-Z]+-\d+|IR-[A-Z]+-\d+|BR-[A-Z]+-\d+|DR-[A-Z]+-\d+|NFR-?\d+|FR-?\d+|TR-?\d+|IR-?\d+|BR-?\d+|DR-?\d+|REQ-?\d+)/i);
      if (desc && desc.length > 5) {
        requirements.push({
          id: idMatch ? idMatch[1] : `req-${requirements.length + 1}`,
          name: desc.substring(0, 120),
          description: desc,
          priority: "",
          source: "brd-fr",
        });
      }
    }
  }

  if (requirements.length === 0) {
    const sections = requirementsContent.split(/\n---\n|\n## /);
    for (const section of sections) {
      const trimmed = section.trim();
      if (trimmed.length > 20 && trimmed.length < 2000) {
        const firstLine = trimmed.split("\n")[0].trim();
        if (firstLine.length > 5) {
          requirements.push({
            id: `req-${requirements.length + 1}`,
            name: firstLine.substring(0, 120),
            description: trimmed.substring(0, 500),
            priority: "",
            source: "text",
          });
        }
      }
    }
  }

  return requirements;
}

function checkRequirementCoverage(
  requirements: ParsedRequirement[],
  artifacts: any,
): RequirementCoverage[] {
  const features = artifacts.features || [];
  const stories = artifacts.userStories || [];
  const epics = artifacts.epics || [];

  const allArtifactTexts = [
    ...epics.map((e: any) => ({
      text: `${e.title || ""} ${e.description || ""}`,
      type: "epic",
      id: e.id,
      title: e.title,
    })),
    ...features.map((f: any) => ({
      text: `${f.title || ""} ${f.description || ""}`,
      type: "feature",
      id: f.id,
      title: f.title,
    })),
    ...stories.map((s: any) => {
      const subtaskText = Array.isArray(s.subtasks)
        ? s.subtasks.map((st: any) => typeof st === 'string' ? st : (st?.description ?? st?.title ?? '')).join(' ')
        : '';
      return {
        text: `${s.title || ""} ${s.description || ""} ${(s.acceptanceCriteria || []).join(" ")} ${subtaskText}`,
        type: "story",
        id: s.id,
        title: s.title,
        featureId: s.featureId,
      };
    }),
  ];

  return requirements.map((req) => {
    const reqKeywords = extractKeywords(`${req.name} ${req.description}`);
    if (reqKeywords.size === 0) {
      return {
        requirementId: req.id,
        requirementName: req.name,
        requirementDescription: req.description,
        covered: true,
        coveringStories: [],
        coveringFeatures: [],
        coverageStrength: "full" as const,
      };
    }

    const coveringStories: string[] = [];
    const coveringFeatures: string[] = [];
    let bestOverlap = 0;
    let hasDirectIdMatch = false;

    // Normalize requirement ID for direct-match checking (e.g. "FR-05", "NFR-01")
    const reqIdNorm = req.id.replace(/[\s-]+/g, '').toLowerCase();

    for (const artifact of allArtifactTexts) {
      // Direct requirement-ID match: if the artifact text mentions this req's ID, it's a strong signal
      const artifactTextNorm = artifact.text.replace(/[\s-]+/g, '').toLowerCase();
      if (reqIdNorm.length >= 3 && artifactTextNorm.includes(reqIdNorm)) {
        if (artifact.type === "story") {
          if (!coveringStories.includes(artifact.title || artifact.id)) {
            coveringStories.push(artifact.title || artifact.id);
          }
          hasDirectIdMatch = true;
          bestOverlap = Math.max(bestOverlap, 1.0);
        }
        continue; // already a full match, skip keyword overlap for this artifact
      }

      const artifactKeywords = extractKeywords(artifact.text);
      const overlap = [...reqKeywords].filter((k) =>
        artifactKeywords.has(k),
      ).length;
      const overlapRatio =
        reqKeywords.size > 0 ? overlap / reqKeywords.size : 0;

      if (overlapRatio >= 0.25) {
        if (artifact.type === "story") {
          coveringStories.push(artifact.title || artifact.id);
        } else if (artifact.type === "feature") {
          coveringFeatures.push(artifact.title || artifact.id);
        }
        bestOverlap = Math.max(bestOverlap, overlapRatio);
      }
    }

    let coverageStrength: "full" | "partial" | "none" = "none";
    // Multiple matching stories with lower individual overlap still indicates full coverage
    if (coveringStories.length >= 2 && bestOverlap >= 0.35) {
      coverageStrength = "full";
    } else if (coveringStories.length > 0 && bestOverlap >= 0.45) {
      coverageStrength = "full";
    } else if (coveringStories.length > 0 && bestOverlap >= 0.25) {
      coverageStrength = "partial";
    } else if (coveringFeatures.length > 0 && coveringStories.length === 0) {
      coverageStrength = "none";
    }

    return {
      requirementId: req.id,
      requirementName: req.name,
      requirementDescription: req.description,
      covered: coverageStrength !== "none",
      coveringStories: coveringStories.slice(0, 5),
      coveringFeatures: coveringFeatures.slice(0, 3),
      coverageStrength,
    };
  });
}

/** Ensures item is a plain object (not string, null, or array). Used to avoid "Cannot create property on string" when artifacts contain malformed entries. */
function isPlainObject(o: any): boolean {
  return o != null && typeof o === "object" && !Array.isArray(o);
}

function sanitizeArtifactArrays(artifacts: any): void {
  if (Array.isArray(artifacts.epics)) {
    artifacts.epics = artifacts.epics.filter(isPlainObject);
  }
  if (Array.isArray(artifacts.features)) {
    artifacts.features = artifacts.features.filter(isPlainObject);
  }
  if (Array.isArray(artifacts.userStories)) {
    artifacts.userStories = artifacts.userStories.filter(isPlainObject);
  }
}

export function deduplicateArtifacts(
  artifacts: any,
  progressCallback?: (message: string) => void,
): any {
  const result = { ...artifacts };
  sanitizeArtifactArrays(result);

  // ── EPIC DEDUP: Semantic comparison using title + description ──
  if (Array.isArray(result.epics)) {
    const uniqueEpics: any[] = [];
    const epicIdMap = new Map<string, string>();
    for (const epic of result.epics) {
      const duplicate = uniqueEpics.find((e) =>
        areSemanticallyDuplicate(e, epic),
      );
      if (duplicate) {
        epicIdMap.set(epic.id, duplicate.id);
        progressCallback?.(
          `🧹 Dedup: Merged duplicate epic "${epic.title}" into "${duplicate.title}"`,
        );
      } else {
        uniqueEpics.push(epic);
        epicIdMap.set(epic.id, epic.id);
      }
    }
    result.epics = uniqueEpics;
    if (Array.isArray(result.features)) {
      result.features = result.features.map((f: any) => ({
        ...f,
        epicId: epicIdMap.get(f.epicId) || f.epicId,
      }));
    }
  }

  // ── FEATURE DEDUP: Within-epic uses single signal, cross-epic requires both title + description ──
  if (Array.isArray(result.features)) {
    const uniqueFeatures: any[] = [];
    const featureIdMap = new Map<string, string>();
    for (const feature of result.features) {
      const duplicate = uniqueFeatures.find((f) => {
        const sameEpic = f.epicId === feature.epicId;
        return areSemanticallyDuplicate(f, feature, !sameEpic);
      });
      if (duplicate) {
        featureIdMap.set(feature.id, duplicate.id);
        progressCallback?.(
          `🧹 Dedup: Merged duplicate feature "${feature.title}" into "${duplicate.title}"`,
        );
      } else {
        uniqueFeatures.push(feature);
        featureIdMap.set(feature.id, feature.id);
      }
    }
    result.features = uniqueFeatures;
    if (Array.isArray(result.userStories)) {
      result.userStories = result.userStories
        .filter((s: any) => isPlainObject(s))
        .map((s: any) => ({
          ...s,
          featureId: featureIdMap.get(s.featureId) || s.featureId,
        }));
    }
  }

  // ── STORY DEDUP: Within-feature uses single signal, cross-feature requires both title + description ──
  if (Array.isArray(result.userStories)) {
    const uniqueStories: any[] = [];
    for (const story of result.userStories) {
      if (!isPlainObject(story)) continue;
      const duplicate = uniqueStories.find((s) => {
        const sameFeature = s.featureId === story.featureId;
        return areSemanticallyDuplicate(s, story, !sameFeature);
      });
      if (!duplicate) {
        uniqueStories.push(story);
      } else {
        progressCallback?.(
          `🧹 Dedup: Removed duplicate story "${story.title}" (similar to "${duplicate.title}")`,
        );
      }
    }
    result.userStories = uniqueStories;
  }

  return result;
}

const DESCRIPTION_SECTION_HEADERS = [
  'CONTEXT & BACKGROUND',
  'CURRENT STATE',
  'DESIRED STATE',
  'KEY FUNCTIONALITY',
  'USER INTERACTION FLOW',
  'TECHNICAL CONSIDERATIONS',
  'OUT OF SCOPE',
  'SUCCESS METRICS',
];

/**
 * normalizeStoryFormat — content-preserving normalizer.
 *
 * Strict-format normalizer. Every story exits with:
 *   - 8-section description (CONTEXT & BACKGROUND, CURRENT STATE, DESIRED STATE,
 *     KEY FUNCTIONALITY, USER INTERACTION FLOW, TECHNICAL CONSIDERATIONS,
 *     OUT OF SCOPE, SUCCESS METRICS)
 *   - 5 acceptance criteria
 *   - 5 subtasks (Planning / Backend / Frontend / Testing / Documentation)
 *   - 3 test cases (happy path / validation-error / edge case)
 *
 * EVERY synthesized line is grounded in the story's own title — never the
 * historical generic boilerplate ("Manual or incomplete process today",
 * "System supports the capability end-to-end", "Implement API endpoint and
 * business logic", "Define requirements", "Document API and user guide",
 * "Navigate to feature / Page displayed", "scenario N").
 */

// ── Story-grounded synthesizers (parallel to those in ai-service.ts) ──
// Local copies so quality-agent.ts has no cross-file dependency on internals.
// Each synthesizer anchors on a SHORT capability label extracted from the
// title (not the full "I want to X so that Y" phrase) so the synthesized
// content reads as varied, not as eight repetitions of the same sentence.

function extractCapabilityLabelLocal(actionPhrase: string): string {
  let s = (actionPhrase || '').trim();
  if (!s) return 'this capability';
  // Strip "I want to ...", "I want the ...", "I want a ...", "I would like to ...", etc.
  s = s.replace(/^(?:i\s+(?:want|would\s+like|need|wish)\s+(?:to\s+)?)/i, '');
  s = s.replace(/\s+so\s+that\s+.*$/i, '');
  s = s.replace(/[\s.,;:!?]+$/g, '').trim();
  if (s.length > 70) {
    const cut = s.lastIndexOf(' ', 70);
    s = (cut > 30 ? s.substring(0, cut) : s.substring(0, 70)).trim();
  }
  return s || 'this capability';
}

function extractGoalClauseLocal(actionPhrase: string): string {
  const s = (actionPhrase || '').trim();
  const m = s.match(/\bso\s+that\s+(.+)$/i);
  if (!m) return '';
  return m[1].replace(/[\s.,;:!?]+$/g, '').trim();
}

function synthesizeGroundedSubtasksLocal(actionPhrase: string): any[] {
  const cap = extractCapabilityLabelLocal(actionPhrase);
  return [
    { id: 'st-1', category: 'Planning',      description: `Refine acceptance criteria and design constraints for "${cap}"`,                              estimatedHours: 4 },
    { id: 'st-2', category: 'Backend',       description: `Implement the server-side logic, data model changes, and APIs that support "${cap}"`,         estimatedHours: 8 },
    { id: 'st-3', category: 'Frontend',      description: `Build the UI surface, state handling, and integration calls for "${cap}"`,                    estimatedHours: 6 },
    { id: 'st-4', category: 'Testing',       description: `Add unit, integration, and acceptance tests covering happy path and edge cases of "${cap}"`,  estimatedHours: 6 },
    { id: 'st-5', category: 'Documentation', description: `Update user-facing help and developer notes describing how "${cap}" works`,                   estimatedHours: 4 },
  ];
}

function synthesizeGroundedTestCasesLocal(actionPhrase: string): any[] {
  const cap = extractCapabilityLabelLocal(actionPhrase);
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

function synthesizeGroundedAcceptanceCriteriaLocal(actionPhrase: string): string[] {
  const cap = extractCapabilityLabelLocal(actionPhrase);
  const goal = extractGoalClauseLocal(actionPhrase);
  const goalSuffix = goal ? ` so that ${goal}` : '';
  return [
    `Given valid preconditions, when the user performs the action to ${cap}, the action completes successfully${goalSuffix}.`,
    `When required inputs for "${cap}" are missing or invalid, the system blocks completion and shows a specific, actionable error tied to the failing input.`,
    `After the action to ${cap} completes, the resulting state is persisted and remains visible on next navigation to the same screen.`,
    `If the action to ${cap} fails due to a transient backend or network error, the user can retry without losing entered data and the system reports the failure clearly.`,
    `Response time and responsiveness for the action to ${cap} stay within the agreed SLA under typical load and on supported devices.`,
  ];
}

function synthesizeGroundedEightSectionDescriptionLocal(actionPhrase: string, existingContext?: string, compactACs?: string[]): string {
  const cap = extractCapabilityLabelLocal(actionPhrase);
  const goal = extractGoalClauseLocal(actionPhrase);
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

function normalizeStoryFormat(story: any): any {
  if (!isPlainObject(story)) return story;

  const title = typeof story.title === 'string' ? story.title.trim() : 'User story';
  // Strip any "As <persona>, " prefix to get the raw action phrase for synthesis.
  const actionPhrase = title.replace(/^as\s+[^,]+,\s*/i, '').trim() || title;

  // ── Strict-format normalization ──
  // Every story exits with the full strict shape:
  //   - 8-section description
  //   - 5 acceptance criteria
  //   - 5 subtasks
  //   - 3 test cases
  // Every synthesized line is GROUNDED in the story's own title — never
  // generic boilerplate ("Manual or incomplete process today", "Implement
  // API endpoint and business logic", "scenario 4/5", "Navigate to feature").

  // 1. Description: synthesize an 8-section grounded description if the
  // existing one has fewer than 3 section headings.
  const desc = typeof story.description === 'string' ? story.description.trim() : '';
  const sectionCount = (desc.match(/\n[A-Z][A-Z &\/]{2,40}:/g) || []).length + (desc.match(/^[A-Z][A-Z &\/]{2,40}:/m) ? 1 : 0);
  if (sectionCount < 3) {
    const existingACsForDesc = Array.isArray(story.acceptanceCriteria)
      ? story.acceptanceCriteria.filter((ac: any) => typeof ac === 'string' && ac.trim().length > 0)
      : [];
    story.description = synthesizeGroundedEightSectionDescriptionLocal(actionPhrase, desc, existingACsForDesc.length > 0 ? existingACsForDesc : undefined);
  }

  // 2. Acceptance criteria: ensure 5 grounded ACs.
  // Preserve ALL existing grounded ACs from the LLM enrichment pass.
  // Only synthesize when the story has fewer than 3 existing ACs.
  const existingACs = Array.isArray(story.acceptanceCriteria)
    ? story.acceptanceCriteria.filter((ac: any) => typeof ac === 'string' && ac.trim().length > 0)
    : [];
  if (existingACs.length >= 5) {
    story.acceptanceCriteria = existingACs.slice(0, 5);
  } else if (existingACs.length >= 3) {
    // Already has 3-4 grounded ACs — keep them without appending generic boilerplate.
    // The user prefers 3-4 high-quality ACs over 5 where the last 2 are generic.
    story.acceptanceCriteria = existingACs;
  } else {
    story.acceptanceCriteria = synthesizeGroundedAcceptanceCriteriaLocal(actionPhrase);
  }

  // 3. Subtasks: ensure subtasks exist. Preserve existing grounded subtasks
  // from the enrichment pass. Only synthesize from scratch when empty.
  const existingSubtasks = Array.isArray(story.subtasks)
    ? story.subtasks.filter((st: any) => st != null && (typeof st === 'string' ? st.trim().length > 0 : typeof st === 'object'))
    : [];
  if (existingSubtasks.length >= 5) {
    story.subtasks = existingSubtasks.slice(0, 5);
  } else if (existingSubtasks.length >= 2) {
    // Keep existing grounded subtasks — don't replace with template.
    story.subtasks = existingSubtasks;
  } else {
    story.subtasks = synthesizeGroundedSubtasksLocal(actionPhrase);
  }

  // 4. Test cases: ensure 3 grounded test cases (happy / error / edge).
  if (!Array.isArray(story.testCases) || story.testCases.length < 3) {
    story.testCases = synthesizeGroundedTestCasesLocal(actionPhrase);
  }

  // Light-touch normalization on test-case shape (only when the generator
  // produced test cases — preserves all of them, just standardises field names).
  for (const tc of story.testCases) {
    if (isPlainObject(tc) && Array.isArray(tc.steps)) {
      tc.steps = tc.steps.map((s: any, idx: number) => ({
        step: s.step ?? idx + 1,
        action: s.action || s.description || '',
        result: s.result || s.expectedResult || '',
      }));
    }
  }

  // Minimal default scalars when missing — these don't introduce content,
  // they're just metadata defaults so the story passes schema checks.
  if (!story.priority) story.priority = 'Medium';
  if (!story.storyPoints) story.storyPoints = 3;
  // Persona: never default to 'System User' — that masks persona-tagging bugs
  // upstream. If the integrity enforcer + tagPersonasForBrdArtifacts didn't
  // assign a persona, leave it blank so QA can spot the gap.

  return story;
}

function findOrphanFeatures(artifacts: any): any[] {
  if (
    !Array.isArray(artifacts.features) ||
    !Array.isArray(artifacts.userStories)
  )
    return [];
  const featureIdsWithStories = new Set(
    artifacts.userStories.map((s: any) => s.featureId),
  );
  return artifacts.features.filter(
    (f: any) => !featureIdsWithStories.has(f.id),
  );
}

function cleanupOrphanEpics(
  artifacts: any,
  progressCallback?: (message: string) => void,
): { artifacts: any; epicsRemoved: number } {
  const result = { ...artifacts };
  let epicsRemoved = 0;

  if (Array.isArray(result.epics) && Array.isArray(result.features)) {
    // First, ensure that every feature points to a valid epic if any epics exist.
    // In some edge cases, upstream generation can produce features whose epicId
    // does not match any existing epic. This previously caused ALL epics to be
    // treated as "empty" and removed, resulting in 0 epics but many features.
    if (result.epics.length > 0 && result.features.length > 0) {
      const validEpicIds = new Set(result.epics.map((e: any) => e.id));
      const featuresNeedingEpic = result.features.filter(
        (f: any) => !f.epicId || !validEpicIds.has(f.epicId),
      );

      if (featuresNeedingEpic.length > 0) {
        const fallbackEpic = result.epics[0];
        for (const feature of featuresNeedingEpic) {
          feature.epicId = fallbackEpic.id;
        }
        progressCallback?.(
          `🛠️ Cleanup: Attached ${featuresNeedingEpic.length} feature(s) to fallback epic "${fallbackEpic.title}"`,
        );
      }
    }

    const epicIdsWithFeatures = new Set(
      result.features.map((f: any) => f.epicId).filter(Boolean),
    );
    const beforeCount = result.epics.length;
    const orphanEpics = result.epics.filter(
      (e: any) => !epicIdsWithFeatures.has(e.id),
    );
    const remainingEpics = result.epics.filter((e: any) =>
      epicIdsWithFeatures.has(e.id),
    );

    // Safety guard: never remove all epics when features still exist.
    if (
      remainingEpics.length === 0 &&
      beforeCount > 0 &&
      result.features.length > 0
    ) {
      progressCallback?.(
        "ℹ️ Cleanup: No epics currently have linked features — keeping all epics to avoid an empty epic set",
      );
    } else {
      result.epics = remainingEpics;
      epicsRemoved = beforeCount - result.epics.length;
      if (epicsRemoved > 0) {
        for (const oe of orphanEpics) {
          progressCallback?.(
            `🗑️ Cleanup: Removed empty epic "${oe.title}" (0 features)`,
          );
        }
      }
    }
  }

  return { artifacts: result, epicsRemoved };
}

async function generateStoriesForEmptyFeatures(
  artifacts: any,
  progressCallback?: (message: string) => void,
): Promise<{ artifacts: any; storiesGenerated: number }> {
  const result = { ...artifacts };
  const orphanFeatures = findOrphanFeatures(result);
  if (orphanFeatures.length === 0)
    return { artifacts: result, storiesGenerated: 0 };

  progressCallback?.(
    `🔄 Quality Agent: Found ${orphanFeatures.length} feature(s) with 0 user stories — generating stories for them...`,
  );

  const batchSize = 5;
  const batches: any[][] = [];
  for (let i = 0; i < orphanFeatures.length; i += batchSize) {
    batches.push(orphanFeatures.slice(i, i + batchSize));
  }

  const prompt = `You are a requirements agent. Generate COMPACT user stories for features that currently have NO user stories. The downstream enrichment pass will expand each compact story to a strict 8-section description, 5 ACs, 5 subtasks, and 3 test cases — your job here is to be CORRECT and COMPACT so the JSON response fits within token limits.
${personaConstraint}
For EACH feature provided, generate 3-5 compact user stories with:
- title: "As [Persona], I want to [direct verb phrase] so that [outcome]" (natural verb, NOT "perform [noun]", use ONLY allowed personas above)
- description: 1-2 grounded sentences tied to the feature's actual capability (do NOT emit the 8-section structure — enrichment adds that later)
- acceptanceCriteria: 1-3 short grounded strings tied to specific behaviour
- subtasks: 1-2 brief grounded implementation lines (each referencing concrete work for THIS story)
- priority: "Medium"
- storyPoints: 1-8

DO NOT include "testCases" — the enrichment pass adds those.
Keep each story tight: under ~120 words total. NEVER use generic boilerplate ("Manual or incomplete", "Implement API endpoint", "scenario N", "Navigate to feature").

Return JSON:
{
  "stories": [{"title": "...", "description": "...", "featureId": "the-feature-id", "acceptanceCriteria": [...], "subtasks": [...], "priority": "Medium", "storyPoints": N}]
}
${QA_JSON_OUTPUT_CONSTRAINT}`;

  let totalAdded = 0;
  if (!result.userStories) result.userStories = [];

  const genResults = await Promise.allSettled(
    batches.map(async (batch, batchIdx) => {
      const { client, model, instanceName } = getClientAndModel();
      const featureList = batch
        .map((f: any) => {
          const desc =
            typeof f.description === "string"
              ? f.description
              : JSON.stringify(f.description || "");
          return `- ${f.id}: "${f.title}"\n  Description: ${desc.substring(0, 200)}\n  Epic: ${f.epicId}`;
        })
        .join("\n");

      const createParams: any = {
        model,
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: `Features with 0 user stories (generate stories for these):\n${featureList}`,
          },
        ],
        temperature: 0.4,
        max_tokens: 8000,
        response_format: { type: "json_object" as const },
      };

      const response: any = await qaLlmCallWithRetry(
        () => client.chat.completions.create(createParams) as Promise<any>,
        LLM_CALL_TIMEOUT_MS,
        `Empty feature story generation batch ${batchIdx + 1} (${instanceName})`,
      );
      const content = response.choices[0]?.message?.content || "{}";
      const parsed = robustJsonParse(content, `Empty feature stories batch ${batchIdx + 1}`);
      if (!parsed) throw new Error('JSON parse failed after all repair strategies');
      return { parsed, batch, batchIdx };
    }),
  );

  for (const result_ of genResults) {
    if (result_.status === "fulfilled") {
      const { parsed, batch, batchIdx } = result_.value;
      let newStories = Array.isArray(parsed.stories)
        ? parsed.stories
        : Array.isArray(parsed.newStories)
          ? parsed.newStories
          : Array.isArray(parsed.userStories)
            ? parsed.userStories
            : [];
      newStories = newStories.filter(isPlainObject);

      const batchFeatureIds = new Set(batch.map((f: any) => f.id));
      const batchFeatureEpicMap = new Map(batch.map((f: any) => [f.id, f.epicId || '']));
      for (let i = 0; i < newStories.length; i++) {
        const story = newStories[i];
        story.id = `story-orphan-${batchIdx}-${i}-${Date.now()}`;
        story.generatedByQA = true;
        if (!story.featureId || !batchFeatureIds.has(story.featureId)) {
          const targetFeature =
            batch.find(
              (f: any) =>
                story.title
                  ?.toLowerCase()
                  .includes(f.title?.toLowerCase().split(" ")[0]) ||
                story.description
                  ?.toString()
                  .toLowerCase()
                  .includes(f.title?.toLowerCase().split(" ")[0]),
            ) || batch[i % batch.length];
          story.featureId = targetFeature.id;
        }
        story.epicId = batchFeatureEpicMap.get(story.featureId) || batch[0]?.epicId || '';
        if (!story.persona) story.persona = 'System User';
        if (!story.personaId) story.personaId = 'persona-1';
        result.userStories.push(story);
        totalAdded++;
      }

      for (const f of batch) {
        const storiesForFeature = result.userStories.filter(
          (s: any) => s.featureId === f.id,
        );
        if (storiesForFeature.length > 0) {
          progressCallback?.(
            `✅ Quality Agent: Generated ${storiesForFeature.length} stories for empty feature "${f.title}"`,
          );
        }
      }
    } else {
      console.warn(
        `[Quality Agent] Empty feature story generation batch failed:`,
        result_.reason,
      );
      progressCallback?.(
        `⚠️ Quality Agent: Failed to generate stories for some empty features`,
      );
    }
  }

  // STRICT SCOPE LOCK: never inject generic boilerplate stories.
  // If a feature is still empty after LLM-based regeneration, DROP the feature and
  // record it for the quality report. Padding with "I want to use X so that I can
  // benefit from its core functionality" creates fake backlog content that doesn't
  // trace to any requirement. Better to surface the gap.
  const stillEmpty = findOrphanFeatures(result);
  if (stillEmpty.length > 0) {
    const droppedIds = new Set(stillEmpty.map(f => f.id));
    if (Array.isArray(result.features)) {
      result.features = result.features.filter((f: any) => !droppedIds.has(f.id));
    }
    // Drop any feature-less stories that pointed at the now-removed features.
    if (Array.isArray(result.userStories)) {
      result.userStories = result.userStories.filter((s: any) => !droppedIds.has(s?.featureId));
    }
    (result._qualityReport = result._qualityReport || {}).droppedEmptyFeatures = stillEmpty.map(f => ({
      id: f.id,
      title: f.title,
      reason: 'no user stories could be generated from the chunk text',
    }));
    progressCallback?.(
      `⚠️ Quality Agent: Dropped ${stillEmpty.length} empty feature(s) — no boilerplate padding will be injected. See qualityReport.droppedEmptyFeatures for details.`,
    );
  }

  if (totalAdded > 0) {
    progressCallback?.(
      `✅ Quality Agent: Generated ${totalAdded} user stories for ${orphanFeatures.length - stillEmpty.length} previously empty feature(s)`,
    );
  }

  return { artifacts: result, storiesGenerated: totalAdded };
}

export async function runQualityAgent(
  artifacts: any,
  requirementsContent: string,
  progressCallback?: (message: string) => void,
  personaNames?: string[],
): Promise<{ artifacts: any; qualityReport: any }> {
  const startTime = Date.now();
  progressCallback?.(
    "🔎 Quality Agent: Starting quality & traceability analysis...",
  );

  // Build persona constraint for all QA-generated stories
  // If persona names were provided (from golden repo, persona hub, or AI fallback),
  // enforce them so QA gap stories never invent "platform engineer", "backend developer" etc.
  const resolvedPersonas = Array.isArray(personaNames) && personaNames.length > 0
    ? personaNames
    : (() => {
        // Fallback: extract unique persona names from existing story titles
        const personas = new Set<string>();
        for (const s of (artifacts.userStories || [])) {
          const m = typeof s?.title === 'string' && s.title.match(/^As\s+(.+?),\s+I\s+want/i);
          if (m) personas.add(m[1].trim());
        }
        return personas.size > 0 ? [...personas] : ['User'];
      })();
  const personaConstraint = resolvedPersonas.length > 0
    ? `\n\nALLOWED PERSONAS (use ONLY these — do NOT invent personas like "platform engineer", "backend developer", "QA engineer", "database administrator"):\n${resolvedPersonas.map(p => `- ${p}`).join('\n')}\n`
    : '';

  // Sanitize so we never treat strings/primitives as stories or features (avoids "Cannot create property 'featureId' on string")
  sanitizeArtifactArrays(artifacts);

  // ══ STEP 1: DEDUPLICATION ══
  progressCallback?.(
    "🧹 Quality Agent: Running aggressive deduplication (semantic + title matching)...",
  );
  const deduped = deduplicateArtifacts(artifacts, progressCallback);
  const dedupStats = {
    epicsRemoved: (artifacts.epics?.length || 0) - (deduped.epics?.length || 0),
    featuresRemoved:
      (artifacts.features?.length || 0) - (deduped.features?.length || 0),
    storiesRemoved:
      (artifacts.userStories?.length || 0) - (deduped.userStories?.length || 0),
  };

  // ══ STEP 1b: GENERATE STORIES FOR EMPTY FEATURES + CLEANUP EMPTY EPICS ══
  progressCallback?.(
    "🔄 Quality Agent: Checking for features with 0 user stories...",
  );
  const {
    artifacts: filledDeduped,
    storiesGenerated: initialStoriesGenerated,
  } = await generateStoriesForEmptyFeatures(deduped, progressCallback);
  Object.assign(deduped, filledDeduped);

  const { artifacts: cleanedDeduped, epicsRemoved: initialEpicsRemoved } =
    cleanupOrphanEpics(deduped, progressCallback);
  Object.assign(deduped, cleanedDeduped);

  const totalRemoved =
    dedupStats.epicsRemoved +
    dedupStats.featuresRemoved +
    dedupStats.storiesRemoved +
    initialEpicsRemoved;
  if (totalRemoved > 0 || initialStoriesGenerated > 0) {
    progressCallback?.(
      `🧹 Quality Agent: Cleanup summary — Dedup removed: ${dedupStats.epicsRemoved} epics, ${dedupStats.featuresRemoved} features, ${dedupStats.storiesRemoved} stories | Empty epics removed: ${initialEpicsRemoved} | Stories generated for empty features: ${initialStoriesGenerated}`,
    );
  } else {
    progressCallback?.("✅ Quality Agent: No duplicates or orphans found");
  }

  // ══ STEP 2: WITHIN-STORY DEDUPLICATION ══
  if (deduped.userStories && Array.isArray(deduped.userStories)) {
    for (const story of deduped.userStories) {
      if (!isPlainObject(story)) continue;
      if (Array.isArray(story.subtasks) && story.subtasks.length > 0) {
        const seen = new Set<string>();
        story.subtasks = story.subtasks.filter((st: any) => {
          const key = (st.description || "").toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      if (Array.isArray(story.testCases) && story.testCases.length > 0) {
        const seen = new Set<string>();
        story.testCases = story.testCases.filter((tc: any) => {
          const key = (tc.title || "").toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    }
  }

  // ══ STEP 3: BRD REQUIREMENTS COVERAGE CHECK ══
  progressCallback?.(
    "📋 Quality Agent: Parsing BRD requirements for coverage verification...",
  );
  const parsedRequirements = parseBRDRequirements(requirementsContent);
  let coverageResults: RequirementCoverage[] = [];
  let uncoveredRequirements: ParsedRequirement[] = [];
  let partiallyCoveredRequirements: ParsedRequirement[] = [];

  if (parsedRequirements.length > 0) {
    progressCallback?.(
      `📋 Quality Agent: Found ${parsedRequirements.length} BRD requirements — checking coverage against ${deduped.userStories?.length || 0} user stories...`,
    );

    coverageResults = checkRequirementCoverage(parsedRequirements, deduped);
    uncoveredRequirements = parsedRequirements.filter((req) => {
      const coverage = coverageResults.find((c) => c.requirementId === req.id);
      return coverage && coverage.coverageStrength === "none";
    });
    partiallyCoveredRequirements = parsedRequirements.filter((req) => {
      const coverage = coverageResults.find((c) => c.requirementId === req.id);
      return coverage && coverage.coverageStrength === "partial";
    });

    const fullyCovered = coverageResults.filter(
      (c) => c.coverageStrength === "full",
    ).length;
    const partial = partiallyCoveredRequirements.length;
    const missing = uncoveredRequirements.length;
    const total = parsedRequirements.length;
    const coveragePct =
      total > 0
        ? Math.round(((fullyCovered + partial * 0.5) / total) * 100)
        : 100;

    const coverageEmoji =
      coveragePct >= 90 ? "🟢" : coveragePct >= 70 ? "🟡" : "🔴";
    progressCallback?.(
      `${coverageEmoji} Quality Agent: BRD Coverage — ${coveragePct}% (${fullyCovered} full, ${partial} partial, ${missing} missing out of ${total} requirements)`,
    );

    if (missing > 0) {
      progressCallback?.(
        `   ❌ Missing coverage for: ${uncoveredRequirements
          .slice(0, 5)
          .map((r) => `"${r.name}"`)
          .join(", ")}${missing > 5 ? ` and ${missing - 5} more` : ""}`,
      );
    }
    if (partial > 0) {
      progressCallback?.(
        `   ⚠️ Partial coverage for: ${partiallyCoveredRequirements
          .slice(0, 3)
          .map((r) => `"${r.name}"`)
          .join(", ")}${partial > 3 ? ` and ${partial - 3} more` : ""}`,
      );
    }
  } else {
    progressCallback?.(
      "📋 Quality Agent: No structured BRD requirements detected — skipping coverage check",
    );
  }

  // ══ STEP 3b: LLM-POWERED COVERAGE VERIFICATION (for uncovered + partial) ══
  if (
    (uncoveredRequirements.length > 0 ||
      partiallyCoveredRequirements.length > 0) &&
    parsedRequirements.length > 0
  ) {
    try {
      const { client, model, instanceName } = getClientForTaskIndex(0);

      if (client) {
        const flaggedReqs = [
          ...uncoveredRequirements,
          ...partiallyCoveredRequirements,
        ].slice(0, 15);
        const storyTitles = (deduped.userStories || []).map((s: any) => {
          const acSummary = Array.isArray(s.acceptanceCriteria)
            ? ` | AC: ${s.acceptanceCriteria.slice(0, 2).join("; ")}`
            : "";
          const descSnippet = s.description
            ? ` | ${s.description.substring(0, 100)}`
            : "";
          return `${s.id}: ${s.title}${descSnippet}${acSummary}`;
        });

        progressCallback?.(
          `🔍 Quality Agent: LLM verifying coverage for ${flaggedReqs.length} flagged requirements on instance ${instanceName}...`,
        );

        const verifyResponse: any = await qaLlmCallWithRetry(
          () => client.chat.completions.create({
            model,
            messages: [
              {
                role: "system",
                content: `You are a requirements traceability agent. Given a list of BRD functional requirements and generated user story titles, determine which requirements are truly UNCOVERED (no user story addresses them at all).

A requirement is COVERED if any user story addresses its core intent, even if the exact wording differs.
A requirement is UNCOVERED only if NO user story addresses its core functionality.

Return JSON:
{
  "uncoveredRequirementIds": ["id1", "id2"],
  "analysis": [
    {"requirementId": "id", "covered": true/false, "matchingStory": "story title or null", "reason": "brief explanation"}
  ]
}
${QA_JSON_OUTPUT_CONSTRAINT}`,
              },
              {
                role: "user",
                content: `BRD Requirements to verify:\n${flaggedReqs.map((r) => `- ${r.id}: ${r.name}\n  Description: ${r.description.substring(0, 200)}`).join("\n")}\n\nGenerated User Stories:\n${storyTitles.join("\n")}`,
              },
            ],
            temperature: 0.1,
            max_tokens: 2000,
            response_format: { type: "json_object" as const },
          }),
          LLM_CALL_TIMEOUT_MS,
          `Coverage verification (${instanceName})`,
        );

        const verifyContent =
          verifyResponse.choices[0]?.message?.content || "{}";
        try {
          const verifyParsed = robustJsonParse(verifyContent, 'Coverage verification') || {};
          const llmUncoveredIds = new Set<string>(
            verifyParsed.uncoveredRequirementIds || [],
          );

          const llmCoveredIds = new Set<string>();
          for (const analysis of verifyParsed.analysis || []) {
            const existing = coverageResults.find(
              (c) => c.requirementId === analysis.requirementId,
            );
            if (existing && analysis.covered) {
              existing.covered = true;
              existing.coverageStrength = "full";
              if (analysis.matchingStory) {
                existing.coveringStories = [analysis.matchingStory];
              }
              llmCoveredIds.add(analysis.requirementId);
            }
          }

          uncoveredRequirements = parsedRequirements.filter(
            (req) => llmUncoveredIds.has(req.id) && !llmCoveredIds.has(req.id),
          );
          partiallyCoveredRequirements = partiallyCoveredRequirements.filter(
            (req) => !llmCoveredIds.has(req.id),
          );

          const corrected = llmCoveredIds.size;
          if (corrected > 0) {
            progressCallback?.(
              `🔍 Quality Agent: LLM verified ${corrected} requirement(s) are actually covered (semantic match) — ${uncoveredRequirements.length} truly uncovered, ${partiallyCoveredRequirements.length} partial`,
            );
          }
        } catch { }
      }
    } catch (err) {
      console.warn(
        "[Quality Agent] LLM coverage verification failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ══ STEP 4b: START ARCHITECTURAL LAYER CHECK IN PARALLEL (awaited after Step 4) ══
  // Start architectural verification early so it runs concurrently with gap story generation
  const archLayerPromiseEarly = (async () => {
    progressCallback?.(
      "🏗️ Quality Agent: Checking mandatory architectural layers (parallel)...",
    );
    const archLayerCoverage = checkArchitecturalLayerCoverage(deduped);
    const missingLayers = archLayerCoverage.filter((l) => !l.covered);
    const coveredLayers = archLayerCoverage.filter((l) => l.covered);

    progressCallback?.(
      `🏗️ Quality Agent: Architectural layers — ${coveredLayers.length}/${archLayerCoverage.length} covered, ${missingLayers.length} missing`,
    );
    if (missingLayers.length === 0) {
      progressCallback?.(
        "✅ Quality Agent: All mandatory architectural layers are covered",
      );
      return { missingLayers: [] as typeof missingLayers, coveredLayers };
    }
    return { missingLayers, coveredLayers };
  })();

  // ══ STEP 4: GENERATE MISSING STORIES FOR UNCOVERED + PARTIALLY COVERED REQUIREMENTS ══
  const requirementsNeedingGapStories = [
    ...uncoveredRequirements,
    ...partiallyCoveredRequirements,
  ];
  if (requirementsNeedingGapStories.length > 0) {
    progressCallback?.(
      `🔄 Quality Agent: Generating gap stories for ${uncoveredRequirements.length} uncovered + ${partiallyCoveredRequirements.length} partially covered BRD requirement(s) in parallel across ${workflowAzureInstances.length || 1} instance(s)...`,
    );

    const existingEpics = deduped.epics || [];
    const existingFeatures = deduped.features || [];
    const batchSize = 5;
    const batches: ParsedRequirement[][] = [];
    for (
      let batchStart = 0;
      batchStart < requirementsNeedingGapStories.length;
      batchStart += batchSize
    ) {
      batches.push(
        requirementsNeedingGapStories.slice(batchStart, batchStart + batchSize),
      );
    }

    const gapPrompt = `You are a requirements coverage agent. Generate user stories for BRD functional requirements that have NO or WEAK coverage in the existing artifact set.
${personaConstraint}
For EACH uncovered or partially covered requirement, generate ADDITIONAL user stories to ensure FULL coverage:
1. A feature (if no existing feature covers this area)
2. One or more COMPACT user stories with:
   - title: "As [Persona], I want to [direct verb phrase] so that [outcome]" (natural verb, NOT "perform [noun]", use ONLY allowed personas above)
   - description: 1-2 grounded sentences directly addressing the BRD requirement (do NOT emit an 8-section structure — enrichment adds that later)
   - acceptanceCriteria: 1-3 short grounded strings tied to the requirement's specific behaviour (no "scenario N" filler)
   - subtasks: 1-2 brief grounded implementation lines (no "Implement API endpoint" / "Document API and user guide" boilerplate)
   - priority: "High" (these are missing BRD requirements)
   - storyPoints: 1-8

DO NOT include "testCases" — the enrichment pass adds those.
Assign each story to the most relevant existing feature, or create a new feature if none fits.
IMPORTANT: Each feature must have at most 7 user stories total.
Keep each story compact (under ~120 words). The downstream enrichment pass will expand to the strict 8-section + 5 AC + 5 subtask + 3 test case format.

Return JSON:
{
  "newFeatures": [{"id": "feat-gap-N", "title": "...", "description": "...", "epicId": "existing-epic-id"}],
  "newStories": [{"title": "...", "description": "...", "featureId": "existing-or-new-feat-id", "acceptanceCriteria": [...], "subtasks": [...], "priority": "High", "storyPoints": N, "sourceRequirementId": "req-id"}]
}
${QA_JSON_OUTPUT_CONSTRAINT}`;

    progressCallback?.(
      `🔄 Quality Agent: Processing ${batches.length} batch(es) of gap stories in batches of ${qaConcurrencyLimit}...`,
    );

    const gapResults: PromiseSettledResult<{
      parsed: any;
      batch: ParsedRequirement[];
      batchIdx: number;
    }>[] = [];
    for (let i = 0; i < batches.length; i += qaConcurrencyLimit) {
      const batchSlice = batches.slice(i, i + qaConcurrencyLimit);
      const batchSettled = await Promise.allSettled(
        batchSlice.map(async (batch, j) => {
          const batchIdx = i + j;
          const {
            client: gapClient,
            model: gapModel,
            instanceName,
          } = getClientForTaskIndex(batchIdx);
          const reqList = batch
            .map(
              (r) =>
                `- ${r.id}: ${r.name}\n  Description: ${r.description.substring(0, 300)}`,
            )
            .join("\n");

          const createParams: any = {
            model: gapModel,
            messages: [
              { role: "system", content: gapPrompt },
              {
                role: "user",
                content: `UNCOVERED BRD Requirements (generate stories for these):\n${reqList}\n\nExisting Epics:\n${existingEpics.map((e: any) => `- ${e.id}: ${e.title}`).join("\n")}\n\nExisting Features:\n${existingFeatures.map((f: any) => `- ${f.id}: ${f.title} (epic: ${f.epicId})`).join("\n")}`,
              },
            ],
            temperature: 0.4,
            max_tokens: 8000,
            response_format: { type: "json_object" as const },
          };

          const gapResponse: any = await qaLlmCallWithRetry(
            () => gapClient.chat.completions.create(createParams) as Promise<any>,
            LLM_CALL_TIMEOUT_MS,
            `Gap story generation batch ${batchIdx + 1} (${instanceName})`,
          );
          const gapContent = gapResponse.choices[0]?.message?.content || "{}";
          const parsed = robustJsonParse(gapContent, `Gap stories batch ${batchIdx + 1}`);
          if (!parsed) throw new Error('JSON parse failed after all repair strategies');
          return { parsed, batch, batchIdx };
        }),
      );
      gapResults.push(...batchSettled);
    }

    for (const result of gapResults) {
      if (result.status === "fulfilled") {
        const { parsed, batch, batchIdx } = result.value;
        if (parsed) {
          const newFeatures = (
            Array.isArray(parsed.newFeatures) ? parsed.newFeatures : []
          ).filter(isPlainObject);
          let newStories = Array.isArray(parsed.newStories)
            ? parsed.newStories
            : Array.isArray(parsed.stories)
              ? parsed.stories
              : Array.isArray(parsed.userStories)
                ? parsed.userStories
                : [];
          newStories = newStories.filter(isPlainObject);

          for (const feat of newFeatures) {
            if (!feat.id)
              feat.id = `feat-gap-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
            if (
              !feat.epicId ||
              !existingEpics.some((e: any) => e.id === feat.epicId)
            ) {
              feat.epicId = existingEpics[0]?.id;
            }
            if (
              !deduped.features.some((f: any) =>
                areSimilarTitles(f.title, feat.title),
              )
            ) {
              deduped.features.push(feat);
            }
          }

          const MAX_STORIES_PER_FEATURE = 7;
          const storyCountByFeature = new Map<string, number>();
          for (const s of deduped.userStories) {
            storyCountByFeature.set(s.featureId, (storyCountByFeature.get(s.featureId) || 0) + 1);
          }

          let addedCount = 0;
          for (let i = 0; i < newStories.length; i++) {
            const story = newStories[i];
            if (!isPlainObject(story)) continue;
            story.id = `story-gap-${batchIdx * batchSize + i + 1}-${Date.now()}`;
            story.generatedByQA = true;
            if (
              !story.featureId ||
              !deduped.features.some((f: any) => f.id === story.featureId)
            ) {
              const matchingNewFeat = newFeatures.find(
                (nf: any) => nf.id === story.featureId,
              );
              story.featureId =
                matchingNewFeat?.id ||
                existingFeatures[0]?.id ||
                deduped.features[0]?.id;
            }
            const currentCount = storyCountByFeature.get(story.featureId) || 0;
            if (currentCount >= MAX_STORIES_PER_FEATURE) {
              continue;
            }
            if (
              !deduped.userStories.some((s: any) =>
                areSimilarTitles(s.title, story.title),
              )
            ) {
              deduped.userStories.push(story);
              storyCountByFeature.set(story.featureId, currentCount + 1);
              addedCount++;
            }
          }

          if (addedCount > 0 || newFeatures.length > 0) {
            progressCallback?.(
              `✅ Quality Agent: Batch ${batchIdx + 1} — generated ${addedCount} new stories and ${newFeatures.length} new features`,
            );
          }

          for (const req of batch) {
            const coverage = coverageResults.find(
              (c) => c.requirementId === req.id,
            );
            if (coverage) {
              const matchingStories = newStories.filter(
                (s: any) => s.sourceRequirementId === req.id,
              );
              if (matchingStories.length > 0) {
                coverage.covered = true;
                coverage.coverageStrength = "full";
                coverage.coveringStories = matchingStories.map(
                  (s: any) => s.title || s.id,
                );
              }
            }
          }
        }
      } else {
        console.warn(
          `[Quality Agent] Gap story generation batch failed:`,
          result.reason,
        );
        progressCallback?.(
          `⚠️ Quality Agent: Story generation failed for some uncovered requirements — these gaps remain`,
        );
      }
    }
  }

  // ══ STEP 4b: GENERATE STORIES FOR MISSING ARCHITECTURAL LAYERS ══
  const { missingLayers, coveredLayers } = await archLayerPromiseEarly;
  const archLayerPromise = (async () => {
    if (missingLayers.length === 0) return;
    progressCallback?.(
      `   ❌ Missing layers: ${missingLayers.map((l: any) => l.layerName).join(", ")}`,
    );

    const {
      client: archClient,
      model: archModel,
      instanceName: archInstanceName,
    } = getClientForTaskIndex(qaNumInstances > 1 ? qaNumInstances - 1 : 0);

    if (!archClient) return;

    progressCallback?.(
      `🔄 Quality Agent: Generating stories for ${missingLayers.length} missing architectural layers on ${archInstanceName}...`,
    );

    const layerDescriptions = missingLayers
      .map((l) => {
        const layerDef = MANDATORY_ARCHITECTURAL_LAYERS.find(
          (ml) => ml.id === l.layerId,
        );
        return `- ${l.layerName}: ${layerDef?.description || ""}`;
      })
      .join("\n");

    try {
      const existingEpics = deduped.epics || [];
      const existingFeatures = deduped.features || [];

      const archResponse: any = await qaLlmCallWithRetry(
        () => archClient.chat.completions.create({
          model: archModel,
          messages: [
            {
              role: "system",
              content: `You are an enterprise architecture completeness agent. The generated artifacts are missing critical architectural layers that MUST be present in any production-ready system.
${personaConstraint}
For EACH missing architectural layer, generate COMPACT artifacts. The downstream enrichment pass will expand each story to a strict 8-section description, 5 ACs, 5 subtasks, and 3 test cases — your job here is to be CORRECT and COMPACT so the JSON response fits within token limits.

1. A new feature under the most relevant existing epic (or create a "Platform Architecture" epic if needed)
2. 3-5 COMPACT user stories per missing layer with:
   - title: "As [Persona], I want to [direct verb phrase] so that [outcome]" (natural verb, NOT "perform [noun]", use ONLY allowed personas above)
   - description: 1-2 grounded sentences specific to this architectural concern (do NOT emit the 8-section structure — enrichment adds that later)
   - acceptanceCriteria: 1-3 short grounded strings tied to the architectural concern (no "scenario N" filler)
   - subtasks: 1-2 brief grounded implementation lines (no generic "Implement API endpoint" boilerplate)
   - priority: "High"
   - storyPoints: 3-8

DO NOT include "testCases" — the enrichment pass adds those.
Keep each story compact (under ~120 words). The downstream enrichment expands to the strict format.

Return JSON:
{
  "newEpic": {"id": "epic-arch-platform", "title": "Platform Architecture & Cross-Cutting Concerns", "description": "..."} or null,
  "newFeatures": [{"id": "feat-arch-N", "title": "...", "description": "...", "epicId": "..."}],
  "newStories": [{"title": "...", "description": "...", "featureId": "feat-arch-N", "acceptanceCriteria": [...], "subtasks": [...], "priority": "High", "storyPoints": N, "architecturalLayer": "layer-id"}]
}
${QA_JSON_OUTPUT_CONSTRAINT}`,
            },
            {
              role: "user",
              content: `MISSING ARCHITECTURAL LAYERS (generate stories for these):\n${layerDescriptions}\n\nExisting Epics:\n${existingEpics.map((e: any) => `- ${e.id}: ${e.title}`).join("\n")}\n\nExisting Features:\n${existingFeatures.map((f: any) => `- ${f.id}: ${f.title} (epic: ${f.epicId})`).join("\n")}`,
            },
          ],
          temperature: 0.4,
          max_tokens: 12000,
          response_format: { type: "json_object" as const },
        }),
        LLM_CALL_TIMEOUT_MS,
        `Architectural layer generation (${archInstanceName})`,
      );
      const archContent = archResponse.choices[0]?.message?.content || "{}";

      try {
        const parsed = robustJsonParse(archContent, 'Architectural layer generation');

        if (parsed) {
          if (parsed.newEpic && parsed.newEpic.title) {
            if (
              !deduped.epics.some((e: any) =>
                areSimilarTitles(e.title, parsed.newEpic.title),
              )
            ) {
              if (!parsed.newEpic.id)
                parsed.newEpic.id = `epic-arch-${Date.now()}`;
              deduped.epics.push(parsed.newEpic);
              progressCallback?.(
                `✅ Quality Agent: Created architecture epic: "${parsed.newEpic.title}"`,
              );
            }
          }

          const newFeatures = (
            Array.isArray(parsed.newFeatures) ? parsed.newFeatures : []
          ).filter(isPlainObject);
          let newStories = Array.isArray(parsed.newStories)
            ? parsed.newStories
            : Array.isArray(parsed.stories)
              ? parsed.stories
              : Array.isArray(parsed.userStories)
                ? parsed.userStories
                : [];
          newStories = newStories.filter(isPlainObject);

          for (const feat of newFeatures) {
            if (!feat.id)
              feat.id = `feat-arch-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
            if (
              !feat.epicId ||
              !deduped.epics.some((e: any) => e.id === feat.epicId)
            ) {
              feat.epicId = parsed.newEpic?.id || existingEpics[0]?.id;
            }
            if (
              !deduped.features.some((f: any) =>
                areSimilarTitles(f.title, feat.title),
              )
            ) {
              deduped.features.push(feat);
            }
          }

          const MAX_STORIES_PER_FEATURE_ARCH = 7;
          const archStoryCount = new Map<string, number>();
          for (const s of deduped.userStories) {
            archStoryCount.set(s.featureId, (archStoryCount.get(s.featureId) || 0) + 1);
          }

          let archStoriesAdded = 0;
          for (let i = 0; i < newStories.length; i++) {
            const story = newStories[i];
            if (!isPlainObject(story)) continue;
            story.id = `story-arch-${i + 1}-${Date.now()}`;
            story.generatedByQA = true;
            if (
              !story.featureId ||
              !deduped.features.some((f: any) => f.id === story.featureId)
            ) {
              const matchFeat = newFeatures.find(
                (nf: any) => nf.id === story.featureId,
              );
              story.featureId =
                matchFeat?.id ||
                newFeatures[0]?.id ||
                existingFeatures[0]?.id ||
                deduped.features[0]?.id;
            }
            const curCount = archStoryCount.get(story.featureId) || 0;
            if (curCount >= MAX_STORIES_PER_FEATURE_ARCH) {
              continue;
            }
            if (
              !deduped.userStories.some((s: any) =>
                areSimilarTitles(s.title, story.title),
              )
            ) {
              deduped.userStories.push(story);
              archStoryCount.set(story.featureId, curCount + 1);
              archStoriesAdded++;
            }
          }

          progressCallback?.(
            `✅ Quality Agent: Generated ${archStoriesAdded} stories and ${newFeatures.length} features for missing architectural layers`,
          );
        }
      } catch {
        progressCallback?.(
          `⚠️ Quality Agent: Could not parse architectural layer stories — missing layers remain as gaps`,
        );
      }
    } catch (archErr) {
      console.warn(
        "[Quality Agent] Architectural layer generation failed:",
        archErr instanceof Error ? archErr.message : String(archErr),
      );
      progressCallback?.(
        `⚠️ Quality Agent: Architectural layer story generation failed — missing layers remain as gaps`,
      );
    }
  })();

  // Wait for architectural layer verification to complete (it ran in parallel with gap stories above)
  await archLayerPromise;

  // ══ STEPS 5 + 6: SCORING & SCORE-DRIVEN REGENERATION — REMOVED ══
  // Per-epic LLM quality scoring (overallScore / INVEST / traceability /
  // completeness / duplicateRisk + gaps/strengths) and the score-threshold
  // regeneration pass have been removed. They added ~minutes of LLM calls
  // for marginal value, and the score-driven regeneration was a frequent
  // source of templated rewrites that overrode grounded LLM output.
  //
  // Coverage-based remediation (Step 6b below) and architectural-layer
  // verification (Step 4 above) still run — they operate on parsed BRD
  // requirements, not on subjective scores.

  // ══ STEP 6b: COVERAGE REMEDIATION ══
  // After scoring + regeneration, re-check BRD coverage and generate targeted stories for any remaining gaps
  if (parsedRequirements.length > 0) {
    const postCoverage = checkRequirementCoverage(parsedRequirements, deduped);
    const stillUncovered = parsedRequirements.filter((req) => {
      const cov = postCoverage.find((c) => c.requirementId === req.id);
      return (
        cov &&
        (cov.coverageStrength === "none" || cov.coverageStrength === "partial")
      );
    });

    if (stillUncovered.length > 0) {
      progressCallback?.(
        `🔄 Quality Agent: Post-scoring remediation — ${stillUncovered.length} requirement(s) still lack full coverage. Generating targeted gap stories...`,
      );

      const remBatchSize = 5;
      const remBatches: ParsedRequirement[][] = [];
      for (let i = 0; i < stillUncovered.length; i += remBatchSize) {
        remBatches.push(stillUncovered.slice(i, i + remBatchSize));
      }

      const remediationPrompt = `You are a requirements coverage remediation agent. The following BRD requirements still lack FULL coverage after initial artifact generation.
${personaConstraint}
Generate TARGETED COMPACT user stories that DIRECTLY and EXPLICITLY address each requirement. The downstream enrichment pass will expand each story to a strict 8-section description, 5 ACs, 5 subtasks, and 3 test cases — your job here is to be CORRECT and COMPACT so the JSON response fits within token limits.

Each story MUST:
- Directly reference the requirement it covers
- title: "As [Persona], I want to [direct verb phrase] so that [outcome]" (natural verb, NOT "perform [noun]", use ONLY allowed personas above)
- description: 1-2 grounded sentences directly addressing the requirement (do NOT emit the 8-section structure — enrichment adds that later)
- acceptanceCriteria: 1-3 short grounded strings tied to the requirement (no "scenario N" filler)
- subtasks: 1-2 brief grounded implementation lines (no generic "Implement API endpoint" / "Document API and user guide" boilerplate)
- priority: "High"
- storyPoints: 1-8

DO NOT include "testCases" — the enrichment pass adds those.
Keep each story compact (under ~120 words). The downstream enrichment expands to the strict format.

Return JSON:
{
  "newFeatures": [{"id": "feat-rem-N", "title": "...", "description": "...", "epicId": "existing-epic-id"}],
  "newStories": [{"title": "...", "description": "...", "featureId": "...", "acceptanceCriteria": [...], "subtasks": [...], "priority": "High", "storyPoints": N, "sourceRequirementId": "req-id"}]
}
${QA_JSON_OUTPUT_CONSTRAINT}`;

      const existingEpics = deduped.epics || [];
      const existingFeatures = deduped.features || [];

      // Run ALL remediation batches in parallel (distributed across instances), then merge results sequentially
      const remResults = await Promise.allSettled(
        remBatches.map(async (batch, batchIdx) => {
          const {
            client: remClient,
            model: remModel,
            instanceName,
          } = getClientForTaskIndex(batchIdx);
          const reqList = batch
            .map((r) => {
              const cov = postCoverage.find((c) => c.requirementId === r.id);
              const existingStories =
                cov?.coveringStories?.join(", ") || "none";
              return `- ${r.id}: ${r.name}\n  Description: ${r.description.substring(0, 300)}\n  Current coverage: ${cov?.coverageStrength || "none"} (existing stories: ${existingStories})`;
            })
            .join("\n");

          const remResponse: any = await qaLlmCallWithRetry(
            () => remClient.chat.completions.create({
              model: remModel,
              messages: [
                { role: "system", content: remediationPrompt },
                {
                  role: "user",
                  content: `REQUIREMENTS STILL NEEDING COVERAGE:\n${reqList}\n\nExisting Epics:\n${existingEpics.map((e: any) => `- ${e.id}: ${e.title}`).join("\n")}\n\nExisting Features:\n${existingFeatures.map((f: any) => `- ${f.id}: ${f.title} (epic: ${f.epicId})`).join("\n")}`,
                },
              ],
              temperature: 0.4,
              max_tokens: 8000,
              response_format: { type: "json_object" as const },
            }),
            LLM_CALL_TIMEOUT_MS,
            `Post-scoring remediation batch ${batchIdx + 1} (${instanceName})`,
          );
          const content = remResponse.choices[0]?.message?.content || "{}";
          const parsed = robustJsonParse(content, `Post-scoring remediation batch ${batchIdx + 1}`);
          if (!parsed) throw new Error('JSON parse failed after all repair strategies');
          return { parsed, batch, batchIdx };
        }),
      );

      // Merge results into deduped SEQUENTIALLY (avoid concurrent mutation)
      let totalRemStories = 0;
      let totalRemFeatures = 0;
      for (const result of remResults) {
        if (result.status === "fulfilled") {
          const { parsed, batch, batchIdx } = result.value;
          if (parsed) {
            const newFeatures = (
              Array.isArray(parsed.newFeatures) ? parsed.newFeatures : []
            ).filter(isPlainObject);
            let newStories = Array.isArray(parsed.newStories)
              ? parsed.newStories
              : Array.isArray(parsed.stories)
                ? parsed.stories
                : Array.isArray(parsed.userStories)
                  ? parsed.userStories
                  : [];
            newStories = newStories.filter(isPlainObject);

            for (const feat of newFeatures) {
              if (!feat.id)
                feat.id = `feat-rem-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
              if (
                !feat.epicId ||
                !existingEpics.some((e: any) => e.id === feat.epicId)
              ) {
                feat.epicId = existingEpics[0]?.id;
              }
              if (
                !deduped.features.some((f: any) =>
                  areSimilarTitles(f.title, feat.title),
                )
              ) {
                deduped.features.push(feat);
                totalRemFeatures++;
              }
            }

            const MAX_STORIES_PER_FEATURE_REM = 7;
            const remStoryCount = new Map<string, number>();
            for (const s of deduped.userStories) {
              remStoryCount.set(s.featureId, (remStoryCount.get(s.featureId) || 0) + 1);
            }

            for (let i = 0; i < newStories.length; i++) {
              const story = newStories[i];
              if (!isPlainObject(story)) continue;
              story.id = `story-rem-b${batchIdx}-s${i + 1}-${Math.random().toString(36).substring(2, 8)}`;
              story.generatedByQA = true;
              if (
                !story.featureId ||
                !deduped.features.some((f: any) => f.id === story.featureId)
              ) {
                const matchFeat = newFeatures.find(
                  (nf: any) => nf.id === story.featureId,
                );
                story.featureId =
                  matchFeat?.id ||
                  existingFeatures[0]?.id ||
                  deduped.features[0]?.id;
              }
              const curCount = remStoryCount.get(story.featureId) || 0;
              if (curCount >= MAX_STORIES_PER_FEATURE_REM) {
                continue;
              }
              if (
                !deduped.userStories.some((s: any) =>
                  areSimilarTitles(s.title, story.title),
                )
              ) {
                deduped.userStories.push(story);
                remStoryCount.set(story.featureId, curCount + 1);
                totalRemStories++;
              }
            }

            for (const req of batch) {
              const coverage = coverageResults.find(
                (c) => c.requirementId === req.id,
              );
              if (coverage) {
                const matchingStories = newStories.filter(
                  (s: any) => s.sourceRequirementId === req.id,
                );
                if (matchingStories.length > 0) {
                  coverage.covered = true;
                  coverage.coverageStrength = "full";
                  coverage.coveringStories = [
                    ...(coverage.coveringStories || []),
                    ...matchingStories.map((s: any) => s.title || s.id),
                  ];
                }
              }
            }
          }
        } else {
          console.warn(
            `[Quality Agent] Remediation batch failed:`,
            result.reason,
          );
        }
      }

      if (totalRemStories > 0 || totalRemFeatures > 0) {
        progressCallback?.(
          `✅ Quality Agent: Post-scoring remediation generated ${totalRemStories} stories and ${totalRemFeatures} features for remaining coverage gaps`,
        );
      }
    } else {
      progressCallback?.(
        `✅ Quality Agent: Post-scoring check — all ${parsedRequirements.length} BRD requirements have full coverage`,
      );
    }
  }

  // ══ STEP 7: FINAL DEDUPLICATION + STORY GEN FOR EMPTY FEATURES + CLEANUP ══
  progressCallback?.("🧹 Quality Agent: Running final deduplication pass...");
  const finalDeduped = deduplicateArtifacts(deduped, progressCallback);

  // Generate stories for any remaining empty features after final dedup
  const { artifacts: finalFilled, storiesGenerated: finalStoriesGenerated } =
    await generateStoriesForEmptyFeatures(finalDeduped, progressCallback);
  Object.assign(finalDeduped, finalFilled);

  const { artifacts: finalArtifacts, epicsRemoved: finalEpicsRemoved } =
    cleanupOrphanEpics(finalDeduped, progressCallback);

  const finalDedupEpics =
    (deduped.epics?.length || 0) - (finalDeduped.epics?.length || 0);
  const finalDedupFeatures =
    (deduped.features?.length || 0) - (finalDeduped.features?.length || 0);
  const finalDedupStories =
    (deduped.userStories?.length || 0) -
    (finalDeduped.userStories?.length || 0);
  const finalTotalCleaned =
    finalDedupEpics +
    finalDedupFeatures +
    finalDedupStories +
    finalEpicsRemoved;
  if (finalTotalCleaned > 0 || finalStoriesGenerated > 0) {
    progressCallback?.(
      `🧹 Quality Agent: Final cleanup — Dedup: ${finalDedupEpics} epics, ${finalDedupFeatures} features, ${finalDedupStories} stories | Empty epics removed: ${finalEpicsRemoved} | Stories generated for empty features: ${finalStoriesGenerated}`,
    );
  } else {
    progressCallback?.(
      "✅ Quality Agent: Final pass — no additional duplicates or orphans found",
    );
  }

  // Update dedup stats totals
  dedupStats.epicsRemoved += finalDedupEpics + finalEpicsRemoved;
  dedupStats.featuresRemoved += finalDedupFeatures;
  dedupStats.storiesRemoved += finalDedupStories;

  progressCallback?.(
    `📊 Quality Agent: Final artifact counts — ${finalArtifacts.epics?.length || 0} epics, ${finalArtifacts.features?.length || 0} features, ${finalArtifacts.userStories?.length || 0} user stories`,
  );

  // ══ STEP 8: FINAL COVERAGE SUMMARY ══
  const finalCoverageResults =
    parsedRequirements.length > 0
      ? checkRequirementCoverage(parsedRequirements, finalArtifacts)
      : [];
  const finalFullyCovered = finalCoverageResults.filter(
    (c) => c.coverageStrength === "full",
  ).length;
  const finalPartial = finalCoverageResults.filter(
    (c) => c.coverageStrength === "partial",
  ).length;
  const finalMissing = finalCoverageResults.filter(
    (c) => c.coverageStrength === "none",
  ).length;
  const finalCoveragePct =
    parsedRequirements.length > 0
      ? Math.round(
        ((finalFullyCovered + finalPartial * 0.5) /
          parsedRequirements.length) *
        100,
      )
      : 100;

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Re-check architectural layers after generation
  const finalArchCoverage = checkArchitecturalLayerCoverage(finalArtifacts);
  const finalArchCovered = finalArchCoverage.filter((l) => l.covered).length;
  const finalArchMissing = finalArchCoverage.filter((l) => !l.covered);

  if (parsedRequirements.length > 0) {
    progressCallback?.(
      `📋 Quality Agent: Final BRD Coverage — ${finalCoveragePct}% (${finalFullyCovered} full, ${finalPartial} partial, ${finalMissing} missing out of ${parsedRequirements.length})`,
    );
  }
  progressCallback?.(
    `🏗️ Quality Agent: Final Architectural Layers — ${finalArchCovered}/${MANDATORY_ARCHITECTURAL_LAYERS.length} covered${finalArchMissing.length > 0 ? ` (still missing: ${finalArchMissing.map((l) => l.layerName).join(", ")})` : ""}`,
  );
  progressCallback?.(
    `✅ Quality Agent: Analysis complete (${duration}s)`,
  );

  // ══ FINAL: RENUMBER ALL ARTIFACT IDs SEQUENTIALLY ══
  if (Array.isArray(finalArtifacts.epics)) {
    const epicIdMap = new Map<string, string>();
    finalArtifacts.epics.forEach((epic: any, idx: number) => {
      const newId = `epic-${idx + 1}`;
      epicIdMap.set(epic.id, newId);
      epic.id = newId;
    });
    if (Array.isArray(finalArtifacts.features)) {
      finalArtifacts.features.forEach((f: any) => {
        if (epicIdMap.has(f.epicId)) f.epicId = epicIdMap.get(f.epicId);
      });
    }
    if (Array.isArray(finalArtifacts.userStories)) {
      finalArtifacts.userStories.forEach((s: any) => {
        if (epicIdMap.has(s.epicId)) s.epicId = epicIdMap.get(s.epicId);
      });
    }
  }
  if (Array.isArray(finalArtifacts.features)) {
    const featureIdMap = new Map<string, string>();
    finalArtifacts.features.forEach((feature: any, idx: number) => {
      const newId = `feature-${idx + 1}`;
      featureIdMap.set(feature.id, newId);
      feature.id = newId;
    });
    if (Array.isArray(finalArtifacts.userStories)) {
      finalArtifacts.userStories.forEach((s: any) => {
        if (!isPlainObject(s)) return;
        if (featureIdMap.has(s.featureId))
          s.featureId = featureIdMap.get(s.featureId);
      });
    }
  }
  if (Array.isArray(finalArtifacts.userStories)) {
    finalArtifacts.userStories.forEach((story: any, idx: number) => {
      if (!isPlainObject(story)) return;
      story.id = `story-${idx + 1}`;
    });
  }

  // ══ FINAL SAFETY SWEEP: drop (do not pad) any feature still with 0 stories ══
  // Generic "I want to use X so that I can benefit from its core functionality"
  // padding is forbidden — it pollutes the backlog with stories that don't trace
  // to any requirement. Surface the gap in the quality report instead.
  const postRenumberOrphans = findOrphanFeatures(finalArtifacts);
  if (postRenumberOrphans.length > 0) {
    const droppedIds = new Set(postRenumberOrphans.map(f => f.id));
    if (Array.isArray(finalArtifacts.features)) {
      finalArtifacts.features = finalArtifacts.features.filter((f: any) => !droppedIds.has(f.id));
    }
    if (Array.isArray(finalArtifacts.userStories)) {
      finalArtifacts.userStories = finalArtifacts.userStories.filter((s: any) => !droppedIds.has(s?.featureId));
    }
    const report = ((finalArtifacts as any)._qualityReport = (finalArtifacts as any)._qualityReport || {});
    const existing = Array.isArray(report.droppedEmptyFeatures) ? report.droppedEmptyFeatures : [];
    report.droppedEmptyFeatures = existing.concat(
      postRenumberOrphans.map(f => ({
        id: f.id,
        title: f.title,
        reason: 'no stories generated; dropped to avoid generic boilerplate padding',
      })),
    );
    progressCallback?.(
      `⚠️ Quality Agent: Final sweep dropped ${postRenumberOrphans.length} empty feature(s) — see qualityReport.droppedEmptyFeatures.`,
    );
  }

  // ══ FINAL: NORMALIZE ALL STORY FORMATS ══
  // Ensure every story has the required 8-section description, 5 acceptance criteria,
  // 5 subtasks, 3+ test cases — covers initial generation AND QA-generated stories.
  if (Array.isArray(finalArtifacts.userStories)) {
    let normalizedCount = 0;
    for (let i = 0; i < finalArtifacts.userStories.length; i++) {
      const story = finalArtifacts.userStories[i];
      if (!isPlainObject(story)) continue;
      const descBefore = story.description;
      const subtasksBefore = story.subtasks?.length;
      const testCasesBefore = story.testCases?.length;
      const acBefore = story.acceptanceCriteria?.length;
      finalArtifacts.userStories[i] = normalizeStoryFormat(story);
      if (
        descBefore !== story.description ||
        subtasksBefore !== story.subtasks?.length ||
        testCasesBefore !== story.testCases?.length ||
        acBefore !== story.acceptanceCriteria?.length
      ) {
        normalizedCount++;
      }
    }
    if (normalizedCount > 0) {
      progressCallback?.(
        `📋 Quality Agent: Normalized format for ${normalizedCount} user stories (ensured 8-section descriptions, subtasks, test cases, acceptance criteria)`,
      );
    }
  }

  return {
    artifacts: finalArtifacts,
    qualityReport: {
      // Scoring removed — qualityReport now reports only the deterministic
      // structural facts: dedup stats, BRD coverage, architectural-layer
      // coverage, and any artifacts dropped by the integrity enforcer.
      deduplicationStats: {
        ...dedupStats,
        orphanEpicsRemoved: initialEpicsRemoved + finalEpicsRemoved,
        storiesGeneratedForEmptyFeatures:
          initialStoriesGenerated + finalStoriesGenerated,
      },
      totalDuration: duration,
      brdCoverage: {
        totalRequirements: parsedRequirements.length,
        fullyCovered: finalFullyCovered,
        partiallyCovered: finalPartial,
        uncovered: finalMissing,
        coveragePercentage: finalCoveragePct,
        details: finalCoverageResults.map((c) => ({
          requirementId: c.requirementId,
          requirementName: c.requirementName,
          coverageStrength: c.coverageStrength,
          coveringStories: c.coveringStories,
        })),
        gapStoriesGenerated: uncoveredRequirements.length,
      },
      architecturalLayers: {
        totalLayers: MANDATORY_ARCHITECTURAL_LAYERS.length,
        covered: finalArchCovered,
        missing: finalArchMissing.map((l) => l.layerName),
        details: finalArchCoverage.map((l) => ({
          layerId: l.layerId,
          layerName: l.layerName,
          covered: l.covered,
          matchingKeywords: l.matchingArtifacts,
        })),
      },
    },
  };
}
