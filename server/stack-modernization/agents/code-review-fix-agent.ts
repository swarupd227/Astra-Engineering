/**
 * Code Review & Fix Agent
 *
 * Sits between consistency_validation and test_generation.
 * Performs two-layer validation:
 *
 * Layer 1 — Deterministic checks (fast, no LLM):
 *   - Import/using statements reference packages that actually exist in the target version
 *   - No dangling references to removed APIs (cross-checked with migration docs)
 *   - Configuration files have matching versions
 *   - Files in coupling groups are internally consistent
 *
 * Layer 2 — LLM-assisted review (focused, per-file):
 *   - Scans each modified file with its original + migration context
 *   - Detects semantic issues the deterministic layer can't catch
 *   - Produces targeted fixes
 *
 * Output: updated modifiedFiles + CodeReviewReport on state
 */

import type {
  StackModernizationState,
  CodeReviewIssue,
  CodeReviewReport,
  VersionSelection,
} from "../types";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";

// ── Layer 1: Deterministic Checks ───────────────────────────────

function runDeterministicChecks(state: StackModernizationState): CodeReviewIssue[] {
  const issues: CodeReviewIssue[] = [];
  const modifiedFiles = state.modifiedFiles ?? [];
  const selections = state.userSelections ?? [];
  const migrationDocs = state.migrationDocs ?? {};

  const removedAPIs = new Set<string>();
  for (const [, doc] of Object.entries(migrationDocs)) {
    if (!doc.found) continue;
    for (const api of doc.removedAPIs) {
      const key = api.split("(")[0].split(" ")[0].replace(/^\./, "").trim().toLowerCase();
      if (key.length > 2) removedAPIs.add(key);
    }
  }

  for (const mf of modifiedFiles) {
    const filePath = (mf as any).path || (mf as any).filePath || "";
    const content = ((mf as any).content || "").toLowerCase();
    if (!filePath || !content) continue;

    // Check for removed API usage in upgraded code
    for (const api of removedAPIs) {
      if (content.includes(api)) {
        issues.push({
          file: filePath,
          issue: `Removed API "${api}" still present in upgraded code`,
          severity: "critical",
          category: "api-misuse",
          fixed: false,
        });
      }
    }

    // Check for version mismatches in the same file
    for (const sel of selections) {
      const currentMajor = sel.currentVersion?.split(".")[0] || "";
      const targetMajor = sel.selectedVersion.split(".")[0];
      const pkgLower = sel.package.toLowerCase();

      if (!content.includes(pkgLower)) continue;

      // Detect leftover old version references in manifest-like files
      const isManifest = filePath.endsWith(".json") || filePath.endsWith(".csproj") ||
        filePath.endsWith(".xml") || filePath.endsWith(".toml") || filePath.endsWith(".cfg");
      if (isManifest && currentMajor) {
        const oldVersionPattern = new RegExp(
          `${sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d]*${currentMajor}\\.`,
          "i"
        );
        const rawContent = (mf as any).content || "";
        if (oldVersionPattern.test(rawContent)) {
          issues.push({
            file: filePath,
            issue: `Old version ${sel.currentVersion} of ${sel.package} still referenced (should be ${sel.selectedVersion})`,
            severity: "critical",
            category: "incomplete-upgrade",
            fixed: false,
          });
        }
      }
    }

    // Check for mixed import styles (e.g., javax + jakarta in same file)
    if (content.includes("javax.") && content.includes("jakarta.")) {
      issues.push({
        file: filePath,
        issue: "Mixed javax.* and jakarta.* imports — should be fully migrated to jakarta.*",
        severity: "critical",
        category: "import-mismatch",
        fixed: false,
      });
    }

    // Check for dangling Bootstrap 4 patterns in files that also have BS5 patterns
    if (content.includes("data-bs-") && content.includes("data-toggle")) {
      issues.push({
        file: filePath,
        issue: "Mixed Bootstrap 4 (data-toggle) and Bootstrap 5 (data-bs-) attributes",
        severity: "critical",
        category: "incomplete-upgrade",
        fixed: false,
      });
    }
  }

  return issues;
}

// ── Layer 2: LLM-Assisted Review ────────────────────────────────

