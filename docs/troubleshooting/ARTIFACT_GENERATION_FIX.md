# Artifact Generation Troubleshooting Guide

## Overview
This document helps diagnose and resolve issues with workflow artifact generation in the DevX platform.

---

## Common Issues & Solutions

### 1. ❌ "Generation Failed" with No Details

**Symptoms:**
- Toast notification shows "Generation Failed"
- No specific error message displayed
- Console shows generic error

**Recent Fixes Applied:**
✅ Enhanced error handling in `/api/workflow/generate-artifacts` endpoint
✅ Frontend now displays actual error messages from API
✅ Better error propagation throughout the stack

**Resolution Steps:**
1. Check browser console (F12 → Console tab) for detailed error message
2. Check server logs for "Error generating artifacts:" message
3. Verify Azure OpenAI credentials in `.env` file
4. Increase max_tokens from 3000 to 4500 to allow comprehensive artifact generation

---

### 2. ❌ AI Model Timeout or Unavailable

**Symptoms:**
- Artifact generation takes >2 minutes
- Request timeout error
- "Model not found" error

**Possible Causes:**
- Azure OpenAI deployment not responding
- Incorrect Azure credentials
- Network connectivity issues

**Resolution:**
```bash
# Verify environment variables
echo $AZURE_OPENAI_ENDPOINT
echo $AZURE_OPENAI_DEPLOYMENT
echo $AZURE_OPENAI_API_KEY

# Check Azure OpenAI deployment is accessible
curl -X POST https://openaiswarup.openai.azure.com/openai/deployments/SwarupDemo/chat/completions?api-version=2024-02-01 \
  -H "api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}]}'
```

---

### 3. ❌ "Invalid Artifacts" Error

**Symptoms:**
- AI generates response but validation fails
- Error mentions "missing id or title"
- Error mentions "missing epicId or featureId"

**Root Cause:**
The AI response doesn't follow the required structure. This was fixed by:

✅ Increased max_tokens from 3000 to 4500
✅ Added comprehensive validation checks
✅ Better JSON parsing error reporting

**Resolution:**
1. The system now validates that all artifacts have required fields:
   - **Epics:** must have `id`, `title`, `description`, `priority`
   - **Features:** must have `id`, `title`, `epicId`, `description`, `priority`
   - **User Stories:** must have `id`, `title`, `featureId`, `epicId`, detailed structure with ACs

2. If validation still fails, check the server logs for what's missing

---

### 4. ❌ Empty or Incomplete Artifacts

**Symptoms:**
- Artifacts generate but are empty arrays
- Some epics, but no features or stories
- Missing acceptance criteria or subtasks

**Root Cause:**
- Requirement text too short
- AI response truncated due to token limit
- Personas not properly formatted

**Resolution:**
1. Provide detailed requirement text (minimum 200 characters, ideally 500+)
2. Token limit increased to 4500 - should now handle comprehensive artifacts
3. Ensure personas are properly selected if using persona-based stories

---

### 5. ⚠️ Guidelines Generation Fails

**Symptoms:**
- Error at "Generating AI Design Guidelines..." step
- Workflow stops before artifacts are even attempted

**Resolution:**
1. Verify the same Azure OpenAI credentials work
2. Check if `/api/workflow/generate-guidelines` endpoint is accessible
3. Server logs should show detailed error

---

## Files Modified for Fixes

### Backend Changes:
1. **`server/routes.ts` (Line 912-933)**
   - Added detailed error message propagation
   - Now returns actual error instead of generic message

2. **`server/ai-service.ts` (Line ~2950)**
   - Added validation for all artifact fields
   - Validates epics, features, and user stories have required data
   - Clear error messages for missing fields
   - Increased `max_tokens` from 3000 to 4500

### Frontend Changes:
1. **`client/src/components/workflow/step1-conversational-refinement.tsx`**
   - Better error response handling
   - Displays actual API error messages in toast
   - Added error checking for guidelines endpoint
   - Shows detailed error instead of generic message

---

## Testing the Fix

### Using Test Script:
```bash
node test-artifact-generation.js
```

This will:
1. Send a sample requirement to `/api/workflow/generate-artifacts`
2. Parse and display the response
3. Show detailed statistics about generated artifacts
4. Validate the structure is correct

