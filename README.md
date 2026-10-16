# Warrantly

Arquivo de garantias: guarda as faturas das tuas compras, acompanha o prazo de garantia de cada uma e avisa-te antes de expirarem. Quando algo avaria, gera a reclamação para a loja já preenchida.

> Estado: em desenvolvimento (projeto de aprendizagem full stack, 12 semanas).

## O problema

Em Portugal, os bens novos têm 3 anos de garantia legal (Decreto-Lei n.º 84/2021). Na prática, quando a máquina de lavar avaria ao fim de dois anos e meio, ninguém sabe onde está a fatura, quando foi a compra, nem o que escrever à loja. A garantia existe, mas acaba por não ser usada.

## O que a app faz

- **Registar compras:** carregas a fatura (PDF ou fotografia) e a app lê-a e sugere o produto, a loja, a data, o preço e o n.º da fatura (PDF com texto diretamente; fotografias com OCR, pelo Tesseract, sem sair do servidor). Confirmas e corriges antes de guardar.
- **Calcular o prazo:** a data de fim da garantia é calculada automaticamente (3 anos por omissão, ajustável para garantias de marca ou bens usados).
- **Painel:** todas as garantias ordenadas pela que expira primeiro, com o estado de cada uma (ativa, a expirar, expirada).
- **Alertas:** aviso por email 60 e 15 dias antes de cada garantia expirar.
- **Reclamação pronta:** a partir de uma compra e de uma descrição da avaria, gera o texto da reclamação para a loja, com os dados da compra e a fatura em anexo.
- **Pesquisa e filtros:** por loja, categoria e estado.
- **Exportar:** um ZIP com todas as compras (CSV para o Excel e JSON) e as faturas.

Ideias para depois: partilhar o arquivo com a família.

## Sketches

**Painel**

![Painel com as garantias ordenadas por data de fim](docs/sketches/painel.svg)

**Nova compra**

![Formulário para registar uma compra com a fatura](docs/sketches/nova-compra.svg)

**Gerar reclamação**

![Detalhe de uma compra e pré-visualização da reclamação](docs/sketches/reclamacao.svg)

## Stack prevista

- **Frontend:** React com TypeScript
- **Backend:** Python (API REST) com PostgreSQL e migrações Alembic
- **Testes:** pytest, testes de componentes e Playwright (E2E)
- **Ambiente:** dev container (VS Code no desktop, GitHub Codespaces no portátil)
- **Entrega:** CI no GitHub Actions, Docker e deploy

## Desenvolvimento

O ambiente fica definido em `.devcontainer/`: Python 3.12, Node 22 e PostgreSQL 16 (num contentor à parte).

1. Abre o repositório no VS Code com a extensão Dev Containers e escolhe **Reopen in Container**, ou cria um Codespace.
2. No primeiro arranque, o `.env` é criado a partir de `.env.example`.
3. A base de dados fica disponível em `db:5432` (utilizador, palavra-passe e base de dados: `warrantly`).

### Backend

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
| `POST` | `/auth/login` | Devolve um token de acesso (form OAuth2: `username` = email, `password`) |
| `GET` | `/auth/me` | Dados do utilizador autenticado |
| `PATCH` | `/auth/me` | Altera o nome (usado para assinar as reclamações) |
| `DELETE` | `/auth/me` | Apaga a conta, as compras, os alertas e os ficheiros das faturas (pede a palavra-passe) |
| `POST` | `/purchases` | Regista uma compra (garantia de 36 meses por omissão) |
| `GET` | `/purchases` | Lista as compras pela garantia que expira primeiro; filtros `store`, `category` e `status` (`active`, `expiring`, `expired`) |
| `GET` | `/purchases/export` | ZIP com `compras.csv` (`;` e vírgula decimal, para o Excel), `compras.json` e as faturas em `faturas/` |
| `GET` | `/purchases/{id}` | Detalhe de uma compra |
| `PATCH` | `/purchases/{id}` | Altera os campos enviados |
| `DELETE` | `/purchases/{id}` | Apaga uma compra (e a fatura, se tiver) |
| `POST` | `/purchases/scan-invoice` | Lê uma fatura (multipart, campo `file`) e devolve sugestões para os campos da compra; não guarda nada. Fotografias precisam do `tesseract` com o português (`tesseract-ocr-por`) |
| `PUT` | `/purchases/{id}/invoice` | Carrega a fatura (multipart, campo `file`); substitui a anterior |
| `GET` | `/purchases/{id}/invoice` | Devolve a fatura |
| `DELETE` | `/purchases/{id}/invoice` | Apaga a fatura |
| `POST` | `/purchases/{id}/claim` | Gera o texto da reclamação à loja a partir da descrição da avaria |
| `POST` | `/purchases/{id}/claim.pdf` | A mesma reclamação em PDF, com a fatura juntada a seguir à carta |

