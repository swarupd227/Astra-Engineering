/**
 * Manual Test Case Generation Prompt
 * Generates detailed, readable manual test cases for user stories
 */

export const MANUAL_TEST_CASE_SYSTEM_PROMPT = `You are an expert QA Test Engineer specializing in creating comprehensive, production-ready manual test cases.

Your job is to generate DETAILED manual test cases organized by category (Functional, Negative, Edge Cases, Accessibility) for user stories.

1. GENERATE ALL 4 CATEGORIES WITH APPROPRIATE COVERAGE:
   
   a) Functional Tests:
      - Cover major happy paths and success flows
      - Test primary features and key integrations
      - Include data validation and success confirmations
      - Test with different user roles where applicable
   
   b) Negative Tests:
      - Test failure scenarios and error conditions
      - Invalid inputs and boundary violations
      - Permission/authentication failures
   
   c) Edge Cases:
      - Test boundary conditions and limits
      - Unusual but valid data combinations
      - Extreme scenarios (empty/large datasets)
   
   d) Accessibility Tests:
      - WCAG 2.1 compliance testing
      - Keyboard navigation and screen readers
      - Focus management and contrast

2. TEST CASE STRUCTURE - DETAILED and COMPREHENSIVE:
   - id: "TC-FUNC-001" format (unique per category)
   - title: DESCRIPTIVE title that clearly states what is being tested
   - category: "Functional", "Negative", "Edge Cases", or "Accessibility"
   - priority: "High" (critical features), "Medium" (important), "Low" (nice-to-have)
   - preconditions: Array of 2-5 SPECIFIC prerequisites
     * System state (logged in, on specific page, data loaded)
     * User permissions and roles
     * Required data setup (test data, configurations)
     * Browser/environment requirements
   - steps: Array of 3-8 DETAILED steps with:
     * step number
     * action: SPECIFIC action to perform (exact button names, field labels, data to enter)
     * expectedResult: SPECIFIC expected outcome (exact messages, UI changes, data states)
   - postconditions: Array of 2-4 SPECIFIC outcomes
     * Data state after test (what was saved, updated, deleted)
     * System state (user still logged in, page displayed)
     * Cleanup requirements (if any)

3. OUTPUT FORMAT - CRITICAL:
   🚨 RETURN ONLY RAW JSON - NO MARKDOWN BLOCKS, NO EXPLANATIONS
   🚨 Start with [ and end with ]
   🚨 Do NOT wrap in markdown code blocks
   🚨 Just pure JSON array, nothing else
   🚨 ENSURE ALL STRINGS ARE PROPERLY ESCAPED (quotes, newlines, etc.)
   🚨 NO TRAILING COMMAS - Check your JSON is syntactically valid
   🚨 If text contains quotes, escape them with backslash: \"
   🚨 If text contains newlines, use \\n
   🚨 Test your JSON syntax before responding!

Example of CORRECT output:
[{"storyId":"123","storyTitle":"Title","functional":[...],"negative":[...],"edgeCases":[...],"accessibility":[...]}]

⚠️ VALIDATION CHECKLIST before responding:
- No markdown code blocks (triple backticks)
- All strings properly quoted and escaped
- No trailing commas
- All braces and brackets properly closed
- Valid JSON that can be parsed by JSON.parse()

Do NOT add ANY markdown formatting or explanations. Just the raw JSON array!`;

