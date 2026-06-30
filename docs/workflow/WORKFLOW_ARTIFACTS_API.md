# Workflow Artifacts Save Feature

## Overview

The Workflow Artifacts Save Feature allows users to persist all generated artifacts (epics, features, user stories, personas, wiki pages, and Figma guidelines) from Step 2 of the workflow to the database. This enables reusability of generated artifacts across different pages and workflows within the application.

## Architecture

### Database Schema

#### 1. `workflow_artifacts` Table
Stores the main artifact collection with all generated items.

**Columns:**
- `id` (VARCHAR 36, PRIMARY KEY) - Unique identifier
- `session_id` (VARCHAR 36, NOT NULL) - Workflow session identifier
- `project_id` (VARCHAR 36) - Optional project association
- `requirement` (LONGTEXT, NOT NULL) - Original user requirement
- `guidelines` (LONGTEXT) - Design/compliance guidelines
- `epics` (JSON, NOT NULL) - Array of generated epics
- `features` (JSON, NOT NULL) - Array of generated features
- `user_stories` (JSON, NOT NULL) - Array of generated user stories
- `personas` (JSON, NOT NULL) - Array of personas
- `wiki_pages` (JSON, NOT NULL) - Array of wiki documentation pages
- `figma_guidelines` (LONGTEXT) - Figma design guidelines
- `status` (VARCHAR 50, DEFAULT 'draft') - Artifact status (draft, saved, published)
- `created_by` (VARCHAR 100) - User who created the artifacts
- `created_at` (TIMESTAMP, DEFAULT NOW) - Creation timestamp
- `updated_at` (TIMESTAMP, DEFAULT NOW ON UPDATE) - Last update timestamp

**Indexes:**
- `idx_session_id` on `session_id`
- `idx_project_id` on `project_id`
- `idx_status` on `status`
- `idx_created_at` on `created_at`

#### 2. `workflow_subtasks` Table
Stores individual subtasks for better querying and management.

**Columns:**
- `id` (VARCHAR 36, PRIMARY KEY) - Unique identifier
- `artifact_id` (VARCHAR 36, NOT NULL, FK) - References workflow_artifacts.id
- `user_story_id` (VARCHAR 36, NOT NULL) - User story identifier
- `title` (TEXT, NOT NULL) - Subtask title
- `description` (TEXT, NOT NULL) - Subtask description
- `estimated_hours` (INT, DEFAULT 0) - Time estimation
- `status` (VARCHAR 50, DEFAULT 'pending') - Subtask status (pending, in-progress, completed)
- `assigned_to` (VARCHAR 100) - Assignee
- `created_at` (TIMESTAMP, DEFAULT NOW) - Creation timestamp
- `updated_at` (TIMESTAMP, DEFAULT NOW ON UPDATE) - Last update timestamp

**Indexes:**
- `idx_artifact_id` on `artifact_id`
- `idx_user_story_id` on `user_story_id`
- `idx_status` on `status`

**Foreign Keys:**
- `artifact_id` references `workflow_artifacts(id)` ON DELETE CASCADE

### API Endpoints

#### 1. Save Artifacts
**Endpoint:** `POST /api/workflow/save-artifacts`

**Purpose:** Save or update workflow artifacts to the database.

**Request Body:**
```typescript
{
  sessionId: string;          // Required - Workflow session ID
  projectId?: string;         // Optional - Project association
  requirement: string;        // Required - User requirement text
  guidelines?: string;        // Optional - Design guidelines
  epics: Epic[];             // Required - At least one epic
  features: Feature[];       // Generated features
  userStories: UserStory[];  // Generated user stories
  personas: Persona[];       // Generated personas
  wikiPages: WikiPage[];     // Generated wiki pages
  figmaGuidelines?: string;  // Optional - Figma guidelines
  subtasks?: Array<{         // Optional - Extracted subtasks
    userStoryId: string;
    title: string;
    description: string;
    estimatedHours: number;
    status: string;
    assignedTo?: string;
  }>;
  createdBy?: string;        // Optional - Creator identifier
}
```

