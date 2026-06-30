# 🏗️ Workflow Architecture & Guidelines Integration Reference

**Last Updated:** December 3, 2025  
**Purpose:** Complete technical reference for workflow logic, guideline handling, AI model integration, and output generation.

---

## 📋 Table of Contents

1. [File Structure & Entry Points](#file-structure--entry-points)
2. [API Endpoints & Routes](#api-endpoints--routes)
3. [Guidelines Flow Architecture](#guidelines-flow-architecture)
4. [AI Model Integration](#ai-model-integration)
5. [Artifact Generation Pipeline](#artifact-generation-pipeline)
6. [Output Structure & Data Models](#output-structure--data-models)
7. [Prompt Engineering & Claude Instructions](#prompt-engineering--claude-instructions)

---

## 📂 File Structure & Entry Points

### Core Workflow Files

| File | Purpose | Key Functions | Lines |
|------|---------|---|---|
| **server/routes.ts** | API route definitions & request handlers | Endpoint registration, request validation, response formatting | 1-13957 |
| **server/ai-service.ts** | Core AI logic, guideline injection, artifact generation | `generateAgileArtifacts()`, `generateDesignGuidelines()`, prompt building | 1-5704 |
| **server/workflow-ai-service.ts** | Workflow-specific conversation AI | `generateWorkflowConversationQuestion()`, phase-based questioning | 1-1050+ |
| **server/ai-client.ts** | Centralized AI client (Claude/OpenAI) | HTTP request mapping, provider abstraction | 1-150+ |
| **server/ai-config-logger.ts** | AI provider detection & logging | Environment variable parsing, model validation | 1-100+ |
| **server/code-generation-service.ts** | Code generation from stories | Optional code artifact generation | 1-200+ |
| **client/src/pages/workflow.tsx** | Frontend workflow orchestration | Step tracking, data collection, UI flow | 1-500+ |
| **client/src/components/workflow/step1-conversational-refinement.tsx** | Interactive requirement gathering | Chat interface, guideline collection | 1-1050+ |
| **shared/schema.ts** | TypeScript types for all data models | Type definitions for conversations, artifacts, guidelines | All types |

---

## 🔌 API Endpoints & Routes

### **Workflow Generation Endpoints**

#### 1. **POST `/api/workflow/generate-guidelines`**
**File:** `server/routes.ts` (Lines 496-521)

**Purpose:** Generate AI Design Guidelines from user requirements.

**Request Body:**
```json
{
  "input": "string - user requirement text",
  "capturedRequirements": {
    "businessGoals": ["string[]"],
    "targetUsers": ["string[]"],
    "keyFeatures": ["string[]"],
    "technicalConstraints": ["string[]"],
    "functionalRequirements": ["string[]"],
    "nonFunctionalRequirements": ["string[]"]
  }
}
```

**Response:**
```json
{
  "guidelines": "string - generated design guidelines text"
}
```

**Flow:**
1. Validates input (line 499)
2. Calls `generateDesignGuidelines(input, capturedRequirements)` (line 507)
3. Returns guidelines text to client

**Handler Code:** Lines 496-521

---

#### 2. **POST `/api/workflow/generate-artifacts`**
**File:** `server/routes.ts` (Lines 522-542)

**Purpose:** Generate Epics, Features, User Stories, and Personas from requirements + compliance guidelines.

**Request Body:**
```json
{
  "requirement": "string - full requirement text (conversation + captured data)",
  "complianceGuidelines": [
    {
      "id": "string",
      "name": "string - guideline name",
      "content": "string - full guideline text"
    }
  ],
  "backlogContext": {
    "epics": ["object[]"],
    "features": ["object[]"],
    "userStories": ["object[]"]
  },
  "selectedPersonaIds": ["string[]"]
}
```

**Response:**
```json
{
  "epics": [{ "title": "string", "description": "string", ... }],
  "features": [{ "title": "string", "description": "string", ... }],
  "userStories": [{ "title": "string", "description": "string", "acceptanceCriteria": [], ... }],
  "personas": [{ "id": "string", "name": "string", "role": "string", ... }]
}
```

**Flow:**
1. Validates requirement text (line 525)
2. Calls `generateAgileArtifacts(requirement, complianceGuidelines, backlogContext, selectedPersonaIds)` (line 530)
3. Returns structured artifacts

**Handler Code:** Lines 522-542

**Key Details:**
- **Guidelines Passed:** `complianceGuidelines` array (each with `name` and `content`)
- **Constraint Context:** Optional `backlogContext` prevents duplicate artifacts
- **Persona Selection:** `selectedPersonaIds` filters which personas to use for story generation

---

#### 3. **POST `/api/workflow/conversation`**
**File:** `server/routes.ts` (Lines 547-580)

**Purpose:** Get next conversational question for requirements gathering.

**Request Body:**
```json
{
  "conversationHistory": [
    { "role": "user|assistant", "content": "string" }
  ],
  "capturedRequirements": { /* same structure as above */ },
  "currentPhase": "understanding|refining|personas|artifacts",
  "askedQuestions": ["string[]"],
  "complianceGuidelines": [{ "id": "string", "name": "string", "content": "string" }],
  "isRegenerating": "boolean",
  "originalRequirement": "string"
}
```

**Response:**
```json
{
  "question": "string - next conversational question",
  "phase": "string - updated conversation phase",
  "quickReplies": ["string[]"],
  "singleSelect": "boolean",
  "capturedInfo": { /* newly captured requirements */ },
  "readyToGenerate": "boolean"
}
```

**Flow:**
1. Validates conversation history (line 553)
2. Calls `generateWorkflowConversationQuestion(...)` (line 562)
3. Returns next question + phase progression

**Handler Code:** Lines 547-580

---

## 🔄 Guidelines Flow Architecture

### Complete Data Flow Diagram

```
┌────────────────────────────────────────────────┐
│  Frontend: Workflow Page                       │
│  (workflow.tsx, step1-conversational...)       │
└────────────┬─────────────────────────────────┘
             │
             ├─► User selects compliance guidelines via Modal
             │   (ComplianceGuidelinesModal component)
             │
             └─► Guidelines stored in Workflow Context
                 (selectedGuidelines: { id, name, content })
                 │
                 └─► Passed to API requests:
                     • /api/workflow/conversation
                     • /api/workflow/generate-artifacts
                     │
┌────────────────────────────────────────────────┐
│  Backend: API Routes (server/routes.ts)        │
│                                                 │
│  POST /api/workflow/conversation                │
│  ├─ Extract: complianceGuidelines from req.body│
│  └─ Pass to: generateWorkflowConversationQues()│
│                                                 │
│  POST /api/workflow/generate-artifacts          │
│  ├─ Extract: complianceGuidelines from req.body│
│  └─ Pass to: generateAgileArtifacts()          │
└────────────┬─────────────────────────────────┘
             │
             ├─ Lines 567, 532 (route handlers)
             │  Pass guidelines to service functions
             │
┌────────────────────────────────────────────────┐
│  AI Service Layer (server/ai-service.ts)       │
│                                                 │
│  Function: generateAgileArtifacts()             │
│  ├─ Line 2315: Accept complianceGuidelines []  │
│  ├─ Line 2324: Log guideline count             │
│  ├─ Line 2355: Check if guidelines exist       │
│  ├─ Line 2356: Build compliance section        │
│  │   └─ "You must strictly follow these X      │
│  │      compliance guideline documents..."     │
│  ├─ Line 2358: forEach guideline:              │
│  │   complianceSection += `=== ${name} ===     │
│  │   ${content}...`                            │
│  │                                              │
│  └─ Line 2608-2750: Create OpenAI prompt with  │
│     injected complianceSection                 │
│                                                 │
│  Function: generateWorkflowConversationQuest() │
│  (server/workflow-ai-service.ts)               │
│  ├─ Line 618: Accept complianceGuidelines []   │
│  ├─ Line 1124: Check if guidelines exist       │
│  ├─ Line 1125: Build "COMPLIANCE GUIDELINES    │
│     ACTIVE" section                            │
│  ├─ Line 1129: forEach guideline: inject into  │
│     system prompt                              │
│  └─ Include guidelines in conversation context │
└────────────┬─────────────────────────────────┘
             │
             ├─ Compliance section embedded in
             │  system prompt before AI call
             │
┌────────────────────────────────────────────────┐
│  Claude/OpenAI API Call                         │
│  (via openai.chat.completions.create)          │
│                                                 │
│  System Prompt includes:                        │
│  • "You must strictly follow these X guidelines"│
│  • Full guideline text (name + content)        │
│  • Examples of compliance-aware ACs            │
│  • Validation requirements                     │
│                                                 │
│  Claude receives FULL guideline text           │
│  and generates compliant artifacts             │
└────────────┬─────────────────────────────────┘
             │
             ├─ Claude generates epics, features,
             │  user stories with compliance-aware
             │  acceptance criteria
             │
┌────────────────────────────────────────────────┐
│  Response Processing (ai-service.ts)           │
│                                                 │
│  Parse Claude response JSON:                    │
│  • Extract epics array                          │
│  • Extract features array                       │
│  • Extract userStories with ACs                 │
│  • Extract personas array                       │
│  • Return to API handler                        │
└────────────┬─────────────────────────────────┘
             │
┌────────────────────────────────────────────────┐
│  Frontend: Display Artifacts                    │
│  (step2-generated-content.tsx)                 │
│                                                 │
│  Show to user:                                  │
│  • Generated epics                              │
│  • Generated features                           │
│  • Generated user stories                       │
│  • Compliance-aware acceptance criteria         │
│  • Personas                                     │
└────────────────────────────────────────────────┘
```

### Guidelines Injection Points

**File:** `server/ai-service.ts`

| Location | Function | Purpose | Code |
|----------|----------|---------|------|
| **Lines 2315-2365** | `generateAgileArtifacts()` | Build compliance section from guideline objects | `complianceGuidelines.forEach(guideline => ...)` |
| **Lines 2356-2364** | Compliance Section Builder | Format guidelines for Claude injection | Creates string like `=== Guideline Name ===\nContent...` |
| **Lines 2608-2750** | Claude API Call | Inject complianceSection into system prompt | `content: \`...${complianceSection}${backlogSection}...\`` |

**File:** `server/workflow-ai-service.ts`

| Location | Function | Purpose | Code |
|----------|----------|---------|------|
| **Lines 1124-1135** | Conversation Question Generation | Inject guidelines into conversation context | Conditionally build compliance section for multi-turn conversations |

---

## 🧠 AI Model Integration

### Model Configuration

**Provider Detection:** `server/ai-config-logger.ts` (Lines 11-50)

```typescript
// Priority 1: Claude via Anthropic Azure
if (process.env.ANTHROPIC_AZURE_ENDPOINT && process.env.ANTHROPIC_API_KEY) {
  // Use Claude (Anthropic)
  console.log(`✓ Active Model: Claude (Anthropic)`);
}

// Priority 2: Azure OpenAI
else if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT) {
  // Use Azure OpenAI (GPT-4)
}

// Priority 3: Replit AI Integration (OpenAI)
else if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  // Use Replit OpenAI
}
```

### Client Abstraction Layer

**File:** `server/ai-client.ts` (Lines 1-150+)

**Purpose:** Unified interface supporting Claude, Azure OpenAI, and OpenAI

**Key Logic:**
```typescript
const useAnthropic = !!process.env.ANTHROPIC_AZURE_ENDPOINT && !!process.env.ANTHROPIC_API_KEY;

if (useAnthropic) {
  // Map OpenAI-style request to Anthropic Azure HTTP API (Lines 50-120)
  const anthropicMessages = messages.map(msg => ({ role: msg.role, content: msg.content }));
  const resp = await fetch(process.env.ANTHROPIC_AZURE_ENDPOINT!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}`,
      "anthropic-version": process.env.ANTHROPIC_MODEL_VERSION || "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL_NAME || "claude-sonnet-4-5",
      messages: anthropicMessages,
      max_tokens: 4000,
    })
  });
}
```

### OpenAI Client Initialization

**File:** `server/ai-service.ts` (Lines 1-20)

```typescript
import OpenAI from "openai";
import { AzureOpenAI } from "openai";

const useAzure = process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT;

const openai = useAzure
  ? new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-02-01",
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    })
  : new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
