# 0003. Notificações push pelo serviço do Expo

- Estado: aceite
- Data: 2026-10-16

## Contexto

Os alertas de garantia (60 e 15 dias antes do fim) só iam por email. Com a app móvel (Expo), faz sentido avisar também no telemóvel. Há três formas de enviar push:

1. **Serviço de push do Expo:** o servidor envia um pedido HTTP com o token Expo do telemóvel, e o Expo entrega pelo FCM (Android) ou pelo APNs (iOS). É grátis. As credenciais da Google e da Apple ficam guardadas no EAS, não no servidor.
2. **Amazon SNS (mobile push):** fica na AWS, mas obriga a gerir as credenciais do FCM e do APNs, os "endpoints" de cada aparelho e os tokens nativos (não os do Expo).
3. **FCM e APNs diretamente:** duas integrações diferentes, com contas, chaves e formatos próprios.

## Decisão

- Push pelo **serviço do Expo**. O backend tem um módulo pequeno (`app/push.py`, só com a biblioteca padrão) que envia lotes de 100 mensagens para `https://exp.host/--/api/v2/push/send`.
- A API guarda um token por telemóvel (`push_tokens`, único). A app regista-o ao entrar e apaga-o ao carregar em "Sair". Uma sessão expirada não o apaga, porque a pessoa não saiu.
- O push segue os alertas por email, como um canal extra: só é enviado depois de o email sair, e se falhar não impede o registo do aviso.
- Os tokens de apps desinstaladas (`DeviceNotRegistered`) são apagados quando o Expo os recusa.
- `EXPO_ACCESS_TOKEN` (opcional, no SSM): com o "enhanced push security" ligado na conta do Expo, só quem tem este token consegue enviar para os tokens da app.

## Consequências

- Mais uma dependência externa (o Expo), sem custo. O SNS fica como alternativa se um dia a app sair do Expo. A troca seria só no `app/push.py`, porque os tokens nativos também se obtêm com `getDevicePushTokenAsync`.
- O push não funciona na Expo Go no Android (desde o SDK 53): é preciso uma **development build** (EAS) com um projeto no Firebase para o FCM. No iOS, o push precisa de uma conta paga de Apple Developer. Os passos estão em `docs/push.md`.
- ~~Ainda não se leem os "receipts" do Expo.~~ Ver a atualização abaixo.

## Atualização (2026-10-19): recibos de entrega

- O Expo responde ao envio com um **ticket** (aceitou a mensagem) e só uns minutos depois tem o **recibo** (o FCM ou o APNs entregou, ou não). Recomenda esperar 15 minutos, e guarda os recibos pelo menos 24 horas.
- **Onde ficam os tickets:** os ids dos tickets aceites vão para `push_tickets`, com o token. A chave estrangeira para `push_tokens.token` é `ON DELETE CASCADE`: se o token sair, os tickets vão com ele.
- **Quando se leem os recibos:** um segundo agendamento no EventBridge Scheduler, 30 minutos depois dos alertas (`{"task": "push-receipts"}`), chama `push.check_receipts`. O Lambda não fica à espera dentro do pedido dos alertas, porque pagaria 15 minutos parado e o pedido podia passar do tempo máximo.
- **O que se faz com eles:**
  - um recibo com `DeviceNotRegistered` apaga o token;
  - os outros erros ficam no log com nível `ERROR`;
  - um ticket sem recibo espera pela corrida seguinte, até ter 24 horas.
- **Métricas:** nenhuma nova, porque as 10 do nível gratuito do CloudWatch já estão usadas (ADR 0005). Os números ficam na linha de log "Recibos de push: …", que se pesquisa no Logs Insights.
