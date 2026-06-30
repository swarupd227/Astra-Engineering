/**
 * Planning Agent Prompts
 * Comprehensive prompts for generating detailed upgrade plans
 * Now with smart token management for large codebases
 */

import type { StackModernizationState, VersionSelection } from "../types";
import { 
  prepareFilesWithinBudget, 
  formatFilesForPrompt, 
  calculateCodeBudget,
  estimatePromptSize
} from "../services/token-manager";
import { DEFAULT_MODEL_ID } from "../../llm-config-constants";

export const PLANNING_SYSTEM_PROMPT = `You are a **Lead Migration Architect** with 30+ years of experience in:
- Large-scale system migrations and modernization projects
- Risk mitigation and rollback planning
- Breaking change analysis and remediation strategies
- Cross-framework compatibility assessment (React, Angular, Vue, Spring Boot, .NET, Django, Rails)
- Database migration and schema versioning
- Zero-downtime deployment strategies
- Incident prevention and disaster recovery

**Your Expertise:**
- **Migration Projects**: Successfully led 500+ migrations across Fortune 500 companies
- **Risk Assessment**: Prevented 1000+ production outages through thorough planning
- **Breaking Changes**: Expert in analyzing release notes and mapping to code impact
- **Rollback Strategies**: Designed fail-safe rollback procedures for critical systems
- **Team Leadership**: Guided 100+ engineering teams through complex upgrades
- **Framework Transitions**: Deep knowledge of migration paths for all major frameworks

**Your Planning Philosophy:**
1. **Assume Murphy's Law**: Everything that can go wrong, will go wrong
2. **Plan for Rollback**: Every step must be reversible
3. **Measure Twice, Cut Once**: Thorough planning prevents costly mistakes
4. **Communicate Risk Clearly**: Decision-makers need honest assessments
5. **Phase Complex Changes**: Break big changes into safe, testable increments
6. **Document Everything**: Future teams will thank you

**Your Reputation:**
Teams trust your plans because they're:
- **Detailed**: Every step is clear and actionable
- **Realistic**: Effort estimates are accurate (within 20%)
- **Safe**: Rollback procedures are always included
- **Tested**: Plans include validation at every step
- **Honest**: Risks are never sugarcoated; also accurate—use the version and upgrade data provided; do not state that a version "does not exist" if it appears in the data (e.g. .NET 10).

**Version guidance:**
The "Selected Upgrades" section in the prompt contains the exact target versions the user chose. Use these as your source of truth.
- Use these exact versions in all plan text, migration steps, upgrade order, and everywhere else.
- Do not substitute, downgrade, or recommend a different version than what the user selected.
- If the user selected ".NET 10.0", every mention should say ".NET 10" or "net10.0" — not ".NET 8" or "net8.0".
- Even if you believe a version does not exist — use it anyway. The user's selection takes precedence over general knowledge.`;

export function buildPlanningPrompt(state: StackModernizationState, model: string = DEFAULT_MODEL_ID): string {
  const selections = state.userSelections || [];
  const compat = state.compatibilityCheck;
  const repoProfile = state.repoProfile;
  const codeFiles = state.extractedFiles || [];
  
  // Build the static portion of the prompt first (without code files)
  const staticPromptPart = buildStaticPlanningSection(selections, compat, repoProfile, state);
  const instructionsPart = buildPlanningInstructions();
  
  // Calculate how much budget we have left for code files
  const codeBudget = calculateCodeBudget(
    PLANNING_SYSTEM_PROMPT,
    staticPromptPart + instructionsPart,
    model
  );
  
  
  // Get code files that are relevant for planning (source code + manifests + frontend)
  const relevantFiles = codeFiles.filter(f => {
    const ext = f.relativePath?.split('.').pop()?.toLowerCase();
    return ['js', 'ts', 'tsx', 'jsx', 'java', 'cs', 'py', 'go', 'json', 'xml', 'csproj', 'yaml', 'yml',
            'cshtml', 'html', 'razor', 'htm', 'css', 'scss', 'less', 'sln', 'props',
            'targets', 'config', 'vue', 'php', 'rb'].includes(ext || '');
  });
  
  // Prepare files within budget using smart chunking
  const preparedFiles = prepareFilesWithinBudget(relevantFiles, {
    totalCharBudget: Math.max(codeBudget, 5000),
    maxCharsPerFile: Math.min(4000, Math.floor(codeBudget / 5)),
    maxFiles: 15,
    priorityExtensions: ['cs', 'csproj', 'java', 'ts', 'tsx', 'js', 'jsx', 'py', 'cshtml', 'html', 'json'],
  });
  
  const codeSection = formatFilesForPrompt(preparedFiles, "Code Files to Analyze");
  
  // Log final prompt size
  const fullPrompt = `${staticPromptPart}\n\n${codeSection}\n\n${instructionsPart}`;
  const estimate = estimatePromptSize(PLANNING_SYSTEM_PROMPT, fullPrompt);
  
  return fullPrompt;
}

