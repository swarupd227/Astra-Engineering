# DevX EKS — Terraform (platform bootstrap)

Matches the existing DevX EKS strategy: **Terraform → LB controller script → GitLab CI / Helm**.

## Portable across laptops and AWS accounts

This module is **not tied to one machine or one AWS account**.

| What travels in git | What stays on each laptop |
|---------------------|---------------------------|
| `.tf` files, defaults, `terraform.tfvars.example` | AWS credentials (`aws configure`, SSO, or env vars) |
| No hardcoded account IDs | Optional `terraform.tfvars` (copy from example, gitignored) |
| Optional `backend.tf.example` for shared state | Local `.terraform/` until `terraform init` |

**Any teammate** can clone the repo, configure credentials for **their** account, copy `terraform.tfvars.example` → `terraform.tfvars`, adjust `aws_region` / `cluster_name` if needed, then run `terraform plan`.

After `terraform apply`, check the plan output **`aws_account_id`** — it must match the account you intend.

```powershell
cp terraform.tfvars.example terraform.tfvars
# edit aws_region, cluster_name, aws_profile as needed
terraform plan   # confirm aws_account_id in outputs
```

**State:** By default, state is local (`terraform.tfstate` on that laptop). For multiple people on the **same** account, use remote state — see `backend.tf.example`.

**Defaults** (`astra-eks`, `us-east-1`, `devx/backend`) are DevX project conventions only; override them per account or environment in `terraform.tfvars`.

## Prerequisites (tools only)

You do **not** need a VPC, EKS cluster, ECR repo, or IAM role before `terraform apply`. Terraform creates them when missing (default greenfield).

| Required | Purpose |
|----------|---------|
| Terraform >= 1.5 | Plan/apply |
| AWS credentials | Provider + precheck (`aws configure`, env vars, or SSO) |
| AWS CLI v2 | Optional existence probe (recommended) |
| PowerShell | Default precheck on Windows |
| bash + jq | Linux/CloudShell — set `precheck_use_bash = true` |

If AWS CLI is unavailable, set `run_aws_precheck = false` (do not set `ecr_already_exists` / `lb_controller_role_already_exists` unless those resources truly exist).

## Default behaviour (greenfield)

When **astra-eks** does not exist and **vpc_id** / **private_subnet_ids** are not set:

1. **Creates a new VPC** (`10.0.0.0/16`, 2 AZs, NAT gateway, public + private subnets)
2. **Creates EKS** cluster **astra-eks** + node group
3. **Creates ECR** `devx/backend` (if missing)
4. **Creates IAM** role for AWS Load Balancer Controller (if missing)
5. **Creates IAM OIDC provider** for IRSA when the cluster exists but OIDC is not registered yet

Precheck returns `false` for missing ECR/IAM/OIDC — that is expected and does **not** fail the plan.

## Use existing VPC instead

In `terraform.tfvars`:

```hcl
create_vpc         = false
vpc_id             = "vpc-xxxxxxxx"
private_subnet_ids = ["subnet-aaa", "subnet-bbb"]
```

## Apply

```powershell
cd deploy/eks/terraform
terraform init
terraform plan
terraform apply
```

## After apply

```bash
aws eks update-kubeconfig --name <cluster_name> --region <aws_region>
bash deploy/eks/scripts/install-aws-load-balancer-controller.sh
```

Use the same `cluster_name` and `aws_region` as in your `terraform.tfvars`.

Then GitLab CI / Helm (`deploy/eks/helm/devx`, namespace `devx`).

## Cost note

A new VPC includes a **NAT gateway** (hourly charge). Use `create_vpc = false` and an existing VPC to avoid that.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `No valid credential sources` | Configure AWS credentials before plan/apply |
| `lookup sts.<region>.amazonaws.com: no such host` | Keep `use_global_sts_endpoint = true` (default) so Terraform authenticates via `sts.amazonaws.com`; this avoids regional STS DNS issues on some networks. |
| `ecr_already_exists = true but repository ... not found` | Set `ecr_already_exists = false` (greenfield default) |
| `lb_controller_role_already_exists = true but IAM role ... not found` | Set `lb_controller_role_already_exists = false` |
| Precheck fails on Linux | `precheck_use_bash = true` or `run_aws_precheck = false` |
| `Cannot create EKS` network check | Use `create_vpc = true` (default) or pass `vpc_id` + 2+ subnets |
