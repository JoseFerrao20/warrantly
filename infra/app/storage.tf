# Dois buckets privados: as faturas (lidas e escritas só pelo Lambda) e o frontend (lido só
# pelo CloudFront). Nenhum é público: o "Block Public Access" impede-o mesmo por engano.

resource "aws_s3_bucket" "invoices" {
  bucket = "${var.project}-faturas-${local.account_id}"
}

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project}-frontend-${local.account_id}"
}

locals {
  buckets = {
    invoices = aws_s3_bucket.invoices.id
    frontend = aws_s3_bucket.frontend.id
  }
}

resource "aws_s3_bucket_public_access_block" "all" {
  for_each                = local.buckets
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "all" {
  for_each = local.buckets
  bucket   = each.value
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Upload direto: o browser envia as faturas para o bucket com um POST pré-assinado pela API.
# O CORS só deixa a própria app fazê-lo (o POST pré-assinado continua a ser obrigatório).
resource "aws_s3_bucket_cors_configuration" "invoices" {
  bucket = aws_s3_bucket.invoices.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = ["https://${aws_cloudfront_distribution.app.domain_name}"]
    allowed_headers = ["*"]
    max_age_seconds = 3600
  }
}

# Ficheiros enviados mas nunca associados a uma compra (ex.: o utilizador desistiu) não ficam
# para sempre: a pasta uploads/ esvazia-se sozinha.
resource "aws_s3_bucket_lifecycle_configuration" "invoices" {
  bucket = aws_s3_bucket.invoices.id
  rule {
    id     = "apagar-uploads-por-usar"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }
    expiration {
      days = 1
    }
  }
}

# Só o CloudFront (esta distribuição) pode ler o frontend.
data "aws_iam_policy_document" "frontend" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend.json
}
