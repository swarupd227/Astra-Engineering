# Artifacts Generation Summary

**Last Updated:** December 18, 2025

## Overview
This document provides a complete reference for how agile artifacts (Epics, Features, User Stories, Acceptance Criteria, and Testcases) are generated in the DevX platform.

---

## 1. Prompt Files Used

### 1.1 Main Workflow Requirements Prompt
**File:** `server/prompts/prompt_workflow_requirements.ts`
**Export:** `promptWorkflowRequirements(requirement: string, personasToUse: any[])`

**Purpose:** Generate complete artifact structure (Epics, Features, User Stories) from business requirements in a **SINGLE LLM call**

**Key Sections:**
- Input requirements and persona context
- Epic generation rules
- Feature generation rules
- User story generation rules
- Acceptance Criteria generation rules (inline with user stories) ← **Direct, NOT delegated**
- Subtasks generation guidelines
- Testcases section

**Important:** This prompt generates ACs **inline** as part of batch artifact generation. For individual story AC enhancement or re-generation, see `prompt_acceptance_criteria.ts`

---

### 1.2 Acceptance Criteria Prompt
**File:** `server/prompts/prompt_acceptance_criteria.ts`
**Export:** `promptenhanceAcceptanceCriteria(acCount, storyPoints, domainConsiderations)`

**Purpose:** Generate acceptance criteria for individual user stories

**Key Features:**
- Simple title-based format (no Given/When/Then required)
- Output: `#1 Form validates all required fields correctly`
- Testable by QA without requiring Given/When/Then breakdowns
- Outcome-focused, business-readable language

---

### 1.3 Subtasks Breakdown Prompt
**File:** `server/prompts/prompt_break_Down_Userstory.ts`
**Export:** `breakDownUserstory(storyPoints, storyTitle, criteriaText)`

**Purpose:** Decompose a user story into actionable development subtasks

**Categories Covered:**
- Backend Development
- Frontend Development
- Database Changes
- Testing
- Documentation
- Deployment

---

### 1.4 Artifact Summary Prompt
**File:** `server/prompts/prompt_artifact_summary.ts`
**Export:** `promptArtifactSummary(artifacts)`

**Purpose:** Generate executive summary of generated artifacts

**Summary Includes:**
- Overview (2-3 sentences)
- Key metrics (counts)
- Epic summaries with business value
- Feature highlights (3-5 most important)
- Story distribution analysis
- Completeness assessment
- Next steps (3-4 recommendations)

---

## 2. Service Functions & Logic

### 2.1 Main Artifact Generation Function
**File:** `server/ai-service.ts`
**Function:** `generateAgileArtifacts(requirement, complianceGuidelines, backlogContext, selectedPersonaIds)`
**Lines:** 2314-2880

**Flow:**
1. Accept business requirement and persona context (Lines 2314-2350)
2. Build prompt with workflow requirements template (Lines 2360-2750)
3. Call LLM with prompt (Lines 2760-2810)
4. Parse JSON response (Lines 2820-2850)
5. Validate artifact structure (Lines 2880-2940)
6. **NEW:** Normalize and validate testCases array (Lines 2927-2950)
7. Return artifacts object

**Key Validations:**
- Epics: must have id and title (Line 2900)
- Features: must have id, title, epicId (Line 2915)
- User Stories: must have id, title, featureId, epicId (Line 2920)
- **TestCases:** auto-creates empty array if missing, normalizes structure (Lines 2927-2950)

**TestCases Normalization Logic (Lines 2927-2950):**
```typescript
// Ensure all user stories have testCases array
artifacts.userStories = artifacts.userStories.map((story: any) => ({
  ...story,
  testCases: story.testCases && Array.isArray(story.testCases) 
    ? story.testCases.map((tc: any) => ({
        id: tc.id || `TC-${Math.random().toString(36).substr(2, 9)}`,
        scenario: tc.scenario || tc.title || "Test case",
        steps: Array.isArray(tc.steps) ? tc.steps : typeof tc.steps === 'string' ? [tc.steps] : [],
        expectedResult: tc.expectedResult || tc.expected || "Verify the scenario completes successfully",
      }))
    : []
}));
```

---

