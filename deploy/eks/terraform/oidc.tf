# OIDC provider for IRSA on an existing cluster (EKS module creates OIDC when create_eks = true).

data "tls_certificate" "eks_oidc" {
  count = local.create_lb_irsa && !local.create_eks && !local.oidc_provider_exists ? 1 : 0
  url   = data.aws_eks_cluster.existing[0].identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  count = local.create_lb_irsa && !local.create_eks && var.run_aws_precheck && !local.oidc_provider_exists ? 1 : 0

  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks_oidc[0].certificates[0].sha1_fingerprint]
  url             = data.aws_eks_cluster.existing[0].identity[0].oidc[0].issuer
}

locals {
  oidc_provider_arn_for_irsa = local.create_lb_irsa ? (
    local.create_eks ? module.eks[0].oidc_provider_arn : (
      (local.oidc_provider_exists || !var.run_aws_precheck) ? data.aws_iam_openid_connect_provider.cluster[0].arn : aws_iam_openid_connect_provider.eks[0].arn
    )
  ) : null
}
