/**
 * Stack Modernization - Assessment Agent
 * Orchestrates all assessment sub-agents with partial state updates.
 * Each sub-agent completes independently and the frontend receives
 * real-time card updates via progress polling.
 *
 * Sub-agents:
 * 1. Stack Detection (repo-profiler)
 * 2. Dependency Analysis (dependency-graph)
 * 3. Version Intelligence
 * 4. Security Assessment
 * 5. Code Quality
 * 6. Breaking Changes Preview
 * 7. Database Dependencies
 * 8. Requirements Analysis
 */

import type {
  StackModernizationState,
  AssessmentSubAgentStatus,
} from "../types";
import { getLLMClient } from "../services/llm-selector";
import { executeRepoProfilerAgent } from "./repo-profiler-agent";
import { executeDependencyGraphAgent } from "./dependency-graph-agent";
import { executeVersionIntelligenceAgent } from "./version-intelligence-agent";
import { executeSecurityAssessmentAgent } from "./security-assessment-agent";
import { executeCodeQualityAgent } from "./code-quality-agent";
import { executeBreakingChangesPreviewAgent } from "./breaking-changes-agent";
import { executeDatabaseDependencyAgent } from "./database-dependency-agent";
import { executeRequirementsAgent } from "./requirements-agent";
import {
  ASSESSMENT_SYSTEM_PROMPT,
  buildAssessmentMarkdownPrompt,
} from "../prompts/assessment-prompts";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";

function initSubAgentStatus(): AssessmentSubAgentStatus {
  return {
    stackDetection: "pending",
    dependencyAnalysis: "pending",
    versionIntelligence: "pending",
    securityAssessment: "pending",
    codeQuality: "pending",
    breakingChangesPreview: "pending",
    databaseDependencies: "pending",
    requirementsAnalysis: "pending",
  };
}

/**
 * Persist partial state so the progress API can serve live updates.
 */
async function persistState(state: StackModernizationState): Promise<void> {
  try {
    const { stateStore } = await import("../services/state-store");
    stateStore.save(state);
  } catch { /* non-critical */ }
}

/**
 * Execute complete assessment phase with all 8 sub-agents
 */