```

### Model Selection by Function

| Function | Model Selection | Lines |
|----------|---|---|
| `generateDesignGuidelines()` | `process.env.AZURE_OPENAI_DEPLOYMENT \|\| "gpt-4o"` | ~40 |
| `generateAgileArtifacts()` | `useAzure ? AZURE_OPENAI_DEPLOYMENT : "gpt-4o"` | ~2340 |
| `generateWorkflowConversationQuestion()` | Inherits from openai client config | workflow-ai-service.ts |

---

## 🚀 Artifact Generation Pipeline

### **Step 1: Design Guidelines Generation**

**Function:** `generateDesignGuidelines()` (Lines 25-250 in ai-service.ts)

**Input:**
- User requirement text
- Captured requirements (business goals, target users, key features, constraints)

**Process:**
1. Build enhanced context from captured requirements (Lines 45-100)
2. Extract detailed info from requirement text
3. Create system prompt with persona context
4. Call Claude/OpenAI with system + user messages
5. Return parsed guidelines text

**Claude Prompt Structure:**
```
System Role: "You are a world-class UI/UX designer and developer..."

Instruction Blocks:
1. Design Principles to follow
2. Visual hierarchy guidelines
3. Component specifications
4. Interaction patterns
5. Accessibility requirements
6. Responsive design rules

