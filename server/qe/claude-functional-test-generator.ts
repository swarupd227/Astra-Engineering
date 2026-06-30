import { qeAnthropicClient as anthropic } from './ai-client.js';
import pRetry from "p-retry";
import pLimit from "p-limit";
import type { TestStep } from "@shared/qe-schema";
import type { DiscoveredWorkflow } from "./claude-workflow-analyzer";

const limit = pLimit(3);

function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const errorMsg = error.message || error.toString();
  return (
    errorMsg.includes("rate_limit") ||
    errorMsg.includes("429") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

export interface GeneratedFunctionalTestCase {
  testId: string;
  workflowId: string;
  name: string;
  objective: string;
  given: string;
  when: string;
  then: string;
  selector?: string;
  preconditions: string[];
  test_steps: TestStep[];
  postconditions: string[];
  test_data: Record<string, any>;
  test_type: string;
  priority: string;
  type: string;
  tags: string[];
  workflow: {
    id: string;
    name: string;
    type: string;
  };
}

function generateFallbackTestCase(counter: number): GeneratedFunctionalTestCase {
  return {
    testId: `TC-${String(counter).padStart(4, "0")}`,
    workflowId: "unknown",
    name: "Malformed Test Case",
    objective: "Test case could not be parsed from Claude response",
    given: "",
    when: "",
    then: "",
    selector: "",
    preconditions: [],
    test_steps: [{
      step_number: 1,
      action: "Unable to parse test case",
      expected_behavior: "N/A",
    }],
    postconditions: [],
    test_data: {},
    test_type: "Functional",
    priority: "P3",
    type: "user_interaction",
    tags: ["malformed"],
    workflow: {
      id: "unknown",
      name: "",
      type: "user_interaction",
    },
  };
}

function parseTestSteps(stepsText: string): TestStep[] {
  const steps: TestStep[] = [];
  const lines = stepsText.split('\n');
  let currentStep = 0;
  let currentAction = '';
  
  for (const line of lines) {
    const stepMatch = line.match(/Step\s+(\d+):\s*(.+)/i);
    if (stepMatch) {
      if (currentStep > 0 && currentAction) {
        const verifyMatch = currentAction.match(/^(.+?)(?:Verify|Expected:|Assert:)\s*(.+)$/i);
        if (verifyMatch) {
          steps.push({
            step_number: currentStep,
            action: verifyMatch[1].trim(),
            expected_behavior: verifyMatch[2].trim(),
          });
        } else {
          steps.push({
            step_number: currentStep,
            action: currentAction.trim(),
            expected_behavior: "",
          });
        }
      }
      currentStep = parseInt(stepMatch[1], 10);
      currentAction = stepMatch[2];
    } else if (currentStep > 0) {
      currentAction += ' ' + line.trim();
    }
  }
  
  if (currentStep > 0 && currentAction) {
    const verifyMatch = currentAction.match(/^(.+?)(?:Verify|Expected:|Assert:)\s*(.+)$/i);
    if (verifyMatch) {
      steps.push({
        step_number: currentStep,
        action: verifyMatch[1].trim(),
        expected_behavior: verifyMatch[2].trim(),
      });
    } else {
      steps.push({
        step_number: currentStep,
        action: currentAction.trim(),
        expected_behavior: "",
      });
    }
  }
  
  return steps.length > 0 ? steps : [{
    step_number: 1,
    action: stepsText,
    expected_behavior: "",
  }];
}

function parsePreconditions(preconditionsText: string): string[] {
  if (!preconditionsText || preconditionsText.toLowerCase() === "none") {
    return [];
  }
  
  const lines = preconditionsText.split(/[\n•-]/).filter(line => line.trim());
  return lines.map(line => line.trim()).filter(Boolean);
}

function parseTestData(testDataText: string): Record<string, any> {
  if (!testDataText || testDataText.toLowerCase() === "none") {
    return {};
  }
  
  try {
    return JSON.parse(testDataText);
  } catch {
    const lines = testDataText.split(/[\n,]/).filter(line => line.trim());
    const data: Record<string, any> = {};
    lines.forEach((line, index) => {
      const keyValue = line.split(/[:=]/).map(s => s.trim());
      if (keyValue.length === 2) {
        data[keyValue[0]] = keyValue[1];
      } else {
        data[`item_${index + 1}`] = line.trim();
      }
    });
    return data;
  }
}

export async function generateFunctionalTestCasesWithClaude(
  workflows: DiscoveredWorkflow[],
  testFocus: string
): Promise<GeneratedFunctionalTestCase[]> {
  const workflowsData = workflows.map(wf => ({
    id: wf.id,
    name: wf.name,
    type: wf.type,
    entryPoint: wf.entryPoint,
    steps: wf.steps,
    confidence: wf.confidence,
    description: wf.description,
  }));

  const prompt = `You are an expert QA Architect creating comprehensive test cases for web application testing.

DISCOVERED WORKFLOWS:
${JSON.stringify(workflowsData, null, 2)}

TEST FOCUS: ${testFocus}

TASK:
Generate comprehensive test cases for these workflows. For each workflow, create 3-5 test cases covering:
1. Happy path (successful completion)
2. Validation scenarios (invalid inputs, required fields)
3. Edge cases (boundary conditions, special characters)
4. Error handling (network errors, timeouts)

FOR EACH TEST CASE, PROVIDE:
1. testId: Unique identifier (TC-0001, TC-0002, etc.)
2. workflowId: ID of the workflow being tested
3. name: Clear, descriptive test name
4. objective: One sentence describing what this test verifies
5. given: Initial state/precondition in BDD format
6. when: User action in BDD format
7. then: Expected outcome in BDD format
8. selector: Primary CSS selector for the main element
9. preconditions: Array of setup requirements
10. test_steps: Numbered steps with actions and expected behaviors
11. postconditions: Array of expected system states after test
12. test_data: Specific test data as JSON object
13. test_type: "Functional", "Negative", "Edge", or "Accessibility"
14. priority: "P0" (critical), "P1" (high), "P2" (medium), or "P3" (low)
15. type: Workflow type (form_submission, navigation_path, cta_flow, user_interaction)
16. tags: Array of relevant tags (e.g., ["form", "validation", "critical"])

TEST STEPS FORMAT:
Step 1: [Action to perform] Expected: [What should happen]
Step 2: [Action to perform] Expected: [What should happen]

IMPORTANT:
- Generate realistic, executable test cases
- Include specific test data values
- Ensure steps are clear and actionable
- Prioritize based on workflow confidence and criticality
- Use proper CSS selectors from workflow steps
- No emoji or special characters

OUTPUT FORMAT:
Return a valid JSON array of test case objects with the exact structure specified above.

Return ONLY the JSON array, no markdown formatting.`;

  console.log(`[Claude FuncGen] Starting test generation for ${workflows.length} workflows...`);
  
  return await pRetry(
    async () => {
      try {
        console.log('[Claude FuncGen] Sending request to Claude API...');
        const message = await anthropic.messages.create({
          model: "claude-sonnet-4-5",
          max_tokens: 16384,
          temperature: 0.5,
          messages: [{ role: "user", content: prompt }],
        });
        console.log('[Claude FuncGen] Received response from Claude API');

        const content = message.content[0];
        if (content.type !== "text") {
          throw new Error("Unexpected response type from Claude");
        }

        let responseText = content.text.trim();
        console.log(`[Claude FuncGen] Response length: ${responseText.length} characters`);
        responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "");
        
        let testCases;
        try {
          console.log('[Claude FuncGen] Parsing JSON response...');
          testCases = JSON.parse(responseText);
          console.log('[Claude FuncGen] Successfully parsed JSON');
        } catch (parseError) {
          console.error("[Claude FuncGen] JSON parse error:", parseError);
          console.error("[Claude FuncGen] Response text:", responseText.substring(0, 500));
          throw new Error("Failed to parse Claude response as JSON");
        }
        
        if (!Array.isArray(testCases)) {
          console.log('[Claude FuncGen] Response is not an array, searching for array in object...');
          if (testCases && typeof testCases === "object") {
            const possibleArrayKeys = ["testCases", "tests", "cases"];
            for (const key of possibleArrayKeys) {
              if (Array.isArray(testCases[key])) {
                console.log(`[Claude FuncGen] Found array at key: ${key}`);
                testCases = testCases[key];
                break;
              }
            }
          }
          if (!Array.isArray(testCases)) {
            console.error('[Claude FuncGen] No array found in response');
            throw new Error("Claude response is not an array and no array found in object");
          }
        }

        console.log(`[Claude FuncGen] Processing ${testCases.length} test cases...`);
        let testCounter = 0;
        const processedCases = testCases.map((tc: any) => {
          if (!tc || typeof tc !== "object") {
            testCounter++;
            return generateFallbackTestCase(testCounter);
          }
          testCounter++;
          return {
            testId: tc.testId || `TC-${String(testCounter).padStart(4, "0")}`,
            workflowId: tc.workflowId || "",
            name: tc.name || "Unnamed Test",
            objective: tc.objective || "",
            given: tc.given || "",
            when: tc.when || "",
            then: tc.then || "",
            selector: tc.selector,
            preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : parsePreconditions(tc.preconditions || ""),
            test_steps: Array.isArray(tc.test_steps) ? tc.test_steps : parseTestSteps(tc.test_steps || ""),
            postconditions: Array.isArray(tc.postconditions) ? tc.postconditions : parsePreconditions(tc.postconditions || ""),
            test_data: typeof tc.test_data === 'object' ? tc.test_data : parseTestData(tc.test_data || ""),
            test_type: tc.test_type || "Functional",
            priority: tc.priority || "P2",
            type: tc.type || "user_interaction",
            tags: Array.isArray(tc.tags) ? tc.tags : [],
            workflow: tc.workflow || {
              id: tc.workflowId || "",
              name: "",
              type: tc.type || "user_interaction",
            },
          };
        });
        
        console.log(`[Claude FuncGen] Successfully processed ${processedCases.length} test cases`);
        return processedCases;
      } catch (error: any) {
        console.error('[Claude FuncGen] Error in retry handler:', error);
        if (isRateLimitError(error)) {
          console.log('[Claude FuncGen] Rate limit error detected, will retry');
          throw error;
        }
        console.log('[Claude FuncGen] Non-retryable error, aborting');
        const abortError: any = new Error("Non-retryable error");
        abortError.name = "AbortError";
        throw abortError;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      maxTimeout: 5000,
      onFailedAttempt: (error) => {
        console.log(
          `[Claude FuncGen] Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left. Error: ${error.message}`
        );
      },
    }
  );
}
