# Workflow Artifacts Generation Implementation Summary

**Last Updated:** December 12, 2025  
**Feature:** Generate Artifacts from BRD in Workflow SDLC Section

---

## Overview

This document details the complete implementation of the **Generate Artifacts** feature within the Workflow section of the SDLC page. The feature enables users to attach a Business Requirements Document (BRD) and directly generate agile artifacts (Epics, Features, User Stories, Personas, and Design Guidelines) with a single click, without displaying AI model suggestion buttons or confusing modal dialogs.

---

## Feature Implementation Details

### 1. **BRD Attachment Flow**

Users can now attach an existing BRD version to their workflow:

- **Action:** Click the **"Save BRD"** button in the "Attach BRD to Workflow" helper section
- **Dialog:** Select a BRD version from the list and confirm
- **Success:** BRD is linked to the workflow without displaying confirmation text

**Key Characteristics:**
- Silently attaches BRD (no confirmation message in UI)
- Toast notification confirms success in the notification area
- Compact button layout within the BRD helper section
- No interruption to the conversation flow

---

### 2. **Generate Artifacts Button (Compact)**

Once a BRD is successfully attached:

- **Location:** Appears directly under the "Save BRD" button in the same "Attach BRD to Workflow" section
- **Size:** Small (`sm`) button to match the "Save BRD" button dimensions
- **Label:** "Generate Artifacts" with Sparkles icon
- **Styling:** Green gradient background (`bg-green-600 hover:bg-green-700`)
- **State Indicator:** Shows spinner and "Generating..." text during artifact generation

**Key Characteristics:**
- Compact, space-efficient design
- In-context placement (not at bottom of chat area)
- Direct generation without modal dialogs or suggestion choices
- Integrated loading state feedback

---

### 3. **Hidden Model Suggestion Buttons**

When a BRD is attached:

- **Quick Reply Buttons:** Model suggestion buttons from AI responses are hidden
- **Rationale:** When BRD context is provided, users have clear requirements and don't need model suggestions
- **User Experience:** Cleaner UI focused on the generation action, not conversation refinement

---

### 4. **Direct Artifact Generation Flow**

Clicking "Generate Artifacts" triggers immediate generation:

1. **Clear State:** Quick replies and choice dialogs are cleared
2. **Direct Call:** Artifact generation is called directly without showing options
3. **Generation Steps:**
   - Prepare requirements from conversation and captured data
   - Generate AI Design Guidelines (using BRD/conversation context)
   - Generate Epics, Features, User Stories, and Personas
   - Automatically create SDLC project (if not exists)
   - Save artifacts to project
   - Transition to Step 2 (artifact display)

4. **No User Interaction Required:** No modal dialogs asking "Continue Refining" vs "Generate Now"

---

## Code Implementation

### File: `client/src/components/workflow/step1-conversational-refinement.tsx`

#### **State Management** (Lines 61-76)

```typescript
const [quickReplies, setQuickReplies] = useState<string[]>([]);
const [selectedQuickReplies, setSelectedQuickReplies] = useState<string[]>([]);
const [isSingleSelect, setIsSingleSelect] = useState(false);
const [showChoiceDialog, setShowChoiceDialog] = useState(false);
const [isGenerating, setIsGenerating] = useState(false);
const [generationProgress, setGenerationProgress] = useState(0);
const [generationStep, setGenerationStep] = useState("");
const [brdDialogOpen, setBrdDialogOpen] = useState(false);
const [brdVersions, setBrdVersions] = useState<
  Array<{ versionId: number; version: number; file_name: string; uploaded_at: string }>
>([]);
const [brdVersionsLoading, setBrdVersionsLoading] = useState(false);
const [selectedBrdVersionId, setSelectedBrdVersionId] = useState<number | null>(null);
const [attachStatus, setAttachStatus] = useState<string | null>(null);
const [attachLoading, setAttachLoading] = useState(false);
const [brdAttached, setBrdAttached] = useState(false);  // NEW: Track BRD attach state
```

**Key Addition (Line 76):**
- `brdAttached` state tracks when a BRD has been successfully attached
- Used to conditionally show/hide UI elements (Generate button, quick replies)

---

#### **Handle BRD Attachment** (Lines 191-242)

