# DEVLOG

- **2026-10-13 (desktop):** repositório criado com README e sketches. Próximo passo: criar o dev container (`.devcontainer/devcontainer.json`, `docker-compose.yml` com Postgres, `.env.example`) e confirmar que abre no VS Code.
- **2026-10-13 (desktop):** dev container criado: `.devcontainer/devcontainer.json` (imagem Python 3.12 + Node 22, extensões VS Code, portas 8000/5173), `.devcontainer/docker-compose.yml` (serviço `app` + Postgres 16 com healthcheck e volume), `post-create.sh` (cria `.env` a partir de `.env.example`), `.env.example` e `.gitignore`. Testado com `docker compose up`: Python 3.12 a correr e Postgres acessível a partir do `app`. Falta confirmar que abre no VS Code ("Dev Containers: Reopen in Container") e num Codespace. Próximo passo: esqueleto do backend (FastAPI + SQLAlchemy + Alembic) com um endpoint `/health` que fala com a base de dados.

## Plano para 2026-10-14 (portátil, Codespaces, 2h)

Objetivo: esqueleto do backend (FastAPI ligado ao Postgres, com `/health` testado).

- [ ] **0:00–0:15 · Validar o Codespace:** criar o Codespace no `main`; confirmar que o `.env` existe, Python 3.12, Node 22; ligar ao Postgres pelo SQLTools ("warrantly (dev)"). Se falhar, anotar aqui e não gastar mais de 15 min.
- [ ] **0:15–0:30 · Estrutura:** `backend/` com `pyproject.toml`; dependências `fastapi`, `uvicorn[standard]`, `sqlalchemy`, `psycopg[binary]`, `alembic`, `pydantic-settings`; para testes, `pytest` e `httpx`.
- [ ] **0:30–1:00 · App e `/health`:** `config.py` (lê `DATABASE_URL` com `pydantic-settings`), `db.py` (engine e sessão), `main.py` com `GET /health` a correr `SELECT 1` e a devolver `{"status": "ok", "db": "ok"}`. Arrancar com `uvicorn app.main:app --reload --host 0.0.0.0` e abrir a porta 8000.
- [ ] **1:00–1:30 · Alembic:** `alembic init`; `env.py` a usar o `DATABASE_URL`; migração inicial vazia; `alembic upgrade head`; confirmar que existe a tabela `alembic_version`.
- [ ] **1:30–1:50 · Teste:** `tests/test_health.py` com `TestClient` (código 200 e conteúdo da resposta); `pytest` a passar.
- [ ] **1:50–2:00 · Fechar:** entrada no DEVLOG, commit e push.

Se o tempo apertar, o Alembic passa para a sessão seguinte. O mínimo é o `/health` com a base de dados e o teste a passar.

Pendente (em casa, desktop): confirmar que o dev container abre no VS Code ("Dev Containers: Reopen in Container").
