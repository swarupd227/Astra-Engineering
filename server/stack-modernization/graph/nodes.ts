/**
 * LangGraph nodes for Stack Modernization. Each node loads state from stateStore, runs an agent, saves back.
 */

import { interrupt } from "@langchain/langgraph";
import type { StackModGraphState } from "./state";
import { stateStore } from "../services/state-store";
import { recordPhaseStart, recordPhaseEnd } from "../services/llm-call-tracker";
import { persistTokenUsage } from "../services/db-persistence";
import { hasAtLeastOneUpgrade } from "../utils/version-selection-validation";
import { executeAssessmentAgent } from "../agents/assessment-agent";
import { buildCouplingRegistry } from "../agents/coupling-registry-agent";
import { executeMigrationDocsFetchAgent } from "../agents/migration-docs-fetch-agent";
import { executePlanningAgent } from "../agents/planning-agent";
import { executeTaskPlannerAgent } from "../agents/task-planner-agent";
import { executeCodeUpgradeAgent } from "../agents/code-upgrade-agent";
import { executeConsistencyValidator } from "../agents/consistency-validator-agent";
import { executeCodeReviewFixAgent } from "../agents/code-review-fix-agent";
import { executeTestGenerationAgent } from "../agents/test-generation-agent";
import type { VersionSelection } from "../types";
import type { SelectablePhase } from "../types";
import type { CodeGenerationProgressContext } from "../services/code-generation-loop";
import { codeExecutionService, isCodeExecutionEnabled } from "../../code-execution";
import type { StackType } from "../../code-execution/types";
import { runContainerExecution } from "../../container-orchestration";
import { createContainerExecutionAdapter } from "../services/container-execution-adapter";
import { resolveIntendedTfm } from "../services/prepare-project-dir";
import { stackModConfig } from "../config";
import { resolveAdoPat } from "../services/resolve-ado-pat";

async function resolveAdoConfigForGit(analysisId: string): Promise<{ organization: string; project: string; pat: string } | null> {
  const state = stateStore.get(analysisId);
  if (!state?.adoOrg || !state.adoProjectName) return null;
  const pat = await resolveAdoPat(state.adoOrg);
  if (!pat) return null;
  return { organization: state.adoOrg, project: state.adoProjectName, pat };
}

function getState(analysisId: string) {
  const state = stateStore.get(analysisId);
  if (!state) throw new Error(`State not found for analysis ${analysisId}`);
  return state;
}

function isPhaseSelected(analysisId: string, phase: SelectablePhase): boolean {
  const state = stateStore.get(analysisId);
  if (!state?.selectedPhases || state.selectedPhases.length === 0) return true;
  return state.selectedPhases.includes(phase);
}

/**
 * Check if the analysis should be aborted (paused or cancelled).
 *
 * - For "paused": calls LangGraph `interrupt()` which STOPS the graph at a
 *   checkpoint.  When the user resumes (via Command({ resume })), the node
 *   re-executes from the top.  By then the resume endpoint has already set
 *   status back to "in_progress", so the re-check falls through and the node
 *   continues normally.
 *
 * - For "cancelled": returns `true` so the calling node can return `{}`.
 *   Cancellation means we *want* the remaining nodes to complete (as no-ops)
 *   so the graph reaches END and the thread can be garbage-collected.
 */
function shouldAbortNode(analysisId: string): boolean {
  const state = stateStore.get(analysisId);
  if (!state) return false;

  if (state.status === "paused") {
    // Record which node we're pausing at so the client can show the right stage
    console.log(`[shouldAbortNode] Analysis ${analysisId} is paused at: ${state.currentStage}. Interrupting graph.`);
    interrupt({ reason: "paused", currentStage: state.currentStage });
    // When resumed, execution continues here.  Status is already "in_progress"
    // (set by the resume endpoint before sending Command({ resume })).
    return false;
  }

  return state.status === "cancelled";
}

/** Persist token usage snapshot to DB after each phase (fire-and-forget). */
function persistTokenSnapshot(analysisId: string): void {
  const state = stateStore.get(analysisId);
  if (!state?.tokenUsage) return;
  const fileCount = state.extractedFiles?.length ?? 0;
  const totalLines = (state.extractedFiles ?? []).reduce((sum, f) => sum + (f.content?.split("\n").length ?? 0), 0);
  persistTokenUsage(analysisId, state.tokenUsage, fileCount, totalLines).catch(() => {});
}

function anyPhaseSelected(analysisId: string, phases: SelectablePhase[]): boolean {
  const state = stateStore.get(analysisId);
  if (!state?.selectedPhases || state.selectedPhases.length === 0) return true;
  return phases.some(p => state.selectedPhases!.includes(p));
}

const ALL_PHASES: SelectablePhase[] = ["assessment", "planning", "packages", "tasks", "execution", "tests", "validation"];

/** Calculate proportional progress value based on how many phases are selected and which phase just completed. */
function phaseProgress(analysisId: string, completedPhase: SelectablePhase): number {
  const state = stateStore.get(analysisId);
  const selected = state?.selectedPhases?.length ? state.selectedPhases : ALL_PHASES;
  const total = selected.length + 1; // +1 for upload
  const idx = selected.indexOf(completedPhase);
  if (idx === -1) return 50;
  return Math.round(((idx + 2) / total) * 100); // +2 because upload is step 1
}

