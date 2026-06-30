/**
 * Stack Modernization - Risk Report Agent
 * LLM generates comprehensive risk analysis and summary for user's selected version combination
 */

import type { StackModernizationState, VersionSelection, RiskReportResult } from "../types";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";
import { RISK_REPORT_SYSTEM_PROMPT, buildRiskReportPrompt } from "../prompts/risk-report";

export type { RiskReportResult };

export async function executeRiskReportAgent(
  state: StackModernizationState,
  selections: VersionSelection[]
): Promise<RiskReportResult> {

  const { client, model, provider } = getLLMClient(state.llmProvider);

  const selectedVersions = selections.map(s => ({
    package: s.package,
    currentVersion: s.currentVersion,
    selectedVersion: s.selectedVersion,
    category: s.category || "library"
  }));

  // Extract ALL relevant code files - NO TRUNCATION, NO ARBITRARY LIMITS
  // Strategy: Find files that actually use the packages being upgraded
  const selectedPackages = selections.map(s => s.package.toLowerCase());
  
  const allCodeFiles = (state.extractedFiles || [])
    .filter(f => {
      const ext = (f.relativePath || f.fullPath || '').toLowerCase();
      return ext.endsWith('.js') || ext.endsWith('.ts') || ext.endsWith('.tsx') || 
             ext.endsWith('.jsx') || ext.endsWith('.py') || ext.endsWith('.java') || 
             ext.endsWith('.cs') || ext.endsWith('.cpp') || ext.endsWith('.go') ||
             ext.endsWith('.vue') || ext.endsWith('.rb') || ext.endsWith('.php');
    })
    .map(f => ({
      path: f.relativePath || f.fullPath || 'unknown',
      content: f.content || '',
      size: (f.content || '').length
    }))
    .filter(f => f.content.length > 0);
  
  // Prioritize files that actually import/use the packages being upgraded
  const relevantFiles = allCodeFiles.filter(f => {
    const content = f.content.toLowerCase();
    return selectedPackages.some(pkg => 
      content.includes(`import`) && content.includes(pkg) ||
      content.includes(`require`) && content.includes(pkg) ||
      content.includes(`from ${pkg}`) ||
      content.includes(`@${pkg}`) // Java annotations
    );
  });
  
  // If no relevant files found (e.g., manifest-only upload), use all code files
  const filesToAnalyze = relevantFiles.length > 0 ? relevantFiles : allCodeFiles;
  
  // Pass code files to LLM (buildRiskReportPrompt handles smart chunking)
  const codeFiles = filesToAnalyze.map(f => ({
    path: f.path,
    content: f.content,
    size: f.size
  }));
  
  const totalSize = codeFiles.reduce((sum, f) => sum + f.size, 0);

  const userPrompt = buildRiskReportPrompt(
    selectedVersions,
    state.repoProfile?.projectType || "unknown",
    state.repoProfile?.languages || [],
    (state.repoProfile?.frameworks || []).map(f => typeof f === 'string' ? f : f.name) as string[],
    state.compatibilityCheck ? {
      compatible: state.compatibilityCheck.compatible,
      conflicts: state.compatibilityCheck.conflicts.map(c => ({
        package: c.package,
        selectedVersion: c.selectedVersion,
        conflictsWith: c.conflictsWith,
        solution: c.solution
      })),
      recommendation: state.compatibilityCheck.recommendation
    } : undefined,
    codeFiles // CRITICAL: Pass actual code files to LLM
  );

  const budgetBlock = buildBudgetConstraint("riskReport", "json");
  const requestParams: any = {
    model,
    messages: [
      { role: "system", content: `${budgetBlock}\n\n${RISK_REPORT_SYSTEM_PROMPT}` },
      { role: "user", content: userPrompt }
    ],
    temperature: 0
  };

  if (provider === "azure-openai") {
    requestParams.response_format = { type: "json_object" };
  }
  requestParams.max_tokens = safeMaxTokens(AGENT_TOKEN_BUDGETS.riskReport, model);

  const response = await trackedLLMCall(client, requestParams, { analysisId: state.analysisId, phase: "planning", agent: "RiskReport" });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Risk report LLM returned empty response");

  let cleaned = content.trim();
  
  // Remove markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  }
  
  // Remove markdown headers and any leading non-JSON content
  if (cleaned.startsWith("#")) {
    const jsonStart = Math.min(
      cleaned.indexOf('{') !== -1 ? cleaned.indexOf('{') : Infinity,
      cleaned.indexOf('[') !== -1 ? cleaned.indexOf('[') : Infinity
    );
    if (jsonStart !== Infinity) {
      cleaned = cleaned.substring(jsonStart);
    }
  }
  
  // Clean any trailing non-JSON content
  const lastBrace = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (lastBrace !== -1) {
    cleaned = cleaned.substring(0, lastBrace + 1);
  }
  

  const parsed = JSON.parse(cleaned) as RiskReportResult;

  // Post-process: enforce user-selected versions in upgradeOrder
  // Build a lookup map: package name keywords → user-selected target version
  const selectionMap = selections.map(sel => ({
    pkg: (sel.package || "").toLowerCase(),
    target: (sel.selectedVersion || "").replace(/^v/i, "").trim(),
    current: (sel.currentVersion || "").replace(/^v/i, "").trim(),
  })).filter(s => s.target && s.pkg);

  if (parsed.upgradeOrder && Array.isArray(parsed.upgradeOrder)) {
    parsed.upgradeOrder = parsed.upgradeOrder.map(item => {
      let fixed = item;
      for (const sel of selectionMap) {
        const itemLower = fixed.toLowerCase();
        const keywords = [sel.pkg, sel.pkg.replace(/\./g, " "), sel.pkg.replace(/\./g, "")];
        const matches = keywords.some(kw => itemLower.includes(kw));
        if (!matches) continue;

        if (sel.pkg.includes(".net") || sel.pkg.includes("dotnet")) {
          const major = parseInt(sel.target.split(".")[0], 10);
          if (!isNaN(major)) {
            // Fix "to .NET X" → "to .NET <correct>"
            fixed = fixed.replace(
              /(?:to|→|->|=>)\s*\.?NET\s*\d+(\.\d+)*/gi,
              `to .NET ${major}`
            );
          }
        } else {
          // Generic: replace version number after "to"/"→" that doesn't match user's target
          fixed = fixed.replace(
            /(?:to|→|->|=>)\s*v?(\d+\.\d+[\d.]*)/gi,
            (match, ver) => {
              if (ver === sel.target) return match;
              return match.replace(ver, sel.target);
            }
          );
        }
      }
      return fixed;
    });
  }

  // Post-process: enforce user-selected versions in breakingChanges
  if (parsed.breakingChanges && Array.isArray(parsed.breakingChanges)) {
    for (const bc of parsed.breakingChanges) {
      for (const sel of selections) {
        const pkg = sel.package || "";
        const targetVer = (sel.selectedVersion || "").replace(/^v/i, "").trim();
        if (!targetVer || !pkg) continue;
        if (bc.package?.toLowerCase().includes(pkg.toLowerCase())) {
          bc.toVersion = targetVer;
        }
      }
    }
  }


  return parsed;
}