User: "Based on this requirement, generate comprehensive design guidelines..."
```

**Output:**
```
String containing:
- Visual design system
- Component library specs
- Interaction patterns
- Accessibility guidelines
- Responsive behavior
```

---

### **Step 2: Agile Artifacts Generation (PRIMARY)**

**Function:** `generateAgileArtifacts()` (Lines 2313-3100+ in ai-service.ts)

**Input:**
```typescript
{
  requirement: string,           // Full requirement + captured data
  complianceGuidelines: [],      // Array of { name, content }
  backlogContext: {              // Existing artifacts in ADO
    epics: [],
    features: [],
    userStories: []
  },
  selectedPersonaIds: []         // Personas to focus on
}
```

**Process Flow:**

**1. Guideline Injection (Lines 2355-2364)**
```typescript
let complianceSection = "";
if (complianceGuidelines.length > 0) {
  complianceSection = `\n\nCOMPLIANCE REQUIREMENTS:\n\nYou must strictly follow these ${complianceGuidelines.length} compliance guideline document${complianceGuidelines.length > 1 ? 's' : ''} from the organization's Golden Repository:\n\n`;
  
  complianceGuidelines.forEach((guideline: any) => {
    complianceSection += `=== ${guideline.name} ===\n${guideline.content}\n===================\n\n`;
  });

  complianceSection += `All generated epics, user stories, and subtasks MUST:
- Adhere to requirements specified in these guidelines
- Include compliance validation in acceptance criteria where applicable
- Reference guidelines when relevant (e.g., "As per Security Guidelines...")
- Include compliance-related subtasks if needed

Validate all artifacts against these guidelines before finalizing.\n`;
}
```

**2. Context Building (Lines 2380-2450)**
- Optional: Add existing backlog context (epics, features, user stories)
- Prevents duplicate artifact generation
- References existing work items by ID

**3. Persona Loading (Lines 2456-2490)**
```typescript
let AVAILABLE_PERSONAS: any[] = [];
try {
  AVAILABLE_PERSONAS = await storage.getPersonas();
  if (AVAILABLE_PERSONAS.length === 0) {
    await storage.initializeDefaultPersonas();
    AVAILABLE_PERSONAS = await storage.getPersonas();
  }
} catch (error) {
  // Fallback to hardcoded personas
}
```

**4. Claude API Call (Lines 2608-2750)**
```typescript
const response = await openai.chat.completions.create({
  model: modelName,
  response_format: { type: "json_object" },
  messages: [
    {
      role: "system",
      content: `You are an expert Agile coach...${complianceSection}${backlogSection}${personaSection}

QUALITY STANDARDS YOU MUST FOLLOW:
1. USER STORY FORMAT
2. DESCRIPTION STRUCTURE (MANDATORY 7 SECTIONS)
3. ACCEPTANCE CRITERIA STANDARDS (Production-Grade Quality)
   - AT LEAST 3-5 comprehensive ACs per story
   - Each AC must include: TITLE, GIVEN, WHEN, THEN, AND
   - Detailed preconditions, specific user actions, observable outcomes
4. SUBTASK FORMAT with [Category] prefixes
...
[MASSIVE PROMPT - 2700+ lines of instructions]`
    },
    {
      role: "user",
      content: `Based on this requirement, generate high-quality agile artifacts:\n\n${requirement}\n\nGenerate a JSON response with: epics, features, userStories, personas...`
    }
  ]
});
```

**5. JSON Response Parsing (Lines 2750+)**
```typescript
const parsed = JSON.parse(response.choices[0].message.content);

