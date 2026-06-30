# ECR / IAM / OIDC existence — optional AWS CLI probe. Missing resources => create (never a hard error).

locals {
  precheck_program = var.precheck_use_bash ? [
    "bash",
    "${path.module}/scripts/aws-precheck.sh",
    ] : [
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "${path.module}/scripts/aws-precheck.ps1",
  ]
}

data "external" "precheck" {
  count = var.run_aws_precheck ? 1 : 0

  program = local.precheck_program

  query = {
    region        = var.aws_region
    ecr_name      = var.ecr_repository_name
    iam_role      = local.lb_controller_role_name
    cluster_name  = var.cluster_name
  }
}

locals {
  precheck_ecr_exists  = var.run_aws_precheck ? (try(data.external.precheck[0].result.ecr_exists, "false") == "true") : var.ecr_already_exists
  precheck_iam_exists  = var.run_aws_precheck ? (try(data.external.precheck[0].result.iam_role_exists, "false") == "true") : var.lb_controller_role_already_exists
  precheck_oidc_exists = var.run_aws_precheck ? (try(data.external.precheck[0].result.oidc_provider_exists, "false") == "true") : false

  ecr_exists = var.ecr_already_exists || local.precheck_ecr_exists
  iam_role_exists = var.lb_controller_role_already_exists || local.precheck_iam_exists
  oidc_provider_exists = local.precheck_oidc_exists

  # Keep resources under Terraform control during create/recovery runs.
  create_ecr = var.create_ecr_repository && (local.create_eks || !local.ecr_exists)

  create_lb_irsa = (var.create_lb_controller_irsa || local.create_eks) && (local.create_eks || !local.iam_role_exists)
}
