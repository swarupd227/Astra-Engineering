# Astra / DevX 2.0 — Client Setup Guide  
## Source Code → Amazon EKS Deployment

This guide walks your team through deploying the **Astra Platform (DevX 2.0)** in **your own AWS account** using **Amazon EKS** and **Helm**, based on the Astra AWS Installation Guide v4 and the application source repository.

**Estimated time:** 4–8 hours (first environment)  
**Hosting mode:** `DEVX_HOSTING=aws` (Cognito, Bedrock, Jira, Secrets Manager)

---

## Table of contents

1. [What you receive](#1-what-you-receive)
2. [Architecture](#2-architecture)
3. [Prerequisites](#3-prerequisites)
4. [Phase 1 — Plan your environment](#4-phase-1--plan-your-environment)
5. [Phase 2 — AWS foundation](#5-phase-2--aws-foundation)
6. [Phase 3 — Database](#6-phase-3--database)
7. [Phase 4 — Amazon EKS](#7-phase-4--amazon-eks)
8. [Phase 5 — Build and push the container image](#8-phase-5--build-and-push-the-container-image)
9. [Phase 6 — Cluster add-ons (ALB controller)](#9-phase-6--cluster-add-ons-alb-controller)
10. [Phase 7 — Deploy with Helm](#10-phase-7--deploy-with-helm)
11. [Phase 8 — DNS, TLS, and optional CloudFront](#11-phase-8--dns-tls-and-optional-cloudfront)
12. [Phase 9 — Verification](#12-phase-9--verification)
13. [Phase 10 — CI/CD (optional)](#13-phase-10--cicd-optional)
14. [Operations and troubleshooting](#14-operations-and-troubleshooting)
15. [Deliverables checklist](#15-deliverables-checklist)

---

## 1. What you receive

| Item | Description |
|------|-------------|
| **Application source** | Full repository (React + Node.js API) |

| **Helm chart** | `deploy/eks/helm/devx/` — Kubernetes Deployment, Service, Ingress, HPA, PDB |
| **Terraform (optional)** | `deploy/eks/terraform/` — ECR, optional new EKS cluster, optional ALB IRSA |
| **Database docs** | `docs/database/DATABASE_REFERENCE.md`, `migrations/manual/SEED_DATA.sql` |
| **Environment template** | `.env.example` — bootstrap and build-time variables |
| **This guide** | End-to-end EKS setup |

The repository you receive includes `Dockerfile`, `deploy/eks/`, Helm charts, and database migrations in **one source tree**. Verify paths after clone (see `CLIENT_COMPLETE_SETUP_GUIDE.md` Section 2.1).

**Do not commit or share:** `.env` with real keys, Secrets Manager JSON exports, or database dumps with production data.

---

## 2. Architecture

```
                    Internet / corporate network
                              │
              ┌───────────────┴───────────────┐
              │  Route 53 + ACM (optional)   │
              │  CloudFront (optional CDN)    │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │  Application Load Balancer     │  ← AWS Load Balancer Controller
              │  (from Kubernetes Ingress)     │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────┐
              │  Amazon EKS                    │
              │  Namespace: devx (example)     │
              │  Pods: Node.js API + static UI │
              │  Port: 8080 (container)        │
              └───────┬───────────┬───────────┘
                      │           │
         ┌────────────▼──┐   ┌────▼────────────┐
         │ RDS Aurora     │   │ AWS services     │
         │ MySQL          │   │ Cognito, Bedrock │
         └────────────────┘   │ S3, Secrets Mgr  │
                              └──────────────────┘
```

**Request flow**

1. User opens `https://<your-domain>/` in a browser.
2. Traffic hits ALB (from Ingress) or NLB (legacy manual chart).
3. ALB forwards to Kubernetes Service → Pod on port **8080**.
4. Node.js serves `/api/*` (API) and static files from the built React app.
5. App loads runtime config from **Secrets Manager** when `DEVX_HOSTING=aws`.
6. App reads/writes **Aurora MySQL**.

---

## 3. Prerequisites

### AWS account

- Dedicated AWS account or isolated OU for production.
- IAM user/role with `PowerUserAccess` (initial setup) or scoped policies for EKS, RDS, ECR, Cognito, Secrets Manager, IAM, Route 53, ACM.
- Service limits verified: EKS nodes (3+), RDS instances, ECR repositories.

### Tools on the build/deploy machine

| Tool | Purpose |
|------|---------|
| `git` | Clone source |
| `docker` | Build image |
| `aws` CLI v2 | ECR, EKS, Secrets Manager |
| `kubectl` | Cluster access |
| `helm` 3 | Deploy chart |
| `eksctl` | OIDC + IRSA for ALB controller (recommended) |
| `terraform` ≥ 1.5 | Optional IaC in `deploy/eks/terraform/` |
| `node` 20+ & `npm` | Local build/test, DB migrations |

### Network

- VPC with **private subnets** (EKS nodes, RDS) and **public subnets** (ALB).
- Tag public subnets for ALB: `kubernetes.io/role/elb=1`.
- Security groups: RDS allows MySQL **3306** from EKS node security group only.

### Domain (recommended)

- Custom domain (e.g. `astra.yourcompany.com`).
- ACM certificate in the same region as ALB (or use CloudFront + ACM in `us-east-1`).

---

## 4. Phase 1 — Plan your environment

Fill this worksheet before creating resources:

| Setting | Your value (example) |
|---------|----------------------|
| AWS Region | `ap-south-1` |
| EKS cluster name | `astra-eks` |
| Kubernetes namespace | `devx` |
| Helm release name | `devx` |
| ECR repository | `devx/backend` |
| RDS database name | `astra_production` |
| Secrets Manager secret name | `astra/platform/production` |
| Cognito User Pool name | `Astra-Platform-Users` |
| S3 design bucket | `your-org-design-assets` |
| Bedrock region / model ID | e.g. `us-east-1` / Claude model ARN |

---

## 5. Phase 2 — AWS foundation

Create resources in this order.

### 5.1 VPC and subnets

- Use an existing VPC or create one with at least **two Availability Zones**.
- **Private subnets:** EKS worker nodes, RDS subnet group.
- **Public subnets:** ALB (when using Ingress with `internet-facing` scheme).

### 5.2 RDS Aurora MySQL

Recommended settings (adjust for your scale):

| Parameter | Recommendation |
|-----------|----------------|
| Engine | Aurora MySQL 8.0 compatible |
| Instance class | `db.r6g.large` or per sizing exercise |
| Multi-AZ | Enabled |
| Database name | Your chosen name |
| Encryption | Enabled at rest |
| SSL | Required for app connections |
| Backup | Per compliance (e.g. 7+ days) |
| Subnet group | Private subnets only |

Note the **cluster endpoint** — you will store it in Secrets Manager as `MYSQL_HOST`.

### 5.3 Amazon Cognito

> **Entra ID / SAML / callback URLs (client IAM):** See [AWS_ENTRA_COGNITO_AUTH_SETUP.md](./AWS_ENTRA_COGNITO_AUTH_SETUP.md).

1. Create a **User Pool** (email sign-in, password policy per your policy).
2. Create an **App client** (OAuth authorization code flow).
3. Set **callback URLs** (all four variants — see auth setup guide): `https://<your-domain>/auth/callback`, `/auth/callback/`, origin, origin `/`
4. Set **sign-out URLs**: `https://<your-domain>` and `https://<your-domain>/`
5. Optional: SAML / Azure AD identity provider (name **`Microsoft`** in Cognito).
6. Optional: User groups (Administrators, Developers, Viewers).

Record:

- `COGNITO_USER_POOL_ID`
- `COGNITO_APP_CLIENT_ID`
- `COGNITO_REGION`
- `COGNITO_DOMAIN`

These are required at **Docker build time** as `VITE_COGNITO_*` (see Phase 8).

### 5.4 S3 bucket

- Create a private bucket for design prompts / assets.
- Block public access.
- Grant the application IAM role `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on this bucket only.

### 5.5 AWS Secrets Manager

Create a secret (flat JSON), e.g. `astra/platform/production`:

```json
{
  "MYSQL_HOST": "your-cluster.cluster-xxxx.region.rds.amazonaws.com",
  "MYSQL_PORT": "3306",
  "MYSQL_USER": "app_user",
  "MYSQL_PASSWORD": "REPLACE",
  "MYSQL_DATABASE": "astra_production",
  "SESSION_SECRET": "REPLACE_64_CHAR_RANDOM",
  "PAT_ENCRYPTION_KEY": "REPLACE_32_PLUS_CHARS",
  "BEDROCK_REGION": "us-east-1",
  "BEDROCK_MODEL_ID": "your.foundation.model.id",
  "BEDROCK_EMBEDDING_MODEL_ID": "amazon.titan-embed-text-v2:0",
  "S3_DESIGN_BUCKET": "your-design-bucket",
  "NAT_S3_BUCKET": "your-design-bucket",
  "NAT_S3_PREFIX": "NAT-Extensions",
  "JIRA_HOST": "https://yourorg.atlassian.net",
  "JIRA_EMAIL": "service@yourorg.com",
  "JIRA_API_TOKEN": "REPLACE",
  "CONFLUENCE_HOST": "https://yourorg.atlassian.net/wiki",
  "GITHUB_TOKEN": "REPLACE",
  "GITHUB_OWNER": "YourOrg",
  "GITHUB_REPO": "YourRepo",
  "GITHUB_BRANCH": "main",
  "FEATURE_SDLC": "true",
  "FEATURE_QUICK_WORKFLOW": "false",
  "FEATURE_STACK_MODERNIZATION": "false"
}
```

Add any additional keys your contract requires. The server merges these into `process.env` at startup (`server/secrets-loader.ts`).

### 5.6 IAM — application task role (IRSA)

Create an IAM role for the Kubernetes **ServiceAccount** (IRSA) with least privilege:

- `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` — scoped to specific model ARNs
- `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` — your bucket only
- `secretsmanager:GetSecretValue` — your secret path only
- `cognito-idp:AdminGetUser`, `cognito-idp:AdminListGroupsForUser` — your user pool only

Annotate the Helm ServiceAccount with:

`eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT:role/Astra-EKS-TaskRole`

Set pod environment (bootstrap only):

```yaml
DEVX_HOSTING: aws
AWS_REGION: ap-south-1
AWS_SECRET_NAME: astra/platform/production
NODE_ENV: production
PORT: "8080"
DEVX_REPO_ROOT: /app   # match your container WORKDIR
```

---

## 6. Phase 3 — Database

### 6.1 Automated migrations (recommended for EKS)

The Helm chart runs a **pre-install / pre-upgrade Job** that applies all SQL in `migrations/migration-order.json` (baseline + incrementals + optional seed). Defaults are in `deploy/eks/helm/devx/values.yaml`:

```yaml
migrations:
  runAsJob: true
  seed: "true"
  strict: "true"
```

Ensure the Kubernetes secret (`mysql.existingSecret`, default `devx-runtime-env`) includes `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`.

On `helm upgrade --install`, check the migration Job:

```bash
kubectl get jobs -n devx
kubectl logs -n devx job/<release>-db-migrate-<revision>
```

**Client guide (full):** `docs/deployment/CLIENT_DATABASE_MIGRATION_GUIDE.md`  
**Quick reference:** `migrations/CLIENT_DATABASE_SETUP.md`

### 6.2 Manual migrations (CI or laptop)

From a machine that can reach Aurora:

```bash
cp .env.example .env
# Set MYSQL_*

npm ci
RUN_DB_SEED=true npm run migrate:dev
npm run check:schema
```

This runs: `baseline/00_full_schema.sql` (all tables) → manual incrementals → `manual/02_seed.sql`.

Regenerate baseline from live DB: `npm run generate:full-schema` (requires `MYSQL_*` in `.env`).

### 6.3 Container startup alternative (single replica only)

Set on the app Deployment instead of the Job:

```yaml
RUN_DB_MIGRATIONS: "true"
RUN_DB_SEED: "true"
```

Only use when `migrations.runAsJob: false` and `replicaCount: 1`.

### 6.4 Verify

```sql
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE';

SELECT migration_name, status, executed_at
FROM schema_migrations ORDER BY executed_at DESC LIMIT 20;

SELECT * FROM subscription_types;
SELECT * FROM roles ORDER BY id;
```

Users and tenants are usually created on first login (Cognito / Azure AD).

---

## 7. Phase 4 — Amazon EKS

### Option A — Use Terraform (recommended for ECR only)

```bash
cd deploy/eks/terraform/
cp terraform.tfvars.example terraform.tfvars
# Edit: aws_region, cluster_name, ecr_repository_name, toggles

terraform init
terraform plan -var-file=terraform.tfvars -out=astra.tfplan
terraform apply astra.tfplan
```

Default toggles in the reference package:

| Variable | Typical first apply |
|----------|---------------------|
| `create_ecr_repository` | `true` |
| `create_eks_cluster` | `false` (use existing cluster) |
| `create_lb_controller_irsa` | `false` (use eksctl script instead) |

### Option B — Create a new EKS cluster

Set `create_eks_cluster = true` and provide `vpc_id` + `private_subnet_ids` (≥2 AZs).

Or create the cluster with AWS Console / `eksctl` per your standards.

### Configure kubectl

```bash
aws eks update-kubeconfig --region <REGION> --name <CLUSTER_NAME>
kubectl get nodes
```

Ensure nodes are `Ready`.

---

## 8. Phase 5 — Build and push the container image

### 8.1 Clone the repository

```bash
git clone <repository-url>
cd <repo>
git checkout <branch-or-tag-from-vendor>
```

Verify: `Dockerfile`, `deploy/eks/helm/devx/Chart.yaml`, and `deploy/eks/scripts/install-aws-load-balancer-controller.sh` exist.

### 8.2 Set build-time variables (frontend)

Cognito and feature flags are embedded at **build time**:

```bash
export DEVX_HOSTING=aws
export VITE_DEVX_HOSTING=aws
export VITE_COGNITO_USER_POOL_ID=<your-pool-id>
export VITE_COGNITO_APP_CLIENT_ID=<your-client-id>
export VITE_COGNITO_REGION=<region>
export VITE_COGNITO_DOMAIN=<cognito-domain-prefix>
export VITE_FEATURE_SDLC=true
export VITE_FEATURE_QUICK_WORKFLOW=false
export VITE_FEATURE_STACK_MODERNIZATION=false
```

### 8.3 Build and push to ECR

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)
AWS_REGION=<region>
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

aws ecr create-repository --repository-name devx/backend --region $AWS_REGION 2>/dev/null || true

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin $ECR_REGISTRY

docker build -t devx/backend:${IMAGE_TAG} .
docker tag devx/backend:${IMAGE_TAG} ${ECR_REGISTRY}/devx/backend:${IMAGE_TAG}
docker push ${ECR_REGISTRY}/devx/backend:${IMAGE_TAG}
```

---

## 9. Phase 6 — Cluster add-ons (ALB controller)

**Run once per cluster** before Ingress-based deploys.

Use the script from the repository:

`deploy/eks/scripts/install-aws-load-balancer-controller.sh`

Or follow the manual steps in the installation guide:

1. Download AWS Load Balancer Controller IAM policy JSON.
2. `eksctl utils associate-iam-oidc-provider --cluster=<name> --approve`
3. `eksctl create iamserviceaccount` for `kube-system/aws-load-balancer-controller`
4. `helm install aws-load-balancer-controller` from `eks/aws-load-balancer-controller` chart

Verify:

```bash
kubectl get deployment -n kube-system aws-load-balancer-controller
kubectl get ingressclass
# Should show 'alb'
```

**Public subnet tagging:** `kubernetes.io/role/elb=1` on subnets used by the ALB.

---

## 10. Phase 7 — Deploy with Helm

### 10.1 Create namespace and DB secret (if not using External Secrets)

```bash
kubectl create namespace devx

kubectl create secret generic devx-mysql \
  --namespace devx \
  --from-literal=MYSQL_HOST='your-aurora-endpoint' \
  --from-literal=MYSQL_PORT='3306' \
  --from-literal=MYSQL_USER='app_user' \
  --from-literal=MYSQL_PASSWORD='***' \
  --from-literal=MYSQL_DATABASE='astra_production'
```

Production: prefer **External Secrets Operator** syncing from Secrets Manager instead of `kubectl create secret` with plaintext.

### 10.2 Install / upgrade Helm release

Chart path: `deploy/eks/helm/devx/`

```bash
helm upgrade --install devx deploy/eks/helm/devx \
  --namespace devx \
  --create-namespace \
  --set image.repository=${ECR_REGISTRY}/devx/backend \
  --set image.tag=${IMAGE_TAG} \
  --set ingress.enabled=true \
  --set mysql.existingSecret=devx-mysql \
  --wait --timeout 25m
```

Edit `values.yaml` for your environment:

| Area | Typical settings |
|------|------------------|
| `replicaCount` | `2` |
| `containerPort` | `8080` |
| `resources` | requests/limits per sizing |
| `ingress.annotations` | ALB scheme, health check `/healthz`, security groups |
| `autoscaling.enabled` | `true` when ready |

**Legacy manual chart:** Some packages include `devx-backend-chart/` with `LoadBalancer` → NLB instead of ALB Ingress. Prefer `deploy/eks/helm/devx` for new deployments.

### 10.3 Rollout status

```bash
kubectl get pods,svc,ingress -n devx
kubectl rollout status deployment/devx -n devx
helm status devx -n devx
```

First ALB provisioning may take **2–3 minutes**.

---

## 11. Phase 8 — DNS, TLS, and optional CloudFront

### 11.1 ALB hostname

```bash
kubectl get ingress devx -n devx \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}{"\n"}'
```

### 11.2 Route 53

Create a CNAME or alias record pointing your domain to the ALB hostname.

### 11.3 ACM + HTTPS

- Request ACM certificate for your domain.
- Configure Ingress annotations for HTTPS listener (per Helm chart / ALB controller docs).
- Update Cognito callback URLs to `https://<your-domain>/...`

### 11.4 CloudFront (optional)

- Origin: ALB DNS name (HTTP to origin; HTTPS at viewer).
- Use for global CDN and WAF attachment.
- Update Cognito URLs if the user-facing URL is the CloudFront domain.

---

## 12. Phase 9 — Verification

| Check | Command / URL |
|-------|----------------|
| Pods healthy | `kubectl get pods -n devx` |
| Health endpoint | `https://<domain>/healthz` or `/api/health` |
| Login | Cognito sign-in from UI |
| Database | No connection errors in pod logs |
| Bedrock | Run an AI feature; check IAM and model access |
| Static UI | Home page loads; client routes work (SPA) |

**Logs:**

```bash
kubectl logs -n devx -l app.kubernetes.io/name=devx -f --tail=100
```

**Rollback:**

```bash
helm rollback devx -n devx
```

---

## 13. Phase 10 — CI/CD (Azure DevOps)

Pipeline `azure-pipelines-eks.yml` (or EKS job in `azure-pipelines.yml`):

1. Build Docker image with `VITE_DEVX_HOSTING=aws` and `VITE_COGNITO_*`  
2. Push to ECR with build ID tag  
3. `helm upgrade --install` using `deploy/eks/helm/devx`

**Helm chart persists AWS runtime (do not rely on manual `kubectl set env` after each deploy):**

| Setting | Helm source |
|---------|-------------|
| `DEVX_HOSTING=aws` | `values.yaml` → `env.devxHosting` |
| `AWS_REGION`, `AWS_SECRET_NAME` | `values.yaml` → `env.*` |
| `serviceAccountName: devx` | `values.yaml` → `serviceAccount.name` |
| IRSA role | `templates/serviceaccount.yaml` + `serviceAccount.roleArn` |
| DB/runtime keys | `mysql.existingSecret` (default `devx-runtime-env`) |

**One-time IRSA (before first successful AWS deploy):**

```bash
eksctl utils associate-iam-oidc-provider --cluster=astra-eks --region=ap-south-1 --approve
eksctl create iamserviceaccount \
  --cluster=astra-eks --region=ap-south-1 --namespace=devx --name=devx \
  --role-name=Astra-DevX-EKS-TaskRole \
  --attach-policy-arn=<same policies as EC2> \
  --override-existing-serviceaccounts --approve
```

Helm sets `serviceAccountName: devx` only (`serviceAccount.create: false`). IRSA role is **not** recreated by Helm.

**Cognito app client (console):** enable scope `aws.cognito.signin.user.admin` on the app client (matches `amplify-config.ts` scopes). Callback URLs must match your CloudFront/ALB URL.

**Pipeline variables:**

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`, `EKS_CLUSTER_NAME`, `EKS_NAMESPACE`
- `MYSQL_SECRET_NAME` (e.g. `devx-runtime-env`)
- `EKS_SA_ROLE_ARN` (IRSA role ARN; optional override)

See `deploy/eks/helm/devx/README.md` for full steps.

---

## 14. Operations and troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Ingress stays Pending | ALB controller not installed or subnets untagged | Phase 6; check subnet tags |
| Pods CrashLoopBackOff | Missing env / SM / DB | `kubectl describe pod`; check logs |
| 502 / no response | Wrong port (use **8080** in K8s) | Verify Service `targetPort` |
| DB connection refused | RDS SG blocks EKS nodes | Allow 3306 from node SG |
| Cognito redirect error | Callback URL mismatch | Update Cognito app client URLs |
| AI features fail | Bedrock IAM or wrong region | Task role policy + `BEDROCK_REGION` |
| Frontend wrong auth mode | `VITE_*` not set at build | Rebuild image with Cognito vars |

**WebSockets:** If using the Chrome extension behind ALB, configure `EXTENSION_WS_PUBLIC_URL` per `.env.example` (direct endpoint or separate WS ingress).

**Updates:** Rebuild image → `helm upgrade` with new tag. Run pending DB migrations before or after deploy per your change window.

---

## 15. Deliverables checklist

Hand off to your operations team:

- [ ] Source repo cloned; required paths verified (Section 2.1 in complete guide)  
- [ ] `docs/deployment/EKS_CLIENT_SETUP_GUIDE.md` (this file)  
- [ ] `docs/database/DATABASE_REFERENCE.md` + `migrations/manual/SEED_DATA.sql`  
- [ ] `.env.example` (no secrets)  
- [ ] Helm chart `deploy/eks/helm/devx/`  
- [ ] Terraform `deploy/eks/terraform/` (optional)  
- [ ] Runbook: secret name, cluster name, namespace, ECR repo, domain  
- [ ] Cognito pool/client IDs for rebuilds  
- [ ] Support contact for version upgrades  

---

## Quick reference — command sequence

```bash
# 1. Database
npm run migrate:dev && mysql ... < migrations/manual/SEED_DATA.sql

# 2. ECR
docker build -t ... && docker push ...

# 3. Cluster access
aws eks update-kubeconfig --name astra-eks --region ap-south-1

# 4. ALB controller (once)
bash deploy/eks/scripts/install-aws-load-balancer-controller.sh

# 5. Deploy
helm upgrade --install devx deploy/eks/helm/devx \
  --namespace devx --create-namespace \
  --set image.repository=... --set image.tag=...

# 6. Verify
kubectl get ingress -n devx
curl -k https://<domain>/healthz
```

---

*Based on Astra AWS Installation Guide v4 (EKS / Helm / Terraform) and DevX 2.0 application repository. Adjust names, regions, and ARNs for your organization.*
