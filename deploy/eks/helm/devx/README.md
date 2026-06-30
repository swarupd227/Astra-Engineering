# DevX Helm chart (EKS)

Persists **AWS hosting**, **IRSA service account**, and **runtime secret** on every `helm upgrade` (so Azure Pipeline deploys do not reset manual `kubectl` fixes).

## One-time (AWS / CloudShell)

### 1. Load Balancer Controller

```bash
aws eks update-kubeconfig --name astra-eks --region ap-south-1
bash deploy/eks/scripts/install-aws-load-balancer-controller.sh
```

### 2. IRSA for app pods (same IAM policies as EC2)

```bash
# OIDC provider (idempotent)
eksctl utils associate-iam-oidc-provider --cluster=astra-eks --region=ap-south-1 --approve

# Create SA devx + IAM role (attach the same 4 policies used on EC2)
eksctl create iamserviceaccount \
  --cluster=astra-eks \
  --region=ap-south-1 \
  --namespace=devx \
  --name=devx \
  --role-name=Astra-DevX-EKS-TaskRole \
  --attach-policy-arn=arn:aws:iam::aws:policy/... \
  --override-existing-serviceaccounts \
  --approve
```

Note the role ARN:

```bash
kubectl describe sa devx -n devx | grep role-arn
```

Put that ARN in `values.yaml` → `serviceAccount.roleArn`.

### 3. Kubernetes secret from Secrets Manager

Create `devx-runtime-env` in namespace `devx` with keys from your SM secret (`devx/platform/qa`): `MYSQL_*`, `COGNITO_*`, `JIRA_*`, etc.

### 4. Cognito app client

Callback URLs must include your public URL (CloudFront), e.g.:

- `https://<cloudfront-domain>/auth/callback`
- `https://<cloudfront-domain>/`
- App client: **no client secret** (public SPA)

## Every release (Azure Pipeline)

Pipeline `azure-pipelines-eks.yml`:

1. Docker build with `VITE_DEVX_HOSTING=aws` and `VITE_COGNITO_*`
2. Push to ECR `devx/backend:<BuildId>`
3. `helm upgrade --install devx` with this chart

Helm applies automatically:

| Setting | Source |
|---------|--------|
| `DEVX_HOSTING=aws` | `values.yaml` → `env.devxHosting` |
| `AWS_REGION`, `AWS_SECRET_NAME` | `values.yaml` → `env.*` |
| `serviceAccountName: devx` | `values.yaml` → `serviceAccount.name` |
| IRSA (eksctl SA `devx`) | `serviceAccountName: devx` only (`create: false`) |
| DB/runtime keys | `mysql.existingSecret` (default `devx-runtime-env`) |
| DB migrations (pre-upgrade Job) | `migrations.runAsJob: true` (see `migrations/CLIENT_DATABASE_SETUP.md`) |

Override without editing files:

```bash
helm upgrade --install devx deploy/eks/helm/devx \
  --namespace devx \
  --set image.repository=860829110416.dkr.ecr.ap-south-1.amazonaws.com/devx/backend \
  --set image.tag=1234 \
  --set mysql.existingSecret=devx-runtime-env \
  --set serviceAccount.roleArn=arn:aws:iam::860829110416:role/Astra-DevX-EKS-TaskRole
```

## Database migrations

By default a Helm **pre-install/pre-upgrade Job** runs `migrations/migration-order.json` (baseline + incrementals + seed). Disable only for brownfield DBs where SQL was applied manually:

```bash
helm upgrade --install devx deploy/eks/helm/devx --set migrations.runAsJob=false ...
```

Check migration Job logs:

```bash
kubectl get jobs -n devx
kubectl logs -n devx job/devx-db-migrate-<revision>
```

## Verify after deploy

```bash
kubectl get deployment devx -n devx -o jsonpath='{.spec.template.spec.serviceAccountName}{"\n"}'
kubectl set env deployment/devx -n devx --list | grep DEVX_HOSTING
kubectl logs -n devx -l app.kubernetes.io/instance=devx --tail=30 | grep DEVX_HOSTING
```

Expected: `serviceAccountName=devx`, `DEVX_HOSTING=aws`, Cognito JWT validation on API.

## What manual kubectl fixed (now in chart)

| Manual command | Helm equivalent |
|----------------|-----------------|
| `kubectl set env ... DEVX_HOSTING=aws` | `deployment.yaml` env block |
| `kubectl patch ... serviceAccountName: devx` | `deployment.yaml` `serviceAccountName` |
| eksctl IRSA | `serviceaccount.yaml` + one-time eksctl |
