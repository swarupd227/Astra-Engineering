/**
 * Confidence Report Generation Prompts
 * 
 * Generates an enterprise-grade, audit-ready confidence report that answers:
 * "Can this upgraded code go to production safely?"
 */

import type { StackModernizationState } from "../types";

export const CONFIDENCE_REPORT_SYSTEM_PROMPT = `You are a Principal Software Architect and Production Reliability Engineer with 30+ years of experience leading Fortune 500 tech stack upgrades. You have conducted hundreds of production upgrade certifications across .NET, Java, Node.js, React, Angular, Spring Boot, Django, and more.

The report must answer one question: "Can this go to production safely without business, security, performance, or compliance risk?" Every claim must be backed by the data provided — do not invent metrics or evidence.

Your confidence reports are used by CTOs, VPs of Engineering, and audit teams to make go/no-go decisions on production deployments. They are known for being:
- Accurate and balanced (reflect actual outcomes: when upgrade completed and code/tests were generated, say so; do not default to negative language)
- Data-driven (every claim backed by evidence from the actual data provided—use the version and registry data given; do not state that a version "does not exist" if it appears in the provided data, e.g. .NET 10)
- Actionable (every residual risk comes with a mitigation recommendation)
- Executive-ready (clear scoring, clear recommendations)

When the pipeline has produced upgraded files and generated tests, reflect that positively in scope and readiness; only flag real residual risks. You generate MARKDOWN confidence reports. Be thorough but structured.

CRITICAL: The "What Was Changed (Change Log)" section must be populated ONLY from the CHANGE LOG data provided in the user message. Do not invent file paths or change descriptions. If the CHANGE LOG is empty, say "No file-level changes recorded" and leave the table minimal. The risk matrix must use the exact category weights given (Dependencies 15%, Breaking Changes 20%, Test Coverage 20%, Performance 15%, Security 15%, Rollback 10%, Observability 5%). Your report proves: the system is stable, risks are understood, the business is protected, rollback is ready, and the upgrade is measurable.`;

