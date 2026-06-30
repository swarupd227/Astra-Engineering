/**
 * LLM-driven bounded-context decomposition of BRD requirements.
 *
 * Design principle: the LLM is the SOLE authority on epic grouping.
 * No business heuristics, no regex-based coupling detection, no target
 * epic counts, no clamps. The epic count is an OUTPUT of architectural
 * analysis, never an input or a constraint.
 *
 * Only technical safeguards remain:
 *   - coverage validation (every requirement must be assigned exactly once)
 *   - exact-label dedupe (safety net if the LLM emits duplicate group labels)
 *   - per-chunk character budget (LLM context-window safety)
 *
 * If the global LLM pass fails, a pairwise-edge LLM pass runs as fallback.
 * If both fail, null is returned and the caller falls back to one-requirement-
 * per-chunk (worst case ΓÇö never blocks generation).
 */

import { promises as fs } from "fs";
import path from "path";
import { azureOpenAI, hasAzureOpenAI } from "./llm-config";
import { NEW_API_MODEL_SUBSTRINGS } from "./llm-config-constants";

// ---------------------------------------------------------------------------
// Persistent diagnostic log
// ---------------------------------------------------------------------------
// Terminal scrollback rotates and hides clustering decisions. We always append
// a structured record of every clustering run to disk so the LLM's reasoning
// can be inspected after the fact. Path: <repo>/logs/requirement-clustering.log
// ---------------------------------------------------------------------------

const CLUSTERING_LOG_PATH = path.join(
  process.cwd(),
  "logs",
  "requirement-clustering.log",
);

async function writeClusteringLog(entry: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CLUSTERING_LOG_PATH), { recursive: true });
    const line =
      JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
    await fs.appendFile(CLUSTERING_LOG_PATH, line, "utf-8");
  } catch (err) {
    console.warn(
      "[RequirementClustering] Failed to write diagnostic log:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Row passed from routes / ai-service ΓÇö `content` is the markdown block per requirement. */
export interface StructuredRequirementRow {
  id: string;
  content: string;
  name?: string;
  description?: string | null;
}

/** Truncate requirement text for clustering prompt only (not for artifact chunks). */
export const CLUSTER_LLM_DESC_MAX_CHARS = 600;

/**
 * Per-chunk character budget. This is a TECHNICAL safety bound for the
 * downstream artifact-generation LLM context window ΓÇö NOT a business rule
 * about epic size. Clusters exceeding this are split into single-requirement
 * chunks (preserves coverage, worst-case quality).
 */
export const MAX_CLUSTER_CHUNK_CHARS = 60000;

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

class UnionFind {
  private parent = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) {
      this.parent.set(id, id);
    }
  }

  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

function orderIndexMap(order: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const id = String(order[i]).trim();
    if (id && !m.has(id)) m.set(id, i);
  }
  return m;
}

