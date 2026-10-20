# Desenvolvimento

Como correr, testar e mexer em cada parte do Warrantly. A apresentação do projeto está no [README](../README.md); a AWS em [`cloud.md`](cloud.md) e o push em [`push.md`](push.md).

## Ambiente

O ambiente fica definido em `.devcontainer/`: Python 3.12, Node 22, PostgreSQL 16 (num contentor à parte), Mailpit, AWS CLI, Terraform e o Claude Code.

1. Abre o repositório no VS Code com a extensão Dev Containers e escolhe **Reopen in Container**, ou cria um Codespace.
2. No primeiro arranque, o `.env` é criado a partir de `.env.example`.
3. A base de dados fica disponível em `db:5432` (utilizador, palavra-passe e base de dados: `warrantly`).
4. O Claude Code arranca com `claude` no terminal. Na primeira vez, pede para entrar na conta. A sessão fica num volume do Docker (`claude-config`), por isso sobrevive a um "Rebuild Container".

**No Windows:**
- O Docker Desktop tem de estar a correr ("Engine running") antes do "Reopen in Container". Se o VS Code ficar preso em "Start: Run: Docker Desktop.exe", o problema é o Docker. Abre-o à mão; se não arrancar, corre `wsl --update` e `wsl --shutdown` no PowerShell, e em Settings → Resources → WSL integration liga o Ubuntu.
- Clona o repositório dentro do WSL (`~/dev/warrantly`, no terminal do Ubuntu) e abre-o com `code .`. Num disco do Windows (`C:\...`), tudo fica muito mais lento.

## Backend

API em FastAPI, na pasta `backend/`:

```bash
cd backend
pip install -e '.[dev]'
alembic upgrade head                                 # aplica as migrações
uvicorn app.main:app --reload --host 0.0.0.0         # API em http://localhost:8000 (GET /health)
pytest                                               # testes (precisam do Postgres a correr)
ruff check . && ruff format --check .                # lint e formatação (ruff format . corrige)
```

O URL da base de dados vem da variável `DATABASE_URL`, que é usada pela app e pelo Alembic.

Endpoints (documentação interativa em `/docs`):

