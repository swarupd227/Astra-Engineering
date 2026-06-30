/**
 * Playwright Test Script Generation Prompt
 * Generates TypeScript Playwright automation scripts from user stories
 */

export const PLAYWRIGHT_SYSTEM_PROMPT = `You are an expert Playwright automation engineer. Generate TypeScript Playwright test scripts based on existing test cases.

CRITICAL INSTRUCTIONS:
- DO NOT create new test scenarios - only convert the provided test cases to automation
- Focus primarily on the "Test Cases to Automate" section from each user story
- Use the testcases field data as your primary input
- Convert each existing test case into a proper Playwright test() function
- Implement realistic web interactions with proper selectors and assertions

Response Format:
Return ONLY valid JSON with this structure:
{
  "success": true,
  "playwrightTests": [
    {
      "storyId": "string",
      "storyTitle": "string", 
      "testFile": "story-name.spec.ts",
      "testCode": "complete TypeScript Playwright code with imports, describe blocks, and test functions"
    }
  ]
}

Technical Requirements:
- Use TypeScript with Playwright
- Include proper imports: import { test, expect } from '@playwright/test'
- Use describe() blocks for story grouping
- Use test() functions for individual test cases
- Implement realistic page.goto(), page.click(), page.fill(), expect() calls
- Use data-testid selectors when possible, fallback to role-based or text-based selectors
- Add meaningful assertions with expect()
- Handle async/await properly

IMPORTANT: Base all test scripts on the existing test cases provided in the user stories. Do not invent new functionality or test scenarios.`;

export function getPlaywrightUserPrompt(userStories: any[]): string {
  const storiesFormatted = userStories
    .map(
      (story) => {
        let storyText = `Story ID: ${story.id}
Title: ${story.title}
Description: ${story.description || "No description provided"}`;

        // Add acceptance criteria if available
        if (story.acceptanceCriteria) {
          const criteria = Array.isArray(story.acceptanceCriteria)
            ? story.acceptanceCriteria.map((c: any, idx: number) => {
                if (typeof c === 'object') {
                  return `#${idx + 1} ${c.title || c.description || c.then || c.when || c.given || JSON.stringify(c)}`;
                } else {
                  return `#${idx + 1} ${c}`;
                }
              }).join("\n")
            : `- ${story.acceptanceCriteria}`;
          storyText += `\nAcceptance Criteria:\n${criteria}`;
        }

        // MOST IMPORTANT: Add testcases if available - Handle complex testcase structure
        if (story.testcases && Array.isArray(story.testcases)) {
          storyText += `\nTest Cases to Automate:`;
          story.testcases.forEach((testcase: any, index: number) => {
            storyText += `\n#${index + 1} ${testcase.title || testcase.description || testcase}`;
            
            // Handle detailed step structure with Action/Result columns
            if (testcase.steps && Array.isArray(testcase.steps)) {
              storyText += `\n   Steps:`;
              testcase.steps.forEach((step: any, stepIndex: number) => {
                if (typeof step === 'object' && step.Action && step.Result) {
                  // Table format: Step | Action | Result
                  storyText += `\n   ${stepIndex + 1}. Action: ${step.Action} | Expected Result: ${step.Result}`;
                } else if (typeof step === 'object' && step.action && step.result) {
                  // Alternative format
                  storyText += `\n   ${stepIndex + 1}. Action: ${step.action} | Expected Result: ${step.result}`;
                } else if (typeof step === 'string') {
                  // Simple string format
                  storyText += `\n   ${stepIndex + 1}. ${step}`;
                } else if (typeof step === 'object') {
                  // Generic object handling
                  const actionText = step.Action || step.action || step.step || 'Action not specified';
                  const resultText = step.Result || step.result || step.expectedResult || step.expected || 'Result not specified';
                  storyText += `\n   ${stepIndex + 1}. Action: ${actionText} | Expected Result: ${resultText}`;
                }
              });
            }
            
            // Handle overall expected result if available
            if (testcase.expectedResult || testcase.expected || testcase.Result) {
              const result = testcase.expectedResult || testcase.expected || testcase.Result;
              storyText += `\n   Overall Expected Result: ${result}`;
            }
          });
        } else if (story.testCases && Array.isArray(story.testCases)) {
          // Alternative field name - sometimes it's "testCases" instead of "testcases"
          storyText += `\nTest Cases to Automate:`;
          story.testCases.forEach((testcase: any, index: number) => {
            storyText += `\n#${index + 1} ${testcase.title || testcase.description || testcase.scenario || testcase}`;
            
            if (testcase.steps && Array.isArray(testcase.steps)) {
              storyText += `\n   Steps:`;
              testcase.steps.forEach((step: any, stepIndex: number) => {
                if (typeof step === 'object' && step.Action && step.Result) {
                  storyText += `\n   ${stepIndex + 1}. Action: ${step.Action} | Expected Result: ${step.Result}`;
                } else if (typeof step === 'object' && step.action && step.result) {
                  storyText += `\n   ${stepIndex + 1}. Action: ${step.action} | Expected Result: ${step.result}`;
                } else if (typeof step === 'string') {
                  storyText += `\n   ${stepIndex + 1}. ${step}`;
                } else if (typeof step === 'object') {
                  const actionText = step.Action || step.action || step.step || 'Action not specified';
                  const resultText = step.Result || step.result || step.expectedResult || step.expected || 'Result not specified';
                  storyText += `\n   ${stepIndex + 1}. Action: ${actionText} | Expected Result: ${resultText}`;
                }
              });
            }
          });
        }

        // Also add manual test cases if they were generated
        if (story.manualTestCases && Array.isArray(story.manualTestCases)) {
          storyText += `\nManual Test Cases (to convert to automation):`;
          story.manualTestCases.forEach((tc: any, index: number) => {
            storyText += `\n${index + 1}. ${tc.title} (${tc.type})`;
            if (tc.steps && Array.isArray(tc.steps)) {
              storyText += `\n   Steps: ${tc.steps.map((s: any) => s.action).join(" -> ")}`;
            }
          });
        }

        return storyText;
      }
    )
    .join("\n\n---\n\n");

  return `## User Stories with Test Cases to Automate:

${storiesFormatted}

## Your Task:

Convert the provided test cases into TypeScript Playwright automation scripts.

For each story:
1. Use the existing test cases as your base - DO NOT create new test scenarios
2. Convert each test case into a Playwright test() function
3. Implement realistic page interactions based on the test steps
4. Use proper selectors and assertions
4. Use page.goto(), page.fill(), page.click(), etc. as appropriate
5. Add assertions for each expected result
6. Handle wait conditions appropriately
7. Use realistic test data

## Code Requirements:

- Import { test, expect } from '@playwright/test'
- Use proper TypeScript typing
- Include descriptive test names matching manual test cases
- Add comments for clarity
- Include error handling with meaningful error messages
- Use page object pattern if applicable
- Include beforeEach/afterEach hooks if needed

Return ONLY valid TypeScript code that can be directly used in a Playwright project.
No markdown blocks, no explanations - just the TypeScript code.
NO code formatting blocks - start directly with import statements.`;
}

export default {
  PLAYWRIGHT_SYSTEM_PROMPT,
  getPlaywrightUserPrompt,
};
