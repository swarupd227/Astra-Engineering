provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile != "" ? var.aws_profile : null
  sts_region = var.use_global_sts_endpoint ? "us-east-1" : null

  # Some enterprise/local DNS setups fail to resolve regional STS hosts.
  # Use global STS endpoint for auth when enabled.
  endpoints {
    sts = var.use_global_sts_endpoint ? "https://sts.amazonaws.com" : null
  }

  default_tags {
    tags = var.default_tags
  }
}

data "aws_caller_identity" "current" {}