function buildStaticPlanningSection(
  selections: any[],
  compat: any,
  repoProfile: any,
  state?: { repositoryTree?: { entryPoints: string[]; testRoots: string[]; projectRoots: string[]; framework?: string }; importGraph?: { packageToFiles: Record<string, string[]> } }
): string {
  const repoTree = state?.repositoryTree;
  const importGraph = state?.importGraph;
  const structureSection = repoTree
    ? `
### Repository Structure (scope for upgrade)
- **Entry points**: ${repoTree.entryPoints.length ? repoTree.entryPoints.join(", ") : "None detected"}
- **Test roots**: ${repoTree.testRoots.length ? repoTree.testRoots.join(", ") : "None"}
- **Project roots**: ${repoTree.projectRoots.length ? repoTree.projectRoots.join(", ") : "None"}
- **Framework**: ${repoTree.framework ?? "Unknown"}`
    : "";
  const importScopeSection = importGraph && selections?.length
    ? `
### Import scope (packages being upgraded → files that use them)
Limit upgrade scope to these files where possible.
${selections
  .map((s: { package: string }) => {
    const pkg = s.package;
    const files = importGraph.packageToFiles[pkg] ?? importGraph.packageToFiles[pkg.toLowerCase()] ?? [];
    return `- **${pkg}**: ${files.length ? files.slice(0, 50).join(", ") + (files.length > 50 ? ` (+${files.length - 50} more)` : "") : "No direct imports found"}`;
  })
  .join("\n")}`
    : "";

  return `# Upgrade Planning Task

## Your Mission
Create a **production-ready upgrade plan** for this repository. This plan will be executed by a team of engineers and must be detailed enough that they can follow it step-by-step without guessing. The plan must include risk assessment, breaking changes, migration steps, testing strategy, and rollback procedures.

---

## 📊 Project Context

### Repository Profile
- **Project Type**: ${repoProfile?.projectType || "Unknown"}
- **Tech Stack**: ${repoProfile?.runtimeInfo?.map((r: any) => `${r.language} ${r.version}`).join(", ") || "Unknown"}
- **Framework**: ${repoProfile?.frameworks?.map((f: any) => `${f.name} ${f.version}`).join(", ") || "None"}
- **Total Files**: ${repoProfile?.fileStructure?.totalFiles || 0}
- **Code Files**: ${repoProfile?.fileStructure?.codeFiles || 0}
- **Test Files**: ${repoProfile?.fileStructure?.testFiles || 0}
- **Has CI/CD**: ${repoProfile?.detectedPatterns?.hasCI ? "Yes" : "No"}
- **Has Tests**: ${repoProfile?.detectedPatterns?.hasTests ? "Yes" : "No"}
${structureSection}
${importScopeSection}

### Selected Upgrades (USER-SPECIFIED — these are the EXACT target versions)
${selections.map(s => `- **${s.package}**: ${s.currentVersion} → **${s.selectedVersion}** (${s.category})`).join("\n")}

**IMPORTANT: The target versions above are the user's explicit choices and are your source of truth. All planning must reference these exact versions. Do not substitute different version numbers.**

### Compatibility Status
- **Overall Compatible**: ${compat?.compatible ? "✅ Yes" : "⚠️ Issues Detected"}
- **Confidence Level**: ${compat?.confidence || 0}%
- **Warnings**: ${compat?.warnings?.length || 0}
- **Conflicts**: ${compat?.conflicts?.length || 0}
- **Recommendation**: ${compat?.recommendation || "review_required"}

### Compatibility Warnings
${compat?.warnings && compat.warnings.length > 0
  ? compat.warnings.slice(0, 10).map((w: any) => 
      `- **${w.package || "Unknown"}** [${w.severity}]: ${w.message || "No message"}\n  Impact: ${w.impact || "Unknown"}`
    ).join("\n")
  : "- No warnings"}

### Compatibility Conflicts
${compat?.conflicts && compat.conflicts.length > 0
  ? compat.conflicts.map((c: any) => 
      `- **${c.package || "Unknown"}** [${c.severity}]: ${c.message || "No message"}\n  Solution: ${c.solution || "Unknown"}`
    ).join("\n")
  : "- No conflicts"}`;

}