| Método | Caminho | O que faz |
| --- | --- | --- |
| `GET` | `/health` | Estado da API e da base de dados |
| `POST` | `/auth/register` | Cria uma conta (email, palavra-passe com 8 caracteres ou mais e, opcionalmente, o nome) |
| `POST` | `/auth/login` | Devolve um token de acesso (form OAuth2: `username` = email, `password`) e começa uma sessão: refresh token num cookie httpOnly (browser) ou no corpo (app móvel, com `X-Client: mobile`) |
| `POST` | `/auth/refresh` | Troca o refresh token (cookie ou `{refresh_token}`) por um token de acesso e um refresh token novos |
| `POST` | `/auth/logout` | Revoga a sessão deste aparelho e apaga o cookie |
| `POST` | `/auth/password-reset` | Envia por email um link para repor a palavra-passe (`{email}`); a resposta é a mesma, exista ou não a conta |
| `POST` | `/auth/password-reset/confirm` | Muda a palavra-passe com o token do link (`{token, password}`) e termina todas as sessões |
| `GET` | `/auth/me` | Dados do utilizador autenticado |
| `GET` | `/auth/sessions` | Sessões abertas (aparelho, entrada, última atividade), com a deste pedido marcada (`current`) |
| `DELETE` | `/auth/sessions/{id}` | Termina a sessão de um aparelho: o refresh token e os tokens de acesso dela deixam logo de servir |
| `POST` | `/auth/sessions/end-others` | Sair dos outros aparelhos (este continua); devolve `{ended}` |
| `PATCH` | `/auth/me` | Altera o nome (usado para assinar as reclamações) |
| `DELETE` | `/auth/me` | Apaga a conta, as compras, os alertas e os ficheiros das faturas (pede a palavra-passe) |
| `POST` | `/push-tokens` | Regista o token de push (Expo) do telemóvel (`{token, platform}`); se já existia noutra conta, passa para esta |
| `DELETE` | `/push-tokens` | Apaga o token deste telemóvel (`{token}`), ao sair da conta na app |
| `POST` | `/auth/verify-email` | Confirma o email com o token do link enviado no registo (`{token}`); não precisa de sessão ([ADR 0008](adr/0008-confirmacao-do-email.md)) |
| `POST` | `/auth/verify-email/resend` | Envia outra vez o link de confirmação (até 5 por hora); 409 se o email já está confirmado |
| `GET` | `/sharing` | Com quem partilho o arquivo (`members`) e os arquivos partilhados comigo (`shared_with_me`), aceites ou por aceitar |
| `POST` | `/sharing` | Convida um email (`{email}`) a ver o meu arquivo e envia-lhe um email; a resposta é igual com ou sem conta. Precisa do email confirmado, tal como ver, aceitar e recusar os convites recebidos. Até 10 pessoas ([ADR 0007](adr/0007-partilha-do-arquivo.md)) |
| `POST` | `/sharing/{id}/accept` | Aceita um convite feito para o meu email |
| `DELETE` | `/sharing/{id}` | Deixa de partilhar (quem convidou) ou recusa ou sai (quem foi convidado) |
| `POST` | `/purchases` | Regista uma compra (garantia de 36 meses por omissão) |
| `GET` | `/purchases` | Lista as compras (as minhas e as dos arquivos partilhados comigo, com `user_id` e `owner_name`) pela garantia que expira primeiro; filtros `store`, `category` e `status` (`active`, `expiring`, `expired`) |
| `GET` | `/purchases/export` | ZIP com `compras.csv` (`;` e vírgula decimal, para o Excel), `compras.json` e as faturas em `faturas/` |
| `GET` | `/purchases/{id}` | Detalhe de uma compra |
| `PATCH` | `/purchases/{id}` | Altera os campos enviados |
| `DELETE` | `/purchases/{id}` | Apaga uma compra (e a fatura, se tiver). Numa compra partilhada comigo, 403, tal como trocar ou apagar a fatura |
| `POST` | `/purchases/uploads` | Upload direto para o S3: devolve um POST pré-assinado (válido 5 min, com o tamanho máximo assinado) para o browser enviar a fatura para `uploads/<utilizador>/<token>`. Sem S3, `direct` vem a `false` e usa-se o upload pela API |
| `POST` | `/purchases/uploads/{token}/scan` | Como `/scan-invoice`, para uma fatura já enviada para o S3 |
| `PUT` | `/purchases/{id}/invoice/upload` | Associa à compra uma fatura enviada para o S3 (`{token, filename}`); valida-a pelos bytes e apaga o temporário |
| `POST` | `/purchases/scan-invoice` | Lê uma fatura (multipart, campo `file`) e devolve sugestões para os campos da compra; não guarda nada. Fotografias precisam do `tesseract` com o português (`tesseract-ocr-por`) |
| `PUT` | `/purchases/{id}/invoice` | Carrega a fatura (multipart, campo `file`); substitui a anterior |
| `GET` | `/purchases/{id}/invoice` | Devolve a fatura |
| `DELETE` | `/purchases/{id}/invoice` | Apaga a fatura |
| `POST` | `/purchases/{id}/claim` | Gera o texto da reclamação à loja a partir da descrição da avaria |
| `POST` | `/purchases/{id}/claim.pdf` | A mesma reclamação em PDF, com a fatura juntada a seguir à carta |

Uma garantia está "a expirar" (`expiring`) quando faltam 60 dias ou menos.

A reclamação é uma carta ao abrigo do Decreto-Lei n.º 84/2021 com os dados da compra (incluindo o n.º da fatura, se preenchido), a descrição da avaria e o nome do utilizador. A API só gera o texto e o PDF; o envio é feito pelo email do próprio utilizador. Na app há três passos: descarregar o PDF (carta e fatura), abrir o programa de email com o email da loja, o assunto e a carta já preenchidos (link `mailto:`) e anexar o PDF. O email da loja é opcional e fica guardado na compra (`store_email`). Se a garantia já terminou, a resposta indica `within_warranty: false`. O PDF (ReportLab e pypdf) junta a fatura a seguir à carta: um PDF é anexado tal como está, e uma imagem passa a uma página A4. Se a fatura não puder ser lida, o PDF sai só com a carta e o cabeçalho `X-Invoice-Included` vem a `false`.

Os endpoints `/purchases` e `/auth/me` pedem o cabeçalho `Authorization: Bearer <token>`, e cada utilizador só vê as suas compras. No `/docs`, o botão **Authorize** faz o login. O token de acesso é assinado com a `SECRET_KEY` (pelo menos 32 caracteres) e dura 15 minutos. Para não ser preciso entrar a toda a hora, o login começa uma sessão de 30 dias (renovada a cada uso) com um refresh token que muda a cada renovação. Se um refresh token já usado voltar a aparecer, a sessão desse aparelho é revogada ([ADR 0004](adr/0004-sessoes-com-refresh-token.md)). O token de acesso leva o id da sessão (`sid`): terminar uma sessão (na conta, ao sair ou ao repor a palavra-passe) corta logo o acesso desse aparelho. A app móvel manda o modelo do telemóvel no login (`X-Device-Name`), para a lista de sessões. O site e a app renovam o token de acesso sozinhos quando recebem um 401.