### 2.2 Acceptance Criteria Generation Function
**File:** `server/ai-service.ts`
**Function:** `enhanceAcceptanceCriteria(data)`
**Lines:** 4708-4767

**Parameters:**
- acCount: Number of criteria to generate
- storyTitle: User story title
- storyPoints: Complexity indicator
- personaContext: Persona information
- domainConsiderations: Industry-specific guidance

**Output Format:**
```
Acceptance Criteria
#1 Form validates all required fields correctly
#2 System prevents duplicate email registrations
#3 Password is stored hashed and not in plain text
```

---

### 2.3 Subtasks Generation Function
**File:** `server/ai-service.ts`
**Function:** `generateSubtasksFromACs(data)`
**Lines:** 4833-4899

**Input:**
- storyTitle: User story title
- acceptanceCriteria: Array of AC objects
- storyPoints: Story points (default 3)

**Output:**
- Array of actionable developer subtasks with category prefixes

---

### 2.4 Artifact Summary Generation Function
**File:** `server/ai-service.ts`
**Function:** `generateArtifactSummary(artifacts)`
**Lines:** 4911-4955

**Input:**
```typescript
{
  epics: any[];
  features: any[];
  userStories: any[];
  guidelines?: any;
}
```

**Output:** Executive summary (400-600 words) suitable for stakeholder review

---

## 3. Data Schema & Structures

### 3.1 TestCase Schema
**File:** `shared/schema.ts` (Lines 959-964)
```typescript
export const testCaseSchema = z.object({
  id: z.string(),
  scenario: z.string(),
  steps: z.array(z.string()),
  expectedResult: z.string(),
});
```

### 3.2 Enhanced User Story Schema
**File:** `shared/schema.ts` (Lines 966-968)
```typescript
export const enhancedUserStorySchema = userStorySchema.extend({
  subtasks: z.array(subtaskSchema).default([]),
  testCases: z.array(testCaseSchema).default([]),
});
```

### 3.3 User Story Schema
**File:** `shared/schema.ts` (Lines 106-124)
```typescript
export const userStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  persona: z.string(),
  personaId: z.string(),
  acceptanceCriteria: z.array(acceptanceCriterionSchema),
  subtasks: z.array(z.string()).optional(),
  pushedTasks: z.array(z.number()).optional(),
  priority: z.enum(["High", "Medium", "Low"]),
  storyPoints: z.number(),
  featureId: z.string(),
  epicId: z.string(),
  adoWorkItemId: z.number().optional(),
});
```

---

## 4. Artifacts Generation Flow (End-to-End)

```
User Requirement (Business Need)
          ↓
   [generateAgileArtifacts]
   Lines: 2314-2880 (ai-service.ts)
          ↓
   Use: promptWorkflowRequirements
   File: server/prompts/prompt_workflow_requirements.ts
          ↓
   LLM Call (Azure OpenAI or Replit AI)
   Lines: 2760-2810 (ai-service.ts)
          ↓
   JSON Parse & Extract
   Lines: 2820-2850 (ai-service.ts)
          ↓
   Validation & Normalization
   Lines: 2880-2950 (ai-service.ts)
          ├── Validate Epic structure (Line 2900)
          ├── Validate Feature structure (Line 2915)
          ├── Validate User Story structure (Line 2920)
          └── Normalize TestCases (Lines 2927-2950) ← NEW
          ↓
   Return Artifacts Object with:
   ├── epics[]
   ├── features[]
   └── userStories[]
       ├── acceptanceCriteria[]
       ├── subtasks[]
       └── testCases[] ← NEW
```

---

## 5. API Endpoint Integration

**Endpoint:** `POST /api/workflow/generate-artifacts`

**Request:**
```json
{
  "requirement": "User story requirement text",
  "personaIds": ["persona-1", "persona-2"],
  "complianceGuidelines": []
}
```

