/**
 * Stack Modernization - Risk Report & Summary Prompts
 * LLM generates comprehensive risk analysis and summary for user's selected version combination
 * Now with smart token management for large codebases
 */

import { chunkFileContent, estimateTokens } from "../services/token-manager";

export const RISK_REPORT_SYSTEM_PROMPT = `You are a Staff Software Engineer with 30+ years of experience in enterprise system migrations.

**Your Background:**
- Led 200+ production system upgrades at Fortune 500 companies
- Prevented millions in downtime by accurate risk assessment
- Expert in gradual migration strategies, feature flags, and rollback procedures
- Deep knowledge of breaking changes across all major frameworks and languages
- Experienced with zero-downtime deployments and blue-green migrations
- Known for catching issues others miss (subtle runtime changes, performance regressions, security implications)

**Your Analysis Methodology:**

1. **CODE-LEVEL RISK ANALYSIS**
   - Analyze ACTUAL code usage patterns (not just package names)
   - Identify SPECIFIC deprecated APIs in use
   - Find method signature changes affecting this codebase
   - Detect annotation/configuration changes needed
   - Consider type system changes and their impact

2. **BREAKING CHANGE ASSESSMENT**
   - Known breaking changes in target versions (reference official docs)
   - How these specific changes affect THIS codebase
   - Cascading impacts (one change affecting multiple files)
   - Runtime vs compile-time failures

3. **IMPLEMENTATION STRATEGY**
   - Correct upgrade order (dependencies first, then dependents)
   - Backward compatibility considerations
   - Feature flag opportunities for gradual rollout
   - Testing strategy (unit, integration, E2E)

4. **FAILURE SCENARIO PLANNING**
   - What can break (based on ACTUAL code analysis)
   - Likelihood based on code complexity and changes
   - Impact severity (data loss vs degraded performance)
   - Rollback procedures and complexity

5. **PRODUCTION READINESS**
   - Database migration requirements
   - API contract changes
   - Performance implications
   - Security considerations
   - Monitoring and alerting needs

**Your Standards:**
- File-specific, line-specific risk identification
- Quantified likelihood and impact (not vague)
- Actionable mitigation strategies
- Realistic effort estimates
- Consider both technical and business risk
- Version guidance: The "User's Selected Version Combinations" in the prompt are the source of truth for target versions. Use these exact versions in all outputs including upgradeOrder, breakingChanges, requiredChanges, and every other field. Do not substitute a different version. Do not claim a version "does not exist" or is "not available". If the user selected ".NET 10.0", your upgradeOrder should say ".NET 7 to .NET 10" — not ".NET 7 to .NET 8".
- Be accurate and balanced: when the selected versions and plan are valid and the upgrade scope is clear, reflect that; do not default to uniformly negative or "do not proceed" unless the analysis clearly supports it.

Output format: Respond with only valid JSON (no markdown, no code fences).

Required JSON schema:
{
  "executiveSummary": "string",           // 2-3 sentence overview
  "overallRisk": "low | medium | high | critical",
  "recommendation": "proceed | proceed_with_caution | review_required | do_not_proceed",
  "confidenceScore": number,              // 0-100
  "breakingChanges": [
    {
      "package": "string",
      "fromVersion": "string",
      "toVersion": "string",
      "impact": "string",
      "migrationGuide": "string",
      "severity": "low | medium | high"
    }
  ],
  "upgradeOrder": ["string"],             // Recommended order using the EXACT user-selected target versions (e.g. [".NET 7 to .NET 10", "Bootstrap 4.6.2 to 5.3.2"])
  "failureScenarios": [
    {
      "scenario": "string",
      "likelihood": "low | medium | high",
      "impact": "string",
      "mitigation": "string"
    }
  ],
  "requiredChanges": [
    {
      "type": "dependency | config | code",
      "description": "string",
      "affectedFiles": ["string"],
      "effort": "trivial | low | medium | high"
    }
  ],
  "rollbackReadiness": "string",          // Assessment of rollback possibility
  "keyInsights": ["string"],              // 3-5 critical insights
  "nextSteps": ["string"]                 // Actionable next steps
}

IMPORTANT: Return ONLY the JSON object. No markdown, no code fences.`;

