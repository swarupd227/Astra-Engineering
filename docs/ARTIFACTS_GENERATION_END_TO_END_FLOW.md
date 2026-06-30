# Artifacts Generation: Complete End-to-End Flow & Prompt Details

**Document Purpose:** Detailed comprehensive guide on how agile artifacts (Epics, Features, User Stories, Personas) are generated in the DevX Workflow system, with particular focus on prompt files, their locations, usage, and the complete API flow.

**Last Updated:** December 9, 2025

---

## Table of Contents

1. [End-to-End API Flow](#end-to-end-api-flow)
2. [Prompt Files Inventory](#prompt-files-inventory)
3. [Prompt Architecture & Usage](#prompt-architecture--usage)
4. [API Endpoint Details](#api-endpoint-details)
5. [AI Service Function Details](#ai-service-function-details)
6. [Data Flow & Context Building](#data-flow--context-building)
7. [JSON Response Schema](#json-response-schema)
8. [Error Handling & Validation](#error-handling--validation)
9. [Configuration & Settings](#configuration--settings)

---

## End-to-End API Flow

### High-Level Request Flow Diagram

```
Frontend (Client)
    ↓
[POST /api/workflow/generate-artifacts]
    ↓
Backend (server/routes.ts)
    ↓
generateAgileArtifacts() in server/ai-service.ts
    ├→ Load Prompts from server/prompts/*.ts
    ├→ Build Context Sections (Compliance, Backlog, Personas)
    ├→ Fetch Personas from Database
    ├→ Construct System Message
    ├→ Construct User Message
    ├→ Call Azure OpenAI / OpenAI Chat API
    ├→ Parse JSON Response
    ├→ Validate Schema
    └→ Return to Frontend
    ↓
Frontend (client/src/components/workflow/step1-conversational-refinement.tsx)
    ├→ Store in WorkflowContext (setEpics, setFeatures, setUserStories, setPersonas)
    └→ Render Hierarchical UI (Epics → Features → Stories)
```

### Complete Request-Response Lifecycle

```
1. USER ACTION
   ├─ User completes conversational refinement in Step 1
   ├─ Clicks "Generate Artifacts" button
   └─ Frontend assembles requirement text from conversation history + captured requirements

2. HTTP REQUEST
   POST /api/workflow/generate-artifacts
   Content-Type: application/json
   Request Body: {
     requirement: "Full assembled requirement text",
     complianceGuidelines?: [{ name: string, content: string }, ...],
     backlogContext?: { epics: [], features: [], userStories: [] },
     selectedPersonaIds?: ["persona-id-1", "persona-id-2", ...]
   }

3. BACKEND PROCESSING (server/routes.ts: Line 912-936)
   ├─ Validate request body
   ├─ Extract parameters: requirement, complianceGuidelines, backlogContext, selectedPersonaIds
   ├─ Call generateAgileArtifacts(requirement, complianceGuidelines, backlogContext, selectedPersonaIds)
   └─ Return response to frontend

4. ARTIFACT GENERATION (server/ai-service.ts: Lines 2313-3050)
   [Detailed in "AI Service Function Details" section below]

5. HTTP RESPONSE
   HTTP 200 OK
   Response Body: {
     epics: [...],
     features: [...],
     userStories: [...],
     personas: [...]
   }

6. FRONTEND HANDLING
   ├─ Store artifacts in WorkflowContext using setters
   ├─ Render hierarchical UI
   ├─ User can browse Epics → Features → User Stories
   └─ Optional: Call /api/workflow/save-artifacts to persist to Azure DevOps
```

---

## Prompt Files Inventory

### Location: `server/prompts/` Directory

The artifact-generation prompts are located in four files under `server/prompts/`:

| File Name | File Type | Purpose | Status | Usage |
|-----------|-----------|---------|--------|-------|
| `prompt_workflow_requirements.ts` | TypeScript Module | Stores the **USER-role prompt** (concise generation rules) | ✅ **ACTIVE** | Provides concise generation rules for the user message |
| `prompt_workflow_userstory_formatinstructions.ts` | TypeScript Module | Stores the **SYSTEM-role prompt** (enterprise-grade standards) | ✅ **ACTIVE** | Provides quality standards & user story format for the system message |
| `workflow_artifacts_system.ts` | TypeScript Adapter/Re-export | **Adapter module** that re-exports `prompt_workflow_userstory_formatinstructions` | ⚠️ **INTERMEDIARY** | Provides system prompt content; intermediate layer for abstraction |
| `workflow_artifacts_user.ts` | TypeScript Adapter/Re-export | **Adapter module** that re-exports `prompt_workflow_requirements` | ⚠️ **INTERMEDIARY** | Provides user prompt content; intermediate layer for abstraction |

### File Details

#### 1. `prompt_workflow_requirements.ts` (PRIMARY PROMPT FILE - USER ROLE)

**Location:** `server/prompts/prompt_workflow_requirements.ts`

**Purpose:** Contains the user-role prompt template with concise generation rules.

**Content Structure:**
```typescript
const promptWorkflowRequirements = {
    role: "user",
    content: `Based on this requirement, generate concise agile artifacts in JSON only:

<requirement>
GENERATION RULES:
- Generate EXACTLY 2 epics, 4 features, 8 user stories
- Distribute features evenly across epics (2 each)
- Distribute stories evenly across features (2 each)
- NO descriptions, subtasks, or extra details - omit completely
- Each AC: 3-5 per story, UNDER 200 total chars each
- Titles: concise, action-oriented
- Acceptance criteria: minimal but testable
- Use simple, direct language to save tokens
- Return ONLY JSON object - no markdown, no text

ACCEPTANCE CRITERIA TEMPLATE (Keep brief):
- 1 happy path: "User successfully [action] when [condition]"
- 1 error case: "System shows error when [invalid input/state]"
- 1 edge case: "System handles [boundary condition] correctly"

CONSTRAINTS:
- Keep everything SHORT and focused
- Omit all descriptions, workflows, and details
- Minimal acceptance criteria word count
- Avoid repetition and verbose language
- Token efficiency OVER comprehensive details
- Return ONLY valid JSON, no other text`
}
export { promptWorkflowRequirements }
```

**Key Features:**
- Generates exactly **2 epics, 4 features, 8 user stories**
- Focuses on **token efficiency** (minimal descriptions, short ACs)
- Provides **ACCEPTANCE CRITERIA TEMPLATE** with 3 types: happy path, error case, edge case
- **Concise format** optimized for fast, deterministic AI responses
- Rule: NO descriptions, subtasks, or extra details to minimize token usage

**Where It's Used:**
1. Re-exported by `workflow_artifacts_user.ts` as `workflowArtifactsUser`
2. Consumed by `generateAgileArtifacts()` in `server/ai-service.ts` (lines 2695-2920)
3. Injected into the **user message** of the OpenAI chat completion call

**Character Count:** ~1,200 characters

---

#### 2. `prompt_workflow_userstory_formatinstructions.ts` (PRIMARY PROMPT FILE - SYSTEM ROLE)

**Location:** `server/prompts/prompt_workflow_userstory_formatinstructions.ts`

**Purpose:** Contains the system-role prompt with enterprise-grade quality standards.

**Content Structure:**
```typescript
const workflowUserstoryFormatInstructions = {
  role: "system",
  content: `
You are an expert AgileManagist who produces enterprise-grade user stories following strict quality standards.
All responses must be valid JSON.
________________________________________
1. USER STORY FORMAT:
{USER_STORY_FORMAT_INSTRUCTION}
2. DESCRIPTION CONTENT (7 Mandatory Sections, in order)
Each story description MUST include:
1.	Context & Background 2 - 3 sentences explaining purpose and problem
2.	Key Functionality - detailed bullet points
3.	User Interaction Flow 3-5 numbered steps
4.	Technical Considerations - data, performance, security, dependencies
5.	Success Metrics - measurable, quantifiable outcomes
________________________________________
3. ACCEPTANCE CRITERIA (3-5 minimum, production-grade)
Each AC must be independently testable and follow this exact 2 part structure:
Each acceptance criterion MUST include ALL 5 components in this exact structure:

**Component 1: TITLE (5-8 words)**
Format: "[Action] [Object] [Result]".
Example: "User submits form with validation".

**Component 2: GIVEN (Detailed Preconditions - Minimum 15 words)**
Must include:
•	Exact persona/role + permissions
•	Precise screen/location (with path/URL)
•	Specific data conditions (IDs, statuses, field values)
•	System/environment config
•	Time-based conditions if relevant
...
`
}
export { workflowUserstoryFormatInstructions }
```

**Key Features:**
- Defines **7 MANDATORY DESCRIPTION SECTIONS**: Context & Background, Key Functionality, User Interaction Flow, Technical Considerations, Success Metrics
- Specifies **PRODUCTION-GRADE ACCEPTANCE CRITERIA** with 5 components: TITLE, GIVEN, WHEN, THEN, AND
- Includes **detailed component specifications** with minimum word counts (GIVEN ≥15 words, WHEN ≥15 words, THEN ≥25 words, AND ≥20 words)
- Provides **examples** of what good and bad acceptance criteria look like
- Focuses on **enterprise-grade quality**, comprehensive coverage, and testability

**Where It's Used:**
1. Re-exported by `workflow_artifacts_system.ts` as `workflowArtifactsSystem`
2. Consumed by `generateAgileArtifacts()` in `server/ai-service.ts` (lines 2313-2920)
3. Injected into the **system message** of the OpenAI chat completion call

**Character Count:** ~3,500+ characters (large, comprehensive prompt)

---

#### 3. `workflow_artifacts_system.ts` (ADAPTER - RE-EXPORT)

**Location:** `server/prompts/workflow_artifacts_system.ts`

**Purpose:** Adapter module that re-exports the system-level prompt content.

**Content:**
```typescript
import { workflowUserstoryFormatInstructions } from "./prompt_workflow_userstory_formatinstructions";

// Re-export the system-level prompt content for workflow artifact generation
export const workflowArtifactsSystem: string = workflowUserstoryFormatInstructions.content;

export default workflowArtifactsSystem;
```

**Why It Exists:**
- Provides a **consistent naming convention** for importing (`workflowArtifactsSystem`)
- Acts as an **abstraction layer** to allow future changes to underlying prompt implementation without breaking consumers
- Makes import statements in `ai-service.ts` more **readable and semantic** (i.e., "system artifacts prompt" vs "format instructions")

**Relationship:**
```
workflow_artifacts_system.ts
    ↓ (imports & re-exports)
prompt_workflow_userstory_formatinstructions.ts (real prompt content)
```

---

#### 4. `workflow_artifacts_user.ts` (ADAPTER - RE-EXPORT)

**Location:** `server/prompts/workflow_artifacts_user.ts`

**Purpose:** Adapter module that re-exports the user-level prompt content.

**Content:**
```typescript
import { promptWorkflowRequirements } from "./prompt_workflow_requirements";

// Re-export the user-level prompt template for workflow artifact generation
export const workflowArtifactsUser: string = promptWorkflowRequirements.content;

export default workflowArtifactsUser;
```

**Why It Exists:**
- Provides a **consistent naming convention** for importing (`workflowArtifactsUser`)
- Acts as an **abstraction layer** for semantic clarity
- Allows future consolidation or reorganization without breaking consumer code

**Relationship:**
```
workflow_artifacts_user.ts
    ↓ (imports & re-exports)
prompt_workflow_requirements.ts (real prompt content)
```

---

## Prompt Architecture & Usage

### Prompt Chain & Inheritance

```
┌─────────────────────────────────────────────────────────────┐
│  ORIGINAL PRIMARY PROMPTS                                   │
├─────────────────────────────────────────────────────────────┤
│  prompt_workflow_requirements.ts                             │
│    └─ Contains: User-role prompt (concise generation rules)  │
│                                                              │
│  prompt_workflow_userstory_formatinstructions.ts             │
│    └─ Contains: System-role prompt (quality standards)       │
└─────────────────────────────────────────────────────────────┘
         ↓ (imported & re-exported)
┌─────────────────────────────────────────────────────────────┐
│  ADAPTER MODULES (Abstraction Layer)                        │
├─────────────────────────────────────────────────────────────┤
│  workflow_artifacts_system.ts                               │
│    └─ Re-exports: .content from format instructions         │
│                                                              │
│  workflow_artifacts_user.ts                                 │
│    └─ Re-exports: .content from requirements                │
└─────────────────────────────────────────────────────────────┘
         ↓ (imported into AI service)
┌─────────────────────────────────────────────────────────────┐
│  CONSUMER                                                   │
├─────────────────────────────────────────────────────────────┤
│  generateAgileArtifacts() in server/ai-service.ts           │
│    ├─ Imports: workflowArtifactsSystem (system prompt)      │
│    ├─ Imports: workflowArtifactsUser (user prompt)          │
│    ├─ Adds context sections: Compliance, Backlog, Personas  │
│    ├─ Constructs: systemContent & userContent              │
│    └─ Sends to OpenAI Chat Completions API                 │
└─────────────────────────────────────────────────────────────┘
```

### Prompt Content Flow in `generateAgileArtifacts()`

#### Step 1: Import Adapter Modules

**Location:** `server/ai-service.ts` (implicit at top of file)

The function uses these imported modules:
- `workflowArtifactsSystem` (from `workflow_artifacts_system.ts`)
- `workflowArtifactsUser` (from `workflow_artifacts_user.ts`)

#### Step 2: Build Context Sections

**Location:** `server/ai-service.ts` lines 2313-2650

The function builds three optional context sections that **prepend** to the core system prompt:

**A. Compliance Guidelines Section**
```typescript
let complianceSection = "";
if (complianceGuidelines.length > 0) {
  complianceSection = `\n\nCOMPLIANCE REQUIREMENTS:\n\n...${complianceGuidelines...}...`;
}
```
**When Used:** When `complianceGuidelines` array is provided in the request
**Format:** Lists all compliance documents with content
**Impact:** Prepended to system message

**B. Existing Backlog Context Section**
```typescript
let backlogSection = "";
if (backlogContext && (epics.length > 0 || features.length > 0 || ...)) {
  backlogSection = `\n\nEXISTING AZURE DEVOPS BACKLOG CONTEXT:\n\n...`;
}
```
**When Used:** When `backlogContext` (existing work items) is provided
**Format:** Lists existing epics, features, user stories with IDs and states
**Impact:** Helps AI avoid duplicates and align with existing backlog

**C. Selected Personas Section**
```typescript
let personaSection = "";
if (selectedPersonaIds && selectedPersonaIds.length > 0) {
  personasToUse = AVAILABLE_PERSONAS.filter(p => selectedPersonaIds.includes(p.id));
  if (personasToUse.length > 0) {
    personaSection = `\n\nSELECTED USER PERSONAS:\n\n...`;
  }
}
```
**When Used:** When `selectedPersonaIds` (persona hub selections) are provided
**Format:** Lists selected personas with their focus, pain points, goals
**Impact:** Ensures generated stories are persona-aware

#### Step 3: Construct System Message

**Location:** `server/ai-service.ts` lines 2495-2540

The **final system message** is composed as:

```typescript
{
  role: "system",
  content: `You are an expert Agile coach and product manager who generates ENTERPRISE-GRADE user stories following strict quality standards.${complianceSection}${backlogSection}${personaSection}

QUALITY STANDARDS YOU MUST FOLLOW:

1. USER STORY FORMAT:
${userStoryFormatInstruction}

2. DESCRIPTION STRUCTURE (MANDATORY 7 SECTIONS):
...

3. ACCEPTANCE CRITERIA STANDARDS (Production-Grade Quality):
...
[Full prompt from workflowUserstoryFormatInstructions]
`
}
```

**Composition Breakdown:**
- **Base System Prompt:** "You are an expert Agile coach..."
- **+ Compliance Section:** IF provided (optional)
- **+ Backlog Context Section:** IF provided (optional)
- **+ Personas Section:** IF provided (optional)
- **+ Quality Standards & Instructions:** ALWAYS included (from `prompt_workflow_userstory_formatinstructions.ts`)

#### Step 4: Construct User Message

**Location:** `server/ai-service.ts` lines 2554-2695

The **final user message** is composed as:

```typescript
{
  role: "user",
  content: `Based on this requirement, generate high-quality agile artifacts:

${requirement}

Generate a JSON response with the following structure:
{
  "epics": [...],
  "features": [...],
  "userStories": [...],
  "personas": [...]
}

IMPORTANT REQUIREMENTS:
- Generate exactly 2 epics
- Generate exactly 4 features
- Generate 8-10 user stories
- [Persona rules - conditional based on selected personas]

*** CRITICAL: ACCEPTANCE CRITERIA REQUIREMENTS ***
- Each user story MUST have MINIMUM 3 and MAXIMUM 5 comprehensive acceptance criteria
- [Full acceptance criteria standards...]
[Content from prompt_workflow_requirements.ts]
`
}
```

**Composition Breakdown:**
- **Intro:** "Based on this requirement, generate high-quality agile artifacts..."
- **Requirement Text:** The assembled requirement from the frontend
- **JSON Schema:** Example of expected output structure
- **Artifact Count Requirements:** 2 epics, 4 features, 8-10 stories
- **Conditional Rules:** Persona distribution rules (IF personas provided)
- **Critical Requirements:** From `prompt_workflow_requirements.ts`

#### Step 5: API Call to Azure OpenAI / OpenAI

**Location:** `server/ai-service.ts` lines 2507-2530

```typescript
const response = await openai.chat.completions.create({
  model: modelName,  // "gpt-4o" or Azure deployment name
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ],
  temperature: 0.2,           // Low for deterministic output
  max_tokens: 32768,          // High for comprehensive artifacts
});
```

**Key Settings:**
- **Model:** `gpt-4o` (OpenAI) or Azure deployment (configurable)
- **Response Format:** `json_object` (enforces JSON structure)
- **Temperature:** `0.2` (low = deterministic, reproducible output)
- **Max Tokens:** `32768` (high = allows large JSON responses with all details)

---

## API Endpoint Details

### Endpoint: `POST /api/workflow/generate-artifacts`

**Location:** `server/routes.ts` lines 912-936

**HTTP Method:** POST

**Content-Type:** application/json

**Base URL:** `http://localhost:3000` (development) or configured deployment URL

**Full Endpoint URL:** `POST /api/workflow/generate-artifacts`

---

### Request Body Schema

```typescript
interface GenerateArtifactsRequest {
  requirement: string;                    // REQUIRED: Full assembled requirement text
  complianceGuidelines?: Array<{          // OPTIONAL: Compliance docs to enforce
    name: string;                         // Guideline name
    content: string;                      // Full guideline content
  }>;
  backlogContext?: {                      // OPTIONAL: Existing work items to reference
    epics: any[];                         // Existing epics (Azure DevOps format)
    features: any[];                      // Existing features
    userStories: any[];                   // Existing user stories
  };
  selectedPersonaIds?: string[];          // OPTIONAL: Persona IDs from Persona Manager
}
```

**Example Request:**
```json
{
  "requirement": "Build a user authentication system with email login and password reset...",
  "complianceGuidelines": [
    {
      "name": "Security Guidelines",
      "content": "All passwords must be hashed using bcrypt with min cost 10..."
    }
  ],
  "backlogContext": {
    "epics": [
      {
        "id": 123,
        "fields": { "System.Title": "User Management System", "System.State": "Active" }
      }
    ],
    "features": [],
    "userStories": []
  },
  "selectedPersonaIds": ["persona-1", "persona-2"]
}
```

---

### Response Schema

```typescript
interface GenerateArtifactsResponse {
  epics: Array<{
    id: string;                           // Unique epic ID
    title: string;                        // Epic title
    description: string;                  // Epic description
    priority: "High" | "Medium" | "Low";  // Priority level
    featureCount?: number;                // Count of features in epic
  }>;
  
  features: Array<{
    id: string;                           // Unique feature ID
    epicId: string;                       // References epic ID
    title: string;                        // Feature title
    description: string;                  // Feature description
    priority: "High" | "Medium" | "Low";  // Priority level
  }>;
  
  userStories: Array<{
    id: string;                           // Unique user story ID
    featureId: string;                    // References feature ID
    epicId: string;                       // References epic ID
    personaId?: string | null;            // Persona ID if persona-based
    persona?: string | null;              // Persona name if persona-based
    title: string;                        // User story title
    description: string;                  // 7-section description
    acceptanceCriteria: Array<{
      title: string;                      // AC title (5-8 words)
      given: string;                      // Preconditions (≥20 words)
      when: string;                       // User action (≥15 words)
      then: string;                       // Observable outcomes (≥25 words)
      and: string;                        // Secondary effects (≥20 words)
    }>;
    subtasks: string[];                   // Task list with categories
    storyPoints: number;                  // Estimated effort
    priority: "High" | "Medium" | "Low";  // Priority level
  }>;
  
  personas: Array<{
    id: string;
    name: string;
    role: string;
    color?: string;
    focus: string;
    painPoints: string[];
    goals: string[];
  }>;
}
```

**Example Response (Abbreviated):**
```json
{
  "epics": [
    {
      "id": "epic-1",
      "title": "User Authentication",
      "description": "Enable users to securely authenticate...",
      "priority": "High",
      "featureCount": 2
    },
    {
      "id": "epic-2",
      "title": "Account Management",
      "description": "Allow users to manage their accounts...",
      "priority": "High",
      "featureCount": 2
    }
  ],
  "features": [
    {
      "id": "feature-1",
      "epicId": "epic-1",
      "title": "Email Login",
      "description": "Enable users to log in with email and password...",
      "priority": "High"
    },
    {
      "id": "feature-2",
      "epicId": "epic-1",
      "title": "Password Reset",
      "description": "Allow users to reset forgotten passwords...",
      "priority": "High"
    }
  ],
  "userStories": [
    {
      "id": "story-1",
      "featureId": "feature-1",
      "epicId": "epic-1",
      "personaId": "persona-1",
      "persona": "Mobile User",
      "title": "As a Mobile User, I want to log in quickly using email...",
      "description": "CONTEXT & BACKGROUND: Mobile users need a fast...\nKEY FUNCTIONALITY:\n- Support email login...",
      "acceptanceCriteria": [
        {
          "title": "User successfully logs in with valid credentials",
          "given": "Mobile user 'John' is on the login screen (/login) with email field visible and password field visible; system is in production mode",
          "when": "User enters email 'john@example.com', enters password 'SecurePass123!', and taps 'Login' button",
          "then": "System validates credentials within 1 second, displays success message 'Login successful', redirects to dashboard at /dashboard within 500ms, session token is stored securely",
          "and": "And email login audit log is created with user_id=123, timestamp, ip_address, and login_success=true; user's last_login timestamp is updated in database; browser session cookie is set with secure flag"
        }
      ],
      "subtasks": [
        "Backend - Implement POST /api/auth/login endpoint with email validation - 4 hours",
        "Frontend - Create login form component with email and password fields - 3 hours",
        "Testing - Write unit tests for login validation logic - 2 hours"
      ],
      "storyPoints": 5,
      "priority": "High"
    }
  ],
  "personas": [
    {
      "id": "persona-1",
      "name": "Mobile User",
      "role": "Casual user accessing via mobile device",
      "color": "#FF6B6B",
      "focus": "Quick, seamless mobile experience",
      "painPoints": ["Slow login on mobile", "Form fields too small"],
      "goals": ["Fast authentication", "Smooth user experience"]
    }
  ]
}
```

---

### Response Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success - Artifacts generated | See response schema above |
| 400 | Bad Request - Missing/invalid requirement | `{ error: "Requirement text is required" }` |
| 500 | Server Error - AI call failed or JSON parse error | `{ error: "Failed to parse AI response as JSON: Unexpected end of JSON input" }` |

---

## AI Service Function Details

### Function Signature

**Location:** `server/ai-service.ts` lines 2313-3050

```typescript
export async function generateAgileArtifacts(
  requirement: string,
  complianceGuidelines: any[] = [],
  backlogContext?: { 
    epics: any[]; 
    features: any[]; 
    userStories: any[] 
  },
  selectedPersonaIds: string[] = []
): Promise<any>
```

### Function Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `requirement` | string | Yes | Full assembled requirement text from frontend |
| `complianceGuidelines` | array | No | Compliance documents to enforce (default: []) |
| `backlogContext` | object | No | Existing work items to reference and avoid duplicates |
| `selectedPersonaIds` | array | No | Persona IDs selected by user (default: []) |

### Function Processing Steps (Detailed)

#### Step 1: Logging & Configuration (Lines 2315-2340)
- Log input parameters for debugging
- Detect Azure OpenAI vs Replit AI Integration setup
- Log API endpoint and deployment configuration

#### Step 2: Build Compliance Section (Lines 2345-2368)
- IF `complianceGuidelines.length > 0`:
  - Prepend compliance section to system message
  - List all guidelines with instructions to follow them
  - Add compliance validation rules

#### Step 3: Build Backlog Context Section (Lines 2370-2430)
- IF existing work items provided:
  - Extract epics, features, user stories from backlog
  - List up to 10 of each type with ID, title, state
  - Provide rules to avoid duplicates and align properly
  - Include guidance on checking relevance

#### Step 4: Fetch Personas from Database (Lines 2432-2443)
- Query database for all available personas
- Call `storage.getPersonas()`
- Handle errors gracefully (log and proceed with empty list)

#### Step 5: Build Persona Context Section (Lines 2445-2490)
- IF `selectedPersonaIds.length > 0`:
  - Filter personas by selected IDs
  - Build persona section with focus, pain points, goals
  - Set rules: use ONLY selected personas, DO NOT invent new ones
  - If no personas: set rule to use functionality-focused format instead

#### Step 6: Construct System Message (Lines 2495-2540)
- Combine:
  1. Base system prompt: "You are an expert Agile coach..."
  2. + Compliance section (if provided)
  3. + Backlog context section (if provided)
  4. + Personas section (if provided)
  5. + Quality standards (from `workflowUserstoryFormatInstructions`)
- Result: Comprehensive system message with all context

#### Step 7: Construct User Message (Lines 2545-2695)
- Combine:
  1. Intro: "Based on this requirement, generate high-quality artifacts..."
  2. + Requirement text (from parameter)
  3. + JSON schema template
  4. + Artifact count requirements (2 epics, 4 features, 8-10 stories)
  5. + Conditional persona rules
  6. + Critical acceptance criteria requirements
- Result: User message with complete instruction set

#### Step 8: Call OpenAI Chat Completions API (Lines 2507-2530)
```typescript
const response = await openai.chat.completions.create({
  model: modelName,
  response_format: { type: "json_object" },
  messages: [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ],
  temperature: 0.2,
  max_tokens: 32768,
});
```

**Key Settings:**
- **response_format:** Enforces structured JSON output
- **temperature:** 0.2 = deterministic, reproducible responses
- **max_tokens:** 32768 = allows comprehensive artifact generation

#### Step 9: Extract Content from Response (Lines 2532-2537)
```typescript
const content = response.choices[0]?.message?.content || "{}";
console.log("[AI Service] Artifacts generated, length:", content.length);
```

#### Step 10: Parse JSON Response (Lines 2539-2560)
- Use `JSON.parse(content)` to parse AI response
- Catch errors and provide detailed diagnostics
- Log first/last 200 characters on parse failure
- Check for truncation (common with large payloads)

#### Step 11: Validate Schema (Lines 2562-2640)
- Validate `artifacts.epics` is non-empty array
- Validate `artifacts.features` is non-empty array
- Validate `artifacts.userStories` is non-empty array
- Check for required fields (id, title, epicId, featureId)
- Throw descriptive errors if validation fails

#### Step 12: Return Artifacts (Lines 2642-2645)
- Return parsed and validated artifacts to caller
- Response: { epics, features, userStories, personas }

### Error Handling

**Location:** Lines 2648-2650

```typescript
catch (error) {
  console.error("[AI Service] Error generating artifacts:", error);
  throw error;
}
```

**Common Errors & Diagnostics:**

| Error | Cause | Diagnosis |
|-------|-------|-----------|
| `JSON.parse` error | AI response malformed or truncated | Logs response length, first/last 200 chars |
| "AI returned empty response" | Unexpected response format | Check API response structure |
| "Generated artifacts must contain at least 1 epic" | AI didn't follow instructions | Review AI system prompt clarity |
| "Invalid features found" | Missing required fields | Check AI output schema compliance |
| "InvalidPersonas" | Selected persona IDs not found | Verify persona database state |

---

## Data Flow & Context Building

### Requirement Assembly (Frontend → Backend)

**Location:** `client/src/components/workflow/step1-conversational-refinement.tsx`

```typescript
// Lines ~349-355
const requirementText = `
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n\n')}

## CAPTURED REQUIREMENTS

Business Goals:
${capturedRequirements.businessGoals?.join('\n') || 'None'}

Target Users:
${capturedRequirements.targetUsers?.join('\n') || 'None'}

Key Features:
${capturedRequirements.keyFeatures?.join('\n') || 'None'}

Technical Constraints:
${capturedRequirements.technicalConstraints?.join('\n') || 'None'}
`;

// Lines ~375-380: POST to generate-artifacts endpoint
const response = await apiRequest("POST", "/api/workflow/generate-artifacts", {
  requirement: requirementText,
  complianceGuidelines: selectedGuidelines,
  backlogContext: currentBacklog,
  selectedPersonaIds: selectedPersonas
});
```

**Requirement Text Includes:**
1. Conversation history (all Q&A between user and AI)
2. Captured requirements sections:
   - Business Goals
   - Target Users
   - Key Features
   - Technical Constraints
   - Functional Requirements
   - Non-Functional Requirements

### Context Enhancement in `generateAgileArtifacts()`

**Compliance Context:**
```
Input: complianceGuidelines = [
  { name: "Security Guidelines", content: "..." },
  { name: "Performance Guidelines", content: "..." }
]

Output Section:
COMPLIANCE REQUIREMENTS:

You must strictly follow these 2 compliance guideline documents from the organization's Golden Repository:

=== Security Guidelines ===
All passwords must be hashed using bcrypt...
===================

=== Performance Guidelines ===
API responses must complete within 2 seconds...
===================

All generated epics, user stories, and subtasks MUST:
- Adhere to requirements specified in these guidelines
- Include compliance validation in acceptance criteria where applicable
- Reference guidelines when relevant (e.g., "As per Security Guidelines...")
```

**Backlog Context:**
```
Input: backlogContext = {
  epics: [{ id: 123, fields: { "System.Title": "Existing Epic", ... } }],
  features: [...],
  userStories: [...]
}

Output Section:
EXISTING AZURE DEVOPS BACKLOG CONTEXT:

The target Azure DevOps project already has the following work items...

EXISTING EPICS (1 total):
- [ID: 123] "Existing Epic" (Active)

IMPORTANT GUIDELINES FOR USING THIS CONTEXT:
1. AVOID DUPLICATES: Do NOT create new epics substantially similar to existing ones
2. ALIGN PROPERLY: If the new requirement fits under existing Epic/Feature, mention it
3. BUILD ON EXISTING: Reference existing work items by ID when there are dependencies
4. CHECK RELEVANCE: Only create new work items if they add distinct new value
5. COORDINATE HIERARCHY: Ensure new features align with existing epic structure
```

**Personas Context:**
```
Input: selectedPersonaIds = ["persona-1", "persona-2"]
       AVAILABLE_PERSONAS = [
         {
           id: "persona-1",
           name: "Mobile User",
           role: "Casual user on mobile",
           focus: "Quick experience",
           painPoints: ["Slow login", "Form too small"],
           goals: ["Fast auth", "Smooth UX"]
         },
         ...
       ]

Output Section:
SELECTED USER PERSONAS:

The user has specifically selected 2 persona(s) from the Persona Manager. 
You MUST use ONLY these personas when generating user stories:

Persona 1: Mobile User - Casual user on mobile
  Focus: Quick experience
  Pain Points:
    - Slow login
    - Form too small
  Goals:
    - Fast auth
    - Smooth UX

Persona 2: Desktop Admin - ...

CRITICAL PERSONA USAGE RULES:
1. Use ONLY the 2 persona(s) listed above - DO NOT create new personas
2. When writing user stories, use format: "As Mobile User OR Desktop Admin, I want..."
3. Distribute user stories across all selected personas
4. Align story goals with persona's focus, pain points, and goals listed above
5. Each persona's pain points and goals should guide feature relevance
6. Include persona's exact ID and name in user story data structure
7. Return full persona objects in 'personas' array with ALL details
```

---

## JSON Response Schema

### Complete JSON Structure

The AI response is expected to be a JSON object with this structure:

```json
{
  "epics": [
    {
      "id": "epic-1",
      "title": "Epic Title",
      "description": "Epic description...",
      "priority": "High|Medium|Low",
      "featureCount": 2
    },
    ...
  ],
  
  "features": [
    {
      "id": "feature-1",
      "epicId": "epic-1",
      "title": "Feature Title",
      "description": "Feature description...",
      "priority": "High|Medium|Low"
    },
    ...
  ],
  
  "userStories": [
    {
      "id": "story-1",
      "featureId": "feature-1",
      "epicId": "epic-1",
      "personaId": "persona-1" or null,
      "persona": "Persona Name" or "N/A",
      "title": "As [Persona] I want [goal] so that [benefit]" or "[Feature enables capability]",
      "description": "CONTEXT & BACKGROUND: ...\nKEY FUNCTIONALITY: ...\nUSER INTERACTION FLOW: ...\nTECHNICAL CONSIDERATIONS: ...\nOUT OF SCOPE: ...\nSUCCESS METRICS: ...",
      "acceptanceCriteria": [
        {
          "title": "AC Title (5-8 words)",
          "given": "Detailed preconditions (min 20 words)",
          "when": "User action (min 15 words)",
          "then": "Observable outcomes (min 25 words)",
          "and": "Secondary effects (min 20 words)"
        },
        ...
      ],
      "subtasks": [
        "Backend - Implement POST /api/endpoint with validation - 4 hours",
        "Frontend - Create component for feature - 3 hours",
        "Testing - Write unit tests - 2 hours"
      ],
      "storyPoints": 5,
      "priority": "High|Medium|Low"
    },
    ...
  ],
  
  "personas": [
    {
      "id": "persona-1",
      "name": "Persona Name",
      "role": "Persona Role",
      "color": "#HEX_COLOR",
      "focus": "Focus area",
      "painPoints": ["Pain point 1", "Pain point 2"],
      "goals": ["Goal 1", "Goal 2"]
    },
    ...
  ]
}
```

### Validation Rules

**Epics:**
- Minimum: 1 epic
- Typical: 2 epics (per prompt specification)
- Required fields: `id`, `title`
- Optional fields: `description`, `priority`, `featureCount`

**Features:**
- Minimum: 1 feature
- Typical: 4 features (per prompt specification)
- Required fields: `id`, `title`, `epicId`
- Optional fields: `description`, `priority`
- Relationship: All `epicId` values must reference existing epics

**User Stories:**
- Minimum: 1 story
- Typical: 8-10 stories (per prompt specification)
- Required fields: `id`, `title`, `featureId`, `epicId`
- Optional fields: `personaId`, `persona`, `description`, `acceptanceCriteria`, `subtasks`, `storyPoints`, `priority`
- Relationship: All `featureId` values must reference existing features; all `epicId` values must reference existing epics
- Acceptance Criteria: Each must have ALL 5 components: `title`, `given`, `when`, `then`, `and`

**Personas:**
- Only returned if personas were provided in request
- If no personas: return empty array `[]`
- Required fields: `id`, `name`, `role`
- Optional fields: `color`, `focus`, `painPoints`, `goals`

---

## Error Handling & Validation

### JSON Parse Errors

**Error Location:** `server/ai-service.ts` lines 2539-2560

**Common Causes:**
1. **Truncated Response:** AI response cut off mid-JSON (common with large payloads)
2. **Invalid JSON Syntax:** Trailing commas, unescaped quotes, mismatched brackets
3. **Incomplete JSON:** Missing closing brackets or quotes

**Error Diagnostic Output:**
```
[AI Service] JSON Parse Error: Unexpected end of JSON input at position 25432
[AI Service] Content length: 25432
[AI Service] Last 200 chars: ..."storyPoints": 5, "priority": "High", "acceptanceCriteria": [ { "title": "Test", "given": "...
[AI Service] First 200 chars: {"epics": [{"id": "epic-1", "title": "Epic 1", "description": "...
```

**Truncation Detection:**
```typescript
if (content.length > 10000 && !content.trim().endsWith('}')) {
  throw new Error(
    `AI response was truncated at ${content.length} characters. ` +
    `This typically happens when generating too many artifacts. ` +
    `The response needs to be shorter. Last chars: ${content.slice(-50)}`
  );
}
```

### Schema Validation Errors

**Error Location:** `server/ai-service.ts` lines 2562-2640

**Validation Checks:**

| Check | Condition | Error Message |
|-------|-----------|----------------|
| Epics exist | `!artifacts.epics \|\| !Array.isArray(artifacts.epics) \|\| epics.length === 0` | "Generated artifacts must contain at least 1 epic" |
| Features exist | `!artifacts.features \|\| !Array.isArray(artifacts.features) \|\| features.length === 0` | "Generated artifacts must contain at least 1 feature" |
| Stories exist | `!artifacts.userStories \|\| !Array.isArray(artifacts.userStories) \|\| stories.length === 0` | "Generated artifacts must contain at least 1 user story" |
| Epic fields | Epic missing `id` or `title` | "Invalid epics found: missing id or title. Invalid count: X" |
| Feature fields | Feature missing `id`, `title`, or `epicId` | "Invalid features found: missing id, title, or epicId. Invalid count: X" |
| Story fields | Story missing `id`, `title`, `featureId`, or `epicId` | "Invalid user stories found: missing required fields. Invalid count: X" |

### HTTP Error Responses

**Endpoint:** `server/routes.ts` lines 912-936

| Scenario | HTTP Code | Response Body |
|----------|-----------|----------------|
| Missing requirement | 400 | `{ error: "Requirement text is required" }` |
| Invalid requirement type | 400 | `{ error: "Requirement text is required" }` |
| AI call fails | 500 | `{ error: "Failed to generate agile artifacts: [specific AI error]" }` |
| JSON parse fails | 500 | `{ error: "Failed to parse AI response as JSON: [specific parse error]" }` |
| Schema validation fails | 500 | `{ error: "Generated artifacts [validation error detail]" }` |
| Unknown error | 500 | `{ error: "Failed to generate agile artifacts" }` |

---

## Configuration & Settings

### Environment Variables

**Location:** `.env` file or deployment environment

#### Azure OpenAI Configuration (IF USED):
```
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_VERSION=2024-02-01
AZURE_OPENAI_DEPLOYMENT=<deployment-name>
```

#### Replit AI Integration Configuration (IF USED):
```
AI_INTEGRATIONS_OPENAI_BASE_URL=<replit-ai-endpoint>
AI_INTEGRATIONS_OPENAI_API_KEY=<replit-ai-key>
```

**Selection Logic:**
```typescript
const useAzure =
  process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT;

const openai = useAzure ? 
  new AzureOpenAI({ ... }) : 
  new OpenAI({ baseURL: ..., apiKey: ... });
```

### AI Model Settings

**Location:** `server/ai-service.ts` lines 2507-2530

| Setting | Value | Purpose |
|---------|-------|---------|
| Model | `gpt-4o` (OpenAI) or Azure deployment | Latest, most capable model for complex reasoning |
| Temperature | `0.2` | Low temperature = deterministic, reproducible output |
| Max Tokens | `32768` | High limit to allow comprehensive, detailed artifacts |
| Response Format | `json_object` | Enforce valid JSON structure in response |

### Prompt File Locations

```
server/prompts/
├── prompt_workflow_requirements.ts              [PRIMARY USER PROMPT]
├── prompt_workflow_userstory_formatinstructions.ts [PRIMARY SYSTEM PROMPT]
├── workflow_artifacts_system.ts                 [ADAPTER - Re-exports system prompt]
└── workflow_artifacts_user.ts                   [ADAPTER - Re-exports user prompt]
```

### Key Constants in `generateAgileArtifacts()`

```typescript
// From prompt specification
const REQUIRED_EPICS = 2;
const REQUIRED_FEATURES = 4;
const REQUIRED_USER_STORIES_MIN = 8;
const REQUIRED_USER_STORIES_MAX = 10;

// From AI call settings
const TEMPERATURE = 0.2;
const MAX_TOKENS = 32768;
const RESPONSE_FORMAT = "json_object";

// Validation constants
const MIN_EPIC_ID_LENGTH = 1;
const MIN_FEATURE_ID_LENGTH = 1;
const MIN_STORY_ID_LENGTH = 1;
```

---

## Summary: Prompt Usage in Current System

### Current State (December 9, 2025)

| Aspect | Status | Details |
|--------|--------|---------|
| **Primary Prompt Files** | ✅ Active | `prompt_workflow_requirements.ts` + `prompt_workflow_userstory_formatinstructions.ts` |
| **Adapter Modules** | ✅ Active | `workflow_artifacts_system.ts` + `workflow_artifacts_user.ts` exist but are intermediary |
| **Prompt Location** | ✅ External | Prompts are stored in `/server/prompts/` (NOT embedded in code) |
| **Prompt Loading** | ✅ File-Based | Prompts are imported via TypeScript modules, not hardcoded in `ai-service.ts` |
| **Prompt Usage in API Call** | ✅ Used | Prompts are composed with context sections and sent to AI in chat completions call |
| **Backup/Legacy Prompts** | ⚠️ Possible | Inline prompts may still exist in `ai-service.ts` alongside file-based imports (need verification) |

### Prompts Used in Artifact Generation

**System Prompt Source:** `prompt_workflow_userstory_formatinstructions.ts` → `workflow_artifacts_system.ts`
- **Content:** Enterprise-grade user story format standards, 7-section descriptions, 5-component acceptance criteria
- **Where Used:** Injected into `system` message of OpenAI call
- **Word Count:** ~3,500+ characters (comprehensive)

**User Prompt Source:** `prompt_workflow_requirements.ts` → `workflow_artifacts_user.ts`
- **Content:** Concise generation rules, artifact count requirements (2 epics, 4 features, 8-10 stories), AC template
- **Where Used:** Injected into `user` message of OpenAI call (after requirement text)
- **Word Count:** ~1,200 characters (token-efficient)

### Prompts NOT Used in Artifact Generation

These prompt files exist but are NOT used by `generateAgileArtifacts()`:
- Any other files in `server/prompts/` directory (if they exist)
- Any inline prompts in other functions (e.g., `generateDesignGuidelines`, `generateConversationQuestion`)

---

## Quick Reference: Call Flow

```
1. User initiates artifact generation in Step 1 UI
   ↓
2. Frontend calls POST /api/workflow/generate-artifacts with requirement + options
   ↓
3. Backend server/routes.ts handler (line 912) receives request
   ↓
4. Calls generateAgileArtifacts(requirement, complianceGuidelines, backlogContext, selectedPersonaIds)
   ↓
5. Function builds context sections (Compliance, Backlog, Personas)
   ↓
6. Fetches prompts from server/prompts/ files:
   - workflow_artifacts_system.ts (system message content)
   - workflow_artifacts_user.ts (user message content)
   ↓
7. Constructs systemContent = systemPrompt + context sections
   Constructs userContent = requirement + jsonSchema + rules
   ↓
8. Calls openai.chat.completions.create({
     model, messages: [systemContent, userContent], 
     temperature: 0.2, max_tokens: 32768, response_format: json_object
   })
   ↓
9. Parses JSON response with error diagnostics
   ↓
10. Validates JSON schema (epics, features, stories structure)
    ↓
11. Returns artifacts to frontend
    ↓
12. Frontend stores in WorkflowContext, renders hierarchical UI
```

---

## Document Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-09 | Initial comprehensive end-to-end flow documentation with detailed prompt analysis and file inventory |

---

**For questions or clarifications on artifact generation flow, refer to:**
- API Implementation: `server/routes.ts` (line 912)
- AI Service Function: `server/ai-service.ts` (line 2313)
- Prompt Files: `server/prompts/` directory
- Frontend Integration: `client/src/components/workflow/step1-conversational-refinement.tsx`
