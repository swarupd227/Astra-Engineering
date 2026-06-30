/**
 * Smart migration doc formatter with priority-based, budget-aware truncation.
 *
 * Instead of a single hard char cap that blindly slices across all packages,
 * this module:
 *   1. Allocates budget fairly across packages
 *   2. Prioritises: removed APIs (build-breaking) > behavior changes > deprecated
 *   3. Provides per-consumer formatters with different detail levels
 *   4. Supports targeted per-task retrieval for code-upgrade (lightweight RAG)
 */

import type { MigrationDocResult } from "./migration-doc-fetcher";
import type { MigrationDocIndex } from "../types";

// ── Priority tiers ──────────────────────────────────────────────

enum Priority {
  CRITICAL = 0,   // removedAPIs — code won't compile without these
  IMPORTANT = 1,  // behaviorChanges — code compiles but behaves wrong
  ADVISORY = 2,   // deprecatedAPIs — still works, but should update
}

interface DocSection {
  priority: Priority;
  label: string;
  items: string[];
}

function sectionsForDoc(doc: MigrationDocResult): DocSection[] {
  return [
    { priority: Priority.CRITICAL, label: "REMOVED APIs (MUST be replaced)", items: doc.removedAPIs },
    { priority: Priority.IMPORTANT, label: "BEHAVIOR CHANGES (verify compatibility)", items: doc.behaviorChanges },
    { priority: Priority.ADVISORY, label: "DEPRECATED APIs (should be updated)", items: doc.deprecatedAPIs },
  ];
}

function measureSection(label: string, items: string[]): number {
  if (items.length === 0) return 0;
  return `**${label}:**\n`.length + items.reduce((sum, i) => sum + `  - ${i}\n`.length, 0);
}

function renderSection(label: string, items: string[]): string {
  if (items.length === 0) return "";
  return `**${label}:**\n${items.map(i => `  - ${i}`).join("\n")}`;
}

// ── Budget allocation ───────────────────────────────────────────

interface PackageBudget {
  pkg: string;
  doc: MigrationDocResult;
  allocatedChars: number;
}

/**
 * Distribute a character budget across packages, weighted by content volume.
 * Packages with more breaking changes get proportionally more space, but
 * every package gets at least a minimum allocation.
 */
function allocateBudgets(
  docs: Record<string, MigrationDocResult>,
  totalBudget: number,
): PackageBudget[] {
  const entries = Object.entries(docs).filter(([, d]) => d.found);
  if (entries.length === 0) return [];

  const MIN_PER_PKG = 800;
  const headerOverhead = 200;

  const weights = entries.map(([pkg, doc]) => {
    const removedWeight = doc.removedAPIs.length * 3;
    const behaviorWeight = doc.behaviorChanges.length * 2;
    const deprecatedWeight = doc.deprecatedAPIs.length * 1;
    return { pkg, doc, weight: Math.max(removedWeight + behaviorWeight + deprecatedWeight, 1) };
  });

  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
  const usableBudget = totalBudget - headerOverhead;

  return weights.map(w => ({
    pkg: w.pkg,
    doc: w.doc,
    allocatedChars: Math.max(
      MIN_PER_PKG,
      Math.floor((w.weight / totalWeight) * usableBudget),
    ),
  }));
}

/**
 * Format a single package's docs within a character budget,
 * respecting priority order (removed > behavior > deprecated).
 */
function formatPackageWithBudget(pkg: string, doc: MigrationDocResult, budget: number): string {
  const header = `### ${pkg}\n`;
  let remaining = budget - header.length;
  const sections = sectionsForDoc(doc);
  const rendered: string[] = [header];

  for (const section of sections) {
    if (section.items.length === 0 || remaining <= 0) continue;

    const labelLine = `**${section.label}:**\n`;
    if (remaining < labelLine.length + 20) break;
    remaining -= labelLine.length;

    const includedItems: string[] = [];
    for (const item of section.items) {
      const line = `  - ${item}\n`;
      if (remaining < line.length) break;
      includedItems.push(item);
      remaining -= line.length;
    }

    if (includedItems.length > 0) {
      rendered.push(renderSection(section.label, includedItems));
      const omitted = section.items.length - includedItems.length;
      if (omitted > 0) {
        const note = `  _(${omitted} more ${section.label.toLowerCase().split(" ")[0]} items — see per-file guidance for complete list)_`;
        rendered.push(note);
        remaining -= note.length;
      }
    }
  }

  return rendered.join("\n");
}

// ── Public formatters ───────────────────────────────────────────

/**
 * For the PLANNING agent: summary of all packages.
 * Needs a broad overview but not full API lists.
 * Budget: ~16K chars (planning prompts don't include file contents).
 */
