# -----------------------------------------------------------------------------
# DevX EKS platform — Terraform (deploy/eks/terraform/)
#
# Greenfield (defaults): creates VPC, EKS, ECR, LB-controller IAM when missing.
# Brownfield: detects existing cluster/resources and reuses them.
#
# Prerequisites (tools only — no pre-created VPC/cluster/ECR/IAM):
#   - Terraform >= 1.5
#   - AWS credentials (aws configure / env vars / SSO)
#   - AWS CLI v2
#   - PowerShell (Windows, default precheck) OR bash + jq (set precheck_use_bash = true)
#
# Quick start:
#   cd deploy/eks/terraform
#   terraform init
#   terraform plan
#   terraform apply
# -----------------------------------------------------------------------------