export async function executeAssessmentAgent(
  state: StackModernizationState
): Promise<StackModernizationState> {

  let s = { ...state, assessmentSubAgentStatus: initSubAgentStatus() };
  await persistState(s);

  const assessmentT0 = Date.now();

  try {
    // --- 1. Stack Detection (repo profiler) ---
    s.assessmentSubAgentStatus!.stackDetection = "running";
    s.currentStage = "Stack detection...";
    await persistState(s);
    const t1 = Date.now();
    s = await executeRepoProfilerAgent(s);
    console.log(`[Assessment] Stack detection completed in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    s.assessmentSubAgentStatus!.stackDetection = "completed";
    s.progress = 8;
    await persistState(s);

    // --- 2. Dependency Analysis ---
    s.assessmentSubAgentStatus!.dependencyAnalysis = "running";
    s.currentStage = "Dependency analysis...";
    await persistState(s);
    const t2 = Date.now();
    s = await executeDependencyGraphAgent(s);
    console.log(`[Assessment] Dependency analysis completed in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
    s.assessmentSubAgentStatus!.dependencyAnalysis = "completed";
    s.progress = 16;
    await persistState(s);

    // --- 3. Version Intelligence ---
    s.assessmentSubAgentStatus!.versionIntelligence = "running";
    s.currentStage = "Version intelligence...";
    await persistState(s);
    const t3 = Date.now();
    s = await executeVersionIntelligenceAgent(s);
    console.log(`[Assessment] Version intelligence completed in ${((Date.now() - t3) / 1000).toFixed(1)}s`);
    s.assessmentSubAgentStatus!.versionIntelligence = "completed";
    s.progress = 24;
    await persistState(s);

    // --- Run remaining 5 sub-agents in parallel for speed ---
    s.assessmentSubAgentStatus!.securityAssessment = "running";
    s.assessmentSubAgentStatus!.codeQuality = "running";
    s.assessmentSubAgentStatus!.breakingChangesPreview = "running";
    s.assessmentSubAgentStatus!.databaseDependencies = "running";
    s.assessmentSubAgentStatus!.requirementsAnalysis = "running";
    s.currentStage = "Running detailed assessments...";
    await persistState(s);

    const t4 = Date.now();
    const [securityResult, codeQualityResult, breakingResult, dbResult, reqResult] =
      await Promise.allSettled([
        executeSecurityAssessmentAgent(s),
        executeCodeQualityAgent(s),
        executeBreakingChangesPreviewAgent(s),
        executeDatabaseDependencyAgent(s),
        executeRequirementsAgent(s),
      ]);
    console.log(`[Assessment] Parallel sub-agents completed in ${((Date.now() - t4) / 1000).toFixed(1)}s`);

    // --- 4. Security ---
    if (securityResult.status === "fulfilled") {
      s.securityAssessment = securityResult.value;
      s.assessmentSubAgentStatus!.securityAssessment = "completed";
    } else {
      console.warn("[Assessment] Security assessment failed:", securityResult.reason);
      s.assessmentSubAgentStatus!.securityAssessment = "failed";
    }
    s.progress = 32;
    await persistState(s);

    // --- 5. Code Quality ---
    if (codeQualityResult.status === "fulfilled") {
      s.codeQuality = codeQualityResult.value;
      s.assessmentSubAgentStatus!.codeQuality = "completed";
    } else {
      console.warn("[Assessment] Code quality failed:", codeQualityResult.reason);
      s.assessmentSubAgentStatus!.codeQuality = "failed";
    }
    s.progress = 36;
    await persistState(s);

    // --- 6. Breaking Changes Preview ---
    if (breakingResult.status === "fulfilled") {
      s.breakingChangesPreview = breakingResult.value;
      s.assessmentSubAgentStatus!.breakingChangesPreview = "completed";
    } else {
      console.warn("[Assessment] Breaking changes failed:", breakingResult.reason);
      s.assessmentSubAgentStatus!.breakingChangesPreview = "failed";
    }
    s.progress = 38;
    await persistState(s);

    // --- 7. Database Dependencies ---
    if (dbResult.status === "fulfilled") {
      s.databaseDependencies = dbResult.value;
      s.assessmentSubAgentStatus!.databaseDependencies = "completed";
    } else {
      console.warn("[Assessment] DB dependency failed:", dbResult.reason);
      s.assessmentSubAgentStatus!.databaseDependencies = "failed";
    }
    s.progress = 39;
    await persistState(s);

    // --- 8. Requirements ---
    if (reqResult.status === "fulfilled") {
      s.requirementsAnalysis = reqResult.value;
      s.assessmentSubAgentStatus!.requirementsAnalysis = "completed";
    } else {
      console.warn("[Assessment] Requirements failed:", reqResult.reason);
      s.assessmentSubAgentStatus!.requirementsAnalysis = "failed";
    }
    s.progress = 40;
    await persistState(s);

    // Build structural models for scope-limited upgrade
    const t5 = Date.now();
    const { buildRepositoryTree } = await import("../services/repository-tree-builder");
    const { buildImportGraph } = await import("../services/import-graph-builder");
    const { buildFileIntelligenceMap } = await import("../services/file-intelligence");
    s.repositoryTree = buildRepositoryTree(s.extractedFiles ?? []);
    s.importGraph = buildImportGraph((s.extractedFiles ?? []) as import("../types").ExtractedFile[]);

    const intelMap = buildFileIntelligenceMap((s.extractedFiles ?? []) as import("../types").ExtractedFile[]);
    s.fileIntelligence = Object.fromEntries(intelMap);

    const { parseFiles } = await import("../services/ast-parser");
    const astMap = parseFiles((s.extractedFiles ?? []).map(f => ({ relativePath: f.relativePath, content: f.content })));
    s.astAnalysis = Object.fromEntries(astMap);
    console.log(`[Assessment] Structural analysis (tree + imports + intel + AST) completed in ${((Date.now() - t5) / 1000).toFixed(1)}s (${s.extractedFiles?.length ?? 0} files)`);

    const t6 = Date.now();
    const assessmentMarkdown = await generateAssessmentMarkdown(s);
    console.log(`[Assessment] Markdown generation completed in ${((Date.now() - t6) / 1000).toFixed(1)}s`);
    console.log(`[Assessment] TOTAL assessment phase: ${((Date.now() - assessmentT0) / 1000).toFixed(1)}s`);

    // Generate pre-filled version recommendations text
    const versionRecommendationsText = generateVersionRecommendationsText(s);

    const finalState: StackModernizationState = {
      ...s,
      assessmentMarkdown,
      versionRecommendationsText,
      currentStage: "awaiting_user_selection",
      status: "in_progress",
    };

    return finalState;
  } catch (error) {
    console.error("[Assessment] Error:", error);
    throw error;
  }
}

/**
 * Generate comprehensive assessment.md using LLM with all sub-agent data + code files.
 * Falls back to a factual-only template if LLM fails.
 */
async function generateAssessmentMarkdown(state: StackModernizationState): Promise<string> {
  try {
    const { client, model } = getLLMClient(state.llmProvider);
    const prompt = buildAssessmentMarkdownPrompt(state, model);

    const selections = state.userSelections || [];
    const versionReminder = selections.length > 0
      ? `\n\nVersion guidance: The user selected these target versions. Use them as stated:\n${selections.map(s => `  - ${s.package}: ${s.currentVersion} -> ${s.selectedVersion}`).join("\n")}`
      : "";

    const budgetBlock = buildBudgetConstraint("assessment", "markdown");
    const response = await trackedLLMCall(client, {
      model,
      messages: [
        { role: "system", content: `${budgetBlock}\n\n${ASSESSMENT_SYSTEM_PROMPT}\n\nYou generate comprehensive MARKDOWN assessment reports. Be thorough, specific, and reference the actual data and code files provided. Never invent data.${versionReminder}` },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.assessment, model),
    }, { analysisId: state.analysisId, phase: "assessment", agent: "Assessment" });

    const llmMarkdown = response.choices[0]?.message?.content?.trim() || "";
    if (llmMarkdown.length > 200) {
      return `# Stack Modernization Assessment\n\n*Generated on: ${new Date().toISOString()}*\n\n${llmMarkdown}\n\n---\n*Generated by DevX Stack Modernization Agent v2.0*`;
    }
    throw new Error("LLM returned insufficient content");
  } catch (error) {
    console.warn("[Assessment] LLM markdown generation failed, using factual fallback:", error instanceof Error ? error.message : error);
    return generateAssessmentMarkdownFallback(state);
  }
}

function generateAssessmentMarkdownFallback(state: StackModernizationState): string {
  const repoProfile = state.repoProfile;
  const depGraph = state.dependencyGraph;
  const versionInt = state.versionIntelligence || [];
  
  // Count metrics
  const totalDeps = (depGraph?.directDependencies?.length || 0) + (depGraph?.transitiveDependencies?.length || 0);
  const directDeps = depGraph?.directDependencies?.length || 0;
  const criticalDeps = versionInt.filter(v => v.riskLevel === "high").length;
  
  // Security vulnerabilities (if any field exists)
  const securityIssues: Array<{package: string; issues: any[]}> = []; // Placeholder - VersionRecommendation doesn't have securityVulnerabilities
  
  const markdown = `# Stack Modernization Assessment

Generated on: ${new Date().toISOString()}

---

## 📊 Executive Summary

### Project Overview
- **Primary Runtime**: ${repoProfile?.runtimeInfo?.[0]?.language || "Unknown"} ${repoProfile?.runtimeInfo?.[0]?.version || ""}
- **Project Type**: ${repoProfile?.projectType || "Unknown"}
- **Primary Language**: ${repoProfile?.languages?.[0] || "Unknown"}
- **Total Lines of Code**: N/A
- **Total Files**: ${repoProfile?.fileStructure?.totalFiles || "N/A"}

### High-Level Metrics
- **Total Dependencies**: ${totalDeps}
- **Direct Dependencies**: ${directDeps}
- **Transitive Dependencies**: ${totalDeps - directDeps}
- **Critical Upgrades Required**: ${criticalDeps}
- **Security Vulnerabilities**: ${securityIssues.length > 0 ? securityIssues.reduce((sum, s) => sum + s.issues!.length, 0) : 0}

---

## 🏗️ Project Structure Analysis

### Detected Frameworks
${repoProfile?.frameworks && repoProfile.frameworks.length > 0 
  ? repoProfile.frameworks.map((f: any) => `- **${f.name}** (${f.version || "version unknown"})`).join("\n")
  : "- No frameworks detected"}

### Build Tools
- No build tool information available in current schema

### Project Manifest Files
${repoProfile?.packageManifests && repoProfile.packageManifests.length > 0
  ? repoProfile.packageManifests.map((m: any) => `- \`${m.type}\` at \`${m.path}\``).join("\n")
  : "- No manifest files found"}

