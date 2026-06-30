# VPC / subnets for new EKS: create VPC (default), or use existing VPC / explicit ids.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Greenfield: create VPC + subnets when no vpc_id / subnet list supplied.
  create_vpc = local.create_eks && var.create_vpc && var.vpc_id == "" && length(var.private_subnet_ids) == 0
}

data "aws_vpcs" "default" {
  count = local.create_eks && !local.create_vpc && var.vpc_id == "" ? 1 : 0

  filter {
    name   = "isDefault"
    values = ["true"]
  }
}

data "aws_vpcs" "any" {
  count = local.create_eks && !local.create_vpc && var.vpc_id == "" && length(try(data.aws_vpcs.default[0].ids, [])) == 0 ? 1 : 0
}

data "aws_subnets" "in_vpc" {
  count = local.create_eks && !local.create_vpc && local.vpc_id != "" && length(var.private_subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }
}

data "aws_subnet" "selected" {
  for_each = local.create_eks && !local.create_vpc && local.vpc_id != "" && length(var.private_subnet_ids) == 0 ? toset(try(data.aws_subnets.in_vpc[0].ids, [])) : toset([])

  id = each.value
}

locals {
  vpc_id = var.vpc_id != "" ? var.vpc_id : (
    local.create_vpc ? module.vpc[0].vpc_id : try(
      data.aws_vpcs.default[0].ids[0],
      try(data.aws_vpcs.any[0].ids[0], "")
    )
  )

  subnet_ids_per_az = {
    for id, subnet in data.aws_subnet.selected : subnet.availability_zone => id...
  }

  discovered_subnet_ids = slice(values(local.subnet_ids_per_az), 0, min(3, length(local.subnet_ids_per_az)))

  subnet_ids = length(var.private_subnet_ids) > 0 ? var.private_subnet_ids : (
    local.create_vpc ? module.vpc[0].private_subnets : local.discovered_subnet_ids
  )
}

# Extra tags only when reusing an existing VPC (created VPC module already tags subnets).
resource "aws_ec2_tag" "cluster_subnet_shared" {
  for_each = local.create_eks && !local.create_vpc ? toset(local.subnet_ids) : toset([])

  resource_id = each.value
  key         = "kubernetes.io/cluster/${var.cluster_name}"
  value       = "shared"
}

resource "aws_ec2_tag" "subnet_internal_elb" {
  for_each = local.create_eks && !local.create_vpc ? toset(local.subnet_ids) : toset([])

  resource_id = each.value
  key         = "kubernetes.io/role/internal-elb"
  value       = "1"
}

resource "aws_ec2_tag" "subnet_public_elb" {
  for_each = local.create_eks && !local.create_vpc ? toset(local.subnet_ids) : toset([])

  resource_id = each.value
  key         = "kubernetes.io/role/elb"
  value       = "1"
}