```typescript
const handleAttachBrdToWorkflow = async () => {
  if (!projectId && !sdlcProjectId) {
    toast({
      title: "Project required",
      description: "Select a project before attaching a BRD.",
      variant: "destructive",
    });
    return;
  }
  if (!selectedBrdVersionId) {
    toast({
      title: "No BRD selected",
      description: "Choose a BRD version to attach.",
    });
    return;
  }

  try {
    setAttachLoading(true);
    const res = await apiRequest("POST", "/api/workflow/attach-brd", {
      workflowId: sessionId,
      brdVersionId: selectedBrdVersionId,
      attachedBy: sessionId,
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || "Failed to attach BRD");
    }
    const attachedVersion =
      brdVersions.find((v) => v.versionId === selectedBrdVersionId)?.version ??
      selectedBrdVersionId;
    
    // NEW: Mark BRD attached (do not display confirmation text in UI)
    setBrdAttached(true);                              // Line 224
    setAttachStatus(null);                             // Line 225
    toast({
      title: "BRD attached",
      description: `BRD v${attachedVersion} linked to this workflow.`,
    });
    setBrdDialogOpen(false);
  } catch (error: any) {
    toast({
      title: "Attach failed",
      description:
        error instanceof Error ? error.message : "Unable to attach BRD.",
      variant: "destructive",
    });
  } finally {
    setAttachLoading(false);
  }
};
```

**Key Changes (Lines 224-225):**
- `setBrdAttached(true)` - Activates the Generate button
- `setAttachStatus(null)` - Prevents confirmation text from displaying

---

#### **Handle Generate from BRD** (Lines 244-255)

```typescript
// Handler to generate directly from attached BRD without showing suggestions
const handleGenerateFromBrd = async () => {
  try {
    // Clear any quick replies or choice dialogs
    setQuickReplies([]);                              // Line 247
    setShowChoiceDialog(false);                       // Line 248
    // Directly call the existing artifact generation flow
    await handleGenerateArtifacts();                  // Line 250
  } catch (err) {
    console.error('Error generating from BRD:', err);
    toast({ 
      title: 'Generation Failed', 
      description: 'Could not generate artifacts from BRD.', 
      variant: 'destructive' 
    });
  }
};
```

**Purpose:**
- New handler specifically for BRD-triggered generation
- Clears quick replies and choice dialogs before calling generation
- Ensures clean UI state during generation (no interrupting modals)
- Directly invokes `handleGenerateArtifacts()` (existing flow)

---

#### **BRD Attachment UI Section** (Lines 829-870)

```typescript
{/* BRD attachment helper */}
<div className="border-t bg-muted/30 px-4 md:px-8 py-4">
  <div className="mx-auto max-w-4xl flex items-start justify-between gap-3 flex-wrap">
    <div className="space-y-1">
      <p className="text-sm font-semibold">Attach BRD to Workflow</p>
      <p className="text-xs text-muted-foreground">
        Link an existing BRD version so it's available with your workflow artifacts.
      </p>
    </div>
    <div className="flex flex-col items-end gap-2">        {/* Line 839 */}
      <Button
        size="sm"
        variant={brdVersions.length === 0 ? "outline" : "default"}
        disabled={brdVersionsLoading || brdVersions.length === 0}
        onClick={() => setBrdDialogOpen(true)}
      >
        {brdVersionsLoading
          ? "Loading BRDs..."
          : brdVersions.length === 0
          ? "No BRD Available"
          : "Select BRD"}
      </Button>

      {brdAttached && (                               {/* Line 856 */}
        <Button
          onClick={handleGenerateFromBrd}            {/* Line 857 */}
          disabled={isGenerating}
          size="sm"
          className="bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Generate Artifacts
            </>
          )}
        </Button>
      )}
    </div>
  </div>
</div>
```

**Key Implementation (Lines 839-870):**
- **Line 839:** Flex column container for vertical button stacking
- **Lines 841-854:** "Save BRD" button (existing)
- **Line 856:** Conditional render - only show Generate button when `brdAttached === true`
- **Line 857:** Calls `handleGenerateFromBrd()` on click
- **Lines 863-869:** Loading state with spinner during generation

---

#### **Hide Quick Reply Buttons When BRD Attached** (Line 799)

```typescript
{/* Quick Reply Chips */}
{quickReplies && quickReplies.length > 0 && !isConversationLoading && !brdAttached && (
  <div className="border-t bg-muted/30 px-4 md:px-8 py-4">
    {/* Button rendering code */}
  </div>
)}
```

**Key Change (Line 799):**
- Added `&& !brdAttached` condition to the rendering logic
- When `brdAttached` is true, quick reply suggestion buttons are hidden
- Prevents confusing users with model options when they have a clear BRD

---

#### **Existing Artifact Generation Handler** (Lines 456-591)

The following existing function was leveraged (not modified):

```typescript
const handleGenerateArtifacts = async () => {
  // Lines 456-591
  // Prepares requirement text from conversation + captured requirements
  // Calls /api/workflow/generate-guidelines
  // Calls /api/workflow/generate-artifacts
  // Calls /api/workflow/save-artifacts
  // Creates SDLC project if needed
  // Transitions to Step 2
}
```