Uma garantia está "a expirar" (`expiring`) quando faltam 60 dias ou menos.

A reclamação é uma carta ao abrigo do Decreto-Lei n.º 84/2021 com os dados da compra (incluindo o n.º da fatura, se preenchido), a descrição da avaria e o nome do utilizador. A API só gera o texto e o PDF; o envio é feito pelo email do próprio utilizador. Na app há três passos: descarregar o PDF (carta e fatura), abrir o programa de email com o email da loja, o assunto e a carta já preenchidos (link `mailto:`) e anexar o PDF. O email da loja é opcional e fica guardado na compra (`store_email`). Se a garantia já terminou, a resposta indica `within_warranty: false`. O PDF (ReportLab e pypdf) junta a fatura a seguir à carta: um PDF é anexado tal como está, e uma imagem passa a uma página A4. Se a fatura não puder ser lida, o PDF sai só com a carta e o cabeçalho `X-Invoice-Included` vem a `false`.

Os endpoints `/purchases` e `/auth/me` pedem o cabeçalho `Authorization: Bearer <token>`, e cada utilizador só vê as suas compras. No `/docs`, o botão **Authorize** faz o login. O token é assinado com a `SECRET_KEY` (pelo menos 32 caracteres) e dura 60 minutos.

As faturas podem ser PDF, JPEG, PNG, WebP ou HEIC (fotografias do iPhone), até 10 MB. O tipo é reconhecido pelo conteúdo do ficheiro, não pelo nome. As fotografias HEIC são convertidas para JPEG (com a orientação corrigida), porque a maioria dos browsers não as mostra. Ficam guardadas em disco na pasta `UPLOAD_DIR` (por omissão `backend/uploads/`, que não vai para o git), com um nome aleatório.

### Alertas por email

O comando `python -m app.alerts` (na pasta `backend/`) envia os avisos de garantias a acabar: um email por utilizador quando faltam 60 dias e outro quando faltam 15. Os avisos enviados ficam registados, por isso correr o comando várias vezes não repete emails. Deve correr uma vez por dia, por exemplo com cron:

```cron
0 9 * * * cd /caminho/para/warrantly/backend && python -m app.alerts
```

No dev container, os emails vão para o Mailpit em http://localhost:8025 e não chegam a ser enviados.

### Frontend

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

Em desenvolvimento, o Vite reencaminha os pedidos a `/api/...` para a API em `http://localhost:8000` (configurável com `API_URL`), por isso não é preciso configurar CORS. Páginas: login e registo (`/entrar`), painel (`/`), nova compra (`/compras/nova`), detalhe (`/compras/:id`), edição (`/compras/:id/editar`) e conta (`/conta`: nome, tema e apagar conta). O tema segue o modo claro/escuro do sistema, mas pode ser fixado em "Claro" ou "Escuro" (fica guardado no browser).

