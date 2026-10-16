# Remetente dos alertas. Ao criar, a AWS envia um email de confirmação para este endereço.
# Enquanto a conta SES estiver em "sandbox", só envia para endereços verificados.
resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.mail_from_address
}
