/**
 * Migration Docs Fetch Agent
 *
 * Runs once right after version selection, before planning.
 * Fetches official migration docs, builds deterministic rules,
 * formats prompt text, and builds a per-file relevance index.
 * All results are stored on state so every downstream agent can use them
 * without re-fetching.
 *
 * Doc formatting uses priority-based, budget-aware truncation via
 * migration-doc-formatter.ts — each downstream consumer (planning,
 * task planner, code upgrade) gets its own format at call time.
 */

import type {
  StackModernizationState,
  MigrationDocIndex,
  ExtractedFile,
  ImportGraph,
} from "../types";
import {
  fetchAllMigrationDocs,
  type MigrationDocResult,
} from "../services/migration-doc-fetcher";
import { generateRulesFromMigrationDocs } from "../services/deterministic-transforms";
import {
  formatDocsComplete,
  formatDocsForPlanning,
} from "../services/migration-doc-formatter";

/**
 * Build a per-file relevance index mapping each file to the doc sections
 * that are relevant to its content.  This keeps per-file prompt injection
 * targeted instead of dumping the entire doc into every call.
 */
function buildMigrationDocIndex(
  extractedFiles: ExtractedFile[],
  migrationDocs: Record<string, MigrationDocResult>,
  importGraph?: ImportGraph,
): MigrationDocIndex {
  const fileRelevance: Record<string, string[]> = {};
  const packageSections: Record<string, string[]> = {};

  for (const [pkg, doc] of Object.entries(migrationDocs)) {
    if (!doc.found) continue;
    const sections: string[] = [];
    if (doc.removedAPIs.length) sections.push("Removed APIs");
    if (doc.deprecatedAPIs.length) sections.push("Deprecated APIs");
    if (doc.behaviorChanges.length) sections.push("Behavior Changes");
    packageSections[pkg] = sections;
  }

  for (const file of extractedFiles) {
    const relevant: string[] = [];
    const contentLower = file.content.toLowerCase();

    for (const [pkg, doc] of Object.entries(migrationDocs)) {
      if (!doc.found) continue;

      const pkgLower = pkg.toLowerCase();
      const importsPackage = importGraph?.packageToFiles?.[pkg]?.includes(file.relativePath);
      const mentionsPackage = contentLower.includes(pkgLower);

      if (!importsPackage && !mentionsPackage) continue;

      const fileRemovedAPIs = doc.removedAPIs.filter(api => {
        const apiKey = api.split("(")[0].split(" ")[0].toLowerCase().replace(/^\./, "");
        return apiKey.length > 2 && contentLower.includes(apiKey);
      });
      if (fileRemovedAPIs.length > 0) {
        relevant.push(
          `REMOVED APIs in ${pkg} affecting this file:\n${fileRemovedAPIs.map(a => `  - ${a}`).join("\n")}`,
        );
      }

      const fileBehaviorChanges = doc.behaviorChanges.filter(change => {
        const keywords = change.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        return keywords.some(k => contentLower.includes(k));
      });
      if (fileBehaviorChanges.length > 0) {
        relevant.push(
          `Behavior changes in ${pkg} relevant to this file:\n${fileBehaviorChanges.map(c => `  - ${c}`).join("\n")}`,
        );
      }

      const fileDeprecatedAPIs = doc.deprecatedAPIs.filter(api => {
        const apiKey = api.split("(")[0].split(" ")[0].toLowerCase().replace(/^\./, "");
        return apiKey.length > 2 && contentLower.includes(apiKey);
      });
      if (fileDeprecatedAPIs.length > 0) {
        relevant.push(
          `Deprecated APIs in ${pkg} in this file:\n${fileDeprecatedAPIs.map(a => `  - ${a}`).join("\n")}`,
        );
      }
    }

    if (relevant.length > 0) {
      fileRelevance[file.relativePath] = relevant;
    }
  }

  return { fileRelevance, packageSections };
}

/**
 * Main entry point — called by the graph node.
 */
export async function executeMigrationDocsFetchAgent(
  state: StackModernizationState,
): Promise<StackModernizationState> {
  const selections = state.userSelections ?? [];
  if (selections.length === 0) return state;

  const updated = { ...state };

  // 1. Fetch docs once
  const docsMap = await fetchAllMigrationDocs(selections);
  const docsRecord: Record<string, MigrationDocResult> = {};
  for (const [key, val] of docsMap) {
    docsRecord[key] = val;
  }
  updated.migrationDocs = docsRecord;

  // 2. Build deterministic rules from docs
  try {
    const rules = generateRulesFromMigrationDocs(docsMap, selections);
    updated.deterministicRules = rules;
  } catch {
    updated.deterministicRules = [];
  }

  // 3. Store full untruncated doc text (source of truth for retrieval).
  //    Per-consumer budgeted formats are generated at call sites via
  //    migration-doc-formatter.ts, NOT stored on state.
  updated.migrationDocsFullText = formatDocsComplete(docsRecord);
  // Legacy field — generate a planning-level summary for backward compat.
  updated.migrationDocsPromptText = formatDocsForPlanning(docsRecord);

  // 4. Build per-file relevance index
  updated.migrationDocsIndex = buildMigrationDocIndex(
    state.extractedFiles ?? [],
    docsRecord,
    state.importGraph,
  );

  // 5. Warn about packages with no docs
  const warnings: string[] = [];
  for (const sel of selections) {
    const doc = docsRecord[sel.package];
    if (!doc || !doc.found) {
      warnings.push(`No migration docs found for ${sel.package} ${sel.currentVersion} → ${sel.selectedVersion}. LLM will rely on training data only.`);
    }
  }
  updated.migrationDocsWarnings = warnings;

  if (warnings.length > 0) {
    console.warn("[MigrationDocsFetchAgent]", warnings.join(" | "));
  }

  const foundCount = Object.values(docsRecord).filter(d => d.found).length;
  console.log(
    `[MigrationDocsFetchAgent] Fetched docs for ${foundCount}/${selections.length} selections. ` +
    `Index covers ${Object.keys(updated.migrationDocsIndex.fileRelevance).length} files.`,
  );

  return updated;
}
