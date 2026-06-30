# Azure Deployment Guide

This document provides instructions for deploying the DevX Backend to Azure Web App (Linux).

## Prerequisites

1. Azure DevOps pipeline configured with service connection named `devxmanagedidentity`
2. Azure Web App (Linux) created with the following details:
   - **App Name**: `devxapi2o`
   - **Resource Group**: `RG-DevXPlatform`
   - **Subscription**: `devxmanagedidentity`
   - **App Type**: Linux Web App
   - **Runtime Stack**: Node.js 22 (configure in App Service → Configuration → General settings)
   - **Default Domain**: `devxapi2o-emfrddb9bab5hkdb.eastus2-01.azurewebsites.net`
   - **Location**: East US 2
   - **App Service Plan**: ASP-RGBhhcFNOL-8fb6 (F1: 1)

## Environment Variables Configuration

The following environment variables **must** be configured in Azure App Service Configuration (Application Settings):

### Required Environment Variables

1. **NODE_ENV**: `production` ⚠️ **CRITICAL - Must be set to `production`**
   - Azure App Service may set this automatically, but ensure it's configured
   - Without this, the app will run in development mode and may fail
2. **PORT**: Azure App Service sets this automatically (usually `8080`)
   - Your code will use `process.env.PORT` automatically
   - No need to set this manually unless you want a specific port
3. **HOST**: `0.0.0.0` (optional, defaults to `0.0.0.0` in code)

### Database Configuration (Required)

4. **MYSQL_HOST**: Your Azure MySQL server hostname
5. **MYSQL_PORT**: `3306` (default MySQL port)
6. **MYSQL_USER**: Your MySQL username
7. **MYSQL_PASSWORD**: Your MySQL password
8. **MYSQL_DATABASE**: Your MySQL database name

### Security Configuration (Required)

9. **PAT_ENCRYPTION_KEY**: A secure encryption key (minimum 32 characters recommended)
   - Generate a secure random string for this
   - Example: `openssl rand -hex 32`

### Azure OpenAI Configuration (Required for AI features)

10. **AZURE_OPENAI_API_KEY**: Your Azure OpenAI API key
11. **AZURE_OPENAI_ENDPOINT**: Your Azure OpenAI endpoint URL
    - Format: `https://your-resource.openai.azure.com/`
12. **AZURE_OPENAI_DEPLOYMENT**: Your Azure OpenAI deployment name
13. **AZURE_OPENAI_API_VERSION**: `2024-02-01` (or latest version)

### Optional Configuration

14. **AI_INTEGRATIONS_OPENAI_BASE_URL**: Alternative OpenAI base URL (optional)
15. **AI_INTEGRATIONS_OPENAI_API_KEY**: Alternative OpenAI API key (optional)
16. **OPENAI_API_KEY**: Standard OpenAI API key (optional, used as fallback)
17. **ADO_PAT**: Azure DevOps Personal Access Token (optional, for ADO integration)

## How to Configure Environment Variables in Azure Portal

1. Navigate to your Azure Web App in the Azure Portal
2. Go to **Configuration** → **Application settings**
3. Click **+ New application setting** for each environment variable
4. Add each variable with its value
5. Click **Save** to apply changes
6. The app will restart automatically

## Azure DevOps Pipeline

The pipeline (`azure-pipelines.yml`) automatically:

1. **Builds** the application:
   - Installs Node.js 22.x
   - Runs `npm install`
   - Runs TypeScript type checking (`npm run check`)
   - Builds the application (`npm run build`)
   - Installs production dependencies (`npm ci --production`)
   - Packages the deployment with `dist/`, `package.json`, `package-lock.json`, and `node_modules/`

2. **Deploys** to Azure Web App:
   - Packages the built application
   - Deploys to Azure Web App using the service connection
   - Restarts the app service

## Pipeline Variables

The following variables are configured in the pipeline:
- `azureSubscription`: `devxmanagedidentity`
- `appType`: `webAppLinux`
- `appName`: `devxapi2o`
- `resourceGroupName`: `RG-DevXPlatform`
- `nodeVersion`: `22.x`

## Manual Deployment Steps (if needed)

If you need to deploy manually:

1. Build the application:
   ```bash
   npm install
   npm run build
   ```

2. Create a deployment package:
   ```bash
   zip -r deploy.zip dist/ package.json package-lock.json
   ```

3. Deploy using Azure CLI:
   ```bash
   az webapp deploy --resource-group RG-DevXPlatform --name devxapi2o --src-path deploy.zip --type zip
   ```

## Troubleshooting

### App fails to start

- Check application logs in Azure Portal → Log stream
- Verify all required environment variables are set
- Ensure `NODE_ENV` is set to `production`
- Check that the startup command is `npm start`

### Database connection errors

- Verify MySQL server allows connections from Azure Web App IP
- Check MySQL firewall rules
- Ensure SSL is configured correctly (Azure MySQL requires SSL)

### Missing environment variables

- All required environment variables must be set in Azure App Service Configuration
- Check the Application Settings in Azure Portal
- Restart the app after adding new environment variables

## Notes

- Azure Web App Linux automatically runs `npm install --production` when `package.json` is detected
- The startup command is configured as `npm start` which runs `node dist/index.js`
- The pipeline triggers on pushes to `main` and `develop` branches
- PRs to `main` and `develop` also trigger the pipeline (build only, no deployment)

