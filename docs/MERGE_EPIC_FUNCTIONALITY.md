# Merge Epic Functionality Documentation

## Overview
The Merge Epic functionality allows users to select multiple epics through checkboxes and merge them into a single consolidated epic using AI-powered title generation. This feature is available on the SDLC Backlog screen (Step 2 - Generated Content).

## Architecture Overview

### Frontend Component
**File:** `client/src/components/workflow/step2-generated-content.tsx`

### Backend API
**File:** `server/routes.ts`

---

## Frontend Implementation

### 1. State Management
**Location:** Lines 175
```tsx
const [selectedEpics, setSelectedEpics] = useState<Set<string>>(new Set());
```
- Manages selected epic IDs using a Set for efficient lookup and deduplication

### 2. Epic Checkbox Logic
**Location:** Lines 1488-1500
```tsx
<Checkbox
  checked={selectedEpics.has(epic.id)}
  onCheckedChange={(checked) => {
    setSelectedEpics(prev => {
      const newSelected = new Set(prev);
      if (checked) {
        newSelected.add(epic.id);
      } else {
        newSelected.delete(epic.id);
      }
      return newSelected;
    });
  }}
```

**Functionality:**
- Each epic displays a checkbox next to its expand/collapse arrow
- Checkbox state is managed through the `selectedEpics` Set
- `onCheckedChange` handler adds or removes epic IDs from the selection
- Checkboxes are rendered during artifact generation for all epics

### 3. Merge Epics Button
**Location:** Lines 1347-1353
```tsx
<Button
  variant="outline"
  size="sm"
  onClick={async () => { /* merge logic */ }}
  disabled={selectedEpics.size < 2}
  title={selectedEpics.size < 2 ? "Select at least 2 epics to merge" : "Merge selected epics into one"}
>
  <Merge className="h-4 w-4 mr-2" />
  Merge Epics ({selectedEpics.size})
</Button>
```

**Features:**
- Positioned next to Export button in the toolbar
- Shows count of selected epics in parentheses
- Disabled state when less than 2 epics are selected
- Tooltip indicates requirement for minimum selection

### 4. Merge Logic Implementation
**Location:** Lines 1105-1345

#### 4.1 Data Collection (Lines 1105-1128)
```tsx
const selectedEpicIds = Array.from(selectedEpics);
const epicsToMerge = epics.filter(epic => selectedEpicIds.includes(epic.id));

// Get all features and user stories related to selected epics
const relatedFeatures = features.filter(feature => 
  selectedEpicIds.includes(feature.epicId)
);
const relatedUserStories = userStories.filter(story => 
  selectedEpicIds.includes(story.epicId)
);
```

#### 4.2 AI API Call (Lines 1129-1149)
```tsx
const response = await apiRequest(`/api/ai/generate-merged-epic-title`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    epics: epicsToMerge.map(epic => ({
      id: epic.id,
      title: epic.title,
      description: epic.description,
      priority: epic.priority
    })),
    features: relatedFeatures,
    userStories: relatedUserStories,
    requirement: requirement,
    projectContext: projectName
  })
});
```

#### 4.3 Epic Consolidation (Lines 1150-1209)
```tsx
// Create new merged epic
const mergedEpic: Epic = {
  id: `merged-epic-${Date.now()}`,
  title: mergedTitle,
  description: mergedDescription,
  priority: highestPriority,
  featureCount: 0
};

// Update feature references
const updatedFeatures = features.map(feature => {
  if (selectedEpicIds.includes(feature.epicId)) {
    return { ...feature, epicId: mergedEpic.id };
  }
  return feature;
});

// Update user story references  
const updatedUserStories = userStories.map(story => {
  if (selectedEpicIds.includes(story.epicId)) {
    return { ...story, epicId: mergedEpic.id };
  }
  return story;
});

// Remove original epics and add merged epic
const remainingEpics = epics.filter(epic => !selectedEpicIds.includes(epic.id));
const allUpdatedEpics = [...remainingEpics, mergedEpic];
```

#### 4.4 Fallback Logic (Lines 1213-1344)
When AI service fails, implements intelligent fallback:
- Analyzes epic titles and descriptions for meaningful keywords
- Filters out common words and noise terms
- Creates consolidated title by combining significant terms
- Generates descriptive summary of combined epics

---

## Backend Implementation

### 1. API Endpoint
**Location:** `server/routes.ts` Lines 7323-7520
```typescript
app.post("/api/ai/generate-merged-epic-title", async (req: Request, res: Response) => {
```

### 2. Input Validation (Lines 7325-7330)
```typescript
const { epics, features = [], userStories = [], requirement, projectContext } = req.body;

if (!epics || !Array.isArray(epics) || epics.length < 2) {
  return res.status(400).json({ error: "At least 2 epics are required for merging" });
}
```