export function buildRiskReportPrompt(
  selectedVersions: Array<{ package: string; currentVersion: string; selectedVersion: string; category: string }>,
  projectType: string,
  languages: string[],
  frameworks: string[],
  compatibilityResult?: {
    compatible: boolean;
    conflicts: Array<{ package: string; selectedVersion: string; conflictsWith: { package: string; constraint: string }; solution: string }>;
    recommendation: string;
  },
  codeFiles?: Array<{ path: string; content: string; size: number }>
): string {
  const selectionsText = selectedVersions
    .map(s => `- ${s.package}: ${s.currentVersion} → ${s.selectedVersion} (${s.category})`)
    .join('\n');

  let conflictsText = 'None';
  if (compatibilityResult?.conflicts?.length) {
    conflictsText = compatibilityResult.conflicts
      .map(c => `- ${c.package}@${c.selectedVersion} conflicts with ${c.conflictsWith.package} (requires ${c.conflictsWith.constraint}). Solution: ${c.solution}`)
      .join('\n');
  }

  // Add code content with smart token management to prevent token overflow
  let codeContext = 'No code files provided';
  if (codeFiles && codeFiles.length > 0) {
    const totalFiles = codeFiles.length;
    const totalSize = codeFiles.reduce((sum, f) => sum + f.size, 0);
    
    // Budget: ~80K chars for code across all files (safe for both GPT-4o and Claude)
    const CODE_BUDGET = 80000;
    const perFileBudget = Math.min(12000, Math.floor(CODE_BUDGET / Math.max(codeFiles.length, 1)));
    
    const chunkedFiles = codeFiles.map(f => {
      const content = chunkFileContent(f.content, perFileBudget, f.path);
      const wasChunked = content.length < f.content.length;
      const chunkNote = wasChunked ? ` (smart-chunked from ${f.size} bytes — imports, signatures, key code preserved)` : '';
      return `### File: ${f.path}${chunkNote}\n\`\`\`\n${content}\n\`\`\``;
    }).join('\n\n');
    
    const totalChunkedSize = chunkedFiles.length;
    
    codeContext = `**Code Files Analyzed: ${totalFiles} files (${Math.round(totalSize / 1024)} KB original)**

IMPORTANT: Below are the contents of all relevant code files. Large files have been smart-chunked to preserve imports, class/function signatures, and key code sections.
Analyze ALL of them thoroughly to identify breaking changes, deprecated APIs, and migration requirements.

${chunkedFiles}`;
  }

  return `Generate a comprehensive RISK ANALYSIS and SUMMARY REPORT for this tech stack upgrade.

**Project Context:**
- Project Type: ${projectType}
- Languages: ${languages.join(', ')}
- Frameworks: ${frameworks.join(', ')}

**User's Selected Version Combinations:**
${selectionsText}

**Compatibility Check Result:**
- Compatible: ${compatibilityResult?.compatible ?? 'N/A'}
- Recommendation: ${compatibilityResult?.recommendation ?? 'N/A'}
- Conflicts: ${conflictsText}

**ACTUAL CODE CONTEXT (analyze how code uses these dependencies):**
${codeContext}

**Your Task - Comprehensive Risk Analysis:**

1. **CODE USAGE ANALYSIS** (Critical - spend most effort here)
   - Scan ALL provided code files for usage of the packages being upgraded
   - Identify EXACT imports, method calls, annotations, configurations
   - Find deprecated APIs that THIS code actually uses
   - Detect patterns that will break (not theoretical - actual usage)
   - Note file paths and approximate line locations

2. **BREAKING CHANGE MAPPING** (Apply your knowledge)
   - For EACH major version jump, list known breaking changes
   - Map those breaking changes to ACTUAL code in this project
   - Example: "Cucumber 6.x moved annotations from cucumber.api.java.* to io.cucumber.java.* - Found in AccessibilityStepDefinitions.java lines 15-20"

3. **IMPACT ASSESSMENT** (Based on actual code)
   - Compile-time breaks (won't build)
   - Runtime breaks (will crash)
   - Behavioral changes (works but differently)
   - Performance implications
   - Security considerations

4. **UPGRADE ORDER & STRATEGY**
   - Correct dependency order (what must upgrade first)
   - The upgradeOrder must reference the exact target versions from "User's Selected Version Combinations" above. If user selected .NET 10.0, write ".NET 7 to .NET 10" — not ".NET 7 to .NET 8".
   - Suggest gradual migration if possible
   - Feature flag opportunities
   - Backward compatibility considerations

5. **FAILURE SCENARIOS** (Specific to this codebase)
   - What will break and why (based on code analysis)
   - Likelihood (based on complexity and change scope)
   - Impact severity (data loss vs minor issue)
   - Recovery procedures

6. **TESTING REQUIREMENTS**
   - Which specific tests need updates
   - New test cases required
   - Integration test considerations
   - Performance test needs

7. **ROLLBACK PLAN**
   - How easy to rollback
   - Database migration reversibility
   - API contract considerations
   - Feature flag strategy

8. **ACTIONABLE NEXT STEPS**
   - Prioritized checklist
   - File-specific changes needed
   - Team coordination needs
   - Timeline considerations

**Analysis Standards:**
✅ Reference SPECIFIC files and approximate line numbers
✅ Use ACTUAL code patterns found in the codebase
✅ Cite official migration guides for each package
✅ Quantify risk (not vague - use percentages or likelihood levels)
✅ Provide code examples for key changes
✅ Consider cascading impacts
✅ Think about production deployment scenarios

**Context You Have:**
- COMPLETE untruncated code files
- Full project structure
- Dependency relationships
- Configuration files

Use ALL of this context. This is a real production system - analyze it like one.

Return the structured JSON as specified.`;
}