**Response:**
```json
{
  "epics": [
    {
      "id": "epic-1",
      "title": "Epic Title",
      "description": "...",
      "priority": "High"
    }
  ],
  "features": [
    {
      "id": "feature-1",
      "title": "Feature Title",
      "epicId": "epic-1",
      "description": "..."
    }
  ],
  "userStories": [
    {
      "id": "story-1",
      "title": "Story Title",
      "featureId": "feature-1",
      "epicId": "epic-1",
      "description": "...",
      "storyPoints": 3,
      "priority": "High",
      "acceptanceCriteria": [
        {
          "title": "#1 Form validates all required fields correctly"
        }
      ],
      "subtasks": [
        "Create user authentication API endpoint",
        "Design and implement login form UI component"
      ],
      "testCases": [
        {
          "id": "TC-1",
          "scenario": "User successfully submits form with all required fields",
          "steps": ["Navigate to form", "Fill all fields", "Click Submit"],
          "expectedResult": "Form submitted successfully"
        }
      ]
    }
  ]
}
```

---

## 6. Parsing & Processing Logic

### 6.1 Acceptance Criteria Parsing
**File:** `server/ai-service.ts`
**Function:** `parseAcceptanceCriteria(content: string)`
**Lines:** 4796-4830

**Process:**
1. Split content by `#\d+` or `AC #\d+` markers
2. Extract title from first line (non-Given/When/Then)
3. Extract Given/When/Then/And if present
4. **Accept ACs with just title (no Given/When/Then required)**
5. Return structured array

**Key Update (Line 4828):**
```typescript
// Add if we have at least a title (simple format) 
// OR all of Given/When/Then (detailed format)
if (ac.title || (ac.given && ac.when && ac.then)) {
  criteria.push(ac);
}
```

---

### 6.2 JSON Response Fallback Logic
**File:** `server/ai-service.ts`
**Lines:** 2820-2850

**Handles:**
1. Direct JSON parsing (Line 2820)
2. Markdown code block extraction (Lines 2832-2850)
3. Truncated response detection (Lines 2839-2850)
4. Detailed error reporting with context (Lines 2822-2850)

---

## 7. Configuration & Environment

**AI Model Configuration:**
- **Azure OpenAI:** Uses `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_ENDPOINT`
- **Fallback:** Replit AI Integration via `AI_INTEGRATIONS_OPENAI_BASE_URL`

**Model Used:** `gpt-4o` (or Azure deployment equivalent)

**Key Parameters:**
- `temperature`: 0.7 (balanced creativity + consistency)
- `max_tokens`: Varies by function
  - Artifacts generation: ~4000 tokens
  - Artifact summary: ~1500 tokens
  - AC enhancement: ~1000 tokens

---

## 8. Output Structure Example

### Generated Artifact with Testcases:
```json
{
  "id": "story-1",
  "title": "User Registration with Email Validation",
  "storyPoints": 5,
  "acceptanceCriteria": [
    { "title": "#1 Form validates all required fields correctly" },
    { "title": "#2 System prevents duplicate email registrations" },
    { "title": "#3 Password is stored hashed and not in plain text" },
    { "title": "#4 Confirmation email is sent upon successful registration" },
    { "title": "#5 System handles invalid input with appropriate error messages" }
  ],
  "subtasks": [
    "[Backend] Create user registration API endpoint",
    "[Frontend] Design registration form UI component",
    "[Database] Add user schema with email validation",
    "[Testing] Write unit tests for email validation"
  ],
  "testCases": [
    {
      "id": "TC-1",
      "scenario": "User successfully registers with valid data",
      "steps": [
        "Navigate to registration page",
        "Fill all required fields with valid data",
        "Submit form",
        "Check email inbox"
      ],
      "expectedResult": "User account created and confirmation email received"
    },
    {
      "id": "TC-2",
      "scenario": "System prevents duplicate email registration",
      "steps": [
        "Attempt to register with existing email",
        "Submit form"
      ],
      "expectedResult": "Error message: 'Email already registered'"
    },
    {
      "id": "TC-3",
      "scenario": "System validates required fields",
      "steps": [
        "Leave password field empty",
        "Submit form"
      ],
      "expectedResult": "Validation error displayed for required field"
    }
  ]
}
```

---

## 9. Key Files Summary

