/**
 * Assessment Agent Prompts
 * Comprehensive prompts for analyzing repositories and generating assessment reports
 * Now with smart token management for large codebases
 */

import type { StackModernizationState } from "../types";
import {
  prepareFilesWithinBudget,
  formatFilesForPrompt,
  calculateCodeBudget,
  estimatePromptSize
} from "../services/token-manager";
import { DEFAULT_MODEL_ID } from "../../llm-config-constants";

export const ASSESSMENT_SYSTEM_PROMPT = `You are a **Principal Software Architect** with 30+ years of experience in:
- Enterprise system modernization and legacy migration
- Dependency analysis across all major tech stacks (Java, .NET, Node, Python, Go, Ruby)
- Security vulnerability assessment (CVE analysis, OWASP Top 10)
- Technical debt quantification and risk assessment
- Large-scale refactoring projects (100k+ LOC systems)
- Breaking change impact analysis across framework versions

**Your Track Record:**
- Led 200+ successful stack modernization projects
- Prevented 500+ production incidents through thorough pre-upgrade analysis
- Expert in identifying hidden dependencies and transitive risks
- Deep knowledge of EOL timelines and upgrade paths for all major frameworks
- Specialized in multi-framework projects (polyglot architectures)

**Your Analysis Philosophy:**
- **Thoroughness over speed**: Better to find all issues now than discover them in production
- **Context-aware**: Every codebase is unique; generic advice is useless
- **Risk-first**: Highlight what can go wrong; also reflect what is in good shape when the data supports it (balanced, not uniformly negative)
- **Actionable insights**: Every finding must have a clear next step
- **Honesty**: If something is uncertain, say so explicitly
- **Use provided data**: Version and upgrade targets come from the pipeline; do not state that a version "does not exist" if it appears in the data (e.g. .NET 10)
- **Version guidance**: When user-selected target versions appear in the data, use them exactly as provided. Do not substitute a different version. If the user selected ".NET 10.0", refer to it as ".NET 10" everywhere — not as ".NET 8" or any other version. The user's selection takes precedence over general knowledge about version availability.
- **Accurate tone**: When the repo profile and version intelligence are complete and targets are valid, say so; avoid defaulting to negative or alarmist language without evidence

**Your Role:**
You analyze code repositories to generate comprehensive assessment reports that guide upgrade decisions. Your assessments are used by engineering teams, CTOs, and project managers to plan modernization efforts.`;

export function buildAssessmentPrompt(state: StackModernizationState, model: string = DEFAULT_MODEL_ID): string {
  const repoProfile = state.repoProfile;
  const depGraph = state.dependencyGraph;
  const versionInt = state.versionIntelligence || [];
  const codeFiles = state.extractedFiles || [];
  
  // Build static portion
  const staticPart = `# Repository Assessment Task

## Your Mission
Analyze this repository comprehensively to generate an assessment report that will guide a stack modernization effort. This report will be read by senior engineers and executives to make go/no-go decisions on upgrades.

---

## 📊 Repository Overview

### Project Profile
- **Project Type**: ${repoProfile?.projectType || "Unknown"}
- **Primary Language**: ${repoProfile?.languages?.[0] || "Unknown"}
- **Runtime**: ${repoProfile?.runtimeInfo?.[0]?.language || "Unknown"} ${repoProfile?.runtimeInfo?.[0]?.version || ""}
- **Total Files**: ${repoProfile?.fileStructure?.totalFiles || 0}
- **Frameworks Detected**: ${repoProfile?.frameworks?.map(f => `${f.name} ${f.version}`).join(", ") || "None"}
- **Build System**: ${repoProfile?.packageManifests?.map(m => m.type).join(", ") || "Unknown"}

### Dependency Overview
- **Direct Dependencies**: ${depGraph?.directDependencies?.length || 0}
- **Transitive Dependencies**: ${depGraph?.transitiveDependencies?.length || 0}
- **Total Dependency Graph**: ${(depGraph?.directDependencies?.length || 0) + (depGraph?.transitiveDependencies?.length || 0)}

### Version Intelligence Summary
${versionInt.length > 0 
  ? versionInt.map(v => `- **${v.package}**: ${v.currentVersion} → ${v.recommended} (Risk: ${v.riskLevel})`).join("\n")
  : "- No version intelligence available"}`;

  // Build the instructions part (after code files)
  const instructionsPart = buildAssessmentInstructions();
  
  // Calculate code budget
  const codeBudget = calculateCodeBudget(
    ASSESSMENT_SYSTEM_PROMPT,
    staticPart + instructionsPart,
    model
  );
  
  
  // Get relevant files (manifest + source code + frontend, exclude tests)
  const relevantFiles = codeFiles.filter(f => {
    const ext = f.relativePath?.split('.').pop()?.toLowerCase();
    const isCode = ['js', 'ts', 'tsx', 'jsx', 'java', 'cs', 'py', 'go', 'json', 'xml', 'csproj', 'txt', 'yaml', 'yml',
                    'cshtml', 'html', 'razor', 'htm', 'css', 'scss', 'less', 'sln', 'props',
                    'targets', 'config', 'vue', 'php', 'rb'].includes(ext || '');
    const isTest = f.relativePath?.includes('test') || f.relativePath?.includes('spec');
    return isCode && !isTest;
  });
  
  // Prepare files within budget
  const preparedFiles = prepareFilesWithinBudget(relevantFiles, {
    totalCharBudget: Math.max(codeBudget, 5000),
    maxCharsPerFile: Math.min(5000, Math.floor(codeBudget / 5)),
    maxFiles: 15,
    priorityExtensions: ['json', 'xml', 'csproj', 'cs', 'java', 'ts', 'tsx', 'js', 'py', 'cshtml', 'html'],
  });
  
  const codeSection = formatFilesForPrompt(preparedFiles, "Repository Files");
  
  // Log final prompt size
  const fullPrompt = `${staticPart}\n\n---\n\n${codeSection}\n\n${instructionsPart}`;
  const estimate = estimatePromptSize(ASSESSMENT_SYSTEM_PROMPT, fullPrompt);
  
  return fullPrompt;
}

