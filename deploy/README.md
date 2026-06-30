# DevX 2.0 — Deployment Guide

> **Amazon EKS (client self-hosted):** See **[docs/deployment/CLIENT_COMPLETE_SETUP_GUIDE.md](../docs/deployment/CLIENT_COMPLETE_SETUP_GUIDE.md)** for the full start-to-end client install guide (`Dockerfile` and `deploy/eks/` are in the repository root).

## Architecture Overview

DevX 2.0 supports two hosting modes controlled by a single environment variable:

| Mode | `DEVX_HOSTING` | Auth | LLM | Work Items | Config Source |
|------|----------------|------|-----|------------|---------------|
| **Azure** | `azure` | MSAL (Azure AD) | Azure OpenAI / Anthropic | Azure DevOps | `.env` file |
| **AWS** | `aws` | Cognito (Amplify) | Amazon Bedrock | Jira + Confluence | AWS Secrets Manager |

### Amazon EKS (Helm)

- Chart: `deploy/eks/helm/devx/` — sets `DEVX_HOSTING=aws`, `serviceAccountName: devx`, runtime secret on every `helm upgrade`.
- **IRSA** (SA `devx` + role `Astra-DevX-EKS-TaskRole`): create **once** with `eksctl`; Helm does **not** recreate IAM (`serviceAccount.create: false`).
- Pipeline: `azure-pipelines-eks.yml`. Details: `deploy/eks/helm/devx/README.md`.

---

## Local Development

### 1. Copy the env template

```bash
cp .env.example .env
```

### 2. Fill in your values

- Set `DEVX_HOSTING=aws` or `DEVX_HOSTING=azure`
- For AWS mode, provide `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, and `AWS_SECRET_NAME`
- For Azure mode, fill in the Azure-specific sections (ADO, Azure OpenAI, etc.)
- Set `VITE_*` vars for the frontend build

### 3. Run the dev server

```bash
npm install
npm run dev
```

The server starts on port 4000. When `DEVX_HOSTING=aws`, the server fetches runtime config from Secrets Manager at startup, overwriting hosting-specific keys from your `.env`.

---

## Production Deployment (AWS EC2)

### Prerequisites

- EC2 instance (Amazon Linux 2023 or Ubuntu 22.04+)
- IAM Instance Profile attached (see below)
- Security group allowing inbound TCP on port 4000
- RDS MySQL / Aurora instance accessible from the EC2 VPC
- Secrets Manager secret with all runtime config (see below)

### Step 1: Create the IAM Role

Create an IAM role for EC2 with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:ap-south-1:ACCOUNT_ID:secret:devx/platform/qa-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::devx-design-prompts-ap",
        "arn:aws:s3:::devx-design-prompts-ap/*"
      ]
    }
  ]
}
```

Attach this role as an **Instance Profile** to your EC2 instance. The app authenticates to AWS services automatically via IMDS — no explicit access keys needed.

### Step 2: Create the Secrets Manager Secret

Create a secret named `devx/platform/qa` (or your chosen name) in the same region as the EC2 instance. The value must be a flat JSON object with all runtime config:

```json
{
  "MYSQL_HOST": "devx-db.xxxx.ap-south-1.rds.amazonaws.com",
  "MYSQL_PORT": "3306",
  "MYSQL_USER": "devxadmin",
  "MYSQL_PASSWORD": "your-password",
  "MYSQL_DATABASE": "jiratest",
  "SESSION_SECRET": "generate-a-random-64-char-string",
  "PAT_ENCRYPTION_KEY": "your-encryption-key",
  "BEDROCK_MODEL_ID": "anthropic.claude-sonnet-4-20250514",
  "BEDROCK_REGION": "ap-south-1",
  "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx",
  "GITHUB_OWNER": "YourOrg",
  "GITHUB_REPO": "YourRepo",
  "S3_DESIGN_BUCKET": "devx-design-prompts-ap",
  "NAT_S3_BUCKET": "devx-design-prompts-ap",
  "NAT_S3_PREFIX": "NAT-Extensions",
  "JIRA_HOST": "https://yourorg.atlassian.net",
  "JIRA_EMAIL": "service@example.com",
  "JIRA_API_TOKEN": "your-jira-token",
  "CONFLUENCE_HOST": "https://yourorg.atlassian.net/wiki"
}
```

