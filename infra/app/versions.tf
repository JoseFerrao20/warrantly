terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Estado no bucket criado pelo bootstrap. Os valores (bucket, região) vêm de backend.hcl:
  #   terraform init -backend-config=backend.hcl
  # use_lockfile: o Terraform >= 1.10 bloqueia o estado com um ficheiro no S3 (sem DynamoDB).
  backend "s3" {
    key          = "app/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = var.project, ManagedBy = "terraform", Stack = "app" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # Prefixo dos segredos no SSM Parameter Store (criados à mão; ver docs/cloud.md).
  ssm_path = "/${var.project}/prod/"
}
