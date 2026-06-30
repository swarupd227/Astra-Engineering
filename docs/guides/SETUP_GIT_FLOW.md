# Git Flow Setup Guide

This guide will help you set up the Git Flow deployment pipeline in Azure DevOps.

## Prerequisites

1. Azure DevOps project with repository access
2. Azure service connection named `devxmanagedidentity`
3. Azure resources already created:
   - QA, UAT, and PROD App Services
   - QA, UAT, and PROD Static Web Apps

## Step 1: Configure Pipeline Variables

The pipeline uses variables for environment-specific configurations. You have two options:

### Option A: Use Pipeline Variables (Recommended for Secrets)

1. Go to **Azure DevOps** → **Pipelines** → **Library**
2. Create a new **Variable Group** named `DevX-Environment-Config`
3. Add the following variables as **Secret** variables:

   **QA Environment:**
   - `qaAppServiceName` = `qadevxapi2o` (regular variable)
   - `qaResourceGroup` = `RG-DevXPlatform` (regular variable)
   - `qaSwaToken` = (from Key Vault if enabled, or Secret variable)

   **UAT Environment:**
   - `uatAppServiceName` = `uatdevxapi2o` (regular variable)
   - `uatResourceGroup` = `RG-DevXPlatform` (regular variable)
   - `uatSwaToken` = (from Key Vault if enabled, or Secret variable)

   **PROD Environment:**
   - `prodAppServiceName` = `devxapi2o` (regular variable)
   - `prodResourceGroup` = `RG-DevXPlatform` (regular variable)
   - `prodSwaToken` = (from Key Vault if enabled, or Secret variable)

   **Note**: If not using Key Vault, mark SWA tokens as **Secret** variables (lock icon).

5. In your pipeline, add the variable group:
   ```yaml
   variables:
     - group: DevX-Environment-Config
   ```

**Azure Key Vault Setup (Recommended for Production):**
1. Create an Azure Key Vault (or use existing)
2. Add secrets to Key Vault:
   - `qa-swa-token`
   - `uat-swa-token`
   - `prod-swa-token`
3. In Variable Group, toggle "Link secrets from an Azure key vault" ON
4. Select your Azure subscription and Key Vault
5. Link the secrets as variables (they'll appear in the variables list)

### Option B: Use Inline Variables (Current Setup)

The current `azure-pipelines.yml` has variables defined inline. For production, consider moving secrets to Variable Groups.

## Step 2: Create Azure DevOps Environments

Create environments for approval gates:

1. Go to **Pipelines** → **Environments**
2. Create the following environments:
   - `qa-frontend`
   - `qa-backend`
   - `uat-frontend`
   - `uat-backend`
   - `prod-frontend` (with approval gates)
   - `prod-backend` (with approval gates)

3. For PROD environments, configure approval gates:
   - Click on `prod-frontend` → **Approvals and checks** → **Approvals**
   - Add required approvers
   - Repeat for `prod-backend`

## Step 3: Configure the Pipeline

1. Go to **Pipelines** → **Pipelines**
2. Click **New pipeline** or **Edit** existing pipeline
3. Select your repository
4. Choose **Existing Azure Pipelines YAML file**
5. Select the branch and path: `azure-pipelines.yml`
6. Save the pipeline

## Step 4: Verify Branch Protection

Set up branch policies in Azure DevOps:

1. Go to **Repos** → **Branches**
2. For `main` branch:
   - Click **...** → **Branch policies**
   - Enable **Require a minimum number of reviewers** (recommended: 2)
   - Enable **Require linked work items**
   - Enable **Build validation** (select your pipeline)
3. For `develop` branch:
   - Enable **Build validation**
   - Optional: Require reviewers

## Step 5: Test the Pipeline

### Test Feature Branch (Build Only)

1. Create a feature branch:
   ```bash
   git checkout develop
   git checkout -b feature/test-pipeline
   ```

2. Make a small change and push:
   ```bash
   git add .
   git commit -m "Test pipeline"
   git push origin feature/test-pipeline
   ```

3. Verify pipeline runs and builds successfully (no deployment)

### Test QA Deployment

1. Create a PR from `feature/test-pipeline` to `develop`
2. Merge the PR
3. Verify pipeline deploys to QA environment

### Test UAT Deployment

1. Create a release branch:
   ```bash
   git checkout develop
   git checkout -b release/test-1.0.0
   git push origin release/test-1.0.0
   ```

2. Verify pipeline deploys to UAT environment

### Test PROD Deployment

1. Merge release branch to main:
   ```bash
   git checkout main
   git merge release/test-1.0.0
   git push origin main
   ```

2. Verify approval gates appear
3. After approval, verify deployment to PROD

## Step 6: Configure Environment Variables in Azure App Service

For each environment (QA, UAT, PROD), configure environment variables:

1. Go to **Azure Portal** → Your App Service
2. Navigate to **Configuration** → **Application settings**
3. Add all required variables (see `env/*/env.template` files)
4. Click **Save**

Required variables for each environment:
- `NODE_ENV` = `production`
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`
- `PAT_ENCRYPTION_KEY`
- `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`

## Step 7: Verify Static Web App Configuration

For each Static Web App, verify:

1. **Build configuration**:
   - App location: `/`
   - Output location: `dist/public`
   - API location: (empty)

2. **Deployment token** matches the token in pipeline variables

## Troubleshooting

### Pipeline Not Triggering

- Check branch name matches: `develop`, `release/*`, `main`, or `feature/*`
- Verify path filters in pipeline YAML
- Check pipeline permissions

### Deployment Fails

- Verify service connection `devxmanagedidentity` has permissions
- Check App Service names match pipeline variables
- Verify Static Web App tokens are correct
- Check environment variables in Azure App Service

### Approval Gates Not Appearing

- Verify environments are created in Azure DevOps
- Check environment names match pipeline YAML
- Ensure you have permissions to view approvals

## Next Steps

1. Review [GIT_FLOW_GUIDE.md](./GIT_FLOW_GUIDE.md) for workflow details
2. Review [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment information
3. Train team on Git Flow workflow
4. Set up monitoring and alerts for deployments

## Security Best Practices

1. ✅ Store secrets in Azure DevOps Variable Groups (not in YAML)
2. ✅ **Use Azure Key Vault for production secrets** (toggle ON in Variable Group)
   - Provides centralized secret management
   - Enables automatic secret rotation
   - Better audit trail and access control
   - Recommended for PROD, optional for QA/UAT
3. ✅ Enable approval gates for production
4. ✅ Rotate Static Web App tokens regularly
5. ✅ Use branch policies to prevent direct pushes to main
6. ✅ Enable audit logs for deployments

## Support

For issues:
1. Check pipeline logs in Azure DevOps
2. Review this guide and [GIT_FLOW_GUIDE.md](./GIT_FLOW_GUIDE.md)
3. Contact DevOps team