O CI corre em cada PR e em cada push para o `main`: `.github/workflows/backend.yml` corre o ruff (lint e formatação), aplica as migrações e corre os testes com Postgres, `.github/workflows/frontend.yml` corre o lint, os tipos, os testes e o build do frontend, e `.github/workflows/e2e.yml` corre os testes do Playwright com Postgres (o relatório fica como artefacto quando falham).

## Cloud (AWS)

O Warrantly corre na AWS, como projeto de aprendizagem de cloud (antes estava preparado para o Fly.io; ver ADR 0001): roteiro em [`docs/cloud.md`](docs/cloud.md) e decisões em [`docs/adr/`](docs/adr/). Arquitetura serverless ([ADR 0002](docs/adr/0002-arquitetura-serverless.md)): Lambda (a mesma imagem Docker, com o Lambda Web Adapter), S3 + CloudFront, Neon, SES e SSM Parameter Store. Já feito: faturas no S3 (`STORAGE_BACKEND=s3`) e a app pronta para o Lambda (segredos no SSM, email pelo SES e ligações sem pool).

## Deploy (AWS)

Arquitetura serverless ([ADR 0002](docs/adr/0002-arquitetura-serverless.md)): o CloudFront serve o frontend a partir do S3 e manda `/api/*` para um Lambda que corre a imagem Docker da app (com o Lambda Web Adapter). A base de dados é o Neon, as faturas ficam no S3, o email sai pelo SES e os segredos ficam no SSM Parameter Store. Toda a infraestrutura está em Terraform (`infra/`).

Workflows do GitHub Actions:

- `docker.yml`: constrói a imagem e corre os testes E2E contra o contentor (em cada PR e no `main`).
- `infra.yml`: `terraform fmt` e `validate` em cada PR que mexa em `infra/`, e o `plan` quando a AWS está configurada.
- `deploy.yml`: depois do `docker.yml` no `main`, entra na AWS por OIDC, publica a imagem, aplica as migrações e o Terraform, e atualiza o Lambda e o frontend. Sem a variável `AWS_DEPLOY_ROLE_ARN`, não faz nada.
- `alerts.yml`: todos os dias às 07:47 UTC chama `POST /api/internal/alerts` para enviar os alertas de garantia. Sem `APP_URL` e `ALERTS_TOKEN`, não faz nada.

### Segurança

- **Palavras-passe:** Argon2. No login com um email que não existe, a resposta demora o mesmo, para não revelar que emails estão registados.
- **Sessão:** token JWT (HS256) válido 60 minutos. Em produção, a app recusa arrancar com a `SECRET_KEY` de exemplo.
- **Limite de tentativas** (em memória, `app/rate_limit.py`): 5 falhas de login por IP e email em 15 minutos, 30 por IP, 20 por email (de qualquer IP), 10 registos por IP por hora e 5 palavras-passe erradas ao apagar a conta. Depois disso, a resposta é 429 com `Retry-After`. Cada instância do Lambda conta à parte. `RATE_LIMITS=false` desliga os limites (só nos testes E2E).
- **Pedidos grandes:** a API corta qualquer pedido acima de 11 MB (413), mesmo sem `Content-Length`, antes de o guardar em disco.
- **Faturas:** o tipo é reconhecido pelos primeiros bytes (só PDF, JPEG, PNG, WebP e HEIC), o ficheiro fica com um nome aleatório e o download sai com `nosniff`.
- **Cabeçalhos** (servidor de produção): CSP sem scripts inline (`script-src 'self'`), `frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` e HSTS. O `/api/docs` e o `/api/openapi.json` não existem em produção.
- **Dependências:** `pip-audit` (backend) e `npm audit` (frontend), sem vulnerabilidades conhecidas a 2026-10-15.

### Configuração inicial (uma vez)

Passo a passo em [`docs/cloud.md`, "Primeiro deploy"](docs/cloud.md#primeiro-deploy-em-casa-uma-vez): conta AWS com MFA, Neon, bootstrap do Terraform, segredos no SSM, variáveis no GitHub e o primeiro deploy pelo Actions.
