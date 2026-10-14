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
| `POST` | `/auth/register` | Cria uma conta (email e palavra-passe com 8 caracteres ou mais) |
| `POST` | `/auth/login` | Devolve um token de acesso (form OAuth2: `username` = email, `password`) |
| `GET` | `/auth/me` | Dados do utilizador autenticado |
| `POST` | `/purchases` | Regista uma compra (garantia de 36 meses por omissão) |
| `GET` | `/purchases` | Lista as compras pela garantia que expira primeiro; filtros `store`, `category` e `status` (`active`, `expiring`, `expired`) |
| `GET` | `/purchases/{id}` | Detalhe de uma compra |
| `PATCH` | `/purchases/{id}` | Altera os campos enviados |
| `DELETE` | `/purchases/{id}` | Apaga uma compra |

Uma garantia está "a expirar" (`expiring`) quando faltam 60 dias ou menos.

Os endpoints `/purchases` e `/auth/me` pedem o cabeçalho `Authorization: Bearer <token>`, e cada utilizador só vê as suas compras. No `/docs`, o botão **Authorize** faz o login. O token é assinado com a `SECRET_KEY` (pelo menos 32 caracteres) e dura 60 minutos.

O CI (`.github/workflows/backend.yml`) corre as migrações e os testes com Postgres em cada PR e em cada push para o `main`.
