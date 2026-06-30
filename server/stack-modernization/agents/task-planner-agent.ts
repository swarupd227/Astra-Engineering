/**
 * Stack Modernization - Task Planner Agent
 * Takes the detailed plan and breaks it down into executable tasks
 * 
 * Outputs:
 * - tasks.md: Detailed task list with verification criteria
 * - Task execution metadata for the Code Upgrade Agent
 */

import type { 
  StackModernizationState
} from "../types";
import { getLLMClient } from "../services/llm-selector";
import { safeMaxTokens } from "../services/token-manager";
import { trackedLLMCall } from "../services/llm-call-tracker";
import { AGENT_TOKEN_BUDGETS } from "../services/token-budgets";
import { 
  TASK_PLANNER_SYSTEM_PROMPT, 
  buildTaskPlannerPrompt 
} from "../prompts/task-planner-prompts";
import { formatDocsForTaskPlanning } from "../services/migration-doc-formatter";

// ═══════════════════════════════════════════════════════════════
// ROBUST JSON ARRAY EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Multi-strategy parser for extracting a JSON task array from LLM output.
 * LLMs often wrap JSON in markdown fences, add explanatory text, or truncate
 * the output. This tries progressively more lenient strategies.
 */
function robustParseTaskArray(raw: string): UpgradeTask[] {
  // Helper: if parsed is an object with an array property, unwrap it
  // (GPT json_object mode returns { "tasks": [...] } instead of bare [...])
  const unwrap = (parsed: any): UpgradeTask[] | null => {
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed)) {
        if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
          return parsed[key];
        }
      }
    }
    return null;
  };

  // Strategy 1: Direct parse (ideal case — LLM returned pure JSON)
  try {
    const parsed = JSON.parse(raw);
    const result = unwrap(parsed);
    if (result) { console.log("[TaskPlanner] Parse strategy: direct"); return result; }
  } catch { /* continue */ }

  // Strategy 2: Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceStripped = raw
    .replace(/^```(?:json|JSON)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();
  try {
    const parsed = JSON.parse(fenceStripped);
    const result = unwrap(parsed);
    if (result) { console.log("[TaskPlanner] Parse strategy: fence-strip"); return result; }
  } catch { /* continue */ }

  // Strategy 3: Find the first '[' and extract balanced brackets
  const arrayJson = extractBalancedArray(raw);
  if (arrayJson) {
    try {
      const parsed = JSON.parse(arrayJson);
      const result = unwrap(parsed);
      if (result) { console.log("[TaskPlanner] Parse strategy: balanced-array"); return result; }
    } catch { /* continue */ }
  }

  // Strategy 3.5: TRUNCATION RECOVERY (must run BEFORE balanced-object)
  // When finish_reason=max_tokens, the JSON array is cut mid-stream.
  // Find the last complete {} object in the array and close it.
  // This MUST run before balanced-object because balanced-object would extract
  // just the first {} and unwrap its internal arrays as "tasks" — producing garbage.
  const firstBracket = raw.indexOf("[");
  if (firstBracket !== -1) {
    const truncated = recoverTruncatedArray(raw.slice(firstBracket));
    if (truncated) {
      try {
        const parsed = JSON.parse(truncated);
        const result = unwrap(parsed);
        if (result) { console.log("[TaskPlanner] Parse strategy: truncation-recovery"); return result; }
      } catch { /* continue */ }
    }
  }

  // Strategy 4: Find the first '{' and extract balanced braces (for wrapped object like { "tasks": [...] })
  const objStart = raw.indexOf("{");
  if (objStart !== -1) {
    const objJson = extractBalancedBraces(raw, objStart);
    if (objJson) {
      try {
        const parsed = JSON.parse(objJson);
        const result = unwrap(parsed);
        if (result) { console.log("[TaskPlanner] Parse strategy: balanced-object"); return result; }
      } catch { /* continue */ }
    }
  }

  // Strategy 5: Look for individual JSON objects and collect them into an array
  const objects = extractIndividualObjects(raw);
  if (objects.length > 0) { console.log("[TaskPlanner] Parse strategy: individual-objects"); return objects; }

  return [];
}

function extractBalancedBraces(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractBalancedArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") depth++;
    if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function recoverTruncatedArray(text: string): string | null {
  let depth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escape = false;
  let lastCompleteObject = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0 && bracketDepth === 1) {
        lastCompleteObject = i;
      }
    }
    if (ch === "[") bracketDepth++;
    if (ch === "]") bracketDepth--;
  }

  if (lastCompleteObject === -1) return null;

  // Truncate after the last complete object and close the array
  let patched = text.slice(0, lastCompleteObject + 1);
  // Remove any trailing comma
  patched = patched.replace(/,\s*$/, "");
  patched += "]";

  try { JSON.parse(patched); return patched; } catch { return null; }
}

function extractIndividualObjects(text: string): UpgradeTask[] {
  const results: UpgradeTask[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const objStart = text.indexOf("{", searchFrom);
    if (objStart === -1) break;

    let depth = 0;
    let inString = false;
    let escape = false;
    let objEnd = -1;

    for (let i = objStart; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"' && !escape) { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) { objEnd = i; break; }
      }
    }

    if (objEnd === -1) break;

    try {
      const obj = JSON.parse(text.slice(objStart, objEnd + 1));
      if (obj.id && obj.title && (obj.steps || obj.description)) {
        results.push(obj);
      }
    } catch { /* skip malformed object */ }

    searchFrom = objEnd + 1;
  }

  return results;
}

export interface UpgradeTask {
  id: string;
  title: string;
  description: string;
  phase: string;
  riskLevel: "low" | "medium" | "high";
  estimatedTime: string;
  autoFixable: boolean;
  steps: string[];
  verificationCriteria: string[];
  affectedFiles: string[];
  codeExample?: {
    before: string;
    after: string;
  };
  status: "pending" | "in_progress" | "completed" | "failed";
}

/**
 * Execute task planning phase
 */
export async function executeTaskPlannerAgent(
  state: StackModernizationState
): Promise<StackModernizationState> {
  
  try {
    // Generate tasks based on plan, risk report, and compatibility analysis
    const tasks = await generateUpgradeTasks(state);

    // Debug: log raw task structure to identify missing fields
    console.log(`[TaskPlanner] Generated ${tasks.length} tasks. Sample fields:`,
      tasks.slice(0, 2).map((t, i) => ({
        index: i,
        hasId: !!t.id, id: t.id,
        hasTitle: !!t.title, titleLen: t.title?.length ?? 0, titlePreview: t.title?.slice(0, 50),
        hasDesc: !!t.description, descLen: t.description?.length ?? 0,
        hasSteps: Array.isArray(t.steps), stepsLen: t.steps?.length ?? 0,
        keys: Object.keys(t).join(","),
      }))
    );
    
    // Generate tasks.md markdown file
    const tasksMarkdown = generateTasksMarkdown(tasks);
    
    // Safeguard: ensure every task has a non-empty title and id
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (!t.id) t.id = `TASK-${String(i + 1).padStart(3, "0")}`;
      if (!t.title || typeof t.title !== "string" || t.title.trim() === "") {
        // Derive title from description or phase
        if (t.description && typeof t.description === "string" && t.description.length > 0) {
          t.title = t.description.slice(0, 100).split("\n")[0].trim();
          if (t.title.length > 80) t.title = t.title.slice(0, 77) + "...";
        } else {
          t.title = `Upgrade Task ${i + 1}`;
        }
        console.warn(`[TaskPlanner] Task ${t.id} had empty title — derived: "${t.title}"`);
      }
      if (!t.riskLevel) t.riskLevel = "medium";
      if (!t.status) t.status = "pending";
      if (!t.steps) t.steps = [];
      if (!t.verificationCriteria) t.verificationCriteria = [];
      if (!t.affectedFiles) t.affectedFiles = [];
    }

    // Update state
    const finalState: StackModernizationState = {
      ...state,
      upgradeTasks: tasks,
      tasksMarkdown,
      currentStage: "tasks_ready",
      status: "in_progress",
    };
    
    return finalState;
    
  } catch (error) {
    console.error("[TaskPlanner] ❌ Error:", error);
    throw error;
  }
}

/**
 * Generate upgrade tasks using LLM analysis
 */
async function generateUpgradeTasks(state: StackModernizationState): Promise<UpgradeTask[]> {
  const llmClient = getLLMClient(state.llmProvider);
  const { client, model } = llmClient;

  // The prompt already tells the LLM its exact output budget — use the model's safe max
  const outputTokenBudget = safeMaxTokens(16000, model);
  const prompt = buildTaskPlannerPrompt(state, model);

  const migrationDocs = state.migrationDocs ?? {};
  let docsContext = "";
  if (Object.keys(migrationDocs).length > 0) {
    docsContext = `\n\n${formatDocsForTaskPlanning(migrationDocs)}`;
  }

  let couplingContext = "";
  if (state.couplingRegistry && state.couplingRegistry.length > 0) {
    couplingContext = `\n\nFILE COUPLING GROUPS (files in the same group MUST be in the same task — never split them across tasks):\n${state.couplingRegistry.map(g => `- ${g.name}: ${g.files.join(", ")} — Rule: ${g.rule}`).join("\n")}`;
  }

  const systemContent = TASK_PLANNER_SYSTEM_PROMPT + docsContext + couplingContext;

  // Retry up to 2 times on JSON parse failure (same budget — prompt already manages sizing)
  const MAX_ATTEMPTS = 2;
  let lastRawContent = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemContent },
      { role: "user", content: prompt },
    ];

    // On retry, feed back the broken response and ask for a clean JSON-only redo
    if (attempt > 1 && lastRawContent) {
      messages.push({
        role: "assistant",
        content: lastRawContent,
      });
      messages.push({
        role: "user",
        content: `Your previous response could not be parsed as valid JSON. Output ONLY a raw JSON array — start with [ and end with ]. No markdown fences, no explanations. Keep the same tasks but fix the JSON format. Begin with [ immediately.`,
      });
    }

    console.log(`[TaskPlanner] Attempt ${attempt}/${MAX_ATTEMPTS} — model=${model}, max_tokens=${outputTokenBudget}`);
    
    try {
      const response = await trackedLLMCall(client, {
        model,
        messages,
        temperature: 0,
        max_tokens: outputTokenBudget,
      }, { analysisId: state.analysisId, phase: "tasks", agent: "TaskPlanner" });

      const rawContent = response.choices[0]?.message?.content?.trim() || "[]";
      const finishReason = response.choices[0]?.finish_reason || "unknown";
      lastRawContent = rawContent;

      console.log(`[TaskPlanner] Attempt ${attempt} — response: ${rawContent.length} chars, finish_reason: ${finishReason}`);
      if (finishReason === "length") {
        console.warn(`[TaskPlanner] ⚠️ Response truncated despite budget instruction. Attempting truncation recovery...`);
      }

      const tasks = robustParseTaskArray(rawContent);
      if (tasks.length > 0) {
        console.log(`[TaskPlanner] ✅ Parsed ${tasks.length} tasks on attempt ${attempt}`);

        const selections = state.userSelections || [];
        if (selections.length > 0) {
          const sanitized = sanitizeTaskVersions(tasks, selections);
          return enforceTaskTitleVersions(sanitized, selections);
        }
        return tasks;
      }

      console.warn(`[TaskPlanner] Attempt ${attempt} — parse returned 0 tasks${attempt < MAX_ATTEMPTS ? ", retrying with JSON fix instruction..." : ""}`);
      console.warn(`[TaskPlanner] Raw first 500 chars: ${rawContent.slice(0, 500)}`);
    } catch (error: any) {
      console.error(`[TaskPlanner] Attempt ${attempt} — LLM call failed: ${error.message}`);
      if (attempt === MAX_ATTEMPTS) throw error;
    }
  }

  console.error("[TaskPlanner] ❌ All attempts exhausted. Raw first 800 chars:", lastRawContent.slice(0, 800));
  console.error("[TaskPlanner] Raw last 300 chars:", lastRawContent.slice(-300));
  throw new Error(`Task planner failed after ${MAX_ATTEMPTS} attempts — LLM did not return parseable JSON`);
}

/**
 * Scan every text field in generated tasks for version references that don't match
 * the user's selections. Replace hallucinated versions with the correct ones.
 *
 * Version-aware: preserves currentVersion references (e.g. "from .NET 7.0")
 * and only rewrites versions that are neither current nor target (hallucinated).
 */
function sanitizeTaskVersions(tasks: UpgradeTask[], selections: Array<{ package: string; currentVersion?: string; selectedVersion: string }>): UpgradeTask[] {
  const versionMap = buildVersionRewriteMap(selections);
  if (versionMap.length === 0) return tasks;

  let totalFixes = 0;
  const sanitized = tasks.map(task => {
    let fixes = 0;
    const fixText = (text: string | undefined | null): string => {
      if (!text) return text as string ?? "";
      let result = text;
      for (const { patterns, correctVersion, currentVersion, isTfmPattern } of versionMap) {
        for (const pattern of patterns) {
          const before = result;
          result = result.replace(pattern, (match) => {
            const verMatch = match.match(/\d+\.\d+(?:\.\d+)?/);
            if (!verMatch) return match;
            const found = verMatch[0];

            if (found === correctVersion) return match;
            // TFM patterns (<TargetFramework>netX.Y</TargetFramework>) always reference the target
            if (!isTfmPattern && currentVersion && normVer(found) === normVer(currentVersion)) return match;

            const replaced = match.replace(/\d+\.\d+(?:\.\d+)?/, correctVersion);
            if (replaced !== match) fixes++;
            return replaced;
          });
          if (result !== before) break;
        }
      }
      return result;
    };

    const fixed: UpgradeTask = {
      ...task,
      title: fixText(task.title),
      description: fixText(task.description),
      steps: (task.steps || []).map((s: string) => fixText(s)),
      verificationCriteria: (task.verificationCriteria || []).map((v: string) => fixText(v)),
    };
    if (fixed.codeExample) {
      fixed.codeExample = {
        before: fixText(fixed.codeExample.before),
        after: fixText(fixed.codeExample.after),
      };
    }
    totalFixes += fixes;
    return fixed;
  });

  if (totalFixes > 0) {
    console.log(`[TaskPlanner] Version sanitization: fixed ${totalFixes} hallucinated version reference(s) across ${tasks.length} tasks`);
  }
  return sanitized;
}

/** Normalize version string for comparison: strip leading zeros, trailing ".0" */
function normVer(v: string): string {
  return v.replace(/^v/i, "").trim().split(".").map(p => String(parseInt(p, 10) || 0)).join(".");
}

interface VersionRewriteEntry {
  packageLabel: string;
  correctVersion: string;
  currentVersion: string;
  patterns: RegExp[];
  isTfmPattern?: boolean;
}

/**
 * Build regex patterns for each user-selected package to detect wrong version
 * references and know what the correct version should be.
 * Includes currentVersion so the replacement callback can preserve it.
 */
function buildVersionRewriteMap(selections: Array<{ package: string; currentVersion?: string; selectedVersion: string }>): VersionRewriteEntry[] {
  const result: VersionRewriteEntry[] = [];

  for (const sel of selections) {
    const pkg = sel.package;
    const target = sel.selectedVersion.replace(/^v/i, "").trim();
    const current = (sel.currentVersion || "").replace(/^v/i, "").trim();
    if (!target) continue;

    const pkgLower = pkg.toLowerCase();

    if (pkgLower.includes(".net") || pkgLower.includes("dotnet") || pkgLower === "dotnet") {
      // Text patterns: preserve currentVersion, fix hallucinated versions
      result.push({
        packageLabel: pkg, correctVersion: target, currentVersion: current,
        patterns: [
          new RegExp(`(\\.NET\\s+)\\d+\\.\\d+(?:\\.\\d+)?`, "gi"),
          new RegExp(`(dotnet\\s+)\\d+\\.\\d+(?:\\.\\d+)?`, "gi"),
          new RegExp(`(net)(\\d+\\.\\d+(?:\\.\\d+)?)`, "gi"),
        ],
      });
      // TFM pattern: always target (never references current version)
      result.push({
        packageLabel: pkg, correctVersion: target, currentVersion: current,
        isTfmPattern: true,
        patterns: [
          new RegExp(`(<TargetFramework>net)\\d+\\.\\d+(?:\\.\\d+)?(</TargetFramework>)`, "gi"),
        ],
      });
    } else if (pkgLower === "java" || pkgLower === "jdk" || pkgLower === "openjdk") {
      result.push({
        packageLabel: pkg, correctVersion: target, currentVersion: current,
        patterns: [
          new RegExp(`(Java\\s+)\\d+`, "gi"),
          new RegExp(`(JDK\\s+)\\d+`, "gi"),
        ],
      });
    } else {
      const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result.push({
        packageLabel: pkg, correctVersion: target, currentVersion: current,
        patterns: [
          new RegExp(`(${escaped}\\s+(?:v|version\\s+)?)\\d+\\.\\d+(?:\\.\\d+)?`, "gi"),
          new RegExp(`(${escaped}@)\\d+\\.\\d+(?:\\.\\d+)?`, "gi"),
        ],
      });
    }
  }

  return result;
}

/**
 * Post-processing pass that specifically targets task titles containing
 * "from X to Y" or "X → Y" version patterns and ensures they use the
 * exact currentVersion and selectedVersion from user selections.
 */
function enforceTaskTitleVersions(
  tasks: UpgradeTask[],
  selections: Array<{ package: string; currentVersion?: string; selectedVersion: string }>
): UpgradeTask[] {
  let totalFixes = 0;

  const selMap = new Map<string, { current: string; target: string }>();
  for (const sel of selections) {
    const key = sel.package.toLowerCase();
    selMap.set(key, {
      current: (sel.currentVersion || "").replace(/^v/i, "").trim(),
      target: sel.selectedVersion.replace(/^v/i, "").trim(),
    });
  }

  const fixTitle = (title: string): string => {
    let result = title;
    for (const [pkgKey, { current, target }] of selMap) {
      if (!current || !target) continue;

      // Build package name patterns to detect in the title
      const namePatterns: string[] = [];
      if (pkgKey.includes(".net") || pkgKey.includes("dotnet")) {
        namePatterns.push("\\.NET", "net", "dotnet");
      } else if (pkgKey === "java" || pkgKey === "jdk") {
        namePatterns.push("Java", "JDK");
      } else {
        namePatterns.push(pkgKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      }

      for (const namePat of namePatterns) {
        // "Package A.B.C to|→|->|=> D.E.F" — fix both A.B.C and D.E.F
        const fromTo = new RegExp(
          `(${namePat}\\s+)(\\d+\\.\\d+(?:\\.\\d+)?)(\\s+(?:to|→|->|=>)\\s+)(\\d+\\.\\d+(?:\\.\\d+)?)`,
          "gi"
        );
        const prev = result;
        result = result.replace(fromTo, (_m, prefix, fromVer, arrow, toVer) => {
          let fixed = false;
          if (normVer(fromVer) !== normVer(current)) { fromVer = current; fixed = true; }
          if (normVer(toVer) !== normVer(target)) { toVer = target; fixed = true; }
          if (fixed) totalFixes++;
          return `${prefix}${fromVer}${arrow}${toVer}`;
        });
        if (result !== prev) break;
      }
    }
    return result;
  };

  const enforced = tasks.map(task => ({
    ...task,
    title: fixTitle(task.title || ""),
  }));

  if (totalFixes > 0) {
    console.log(`[TaskPlanner] Title enforcement: fixed ${totalFixes} version(s) in task titles`);
  }
  return enforced;
}

/**
 * Generate tasks.md markdown from task list
 */
function formatTaskBlock(task: UpgradeTask): string {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const verificationCriteria = Array.isArray(task.verificationCriteria) ? task.verificationCriteria : [];
  const affectedFiles = Array.isArray(task.affectedFiles) ? task.affectedFiles : [];
  const statusIcon = task.status === "completed" ? "[✓]" : task.status === "failed" ? "[✗]" : "[ ]";
  const lines: string[] = [
    "#### " + statusIcon + " " + (task.id || "task") + ": " + (task.title || "Untitled"),
    task.status === "completed" ? "*(Completed: " + new Date().toISOString() + ")*" : "",
    task.status === "failed" ? "*(Failed: " + new Date().toISOString() + ")*" : "",
    "",
    "**Risk Level**: " + (task.riskLevel ?? "medium"),
    "**Estimated Time**: " + (task.estimatedTime ?? "—"),
    "**Auto-fixable**: " + (task.autoFixable ? "Yes" : "No"),
    "",
    "**Description**: " + (task.description ?? ""),
    "",
    "**Steps:**",
    ...steps.map((step: any, idx: number) => (idx + 1) + ". " + (typeof step === "string" ? step : String(step))),
    "",
    "**Verification Criteria:**",
    ...verificationCriteria.map((vc: any) => "- " + (typeof vc === "string" ? vc : String(vc))),
  ];
  if (affectedFiles.length > 0) {
    lines.push("", "**Affected Files:**", ...affectedFiles.map((f: any) => "- `" + (typeof f === "string" ? f : String(f)) + "`"));
  }
  const codeEx = task.codeExample;
  if (codeEx && (codeEx.before != null || codeEx.after != null)) {
    lines.push("", "**Code Example:**", "```", "// Before", String(codeEx.before ?? ""), "", "// After", String(codeEx.after ?? ""), "```");
  }
  lines.push("", "---");
  return lines.join("\n");
}

