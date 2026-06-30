/**
 * QE Golden Repo Guidance loader.
 *
 * Mirrors the BRD generation chain (`server/routes.ts:buildComplianceGuidelinesFromProject`
 * → `OptimizedRAGOrchestrator.processBrdWithGuidelines`) so the QE
 * "Generate from User Stories" flow can pull authoritative context out of
 * the SDLC Golden Repo (`sdlc_projects.golden_repo_reference` →
 * `devx_guideline_chunks`) instead of relying only on the local filesystem
 * `repoPath` scan and uploaded docs.
 *
 * Lookup chain when given a QE `projectId`:
 *   1. `qe.projects.devxSdlcProjectId` resolves the QE project to its SDLC
 *      counterpart. (Caller can also pass an SDLC project id / key directly.)
 *   2. `sdlc_projects.golden_repo_reference.{repoId, filePaths}` -- the
 *      "Custom files" selection from Project Edit. Empty `filePaths` is
 *      treated as a no-op (matches BRD's "All files" behavior today; see
 *      explore notes from this PR).
 *   3. Chunks are pulled from `devx_guideline_chunks` joined to
 *      `devx_vectorized_guidelines` keyed on `goldenRepoId` + filename.
 *   4. `OptimizedRAGOrchestrator.processBrdWithGuidelines(..., {
 *      pipelineModeOverride: "cag_pageindex" })` produces the final summary
 *      string that callers inject into LLM prompts. Same call BRD uses --
 *      the function name has "Brd" in it but the pipeline is
 *      content-agnostic; it just runs CAG over the guideline corpus given
 *      a query string. We pass the user story (title + AC) as that query.
 */

// IMPORTANT: this module spans two databases.
// - SDLC tables (sdlc_projects, devx_vectorized_guidelines, devx_guideline_chunks)
//   live on the main DB exposed by server/db.ts.
// - The QE projects table (qe-schema) lives on the QE DB exposed by
//   server/qe/db.ts. We resolve QE-project-id -> SDLC-project-id via that
//   table, then do the rest of the work against the SDLC DB.
import { db as sdlcDb } from "../db";
import { db as qeDb } from "./db";
import * as schema from "@shared/schema";
import { projects as qeProjects } from "@shared/qe-schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { OptimizedRAGOrchestrator } from "../ai/RAG_agents/optimizedRAGOrchestrator";
import { randomUUID } from "crypto";

export interface LoadGoldenRepoGuidanceInput {
  /**
   * Project identifier from the QE generation request. Accepted forms (tried
   * in order): QE `projects.id` (UUID), SDLC `sdlc_projects.id`, SDLC
   * `sdlc_projects.projectId`, or `jiraProjectKey`.
   */
  projectId: string;
  /** Free-text query passed to the RAG orchestrator -- e.g. user story title + AC. */
  ragQuery: string;
  tenantId?: string | null;
  userId?: string | null;
}

export interface GoldenRepoGuidanceResult {
  /** Final RAG summary text to inject into LLM prompts. Empty string when no guidance loaded. */
  guidance: string;
  /** Resolved SDLC golden repo id, when found. */
  goldenRepoId: string | null;
  /** Resolved SDLC project id used for the lookup. */
  sdlcProjectId: string | null;
  /** Source filenames that contributed chunks to the guidance. */
  files: string[];
  /** Reason the loader produced no guidance (for diagnostic logs / SSE events). */
  skipReason:
    | null
    | "no-project"
    | "no-golden-repo-reference"
    | "empty-file-paths"
    | "no-chunks-vectorized"
    | "rag-failed"
    | "rag-empty-summary";
}

const EMPTY_RESULT: GoldenRepoGuidanceResult = {
  guidance: "",
  goldenRepoId: null,
  sdlcProjectId: null,
  files: [],
  skipReason: "no-project",
};

// One orchestrator instance per server process. The class internally tracks
// per-session state in a Map keyed by sessionId, so reuse is safe.
let _orchestrator: OptimizedRAGOrchestrator | null = null;
function getOrchestrator(): OptimizedRAGOrchestrator {
  if (!_orchestrator) _orchestrator = new OptimizedRAGOrchestrator();
  return _orchestrator;
}

/**
 * Resolve a request-supplied id to an SDLC project row that may carry a
 * golden_repo_reference. Tries QE -> SDLC linkage first, then falls back to
 * direct SDLC lookups (id / projectId / jiraProjectKey) the same way BRD
 * does.
 */
