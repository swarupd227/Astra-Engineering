# IAM role for AWS Load Balancer Controller (IRSA). Skipped if role already exists.

module "lb_controller_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.39"

  count = local.create_lb_irsa ? 1 : 0

  role_name                              = local.lb_controller_role_name
  attach_load_balancer_controller_policy = true

  oidc_providers = {
    eks = {
      provider_arn               = local.oidc_provider_arn_for_irsa
      namespace_service_accounts = [
        "kube-system:aws-load-balancer-controller",
      ]
    }
  }
}
