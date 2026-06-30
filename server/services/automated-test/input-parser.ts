/**
 * Requirements input parser for autonomous test generation.
 * Supports three formats:
 *   - "brd"        : Business Requirements Document (free-form prose)
 *   - "user-story" : "As a... I want to... So that..." stories
 *   - "gherkin"    : Given/When/Then scenarios
 *   - "general"    : unstructured additional context
 *
 * Parsed output feeds directly into the test case generation prompts,
 * replacing or augmenting the DOM-based test cases.
 */

import { getSelectedLLM } from "../../llm-config";

export type RequirementsFormat = "brd" | "user-story" | "gherkin" | "general";

export interface ParsedScenario {
  title: string;
  preconditions: string[];
  steps: Array<{ action: string; expectedResult: string }>;
  testType: "ui" | "form_submit" | "navigation" | "action" | "workflow";
}

export interface ParsedRequirements {
  format: RequirementsFormat;
  scenarios: ParsedScenario[];
  rawSummary: string;
}

function extractJsonFromText(text: string): string {
  const raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? fenced[1].trim() : raw;
}

/**
 * Detect the format of the input text automatically if not specified.
 */
export function detectFormat(text: string): RequirementsFormat {
  const lower = text.toLowerCase();
  if (/^\s*(given|when|then|scenario|feature|background)/m.test(lower)) return "gherkin";
  if (/as a .+i want to/i.test(lower)) return "user-story";
  if (/\b(requirement|shall|must|the system|functional|non.functional|brd)\b/i.test(lower)) return "brd";
  return "general";
}

/**
 * Parse Gherkin (Given/When/Then) text into structured scenarios without LLM.
 */
function parseGherkinSync(text: string): ParsedScenario[] {
  const scenarios: ParsedScenario[] = [];
  const scenarioBlocks = text.split(/\n\s*(?=scenario(?:\s+outline)?:)/i);

  for (const block of scenarioBlocks) {
    const titleMatch = block.match(/^scenario(?:\s+outline)?:\s*(.+)/i);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();
    const preconditions: string[] = [];
    const steps: Array<{ action: string; expectedResult: string }> = [];

    const lines = block.split("\n");
    let currentGiven = "";
    for (const line of lines) {
      const trimmed = line.trim();
      const givenMatch = trimmed.match(/^given\s+(.+)/i);
      const whenMatch = trimmed.match(/^(?:when|and)\s+(.+)/i);
      const thenMatch = trimmed.match(/^then\s+(.+)/i);
      if (givenMatch) {
        currentGiven = givenMatch[1];
        preconditions.push(currentGiven);
      } else if (whenMatch) {
        const action = whenMatch[1];
        steps.push({ action, expectedResult: "" });
      } else if (thenMatch && steps.length > 0) {
        steps[steps.length - 1].expectedResult = thenMatch[1];
      } else if (thenMatch) {
        steps.push({ action: "Verify", expectedResult: thenMatch[1] });
      }
    }

    if (steps.length > 0) {
      const testType = steps.some(
        (s) =>
          s.action.toLowerCase().includes("fill") ||
          s.action.toLowerCase().includes("enter") ||
          s.action.toLowerCase().includes("submit")
      )
        ? "form_submit"
        : steps.some(
            (s) =>
              s.action.toLowerCase().includes("click") ||
              s.action.toLowerCase().includes("press")
          )
        ? "action"
        : "workflow";

      scenarios.push({ title, preconditions, steps, testType });
    }
  }

  return scenarios;
}

/**
 * Parse requirements using LLM for BRD, user-story, and general formats.
 * Falls back to simple extraction if LLM is unavailable.
 */
export async function parseRequirementsInput(
  text: string,
  format?: RequirementsFormat
): Promise<ParsedRequirements> {
  const resolvedFormat = format ?? detectFormat(text);

  // Gherkin can be parsed deterministically
  if (resolvedFormat === "gherkin") {
    const scenarios = parseGherkinSync(text);
    return {
      format: "gherkin",
      scenarios,
      rawSummary: `Parsed ${scenarios.length} Gherkin scenario(s) from Given/When/Then structure.`,
    };
  }

  const client = getSelectedLLM();
  if (!client) {
    return {
      format: resolvedFormat,
      scenarios: [],
      rawSummary: text.slice(0, 500),
    };
  }

  const formatInstructions: Record<string, string> = {
    "brd": `Extract all testable functional requirements. For each requirement, create one test scenario with clear steps and expected outcomes.`,
    "user-story": `Parse each "As a... I want to... So that..." story. For each story derive acceptance criteria as test steps.`,
    "general": `Extract any testable scenarios, workflows, or behaviors described. Generate test scenarios from the context.`,
  };

  const instruction = formatInstructions[resolvedFormat] ?? formatInstructions["general"];

  const systemPrompt = `You are a QA analyst who converts requirements into structured test scenarios.
${instruction}

Output ONLY valid JSON (no markdown):
{
  "scenarios": [
    {
      "title": "Short test scenario title",
      "preconditions": ["precondition 1"],
      "steps": [
        { "action": "User action to perform", "expectedResult": "What should happen" }
      ],
      "testType": "ui | form_submit | navigation | action | workflow"
    }
  ],
  "rawSummary": "One sentence summary of what was parsed"
}`;

  try {
    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Format: ${resolvedFormat}\n\nInput:\n${text}` },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    } as any);

    const content = (response as any).choices?.[0]?.message?.content ?? "";
    const raw = extractJsonFromText(content);
    const parsed = JSON.parse(raw) as { scenarios?: ParsedScenario[]; rawSummary?: string };

    return {
      format: resolvedFormat,
      scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
      rawSummary: parsed.rawSummary ?? text.slice(0, 200),
    };
  } catch (e) {
    console.warn("[input-parser] LLM parse failed:", (e as Error)?.message);
    return {
      format: resolvedFormat,
      scenarios: [],
      rawSummary: text.slice(0, 500),
    };
  }
}

/**
 * Convert parsed scenarios into the format used by test case generation.
 */
export function scenariosToTestCaseInserts(
  scenarios: ParsedScenario[],
  crawlRunId: string,
  pageId: string | null,
  startIndex: number = 1
): Array<{
  crawlRunId: string;
  pageId: string | null;
  caseCode: string;
  title: string;
  testType: string;
  steps: Array<{ action: string; expectedResult: string }>;
}> {
  return scenarios.map((s, i) => ({
    crawlRunId,
    pageId,
    caseCode: `TC-${String(startIndex + i).padStart(4, "0")}`,
    title: s.title,
    testType: s.testType,
    steps: s.steps,
  }));
}
