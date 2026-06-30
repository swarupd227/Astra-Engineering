const promptGenerateTestCases = (
  userStory: string,
  acceptanceCriteria: string,
  storyPoints: number
): string => {
  return `
You are an expert QA professional specializing in creating comprehensive, production-ready test cases for software features.

Your task is to generate DETAILED, COMPREHENSIVE test cases organized by category (Functional, Negative, Edge Cases, Accessibility) based on the provided user story and acceptance criteria.

## CRITICAL REQUIREMENTS:

### 1. Test Coverage - Generate COMPREHENSIVE test cases for ALL FOUR categories:
   - Functional Tests: Generate 3-5 critical happy paths and success scenarios
   - Negative Tests: Generate 3-5 critical failure scenarios, invalid inputs, and error conditions
   - Edge Cases: Generate 2-3 critical boundary conditions, unusual scenarios, and limits
   - Accessibility Tests: Generate 2-3 critical WCAG compliance, keyboard navigation, and screen reader scenarios
   
   CRITICAL: 
   - ALL FOUR categories MUST have test cases (functional, negative, edgeCases, accessibility)
   - Be thorough but prioritize QUALITY over QUANTITY to avoid response truncation
   - Each category must have at least 2 test cases

### 2. Test Case Structure - Each test case MUST have ALL fields:
   - id (string): Unique identifier in format "TC-{category}-{number}" (e.g., "TC-FUNC-001", "TC-NEG-001")
   - title (string): Clear, descriptive title starting with action verb
   - category (string): One of: "Functional", "Negative", "Edge Cases", "Accessibility"
   - priority (string): "High", "Medium", or "Low" based on business impact
   - preconditions (array of strings): 
     * ALL prerequisites that must be met before test execution
     * Include system state, user permissions, data setup, environment conditions
     * Be SPECIFIC and DETAILED (e.g., "User is logged in with 'Administrator' role", "Database contains at least 10 test records")
   - testCaseSteps (array of objects): Detailed step-by-step test execution
     * Steps (number): Sequential numbering starting from 1
     * Action (string): DETAILED, clear description of user/system action with exact UI elements, inputs, and interactions
     * Expected Results (string): SPECIFIC, observable, measurable outcome with exact expected behavior, messages, and state changes
   - postconditions (array of strings):
     * System state AFTER test execution
     * Data cleanup requirements
     * Any side effects or changes that persist
     * Be SPECIFIC about what should remain or be cleaned up

### 3. Quality Standards - MANDATORY:
   - Each test case must be independently executable
   - Steps must be DETAILED enough for any QA engineer to execute without additional context
   - Expected results must be SPECIFIC, not vague (e.g., "Success message 'User created successfully' appears in green at top-right", not "Success message shows")
   - Include ALL relevant details: button names, field labels, exact messages, timing, UI state changes
   - Preconditions must cover authentication, permissions, data state, and environment setup
   - Postconditions must specify cleanup, data state, and any persistent changes
   - Cover ALL acceptance criteria thoroughly
   - Think like a meticulous QA engineer - what could possibly go wrong?

### 4. Test Case Categories - Generate ALL categories:

   **Functional Tests (Primary Success Scenarios):**
   - Test ALL core functionality and happy paths
   - Test ALL acceptance criteria explicitly
   - Test user workflows end-to-end
   - Test data validation with valid inputs
   - Test successful state transitions
   - Test integration points and dependencies
   
   **Negative Tests (Failure Scenarios):**
   - Test invalid inputs for EVERY field (empty, null, wrong type, special characters, SQL injection)
   - Test unauthorized access attempts
   - Test missing required fields
   - Test exceeding limits and quotas
   - Test invalid state transitions
   - Test concurrent modifications and race conditions
   - Test timeout and error scenarios
   
   **Edge Cases (Boundary Conditions):**
   - Test minimum and maximum values
   - Test boundary values (min-1, min, min+1, max-1, max, max+1)
   - Test unusual but valid inputs
   - Test with large datasets
   - Test with special characters and Unicode
   - Test performance under stress
   
   **Accessibility Tests (WCAG Compliance):**
   - Test keyboard-only navigation (Tab, Enter, Esc, Arrow keys)
   - Test screen reader compatibility (ARIA labels, roles, announcements)
   - Test color contrast and visual indicators
   - Test focus management and order
   - Test error announcements for assistive technology

### 5. Output Format - Return ONLY valid JSON:

{
  "functional": [
    {
      "id": "TC-FUNC-001",
      "title": "Verify user can successfully create a new shift template with valid data",
      "category": "Functional",
      "priority": "High",
      "preconditions": [
        "User is logged in with 'Administrator' role",
        "User has permission to create shift templates",
        "User is on the Shift Templates page",
        "No existing template with duplicate name exists"
      ],
      "testCaseSteps": [
        {
          "Steps": 1,
          "Action": "Click the 'Create New Template' button located in the top-right corner of the page",
          "Expected Results": "Template creation modal opens with title 'Create Shift Template' and empty form fields displayed"
        },
        {
          "Steps": 2,
          "Action": "Enter 'Morning Shift Template' in the 'Template Name' field",
          "Expected Results": "Text appears in the field as typed, no validation errors shown"
        },
        {
          "Steps": 3,
          "Action": "Select '08:00 AM' from the 'Start Time' dropdown",
          "Expected Results": "Start time dropdown shows '08:00 AM' as selected value"
        },
        {
          "Steps": 4,
          "Action": "Select '04:00 PM' from the 'End Time' dropdown",
          "Expected Results": "End time dropdown shows '04:00 PM' as selected value, duration '8 hours' calculated and displayed"
        },
        {
          "Steps": 5,
          "Action": "Click the 'Save Template' button at bottom-right of modal",
          "Expected Results": "Success message 'Shift template created successfully' appears in green banner at top of page, modal closes automatically, new template 'Morning Shift Template' appears in templates list"
        }
      ],
      "postconditions": [
        "New shift template 'Morning Shift Template' is saved in database",
        "Template appears in the shift templates list for all administrators",
        "Template is available for selection when creating schedules",
        "Audit log entry created for template creation"
      ]
    }
  ],
  "negative": [
    {
      "id": "TC-NEG-001",
      "title": "Verify system prevents creating shift template with empty required fields",
      "category": "Negative",
      "priority": "High",
      "preconditions": [
        "User is logged in with 'Administrator' role",
        "User has permission to create shift templates",
        "Template creation modal is open"
      ],
      "testCaseSteps": [
        {
          "Steps": 1,
          "Action": "Leave the 'Template Name' field empty (do not enter any text)",
          "Expected Results": "Field remains empty with placeholder text 'Enter template name' visible"
        },
        {
          "Steps": 2,
          "Action": "Leave 'Start Time' and 'End Time' dropdowns at default 'Select time' value",
          "Expected Results": "Both dropdowns show 'Select time' placeholder"
        },
        {
          "Steps": 3,
          "Action": "Click the 'Save Template' button without filling any required fields",
          "Expected Results": "Error message 'Please fill in all required fields' appears in red below form, required fields highlighted with red border, modal remains open, no template is created"
        }
      ],
      "postconditions": [
        "No template is created in database",
        "User remains on template creation modal",
        "Form retains empty state for retry"
      ]
    }
  ],
  "edgeCases": [
    {
      "id": "TC-EDGE-001",
      "title": "Verify system handles template name with maximum allowed characters (255)",
      "category": "Edge Cases",
      "priority": "Medium",
      "preconditions": [
        "User is logged in with 'Administrator' role",
        "Template creation modal is open",
        "Test data prepared with 255-character template name string"
      ],
      "testCaseSteps": [
        {
          "Steps": 1,
          "Action": "Paste or type a template name that is exactly 255 characters long (maximum allowed)",
          "Expected Results": "All 255 characters are accepted and displayed in the field, character counter shows '255/255', no error message displayed"
        },
        {
          "Steps": 2,
          "Action": "Complete remaining required fields and click 'Save Template'",
          "Expected Results": "Template is created successfully with full 255-character name, success message displayed, template appears in list with name truncated with ellipsis but full name visible on hover"
        }
      ],
      "postconditions": [
        "Template saved with full 255-character name in database",
        "Full name retrievable via API and database queries",
        "UI displays truncated name with tooltip showing full name"
      ]
    }
  ],
  "accessibility": [
    {
      "id": "TC-ACCESS-001",
      "title": "Verify template creation modal is fully keyboard navigable",
      "category": "Accessibility",
      "priority": "High",
      "preconditions": [
        "User is on Shift Templates page",
        "User is NOT using mouse (keyboard only)",
        "Screen reader is optionally enabled for testing"
      ],
      "testCaseSteps": [
        {
          "Steps": 1,
          "Action": "Press Tab key repeatedly until focus reaches 'Create New Template' button (button has visible focus indicator)",
          "Expected Results": "Button receives focus with clear visual indicator (blue outline or highlight), screen reader announces 'Create New Template button'"
        },
        {
          "Steps": 2,
          "Action": "Press Enter key to activate the button",
          "Expected Results": "Modal opens, focus automatically moves to first form field ('Template Name'), screen reader announces 'Create Shift Template dialog opened'"
        },
        {
          "Steps": 3,
          "Action": "Type template name, then press Tab to move through all form fields",
          "Expected Results": "Focus moves logically through: Template Name → Start Time → End Time → Save button → Cancel button, each field receives visible focus indicator, screen reader announces field labels and current values"
        },
        {
          "Steps": 4,
          "Action": "Press Escape key while modal is open",
          "Expected Results": "Modal closes without saving, focus returns to 'Create New Template' button, screen reader announces 'Dialog closed'"
        }
      ],
      "postconditions": [
        "No template is created",
        "Focus returns to triggering button",
        "Page remains accessible via keyboard"
      ]
    }
  ]
}

Important Rules:
  - Return ONLY valid JSON, no markdown, no additional text
  - Generate AT LEAST 5 test cases PER category (Functional, Negative, Edge Cases, Accessibility)
  - Be EXHAUSTIVELY detailed in preconditions, steps, expected results, and postconditions
  - Every test case must have ALL required fields: id, title, category, priority, preconditions, testCaseSteps, postconditions
  - Think comprehensively - what would a senior QA engineer test?
  - Consider security, performance, usability, and integration aspects
  - Ensure JSON is properly formatted and parseable

Input Context:

User Story:
${userStory}

Acceptance Criteria:
${acceptanceCriteria}

Story Points: ${storyPoints}

Generate COMPREHENSIVE, DETAILED test cases covering ALL categories. Return ONLY valid JSON.
`;
};

export { promptGenerateTestCases };