return {
  epics: parsed.epics || [],
  features: parsed.features || [],
  userStories: parsed.userStories || [],
  personas: parsed.personas || []
};
```

**Response Structure:**
```json
{
  "epics": [
    {
      "title": "string",
      "description": "string",
      "priority": "Critical|High|Medium|Low",
      "expectedDuration": "X weeks"
    }
  ],
  "features": [
    {
      "title": "string",
      "description": "string",
      "parentEpic": "epic ID or title",
      "priority": "Critical|High|Medium|Low"
    }
  ],
  "userStories": [
    {
      "title": "As a [persona], I want [goal], so that [benefit]",
      "description": "string (7 sections)",
      "acceptanceCriteria": [
        {
          "title": "string",
          "given": "string",
          "when": "string",
          "then": "string",
          "and": "string"
        }
      ],
      "subtasks": [
        "[Category] - specific deliverable - X hours"
      ],
      "estimatedStoryPoints": "number"
    }
  ],
  "personas": [
    {
      "id": "string",
      "name": "string",
      "role": "string",
      "color": "string (hex)",
      "focus": "string",
      "painPoints": ["string"],
      "goals": ["string"]
    }
  ]
}
```

---

### **Step 3: Artifact Saving (Routes Handler)**

**File:** `server/routes.ts` (Lines 630+)

**Endpoint:** `POST /api/workflow/save-artifacts`

**Process:**
1. Extract: `sessionId`, `projectId`, `epics`, `features`, `userStories`, `personas`
2. Store in database via `storage` service
3. Optionally push to Azure DevOps
4. Return saved artifact IDs

---

## 📊 Output Structure & Data Models

### Artifact Models

**User Story Complete Model:**
```typescript
interface UserStory {
  id?: string;
  title: string;                    // "As a [persona], I want [goal], so that [benefit]"
  description: string;              // 7-section detailed description
  priority: "Critical" | "High" | "Medium" | "Low";
  parentFeature?: string;            // Link to parent feature ID/title
  acceptanceCriteria: AcceptanceCriterion[];
  subtasks: Subtask[];
  estimatedStoryPoints?: number;
  tags?: string[];                  // ["compliance", "security", "performance"]
  relatedGuidelines?: string[];     // References to compliance guidelines used
}