Quem se esquecer da palavra-passe pede um link em "Esqueci-me da palavra-passe". O link (`APP_URL/repor-palavra-passe#token=...`) serve uma vez, durante 1 hora. O token é assinado e leva uma impressão do hash da palavra-passe atual, por isso deixa de servir assim que a palavra-passe muda, sem ser preciso guardá-lo. Vai no fragmento (`#`), que o browser não envia ao servidor. Mudar a palavra-passe termina todas as sessões. Os pedidos têm limite por IP e por email.

As faturas podem ser PDF, JPEG, PNG, WebP ou HEIC (fotografias do iPhone), até 10 MB. O tipo é reconhecido pelo conteúdo do ficheiro, não pelo nome. As fotografias HEIC são convertidas para JPEG (com a orientação corrigida), porque a maioria dos browsers não as mostra. Ficam guardadas em disco na pasta `UPLOAD_DIR` (por omissão `backend/uploads/`, que não vai para o git), com um nome aleatório.

## Alertas por email e no telemóvel

O comando `python -m app.alerts` (na pasta `backend/`) envia os avisos de garantias a acabar: um email por utilizador quando faltam 60 dias e outro quando faltam 15. Quem tiver a app móvel com as notificações ligadas recebe também o aviso no telemóvel (push pelo serviço do Expo; tocar abre a compra). Ver [`docs/push.md`](push.md). Os avisos enviados ficam registados, por isso correr o comando várias vezes não repete emails. Deve correr uma vez por dia. Na AWS, o EventBridge Scheduler invoca o Lambda às 08:47 de Lisboa ([ADR 0006](adr/0006-alertas-com-eventbridge-scheduler.md)); num servidor próprio, chega um cron:

```cron
0 9 * * * cd /caminho/para/warrantly/backend && python -m app.alerts
```

No dev container, os emails vão para o Mailpit em http://localhost:8025 e não chegam a ser enviados.

## Frontend

React com TypeScript (Vite), na pasta `frontend/`:

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (precisa da API a correr na porta 8000)
npm test           # testes de componentes (Vitest + Testing Library)
npm run lint       # oxlint
npm run typecheck  # tsc
npm run build      # build de produção em frontend/dist/
```

Testes de ponta a ponta (Playwright, na pasta `frontend/e2e/`): arrancam sozinhos a API (com as migrações) e o Vite, e usam a app no Chromium (registo e login, compra com fatura, painel, edição, reclamação e PDF). O `e2e/a11y.spec.ts` passa o [axe](https://github.com/dequelabs/axe-core) (WCAG 2.2 AA) em todas as páginas, nos modos claro e escuro e a 320 px de largura, e testa a navegação só com o teclado. Precisam do Postgres a correr.

```bash
cd frontend
npx playwright install chromium   # só da primeira vez
npm run e2e
```

Se a API e o Vite já estiverem a correr, os testes usam-nos (nesse caso, arrancar a API com `RATE_LIMITS=false`, senão os registos seguidos batem no limite de tentativas). Cada teste cria o seu próprio utilizador (`e2e-…@example.com`); para limpar a base de dados de desenvolvimento: `DELETE FROM users WHERE email LIKE 'e2e-%@example.com'`.

Em desenvolvimento, o Vite reencaminha os pedidos a `/api/...` para a API em `http://localhost:8000` (configurável com `API_URL`), por isso não é preciso configurar CORS. Páginas: login e registo (`/entrar`), painel (`/`), nova compra (`/compras/nova`), detalhe (`/compras/:id`), edição (`/compras/:id/editar`) e conta (`/conta`: nome, tema, exportar, partilha, sessões e apagar conta) e a confirmação do email (`/confirmar-email`, a página do link). O tema segue o modo claro/escuro do sistema, mas pode ser fixado em "Claro" ou "Escuro" (fica guardado no browser).

## App móvel

