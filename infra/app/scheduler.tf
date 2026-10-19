# Alertas diários de garantia com o EventBridge Scheduler (ver docs/adr/0006), e os recibos
# dos pushes desses alertas (no fim do ficheiro).
# Às 08:47 em Lisboa (o fuso horário trata da hora de verão), o Scheduler invoca o Lambda com
# {"task": "alerts"}. O Lambda Web Adapter entrega os eventos que não são HTTP em
# POST /api/internal/events (AWS_LWA_PASS_THROUGH_PATH, no Dockerfile), e a app envia os
# alertas. O alarme "alerts-not-running" (monitoring.tf) avisa se um dia não correr.

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    # Só agendamentos desta conta podem usar o papel.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

# O papel só pode invocar este Lambda.
data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.api.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

resource "aws_scheduler_schedule" "alerts" {
  name        = "${var.project}-alerts"
  description = "Alertas de garantia (60 e 15 dias antes do fim), uma vez por dia."

  schedule_expression          = "cron(47 8 * * ? *)"
  schedule_expression_timezone = "Europe/Lisbon"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ task = "alerts" })

    # Se a entrega ao Lambda falhar, o Scheduler tenta outra vez durante uma hora. Repetir não
    # envia nada a dobrar (os avisos enviados ficam registados).
    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 3
    }
  }
}

# Recibos dos pushes dos alertas (ver backend/app/push.py). O Expo só os tem uns minutos depois
# do envio (recomenda esperar 15) e guarda-os 24 horas: 30 minutos depois dos alertas chega.
# Apaga os tokens das apps desinstaladas e deixa no log os outros erros de entrega.
resource "aws_scheduler_schedule" "push_receipts" {
  name        = "${var.project}-push-receipts"
  description = "Recibos de entrega dos pushes dos alertas, 30 minutos depois deles."

  schedule_expression          = "cron(17 9 * * ? *)"
  schedule_expression_timezone = "Europe/Lisbon"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.api.arn
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ task = "push-receipts" })

    # Repetir não faz mal: os recibos já vistos são apagados, e os outros esperam pela próxima.
    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 3
    }
  }
}