/** Run assessment (repo profiler + dependency graph + version intelligence). */
export async function assessmentNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "assessment")) {
    const s = getState(analysisId);
    s.currentStage = "Assessment skipped";
    s.progress = phaseProgress(analysisId, "assessment");
    stateStore.save(s);
    return {};
  }
  recordPhaseStart(analysisId, "assessment");
  const t0 = Date.now();
  const stackState = getState(analysisId);
  console.log(`[assessmentNode] Starting assessment for ${analysisId} (${stackState.extractedFiles?.length ?? 0} extracted files)`);
  const updated = await executeAssessmentAgent(stackState);
  console.log(`[assessmentNode] Assessment completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  recordPhaseEnd(analysisId, "assessment");
  stateStore.save(updated);
  persistTokenSnapshot(analysisId);
  stateStore.saveToDb(analysisId).catch(() => {});
  stateStore.savePhaseToDb(analysisId, "assessment", "completed", {
    repoProfile: updated.repoProfile,
    dependencyGraph: updated.dependencyGraph,
    versionIntelligence: updated.versionIntelligence,
    securityAssessment: updated.securityAssessment,
    codeQuality: updated.codeQuality,
    breakingChangesPreview: updated.breakingChangesPreview,
    databaseDependencies: updated.databaseDependencies,
    requirementsAnalysis: updated.requirementsAnalysis,
    assessmentSubAgentStatus: updated.assessmentSubAgentStatus,
    astAnalysis: updated.astAnalysis,
    repoMap: (updated as any).repoMap,
    extractedFiles: updated.extractedFiles?.length ? updated.extractedFiles : undefined,
    versionRecommendationsText: (updated as any).versionRecommendationsText,
    // Vendor library detection results (needed for version selection UI + code upgrade)
    vendorLibraries: updated.vendorLibraries,
    bundleDetections: updated.bundleDetections,
    discoveredBundledLibraries: updated.discoveredBundledLibraries,
    cdnReferences: (updated as any).cdnReferences,
    inferredLibraries: (updated as any).inferredLibraries,
  }, updated.assessmentMarkdown).catch(() => {});

  // Push assessment report + source files to Git (sequential to avoid 409 branch conflicts)
  resolveAdoConfigForGit(analysisId).then(async (cfg) => {
    if (!cfg) return;
    try { await stateStore.saveReportsToGit(analysisId, cfg); } catch {}
    try {
      const count = await stateStore.saveExtractedFilesToGit(analysisId, cfg);
      if (count === 0 && (updated.extractedFiles?.length ?? 0) > 0) {
        console.error(`[assessmentNode] Git push returned 0 files but ${updated.extractedFiles!.length} were expected — marking gitPushFailed`);
        const s = stateStore.get(analysisId);
        if (s) {
          (s as any).gitPushFailed = true;
          stateStore.save(s);
        }
      }
    } catch {}
  }).catch(() => {});

  return {};
}

/** Build coupling registry: static analysis of file dependencies — no LLM, always fast. */
export async function buildCouplingRegistryNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  const stackState = getState(analysisId);

  recordPhaseStart(analysisId, "coupling");
  const t0 = Date.now();
  const fileCount = stackState.extractedFiles?.length ?? 0;
  console.log(`[buildCouplingRegistryNode] Starting coupling analysis (${fileCount} files)`);

  try {
    const registry = buildCouplingRegistry(stackState);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const totalGroupFiles = registry.reduce((sum, g) => sum + g.files.length, 0);
    console.log(`[buildCouplingRegistryNode] Completed in ${elapsed}s — ${registry.length} groups, ${totalGroupFiles} total files in groups`);
    stackState.couplingRegistry = registry;
    stackState.currentStage = `Coupling registry built (${registry.length} groups)`;
    stateStore.save(stackState);
  } catch (err) {
    console.warn("[buildCouplingRegistryNode] Non-fatal:", err instanceof Error ? err.message : err);
  }

  // Scan vendor directories from DISK (not filtered extractedFiles) and detect vendor libraries
  // This catches wwwroot/lib/ files that are excluded from extractedFiles by VENDOR_PATH_PATTERNS
  try {
    if (stackState.tempDir) {
      const { scanVendorDirectories, getExtractedDir } = await import("../services/temp-storage");
      const { detectVendorLibraries } = await import("../services/vendor-library-updater");
      const extractDir = getExtractedDir(stackState.tempDir);
      const vendorEntries = await scanVendorDirectories(extractDir);
      if (vendorEntries.length > 0) {
        const vendorLibs = detectVendorLibraries(vendorEntries, stackState.extractedFiles ?? []);
        stackState.vendorLibraries = vendorLibs;
        console.log(`[buildCouplingRegistryNode] Vendor dir scan: ${vendorLibs.length} libraries from ${vendorEntries.length} files`);
      }
    }
  } catch (err) {
    console.warn("[buildCouplingRegistryNode] Vendor dir scan failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // GAP 15: Early bundle detection — surface bundled vendor files in assessment
  // so the user sees ALL libraries (including those inside concatenated bundles)
  // Scan BOTH extractedFiles AND vendor files from disk for version comment headers
  try {
    const { scanAllFilesForBundles, mergeBundleDetections } = await import("../services/vendor-library-updater");
    const extractedFiles = stackState.extractedFiles ?? [];

    // Also read vendor files from disk for bundle scanning (these are excluded from extractedFiles)
    let vendorFilesForBundleScan: Array<{ relativePath: string; content: string }> = [];
    if (stackState.tempDir) {
      try {
        const { getExtractedDir } = await import("../services/temp-storage");
        const fsP = await import("fs/promises");
        const pathM = await import("path");
        const extractDir = getExtractedDir(stackState.tempDir);

        // Read vendor JS/CSS files from disk for bundle header scanning
        async function readVendorFiles(dir: string, prefix: string): Promise<void> {
          let entries;
          try { entries = await fsP.readdir(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const fullPath = pathM.join(dir, entry.name);
            if (entry.isDirectory()) {
              await readVendorFiles(fullPath, relPath);
            } else if (entry.isFile()) {
              const ext = pathM.extname(entry.name).toLowerCase();
              if (ext !== ".js" && ext !== ".css") continue;
              // Only read files that are in vendor paths — uses centralized patterns for ALL tech stacks
              const { isVendorPath } = await import("../services/temp-storage");
              if (!isVendorPath(relPath)) continue;
              try {
                const content = await fsP.readFile(fullPath, "utf-8");
                vendorFilesForBundleScan.push({ relativePath: relPath, content });
              } catch { /* skip unreadable */ }
            }
          }
        }
        await readVendorFiles(extractDir, "");
        if (vendorFilesForBundleScan.length > 0) {
          console.log(`[buildCouplingRegistryNode] Read ${vendorFilesForBundleScan.length} vendor JS/CSS files from disk for bundle scanning`);
        }
      } catch { /* non-fatal */ }
    }

    const allFilesForScan = [...extractedFiles, ...vendorFilesForBundleScan];
    if (allFilesForScan.length > 0) {
      const bundles = scanAllFilesForBundles(allFilesForScan);
      if (bundles.length > 0) {
        const allBundledLibs = bundles.flatMap(b => b.libraries.map(l => `${l.npmPackage}@${l.version}`));
        const concatenated = bundles.filter(b => b.isConcatenated);
        console.log(`[buildCouplingRegistryNode] Bundle scan: ${allBundledLibs.length} libraries found in ${bundles.length} files (${concatenated.length} concatenated)`);

        // Store for downstream consumption (assessment display, version selection)
        stackState.bundleDetections = bundles;
        stackState.discoveredBundledLibraries = allBundledLibs;

        // CRITICAL FIX: Merge bundled libraries into vendorLibraries so they get
        // version recommendations, appear in the selection UI, and get upgraded.
        // Previously this was missing — bundles were detected but never registered.
        const mergeResult = mergeBundleDetections(stackState.vendorLibraries ?? [], bundles);
        stackState.vendorLibraries = mergeResult.vendors;
        console.log(`[buildCouplingRegistryNode] After bundle merge: ${stackState.vendorLibraries.length} total vendor libraries`);

        // Surface in the assessment markdown if it exists
        if (stackState.assessmentMarkdown) {
          const bundleSection = [
            "",
            "## Bundled Vendor Libraries Detected",
            "",
            ...bundles.map(b => {
              const libs = b.libraries.map(l => `${l.name} v${l.version}`).join(", ");
              return `- **${b.filePath}**: ${b.isConcatenated ? "⚠️ CONCATENATED" : ""} ${libs}`;
            }),
            "",
          ].join("\n");
          stackState.assessmentMarkdown += bundleSection;
        }

        stateStore.save(stackState);
      }
    }
  } catch (err) {
    console.warn("[buildCouplingRegistryNode] Bundle scan failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // CDN <script>/<link> reference scanning + CSS-class-inferred library detection
  try {
    const { scanHtmlForCdnReferences, scanForCssClassLibraries } = await import("../services/code-analyzer");
    const { mergeCdnAndInferredDetections } = await import("../services/vendor-library-updater");

    const extractedFiles = stackState.extractedFiles ?? [];
    if (extractedFiles.length > 0) {
      const cdnRefs = scanHtmlForCdnReferences(extractedFiles);
      const inferred = scanForCssClassLibraries(extractedFiles);

      stackState.cdnReferences = cdnRefs;
      stackState.inferredLibraries = inferred;

      if (cdnRefs.length > 0 || inferred.length > 0) {
        stackState.vendorLibraries = mergeCdnAndInferredDetections(
          stackState.vendorLibraries ?? [],
          cdnRefs,
          inferred,
        );

        // Surface in assessment markdown
        if (stackState.assessmentMarkdown) {
          const sections: string[] = [""];

          if (cdnRefs.length > 0) {
            sections.push("## CDN Library References Detected", "");
            const byFile = new Map<string, typeof cdnRefs>();
            for (const ref of cdnRefs) {
              if (!byFile.has(ref.file)) byFile.set(ref.file, []);
              byFile.get(ref.file)!.push(ref);
            }
            for (const [file, refs] of byFile) {
              sections.push(`### ${file}`);
              for (const ref of refs) {
                sections.push(`- **${ref.library}** ${ref.version ?? "(version unknown)"} — \`<${ref.tagType}>\` from ${ref.url}`);
              }
              sections.push("");
            }
          }

          if (inferred.length > 0) {
            sections.push("## CSS-Class-Inferred Libraries", "");
            for (const lib of inferred) {
              const badge = lib.confidence === "high" ? "✅" : lib.confidence === "medium" ? "⚠️" : "❓";
              sections.push(`- ${badge} **${lib.library}** (${lib.npmPackage}) — ${lib.confidence} confidence — found in ${lib.detectedIn.length} file(s)`);
              if (lib.evidence.length > 0) {
                sections.push(`  - Evidence: \`${lib.evidence.slice(0, 3).join("`, `")}\``);
              }
            }
            sections.push("");
          }

          stackState.assessmentMarkdown += sections.join("\n");
        }

        stateStore.save(stackState);
      }
    }
  } catch (err) {
    console.warn("[buildCouplingRegistryNode] CDN/CSS-class scan failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  recordPhaseEnd(analysisId, "coupling");

  return {};
}

/** Interrupt: wait for user to submit version selections. On resume, save selections and proceed. */
export async function waitForSelectionsNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  const assessmentRan = isPhaseSelected(analysisId, "assessment");
  const needsVersionSelections = anyPhaseSelected(analysisId, ["planning", "tasks", "execution"]);
  if (!assessmentRan && !needsVersionSelections) {
    const s = getState(analysisId);
    s.currentStage = "Version selection skipped";
    s.progress = phaseProgress(analysisId, "assessment");
    s.status = "in_progress";
    stateStore.save(s);
    return {};
  }
  // Set currentStage BEFORE interrupt so the frontend can detect the waiting state.
  // Previous nodes (e.g. buildCouplingRegistryNode) may have overwritten it.
  const stackState = getState(analysisId);
  stackState.currentStage = "awaiting_user_selection";
  stateStore.save(stackState);

  const payload = interrupt({
    type: "awaiting_user_selection",
    analysisId,
    message: "Submit version selections to continue.",
  });
  const selections = payload as Array<{ package: string; selectedVersion: string; currentVersion?: string; category?: string }>;
  if (!Array.isArray(selections) || selections.length === 0) {
    stackState.errors = stackState.errors || [];
    stackState.errors.push("No version selections provided on resume.");
    stackState.status = "failed";
    stateStore.save(stackState);
    throw new Error("No version selections provided on resume.");
  }
  const mapped = selections.map((s) => ({
    package: s.package,
    selectedVersion: s.selectedVersion,
    currentVersion: s.currentVersion ?? "unknown",
    category: (s.category as "runtime" | "framework" | "library") ?? "runtime",
  })) as VersionSelection[];
  stackState.userSelections = mapped;
  stackState.currentStage = "Version selections received";
  stackState.progress = 40;
  stackState.status = "in_progress";
  stateStore.save(stackState);
  return {};
}

/** Validate that at least one selection has target !== current. Throws if no upgrade (route returns 400). */
export async function validateSelectionsNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  const stackState = getState(analysisId);
  const needsUpgradeValidation = anyPhaseSelected(analysisId, ["planning", "tasks", "execution"]);
  if (!needsUpgradeValidation) {
    return {};
  }
  if (!hasAtLeastOneUpgrade(stackState.userSelections ?? [])) {
    stackState.errors = stackState.errors || [];
    stackState.errors.push("No upgrade needed. All selected versions match current.");
    stackState.status = "failed";
    stateStore.save(stackState);
    throw new Error("No upgrade needed. All selected versions match current. Change at least one target to proceed.");
  }
  return {};
}

/** Fetch migration docs early so all downstream nodes can use them. */
export async function fetchMigrationDocsNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (!anyPhaseSelected(analysisId, ["planning", "tasks", "execution"])) {
    const s = getState(analysisId);
    s.currentStage = "Migration docs fetch skipped (no downstream phases)";
    stateStore.save(s);
    return {};
  }

  recordPhaseStart(analysisId, "migrationDocs");
  const stackState = getState(analysisId);
  stackState.currentStage = "Fetching official migration documentation...";
  stateStore.save(stackState);

  try {
    const updated = await executeMigrationDocsFetchAgent(stackState);
    stateStore.save(updated);

    const warnings = updated.migrationDocsWarnings ?? [];
    if (warnings.length > 0) {
      console.warn(`[fetchMigrationDocsNode] Warnings: ${warnings.join("; ")}`);
    }
  } catch (err) {
    console.warn("[fetchMigrationDocsNode] Non-fatal:", err instanceof Error ? err.message : err);
  }
  recordPhaseEnd(analysisId, "migrationDocs");

  return {};
}

/** Planning: compatibility check + risk report + plan markdown. */
export async function planningNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "planning")) {
    const s = getState(analysisId);
    s.currentStage = "Planning skipped";
    s.progress = phaseProgress(analysisId, "planning");
    stateStore.save(s);
    return {};
  }
  recordPhaseStart(analysisId, "planning");
  const stackState = getState(analysisId);
  const updated = await executePlanningAgent(stackState);
  recordPhaseEnd(analysisId, "planning");
  stateStore.save(updated);
  persistTokenSnapshot(analysisId);
  stateStore.saveToDb(analysisId).catch(() => {});
  stateStore.savePhaseToDb(analysisId, "planning", "completed", {
    userSelections: updated.userSelections,
    compatibilityCheck: updated.compatibilityCheck,
    riskReport: updated.riskReport,
    planningVisualizationData: updated.planningVisualizationData,
    versionRecommendationsText: (updated as any).versionRecommendationsText,
  }, updated.planMarkdown).catch(() => {});

  // Push planning report to Git (fire-and-forget)
  resolveAdoConfigForGit(analysisId).then(cfg => {
    if (!cfg) return;
    stateStore.saveReportsToGit(analysisId, cfg).catch(() => {});
  }).catch(() => {});

  return {};
}

/** Interrupt: wait for user approval after risk report. On resume, proceed to task planning. */
export async function waitForApprovalNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (!isPhaseSelected(analysisId, "planning") || !anyPhaseSelected(analysisId, ["tasks", "execution", "tests", "validation"])) {
    const s = getState(analysisId);
    s.currentStage = "Approval skipped (not needed for selected phases)";
    s.progress = phaseProgress(analysisId, "planning");
    stateStore.save(s);
    return {};
  }
  const stackState = getState(analysisId);
  stackState.status = "risk_report_ready";
  stackState.currentStage = "Risk analysis complete - awaiting user approval";
  stackState.progress = phaseProgress(analysisId, "planning");
  stateStore.save(stackState);
  interrupt({ type: "risk_report_ready", analysisId, message: "Approve to continue to code generation." });
  return {};
}

/**
 * Vendor Download Node — Downloads and replaces ALL vendor library files BEFORE task generation.
 * Like a real developer: install/update packages FIRST, then plan and write code.
 *
 * This node runs after user approval and before task planning so:
 * 1. The task planner knows which libraries were successfully downloaded
 * 2. The LLM code upgrade agent has real upgraded library files on disk
 * 3. No wasted LLM task on "Download vendor libraries"
 */
