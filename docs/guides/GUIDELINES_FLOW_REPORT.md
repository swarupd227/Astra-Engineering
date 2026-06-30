# Guidelines Flow Report: How Compliance Guidelines Reach the LLM

## Executive Summary

When a user initiates artifact generation with selected compliance guidelines, the guidelines flow through the application in their **complete, unmodified form**. They are **NOT summarized or truncated**. The full content of each guideline document is injected into the LLM's system prompt to ensure the model generates artifacts in strict compliance with the organization's golden repository standards.

---

## 1. Guidelines Origin & Selection

### Where Guidelines Come From
- **Source**: Organization's "Golden Repository" - a collection of compliance and quality guidelines
- **Managed In**: The compliance guidelines section of the workflow configuration
- **Format**: Each guideline consists of:
  - `name` (string): Human-readable identifier (e.g., "Feature Guideline")
  - `content` (string): Full markdown/text content of the guideline

### How Users Select Guidelines
In the workflow conversation UI (`step1-conversational-refinement.tsx`):
- Users select one or more compliance guidelines via UI controls
- Selected guidelines are stored in the component state as `complianceGuidelines` array
- Each element is an object: `{ name: string, content: string }`

**Example Guidelines:**
- Feature Guideline
- Epic Guideline
- Bug/Defect Guideline
- Acceptance Criteria Writing Standards
- Testing Standards

---

## 2. API Request Flow

### Frontend Call (Client to Server)

**File**: `client/src/components/workflow/step1-conversational-refinement.tsx` (line 502)

```typescript
const artifactsRes = await apiRequest("POST", "/api/workflow/generate-artifacts", {
  requirement: requirementText,
  complianceGuidelines,           // ← Full array of guideline objects
  selectedPersonaIds,
});
```

**What Gets Sent**:
- `requirement`: User's requirement text (string)
- `complianceGuidelines`: Array of `{ name, content }` objects - **FULL CONTENT UNMODIFIED**
- `selectedPersonaIds`: Array of persona identifiers

**Key Point**: The guidelines array is sent as-is from the client. No summarization, filtering, or truncation occurs at this stage.

---

## 3. Backend Route Handler

### API Endpoint

**File**: `server/routes.ts` (line 1297)

```typescript
// POST /api/workflow/generate-artifacts
const { requirement, complianceGuidelines, backlogContext, selectedPersonaIds } = req.body;

const artifacts = await generateAgileArtifacts(
  requirement,
  complianceGuidelines || [],      // ← Passed as received from client
  backlogContext,
  selectedPersonaIds || []
);

res.json(artifacts);
```

**Processing**:
- Extract parameters from request body
- Pass `complianceGuidelines` array directly to `generateAgileArtifacts()` function
- Return generated artifacts as JSON response

**Key Point**: No processing or modification of guidelines at this stage. They are passed through to the AI service.

---

## 4. AI Service Processing

### Function Signature

**File**: `server/ai-service.ts` (line 2313)

```typescript
export async function generateAgileArtifacts(
  requirement: string,
  complianceGuidelines: Array<{ name: string; content: string }> = [],
  backlogContext?: any,
  selectedPersonaIds: string[] = []
): Promise<any>
```

### Guideline Processing Logic

**File**: `server/ai-service.ts` (lines 2355-2363)

