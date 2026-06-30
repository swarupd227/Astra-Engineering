/**
 * Breaking Changes Preview Agent
 * Pre-analyzes potential breaking changes between current and latest versions
 * BEFORE the user makes version selections. This gives early visibility.
 */

import type { StackModernizationState, BreakingChangesPreview } from "../types";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";

export async function executeBreakingChangesPreviewAgent(
  state: StackModernizationState
): Promise<BreakingChangesPreview> {
  const versionRecs = state.versionIntelligence || [];
  if (versionRecs.length === 0) {
    return { totalBreakingChanges: 0, byPackage: [], severityDistribution: { minor: 0, major: 0, critical: 0 } };
  }

  const packagesWithUpgrade = versionRecs.filter(
    (v) => v.currentVersion && v.recommended && v.currentVersion !== v.recommended
  );

  if (packagesWithUpgrade.length === 0) {
    return { totalBreakingChanges: 0, byPackage: [], severityDistribution: { minor: 0, major: 0, critical: 0 } };
  }

  const byPackage: BreakingChangesPreview["byPackage"] = [];

  try {
    const { client, model } = getLLMClient(state.llmProvider);

    const packageList = packagesWithUpgrade
      .slice(0, 20)
      .map((v) => `- ${v.package}: ${v.currentVersion} -> ${v.recommended}`)
      .join("\n");

    const budgetBlock = buildBudgetConstraint("breakingChanges", "json");
    const resp = await trackedLLMCall(client, {
      model,
      messages: [
        {
          role: "system",
          content: `${budgetBlock}\n\nYou are a software upgrade expert. For each package version upgrade, identify the number of known breaking changes and their severity. Return JSON array:
[{ "package": "name", "breakingChangesCount": N, "severity": "minor"|"major"|"critical", "highlights": ["change1", "change2"] }]
Return ONLY valid JSON array.`,
        },
        {
          role: "user",
          content: `Analyze breaking changes for these upgrades:\n${packageList}`,
        },
      ],
      temperature: 0,
      max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.breakingChanges, model),
    }, { analysisId: state.analysisId, phase: "assessment", agent: "BreakingChanges" });

    const text = resp.choices[0]?.message?.content?.trim() || "[]";
    try {
      let clean = text;
      if (clean.startsWith("```")) clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const matchedPkg = packagesWithUpgrade.find(
            (v) => v.package.toLowerCase() === (item.package || "").toLowerCase()
          );
          byPackage.push({
            package: item.package || "Unknown",
            currentVersion: matchedPkg?.currentVersion || "unknown",
            latestVersion: matchedPkg?.recommended || "unknown",
            breakingChangesCount: item.breakingChangesCount || 0,
            severity: item.severity || "minor",
            highlights: Array.isArray(item.highlights) ? item.highlights.slice(0, 5) : [],
          });
        }
      }
    } catch { /* ignore parse failure */ }
  } catch (e) {
    console.warn("[BreakingChangesPreview] LLM analysis failed:", e instanceof Error ? e.message : e);
    // Fallback: estimate from major version jumps
    for (const v of packagesWithUpgrade) {
      const curMajor = parseInt(v.currentVersion.split(".")[0]) || 0;
      const recMajor = parseInt(v.recommended.split(".")[0]) || 0;
      const diff = recMajor - curMajor;
      if (diff > 0) {
        byPackage.push({
          package: v.package,
          currentVersion: v.currentVersion,
          latestVersion: v.recommended,
          breakingChangesCount: diff * 3,
          severity: diff >= 2 ? "critical" : "major",
          highlights: [`Major version jump from ${curMajor} to ${recMajor}`],
        });
      }
    }
  }

  const severityDistribution = {
    minor: byPackage.filter((b) => b.severity === "minor").reduce((s, b) => s + b.breakingChangesCount, 0),
    major: byPackage.filter((b) => b.severity === "major").reduce((s, b) => s + b.breakingChangesCount, 0),
    critical: byPackage.filter((b) => b.severity === "critical").reduce((s, b) => s + b.breakingChangesCount, 0),
  };

  const totalBreakingChanges = byPackage.reduce((s, b) => s + b.breakingChangesCount, 0);

  return { totalBreakingChanges, byPackage, severityDistribution };
}