async function runLLMReview(
  state: StackModernizationState,
  deterministicIssues: CodeReviewIssue[],
): Promise<{ issues: CodeReviewIssue[]; fixedFiles: Map<string, string> }> {
  const modifiedFiles = state.modifiedFiles ?? [];
  const selections = state.userSelections ?? [];

  if (modifiedFiles.length === 0 || selections.length === 0) {
    return { issues: [], fixedFiles: new Map() };
  }

  const { client, model } = getLLMClient(state.llmProvider);
  const issues: CodeReviewIssue[] = [];
  const fixedFiles = new Map<string, string>();

  // Only review files with deterministic issues OR high-risk files
  const deterministicFilePaths = new Set(deterministicIssues.map(i => i.file));
  const impactFilePaths = new Set(
    (state.impactReport?.affectedFiles ?? [])
      .filter(f => f.riskScore >= 5)
      .map(f => f.path)
  );

  const filesToReview = modifiedFiles.filter((mf: any) => {
    const fp = mf.path || mf.filePath || "";
    return deterministicFilePaths.has(fp) || impactFilePaths.has(fp);
  });

  // If no high-risk files, review up to 10 modified files (sorted by size desc)
  const reviewTargets = filesToReview.length > 0
    ? filesToReview.slice(0, 15)
    : [...modifiedFiles]
        .sort((a: any, b: any) => ((b.content || "").length) - ((a.content || "").length))
        .slice(0, 10);

  const versionContext = selections.map(s => `${s.package}: ${s.currentVersion} → ${s.selectedVersion}`).join("\n");

  // Consistency report context
  const consistencyContext = state.consistencyReport
    ? `\nConsistency validation found ${state.consistencyReport.violations.length} issues, auto-fixed ${state.consistencyReport.autoFixed}.`
    : "";

  const CONCURRENCY = 3;
  for (let i = 0; i < reviewTargets.length; i += CONCURRENCY) {
    const batch = reviewTargets.slice(i, i + CONCURRENCY);

    const batchPromises = batch.map(async (mf: any) => {
      const filePath = mf.path || mf.filePath || "";
      const content = mf.content || "";
      const originalContent = mf.originalContent || "";

      if (!filePath || content.length < 30) return;

      const fileIssues = deterministicIssues.filter(di => di.file === filePath);
      const knownIssuesText = fileIssues.length > 0
        ? `\nKNOWN ISSUES IN THIS FILE (fix these):\n${fileIssues.map(i => `- [${i.severity}] ${i.issue}`).join("\n")}`
        : "";

      const { sanitizeForContentFilter } = await import("../services/prompt-sanitizer");
      const truncatedContent = sanitizeForContentFilter(content.slice(0, 10000), "standard");
      const truncatedOriginal = originalContent
        ? sanitizeForContentFilter(originalContent.slice(0, 5000), "standard")
        : "";
      const originalSection = truncatedOriginal ? `\nORIGINAL (before upgrade):\n\`\`\`\n${truncatedOriginal}\n\`\`\`` : "";

      try {
        const budgetBlock = buildBudgetConstraint("codeReviewFix", "code");
        const response = await trackedLLMCall(client, {
          model,
          messages: [
            {
              role: "system",
              content: `${budgetBlock}\n\nYou are a senior code reviewer validating upgraded code. Check for:
1. Import/using statements that reference APIs removed in the target version
2. API calls using old signatures that changed in the target version
3. Configuration mismatches (old version config with new version code)
4. Logic errors introduced by the upgrade (e.g., changed default behavior)
5. Incomplete upgrades (some patterns updated, others missed in the same file)
${consistencyContext}

VERSION UPGRADES:
${versionContext}

RESPONSE FORMAT — return ONLY valid JSON:
{
  "issues": [
    { "issue": "description", "severity": "critical|warning|info", "category": "import-mismatch|api-misuse|type-error|missing-config|logic-error|incomplete-upgrade" }
  ],
  "fixedContent": "full corrected file content OR null if no fixes needed",
  "fixSummary": "what was fixed (or null)"
}`
            },
            {
              role: "user",
              content: `Review this upgraded file:\n\nFILE: ${filePath}${knownIssuesText}${originalSection}\n\nUPGRADED CODE:\n\`\`\`\n${truncatedContent}\n\`\`\``,
            },
          ],
          temperature: 0,
          max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.codeReviewFix, model),
        }, { analysisId: state.analysisId, phase: "execution", agent: "CodeReviewFix" });

        let responseText = response.choices[0]?.message?.content?.trim() || "";
        if (responseText.startsWith("```json")) {
          responseText = responseText.replace(/^```json\n?/, "").replace(/\n?```\s*$/, "");
        } else if (responseText.startsWith("```")) {
          responseText = responseText.replace(/^```\n?/, "").replace(/\n?```\s*$/, "");
        }

        const parsed = JSON.parse(responseText);
        if (parsed.issues && Array.isArray(parsed.issues)) {
          for (const iss of parsed.issues) {
            issues.push({
              file: filePath,
              issue: iss.issue || "Unknown issue",
              severity: iss.severity || "warning",
              category: iss.category || "logic-error",
              fixed: !!parsed.fixedContent,
              fixDescription: parsed.fixSummary || undefined,
            });
          }
        }

        if (parsed.fixedContent && typeof parsed.fixedContent === "string" && parsed.fixedContent.length > 30) {
          fixedFiles.set(filePath, parsed.fixedContent);
        }
      } catch (err) {
        console.warn(`[CodeReviewAgent] LLM review failed for ${filePath}:`, err instanceof Error ? err.message : err);
      }
    });

    await Promise.all(batchPromises);
  }

  return { issues, fixedFiles };
}

