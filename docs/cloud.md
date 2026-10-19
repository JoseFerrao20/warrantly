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
| 6b | Alertas agendados ([ADR 0006](adr/0006-alertas-com-eventbridge-scheduler.md)) | EventBridge Scheduler com fuso horário, papel IAM para invocar o Lambda, eventos que não são HTTP pelo Lambda Web Adapter | ✅ código, `apply` em casa |
| 7 | Observabilidade ([ADR 0005](adr/0005-observabilidade.md)) | logs estruturados (JSON), métricas EMF, alarmes por email (SNS) e dashboard no CloudWatch; mais tarde, traces com OpenTelemetry e um runbook de incidentes | ✅ código, `apply` em casa |
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
| `APP_URL` | no SSM | Endereço do site nos links dos emails; o Terraform escreve o domínio do CloudFront em `/warrantly/prod/APP_URL` |
| `DATABASE_POOL` | `null` | Sem pool de ligações na app: o pooler do Neon trata disso |
| `MAIL_BACKEND` | `ses` | Email pela API do SES, com o papel IAM |
| `STATIC_DIR` | vazio | O frontend vem do S3/CloudFront, não do Lambda |
| `AWS_LWA_*` | já na imagem | Configuração do Lambda Web Adapter (porta, `/api/health/live` e streaming) |

## Observabilidade

[ADR 0005](adr/0005-observabilidade.md). No Lambda, a app escreve logs em JSON (`LOG_FORMAT=json`) e métricas no formato EMF, que o CloudWatch transforma em métricas no namespace `Warrantly`. O `infra/app/monitoring.tf` cria os alarmes (por email, por SNS) e o dashboard (output `dashboard_url`).

Para investigar um erro: a resposta traz `X-Request-ID`. Depois, CloudWatch → Logs Insights, no grupo `/aws/lambda/warrantly-api`:

```
fields @timestamp, level, route, status, duration_ms, message, exception
| filter request_id = "<o id>"
| sort @timestamp
```

Outras perguntas úteis:
- **Rotas mais lentas:** `filter logger = "app.requests" | stats avg(duration_ms), pct(duration_ms, 95), count() by route | sort pct(duration_ms, 95) desc`
- **Erros por rota:** `filter status >= 500 | stats count() by route`
- **Arranques a frio:** `filter @type = "REPORT" and ispresent(@initDuration) | stats count(), avg(@initDuration)`

## IP do cliente

Os limites de tentativas (`app/rate_limit.py`) contam por IP e por email. O IP vem do `X-Forwarded-For`: o uvicorn corre com `--proxy-headers --forwarded-allow-ips='*'` (Dockerfile) e usa a primeira entrada, e essa quem faz o pedido pode inventar.

- **O que já protege:** os limites **por email** (20 logins falhados em 15 minutos, 3 pedidos de recuperação por hora) não dependem do IP. Adivinhar a palavra-passe de uma conta continua travado.
- **O que fica mais fraco:** os limites **só por IP**, ou seja, as contas novas por IP e os logins falhados de um IP em muitos emails.
- **Como saber:** o `scripts/smoke_test.py`, no fim do deploy, faz 6 logins errados com um IP inventado em cada um e escreve `AVISO a app usa o IP do X-Forwarded-For…` quando o limite não os apanha. É só um aviso: o deploy não falha.
- **A correção, se o aviso aparecer** (fica para depois do primeiro deploy, porque só se testa na AWS):
  1. o CloudFront junta a cada pedido para `/api/*` um cabeçalho secreto (origin custom header, por exemplo `X-Origin-Verify`, com um valor no SSM);
  2. a política de pedidos de origem passa a incluir o `CloudFront-Viewer-Address`, o IP que o próprio CloudFront viu;
  3. a app só aceita esse IP quando o cabeçalho secreto vem certo, e ignora o `X-Forwarded-For`.

  De caminho, a app pode recusar os pedidos sem o cabeçalho secreto, o que fecha o acesso direto à Function URL (hoje pública).

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
   - Variáveis: `AWS_DEPLOY_ROLE_ARN` e `AWS_PLAN_ROLE_ARN` (outputs do bootstrap), `TF_STATE_BUCKET` (output `state_bucket`) e `MAIL_FROM_ADDRESS` (o email que envia os alertas). Opcional: `ALARM_EMAIL` (recebe os alarmes do CloudWatch; confirmar o email da AWS "Subscription Confirmation").
   - Segredo: `ALERTS_TOKEN`, com o mesmo valor do passo 4.
6. **Primeiro deploy**: Actions → Deploy → Run workflow.
   - O workflow cria o ECR, publica a imagem, aplica as migrações no Neon, cria o resto com o Terraform e publica o frontend.
   - O endereço aparece no resumo da execução: `https://<id>.cloudfront.net`.
   - Pôr esse endereço na variável `APP_URL`, para correr os alertas à mão (Actions → Alertas). Os diários correm sozinhos, com o EventBridge Scheduler.
7. **SES**: confirmar o email de verificação que a AWS envia para `MAIL_FROM_ADDRESS`. Enquanto o SES estiver em "sandbox", só envia para endereços verificados, por isso verifica também o teu (SES → Identities).
8. **Verificações**
   - O último passo do deploy corre `scripts/smoke_test.py` contra o `APP_URL` e falha se algo não estiver certo. Verifica:
     - a API e a base de dados (`/api/health`);
     - os cabeçalhos de segurança (CSP, HSTS e os outros);
     - o `/api/docs` com 404 e o 403 em `POST /api/internal/events`;
     - o cookie da sessão (`Secure`, `HttpOnly`, `SameSite=Strict`, caminho `/api/auth`) e a renovação da sessão;
     - os logins errados seguidos a darem "Demasiadas tentativas".

     Cria uma conta `smoke-…@example.com` e apaga-a no fim. Corre também à mão: `python3 scripts/smoke_test.py <APP_URL>`.
   - Criar conta e registar uma compra com uma fatura PDF; a fatura abre inteira.
   - Fotografia grande (até 10 MB), com a leitura a preencher os campos. Vai do browser diretamente para o S3; no browser, em Rede, o POST vai para `…s3.eu-central-1.amazonaws.com`.
   - Em CloudWatch → Log groups → `/aws/lambda/warrantly-api`, os logs aparecem.
   - No log do passo "Verificar a app publicada", ver se aparece o `AVISO` do IP (secção "IP do cliente", acima).
   - Alertas agendados: Lambda → `warrantly-api` → Testar, com o evento `{"task": "alerts"}`; a resposta tem `emails_sent`. O evento `{"task": "push-receipts"}` responde com `checked` e `tokens_removed`. Ver também os dois agendamentos em EventBridge → Scheduler → Schedules.
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
