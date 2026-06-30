variable "aws_region" {
  type        = string
  description = "AWS region for this apply (any region your account supports)."
  default     = "us-east-1"
}

variable "aws_profile" {
  type        = string
  description = "Optional AWS CLI profile (SSO or named profile). Leave empty to use default credential chain on this machine."
  default     = ""
}

variable "use_global_sts_endpoint" {
  type        = bool
  description = "Use https://sts.amazonaws.com for provider auth calls. Helpful when regional STS DNS (for example sts.<region>.amazonaws.com) cannot be resolved on local/corporate networks."
  default     = true
}

variable "cluster_name" {
  type        = string
  description = "EKS cluster name in the target AWS account. Created automatically if it does not exist."
  default     = "astra-eks"
}

variable "ecr_repository_name" {
  type        = string
  description = "ECR repository name for DevX backend images."
  default     = "devx/backend"
}

variable "create_ecr_repository" {
  type        = bool
  description = "Create ECR repository when it does not already exist."
  default     = true
}

variable "run_aws_precheck" {
  type        = bool
  description = "Probe AWS for existing ECR/IAM/OIDC via CLI (missing resources => Terraform creates them). Set false only if CLI is unavailable."
  default     = true
}

variable "precheck_use_bash" {
  type        = bool
  description = "Use bash + jq precheck script (Linux/macOS/CloudShell). Default false uses PowerShell (Windows)."
  default     = false
}

variable "ecr_already_exists" {
  type        = bool
  description = "Skip ECR create when true (or when precheck detects the repo)."
  default     = false
}

variable "lb_controller_role_already_exists" {
  type        = bool
  description = "Skip LB controller IAM role create when true (or when precheck detects the role)."
  default     = false
}

variable "create_eks_cluster" {
  type        = bool
  description = "Force EKS cluster creation. Normally not needed: Terraform creates the cluster automatically when cluster_name is missing in the account."
  default     = false
}

variable "cluster_version" {
  type        = string
  description = "Kubernetes version when creating a new cluster."
  default     = "1.29"
}

variable "node_ami_type" {
  type        = string
  description = "EKS managed node group AMI type. Use AL2023_x86_64_STANDARD for current Kubernetes versions."
  default     = "AL2023_x86_64_STANDARD"
}

variable "create_vpc" {
  type        = bool
  description = "Create a new VPC with public/private subnets + NAT when creating EKS and vpc_id/subnets are not set (recommended greenfield default)."
  default     = true
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR for a new VPC when create_vpc = true."
  default     = "10.0.0.0/16"
}

variable "vpc_az_count" {
  type        = number
  description = "Number of AZs for a new VPC (minimum 2)."
  default     = 2

  validation {
    condition     = var.vpc_az_count >= 2
    error_message = "vpc_az_count must be at least 2 for EKS."
  }
}

variable "vpc_id" {
  type        = string
  description = "Use an existing VPC instead of create_vpc. Leave empty to create a new VPC (default)."
  default     = ""
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Use existing subnets instead of create_vpc. At least two IDs in different AZs. Leave empty when create_vpc = true."
  default     = []
}

variable "public_access_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach the public Kubernetes API endpoint on a new cluster."
  default     = ["0.0.0.0/0"]
}

variable "node_instance_types" {
  type        = list(string)
  description = "Instance types for the default managed node group on a new cluster."
  default     = ["m5.large"]
}

variable "node_desired_size" {
  type        = number
  description = "Desired worker count on a new cluster."
  default     = 2
}

variable "create_lb_controller_irsa" {
  type        = bool
  description = "Create IAM role for AWS Load Balancer Controller when it does not exist. Also created automatically with a new EKS cluster."
  default     = true
}

variable "lb_controller_role_name" {
  type        = string
  description = "IAM role name for the load balancer controller. Leave empty to use AmazonEKSLoadBalancerControllerRole-<cluster_name>."
  default     = ""
}

variable "default_tags" {
  type        = map(string)
  description = "Tags applied to supported resources."
  default = {
    Project = "DevX"
    Managed = "terraform"
  }
}

variable "manage_default_network_acl" {
  type        = bool
  description = "Whether to manage default VPC network ACL entries. Keep false in orgs with SCP deny on DeleteNetworkAclEntry."
  default     = false
}

variable "manage_default_route_table" {
  type        = bool
  description = "Whether to manage the default VPC route table."
  default     = false
}

variable "manage_default_security_group" {
  type        = bool
  description = "Whether to manage the default VPC security group."
  default     = false
}

check "eks_network_when_creating" {
  assert {
    condition     = !local.create_eks || local.create_vpc || (local.vpc_id != "" && length(local.subnet_ids) >= 2)
    error_message = "Cannot create EKS: enable create_vpc = true (default), or set vpc_id and private_subnet_ids (2+ AZs), or ensure a default VPC with subnets exists."
  }
}

check "cluster_exists_or_will_be_created" {
  assert {
    condition     = local.create_eks || local.eks_cluster_exists
    error_message = "EKS cluster ${var.cluster_name} does not exist. Remove create_eks_cluster overrides — Terraform creates the cluster when it is missing."
  }
}

check "do_not_skip_ecr_create_when_missing" {
  assert {
    condition     = !var.ecr_already_exists || (var.run_aws_precheck && local.precheck_ecr_exists)
    error_message = "ecr_already_exists = true but repository ${var.ecr_repository_name} was not found. Set ecr_already_exists = false (default) for greenfield."
  }
}

check "do_not_skip_iam_create_when_missing" {
  assert {
    condition     = !var.lb_controller_role_already_exists || (var.run_aws_precheck && local.precheck_iam_exists)
    error_message = "lb_controller_role_already_exists = true but IAM role ${local.lb_controller_role_name} was not found. Set lb_controller_role_already_exists = false (default) for greenfield."
  }
}
