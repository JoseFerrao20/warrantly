# 0001. AWS em vez do Fly.io

- Estado: aceite
- Data: 2026-10-16

## Contexto

O Warrantly tinha o deploy preparado para o Fly.io (um contentor, volume para as faturas e Postgres gerido). O Fly é simples, mas o objetivo do projeto mudou: além de pôr a app online, quero aprender cloud para procurar trabalho em full stack e cloud. Nas ofertas, a AWS é a cloud mais pedida, e o que se aprende (IAM, redes, armazenamento de objetos, bases de dados geridas, IaC) passa para o Azure e o Google Cloud.

## Decisão

- Produção na **AWS**, com toda a infraestrutura em **Terraform**.
- As faturas passam do disco para o **S3**, porque um contentor na cloud pode ser substituído a qualquer momento e o disco perde-se. Fica um backend local para desenvolvimento e testes (`STORAGE_BACKEND`).
- O Fly.io deixa de ser o alvo. O `fly.toml` e o `deploy.yml` saem quando o deploy na AWS estiver a funcionar.

## Consequências

- Mais peças para perceber e pagar do que no Fly. Isto é aceite, porque aprender é o objetivo, e fica controlado com o alerta de orçamento e o `terraform destroy`.
- Fica por decidir (próximo ADR): onde corre o contentor da API. As opções são ECS Fargate com um balanceador, uma instância EC2 pequena ou App Runner, a comparar em custo mensal e no que ensinam.
