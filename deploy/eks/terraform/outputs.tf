output "aws_account_id" {
  description = "AWS account targeted by this apply (verify on every laptop before apply)."
  value       = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  description = "Region used for this apply."
  value       = var.aws_region
}

output "vpc_created" {
  description = "Whether Terraform created a new VPC in this apply."
  value       = local.create_vpc
}

output "vpc_id" {
  description = "VPC used for a new cluster (empty when not creating)."
  value       = local.create_eks ? local.vpc_id : null
}

output "subnet_ids" {
  description = "Subnets used for a new cluster (empty when not creating)."
  value       = local.create_eks ? local.subnet_ids : []
}

output "eks_cluster_exists" {
  description = "Whether the cluster already existed before this apply."
  value       = local.eks_cluster_exists
}

output "eks_cluster_created" {
  description = "Whether Terraform created the EKS cluster in this apply."
  value       = local.create_eks
}

output "ecr_repository_url" {
  description = "ECR registry URL for docker push."
  value = local.create_ecr ? aws_ecr_repository.backend[0].repository_url : (
    local.ecr_exists ? data.aws_ecr_repository.existing[0].repository_url : null
  )
}

output "ecr_repository_arn" {
  description = "ECR repository ARN."
  value = local.create_ecr ? aws_ecr_repository.backend[0].arn : (
    local.ecr_exists ? data.aws_ecr_repository.existing[0].arn : null
  )
}

output "eks_cluster_endpoint" {
  description = "Kubernetes API endpoint."
  value       = local.create_eks ? module.eks[0].cluster_endpoint : data.aws_eks_cluster.existing[0].endpoint
}

output "eks_cluster_arn" {
  description = "EKS cluster ARN."
  value       = local.create_eks ? module.eks[0].cluster_arn : data.aws_eks_cluster.existing[0].arn
}

output "eks_oidc_issuer_url" {
  description = "OIDC issuer URL (for IRSA)."
  value       = local.create_eks ? module.eks[0].cluster_oidc_issuer_url : data.aws_eks_cluster.existing[0].identity[0].oidc[0].issuer
}

output "eks_cluster_vpc_id" {
  description = "VPC ID (ALB controller Helm needs this)."
  value       = local.create_eks ? local.vpc_id : data.aws_eks_cluster.existing[0].vpc_config[0].vpc_id
}

output "lb_controller_irsa_role_arn" {
  description = "IAM role ARN for AWS Load Balancer Controller."
  value = local.create_lb_irsa ? module.lb_controller_irsa[0].iam_role_arn : (
    local.iam_role_exists ? data.aws_iam_role.lb_controller_existing[0].arn : null
  )
}

output "next_steps" {
  description = "Post-apply reminders."
  value       = <<-EOT
    1. aws eks update-kubeconfig --name ${var.cluster_name} --region ${var.aws_region}
    2. Install AWS Load Balancer Controller (Helm) if not installed — see deploy/eks/scripts/install-aws-load-balancer-controller.sh
    3. Deploy app via GitLab CI or Helm (namespace devx)
  EOT
}
