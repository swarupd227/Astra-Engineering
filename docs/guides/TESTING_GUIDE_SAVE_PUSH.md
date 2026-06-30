# Testing Guide - User Story Save & Push to Azure DevOps

## Prerequisites

1. Application running locally or deployed
2. Azure DevOps organization configured
3. Personal Access Token (PAT) for Azure DevOps with appropriate permissions
4. At least one user story in the Requirements phase

## Test Steps

### Test 1: View and Edit User Stories

**Steps:**
1. Navigate to SDLC (main page)
2. Click on "Requirement & Analysis" phase
3. Click on "User Stories" submenu/feature
4. Verify user stories are displayed as cards with:
   - Title
   - Description (truncated)
   - Status and Priority badges
   - Story points
   - Assigned to
   - View and Edit buttons

**Expected Result:**
- User stories load and display correctly
- Each card has View and Edit buttons

---

### Test 2: Open Edit Dialog

**Steps:**
1. From Test 1, click the "Edit" button on any user story
2. Verify the edit dialog opens with all user story details

**Expected Result:**
- WorkItemEditDialog opens
- All fields are populated with user story data:
  - Title field
  - Description textarea
  - Status dropdown
  - Priority dropdown
  - Assigned To field
  - Story Points field
- Dialog footer shows three buttons:
  - Cancel
  - Push to Azure DevOps (NEW)
  - Save Changes (Existing)

---

### Test 3: Save User Story Changes (Existing Functionality)

**Steps:**
1. From Test 2, make a change to the user story (e.g., change title)
2. Click "Save Changes" button
3. Wait for response
4. Verify success message appears

**Expected Result:**
- Success toast notification: "[item type] updated successfully"
- Dialog closes
- Changes are saved to local database
- When reopening the dialog, changes persist

---

### Test 4: Access Push to Azure DevOps Modal

**Steps:**
1. From Test 2 (edit dialog), click "Push to Azure DevOps" button
2. Verify the push modal opens

**Expected Result:**
- UserStoryPushDevOpsModal opens
- Shows "Push User Story to Azure DevOps" title
- Displays three sections:
  1. User Story Details (read-only)
     - Shows title, description, status, priority, story points
  2. Azure DevOps Configuration (collapsible, expanded by default)
     - Organization field (pre-populated if available)
     - Project field (pre-populated if available)
     - Repository field (optional)
     - Branch field (defaults to "main")
     - Personal Access Token field (empty, required)
  3. Dialog footer with Cancel and "Push to Azure DevOps" buttons

---

### Test 5: Pre-population of ADO Fields

**Prerequisites:**
- An ADO project should be selected in the main SDLC interface

**Steps:**
1. Select an ADO project in the main SDLC interface
2. Open user story edit dialog
3. Click "Push to Azure DevOps" button
4. Verify Organization and Project fields are pre-populated

**Expected Result:**
- Organization field is pre-filled with the selected ADO organization
- Project field is pre-filled with the selected ADO project name
- User only needs to provide the PAT

**Fallback Test (No ADO Project Selected):**
1. Clear the selected ADO project
2. Repeat steps 2-3
3. Verify fields are empty (not an error, just require manual entry)

---

### Test 6: Validation - Missing PAT

**Steps:**
1. From Test 4 (push modal), leave the PAT field empty
2. Try to click "Push to Azure DevOps" button

**Expected Result:**
- Button is disabled (grayed out)
- Tooltip or disabled state prevents clicking
- User must enter PAT before push is allowed

---

### Test 7: Successful Push to Azure DevOps

**Prerequisites:**
- Valid Azure DevOps PAT
- Azure DevOps organization and project exist and are accessible

**Steps:**
1. From Test 4 (push modal), fill in all required fields:
   - Organization (or keep pre-populated)
   - Project (or keep pre-populated)
   - Personal Access Token (required)
2. Click "Push to Azure DevOps" button
3. Wait for processing
4. Verify success message

**Expected Result:**
- Button shows loading state: "Pushing..." with spinner
- After 1-2 seconds, success message appears
- Toast notification: "User story pushed to Azure DevOps successfully!"
- Button shows "✓ Pushed Successfully" state
- Dialog automatically closes after 1.5 seconds
- User returns to the list view

**Verification in Azure DevOps:**
- Log into Azure DevOps
- Navigate to the project
- Check Backlog or Boards
- Verify the user story appears as a new work item

