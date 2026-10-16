# 0002. Arquitetura serverless na AWS (Lambda + S3 + CloudFront + Neon)

- Estado: aceite
- Data: 2026-10-16

## Contexto

Conta AWS nova, com o plano gratuito atual: créditos (100 USD, mais até 100 USD) durante 6 meses, e a conta fecha no fim, a não ser que passe a paga. O objetivo é aprender AWS sem pagar nesta fase e, depois dos 6 meses, ficar perto de 0 €. As peças "clássicas" (balanceador de carga, NAT Gateway e RDS) cobram por hora, mesmo paradas, e gastariam os créditos depressa.

## Decisão

```
Browser ──HTTPS──▶ CloudFront ──┬── /*      ──▶ S3 (frontend, privado, acesso só pelo CloudFront)
                                └── /api/*  ──▶ Lambda Function URL (respostas em streaming)
                                                   │  imagem Docker no ECR + Lambda Web Adapter
                                                   │  (a mesma imagem que corre em qualquer Docker)
                                                   ├──▶ Neon (Postgres, ligação "pooled", TLS)
                                                   ├──▶ S3 (faturas)            ┐
                                                   ├──▶ SES (alertas por email) ├ papel IAM do Lambda,
                                                   └──▶ SSM Parameter Store     ┘ sem chaves guardadas
GitHub Actions ──OIDC──▶ papel IAM de deploy: ECR, Lambda, S3 e CloudFront; migrações no Neon
```

| Peça | Escolha | Porquê |
|---|---|---|
| API | **Lambda** com imagem de contentor e **Lambda Web Adapter** (1.1.0) | Paga-se por pedido (sem tráfego, 0 €). A app não muda: o adapter traduz os eventos do Lambda em HTTP para o uvicorn. |
| Entrada da API | **Function URL** com `RESPONSE_STREAM` | Sem API Gateway, que é mais uma peça a pagar. Com streaming, as respostas podem ter até 200 MB (faturas, ZIP e PDF). |
| Frontend | **S3 + CloudFront** | Ficheiros estáticos com HTTPS e cache; o CloudFront junta o frontend e a API no mesmo domínio, por isso não há CORS. |
| Base de dados | **Neon** (plano gratuito, região AWS `eu-central-1`) | Postgres serverless que adormece sem uso. O RDS mais pequeno cobra por hora. Fica como passo opcional, para aprender. |
| Segredos | **SSM Parameter Store** (SecureString) | Gratuito nos parâmetros "standard". A app lê `/warrantly/prod/*` ao arrancar (`SSM_PARAMETERS_PATH`), e os valores não passam pelo Terraform nem pelas variáveis do Lambda. |
| Email | **SES** pela API (`MAIL_BACKEND=ses`) | Autorizado pelo papel IAM, sem password SMTP. |
| Região | **`eu-central-1`** (Frankfurt) | O Neon tem esta região: a API e a base de dados ficam perto uma da outra. |
| Infraestrutura | **Terraform**, com o estado num bucket S3 | Tudo revisto em PR e reproduzível (`apply`/`destroy`). |
| Deploy | **GitHub Actions com OIDC** | Credenciais temporárias por execução, e nenhuma chave da AWS no GitHub. |

## Consequências e limites conhecidos

- **Pedidos até 6 MB** (limite do Lambda, com o corpo em base64): no Lambda, `MAX_INVOICE_BYTES` fica em 4 MB. A solução definitiva é o upload direto do browser para o S3 com um URL pré-assinado, que fica num PR à parte.
- **Arranque a frio:** a primeira chamada depois de algum tempo parado demora alguns segundos (imagem com o Tesseract, e o Neon a acordar). Para uma app pessoal, é aceitável.
- **Limite de tentativas** (`app/rate_limit.py`) em memória, por instância do Lambda: com várias instâncias, cada uma conta à parte. Passa para o DynamoDB se for preciso.
- **Function URL pública:** a autenticação é a da própria API (JWT), e o CloudFront fica à frente para HTTPS e cache. Não se usa OAC para o Lambda, porque obrigaria o browser a enviar o hash do corpo nos POST/PUT.
- **Alertas diários:** continuam no `alerts.yml` do GitHub Actions, que chama `POST /api/internal/alerts`. Passar para o EventBridge Scheduler fica para o passo da observabilidade.
- **SES em modo "sandbox"** no início: só envia para emails verificados. Para enviar a qualquer pessoa, pede-se acesso de produção à AWS.
- **Custos:** confirmar sempre nas páginas oficiais antes do `apply` ([Lambda](https://aws.amazon.com/lambda/pricing/), [S3](https://aws.amazon.com/s3/pricing/), [CloudFront](https://aws.amazon.com/cloudfront/pricing/), [ECR](https://aws.amazon.com/ecr/pricing/), [SES](https://aws.amazon.com/ses/pricing/), [Neon](https://neon.com/pricing)). Com o orçamento de 5 € e o alerta, uma surpresa vê-se logo.