---

## 📦 Dependency Graph Overview

### Dependency Tree Structure
\`\`\`
Root Dependencies: ${directDeps}
├── Level 1 (Direct): ${directDeps}
└── Level 2+ (Transitive): ${depGraph?.transitiveDependencies?.length || 0}
\`\`\`

### High-Risk Dependencies
${versionInt.filter(v => v.riskLevel === "high").length > 0
  ? versionInt.filter(v => v.riskLevel === "high").map(v => 
      `- **${v.package}** (${v.currentVersion})\n  - Risk: ${v.riskLevel}\n  - Reason: ${v.reasoning || "Requires upgrade"}`
    ).join("\n")
  : "- No high-risk dependencies detected"}

---

## 🔒 Security Assessment

${state.securityAssessment
  ? `**Security Health Score**: ${state.securityAssessment.score}/100

| Severity | Count |
|----------|-------|
| Critical | ${state.securityAssessment.critical} |
| High | ${state.securityAssessment.high} |
| Medium | ${state.securityAssessment.medium} |
| Low | ${state.securityAssessment.low} |
| Total Vulnerabilities | ${state.securityAssessment.totalVulnerabilities} |

${state.securityAssessment.cves.length > 0
  ? state.securityAssessment.cves.slice(0, 10).map(c => `- **${c.severity.toUpperCase()}** [${c.id}] ${c.package}: ${c.title}${c.fixedIn ? ` (fix: ${c.fixedIn})` : ""}`).join("\n")
  : ""}