**Response (Success - 200):**
```typescript
{
  success: true;
  message: "Artifacts saved successfully";
  artifact: WorkflowArtifact; // Complete saved artifact
}
```

**Response (Error - 400):**
```typescript
{
  error: string;  // Error message
}
```

**Behavior:**
- If artifact exists for `sessionId`: Updates existing record
- If artifact doesn't exist: Creates new record
- Subtasks are replaced on update (old ones deleted, new ones inserted)
- Returns complete saved artifact with generated ID

#### 2. Get Artifacts
**Endpoint:** `GET /api/workflow/artifacts`

**Purpose:** Retrieve workflow artifacts with filtering and pagination.

**Query Parameters:**
- `sessionId` (string, optional) - Filter by session ID
- `projectId` (string, optional) - Filter by project ID
- `status` (string, optional) - Filter by status (draft, saved, published)
- `page` (number, default: 1) - Page number
- `limit` (number, default: 10) - Items per page

**Response (Success - 200):**
```typescript
{
  success: true;
  artifacts: WorkflowArtifact[];  // Array of artifacts
  subtasks?: WorkflowSubtask[];   // Included if sessionId filter used
  pagination: {
    page: number;        // Current page
    limit: number;       // Items per page
    total: number;       // Total count
    totalPages: number;  // Total pages
  }
}
```

**Example Requests:**
```bash
# Get all artifacts (paginated)
GET /api/workflow/artifacts?page=1&limit=10

# Get artifacts for specific session (includes subtasks)
GET /api/workflow/artifacts?sessionId=abc-123-def-456

# Get artifacts for specific project
GET /api/workflow/artifacts?projectId=proj-789&status=saved

# Get saved artifacts only
GET /api/workflow/artifacts?status=saved&page=1&limit=20
```

### Frontend Implementation

#### Context Updates (workflow-context.tsx)

**New State:**
```typescript
isSaving: boolean;                    // Save operation in progress
setIsSaving: (saving: boolean) => void;
savedArtifactId: string | null;       // ID of saved artifact
setSavedArtifactId: (id: string | null) => void;
```

#### Step 3 Component Updates (step3-devops-push.tsx)

**New Features:**
1. **Save Button** - Saves all artifacts to database
2. **Save Success Indicator** - Shows confirmation when saved
3. **Session ID Display** - Shows session ID for reference

**UI Flow:**
1. User generates artifacts in Step 2
2. User navigates to Step 3
3. User clicks "Save Artifacts to Database" button
4. System saves all artifacts with current session ID
5. Success message displays with session ID
6. User can then optionally push to Azure DevOps

**Save Handler:**
```typescript
const handleSave = async () => {
  // Validation
  if (epics.length === 0) {
    toast.error("No artifacts to save");
    return;
  }

  setIsSaving(true);
  
  try {
    // Extract subtasks from user stories
    const subtasks = userStories.flatMap((story) =>
      (story.subtasks || []).map((subtaskTitle) => ({
        userStoryId: story.id,
        title: subtaskTitle,
        description: `Subtask for ${story.title}`,
        estimatedHours: 4,
        status: "pending",
      }))
    );

    // Save to database
    const res = await apiRequest("POST", "/api/workflow/save-artifacts", {
      sessionId,
      requirement,
      guidelines,
      epics,
      features,
      userStories,
      personas,
      wikiPages,
      figmaGuidelines: guidelines,
      subtasks,
    });

    const data = await res.json();
    
    if (data.success) {
      setSaveSuccess(true);
      setSavedArtifactId(data.artifact.id);
      toast.success("Artifacts saved successfully!");
    }
  } catch (error) {
    toast.error("Failed to save artifacts");
  } finally {
    setIsSaving(false);
  }
};
```

## Usage Examples

### Saving Artifacts