export function buildConfidenceReportPrompt(state: StackModernizationState): string {
  const selections = state.userSelections || [];
  const modifiedFiles = state.modifiedFiles || [];
  const generatedTests = state.generatedTests || [];
  const extractedFiles = state.extractedFiles || [];
  const upgradeTasks = state.upgradeTasks || [];

  // Calculate stats
  const totalFilesInRepo = extractedFiles.length;
  const filesModified = modifiedFiles.length;
  const filesUnchanged = totalFilesInRepo - filesModified;
  const testsGenerated = generatedTests.length;

  // Build change summary
  const changeSummary = modifiedFiles.map((f: any) => {
    const filePath = f.path || f.filePath || 'unknown';
    const originalLen = (f.originalContent || '').length;
    const newLen = (f.content || f.modifiedContent || '').length;
    const changePercent = originalLen > 0 ? Math.round(Math.abs(newLen - originalLen) / originalLen * 100) : 100;
    return `- \`${filePath}\`: ${originalLen} → ${newLen} chars (${changePercent}% change)`;
  }).join('\n');

  // Build change log for "What Was Changed" (file path + change type and package/version per file)
  const changeLogData = modifiedFiles.map((f: any) => {
    const filePath = f.path || f.filePath || 'unknown';
    const changes = (f.changes || []).map((c: any) =>
      `${c.package || 'package'}: ${c.oldVersion || '?'} → ${c.newVersion || '?'}${c.description ? ` (${c.description})` : ''}`
    ).join('; ');
    return { path: filePath, changes: changes || 'Version/config updates' };
  });
  const changeLogText = changeLogData.map((e: { path: string; changes: string }) =>
    `- \`${e.path}\`: ${e.changes}`
  ).join('\n');

  // Build test coverage summary
  const testCoverage = generatedTests.map((t: any) => {
    const cases = t.testCases?.length || 0;
    return `- \`${t.filePath}\`: ${cases} test cases (${t.testFramework})`;
  }).join('\n');

  // Get upgrade selections
  const upgradeTargets = selections.map((s: any) => 
    `- **${s.package}**: ${s.currentVersion || 'unknown'} → ${s.selectedVersion}`
  ).join('\n');

  // Plan summary (truncated)
  const planSummary = (state.planMarkdown || '').length > 3000 
    ? (state.planMarkdown || '').slice(0, 3000) + '\n...(truncated)' 
    : (state.planMarkdown || 'No plan available');

  // Version intelligence (live registry API data)
  const versionInt = state.versionIntelligence || [];
  const versionIntelligenceText = versionInt.length > 0
    ? versionInt.map((v: any) =>
        `- **${v.package}**: current=${v.currentVersion}, latest_stable=${v.latestStable || "?"}, recommended=${v.recommended}${v.latestLTS ? " (LTS)" : ""}, risk=${v.riskLevel}`
      ).join('\n')
    : 'No version intelligence available';

  // Risk report summary
  const riskSummary = state.riskReport 
    ? JSON.stringify(state.riskReport, null, 2).slice(0, 2000) 
    : 'No risk report available';

  // Task completion summary
  const taskSummary = upgradeTasks.length > 0 
    ? upgradeTasks.map((t: any, i: number) => `${i + 1}. ${t.title || t.id} — ${t.status || 'completed'}`).join('\n')
    : 'No tasks tracked';

  // Validation outcome (container execution) when run_and_validate has run
  const validationOutcome =
    state.validationPassed != null && state.validationAttempts != null
      ? `Tests executed in container: ${state.validationPassed ? "passed" : "failed"} after ${state.validationAttempts} attempt(s).`
      : null;

  return `Generate a comprehensive **Upgrade Confidence Report** for this project upgrade.

**PROJECT OVERVIEW:**
- Project Type: ${state.repoProfile?.projectType || 'Unknown'}
- Languages: ${state.repoProfile?.languages?.join(', ') || 'Unknown'}
- Frameworks: ${state.repoProfile?.frameworks?.join(', ') || 'Unknown'}
- Total Files in Repository: ${totalFilesInRepo}
- Files Modified by Upgrade: ${filesModified}
- Files Unchanged: ${filesUnchanged}
- Unit Tests Generated: ${testsGenerated}

**UPGRADE TARGETS:**
${upgradeTargets || 'None specified'}

**VERSION INTELLIGENCE (from live package registry APIs - source of truth for version data):**
${versionIntelligenceText}

**FILES MODIFIED (with change magnitude):**
${changeSummary || 'No files modified'}

**CHANGE LOG (use this to fill section "What Was Changed"):**
${changeLogText || 'No changes'}

**GENERATED TEST COVERAGE:**
${testCoverage || 'No tests generated'}

**UPGRADE PLAN SUMMARY:**
${planSummary}

**RISK ANALYSIS:**
${riskSummary}

**TASK EXECUTION:**
${taskSummary}
${validationOutcome ? `\n**VALIDATION (CONTAINER EXECUTION):**\n${validationOutcome}\nInclude a "Validation (Container Execution)" section with this outcome.` : ""}

---

**GENERATE THE FOLLOWING CONFIDENCE REPORT IN MARKDOWN:**

# Upgrade Confidence Report

## 1. Executive Summary
- **Overall Confidence Score**: [Low / Medium / High / Production-Ready] with percentage (0-100%)
- **Risk Classification**: [Technical / Security / Compliance / Performance / Rollback as applicable]
- **Go / No-Go Recommendation**: [Based on evidence]
- **Known Residual Risks**: [List top 3-5]
- **Rollback Readiness Status**: [Assessment]

## 2. What Was Changed (Change Log)
Produce a table or list from the CHANGE LOG data above. For each modified file include:
- **File path**
- **Change type** (e.g. TargetFramework, Package version, Deprecated API replacement, Config)
- **Brief description** (one line; use the package/version changes from the data)
Do not invent entries — use only the file paths and changes provided in the CHANGE LOG section.

## 3. Current vs Target State Clarity
- Table: Current version (runtime, framework, SDK) vs Target version (LTS/stable)
- End-of-support status of old version (if known from plan/risk)
- Breaking change summary from upgrade scope
- Deprecated APIs addressed in this codebase

## 4. Upgrade Scope & Impact
- Total files analyzed vs modified vs unchanged
- Code change magnitude (lines/chars changed, % of codebase affected)

## 5. Dependency Risk Analysis
Score: [X/10]
- Direct dependencies affected
- Transitive dependency risks
- Known incompatibilities
- Security advisories relevant to target versions

## 6. Breaking Change Assessment
Score: [X/10]
- Configuration changes required
- API signature changes
- Behavioral changes (async, serialization, middleware)
- Deprecated API replacements made
- Deprecated APIs still remaining (if any)

## 7. Code Modification Confidence
Score: [X/10]
- Files modified: categorize by risk level (low/medium/high)
- Core business logic modified? Entry points? Database layer? Auth/security code?
- Change localization (how contained are the changes?)

## 8. Test Coverage & Quality
Score: [X/10]
- Total tests generated: ${testsGenerated}
- Test coverage targets and test types (functional, edge, error handling)
- Gaps (files modified but no tests generated)
- Recommendation for additional manual testing

## 9. Performance Impact Assessment
Score: [X/10]
- Expected impact on startup time, runtime, memory, build time
- Areas requiring performance benchmarking

## 10. Security Validation
Score: [X/10]
- Authentication flow integrity, encryption/TLS, CVEs in target versions
- Security configuration and secrets management impact

## 11. Database & Integration Compatibility
Score: [X/10]
- DB driver/ORM version changes
- Migration and rollback compatibility (from plan/risk if available)
- Backward compatibility with existing schema

## 12. Deployment & Rollback Readiness
Score: [X/10]
- Build pipeline, container/runtime compatibility
- Rollback strategy feasibility, feature flag recommendations

## 13. Observability & Monitoring Readiness
Score: [X/10]
- Logging, APM, health checks, metrics/alerts
- Impact of upgrade on monitoring; production blind spots

## 14. Business Impact Validation
- Critical user journeys, integrations, background jobs that may be affected
- Recommend manual validation of revenue-related and third-party flows

## 15. Risk Matrix
Use these exact weights. Fill scores from the section scores above.
| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Dependencies | 15% | X/10 | X |
| Breaking Changes | 20% | X/10 | X |
| Test Coverage | 20% | X/10 | X |
| Performance | 15% | X/10 | X |
| Security | 15% | X/10 | X |
| Rollback | 10% | X/10 | X |
| Observability | 5% | X/10 | X |
| **TOTAL** | **100%** | | **X/100** |

## 16. Production Confidence Level Definitions
- **Production-Ready**: All tests passing, no critical vulns, performance stable, rollback validated, monitoring confirmed.
- **High**: Same as above with minor caveats documented.
- **Medium**: Minor performance variance, some deprecated APIs still present, partial rollback validation.
- **Low**: Limited testing, major dependency jumps, security concerns, or no rollback path.

## 17. Recommendations
### Immediate Actions (Before Deployment)
[Numbered list]

### Post-Deployment Monitoring
[Numbered list]

### Future Improvements
[Numbered list]

## 18. Final Certification

**Confidence Level**: [LOW / MEDIUM / HIGH / PRODUCTION-READY]
**Recommendation**: [GO / NO-GO / CONDITIONAL GO]
**Conditions (if conditional)**: [List]

---
*Generated by DevX Stack Modernization Confidence Engine v2.0*
*Report Date: ${new Date().toISOString()}*

**IMPORTANT RULES:**
- Base ALL scores on the ACTUAL data provided above (files modified, tests generated, upgrade targets, CHANGE LOG).
- Do NOT invent data — if information is missing, score that category lower and note the gap.
- Be accurate and balanced: when files were modified and tests generated successfully, reflect that in scope and confidence; do not default to overly negative wording.
- **Scoring when upgrade completed:** When the pipeline has produced modified files and generated tests, the overall confidence score and section scores should reflect that the upgrade was executed successfully. Do not default to Low or very low scores (e.g. below 40) unless the data clearly indicates failure, critical errors, or no tests. Successful execution with tests and changes warrants at least Medium (40–69) or High (70+) where the data supports it.
- Use the version and upgrade data provided; do not claim a version "does not exist" or "is not available" if it appears in the data (e.g. .NET 10 is a valid target in the registry).
- Every residual risk must have a mitigation recommendation.
- The risk matrix scores must be consistent with the section scores.`;
}
