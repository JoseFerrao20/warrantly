# Warrantly

Arquivo de garantias: compras com fatura, prazo da garantia calculado, alertas por email e reclamação à loja (texto, PDF e envio pelo email do utilizador). Projeto de aprendizagem full stack de José Ferrão. O `README.md` descreve a app e o deploy; o `DEVLOG.md` tem o histórico e, no fim, o **plano da próxima sessão**: ler esse plano antes de começar.

## Estrutura

- `backend/`: FastAPI + SQLAlchemy 2 + Alembic + Postgres 16 (Python 3.12 no CI e no Docker).
  - `app/main.py` (API de desenvolvimento) e `app/server.py` (produção: API em `/api` e frontend na raiz).
  - `app/routers/`: `auth`, `purchases` (compras, fatura, reclamação, PDF, exportação) e `internal` (alertas por HTTP).
  - `app/claims.py` (texto da carta), `app/claim_pdf.py` (PDF com a fatura junta), `app/alerts.py` (`python -m app.alerts`), `app/storage.py` (faturas em disco e conversão de HEIC), `app/export.py` (ZIP com CSV, JSON e faturas), `app/invoice_scan.py` (leitura da fatura: texto do PDF ou OCR com o Tesseract, e sugestão dos campos).
- `frontend/`: Vite + React 19 + TypeScript + React Router 8, CSS próprio em `src/index.css` (tokens claro/escuro). Testes em `src/**/*.test.tsx` (Vitest) e `e2e/` (Playwright).
- `.devcontainer/` (dev container e Codespace, com Postgres e Mailpit), `Dockerfile` e `fly.toml` (produção) e `.github/workflows/` (backend, frontend, e2e, docker, deploy e alerts).

## Comandos

Nas sessões cloud, o hook `.claude/hooks/session-start.sh` arranca o Postgres, instala as dependências, aplica as migrações e põe o `.venv` do backend no PATH.

```bash
# Backend (pasta backend/)
pytest                                        # testes (precisam do Postgres)
ruff check . && ruff format --check .         # lint e formatação (ruff format . corrige)
alembic revision --autogenerate -m "..."      # nova migração depois de mudar um modelo
alembic upgrade head && alembic downgrade -1 && alembic upgrade head && alembic check
uvicorn app.main:app --reload --port 8000     # API para desenvolvimento

# Frontend (pasta frontend/)
npm run lint && npm run typecheck && npm test && npm run build
npm run dev                                   # http://localhost:5173 (proxy /api → :8000)
npm run e2e                                   # Playwright; arranca a API e o Vite sozinho
```

## Convenções

- Interface, mensagens de erro, README, DEVLOG e descrições de PR em **português de Portugal**; mensagens de commit em inglês.
- Cada alteração vai num PR a partir de um ramo; o CI (backend, frontend, E2E e Docker) tem de estar verde antes do merge. O utilizador decide quando se faz o merge.
- No fim de cada trabalho: entrada nova no `DEVLOG.md` (o que se fez, decisões e lições) e o plano da próxima sessão atualizado.
- Mudanças no modelo levam sempre uma migração gerada com `--autogenerate`, revista e testada com upgrade, downgrade e `alembic check`.
- Testes do backend: cada teste corre numa transação desfeita no fim (fixtures `db_session`, `client`, `auth_client` e `user` em `tests/conftest.py`); as faturas vão para uma pasta temporária.
- Testes E2E: cada teste cria o seu utilizador `e2e-…@example.com`. Na base de dados de desenvolvimento, limpar com `DELETE FROM users WHERE email LIKE 'e2e-%@example.com'`.

## Armadilhas já encontradas

- Não usar `pkill -f uvicorn` (ou padrões parecidos): também apanha a shell que corre o comando. Usar o PID ou `ps -eo pid,args | awk '/[u]vicorn/ {print $1}' | xargs -r kill`.
- O Chromium "headless shell" do Playwright não tem visualizador de PDF, porque trata um PDF como download; testar o pedido da fatura, não a página.
- O Chromium não lê ficheiros de upload com acentos no caminho; nos testes, passar o ficheiro a partir da memória (`setInputFiles({ name, mimeType, buffer })`).
- `getByLabel('Loja')` no Playwright também apanha "Email da loja": usar `{ exact: true }`.
- As migrações geradas passam pelo ruff (hooks no `alembic.ini`), por isso o `ruff` tem de estar no PATH ao correr `alembic revision`. O isort do ruff trata `alembic` como pacote externo (`known-third-party`), apesar da pasta `alembic/`.
- Acessibilidade: o `e2e/a11y.spec.ts` (axe, WCAG 2.2 AA) tem de continuar limpo. Cores novas passam pelos tokens em `src/index.css` com contraste ≥ 4.5:1 nos dois temas; cada página chama `usePageTitle` e tem um `h1`; nada clicável só com o rato (usar `button`/`a`).
- Segurança: o servidor de produção (`app/server.py`) envia uma CSP sem scripts inline, por isso nada de `<script>` inline no `index.html` (usar `public/`). Para testar a CSP, correr `uvicorn app.server:server` com `STATIC_DIR=../frontend/dist` e os E2E com `E2E_BASE_URL`. Os limites de tentativas (`app/rate_limit.py`) desligam-se com `RATE_LIMITS=false`, só nos E2E.
- OCR: precisa do programa `tesseract` com o português (`tesseract-ocr-por`); o hook e o `post-create.sh` instalam-no. Sem ele, só as fotografias deixam de dar sugestões e o teste de OCR é saltado. A leitura só sugere: na dúvida, é melhor não sugerir nada.
- O React StrictMode corre os efeitos duas vezes em desenvolvimento: não contar com "primeira execução" num `useEffect`.
- O pytest trata `StarletteDeprecationWarning` como erro: o `TestClient` precisa do `httpx2`, não do `httpx`.
- Variáveis vazias no `.env` contam como não definidas (`env_ignore_empty`); em produção, `ENVIRONMENT=production` recusa a `SECRET_KEY` de exemplo.
