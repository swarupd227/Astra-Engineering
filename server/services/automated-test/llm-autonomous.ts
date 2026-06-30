/**
 * LLM integration for autonomous testing: test case generation and Playwright script generation.
 * Uses the repo's configured LLM (Anthropic or Azure OpenAI) via getSelectedLLM().
 */

import { jsonrepair } from "jsonrepair";
import { getSelectedLLM } from "../../llm-config";
import {
  AUTONOMOUS_TEST_CASES_SYSTEM_PROMPT,
  getAutonomousTestCasesUserPrompt,
} from "../../prompts/prompt_autonomous_test_cases";
import {
  AUTONOMOUS_PLAYWRIGHT_SYSTEM_PROMPT,
  getAutonomousPlaywrightUserPrompt,
} from "../../prompts/prompt_autonomous_playwright";

export interface LLMTestCaseItem {
  caseCode: string;
  title: string;
  testType: string;
  pageIdRef: string | number;
  steps: Array<{ action: string; expectedResult: string }>;
}

export interface LLMTestCasesResult {
  testCases: LLMTestCaseItem[];
}

/** High enough for large multi-page runs; Anthropic/Bedrock cap at 32k in our clients. */
const MAX_TOKENS_TEST_CASES = 24_000;
const MAX_TOKENS_PLAYWRIGHT = 16_000;
const TEMPERATURE = 0.3;

function extractJsonFromResponse(text: string): string {
  let raw = text.trim();
  if (raw.startsWith("```json")) raw = raw.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  else if (raw.startsWith("```")) raw = raw.replace(/^```\w*\s*/, "").replace(/\s*```$/, "");
  return raw;
}

/** First top-level `{ ... }` with string-aware brace matching (ignores `{` inside strings). */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseTestCasesResult(raw: string): LLMTestCasesResult | null {
  const trimmed = raw.trim();
  const candidates = [trimmed, extractFirstJsonObject(trimmed)].filter((s): s is string => !!s?.length);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as LLMTestCasesResult;
      if (Array.isArray(parsed.testCases)) return parsed;
    } catch {
      /* try next */
    }
  }

  try {
    const repaired = jsonrepair(trimmed);
    const parsed = JSON.parse(repaired) as LLMTestCasesResult;
    if (Array.isArray(parsed.testCases)) return parsed;
  } catch {
    /* fall through */
  }

  const extracted = extractFirstJsonObject(trimmed);
  if (extracted && extracted !== trimmed) {
    try {
      const repaired = jsonrepair(extracted);
      const parsed = JSON.parse(repaired) as LLMTestCasesResult;
      if (Array.isArray(parsed.testCases)) return parsed;
    } catch {
      /* ignore */
    }
  }

  return null;
}

/**
 * Call LLM to generate test cases from pages + DOM summary. Returns parsed test cases or null on failure.
 */
export async function generateTestCasesWithLLM(
  pages: Array<{
    pageId: string;
    pageIndex: number;
    url: string;
    title?: string | null;
    routePattern: string;
    domSummary: {
      pageMeta?: { title?: string; h1?: string };
      forms?: Array<{ name?: string; fieldCount?: number; method?: string }>;
      actions?: Array<{ type: string; visibleText?: string }>;
    };
  }>,
  testFocus: string = "all",
  requirementsContext?: string
): Promise<LLMTestCaseItem[] | null> {
  if (pages.length === 0) return [];
  try {
    const client = getSelectedLLM();
    if (!client) return null;
    // Added today: Forward test focus down to the prompt generation logic to instruct the LLM
    const userPrompt = getAutonomousTestCasesUserPrompt(pages, testFocus, requirementsContext);
    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: AUTONOMOUS_TEST_CASES_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS_TEST_CASES,
    } as any);
    const choice = (response as any).choices?.[0];
    const finishReason = choice?.finish_reason;
    if (finishReason === "length") {
      console.warn(
        "[automated-test] LLM output hit max length; response may be truncated. Consider fewer pages or shorter requirements text."
      );
    }
    const content = choice?.message?.content ?? "";
    const raw = extractJsonFromResponse(content);
    const parsed = parseTestCasesResult(raw);
    if (parsed && Array.isArray(parsed.testCases)) return parsed.testCases;
  } catch (e) {
    console.warn("[automated-test] LLM test case generation failed:", (e as Error)?.message);
  }
  return null;
}

/**
 * Call LLM to generate one Playwright spec file from test cases + locators. Returns script content or null on failure.
 */
export async function generatePlaywrightScriptWithLLM(
  baseUrl: string,
  testCases: Array<{
    caseCode: string;
    title: string;
    testType: string;
    steps: Array<{ action: string; expectedResult: string }>;
    pageUrl?: string;
  }>,
  locatorsByPage: Record<
    string,
    {
      forms?: Array<{
        formIndex: number;
        fields: Array<{ name?: string; type?: string; xpath: string; selector: string; fillValue?: string }>;
        submitXpath?: string;
      }>;
      actions?: Array<{ visibleText?: string; type: string; xpath: string; selector: string }>;
    }
  >,
  websiteType?: string
): Promise<string | null> {
  if (testCases.length === 0) return null;
  try {
    const client = getSelectedLLM();
    if (!client) return null;
    const userPrompt = getAutonomousPlaywrightUserPrompt(baseUrl, testCases, locatorsByPage, websiteType);
    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: AUTONOMOUS_PLAYWRIGHT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: TEMPERATURE,
      max_tokens: MAX_TOKENS_PLAYWRIGHT,
    } as any);
    const content = (response as any).choices?.[0]?.message?.content ?? "";
    let code = content.trim();
    if (code.startsWith("```typescript")) code = code.replace(/^```typescript\s*/, "").replace(/\s*```$/, "");
    else if (code.startsWith("```")) code = code.replace(/^```\w*\s*/, "").replace(/\s*```$/, "");
    if (code.includes("import") && (code.includes("test(") || code.includes("test ("))) return code;
  } catch (e) {
    console.warn("[automated-test] LLM Playwright generation failed:", (e as Error)?.message);
  }
  return null;
}