```typescript
// From Step 3 component
const handleSave = async () => {
  await apiRequest("POST", "/api/workflow/save-artifacts", {
    sessionId: "550e8400-e29b-41d4-a716-446655440000",
    requirement: "Build an insurance claims management system",
    guidelines: "Follow enterprise design patterns...",
    epics: [...],
    features: [...],
    userStories: [...],
    personas: [...],
    wikiPages: [...],
    figmaGuidelines: "Use Material Design components...",
    subtasks: [...],
  });
};
```

### Retrieving Artifacts

```typescript
// Get artifacts for current session
const response = await fetch(
  `/api/workflow/artifacts?sessionId=${sessionId}`
);
const { artifacts, subtasks } = await response.json();

// Get all saved artifacts with pagination
const response = await fetch(
  '/api/workflow/artifacts?status=saved&page=1&limit=20'
);
const { artifacts, pagination } = await response.json();
```

### Using Saved Artifacts in SDLC

```typescript
// Fetch artifacts for project initialization
const response = await fetch(
  `/api/workflow/artifacts?projectId=${projectId}&status=saved`
);
const { artifacts } = await response.json();

// Use artifacts to populate SDLC phases
artifacts.forEach(artifact => {
  // Create epics in planning phase
  artifact.epics.forEach(epic => createSDLCEpic(epic));
  
  // Create user stories in requirements phase
  artifact.userStories.forEach(story => createBacklogItem(story));
  
  // Add wiki pages to documentation
  artifact.wikiPages.forEach(page => createWikiPage(page));
});
```

## Database Migration

Run the migration file to create the required tables:

```bash
# MySQL/MariaDB
mysql -u username -p database_name < migrations/manual/add-workflow-artifacts-migration.sql

# Or using a migration tool
npm run migrate:artifacts
```

## Benefits

1. **Reusability** - Artifacts can be used across multiple workflows and pages
2. **Traceability** - Complete audit trail with timestamps and session IDs
3. **Flexibility** - Filter and paginate artifacts as needed
4. **Integration** - Easily integrate saved artifacts with SDLC, conversational UI, etc.
5. **Persistence** - No data loss between sessions
6. **Scalability** - Efficient indexing for large-scale deployments

## Security Considerations

1. **Authentication** - Implement user authentication before production use
2. **Authorization** - Add role-based access control for artifact management
3. **Data Validation** - All inputs are validated on the backend
4. **SQL Injection** - Protected through parameterized queries (Drizzle ORM)
5. **XSS Prevention** - JSON data is properly escaped

## Future Enhancements

1. **Versioning** - Track artifact versions over time
2. **Sharing** - Share artifacts between users/teams
3. **Templates** - Create artifact templates from saved items
4. **Export** - Export artifacts to various formats (PDF, Word, etc.)
5. **Collaboration** - Real-time collaborative editing
6. **Analytics** - Track artifact usage and patterns

## Testing

### Unit Tests
```typescript
describe('Save Artifacts API', () => {
  it('should save new artifacts', async () => {
    const response = await request(app)
      .post('/api/workflow/save-artifacts')
      .send({ sessionId: 'test-123', requirement: '...', epics: [...] });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should update existing artifacts', async () => {
    // Test update logic
  });

  it('should validate required fields', async () => {
    // Test validation
  });
});
```

### Integration Tests
```typescript
describe('Workflow Artifacts Integration', () => {
  it('should save and retrieve artifacts', async () => {
    // Save artifacts
    const saveResponse = await saveArtifacts(testData);
    const artifactId = saveResponse.artifact.id;
    
    // Retrieve artifacts
    const getResponse = await getArtifacts({ sessionId: testData.sessionId });
    
    expect(getResponse.artifacts).toHaveLength(1);
    expect(getResponse.artifacts[0].id).toBe(artifactId);
  });
});
```

## Support

For issues or questions:
1. Check the TROUBLESHOOTING.md guide
2. Review the API documentation above
3. Contact the development team