function generateTasksMarkdown(tasks: UpgradeTask[]): string {
  const completedTasks = tasks.filter(t => t.status === "completed").length;
  const totalTasks = tasks.length;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  
  const phases = new Map<string, UpgradeTask[]>();
  for (const task of tasks) {
    const phase = task.phase ?? "Other";
    if (!phases.has(phase)) phases.set(phase, []);
    phases.get(phase)!.push(task);
  }

  const phaseSections = Array.from(phases.entries()).map(([phase, phaseTasks]) => {
    const taskBlocks = phaseTasks.map(t => formatTaskBlock(t)).join("\n\n");
    return "### " + phase + "\n\n" + taskBlocks;
  }).join("\n\n");

  return `# Stack Modernization Upgrade Tasks

Generated on: ${new Date().toISOString()}

---

## Overview

This document tracks the execution of the stack modernization upgrade. Tasks are organized by phase and will be executed sequentially with verification at each step.

**Progress**: ${completedTasks}/${totalTasks} tasks complete (${progressPercent}%)

---

## Tasks

${phaseSections}

---

## Execution Notes

- Tasks will be executed sequentially in the order listed
- Each task includes verification criteria that must pass before proceeding
- Failed tasks will be logged and may require manual intervention
- Completed tasks are marked with [✓]
- Failed tasks are marked with [✗]

---

## Next Steps

1. Review all tasks above
2. Click "Execute Tasks" to begin automated execution
3. Monitor progress in real-time
4. Review results and generated unit tests

---

*Generated by DevX Stack Modernization Task Planner Agent v2.0*
`;

  return markdown;
}