${state.securityAssessment.advisories.length > 0
  ? "\n### Code Security Advisories\n" + state.securityAssessment.advisories.slice(0, 10).map(a => `- ${a}`).join("\n")
  : ""}`
  : "✅ Security assessment not yet completed."}

---

## 🎯 Recommended Target Versions

${versionInt && versionInt.length > 0
  ? versionInt.map(v => `### ${v.package}
- **Current Version**: ${v.currentVersion}
- **Recommended Version**: ${v.recommended} ${v.latestLTS ? "🏆 **LTS**" : ""}
- **Latest Version**: ${v.latestStable || "Unknown"}
- **Risk Level**: ${v.riskLevel}
- **Rationale**: ${v.reasoning || "Upgrade recommended"}
`).join("\n")
  : "- No version recommendations available"}

---

## 🧹 Code Quality

${state.codeQuality
  ? `**Quality Score**: ${state.codeQuality.qualityScore}/100 | **Maintainability**: ${state.codeQuality.maintainabilityIndex}/100

| Metric | Value |
|--------|-------|
| Lines of Code | ${state.codeQuality.complexityMetrics.linesOfCode} |
| Avg Cyclomatic Complexity | ${state.codeQuality.complexityMetrics.averageCyclomaticComplexity} |
| Max Cyclomatic Complexity | ${state.codeQuality.complexityMetrics.maxCyclomaticComplexity} |
| Duplicate Code | ${state.codeQuality.complexityMetrics.duplicateCodePercentage}% |
| Test Coverage | ${state.codeQuality.patterns.testCoverage} |

${state.codeQuality.debtItems.length > 0
  ? "### Tech Debt Items\n" + state.codeQuality.debtItems.slice(0, 8).map(d => `- **[${d.severity.toUpperCase()}]** ${d.description} (${d.file})`).join("\n")
  : ""}`
  : "Code quality assessment not completed."}

---

## 🗄️ Database Dependencies

${state.databaseDependencies
  ? `${state.databaseDependencies.databases.length > 0
  ? "**Databases Detected:**\n" + state.databaseDependencies.databases.map(d => `- ${d.type} (from ${d.detectedFrom})`).join("\n")
  : "No databases detected."}

${state.databaseDependencies.orms.length > 0
  ? "\n**ORMs:**\n" + state.databaseDependencies.orms.map(o => `- ${o.name}${o.version ? ` v${o.version}` : ""}`).join("\n")
  : ""}

- **Migration Files**: ${state.databaseDependencies.migrationFiles.length}
- **Connection Strings**: ${state.databaseDependencies.connectionStrings}`
  : "Database dependency analysis not completed."}

---

## ⚠️ Breaking Changes Overview

${state.breakingChangesPreview && state.breakingChangesPreview.totalBreakingChanges > 0
  ? `**Total Potential Breaking Changes**: ${state.breakingChangesPreview.totalBreakingChanges}