export async function vendorDownloadNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};

  const stackState = getState(analysisId);
  const selections = stackState.userSelections ?? [];
  const vendorLibs = stackState.vendorLibraries ?? [];
  const bundleDets = (stackState.bundleDetections ?? []) as any[];
  const tempDir = stackState.tempDir;

  // Initialize download results — structured objects for rich UI
  const downloadResults: NonNullable<typeof stackState.vendorDownloadResults> = {
    downloaded: [] as any[],
    failed: [],
    skipped: [],
  };

  // Set status so the UI stepper shows "Packages" as the active phase
  stackState.status = "downloading_packages";
  stackState.currentStage = "Preparing vendor library download...";
  stateStore.save(stackState);

  console.log(`[vendorDownloadNode] Starting vendor library download. Vendors: ${vendorLibs.length}, Bundles: ${bundleDets.length}, Selections: ${selections.length}, TempDir: ${tempDir ? "YES" : "MISSING"}`);

  if (selections.length === 0 || !tempDir) {
    console.log("[vendorDownloadNode] No selections or tempDir — skipping vendor download");
    stackState.vendorDownloadResults = downloadResults;
    stackState.status = "packages_complete";
    stateStore.save(stackState);
    return {};
  }

  const { getExtractedDir } = await import("../services/temp-storage");
  const extractDir = getExtractedDir(tempDir);
  const fsP = await import("fs/promises");
  const pathM = await import("path");

  // ── Phase 1: Download individual vendor files ──
  if (vendorLibs.length > 0) {
    stackState.currentStage = `Downloading vendor libraries (${vendorLibs.length} detected)...`;
    stackState.progress = phaseProgress(analysisId, "execution") + 1;
    stateStore.save(stackState);

    try {
      const { downloadVendorDistFiles } = await import("../services/vendor-library-updater");
      console.log(`[vendorDownloadNode] Vendor names: ${vendorLibs.map((v: any) => `${v.name}@${v.detectedVersion ?? "?"}`).join(", ")}`);

      const downloadedFiles = await downloadVendorDistFiles(
        vendorLibs,
        selections,
        extractDir,
        { perFileTimeoutMs: 10_000, totalTimeoutMs: 120_000 },
      );

      for (const dvf of downloadedFiles) {
        downloadResults.downloaded.push({
          library: dvf.library, version: dvf.newVersion,
          source: `https://cdn.jsdelivr.net/npm/${encodeURIComponent(dvf.library)}@${dvf.newVersion}/...`,
          destination: dvf.projectPath, sizeBytes: dvf.content.length, durationMs: 0, type: "individual" as const,
        });
        // Write to disk for ZIP
        try {
          const fullPath = pathM.join(extractDir, dvf.projectPath);
          await fsP.mkdir(pathM.dirname(fullPath), { recursive: true });
          await fsP.writeFile(fullPath, dvf.content, "utf-8");
        } catch { /* disk write failed */ }
        // Add to modifiedFiles so ZIP overlay and diff viewer pick it up
        (stackState.modifiedFiles ??= []).push({
          path: dvf.projectPath,
          content: dvf.content,
          originalContent: dvf.originalContent || "",
          changes: [{ package: dvf.library, oldVersion: dvf.oldVersion || "unknown", newVersion: dvf.newVersion }],
        });
      }

      console.log(`[vendorDownloadNode] Phase 1 complete: ${downloadedFiles.length} individual vendor files downloaded`);
    } catch (err: any) {
      console.error("[vendorDownloadNode] Phase 1 FAILED:", err?.message || err);
      downloadResults.failed.push({ library: "vendor-download", version: "", source: "jsDelivr", reason: err?.message || "Phase 1 error" });
    }
  }

  // ── Phase 2: Rebuild concatenated bundles (e.g., base-library.js = jQuery + Bootstrap) ──
  const concatenatedBundles = bundleDets.filter((b: any) => b.libraries && b.libraries.length >= 1);
  if (concatenatedBundles.length > 0) {
    stackState.currentStage = `Rebuilding ${concatenatedBundles.length} bundled library files...`;
    stateStore.save(stackState);

    try {
      const { rebuildConcatenatedBundles } = await import("../services/vendor-library-updater");
      console.log(`[vendorDownloadNode] Rebuilding bundles: ${concatenatedBundles.map((b: any) => `${b.filePath} (${b.libraries?.length ?? 0} libs)`).join(", ")}`);

      const rebuiltFiles = await rebuildConcatenatedBundles(
        concatenatedBundles,
        selections,
        extractDir,
      );

      for (const rf of rebuiltFiles) {
        downloadResults.downloaded.push({
          library: rf.library, version: rf.newVersion,
          source: "jsDelivr (concatenated bundle)",
          destination: rf.projectPath, sizeBytes: rf.content.length, durationMs: 0, type: "bundle" as const,
        });
        // Write to disk
        try {
          const fullPath = pathM.join(extractDir, rf.projectPath);
          await fsP.mkdir(pathM.dirname(fullPath), { recursive: true });
          await fsP.writeFile(fullPath, rf.content, "utf-8");
        } catch { /* disk write failed */ }
        // Add to modifiedFiles so ZIP overlay and diff viewer pick it up
        (stackState.modifiedFiles ??= []).push({
          path: rf.projectPath,
          content: rf.content,
          originalContent: rf.originalContent || "",
          changes: [{ package: rf.library, oldVersion: rf.oldVersion || "", newVersion: rf.newVersion }],
        });
      }

      console.log(`[vendorDownloadNode] Phase 2 complete: ${rebuiltFiles.length} bundles rebuilt`);
    } catch (err: any) {
      console.error("[vendorDownloadNode] Phase 2 FAILED:", err?.message || err);
      downloadResults.failed.push({ library: "bundle-rebuild", version: "", source: "jsDelivr", reason: err?.message || "Phase 2 error" });
    }
  }

  // ── Phase 3: Resolve missing library paths from view references ──
  try {
    stackState.currentStage = "Resolving missing library file references...";
    stateStore.save(stackState);

    const { buildSelectionLookup, fetchFileFromCdn } = await import("../services/vendor-library-updater");
    const findSelection = buildSelectionLookup(selections);

    // Scan extracted view files for ~/lib/ references
    const viewFiles = (stackState.extractedFiles ?? []).filter(
      f => /\.(cshtml|html|razor|htm)$/i.test(f.relativePath)
    );

    const libRefRegex = /~\/lib\/([^"'\s]+)/gi;
    const refsToResolve = new Set<string>();
    for (const vf of viewFiles) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(libRefRegex.source, "gi");
      while ((match = regex.exec(vf.content || "")) !== null) {
        refsToResolve.add(match[1]);
      }
    }

    if (refsToResolve.size > 0) {
      console.log(`[vendorDownloadNode] Phase 3: ${refsToResolve.size} ~/lib/ references found — checking for missing files`);
      let createdCount = 0;

      for (const ref of refsToResolve) {
        const libDirPath = `wwwroot/lib/${ref}`;
        const fullDiskPath = pathM.join(extractDir, libDirPath);

        // Check if file already exists on disk
        try {
          await fsP.access(fullDiskPath);
          continue;
        } catch { /* file doesn't exist */ }

        const libName = ref.split("/")[0];
        const sel = findSelection(libName);
        if (!sel) continue;

        const ext = ref.substring(ref.lastIndexOf(".")).toLowerCase();
        if (ext !== ".js" && ext !== ".css") continue;

        const cdnPath = ref.substring(ref.indexOf("/") + 1);
        try {
          stackState.currentStage = `Downloading ${sel.package}@${sel.selectedVersion}/${cdnPath}...`;
          stateStore.save(stackState);

          const content = await fetchFileFromCdn(sel.package, sel.selectedVersion, cdnPath);
          await fsP.mkdir(pathM.dirname(fullDiskPath), { recursive: true });
          await fsP.writeFile(fullDiskPath, content, "utf-8");
          downloadResults.downloaded.push({
            library: sel.package, version: sel.selectedVersion,
            source: `https://cdn.jsdelivr.net/npm/${encodeURIComponent(sel.package)}@${sel.selectedVersion}/${cdnPath}`,
            destination: libDirPath, sizeBytes: content.length, durationMs: 0, type: "created" as const,
          });
          // Add to modifiedFiles as a NEW file
          (stackState.modifiedFiles ??= []).push({
            path: libDirPath,
            content,
            originalContent: "",
            isNew: true,
            changes: [{ package: sel.package, oldVersion: "none", newVersion: sel.selectedVersion }],
          } as any);
          createdCount++;
        } catch (dlErr: any) {
          console.warn(`[vendorDownloadNode] Could not download ${sel.package}/${cdnPath}:`, dlErr?.message || dlErr);
          downloadResults.failed.push({
            library: sel.package, version: sel.selectedVersion,
            source: `https://cdn.jsdelivr.net/npm/${encodeURIComponent(sel.package)}@${sel.selectedVersion}/${cdnPath}`,
            reason: dlErr?.message || "Download failed",
          });
        }
      }

      console.log(`[vendorDownloadNode] Phase 3 complete: ${createdCount} missing files created`);
    }
  } catch (err) {
    console.error("[vendorDownloadNode] Phase 3 FAILED:", err instanceof Error ? err.message : err);
  }

  // ── Save results ──
  stackState.vendorDownloadResults = downloadResults;
  stackState.status = "packages_complete";
  const totalDlSize = downloadResults.downloaded.reduce((sum, d) => sum + (d.sizeBytes || 0), 0);
  stackState.currentStage = `Vendor download complete: ${downloadResults.downloaded.length} downloaded (${(totalDlSize / 1024).toFixed(1)}KB), ${downloadResults.failed.length} failed`;
  console.log(`[vendorDownloadNode] modifiedFiles count after vendor download: ${(stackState.modifiedFiles ?? []).length}`);
  stateStore.save(stackState);

  console.log(`[vendorDownloadNode] ✅ COMPLETE — Downloaded: ${downloadResults.downloaded.length}, Failed: ${downloadResults.failed.length}, Skipped: ${downloadResults.skipped.length}`);
  console.log(`[vendorDownloadNode] Downloaded items: ${downloadResults.downloaded.join(", ") || "(none)"}`);
  if (downloadResults.failed.length > 0) {
    console.warn(`[vendorDownloadNode] Failed items: ${downloadResults.failed.join(", ")}`);
  }

  return {};
}

