# Warrantly na AWS: roteiro

Objetivo: aprender cloud a partir de zero, pondo o Warrantly a correr na AWS da forma como se faz numa empresa: infraestrutura em código, deploy automático sem chaves guardadas e observabilidade. Cada passo é um PR, e as decisões ficam em [`docs/adr/`](adr/).

| # | Passo | O que se aprende | Onde |
|---|---|---|---|
| 1 | Faturas no S3 (`STORAGE_BACKEND=s3`) | armazenamento de objetos, SDK (boto3), credenciais por ambiente, testes com o S3 simulado (moto) | ✅ feito |
| 2 | Conta AWS segura | utilizador root com MFA, IAM Identity Center (um utilizador para o dia a dia), alerta de orçamento, região | em casa (precisa do cartão) |
| 3 | App pronta para o Lambda ([ADR 0002](adr/0002-arquitetura-serverless.md)) | Lambda Web Adapter, segredos no SSM, email pelo SES com o papel IAM, ligações à base de dados sem pool (Neon) | ✅ feito |
| 4 | Terraform | o que é IaC, estado remoto (bucket S3), `plan`/`apply`; ECR, Lambda + Function URL, S3 (faturas e frontend), CloudFront, SES, papéis IAM com o mínimo de permissões, orçamento | código aqui, `apply` em casa |
| 5 | CI/CD com OIDC | o GitHub Actions entra na AWS com credenciais temporárias (sem chaves no repositório); `terraform plan` comentado em cada PR; deploy da imagem depois do merge | código aqui |
| 6 | Upload direto para o S3 e alertas agendados | URLs pré-assinados (faturas até 10 MB, sem passar pelo Lambda); EventBridge Scheduler em vez do `alerts.yml` | código aqui |
| 7 | Observabilidade | logs estruturados (JSON), CloudWatch, métricas e traces com OpenTelemetry, alarmes e um runbook de incidentes | código aqui |
| 8 | Extra: Kubernetes local | k3d + chart Helm do Warrantly, para perceber os conceitos sem pagar EKS | em casa (precisa de Docker) |

Em paralelo, para o CV: certificação **AWS Certified Cloud Practitioner** (entrada) e, mais tarde, **Solutions Architect – Associate**.

## Custos

A AWS cobra por uso, e alguns serviços custam dinheiro mesmo parados (Postgres gerido, balanceador de carga, NAT Gateway). Regras:

- Alerta de orçamento (ex.: 5 €/mês) **antes** de criar qualquer recurso.
- Confirmar o preço de cada serviço na página oficial antes do `apply`, e anotar no ADR.
- `terraform destroy` quando não estiver a ser usado, enquanto for só para aprender.

## Variáveis para a AWS

| Variável | No Lambda | Para quê |
|---|---|---|
| `SSM_PARAMETERS_PATH` | `/warrantly/prod/` | Lê os segredos (`SECRET_KEY`, `DATABASE_URL`, `ALERTS_TOKEN`) do SSM Parameter Store ao arrancar |
| `DATABASE_POOL` | `null` | Sem pool de ligações na app: o pooler do Neon trata disso |
| `MAIL_BACKEND` | `ses` | Email pela API do SES, com o papel IAM |
| `MAX_INVOICE_BYTES` | `4194304` (4 MB) | Limite de 6 MB por pedido no Lambda, até haver upload direto para o S3 |
| `STATIC_DIR` | vazio | O frontend vem do S3/CloudFront, não do Lambda |
| `AWS_LWA_*` | já na imagem | Configuração do Lambda Web Adapter (porta, `/api/health/live` e streaming) |

## Armazenamento das faturas

| Variável | Valor |
|---|---|
| `STORAGE_BACKEND` | `local` (pasta `UPLOAD_DIR`, por omissão) ou `s3` |
| `S3_BUCKET` | nome do bucket (obrigatório com `s3`) |
| `AWS_REGION` | região do bucket (ex.: `eu-west-1`, Irlanda, ou `eu-south-2`, Espanha) |
| `S3_ENDPOINT_URL` | só para um S3 local (MinIO ou LocalStack) |

As credenciais nunca vão para variáveis da app em produção: na AWS, o serviço corre com um papel IAM que só pode ler, escrever e apagar em `s3://<bucket>/faturas/*`. Em desenvolvimento, usa-se `AWS_PROFILE` (depois de `aws sso login`).