function sortClusterIds(
  ids: string[],
  orderIndex: Map<string, number>,
): string[] {
  return [...ids].sort((a, b) => {
    const ia = orderIndex.has(a) ? orderIndex.get(a)! : 999999;
    const ib = orderIndex.has(b) ? orderIndex.get(b)! : 999999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

function truncate(s: string, max: number): string {
  if (!s || s.length <= max) return s || "";
  return s.slice(0, max).trim() + "ΓÇª";
}

function parseJsonObject(raw: string): any {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fence ? fence[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Technical safety only: if a cluster's joined text would blow the downstream
 * LLM's context window, split it into singletons rather than failing generation.
 * This is the ONLY post-LLM transformation applied to clusters.
 */
function splitByCharBudget(
  clusters: string[][],
  rowById: Map<string, StructuredRequirementRow>,
  appendix: string,
  maxChars: number,
  orderIndex: Map<string, number>,
): string[][] {
  const out: string[][] = [];
  for (const c of clusters) {
    const sorted = sortClusterIds(c, orderIndex);
    const joined =
      sorted.map((id) => rowById.get(id)?.content ?? "").join("\n\n---\n\n") +
      appendix;
    if (joined.length <= maxChars) {
      out.push(sorted);
      continue;
    }
    console.warn(
      `[RequirementClustering] Cluster of ${sorted.length} reqs exceeds ${maxChars} chars ΓÇö splitting to singleton chunks (technical safety, not a business rule)`,
    );
    for (const id of sorted) out.push([id]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PRIMARY PATH ΓÇö Global bounded-context capability grouping
// ---------------------------------------------------------------------------

interface CapabilityGroup {
  capability: string;
  boundedContext: string;
  rationale?: string;
  requirementIds: string[];
}

type DetectedCouplingIntent = "loose" | "tight" | "none";

interface CapabilityGroupingResult {
  analysis: string;
  detectedCouplingIntent: DetectedCouplingIntent;
  couplingIntentEvidence: string;
  groups: CapabilityGroup[];
}

/**
 * GLOBAL bounded-context decomposition.
 *
 * One LLM call sees the entire BRD, reasons about its architecture, and
 * returns the epics directly. The number of epics emerges naturally from
 * the bounded-context structure ΓÇö there is no target count and no clamp.
 */
async function inferCapabilityGroups(
  rows: StructuredRequirementRow[],
  checkCancelled?: () => boolean,
): Promise<CapabilityGroupingResult | null> {
  if (!hasAzureOpenAI || !azureOpenAI) {
    console.warn(
      "[RequirementClustering] Γ£ù Azure OpenAI not configured ΓÇö capability grouping unavailable. Check AZURE_OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT env vars.",
    );
    return null;
  }

  if (checkCancelled?.()) {
    throw new Error("Generation cancelled by user");
  }

  const idSet = new Set(rows.map((r) => r.id));
  const payload = rows.map((r) => ({
    id: r.id,
    title: truncate(String(r.name || ""), 220),
    description: truncate(String(r.description ?? ""), CLUSTER_LLM_DESC_MAX_CHARS),
  }));

  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";
  const modelLower = deployment.toLowerCase();
  const isNewModel = NEW_API_MODEL_SUBSTRINGS.some((m) => modelLower.includes(m));

  const userPrompt = `You are a principal solution architect performing bounded-context decomposition on a BRD.

Your decomposition becomes the EPIC structure for an agile delivery team. Each group you output becomes EXACTLY ONE epic.

================================================================
EPIC COUNT IS AN OUTPUT, NEVER A TARGET
================================================================
The number of epics is determined ENTIRELY by the architecture and stated
intent you discover in this BRD.
- There is NO preferred number.
- There is NO minimum.
- There is NO maximum.
- Two different BRDs MUST yield dramatically different epic counts when their architectures differ.
- Do NOT settle on a "reasonable" count. Settle on the count this BRD demands.
- Do NOT default to "one epic per requirement" ΓÇö that is fragmentation, not analysis.
- Do NOT default to "one big epic" ΓÇö that is laziness, not analysis.

================================================================
*** STEP 0 (READ THIS FIRST) ΓÇö LISTEN TO THE BRD'S COUPLING INTENT ***
================================================================
Before doing bounded-context analysis, scan the BRD's purpose, executive
summary, scope, business goals, constraints, and the requirement descriptions
themselves for EXPLICIT statements about how requirements are intended to relate.

LOOSE-COUPLING INTENT ΓÇö keywords/phrases:
  "loosely coupled", "decoupled", "independent", "standalone", "modular",
  "not tightly coupled", "logical independence", "operate independently",
  "modify one without impacting others", "discrete records",
  "independently maintainable", "loosely coupled requirements",
  "requirement independence", "modify one requirement without impacting others"

  ΓåÆ When the BRD intentionally designs its requirements to be independent,
    each requirement is a STANDALONE deliverable. Group ONLY the rare pairs
    that share a literal entity/workflow (typically: a "create X" requirement
    with its corresponding "edit X" / "delete X" requirement).
  ΓåÆ EXPECTED EPIC COUNT under loose intent: ~70ΓÇô100% of the input requirement
    count. e.g. 20 loose requirements ΓåÆ 14ΓÇô20 epics. NEVER 4ΓÇô6 epics.
  ΓåÆ A BRD asking for "loosely coupled requirements" that you collapse into
    4ΓÇô6 epics is a FAILURE to respect stated intent. Do not do this.

TIGHT-COUPLING INTENT ΓÇö keywords/phrases:
  "tightly coupled", "interdependent", "logically connected", "interconnected",
  "cohesive", "unified scope", "tight coupling", "relationship integrity",
  "preserve coupling", "tight interdependency", "logical linkage",
  "collectively support a common objective", "unified business scope",
  "tightly coupled requirements"

  ΓåÆ When the BRD intentionally designs its requirements to operate as a unit,
    they collectively form ONE bounded context (or 2 if there is a hard
    capability boundary like "Generation" vs "Export").
  ΓåÆ EXPECTED EPIC COUNT under tight intent: 1ΓÇô3 epics regardless of input
    requirement count. e.g. 24 tight requirements ΓåÆ 1, 2, or 3 epics, NEVER
    5ΓÇô6 epics.
  ΓåÆ A BRD asking for "tightly coupled requirements" that you split into 5+
    epics is a FAILURE to respect stated intent. Do not do this.

NO EXPLICIT INTENT ΓÇö analyze purely on bounded-context architectural grounds.

================================================================
*** FORCING FUNCTION ΓÇö INTENT MUST DOMINATE THE OUTPUT ***
================================================================
Detected intent is NOT a soft hint. It is a HARD CONSTRAINT on the shape of
your output. Apply this check BEFORE finalizing the groups:

  IF detectedCouplingIntent == "loose":
    groups.length MUST be >= ceil(0.70 * inputRequirementCount).
    If your draft has fewer groups than this, SPLIT the largest groups
    until the floor is met. Default each requirement to its own group
    unless two requirements literally share an entity AND a workflow.

  IF detectedCouplingIntent == "tight":
    groups.length MUST be <= 3.
    If your draft has more than 3 groups, MERGE adjacent capabilities
    (e.g. "Generation" + "Validation" + "Data Model" ΓåÆ one
    "BRD Generation & Validation" epic) until <= 3.

  IF detectedCouplingIntent == "none":
    Pure bounded-context analysis applies. No numeric floor or ceiling.

After applying the forcing function, the final groups.length MUST satisfy the
constraint for the detected intent. Then re-verify coverage.

ALWAYS record what you detected AND the forcing function adjustment (if any)
in the boundedContextAnalysis output field.

================================================================
CALIBRATION (illustrations only ΓÇö read them, then forget the exact numbers)
================================================================
- BRD states "20 LOOSELY COUPLED requirements" ΓåÆ ~15ΓÇô20 epics (respect independence).
- BRD states "20 TIGHTLY COUPLED requirements all serving one objective" ΓåÆ 1ΓÇô3 epics (respect cohesion).
- BRD describing one tightly-integrated subsystem with 12 requirements ΓåÆ 1 epic.
- BRD with 30 requirements covering 3 distinct domains ΓåÆ 3 epics.
- BRD with 10 totally unrelated capabilities ΓåÆ 10 epics.
- BRD with 25 requirements where 18 belong to "Claims Processing" and 7 belong to "Reporting" ΓåÆ 2 epics.
- BRD with 6 requirements that each represent an independent business capability ΓåÆ 6 epics.

================================================================
*** REQUIREMENT-ID PREFIX IS NOT A BOUNDED CONTEXT ***
================================================================
Requirement ids may carry TYPE prefixes such as FR (Functional), NFR (Non-Functional),
TR (Technical), IR (Integration), BR (Business Rule), UR (Usability), etc.
These prefixes describe the requirement KIND. They are NEVER a bounded context.

It is WRONG to group "all FR-* together as one epic" and "all NFR-* together as another epic".
The bounded context is determined by what the requirement DOES (its capability and domain),
NOT by its requirement-type prefix.

A single bounded context typically MIXES FR + NFR + TR + IR requirements that all support
the same capability. E.g. an "Authentication" epic may contain FR-01 (login form), NFR-02
(must respond in <500ms), TR-03 (use OAuth2), and IR-04 (integrate with Active Directory).

================================================================
REASONING PROCESS ΓÇö apply IN ORDER for every requirement
================================================================
For each requirement, internally determine:
  1. Which BUSINESS CAPABILITY does it serve?
  2. Which BOUNDED CONTEXT owns its data, workflow, and lifecycle?
       (A bounded context = one coherent capability, one data model, one workflow,
        one deployable subsystem, one release lifecycle.)
  3. Which SUBSYSTEM / MODULE / SERVICE implements it?
  4. Could it be built, released, and operated INDEPENDENTLY of any other requirement,
     or does it share state / workflow / lifecycle with others?

Then GROUP requirements that:
  - Operate on the SAME CORE ENTITY, OR
  - Share the SAME OPERATIONAL WORKFLOW, OR
  - Belong to the SAME DEPLOYMENT / RELEASE UNIT, OR
  - Represent VARIANTS of the same capability (CRUD operations, lifecycle phases,
    configuration vs execution vs monitoring of the same thing).

KEEP SEPARATE requirements that:
  - Serve different business goals
  - Operate on different core entities
  - Have different lifecycles and can be deployed independently
  - Just happen to live in the same application but solve different problems

================================================================
ANTI-FRAGMENTATION (do not split a single bounded context)
================================================================
- CRUD on the same entity = ONE epic, never four.
- Different phases of the same workflow = ONE epic, never phase-per-epic.
- Configuration + Execution + Monitoring of the same capability = ONE epic.
- Variants of the same capability = ONE epic.
- Functional + Non-Functional + Technical requirements about the SAME capability = ONE epic.

================================================================
ANTI-OVER-MERGE (do not collapse independent capabilities)
================================================================
- Different business domains = SEPARATE epics. Never collapse into a "Platform" mega-epic.
- Cross-cutting concerns (logging, auth, audit) are NOT bounded contexts on their own
  unless this BRD is specifically about that concern.
- Lexical or naming similarity is NOT a reason to merge ΓÇö only architectural ownership is.

================================================================
COVERAGE & FAITHFULNESS
================================================================
- EVERY requirement id MUST appear in EXACTLY ONE group.
- No requirement may be dropped, duplicated, or invented.
- Use ONLY the requirement ids present in the input.

================================================================
INPUT
================================================================
Requirements (JSON):
${JSON.stringify(payload, null, 2)}

================================================================
OUTPUT
================================================================
Respond with a single JSON object ΓÇö no markdown, no commentary outside JSON.

{
  "detectedCouplingIntent": "<one of: 'loose' | 'tight' | 'none'>",
  "couplingIntentEvidence": "<short quote(s) from the BRD that revealed the coupling intent, or empty string if 'none'>",
  "boundedContextAnalysis": "<3-5 sentences. (1) State the detected coupling intent and how it influenced your grouping. (2) Describe the bounded contexts you identified in THIS BRD's domain (not generic). (3) Explain the architectural reason for the epic count you produced, referencing entities, workflows, and lifecycles.>",
  "groups": [
    {
      "capability": "<short capability name, e.g. 'Account Management'>",
      "boundedContext": "<bounded context name, e.g. 'Customer Onboarding Subsystem'>",
      "rationale": "<1-2 sentences: why these requirements share a bounded context ΓÇö reference entities/workflow/lifecycle/coupling intent, NOT id prefixes>",
      "requirementIds": ["<id>", "<id>"]
    }
  ]
}`;

  try {
    const tokensParam = isNewModel
      ? { max_completion_tokens: 4096 }
      : { max_tokens: 4096 };

    const response = await azureOpenAI.chat.completions.create({
      model: deployment,
      messages: [
        {
          role: "system",
          content:
            "You are a principal solution architect. You output a single valid JSON object. No markdown fences, no commentary outside JSON.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      ...tokensParam,
      response_format: { type: "json_object" as const },
    });

    const content = response.choices[0]?.message?.content || "{}";
    let parsed: any;
    try {
      parsed = parseJsonObject(content);
    } catch (parseErr) {
      console.warn(
        `[RequirementClustering] Γ£ù JSON parse failed for capability grouping response (length=${content.length}). First 300 chars: ${content.slice(0, 300)}`,
      );
      return null;
    }

    const analysis =
      typeof parsed?.boundedContextAnalysis === "string"
        ? parsed.boundedContextAnalysis.trim()
        : "";

    const rawIntent =
      typeof parsed?.detectedCouplingIntent === "string"
        ? parsed.detectedCouplingIntent.trim().toLowerCase()
        : "";
    const detectedCouplingIntent: DetectedCouplingIntent =
      rawIntent === "loose" || rawIntent === "tight" ? rawIntent : "none";
    const couplingIntentEvidence =
      typeof parsed?.couplingIntentEvidence === "string"
        ? parsed.couplingIntentEvidence.trim()
        : "";

    const groupsRaw = parsed?.groups;
    if (!Array.isArray(groupsRaw)) {
      console.warn(
        `[RequirementClustering] Γ£ù LLM response missing 'groups' array. Got keys: [${Object.keys(parsed || {}).join(", ")}]`,
      );
      return null;
    }

    const groups: CapabilityGroup[] = [];
    for (const g of groupsRaw) {
      const capability =
        typeof g?.capability === "string" ? g.capability.trim() : "";
      const boundedContext =
        typeof g?.boundedContext === "string"
          ? g.boundedContext.trim()
          : capability;
      const rationale =
        typeof g?.rationale === "string" ? g.rationale.trim() : "";
      const reqIds: string[] = Array.isArray(g?.requirementIds)
        ? g.requirementIds
            .filter(
              (x: unknown) =>
                typeof x === "string" && idSet.has((x as string).trim()),
            )
            .map((x: string) => x.trim())
        : [];
      if (reqIds.length === 0) continue;
      groups.push({
        capability: capability || "Unnamed Capability",
        boundedContext: boundedContext || capability || "Unnamed",
        rationale,
        requirementIds: reqIds,
      });
    }

    return {
      analysis,
      detectedCouplingIntent,
      couplingIntentEvidence,
      groups,
    };
  } catch (err) {
    console.warn(
      "[RequirementClustering] LLM capability grouping failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Coverage validation: every requirement must appear in exactly one group.
 * This is the ONLY validation applied to the LLM output ΓÇö no business rules.
 */
function validateCapabilityCoverage(
  groups: CapabilityGroup[],
  expectedIds: string[],
): { ok: true } | { ok: false; reason: string } {
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  for (const g of groups) {
    for (const id of g.requirementIds) {
      if (!expected.has(id))
        return { ok: false, reason: `unknown id ${id}` };
      if (seen.has(id))
        return { ok: false, reason: `duplicate id ${id}` };
      seen.add(id);
    }
  }
  if (seen.size !== expected.size) {
    const missing = expectedIds.filter((id) => !seen.has(id));
    return {
      ok: false,
      reason: `missing ${missing.length} id(s): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "ΓÇª" : ""}`,
    };
  }
  return { ok: true };
}

/**
 * Safety net for accidental LLM duplication: collapse groups whose labels
 * (capability + bounded context) are byte-for-byte identical after trim+lowercase.
 *
 * Intentionally STRICT ΓÇö does NOT strip suffix words ("management", "system",
 * etc.) because that risks over-merging distinct capabilities like
 * "Risk Engine" + "Risk Management".
 */
function dedupeGroupsByExactLabel(
  groups: CapabilityGroup[],
): CapabilityGroup[] {
  const norm = (s: string) =>
    String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const byKey = new Map<string, CapabilityGroup>();
  for (const g of groups) {
    const key = `${norm(g.capability)}||${norm(g.boundedContext)}`;
    if (!key.replace(/\|/g, "").trim()) {
      // unnamed ΓÇö keep separate
      byKey.set(`__unnamed__${byKey.size}`, {
        ...g,
        requirementIds: [...g.requirementIds],
      });
      continue;
    }
    const existing = byKey.get(key);
    if (existing) {
      const merged = new Set([
        ...existing.requirementIds,
        ...g.requirementIds,
      ]);
      existing.requirementIds = Array.from(merged);
    } else {
      byKey.set(key, { ...g, requirementIds: [...g.requirementIds] });
    }
  }
  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// FALLBACK PATH ΓÇö Pairwise-edge LLM clustering (kept for resilience)
// ---------------------------------------------------------------------------
//
// Only runs if the primary global bounded-context pass fails (LLM error,
// malformed JSON, or coverage validation rejection). Uses the same neutral
// 4-tier coupling model so the fallback also avoids hardcoded bias.

interface ClusteringEdge {
  a: string;
  b: string;
}

async function inferCouplingEdges(
  rows: StructuredRequirementRow[],
  checkCancelled?: () => boolean,
): Promise<ClusteringEdge[] | null> {
  if (!hasAzureOpenAI || !azureOpenAI) {
    return null;
  }
  if (checkCancelled?.()) {
    throw new Error("Generation cancelled by user");
  }

  const idSet = new Set(rows.map((r) => r.id));
  const payload = rows.map((r) => ({
    id: r.id,
    title: truncate(String(r.name || ""), 200),
    description: truncate(String(r.description ?? ""), CLUSTER_LLM_DESC_MAX_CHARS),
  }));

  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";
  const modelLower = deployment.toLowerCase();
  const isNewModel = NEW_API_MODEL_SUBSTRINGS.some((m) => modelLower.includes(m));

  const userPrompt = `You are an enterprise solution architect performing agile decomposition (fallback edge mode).

Each connected component you produce will become EXACTLY ONE epic. Emit an edge between two requirements ONLY when their coupling is Strong or Moderate.

COUPLING MODEL
  STRONGLY COUPLED   ΓåÆ EMIT EDGE (same bounded context, shared core entities, shared workflow stages, lifecycle interdependency, cannot function independently)
  MODERATELY COUPLED ΓåÆ EMIT EDGE (same broader domain, shared APIs/services/validation, belong together architecturally)
  WEAKLY COUPLED     ΓåÆ NO EDGE  (occasional interaction, distinct capabilities)
  INDEPENDENT        ΓåÆ NO EDGE  (different domains, different data models, different lifecycles, different deployment units)

CRITICAL
  - Epic count emerges from coupling ΓÇö no target, no clamp.
  - Truly independent requirements MUST stay disconnected.
  - Tightly coupled requirements MUST be connected.
  - Do NOT merge on wording or generic semantic similarity.
  - Use ONLY requirement ids from the input list. Undirected pairs only.
  - Empty edges is valid when all requirements are independent.

Requirements (JSON):
${JSON.stringify(payload, null, 2)}

Respond with JSON only:
{
  "edges": [ { "a": "<id>", "b": "<id>" } ]
}`;

  try {
    const tokensParam = isNewModel
      ? { max_completion_tokens: 2048 }
      : { max_tokens: 2048 };

    const response = await azureOpenAI.chat.completions.create({
      model: deployment,
      messages: [
        {
          role: "system",
          content:
            "You output only valid JSON objects. No markdown, no commentary.",
        },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      ...tokensParam,
      response_format: { type: "json_object" as const },
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = parseJsonObject(content);
    const edgesRaw = parsed?.edges;
    if (!Array.isArray(edgesRaw)) {
      console.warn("[RequirementClustering] Invalid edges array from LLM");
      return null;
    }

    const edges: ClusteringEdge[] = [];
    const seen = new Set<string>();
    for (const e of edgesRaw) {
      const a = typeof e?.a === "string" ? e.a.trim() : "";
      const b = typeof e?.b === "string" ? e.b.trim() : "";
      if (!a || !b || a === b) continue;
      if (!idSet.has(a) || !idSet.has(b)) continue;
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
    return edges;
  } catch (err) {
    console.warn(
      "[RequirementClustering] LLM edge clustering failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function edgesToClusters(ids: string[], edges: ClusteringEdge[]): string[][] {
  const uf = new UnionFind(ids);
  for (const { a, b } of edges) {
    uf.union(a, b);
  }
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const root = uf.find(id);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root)!.push(id);
  }
  return Array.from(buckets.values());
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface ClusteredChunksResult {
  chunks: string[];
  requirementCounts: number[];
}

/**
 * Build chunk strings (one epic per chunk) for downstream artifact generation.
 *
 * Strategy:
 *   1. PRIMARY  ΓÇö global bounded-context capability grouping (LLM analyses
 *      the whole BRD and emits epic groups directly).
 *   2. FALLBACK ΓÇö pairwise edge clustering + union-find (only if primary
 *      fails or produces invalid coverage).
 *   3. NULL     ΓÇö both LLM passes failed; caller does one-requirement-per-chunk.
 *
 * The ONLY post-LLM transformations are:
 *   - exact-label dedupe (safety net for accidental LLM duplication)
 *   - character-budget split (technical safety for downstream context window)
 *
 * NO target epic counts, NO clamps, NO regex coupling heuristics, NO
 * merge-by-keyword. The LLM is the sole authority on architectural grouping.
 */
export async function tryBuildDependencyClusteredChunks(
  rows: StructuredRequirementRow[],
  requirementIdOrder: string[],
  chunkAppendix: string,
  checkCancelled?: () => boolean,
): Promise<ClusteredChunksResult | null> {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  console.log(
    `[RequirementClustering] Γû╢ ENTRY ΓÇö runId=${runId} rows=${rows?.length ?? 0}, idOrder=${requirementIdOrder?.length ?? 0}`,
  );

  await writeClusteringLog({
    event: "entry",
    runId,
    inputRequirementCount: rows?.length ?? 0,
    requirementIdSample:
      rows?.slice(0, 30).map((r) => ({
        id: r.id,
        name: String(r.name || "").slice(0, 80),
        descriptionSnippet: String(r.description || "").slice(0, 180),
      })) ?? [],
    diagnosticLogPath: CLUSTERING_LOG_PATH,
  });

  if (!rows || rows.length < 2) {
    console.log(
      `[RequirementClustering] ΓùÇ SKIPPED ΓÇö fewer than 2 requirements (need >=2 for clustering)`,
    );
    await writeClusteringLog({
      event: "exit",
      runId,
      outcome: "skipped",
      reason: "fewer than 2 requirements",
    });
    return null;
  }

  if (checkCancelled?.()) {
    throw new Error("Generation cancelled by user");
  }

  const ids = rows.map((r) => r.id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    console.warn(
      "[RequirementClustering] ΓùÇ SKIPPED ΓÇö duplicate requirement ids in input",
    );
    return null;
  }

  console.log(
    `[RequirementClustering] Input id sample: ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? `, ΓÇª(+${ids.length - 6} more)` : ""}`,
  );

  const rowById = new Map<string, StructuredRequirementRow>();
  for (const r of rows) rowById.set(r.id, r);

  const orderIndex = orderIndexMap(
    requirementIdOrder.length > 0 ? requirementIdOrder : ids,
  );

  let clusters: string[][] | null = null;
  let strategy: "capability-grouping" | "edge-fallback" = "capability-grouping";

  // -------------------------------------------------------------------------
  // PRIMARY ΓÇö global bounded-context capability grouping
  // -------------------------------------------------------------------------
  console.log(
    `[RequirementClustering] ΓåÆ Calling primary LLM (global bounded-context grouping) for ${rows.length} requirement(s)ΓÇª`,
  );
  const groupResult = await inferCapabilityGroups(rows, checkCancelled);

  if (!groupResult) {
    console.warn(
      `[RequirementClustering] Γ£ù Primary LLM returned null (Azure unavailable, JSON parse failed, or LLM error) ΓÇö will try edge fallback`,
    );
    await writeClusteringLog({
      event: "primary_llm_failed",
      runId,
      reason: "null result (Azure unavailable, parse failed, or LLM error)",
    });
  } else if (groupResult.groups.length === 0) {
    console.warn(
      `[RequirementClustering] Γ£ù Primary LLM returned 0 groups ΓÇö will try edge fallback`,
    );
    await writeClusteringLog({
      event: "primary_llm_failed",
      runId,
      reason: "zero groups returned",
      detectedCouplingIntent: groupResult.detectedCouplingIntent,
      couplingIntentEvidence: groupResult.couplingIntentEvidence,
      analysis: groupResult.analysis,
    });
  } else {
    console.log(
      `[RequirementClustering] Γ£ô Primary LLM returned ${groupResult.groups.length} group(s).`,
    );
    console.log(
      `[RequirementClustering] Detected coupling intent: ${groupResult.detectedCouplingIntent.toUpperCase()}${groupResult.couplingIntentEvidence ? ` ΓÇö evidence: "${groupResult.couplingIntentEvidence.slice(0, 200)}${groupResult.couplingIntentEvidence.length > 200 ? "ΓÇª" : ""}"` : ""}`,
    );
    console.log(
      `[RequirementClustering] Analysis: ${groupResult.analysis || "(none)"}`,
    );
    const coverage = validateCapabilityCoverage(groupResult.groups, ids);
    if (coverage.ok) {
      const deduped = dedupeGroupsByExactLabel(groupResult.groups);
      clusters = deduped.map((g) => [...g.requirementIds]);

      console.log(
        `[RequirementClustering] Γ£ô Coverage valid. ${groupResult.groups.length} LLM group(s) ΓåÆ ${clusters.length} cluster(s) after exact-label dedupe`,
      );
      console.log(
        `[RequirementClustering] Epics: ${deduped
          .map(
            (g) =>
              `"${g.boundedContext || g.capability}" (${g.requirementIds.length} req${g.requirementIds.length === 1 ? "" : "s"})`,
          )
          .join(" | ")}`,
      );
      await writeClusteringLog({
        event: "primary_llm_success",
        runId,
        detectedCouplingIntent: groupResult.detectedCouplingIntent,
        couplingIntentEvidence: groupResult.couplingIntentEvidence,
        analysis: groupResult.analysis,
        inputRequirementCount: rows.length,
        outputGroupCount: deduped.length,
        intentRespected:
          groupResult.detectedCouplingIntent === "loose"
            ? deduped.length >= Math.ceil(0.7 * rows.length)
            : groupResult.detectedCouplingIntent === "tight"
              ? deduped.length <= 3
              : null,
        groups: deduped.map((g) => ({
          capability: g.capability,
          boundedContext: g.boundedContext,
          rationale: g.rationale,
          requirementIds: g.requirementIds,
        })),
      });
    } else {
      console.warn(
        `[RequirementClustering] Γ£ù Coverage rejected: ${coverage.reason} ΓÇö falling back to edge model`,
      );
      await writeClusteringLog({
        event: "primary_llm_coverage_rejected",
        runId,
        reason: coverage.reason,
        detectedCouplingIntent: groupResult.detectedCouplingIntent,
        couplingIntentEvidence: groupResult.couplingIntentEvidence,
        analysis: groupResult.analysis,
        groups: groupResult.groups.map((g) => ({
          capability: g.capability,
          boundedContext: g.boundedContext,
          requirementIds: g.requirementIds,
        })),
      });
    }
  }

  // -------------------------------------------------------------------------
  // FALLBACK ΓÇö pairwise edge clustering
  // -------------------------------------------------------------------------
  if (!clusters) {
    strategy = "edge-fallback";
    console.log(`[RequirementClustering] ΓåÆ Calling edge-fallback LLMΓÇª`);
    const llmEdges = await inferCouplingEdges(rows, checkCancelled);
    if (llmEdges === null) {
      console.warn(
        `[RequirementClustering] ΓùÇ Both LLM paths failed ΓÇö returning null. Caller will use one-requirement-per-chunk (this is why you see N epics for N requirements).`,
      );
      await writeClusteringLog({
        event: "exit",
        runId,
        outcome: "both_llm_paths_failed",
        strategy: "none",
      });
      return null;
    }
    clusters = edgesToClusters(ids, llmEdges);
    console.log(
      `[RequirementClustering] Γ£ô Edge fallback: ${rows.length} requirement(s) ΓåÆ ${llmEdges.length} edge(s) ΓåÆ ${clusters.length} cluster(s)`,
    );
    if (llmEdges.length === 0) {
      console.log(
        `[RequirementClustering]   (no edges produced ΓÇö LLM judged all requirements independent ΓåÆ ${clusters.length} singleton epics)`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Technical safety only ΓÇö character budget for downstream LLM context window
  // -------------------------------------------------------------------------
  clusters = splitByCharBudget(
    clusters,
    rowById,
    chunkAppendix || "",
    MAX_CLUSTER_CHUNK_CHARS,
    orderIndex,
  );

  // Deterministic epic ordering by user's selection order.
  clusters.sort((c1, c2) => {
    const i1 = Math.min(...c1.map((id) => orderIndex.get(id) ?? 999999));
    const i2 = Math.min(...c2.map((id) => orderIndex.get(id) ?? 999999));
    return i1 - i2;
  });

  const chunks: string[] = [];
  const requirementCounts: number[] = [];

  for (const cluster of clusters) {
    const sortedIds = sortClusterIds(cluster, orderIndex);
    const body = sortedIds
      .map((id) => rowById.get(id)?.content ?? "")
      .filter((c) => c.trim().length > 0)
      .join("\n\n---\n\n");
    const full = body + (chunkAppendix || "");
    chunks.push(full);
    requirementCounts.push(sortedIds.length);
  }

  console.log(
    `[RequirementClustering] ΓùÇ EXIT ΓÇö ${rows.length} requirement(s) ΓåÆ ${chunks.length} epic chunk(s) (strategy=${strategy})`,
  );

  await writeClusteringLog({
    event: "exit",
    runId,
    outcome: "success",
    strategy,
    inputRequirementCount: rows.length,
    outputChunkCount: chunks.length,
    requirementCountsPerChunk: requirementCounts,
  });

  return { chunks, requirementCounts };
}