**Key Points:**
- This function is reused for both conversational flow and BRD flow
- Requires `setRequirement()` to be called beforehand (sets requirement text)
- Handles all artifact generation, saving, and SDLC project creation
- Progress overlay shows generation status with spinner

---

### File: `client/src/components/workflow/step1-conversational-refinement.tsx` - Dialog Definition

#### **BRD Selection Dialog** (Lines 928-980)

```typescript
{/* BRD selection dialog */}
<Dialog open={brdDialogOpen} onOpenChange={setBrdDialogOpen}>
  <DialogContent className="sm:max-w-[520px]" data-testid="dialog-attach-brd">
    <DialogHeader>
      <DialogTitle>Attach BRD Version</DialogTitle>
      <DialogDescription>Select a BRD version to attach to this workflow.</DialogDescription>
    </DialogHeader>

    <div className="space-y-3">
      {brdVersions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No BRD versions found for this project.</p>
      ) : (
        <ScrollArea className="max-h-64 pr-2">
          <RadioGroup
            value={selectedBrdVersionId ? String(selectedBrdVersionId) : undefined}
            onValueChange={(val) => setSelectedBrdVersionId(Number(val))}
            className="space-y-2"
          >
            {brdVersions.map((v) => (
              <div key={v.versionId} className="flex items-start gap-3 p-3 rounded-lg border hover:border-primary/50">
                <RadioGroupItem value={String(v.versionId)} className="mt-1" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    BRD v{v.version} — {v.file_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Uploaded: {v.uploaded_at ? new Date(v.uploaded_at).toLocaleString() : "Unknown"}
                  </p>
                </div>
              </div>
            ))}
          </RadioGroup>
        </ScrollArea>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => setBrdDialogOpen(false)}>
          Cancel
        </Button>
        <Button
          onClick={handleAttachBrdToWorkflow}
          disabled={!selectedBrdVersionId || attachLoading}
        >
          {attachLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Attaching...
            </>
          ) : (
            "Attach BRD"
          )}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
```

**Functionality:**
- Displays list of BRD versions for the project (sorted newest first)
- Radio group for single selection
- Shows version number and file name with upload timestamp
- Confirmation button calls `handleAttachBrdToWorkflow()`

---

## User Workflow

### Step-by-Step User Experience

1. **Initial Conversation Phase (Optional)**
   - User can engage in conversation with Tia Bot to refine requirements
   - Quick replies appear for multi-select responses
   - User can upload supporting documents

2. **Attach BRD**
   - User clicks "Save BRD" button in the "Attach BRD to Workflow" section
   - Dialog opens showing available BRD versions
   - User selects a BRD version and confirms
   - BRD is attached (quiet success - no UI confirmation text)

3. **Generate Artifacts**
   - "Generate Artifacts" button appears under "Save BRD" button
   - Quick reply suggestion buttons disappear from conversation area
   - User clicks "Generate Artifacts"
   - Generation starts immediately (no modal asking to confirm)

4. **Generation Progress**
   - Full-screen overlay with spinner shows "Generating Artifacts"
   - Progress bar indicates completion percentage
   - Generation steps displayed (Guidelines, Epics, Features, Stories, etc.)
   - Automatically creates SDLC project if needed
   - Saves all artifacts to project

5. **Completion**
   - Transition to Step 2 (artifact display/management)
   - User can view, edit, and manage generated artifacts

---

## Data Flow

### BRD Attachment Data Flow

```
User clicks "Save BRD" button
    ↓
Dialog opens with BRD versions from /api/brd/versions?projectId={pid}
    ↓
User selects BRD version and confirms
    ↓
POST /api/workflow/attach-brd {workflowId, brdVersionId, attachedBy}
    ↓
Server responds with success
    ↓
Client: setBrdAttached(true)
    ↓
"Generate Artifacts" button becomes visible
Quick reply buttons become hidden
```

### Artifact Generation Data Flow

```
User clicks "Generate Artifacts" button
    ↓
handleGenerateFromBrd() clears state (quickReplies, showChoiceDialog)
    ↓
handleGenerateArtifacts() called
    ↓
Prepare requirement text from conversation + captured requirements
    ↓
POST /api/workflow/generate-guidelines {input: requirementText}
    ↓
POST /api/workflow/generate-artifacts {requirement, complianceGuidelines, selectedPersonaIds}
    ↓
POST /api/sdlc/projects (create if needed)
    ↓
POST /api/workflow/save-artifacts {epics, features, userStories, personas}
    ↓
setCurrentStep(2) - Transition to Step 2
```

---

## API Endpoints Used

