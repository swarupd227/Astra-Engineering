# Development Phase - Azure DevOps Integration

## Overview

The Development phase is now fully integrated with Azure DevOps to fetch and display real repository data including branches and commits. This replaces the previous mock "Code" and "Preview" features with actual data from your Azure DevOps project.

## Workflow

The Development phase follows this workflow:

```
[Start Development Phase]
     ↓
[Click "Link Repository"]
     ↓
(Select Repository from ADO)
     ↓
[Display Repository Details]
  • Repository Name + Link to ADO
  • Branches (main, dev, etc.)
  • Commits (list + count)
     ↓
[Preview Summary]
  • Repo Info
  • Branch Count
  • Commit Count
     ↓
[Click "View Checkpoint"]
     ↓
[Mark "Ready to Build" → Progress to Build & Testing Phase]
```

## Features

### 1. Repository Selection

When you click "Link Repository" in the Development phase card, you'll see:

- **List of Repositories**: All repositories from your Azure DevOps project
- **Repository Details**:
  - Repository name
  - Default branch (e.g., main)
  - Repository size
- **Direct Links**: Click the external link icon to open the repository in Azure DevOps

### 2. Repository Details View

After selecting a repository, you'll see:

#### Summary Statistics
- **Total Branches**: Count of all branches in the repository
- **Recent Commits**: Number of recent commits (last 20)

#### Branches Panel
- List of all branches
- Branch names
- Creator information
- Highlights the default branch (main/master)

#### Commits Panel
- Last 20 commits from the repository
- For each commit:
  - Commit message
  - Author name
  - Commit date and time
  - Short commit SHA (first 8 characters)

### 3. Development Phase Summary

At the bottom of the modal, you'll see a summary card with:
- Repository name
- Total number of branches
- Number of recent commits displayed

This provides a quick overview of your development activity.

## Configuration

### Prerequisites

The Development phase ADO integration uses the same Azure DevOps configuration as the Deployment phase:

```bash
# Required environment variables in .env
ADO_ORG=your-organization-name
ADO_PROJECT=your-project-name
ADO_PAT=your-personal-access-token
```

### PAT Permissions Required

Your Personal Access Token must have these permissions:
- ✅ **Code: Read** (to access repositories, branches, and commits)

## API Endpoints

### Get Repositories

```http
GET /api/sdlc/projects/:projectId/ado/repositories
```

Returns all repositories in the Azure DevOps project.

**Response:**
```json
[
  {
    "id": "repo-id",
    "name": "MyRepository",
    "defaultBranch": "refs/heads/main",
    "remoteUrl": "https://dev.azure.com/...",
    "webUrl": "https://dev.azure.com/...",
    "size": 1024000
  }
]
```

### Get Branches

```http
GET /api/sdlc/projects/:projectId/ado/repositories/:repositoryId/branches
```

Returns all branches for a specific repository.

**Response:**
```json
[
  {
    "name": "main",
    "objectId": "abc123...",
    "creator": {
      "displayName": "John Doe",
      "date": "2024-01-01T10:00:00Z"
    }
  }
]
```

### Get Commits

```http
GET /api/sdlc/projects/:projectId/ado/repositories/:repositoryId/commits?limit=20
```

Returns recent commits for a specific repository.

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

## UI Updates

### Development Phase Card

The Development phase card now shows:

**Features (clickable):**
- 📁 **Repository** - Opens the ADO integration modal
- 🌿 **Branches** - Opens the ADO integration modal
- 💬 **Commits** - Opens the ADO integration modal

**Removed Features:**
- ~~💻 Code~~ (removed - use ADO directly)
- ~~👁️ Preview~~ (removed - use ADO directly)

**Button:**
- **Link Repository** - Opens the ADO integration modal to select and view repository details

### Development ADO Modal

A comprehensive modal that provides:

1. **Repository Selection View**
   - Grid of available repositories
   - Repository metadata
   - Direct links to ADO

2. **Repository Details View**
   - Summary statistics
   - Branches list
   - Commits history
   - Quick summary card
   - Change repository option

3. **Refresh Functionality**
   - Manual refresh button to update all data
   - Auto-refresh when modal opens

## User Guide

### How to Use

1. **Navigate to Development Phase**
   - Go to your SDLC project
   - Find the Development phase card (green, Phase 3)

2. **Link Repository**
   - Click the "Link Repository" button
   - Or click on any feature (Repository, Branches, Commits)

3. **Select Repository**
   - Choose a repository from the list
   - View the repository details automatically