function buildAssessmentInstructions(): string {
  return `

---

## 🎯 Your Assessment Tasks

### 1. **Deep Dependency Analysis**
Analyze the dependency tree and identify:
- **Critical Dependencies**: Which packages are absolutely core to this project?
- **Version Conflicts**: Any peer dependency issues or version mismatches?
- **Security Risks**: Known CVEs or EOL packages?
- **Upgrade Blockers**: Dependencies that will prevent upgrades?
- **Transitive Risks**: Hidden dependencies that could break?

### 2. **Code Pattern Analysis**
Based on the source code provided:
- **Framework Usage Patterns**: How tightly coupled is the code to framework internals?
- **Deprecated API Usage**: Are deprecated methods/classes being used?
- **Breaking Change Exposure**: Which parts of code will break with upgrades?
- **Design Patterns**: What patterns make this easier or harder to upgrade?
- **Technical Debt**: Observable code smells or anti-patterns?

### 3. **Breaking Change Assessment**
For each recommended upgrade:
- **Identify specific breaking changes** from release notes
- **Map breaking changes to actual code** (reference file:line)
- **Estimate effort to fix each breaking change**
- **Flag any show-stoppers** (changes that can't be automated)

### 4. **Security Vulnerability Report**
- **Scan for known CVEs** in current versions
- **Prioritize by severity** (Critical > High > Medium > Low)
- **Check if upgrades fix vulnerabilities**
- **Identify new vulnerabilities** introduced by upgrades

### 5. **Upgrade Effort Estimation**
Provide realistic estimates based on:
- **Number of breaking changes**
- **Code complexity** (LOC, file count, coupling)
- **Test coverage** (if tests exist)
- **Team skill level** (assume mid-level engineers)

**Effort Categories:**
- **Low (4-8 hours)**: Mostly manifest updates, minimal code changes
- **Medium (1-3 days)**: Some API updates, manageable breaking changes
- **High (1-2 weeks)**: Significant refactoring, many breaking changes
- **Very High (2+ weeks)**: Major architectural changes, extensive testing

### 6. **Risk Assessment Matrix**

For each upgrade, assess:
- **Technical Risk**: Will it break? (Low/Medium/High/Critical)
- **Business Risk**: Impact on operations (Low/Medium/High/Critical)
- **Timeline Risk**: How long to fix if broken? (Hours/Days/Weeks)
- **Rollback Risk**: Can we revert safely? (Easy/Medium/Hard/Impossible)

---

## 📝 Output Format

Generate a **structured JSON response** with this EXACT format:

\`\`\`json
{
  "executiveSummary": {
    "overallComplexity": "low" | "medium" | "high",
    "estimatedEffort": "4-8 hours" | "1-3 days" | "1-2 weeks" | "2+ weeks",
    "criticalFindings": ["finding 1", "finding 2", ...],
    "recommendedApproach": "big-bang" | "incremental" | "phased",
    "goNoGo": "proceed" | "proceed_with_caution" | "review_required" | "do_not_proceed"
  },
  "dependencyAnalysis": {
    "criticalDependencies": [
      {
        "package": "exact package name",
        "currentVersion": "x.y.z",
        "role": "core" | "supporting" | "dev",
        "upgradeBlocker": true | false,
        "reason": "why it's critical"
      }
    ],
    "versionConflicts": [
      {
        "package": "package name",
        "issue": "specific conflict description",
        "severity": "low" | "medium" | "high",
        "resolution": "how to fix"
      }
    ],
    "securityIssues": [
      {
        "package": "package name",
        "cve": "CVE-YYYY-XXXXX",
        "severity": "low" | "medium" | "high" | "critical",
        "currentVersion": "x.y.z",
        "fixedInVersion": "x.y.z",
        "description": "what's vulnerable"
      }
    ]
  },
  "codeAnalysis": {
    "frameworkCoupling": "loose" | "moderate" | "tight",
    "deprecatedAPIs": [
      {
        "api": "exact method/class name",
        "package": "package name",
        "file": "path/to/file.ext",
        "line": "line number",
        "replacement": "new API to use"
      }
    ],
    "breakingChangeHotspots": [
      {
        "file": "path/to/file.ext",
        "lines": "start-end",
        "issue": "specific problem",
        "package": "package causing break",
        "fix": "how to fix it"
      }
    ],
    "technicalDebt": [
      {
        "type": "code smell type",
        "severity": "low" | "medium" | "high",
        "description": "what's wrong",
        "impact": "how it affects upgrade"
      }
    ]
  },
  "breakingChanges": [
    {
      "package": "package name",
      "fromVersion": "x.y.z",
      "toVersion": "x.y.z",
      "category": "API change" | "behavior change" | "config change" | "removal",
      "severity": "low" | "medium" | "high" | "critical",
      "description": "what changed",
      "affectedCode": ["file1.ext", "file2.ext"],
      "estimatedEffort": "hours",
      "autoFixable": true | false
    }
  ],
  "upgradeRecommendations": [
    {
      "package": "package name",
      "recommendedVersion": "x.y.z",
      "rationale": "why this version",
      "riskLevel": "low" | "medium" | "high",
      "effort": "hours",
      "blockers": ["blocker 1", "blocker 2"] | []
    }
  ]
}
\`\`\`

---

## ⚠️ Critical Instructions

1. **Be specific**: Don't say "may break" - say "will break method X in file Y at line Z"
2. **Use real data**: Reference actual files, line numbers, package names from the provided code
3. **Be honest**: If you can't determine something from the provided code, say "insufficient data"
4. **Prioritize**: Order findings by severity (critical first)
5. **Be actionable**: Every finding must have a clear next step or fix
6. **Check your work**: Verify package names, version numbers, and file paths are correct
7. **Return only JSON**: No explanations, no markdown outside the JSON block

---

## Important: Red Flags to Watch For

- Multiple versions of the same package (dependency duplication)
- Deep imports from \`node_modules/package/internal/\` (framework internals)
- Monkey patching or prototype modifications
- Hard-coded version checks in code
- Missing peer dependencies
- Circular dependencies
- EOL or archived packages
- Packages with no updates in 2+ years
- Security vulnerabilities with no fix available

---

**Begin your analysis now. Take your time. Be thorough. Lives depend on this (okay, maybe just careers 😄).**`;
}

