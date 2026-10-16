# 0005. Observabilidade com logs JSON, métricas EMF e alarmes no CloudWatch

- Estado: aceite
- Data: 2026-10-16

## Contexto

Depois do deploy, a única forma de saber se a app está bem seria abri-la. Um erro às 3h da manhã, os alertas diários que deixam de correr (o GitHub desliga workflows agendados de repositórios sem atividade há 60 dias) ou alguém a tentar adivinhar palavras-passe passariam despercebidos. Os logs do uvicorn eram texto solto, sem forma de ligar as linhas de um mesmo pedido.

## Decisão

- **Logs estruturados em JSON** (`LOG_FORMAT=json` no Lambda): uma linha por pedido, com o método, a **rota modelo** (`/purchases/{purchase_id}`, sem ids nem dados pessoais), o estado, a duração e um `request_id`. O id vem do CloudFront (`X-Amz-Cf-Id`) ou é gerado, e vai na resposta (`X-Request-ID`). O log de acessos do uvicorn foi desligado.
- **Métricas pelo Embedded Metric Format (EMF):** a app escreve uma linha de log com o bloco `_aws`, e o CloudWatch cria a métrica sozinho.
  - Não usei o `PutMetricData`: faz um pedido HTTP a cada métrica e custa por chamada.
  - Não usei OpenTelemetry/X-Ray: é mais um serviço e um agente para uma app pequena.
  - As 9 métricas da app são: logins com sucesso e falhados, pedidos de recuperação da palavra-passe, reutilização de refresh tokens, campos sugeridos pela leitura das faturas, emails e push dos alertas, falhas dos alertas e erros não tratados.
- **Terraform (`infra/app/monitoring.tf`):**
  - um filtro de métricas conta os 5xx a partir dos logs JSON;
  - 7 alarmes avisam por email (SNS):
    - erros e throttles do Lambda;
    - 5xx;
    - latência p95 acima de 10 s;
    - falhas nos alertas;
    - **alertas que não correram em 24 horas**;
    - reutilização de um refresh token, que é um possível roubo de sessão;
  - um dashboard com pedidos, erros, duração, logins, alertas, leitura de faturas e os últimos erros (Logs Insights).

## Consequências

- Fica tudo dentro do nível gratuito do CloudWatch: 10 métricas personalizadas (as 9 da app mais a dos 5xx), 10 alarmes (usamos 7) e 3 dashboards. Uma métrica nova passa a custar cerca de 0,30 USD por mês.
- Os logs ficam 14 dias. O Logs Insights cobra por GB lido, o que é desprezável com este volume.
- Depois do primeiro deploy, o alarme "alertas não correram" dispara até à primeira corrida diária. É esperado, e o próprio email ensina a ler um alarme.
- Ficam de fora o tracing distribuído (X-Ray) e os alarmes compostos; só fazem falta com mais serviços.
