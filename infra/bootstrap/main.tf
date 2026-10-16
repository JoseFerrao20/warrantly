# Bootstrap: corre UMA vez, à mão, com as tuas credenciais (aws sso login).
# Cria o que tem de existir antes de tudo o resto:
#   - o bucket onde fica o estado do Terraform da app;
#   - o orçamento com alerta por email;
#   - a ligação OIDC do GitHub Actions e os papéis IAM que os workflows assumem.
# O estado deste módulo fica local (terraform.tfstate, fora do git): são poucos recursos e
# raramente mudam. Ver docs/cloud.md, "Primeiro deploy".

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "warrantly", ManagedBy = "terraform", Stack = "bootstrap" }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # Nome único por conta: os nomes de buckets são globais na AWS.
  state_bucket = "warrantly-tfstate-${local.account_id}"
}

# --- Estado do Terraform da app ---------------------------------------------------------

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled" # permite recuperar um estado anterior se algo correr mal
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- Orçamento --------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  name         = "warrantly-mensal"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Email quando a previsão do mês passa o limite e quando o gasto real passa 80%.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}

# --- GitHub Actions por OIDC (sem chaves da AWS no GitHub) ------------------------------

# O GitHub emite um token assinado em cada execução; a AWS confia nele e troca-o por
# credenciais temporárias de um papel IAM, mas só para este repositório.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "trust_main" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Só o ramo main deste repositório pode fazer deploy.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

data "aws_iam_policy_document" "trust_pull_requests" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:pull_request"]
    }
  }
}

# Deploy (ramo main): aplica o Terraform e publica a app. O Terraform cria papéis IAM, por isso
# precisa de permissões largas; o risco fica limitado pela confiança (só o main deste repo).
resource "aws_iam_role" "deploy" {
  name               = "warrantly-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.trust_main.json
}

resource "aws_iam_role_policy_attachment" "deploy_admin" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Plan (pull requests): só leitura, mais ler o estado. Um PR nunca altera a infraestrutura.
resource "aws_iam_role" "plan" {
  name               = "warrantly-github-plan"
  assume_role_policy = data.aws_iam_policy_document.trust_pull_requests.json
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_state" {
  statement {
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_state.json
}
