/**
 * Migration Report Generator
 *
 * Produces a comprehensive markdown document summarising everything the
 * modernisation pipeline changed, what needs manual attention, and what
 * was missed.  Generated deterministically (no LLM) from existing state
 * fields after the completeness verification phase.
 */

import type { StackModernizationState, ModifiedFile, CdnReference } from "../types";

// ═══════════════════════════════════════════════════════════════
// Helper utilities
// ═══════════════════════════════════════════════════════════════

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text}`;
}

function bullet(text: string, indent = 0): string {
  return `${"  ".repeat(indent)}- ${text}`;
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  const sep = headers.map(() => "---");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.map(r => `| ${r.join(" | ")} |`),
  ];
  return lines.join("\n");
}

function datestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

// ═══════════════════════════════════════════════════════════════
// Stack detection helper
// ═══════════════════════════════════════════════════════════════

function detectProjectStacks(state: StackModernizationState): Set<string> {
  const stacks = new Set<string>();
  const files = (state.extractedFiles ?? []).map(f => f.relativePath.toLowerCase().replace(/\\/g, "/"));
  const selections = (state.userSelections ?? []).map(s => s.package.toLowerCase());

  if (files.some(f => f.endsWith(".csproj") || f.endsWith(".sln") || f.endsWith(".fsproj"))) stacks.add("dotnet");
  if (files.some(f => f === "package.json" || f.endsWith("/package.json"))) stacks.add("node");
  if (files.some(f => f.endsWith("pom.xml") || f.endsWith(".gradle") || f.endsWith(".gradle.kts"))) stacks.add("java");
  if (files.some(f => f.endsWith("requirements.txt") || f.endsWith("pyproject.toml") || f.endsWith("pipfile"))) stacks.add("python");
  if (files.some(f => f === "gemfile" || f.endsWith("/gemfile"))) stacks.add("ruby");
  if (files.some(f => f === "composer.json" || f.endsWith("/composer.json"))) stacks.add("php");

  if (selections.some(s => s.includes("microsoft") || s.includes(".net") || s.includes("aspnet"))) stacks.add("dotnet");
  if (selections.some(s => s.includes("spring") || s.includes("javax") || s.includes("jakarta"))) stacks.add("java");
  if (selections.some(s => s.includes("django") || s.includes("flask") || s.includes("fastapi"))) stacks.add("python");

  return stacks;
}

// ═══════════════════════════════════════════════════════════════
// Main generator
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a comprehensive migration report from the pipeline state.
 * All data sources are already present on `state` — no external calls needed.
 */
export function generateMigrationReport(state: StackModernizationState): string {
  const sections: string[] = [];

  const modifiedFiles = state.modifiedFiles ?? [];
  const newFiles = modifiedFiles.filter(f => f.isNew);
  const updatedFiles = modifiedFiles.filter(f => !f.isNew);
  const detectedStacks = detectProjectStacks(state);
  const selections = state.userSelections ?? [];
  const completeness = state.completenessReport as any;
  const scaffoldResult = state.scaffoldResult as any;
  const cdnRefs = state.cdnReferences ?? [];
  const bundleDetections = (state.bundleDetections ?? []) as any[];
  const apiImpact = state.apiUsageImpactReport as any;
  const consistency = state.consistencyReport as any;
  const changeSummaries = state.changeSummaries ?? {};

  // ── Title ──
  sections.push(heading(1, "Migration Report"));
  sections.push(`> Generated: ${datestamp()}`);
  sections.push("");

  // ── Executive Summary ──
  sections.push(heading(2, "Executive Summary"));
  sections.push("");
  const score = completeness?.overallScore ?? "N/A";
  sections.push(table(
    ["Metric", "Value"],
    [
      ["Files modified", String(updatedFiles.length)],
      ["New files created", String(newFiles.length)],
      ["Libraries targeted for upgrade", String(selections.length)],
      ["Completeness score", `${score}%`],
      ["Completeness checks passed", `${completeness?.passed ?? "N/A"} / ${completeness?.totalChecks ?? "N/A"}`],
      ["CDN references found", String(cdnRefs.length)],
      ["Bundled/concatenated files", String(bundleDetections.filter((b: any) => b.isConcatenated).length)],
    ],
  ));
  sections.push("");

  // ── Package / Dependency Upgrades ──
  sections.push(heading(2, "Package / Dependency Upgrades"));
  sections.push("");
  if (selections.length === 0) {
    sections.push("_No version selections were made._");
  } else {
    sections.push(table(
      ["Package", "Category", "From", "To"],
      selections.map(s => [
        `\`${s.package}\``,
        s.category,
        s.currentVersion || "—",
        s.selectedVersion,
      ]),
    ));
  }
  sections.push("");

  // ── Vendor Library Replacements ──
  const vendorLibs = state.vendorLibraries ?? [];
  if (vendorLibs.length > 0) {
    sections.push(heading(2, "Vendor Libraries Detected"));
    sections.push("");
    sections.push(table(
      ["Library", "Detected Version", "Detection Method", "Files"],
      vendorLibs.map(v => [
        `\`${v.name}\``,
        v.detectedVersion ?? "unknown",
        v.detectionMethod,
        v.existingFiles.slice(0, 3).join(", ") + (v.existingFiles.length > 3 ? ` (+${v.existingFiles.length - 3})` : ""),
      ]),
    ));
    sections.push("");
  }

  // ── Vendor Download Results ──
  const vendorDl = state.vendorDownloadResults;
  if (vendorDl && ((vendorDl.downloaded?.length ?? 0) > 0 || (vendorDl.failed?.length ?? 0) > 0)) {
    sections.push(heading(2, "Vendor Library Download Results"));
    sections.push("");
    if (vendorDl.downloaded && vendorDl.downloaded.length > 0) {
      sections.push(heading(3, "Successfully Downloaded"));
      sections.push("");
      sections.push(table(
        ["Library", "Version", "Destination"],
        vendorDl.downloaded.map(d => [
          `\`${d.library}\``,
          d.version,
          `\`${d.destination}\``,
        ]),
      ));
      sections.push("");
    }
    if (vendorDl.failed && vendorDl.failed.length > 0) {
      sections.push(heading(3, "Failed Downloads (Manual Action Required)"));
      sections.push("");
      sections.push(table(
        ["Library", "Version", "Error"],
        vendorDl.failed.map(f => [
          `\`${f.library}\``,
          f.version,
          String(f.reason).slice(0, 150),
        ]),
      ));
      sections.push("");
    }
    if (vendorDl.skipped && vendorDl.skipped.length > 0) {
      sections.push(heading(3, "Skipped"));
      sections.push("");
      sections.push(table(
        ["Library", "Reason"],
        vendorDl.skipped.map(s => [
          `\`${s.library}\``,
          s.reason,
        ]),
      ));
      sections.push("");
    }
  }

  // ── CDN URL Updates ──
  if (cdnRefs.length > 0) {
    sections.push(heading(2, "CDN Library References"));
    sections.push("");
    sections.push("These `<script>` and `<link>` tags reference CDN-hosted libraries:");
    sections.push("");
    sections.push(table(
      ["File", "Line", "Library", "Version", "Tag"],
      cdnRefs.map(r => [
        `\`${r.file}\``,
        String(r.line),
        r.library,
        r.version ?? "unknown",
        `\`<${r.tagType}>\``,
      ]),
    ));
    sections.push("");
  }

  // ── Structural Changes ──
  if (scaffoldResult) {
    sections.push(heading(2, "Structural Changes"));
    sections.push("");

    if (scaffoldResult.newFiles?.length > 0) {
      sections.push(heading(3, "New Files Created"));
      sections.push("");
      for (const sf of scaffoldResult.newFiles) {
        sections.push(bullet(`\`${sf.path}\` — ${sf.reason}`));
      }
      sections.push("");
    }

    if (scaffoldResult.obsoleteFiles?.length > 0) {
      sections.push(heading(3, "Obsolete Files"));
      sections.push("");
      for (const of_ of scaffoldResult.obsoleteFiles) {
        sections.push(bullet(`\`${of_.path}\` — ${of_.reason}`));
      }
      sections.push("");
    }

    if (scaffoldResult.structuralWarnings?.length > 0) {
      sections.push(heading(3, "Structural Warnings"));
      sections.push("");
      for (const w of scaffoldResult.structuralWarnings) {
        sections.push(bullet(w));
      }
      sections.push("");
    }
  }

  // ── Task Execution Results ──
  const taskResults = (state.taskExecutionResults ?? []) as any[];
  const upgradeTasks = (state.upgradeTasks ?? []) as any[];
  if (upgradeTasks.length > 0) {
    sections.push(heading(2, "Task Execution Results"));
    sections.push("");

    const completedTasks = taskResults.filter((r: any) => r.status === "completed");
    const failedTasks = taskResults.filter((r: any) => r.status === "failed");
    const skippedTasks = taskResults.filter((r: any) => r.status === "skipped");
    const pendingTasks = upgradeTasks.filter((t: any) =>
      !taskResults.some((r: any) => r.taskId === t.id)
    );

    sections.push(table(
      ["Status", "Count"],
      [
        ["✅ Completed", String(completedTasks.length)],
        ["❌ Failed", String(failedTasks.length)],
        ["⏭️ Skipped", String(skippedTasks.length)],
        ["⏳ Pending (not executed)", String(pendingTasks.length)],
        ["**Total Tasks**", `**${upgradeTasks.length}**`],
      ],
    ));
    sections.push("");

    // Detail each task
    for (const task of upgradeTasks) {
      const result = taskResults.find((r: any) => r.taskId === task.id);
      const status = result?.status ?? "pending";
      const icon = status === "completed" ? "✅" : status === "failed" ? "❌" : status === "skipped" ? "⏭️" : "⏳";
      sections.push(heading(3, `${icon} Task: ${task.title || task.id}`));
      sections.push("");

      // Task metadata
      if (task.description) sections.push(bullet(`**Description:** ${String(task.description).slice(0, 300)}`));
      if (task.riskLevel) sections.push(bullet(`**Risk Level:** ${task.riskLevel}`));
      if (task.phase) sections.push(bullet(`**Phase:** ${task.phase}`));
      const affectedFiles = task.affectedFiles || task.files || [];
      if (Array.isArray(affectedFiles) && affectedFiles.length > 0) {
        sections.push(bullet(`**Affected Files:** ${affectedFiles.slice(0, 10).map((f: string) => `\`${f}\``).join(", ")}${affectedFiles.length > 10 ? ` (+${affectedFiles.length - 10} more)` : ""}`));
      }
      sections.push("");

      // Execution result
      if (result) {
        if (result.summary) sections.push(bullet(`**What was done:** ${String(result.summary).slice(0, 500)}`));
        if (result.alteredFiles?.length > 0) {
          sections.push(bullet("**Files changed:**"));
          for (const af of result.alteredFiles.slice(0, 10)) {
            const desc = typeof af === "string" ? af : `\`${af.path || af.file || af}\`${af.changes ? ` — ${af.changes}` : ""}`;
            sections.push(bullet(desc, 1));
          }
        }
        if (result.fixedIssues?.length > 0) {
          sections.push(bullet("**Issues fixed:**"));
          for (const issue of result.fixedIssues.slice(0, 5)) {
            sections.push(bullet(String(issue), 1));
          }
        }
        if (status === "failed" && result.error) {
          sections.push(bullet(`**Error:** ${String(result.error).slice(0, 300)}`));
        }
      } else {
        sections.push(bullet("**Status:** Not executed — task was pending when the pipeline completed"));
      }
      sections.push("");
    }
  }

  // ── Code Modification Summaries ──
  const summaryEntries = Object.entries(changeSummaries);
  if (summaryEntries.length > 0) {
    sections.push(heading(2, "Code Modifications Summary"));
    sections.push("");
    for (const [filePath, summary] of summaryEntries.slice(0, 50)) {
      sections.push(bullet(`**\`${filePath}\`**: ${String(summary).slice(0, 300)}`));
    }
    if (summaryEntries.length > 50) {
      sections.push(bullet(`_... and ${summaryEntries.length - 50} more files_`));
    }
    sections.push("");
  }

  // ── Requires Manual Attention ──
  sections.push(heading(2, "⚠️ Requires Manual Attention"));
  sections.push("");

  let hasManualItems = false;

  // Failed completeness checks
  const failedChecks = (completeness?.checks ?? []).filter((c: any) => !c.passed);
  if (failedChecks.length > 0) {
    sections.push(heading(3, "Incomplete Upgrades"));
    sections.push("");
    for (const check of failedChecks) {
      const severity = check.severity === "error" ? "🔴" : "🟡";
      sections.push(bullet(`${severity} **${check.description}**`));
      if (check.details) {
        sections.push(bullet(check.details, 1));
      }
    }
    sections.push("");
    hasManualItems = true;
  }

  // Breaking API changes
  if (apiImpact?.affectedFiles?.length > 0) {
    sections.push(heading(3, "Breaking API Patterns Detected"));
    sections.push("");
    for (const af of apiImpact.affectedFiles.slice(0, 20)) {
      sections.push(bullet(`**\`${af.path}\`** — ${af.impacts?.length ?? 0} pattern(s), risk score: ${af.riskScore ?? "N/A"}/100`));
      for (const imp of (af.impacts ?? []).slice(0, 3)) {
        sections.push(bullet(`\`${imp.pattern}\` (line ${imp.line}) — ${imp.description ?? imp.library ?? ""}`, 1));
      }
    }
    sections.push("");
    hasManualItems = true;
  }

  // Concatenated bundle files
  const concatenatedBundles = bundleDetections.filter((b: any) => b.isConcatenated);
  if (concatenatedBundles.length > 0) {
    sections.push(heading(3, "Concatenated Bundle Files"));
    sections.push("");
    sections.push("These files contain multiple libraries concatenated together. **Do not try to rebuild them manually.**");
    sections.push("Instead, replace the single bundle `<script>` tag with individual library references and use `libman restore` to install them:");
    sections.push("");
    for (const b of concatenatedBundles) {
      const libs = (b.libraries ?? []).map((l: any) => `${l.name} v${l.version}`).join(", ");
      sections.push(bullet(`**\`${b.filePath}\`** — contains: ${libs}`));
      sections.push(bullet("Replace with individual `<script>` / `<link>` tags for each library", 1));
      sections.push(bullet("Individual library entries have been added to `libman.json` — run `libman restore`", 1));
    }
    sections.push("");
    hasManualItems = true;
  }

  // Consistency violations
  if (consistency?.violations?.length > 0) {
    sections.push(heading(3, "Consistency Warnings"));
    sections.push("");
    for (const v of consistency.violations.slice(0, 15)) {
      sections.push(bullet(`${v.severity === "error" ? "🔴" : "🟡"} ${v.message}`));
      if (v.file) sections.push(bullet(`File: \`${v.file}\``, 1));
    }
    sections.push("");
    hasManualItems = true;
  }

  // Skipped files (too large)
  const skippedFiles = (state as any).skippedFiles ?? [];
  if (skippedFiles.length > 0) {
    sections.push(heading(3, "Skipped Files (Too Large to Process)"));
    sections.push("");
    sections.push(`${skippedFiles.length} file(s) were skipped because they exceeded the size threshold:`);
    sections.push("");
    sections.push(table(
      ["File", "Size", "Reason"],
      skippedFiles.map((sf: any) => [
        `\`${sf.path}\``,
        `${(sf.size / 1000).toFixed(0)}K chars`,
        sf.reason,
      ]),
    ));
    sections.push("");
    sections.push("These files need **manual review and upgrade**.");
    sections.push("");
    hasManualItems = true;
  }

  if (!hasManualItems) {
    sections.push("_No manual attention items detected — all checks passed!_");
    sections.push("");
  }

  // ── Successfully Upgraded ──
  const passedChecks = (completeness?.checks ?? []).filter((c: any) => c.passed);
  if (passedChecks.length > 0) {
    sections.push(heading(2, "✅ Successfully Upgraded"));
    sections.push("");
    for (const check of passedChecks) {
      sections.push(bullet(`${check.description}`));
    }
    sections.push("");
  }

  // ── Modified Files List ──
  if (modifiedFiles.length > 0) {
    sections.push(heading(2, "All Modified Files"));
    sections.push("");
    for (const f of modifiedFiles) {
      const badge = f.isNew ? " 🆕" : "";
      sections.push(bullet(`\`${f.path}\`${badge}`));
    }
    sections.push("");
  }

  // ── Build Verification Results ──
  const buildResults = (state as any).buildVerificationResults;
  if (buildResults) {
    sections.push(heading(2, "Build Verification Results"));
    sections.push("");
    if (buildResults.passed) {
      sections.push(`Build verification **PASSED** for ${buildResults.stack || "project"}.`);
    } else {
      sections.push(`Build verification **FAILED** for ${buildResults.stack || "project"}.`);
    }
    if (buildResults.command) {
      sections.push("");
      sections.push(`Command: \`${buildResults.command}\``);
    }
    if (buildResults.output) {
      sections.push("");
      sections.push("```");
      sections.push(buildResults.output.slice(0, 3000));
      sections.push("```");
    }
    sections.push("");
  }

  // ── Pending Work — Detailed Handover ──
  sections.push(heading(2, "📋 Pending Work — Manual Steps Required"));
  sections.push("");
  sections.push("The following items could **not be fully automated** by the platform and require manual developer action. This section is intended as a detailed handover checklist.");
  sections.push("");

  let pendingItemNumber = 0;

  // 1. Failed tasks
  const failedTaskResults = (state.taskExecutionResults ?? [] as any[]).filter((r: any) => r.status === "failed");
  if (failedTaskResults.length > 0) {
    pendingItemNumber++;
    sections.push(heading(3, `${pendingItemNumber}. Failed Upgrade Tasks`));
    sections.push("");
    sections.push("These tasks were attempted but failed. They need to be completed manually:");
    sections.push("");
    for (const fr of failedTaskResults) {
      const task = (state.upgradeTasks ?? [] as any[]).find((t: any) => t.id === fr.taskId) as any;
      sections.push(bullet(`**${task?.title || fr.taskId}**`));
      if (fr.error) sections.push(bullet(`Error: ${String(fr.error).slice(0, 300)}`, 1));
      if (task?.description) sections.push(bullet(`What to do: ${String(task.description).slice(0, 300)}`, 1));
      const files = task?.affectedFiles || task?.files || [];
      if (Array.isArray(files) && files.length > 0) {
        sections.push(bullet(`Files to check: ${files.slice(0, 5).map((f: string) => `\`${f}\``).join(", ")}`, 1));
      }
    }
    sections.push("");
  }

  // 2. Pending (unexecuted) tasks
  const executedTaskIds = new Set((state.taskExecutionResults ?? []).map((r: any) => r.taskId));
  const pendingUngradeTasks = (state.upgradeTasks ?? [] as any[]).filter((t: any) => !executedTaskIds.has(t.id));
  if (pendingUngradeTasks.length > 0) {
    pendingItemNumber++;
    sections.push(heading(3, `${pendingItemNumber}. Tasks Not Executed`));
    sections.push("");
    sections.push("These tasks were planned but never executed by the pipeline:");
    sections.push("");
    for (const t of pendingUngradeTasks as any[]) {
      sections.push(bullet(`**${t.title || t.id}** (Risk: ${t.riskLevel || "unknown"})`));
      if (t.description) sections.push(bullet(`${String(t.description).slice(0, 200)}`, 1));
    }
    sections.push("");
  }

  // 3. Failed completeness checks — with detailed fix instructions
  if (failedChecks.length > 0) {
    pendingItemNumber++;
    sections.push(heading(3, `${pendingItemNumber}. Incomplete Version Upgrades`));
    sections.push("");
    sections.push("The completeness verifier found these upgrades were not fully applied:");
    sections.push("");
    for (const check of failedChecks) {
      sections.push(bullet(`**${check.description}**`));
      if (check.details) sections.push(bullet(`Details: ${check.details}`, 1));
      // Provide actionable fix instructions
      if (check.category === "tfm" || String(check.description).toLowerCase().includes("target framework")) {
        sections.push(bullet("Fix: Open each `.csproj` file and verify `<TargetFramework>` is set correctly", 1));
      } else if (check.category === "nuget" || String(check.description).toLowerCase().includes("nuget")) {
        sections.push(bullet("Fix: Open the `.csproj` file and update the `<PackageReference>` version manually", 1));
      } else if (check.category === "cdn") {
        sections.push(bullet("Fix: Find the `<script>` or `<link>` tag in the file and update the version in the CDN URL", 1));
      } else if (check.category === "vendor") {
        sections.push(bullet("Fix: Run `libman restore` or manually download the library from npm/CDN", 1));
      } else if (check.category === "layout") {
        sections.push(bullet("Fix: Open the file listed above and update the `src` or `href` attribute to point to the correct vendor file path", 1));
        if (check.details && check.details.includes("Correct path")) {
          sections.push(bullet(`Suggested: ${check.details}`, 1));
        }
      }
    }
    sections.push("");
  }

  // Unresolved asset references that couldn't be auto-fixed
  const unresolvedAssetRefs = state.unresolvedAssetRefs ?? [];
  if (unresolvedAssetRefs.length > 0) {
    pendingItemNumber++;
    sections.push(heading(3, `${pendingItemNumber}. Unresolved Asset References (Manual Fix Required)`));
    sections.push("");
    sections.push("The platform detected these `<script src>` / `<link href>` references in view/template files that **could not be automatically corrected** to match downloaded vendor library locations. You must manually verify or fix these paths:");
    sections.push("");

    const groupedByFile = new Map<string, Array<{ ref: string; fileName: string }>>();
    for (const entry of unresolvedAssetRefs) {
      const key = entry.file || "unknown";
      if (!groupedByFile.has(key)) groupedByFile.set(key, []);
      groupedByFile.get(key)!.push(entry);
    }

    for (const [file, refs] of groupedByFile) {
      sections.push(bullet(`**\`${file}\`**`));
      for (const r of refs) {
        sections.push(bullet(`Path: \`${r.ref}\` — file \`${r.fileName}\` not found in vendor downloads`, 1));
        sections.push(bullet("Action: Check if this library was downloaded to a different path, or download it manually and update the reference", 2));
      }
    }
    sections.push("");
  }

  // Vendor download failures
  const vendorDlResults = state.vendorDownloadResults as any;
  if (vendorDlResults?.failed && vendorDlResults.failed.length > 0) {
    pendingItemNumber++;
    sections.push(heading(3, `${pendingItemNumber}. Failed Vendor Library Downloads`));
    sections.push("");
    sections.push("The following vendor libraries **failed to download** during the automated process. You need to download and place them manually:");
    sections.push("");
    sections.push(table(
      ["Library", "Version", "Error", "Action"],
      vendorDlResults.failed.map((f: any) => [
        `\`${f.library || f.name || "unknown"}\``,
        f.version || "unknown",
        String(f.error || f.reason || "download failed").slice(0, 100),
        "Download manually from npm/CDN and place in the appropriate project directory",
      ]),
    ));
    sections.push("");
  }

  // 4. Concatenated bundles that need manual splitting
  if (concatenatedBundles.length > 0) {
    pendingItemNumber++;
    sections.push(heading(3, `${pendingItemNumber}. Concatenated Bundle Files (May Need Manual Review)`));
    sections.push("");
    sections.push("These files contain multiple libraries concatenated into a single file. The platform has rebuilt them with updated library versions, but you should verify:");
    sections.push("");
    for (const b of concatenatedBundles) {
      const libs = (b.libraries ?? []).map((l: any) => `${l.name} v${l.version}`).join(", ");
      sections.push(bullet(`**\`${b.filePath}\`** — contains: ${libs}`));
      sections.push(bullet("Verify: Check that the rebuilt file works correctly in the browser", 1));
      sections.push(bullet("Alternative: Replace the single `<script>`/`<link>` tag with individual library references", 1));
    }
    sections.push("");
  }

  // 5. Breaking API patterns that may still exist
  if ((apiImpact as any)?.affectedFiles?.length > 0) {
    const unresolved = ((apiImpact as any).affectedFiles ?? []).filter((af: any) => (af.riskScore ?? 0) > 50);
    if (unresolved.length > 0) {
      pendingItemNumber++;
      sections.push(heading(3, `${pendingItemNumber}. High-Risk API Patterns Still in Code`));
      sections.push("");
      sections.push("These files contain deprecated/removed API patterns that may cause runtime errors:");
      sections.push("");
      for (const af of unresolved.slice(0, 15)) {
        sections.push(bullet(`**\`${af.path}\`** (risk: ${af.riskScore}/100)`));
        for (const imp of (af.impacts ?? []).slice(0, 3)) {
          sections.push(bullet(`Line ${imp.line}: \`${imp.pattern}\` — ${imp.description || "deprecated API usage"}`, 1));
          if (imp.replacement) sections.push(bullet(`Replace with: \`${imp.replacement}\``, 2));
        }
      }
      sections.push("");
    }
  }

  // 6. Skipped large files
  if (skippedFiles.length > 0) {
    pendingItemNumber++;
    sections.push(heading(3, `${pendingItemNumber}. Large Files Skipped by Platform`));
    sections.push("");
    sections.push("These files exceeded the size threshold and were not analyzed or upgraded:");
    sections.push("");
    for (const sf of skippedFiles) {
      sections.push(bullet(`**\`${sf.path}\`** — ${sf.reason}`));
      sections.push(bullet("Action: Manually review and apply necessary upgrades", 1));
    }
    sections.push("");
  }

  // 7. Environment / runtime tasks
  pendingItemNumber++;
  sections.push(heading(3, `${pendingItemNumber}. Environment & Runtime Verification`));
  sections.push("");
  sections.push("The platform upgrades source code and library files but **cannot verify your runtime environment**. Ensure:");
  sections.push("");
  if (detectedStacks.has("dotnet")) {
    const targetNet = selections.find(s => s.package.toLowerCase().includes(".net") || s.package.toLowerCase().includes("microsoft.netcore"));
    sections.push(bullet(`**.NET SDK:** Install .NET SDK ${targetNet?.selectedVersion || "matching your target version"} on your build server`));
    sections.push(bullet("**Visual Studio:** Update to a version that supports the target .NET version"));
    sections.push(bullet("**CI/CD Pipeline:** Update build agent images and SDK references in pipeline YAML"));
  }
  if (detectedStacks.has("node")) {
    sections.push(bullet("**Node.js version:** Verify `node -v` matches your `engines.node` requirement"));
    sections.push(bullet("**npm version:** Run `npm -v` and update if needed"));
    sections.push(bullet("**CI/CD Pipeline:** Update Node.js version in pipeline configuration"));
  }
  if (detectedStacks.has("java")) {
    sections.push(bullet("**JDK version:** Verify `java -version` matches your target Java version"));
    sections.push(bullet("**Maven/Gradle version:** Update build tool if required by upgraded dependencies"));
  }
  sections.push(bullet("**Docker:** If using Docker, update `FROM` base image to match the new runtime version"));
  sections.push(bullet("**Database:** Verify database schema compatibility if ORM packages were upgraded"));
  sections.push(bullet("**Third-party integrations:** Test all API integrations, webhooks, and external service calls"));
  sections.push("");

  // 8. Testing checklist
  pendingItemNumber++;
  sections.push(heading(3, `${pendingItemNumber}. Testing Checklist`));
  sections.push("");
  sections.push("After applying all changes, perform these tests:");
  sections.push("");
  sections.push(bullet("[ ] **Build succeeds** — No compilation errors"));
  sections.push(bullet("[ ] **Unit tests pass** — Run existing test suite + generated tests in `_tests/`"));
  sections.push(bullet("[ ] **UI renders correctly** — Check all pages, modals, forms, date pickers"));
  sections.push(bullet("[ ] **JavaScript console clean** — No runtime errors in browser DevTools"));
  sections.push(bullet("[ ] **CSS layout intact** — No broken layouts from Bootstrap class renames"));
  sections.push(bullet("[ ] **Forms submit correctly** — Validate all form submissions and AJAX calls"));
  sections.push(bullet("[ ] **Authentication works** — Login, logout, session timeout"));
  sections.push(bullet("[ ] **Third-party libraries load** — No 404 errors for CDN/vendor scripts"));
  sections.push(bullet("[ ] **Responsive design** — Test on mobile, tablet, desktop viewports"));
  sections.push(bullet("[ ] **Accessibility** — Screen reader, keyboard navigation still functional"));
  sections.push("");

  if (pendingItemNumber === 0) {
    sections.push("_No pending work items — all upgrades were fully automated!_");
    sections.push("");
  }

  // ── Restore Instructions ──
  sections.push(heading(2, "Restore Instructions"));
  sections.push("");

  if (detectedStacks.has("dotnet")) {
    sections.push(heading(3, ".NET"));
    sections.push("");
    sections.push("```bash");
    sections.push("# Install the LibraryManager CLI if not already installed");
    sections.push("dotnet tool install -g Microsoft.Web.LibraryManager.Cli");
    sections.push("");
    sections.push("# Restore client-side libraries from libman.json");
    sections.push("libman restore");
    sections.push("");
    sections.push("# Restore NuGet packages");
    sections.push("dotnet restore");
    sections.push("```");
    sections.push("");
  }
  if (detectedStacks.has("node")) {
    sections.push(heading(3, "Node.js"));
    sections.push("");
    sections.push("```bash");
    sections.push("npm install");
    sections.push("```");
    sections.push("");
  }
  if (detectedStacks.has("java")) {
    sections.push(heading(3, "Java"));
    sections.push("");
    sections.push("```bash");
    sections.push("mvn clean install   # Maven");
    sections.push("# or");
    sections.push("./gradlew build     # Gradle");
    sections.push("```");
    sections.push("");
  }
  if (detectedStacks.has("python")) {
    sections.push(heading(3, "Python"));
    sections.push("");
    sections.push("```bash");
    sections.push("pip install -r requirements.txt");
    sections.push("```");
    sections.push("");
  }
  if (detectedStacks.size === 0) {
    sections.push("Run the appropriate package restore command for your stack (e.g., `npm install`, `dotnet restore`, `pip install -r requirements.txt`).");
    sections.push("");
  }

  // ── Next Steps ──
  sections.push(heading(2, "Next Steps"));
  sections.push("");
  sections.push("1. **Restore packages** — Follow the restore instructions above");
  sections.push("2. **Address manual attention items** — Review the section above");
  sections.push("3. **Build the project** — Run `dotnet build` / `npm run build` to verify compilation");
  sections.push("4. **Run generated tests** — Test scripts are in the `_tests/` folder of the output");
  sections.push("5. **Manual testing** — Test UI flows, API endpoints, and integration points");
  sections.push("");

  const report = sections.join("\n");
  console.log(`[MigrationReportGenerator] Generated report: ${report.length} chars, ${modifiedFiles.length} files, ${selections.length} selections, score ${score}%`);
  return report;
}
