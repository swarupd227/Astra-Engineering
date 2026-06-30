# Create EKS when cluster astra-eks (or cluster_name) does not exist yet.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "= 20.31.6"

  count = local.create_eks ? 1 : 0

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  cluster_endpoint_public_access       = true
  cluster_endpoint_public_access_cidrs = var.public_access_cidrs

  vpc_id     = local.vpc_id
  subnet_ids = local.subnet_ids

  eks_managed_node_groups = {
    default = {
      name           = "default"
      ami_type       = var.node_ami_type
      instance_types = var.node_instance_types
      min_size       = max(1, var.node_desired_size - 1)
      max_size       = max(var.node_desired_size, 5)
      desired_size   = var.node_desired_size
    }
  }

  enable_cluster_creator_admin_permissions = true
}
