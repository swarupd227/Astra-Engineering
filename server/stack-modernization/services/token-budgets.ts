/**
 * Centralized Token Budget Registry
 *
 * Every agent's max_tokens output budget is defined here.
 * One place to tune all budgets — no hunting through 16+ files.
 *
 * These are OUTPUT token budgets only.
 * Input tokens are determined by prompt size (code files, system prompt, context).
 */

export const AGENT_TOKEN_BUDGETS = {
  // Assessment phase (structured JSON output, small)
  repoProfiler:        4000,
  dependencyGraph:     4000,
  versionIntelligence: 8000,
  assessment:         12000,
  breakingChanges:     4000,
  codeQuality:         3000,
  securityAssessment:  2000,

  // Planning phase (markdown reports, medium)
  compatibilityCheck:  6000,
  riskReport:          8000,
  planning:            8000,

  // Task planning (large JSON array)
  taskPlanner:        16000,

  // Execution phase (full source code output)
  codeUpgrade:        16000,
  codeReviewFix:      12000,
  codeGenLoopPlan:    16000,
  codeGenLoopTriage:  16000,
  codeGenLoopUpgrade: 16000,

  // Test generation (full test file output)
  testGeneration:     16000,
  testGenSummary:     12000,

  // Validation (fix code output)
  fixValidation:      32000,
} as const;

export type AgentBudgetKey = keyof typeof AGENT_TOKEN_BUDGETS;

type OutputFormat = "json" | "markdown" | "code";

/**
 * Build a budget constraint block to inject into an agent's prompt.
 * Tells the LLM exactly how much output space it has and how to manage it.
 */
export function buildBudgetConstraint(
  agentKey: AgentBudgetKey,
  format: OutputFormat,
): string {
  const budget = AGENT_TOKEN_BUDGETS[agentKey];
  const charBudget = Math.floor(budget * 4);

  const header = `## OUTPUT BUDGET CONSTRAINT\nYour response MUST fit within ~${budget} tokens (~${charBudget} characters). Plan your response size accordingly.`;

  if (format === "json") {
    return [
      header,
      "- If the result set is too large, prioritize the most important/impactful items",
      "- ALWAYS close your JSON properly — never let it get truncated",
      "- If you are running out of space, stop adding items and close the array/object with ] or }",
      "- Prefer concise descriptions over verbose explanations",
    ].join("\n");
  }

  if (format === "markdown") {
    return [
      header,
      "- Be concise but comprehensive — prioritize actionable insights over verbose explanations",
      "- Use bullet points and tables over long paragraphs",
      "- If the codebase has many issues, group similar ones and prioritize by severity",
      "- ALWAYS complete your markdown structure — never leave sections half-written",
    ].join("\n");
  }

  // format === "code"
  return [
    header,
    "- If a file is very large, focus on the changed sections and include sufficient surrounding context",
    "- ALWAYS close your JSON response properly with complete file content",
    "- If you cannot fit all files, process the highest-priority ones and note which were deferred",
    "- Do NOT pad output with comments or explanations — maximize code content",
  ].join("\n");
}