| File | Purpose | Lines | Key Function |
|------|---------|-------|--------------|
| `server/ai-service.ts` | Main orchestration | 2314-2950 | `generateAgileArtifacts()` |
| `server/ai-service.ts` | AC generation | 4708-4767 | `enhanceAcceptanceCriteria()` |
| `server/ai-service.ts` | Subtasks generation | 4833-4899 | `generateSubtasksFromACs()` |
| `server/ai-service.ts` | Summary generation | 4911-4955 | `generateArtifactSummary()` |
| `server/ai-service.ts` | AC parsing | 4796-4830 | `parseAcceptanceCriteria()` |
| `server/prompts/prompt_workflow_requirements.ts` | Main artifact prompt | 1-92 | `promptWorkflowRequirements()` |
| `server/prompts/prompt_acceptance_criteria.ts` | AC prompt | 1-31 | `promptenhanceAcceptanceCriteria()` |
| `server/prompts/prompt_break_Down_Userstory.ts` | Subtasks prompt | 1-48 | `breakDownUserstory()` |
| `server/prompts/prompt_artifact_summary.ts` | Summary prompt | 1-67 | `promptArtifactSummary()` |
| `shared/schema.ts` | Data schemas | 959-968 | `testCaseSchema`, `enhancedUserStorySchema` |

---

## 10. Recent Updates (v1.1)

### Added Testcases Support
- **Date:** December 18, 2025
- **Changes:**
  1. Updated `prompt_workflow_requirements.ts` with Testcases section (Lines 75-90)
  2. Added testCases normalization in `generateAgileArtifacts()` (Lines 2927-2950)
  3. Auto-validates and creates empty testCases array if missing
  4. Normalizes testCase structure (id, scenario, steps, expectedResult)

### Updated AC Output Format
- **Date:** December 18, 2025
- **Changes:**
  1. Simplified AC output to title-only format (no Given/When/Then required)
  2. Updated parsing logic to accept simple titles (Line 4828)
  3. Cleaned up UI display to show simple numbered list

---

## 11. Acceptance Criteria - Two Files Explained

### **Why TWO Files?**

There's often confusion about why AC logic appears in TWO files. Here's the clear distinction:

| Aspect | File | Purpose | Role |
|--------|------|---------|------|
| **What it is** | `prompt_acceptance_criteria.ts` | **PROMPT TEMPLATE** | The LLM instruction text |
| **What it is** | `ai-service.ts` | **SERVICE ORCHESTRATION** | The function that calls the LLM |
| **Who uses it** | `prompt_acceptance_criteria.ts` | LLM reads this | Input to the model |
| **Who uses it** | `ai-service.ts` | Backend code executes this | Manages the flow and response parsing |
| **What happens** | `prompt_acceptance_criteria.ts` | Gets passed to LLM | LLM reads the prompt |
| **What happens** | `ai-service.ts` | Calls LLM with prompt, parses response | Orchestrates the entire process |

---

### **Flow: Which One Gets Passed to LLM?**

```
User Request (Generate AC for Story)
          ↓
[generateAgileArtifacts OR enhanceAcceptanceCriteria]
(ai-service.ts - Lines 2314 or 4677)
          ↓
Import promptenhanceAcceptanceCriteria
(ai-service.ts - Line 4675)
          ↓
Call: const prompt = promptenhanceAcceptanceCriteria(acCount, storyPoints, domainConsiderations)
(ai-service.ts - Line 4751)
          ↓
Get the PROMPT TEXT from prompt_acceptance_criteria.ts
(server/prompts/prompt_acceptance_criteria.ts - Export)
          ↓
Send prompt to LLM via openai.chat.completions.create()
(ai-service.ts - Lines 4760-4773)
          ↓
LLM Processes: "You are an expert QA Engineer..."
(From prompt_acceptance_criteria.ts content)
          ↓
LLM Returns: "#1 Form validates all required fields..."
          ↓
Parse Response: parseAcceptanceCriteria()
(ai-service.ts - Line 4777)
          ↓
Return Structured AC Array
```

---

### **Code Examples:**

#### **1. The PROMPT FILE** (`prompt_acceptance_criteria.ts`)
```typescript
// This is the TEMPLATE that gets sent to LLM
const promptenhanceAcceptanceCriteria = (acCount, storyPoints, domainConsiderations) => {
  return `
You are an expert AI model specializing in writing concise, outcome-focused acceptance criteria...

Generate exactly ${acCount} acceptance criteria (based on ${storyPoints} story points)
...
  `;
};
```

