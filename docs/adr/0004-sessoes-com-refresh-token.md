# 0004. Sessões longas com refresh tokens

- Estado: aceite
- Data: 2026-10-16

## Contexto

O login devolvia um JWT de 60 minutos e nada mais. Passada uma hora, era preciso entrar outra vez. No site isto incomoda; na app móvel, que se abre de vez em quando, é quase sempre. Aumentar a duração do JWT não resolve: um JWT não se pode revogar, e um token roubado com 30 dias de vida dá 30 dias de acesso.

## Decisão

- **Dois tokens.** O de acesso é um JWT de 15 minutos, como antes, só mais curto. O refresh token é um valor aleatório (256 bits) que dura 30 dias desde o último uso. Na base de dados (`refresh_tokens`) fica só o hash SHA-256.
- **Rotação.** Cada `POST /auth/refresh` gasta o refresh token e devolve um novo, da mesma família (uma família é a sessão de um aparelho). Um token gasto que volte a aparecer quer dizer que alguém o copiou, e a família inteira é revogada. Pedidos quase simultâneos com o mesmo token (dois separadores) têm uma margem de 30 segundos.
- **Onde fica o refresh token:**
  - **No browser:** num cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção, só para `/api/auth`. O JavaScript não o lê, por isso um XSS não o leva para outro sítio, e outros sites não o conseguem enviar. Nunca vem no corpo da resposta.
  - **Na app móvel** (`X-Client: mobile`): no corpo, guardado no `expo-secure-store` (Keychain ou Keystore). A app não tem cookies e não corre JavaScript de terceiros.
- **Sair** (`POST /auth/logout`) revoga a família desse aparelho. Os outros aparelhos continuam com sessão. Apagar a conta apaga todas as sessões.
- Os clientes renovam sozinhos: com um 401, fazem um só pedido de renovação (mesmo que vários pedidos falhem ao mesmo tempo) e repetem o pedido original. Se a renovação falhar, voltam ao login.

## Consequências

- Um pedido extra a cada 15 minutos de uso e uma tabela nova. Os tokens gastos são apagados na rotação seguinte, por isso a tabela não cresce sem fim.
- Um token de acesso roubado serve no máximo 15 minutos. Um refresh token roubado é detetado quando os dois (o legítimo e o ladrão) o usam.
- O token de acesso do site continua no `localStorage` (um XSS ainda o pode usar durante 15 minutos). Passá-lo para memória obrigaria a uma renovação em cada abertura da página; fica para depois, se valer a pena.
- Ainda não há "sair de todos os aparelhos" nem uma lista de sessões ativas. A tabela já tem o que é preciso para isso.
