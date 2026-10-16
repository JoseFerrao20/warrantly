# Warrantly na AWS: roteiro

Objetivo: aprender cloud a partir de zero, pondo o Warrantly a correr na AWS da forma como se faz numa empresa: infraestrutura em código, deploy automático sem chaves guardadas e observabilidade. Cada passo é um PR, e as decisões ficam em [`docs/adr/`](adr/).

| # | Passo | O que se aprende | Onde |
|---|---|---|---|
| 1 | Faturas no S3 (`STORAGE_BACKEND=s3`) | armazenamento de objetos, SDK (boto3), credenciais por ambiente, testes com o S3 simulado (moto) | ✅ feito |
| 2 | Conta AWS segura | utilizador root com MFA, IAM Identity Center (um utilizador para o dia a dia), alerta de orçamento, região | em casa (precisa do cartão) |
| 3 | App pronta para o Lambda ([ADR 0002](adr/0002-arquitetura-serverless.md)) | Lambda Web Adapter, segredos no SSM, email pelo SES com o papel IAM, ligações à base de dados sem pool (Neon) | ✅ feito |
| 4 | Terraform | o que é IaC, estado remoto (bucket S3), `plan`/`apply`; ECR, Lambda + Function URL, S3 (faturas e frontend), CloudFront, SES, papéis IAM com o mínimo de permissões, orçamento | código aqui, `apply` em casa |
| 5 | CI/CD com OIDC | o GitHub Actions entra na AWS com credenciais temporárias (sem chaves no repositório); `terraform plan` comentado em cada PR; deploy da imagem depois do merge | código aqui |
| 6 | Upload direto para o S3 | POST pré-assinado (o browser envia a fatura para o bucket, até 10 MB, sem passar pelo Lambda), CORS, regra de ciclo de vida para os temporários | ✅ feito |
| 6b | Alertas agendados | EventBridge Scheduler em vez do `alerts.yml` | código aqui |
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
| `SSM_PARAMETERS_PATH` | `/warrantly/prod/` | Lê os segredos (`SECRET_KEY`, `DATABASE_URL`, `ALERTS_TOKEN` e, opcional, `EXPO_ACCESS_TOKEN` para o push; ver [`push.md`](push.md)) do SSM Parameter Store ao arrancar |
| `DATABASE_POOL` | `null` | Sem pool de ligações na app: o pooler do Neon trata disso |
| `MAIL_BACKEND` | `ses` | Email pela API do SES, com o papel IAM |
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

## Primeiro deploy (em casa, uma vez)

Pré-requisitos no teu computador: [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) e [Terraform](https://developer.hashicorp.com/terraform/install) 1.13 (o dev container já os traz). Gerar cada segredo com `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

1. **Conta AWS segura**
   - Criar a conta. Confirmar que ficou no plano gratuito ("Free plan").
   - No utilizador root, ativar o MFA. A partir daqui, o root não volta a ser usado.
   - Em IAM Identity Center: ativar, criar um utilizador para ti e dar-lhe o "permission set" `AdministratorAccess` nesta conta.
   - No terminal: `aws configure sso` (perfil `warrantly`, região `eu-central-1`), depois `export AWS_PROFILE=warrantly` e `aws sso login`. Confirmar com `aws sts get-caller-identity`.
2. **Neon (Postgres)**
   - Criar um projeto em [neon.com](https://neon.com), na região **AWS Frankfurt (eu-central-1)**.
   - Copiar a *connection string* "pooled" (o host tem `-pooler`), que já traz `sslmode=require`.
3. **Bootstrap**: o bucket do estado, o orçamento e os papéis do GitHub.
   ```bash
   cd infra/bootstrap
   cp terraform.tfvars.example terraform.tfvars   # o teu email para os alertas do orçamento
   terraform init && terraform plan               # ler o plano antes de aplicar!
   terraform apply
   terraform output                               # anotar os 3 valores
   ```
   Depois, confirmar a subscrição no email do AWS Budgets.
4. **Segredos no SSM Parameter Store**: a app lê-os ao arrancar.
   ```bash
   aws ssm put-parameter --type SecureString --name /warrantly/prod/SECRET_KEY   --value '<token>'
   aws ssm put-parameter --type SecureString --name /warrantly/prod/ALERTS_TOKEN --value '<outro-token>'
   aws ssm put-parameter --type SecureString --name /warrantly/prod/DATABASE_URL --value '<connection string do Neon>'
   ```
5. **GitHub** (Settings → Secrets and variables → Actions)
   - Variáveis: `AWS_DEPLOY_ROLE_ARN` e `AWS_PLAN_ROLE_ARN` (outputs do bootstrap), `TF_STATE_BUCKET` (output `state_bucket`) e `MAIL_FROM_ADDRESS` (o email que envia os alertas).
   - Segredo: `ALERTS_TOKEN`, com o mesmo valor do passo 4.
6. **Primeiro deploy**: Actions → Deploy → Run workflow.
   - O workflow cria o ECR, publica a imagem, aplica as migrações no Neon, cria o resto com o Terraform e publica o frontend.
   - O endereço aparece no resumo da execução: `https://<id>.cloudfront.net`.
   - Pôr esse endereço na variável `APP_URL`, para os alertas diários.
7. **SES**: confirmar o email de verificação que a AWS envia para `MAIL_FROM_ADDRESS`. Enquanto o SES estiver em "sandbox", só envia para endereços verificados, por isso verifica também o teu (SES → Identities).
8. **Verificações**
   - Criar conta e registar uma compra com uma fatura PDF; a fatura abre inteira.
   - Fotografia grande (até 10 MB), com a leitura a preencher os campos. Vai do browser diretamente para o S3; no browser, em Rede, o POST vai para `…s3.eu-central-1.amazonaws.com`.
   - `curl -sI <APP_URL> | grep -i content-security` mostra a CSP.
   - `<APP_URL>/api/docs` dá 404.
   - 6 logins errados seguidos dão "Demasiadas tentativas".
   - Em CloudWatch → Log groups → `/aws/lambda/warrantly-api`, os logs aparecem.
9. **Lock files do Terraform**: depois do primeiro `terraform init` em `infra/bootstrap` e `infra/app`, fazer commit dos ficheiros `.terraform.lock.hcl`. Fixam as versões exatas dos providers; não foi possível gerá-los na sessão cloud.

A partir daqui, cada merge no `main` com o CI verde é publicado sozinho. Em cada PR que mexa em `infra/`, o workflow Infra mostra o `terraform plan`.

### Desligar tudo (enquanto for só para aprender)

```bash
cd infra/app
aws s3 rm "s3://$(terraform output -raw invoices_bucket)" --recursive   # os buckets têm de estar vazios
aws s3 rm "s3://$(terraform output -raw frontend_bucket)" --recursive
terraform destroy
```

O bootstrap pode ficar: o bucket do estado e o orçamento custam praticamente nada.
