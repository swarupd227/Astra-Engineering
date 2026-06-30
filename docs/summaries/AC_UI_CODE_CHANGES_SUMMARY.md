# Acceptance Criteria UI Code Changes Summary

## Overview
This document provides a comprehensive summary of acceptance criteria UI changes, removed code, current implementation, and the prompt files used for generating artifacts.

---

## 1. REMOVED CODE (What Was Hardcoded Before)

### Location 1: hub-artifacts.tsx (Lines 2960-3020 - REMOVED SECTION)

```tsx
// REMOVED - This was displaying Given/When/Then structure
<Card key={idx} className="bg-muted/30">
  <CardHeader className="p-3 pb-2">
    <CardTitle className="text-sm font-medium flex items-start gap-2">
      <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 flex-shrink-0" />
      {ac.title || `Acceptance Criterion ${idx + 1}`}
    </CardTitle>
  </CardHeader>
  <CardContent className="p-3 pt-0 space-y-2 text-sm">
    {ac.given && (
      <div>
        <span className="font-medium text-blue-600">
          Given:
        </span>{" "}
        <span className="text-muted-foreground">
          {ac.given}
        </span>
      </div>
    )}
    {ac.when && (
      <div>
        <span className="font-medium text-purple-600">
          When:
        </span>{" "}
        <span className="text-muted-foreground">
          {ac.when}
        </span>
      </div>
    )}
    {ac.then && (
      <div>
        <span className="font-medium text-green-600">
          Then:
        </span>{" "}
        <span className="text-muted-foreground">
          {ac.then}
        </span>
      </div>
    )}
    {ac.and && (
      <div>
        <span className="font-medium text-orange-600">
          And:
        </span>{" "}
        <span className="text-muted-foreground">
          {ac.and}
        </span>
      </div>
    )}
  </CardContent>
</Card>
```

**What was removed:**
- Hardcoded labels: "Given:", "When:", "Then:", "And:" with color coding
- Card component wrapper with CardHeader and CardContent
- Multiple divs for each condition section
- Styling that emphasized the Given/When/Then structure

---

### Location 2: step2-generated-content.tsx (Lines 1328-1342 - REMOVED SECTION)

```tsx
// REMOVED - This was displaying Given/When/Then with strong tags
<div key={idx} className="border-l-4 border-green-500 pl-4 py-2 bg-accent/30 rounded min-w-0">
  <div className="flex items-start gap-2 mb-2 min-w-0">
    <Badge variant="secondary" className="text-xs flex-shrink-0">#{idx + 1}</Badge>
    {criteria.title && (
      <p className="text-sm font-semibold text-foreground flex-1 break-words min-w-0">{criteria.title}</p>
    )}
  </div>
  <div className="text-sm text-muted-foreground space-y-1.5">
    <p className="break-words"><strong className="text-foreground">Given:</strong> {criteria.given}</p>
    <p className="break-words"><strong className="text-foreground">When:</strong> {criteria.when}</p>
    <p className="break-words"><strong className="text-foreground">Then:</strong> {criteria.then}</p>
    {criteria.and && <p className="break-words"><strong className="text-foreground">And:</strong> {criteria.and}</p>}
  </div>
</div>
```

**What was removed:**
- Border-left accent (green-500)
- Nested div structure with title section and details section
- Strong tags with hardcoded labels for Given/When/Then/And
- Multi-line spacing for each condition

---

## 2. CURRENT CODE (What's Now Implemented)

### Current Implementation in hub-artifacts.tsx (Lines 2955-2970)

```tsx
<div className="space-y-3">
  <h4 className="text-sm font-semibold">
    Acceptance Criteria
  </h4>
  <div className="space-y-2">
    {artifact.acceptanceCriteria.map(
      (ac: any, idx: number) => (
        <div key={idx} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg border border-border">
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 flex-shrink-0" />
          <p className="text-sm text-foreground flex-1 break-words min-w-0">
            {ac.title || `Acceptance Criterion ${idx + 1}`}
          </p>
        </div>
      )
    )}
  </div>
</div>
```

**Key features of current code:**
- ✅ Simple title-only display from API response
- ✅ No hardcoded Given/When/Then labels
- ✅ Clean flexbox layout with gap-3 spacing
- ✅ CheckCircle2 icon for visual indication
- ✅ Fallback text if no title provided
- ✅ Responsive border and background styling

### Current Implementation in step2-generated-content.tsx (Lines 1328-1338)

```tsx
<div className="space-y-2">
  {selectedItem.acceptanceCriteria.map((criteria: any, idx: number) => (
    <div key={idx} className="flex items-start gap-3 p-3 bg-accent/30 rounded-lg border border-border">
      <Badge variant="secondary" className="text-xs flex-shrink-0 mt-0.5">#{idx + 1}</Badge>
      <p className="text-sm text-foreground flex-1 break-words min-w-0">
        {criteria.title || `Acceptance Criterion ${idx + 1}`}
      </p>
    </div>
  ))}
</div>
```

