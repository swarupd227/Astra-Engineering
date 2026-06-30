# Azure Pipelines Directory

This directory contains environment-specific pipeline templates and configurations.

## Structure

```
azure-pipelines/
├── README.md           # This file
└── (future templates)   # Environment-specific task templates
```

## Current Setup

The main pipeline is defined in the root `azure-pipelines.yml` file, which uses branch-based conditions to deploy to different environments.

### Pipeline Flow

1. **Build Stage**: Always runs for all branches
   - Builds frontend (Static Web App)
   - Builds backend (App Service)

2. **Deploy Stages**: Conditionally run based on branch
   - `develop` → Deploy_QA
   - `release/*` → Deploy_UAT
   - `main` → Deploy_PROD

## Future Enhancements

This directory can be used for:
- Environment-specific task templates
- Reusable pipeline snippets
- Deployment scripts
- Environment configuration files

## Related Files

- Root `azure-pipelines.yml` - Main unified pipeline
- `GIT_FLOW_GUIDE.md` - Git Flow workflow documentation
- `DEPLOYMENT.md` - Deployment guide

