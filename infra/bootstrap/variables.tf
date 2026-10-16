variable "region" {
  description = "Região AWS (a mesma da app)."
  type        = string
  default     = "eu-central-1"
}

variable "github_repository" {
  description = "Repositório que pode fazer deploy, no formato dono/nome."
  type        = string
  default     = "JoseFerrao20/warrantly"
}

variable "budget_email" {
  description = "Email que recebe os alertas do orçamento."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Limite mensal do orçamento, em USD."
  type        = string
  default     = "5"
}
