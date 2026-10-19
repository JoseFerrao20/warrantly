# 0009. A API só responde ao CloudFront, e o IP vem dele

- Estado: aceite
- Data: 2026-10-19

## Contexto

Na revisão antes do primeiro deploy (DEVLOG de 2026-10-19), encontrei dois problemas:
- **O IP do cliente:** a app lia-o do `X-Forwarded-For`, que quem faz o pedido pode inventar. Os limites de tentativas só por IP (contas novas por IP, logins falhados de um IP) não serviam.
- **A Function URL do Lambda é pública:** quem a descobrisse podia chamar a API sem passar pelo CloudFront, sem os seus cabeçalhos nem os seus registos.

A correção que ficou descrita no `docs/cloud.md` usava o cabeçalho `CloudFront-Viewer-Address`. Para ele chegar à origem, era preciso trocar a política de pedidos de origem, e não há nenhuma que sirva:
- a `AllViewerExceptHostHeader` (a de agora) não o inclui;
- as que o incluem passam também o `Host`, e a Function URL recusa um `Host` que não seja o seu;
- uma política própria com a lista de cabeçalhos não pode incluir o `Authorization`, que leva o token.

## Decisão

- **Uma CloudFront Function no `/api/*`** (`infra/app/api-viewer-ip.js`, no evento viewer-request) escreve em `X-Viewer-IP` o IP que o CloudFront viu (`event.viewer.ip`), por cima do que o cliente tiver enviado. Como passa a ser um cabeçalho do pedido, a política atual já o leva à origem.
- **Um segredo partilhado entre o CloudFront e a app:** o CloudFront junta a cada pedido à API o cabeçalho `X-Origin-Verify` (*origin custom header*). O valor fica no SSM, em `/warrantly/prod/ORIGIN_VERIFY_SECRET`, criado à mão como os outros segredos. O Terraform lê-o para o CloudFront, e o Lambda lê-o ao arrancar.
- **Na app** (`app/origin.py`):
  - com o segredo configurado, o IP dos limites é o `X-Viewer-IP`, mas só quando o `X-Origin-Verify` bate certo (comparação em tempo constante); o `X-Forwarded-For` deixa de contar;
  - o servidor de produção recusa com 403 os pedidos a `/api/*` sem o segredo. Ficam de fora a verificação de saúde do Lambda Web Adapter (`/api/health/live`) e os eventos agendados (`/api/internal/events`, com a proteção do ADR 0006), que não passam pelo CloudFront.
- **Sem o segredo configurado** (desenvolvimento, Docker local, CI), nada muda.

## Consequências

- Os limites por IP passam a valer na AWS. O aviso do smoke test sobre o IP deve dar "ok" no primeiro deploy, que manda um `X-Forwarded-For` e um `X-Viewer-IP` inventados.
- A Function URL deixa de servir a quem não é o CloudFront: `curl <api_function_url>/api/health` dá 403 (output `api_function_url` do Terraform).
- O segredo fica também no estado do Terraform, como valor do cabeçalho do CloudFront. O estado está num bucket privado e cifrado, só acessível aos papéis do deploy.
- **Trocar o segredo:** mudar o parâmetro no SSM, correr o deploy (o Terraform atualiza o CloudFront) e esperar que o Lambda arranque instâncias novas, que leem o valor novo. Durante uns minutos, algumas instâncias antigas podem recusar pedidos.
- Mais uma CloudFront Function por pedido à API. O nível gratuito tem 2 milhões de invocações por mês; o Warrantly está muito longe disso.
