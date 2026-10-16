# CloudFront: HTTPS e um só domínio para o frontend (S3) e a API (/api/* → Lambda).

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# Passa à API os cabeçalhos, cookies e query string do browser, menos o Host (o Lambda
# espera o seu próprio domínio). Atenção: o cabeçalho Authorization (o token JWT) só chega à
# origem com esta política porque a cache está desligada em /api/*. Com cache, teria de fazer
# parte da chave da cache, senão uma resposta de um utilizador podia ser servida a outro.
data "aws_cloudfront_origin_request_policy" "all_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project}-frontend"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa" {
  name    = "${var.project}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/spa-rewrite.js")
}

# Os mesmos cabeçalhos de segurança que a API envia (backend/app/server.py), para o frontend.
resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.project}-security"

  security_headers_config {
    content_security_policy {
      override                = true
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'self' blob:; frame-src 'self' blob:; connect-src 'self' https://${aws_s3_bucket.invoices.bucket}.s3.${var.region}.amazonaws.com; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    }
    content_type_options {
      override = true
    }
    frame_options {
      override     = true
      frame_option = "DENY"
    }
    referrer_policy {
      override        = true
      referrer_policy = "no-referrer"
    }
    strict_transport_security {
      override                   = true
      access_control_max_age_sec = 31536000
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      override = true
      value    = "camera=(), microphone=(), geolocation=(), payment=()"
    }
    items {
      header   = "Cross-Origin-Opener-Policy"
      override = true
      value    = "same-origin"
    }
  }
}

locals {
  # "https://abc.lambda-url.eu-central-1.on.aws/" → "abc.lambda-url.eu-central-1.on.aws"
  api_domain = split("/", aws_lambda_function_url.api.function_url)[2]
}

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  comment             = "Warrantly"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # só os pontos de presença da Europa e América do Norte
  http_version        = "http2and3"

  origin {
    origin_id                = "frontend"
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  origin {
    origin_id   = "api"
    domain_name = local.api_domain
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60 # o mesmo que o timeout do Lambda (OCR, PDF)
    }
  }

  default_cache_behavior {
    target_origin_id           = "frontend"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_except_host.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Sem domínio próprio por agora: o endereço é https://<id>.cloudfront.net.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Endereço do site para os links nos emails (repor a palavra-passe). O Lambda lê-o do SSM ao
# arrancar, com os segredos: pô-lo nas variáveis do Lambda criava um ciclo (o CloudFront já
# depende da Function URL do Lambda).
resource "aws_ssm_parameter" "app_url" {
  name  = "${local.ssm_path}APP_URL"
  type  = "String"
  value = "https://${aws_cloudfront_distribution.app.domain_name}"
}