```typescript
let complianceSection = "";

if (complianceGuidelines.length > 0) {
  complianceSection = `\n\nCOMPLIANCE REQUIREMENTS:\n\nYou must strictly follow these ${complianceGuidelines.length} compliance guideline document${complianceGuidelines.length > 1 ? 's' : ''} from the organization's Golden Repository:\n\n`;
  
  complianceGuidelines.forEach((guideline: any) => {
    complianceSection += `=== ${guideline.name} ===\n${guideline.content}\n===================\n\n`;
  });
}
```

**Processing Steps**:
1. Check if guidelines array has items
2. Create compliance section header with guideline count
3. **Iterate through guidelines** (forEach loop)
4. For each guideline:
   - Add header: `=== ${guideline.name} ===`
   - **Append FULL content**: `${guideline.content}`
   - Add footer: `===================`
5. Build complete `complianceSection` string with all guidelines

**Key Points**:
- ✅ **NO summarization** - Full content is appended
- ✅ **NO truncation** - Entire guideline text is included
- ✅ **NO filtering** - All selected guidelines are processed
- ✅ **Minimal formatting** - Only headers and dividers added

---

## 5. System Message Construction

### How Guidelines Are Integrated into LLM Prompt

**File**: `server/ai-service.ts` (lines 2500+)

The `complianceSection` is concatenated into the LLM's system message alongside other context sections:

```typescript
const systemPrompt = {
  role: "system",
  content: `You are an expert Agile coach and requirements analyst...
${complianceSection}    // ← FULL guideline content injected here
${backlogSection}        // ← Existing epics/features/stories for context
${personaSection}        // ← Selected persona definitions
...additional instructions...`
};
```

### Complete System Message Structure

The LLM receives a system message composed of:

1. **Role Definition**: "You are an expert Agile coach and requirements analyst..."
2. **Compliance Requirements Section**: 
   - Contains full content of all selected guidelines
   - Each guideline clearly marked with its name
   - Instruction: "You must strictly follow these guidelines"
3. **Backlog Context Section**: 
   - Existing epics (first 10, summary of others)
   - Existing features (first 10)
   - Existing user stories (first 15)
   - Purpose: Avoid duplication and maintain alignment
4. **Persona Section**: 
   - Selected persona definitions with roles and contexts
   - Purpose: Enable persona-based perspective
5. **Quality Standards**: 
   - AC (Acceptance Criteria) format instructions
   - TC (Test Cases) format instructions
   - Naming conventions
6. **Output Format**: 
   - JSON schema for response structure

---

## 6. Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (Client Browser)                                    │
│ step1-conversational-refinement.tsx                          │
│                                                               │
│ User Selects Guidelines from Golden Repository               │
│ ↓                                                             │
│ complianceGuidelines = [                                     │
│   { name: "Feature Guideline", content: "..." },            │
│   { name: "Acceptance Criteria Standards", content: "..." } │
│ ]                                                             │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ↓
                    HTTP POST Request
                     (Guidelines FULL)
                             │
┌────────────────────────────┴────────────────────────────────┐
│ API ROUTE (Backend)                                          │
│ server/routes.ts line 1297                                  │
│                                                               │
│ /api/workflow/generate-artifacts                            │
│ Extract: complianceGuidelines (unchanged)                   │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ↓
                    Function Call
           generateAgileArtifacts(...)
                             │
┌────────────────────────────┴────────────────────────────────┐
│ AI SERVICE (Backend)                                         │
│ server/ai-service.ts line 2313                              │
│                                                               │
│ Function: generateAgileArtifacts()                          │
│                                                               │
│ 1. Receive complianceGuidelines array                       │
│ 2. Build complianceSection (lines 2355-2363):              │
│    - forEach guideline → append full content               │
│    - NO summarization or truncation                        │
│ 3. Concatenate into system message                         │
│ 4. Send to LLM with:                                        │
│    - Full compliance requirements                           │
│    - Backlog context                                        │
│    - Persona definitions                                    │
│    - Quality standards                                      │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ↓
                    LLM API Call
            (Azure OpenAI / OpenAI GPT-4o)
                             │
                    System Message = 
        Compliance + Backlog + Persona + Standards
                             │
                             ↓
                  LLM Generates Artifacts
              (Epics, Features, User Stories, etc.)
                   Following ALL Guidelines
                             │
                             ↓
                 Return JSON Response
                             │
┌────────────────────────────┴────────────────────────────────┐
│ RESPONSE (Back to Frontend)                                  │
│                                                               │
│ artifacts = {                                                │
│   epics: [...],                                             │
│   features: [...],                                          │
│   userStories: [...],                                       │
│   personas: [...]                                           │
│ }                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Key Characteristics of Guideline Integration

### ✅ Full Content Preservation
- **No summarization**: Entire guideline text is passed to LLM
- **No truncation**: All content from each guideline is included
- **No filtering**: No selective inclusion/exclusion of guideline sections

### ✅ Minimal Formatting
- Simple headers added: `=== Guideline Name ===`
- Simple footers: `===================`
- No additional processing or rewriting of content

### ✅ Direct LLM Visibility
- LLM sees **complete context** of each guideline
- Can **strictly validate compliance** against full requirements
- Ensures **consistent artifact quality** across organization standards

### ✅ Multiple Guidelines Support
- Array can contain 1-N guidelines
- Each processed with identical handling
- System message scales with guideline count

---

## 8. Example: Guidelines in System Message

When a user selects 3 guidelines, the LLM receives:

```
You are an expert Agile coach...

