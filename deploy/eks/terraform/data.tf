# Read existing cluster only when it already exists in the account (no create path).

data "aws_eks_cluster" "existing" {
  count = local.create_eks ? 0 : 1
  name  = var.cluster_name
}

data "aws_eks_cluster_auth" "existing" {
  count = local.create_eks ? 0 : 1
  name  = var.cluster_name
}

# OIDC provider already in IAM (brownfield). When precheck is off, always read; if missing, enable precheck or apply oidc.tf resource path.
data "aws_iam_openid_connect_provider" "cluster" {
  count = local.create_lb_irsa && !local.create_eks && (local.oidc_provider_exists || !var.run_aws_precheck) ? 1 : 0
  url   = replace(data.aws_eks_cluster.existing[0].identity[0].oidc[0].issuer, "https://", "")
}

data "aws_ecr_repository" "existing" {
  count = local.ecr_exists && !local.create_ecr ? 1 : 0
  name  = var.ecr_repository_name
}

data "aws_iam_role" "lb_controller_existing" {
  count = local.iam_role_exists && !local.create_lb_irsa ? 1 : 0
  name  = local.lb_controller_role_name
}
