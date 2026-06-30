# Azure DevOps (ADO) Integration - Complete API and Feature Documentation

## Overview
DevX integrates extensively with Azure DevOps (ADO) to provide end-to-end SDLC management, from requirements to deployment. This document details all ADO-related APIs, features, and operations performed during navigation.

---

## Table of Contents
1. [Configuration & Settings APIs](#configuration--settings-apis)
2. [Project Management APIs](#project-management-apis)
3. [Work Items & Backlog APIs](#work-items--backlog-apis)
4. [Repository & Code Management APIs](#repository--code-management-apis)
5. [Builds & Pipelines APIs](#builds--pipelines-apis)
6. [Releases & Deployment APIs](#releases--deployment-apis)
7. [Testing APIs](#testing-apis)
8. [Monitoring & Analytics APIs](#monitoring--analytics-apis)
9. [Golden Repositories APIs](#golden-repositories-apis)
10. [Design & Figma Integration APIs](#design--figma-integration-apis)
11. [AI Agent Integration](#ai-agent-integration)
12. [Navigation Operations](#navigation-operations)

---

## 1. Configuration & Settings APIs

### 1.1 Get ADO Settings
**Endpoint:** `GET /api/ado-settings`

**Purpose:** Retrieves Azure DevOps configuration settings (organization URL, project name, repository, branch, API version, PAT status).

**Features:**
- Returns ADO settings without exposing encrypted PAT token
- Shows PAT configuration status (`patConfigured` boolean)
- Used for checking if ADO is configured before operations

**Response:**
```json
{
  "id": "settings-id",
  "organizationUrl": "https://dev.azure.com/org",
  "projectName": "ProjectName",
  "repository": "repo-name",
  "branch": "main",
  "apiVersion": "7.0",
  "patConfigured": true,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

---

### 1.2 Create ADO Settings
**Endpoint:** `POST /api/ado-settings`

**Purpose:** Creates new Azure DevOps configuration.

**Request Body:**
```json
{
  "organizationUrl": "https://dev.azure.com/org",
  "projectName": "ProjectName",
  "repository": "repo-name",
  "branch": "main",
  "patToken": "encrypted-pat",
  "apiVersion": "7.0"
}
```

**Features:**
- Stores encrypted PAT token securely
- Validates required fields (organizationUrl, projectName, apiVersion)
- Used in Settings page for initial ADO setup

---

### 1.3 Update ADO Settings
**Endpoint:** `PUT /api/ado-settings/:id`

**Purpose:** Updates existing Azure DevOps configuration.

**Features:**
- Updates organization URL, project name, repository, branch, PAT token
- Only updates fields that are provided
- Maintains encryption for PAT tokens

---

### 1.4 Test ADO Connection
**Endpoint:** `POST /api/ado-settings/test-connection`

**Purpose:** Tests connectivity to Azure DevOps using configured PAT.

**Features:**
- Validates PAT token by fetching projects from ADO
- Returns connection status and project count
- Used for verifying credentials before operations

**Response:**
```json
{
  "success": true,
  "message": "Successfully connected to Azure DevOps",
  "projectCount": 5
}
```

---

### 1.5 Get ADO Repositories (Settings)
**Endpoint:** `GET /api/ado-settings/repositories`

**Purpose:** Fetches all repositories from configured Azure DevOps project.

**Features:**
- Lists all repositories in the configured project
- Filters by project name if specified
- Used in Settings page for repository selection

---

### 1.6 Get ADO Backlog (Settings)
**Endpoint:** `GET /api/ado-settings/backlog`

**Purpose:** Fetches backlog items (work items) from configured ADO project.

**Features:**
- Retrieves epics, features, user stories, tasks, bugs
- Used for backlog management in Settings

---

### 1.7 Get ADO Configuration for Project
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado-config`

**Purpose:** Gets Azure DevOps configuration for a specific SDLC project.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Works with both SDLC project IDs and ADO project IDs
- Falls back to environment variables if no settings found
- Returns configuration status and credentials

**Response:**
```json
{
  "hasConfig": true,
  "organization": "org-name",
  "project": "project-name",
  "organizationUrl": "https://dev.azure.com/org"
}
```

---

## 2. Project Management APIs

### 2.1 Get ADO Projects
**Endpoint:** `GET /api/ado-projects`

**Purpose:** Lists all Azure DevOps projects from configured organizations.

**Features:**
- Fetches projects from all configured artifact organizations
- Returns project details (id, name, description, organization)
- Used in project selection dropdowns

**Response:**
```json
[
  {
    "id": "project-id",
    "name": "ProjectName",
    "description": "Project description",
    "organization": "org-name",
    "organizationUrl": "https://dev.azure.com/org",
    "artifactOrgId": "org-id"
  }
]
```

---

### 2.2 Update ADO Project
**Endpoint:** `PATCH /api/ado-projects/:projectId`

**Purpose:** Updates ADO project metadata.

**Features:**
- Updates project name, description, organization mapping
- Maintains relationships with SDLC projects

---

### 2.3 Delete ADO Project
**Endpoint:** `DELETE /api/ado-projects/:projectId`

**Purpose:** Removes ADO project from DevX (does not delete from ADO).

**Features:**
- Soft delete - marks project as deleted
- Preserves historical data

---

### 2.4 Get SDLC Project by ADO Project Name
**Endpoint:** `GET /api/sdlc/projects/by-ado-project/:adoProjectName`

**Purpose:** Finds or creates SDLC project from ADO project name.

**Features:**
- Auto-creates SDLC project if it doesn't exist
- Links ADO project to SDLC project
- Used when navigating from ADO to DevX

---

### 2.5 Get SDLC Project Details by ADO Identifier
**Endpoint:** `GET /api/sdlc/projects/by-ado/:identifier/details`

**Purpose:** Gets SDLC project details using ADO project ID or name.

**Features:**
- Supports both ADO project ID and name as identifier
- Returns full project details including ADO mapping
- Used for project resolution in navigation

---

### 2.6 Sync SDLC Project from ADO
**Endpoint:** `POST /api/sdlc/projects/by-ado/:identifier/sync`

**Purpose:** Creates or syncs SDLC project from existing Azure DevOps project.

**Request Body:**
```json
{
  "adoProjectUrl": "https://dev.azure.com/org/project",
  "name": "Project Name",
  "description": "Description"
}
```

**Features:**
- Creates SDLC project linked to ADO project
- Fetches ADO project details (teams, members)
- Sets up initial project structure
- Used for onboarding existing ADO projects into DevX

---

### 2.7 Create Azure ADO Project
**Endpoint:** `POST /api/create-azure-ado-project`

**Purpose:** Creates a new project in Azure DevOps.

**Request Body:**
```json
{
  "orgName": "organization-name",
  "projectName": "Project Name",
  "description": "Project description",
  "processTemplate": "Agile",
  "sourceControlType": "Git",
  "visibility": "private"
}
```

**Features:**
- Creates new ADO project via Azure DevOps REST API
- Configures process template (Agile, Scrum, CMMI)
- Sets up source control (Git or TFVC)
- Returns created project details

---

## 3. Work Items & Backlog APIs

### 3.1 Get User Stories
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/user-stories`

**Purpose:** Fetches all user stories from Azure DevOps project.

**Features:**
- Retrieves user stories with full details (title, description, state, assigned to, story points)
- Uses artifact organizations for authentication
- Returns formatted user story data

---

### 3.2 Update Work Item
**Endpoint:** `PATCH /api/sdlc/projects/:projectId/ado/workitems/:workItemId`

**Purpose:** Updates an Azure DevOps work item.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `artifactOrgId` (optional): Artifact organization ID
- `organizationUrl` (optional): Organization URL

**Request Body:**
```json
{
  "title": "Updated Title",
  "description": "Updated description",
  "status": "Active",
  "priority": "high",
  "acceptanceCriteria": "Criteria text",
  "assignedTo": "user@example.com",
  "storyPoints": 5
}
```

**Features:**
- Maps form fields to ADO field names (System.Title, System.Description, System.State, etc.)
- Resolves user identities for assignment
- Supports priority mapping (low/medium/high/critical to numbers)
- Updates work items in real-time

---

### 3.3 Get Backlog Context
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/backlog-context`

**Purpose:** Fetches comprehensive backlog information including state counts, developer assignments, and velocity metrics.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns state counts for epics, features, user stories
- Provides developer assignment statistics
- Calculates velocity metrics (last 7 days, last 30 days)
- Shows story points distribution
- Used in Development phase dashboard

**Response:**
```json
{
  "availableStates": ["New", "Active", "Resolved", "Closed"],
  "stateCounts": {
    "New": {
      "epics": 5,
      "features": 10,
      "userStories": 25,
      "total": 40
    }
  },
  "developerAssignments": [
    {
      "displayName": "John Doe",
      "totalStories": 10,
      "storiesByState": {"Active": 5, "Resolved": 5},
      "totalStoryPoints": 50,
      "completedStoryPoints": 25
    }
  ],
  "velocity": {
    "last7Days": 20,
    "last30Days": 80,
    "totalStoryPoints": 200,
    "completedStoryPoints": 100,
    "completionRate": 50
  }
}
```

---

### 3.4 Get Epics
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/epics`

**Purpose:** Fetches all epics from Azure DevOps project.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Retrieves epics with hierarchy information
- Includes epic details (title, description, state, work items)
- Used in backlog management and epic views

---

### 3.5 Get Sprints
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/sprints`

**Purpose:** Fetches all sprints/iterations from Azure DevOps project.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Lists all sprints with dates and status
- Includes sprint capacity and velocity
- Used in sprint planning and tracking

---

### 3.6 Get Sprint Data
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/sprint-data`

**Purpose:** Fetches detailed sprint information including work items and burndown data.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `sprintId` (optional): Specific sprint ID

**Features:**
- Returns sprint work items (user stories, tasks, bugs)
- Provides burndown chart data
- Shows sprint capacity and remaining work
- Used in sprint dashboards

---

### 3.7 Get ADO Requirements
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado-requirements`

**Purpose:** Fetches requirements linked to ADO work items.

**Features:**
- Links BRD requirements to ADO work items
- Provides traceability between requirements and implementation
- Used in requirements management

---

### 3.8 Push to ADO
**Endpoint:** `POST /api/sdlc/projects/:projectId/push-to-ado`

**Purpose:** Pushes epics, features, and user stories from DevX to Azure DevOps.

**Request Body:**
```json
{
  "epics": [...],
  "features": [...],
  "userStories": [...],
  "phaseNumber": 3,
  "artifactId": "workflow-artifact-id",
  "config": {
    "organization": "org-name",
    "project": "project-name",
    "pat": "pat-token"
  },
  "brdId": "brd-id",
  "requirementIds": ["req-id-1", "req-id-2"]
}
```

**Features:**
- Creates work items in Azure DevOps (Epics, Features, User Stories)
- Maintains hierarchy (Epic -> Feature -> User Story)
- Links work items to personas
- Updates workflow artifacts with ADO work item IDs
- Handles duplicate detection (skips items that already exist)
- Maintains traceability to BRD requirements
- Returns created and skipped items with ADO work item IDs

**Response:**
```json
{
  "success": true,
  "workItemIds": [123, 124, 125],
  "createdItems": [
    {
      "id": "epic-id",
      "adoWorkItemId": 123,
      "type": "epic"
    }
  ],
  "skippedItems": [
    {
      "id": "epic-id",
      "adoWorkItemId": 456,
      "reason": "already_exists"
    }
  ],
  "message": "Successfully pushed 10 items to Azure DevOps"
}
```

---

### 3.9 Update ADO Item
**Endpoint:** `PATCH /api/sdlc/projects/:projectId/ado-items/:workItemId`

**Purpose:** Updates a work item that was pushed from DevX to ADO.

**Features:**
- Updates work item in both DevX and ADO
- Maintains synchronization between systems
- Updates workflow artifacts with latest ADO data

---

### 3.10 Delete ADO Item
**Endpoint:** `DELETE /api/sdlc/projects/:projectId/ado-items/:workItemId`

**Purpose:** Deletes a work item from ADO (and optionally from DevX).

**Query Parameters:**
- `deleteFromAdo` (optional): Whether to delete from ADO (default: true)
- `deleteFromDevX` (optional): Whether to delete from DevX (default: false)

**Features:**
- Removes work item from Azure DevOps
- Optionally removes from DevX workflow artifacts
- Maintains data integrity

---

### 3.11 Get Epics (Legacy)
**Endpoint:** `GET /api/ado/get_epics/:projectName?`

**Purpose:** Fetches epics from Azure DevOps (legacy endpoint, still used in some flows).

**Query Parameters:**
- `projectId` (optional): SDLC project ID
- `adoProjectId` (optional): ADO project ID
- `organization` or `organizationUrl` (optional): Organization URL
- `projectName` (optional): Project name
- `artifactOrgId` (optional): Artifact organization ID

**Features:**
- Multiple resolution strategies (projectId, adoProjectId, projectName, artifactOrgId)
- Returns epics with Figma links if available
- Used in Design phase for epic selection

---

### 3.12 Get User Stories for Epic
**Endpoint:** `GET /api/ado/epics/:epicId/user-stories`

**Purpose:** Fetches all user stories linked to a specific epic.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `artifactOrgId` (optional): Artifact organization ID

**Features:**
- Returns user stories with epic relationship
- Includes story details (title, description, state, story points)
- Used in epic detail views

---

### 3.13 Create Work Item
**Endpoint:** `POST /api/ado/create-work-item`

**Purpose:** Creates a new work item directly in Azure DevOps.

**Request Body:**
```json
{
  "workItemType": "User Story",
  "title": "Work Item Title",
  "description": "Description",
  "project": "project-name",
  "organization": "org-name"
}
```

**Features:**
- Creates work items of any type (Epic, Feature, User Story, Task, Bug)
- Sets initial fields and state
- Returns created work item ID

---

### 3.14 Resolve Assignee
**Endpoint:** `POST /api/ado/resolve-assignee`

**Purpose:** Resolves user identity for work item assignment.

**Request Body:**
```json
{
  "userEmail": "user@example.com",
  "organization": "org-name"
}
```

**Features:**
- Resolves email to ADO user identity
- Returns user descriptor for assignment
- Used when assigning work items to users

---

## 4. Repository & Code Management APIs

### 4.1 Get Repositories
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/repositories`

**Purpose:** Lists all Git repositories in the Azure DevOps project.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns repository list with metadata (id, name, defaultBranch, webUrl, size)
- Used in Development phase for repository selection
- Shows repository details in UI

**Response:**
```json
[
  {
    "id": "repo-id",
    "name": "RepositoryName",
    "defaultBranch": "refs/heads/main",
    "remoteUrl": "https://dev.azure.com/...",
    "webUrl": "https://dev.azure.com/...",
    "size": 1024000
  }
]
```

---

### 4.2 Get Repository Branches
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/repositories/:repositoryId/branches`

**Purpose:** Lists all branches in a specific repository.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns branch list with metadata (name, objectId, creator, date)
- Shows branch protection status
- Used in Development phase for branch selection

---

### 4.3 Get Repository Commits
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/repositories/:repositoryId/commits`

**Purpose:** Fetches recent commits from a repository.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `limit` (optional): Number of commits to return (default: 20)
- `branch` (optional): Branch name

**Features:**
- Returns commit history with author, message, date
- Supports pagination via limit parameter
- Used in Development phase to show recent activity

**Response:**
```json
[
  {
    "commitId": "abc123def456...",
    "comment": "Fix bug in login flow",
    "author": {
      "name": "John Doe",
      "email": "john@example.com",
      "date": "2024-01-15T14:30:00Z"
    }
  }
]
```

---

### 4.4 Get Golden Repositories
**Endpoint:** `GET /api/ado/golden-repositories`

**Purpose:** Fetches all repositories configured as "golden repositories" (template repositories).

**Features:**
- Returns repositories with detailed metadata
- Includes commit count, contributors, recent commits
- Shows last commit information
- Used in Golden Repos page for template selection

**Response:**
```json
{
  "repositories": [
    {
      "id": "repo-id",
      "name": "RepositoryName",
      "organizationName": "Organization",
      "description": "Description",
      "webUrl": "https://dev.azure.com/...",
      "defaultBranch": "main",
      "size": 1024000,
      "commitCount": 150,
      "contributors": ["User1", "User2"],
      "contributorCount": 2,
      "lastCommit": {
        "author": "John Doe",
        "message": "Latest commit",
        "date": "2024-01-15T14:30:00Z"
      },
      "recentCommits": [...]
    }
  ],
  "count": 5
}
```

---

### 4.5 Get Repository Tree
**Endpoint:** `GET /api/ado/repository/:repositoryId/tree`

**Purpose:** Fetches file and folder structure of a repository.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `branch` (optional): Branch name (default: default branch)
- `path` (optional): Subdirectory path

**Features:**
- Returns hierarchical file/folder structure
- Shows file sizes and types
- Supports navigation into subdirectories
- Used in Golden Repo preview and file browser

---

### 4.6 Get Repository File
**Endpoint:** `GET /api/ado/repository/:repositoryId/file`

**Purpose:** Fetches content of a specific file from repository.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `path` (required): File path
- `branch` (optional): Branch name

**Features:**
- Returns file content (text files)
- Supports various file types
- Used in file viewer and code preview

---

### 4.7 Download Repository File
**Endpoint:** `GET /api/ado/repository/:repositoryId/download`

**Purpose:** Downloads a file from repository as binary.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `path` (required): File path
- `branch` (optional): Branch name

**Features:**
- Returns file as download stream
- Supports binary files
- Used for downloading files from golden repositories

---

### 4.8 Upload File to Repository
**Endpoint:** `POST /api/ado/repository/:repositoryId/upload`

**Purpose:** Uploads a file to repository.

**Request Body:** Multipart form data with file

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `path` (required): Target file path
- `branch` (optional): Branch name
- `commitMessage` (optional): Commit message

**Features:**
- Creates or updates files in repository
- Creates commit with message
- Supports file creation and updates
- Used in Golden Repo file management

---

### 4.9 Delete File from Repository
**Endpoint:** `POST /api/ado/repository/:repositoryId/delete`

**Purpose:** Deletes a file from repository.

**Request Body:**
```json
{
  "path": "path/to/file",
  "branch": "main",
  "commitMessage": "Delete file"
}
```

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Deletes file and creates commit
- Supports file deletion from any branch
- Used in Golden Repo file management

---

### 4.10 Initialize Repository
**Endpoint:** `POST /api/ado/repository/:repositoryId/initialize`

**Purpose:** Initializes a repository with initial files (README, .gitignore, etc.).

**Request Body:**
```json
{
  "template": "default",
  "projectType": "web-app"
}
```

**Features:**
- Creates initial repository structure
- Adds template files based on project type
- Sets up initial commit
- Used when creating new projects from golden repos

---

### 4.11 Fork Repository
**Endpoint:** `POST /api/ado/fork-repository`

**Purpose:** Forks a golden repository to create a new project repository.

**Request Body:**
```json
{
  "sourceRepoId": "source-repo-id",
  "targetProjectName": "NewProject",
  "targetRepositoryName": "new-repo-name"
}
```

**Features:**
- Creates new repository from golden repo template
- Copies all files and history
- Sets up new project structure
- Used in project creation from templates

---

## 5. Builds & Pipelines APIs

### 5.1 Get Builds
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/builds`

**Purpose:** Fetches build history and status.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `top` (optional): Number of builds to return (default: 50)
- `definitions` (optional): Build definition IDs (comma-separated)
- `statusFilter` (optional): Filter by status (all, completed, inProgress, cancelled, notStarted)

**Features:**
- Returns build list with status, result, duration, build number
- Includes build definition information
- Shows build timeline and logs links
- Used in Builds dashboard and monitoring

**Response:**
```json
{
  "value": [
    {
      "id": 123,
      "buildNumber": "20240115.1",
      "status": "completed",
      "result": "succeeded",
      "startTime": "2024-01-15T10:00:00Z",
      "finishTime": "2024-01-15T10:05:00Z",
      "definition": {
        "id": 1,
        "name": "CI Build"
      },
      "sourceBranch": "refs/heads/main"
    }
  ],
  "count": 50
}
```

---

### 5.2 Get Pipelines
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/pipelines`

**Purpose:** Lists all build pipelines (definitions) in the project.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns pipeline definitions with metadata
- Shows pipeline status and last build information
- Used in pipeline selection and management

---

### 5.3 Get Build Timeline
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/builds/:buildId/timeline`

**Purpose:** Fetches detailed build timeline with stages and tasks.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns build execution timeline
- Shows stages, jobs, and tasks with durations
- Identifies failed tasks
- Used in build analysis and debugging

---

## 6. Releases & Deployment APIs

### 6.1 Get Release Definitions
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/release-definitions`

**Purpose:** Lists all release pipelines (definitions) in the project.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns release pipeline definitions
- Shows environments and deployment stages
- Used in release management dashboard

---

### 6.2 Get Releases
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/releases`

**Purpose:** Fetches release history.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `definitionId` (optional): Filter by release definition ID
- `top` (optional): Number of releases to return (default: 100)
- `statusFilter` (optional): Filter by status

**Features:**
- Returns release list with status, environments, deployment status
- Shows release version and creation date
- Includes deployment history per environment
- Used in Releases dashboard

**Response:**
```json
[
  {
    "id": 123,
    "name": "Release-20240115.1",
    "status": "active",
    "createdOn": "2024-01-15T10:00:00Z",
    "createdBy": {
      "displayName": "John Doe"
    },
    "environments": [
      {
        "id": 1,
        "name": "Development",
        "status": "succeeded",
        "deploySteps": [...]
      }
    ]
  }
]
```

---

### 6.3 Get Specific Release
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/releases/:releaseId`

**Purpose:** Fetches detailed information about a specific release.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns complete release details
- Shows all environments and their deployment status
- Includes release artifacts and approvals
- Used in release detail views

---

### 6.4 Get Release Details (Extended)
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/releases/:releaseId/details`

**Purpose:** Fetches extended release information including deployment history.

**Features:**
- Returns detailed release information
- Includes full deployment history
- Shows approval status and comments
- Used in release management UI

---

### 6.5 Create Release
**Endpoint:** `POST /api/sdlc/projects/:projectId/ado/releases`

**Purpose:** Creates a new release from a release definition.

**Request Body:**
```json
{
  "definitionId": 123,
  "description": "Release description",
  "createdBy": "user-id",
  "createdByName": "User Name"
}
```

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Creates release in Azure DevOps
- Stores user information for tracking
- Returns created release details
- Used in release creation workflow

---

### 6.6 Trigger Release
**Endpoint:** `POST /api/sdlc/projects/:projectId/ado/trigger-release`

**Purpose:** Triggers a new release (alias for create release with additional tracking).

**Request Body:**
```json
{
  "definitionId": 123,
  "description": "Release description",
  "triggeredBy": "user-id",
  "triggeredByName": "User Name"
}
```

**Features:**
- Creates and triggers release
- Tracks who triggered the release
- Used in deployment workflows

---

### 6.7 Deploy Release
**Endpoint:** `POST /api/sdlc/projects/:projectId/ado/releases/:releaseId/deploy`

**Purpose:** Triggers deployment of a release to a specific environment.

**Request Body:**
```json
{
  "environmentId": 456,
  "comment": "Deployment comment"
}
```

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Triggers deployment to environment
- Handles deployment state validation
- Returns deployment result
- Used in deployment management

---

### 6.8 Get Deployments
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/releases/:releaseId/deployments`

**Purpose:** Fetches all deployments for a specific release.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns deployment history per environment
- Shows deployment status, duration, and logs
- Used in deployment tracking

---

### 6.9 Get Deployment Summary
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/deployment-summary`

**Purpose:** Fetches deployment statistics and recent releases.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `daysBack` (optional): Number of days to look back (default: 30)

**Features:**
- Returns deployment statistics (total, successful, failed, pending)
- Calculates success/failure rates
- Shows recent releases timeline
- Used in deployment dashboard overview

**Response:**
```json
{
  "statistics": {
    "total": 100,
    "succeeded": 85,
    "failed": 10,
    "pending": 5,
    "successRate": 85
  },
  "recentReleases": [...],
  "trends": {
    "last7Days": 20,
    "last30Days": 100
  }
}
```

---

### 6.10 Get Release Artifacts
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/release-artifacts`

**Purpose:** Fetches artifacts associated with releases.

**Features:**
- Returns build artifacts linked to releases
- Shows artifact versions and sources
- Used in release artifact management

---

### 6.11 Get Approvals
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/approvals`

**Purpose:** Fetches pending, approved, or rejected approval requests.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `status` (optional): Filter by status (pending, approved, rejected)

**Features:**
- Returns approval requests for releases
- Shows approver information and comments
- Used in approval management

---

### 6.12 Update Approval
**Endpoint:** `PATCH /api/sdlc/projects/:projectId/ado/approvals/:approvalId`

**Purpose:** Approves or rejects a release approval.

**Request Body:**
```json
{
  "status": "approved",
  "comments": "Approval comments"
}
```

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Approves or rejects release approvals
- Adds comments to approval
- Triggers deployment if approved
- Used in approval workflows

---

### 6.13 Get Deployments (General)
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/deployments`

**Purpose:** Fetches all deployments across all releases.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `top` (optional): Number of deployments to return

**Features:**
- Returns deployment history across releases
- Shows deployment trends
- Used in deployment analytics

---

## 7. Testing APIs

### 7.1 Get Test Runs
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/test-runs`

**Purpose:** Fetches test run history and results.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `top` (optional): Number of test runs to return (default: 50)

**Features:**
- Returns test runs with results (passed, failed, total)
- Shows test run status and duration
- Includes test run details and links
- Used in testing dashboard

**Response:**
```json
[
  {
    "id": 123,
    "name": "Test Run 2024-01-15",
    "state": "completed",
    "startedDate": "2024-01-15T10:00:00Z",
    "completedDate": "2024-01-15T10:30:00Z",
    "totalTests": 100,
    "passedTests": 95,
    "failedTests": 5,
    "incompleteTests": 0
  }
]
```

---

### 7.2 Get Test Results
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/test-results/:testRunId`

**Purpose:** Fetches detailed test results for a specific test run.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns individual test case results
- Shows test outcome, duration, error messages
- Includes test case details and attachments
- Used in test result analysis

---

### 7.3 Get Test Result Attachments
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/test-results/:testRunId/:resultId/attachments`

**Purpose:** Fetches attachments (screenshots, logs) for a test result.

**Features:**
- Returns test attachments (screenshots, logs, videos)
- Provides download links for attachments
- Used in test failure analysis

---

### 7.4 Get AI Test Suggestions
**Endpoint:** `POST /api/sdlc/projects/:projectId/ado/test-results/ai-suggestions`

**Purpose:** Generates AI-powered suggestions for failed tests.

**Request Body:**
```json
{
  "testRunId": 123,
  "failedTestIds": [1, 2, 3]
}
```

**Features:**
- Analyzes failed tests using AI
- Provides suggestions for fixing test failures
- Generates test improvement recommendations
- Used in test optimization

---

### 7.5 Export Test Report
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/test-reports/export`

**Purpose:** Exports test results as report (PDF, Excel, etc.).

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `testRunId` (optional): Specific test run ID
- `format` (optional): Export format (pdf, excel, json)

**Features:**
- Generates test reports in various formats
- Includes test metrics and trends
- Used for test reporting and documentation

---

### 7.6 Rerun Failed Tests
**Endpoint:** `POST /api/sdlc/projects/:projectId/ado/test-runs/:testRunId/rerun-failed`

**Purpose:** Reruns only the failed tests from a test run.

**Request Body:**
```json
{
  "failedTestIds": [1, 2, 3]
}
```

**Features:**
- Creates new test run with only failed tests
- Preserves original test run
- Used for test debugging and validation

---

## 8. Monitoring & Analytics APIs

### 8.1 Get ADO Monitoring
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado/monitoring`

**Purpose:** Fetches comprehensive monitoring data including builds, tests, and agent pools.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns system status (Healthy, Warning, Critical)
- Provides build statistics (total, succeeded, failed, success rate)
- Shows test statistics (total, passed, failed, pass rate)
- Includes agent pool status (total, online, offline)
- Calculates trends (last 7 days vs previous 7 days)
- Used in system monitoring dashboard

**Response:**
```json
{
  "systemStatus": "Healthy",
  "services": {
    "running": 10,
    "total": 12
  },
  "cpu": {
    "usage": 85,
    "trend": 5,
    "cores": 4
  },
  "memory": {
    "usage": 90,
    "trend": -2,
    "total": 1000,
    "used": 900,
    "free": 100
  },
  "builds": {
    "total": 100,
    "succeeded": 85,
    "failed": 10,
    "inProgress": 5,
    "successRate": 85
  },
  "tests": {
    "total": 1000,
    "passed": 950,
    "failed": 50,
    "passRate": 95
  },
  "agents": {
    "total": 12,
    "online": 10,
    "offline": 2
  },
  "timestamp": "2024-01-15T10:00:00Z"
}
```

---

### 8.2 Get System Status
**Endpoint:** `GET /api/sdlc/projects/:projectId/maintenance/system-status`

**Purpose:** Fetches system health status from ADO builds and releases.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Detects system warnings from ADO builds and releases
- Identifies critical issues
- Provides system health metrics
- Used in maintenance dashboard

---

### 8.3 Get Deployment Trends
**Endpoint:** `GET /api/sdlc/projects/:projectId/maintenance/deployment-trends`

**Purpose:** Fetches deployment trends and analytics.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name
- `daysBack` (optional): Number of days to analyze

**Features:**
- Calculates deployment frequency trends
- Shows success/failure trends over time
- Analyzes deployment patterns by iteration
- Used in deployment analytics

---

### 8.4 Get Pipeline Health
**Endpoint:** `GET /api/sdlc/projects/:projectId/maintenance/pipeline-health`

**Purpose:** Fetches pipeline health metrics and build timeline analysis.

**Query Parameters:**
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Analyzes build pipeline health
- Identifies slow or failing builds
- Provides build timeline analysis
- Shows pipeline performance metrics
- Used in pipeline optimization

---

## 9. Golden Repositories APIs

### 9.1 Get Golden Repositories (ADO)
**Endpoint:** `GET /api/golden-repos/ado`

**Purpose:** Fetches golden repositories from ADO (legacy endpoint).

**Features:**
- Returns template repositories
- Used for project templates
- Legacy endpoint, use `/api/ado/golden-repositories` instead

---

### 9.2 Test ADO Connection (Artifact Organization)
**Endpoint:** `POST /api/artifact-organizations/:id/test-ado`

**Purpose:** Tests ADO connection for a specific artifact organization.

**Features:**
- Validates PAT token for artifact organization
- Tests connectivity to ADO
- Returns connection status
- Used in Settings for connection validation

---

## 10. Design & Figma Integration APIs

### 10.1 Get Epics with Figma
**Endpoint:** `GET /api/ado/epics_with_figma`

**Purpose:** Fetches epics that contain Figma design links.

**Query Parameters:**
- `projectId` (optional): SDLC project ID
- `adoProjectId` (optional): ADO project ID
- `organization` (optional): Organization name
- `projectName` (optional): Project name

**Features:**
- Returns epics with Figma links in description
- Used in Design phase to show epics with design assets
- Filters epics that have design work

---

### 10.2 Push Figma to Epic
**Endpoint:** `POST /api/ado/push_figma_to_epic`

**Purpose:** Adds Figma design link to an epic's description.

**Request Body:**
```json
{
  "epicId": 123,
  "figmaUrl": "https://figma.com/file/...",
  "organization": "org-name",
  "projectName": "project-name"
}
```

**Features:**
- Updates epic description with Figma link
- Maintains design traceability
- Used in Design phase for linking designs to epics

---

### 10.3 Get ADO Sync Status
**Endpoint:** `GET /api/sdlc/projects/:projectId/ado-sync-status`

**Purpose:** Checks synchronization status between DevX and ADO.

**Features:**
- Returns sync status for work items
- Shows last sync timestamp
- Identifies items that need syncing
- Used in sync management

---

### 10.4 Sync from ADO
**Endpoint:** `POST /api/sdlc/projects/:projectId/sync-from-ado`

**Purpose:** Syncs work items from ADO to DevX.

**Request Body:**
```json
{
  "workItemIds": [123, 124, 125],
  "syncType": "full" // or "incremental"
}
```

**Features:**
- Pulls work items from ADO to DevX
- Updates workflow artifacts with ADO data
- Maintains bidirectional sync
- Used in synchronization workflows

---

## 11. AI Agent Integration

### 11.1 ADO Agent
**Agent Name:** "ADO Agent"

**Purpose:** AI-powered agent for querying Azure DevOps data through natural language.

**Capabilities:**
1. **Query Work Items**
   - User stories, epics, bugs, tasks
   - Example: "Show user stories", "List epics", "View bugs"

2. **View Repositories**
   - List repositories in Azure DevOps
   - Example: "Show repositories", "List repos"

3. **Check Pipelines**
   - View pipeline status and builds
   - Example: "Check pipelines", "Show builds"

4. **View Pull Requests**
   - View pull requests
   - Example: "Show pull requests", "List PRs"

**Navigation Actions:**
- **Reset:** Clears current state and starts fresh
- **Change Organization:** Switches to different ADO organization
- **Change Project:** Switches to different ADO project

**State Management:**
- Maintains session state (selected organization, project, query type)
- Supports conversation history
- Provides context-aware quick replies

**API Integration:**
- Uses ADO APIs to fetch data based on user queries
- Interprets natural language to determine actions
- Returns formatted responses with work items, repositories, pipelines

---

## 12. Navigation Operations

### 12.1 Navigation Flow in SDLC Page

When navigating in the SDLC page, the following ADO operations are performed:

1. **Project Selection:**
   - Fetches ADO projects: `GET /api/ado-projects`
   - Gets ADO config: `GET /api/sdlc/projects/:projectId/ado-config`
   - Updates URL parameters with organization and projectName

2. **Phase 2 (Design) Loading:**
   - Fetches epics with Figma: `GET /api/ado/epics_with_figma`
   - Gets epic count: Used for phase badge counts

3. **Phase 3 (Development) Loading:**
   - Fetches ADO config: `GET /api/sdlc/projects/:projectId/ado-config`
   - Gets backlog context: `GET /api/sdlc/projects/:projectId/ado/backlog-context`
   - Loads state counts, developer assignments, velocity metrics

4. **Phase 4 (Testing) Loading:**
   - Fetches test runs: `GET /api/sdlc/projects/:projectId/ado/test-runs`
   - Gets test results and statistics

5. **Phase 5 (Deployment) Loading:**
   - Fetches releases: `GET /api/sdlc/projects/:projectId/ado/releases`
   - Gets release definitions: `GET /api/sdlc/projects/:projectId/ado/release-definitions`
   - Loads deployment summary: `GET /api/sdlc/projects/:projectId/ado/deployment-summary`

6. **Phase 6 (Maintenance) Loading:**
   - Fetches monitoring data: `GET /api/sdlc/projects/:projectId/ado/monitoring`
   - Gets builds: `GET /api/sdlc/projects/:projectId/ado/builds`
   - Loads pipeline health: `GET /api/sdlc/projects/:projectId/maintenance/pipeline-health`

### 12.2 URL Parameter Management

The SDLC page maintains ADO context in URL parameters:
- `organization`: ADO organization name
- `projectId`: SDLC or ADO project ID
- `projectName`: ADO project name
- `artifactOrgId`: Artifact organization ID

These parameters are:
- Set when selecting ADO project
- Preserved during navigation
- Used for API calls to fetch ADO data
- Restored when page is reloaded

### 12.3 Sequential Loading

Phases load sequentially to optimize performance:
- Phase 1 (Requirements) loads first
- Phase 2 (Design) loads after Phase 1 completes
- Phase 3 (Development) loads after Phase 2 completes
- Subsequent phases load when visible or interacted with

This ensures:
- Faster initial page load
- Progressive data loading
- Better user experience
- Reduced API calls

### 12.4 Data Caching

ADO data is cached using React Query:
- **Stale Time:** 5-10 minutes for most endpoints
- **Cache Time:** 10-15 minutes
- **Refetch:** On window focus disabled for most queries
- **Retry:** 1-2 retries on failure

This reduces:
- Unnecessary API calls
- Server load
- Response times
- Network traffic

---

## Summary

DevX performs extensive ADO operations during navigation:

1. **Configuration:** 7 APIs for managing ADO settings and connections
2. **Project Management:** 7 APIs for managing ADO projects and SDLC mappings
3. **Work Items:** 14 APIs for managing epics, features, user stories, and backlog
4. **Repositories:** 11 APIs for code management and golden repositories
5. **Builds & Pipelines:** 3 APIs for build and pipeline management
6. **Releases & Deployment:** 13 APIs for release and deployment management
7. **Testing:** 6 APIs for test management and reporting
8. **Monitoring:** 4 APIs for system monitoring and analytics
9. **Design Integration:** 4 APIs for Figma and design sync
10. **AI Agent:** Natural language interface for ADO queries

**Total: 70+ ADO-related APIs** providing comprehensive Azure DevOps integration across the entire SDLC.

---

## Key Features

1. **Multi-Organization Support:** Works with multiple ADO organizations via artifact organizations
2. **Bidirectional Sync:** Syncs data between DevX and ADO in both directions
3. **Traceability:** Maintains links between BRD requirements and ADO work items
4. **Real-time Updates:** Updates work items, builds, releases in real-time
5. **Comprehensive Monitoring:** Provides system health, build, test, and deployment metrics
6. **AI Integration:** Natural language queries for ADO data
7. **Golden Repositories:** Template repository management for project creation
8. **Design Integration:** Links Figma designs to ADO epics
9. **Progressive Loading:** Sequential phase loading for optimal performance
10. **Data Caching:** Intelligent caching to reduce API calls

---

*Last Updated: Based on current codebase analysis*
*Document Version: 1.0*
