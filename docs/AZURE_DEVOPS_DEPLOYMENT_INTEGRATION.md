# Azure DevOps Deployment Integration

## Overview

The Deployment phase in the SDLC Workflow is now fully integrated with Azure DevOps Release Management. This integration allows you to:

- **View Releases**: Browse all releases and release pipelines
- **Create Releases**: Create new releases from release definitions
- **Trigger Deployments**: Deploy releases to different environments
- **Monitor Deployments**: Track deployment status and history
- **Manage Approvals**: View and approve pending deployment approvals
- **View Analytics**: See deployment success rates and trends

## Configuration

### Prerequisites

1. An Azure DevOps organization with at least one project
2. A Personal Access Token (PAT) with the following permissions:
   - **Release: Read, write, execute** (for managing releases)
   - **Build: Read & execute** (for viewing pipelines)
   - **Code: Read** (for accessing repositories)

### Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Azure DevOps Configuration
ADO_ORG=your-organization-name
ADO_PROJECT=your-project-name
ADO_PAT=your-personal-access-token
```

**Example:**

```bash
ADO_ORG=contoso
ADO_PROJECT=MyProject
ADO_PAT=abcdefghijklmnopqrstuvwxyz1234567890
```

### Getting Your Azure DevOps PAT

1. Sign in to your Azure DevOps organization
2. Click on your profile picture in the top right corner
3. Select **Personal access tokens**
4. Click **New Token**
5. Configure the token:
   - **Name**: DevPlatform Deployment Integration
   - **Organization**: Select your organization
   - **Expiration**: Choose an appropriate duration
   - **Scopes**: Select **Custom defined**, then:
     - ✅ Release: Read, write, execute
     - ✅ Build: Read & execute
     - ✅ Code: Read
6. Click **Create**
7. **Important**: Copy the token immediately and save it securely (you won't be able to see it again)

## Features

### 1. Deployment Dashboard

Access the deployment dashboard by clicking on any deployment phase feature or the "Manage Deployments" button in the Deployment phase card.

The dashboard provides:

- **Overview Tab**: 
  - Deployment statistics (total, successful, failed, pending)
  - Success/failure rates
  - Recent releases timeline

- **Releases Tab**:
  - List of all releases with status
  - Environment deployment status
  - Quick deploy actions
  - Links to Azure DevOps

- **Create Release Tab**:
  - Select a release pipeline
  - Create new releases with one click

### 2. Viewing Releases

The releases view shows:

- Release name and version
- Creation date and author
- Current status (succeeded, failed, in progress)
- Environment deployment status
- Direct links to Azure DevOps

### 3. Creating Releases

To create a new release:

1. Open the Deployment modal
2. Go to the **Create Release** tab
3. Select a release pipeline from the dropdown
4. Click **Create Release**
5. The system will create the release in Azure DevOps

### 4. Triggering Deployments

To deploy a release to an environment:

1. Find the release in the **Releases** tab
2. Locate the target environment
3. Click the **Deploy** button next to the environment
4. The deployment will be triggered in Azure DevOps

### 5. Monitoring Deployments

The deployment modal automatically refreshes data. You can also:

- Click the **Refresh** button to manually update data
- View deployment status for each environment
- See deployment timelines and history
- Check success/failure rates in the Overview tab

## API Endpoints

The following API endpoints are available for deployment operations:

### Get ADO Configuration

```http
GET /api/sdlc/projects/:projectId/ado-config
```

Returns Azure DevOps configuration status.

### Get Release Definitions

```http
GET /api/sdlc/projects/:projectId/ado/release-definitions
```

Returns all release pipelines in the project.

### Get Releases

```http
GET /api/sdlc/projects/:projectId/ado/releases?definitionId={id}&top={count}
```

Returns releases, optionally filtered by definition ID.

### Get Specific Release

```http
GET /api/sdlc/projects/:projectId/ado/releases/:releaseId
```

Returns detailed information about a specific release.

### Create Release

```http
POST /api/sdlc/projects/:projectId/ado/releases
Content-Type: application/json

{
  "definitionId": 123,
  "description": "Release description"
}
```

Creates a new release from a release definition.

### Trigger Deployment

```http
POST /api/sdlc/projects/:projectId/ado/releases/:releaseId/deploy
Content-Type: application/json

