# User Story Save and Push to Azure DevOps Implementation

## Overview

This implementation adds two key features to the SDLC Requirement Analysis phase for User Stories:

1. **Save Button** - Saves user story changes to the local database
2. **Push to Azure DevOps Button** - Opens a modal to configure and push the user story to Azure DevOps

## Changes Made

### 1. New Modal Component: `user-story-push-devops-modal.tsx`

**Location:** `client/src/components/user-story-push-devops-modal.tsx`

**Features:**
- Displays user story details (title, description, status, priority, story points)
- Azure DevOps Configuration section with collapsible details:
  - Organization
  - Project
  - Repository
  - Branch (defaults to "main")
  - Personal Access Token (PAT) - Required
- Pre-populates organization and project if they're available from the selected ADO project
- Push button that calls the backend API
- Success/error messaging with toast notifications

**Props:**
```typescript
interface UserStoryPushDevOpsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userStory: any;
  projectId: string;
  adoOrganization?: string | null;
  adoOrganizationDisplay?: string | null;
  adoProjectName?: string | null;
  onSuccess?: () => void;
}
```

### 2. Updated: `work-item-edit-dialog.tsx`

**Changes:**
- Added import for `UserStoryPushDevOpsModal` and `Cloud` icon from lucide-react
- Added new optional props to interface for ADO organization information:
  - `adoOrganization`
  - `adoOrganizationDisplay`
  - `adoProjectName`
- Added state for `pushModalOpen`
- Added "Push to Azure DevOps" button in DialogFooter (visible only for story/backlog items)
- Button opens the UserStoryPushDevOpsModal
- Included the modal component with proper data passing

**Key Features:**
- Save button saves changes to database (already existed)
- Push button is only shown for user stories and backlog items
- Both buttons are available in the edit dialog

### 3. Updated: `phase-feature-dialog.tsx`

**Changes:**
- Updated `PhaseFeatureDialogProps` interface to include ADO organization props
- Updated component function signature to accept the new props
- Updated `UserStoriesContent` and `BacklogContent` function signatures
- Passed ADO props to both content functions in switch cases
- Updated `WorkItemEditDialog` usage in both `UserStoriesContent` and `BacklogContent` to pass ADO props

**Props Flow:**
```
PhaseFeatureDialog (receives adoOrganization, etc.)
  ↓
UserStoriesContent / BacklogContent (receive ADO props)
  ↓
WorkItemEditDialog (receives ADO props)
  ↓
UserStoryPushDevOpsModal (uses ADO props for pre-population)
```

### 4. Updated: `sdlc.tsx`

**Changes:**
- Updated `PhaseFeatureDialog` component usage to pass ADO information from selected project:
  - `adoOrganization={selectedAdoProject?.id}`
  - `adoOrganizationDisplay={selectedAdoProject?.organization}`
  - `adoProjectName={selectedAdoProject?.name}`

### 5. New API Endpoint: `routes.ts`

**Endpoint:** `POST /api/workflow/push-devops-single-story`

**Purpose:** Handles pushing a single user story to Azure DevOps

**Request Body:**
```typescript
{
  config: {
    organization: string;
    project: string;
    repository?: string;
    branch?: string;
    pat: string;
  },
  userStory: {
    id: string;
    title: string;
    description?: string;
    // ... other user story fields
  }
}
```

**Response:**
```typescript
{
  success: boolean;
  message?: string;
  error?: string;
  workItemIds?: string[];
  url?: string;
}
```

**Implementation Details:**
- Creates an AzureDevOpsService instance with provided configuration
- Calls the existing `pushWorkItems` method
- Returns success/error response
- Handles validation of required fields (organization, project, PAT)

## User Flow

1. **View User Stories**
   - User navigates to SDLC → Requirement Analysis phase → User Stories submenu
   - User stories are displayed as cards with Edit button

2. **Edit User Story**
   - User clicks "Edit" button on a user story card
   - WorkItemEditDialog opens with user story details
   - User can modify title, description, status, priority, assigned to, story points

3. **Save Changes** (Existing Feature)
   - User clicks "Save Changes" button
   - Changes are saved to the local database
   - Dialog closes with success message

4. **Push to Azure DevOps** (New Feature)
   - User clicks "Push to Azure DevOps" button
   - UserStoryPushDevOpsModal opens
   - Shows user story details for reference
   - Shows Azure DevOps Configuration section
   - Organization and Project are pre-populated if available
   - User enters Personal Access Token (required)
   - User can customize Repository and Branch if needed
   - User clicks "Push to Azure DevOps" button
   - API call is made to push the story
   - Success message appears
   - Dialog closes after 1.5 seconds

## Database Changes

**None** - The implementation uses existing database tables and API endpoints.

## Configuration

**No additional configuration needed** - The system uses:
- Existing Azure DevOps configuration from Settings
- Selected ADO project information from the project selector
- User-provided PAT during push operation

## Error Handling

- Validation for required fields (organization, project, PAT)
- Toast notifications for both success and error cases
- Error messages are user-friendly with details from the API
- Graceful fallback if ADO config can't be fetched

## Testing Checklist

- [ ] User stories display correctly in Requirements phase
- [ ] Edit button opens the edit dialog
- [ ] Save button updates user story in database
- [ ] Push to Azure DevOps button appears only for user stories/backlog
- [ ] Push modal opens with correct user story details
- [ ] Organization and Project fields are pre-populated
- [ ] Modal validates PAT is provided before allowing push
- [ ] Push successfully creates work item in Azure DevOps
- [ ] Success message shows after push
- [ ] Error messages display appropriately if push fails

## Notes

- The push modal follows the same design pattern as the existing `devops-push-modal.tsx` for consistency
- The implementation works with both local workflow artifacts and ADO work items
- The PAT is sent via HTTPS to the backend and then to Azure DevOps (not stored)
- The implementation is compatible with existing workflows and doesn't break any functionality