function buildPlanningInstructions(): string {
  return `---

## 🎯 Your Planning Tasks

### 1. **Breaking Change Deep Dive**
For EACH selected upgrade:

#### Research Phase
- Study official release notes and changelog
- Identify ALL breaking changes between current and target versions
- Categorize by type:
  - **API Changes**: Method removals, signature changes, renamed classes
  - **Behavioral Changes**: Different defaults, execution order, async handling
  - **Configuration Changes**: New required settings, deprecated options
  - **Dependency Changes**: New peer requirements, dropped support

#### Code Mapping Phase
- **Scan the provided code files** for usage of affected APIs
- **Map each breaking change to specific files and line numbers**
- **Estimate effort to fix each occurrence** (trivial/low/medium/high)
- **Identify code patterns that will break** (not just individual APIs)

#### Example Breaking Change Entry:
\`\`\`json
{
  "package": "react",
  "fromVersion": "17.0.2",
  "toVersion": "18.2.0",
  "change": "componentWillMount deprecated",
  "type": "API removal",
  "severity": "high",
  "affectedFiles": [
    {
      "file": "src/components/Dashboard.jsx",
      "lines": "45-52",
      "occurrences": 1,
      "codeSnippet": "componentWillMount() { this.fetchData(); }",
      "fix": "Move to useEffect hook or componentDidMount",
      "estimatedEffort": "15 minutes"
    }
  ],
  "totalOccurrences": 3,
  "totalEffort": "1 hour",
  "autoFixable": false,
  "migrationGuide": "https://react.dev/blog/2022/03/29/react-v18#breaking-changes"
}
\`\`\`

### 2. **Risk Assessment Matrix**

Assess risks across multiple dimensions:

#### Technical Risks
- **Build Failures**: Will it compile after upgrade?
- **Runtime Errors**: Will it run without crashing?
- **Silent Bugs**: Behavioral changes that don't throw errors
- **Performance Degradation**: Slower than before?
- **Memory Leaks**: New memory issues introduced?

#### Business Risks
- **Downtime**: How long will deployment take?
- **Data Loss**: Any risk to data integrity?
- **Feature Breakage**: Which features might stop working?
- **User Impact**: What do users experience during upgrade?
- **Rollback Time**: How long to revert if needed?

#### Project Risks
- **Timeline**: Will we meet the deadline?
- **Resource Requirements**: Do we have enough engineers?
- **Skill Gaps**: Does team know the new APIs?
- **Testing Coverage**: Can we validate the upgrade?
- **Dependency Availability**: Are all packages ready?

For each risk, provide:
- **Likelihood**: 0-100%
- **Impact**: Low/Medium/High/Critical
- **Mitigation Strategy**: How to prevent or minimize
- **Detection Method**: How to catch it early
- **Rollback Plan**: How to recover if it occurs

### 3. **Migration Strategy**

Choose the best approach based on:
- **Project complexity** (file count, dependency graph size)
- **Risk level** (breaking changes count, test coverage)
- **Team capacity** (available engineers, skill level)
- **Business constraints** (deadline, uptime requirements)

**Strategy Options:**
1. **Big Bang** (all at once):
   - **Use when**: Low risk, small codebase, good tests
   - **Pros**: Fast, simple, clean break
   - **Cons**: High risk, hard to debug, no safety net

2. **Incremental** (feature flags, gradual rollout):
   - **Use when**: Medium risk, can isolate changes
   - **Pros**: Safer, easier to debug, can abort midway
   - **Cons**: Slower, more complex, temporary tech debt

3. **Phased** (by module/service):
   - **Use when**: High risk, microservices, large team
   - **Pros**: Safest, validates each step, easy rollback
   - **Cons**: Slowest, requires compatibility layers

### 4. **Detailed Migration Steps**

Break the upgrade into **sequential, verifiable tasks**:

#### Phase 0: Preparation
1. Create feature branch
2. Backup current state
3. Document current behavior (baseline metrics)
4. Review this plan with team
5. Get stakeholder approval

#### Phase 1: Dependency Updates
For each package in upgrade order:
1. Update version in manifest
2. Run package manager install
3. Verify no conflicts
4. Commit with clear message

#### Phase 2: Breaking Change Fixes
For each breaking change:
1. Locate affected code
2. Apply fix
3. Verify locally
4. Write test for new behavior
5. Commit

#### Phase 3: Testing & Validation
1. Run unit tests
2. Run integration tests
3. Run E2E tests
4. Manual smoke testing
5. Performance benchmarks
6. Security scan

#### Phase 4: Deployment
1. Deploy to staging
2. Validate staging
3. Deploy to production (with rollback plan ready)
4. Monitor for issues
5. Communicate success/issues

### 5. **Rollback Procedures**

For each phase, document:
- **Rollback triggers**: When to abort (test failures, errors, performance drop)
- **Rollback steps**: Exact commands to revert
- **Rollback time**: How long it takes
- **Data considerations**: Any data migrations that can't be undone
- **Communication plan**: Who to notify, what to say

---

## 📝 Output Format

Return a **comprehensive JSON plan** with this structure:

\`\`\`json
{
  "executiveSummary": {
    "strategy": "big-bang" | "incremental" | "phased",
    "estimatedEffort": "total hours",
    "riskLevel": "low" | "medium" | "high" | "critical",
    "recommendation": "proceed" | "proceed_with_caution" | "review_required" | "do_not_proceed",
    "keyFindings": ["finding 1", "finding 2", ...],
    "successCriteria": ["criteria 1", "criteria 2", ...]
  },
  "breakingChanges": [
    {
      "package": "package name",
      "fromVersion": "x.y.z",
      "toVersion": "x.y.z",
      "change": "what changed",
      "type": "API change" | "behavioral" | "config" | "dependency",
      "severity": "low" | "medium" | "high" | "critical",
      "affectedFiles": [
        {
          "file": "path/to/file",
          "lines": "start-end",
          "occurrences": number,
          "codeSnippet": "actual code",
          "fix": "how to fix",
          "estimatedEffort": "minutes/hours"
        }
      ],
      "totalOccurrences": number,
      "totalEffort": "hours",
      "autoFixable": boolean,
      "migrationGuide": "URL"
    }
  ],
  "riskAssessment": {
    "overallRisk": "low" | "medium" | "high" | "critical",
    "technicalRisks": [
      {
        "risk": "description",
        "likelihood": "0-100%",
        "impact": "low" | "medium" | "high" | "critical",
        "mitigation": "how to prevent",
        "detection": "how to catch early",
        "rollback": "how to recover"
      }
    ],
    "businessRisks": [...],
    "projectRisks": [...]
  },
  "migrationSteps": {
    "phase0": { "name": "Preparation", "tasks": [...], "duration": "hours" },
    "phase1": { "name": "Dependency Updates", "tasks": [...], "duration": "hours" },
    "phase2": { "name": "Breaking Change Fixes", "tasks": [...], "duration": "hours" },
    "phase3": { "name": "Testing & Validation", "tasks": [...], "duration": "hours" },
    "phase4": { "name": "Deployment", "tasks": [...], "duration": "hours" }
  },
  "rollbackProcedures": [
    {
      "phase": "phase name",
      "triggers": ["trigger 1", "trigger 2"],
      "steps": ["step 1", "step 2"],
      "estimatedTime": "minutes",
      "dataImpact": "description",
      "verification": "how to confirm rollback worked"
    }
  ],
  "testingStrategy": {
    "unitTests": { "coverage": "percentage", "newTests": number, "effort": "hours" },
    "integrationTests": {...},
    "e2eTests": {...},
    "performanceTests": {...}
  }
}
\`\`\`

---

## ⚠️ Critical Requirements

1. **Analyze the actual code**: Don't make generic statements - reference specific files and lines
2. **Be thorough**: Missing one breaking change can cause a production outage
3. **Be realistic**: Don't underestimate effort - teams hate surprises
4. **Prioritize safety**: When in doubt, recommend more caution, not less
5. **Document rollback**: Every step must be reversible
6. **Verify everything**: Include verification steps at each phase
7. **Return only JSON**: No markdown wrapper, no explanations

**Begin planning now. This is production code. People's jobs depend on this working.**`;
}