// ── Post-review version enforcement ─────────────────────────────
// After LLM review fixes, re-enforce user-selected versions to prevent
// the LLM from re-introducing wrong version numbers.

function enforceVersionsPostReview(content: string, filePath: string, selections: VersionSelection[]): string {
  let result = content;
  const lower = filePath.toLowerCase();
  const baseName = (filePath.split(/[\\/]/).pop() || "").toLowerCase();

  for (const sel of selections) {
    const pkg = (sel.package || "").toLowerCase();
    const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
    if (!targetVer) continue;

    // .NET TargetFramework
    if ((pkg.includes(".net") || pkg.includes("dotnet") || pkg === "dotnet") &&
        (lower.endsWith(".csproj") || lower.endsWith(".fsproj") || lower.endsWith(".vbproj"))) {
      const major = parseInt(targetVer.split(".")[0], 10);
      if (major >= 5) {
        const tfm = `net${major}.0`;
        result = result.replace(/<TargetFramework>\s*net[^<]*<\/TargetFramework>/gi,
          `<TargetFramework>${tfm}</TargetFramework>`);
      }
    }

    // NuGet PackageReference
    if ((lower.endsWith(".csproj") || lower.endsWith(".fsproj") || lower.endsWith(".vbproj")) &&
        sel.category !== "framework") {
      const ePkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(
        new RegExp(`(<PackageReference\\s+Include="${ePkg}"\\s+Version=")[^"]+(")`, "gi"),
        `$1${targetVer}$2`
      );
    }

    // package.json dependencies
    if (lower.endsWith("package.json") && pkg !== "node" && pkg !== "nodejs") {
      try {
        const parsed = JSON.parse(result);
        let changed = false;
        const normPkg = pkg.replace(/[-_.@\s/]/g, "");
        for (const section of ["dependencies", "devDependencies"]) {
          if (!parsed[section]) continue;
          for (const depName of Object.keys(parsed[section])) {
            const normDep = depName.toLowerCase().replace(/[-_.@\s/]/g, "");
            if (normDep === normPkg || normDep.includes(normPkg) || normPkg.includes(normDep)) {
              const currentVer = String(parsed[section][depName]).replace(/^[\^~>=<\s]+/, "");
              if (currentVer !== targetVer) {
                const prefix = String(parsed[section][depName]).match(/^([\^~])/)?.[1] || "^";
                parsed[section][depName] = `${prefix}${targetVer}`;
                changed = true;
              }
            }
          }
        }
        if (changed) result = JSON.stringify(parsed, null, 2);
      } catch { /* non-fatal */ }
    }

    // pom.xml dependency versions
    if (lower.endsWith("pom.xml")) {
      const ePkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(
        new RegExp(`(<dependency>[\\s\\S]*?<artifactId>\\s*${ePkg}\\s*<\\/artifactId>[\\s\\S]*?<version>)[^<]+(</version>)`, "gi"),
        `$1${targetVer}$2`
      );
      if (pkg.includes("java") || pkg === "jdk" || pkg === "openjdk") {
        result = result.replace(/<java\.version>\d+<\/java\.version>/g,
          `<java.version>${targetVer.split(".")[0]}</java.version>`);
      }
    }

    // requirements.txt
    if (lower.match(/requirements.*\.txt$/)) {
      const ePkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(
        new RegExp(`^(${ePkg}\\s*(?:==|>=|~=|<=|!=)\\s*)([\\d][\\w.\\-]*)`, "gmi"),
        `$1${targetVer}`
      );
    }

    // Gemfile
    if (baseName === "gemfile") {
      const ePkg = sel.package.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(
        new RegExp(`(gem\\s+['"]${ePkg}['"]\\s*,\\s*['"][~>=<]*\\s*)([\\d][\\w.\\-]*)`, "gi"),
        `$1${targetVer}`
      );
    }

    // libman.json
    if (baseName === "libman.json") {
      try {
        const parsed = JSON.parse(result);
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
          if (changed) result = JSON.stringify(parsed, null, 2);
        }
      } catch { /* non-fatal */ }
    }
  }

  return result;
}

