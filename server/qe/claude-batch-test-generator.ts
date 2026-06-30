import { qeAnthropicClient as anthropic } from './ai-client.js';
import pRetry from "p-retry";
import pLimit from "p-limit";
import type { InsuranceScenario } from "./claude-scenario-analyzer";

// Limit concurrent Claude API calls to prevent rate limiting
const claudeLimit = pLimit(3);

export interface CategorizedTestStep {
  step_number: number;
  action: string;
  expected_behavior: string;
  element_label?: string;
  selector?: string;
}

export interface CategorizedTestCase {
  testId: string;
  scenarioId: string;
  name: string;
  description?: string;
  category: "text_validation" | "workflow" | "functional" | "negative" | "edge_case";
  objective: string;
  given: string;
  when: string;
  then: string;
  preconditions: string[];
  test_steps: CategorizedTestStep[];
  postconditions: string[];
  test_data: Record<string, any>;
  priority: "P0" | "P1" | "P2" | "P3";
  tags: string[];
  expected_elements: string[];
}

function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const errorMsg = error.message || error.toString();
  return (
    errorMsg.includes("rate_limit") ||
    errorMsg.includes("429") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

function parseTestSteps(stepsText: string): CategorizedTestStep[] {
  const steps: CategorizedTestStep[] = [];
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

// Flexible page data type that works with various crawler formats
export interface PageData {
  url: string;
  title: string;
  buttons: any[];
  inputs: any[];
  links: any[];
  forms?: any[];
}

export async function generateTestCasesForScenarioBatch(
  scenarios: InsuranceScenario[],
  pages: PageData[] = [],
  onProgress?: (current: number, total: number, message: string) => void,
  onTestCaseGenerated?: (testCase: CategorizedTestCase) => void,
  onCategoryProgress?: (category: string, status: 'started' | 'completed', count?: number) => void
): Promise<CategorizedTestCase[]> {
  console.log(`[Batch Generator] Generating test cases for ${scenarios.length} scenarios with ${pages.length} pages of context...`);
  
  const allTestCases: CategorizedTestCase[] = [];
  let processedScenarios = 0;

  // Group scenarios by category for progressive generation
  const categorizedScenarios = {
    functional: scenarios.filter(s => s.category === 'functional'),
    workflow: scenarios.filter(s => s.category === 'workflow'),
    text_validation: scenarios.filter(s => s.category === 'text_validation'),
    negative: scenarios.filter(s => s.category === 'negative'),
    edge_case: scenarios.filter(s => s.category === 'edge_case'),
  };

  // Prepare all batch tasks for parallel execution
  type BatchTask = {
    category: string;
    scenarios: InsuranceScenario[];
    batchIndex: number;
  };
  
  const allBatchTasks: BatchTask[] = [];
  const categoryOrder: Array<keyof typeof categorizedScenarios> = ['functional', 'workflow', 'text_validation', 'negative', 'edge_case'];
  
  for (const category of categoryOrder) {
    const categoryScenarios = categorizedScenarios[category];
    if (categoryScenarios.length === 0) continue;
    
    // Create batch tasks - 1 scenario per batch for better parallelization
    for (let i = 0; i < categoryScenarios.length; i++) {
      allBatchTasks.push({
        category,
        scenarios: [categoryScenarios[i]],
        batchIndex: i,
      });
    }
  }

  console.log(`[Batch Generator] Created ${allBatchTasks.length} parallel batch tasks`);

  // Notify all categories as started
  for (const category of categoryOrder) {
    if (onCategoryProgress) {
      onCategoryProgress(category, 'started');
    }
  }

  // Track results per category
  const categoryResults: Record<string, CategorizedTestCase[]> = {
    functional: [],
    workflow: [],
    text_validation: [],
    negative: [],
    edge_case: [],
  };

  // Execute all batches in parallel with concurrency limit
  const batchPromises = allBatchTasks.map((task) =>
    claudeLimit(async () => {
      const { category, scenarios: batchScenarios, batchIndex } = task;
      console.log(`[Batch Generator] Processing ${category} scenario ${batchIndex + 1}`);
      
      try {
        const batchTestCases = await generateTestCasesForBatch(batchScenarios, pages);
        
        // Stream each test case immediately
        if (onTestCaseGenerated) {
          for (const testCase of batchTestCases) {
            onTestCaseGenerated(testCase);
          }
        }
        
        processedScenarios += batchScenarios.length;
        if (onProgress) {
          onProgress(processedScenarios, scenarios.length, `Generated ${batchTestCases.length} test cases`);
        }
        
        console.log(`[Batch Generator] Generated ${batchTestCases.length} ${category} test cases`);
        return { category, testCases: batchTestCases };
      } catch (batchError) {
        console.error(`[Batch Generator] Failed for ${category} batch ${batchIndex}:`, batchError);
        processedScenarios += batchScenarios.length;
        return { category, testCases: [] };
      }
    })
  );

  // Wait for all parallel tasks to complete
  const results = await Promise.all(batchPromises);
  
  // Aggregate results by category
  for (const result of results) {
    categoryResults[result.category].push(...result.testCases);
    allTestCases.push(...result.testCases);
  }

  // Notify categories as completed
  for (const category of categoryOrder) {
    if (onCategoryProgress) {
      onCategoryProgress(category, 'completed', categoryResults[category].length);
    }
  }

  if (onProgress) {
    onProgress(scenarios.length, scenarios.length, `Generated ${allTestCases.length} test cases`);
  }

  console.log(`[Batch Generator] Total test cases generated: ${allTestCases.length}`);
  return allTestCases;
}

async function generateTestCasesForBatch(
  scenarios: InsuranceScenario[],
  pages: PageData[] = []
): Promise<CategorizedTestCase[]> {
  const scenariosData = scenarios.map(sc => ({
    id: sc.id,
    title: sc.title,
    description: sc.description,
    category: sc.category,
    priority: sc.priority,
    userStory: sc.userStory,
    acceptanceCriteria: sc.acceptanceCriteria,
    relatedElements: sc.relatedElements,
  }));

  // Extract all UI elements from pages for reference
  // Handle both object format {text: string} and string format for links
  const allButtons = pages.flatMap(p => (p.buttons || []).map((b: any) => b.text || b).filter(Boolean));
  const allInputs = pages.flatMap(p => (p.inputs || []).map((i: any) => i.label || i.placeholder || i.name).filter(Boolean));
  const allLinks = pages.flatMap(p => (p.links || []).map((l: any) => typeof l === 'string' ? l : l.text).filter(Boolean)).slice(0, 50);
  
  const availableElements = {
    buttons: Array.from(new Set(allButtons)).slice(0, 50),
    inputs: Array.from(new Set(allInputs)).filter((x): x is string => !!x).slice(0, 50),
    links: Array.from(new Set(allLinks)).slice(0, 30),
  };

  // Log available elements for debugging
  console.log(`[Batch Generator] Available elements: ${availableElements.buttons.length} buttons, ${availableElements.inputs.length} inputs, ${availableElements.links.length} links`);
  if (availableElements.buttons.length > 0) {
    console.log(`[Batch Generator] Sample buttons: ${availableElements.buttons.slice(0, 5).join(', ')}`);
  }

  const prompt = `You are an expert QA Engineer with 20+ years of experience creating comprehensive test cases using EXACT UI element text from a website.

AVAILABLE UI ELEMENTS FROM THE WEBSITE:
Buttons: ${JSON.stringify(availableElements.buttons)}
Input Fields: ${JSON.stringify(availableElements.inputs)}
Links: ${JSON.stringify(availableElements.links)}

SCENARIO TO TEST:
${JSON.stringify(scenariosData, null, 2)}

ABSOLUTE RULES - MUST FOLLOW:
1. Use EXACT text from the AVAILABLE UI ELEMENTS lists above
2. Copy button text EXACTLY as shown (e.g., if button is "Sign up for GitHub", write "Sign up for GitHub" not "Sign Up")
3. Copy input labels EXACTLY as shown
4. NEVER invent or paraphrase element names
5. If an element doesn't exist in the lists above, DO NOT reference it
6. Each test case MUST have EXACTLY 6 detailed test steps

GENERATE 2-3 TEST CASES using this format:
{
  "testId": "TC-XXX-001",
  "scenarioId": "[scenario id]",
  "name": "Verify [EXACT element text] [action]",
  "description": "Validate that [detailed description of what is being tested and why it matters]",
  "category": "[match scenario category]",
  "objective": "Test that [EXACT element] works correctly with [specific validation outcome]",
  "given": "User is on the [specific page] and [specific precondition state]",
  "when": "User [performs specific action with EXACT element text]",
  "then": "System [specific expected outcome with validation points]",
  "preconditions": [
    "User is logged in with [specific role/permissions]",
    "[Specific data/state] exists in the system",
    "Browser is on [specific page/URL]",
    "[Any other prerequisite configuration]"
  ],
  "test_steps": [
    {"step_number": 1, "action": "Navigate to the [specific page] and verify page loads", "expected_behavior": "Page loads successfully with all elements visible"},
    {"step_number": 2, "action": "Locate and verify [EXACT UI element] is present and enabled", "expected_behavior": "Element is visible, enabled, and ready for interaction"},
    {"step_number": 3, "action": "Perform [primary action] on \"[EXACT ELEMENT TEXT]\"", "expected_behavior": "System responds with [specific feedback/response]"},
    {"step_number": 4, "action": "Verify intermediate state: [specific validation]", "expected_behavior": "[Specific intermediate state/data] is displayed correctly"},
    {"step_number": 5, "action": "Complete the workflow by [final action]", "expected_behavior": "Workflow completes with [success indication]"},
    {"step_number": 6, "action": "Validate final state and data persistence", "expected_behavior": "All changes are correctly saved and displayed"}
  ],
  "postconditions": [
    "[Specific record/data] is [created/updated] in the system",
    "[Audit trail/log] entry is recorded",
    "System returns to [expected state]"
  ],
  "test_data": {"field1": "specific_value", "field2": "specific_value"},
  "priority": "[from scenario]",
  "tags": [],
  "expected_elements": ["[EXACT elements from lists]"]
}

CRITICAL: Each test case MUST have exactly 6 test steps covering:
1. Navigation/Setup
2. Element verification
3. Primary action execution
4. Intermediate validation
5. Workflow completion
6. Final state verification

OUTPUT: JSON array of test cases only. No markdown.`;

  return await pRetry(
    async () => {
      try {
        console.log('[Batch Generator] Sending streaming request to Claude API...');
        
        // Use streaming to avoid timeout issues with long operations
        let responseText = '';
        const stream = await anthropic.messages.stream({
          model: "claude-sonnet-4-5",
          max_tokens: 16000,
          temperature: 0.5,
          messages: [{ role: "user", content: prompt }],
        });
        
        // Collect all streamed text
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            responseText += event.delta.text;
          }
        }
        
        console.log('[Batch Generator] Received complete response from Claude API');
        responseText = responseText.trim();
        console.log(`[Batch Generator] Response length: ${responseText.length} characters`);
        responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "");

        let testCases;
        try {
          console.log('[Batch Generator] Parsing JSON response...');
          testCases = JSON.parse(responseText);
          console.log('[Batch Generator] Successfully parsed JSON');
        } catch (parseError) {
          console.error("[Batch Generator] JSON parse error:", parseError);
          console.error("[Batch Generator] Response text:", responseText.substring(0, 500));
          throw new Error("Failed to parse Claude response as JSON");
        }

        if (!Array.isArray(testCases)) {
          console.log('[Batch Generator] Response is not an array, searching for array in object...');
          if (testCases && typeof testCases === "object") {
            const possibleArrayKeys = ["testCases", "tests", "cases"];
            for (const key of possibleArrayKeys) {
              if (Array.isArray(testCases[key])) {
                console.log(`[Batch Generator] Found array at key: ${key}`);
                testCases = testCases[key];
                break;
              }
            }
          }
          if (!Array.isArray(testCases)) {
            console.error('[Batch Generator] No array found in response');
            throw new Error("Claude response is not an array and no array found in object");
          }
        }

        console.log(`[Batch Generator] Processing ${testCases.length} test cases...`);
        const processedCases = testCases.map((tc: any) => ({
          testId: tc.testId || `TC-${Date.now()}`,
          scenarioId: tc.scenarioId || "",
          name: tc.name || "Unnamed Test",
          description: tc.description || "",
          category: tc.category || "functional",
          objective: tc.objective || "",
          given: tc.given || "",
          when: tc.when || "",
          then: tc.then || "",
          preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [],
          test_steps: Array.isArray(tc.test_steps) ? tc.test_steps : parseTestSteps(tc.test_steps || ""),
          postconditions: Array.isArray(tc.postconditions) ? tc.postconditions : [],
          test_data: typeof tc.test_data === 'object' && tc.test_data ? tc.test_data : {},
          priority: tc.priority || "P2",
          tags: Array.isArray(tc.tags) ? tc.tags : [],
          expected_elements: Array.isArray(tc.expected_elements) ? tc.expected_elements : [],
        }));

        console.log(`[Batch Generator] Successfully processed ${processedCases.length} test cases`);
        return processedCases;
      } catch (error: any) {
        console.error('[Batch Generator] Error in generation:', error);
        if (isRateLimitError(error)) {
          console.log('[Batch Generator] Rate limit error detected, will retry');
          throw error;
        }
        console.log('[Batch Generator] Non-retryable error, aborting');
        const abortError: any = new Error("Non-retryable error");
        abortError.name = "AbortError";
        throw abortError;
      }
    },
    {
      retries: 3,
      minTimeout: 2000,
      maxTimeout: 5000,
      onFailedAttempt: (error: any) => {
        console.log(
          `[Batch Generator] Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left. Error: ${error.message || 'Unknown error'}`
        );
      },
    }
  );
}