/** Task planner: generate tasks from plan. */
export async function taskPlanningNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "tasks")) {
    const s = getState(analysisId);
    s.currentStage = "Task planning skipped";
    s.progress = phaseProgress(analysisId, "tasks");
    stateStore.save(s);
    return {};
  }
  recordPhaseStart(analysisId, "tasks");
  const stackState = getState(analysisId);
  const tpSelections = stackState.userSelections ?? [];
  if (tpSelections.length === 0) {
    console.error(`[taskPlanningNode] ❌ CRITICAL: No userSelections in state for ${analysisId}! Task planner will generate tasks without version targets.`);
  } else {
    console.log(`[taskPlanningNode] User selections (${tpSelections.length}): ${tpSelections.map(s => `${s.package}: ${s.currentVersion} → ${s.selectedVersion}`).join(", ")}`);
  }
  const updated = await executeTaskPlannerAgent(stackState);

  // ── GAP 4: Post-process tasks with dependency DAG ordering ──
  try {
    const { topologicalSortLibraries } = await import("../services/target-library-resolver");
    const tasks = updated.upgradeTasks ?? [];
    if (tasks.length > 1) {
      // Extract library names from task titles for dependency ordering
      const libraryNames = (updated.userSelections ?? []).map((s: any) => s.package);
      const sortedLibs = topologicalSortLibraries(libraryNames);

      // Build a priority map: libraries earlier in topological sort get lower priority (executed first)
      const priorityMap = new Map<string, number>();
      sortedLibs.forEach((lib, idx) => priorityMap.set(lib.toLowerCase(), idx));

      // Also add built-in ordering rules:
      // 1. .csproj / pom.xml / build files ALWAYS first
      // 2. Backend code before frontend code
      // 3. Config files before application code
      const categoryOrder: Record<string, number> = {
        "project-file": 0,     // .csproj, pom.xml, build.gradle
        "config": 10,          // Startup.cs, Program.cs, appsettings.json, web.config
        "backend": 20,         // Controllers, Services, DAL
        "frontend-vendor": 30, // Vendor library replacements
        "frontend-layout": 40, // _Layout.cshtml, index.html
        "frontend-code": 50,   // site.js, app code
        "test": 60,            // Test files
        "other": 70,
      };

      // Assign computed priority to each task
      for (const task of tasks) {
        const titleLower = (task.title ?? "").toLowerCase();
        const filesStr = ((task as any).files ?? []).join(" ").toLowerCase();
        const combined = `${titleLower} ${filesStr}`;

        let priority = categoryOrder["other"];

        if (combined.includes(".csproj") || combined.includes("pom.xml") || combined.includes("build.gradle") || combined.includes("package.json")) {
          priority = categoryOrder["project-file"];
        } else if (combined.includes("startup") || combined.includes("program.cs") || combined.includes("appsettings") || combined.includes("web.config") || combined.includes("middleware")) {
          priority = categoryOrder["config"];
        } else if (combined.includes("controller") || combined.includes("service") || combined.includes("dal") || combined.includes("bll") || combined.includes("repository")) {
          priority = categoryOrder["backend"];
        } else if (combined.includes("vendor") || combined.includes("lib/") || combined.includes("base-library")) {
          priority = categoryOrder["frontend-vendor"];
        } else if (combined.includes("layout") || combined.includes("_layout") || combined.includes("index.html")) {
          priority = categoryOrder["frontend-layout"];
        } else if (combined.includes(".js") || combined.includes(".css") || combined.includes(".ts") || combined.includes("site.")) {
          priority = categoryOrder["frontend-code"];
        } else if (combined.includes("test") || combined.includes("spec")) {
          priority = categoryOrder["test"];
        }

        // Also factor in library dependency ordering
        for (const [lib, libPriority] of priorityMap) {
          if (combined.includes(lib)) {
            priority = Math.min(priority, categoryOrder["frontend-vendor"] + libPriority);
            break;
          }
        }

        (task as any).executionPriority = priority;
      }

      // Sort tasks by priority
      tasks.sort((a: any, b: any) => (a.executionPriority ?? 70) - (b.executionPriority ?? 70));
      updated.upgradeTasks = tasks;

      console.log(`[taskPlanningNode] Reordered ${tasks.length} tasks by dependency DAG: ${tasks.map((t: any) => `[P${t.executionPriority ?? "?"}] ${t.title}`).join(", ")}`);
    }
  } catch (err) {
    console.warn("[taskPlanningNode] Task dependency DAG ordering failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Post-processing: Fix hallucinated version numbers in task titles and descriptions.
  // The LLM constantly invents fake version strings like "net0.7.6.1.8" or "net1.34.1.4".
  // Strategy: for each task, replace ALL "from X to Y" patterns with the correct versions
  // from userSelections, matched by package keyword presence in the task text.
  try {
    const selections = (updated.userSelections ?? []) as VersionSelection[];
    const tasks = updated.upgradeTasks as any[];
    if (tasks && selections.length > 0) {
      // Build a lookup: keywords → { from, to } for matching
      const selKeywords: Array<{ keywords: string[]; from: string; to: string; isDotNet: boolean }> = [];
      for (const sel of selections) {
        const pkg = (sel.package || "").toLowerCase();
        const from = sel.currentVersion || "unknown";
        const to = sel.selectedVersion || "unknown";
        const isDotNet = pkg.includes(".net") || pkg.includes("dotnet") || pkg === "targetframework" || pkg === "net";
        const keywords = [pkg];
        // Add extra keywords for common matches
        if (isDotNet) keywords.push(".net", "dotnet", "target framework", "targetframework", "csproj", ".csproj");
        if (pkg.includes("entity")) keywords.push("ef core", "entityframework", "entity framework");
        if (pkg.includes("bootstrap") && !pkg.includes("datepicker")) keywords.push("bootstrap");
        if (pkg.includes("jquery") && !pkg.includes("ui") && !pkg.includes("valid")) keywords.push("jquery");
        selKeywords.push({ keywords, from, to, isDotNet });
      }

      for (const task of tasks) {
        const titleLower = ((task.title || "") as string).toLowerCase();
        const descLower = ((task.description || "") as string).toLowerCase();
        const stepsStr = JSON.stringify(task.steps || []).toLowerCase();
        const allText = titleLower + " " + descLower + " " + stepsStr;

        for (const sel of selKeywords) {
          // Check if this task is about this package
          const matches = sel.keywords.some(k => allText.includes(k));
          if (!matches) continue;

          // Fix title: replace any "from X to Y" pattern with correct versions
          task.title = (task.title as string).replace(
            /from\s+(?:v|net|version\s*)?[\d.]+(?:\s+to\s+(?:v|net|version\s*)?[\d.]+)?/gi,
            sel.isDotNet ? `from net${sel.from} to net${sel.to}` : `from ${sel.from} to ${sel.to}`
          );

          // Fix title: replace standalone wrong "netX.Y.Z" patterns
          if (sel.isDotNet) {
            task.title = (task.title as string).replace(/net[\d.]{3,}/gi, (match) => {
              const ver = match.replace(/^net/i, "");
              if (ver === sel.from || ver === sel.to) return match; // already correct
              // Appears AFTER "to " → use target; else use current or target
              return `net${sel.to}`;
            });

            // Also fix steps: replace wrong net versions
            if (Array.isArray(task.steps)) {
              task.steps = task.steps.map((step: string) =>
                step.replace(/net[\d.]{3,}/gi, (match: string) => {
                  const ver = match.replace(/^net/i, "");
                  if (ver === sel.from || ver === sel.to) return match;
                  // If it appears in "from X" context → use from, else target
                  return `net${sel.to}`;
                })
              );
            }
          }

          // Fix description: same treatment
          if (task.description) {
            task.description = (task.description as string).replace(
              /from\s+(?:v|net|version\s*)?[\d.]+\s+to\s+(?:v|net|version\s*)?[\d.]+/gi,
              sel.isDotNet ? `from net${sel.from} to net${sel.to}` : `from ${sel.from} to ${sel.to}`
            );
          }

          // Fix version references in verificationCriteria
          if (sel.isDotNet && Array.isArray(task.verificationCriteria)) {
            task.verificationCriteria = task.verificationCriteria.map((c: string) =>
              c.replace(/net[\d.]{3,}/gi, (match: string) => {
                const ver = match.replace(/^net/i, "");
                if (ver === sel.from || ver === sel.to) return match;
                return `net${sel.to}`;
              })
            );
          }
        }
      }
      console.log("[taskPlanningNode] Post-processed task titles/descriptions to fix version hallucinations");
    }
  } catch (err) {
    console.warn("[taskPlanningNode] Task title fix failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  recordPhaseEnd(analysisId, "tasks");
  stateStore.save(updated);
  persistTokenSnapshot(analysisId);
  stateStore.saveToDb(analysisId).catch(() => {});
  stateStore.savePhaseToDb(analysisId, "task_generation", "completed", {
    upgradeTasks: updated.upgradeTasks,
  }, updated.tasksMarkdown).catch(() => {});
  return {};
}

/** Code upgrade: apply versions and generate code. Persist partial modifiedFiles and currentStage after each batch for real-time progress API. */
export async function codeUpgradeNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "execution")) {
    const s = getState(analysisId);
    s.currentStage = "Code upgrade skipped";
    s.progress = phaseProgress(analysisId, "execution");
    stateStore.save(s);
    return {};
  }

  const stackState = getState(analysisId);
  const isCompletenessRetry = (stackState.completenessRetryCount ?? 0) > 0;
  const failedChecks = stackState.completenessFailedChecks || [];

  // On completeness retry, run a targeted fix pass instead of full upgrade
  if (isCompletenessRetry && failedChecks.length > 0) {
    console.log(`[codeUpgradeNode] Completeness retry #${stackState.completenessRetryCount} — fixing ${failedChecks.length} failed checks`);
    stackState.currentStage = `Fixing ${failedChecks.length} completeness gaps (retry ${stackState.completenessRetryCount})...`;
    stateStore.save(stackState);

    try {
      const { getLLMClient } = await import("../services/llm-selector");
      const { trackedLLMCall } = await import("../services/llm-call-tracker");
      const { client, model } = getLLMClient(stackState.llmProvider);

      // Build a prompt describing the failed checks for the LLM to fix
      const failedChecksDesc = failedChecks.map((c: any, i: number) =>
        `${i + 1}. [${c.category}] ${c.description}${c.details ? ` — ${c.details}` : ""}`
      ).join("\n");

      const selectionsDesc = (stackState.userSelections ?? []).map((s: any) =>
        `- ${s.package}: ${s.currentVersion} → ${s.selectedVersion}`
      ).join("\n");

      // Process each failed check by finding relevant files and fixing them
      const modifiedMap = new Map<string, any>();
      for (const mf of (stackState.modifiedFiles ?? [])) {
        const path = (mf as any).path || (mf as any).filePath || '';
        if (path) modifiedMap.set(path, mf);
      }

      // Find files that need fixes based on failed check categories
      const filesToFix: Array<{ path: string; content: string; originalContent: string }> = [];
      for (const check of failedChecks) {
        // Try to find the file mentioned in check details
        const detailsLower = (check.details || "").toLowerCase();
        for (const [path, mf] of modifiedMap) {
          const pathLower = path.toLowerCase();
          if (
            (check.category === "tfm" && (pathLower.endsWith(".csproj") || pathLower.endsWith(".fsproj"))) ||
            (check.category === "nuget" && pathLower.endsWith(".csproj")) ||
            (check.category === "cdn" && (pathLower.endsWith(".cshtml") || pathLower.endsWith(".html") || pathLower.endsWith(".razor"))) ||
            (check.category === "vendor" && detailsLower.includes(pathLower.split("/").pop() || "")) ||
            detailsLower.includes(path.split("/").pop() || "")
          ) {
            if (!filesToFix.find(f => f.path === path)) {
              filesToFix.push({ path, content: (mf as any).content, originalContent: (mf as any).originalContent });
            }
          }
        }
      }

      // Also check extracted files for unmodified files that need changes
      for (const check of failedChecks) {
        for (const ef of (stackState.extractedFiles ?? [])) {
          const pathLower = ef.relativePath.toLowerCase();
          if (
            (check.category === "tfm" && (pathLower.endsWith(".csproj") || pathLower.endsWith(".fsproj"))) ||
            (check.category === "nuget" && pathLower.endsWith(".csproj")) ||
            (check.category === "cdn" && (pathLower.endsWith(".cshtml") || pathLower.endsWith(".html")))
          ) {
            if (!modifiedMap.has(ef.relativePath) && !filesToFix.find(f => f.path === ef.relativePath)) {
              filesToFix.push({ path: ef.relativePath, content: ef.content || "", originalContent: ef.content || "" });
            }
          }
        }
      }

      if (filesToFix.length > 0) {
        console.log(`[codeUpgradeNode] Completeness retry: fixing ${filesToFix.length} files for ${failedChecks.length} failed checks`);

        for (const file of filesToFix) {
          try {
            const response = await trackedLLMCall(client, {
              model,
              temperature: 0,
              max_tokens: 8000,
              messages: [
                {
                  role: "system",
                  content: `You are a code upgrade specialist. Fix the specific completeness issues listed below. Output ONLY the corrected file content — no explanations, no markdown fences.`
                },
                {
                  role: "user",
                  content: `Fix the following completeness issues in this file:

## Target Versions
${selectionsDesc}

## Failed Completeness Checks
${failedChecksDesc}

## File: ${file.path}
\`\`\`
${file.content}
\`\`\`

Return ONLY the corrected file content.`
                }
              ]
            }, { analysisId, phase: "execution", agent: "CodeUpgrade/CompletenessRetry" });

            const fixedContent = (response.choices[0]?.message?.content || "")
              .replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();

            if (fixedContent && fixedContent.length > 50 && fixedContent !== file.content) {
              // Update in modifiedFiles
              const existing = modifiedMap.get(file.path);
              if (existing) {
                (existing as any).content = fixedContent;
              } else {
                stackState.modifiedFiles = [
                  ...(stackState.modifiedFiles ?? []),
                  { path: file.path, content: fixedContent, originalContent: file.originalContent } as any,
                ];
              }
              console.log(`[codeUpgradeNode] Fixed: ${file.path}`);
            }
          } catch (err) {
            console.warn(`[codeUpgradeNode] Failed to fix ${file.path}:`, err instanceof Error ? err.message : err);
          }
        }

        stateStore.save(stackState);
        stateStore.saveToDb(analysisId).catch(() => {});
      } else {
        console.warn(`[codeUpgradeNode] Completeness retry: no files identified for fixing. Proceeding.`);
      }
    } catch (err) {
      console.error(`[codeUpgradeNode] Completeness retry error:`, err);
    }

    // Clear the failed checks to avoid infinite loop
    stackState.completenessFailedChecks = [];
    stateStore.save(stackState);
    return {};
  }

  recordPhaseStart(analysisId, "execution");
  const selections = stackState.userSelections ?? [];

  if (selections.length === 0) {
    console.error(`[codeUpgradeNode] ❌ CRITICAL: No userSelections found in state for ${analysisId}! Code upgrade will have no version targets.`);
  } else {
    console.log(`[codeUpgradeNode] User selections (${selections.length}): ${selections.map(s => `${s.package}: ${s.currentVersion} → ${s.selectedVersion}`).join(", ")}`);
  }

  const onProgress = (
    files: Array<{ path: string; content: string; originalContent: string; changes?: any[] }>,
    context?: CodeGenerationProgressContext
  ) => {
    const s = getState(analysisId);
    s.modifiedFiles = files.map((f) => ({
      path: f.path,
      content: f.content,
      originalContent: f.originalContent,
      isNew: (f as any).isNew ?? false,
    }));
    if (context) {
      if (context.phase === "triage") {
        s.currentStage = "Classifying files to upgrade...";
      } else if (context.phase === "group") {
        s.currentStage = "Grouping files for upgrade...";
      } else if (context.phase === "upgrade" && context.batchIndex != null && context.totalBatches != null) {
        s.currentStage = `Upgrading files: batch ${context.batchIndex + 1} of ${context.totalBatches}`;
        if (context.filesDone != null) {
          s.currentStage += ` (${context.filesDone} file(s) done)`;
        }
      }
    }
    stateStore.save(s);
    // Persist partial state to DB so resume after pause restores modifiedFiles and taskExecutionResults
    stateStore.saveToDb(analysisId).catch(() => {});
    stateStore.savePhaseToDb(analysisId, "code_upgrade", "in_progress", {
      taskExecutionResults: s.taskExecutionResults ?? [],
      modifiedFiles: s.modifiedFiles ?? [],
    }).catch(() => {});
  };
  let updated: typeof stackState;
  try {
    updated = await executeCodeUpgradeAgent(stackState, selections, { onProgress });
  } catch (agentErr) {
    console.error(`[codeUpgradeNode] executeCodeUpgradeAgent CRASHED:`, agentErr instanceof Error ? (agentErr as Error).stack : agentErr);
    // Recover partial results from stateStore (onProgress may have saved partial modifiedFiles)
    updated = getState(analysisId);
    updated.errors = [...(updated.errors ?? []), `Code upgrade agent error: ${agentErr instanceof Error ? agentErr.message : String(agentErr)}`];
    stateStore.save(updated);
    console.warn(`[codeUpgradeNode] Recovered ${updated.modifiedFiles?.length ?? 0} partial modifiedFiles from stateStore after crash`);
  }

  // Post-processing: apply deterministic client-side library migrations
  // (Bootstrap attribute/class renames, Font Awesome 5→6, jQuery 3→4, etc.) on top of LLM output
  try {
    const { applyClientSideMigrations } = await import("../services/client-side-migration");
    const modifiedFiles = updated.modifiedFiles ?? [];
    const extractedFiles = updated.extractedFiles ?? [];
    if (modifiedFiles.length > 0 && selections.length > 0) {
      updated.currentStage = "Applying client-side library migrations...";
      stateStore.save(updated);

      const { updatedModified, newlyModified } = applyClientSideMigrations(
        modifiedFiles,
        extractedFiles,
        selections
      );
      updated.modifiedFiles = [
        ...updatedModified,
        ...newlyModified.map(f => ({
          path: f.path,
          content: f.content,
          originalContent: f.originalContent,
        })),
      ];
    }
  } catch (err) {
    console.warn("[CodeUpgradeNode] Client-side migration post-processing failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Post-processing: apply DYNAMIC CSS migration rules from downloaded package diffs
  // These rules are generated by comparing old vs new CSS files (e.g., Bootstrap 4.6.2 vs 5.3.2)
  try {
    const cssRules = stackState.cssMigrationRules ?? [];
    if (cssRules.length > 0) {
      const { applyCssRules } = await import("../services/css-class-differ");
      const viewExts = /\.(cshtml|html|razor|htm|aspx|jsp|ejs|hbs|pug|erb|php|blade\.php|vue|tsx|jsx)$/i;
      let totalChanges = 0;

      // Apply to ALL modified files
      for (const file of (updated.modifiedFiles ?? [])) {
        if (!viewExts.test(file.path)) continue;
        const { content: newContent, changeCount } = applyCssRules(file.content, cssRules);
        if (changeCount > 0) {
          file.content = newContent;
          totalChanges += changeCount;
        }
      }

      // Apply to ALL extracted files that weren't modified by the LLM
      const modifiedPaths = new Set(
        (updated.modifiedFiles ?? []).map(m => (m.path || "").replace(/\\/g, "/").toLowerCase())
      );
      for (const f of (updated.extractedFiles ?? stackState.extractedFiles ?? [])) {
        const rel = (f.relativePath || "").replace(/\\/g, "/");
        if (!viewExts.test(rel)) continue;
        if (modifiedPaths.has(rel.toLowerCase())) continue;
        if (!f.content || f.content.length < 10) continue;

        const { content: newContent, changeCount } = applyCssRules(f.content, cssRules);
        if (changeCount > 0) {
          (updated.modifiedFiles ??= []).push({
            path: rel,
            content: newContent,
            originalContent: f.content,
            changes: [],
          });
          totalChanges += changeCount;
        }
      }

      if (totalChanges > 0) {
        console.log(`[codeUpgradeNode] Applied ${totalChanges} dynamic CSS rule changes across view files`);
      }
    }
  } catch (err) {
    console.warn("[codeUpgradeNode] Dynamic CSS rules failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Post-processing: apply deterministic transforms to ALL view/style files from extractedFiles
  // even if the LLM didn't touch them. This catches data-toggle→data-bs-toggle, fa fa-*→fas fa-*,
  // pr-2→pe-2, etc. in files the LLM marked as NO_CHANGE during triage.
  try {
    const { applyClientSideMigrations } = await import("../services/client-side-migration");
    const viewExts = new Set([".cshtml", ".html", ".razor", ".htm", ".aspx", ".css", ".js"]);
    const alreadyModifiedPaths = new Set(
      (updated.modifiedFiles ?? []).map(m => (m.path || "").replace(/\\/g, "/").toLowerCase())
    );

    let extraTransformCount = 0;
    for (const f of (updated.extractedFiles ?? [])) {
      const rel = (f.relativePath || "").replace(/\\/g, "/");
      const ext = rel.substring(rel.lastIndexOf(".")).toLowerCase();
      if (!viewExts.has(ext)) continue;
      if (alreadyModifiedPaths.has(rel.toLowerCase())) continue;
      if (!f.content || f.content.length < 10) continue;

      // Apply deterministic transforms to this unmodified file
      const { updatedModified } = applyClientSideMigrations(
        [{ path: rel, content: f.content, originalContent: f.content }],
        [],
        selections
      );

      if (updatedModified.length > 0 && updatedModified[0].content !== f.content) {
        (updated.modifiedFiles ??= []).push({
          path: rel,
          content: updatedModified[0].content,
          originalContent: f.content,
          changes: [],
        });
        extraTransformCount++;
      }
    }

    if (extraTransformCount > 0) {
      console.log(`[codeUpgradeNode] Applied deterministic transforms to ${extraTransformCount} additional view/style files`);
    }
  } catch (err) {
    console.warn("[codeUpgradeNode] Extra view file transforms failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Post-processing: deduplicate HTML <script>/<link> references (remove duplicates and phantom libs)
  try {
    const { deduplicateHtmlReferences } = await import("../services/deterministic-transforms");
    const modFiles = updated.modifiedFiles ?? [];
    const extFiles = updated.extractedFiles ?? [];
    if (modFiles.length > 0) {
      updated.modifiedFiles = deduplicateHtmlReferences(modFiles, extFiles, selections);
      const removedCount = modFiles.length - (updated.modifiedFiles?.length ?? 0);
      if (removedCount !== 0) {
        console.log(`[codeUpgradeNode] HTML deduplication pass completed`);
      }
    }
  } catch (err) {
    console.warn("[codeUpgradeNode] HTML deduplication failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Post-processing: reconcile view/template asset references with actual vendor download paths.
  // Works for ANY tech stack: .NET (~/lib/), Node (node_modules/), Java (static/), Python (static/), etc.
  // The vendor download node writes files to specific destinations — if the LLM or a previous step
  // introduced paths that don't match, fix them deterministically.
  // Unresolvable mismatches are tracked for the migration report.
  const unresolvedAssetRefs: Array<{ file: string; ref: string; fileName: string }> = [];
  try {
    const dlResults = updated.vendorDownloadResults;
    if (dlResults && dlResults.downloaded && dlResults.downloaded.length > 0) {
      // Build a map: filename -> list of download web paths (strip leading wwwroot/ or public/ for web-relative paths)
      const webRootPrefixes = /^(wwwroot|public|static|dist|resources\/static|web|htdocs)\/?/i;
      const fileNameToDownloads = new Map<string, Array<{ webPath: string; library: string; fullDest: string }>>();

      for (const d of dlResults.downloaded as any[]) {
        const dest = (d.destination || "").replace(/\\/g, "/");
        const webPath = dest.replace(webRootPrefixes, "");
        const fileName = webPath.split("/").pop() || "";
        if (!fileName || !webPath) continue;
        const key = fileName.toLowerCase();
        if (!fileNameToDownloads.has(key)) fileNameToDownloads.set(key, []);
        fileNameToDownloads.get(key)!.push({ webPath, library: d.library || "", fullDest: dest });
      }

      // Detect the project's web root prefix from extracted files to properly prepend ~/
      const hasWwwroot = (updated.extractedFiles ?? []).some(f => /^wwwroot\//i.test(f.relativePath.replace(/\\/g, "/")));
      const webPrefix = hasWwwroot ? "~/" : "";

      const viewExts = /\.(cshtml|html|razor|htm|aspx|master|jsp|ejs|hbs|pug|erb|php|blade\.php|vue|tsx|jsx|svelte|astro|twig|njk)$/i;
      const modPathSet = new Set((updated.modifiedFiles ?? []).map(mf => mf.path.replace(/\\/g, "/").toLowerCase()));
      const allViewFiles = [
        ...(updated.modifiedFiles ?? []),
        ...(updated.extractedFiles ?? []).filter(ef =>
          viewExts.test(ef.relativePath) && !modPathSet.has(ef.relativePath.replace(/\\/g, "/").toLowerCase())
        ).map(ef => ({ path: ef.relativePath, content: ef.content, originalContent: ef.content })),
      ];

      // Known vendor directory patterns across tech stacks
      const vendorDirPattern = /(?:lib|vendor|assets|static|dist|bower_components|node_modules|packages)\//i;

      let totalPathFixes = 0;
      for (const vf of allViewFiles) {
        if (!viewExts.test(vf.path)) continue;
        let content = vf.content;
        let changed = false;

        // Match any src="..." or href="..." that references a JS/CSS file
        const assetRefPattern = /((?:src|href)\s*=\s*["'])([^"']+\.(js|css|min\.js|min\.css))(?=["'])/gi;

        content = content.replace(assetRefPattern, (match, prefix, refPath) => {
          const normalRef = refPath.replace(/\\/g, "/");
          const refFileName = normalRef.split("/").pop() || "";
          const key = refFileName.toLowerCase();

          const downloads = fileNameToDownloads.get(key);
          if (!downloads || downloads.length === 0) return match;

          // Check if current reference already matches a downloaded path
          const strippedRef = normalRef.replace(/^~?\/?/, "").replace(webRootPrefixes, "");
          const alreadyCorrect = downloads.some(dl => dl.webPath.toLowerCase() === strippedRef.toLowerCase());
          if (alreadyCorrect) return match;

          // Only fix references that go through a known vendor directory
          if (!vendorDirPattern.test(normalRef)) return match;

          // Find the best matching download (prefer same library directory name)
          const refDirParts = normalRef.toLowerCase().split("/");
          let bestMatch = downloads[0];
          for (const dl of downloads) {
            const dlParts = dl.webPath.toLowerCase().split("/");
            // Prefer download whose parent directory matches the reference's parent directory
            if (dlParts.some(p => refDirParts.includes(p) && p !== key)) {
              bestMatch = dl;
              break;
            }
          }

          changed = true;
          totalPathFixes++;
          return `${prefix}${webPrefix}${bestMatch.webPath}`;
        });

        if (changed) {
          const existingIdx = (updated.modifiedFiles ?? []).findIndex(
            mf => mf.path.replace(/\\/g, "/").toLowerCase() === vf.path.replace(/\\/g, "/").toLowerCase()
          );
          if (existingIdx >= 0) {
            updated.modifiedFiles![existingIdx].content = content;
          } else {
            const origFile = (updated.extractedFiles ?? []).find(
              ef => ef.relativePath.replace(/\\/g, "/").toLowerCase() === vf.path.replace(/\\/g, "/").toLowerCase()
            );
            (updated.modifiedFiles ??= []).push({
              path: vf.path,
              content,
              originalContent: origFile?.content ?? vf.content,
            });
          }
        }

        // Detect unresolvable references: asset refs pointing to vendor dirs but no matching download
        const unresolvedPattern = /(?:src|href)\s*=\s*["']([^"']+\.(?:js|css|min\.js|min\.css))["']/gi;
        let um: RegExpExecArray | null;
        const finalContent = changed ? content : vf.content;
        while ((um = unresolvedPattern.exec(finalContent)) !== null) {
          const ref = um[1].replace(/\\/g, "/");
          if (!vendorDirPattern.test(ref)) continue;
          const fn = ref.split("/").pop() || "";
          const strippedRef = ref.replace(/^~?\/?/, "").replace(webRootPrefixes, "");
          const downloads = fileNameToDownloads.get(fn.toLowerCase());
          const isResolved = downloads?.some(dl => dl.webPath.toLowerCase() === strippedRef.toLowerCase());
          if (!isResolved && fn) {
            unresolvedAssetRefs.push({ file: vf.path, ref, fileName: fn });
          }
        }
      }

      if (totalPathFixes > 0) {
        console.log(`[codeUpgradeNode] Asset path reconciliation: fixed ${totalPathFixes} reference(s) to match vendor download destinations`);
      }
      if (unresolvedAssetRefs.length > 0) {
        console.warn(`[codeUpgradeNode] ${unresolvedAssetRefs.length} asset reference(s) could not be auto-resolved — will appear in migration report`);
      }
    }
  } catch (err) {
    console.warn("[codeUpgradeNode] Asset path reconciliation failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Store unresolved asset references on state so the migration report can list them
  if (unresolvedAssetRefs.length > 0) {
    updated.unresolvedAssetRefs = unresolvedAssetRefs;
    stateStore.save(updated);
  }

  // Generate/update client-side library manifest (libman.json or package.json)
  try {
    const { generateOrUpdateManifest } = await import("../services/vendor-library-updater");
    const vendorLibs = updated.vendorLibraries ?? [];
    const bundleDets = (updated.bundleDetections ?? []) as any[];
    const detectedStack = (updated.repoProfile as any)?.primaryStack ?? "";

    if (vendorLibs.length > 0 || bundleDets.length > 0) {
      const manifestResult = generateOrUpdateManifest(
        vendorLibs,
        selections,
        updated.extractedFiles ?? [],
        bundleDets,
        detectedStack,
      );
      if (manifestResult) {
        const existingIdx = (updated.modifiedFiles ?? []).findIndex(
          f => f.path.replace(/\\/g, "/").toLowerCase() === manifestResult.path.toLowerCase()
        );
        const origFile = (updated.extractedFiles ?? []).find(
          f => f.relativePath.replace(/\\/g, "/").toLowerCase() === manifestResult.path.toLowerCase()
        );
        if (existingIdx >= 0) {
          updated.modifiedFiles![existingIdx].content = manifestResult.content;
        } else {
          (updated.modifiedFiles ??= []).push({
            path: manifestResult.path,
            content: manifestResult.content,
            originalContent: origFile?.content ?? "",
            isNew: !origFile,
          });
        }
        console.log(`[codeUpgradeNode] Generated/updated manifest: ${manifestResult.path}`);
      }
    }
  } catch (err) {
    console.warn("[codeUpgradeNode] Manifest generation failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // NOTE: Vendor library download/bundle rebuild/layout resolver are now handled by
  // the dedicated vendorDownloadNode which runs BEFORE task_planning.
  // This ensures packages are installed before code tasks are generated,
  // like a real developer workflow.

  // For Node.js projects: run npm install to update node_modules on disk
  // This ensures the ZIP download includes updated dependencies
  try {
    const detectedStack = ((updated.repoProfile as any)?.primaryStack ?? "").toLowerCase();
    const isNodeProject = detectedStack.includes("node") || detectedStack.includes("react") ||
      detectedStack.includes("angular") || detectedStack.includes("vue") || detectedStack.includes("next");

    if (isNodeProject && updated.tempDir && stackModConfig.RUN_PACKAGE_MANAGER_INSTALL !== false) {
      const { getExtractedDir } = await import("../services/temp-storage");
      const extractDir = getExtractedDir(updated.tempDir);
      const fsCheck = await import("fs/promises");
      const pathCheck = await import("path");

      // Only run if package.json exists on disk
      try {
        await fsCheck.access(pathCheck.join(extractDir, "package.json"));
        const { execSync } = await import("child_process");
        console.log("[codeUpgradeNode] Running npm install for Node.js project...");
        updated.currentStage = "Installing npm dependencies...";
        stateStore.save(updated);
        execSync("npm install --ignore-scripts --no-audit --no-fund --prefer-offline 2>&1 || true", {
          cwd: extractDir,
          timeout: 600_000,
          stdio: "pipe",
        });
        console.log("[codeUpgradeNode] npm install completed");
      } catch (npmErr) {
        console.warn("[codeUpgradeNode] npm install skipped or failed (non-fatal):", npmErr instanceof Error ? npmErr.message : npmErr);
      }
    }
  } catch (err) {
    console.warn("[codeUpgradeNode] Node.js package install check failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Merge scaffold new files into modifiedFiles so they appear in the diff viewer
  try {
    if (updated.scaffoldResult?.newFiles?.length) {
      const existingPaths = new Set((updated.modifiedFiles ?? []).map(f => f.path.replace(/\\/g, "/")));
      let mergedCount = 0;
      for (const sf of updated.scaffoldResult.newFiles) {
        const normalPath = sf.path.replace(/\\/g, "/");
        if (!existingPaths.has(normalPath)) {
          (updated.modifiedFiles ??= []).push({
            path: sf.path,
            content: sf.content,
            originalContent: "",
            isNew: true,
          });
          mergedCount++;
        }
      }
      if (mergedCount > 0) {
        console.log(`[codeUpgradeNode] Merged ${mergedCount} scaffold new files into modifiedFiles for diff viewer`);
      }
    }
  } catch (err) {
    console.warn("[codeUpgradeNode] Scaffold file merge failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  stateStore.save(updated);
  persistTokenSnapshot(analysisId);
  stateStore.saveToDb(analysisId).catch(() => {});
  stateStore.savePhaseToDb(analysisId, "code_upgrade", "completed", {
    taskExecutionResults: updated.taskExecutionResults,
    modifiedFiles: updated.modifiedFiles ?? [],
    codeUpgradeSummary: updated.codeUpgrade?.summary,
    codeUpgradeErrors: updated.codeUpgrade?.errors,
    impactReport: updated.impactReport,
    changeSummaries: updated.changeSummaries,
    migrationAllowedRenames: updated.migrationAllowedRenames,
    // GAP fields for resume
    apiUsageImpactReport: updated.apiUsageImpactReport,
    removedObsoletePackages: updated.removedObsoletePackages,
    bundleDetections: updated.bundleDetections,
    discoveredBundledLibraries: updated.discoveredBundledLibraries,
    newLibrariesAdded: updated.newLibrariesAdded,
    scaffoldResult: updated.scaffoldResult,
  }).catch(() => {});

  // Push modified files + reports to Git (fire-and-forget)
  resolveAdoConfigForGit(analysisId).then(cfg => {
    if (!cfg) return;
    stateStore.saveModifiedFilesToGit(analysisId, cfg).catch(() => {});
    stateStore.saveReportsToGit(analysisId, cfg).catch(() => {});
  }).catch(() => {});

  return {};
}

/** Post-upgrade consistency validation: catch split-state issues before test gen. */
export async function consistencyValidationNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "execution")) {
    console.log(`[consistencyValidationNode] Skipped: "execution" phase not selected`);
    return {};
  }

  const stackState = getState(analysisId);
  console.log(`[consistencyValidationNode] Starting: modifiedFiles=${stackState.modifiedFiles?.length ?? 0}`);
  if (!stackState.modifiedFiles?.length) {
    console.warn(`[consistencyValidationNode] Skipped: modifiedFiles is EMPTY`);
    return {};
  }

  stackState.currentStage = "Running post-upgrade consistency validation...";
  stateStore.save(stackState);

  try {
    const updated = await executeConsistencyValidator(stackState);
    stateStore.save(updated);

    const report = updated.consistencyReport;
    if (report) {
      const msg = `Consistency: ${report.passed} clean, ${report.autoFixed} auto-fixed, ${report.llmFixPassFiles} need review`;
      updated.currentStage = msg;
      stateStore.save(updated);
      // Preserve full code_upgrade metadata so resume still has taskExecutionResults and modifiedFiles
      stateStore.savePhaseToDb(analysisId, "code_upgrade", "completed", {
        taskExecutionResults: updated.taskExecutionResults,
        modifiedFiles: updated.modifiedFiles ?? [],
        codeUpgradeSummary: updated.codeUpgrade?.summary,
        codeUpgradeErrors: updated.codeUpgrade?.errors,
        impactReport: updated.impactReport,
        changeSummaries: updated.changeSummaries,
        migrationAllowedRenames: updated.migrationAllowedRenames,
        consistencyReport: report,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[consistencyValidationNode] FAILED:", err instanceof Error ? err.stack : err);
  }

  return {};
}

/** Code review & fix: validate upgraded code before test generation. Two layers:
 *  L1 = deterministic (removed API usage, version mismatches, mixed imports)
 *  L2 = LLM-assisted (semantic review of high-risk files)
 */
export async function codeReviewFixNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "execution")) {
    console.log(`[codeReviewFixNode] Skipped: "execution" phase not selected`);
    return {};
  }

  const stackState = getState(analysisId);
  console.log(`[codeReviewFixNode] Starting: modifiedFiles=${stackState.modifiedFiles?.length ?? 0}`);
  if (!stackState.modifiedFiles?.length) {
    console.warn(`[codeReviewFixNode] Skipped: modifiedFiles is EMPTY`);
    return {};
  }

  stackState.currentStage = "Reviewing upgraded code for issues...";
  stateStore.save(stackState);

  try {
    const updated = await executeCodeReviewFixAgent(stackState);
    stateStore.save(updated);

    const report = updated.codeReviewReport;
    if (report) {
      updated.currentStage = `Code review: ${report.issuesFound} issues found, ${report.issuesFixed} auto-fixed, ${report.issuesRemaining} remaining`;
      stateStore.save(updated);
    }

    // ── Post-review version enforcement ──
    // The LLM code-review-fix may have re-introduced wrong versions.
    // Re-enforce all selected versions as a final safety net.
    const selections = getState(analysisId)?.userSelections ?? [];
    if (selections.length > 0 && updated.modifiedFiles?.length) {
      let postReviewFixes = 0;
      for (const mf of updated.modifiedFiles) {
        const before = mf.content;
        const lowerPath = mf.path.toLowerCase();
        const baseName = (mf.path.split(/[\\/]/).pop() || "").toLowerCase();

        for (const sel of selections) {
          const pkg = (sel.package || "").toLowerCase();
          const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
          if (!targetVer) continue;

          // .NET TFM
          if ((pkg.includes(".net") || pkg.includes("dotnet") || pkg === "dotnet") &&
              (lowerPath.endsWith(".csproj") || lowerPath.endsWith(".fsproj") || lowerPath.endsWith(".vbproj"))) {
            const major = parseInt(targetVer.split(".")[0], 10);
            if (major >= 5 && !isNaN(major)) {
              mf.content = mf.content.replace(/<TargetFramework>\s*net[^<]*<\/TargetFramework>/gi,
                `<TargetFramework>net${major}.0</TargetFramework>`);
            }
          }

          // NuGet PackageReference
          if ((lowerPath.endsWith(".csproj") || lowerPath.endsWith(".fsproj") || lowerPath.endsWith(".vbproj")) &&
              sel.category !== "framework") {
            const ePkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            mf.content = mf.content.replace(
              new RegExp(`(<PackageReference\\s+Include="${ePkg}"\\s+Version=")[^"]+(")`, "gi"),
              `$1${targetVer}$2`
            );
          }

          // package.json deps
          if (lowerPath.endsWith("package.json") && pkg !== "node" && pkg !== "nodejs") {
            try {
              const parsed = JSON.parse(mf.content);
              let changed = false;
              const normPkg = pkg.replace(/[-_.@\s/]/g, "");
              for (const section of ["dependencies", "devDependencies"]) {
                if (!parsed[section]) continue;
                for (const depName of Object.keys(parsed[section])) {
                  const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
                  if (normDep === normPkg || normDep.includes(normPkg) || normPkg.includes(normDep)) {
                    const cv = String(parsed[section][depName]).replace(/^[\^~>=<\s]+/, "");
                    if (cv !== targetVer) {
                      const prefix = String(parsed[section][depName]).match(/^([\^~])/)?.[1] || "^";
                      parsed[section][depName] = `${prefix}${targetVer}`;
                      changed = true;
                    }
                  }
                }
              }
              if (changed) mf.content = JSON.stringify(parsed, null, 2);
            } catch { /* non-fatal */ }
          }

          // libman.json
          if (baseName === "libman.json") {
            try {
              const parsed = JSON.parse(mf.content);
              if (Array.isArray(parsed.libraries)) {
                let changed = false;
                for (const lib of parsed.libraries) {
                  if (!lib.library || typeof lib.library !== "string") continue;
                  const atIdx = lib.library.lastIndexOf("@");
                  if (atIdx <= 0) continue;
                  const libName = lib.library.slice(0, atIdx);
                  const normLib = libName.toLowerCase().replace(/[-_.@\s/]/g, "");
                  const normPkg = pkg.replace(/[-_.@\s/]/g, "");
                  if (normLib === normPkg || normLib.includes(normPkg) || normPkg.includes(normLib)) {
                    lib.library = `${libName}@${targetVer}`;
                    changed = true;
                  }
                }
                if (changed) mf.content = JSON.stringify(parsed, null, 2);
              }
            } catch { /* non-fatal */ }
          }
        }

        if (mf.content !== before) postReviewFixes++;
      }
      if (postReviewFixes > 0) {
        console.warn(`[codeReviewFixNode] Post-review version enforcement: corrected ${postReviewFixes} file(s)`);
        stateStore.save(updated);
      }
    }
  } catch (err) {
    console.warn("[codeReviewFixNode] Non-fatal:", err instanceof Error ? err.message : err);
  }

  // Push fixed files to Git (fire-and-forget)
  resolveAdoConfigForGit(analysisId).then(cfg => {
    if (!cfg) return;
    stateStore.saveModifiedFilesToGit(analysisId, cfg).catch(() => {});
  }).catch(() => {});

  return {};
}

/** Max number of times completeness can loop back to code_upgrade */
const MAX_COMPLETENESS_RETRIES = 2;
/** Minimum completeness score to proceed without retry */
const COMPLETENESS_THRESHOLD = 80;

/** GAP 10: Completeness verification — verify all upgrade targets were addressed before test gen. */
export async function completenessVerificationNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "execution")) {
    console.log(`[completenessVerificationNode] Skipped: "execution" phase not selected for ${analysisId}`);
    return {};
  }

  const stackState = getState(analysisId);
  const retryCount = stackState.completenessRetryCount ?? 0;
  const modFileCount = stackState.modifiedFiles?.length ?? 0;
  const extFileCount = stackState.extractedFiles?.length ?? 0;
  const selCount = stackState.userSelections?.length ?? 0;
  console.log(`[completenessVerificationNode] Starting (retry=${retryCount}): modifiedFiles=${modFileCount}, extractedFiles=${extFileCount}, userSelections=${selCount}`);

  if (!stackState.modifiedFiles?.length) {
    console.warn(`[completenessVerificationNode] Skipped: modifiedFiles is EMPTY for ${analysisId}. This means either code upgrade produced no changes or state was lost.`);
    stackState.currentStage = "Completeness verification skipped (no modified files)";
    stateStore.save(stackState);
    return {};
  }

  stackState.currentStage = retryCount > 0
    ? `Re-verifying upgrade completeness (attempt ${retryCount + 1})...`
    : "Verifying upgrade completeness...";
  stateStore.save(stackState);

  try {
    const { verifyUpgradeCompleteness } = await import("../services/completeness-verifier");
    const selections = stackState.userSelections ?? [];
    const report = verifyUpgradeCompleteness(
      stackState.modifiedFiles ?? [],
      stackState.extractedFiles ?? [],
      selections,
      stackState.vendorLibraries,
      stackState.apiUsageImpactReport,
      stackState.vendorDownloadResults as any,
    );

    stackState.completenessReport = report;
    stackState.completenessReportMarkdown = report.markdown;
    stackState.currentStage = `Completeness: ${report.overallScore}% (${report.passed}/${report.totalChecks} checks passed, ${report.failed} errors, ${report.warnings} warnings)`;

    // Track whether we need a retry — used by completenessRouterFn
    const needsRetry = report.overallScore < COMPLETENESS_THRESHOLD && report.failed > 0 && retryCount < MAX_COMPLETENESS_RETRIES;
    if (needsRetry) {
      stackState.completenessRetryCount = retryCount + 1;
      // Build a list of failed checks so code_upgrade knows what to fix
      const failedChecks = (report.checks || []).filter((c: any) => !c.passed && c.severity === "error");
      stackState.completenessFailedChecks = failedChecks.map((c: any) => ({
        id: c.id,
        category: c.category,
        description: c.description,
        details: c.details,
      }));
      stackState.currentStage = `Completeness: ${report.overallScore}% — ${report.failed} errors found. Retrying upgrade (attempt ${retryCount + 2}/${MAX_COMPLETENESS_RETRIES + 1})...`;
      console.log(`[completenessVerificationNode] Score ${report.overallScore}% below threshold ${COMPLETENESS_THRESHOLD}% with ${report.failed} errors. Routing back to code_upgrade (retry ${retryCount + 1}/${MAX_COMPLETENESS_RETRIES})`);
    } else if (report.overallScore < COMPLETENESS_THRESHOLD && retryCount >= MAX_COMPLETENESS_RETRIES) {
      console.warn(`[completenessVerificationNode] Score ${report.overallScore}% below threshold but max retries (${MAX_COMPLETENESS_RETRIES}) exhausted. Proceeding to test generation.`);
      stackState.currentStage = `Completeness: ${report.overallScore}% — max retries exhausted, proceeding with current state`;
    }

    // Generate comprehensive migration report when NOT routing to retry
    if (!needsRetry) {
      try {
        const { generateMigrationReport } = await import("../services/migration-report-generator");
        stackState.migrationReportMarkdown = generateMigrationReport(stackState);
        console.log(`[completenessVerificationNode] Migration report generated (${stackState.migrationReportMarkdown.length} chars)`);
      } catch (reportErr) {
        console.warn("[completenessVerificationNode] Migration report generation failed (non-fatal):", reportErr instanceof Error ? reportErr.message : reportErr);
      }

      // Generate vendor update report if vendor libraries were processed
      if (!stackState.vendorUpdateReportMarkdown && (stackState.vendorLibraries ?? []).length > 0) {
        try {
          const vendors = stackState.vendorLibraries ?? [];
          const sels = stackState.userSelections ?? [];
          const lines = ["# Vendor Library Update Report", "", `> Generated: ${new Date().toISOString().slice(0, 19)} UTC`, ""];
          for (const v of vendors) {
            const sel = sels.find(s => s.package.toLowerCase() === v.name.toLowerCase());
            const target = sel?.selectedVersion ?? "N/A";
            lines.push(`## ${v.name}`);
            lines.push(`- **Detected version:** ${v.detectedVersion ?? "unknown"}`);
            lines.push(`- **Target version:** ${target}`);
            lines.push(`- **Detection method:** ${v.detectionMethod}`);
            lines.push(`- **Files:** ${v.existingFiles.slice(0, 5).join(", ")}`);
            lines.push("");
          }
          stackState.vendorUpdateReportMarkdown = lines.join("\n");
        } catch { /* non-fatal */ }
      }

      // Generate API usage impact report if impact data exists
      if (!stackState.apiUsageImpactMarkdown && (stackState.apiUsageImpactReport as any)?.affectedFiles?.length > 0) {
        try {
          const impact = stackState.apiUsageImpactReport as any;
          const lines = ["# API Usage Impact Report", "", `> Generated: ${new Date().toISOString().slice(0, 19)} UTC`, ""];
          lines.push(`**Total affected files:** ${impact.affectedFiles.length}`);
          lines.push("");
          for (const af of impact.affectedFiles) {
            lines.push(`## \`${af.path}\` (risk: ${af.riskScore ?? "N/A"}/100)`);
            lines.push("");
            for (const imp of (af.impacts ?? [])) {
              lines.push(`- **Line ${imp.line}:** \`${imp.pattern}\` — ${imp.description ?? imp.library ?? "breaking pattern detected"}`);
            }
            lines.push("");
          }
          stackState.apiUsageImpactMarkdown = lines.join("\n");
        } catch { /* non-fatal */ }
      }
    }

    stateStore.save(stackState);
    console.log(`[completenessVerificationNode] Score: ${report.overallScore}% — ${report.passed} passed, ${report.failed} errors, ${report.warnings} warnings`);

    // Persist completeness verification to DB
    stateStore.savePhaseToDb(analysisId, "completeness_verification", "completed", {
      completenessReport: report,
    }, report.markdown).catch(() => {});

    // Push updated reports to Git (fire-and-forget)
    resolveAdoConfigForGit(analysisId).then(cfg => {
      if (cfg) stateStore.saveReportsToGit(analysisId, cfg).catch(() => {});
    }).catch(() => {});
  } catch (err) {
    console.error("[completenessVerificationNode] FAILED:", err instanceof Error ? err.stack : err);
    stackState.currentStage = `Completeness verification error: ${err instanceof Error ? err.message : String(err)}`;
    stateStore.save(stackState);
  }

  return {};
}

/**
 * Router function for completeness verification conditional edge.
 * Returns "retry_upgrade" if completeness score is below threshold and retries remain,
 * otherwise returns "proceed" to continue to test generation.
 */
export function completenessRouterFn(state: StackModGraphState): "retry_upgrade" | "proceed" {
  const analysisId = state.analysisId;
  const stackState = stateStore.get(analysisId);
  if (!stackState) return "proceed";

  const report = stackState.completenessReport;
  const retryCount = stackState.completenessRetryCount ?? 0;

  // Route back to code_upgrade if: score is low, there are errors, and we haven't exhausted retries
  if (
    report &&
    report.overallScore < COMPLETENESS_THRESHOLD &&
    report.failed > 0 &&
    retryCount <= MAX_COMPLETENESS_RETRIES &&
    (stackState.completenessFailedChecks?.length ?? 0) > 0
  ) {
    console.log(`[completenessRouter] Routing to retry_upgrade (score=${report.overallScore}%, retry=${retryCount})`);
    return "retry_upgrade";
  }

  console.log(`[completenessRouter] Routing to proceed (score=${report?.overallScore ?? "N/A"}%, retry=${retryCount})`);
  return "proceed";
}

/** Test generation: generate and attach confidence report. */
export async function testGenerationNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!isPhaseSelected(analysisId, "tests")) {
    const s = getState(analysisId);
    s.currentStage = "Test generation skipped";
    s.status = "completed";
    s.progress = phaseProgress(analysisId, "tests");
    stateStore.save(s);
    return {};
  }
  recordPhaseStart(analysisId, "tests");
  const stackState = getState(analysisId);
  stackState.currentStage = "generating_tests";
  stateStore.save(stackState);
  console.log(`[testGenerationNode] Starting test generation for ${analysisId}. modifiedFiles=${stackState.modifiedFiles?.length ?? 0}, taskExecutionResults=${stackState.taskExecutionResults?.length ?? 0}`);
  const updated = await executeTestGenerationAgent(stackState);
  recordPhaseEnd(analysisId, "tests");
  const testCount = updated.generatedTests?.length ?? 0;
  console.log(`[testGenerationNode] Completed: ${testCount} test files generated`);
  if (testCount === 0) {
    console.warn(`[testGenerationNode] ⚠️ No tests were generated! Test execution will have nothing to validate.`);
  }
  stateStore.save(updated);
  updated.status = "completed";
  updated.progress = 100;
  updated.currentStage = "tests_generated";
  stateStore.save(updated);
  const reportMd = [updated.testResultsMarkdown, updated.confidenceReportMarkdown].filter(Boolean).join("\n---CONFIDENCE---\n");
  stateStore.saveToDb(analysisId).catch(() => {});
  stateStore.savePhaseToDb(analysisId, "test_generation", "completed", {
    generatedTests: (updated.generatedTests ?? []).map((t: any) => ({ filePath: t.filePath, testFramework: t.testFramework, coverageTarget: t.coverageTarget })),
  }, reportMd || undefined).catch(() => {});

  persistTokenSnapshot(analysisId);

  // Push test files + final reports to Git (fire-and-forget)
  resolveAdoConfigForGit(analysisId).then(cfg => {
    if (!cfg) return;
    stateStore.saveTestFilesToGit(analysisId, cfg).catch(() => {});
    stateStore.saveReportsToGit(analysisId, cfg).catch(() => {});
  }).catch(() => {});

  return {};
}

function normalizeStackName(raw: string | undefined): StackType | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === "dotnet" || lower === ".net" || lower === "csharp" || lower === "c#") return "dotnet";
  if (lower === "python") return "python";
  if (lower === "java" || lower === "maven" || lower === "gradle" || lower === "spring" || lower === "spring boot") return "java";
  if (lower === "node" || lower === "nodejs" || lower === "javascript" || lower === "typescript" || lower === "react" || lower === "angular" || lower === "vue" || lower === "express" || lower === "nextjs") return "node";
  return null;
}

function resolveStack(state: any): { stack: StackType; runtimeVersion?: string } | null {
  const framework = state.repositoryTree?.framework;
  let stack: StackType | null = null;
  let detectedVersion: string | undefined;

  stack = normalizeStackName(framework);
  if (stack) {
    const langKey = stack === "node" ? "javascript" : stack;
    const version = state.repoProfile?.runtimeInfo?.find((r: any) => r.language === stack || r.language === langKey || r.language === framework);
    detectedVersion = version?.version ? String(version.version).replace(/^v/, "").split(".").slice(0, 2).join(".") : undefined;
  }

  if (!stack) {
    const pt = state.repoProfile?.projectType;
    stack = normalizeStackName(pt);
    if (stack) {
      const langKey = stack === "node" ? "javascript" : stack;
      const version = state.repoProfile?.runtimeInfo?.find((r: any) => r.language === stack || r.language === langKey || r.language === pt);
      detectedVersion = version?.version ? String(version.version).replace(/^v/, "").split(".").slice(0, 2).join(".") : undefined;
    }
  }

  // Fallback: check techStack string
  if (!stack) {
    const ts = ((state as any).techStack ?? "").toLowerCase();
    stack = normalizeStackName(ts);
  }

  // Fallback: infer from generated test file extensions
  if (!stack) {
    const tests = state.generatedTests ?? [];
    if (tests.some((t: any) => (t.filePath || "").endsWith(".cs"))) stack = "dotnet";
    else if (tests.some((t: any) => (t.filePath || "").endsWith(".py"))) stack = "python";
    else if (tests.some((t: any) => (t.filePath || "").endsWith(".java"))) stack = "java";
    else if (tests.some((t: any) => /\.(js|ts|jsx|tsx)$/.test(t.filePath || ""))) stack = "node";
  }

  if (!stack) return null;

  // Override with the user-selected TARGET version (not the original detected version)
  const intendedTfm = resolveIntendedTfm(state.userSelections);
  if (intendedTfm && stack === "dotnet") {
    const targetVersion = intendedTfm.replace(/^net/, ""); // "net10.0" -> "10.0"
    return { stack, runtimeVersion: targetVersion };
  }

  return { stack, runtimeVersion: detectedVersion };
}

/** Run-and-validate: prepare dir, run install+test in Docker; on failure run validation loop (fix agent in Phase 7). */
export async function runAndValidateNode(
  state: StackModGraphState
): Promise<Partial<StackModGraphState>> {
  const analysisId = state.analysisId;
  if (shouldAbortNode(analysisId)) return {};
  if (!stackModConfig.validationEnabled) {
    const s = getState(analysisId);
    s.validationRun = { runId: "", status: "skipped", lastLogs: "Validation is disabled (container not configured)." };
    stateStore.save(s);
    return {};
  }
  if (!isPhaseSelected(analysisId, "validation")) {
    const s = getState(analysisId);
    s.validationRun = { runId: "", status: "skipped", lastLogs: "Validation phase was not selected." };
    stateStore.save(s);
    return {};
  }
  const stackState = getState(analysisId);

  if (!stackModConfig.enableRunAndValidate || !isCodeExecutionEnabled()) {
    stackState.validationRun = { runId: "", status: "skipped", lastLogs: "Code execution is disabled (ENABLE_RUN_AND_VALIDATE or Docker)." };
    stateStore.save(stackState);
    return {};
  }
  const hasTests = (stackState.generatedTests?.length ?? 0) > 0;
  const hasModified = (stackState.modifiedFiles?.length ?? 0) > 0;
  console.log(`[runAndValidateNode] hasTests=${hasTests} (${stackState.generatedTests?.length ?? 0}), hasModified=${hasModified} (${stackState.modifiedFiles?.length ?? 0})`);
  if (!hasTests && !hasModified) {
    console.warn(`[runAndValidateNode] Skipping: no tests AND no modified files. This shouldn't happen if test generation ran.`);
    stackState.validationRun = { runId: "", status: "skipped", lastLogs: "No generated tests or modified files to validate." };
    stateStore.save(stackState);
    return {};
  }
  if (!hasTests) {
    console.warn(`[runAndValidateNode] ⚠️ No generated tests found, but modified files exist. Running validation with modified files only.`);
  }

  const resolved = resolveStack(stackState);
  if (!resolved) {
    const fw = stackState.repositoryTree?.framework ?? stackState.repoProfile?.projectType ?? "unknown";
    stackState.validationRun = { runId: "", status: "skipped", lastLogs: `Could not detect a supported stack for code execution (detected: ${fw}). Supported: dotnet, python, java, node.` };
    stateStore.save(stackState);
    return {};
  }

  recordPhaseStart(analysisId, "validation");
  stackState.currentStage = "Preparing project for validation...";
  stateStore.save(stackState);

  const adapter = createContainerExecutionAdapter(analysisId);
  stackState.currentStage = "Running tests in container...";
  stackState.validationRun = {
    runId: `validate-${analysisId}`,
    status: "running",
    lastLogs: "",
  };
  stateStore.save(stackState);

  let result: { passed: boolean; attempts: number; message?: string };
  try {
    result = await runContainerExecution(adapter, codeExecutionService, { maxAttempts: 8 });
  } catch (e) {
    stackState.validationRun = {
      runId: `validate-${analysisId}`,
      status: "error",
      lastLogs: String(e),
    };
    stackState.validationPassed = false;
    stateStore.save(stackState);
    return {};
  }

  const finalState = getState(analysisId);
  finalState.validationAttempts = result.attempts;
  finalState.validationPassed = result.passed;
  // validationRun already set by adapter.setOutcome in orchestrator
  if (finalState.confidenceReportMarkdown) {
    const validationSection = [
      "",
      "---",
      "## Validation (Container Execution)",
      "",
      result.passed
        ? `Tests executed in container: **passed** after ${result.attempts} attempt(s).`
        : `Tests executed in container: **failed** after ${result.attempts} attempt(s).${result.message ? ` ${result.message}` : ""}`,
      "",
    ].join("\n");
    finalState.confidenceReportMarkdown = finalState.confidenceReportMarkdown.trimEnd() + validationSection;
  }
  finalState.currentStage = result.passed ? "Validation passed" : "Validation failed";
  recordPhaseEnd(analysisId, "validation");
  stateStore.save(finalState);
  persistTokenSnapshot(analysisId);
  stateStore.saveToDb(analysisId).catch(() => {});
  stateStore.savePhaseToDb(analysisId, "validation", result.passed ? "completed" : "failed", {
    validationRun: finalState.validationRun,
    validationPassed: finalState.validationPassed,
    validationAttempts: finalState.validationAttempts,
  }).catch(() => {});
  return {};
}