**Key features of current code:**
- ✅ Badge showing AC number (#1, #2, etc.)
- ✅ Only title displayed from API
- ✅ Clean horizontal layout with flex
- ✅ No Given/When/Then labels
- ✅ Consistent padding and borders
- ✅ Fallback for missing titles

---

## 3. KEY DIFFERENCES

| Aspect | Before (Removed) | Now (Current) |
|--------|-----------------|---------------|
| **Structure** | Card with Header/Content | Simple flex div |
| **Labels** | Given, When, Then, And | None - only title |
| **Visual** | Border-left accent, nested divs | Clean border with padding |
| **Components** | Card, CardHeader, CardContent | Simple div, Badge, p tags |
| **Data Displayed** | All 4 fields (given, when, then, and) | Only title field |
| **Complexity** | Nested conditional rendering | Flat single-line content |
| **API Dependency** | Expected Given/When/Then structure | Only expects title field |

---

## 4. PROMPT FILES FOR ACCEPTANCE CRITERIA GENERATION

### File 1: prompt_acceptance_criteria.ts

**Location:** `server/prompts/prompt_acceptance_criteria.ts`

**Purpose:** Template for individual AC enhancement or re-generation (on-demand)

**Function Export:** `promptenhanceAcceptanceCriteria(acCount: string, storyPoints: number, domainConsiderations: string)`

**Complete Content:**
```typescript
const promptenhanceAcceptanceCriteria = (
   acCount: string, 
   storyPoints: number, 
   domainConsiderations: string ): string => {
  return `
You are an expert AI model specializing in writing concise, outcome-focused acceptance criteria for user stories.

1. **Format Requirements:**
  - Do NOT include code blocks or JSON code snippets in the acceptance criteria output
  - Number each criterion clearly (AC #1, AC #2, etc.)
  - Each AC must be a single short sentence or phrase focused on an observable outcome
  - Generate exactly ${acCount} acceptance criteria (based on ${storyPoints} story points)
  - Prioritize the most critical scenarios: happy path, an edge case, and an error/validation case

2. **Quality Standards:**
  - Be TESTABLE: Each AC must be verifiable by QA without requiring Given/When/Then scenarios
  - Be SPECIFIC where possible: prefer explicit field names, messages or measurable outcomes, but keep ACs short
  - Be MEASURABLE when metrics apply (e.g., timeout occurs within 2 seconds)

**Output Requirements:**
- Return ONLY the acceptance criteria text and nothing else
- Format exactly as:
  Acceptance Criteria
  #1 <criterion>
  #2 <criterion>
  ...
- Do NOT include Given/When/Then/And lines or code blocks
- Generate exactly ${acCount} acceptance criteria (based on ${storyPoints} story points)

IMPORTANT: Output must be plain text only, no markdown code fences or JSON blocks. `}
export { promptenhanceAcceptanceCriteria }
```

**Key Points:**
- Generates simple title-format ACs
- NO Given/When/Then required
- Outcome-focused, business-readable language
- Testable without Given/When/Then scenarios
- Used for on-demand AC enhancement

---

### File 2: prompt_workflow_requirements.ts

**Location:** `server/prompts/prompt_workflow_requirements.ts`

**Purpose:** Main template for batch artifact generation (Epics, Features, Stories, ACs, Subtasks, Testcases in ONE LLM call)

**Relevant AC Section (Lines 23-29):**
```typescript
- Each user story MUST have acceptance criteria that are independently testable and verifiable by QA
- ACs should be outcome-focused, business-readable statements (simple title format, no Given/When/Then required)
- Format example: '#1 Form validates all required fields correctly' 
- Generate 3-5 ACs per story based on complexity and story points
- Include ACs directly in the user story JSON object as an array
- NOTE: For individual story AC enhancement (separate from batch generation), use prompt_acceptance_criteria.ts
```

**AC Examples in Prompt (Lines 39-56):**
```
Example 1 - Happy Path:
{
  "title": "User successfully submits claim with all required fields"
}

Example 2 - Validation/Error Scenario:
{
  "title": "System prevents submission with missing required fields"
}

Example 3 - Edge Case/Boundary Condition:
{
  "title": "System handles maximum file size upload gracefully"
}
```

**Key Points:**
- Generates ACs inline as part of batch generation
- 3-5 ACs per story based on complexity
- Simple title-only format
- Each AC independently testable
- Directly embedded in user story JSON

---

## 5. HOW AC GENERATION WORKS

### Batch Generation Flow (prompt_workflow_requirements.ts)
```
User Input Requirement
    ↓
POST /api/workflow/generate-artifacts
    ↓
Server calls generateAgileArtifacts()
    ↓
Sends prompt_workflow_requirements.ts to LLM
    ↓
LLM generates all artifacts in ONE call:
  - Epics
  - Features
  - User Stories (with ACs, Subtasks, Testcases)
    ↓
JSON Response with complete structure
```

### Individual AC Enhancement Flow (prompt_acceptance_criteria.ts)
```
User clicks "AI Enhance" on AC section
    ↓
enhanceAcceptanceCriteria() function called
    ↓
Sends prompt_acceptance_criteria.ts to LLM
    ↓
LLM generates enhanced ACs
    ↓
Updates story with new AC data
```

---

## 6. API RESPONSE STRUCTURE

**Expected API response for ACs:**
```json
{
  "userStories": [
    {
      "id": "US-001",
      "title": "User can submit claim form",
      "acceptanceCriteria": [
        {
          "title": "Form validates all required fields correctly"
        },
        {
          "title": "System displays validation errors on submit"
        },
        {
          "title": "User can submit form with valid data"
        }
      ]
    }
  ]
}
```

**Note:** API now returns ONLY `title` field, no `given`, `when`, `then`, `and` fields.

---

## 7. UI DISPLAY FLOW

```
API Response (with AC title only)
    ↓
hub-artifacts.tsx receives data
    ↓
Maps over acceptanceCriteria array
    ↓
For each AC, displays:
  - CheckCircle2 icon (green)
  - AC title from API
  - Number badge (#1, #2, etc.)
    ↓
Clean, simple UI display
```

---

## 8. CONFIGURATION & CUSTOMIZATION

### To modify AC display format:
1. Edit the map function in hub-artifacts.tsx (Line 2962)
2. Edit the map function in step2-generated-content.tsx (Line 1329)

### To modify AC generation:
1. Edit `prompt_acceptance_criteria.ts` for on-demand AC format
2. Edit `prompt_workflow_requirements.ts` lines 23-56 for batch generation format

### To add Given/When/Then back:
- Would need to modify both the prompt files (to generate these fields)
- And the UI files (to display them conditionally)
- Not recommended - current simple format is cleaner

---

## 9. SUMMARY OF CHANGES

| Aspect | Details |
|--------|---------|
| **UI Simplification** | Removed Card components and Given/When/Then display |
| **Display Format** | Now shows only AC number and title |
| **API Response** | Changed to return only `title` field |
| **Prompt Templates** | Enforces title-only format output |
| **User Experience** | Cleaner, less cluttered AC display |
| **Testability** | ACs still testable, just simpler format |
| **Storage** | Still stores other fields if provided, just doesn't display them |

---

## 10. FILES INVOLVED IN AC GENERATION & DISPLAY

| File | Purpose | Type |
|------|---------|------|
| `server/prompts/prompt_acceptance_criteria.ts` | On-demand AC template | Template |
| `server/prompts/prompt_workflow_requirements.ts` | Batch artifact generation | Template |
| `server/ai-service.ts` (Lines 4677-4830) | AC orchestration functions | Logic |
| `shared/schema.ts` | AC data structure | Schema |
| `client/src/pages/hub-artifacts.tsx` (Lines 2960-2970) | Main AC display | UI |
| `client/src/components/workflow/step2-generated-content.tsx` (Lines 1328-1338) | Detail panel AC display | UI |

---

## 11. VALIDATION & PARSING

**AC Parsing Function Location:** `server/ai-service.ts` - `parseAcceptanceCriteria()` (Lines 4796-4830)

**Parsing Logic:**
- Extracts AC text from LLM response
- Parses markdown code blocks if present
- Converts to JSON array with `title` field
- Handles fallback cases
- Validates structure

**Key Line 4828:**
```typescript
// Accepts ACs with just a title, no Given/When/Then required
const ac = {
  title: cleanedAc.trim(),
  // Other fields optional
};
```

---

## 12. TESTING THE AC DISPLAY

### To verify current behavior:
1. Generate artifacts via UI or API
2. Check response in browser DevTools Network tab
3. Verify `acceptanceCriteria` array has `title` field only
4. Verify UI displays only the title (no Given/When/Then labels)

### Example Test:
```bash
curl -X POST http://localhost:4000/api/workflow/generate-artifacts \
  -H "Content-Type: application/json" \
  -d '{
    "requirement": "User can login with email and password",
    "personasToUse": []
  }'
```

Expected response:
```json
{
  "userStories": [{
    "acceptanceCriteria": [
      {"title": "User can enter email and password"},
      {"title": "System validates credentials"},
      {"title": "User is logged in on success"}
    ]
  }]
}
```

---

## Document Last Updated
**Date:** December 18, 2025
**Status:** Current - Reflects latest UI and prompt changes
