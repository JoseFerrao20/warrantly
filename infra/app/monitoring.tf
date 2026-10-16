# Observabilidade: alarmes por email e um dashboard (ver docs/cloud.md, "Observabilidade").
# A app escreve logs em JSON e métricas no formato EMF (app/observability.py); o CloudWatch
# transforma as linhas EMF em métricas no namespace "Warrantly" sem configuração nenhuma.
# Tudo cabe no nível gratuito: 10 alarmes, 10 métricas personalizadas e 3 dashboards.

locals {
  namespace  = "Warrantly"
  lambda_dim = { FunctionName = aws_lambda_function.api.function_name }
}

resource "aws_sns_topic" "alarms" {
  name = "${var.project}-alarms"
}

# O email recebe primeiro um pedido de confirmação da AWS: sem confirmar, não chega nada.
resource "aws_sns_topic_subscription" "alarms_email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Respostas 5xx, contadas a partir da linha de log de cada pedido (JSON).
resource "aws_cloudwatch_log_metric_filter" "http_5xx" {
  name           = "${var.project}-http-5xx"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = "{ $.logger = \"app.requests\" && $.status >= 500 }"

  metric_transformation {
    name      = "Http5xx"
    namespace = local.namespace
    value     = "1"
    unit      = "Count"
  }
}

# --- Alarmes --------------------------------------------------------------------------------

locals {
  alarms = {
    lambda-errors = {
      description = "O Lambda falhou (a app rebentou ou excedeu o tempo)."
      namespace   = "AWS/Lambda"
      metric      = "Errors"
      dimensions  = local.lambda_dim
      statistic   = "Sum"
      period      = 300
      evaluations = 1
      threshold   = 1
      missing     = "notBreaching"
    }
    lambda-throttles = {
      description = "Pedidos recusados por limite de concorrência do Lambda."
      namespace   = "AWS/Lambda"
      metric      = "Throttles"
      dimensions  = local.lambda_dim
      statistic   = "Sum"
      period      = 300
      evaluations = 1
      threshold   = 1
      missing     = "notBreaching"
    }
    http-5xx = {
      description = "Várias respostas 5xx em 5 minutos (ver os logs com o request_id)."
      namespace   = local.namespace
      metric      = "Http5xx"
      dimensions  = {}
      statistic   = "Sum"
      period      = 300
      evaluations = 1
      threshold   = 3
      missing     = "notBreaching"
    }
    alert-failures = {
      description = "Algum alerta de garantia não foi enviado por email."
      namespace   = local.namespace
      metric      = "AlertFailures"
      dimensions  = {}
      statistic   = "Maximum"
      period      = 3600
      evaluations = 1
      threshold   = 1
      missing     = "notBreaching"
    }
    refresh-token-reuse = {
      description = "Um refresh token já gasto foi usado outra vez: possível roubo de sessão (ADR 0004)."
      namespace   = local.namespace
      metric      = "RefreshTokenReuse"
      dimensions  = {}
      statistic   = "Sum"
      period      = 300
      evaluations = 1
      threshold   = 1
      missing     = "notBreaching"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "simple" {
  for_each = local.alarms

  alarm_name          = "${var.project}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dimensions
  statistic           = each.value.statistic
  period              = each.value.period
  evaluation_periods  = each.value.evaluations
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = each.value.missing
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# Latência: o p95 do Lambda acima de 10 s durante 15 minutos (o OCR das fotografias é o
# pedido mais lento; o resto devia ficar abaixo de 1 s).
resource "aws_cloudwatch_metric_alarm" "latency" {
  alarm_name          = "${var.project}-lambda-latency-p95"
  alarm_description   = "Os pedidos estão lentos (p95 acima de 10 s)."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  dimensions          = local.lambda_dim
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = 10000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# Os alertas diários não correram: cada corrida escreve a métrica AlertEmailsSent (mesmo que
# seja 0). Sem nenhum valor num dia inteiro, o agendamento parou (por exemplo, o GitHub
# desliga os workflows agendados de repositórios sem atividade há 60 dias).
resource "aws_cloudwatch_metric_alarm" "alerts_not_running" {
  alarm_name          = "${var.project}-alerts-not-running"
  alarm_description   = "Os alertas diários de garantia não correram nas últimas 24 horas."
  namespace           = local.namespace
  metric_name         = "AlertEmailsSent"
  statistic           = "SampleCount"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

# --- Dashboard ------------------------------------------------------------------------------

locals {
  fn = aws_lambda_function.api.function_name
  graph = {
    view    = "timeSeries"
    region  = var.region
    stacked = false
    period  = 300
  }
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = var.project
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6
        properties = merge(local.graph, {
          title = "Pedidos e erros"
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", local.fn, { stat = "Sum", label = "Pedidos" }],
            ["AWS/Lambda", "Errors", "FunctionName", local.fn, { stat = "Sum", label = "Erros do Lambda" }],
            [local.namespace, "Http5xx", { stat = "Sum", label = "Respostas 5xx" }],
          ]
        })
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6
        properties = merge(local.graph, {
          title = "Duração (ms)"
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", local.fn, { stat = "p50", label = "p50" }],
            ["AWS/Lambda", "Duration", "FunctionName", local.fn, { stat = "p95", label = "p95" }],
          ]
        })
      },
      {
        type = "metric", x = 0, y = 6, width = 8, height = 6
        properties = merge(local.graph, {
          title = "Logins"
          metrics = [
            [local.namespace, "LoginSucceeded", { stat = "Sum", label = "Com sucesso" }],
            [local.namespace, "LoginFailed", { stat = "Sum", label = "Falhados" }],
            [local.namespace, "PasswordResetRequested", { stat = "Sum", label = "Recuperar palavra-passe" }],
          ]
        })
      },
      {
        type = "metric", x = 8, y = 6, width = 8, height = 6
        properties = merge(local.graph, {
          title  = "Alertas (por dia)"
          period = 86400
          metrics = [
            [local.namespace, "AlertEmailsSent", { stat = "Sum", label = "Emails" }],
            [local.namespace, "AlertPushesSent", { stat = "Sum", label = "Push" }],
            [local.namespace, "AlertFailures", { stat = "Sum", label = "Falhas" }],
          ]
        })
      },
      {
        type = "metric", x = 16, y = 6, width = 8, height = 6
        properties = merge(local.graph, {
          title = "Leitura das faturas (campos sugeridos)"
          metrics = [
            [local.namespace, "InvoiceFieldsSuggested", { stat = "Average", label = "Média por fatura" }],
            [local.namespace, "InvoiceFieldsSuggested", { stat = "SampleCount", label = "Faturas lidas" }],
          ]
        })
      },
      {
        type = "log", x = 0, y = 12, width = 24, height = 6
        properties = {
          title  = "Últimos erros"
          region = var.region
          view   = "table"
          query  = "SOURCE '${aws_cloudwatch_log_group.api.name}' | fields @timestamp, request_id, level, route, status, message | filter level = 'ERROR' or status >= 500 | sort @timestamp desc | limit 20"
        }
      },
    ]
  })
}
