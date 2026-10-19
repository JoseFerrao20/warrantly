# 0008. Confirmação do email da conta

- Estado: aceite
- Data: 2026-10-19

## Contexto

O registo não confirmava o email. Até à partilha do arquivo ([ADR 0007](0007-partilha-do-arquivo.md)), isso só afetava a própria pessoa: um email mal escrito era uma conta sem alertas.

Com a partilha, um convite é feito para um email, e quem criar uma conta com esse email vê o convite. Ficou como risco aceite no ADR 0007: alguém podia registar-se com o email de outra pessoa e aceitar (ou recusar) os convites que lhe fizessem.

## Decisão

- **Um link de confirmação por email no registo**, como o da recuperação da palavra-passe:
  - um JWT assinado, com o id e o email da conta, válido 7 dias e sem nada guardado na base de dados;
  - no fragmento do URL (`/confirmar-email#token=…`), que não chega aos logs;
  - confirmar duas vezes não faz mal, por isso o link não precisa de ser de uso único;
  - se o email da conta mudar, os links antigos deixam de servir.
- **A confirmação abre sem sessão** (`POST /auth/verify-email`): o link pode abrir-se noutro aparelho. Para pedir outro link, `POST /auth/verify-email/resend`, até 5 por hora.
- **O que fica fechado sem o email confirmado:** a partilha. A pessoa não convida ninguém, e os convites feitos para o seu email não aparecem nem se aceitam ou recusam.
- **O resto continua a funcionar sem confirmar:** entrar, registar compras, os alertas. Bloquear o login obrigava a confirmar antes de experimentar a app, e não protegia mais ninguém.
- **Avisos:** o site mostra um aviso no topo com "Enviar outra vez"; a app mostra o mesmo na secção da partilha.
- **As contas que já existiam** ficaram como confirmadas na migração. Ainda não há contas em produção.
- **No SES, os domínios de exemplo** (`example.com`, `.test`, …) não recebem email. O smoke test do deploy cria contas `smoke-…@example.com`, e um envio para lá seria um bounce, que conta para a reputação da conta no SES.

## Consequências

- O risco aceite no ADR 0007 desaparece: para ver um convite, é preciso abrir o email para onde ele foi feito.
- O registo passa a enviar um email. Sem email configurado (desenvolvimento sem Mailpit), a conta fica por confirmar e a partilha fechada.
- Nos testes do backend, o `make_user` cria contas já confirmadas (`verified=False` para o contrário). Nos E2E, o `signUp` confirma o email pelo link do email gravado em ficheiro.
- Os alertas continuam a ir para emails por confirmar. Se um dia isso der problemas (emails mal escritos, bounces), passam a exigir a confirmação.
