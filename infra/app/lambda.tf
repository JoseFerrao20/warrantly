# A API: a imagem Docker do ECR a correr no Lambda (com o Lambda Web Adapter já na imagem).

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.project}-api"
  retention_in_days = 14 # logs antigos apagam-se sozinhos (e não se pagam para sempre)
}

# --- Papel IAM do Lambda: só o que a app precisa ----------------------------------------

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${var.project}-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "api" {
  statement {
    sid     = "Faturas"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    # uploads/: ficheiros enviados diretamente pelo browser (o POST pré-assinado é assinado
    # com as credenciais deste papel, por isso o papel tem de poder escrever lá).
    resources = [
      "${aws_s3_bucket.invoices.arn}/faturas/*",
      "${aws_s3_bucket.invoices.arn}/uploads/*",
    ]
  }
  statement {
    sid     = "Segredos"
    actions = ["ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${var.region}:${local.account_id}:parameter${trimsuffix(local.ssm_path, "/")}",
      "arn:aws:ssm:${var.region}:${local.account_id}:parameter${local.ssm_path}*",
    ]
  }
  statement {
    sid       = "Email"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = [aws_sesv2_email_identity.sender.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# --- Função ----------------------------------------------------------------------------

resource "aws_lambda_function" "api" {
  function_name = "${var.project}-api"
  role          = aws_iam_role.api.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
  architectures = ["x86_64"]
  memory_size   = var.lambda_memory_mb
  timeout       = 60

  environment {
    variables = {
      ENVIRONMENT         = "production"
      SSM_PARAMETERS_PATH = local.ssm_path # SECRET_KEY, DATABASE_URL, ALERTS_TOKEN, EXPO_ACCESS_TOKEN
      DATABASE_POOL       = "null"
      STORAGE_BACKEND     = "s3"
      S3_BUCKET           = aws_s3_bucket.invoices.id
      MAIL_BACKEND        = "ses"
      MAIL_FROM           = "Warrantly <${var.mail_from_address}>"
      # As faturas (até 10 MB) vão do browser diretamente para o S3: os pedidos ao Lambda
      # estão limitados a 6 MB e não servem para ficheiros grandes.
      STATIC_DIR = "" # o frontend vem do S3, pelo CloudFront
    }
  }

  # O workflow de deploy publica imagens novas; o Terraform não as desfaz.
  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy_attachment.api_logs]
}

# --- Function URL (a "porta" HTTPS do Lambda, atrás do CloudFront) -----------------------

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE" # a API tem a sua própria autenticação (JWT)
  invoke_mode        = "RESPONSE_STREAM"
}

# Desde outubro de 2025, uma Function URL pública precisa das duas permissões.
# A segunda fica limitada a chamadas pela URL (não deixa invocar a função diretamente).
resource "aws_lambda_permission" "url" {
  statement_id           = "FunctionUrlPublica"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "url_invoke" {
  statement_id             = "FunctionUrlPublicaInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.api.function_name
  principal                = "*"
  invoked_via_function_url = true
}