export function formatDocsForPlanning(
  docs: Record<string, MigrationDocResult>,
  budget = 16000,
): string {
  const budgets = allocateBudgets(docs, budget);
  if (budgets.length === 0) return "";

  const header = "## OFFICIAL MIGRATION DOCUMENTATION (reference these breaking changes in the plan)\n\n";
  const parts = [header];

  for (const b of budgets) {
    parts.push(formatPackageWithBudget(b.pkg, b.doc, b.allocatedChars));
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * For the TASK PLANNER agent: detailed list of all breaking changes
 * so it can create one task per breaking change group.
 * Budget: ~24K chars (task planner prompts are lightweight beyond this).
 */
export function formatDocsForTaskPlanning(
  docs: Record<string, MigrationDocResult>,
  budget = 24000,
): string {
  const budgets = allocateBudgets(docs, budget);
  if (budgets.length === 0) return "";

  const header = "## OFFICIAL MIGRATION DOCUMENTATION (create tasks that address EACH breaking change listed)\n\n";
  const parts = [header];

  for (const b of budgets) {
    parts.push(formatPackageWithBudget(b.pkg, b.doc, b.allocatedChars));
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * For the CODE UPGRADE agent: targeted docs for just the packages
 * relevant to the current task + per-file API matches.
 *
 * This is the key fix — instead of dumping ALL docs into every per-file
 * LLM call, we retrieve only what's relevant. This is a structured
 * retrieval approach (essentially key-based RAG where the keys are
 * package names and file paths).
 */
export function formatDocsForCodeUpgrade(
  allDocs: Record<string, MigrationDocResult>,
  taskPackages: string[],
  scopeFilePaths: string[],
  docIndex: MigrationDocIndex | undefined,
  budget = 12000,
): string {
  const relevantDocs: Record<string, MigrationDocResult> = {};
  for (const pkg of taskPackages) {
    if (allDocs[pkg]?.found) {
      relevantDocs[pkg] = allDocs[pkg];
    }
  }

  if (Object.keys(relevantDocs).length === 0) {
    for (const [pkg, doc] of Object.entries(allDocs)) {
      if (doc.found) relevantDocs[pkg] = doc;
    }
  }

  const perPkgBudget = Math.floor(budget * 0.6);
  const perFileBudget = Math.floor(budget * 0.4);

  const parts: string[] = [];

  // Part 1: Package-level docs (only relevant packages)
  const budgets = allocateBudgets(relevantDocs, perPkgBudget);
  if (budgets.length > 0) {
    parts.push("## MIGRATION DOCUMENTATION FOR THIS TASK\n");
    for (const b of budgets) {
      parts.push(formatPackageWithBudget(b.pkg, b.doc, b.allocatedChars));
      parts.push("");
    }
  }

  // Part 2: Per-file targeted API matches from the index
  if (docIndex?.fileRelevance) {
    const perFileSections: string[] = [];
    let perFileUsed = 0;

    for (const filePath of scopeFilePaths) {
      const relevant = docIndex.fileRelevance[filePath];
      if (!relevant?.length) continue;

      const section = `FOR FILE ${filePath}:\n${relevant.join("\n")}`;
      if (perFileUsed + section.length > perFileBudget) break;
      perFileSections.push(section);
      perFileUsed += section.length;
    }

    if (perFileSections.length > 0) {
      parts.push("## PER-FILE MIGRATION GUIDANCE (matched from official docs)\n");
      parts.push(perFileSections.join("\n\n"));
    }
  }

  return parts.join("\n");
}

/**
 * Extract package names from a task title/description.
 * Used to determine which docs are relevant for a given upgrade task.
 */
export function extractTaskPackages(
  taskTitle: string,
  taskDescription: string,
  allPackageNames: string[],
): string[] {
  const combined = `${taskTitle} ${taskDescription}`.toLowerCase();
  const matched = allPackageNames.filter(pkg => {
    const pkgLower = pkg.toLowerCase();
    if (combined.includes(pkgLower)) return true;
    const shortName = pkgLower.split("/").pop() || pkgLower;
    return combined.includes(shortName);
  });
  return matched;
}

/**
 * Full untruncated format — stored on state for debugging and
 * for consumers that want to do their own retrieval.
 * No budget cap, just structured formatting.
 */
export function formatDocsComplete(docs: Record<string, MigrationDocResult>): string {
  const entries = Object.entries(docs).filter(([, d]) => d.found);
  if (entries.length === 0) return "";

  const parts: string[] = ["## COMPLETE MIGRATION DOCUMENTATION\n"];

  for (const [pkg, doc] of entries) {
    parts.push(`### ${pkg}`);

    if (doc.removedAPIs.length > 0) {
      parts.push(renderSection("REMOVED APIs (MUST be replaced)", doc.removedAPIs));
    }
    if (doc.behaviorChanges.length > 0) {
      parts.push(renderSection("BEHAVIOR CHANGES (verify compatibility)", doc.behaviorChanges));
    }
    if (doc.deprecatedAPIs.length > 0) {
      parts.push(renderSection("DEPRECATED APIs (should be updated)", doc.deprecatedAPIs));
    }
    parts.push("");
  }

  return parts.join("\n");
}