Add any additional keys your app needs. All keys will be injected into `process.env` at startup.

### Step 3: Build the Application

On your build machine (or CI/CD):

```bash
# Set VITE_* vars for the frontend build
export VITE_DEVX_HOSTING=aws
export VITE_COGNITO_USER_POOL_ID=ap-south-1_xxxxxxxxx
export VITE_COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
export VITE_COGNITO_REGION=ap-south-1
export VITE_COGNITO_DOMAIN=devx-platform

npm ci
npm run build
```

This produces:
- `dist/index.cjs` — bundled server
- `dist/public/` — static frontend assets
- `dist/server/assets/` — server-side assets

### Step 4: Deploy to EC2

Copy the project to the EC2 instance and run the setup script:

```bash
# On your local machine: copy files to EC2
scp -r ./dist ./package.json ./package-lock.json ./deploy ec2-user@YOUR_EC2_IP:/tmp/devx-deploy/

# On the EC2 instance:
cd /tmp/devx-deploy
sudo bash deploy/setup-ec2.sh
```

For subsequent deployments (code updates only):

```bash
sudo bash deploy/setup-ec2.sh --update
```

### Step 5: Verify

```bash
# Check service status
sudo systemctl status devx

# View live logs
sudo journalctl -u devx -f

# Test the health endpoint
curl http://localhost:4000/api/health
```

---

## How Config Loading Works

```
Startup Flow:
  1. dotenv.config()          → loads .env if present (no-op in production)
  2. isAwsHosting() check     → true when DEVX_HOSTING=aws
  3. loadSecrets()            → fetches from Secrets Manager
  4. Smart merge into process.env:
     - Production (no .env): ALL SM values injected (env is nearly empty)
     - Local dev (.env loaded): hosting-specific keys overwritten,
       local-only keys preserved
```

### What Goes Where

| Config | Local Dev (.env) | Production EC2 | Notes |
|--------|-----------------|----------------|-------|
| `DEVX_HOSTING=aws` | In .env | systemd env | Hosting mode selector |
| `AWS_ACCESS_KEY_ID` | In .env | NOT NEEDED | IAM role on EC2 |
| `AWS_REGION` | In .env | systemd env | SM region |
| `AWS_SECRET_NAME` | In .env | systemd env | SM secret name |
| `VITE_*` vars | In .env | Build-time only | Vite embeds at compile |
| `MYSQL_*`, `JIRA_*`, etc. | .env + SM overwrite | SM only | All runtime secrets |
| `USE_LOCAL_CODE_EXECUTION` | .env only | Not set | Dev-only flags |

---

## Updating Secrets

To update a secret value (e.g., rotate a database password):

1. Update the secret in AWS Secrets Manager console
2. Restart the service: `sudo systemctl restart devx`

The app re-fetches secrets from SM on every startup.

---

## Troubleshooting

### Service won't start

```bash
sudo journalctl -u devx --no-pager -n 50
```

Common issues:
- Missing IAM permissions → check Instance Profile
- Cannot reach SM → check VPC/subnet and security groups
- DB connection refused → check RDS security group allows the EC2 IP

### Secrets not loading

Look for `[SecretsLoader]` lines in the logs:
- `Mode: production (no .env)` — confirms no `.env` was detected
- `FATAL: Running in production mode without .env` — SM fetch failed, check IAM role

### Frontend shows wrong hosting mode

`VITE_DEVX_HOSTING` is a build-time variable. Rebuild the frontend with the correct value:

```bash
VITE_DEVX_HOSTING=aws npm run build
```
