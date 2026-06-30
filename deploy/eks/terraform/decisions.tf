# Create vs reuse — EKS cluster detection (AWS API only, no bash).

data "aws_eks_clusters" "all" {}

locals {
  eks_cluster_exists = contains(data.aws_eks_clusters.all.names, var.cluster_name)
  create_eks         = !local.eks_cluster_exists || var.create_eks_cluster

  # Derived from cluster_name so any laptop/account can override cluster_name only.
  lb_controller_role_name = var.lb_controller_role_name != "" ? var.lb_controller_role_name : "AmazonEKSLoadBalancerControllerRole-${var.cluster_name}"
}
