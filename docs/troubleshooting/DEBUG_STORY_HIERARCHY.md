# Debugging: User Stories Not Showing Under Features

## Problem Statement
User stories are not appearing in the feature dropdown/tree view. Expected hierarchy:
- Epic (collapsible) → Feature (collapsible) → User Stories (list under feature)

## Root Cause Investigation

### Key Components Involved

**Frontend:**
- `client/src/components/workflow/step2-generated-content.tsx` (lines 574-586)
  - Filters stories using: `userStories.filter((s) => s.epicId === epic.id && s.featureId === feature.id)`
  - **CRITICAL:** Requires BOTH `epicId` AND `featureId` to match

**Backend:**
- `server/ai-service.ts` (line 2313+)
  - JSON template includes `"featureId"` for each story
  - Template shows 2 epics, 4 features, 8 user stories

**API Response Handler:**
- `client/src/components/workflow/step1-conversational-refinement.tsx` (line 369+)
  - Receives artifacts and sets them: `setEpics()`, `setFeatures()`, `setUserStories()`

## Debugging Steps

### 1. Enable Comprehensive Logging
Logging has been added to three key locations:

**Backend - `server/ai-service.ts` (lines 2931-2947)**
```
[AI Service] === USER STORY RELATIONSHIP DEBUG ===
[AI Service] Story 0: id=story-1, featureId=feature-1, epicId=epic-1, title=...
[AI Service] Story 1: id=story-2, featureId=feature-1, epicId=epic-1, title=...
[AI Service] === FEATURE RELATIONSHIP DEBUG ===
[AI Service] Feature 0: id=feature-1, epicId=epic-1, title=...
```

**Frontend (Receiving) - `client/src/components/workflow/step1-conversational-refinement.tsx` (lines 388-405)**
```
[Workflow] === DETAILED USER STORY DEBUG ===
Story 0: id=story-1, featureId=feature-1, epicId=epic-1, title=...
[Workflow] === FEATURE DEBUG ===
Feature 0: id=feature-1, epicId=epic-1, title=...
```

**Frontend (Displaying) - `client/src/components/workflow/step2-generated-content.tsx` (useEffect added)**
```
[Step2] === ARTIFACT STRUCTURE DEBUG ===
[Step2] Total Epics: 2
[Step2] Total Features: 4
[Step2] Total User Stories: 8
[Step2] === TESTING HIERARCHY FOR EPIC: epic-1 ===
[Step2] Features in epic epic-1: 2
[Step2]   Feature feature-1 (...): 4 stories
```

### 2. How to Check Logs

**Step 1: Open Browser DevTools**
1. Run the application
2. Navigate to the workflow
3. Go through steps to generate artifacts
4. Open browser DevTools (F12) → Console tab

**Step 2: Check Backend Logs (Terminal)**
- Look for `[AI Service] === USER STORY RELATIONSHIP DEBUG ===` logs
- Verify that stories have `featureId` set
- Check if `epicId` values match

**Step 3: Check Frontend (DevTools Console)**
- Look for `[Workflow] === DETAILED USER STORY DEBUG ===`
- Verify stories are received with `featureId` populated
- Look for `[Step2] === ARTIFACT STRUCTURE DEBUG ===`
- Check if hierarchy filtering returns correct counts

### 3. Expected vs Actual Results

**Expected Logs (Correct Behavior):**
```
[AI Service] Story 0: id=story-1, featureId=feature-1, epicId=epic-1, title=...
[Workflow] Story 0: id=story-1, featureId=feature-1, epicId=epic-1, title=...
[Step2] Features in epic epic-1: 2
[Step2]   Feature feature-1 (...): 4 stories
```

**Potential Issues:**

1. **Stories have no featureId:**
   ```
   [AI Service] Story 0: id=story-1, featureId=undefined, epicId=epic-1, title=...
   ```
   → Fix: Update AI template to ensure `featureId` is included

2. **Stories received but featureId missing:**
   ```
   [Workflow] Story 0: id=story-1, featureId=undefined, epicId=epic-1, title=...
   ```
   → Fix: Check API response parsing in routes.ts

3. **Hierarchy filtering returns 0 stories:**
   ```
   [Step2]   Feature feature-1 (...): 0 stories
   [Step2]     ⚠️ MISMATCH DETECTED: Feature has stories but epicId check fails
   [Step2]     Stories filtered by featureId alone: 4
   ```
   → Fix: Stories have wrong epicId - AI is assigning stories to wrong epics

## Verification Steps

### Test Case: Insurance Premium System

1. Create a new workflow session
2. Enter requirement: "Build an insurance premium calculation system"
3. Generate artifacts
4. Check browser console logs
5. Expand epics in the backlog
6. Expand features under each epic
7. Verify user stories appear under each feature

### Console Log Checklist
- ✓ Backend logs show stories with featureId and epicId set
- ✓ Frontend receive logs show same values
- ✓ Step2 debug logs show "Stories filtered by featureId alone" count > 0
- ✓ Step2 hierarchy test shows each feature has stories
- ✓ UI displays stories when feature is expanded

## Common Fixes

### Issue: Hierarchy filter returns 0 stories

**Root Cause:** AI is generating stories with wrong epicId/featureId combination

**Solution:** Check the filter logic in `step2-generated-content.tsx` line 574:
```tsx
const featureStories = userStories.filter((s) => s.epicId === epic.id && (s as any).featureId === feature.id);
```

If the test logs show `⚠️ MISMATCH DETECTED`, the issue is that stories are NOT properly linked to their parent feature's epic.

### Issue: Stories show under feature but with wrong parent

**Root Cause:** featureId is correct but epicId doesn't match

**Solution:** Update AI template to ensure stories get correct epicId when feature is changed

### Issue: No featureId in AI response

**Root Cause:** JSON template not including featureId field

**Solution:** Verify template in ai-service.ts includes:
```json
{
  "id": "story-1",
  "featureId": "feature-1",
  "epicId": "epic-1",
  ...
}
```

## Related Files

- `/server/ai-service.ts` - AI artifact generation (lines 2313+, 2800+, 2931+)
- `/client/src/components/workflow/step2-generated-content.tsx` - Display hierarchy (lines 574+)
- `/client/src/components/workflow/step1-conversational-refinement.tsx` - Receive artifacts (lines 369+)
- `/server/routes.ts` - API endpoint (line 522)

## Next Steps

1. Generate artifacts with a test requirement
2. Check all three logging locations (backend, frontend-receive, frontend-display)
3. Compare featureId and epicId values across all logs
4. If data is correct but display is wrong, investigate Step2 component rendering
5. If data is wrong, update AI template in ai-service.ts
