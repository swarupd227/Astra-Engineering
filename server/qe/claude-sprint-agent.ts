import { qeAnthropicClient as anthropic } from './ai-client.js';

export interface SprintTestCase {
  testCaseId: string;
  title: string;
  objective: string;
  preconditions: string[];
  testSteps: Array<{ step_number: number; action: string; expected_behavior: string }>;
  expectedResult: string;
  testData: Record<string, any>;
  category: "functional" | "negative" | "edge_case" | "security" | "accessibility";
  priority: string;
}

export async function generateSprintTestCases(
  userStoryTitle: string,
  userStoryDescription: string,
  domain: string,
  productDescription: string,
  onProgress?: (category: string, status: string, count?: number) => void
): Promise<SprintTestCase[]> {
  console.log(`[Sprint Agent] Generating tests for: ${userStoryTitle} (Domain: ${domain})`);

  const testCases: SprintTestCase[] = [];
  let caseId = 1;

  // Determine complexity based on description length
  const descriptionLength = userStoryDescription.length;
  const isComplex = descriptionLength > 200;
  
  // Adaptive test case counts
  const testCaseCounts: Record<string, number> = {
    functional: isComplex ? 10 : 8,
    negative: isComplex ? 7 : 5,
    edge_case: isComplex ? 7 : 5,
    security: isComplex ? 6 : 4,
    accessibility: isComplex ? 5 : 3,
  };

  const categories = [
    { name: "functional", label: "Functional Test Cases" },
    { name: "negative", label: "Negative Test Cases" },
    { name: "edge_case", label: "Edge Case Test Cases" },
    { name: "security", label: "Security Test Cases" },
    { name: "accessibility", label: "Accessibility Test Cases" },
  ];

  for (const cat of categories) {
    onProgress?.(cat.name, "started");

    const count = testCaseCounts[cat.name] || 5;
    const prompt = `You are a ${domain} domain expert QA architect. Generate ${count} ${cat.label} for this user story:

Title: ${userStoryTitle}
Description: ${userStoryDescription}
Domain Context: ${domain}
Product Info: ${productDescription}

IMPORTANT: Each test case MUST have 5-6 detailed test steps. Do NOT generate test cases with fewer than 5 steps.

For EACH test case, provide ONLY valid JSON (no markdown, no code blocks):
[
  {
    "title": "Test case title",
    "objective": "What this test validates",
    "preconditions": ["Condition 1", "Condition 2"],
    "testSteps": [
      {"step_number": 1, "action": "Navigate to the target page or module", "expected_behavior": "Page loads successfully"},
      {"step_number": 2, "action": "Verify initial state and prerequisites", "expected_behavior": "All prerequisites are met"},
      {"step_number": 3, "action": "Perform the primary action being tested", "expected_behavior": "Action executes correctly"},
      {"step_number": 4, "action": "Validate the intermediate result", "expected_behavior": "Intermediate state is correct"},
      {"step_number": 5, "action": "Complete the workflow or transaction", "expected_behavior": "Workflow completes successfully"},
      {"step_number": 6, "action": "Verify final state and data persistence", "expected_behavior": "Final expected outcome is achieved"}
    ],
    "expectedResult": "Final expected result",
    "testData": {},
    "priority": "P1"
  }
]

Generate EXACTLY ${count} test cases, each with 5-6 detailed steps. Return ONLY the JSON array, nothing else.`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 8000,
        temperature: 0.5,
        messages: [{ role: "user", content: prompt }],
      });

      const response = message.content[0];
      if (response.type !== "text") throw new Error("Invalid response type");

      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response.text.trim();
      if (jsonStr.includes("```json")) {
        jsonStr = jsonStr.split("```json")[1].split("```")[0].trim();
      } else if (jsonStr.includes("```")) {
        jsonStr = jsonStr.split("```")[1].split("```")[0].trim();
      }

      const parsedCases = JSON.parse(jsonStr);
      const casesArray = Array.isArray(parsedCases) ? parsedCases : [parsedCases];

      for (const tc of casesArray) {
        testCases.push({
          testCaseId: `${cat.name.toUpperCase()}-${caseId}`,
          title: tc.title || "Untitled",
          objective: tc.objective || "",
          preconditions: Array.isArray(tc.preconditions) ? tc.preconditions : [],
          testSteps: Array.isArray(tc.testSteps) ? tc.testSteps : [],
          expectedResult: tc.expectedResult || "",
          testData: tc.testData || {},
          category: cat.name as any,
          priority: tc.priority || "P2",
        });
        caseId++;
      }

      onProgress?.(cat.name, "completed", casesArray.length);
      console.log(`[Sprint Agent] Generated ${casesArray.length} ${cat.name} test cases`);
    } catch (error) {
      console.error(`[Sprint Agent] Error generating ${cat.name} tests:`, error);
      onProgress?.(cat.name, "error", 0);
    }
  }

  console.log(`[Sprint Agent] Total test cases generated: ${testCases.length}`);
  return testCases;
}
