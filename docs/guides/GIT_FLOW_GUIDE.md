# Git Flow Deployment Guide

This document explains the Git Flow branching strategy and deployment workflow for the DevX application.

## Overview

We use a **Git Flow** branching strategy with automated deployments to different Azure environments based on the branch:

| Branch Type | Purpose | Deployment Target |
|------------|---------|-------------------|
| `feature/*` | New development features | None (build/test only) |
| `develop` | Integration / QA testing | **QA Environment** (SWA + App Service) |
| `release/*` | Release candidate | **UAT Environment** (SWA + App Service) |
| `main` | Production-ready code | **PROD Environment** (SWA + App Service) |

## Branch Flow

```
feature/user-authentication
    ↓ (PR)
develop ────────────────→ QA Deployment (auto)
    ↓ (Create release branch)
release/v1.2.0 ──────────→ UAT Deployment (auto)
    ↓ (Merge to main)
main ────────────────────→ PROD Deployment (auto)
```

## Branch Descriptions

### Feature Branches (`feature/*`)

- **Purpose**: Development of new features or bug fixes
- **Naming**: `feature/feature-name` (e.g., `feature/user-authentication`)
- **Workflow**:
  1. Create branch from `develop`
  2. Develop and commit changes
  3. Create Pull Request to `develop`
  4. Pipeline runs build/test (no deployment)
  5. After approval, merge to `develop`

### Develop Branch

- **Purpose**: Integration branch for QA testing
- **Workflow**:
  1. Merge feature branches via PR
  2. Pipeline automatically builds and deploys to **QA Environment**
  3. QA team tests the application
  4. Once QA passes, create a release branch

### Release Branches (`release/*`)

- **Purpose**: Prepare release for UAT and production
- **Naming**: `release/v1.2.0` or `release/2024-01-15`
- **Workflow**:
  1. Create branch from `develop`
  2. Pipeline automatically builds and deploys to **UAT Environment**
  3. UAT team tests the application
  4. Fix any bugs found in UAT (commit directly to release branch)
  5. After UAT approval, merge to `main` (and back to `develop`)

### Main Branch

- **Purpose**: Production-ready code
- **Workflow**:
  1. Merge release branch via PR
  2. Pipeline automatically builds and deploys to **PROD Environment**
  3. Production deployment requires approval (configured in Azure DevOps)

## Deployment Environments

### QA Environment
- **Static Web App**: `azure-static-web-apps-gentle-hill-099ce5400`
- **App Service**: `qadevxapi2o`
- **Resource Group**: `RG-DevXPlatform`
- **Trigger**: Automatic on push to `develop` branch

### UAT Environment
- **Static Web App**: `azure-static-web-apps-polite-sky-06c4dc20f`
- **App Service**: `uatdevxapi2o`
- **Resource Group**: `RG-DevXPlatform`
- **Trigger**: Automatic on push to `release/*` branches

### PROD Environment
- **Static Web App**: `azure-static-web-apps-orange-sky-04d093200`
- **App Service**: `devxapi2o`
- **Resource Group**: `RG-DevXPlatform`
- **Trigger**: Automatic on push to `main` branch (with approval gates)

## Pipeline Configuration

The unified pipeline (`azure-pipelines.yml`) handles all deployments:

1. **Build Stage**: Builds both frontend (Static Web App) and backend (App Service)
2. **Deploy Stages**: Conditionally deploys based on branch:
   - `develop` → QA
   - `release/*` → UAT
   - `main` → PROD

## Manual Deployment Steps

### Creating a Feature Branch

```bash
# Start from develop
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/my-new-feature

# Make changes and commit
git add .
git commit -m "Add new feature"

# Push and create PR
git push origin feature/my-new-feature
```

### Creating a Release Branch

```bash
# Start from develop (after QA approval)
git checkout develop
git pull origin develop

# Create release branch
git checkout -b release/v1.2.0

# Push to trigger UAT deployment
git push origin release/v1.2.0
```

### Releasing to Production

```bash
# After UAT approval, merge release to main
git checkout main
git pull origin main
git merge release/v1.2.0

# Push to trigger PROD deployment
git push origin main

# Also merge back to develop
git checkout develop
git merge release/v1.2.0
git push origin develop

# Delete release branch
git branch -d release/v1.2.0
git push origin --delete release/v1.2.0
```

## Approval Gates

Configure approval gates in Azure DevOps:

1. Go to **Pipelines** → **Environments**
2. Create environments: `qa-frontend`, `qa-backend`, `uat-frontend`, `uat-backend`, `prod-frontend`, `prod-backend`
3. For UAT and PROD environments, add **Approvals**:
   - Add required approvers
   - Set timeout (optional)

## Environment Variables

Each environment has its own configuration:

- **QA**: Configure in Azure App Service → Configuration → Application settings
- **UAT**: Configure in Azure App Service → Configuration → Application settings
- **PROD**: Configure in Azure App Service → Configuration → Application settings

See `env/` directory for example configurations.

## Troubleshooting

### Pipeline Not Triggering

- Check branch name matches pattern (`develop`, `release/*`, `main`, `feature/*`)
- Verify changes are in monitored paths (not excluded)
- Check pipeline permissions

### Deployment Failing

- Verify environment variables are set in Azure App Service
- Check service connection permissions
- Review pipeline logs for specific errors
- Ensure Static Web App tokens are correct

### Wrong Environment Deployed

- Verify branch name matches expected pattern
- Check pipeline conditions in `azure-pipelines.yml`
- Review deployment stage conditions

## Best Practices

1. **Always create PRs** for merging branches
2. **Test in QA** before creating release branch
3. **Fix bugs in release branch** before merging to main
4. **Never push directly to main** (use PRs)
5. **Tag releases** after successful production deployment
6. **Keep release branches short-lived** (merge and delete after release)

## Quick Reference

| Action | Branch | Result |
|--------|--------|--------|
| Start new feature | `feature/my-feature` from `develop` | No deployment |
| Complete feature | PR `feature/*` → `develop` | Deploys to QA |
| Start release | `release/v1.0.0` from `develop` | Deploys to UAT |
| Release to prod | PR `release/*` → `main` | Deploys to PROD |

## Support

For issues or questions:
1. Check pipeline logs in Azure DevOps
2. Review this guide
3. Contact DevOps team