async function resolveSdlcProject(projectIdOrKey: string): Promise<{
  sdlcProjectId: string | null;
  goldenRepoReference: unknown;
} | null> {
  // Step 1: treat as a QE project id and follow the SDLC link.
  try {
    const [qeRow] = await qeDb
      .select({
        id: qeProjects.id,
        devxSdlcProjectId: qeProjects.devxSdlcProjectId,
      })
      .from(qeProjects)
      .where(eq(qeProjects.id, projectIdOrKey))
      .limit(1);

    if (qeRow?.devxSdlcProjectId) {
      const [sdlcRow] = await sdlcDb
        .select({
          id: schema.sdlcProjects.id,
          goldenRepoReference: schema.sdlcProjects.goldenRepoReference,
        })
        .from(schema.sdlcProjects)
        .where(eq(schema.sdlcProjects.id, qeRow.devxSdlcProjectId))
        .limit(1);
      if (sdlcRow) {
        return { sdlcProjectId: sdlcRow.id, goldenRepoReference: sdlcRow.goldenRepoReference };
      }
    }
  } catch {
    // qe.projects may not be queryable in some envs -- fall through to direct SDLC lookup
  }

  // Step 2: treat as an SDLC id / projectId / jiraProjectKey.
  const [sdlcRow] = await sdlcDb
    .select({
      id: schema.sdlcProjects.id,
      goldenRepoReference: schema.sdlcProjects.goldenRepoReference,
    })
    .from(schema.sdlcProjects)
    .where(
      or(
        eq(schema.sdlcProjects.id, projectIdOrKey),
        eq(schema.sdlcProjects.projectId, projectIdOrKey),
        eq(schema.sdlcProjects.jiraProjectKey, projectIdOrKey),
      ),
    )
    .limit(1);

  if (!sdlcRow) return null;
  return { sdlcProjectId: sdlcRow.id, goldenRepoReference: sdlcRow.goldenRepoReference };
}

/**
 * Load pre-vectorized chunks from devx_guideline_chunks for the given
 * golden repo + filenames. Returns one concatenated text per file.
 *
 * NOTE: unlike BRD's `buildComplianceGuidelinesFromProject` we do not
 * fall back to a live ADO/GitHub fetch here -- the QE flow only consumes
 * already-indexed content. Operators can re-index via the Golden Repos
 * UI ("Chunk" action) if files are missing. A future iteration can add
 * the live-fetch fallback by importing `fetchGoldenRepoFileContent` from
 * `server/golden-repos/fetch-guideline.ts`.
 */
async function loadGuidelineDocsFromCache(
  goldenRepoId: string,
  filePaths: string[],
): Promise<Record<string, string>> {
  const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const candidates = (p: string) => Array.from(new Set([p, normalize(p), `/${normalize(p)}`]));
  const allCandidates = Array.from(
    new Set(filePaths.flatMap(candidates).filter((s) => s.length > 0)),
  );
  if (allCandidates.length === 0) return {};

  const vectorized = await sdlcDb
    .select({
      id: schema.devxVectorizedGuidelines.id,
      guidelineName: schema.devxVectorizedGuidelines.guidelineName,
    })
    .from(schema.devxVectorizedGuidelines)
    .where(
      and(
        eq(schema.devxVectorizedGuidelines.goldenRepoId, goldenRepoId),
        eq(schema.devxVectorizedGuidelines.status, "vectorized"),
        inArray(schema.devxVectorizedGuidelines.guidelineName, allCandidates),
      ),
    );

  if (vectorized.length === 0) return {};

  const guidelineIds = vectorized.map((g) => g.id);
  const chunks = await sdlcDb
    .select({
      guidelineId: schema.devxGuidelineChunks.guidelineId,
      chunkIndex: schema.devxGuidelineChunks.chunkIndex,
      chunkText: schema.devxGuidelineChunks.chunkText,
    })
    .from(schema.devxGuidelineChunks)
    .where(inArray(schema.devxGuidelineChunks.guidelineId, guidelineIds))
    .orderBy(schema.devxGuidelineChunks.guidelineId, schema.devxGuidelineChunks.chunkIndex);

  const byGuideline = new Map<string, Array<{ idx: number; text: string }>>();
  for (const c of chunks) {
    const key = String(c.guidelineId);
    if (!byGuideline.has(key)) byGuideline.set(key, []);
    byGuideline.get(key)!.push({ idx: c.chunkIndex, text: String(c.chunkText ?? "") });
  }

  const out: Record<string, string> = {};
  for (const v of vectorized) {
    const parts = byGuideline.get(String(v.id)) ?? [];
    const text = parts
      .sort((a, b) => a.idx - b.idx)
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text.length > 0) out[v.guidelineName] = text;
  }
  return out;
}