---

### Test 8: Error Handling - Invalid Configuration

**Steps:**
1. From Test 4 (push modal), enter:
   - Invalid Organization
   - Valid Project name
   - Valid PAT
2. Click "Push to Azure DevOps" button
3. Observe error handling

**Expected Result:**
- Button shows loading state
- Error message appears in toast notification
- Error message includes details from the API
- Modal stays open for user to retry or cancel
- Button returns to normal state

---

### Test 9: Error Handling - Missing Required Fields

**Steps:**
1. Clear the Organization field
2. Try to click "Push to Azure DevOps" button

**Expected Result:**
- Button remains disabled until Organization is filled
- Help text shows "required" fields
- User cannot push without completing all mandatory fields

---

### Test 10: Multiple Operations

**Steps:**
1. Edit a user story (change title, description, etc.)
2. Click "Save Changes" button
3. Wait for success
4. Click "Edit" again to reopen the same story
5. Click "Push to Azure DevOps" button
6. Fill in PAT and push
7. Wait for success

**Expected Result:**
- Save and Push operations work independently
- Both succeed without conflicts
- Changes saved to database
- Story also appears in Azure DevOps

---

### Test 11: Backlog Items Push (Optional)

**Steps:**
1. Navigate to Backlog feature in Requirement & Analysis
2. Click Edit on a backlog item
3. Verify "Push to Azure DevOps" button appears
4. Complete push operation

**Expected Result:**
- Push to Azure DevOps feature works for backlog items too
- Same workflow as user stories

---

### Test 12: Modal UI Elements

**Steps:**
1. Open push modal
2. Click on "Azure DevOps Configuration" header
3. Verify section collapses
4. Click again to expand

**Expected Result:**
- Configuration section collapses/expands smoothly
- Chevron icon rotates to show state
- All information remains intact when toggling

---

## Edge Cases to Test

### Edge Case 1: Rapid Clicking
1. Click "Push to Azure DevOps" button multiple times rapidly
2. Verify only one request is sent (button should be disabled during push)

**Expected Result:**
- Only one API call is made
- Button is disabled during operation

### Edge Case 2: Network Error
1. Disconnect from network or use browser dev tools to throttle/fail
2. Attempt push
3. Verify error handling

**Expected Result:**
- Error message displays
- Modal remains open
- User can retry when network is available

### Edge Case 3: Very Long User Story Content
1. Create user story with very long title or description
2. Open edit and push dialogs
3. Verify text displays correctly and doesn't break layout

**Expected Result:**
- Text is truncated or wrapped appropriately
- Layout remains intact
- No text overflow or visual issues

### Edge Case 4: Special Characters
1. User story with special characters: `&<>'"*/\\`
2. Edit and save
3. Push to Azure DevOps
4. Verify in Azure DevOps

**Expected Result:**
- Special characters are properly escaped
- Work item is created correctly in Azure DevOps
- No encoding errors

---

## Manual Testing Checklist

- [ ] User stories display correctly
- [ ] Edit dialog opens with proper fields
- [ ] Save button works and updates database
- [ ] Push button is visible only for stories/backlog
- [ ] Push modal opens correctly
- [ ] ADO fields are pre-populated when available
- [ ] PAT field is required (button disabled without it)
- [ ] Successful push creates work item in Azure DevOps
- [ ] Success notification displays
- [ ] Error messages are clear and helpful
- [ ] Modal closes automatically after successful push
- [ ] Multiple operations can be performed sequentially
- [ ] UI elements are responsive and properly aligned
- [ ] Modal collapses/expands correctly
- [ ] No JavaScript errors in browser console

---

## Browser DevTools Checks

1. Open Browser DevTools (F12)
2. Navigate to Console tab
3. Perform all tests above
4. Verify:
   - No red error messages
   - No unhandled promise rejections
   - Network requests show 2xx status for successful operations
   - Request/response payloads are correct

---

## Performance Considerations

1. Test with multiple user stories (20+)
2. Verify list loads quickly
3. Edit dialog opens promptly
4. Push request completes in reasonable time
5. No memory leaks when opening/closing modals repeatedly

---

## Accessibility Testing

1. Test keyboard navigation:
   - Tab through all form fields
   - Enter key submits forms
   - Escape closes modals
2. Verify button labels are clear
3. Test with screen reader (if available)
4. Check color contrast meets WCAG standards