### Manual Testing:
1. Open DevX workflow page
2. Go through conversation steps to gather requirements
3. Check browser console (F12) for detailed logs
4. Check server console for "[AI Service]" debug logs
5. Look for validation errors in server logs

---

## Environment Configuration

Ensure these are set in `.env`:
```
AZURE_OPENAI_API_KEY=your_key
AZURE_OPENAI_ENDPOINT=https://your-instance.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=your_deployment_name
AZURE_OPENAI_API_VERSION=2024-02-01
```

Or fallback to Replit AI:
```
AI_INTEGRATIONS_OPENAI_BASE_URL=http://localhost:1106/modelfarm/openai
AI_INTEGRATIONS_OPENAI_API_KEY=your_key
```

---

## Debug Logging

### Enable Detailed Logging:

**Server Side:**
Look for these patterns in server logs:
- `[AI Service] Generating agile artifacts for:` - Start of generation
- `[AI Service] Using Azure OpenAI:` - Which AI backend is being used
- `[AI Service] Response received:` - AI has responded
- `[AI Service] Parsed artifacts:` - Counts of epics/features/stories
- `[AI Service] === FEATURE RELATIONSHIP DEBUG ===` - Structure validation

**Client Side:**
Check console for:
- `[Workflow] Generated artifacts:` - Artifact counts
- `[Workflow] === DETAILED USER STORY DEBUG ===` - Story relationships
- `[Workflow] Sending to save-artifacts:` - Saving attempt
- `[Workflow] Artifacts saved to SDLC:` - Save confirmation

---

## Common Error Messages & Meanings

| Error | Meaning | Fix |
|-------|---------|-----|
| "Requirement text is required" | No requirement sent | Ensure requirement field in request |
| "Failed to parse AI response as JSON" | AI returned invalid JSON | Increase max_tokens, check prompt |
| "AI response was truncated" | Response too long | Increase max_tokens (done - now 4500) |
| "Invalid epics found: missing id or title" | Epic structure invalid | Check AI prompt for correct format |
| "Invalid features found: missing id or epicId" | Feature structure invalid | Check feature relationships |
| "Invalid user stories: missing featureId or epicId" | Story structure invalid | Check story relationships |
| "Model not found" | Azure deployment mismatch | Verify AZURE_OPENAI_DEPLOYMENT name |

---

## Performance Considerations

- **Generation Time:** 30-60 seconds (AI model processing)
- **Max Tokens:** 4500 (increased from 3000 for comprehensive artifacts)
- **Temperature:** 0.2 (deterministic output)
- **Retry Logic:** Consider adding retry mechanism for failed requests

---

## Next Steps if Issue Persists

1. **Check Server Logs:**
   ```bash
   # If running locally
   npm run dev  # Watch console for errors
   
   # If on server, check logs:
   tail -f /var/log/devx-app.log
   ```

2. **Verify Azure OpenAI:**
   - Test deployment is responding
   - Check quota limits not exceeded
   - Verify API version is correct

3. **Validate Requirement Text:**
   - Minimum 150+ characters
   - Include specific details about features
   - Mention target users and technical constraints

4. **Check Network:**
   - Ensure firewall allows Azure OpenAI calls
   - Verify DNS resolution works
   - Check proxy settings if applicable

5. **Check Database:**
   - Verify `workflow_artifacts` table exists
   - Check `workflow_subtasks` table exists
   - Ensure proper permissions

---

## Support & Reporting

If issues persist after applying these fixes:

1. Gather information:
   - Browser console error (F12)
   - Server logs (full error stack)
   - Request payload (what you sent)
   - Environment details (.env configuration)

2. Report with:
   - Exact error message
   - Steps to reproduce
   - Server logs from the attempt
   - Browser console logs

---

## Summary of Changes

### ✅ Fixed Issues:
- Better error messages visible to users
- Comprehensive artifact validation
- Increased token limit for longer artifacts
- Improved error handling at all layers

### 🎯 What This Achieves:
- Users can now see actual errors instead of generic messages
- AI responses are validated to ensure proper structure
- Artifacts generation has better chance of success with more tokens
- Troubleshooting is easier with detailed error information

---

Last Updated: 2025-01-09
