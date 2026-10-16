output "state_bucket" {
  description = "Bucket do estado: vai para o backend da app (infra/app/backend.hcl)."
  value       = aws_s3_bucket.state.bucket
}

output "deploy_role_arn" {
  description = "Variável AWS_DEPLOY_ROLE_ARN no GitHub (Settings → Variables)."
  value       = aws_iam_role.deploy.arn
}

output "plan_role_arn" {
  description = "Variável AWS_PLAN_ROLE_ARN no GitHub."
  value       = aws_iam_role.plan.arn
}
