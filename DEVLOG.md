# DEVLOG

- **2026-10-13 (desktop):** repositório criado com README e sketches. Próximo passo: criar o dev container (`.devcontainer/devcontainer.json`, `docker-compose.yml` com Postgres, `.env.example`) e confirmar que abre no VS Code.
- **2026-10-13 (desktop):** dev container criado: `.devcontainer/devcontainer.json` (imagem Python 3.12 + Node 22, extensões VS Code, portas 8000/5173), `.devcontainer/docker-compose.yml` (serviço `app` + Postgres 16 com healthcheck e volume), `post-create.sh` (cria `.env` a partir de `.env.example`), `.env.example` e `.gitignore`. Testado com `docker compose up`: Python 3.12 a correr e Postgres acessível a partir do `app`. Falta confirmar que abre no VS Code ("Dev Containers: Reopen in Container") e num Codespace. Próximo passo: esqueleto do backend (FastAPI + SQLAlchemy + Alembic) com um endpoint `/health` que fala com a base de dados.
- **2026-10-14 (PC da empresa, sessão cloud do Claude Code):** sem acesso ao Codespace, por isso a validação do Codespace (passo 0) fica pendente. Esqueleto do backend em `backend/`: `pyproject.toml` com as dependências; `app/config.py` (`DATABASE_URL` via `pydantic-settings`), `app/db.py` (engine, sessão e `Base`) e `app/main.py` com `GET /health` a correr `SELECT 1` e a devolver `{"status": "ok", "db": "ok"}`. Alembic configurado: o `env.py` lê o `DATABASE_URL` e usa `Base.metadata`; migração inicial vazia aplicada e tabela `alembic_version` criada. `tests/test_health.py` com `TestClient`: `pytest` passa. Testado com o Postgres 16 local do contentor (`localhost:5432`), em Python 3.13. Nota: o Starlette avisa que o `TestClient` com `httpx` está obsoleto (sugere `httpx2`); é para rever mais tarde. Próximo passo: correr tudo dentro do dev container/Codespace (Python 3.12, `db:5432`) e começar o modelo `Purchase` (compra) com a primeira migração a sério.

## Plano para 2026-10-14 (portátil, Codespaces, 2h)

Objetivo: esqueleto do backend (FastAPI ligado ao Postgres, com `/health` testado).

- [ ] **0:00–0:15 · Validar o Codespace:** criar o Codespace no `main`; confirmar que o `.env` existe, Python 3.12, Node 22; ligar ao Postgres pelo SQLTools ("warrantly (dev)"). Se falhar, anotar aqui e não gastar mais de 15 min.
- [x] **0:15–0:30 · Estrutura:** `backend/` com `pyproject.toml`; dependências `fastapi`, `uvicorn[standard]`, `sqlalchemy`, `psycopg[binary]`, `alembic`, `pydantic-settings`; para testes, `pytest` e `httpx`.
- [x] **0:30–1:00 · App e `/health`:** `config.py` (lê `DATABASE_URL` com `pydantic-settings`), `db.py` (engine e sessão), `main.py` com `GET /health` a correr `SELECT 1` e a devolver `{"status": "ok", "db": "ok"}`. Arrancar com `uvicorn app.main:app --reload --host 0.0.0.0` e abrir a porta 8000.
- [x] **1:00–1:30 · Alembic:** `alembic init`; `env.py` a usar o `DATABASE_URL`; migração inicial vazia; `alembic upgrade head`; confirmar que existe a tabela `alembic_version`.
- [x] **1:30–1:50 · Teste:** `tests/test_health.py` com `TestClient` (código 200 e conteúdo da resposta); `pytest` a passar.
- [x] **1:50–2:00 · Fechar:** entrada no DEVLOG, commit e push.

Se o tempo apertar, o Alembic passa para a sessão seguinte. O mínimo é o `/health` com a base de dados e o teste a passar.

Pendente (portátil): validar o Codespace (passo 0 de 2026-10-14).

Pendente (em casa, desktop): confirmar que o dev container abre no VS Code ("Dev Containers: Reopen in Container").