**Purpose:** Provides the instruction text that the LLM reads

---

#### **2. The SERVICE FUNCTION** (`ai-service.ts` Lines 4677-4785)
```typescript
export async function enhanceAcceptanceCriteria(data: {...}) {
  // ... prepare data ...
  
  // STEP 1: Get the prompt template from prompt_acceptance_criteria.ts
  const prompt = promptenhanceAcceptanceCriteria(acCount, storyPoints, domainConsiderations);
  
  // STEP 2: Send this prompt to the LLM
  const response = await openai.chat.completions.create({
    model: modelName,
    messages: [
      { role: "system", content: "You are an expert QA Engineer..." },
      { role: "user", content: prompt }  // ← THE PROMPT FROM prompt_acceptance_criteria.ts
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });
  
  // STEP 3: Parse the LLM response
  const parsedCriteria = parseAcceptanceCriteria(response.choices[0]?.message?.content);
  
  // STEP 4: Return structured ACs
  return parsedCriteria;
}
```

**Purpose:** Orchestrates the entire flow - calls LLM with the prompt and handles the response

---

### **What Gets Passed to LLM?**

**Only `prompt_acceptance_criteria.ts` content is sent to the LLM:**

```
User Request → ai-service.ts imports → prompt_acceptance_criteria.ts 
                                             ↓
                                    Returns string template
                                             ↓
                              Sent to LLM as "user" message
```

The LLM sees:
```
You are an expert AI model specializing in writing concise, outcome-focused acceptance criteria for user stories.

1. **Format Requirements:**
  - Generate exactly 4-5 acceptance criteria (based on 3 story points)
  - Number each criterion clearly (#1, #2, #3, etc.)
  - Each AC must be a single, short sentence or phrase focused on an observable outcome
  ...
```

---

### **Analogy:**

Think of it like ordering coffee:
- **`prompt_acceptance_criteria.ts`** = The recipe (what goes into the coffee)
- **`ai-service.ts`** = The barista (reads the recipe, makes the coffee, serves it)

The customer (LLM) reads the **recipe** (`prompt_acceptance_criteria.ts`), not the barista's instructions (`ai-service.ts`).

---

### **Why Two Files Instead of One?**

✅ **Separation of Concerns:**
- Prompt file focuses on: **What to ask the LLM**
- Service file focuses on: **How to ask it and what to do with the response**

✅ **Reusability:**
- Same prompt can be used by multiple service functions
- Same prompt can be tested independently

✅ **Maintainability:**
- Prompt changes don't require code logic changes
- Service logic changes don't require prompt changes

✅ **Clarity:**
- It's obvious which file contains LLM instructions
- It's obvious which file orchestrates the flow

---

### **Summary:**

| Question | Answer |
|----------|--------|
| Which file is used for generating AC? | BOTH work together |
| Which file is sent to LLM? | **Only `prompt_acceptance_criteria.ts`** |
| Which file orchestrates the flow? | **`ai-service.ts`** |
| Where is the prompt template? | **`prompt_acceptance_criteria.ts`** |
| Where is the service function? | **`ai-service.ts`** |
| Where is JSON parsing? | **`ai-service.ts`** |

---

## 12. Debugging & Logging

**Key Debug Points:**
- Line 2810: Artifact length logged
- Line 2865: Full artifacts structure logged (first 1000 chars)
- Line 2880: Relationship debug for stories, features
- Line 2927: TestCases sample count logged

**Common Issues:**
- **Truncated Response:** Check content length > 10000 and incomplete JSON (Lines 2839-2850)
- **Duplicate Emails:** Fallback epic creation for missing epics (Lines 2895-2910)
- **Invalid Structure:** Detailed error messages with field names (Lines 2900-2920)

---

## 12. Next Steps & Improvements

- [ ] Consolidate AC prompt logic (remove duplicates from multiple files)
- [ ] Add UI component to display testCases in artifacts view
- [ ] Create test automation generation from testCases
- [ ] Add testCase execution status tracking
- [ ] Export testCases to QA management tools

---

**Document Version:** 1.1  
**Last Updated:** December 18, 2025  
**Maintained By:** DevX Engineering Team