| Endpoint | Method | Purpose | Response |
|----------|--------|---------|----------|
| `/api/brd/versions` | GET | Fetch BRD versions for project | Array of BRD versions |
| `/api/workflow/attach-brd` | POST | Attach BRD to workflow | `{success: true}` |
| `/api/workflow/generate-guidelines` | POST | Generate design guidelines | `{guidelines: string}` |
| `/api/workflow/generate-artifacts` | POST | Generate epics/features/stories | `{epics, features, userStories, personas}` |
| `/api/sdlc/projects` | POST | Create SDLC project | `{id: string}` |
| `/api/workflow/save-artifacts` | POST | Save artifacts to project | `{success: true}` |

---

## State Variables Summary

| Variable | Type | Purpose | Set By |
|----------|------|---------|--------|
| `brdAttached` | boolean | Tracks BRD attachment status | `handleAttachBrdToWorkflow()` |
| `brdVersions` | Array | List of available BRD versions | `useEffect` (load versions) |
| `selectedBrdVersionId` | number | Selected BRD for attachment | Dialog radio group |
| `brdVersionsLoading` | boolean | Loading state for BRD fetch | `useEffect` |
| `brdDialogOpen` | boolean | Show/hide BRD selection dialog | User clicks "Save BRD" |
| `attachLoading` | boolean | Loading state during attach | `handleAttachBrdToWorkflow()` |
| `isGenerating` | boolean | Loading state during generation | `handleGenerateArtifacts()` |
| `quickReplies` | string[] | AI suggestion buttons | API response / `handleGenerateFromBrd()` |
| `showChoiceDialog` | boolean | Show/hide "Generate or Continue" modal | `handleGenerateFromBrd()` sets to false |

---

## UI/UX Features

### Visual Feedback
- **Toast notifications** for success/error states
- **Loading spinner** during BRD attachment
- **Progress overlay** with percentage during artifact generation
- **Disabled state** on buttons during loading
- **Color coding** (green for generation action)

### Accessibility
- Semantic HTML with proper button types
- Aria labels for screen readers (via Radix UI components)
- Keyboard navigation support
- Clear loading state indicators

### Responsive Design
- Mobile-friendly layout (flex wrapping)
- Compact button sizing for small screens
- Dialog responsive width (`sm:max-w-[520px]`)

---

## Testing Scenarios

### Scenario 1: Attach BRD and Generate
1. Open Workflow SDLC page
2. Click "Save BRD" in the Attach BRD section
3. Select a BRD version and confirm
4. Verify "Generate Artifacts" button appears under "Save BRD"
5. Verify quick reply buttons are hidden
6. Click "Generate Artifacts"
7. Verify generation spinner shows
8. Wait for completion and verify transition to Step 2

### Scenario 2: Generation Without BRD (Conversational Mode)
1. Have conversation with Tia Bot
2. When ready, choose "Generate Artifacts Now" from dialog (if not using BRD flow)
3. Verify normal generation proceeds

### Scenario 3: BRD Versions Not Available
1. Open Workflow with project that has no BRD
2. "Save BRD" button shows "No BRD Available" (disabled)
3. "Generate Artifacts" button does not appear

### Scenario 4: Error Handling
1. Attempt to attach BRD without selecting project (error toast)
2. Attempt to attach BRD without selecting version (error toast)
3. Verify error states are recoverable

---

## Performance Considerations

1. **BRD Version Loading**
   - Loaded once on component mount via `useEffect`
   - Sorted by version descending (newest first)
   - Caching at client level

2. **Artifact Generation**
   - Progress tracking with 90-second timeout estimate
   - No real-time progress updates from server (UX estimate)
   - Large response payloads handled via JSON parsing

3. **State Management**
   - Local component state using React hooks
   - No heavy Redux or context overhead for this feature
   - Efficient re-renders with conditional rendering

---

## Future Enhancements

1. **BRD Summary Injection**
   - Automatically inject BRD summary into requirement context
   - Implement server-side BRD content retrieval

2. **Batch BRD Processing**
   - Support multiple BRD attachments
   - Merge requirements from multiple BRDs

3. **BRD Version History**
   - Track which BRD version generated which artifacts
   - Regenerate from previous BRD versions

4. **Custom Generation Options**
   - Allow user to select personas before generation
   - Choose which artifact types to generate
   - Customize generation prompts per BRD

5. **Artifact Preview**
   - Show preview of artifacts before saving
   - Allow modifications in modal before commit

---

## Conclusion

The **Generate Artifacts from BRD** feature provides a streamlined, user-friendly workflow for users with clear requirements. By eliminating unnecessary dialogs, hiding confusing AI suggestions, and providing immediate action buttons, the feature improves UX and reduces cognitive load. The implementation leverages existing artifact generation infrastructure while adding focused BRD attachment and direct generation capabilities.

**Key Achievement:** Users can now attach a BRD and generate complete agile artifacts with just 2 clicks (Save BRD + Generate Artifacts), compared to the multi-step conversational refinement flow.

