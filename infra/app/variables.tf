variable "region" {
  description = "Região AWS. eu-central-1 (Frankfurt) fica perto do Neon na mesma região."
  type        = string
  default     = "eu-central-1"
}

variable "project" {
  description = "Prefixo dos nomes dos recursos."
  type        = string
  default     = "warrantly"
}

variable "image_tag" {
  description = "Tag da imagem no ECR usada ao criar o Lambda (depois, o deploy atualiza-a)."
  type        = string
  default     = "initial"
}

variable "mail_from_address" {
  description = "Endereço que envia os alertas (verificado no SES; recebe um email de confirmação)."
  type        = string
}

variable "lambda_memory_mb" {
  description = "Memória do Lambda (também define a CPU). O OCR das fotografias precisa de folga."
  type        = number
  default     = 1536
}