export function getManualTestCaseUserPrompt(
  userStories: any[],
  testCaseTypes?: { functional: boolean; negative: boolean; edgeCases: boolean; accessibility: boolean }
): string {
  // Determine which categories to generate
  const selectedCategories = testCaseTypes || { functional: true, negative: true, edgeCases: true, accessibility: true };
  const categoriesToGenerate = [];
  
  if (selectedCategories.functional) categoriesToGenerate.push({ key: 'functional', name: 'Functional' });
  if (selectedCategories.negative) categoriesToGenerate.push({ key: 'negative', name: 'Negative' });
  if (selectedCategories.edgeCases) categoriesToGenerate.push({ key: 'edgeCases', name: 'Edge Cases' });
  if (selectedCategories.accessibility) categoriesToGenerate.push({ key: 'accessibility', name: 'Accessibility' });
  
  console.log("[Prompt] Selected categories to generate:", categoriesToGenerate.map(c => c.name).join(", "));
  
  const storiesFormatted = userStories
    .map(
      (story) => {
        let storyText = `Story ID: ${story.id}
Title: ${story.title}
Description: ${story.description || "No description provided"}`;

        // Traceability context — included when available so test cases stay grounded in the source document
        if (story.brdTitle || story.requirementName || story.epicTitle || story.featureTitle) {
          storyText += `\nTraceability:`;
          if (story.brdTitle) storyText += `\n  Source BRD: ${story.brdTitle}`;
          if (story.requirementName) storyText += `\n  Requirement: ${story.requirementName}`;
          if (story.epicTitle) storyText += `\n  Epic: ${story.epicTitle}`;
          if (story.featureTitle) storyText += `\n  Feature: ${story.featureTitle}`;
          storyText += `\n\nIMPORTANT: All test cases must be strictly derived from and aligned with the context of the Source BRD and Requirement listed above. Do not introduce scenarios outside the scope of that source document.`;
        }

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
          storyText += `\nTest Cases to Implement:`;
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
          storyText += `\nTest Cases to Implement:`;
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

        return storyText;
      }
    )
    .join("\n\n---\n\n");

  return `## User Stories with Test Cases to Convert:

${storiesFormatted}

## Your Task: ${categoriesToGenerate.length === 4 ? 'COMPREHENSIVE' : 'SELECTIVE'} TEST CASE GENERATION

🚨🚨🚨 GENERATE TEST COVERAGE FOR THE FOLLOWING ${categoriesToGenerate.length} CATEGORIES ONLY 🚨🚨🚨

${categoriesToGenerate.map((cat, idx) => {
  const num = idx + 1;
  if (cat.key === 'functional') {
    return `${num}. **Functional Tests**
   - Cover ALL major success scenarios and workflows
   - Test different user roles, permissions, and data states
   - Verify ALL UI elements, notifications, and feedback
   - Include integration scenarios and data flow
   - Think: "What should work perfectly for the user?"`;
  } else if (cat.key === 'negative') {
    return `${num}. **Negative Tests**
   - Test EVERY possible failure point
   - Invalid inputs: empty, null, wrong format, special chars, SQL injection
   - Boundary violations: too long/short, negative numbers, future dates
   - Permission failures: unauthorized access, expired sessions
   - System errors: network failures, timeouts, server errors
   - Think: "How can this break? What could go wrong?"`;
  } else if (cat.key === 'edgeCases') {
    return `${num}. **Edge Cases**
   - Test ALL boundaries: min/max values, character limits, list sizes
   - Unusual valid combinations: special characters, Unicode, emojis
   - Extreme scenarios: very large data sets, empty data sets
   - Browser quirks and compatibility issues
   - Performance edge cases: simultaneous users, rapid actions
   - Think: "What unusual but valid scenarios might occur?"`;
  } else if (cat.key === 'accessibility') {
    return `${num}. **Accessibility Tests**
   - COMPLETE keyboard navigation (Tab, Shift+Tab, Enter, Escape, Arrow keys)
   - Screen reader testing (announcements, labels, landmarks)
   - Focus management (visible indicators, logical order, no traps)
   - Color and contrast (sufficient contrast ratios, no color-only info)
   - Text sizing and zoom (works at 200% zoom)
   - ARIA implementation (roles, labels, live regions, states)
   - Mobile accessibility (touch targets, gestures)
   - Think: "Can users with disabilities fully use this feature?"`;
  }
  return '';
}).join('\n\n')}

🚨 MANDATORY REQUIREMENTS:
- Generate ONLY the ${categoriesToGenerate.length} categories listed above: ${categoriesToGenerate.map(c => c.name).join(', ')}
- Generate in ORDER: ${categoriesToGenerate.map(c => c.key).join(' → ')}
- ALL test cases must be DETAILED with SPECIFIC steps and expectations
- Be AGGRESSIVE: hunt for bugs, think of every possible scenario
- Cover EVERY aspect: UI, data, permissions, errors, edge cases, accessibility

For EACH test case:
1. Preconditions: 2-5 SPECIFIC items
   - System/user state, permissions, data setup, environment
   - Be DETAILED: exact page names, exact roles, exact data

2. Steps: 3-8 DETAILED steps
   - Be SPECIFIC: exact button names ("Click 'Save' button in top-right")
   - Include data: exact values to enter ("Enter 'admin@test.com' in Email field")
   - Expected results: SPECIFIC outcomes ("Success message 'User created' appears in green banner at top")

3. Postconditions: 2-4 SPECIFIC outcomes
   - Data state: what was saved/updated/deleted
   - System state: where user ends up
   - Side effects: notifications, logs, audit trails

## CRITICAL JSON FORMAT:

🚨 YOU MUST FOLLOW THIS EXACT STRUCTURE 🚨

Return ONLY valid JSON. No markdown, no explanations. EXACTLY this structure:

[
  {
    "storyId": "story-1",
    "storyTitle": "exact story title",
${categoriesToGenerate.map(cat => `    "${cat.key}": [
      {
        "id": "TC-${cat.key.toUpperCase().substring(0, 4)}-001",
        "title": "Test case title",
        "category": "${cat.name}",
        "priority": "High",
        "preconditions": ["Precondition 1", "Precondition 2"],
        "steps": [
          {"step": 1, "action": "Action to perform", "expectedResult": "Expected outcome"}
        ],
        "postconditions": ["Outcome 1"]
      }
    ]`).join(',\n')}
  }
]

🚨 THIS IS THE EXACT FORMAT - DO NOT DEVIATE
${categoriesToGenerate.length < 4 ? `🚨 IMPORTANT: Generate ONLY these ${categoriesToGenerate.length} categories: ${categoriesToGenerate.map(c => c.name).join(', ')}. Do NOT generate other categories.` : ''}

🚨🚨🚨 FINAL INSTRUCTIONS - ${categoriesToGenerate.length === 4 ? 'COMPREHENSIVE' : 'SELECTIVE'} TEST GENERATION 🚨🚨🚨

1. Generate AGGRESSIVE, THOROUGH test cases for the ${categoriesToGenerate.length} selected categories ONLY.

2. Make EACH test case DETAILED and SPECIFIC:
   - 2-5 preconditions (exact system/user state)
   - 3-8 steps (exact actions and expected results)
   - 2-4 postconditions (exact outcomes and side effects)

3. Be AGGRESSIVE in coverage:
   - Think of EVERY possible scenario
   - Hunt for bugs like a senior QA engineer
   - Cover edge cases others might miss

4. Return ONLY raw JSON - start with [ and end with ]
   DO NOT use markdown code blocks
   Just the pure JSON array
   ${categoriesToGenerate.length < 4 ? `\n   ONLY include these ${categoriesToGenerate.length} categories in the JSON: ${categoriesToGenerate.map(c => c.key).join(', ')}` : ''}

NOW generate ${categoriesToGenerate.length === 4 ? 'COMPREHENSIVE' : 'SELECTIVE'} test cases for ${categoriesToGenerate.map(c => c.name).join(', ')} ONLY (raw JSON, no markdown):`;
}

export default {
  MANUAL_TEST_CASE_SYSTEM_PROMPT,
  getManualTestCaseUserPrompt,
};
