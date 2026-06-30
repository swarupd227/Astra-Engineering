# Debug Guide - Requirements Edit & AI Enhance

## 🔍 What I Did

### 1. Added Detailed Logging for Requirements
Added extensive console logging to track the transformation and editing flow.

### 2. Restarted Server for AI Enhance Fix
The AI Enhance fix in `server/routes.ts` requires a server restart (not just hot reload).

---

## 🧪 How to Test & Debug

### Test 1: Requirements Edit - Check Browser Console

1. **Open Browser DevTools** (F12)
2. **Go to Console tab**
3. Navigate to: **SDLC** → **Requirement Analysis** → **Requirements**
4. **Click [Edit]** on a requirement

**Look for these console logs:**

```javascript
[Requirements] Transforming raw item: {id: "...", title: "...", description: "..."}
[Requirements] Transformed to: {id: "...", title: "...", _originalItem: {...}}
[Requirements] Total requirements: 1 transformed: 1
[Requirements] Editing item (pre-dialog): {id: "...", title: "...", ...}
[Requirements] Item has _originalItem: true
[Requirements] Item title: "Workflow Requirements - 11/1/2025..."
[Requirements] Item _originalItem title: "Workflow Requirements - 11/1/2025..."
[Edit Dialog] Opening with item: {...}
[Edit Dialog] Original item: {...}
[Edit Dialog] Extracted values: {title: "...", description: "...", ...}
[Edit Dialog] Setting form data: {...}
```

**Expected Result:** Title field should be populated with the requirement title.

**If Title is Still Empty:**
- Check if `[Requirements] Transforming raw item:` shows a title
- Check if `[Edit Dialog] Extracted values:` shows a title
- Share the console log output with me

---

### Test 2: AI Enhance - Check Server Console

1. **Check that server has restarted** - Look for startup messages
2. In SDLC, click **[Edit]** on any item (requirement, user story, epic)
3. Click **AI Enhance** button (✨ sparkles icon)

**Look for these SERVER console logs:**

```
[AI Enhance] Request received: {title: "...", itemType: "...", hasDescription: true}
[AI Enhance] API Keys available: {
  hasOpenAI: false, 
  hasAzureOpenAI: true,
  azureEndpoint: 'https://openaiswarup.openai.azure.com/',
  azureDeployment: 'SwarupDemo'
}
[AI Enhance] OpenAI client initialized using: Azure OpenAI
[AI Enhance] Using model: SwarupDemo
[AI Enhance] Successfully enhanced description, length: 250
```

**Expected Result:** Description gets enhanced and populated in the dialog.

**If AI Enhance Still Fails:**
- Check server console for `[AI Enhance] API Keys available:`
- If `hasAzureOpenAI: false`, the environment variables are not loaded
- Verify `.env` file has:
  ```
  AZURE_OPENAI_API_KEY=...
  AZURE_OPENAI_ENDPOINT=https://openaiswarup.openai.azure.com/
  AZURE_OPENAI_DEPLOYMENT=SwarupDemo
  ```

---

## 🔧 Quick Fixes

### If Requirements Title is Still Empty

**Possible Issue:** The requirement data from the database might not have a title field.

**Check Database:**
```sql
SELECT id, title, description FROM sdlc_requirements 
WHERE project_id = '25f19cc2-d5cc-442e-bcb4-f527ed5140ce'
LIMIT 5;
```

**Alternative Fix:** The title might be in the `description` field. Let me know what the console shows.

---

### If AI Enhance Still Fails After Restart

**Check if server actually restarted:**
- Look for the startup banner in terminal
- The timestamp should be recent

**Manual Restart:**
```powershell
# Stop all processes
Get-Process | Where-Object { $_.ProcessName -like "*node*" } | Stop-Process -Force

# Start dev server
npm run dev
```

---

## 📊 Expected vs Actual

### Requirements Edit

**EXPECTED:**
```
┌────────────────────────────────────────┐
│ Edit requirement                    [X]│
├────────────────────────────────────────┤
│ Title *                                │
│ ┌────────────────────────────────────┐ │
│ │ Workflow Requirements - 11/1/2025  │ │ ← Should have text
│ └────────────────────────────────────┘ │
│                                        │
│ Description               [AI Enhance] │
│ ┌────────────────────────────────────┐ │
│ │ Assistant: Hello! I'm...           │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

**ACTUAL (Your Screenshot):**
```
┌────────────────────────────────────────┐
│ Edit requirement                    [X]│
├────────────────────────────────────────┤
│ Title *                                │
│ ┌────────────────────────────────────┐ │
│ │ |                                  │ │ ← EMPTY, just cursor
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

---

### AI Enhance

**EXPECTED Server Log:**
```
[AI Enhance] Request received: {...}
[AI Enhance] API Keys available: {hasAzureOpenAI: true}
[AI Enhance] Using model: SwarupDemo
[AI Enhance] Successfully enhanced description
```

**ACTUAL (Before Restart):**
```
POST /api/ai/enhance-description 400 in 33ms :: {"error":"OpenAI API key is not..."}
```

**SHOULD BE FIXED AFTER RESTART** ✅

---

## 📞 What to Share With Me

If issues persist, please share:

1. **Browser Console Output** (after clicking Edit on a requirement)
   - Copy the `[Requirements]` and `[Edit Dialog]` logs

2. **Server Console Output** (after clicking AI Enhance)
   - Copy the `[AI Enhance]` logs

3. **Screenshots** showing:
   - The requirement card (before clicking Edit)
   - The edit dialog with empty/filled fields
   - Any error toasts

4. **API Response** (from Network tab)
   - Check: `GET /api/sdlc/projects/.../phases/1/requirements`
   - Look at the Response JSON - does it have `title` field?

---

## ✅ Success Criteria

Once working:
1. ✅ Requirements edit dialog shows title and description
2. ✅ AI Enhance button successfully enhances descriptions
3. ✅ No errors in browser or server console
4. ✅ Can save changes to requirements

Let me know what you see in the console logs!