| Severity | Count |
|----------|-------|
| Critical | ${state.breakingChangesPreview.severityDistribution.critical} |
| Major | ${state.breakingChangesPreview.severityDistribution.major} |
| Minor | ${state.breakingChangesPreview.severityDistribution.minor} |

${state.breakingChangesPreview.byPackage.map(b => `### ${b.package} (${b.currentVersion} → ${b.latestVersion})
- **Breaking Changes**: ${b.breakingChangesCount} (${b.severity})
${b.highlights.map(h => `  - ${h}`).join("\n")}`).join("\n\n")}`
  : "No breaking changes detected at this stage. Detailed analysis after version selection."}

---

## 📈 Upgrade Scope Assessment

### Estimated Impact
- **Files Likely to Change**: ${Math.ceil((repoProfile?.fileStructure?.totalFiles || 0) * 0.3)} (estimated ~30%)
- **API Compatibility Issues**: Detailed analysis after version selection
- **Dependency Updates Required**: ${versionInt.length}
- **Estimated Effort**: ${versionInt.length > 10 ? "High" : versionInt.length > 5 ? "Medium" : "Low"} (${versionInt.length} packages, ${criticalDeps} critical)

### Upgrade Complexity
${criticalDeps > 3 ? "⚠️ **High Complexity** — Multiple critical upgrades with potential breaking changes. Recommend incremental approach." : criticalDeps > 0 ? "🔶 **Medium Complexity** — Some critical upgrades required. Plan for testing." : "✅ **Low Complexity** — Routine upgrades with minimal risk."}

---

## 🛠️ Next Steps

1. **Review Assessment**: Carefully review the breaking changes and security vulnerabilities above
2. **Select Target Versions**: Modify the pre-filled version recommendations if needed
3. **Proceed to Planning**: Click "Continue to Planning" to generate detailed upgrade plan
4. **Review Plan**: Detailed compatibility analysis and migration strategies will be provided
5. **Execute Upgrade**: Automated task-based execution with verification steps

---

## 📝 Notes

- This assessment is based on static code analysis and dependency inspection
- Actual upgrade effort may vary based on code complexity and custom implementations
- Security vulnerabilities should be addressed immediately regardless of upgrade timeline
- Consider testing in a staging environment before production deployment

---

*Generated by DevX Stack Modernization Agent v2.0*
`;

  return markdown;
}

/** Normalize version string for same/different comparison (trim + lowercase). */
function normalizeVersionForCompare(v: string | undefined | null): string {
  return (v ?? "").toString().trim().toLowerCase();
}

/**
 * Generate pre-filled version recommendations text (editable by user)
 * When current === target, shows "No upgrade needed" so user knows not to proceed without changes.
 */
function generateVersionRecommendationsText(state: StackModernizationState): string {
  const versionInt = state.versionIntelligence || [];
  
  if (versionInt.length === 0) {
    return "No version recommendations available. Please check your project structure.";
  }
  
  const lines: string[] = [
    "# Target Version Selection",
    "",
    "Review and modify the recommended target versions below. Only packages with a different target than current will be upgraded.",
    ""
  ];
  
  for (const rec of versionInt) {
    const currentNorm = normalizeVersionForCompare(rec.currentVersion);
    const targetNorm = normalizeVersionForCompare(rec.recommended);
    const noUpgradeNeeded = currentNorm && targetNorm && currentNorm === targetNorm;

    lines.push(`## ${rec.package}`);
    lines.push(`Current: ${rec.currentVersion}`);
    if (noUpgradeNeeded) {
      lines.push(`Target: ${rec.recommended} (no upgrade needed)`);
    } else {
      lines.push(`Target: ${rec.recommended} ${rec.latestLTS ? "(LTS)" : ""}`);
    }
    lines.push(`Risk: ${rec.riskLevel}`);
    if (rec.reasoning) {
      lines.push(`Reason: ${rec.reasoning}`);
    }
    lines.push("");
  }
  
  lines.push("---");
  lines.push("");
  lines.push("💡 **Tip**: Change at least one target to a version different from current to run an upgrade. If all targets match current, 'Continue to Planning' will not be allowed.");
  lines.push("Once ready, click 'Continue to Planning' to proceed.");
  
  return lines.join("\n");
}

