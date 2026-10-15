# Warrantly

Arquivo de garantias: guarda as faturas das tuas compras, acompanha o prazo de garantia de cada uma e avisa-te antes de expirarem. Quando algo avaria, gera a reclamação para a loja já preenchida.

> Estado: em desenvolvimento (projeto de aprendizagem full stack, 12 semanas).

## O problema

Em Portugal, os bens novos têm 3 anos de garantia legal (Decreto-Lei n.º 84/2021). Na prática, quando a máquina de lavar avaria ao fim de dois anos e meio, ninguém sabe onde está a fatura, quando foi a compra, nem o que escrever à loja. A garantia existe, mas acaba por não ser usada.

## O que a app faz

- **Registar compras:** carregas a fatura (PDF ou fotografia) e indicas o produto, a loja, a data e o preço.
- **Calcular o prazo:** a data de fim da garantia é calculada automaticamente (3 anos por omissão, ajustável para garantias de marca ou bens usados).
- **Painel:** todas as garantias ordenadas pela que expira primeiro, com o estado de cada uma (ativa, a expirar, expirada).
- **Alertas:** aviso por email 60 e 15 dias antes de cada garantia expirar.
- **Reclamação pronta:** a partir de uma compra e de uma descrição da avaria, gera o texto da reclamação para a loja, com os dados da compra e a fatura em anexo.
- **Pesquisa e filtros:** por loja, categoria e estado.

Ideias para depois: ler automaticamente os dados da fatura (OCR), partilhar o arquivo com a família, exportar tudo num ZIP.

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
| `POST` | `/purchases` | Regista uma compra (garantia de 36 meses por omissão) |
| `GET` | `/purchases` | Lista as compras pela garantia que expira primeiro; filtros `store`, `category` e `status` (`active`, `expiring`, `expired`) |
| `GET` | `/purchases/{id}` | Detalhe de uma compra |
| `PATCH` | `/purchases/{id}` | Altera os campos enviados |
| `DELETE` | `/purchases/{id}` | Apaga uma compra (e a fatura, se tiver) |
| `PUT` | `/purchases/{id}/invoice` | Carrega a fatura (multipart, campo `file`); substitui a anterior |
| `GET` | `/purchases/{id}/invoice` | Devolve a fatura |
| `DELETE` | `/purchases/{id}/invoice` | Apaga a fatura |
| `POST` | `/purchases/{id}/claim` | Gera o texto da reclamação à loja a partir da descrição da avaria |

Uma garantia está "a expirar" (`expiring`) quando faltam 60 dias ou menos.

A reclamação é uma carta ao abrigo do Decreto-Lei n.º 84/2021 com os dados da compra (incluindo o n.º da fatura, se preenchido), a descrição da avaria e o nome do utilizador. A API só gera o texto: na app, o utilizador copia-o ou abre-o no email. Se a garantia já terminou, a resposta indica `within_warranty: false`.

Os endpoints `/purchases` e `/auth/me` pedem o cabeçalho `Authorization: Bearer <token>`, e cada utilizador só vê as suas compras. No `/docs`, o botão **Authorize** faz o login. O token é assinado com a `SECRET_KEY` (pelo menos 32 caracteres) e dura 60 minutos.

As faturas podem ser PDF, JPEG, PNG ou WebP, até 10 MB. O tipo é reconhecido pelo conteúdo do ficheiro, não pelo nome. Ficam guardadas em disco na pasta `UPLOAD_DIR` (por omissão `backend/uploads/`, que não vai para o git), com um nome aleatório.

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

Em desenvolvimento, o Vite reencaminha os pedidos a `/api/...` para a API em `http://localhost:8000` (configurável com `API_URL`), por isso não é preciso configurar CORS. Páginas: login e registo (`/entrar`), painel (`/`), nova compra (`/compras/nova`), detalhe (`/compras/:id`) e edição (`/compras/:id/editar`).

O CI corre em cada PR e em cada push para o `main`: `.github/workflows/backend.yml` aplica as migrações e corre os testes com Postgres, e `.github/workflows/frontend.yml` corre o lint, os tipos, os testes e o build do frontend.
