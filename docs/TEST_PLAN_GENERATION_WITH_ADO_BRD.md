# Test Plan Generation with ADO BRD Integration

## Overview
This document explains the complete implementation of test plan generation from BRD documents, including the ability to fetch BRD documents directly from Azure DevOps (ADO) work items.

## Features Implemented

### 1. ADO Work Item Attachments Support
Added methods to fetch and download attachments from ADO work items:

**File:** `server/azure-devops-service.ts`

**New Methods:**
- `getWorkItemAttachments(workItemId, projectName)` - Fetches all attachments from a work item
- `downloadAttachment(attachmentUrl)` - Downloads an attachment from ADO and returns a Buffer
- `searchBRDWorkItems(projectName)` - Searches for work items tagged as BRD or containing "BRD" in the title

### 2. API Endpoints for ADO BRD Access

**File:** `server/routes.ts`

**New Endpoints:**

#### GET `/api/testing/ado-brd-list`
Fetches BRD work items from ADO.

**Query Parameters:**
- `organizationUrl` - ADO organization URL
- `projectName` - ADO project name
- `pat` - Personal Access Token for authentication

**Response:**
```json
{
  "success": true,
  "brds": [
    {
      "id": "123",
      "workItemId": 123,
      "title": "BRD for Feature X",
      "type": "Requirement",
      "state": "Active",
      "tags": "BRD",
      "createdDate": "2024-01-15T10:00:00Z",
      "changedDate": "2024-01-20T14:30:00Z",
      "description": "...",
      "hasAttachments": true,
      "attachmentCount": 2,
      "attachments": [
        {
          "id": "att-123",
          "url": "https://...",
          "name": "BRD_Document.docx",
          "comment": ""
        }
      ]
    }
  ],
  "count": 1
}
```

#### POST `/api/testing/ado-brd-download`
Downloads a BRD attachment from ADO and extracts its content.

**Request Body:**
```json
{
  "organizationUrl": "https://dev.azure.com/YourOrg",
  "projectName": "YourProject",
  "pat": "your-pat-token",
  "workItemId": 123,
  "attachmentUrl": "https://..."
}
```

**Features:**
- Supports DOCX files (extracts text using `extractTextFromDocxBuffer`)
- Supports TXT and MD files (plain text extraction)
- Automatically extracts text content for other file types

**Response:**
```json
{
  "success": true,
  "content": "Full BRD document content...",
  "workItemId": 123
}
```

### 3. Enhanced Test Plan Generation Modal

**File:** `client/src/components/sdlc/test-plan-generation-modal.tsx`

**New Features:**

#### Three BRD Source Options:
1. **Local** - BRDs stored in the local database (existing functionality)
2. **ADO** - BRDs from Azure DevOps work items (NEW)
3. **Manual** - Manual text input (existing functionality)

#### ADO BRD Selection Flow:
1. Select ADO Project (from configured organizations)
2. Select BRD Work Item (filtered by BRD tag/title)
3. Select Attachment (if work item has multiple attachments)
4. View and generate test plan from BRD content

**State Management:**
- `brdSource` - Current source type ('local' | 'ado' | 'manual')
- `adoProjects` - List of available ADO projects
- `selectedAdoProject` - Currently selected ADO project
- `adoBrdList` - List of BRD work items from ADO
- `selectedAdoBrd` - Selected BRD work item
- `selectedAttachment` - Selected attachment URL

### 4. LLM Configuration

**File:** `server/routes.ts` (Test Plan Generation Endpoint)

**Updated LLM Integration:**
- Now uses the centralized LLM configuration from `llm-config.ts`
- Supports both **Anthropic (Claude)** and **Azure OpenAI**
- Automatically selects the configured LLM based on environment variables
- Falls back appropriately if primary LLM is not available

**LLM Selection Priority:**
1. Anthropic (Claude) - If `ANTHROPIC_AZURE_ENDPOINT` and `ANTHROPIC_API_KEY` are configured
2. Azure OpenAI - If `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_ENDPOINT` are configured

**Configuration:**
- Uses the same LLM configuration as other services (consistent across the application)
- Temperature: 0.7 (balanced between creativity and consistency)
- Max Tokens: 8000 (sufficient for comprehensive test plans)

## How It Works

### Step 1: Select BRD Source

Users can choose from three sources:
- **Local**: Select from BRDs stored in the database
- **ADO**: Fetch BRD documents from Azure DevOps work items
- **Manual**: Paste BRD content directly

### Step 2: ADO BRD Selection (if ADO source is chosen)

1. **Fetch ADO Projects**: 
   - Modal fetches configured ADO organizations and projects from `/api/settings/artifact-organizations`
   
2. **Fetch BRD Work Items**:
   - When a project is selected, the system searches for work items with:
     - Tag containing "BRD"
     - Title containing "BRD" or "Business Requirements"
     - Work Item Type = "Requirement"
   
3. **Select Attachment**:
   - If the work item has attachments, user selects the BRD document
   - System downloads and extracts text from the attachment

### Step 3: Generate Test Plan

Once BRD content is loaded:
1. User clicks "Generate Test Plan"
2. System sends BRD content to `/api/testing/generate-test-plan`
3. LLM (Anthropic or Azure OpenAI) generates comprehensive test plan using:
   - Professional prompt from `prompt_test_plan_generation.ts`
   - Full BRD content as context