interface AcceptanceCriterion {
  title: string;                    // "[Action] [Object] [Result]"
  given: string;                    // Detailed preconditions (20+ words)
  when: string;                     // Specific user action (15+ words)
  then: string;                     // Observable outcomes (25+ words)
  and: string;                      // Secondary effects & validations (20+ words)
}

interface Subtask {
  id?: string;
  title: string;                    // "[Category] - Deliverable - X hours"
  category: string;                 // "Backend" | "Frontend" | "Testing" etc.
  estimatedHours: number;
  order?: number;
}
```

**Epic Model:**
```typescript
interface Epic {
  id?: string;
  title: string;
  description: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  expectedDuration: string;         // "3-4 weeks"
  businessValue: string;
  parentInitiative?: string;
  relatedGuidelines?: string[];
}
```

**Feature Model:**
```typescript
interface Feature {
  id?: string;
  title: string;
  description: string;
  parentEpic: string;               // Link to Epic
  priority: "Critical" | "High" | "Medium" | "Low";
  userValue: string;
  acceptanceCriteria?: string[];
}
```

**Persona Model:**
```typescript
interface Persona {
  id: string;
  name: string;
  role: string;
  color: string;                    // Hex color for UI
  focus: string;                    // Primary goal/focus area
  painPoints: string[];
  goals: string[];
  skills?: string[];
  environmentPreferences?: string[];
}
```

---

## 💬 Prompt Engineering & Claude Instructions

### System Prompt Template

**Location:** `server/ai-service.ts` Lines 2608-2750

**Structure:**
```
System Role + Context
├─ Compliance Requirements Section (if guidelines provided)
│  └─ Full text of each guideline
├─ Backlog Context Section (if existing artifacts)
│  └─ References to existing epics/features/stories
├─ Personas Section
│  └─ Available personas for user story generation
└─ Quality Standards Section
   ├─ User Story Format Requirements
   ├─ Description Structure (7 mandatory sections)
   ├─ Acceptance Criteria Standards (5-component structure)
   │  ├─ Component 1: Title
   │  ├─ Component 2: GIVEN (preconditions)
   │  ├─ Component 3: WHEN (user action)
   │  ├─ Component 4: THEN (observable outcomes)
   │  └─ Component 5: AND (secondary effects)
   ├─ Subtask Format Requirements
   ├─ Coverage Requirements
   ├─ Testability Requirements
   └─ Validation Requirements
```

### Compliance Guidelines Injection Example

**Before (no guidelines):**
```
"You are an expert Agile coach..."
```

**After (with guidelines):**
```
"You are an expert Agile coach...

COMPLIANCE REQUIREMENTS:

You must strictly follow these 2 compliance guideline documents from the organization's Golden Repository:

=== Security Guidelines ===
1. All API endpoints must use OAuth 2.0 for authentication
2. Sensitive data fields must be encrypted at rest (AES-256)
3. No hardcoded credentials in configuration files
4. All user interactions must be audit-logged
...
===================

=== Accessibility Guidelines ===
1. All UI components must meet WCAG 2.1 AA standards
2. Color contrast ratios must be at least 4.5:1 for text
3. Keyboard navigation must be fully supported
...
===================