App para Android e iOS em [Expo](https://expo.dev) (React Native, SDK 58, Expo Router), na pasta `mobile/`. Usa a mesma API e a mesma conta do site. Faz o essencial para usar na loja ou em casa:
- entrar (o token fica guardado no armazenamento seguro do telemóvel, com o `expo-secure-store`), **criar conta** (com o nome, opcional) e pedir o link para **repor a palavra-passe**;
- ver as garantias, com as que estão a expirar primeiro e o aviso de quantas terminam nos próximos 60 dias, e puxar para atualizar;
- ver o detalhe de uma compra, **juntar ou trocar a fatura** (fotografar ou escolher um ficheiro) e **abrir a fatura** (descarregada para a cache do telemóvel com o `expo-file-system` e aberta no visualizador do sistema com o `expo-sharing`);
- **reclamar à loja**: a API escreve a carta (como no site), e o email do telemóvel abre com o destinatário, o assunto, a carta e o PDF (carta e fatura) em anexo, com o `expo-mail-composer`; sem uma conta de email no telemóvel, partilha-se o PDF;
- **editar e apagar** uma compra (os campos e a validação do formulário estão em `src/lib/purchaseForm.tsx`, partilhados com a compra nova);
- registar uma compra **fotografando a fatura** (ou escolhendo um PDF): a fatura vai para o S3 (ou pela API, sem S3) e a leitura preenche os campos vazios, como no site;
- **partilhar o arquivo com a família** na conta, como no site: convidar pelo email, aceitar ou recusar os convites, sair ou deixar de partilhar. As compras partilhadas mostram de quem são e não têm "Apagar" nem "Trocar a fatura" ([ADR 0007](adr/0007-partilha-do-arquivo.md));
- **exportar os dados**: o ZIP (CSV, JSON e faturas) é descarregado para a cache e abre o menu do sistema para o guardar ou enviar;
- mudar o **nome** na conta, que assina as reclamações, e **apagar a conta** com a palavra-passe (a App Store exige que uma app que deixa criar conta também a deixe apagar);
- ver as **sessões abertas** na conta (os aparelhos com login feito), terminar a de outro aparelho ou sair de todos os outros, e sair deste;
- receber os **alertas de garantia como notificações** (tocar abre a compra). O push precisa de uma development build (EAS), porque a Expo Go no Android já não o recebe: ver [`docs/push.md`](push.md).

Ficam no site só as páginas dos links dos emails (escolher a palavra-passe nova e confirmar o email) e o tema fixo, porque a app segue sempre o tema do telemóvel. Os tipos e as funções da garantia (`src/shared/`) são cópias do frontend, e um teste confirma que se mantêm iguais.

```bash
cd mobile
npm install
cp .env.example .env.local   # EXPO_PUBLIC_API_URL: o endereço da API visto do telemóvel
npx expo start --go          # QR code para abrir na app Expo Go (sem push no Android)
npx expo start               # com a development build instalada (com push)
npm run lint && npm run typecheck && npm test
```

**Ícone:** o escudo com o visto, desenhado uma só vez em `frontend/scripts/icons/generate.mjs`. O `npm run icons` (pasta `frontend/`) gera todas as variantes com o Chromium do Playwright:
- o favicon e o `apple-touch-icon.png` do site;
- o ícone da app, quadrado e sem transparência, porque o sistema arredonda os cantos;
- o ícone adaptativo do Android (frente, fundo e monocromático), com o escudo dentro dos 66 % centrais que o sistema nunca corta;
- o ecrã de arranque (`expo-splash-screen`, com fundo claro e escuro).

As imagens geradas ficam no repositório, por isso só é preciso correr o script ao mudar o desenho.

O telemóvel tem de chegar à API. Há três formas:
- **Sem contentor:** o telemóvel e o computador na mesma rede Wi-Fi, a API com `uvicorn app.main:app --host 0.0.0.0` e `EXPO_PUBLIC_API_URL=http://<IP do computador>:8000`.
- **No Codespace:** pôr a porta 8000 como pública e usar o endereço `https://…-8000.app.github.dev`, com `npx expo start --tunnel`.
- **Contra a AWS:** `EXPO_PUBLIC_API_URL=https://<domínio do CloudFront>/api`.

O CI corre em cada PR e em cada push para o `main`: `.github/workflows/backend.yml` corre o ruff (lint e formatação), aplica as migrações e corre os testes com Postgres, `.github/workflows/frontend.yml` corre o lint, os tipos, os testes e o build do frontend, `.github/workflows/mobile.yml` corre o lint, os tipos, os testes e o bundle de Android da app móvel, e `.github/workflows/e2e.yml` corre os testes do Playwright com Postgres (o relatório fica como artefacto quando falham).

## Capturas de ecrã do README

As imagens em `docs/images/` são geradas pelo Playwright, com uma conta de exemplo que é apagada no fim:

```bash
cd frontend
npm run screenshots   # precisa do Postgres; arranca a API e o Vite como os E2E
```