{
  "environmentId": 456,
  "comment": "Deployment comment"
}
```

Triggers deployment of a release to a specific environment.

### Get Deployments

```http
GET /api/sdlc/projects/:projectId/ado/releases/:releaseId/deployments
```

Returns all deployments for a specific release.

### Get Deployment Summary

```http
GET /api/sdlc/projects/:projectId/ado/deployment-summary?daysBack=30
```

Returns deployment statistics and recent releases.

### Get Approvals

```http
GET /api/sdlc/projects/:projectId/ado/approvals?status=pending
```

Returns approval requests (pending, approved, or rejected).

### Update Approval

```http
PATCH /api/sdlc/projects/:projectId/ado/approvals/:approvalId
Content-Type: application/json

{
  "status": "approved",
  "comments": "Approval comments"
}
```

Approves or rejects a release approval.

## Security Considerations

1. **PAT Security**: 
   - Never commit your PAT to version control
   - Store it securely in environment variables
   - Use minimal required permissions
   - Set appropriate expiration dates
   - Rotate tokens regularly

2. **Access Control**:
   - Ensure users have appropriate Azure DevOps permissions
   - Implement proper authentication in your application
   - Audit deployment activities

3. **Network Security**:
   - All API calls to Azure DevOps use HTTPS
   - PAT is transmitted securely via Basic Authentication

## Troubleshooting

### "Azure DevOps Not Configured" Error

**Problem**: The deployment modal shows a configuration error.

**Solution**:
1. Check that all environment variables are set correctly
2. Verify the PAT has not expired
3. Ensure the PAT has the required permissions
4. Restart the application after setting environment variables

### "Authentication Failed (401)" Error

**Problem**: API calls fail with 401 unauthorized.

**Solution**:
1. Verify your PAT is valid and not expired
2. Check that the organization name is correct
3. Ensure the PAT has "Release: Read, write, execute" permissions
4. Try generating a new PAT with the correct scopes

### "Project Not Found (404)" Error

**Problem**: API calls fail with 404 not found.

**Solution**:
1. Verify the organization name is correct (case-sensitive)
2. Verify the project name is correct (case-sensitive)
3. Ensure you have access to the project
4. Check that the project exists in the organization

### No Release Pipelines Found

**Problem**: The Create Release tab shows "No release pipelines found".

**Solution**:
1. Create at least one release pipeline in Azure DevOps
2. Go to **Pipelines** → **Releases** in Azure DevOps
3. Click **New pipeline** and configure a release pipeline
4. Refresh the deployment modal

### Deployment Not Triggering

**Problem**: Clicking "Deploy" doesn't trigger a deployment.

**Solution**:
1. Check that the environment is configured correctly in the release pipeline
2. Verify there are no pending approvals blocking the deployment
3. Check Azure DevOps for any pipeline errors
4. Ensure the PAT has "Release: Execute" permission

## Best Practices

1. **Release Management**:
   - Use semantic versioning for releases
   - Add meaningful descriptions to releases
   - Tag releases with relevant metadata

2. **Deployment Strategy**:
   - Use multiple environments (Dev, Staging, Production)
   - Implement approval gates for production deployments
   - Test in lower environments before production

3. **Monitoring**:
   - Regularly check the deployment summary dashboard
   - Set up alerts in Azure DevOps for failed deployments
   - Review deployment history to identify patterns

4. **Automation**:
   - Use release triggers to automate deployments
   - Implement quality gates in your release pipelines
   - Set up automatic rollback for failed deployments

## Azure DevOps Resources

- [Azure DevOps Release Management Documentation](https://docs.microsoft.com/en-us/azure/devops/pipelines/release/)
- [Release Pipelines Overview](https://docs.microsoft.com/en-us/azure/devops/pipelines/release/define-multistage-release-process)
- [Release Approvals and Gates](https://docs.microsoft.com/en-us/azure/devops/pipelines/release/approvals/)
- [Azure DevOps REST API Reference](https://docs.microsoft.com/en-us/rest/api/azure/devops/)

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review Azure DevOps service health
3. Verify your PAT permissions and expiration
4. Check the browser console for error messages
5. Review server logs for detailed error information

## Future Enhancements

Planned features for future releases:

- [ ] Feature flag management integration
- [ ] Deployment slot management (Azure App Service)
- [ ] Rollback automation
- [ ] Deployment metrics and analytics
- [ ] Integration with monitoring tools (Application Insights)
- [ ] Deployment schedules and maintenance windows
- [ ] Multi-stage approval workflows
- [ ] Deployment templates and blueprints