### 3. Comprehensive Data Analysis (Lines 7335-7350)
```typescript
const epicsAnalysis = epics.map((epic, index) => {
  const epicFeatures = features.filter(f => f.epicId === epic.id);
  const epicStories = userStories.filter(s => s.epicId === epic.id);
  
  return `Epic ${index + 1}: "${epic.title}"
Description: ${epic.description}
Priority: ${epic.priority}

Features (${epicFeatures.length}):
${epicFeatures.map(f => `    - ${f.title}: ${f.description}`).join('\n')}

User Stories (${epicStories.length}):
${epicStories.map(s => `    - ${s.title} (${s.persona}): ${s.description}`).join('\n')}`;
}).join('\n\n');
```

### 4. AI Prompt Engineering (Lines 7360-7395)
Key requirements sent to AI:
- Create ONE consolidated Epic title
- Combine Epic titles and descriptions into meaningful summary
- No hardcoded suffixes or templates
- Focus on business value and capability
- Natural business language (2-5 words)

### 5. Response Processing (Lines 7415-7430)
```typescript
const result = JSON.parse(content);
if (!result.title || !result.description) {
  throw new Error("Invalid response format");
}
res.json({
  title: result.title.trim(),
  description: result.description
});
```

### 6. Intelligent Fallback (Lines 7435-7515)
When AI fails, implements comprehensive fallback:
- Analyzes titles and descriptions from all epics
- Identifies common themes across multiple epics
- Uses progressive fallback strategy
- Generates meaningful consolidated titles without hardcoding

---

## User Experience Flow

### 1. Epic Selection
1. User navigates to Step 2 - Generated Content (Backlog screen)
2. Epics are displayed with checkboxes for selection
3. User can select/deselect epics by clicking checkboxes
4. Merge button shows count and enables when ≥2 selected

### 2. Merge Execution  
1. User clicks "Merge Epics" button
2. System collects related features and user stories
3. AI analyzes comprehensive data for intelligent title generation
4. New consolidated epic is created
5. All related features/stories are reassigned to new epic
6. Original selected epics are removed
7. User receives success notification

### 3. Fallback Handling
1. If AI service fails, intelligent local analysis kicks in
2. System analyzes epic content for meaningful keywords
3. Creates consolidated title using significant terms
4. Maintains same epic consolidation process
5. User experience remains seamless

---

## Key Features

### ✅ Checkbox Logic for All Epics
- **Location:** Lines 1488-1500 in `step2-generated-content.tsx`
- Checkboxes appear next to every epic during artifact generation
- State managed through React Set for efficient operations
- Visual feedback with count display on merge button

### ✅ AI-Powered Title Generation
- **Location:** Lines 7360-7430 in `server/routes.ts`  
- Analyzes epics, features, user stories, and acceptance criteria
- Creates meaningful business summaries without concatenation
- No hardcoded templates or suffixes

### ✅ Intelligent Fallback System
- **Frontend Fallback:** Lines 1213-1297 in `step2-generated-content.tsx`
- **Backend Fallback:** Lines 7435-7515 in `server/routes.ts`
- Ensures functionality even without AI service
- Maintains quality through content analysis

### ✅ Complete Data Integration  
- Reassigns all related features and user stories to merged epic
- Maintains data integrity across the entire artifact hierarchy
- Preserves business logic and relationships

---

## Technical Implementation Notes

### State Management
- Uses React `useState` with Set<string> for O(1) lookup performance
- Efficient add/remove operations for checkbox interactions

### API Integration
- RESTful POST endpoint with comprehensive payload
- Proper error handling with graceful fallbacks
- Consistent response format for frontend integration

### Data Processing
- Filters and maps related artifacts efficiently
- Maintains referential integrity during merge operations
- Optimized for large dataset handling

### User Feedback
- Real-time button state updates based on selection
- Clear success/error messaging via toast notifications
- Disabled states with helpful tooltips

---

## Error Handling

### Frontend
- Validation for minimum epic selection (≥2)
- Try-catch blocks with fallback logic
- User-friendly error messages

### Backend  
- Input validation for required fields
- AI service failure handling
- Comprehensive fallback mechanisms
- Structured error responses

---

## Future Enhancements

### Potential Improvements
1. Bulk epic operations (delete, priority change)
2. Preview mode before finalizing merge
3. Undo/redo functionality for merge operations
4. Advanced AI prompt customization
5. Export merged epic history

### Performance Optimizations
1. Lazy loading for large epic datasets
2. Virtualization for checkbox rendering
3. Debounced AI API calls
4. Client-side caching for merge previews