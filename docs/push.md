# Notificações push (app móvel)

Os alertas de garantia chegam ao telemóvel pelo serviço de push do Expo ([ADR 0003](adr/0003-notificacoes-push-pelo-expo.md)). Este guia ensina a pôr isto a funcionar num telemóvel Android a sério. Faz-se uma vez, em casa, com a conta do Expo e do Google.

## Como funciona

1. Ao entrar na app, o telemóvel pede autorização para notificações e obtém um **token Expo** (`ExponentPushToken[...]`). A app envia-o para a API (`POST /push-tokens`).
2. Todos os dias, os alertas (`python -m app.alerts` ou `POST /internal/alerts`) enviam o email e, a seguir, uma notificação para cada token da pessoa.
3. O Expo entrega a notificação pelo FCM (Android) ou pelo APNs (iOS). Tocar nela abre a compra na app (`data.url`, por exemplo `/compras/12`).
4. "Sair" apaga o token na API (`DELETE /push-tokens`). Uma app desinstalada é detetada pelo Expo, e o token é apagado: às vezes logo no envio (o "ticket"), às vezes só no recibo de entrega.
5. **Recibos:** o Expo só sabe se o FCM ou o APNs entregou uns minutos depois. A API guarda os ids dos tickets (`push_tickets`), e um segundo agendamento, 30 minutos depois dos alertas (`{"task": "push-receipts"}`), vai buscar os recibos. Apaga os tokens com `DeviceNotRegistered` e deixa no log os outros erros (`MessageTooBig`, `InvalidCredentials`…), que querem dizer que há algo a corrigir do nosso lado.

## Porque não chega a Expo Go

Desde o SDK 53, a Expo Go no Android já não recebe push. É preciso uma **development build**: uma app Warrantly própria, com o `expo-dev-client`, que se liga ao `npx expo start` como a Expo Go. No iOS, a Expo Go ainda recebe push, mas uma build própria precisa de uma conta paga de Apple Developer (99 USD por ano), por isso o caminho grátis é o Android.

## Passos (Android, uma vez)

1. **Conta do Expo:** criar uma em https://expo.dev, e depois `cd mobile && npx eas-cli login`.
2. **Projeto do EAS:** correr `npx eas-cli init`. Como a configuração é dinâmica (`app.config.ts`), o EAS mostra o `projectId` mas não o escreve sozinho: pô-lo no `app.json`, em `expo.extra.eas.projectId`, e fazer commit (não é segredo).
3. **Firebase (FCM):**
   - Em https://console.firebase.google.com, criar um projeto e juntar uma app Android com o pacote `pt.warrantly.app`.
   - Descarregar o `google-services.json` para `mobile/` (está no `.gitignore`).
   - Para as builds no EAS: `npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment development --environment preview --environment production --visibility secret`.
4. **Chave do FCM para o Expo:**
   - No Firebase: Definições do projeto → Contas de serviço → "Gerar nova chave privada" (um JSON).
   - Depois `npx eas-cli credentials` → Android → Google Service Account → "Manage your Google Service Account Key for Push Notifications (FCM V1)" → carregar o JSON.
   - Guardar o JSON fora do repositório; é um segredo.
5. **Endereço da API nas builds:** `npx eas-cli env:create --name EXPO_PUBLIC_API_URL --value https://<domínio do CloudFront>/api --environment development --environment preview --environment production --visibility plaintext`.
6. **Development build:** correr `npx eas-cli build --profile development --platform android`. Corre na cloud do Expo (o plano grátis chega) e dá um link para instalar o APK no telemóvel.
7. **Usar:** `npx expo start` e abrir o projeto na app Warrantly instalada (não na Expo Go). Entrar e aceitar as notificações.
8. **Experimentar:**
   - Na base de dados, `SELECT token FROM push_tokens;` mostra o token do telemóvel.
   - Teste rápido sem a API: https://expo.dev/notifications com esse token.
   - Teste a sério: uma compra cuja garantia acaba daqui a menos de 60 dias, e depois `python -m app.alerts` (ou `POST /internal/alerts`). Chega o email e a notificação, e tocar nela abre a compra.

## Segurança (opcional)

Por omissão, quem souber um token Expo pode enviar-lhe notificações. Para fechar isto:
1. Em expo.dev → Account settings → Access tokens, criar um token.
2. Nas definições do projeto, ligar "Enhanced Security for Push Notifications".
3. Guardar o token no SSM como `/warrantly/prod/EXPO_ACCESS_TOKEN` (SecureString). O Lambda lê-o ao arrancar, como os outros segredos.

## Variáveis do backend

| Variável | Por omissão | Para quê |
|---|---|---|
| `PUSH_ENABLED` | `true` | `false` desliga o push nos alertas (o email continua) |
| `EXPO_ACCESS_TOKEN` | vazio | Token de acesso do Expo, se o "enhanced security" estiver ligado |
