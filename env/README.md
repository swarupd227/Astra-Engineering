# Environment Configuration

This directory contains environment-specific configuration files for different deployment environments.

## Structure

```
env/
├── qa/          # QA environment configuration
├── uat/         # UAT environment configuration
└── prod/        # PROD environment configuration
```

## Usage

1. **For Local Development**: Copy the `.env.example` file to `.env` in the root directory and configure it.

2. **For Azure App Service**: Configure environment variables directly in Azure Portal:
   - Navigate to your App Service → Configuration → Application settings
   - Add each environment variable from the `.env.example` file

3. **For Pipeline Deployment**: Environment variables should be configured in Azure DevOps:
   - Go to Pipelines → Library → Variable Groups
   - Create variable groups for each environment (qa, uat, prod)
   - Add all required variables as secrets

## Security Notes

⚠️ **IMPORTANT**: 
- Never commit `.env` files with real credentials to git
- Use Azure DevOps Variable Groups with secret variables for sensitive data
- Use Azure Key Vault for production secrets
- Rotate secrets regularly

## Environment-Specific Variables

Each environment has its own:
- Database connection strings
- API keys and endpoints
- Encryption keys
- Service connection configurations

Refer to the `.env.example` files in each subdirectory for the required variables.