4. Generated test plan is displayed in the right panel

### Step 4: Download, Copy, or Save

Users can:
- **Download** - Download as Markdown file
- **Copy** - Copy to clipboard
- **Save** - Save to database (future enhancement)

## Search Strategy for BRD Work Items

The system searches for BRD work items using WIQL (Work Item Query Language):

```sql
SELECT [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.Tags]
FROM WorkItems
WHERE [System.TeamProject] = 'ProjectName'
  AND (
    [System.Tags] CONTAINS 'BRD'
    OR [System.Title] CONTAINS 'BRD'
    OR [System.Title] CONTAINS 'Business Requirements'
    OR [System.WorkItemType] = 'Requirement'
  )
  AND [System.State] <> 'Removed'
ORDER BY [System.ChangedDate] DESC
```

## ADO Integration Security

- **PAT Token Storage**: PAT tokens are encrypted and stored securely in the database
- **Per-Request Authentication**: Each API call includes the PAT token for authentication
- **No Client-Side Storage**: PAT tokens are never exposed to the client

## Testing the Flow

### Prerequisites:
1. Configure ADO organization in Settings → Artifact Organizations
2. Ensure BRD work items exist in ADO with:
   - Tag "BRD" or
   - Title containing "BRD" or "Business Requirements"
3. BRD work items should have DOCX/TXT attachments containing the BRD document

### Test Steps:
1. Navigate to Testing phase
2. Click "Test Plan Generation" button
3. Select "ADO" tab
4. Choose an ADO project
5. Select a BRD work item from the list
6. Select an attachment (if multiple)
7. Wait for content to load
8. Click "Generate Test Plan"
9. Review generated test plan
10. Download or copy the test plan

## File Changes Summary

### Backend Files:
1. `server/azure-devops-service.ts` - Added 3 new methods for attachment handling
2. `server/routes.ts` - Added 2 new API endpoints and updated LLM configuration

### Frontend Files:
1. `client/src/components/sdlc/test-plan-generation-modal.tsx` - Complete redesign with tabs and ADO support

### Documentation:
1. `docs/TEST_PLAN_GENERATION_WITH_ADO_BRD.md` - This document

## Environment Variables

### Required for Anthropic (Claude):
```env
ANTHROPIC_AZURE_ENDPOINT=https://your-anthropic-endpoint.openai.azure.com/openai/deployments/your-deployment/chat/completions
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_MODEL_NAME=claude-3-5-sonnet-20241022
ANTHROPIC_MODEL_VERSION=2023-06-01
SELECTED_LLM=ANTHROPIC
```

### Required for Azure OpenAI:
```env
AZURE_OPENAI_API_KEY=your-azure-openai-api-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_API_VERSION=2024-02-01
SELECTED_LLM=AZURE_OPENAI
```

## LLM Model Information

The system uses the `prompt_test_plan_generation.ts` prompt which generates comprehensive test plans including:

1. Executive Summary and Objectives
2. Test Scope and Coverage
3. Comprehensive Test Strategy
4. Test Environment Architecture
5. Detailed Test Schedule and Milestones
6. Entry and Exit Criteria
7. Team Structure and Responsibilities
8. Risk Assessment and Mitigation
9. Defect Management Framework
10. Test Metrics and Reporting
11. Tools and Technology Stack
12. Quality Assurance and Best Practices
13. Assumptions and Dependencies
14. Approval and Sign-off Process

**Target Output**: 8-9 pages (4000-5000 words) of comprehensive test plan documentation.

## Benefits

1. **Seamless ADO Integration** - Direct access to BRD documents stored in ADO work items
2. **Multiple Sources** - Flexibility to use local, ADO, or manual BRD input
3. **Proper LLM Configuration** - Uses the configured LLM (Anthropic or Azure OpenAI) consistently
4. **Attachment Support** - Handles DOCX and other file formats
5. **Security** - PAT tokens are encrypted and never exposed to client
6. **User-Friendly** - Simple tab-based interface for source selection

## Future Enhancements

1. **Save Test Plans** - Implement database storage for generated test plans
2. **Test Plan History** - Track versions and changes to test plans
3. **ADO Sync** - Push generated test plans back to ADO as work items
4. **Multi-Attachment** - Support combining multiple BRD documents
5. **Custom Prompts** - Allow users to customize test plan generation prompts
6. **Test Case Generation** - Automatically generate test cases from test plan
7. **Traceability Matrix** - Link test plan sections to BRD requirements

## Troubleshooting

### Issue: No BRD work items found
- **Solution**: Ensure work items are tagged with "BRD" or have "BRD" in the title
- Check that work items are not in "Removed" state

### Issue: Attachment download fails
- **Solution**: Verify PAT token has necessary permissions
- Check network connectivity to ADO

### Issue: LLM not configured error
- **Solution**: Set up either Anthropic or Azure OpenAI environment variables
- Verify API keys are valid

### Issue: Test plan generation fails
- **Solution**: Check BRD content is valid and not empty
- Verify LLM service is accessible
- Check token limits (BRD might be too large)

## Support

For issues or questions:
1. Check logs for detailed error messages
2. Verify environment configuration
3. Test with manual BRD input first to isolate issues
4. Ensure ADO PAT token has correct permissions:
   - Work Items (Read)
   - Analytics (Read) - Optional but recommended