4. **Review Development Activity**
   - Check branches to see development structure
   - Review recent commits to see latest work
   - Use the summary to get quick insights

5. **Access Azure DevOps**
   - Click the external link icon to open ADO
   - Navigate to specific branches or commits as needed

6. **Complete Development**
   - Use "View Checkpoint" to review phase progress
   - Mark development as complete to move to Build & Testing

### Tips

- **Refresh Data**: Click the refresh button to get the latest information from Azure DevOps
- **Multiple Repositories**: You can switch between repositories using the "Change Repository" button
- **Direct Links**: Use the external link icons to open items directly in Azure DevOps
- **Branch Strategy**: The modal highlights your default branch (typically main or master)

## Integration with SDLC Workflow

### Progress Tracking

The Development phase integrates with the overall SDLC workflow:

1. **Phase Status**: Track development progress percentage
2. **Checkpoint System**: Mark development milestones
3. **Phase Progression**: Move to Build & Testing when ready

### Data Flow

```
Azure DevOps
     ↓
[API Calls]
     ↓
Backend Endpoints
     ↓
Development Modal
     ↓
Phase Progress Tracking
     ↓
Checkpoint Validation
     ↓
Next Phase (Build & Testing)
```

## Troubleshooting

### "Azure DevOps Not Configured" Error

**Problem**: Modal shows configuration error

**Solution**:
1. Verify environment variables are set:
   ```bash
   ADO_ORG=your-org
   ADO_PROJECT=your-project
   ADO_PAT=your-token
   ```
2. Restart your development server
3. Ensure PAT has "Code: Read" permission

### No Repositories Found

**Problem**: Repository list is empty

**Solution**:
1. Verify you have repositories in your Azure DevOps project
2. Check PAT permissions include "Code: Read"
3. Ensure the organization and project names are correct
4. Try refreshing the modal

### Branches or Commits Not Loading

**Problem**: Repository selected but branches/commits not showing

**Solution**:
1. Check your internet connection
2. Verify the repository exists in Azure DevOps
3. Click the refresh button to retry
4. Check browser console for specific errors

### Authentication Errors

**Problem**: 401 Unauthorized errors

**Solution**:
1. Verify your PAT is valid and not expired
2. Ensure PAT has "Code: Read" scope
3. Generate a new PAT if needed
4. Update `.env` file with new PAT
5. Restart server

## Best Practices

### Development Workflow

1. **Regular Commits**: Commit frequently to show progress
2. **Branch Strategy**: Use feature branches (dev, feature/*, hotfix/*)
3. **Meaningful Messages**: Write clear commit messages
4. **Code Reviews**: Use pull requests before merging to main

### Repository Management

1. **Clean Structure**: Organize code logically in your repository
2. **Branch Protection**: Protect main/master branch in Azure DevOps
3. **Documentation**: Keep README and docs updated
4. **Regular Merges**: Merge feature branches regularly to avoid conflicts

### Integration Usage

1. **Regular Checks**: Review the Development modal regularly
2. **Track Progress**: Use commit count as a progress metric
3. **Verify Branches**: Ensure all feature work is in appropriate branches
4. **Monitor Activity**: Check commit history for team activity

## Comparison: Before vs After

### Before (Mock System)

- ❌ Fake "Code" section with mock data
- ❌ Static "Preview" that didn't reflect real work
- ❌ No connection to actual development activity
- ❌ Manual data entry required

### After (ADO Integration)

- ✅ Real repository data from Azure DevOps
- ✅ Live branches showing actual development structure
- ✅ Recent commits reflecting team activity
- ✅ Direct links to Azure DevOps
- ✅ Automatic synchronization with your project
- ✅ No manual data entry needed

## Future Enhancements

Planned features for future releases:

- [ ] Pull Request integration
- [ ] Code review statistics
- [ ] Build status indicators
- [ ] Branch policies and protections
- [ ] Commit graph visualization
- [ ] Developer activity metrics
- [ ] File change statistics
- [ ] Code quality metrics integration

## Related Documentation

- [Azure DevOps Deployment Integration](./AZURE_DEVOPS_DEPLOYMENT_INTEGRATION.md)
- [SDLC Project Configuration](./SDLC_PROJECT_CONFIG_USAGE.md)
- [Azure DevOps REST API](https://docs.microsoft.com/en-us/rest/api/azure/devops/)

## Support

For issues or questions:

1. Check environment variables are correctly set
2. Verify PAT permissions and expiration
3. Test connectivity to Azure DevOps
4. Review browser console for errors
5. Check server logs for detailed information