export const ASSESSMENT_OUTPUT_FORMAT = `Return ONLY valid JSON matching the schema above. No markdown wrapper, no explanations.`;

/**
 * Build a prompt that asks the LLM to produce a rich MARKDOWN assessment document
 * (as opposed to the JSON-oriented buildAssessmentPrompt above).
 * Injects all sub-agent results so the narrative is grounded in real data.
 */
export function buildAssessmentMarkdownPrompt(state: StackModernizationState, model: string = DEFAULT_MODEL_ID): string {
  const repoProfile = state.repoProfile;
  const depGraph = state.dependencyGraph;
  const versionInt = state.versionIntelligence || [];
  const codeFiles = state.extractedFiles || [];

  const secAssess = (state as any).securityAssessment;
  const codeQual = (state as any).codeQuality;
  const breakPrev = (state as any).breakingChangesPreview;
  const dbDeps = (state as any).databaseDependencies;
  const reqAnalysis = (state as any).requirementsAnalysis;

  const securitySection = secAssess
    ? `### Security Assessment Data
- Score: ${secAssess.score}/100
- Critical: ${secAssess.critical}, High: ${secAssess.high}, Medium: ${secAssess.medium}, Low: ${secAssess.low}
- Total Vulnerabilities: ${secAssess.totalVulnerabilities}
${secAssess.cves?.length ? "CVEs:\n" + secAssess.cves.slice(0, 15).map((c: any) => `  - [${c.severity}] ${c.id} ${c.package}: ${c.title}${c.fixedIn ? ` (fix: ${c.fixedIn})` : ""}`).join("\n") : ""}
${secAssess.advisories?.length ? "Advisories:\n" + secAssess.advisories.slice(0, 10).map((a: string) => `  - ${a}`).join("\n") : ""}`
    : "### Security Assessment: Not available";

  const codeQualitySection = codeQual
    ? `### Code Quality Data
- Quality Score: ${codeQual.qualityScore}/100
- Maintainability Index: ${codeQual.maintainabilityIndex}/100
- Lines of Code: ${codeQual.complexityMetrics?.linesOfCode}
- Avg Cyclomatic Complexity: ${codeQual.complexityMetrics?.averageCyclomaticComplexity}
- Max Cyclomatic Complexity: ${codeQual.complexityMetrics?.maxCyclomaticComplexity}
- Duplicate Code: ${codeQual.complexityMetrics?.duplicateCodePercentage}%
- Test Coverage: ${codeQual.patterns?.testCoverage}
${codeQual.debtItems?.length ? "Tech Debt:\n" + codeQual.debtItems.slice(0, 10).map((d: any) => `  - [${d.severity}] ${d.description} (${d.file})`).join("\n") : ""}`
    : "### Code Quality: Not available";

  const breakingSection = breakPrev
    ? `### Breaking Changes Preview Data
- Total Breaking Changes: ${breakPrev.totalBreakingChanges}
- Critical: ${breakPrev.severityDistribution?.critical}, Major: ${breakPrev.severityDistribution?.major}, Minor: ${breakPrev.severityDistribution?.minor}
${breakPrev.byPackage?.length ? breakPrev.byPackage.map((b: any) => `- ${b.package} (${b.currentVersion} -> ${b.latestVersion}): ${b.breakingChangesCount} changes (${b.severity})\n${b.highlights?.map((h: string) => `  - ${h}`).join("\n") || ""}`).join("\n") : ""}`
    : "### Breaking Changes: Not available";

  const dbSection = dbDeps
    ? `### Database Dependencies Data
${dbDeps.databases?.length ? "Databases: " + dbDeps.databases.map((d: any) => `${d.type} (from ${d.detectedFrom})`).join(", ") : "No databases detected"}
${dbDeps.orms?.length ? "ORMs: " + dbDeps.orms.map((o: any) => `${o.name}${o.version ? " v" + o.version : ""}`).join(", ") : ""}
- Migration Files: ${dbDeps.migrationFiles?.length || 0}
- Connection Strings: ${dbDeps.connectionStrings || 0}`
    : "### Database Dependencies: Not available";

  const reqSection = reqAnalysis
    ? `### Requirements Analysis Data
${JSON.stringify(reqAnalysis, null, 2).slice(0, 2000)}`
    : "### Requirements Analysis: Not available";

  const staticPart = `# Generate Assessment Report (Markdown)

You are generating a comprehensive **Markdown assessment report** for a stack modernization project.
All data below comes from automated sub-agents (repo profiler, dependency graph, version intelligence from live registry APIs, security scanner, code quality analyzer, breaking change detector, database dependency analyzer, and requirements analyzer). Use this data as the source of truth.

---

## Repository Profile
- **Project Type**: ${repoProfile?.projectType || "Unknown"}
- **Primary Language**: ${repoProfile?.languages?.[0] || "Unknown"}
- **Runtime**: ${repoProfile?.runtimeInfo?.[0]?.language || "Unknown"} ${repoProfile?.runtimeInfo?.[0]?.version || ""}
- **Total Files**: ${repoProfile?.fileStructure?.totalFiles || 0} (Code: ${repoProfile?.fileStructure?.codeFiles || 0}, Tests: ${repoProfile?.fileStructure?.testFiles || 0})
- **Frameworks**: ${repoProfile?.frameworks?.map((f: any) => `${f.name} ${f.version || ""}`).join(", ") || "None"}
- **Build System**: ${repoProfile?.packageManifests?.map((m: any) => `${m.type} at ${m.path}`).join(", ") || "Unknown"}
- **Has CI/CD**: ${repoProfile?.detectedPatterns?.hasCI ? "Yes" : "No"}
- **Has Tests**: ${repoProfile?.detectedPatterns?.hasTests ? "Yes" : "No"}

## Dependency Graph
- **Direct Dependencies**: ${depGraph?.directDependencies?.length || 0}
- **Transitive Dependencies**: ${depGraph?.transitiveDependencies?.length || 0}
${depGraph?.directDependencies?.length ? "Direct packages:\n" + depGraph.directDependencies.slice(0, 30).map((d: any) => `  - ${d.name || d.package || d}: ${d.version || "?"}`).join("\n") : ""}

## Version Intelligence (from live registry APIs - source of truth for versions)
${versionInt.length > 0
    ? versionInt.map(v => `- **${v.package}**: current ${v.currentVersion} -> recommended ${v.recommended}${v.latestLTS ? " (LTS)" : ""} | latest stable: ${v.latestStable || "?"} | risk: ${v.riskLevel} | registry: ${(v as any).registry || "?"}\n  Reasoning: ${v.reasoning || "N/A"}`).join("\n")
    : "No version intelligence available"}

${securitySection}

${codeQualitySection}

${breakingSection}

${dbSection}

${reqSection}`;

  const instructionsPart = `

---

## Instructions

Generate a comprehensive **Markdown** assessment report. The report must:

1. **Reference the ACTUAL data** provided above -- do not invent metrics, package names, versions, or CVEs.
2. **Analyze the actual code files** provided below and reference specific files, patterns, and APIs you find.
3. **Use version intelligence from registries** as the source of truth for recommended versions.
4. **Be specific and actionable** -- reference real file paths, real package names, real version numbers.
5. **Cover all sections**: Executive Summary, Project Structure, Dependency Analysis, Security, Code Quality, Breaking Changes, Database, Version Recommendations, Upgrade Scope, and Next Steps.
6. **For each version recommendation**, explain WHY that version is recommended based on the registry data and the actual code patterns found.
7. **For breaking changes**, map them to actual files and code patterns found in the provided code.

Return ONLY the markdown document. No JSON wrapper, no code fences around the entire document.

The report should be structured with clear headers (##) and include tables where appropriate.`;

  const codeBudget = calculateCodeBudget(
    ASSESSMENT_SYSTEM_PROMPT,
    staticPart + instructionsPart,
    model
  );

  const relevantFiles = codeFiles.filter(f => {
    const ext = f.relativePath?.split('.').pop()?.toLowerCase();
    const isCode = ['js', 'ts', 'tsx', 'jsx', 'java', 'cs', 'py', 'go', 'json', 'xml', 'csproj', 'txt', 'yaml', 'yml'].includes(ext || '');
    const isTest = f.relativePath?.includes('test') || f.relativePath?.includes('spec');
    return isCode && !isTest;
  });

  const preparedFiles = prepareFilesWithinBudget(relevantFiles, {
    totalCharBudget: Math.max(codeBudget, 5000),
    maxCharsPerFile: Math.min(5000, Math.floor(codeBudget / 5)),
    maxFiles: 12,
    priorityExtensions: ['json', 'xml', 'csproj', 'cs', 'java', 'ts', 'tsx', 'js', 'py'],
  });

  const codeSection = formatFilesForPrompt(preparedFiles, "Repository Source Files");

  const fullPrompt = `${staticPart}\n\n---\n\n${codeSection}\n\n${instructionsPart}`;
  const estimate = estimatePromptSize(ASSESSMENT_SYSTEM_PROMPT, fullPrompt);

  return fullPrompt;
}
