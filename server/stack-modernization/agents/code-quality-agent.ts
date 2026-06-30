/**
 * Code Quality Agent
 * Analyzes code complexity, maintainability, patterns, and tech debt.
 */

import type { StackModernizationState, CodeQualityResult } from "../types";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS, buildBudgetConstraint } from "../services/token-budgets";

function computeStaticMetrics(
  files: Array<{ relativePath: string; content: string }>
): Pick<CodeQualityResult, "complexityMetrics"> & { fileCount: number } {
  const codeExts = new Set(["js", "ts", "tsx", "jsx", "py", "cs", "java", "go", "rb"]);
  const codeFiles = files.filter((f) => {
    const ext = f.relativePath.split(".").pop()?.toLowerCase() || "";
    return codeExts.has(ext) && f.content.length > 10;
  });

  let totalLines = 0;
  let totalCommentLines = 0;
  let maxComplexity = 0;
  let totalComplexity = 0;
  let duplicateEstimate = 0;

  const lineHashes = new Map<string, number>();

  for (const file of codeFiles) {
    const lines = file.content.split("\n");
    totalLines += lines.length;

    let fileComplexity = 1;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
        totalCommentLines++;
      }
      if (/\b(if|else if|elif|for|while|catch|case|&&|\|\||\?\s)/g.test(trimmed)) {
        fileComplexity++;
      }
      if (trimmed.length > 15) {
        const hash = trimmed;
        lineHashes.set(hash, (lineHashes.get(hash) || 0) + 1);
      }
    }
    totalComplexity += fileComplexity;
    maxComplexity = Math.max(maxComplexity, fileComplexity);
  }

  let dupLines = 0;
  for (const count of lineHashes.values()) {
    if (count > 2) dupLines += count - 1;
  }
  duplicateEstimate = totalLines > 0 ? Math.round((dupLines / totalLines) * 100) : 0;

  const avgComplexity = codeFiles.length > 0 ? Math.round(totalComplexity / codeFiles.length) : 0;
  const commentRatio = totalLines > 0 ? Math.round((totalCommentLines / totalLines) * 100) / 100 : 0;

  return {
    fileCount: codeFiles.length,
    complexityMetrics: {
      averageCyclomaticComplexity: avgComplexity,
      maxCyclomaticComplexity: maxComplexity,
      linesOfCode: totalLines,
      codeToCommentRatio: commentRatio,
      duplicateCodePercentage: duplicateEstimate,
    },
  };
}

export async function executeCodeQualityAgent(
  state: StackModernizationState
): Promise<CodeQualityResult> {
  const staticMetrics = computeStaticMetrics(state.extractedFiles || []);
  const debtItems: CodeQualityResult["debtItems"] = [];
  const patterns: CodeQualityResult["patterns"] = {
    designPatterns: [],
    antiPatterns: [],
    testCoverage: "none",
  };

  // Determine test coverage level from file structure
  const testFiles = (state.extractedFiles || []).filter((f) => {
    const p = f.relativePath.toLowerCase();
    return p.includes("test") || p.includes("spec") || p.includes("__tests__");
  });
  const codeFileCount = staticMetrics.fileCount;
  const testRatio = codeFileCount > 0 ? testFiles.length / codeFileCount : 0;
  patterns.testCoverage = testRatio > 0.5 ? "high" : testRatio > 0.2 ? "moderate" : testRatio > 0 ? "low" : "none";

  // LLM analysis for patterns and debt
  try {
    const { client, model } = getLLMClient(state.llmProvider);
    const sampleFiles = (state.extractedFiles || [])
      .filter((f) => ["js", "ts", "py", "cs", "java"].includes(f.relativePath.split(".").pop()?.toLowerCase() || ""))
      .slice(0, 8)
      .map((f) => `--- ${f.relativePath} ---\n${f.content.slice(0, 3000)}`)
      .join("\n\n");

    if (sampleFiles.length > 200) {
      const budgetBlock = buildBudgetConstraint("codeQuality", "json");
      const resp = await trackedLLMCall(client, {
        model,
        messages: [
          {
            role: "system",
            content: `${budgetBlock}\n\nYou are a code quality expert. Analyze the code and return JSON:
{
  "designPatterns": ["pattern1"],
  "antiPatterns": ["anti-pattern1"],
  "debtItems": [{ "type": "code-smell"|"anti-pattern"|"deprecated-usage"|"tech-debt", "description": "...", "file": "...", "severity": "low"|"medium"|"high" }],
  "maintainabilityIndex": 0-100
}
Return ONLY valid JSON.`,
          },
          { role: "user", content: `Analyze code quality:\n\n${sampleFiles}` },
        ],
        temperature: 0,
        max_tokens: safeMaxTokens(AGENT_TOKEN_BUDGETS.codeQuality, model),
      }, { analysisId: state.analysisId, phase: "assessment", agent: "CodeQuality" });

      const text = resp.choices[0]?.message?.content?.trim() || "";
      try {
        let clean = text;
        if (clean.startsWith("```")) clean = clean.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
        const parsed = JSON.parse(clean);
        if (Array.isArray(parsed.designPatterns)) patterns.designPatterns = parsed.designPatterns;
        if (Array.isArray(parsed.antiPatterns)) patterns.antiPatterns = parsed.antiPatterns;
        if (Array.isArray(parsed.debtItems)) {
          for (const item of parsed.debtItems) {
            debtItems.push({
              type: item.type || "tech-debt",
              description: item.description || "",
              file: item.file || "",
              severity: item.severity || "medium",
            });
          }
        }
        if (typeof parsed.maintainabilityIndex === "number") {
          // use LLM value, capped
        }
      } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn("[CodeQuality] LLM analysis failed:", e instanceof Error ? e.message : e);
  }

  // Compute overall scores
  const cm = staticMetrics.complexityMetrics;
  let maintainabilityIndex = 80;
  if (cm.averageCyclomaticComplexity > 15) maintainabilityIndex -= 20;
  else if (cm.averageCyclomaticComplexity > 8) maintainabilityIndex -= 10;
  if (cm.duplicateCodePercentage > 20) maintainabilityIndex -= 15;
  else if (cm.duplicateCodePercentage > 10) maintainabilityIndex -= 8;
  if (patterns.antiPatterns.length > 3) maintainabilityIndex -= 10;
  maintainabilityIndex -= Math.min(debtItems.filter((d) => d.severity === "high").length * 5, 20);
  maintainabilityIndex = Math.max(10, Math.min(100, maintainabilityIndex));

  let qualityScore = maintainabilityIndex;
  if (patterns.testCoverage === "high") qualityScore += 10;
  else if (patterns.testCoverage === "none") qualityScore -= 10;
  qualityScore = Math.max(10, Math.min(100, qualityScore));

  return {
    qualityScore,
    maintainabilityIndex,
    complexityMetrics: cm,
    debtItems,
    patterns,
  };
}
