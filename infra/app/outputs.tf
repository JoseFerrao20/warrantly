output "app_url" {
  description = "Endereço da app (variável APP_URL no GitHub, para os alertas diários)."
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "ecr_repository_url" {
  description = "Onde o deploy publica as imagens."
  value       = aws_ecr_repository.api.repository_url
}

output "lambda_function_name" {
  value = aws_lambda_function.api.function_name
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.id
}

output "invoices_bucket" {
  value = aws_s3_bucket.invoices.id
}

output "cloudfront_distribution_id" {
  description = "Usado pelo deploy para limpar a cache depois de publicar o frontend."
  value       = aws_cloudfront_distribution.app.id
}