All generated epics, user stories, and subtasks MUST:
- Adhere to requirements specified in these guidelines
- Include compliance validation in acceptance criteria where applicable
- Reference guidelines when relevant (e.g., "As per Security Guidelines...")
- Include compliance-related subtasks if needed

Validate all artifacts against these guidelines before finalizing."
```

### Acceptance Criteria Detailed Format

**Claude receives exact requirements like:**

```
**Component 1: TITLE (5-8 words)**
- Use action-oriented, descriptive language
- Format: "[Action] [Object] [Result/Condition]"
- Example: "User successfully submits form with validation"

**Component 2: GIVEN (Detailed Preconditions - Minimum 20 words)**
Must include ALL of:
✓ Exact user role/persona with specific permissions
  Example: "Senior Developer with 'Code Review' permission"
✓ Specific screen/page location with exact URL
  Example: "User is on '/pull-requests/123' page"
✓ Precise data state with actual field values
  Example: "PR is 'Awaiting Review' with 3 files changed"
✓ System configuration or environmental conditions
✓ Time-based conditions if relevant

BAD: "User is logged in"
GOOD: "Senior Developer 'John Smith' with 'Code Review' permission, viewing PR #123 on '/pull-requests/123' page, PR status 'Awaiting Review', 3 files changed (125 lines added, 45 deleted), 2 of 3 approvals received, CI pipeline passed, no conflicts"
```

---

## 🔗 Complete Request-Response Flow

### Example: Generate Artifacts with Guidelines

**Frontend Request:**
```typescript
// step1-conversational-refinement.tsx (user clicks "Generate Artifacts")
const saveRes = await apiRequest("POST", "/api/workflow/generate-artifacts", {
  sessionId: "session-123",
  projectId: "proj-456",
  requirement: "Full conversation + captured requirements",
  epics: [],
  features: [],
  userStories: [],
  personas: [],
  complianceGuidelines: [
    {
      id: "guideline-1",
      name: "Security Guidelines",
      content: "Full guideline text..."
    },
    {
      id: "guideline-2",
      name: "Accessibility Guidelines",
      content: "Full guideline text..."
    }
  ]
});
```

**Backend Route Handler (routes.ts Lines 522-542):**
```typescript
app.post("/api/workflow/generate-artifacts", async (req, res) => {
  const { requirement, complianceGuidelines, selectedPersonaIds } = req.body;
  
  // Call AI service with guidelines
  const artifacts = await generateAgileArtifacts(
    requirement,
    complianceGuidelines || [],        // ← Guidelines passed here
    backlogContext,
    selectedPersonaIds || []
  );
  
  res.json(artifacts);
});
```

**AI Service (ai-service.ts Lines 2313-3100+):**
```typescript
export async function generateAgileArtifacts(
  requirement: string,
  complianceGuidelines: any[] = [],    // ← Received
  backlogContext?: any,
  selectedPersonaIds: string[] = []
): Promise<any> {
  // 1. Build compliance section (Lines 2355-2364)
  let complianceSection = "";
  if (complianceGuidelines.length > 0) {
    complianceSection = `COMPLIANCE REQUIREMENTS:\n...`;
    complianceGuidelines.forEach((guideline) => {
      complianceSection += `=== ${guideline.name} ===\n${guideline.content}\n...`;
    });
  }
  
  // 2. Call Claude with compliance section injected (Line 2608)
  const response = await openai.chat.completions.create({
    model: modelName,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert Agile coach...${complianceSection}...` // ← Guidelines embedded
      },
      {
        role: "user",
        content: `Based on this requirement, generate artifacts:\n\n${requirement}`
      }
    ]
  });
  
  // 3. Parse and return (Line 2750+)
  return {
    epics: parsed.epics,
    features: parsed.features,
    userStories: parsed.userStories,
    personas: parsed.personas
  };
}
```

**Frontend Response Display (step2-generated-content.tsx):**
```typescript
// Render artifacts with compliance annotations
epics.map(epic => (
  <div>
    <h2>{epic.title}</h2>
    <p>{epic.description}</p>
    {epic.relatedGuidelines && (
      <span className="compliance-badge">
        ✓ Follows {epic.relatedGuidelines.join(", ")}
      </span>
    )}
  </div>
))
```

---

## 🎯 Main Claude Prompt for Artifact Generation

### **Primary Workflow Output Definition**

**File:** `server/ai-service.ts`  
**Function:** `generateAgileArtifacts()` (Lines 2313-3150+)  
**Claude API Call:** Lines 2608-2904  
**Response Parsing:** Lines 2908-2950+  

### **System Prompt Structure (Lines 2614-2805)**

The system prompt is composed of 5 major sections:

```
1. Role Definition (Lines 2614-2615):
   "You are an expert Agile coach and product manager who generates ENTERPRISE-GRADE user stories..."

2. Injected Compliance Section (Lines 2614):
   ${complianceSection}  ← Full guideline text injected here
   
3. Injected Backlog Context (Lines 2614):
   ${backlogSection}     ← Existing artifacts to prevent duplicates

4. Injected Persona Section (Lines 2614):
   ${personaSection}     ← Available personas for story assignment

5. Quality Standards (Lines 2616-2805):
   ├─ USER STORY FORMAT (Lines 2618-2627)
   ├─ DESCRIPTION STRUCTURE - 7 Mandatory Sections (Lines 2629-2641)
   ├─ ACCEPTANCE CRITERIA STANDARDS - 5-Component Format (Lines 2643-2805)
   │  ├─ Component 1: TITLE (Lines 2645-2651)
   │  ├─ Component 2: GIVEN (Lines 2653-2673)
   │  ├─ Component 3: WHEN (Lines 2675-2697)
   │  ├─ Component 4: THEN (Lines 2699-2720)
   │  └─ Component 5: AND (Lines 2722-2745)
   ├─ COVERAGE REQUIREMENTS (Lines 2747-2755)
   ├─ TESTABILITY REQUIREMENTS (Lines 2757-2764)
   └─ SUBTASK FORMAT (Lines 2766-2772)
```

### **Output JSON Structure Specification (Lines 2774-2850)**

The prompt defines exact output format with:

```json
{
  "epics": [
    {
      "id": "epic-1",
      "title": "string",
      "description": "string",
      "priority": "Critical|High|Medium|Low",
      "featureCount": "number"
    }
  ],
  "features": [
    {
      "id": "feature-1",
      "epicId": "epic-1",
      "title": "string",
      "description": "string",
      "priority": "Critical|High|Medium|Low"
    }
  ],
  "userStories": [
    {
      "id": "story-1",
      "featureId": "feature-1",
      "personaId": "persona-1",
      "persona": "string",
      "epicId": "epic-1",
      "title": "As [PersonaName] (Role) with [context], I want to [specific goal], so that [clear business value]",
      "description": "CONTEXT & BACKGROUND:\n[2-3 sentences]\n\nCURRENT STATE:\n[pain points, gaps]\n\nDESIRED STATE:\n[improvements]\n\nKEY FUNCTIONALITY:\n- [capability 1]\n- [capability 2]\n\nUSER INTERACTION FLOW:\n1. [step 1]\n2. [step 2]\n...\n\nTECHNICAL CONSIDERATIONS:\n- [data sources, APIs]\n- [performance metrics]\n- [security requirements]\n- [dependencies]\n\nOUT OF SCOPE:\n- [feature X]\n\nSUCCESS METRICS:\n- [quantifiable outcome]",
      "acceptanceCriteria": [
        {
          "title": "Descriptive Criterion Title (5-8 words)",
          "given": "Specific role with permissions viewing specific screen with exact data state (minimum 20 words)",
          "when": "User clicks specific button and enters exact data (minimum 15 words)",
          "then": "Observable UI changes, database updates, notifications within X seconds (minimum 25 words)",
          "and": "Email notifications, audit logs, API calls, metrics updates (minimum 20 words)"
        }
      ],
      "subtasks": [
        "Planning - Review requirements and create technical design - 2 hours",
        "Backend - Implement POST /api/[endpoint] with validation - 3 hours",
        "Frontend - Create [ComponentName] component - 4 hours",
        "Testing - Write unit tests with 80%+ coverage - 3 hours"
      ],
      "storyPoints": "number",
      "priority": "Critical|High|Medium|Low"
    }
  ],
  "personas": [
    {
      "id": "string",
      "name": "string",
      "role": "string",
      "color": "string (hex)",
      "focus": "string",
      "painPoints": ["string"],
      "goals": ["string"]
    }
  ]
}
```

### **Critical Constraints Defined (Lines 2852-2875)**

```
IMPORTANT REQUIREMENTS:
- Generate exactly 2 epics
- Generate exactly 4 features (distributed across 2 epics)
- Generate 8-10 user stories (distributed across features)
- Distribute stories across ALL selected personas
- Return EXACT persona objects from input

ACCEPTANCE CRITERIA REQUIREMENTS:
- MINIMUM 3, MAXIMUM 5 comprehensive ACs per story
- ALL 5 components REQUIRED: title, given, when, then, and
- MINIMUM word counts:
  * given: 20 words
  * when: 15 words
  * then: 25 words
  * and: 20 words
- Must cover: happy path, validation error, edge case, optional performance
- Each AC independently testable by QA
- Include exact field names, button labels, data values, timing

SUBTASK REQUIREMENTS:
- 6-10 subtasks per story covering:
  * Planning & Design (1-3)
  * Backend Development (2-5)
  * Frontend Development (2-5)
  * Database Changes (1-3)
  * Integration (0-2)
  * Testing (2-4)
  * Documentation (1-2)
  * Code Review & Deployment (1-2)
- Include category prefix: [Planning/Backend/Frontend/Database/Integration/Testing/Documentation/DevOps]
- Include technical details: API endpoints, component names, table names
- Include time estimates: 1-8 hours per subtask
- Subtask hours should total 6-8 hours per story point
```

### **Three Production-Grade AC Examples (Lines 2877-2950)**

The prompt includes 3 complete worked examples:

**Example 1 - Happy Path (Lines 2877-2912):**
- Claims Adjuster submits claim with all required fields
- Detailed preconditions including user role, screen, data state
- Full workflow with specific field names, values, timing
- Complete observable outcomes: UI changes, database updates, notifications
- Secondary effects: emails, audit logs, metrics, webhooks

**Example 2 - Validation/Error Scenario (Lines 2914-2935):**
- Missing required fields prevention
- Error messages, field highlighting, form preservation
- No database record created, no backend API call made
- Client-side analytics event firing

**Example 3 - Edge Case/Boundary Condition (Lines 2937-2950):**
- Maximum file size upload handling (15.2 MB exceeds 10 MB limit)
- Graceful rejection with helpful user guidance
- Error state management and recovery

### **User Message (Lines 2952-2980)**

Provides the actual requirement and instructs Claude to:
```
1. Parse the requirement text
2. Extract key personas, features, constraints
3. Generate JSON following exact output structure
4. Ensure all IDs are properly linked
5. Make content specific to the requirement
6. Return ONLY the JSON object, no additional text
```

### **Response Processing (Lines 3008-3150+)**

After Claude returns JSON:
1. Extract content from response (Line 3008)
2. Parse JSON with error handling (Lines 3009-3040)
3. Validate structure (epics, features, stories, personas)
4. Return to API route handler
5. Store in database via `/api/workflow/save-artifacts`

### **Key Configuration**

| Setting | Value | Line |
|---------|-------|------|
| Response Format | `{ type: "json_object" }` | 2609 |
| Model Name | `process.env.AZURE_OPENAI_DEPLOYMENT \|\| "gpt-4o"` | 2340 |
| Temperature | 0.7 | 2977 |
| Max Tokens | (default) | 2609 |
| Compliance Injection | `${complianceSection}` | 2614 |
| Backlog Context | `${backlogSection}` | 2614 |
| Persona Section | `${personaSection}` | 2614 |

---

## 📝 Summary

### Key Takeaways

1. **Guidelines Flow:**
   - Frontend collects user-selected guidelines
   - Passes as `complianceGuidelines` array through API
   - Backend injects full guideline text into system prompt
   - Claude receives complete guidelines and generates compliant artifacts

2. **Main Files:**
   - Routes: `server/routes.ts` (Lines 496-580)
   - AI Logic: `server/ai-service.ts` (Lines 2313-3150+)
   - Main Claude Prompt: Lines 2608-2980
   - Conversation: `server/workflow-ai-service.ts` (Line 613+)
   - Frontend: `client/src/components/workflow/step1-conversational-refinement.tsx`

3. **Critical Injection Points:**
   - `generateAgileArtifacts()` Lines 2355-2364: Build compliance section
   - `generateAgileArtifacts()` Line 2614: Inject into Claude system prompt
   - `generateAgileArtifacts()` Line 2955: Inject user requirement
   - `generateWorkflowConversationQuestion()` Line 1124: Include in conversation

4. **Output Artifacts:**
   - Exactly 2 Epics with priority and duration
   - Exactly 4 Features linked to epics
   - 8-10 User Stories with production-grade acceptance criteria (5-component format: TITLE, GIVEN, WHEN, THEN, AND)
   - 6-10 Subtasks per story with category prefixes and time estimates
   - Personas with role, goals, pain points (distributed across stories)

5. **Claude Model:**
   - Primary: Azure OpenAI GPT-4o or Azure-hosted Claude
   - Fallback: Replit AI Integration OpenAI
   - All configured via environment variables
   - Unified client abstraction in `ai-client.ts`
   - JSON mode enabled: `response_format: { type: "json_object" }`