COMPLIANCE REQUIREMENTS:

You must strictly follow these 3 compliance guideline documents 
from the organization's Golden Repository:

=== Feature Guideline ===
A feature is a significant capability or functionality that delivers 
value to end users. Features should:
- Solve a specific user problem
- Be deliverable within a sprint
- Include clear acceptance criteria
- Have defined success metrics
...
[FULL GUIDELINE CONTENT HERE - NOT SUMMARIZED]
===================

=== Epic Guideline ===
An epic is a large body of work that can be broken down into features...
[FULL GUIDELINE CONTENT HERE - NOT SUMMARIZED]
===================

=== Acceptance Criteria Standards ===
Acceptance Criteria (AC) must be written as clear, testable statements...
[FULL GUIDELINE CONTENT HERE - NOT SUMMARIZED]
===================

[Backlog context...]
[Persona definitions...]
[Quality standards...]
```

**Key Point**: The LLM receives **3 complete guideline documents**, not summaries.

---

## 9. Impact on Artifact Generation

### How Guidelines Influence Output

1. **Compliance Validation**: LLM validates every generated artifact against guideline requirements
2. **Format Consistency**: Artifacts follow naming conventions and structures defined in guidelines
3. **Quality Standards**: AC, TC, and other formats strictly adhere to guideline specifications
4. **Business Alignment**: Content reflects organizational standards and practices

### Why Full Content Matters

- **Nuance**: Guidelines contain contextual information, examples, anti-patterns
- **Context**: LLM understands the "why" behind standards, not just the "what"
- **Accuracy**: No risk of important details lost in summarization
- **Traceability**: LLM can reference specific sections when validating

---

## 10. Summary

### Direct Answer to User's Question

**Q: "Is it a summarised version of selected docs?"**

**A: NO.** Guidelines are passed to the LLM in their **complete, unmodified form**. 

### Data Journey Summary

```
User Selects Guidelines 
    ↓
API Request (Full Content)
    ↓
Backend Routes (Pass-through)
    ↓
AI Service (Iterate & Concatenate)
    ↓
System Message (Full Content Injected)
    ↓
LLM Receives (Complete Guideline Documents)
    ↓
Generates Artifacts (Strictly Following Guidelines)
```

### Key Takeaway

The compliance guidelines system is designed for **maximum fidelity and compliance**. By passing the **full content** of each guideline to the LLM, the system ensures that:
- Guidelines are completely understood by the AI model
- Artifacts meet all compliance requirements
- Quality standards are consistently applied
- The organization's golden repository standards are strictly enforced

---

## File References

| Component | File | Line |
|-----------|------|------|
| Frontend Guidelines Selection | `client/src/components/workflow/step1-conversational-refinement.tsx` | 502 |
| API Request | `client/src/components/workflow/step1-conversational-refinement.tsx` | 502 |
| API Route Handler | `server/routes.ts` | 1297 |
| AI Service Function | `server/ai-service.ts` | 2313 |
| Guideline Processing | `server/ai-service.ts` | 2355-2363 |
| System Message Construction | `server/ai-service.ts` | 2500+ |
| Prompt Template | `server/prompts/prompt_workflow_requirements.ts` | Various |

---

## Conclusion

The guidelines integration is a **direct pass-through system** that preserves the full content and context of compliance documents. This ensures the LLM has complete information to generate artifacts that strictly adhere to organizational standards, with no loss of important details or context through summarization.
