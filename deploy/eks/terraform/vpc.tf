# New VPC for greenfield EKS (default when vpc_id / subnets are not provided).

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.16"

  count = local.create_vpc ? 1 : 0

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs = slice(data.aws_availability_zones.available.names, 0, var.vpc_az_count)

  private_subnets = [for i in range(var.vpc_az_count) : cidrsubnet(var.vpc_cidr, 4, i)]
  public_subnets  = [for i in range(var.vpc_az_count) : cidrsubnet(var.vpc_cidr, 8, i + 48)]

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Some org SCPs deny mutating default VPC resources (for example default NACL entries).
  # Keep them unmanaged to avoid UnauthorizedOperation during apply.
  manage_default_network_acl    = var.manage_default_network_acl
  manage_default_route_table    = var.manage_default_route_table
  manage_default_security_group = var.manage_default_security_group

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  tags = var.default_tags
}
