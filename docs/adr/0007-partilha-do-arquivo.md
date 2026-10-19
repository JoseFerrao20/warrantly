# 0007. Partilha do arquivo de garantias com a família

- Estado: aceite
- Data: 2026-10-19

## Contexto

Numa casa, as compras não são de uma só pessoa. A máquina de lavar pode estar na conta de quem a comprou, mas a avaria pode calhar a outra pessoa, que precisa da fatura e de reclamar à loja. Até aqui, cada compra só era visível para a conta que a registou: `get_purchase_or_404` respondia 404 a todas as outras.

Havia duas formas de o resolver:
- **uma "família" com várias contas lá dentro**, dona das compras;
- **partilhar o arquivo de uma conta** com outras contas.

A primeira obrigava a mudar a quem pertence cada compra, os alertas, a exportação e o apagar da conta. A segunda deixa tudo isso como está e só acrescenta quem pode ver.

## Decisão

- **Partilha por convite, de uma conta para outra** (tabela `archive_shares`): `owner_id`, o `email` convidado (em minúsculas), e `member_id` e `accepted_at` quando a pessoa aceita. A partilha é num só sentido: partilhar o meu arquivo não me dá acesso ao da outra pessoa.
- **O convite é para o email, não para a conta.** A resposta é a mesma exista ou não uma conta com esse email, por isso não serve para descobrir quem usa o Warrantly (tal como a recuperação da palavra-passe). Quem criar a conta mais tarde encontra o convite na página da conta.
- **A pessoa convidada tem de aceitar.** Até lá, não vê nada. Pode recusar, e mais tarde sair; quem partilha pode deixar de partilhar a qualquer momento. As duas coisas apagam a linha.
- **O que pode quem aceita:** ver as compras e as faturas, editar os campos e reclamar à loja. A carta é assinada por quem reclama.
- **O que fica com quem registou a compra:**
  - apagar a compra;
  - apagar ou trocar a fatura, porque trocar apaga a anterior;
  - exportar os dados, que continua a levar só as compras da própria conta;
  - receber os alertas por email e push.

  Nas rotas, isto é o `owner_only=True` do `get_purchase_or_404`, que responde 403.
- **Limites:** 10 pessoas por arquivo, e 20 convites por hora por conta, porque cada convite envia um email para um endereço escolhido por quem convida.
- **A compra diz de quem é:** o `PurchaseRead` ganhou `user_id` e `owner_name`. O site e a app mostram "de Ana Silva" nas compras dos outros e escondem os botões que a API recusaria.

## Consequências

- Quase todas as rotas das compras passam por `sharing.can_access`, que faz mais uma consulta pequena (indexada) quando a compra não é de quem pede.
- A lista de compras junta as minhas às dos arquivos partilhados comigo, ordenadas da mesma forma, sem separar por dona.
- Apagar a conta de quem partilhou apaga as partilhas (ON DELETE CASCADE), e as compras deixam de aparecer a quem as via.
- **Risco aceite:** quem recebe um convite para um email que já não usa (ou que não é seu) e cria uma conta com ele passa a ver o convite. Para aceitar, precisa dessa conta, e criar a conta não pede para confirmar o email. Como só se convida quem se conhece, e aceitar não dá acesso a nada da conta de quem aceita, fica assim. Se um dia o registo confirmar o email, este risco desaparece.
- Não há papéis (só leitura, administrador). Se um dia fizerem falta, cabem numa coluna nova em `archive_shares`.