/**
 * Main entry point. See module-level docstring for the overall chain.
 *
 * Failure modes are non-fatal: any error inside loading or RAG produces an
 * empty `guidance` with a populated `skipReason`, so the QE pipeline can
 * fall back to its existing local-repo / uploaded-docs path without
 * surfacing an error to the user.
 */
export async function loadGoldenRepoGuidance(
  input: LoadGoldenRepoGuidanceInput,
): Promise<GoldenRepoGuidanceResult> {
  const projectId = (input.projectId || "").trim();
  if (!projectId) return { ...EMPTY_RESULT, skipReason: "no-project" };

  let project: { sdlcProjectId: string | null; goldenRepoReference: unknown } | null;
  try {
    project = await resolveSdlcProject(projectId);
  } catch (err) {
    console.warn("[QE][GoldenRepo] resolveSdlcProject failed", { projectId, err: errMsg(err) });
    return { ...EMPTY_RESULT, skipReason: "no-project" };
  }
  if (!project || !project.sdlcProjectId) {
    return { ...EMPTY_RESULT, skipReason: "no-project" };
  }
  const sdlcProjectId = project.sdlcProjectId;

  const ref = (project.goldenRepoReference || null) as
    | { repoId?: string; filePaths?: string[] }
    | null;
  if (!ref || typeof ref !== "object") {
    return { ...EMPTY_RESULT, sdlcProjectId, skipReason: "no-golden-repo-reference" };
  }
  const repoId = typeof ref.repoId === "string" ? ref.repoId : "";
  const filePaths = Array.isArray(ref.filePaths)
    ? ref.filePaths.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];

  if (!repoId || filePaths.length === 0) {
    // "All files" today stores filePaths: [] -- treat as no-op (matches BRD).
    return {
      ...EMPTY_RESULT,
      sdlcProjectId,
      goldenRepoId: repoId || null,
      skipReason: filePaths.length === 0 ? "empty-file-paths" : "no-golden-repo-reference",
    };
  }

  let guidelineDocuments: Record<string, string>;
  try {
    guidelineDocuments = await loadGuidelineDocsFromCache(repoId, filePaths);
  } catch (err) {
    console.warn("[QE][GoldenRepo] chunk fetch failed", {
      sdlcProjectId,
      repoId,
      err: errMsg(err),
    });
    return {
      ...EMPTY_RESULT,
      sdlcProjectId,
      goldenRepoId: repoId,
      skipReason: "no-chunks-vectorized",
    };
  }

  const fileNames = Object.keys(guidelineDocuments);
  if (fileNames.length === 0) {
    console.warn("[QE][GoldenRepo] no vectorized chunks for any of the configured files", {
      sdlcProjectId,
      repoId,
      filePaths,
    });
    return {
      ...EMPTY_RESULT,
      sdlcProjectId,
      goldenRepoId: repoId,
      skipReason: "no-chunks-vectorized",
    };
  }

  // Run the same orchestrator BRD uses; CAG mode skips chunking/embeddings/FAISS
  // and just stuffs / page-indexes the guideline corpus, returning a summary
  // tailored to the user query.
  const sessionId = `qe-sprint-${randomUUID()}`;
  const orchestrator = getOrchestrator();
  let guidance = "";
  try {
    const ragResponse = await orchestrator.processBrdWithGuidelines(
      sessionId,
      // The orchestrator uses `brdContent` mostly for requirement extraction
      // (skipped in CAG mode) -- the operative input is `userQuery`.
      input.ragQuery,
      guidelineDocuments,
      sdlcProjectId,
      input.ragQuery,
      { goldenRepoId: repoId, pipelineModeOverride: "cag_pageindex" },
    );
    if (ragResponse?.success && typeof ragResponse.finalSummary === "string") {
      guidance = ragResponse.finalSummary.trim();
    }
  } catch (err) {
    console.warn("[QE][GoldenRepo] processBrdWithGuidelines threw", {
      sdlcProjectId,
      repoId,
      err: errMsg(err),
    });
    return {
      guidance: "",
      goldenRepoId: repoId,
      sdlcProjectId,
      files: fileNames,
      skipReason: "rag-failed",
    };
  }

  if (!guidance) {
    return {
      guidance: "",
      goldenRepoId: repoId,
      sdlcProjectId,
      files: fileNames,
      skipReason: "rag-empty-summary",
    };
  }

  return {
    guidance,
    goldenRepoId: repoId,
    sdlcProjectId,
    files: fileNames,
    skipReason: null,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