// ── Main Entry Point ────────────────────────────────────────────

export async function executeCodeReviewFixAgent(
  state: StackModernizationState,
): Promise<StackModernizationState> {
  const modifiedFiles = state.modifiedFiles ?? [];
  const selections = state.userSelections ?? [];
  if (modifiedFiles.length === 0) {
    return {
      ...state,
      codeReviewReport: {
        filesReviewed: 0,
        issuesFound: 0,
        issuesFixed: 0,
        issuesRemaining: 0,
        issues: [],
      },
    };
  }

  console.log(`[CodeReviewAgent] Reviewing ${modifiedFiles.length} modified files...`);

  // Layer 1: Deterministic checks
  const deterministicIssues = runDeterministicChecks(state);
  console.log(`[CodeReviewAgent] Layer 1 (deterministic): ${deterministicIssues.length} issues found`);

  // Layer 2: LLM-assisted review
  const { issues: llmIssues, fixedFiles } = await runLLMReview(state, deterministicIssues);
  console.log(`[CodeReviewAgent] Layer 2 (LLM review): ${llmIssues.length} issues found, ${fixedFiles.size} files fixed`);

  // Apply fixes to modifiedFiles, then re-enforce user-selected versions
  // (the LLM review pass may have re-introduced wrong versions)
  const updatedModifiedFiles = modifiedFiles.map((mf: any) => {
    const fp = mf.path || mf.filePath || "";
    let content = fixedFiles.has(fp) ? fixedFiles.get(fp)! : mf.content;

    // Re-enforce versions for files the LLM touched
    if (fixedFiles.has(fp) && selections.length > 0) {
      content = enforceVersionsPostReview(content, fp, selections);
    }

    if (content !== mf.content) {
      return { ...mf, content };
    }
    return mf;
  });

  // Merge issue lists, mark deterministic issues as fixed if the LLM fixed the file
  const allIssues: CodeReviewIssue[] = [];
  for (const di of deterministicIssues) {
    allIssues.push({
      ...di,
      fixed: fixedFiles.has(di.file),
      fixDescription: fixedFiles.has(di.file) ? "Auto-fixed by LLM review pass" : undefined,
    });
  }
  for (const li of llmIssues) {
    allIssues.push(li);
  }

  const issuesFixed = allIssues.filter(i => i.fixed).length;
  const report: CodeReviewReport = {
    filesReviewed: modifiedFiles.length,
    issuesFound: allIssues.length,
    issuesFixed,
    issuesRemaining: allIssues.length - issuesFixed,
    issues: allIssues,
  };

  console.log(`[CodeReviewAgent] Report: ${report.issuesFound} found, ${report.issuesFixed} fixed, ${report.issuesRemaining} remaining`);

  return {
    ...state,
    modifiedFiles: updatedModifiedFiles,
    codeReviewReport: report,
  };
}