/**
 * Build a prompt that asks the LLM to produce a rich MARKDOWN upgrade plan document.
 * Reuses the same context data as buildPlanningPrompt but requests markdown output.
 */
export function buildPlanningMarkdownPrompt(state: StackModernizationState, model: string = DEFAULT_MODEL_ID): string {
  const selections = state.userSelections || [];
  const compat = state.compatibilityCheck;
  const risk = (state as any).riskReport;
  const repoProfile = state.repoProfile;
  const codeFiles = state.extractedFiles || [];

  const staticPromptPart = buildStaticPlanningSection(selections, compat, repoProfile, state);

  const markdownInstructions = `---

## Your Task

Generate a **comprehensive Markdown upgrade plan document** for this project. The plan must be built entirely from the data and code files provided above. Do NOT use generic or boilerplate content.

### Required Sections

1. **Executive Summary** - strategy recommendation, overall risk, effort estimate, key findings (all based on the actual compatibility/risk data above)

2. **Selected Target Versions** - table showing each package, current vs target, change type (major/minor/patch), and risk

3. **Breaking Changes Catalog** - for EACH upgrade, list specific breaking changes you can identify from the code files provided. Reference actual file paths and code patterns. If the risk/compatibility data mentions breaking changes, expand on them with code-level specifics.
${risk?.breakingChanges?.length ? "\nBreaking changes from risk analysis:\n" + (risk.breakingChanges as any[]).slice(0, 15).map((bc: any) => `- ${bc.package || bc.title || "?"}: ${bc.description || bc.title || ""}`).join("\n") : ""}

4. **Detailed Compatibility Analysis** - expand on the warnings and conflicts from the compatibility check data above. Map each to actual code files.

5. **Risk Assessment** - analyze technical, business, and project risks based on the actual codebase complexity and the specific upgrades chosen.
${risk ? `\nRisk data: Overall risk: ${risk.overallRisk}, Confidence: ${risk.confidenceScore}/100` : ""}
${risk?.failureScenarios?.length ? "\nFailure scenarios:\n" + (risk.failureScenarios as any[]).slice(0, 10).map((fs: any) => `- ${fs.scenario}: likelihood=${fs.likelihood}, impact=${fs.impact}, mitigation=${fs.mitigation}`).join("\n") : ""}

6. **Migration Strategy** - recommend big-bang/incremental/phased based on the actual risk level, codebase size, and test coverage. Explain the upgrade order with rationale. The upgrade order must reference the exact target versions from "Selected Upgrades" above — do not substitute different version numbers.

7. **Phase-by-Phase Migration Steps** - detailed, actionable steps for each phase:
   - Phase 0: Preparation (backup, environment setup)
   - Phase 1: Dependency/manifest updates (specific files to modify)
   - Phase 2: Breaking change fixes (specific code changes referencing actual files)
   - Phase 3: Testing & validation
   - Phase 4: Deployment

8. **Version Comparison** - for each selected upgrade, explain what's new in the target version, deprecated features, new features, and performance improvements SPECIFIC to that package and version jump.

9. **Testing & Validation Strategy** - test coverage requirements and a validation checklist

10. **Rollback & Contingency Plan** - rollback triggers, procedure, and contingency plans based on the actual risk profile

11. **Success Criteria** - must-have and should-have criteria for go/no-go

### Critical Rules
- Reference ACTUAL files and code patterns from the provided code files
- Use the compatibility and risk data as ground truth - do not contradict it
- Be specific: "Update OrderCurrency.DAL.csproj line 5" not "update project files"
- Include realistic effort estimates based on the actual scope
- Return ONLY the Markdown document, no JSON wrapper`;

  const codeBudget = calculateCodeBudget(
    PLANNING_SYSTEM_PROMPT,
    staticPromptPart + markdownInstructions,
    model
  );

  const relevantFiles = codeFiles.filter(f => {
    const ext = f.relativePath?.split('.').pop()?.toLowerCase();
    return ['js', 'ts', 'tsx', 'jsx', 'java', 'cs', 'py', 'go', 'json', 'xml', 'csproj', 'yaml', 'yml'].includes(ext || '');
  });

  const preparedFiles = prepareFilesWithinBudget(relevantFiles, {
    totalCharBudget: Math.max(codeBudget, 5000),
    maxCharsPerFile: Math.min(4000, Math.floor(codeBudget / 5)),
    maxFiles: 12,
    priorityExtensions: ['cs', 'java', 'ts', 'tsx', 'js', 'jsx', 'py'],
  });

  const codeSection = formatFilesForPrompt(preparedFiles, "Code Files to Analyze");

  const fullPrompt = `${staticPromptPart}\n\n${codeSection}\n\n${markdownInstructions}`;
  const estimate = estimatePromptSize(PLANNING_SYSTEM_PROMPT, fullPrompt);

  return fullPrompt;
}