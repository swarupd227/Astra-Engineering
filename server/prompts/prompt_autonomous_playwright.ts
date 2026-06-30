/**
 * LLM prompt for generating Playwright spec from autonomous test cases and DOM locators.
 */

export const AUTONOMOUS_PLAYWRIGHT_SYSTEM_PROMPT = `You are an expert Playwright automation engineer. Generate ONE TypeScript Playwright spec file that implements the given test cases using the EXACT locators (xpath or selector) provided for each page.

CRITICAL:
- Use ONLY the locators provided in the "Locators" section. For each form field or button, use the xpath or selector string given.
- Use page.locator() with the selector, or for XPath use page.locator(\`xpath=...\`) with the exact xpath string provided.
- For form fields that include a "fillValue", use that exact value in the page.fill() / locator.fill() call.
- baseURL will be set in config; use relative paths or full URLs from the test context as needed.
- Output a single file: one describe('Autonomous tests') block containing one test() per test case.
- Each test name must start with the caseCode (e.g. "DOM-TC-0001: Title here") so results can be matched.
- Use the exact steps from each test case: navigate, fill fields using the provided locators and fillValues, click using the provided locators, then assert.
- ALWAYS use: const { test, expect } = require('playwright/test'); at the top. NEVER use import/export — this runs as a CommonJS .js file.
- No markdown, no code fence - output only the JavaScript code.`;

export function getAutonomousPlaywrightUserPrompt(
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
): string {
  const casesText = testCases
    .map(
      (tc) => `
${tc.caseCode}: ${tc.title} (type: ${tc.testType})
  Steps:
${(tc.steps ?? []).map((s) => `    - ${s.action} => ${s.expectedResult}`).join("\n")}
  Page URL: ${tc.pageUrl ?? baseUrl}
`
    )
    .join("\n");

  const locatorsText = Object.entries(locatorsByPage).map(
    ([pageUrl, loc]) => `
Page: ${pageUrl}
  Forms: ${JSON.stringify(loc.forms ?? [], null, 2)}
  Actions: ${JSON.stringify(loc.actions ?? [], null, 2)}
`
  ).join("\n");

  const websiteContext = websiteType && websiteType !== "general"
    ? `\nWebsite type: ${websiteType} — tailor interactions and assertions to typical ${websiteType} workflows.\n`
    : "";

  return `baseURL: ${baseUrl}
${websiteContext}
Test cases to implement (use caseCode as test name prefix):
${casesText}

Locators to use (use these exact xpath/selector values; use "fillValue" for page.fill() when provided):
${locatorsText}

Generate one complete .spec.ts file with all tests. Use the locators above for page.locator() or page.locator(\`xpath=...\`). For each form field with a "fillValue", use that value in fill() calls. Output only TypeScript code.`;
}
