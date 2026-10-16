# 0006. Alertas diários com o EventBridge Scheduler

- Estado: aceite
- Data: 2026-10-16

## Contexto

Os alertas de garantia corriam num workflow agendado do GitHub Actions (`alerts.yml`), que chamava `POST /api/internal/alerts` com um token. Funcionava, mas tinha três problemas:
- o cron do GitHub é em UTC, e a hora em Lisboa mudava com a hora de verão;
- o GitHub atrasa os agendamentos nas horas de muito trabalho, e desliga-os em repositórios sem atividade há 60 dias;
- a infraestrutura ficava espalhada: a app na AWS, o relógio no GitHub e um segredo copiado para os dois lados.

## Decisão

- **EventBridge Scheduler** (`infra/app/scheduler.tf`):
  - um agendamento diário às 08:47 com o fuso `Europe/Lisbon`, que invoca o Lambda com `{"task": "alerts"}`;
  - um papel IAM que o Scheduler assume (só desta conta) e que só pode invocar este Lambda;
  - se a entrega falhar, tenta outra vez durante uma hora.
- **Sem um Lambda novo.** O Lambda Web Adapter entrega os eventos que não são HTTP como `POST` no caminho `AWS_LWA_PASS_THROUGH_PATH` (`/api/internal/events`). A mesma imagem trata os pedidos do site e o agendamento.
- **Sem segredos no agendamento.** A rota só aceita pedidos com o contexto do Lambda (`x-amzn-lambda-context`) e sem o contexto de um pedido HTTP (`x-amzn-request-context`). O adapter põe este último em todos os pedidos que chegam pela Function URL. Quem consegue invocar o Lambda diretamente já tem permissões na conta.
- O `alerts.yml` fica só com o `workflow_dispatch`, para correr os alertas à mão com o `ALERTS_TOKEN`.

## Consequências

- O EventBridge Scheduler tem 14 milhões de invocações grátis por mês; um agendamento diário não custa nada.
- **Risco aceite:** a proteção da rota depende de o adapter pôr sempre o `x-amzn-request-context` nos pedidos HTTP. Se um dia não o puser, alguém poderia chamar a rota pela Function URL. Mesmo assim, o impacto é baixo: os avisos não se repetem (ficam registados), por isso uma chamada a mais só antecipava os desse dia.
- A verificar no primeiro deploy (runbook em `docs/cloud.md`): Lambda → Testar com `{"task": "alerts"}`, e um `POST /api/internal/events` pela URL do CloudFront tem de dar 403.
- O alarme "alerts-not-running" (ADR 0005) continua a avisar se um dia os alertas não correrem.
