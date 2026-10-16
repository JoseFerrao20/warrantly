# Warrantly

Arquivo de garantias: compras com fatura, prazo da garantia calculado, alertas por email e reclamação à loja (texto, PDF e envio pelo email do utilizador). Projeto de aprendizagem full stack de José Ferrão. O `README.md` descreve a app e o deploy; o `DEVLOG.md` tem o histórico e, no fim, o **plano da próxima sessão**: ler esse plano antes de começar.

## Estrutura

- `backend/`: FastAPI + SQLAlchemy 2 + Alembic + Postgres 16 (Python 3.12 no CI e no Docker).
  - `app/main.py` (API de desenvolvimento) e `app/server.py` (produção: API em `/api` e frontend na raiz).
  - `app/routers/`: `auth`, `purchases` (compras, fatura, reclamação, PDF, exportação) e `internal` (alertas por HTTP).
  - `app/claims.py` (texto da carta), `app/claim_pdf.py` (PDF com a fatura junta), `app/alerts.py` (`python -m app.alerts`), `app/storage.py` (faturas em disco ou no S3, por `STORAGE_BACKEND`, e conversão de HEIC), `app/export.py` (ZIP com CSV, JSON e faturas), `app/invoice_scan.py` (leitura da fatura: texto do PDF ou OCR com o Tesseract, e sugestão dos campos), `app/password_reset.py` (link por email para repor a palavra-passe: JWT com a impressão do hash, de uso único), `app/sessions.py` (refresh tokens com rotação, ADR 0004: cookie httpOnly no browser, corpo na app com `X-Client: mobile`), `app/push.py` (notificações pelo serviço de push do Expo, enviadas pelos alertas; tokens em `push_tokens`, rotas em `routers/push.py`).
- `frontend/`: Vite + React 19 + TypeScript + React Router 8, CSS próprio em `src/index.css` (tokens claro/escuro). Testes em `src/**/*.test.tsx` (Vitest) e `e2e/` (Playwright).
- `mobile/`: app Expo (SDK 58, React Native, Expo Router com rotas em `src/app/`, que só pode ter ecrãs). `src/lib/` (API, token no `expo-secure-store`, sessão, upload da fatura, push com o `expo-notifications`, tema e componentes), `src/shared/` (cópias de `frontend/src/types.ts` e `warranty.ts`, mantidas iguais por um teste) e testes em `src/test/` (jest-expo e Testing Library, com o `fetch` simulado).
- `infra/` (Terraform: `bootstrap/`, que corre uma vez à mão, e `app/`, com ECR, Lambda, S3, CloudFront e SES), `.devcontainer/` (dev container e Codespace, com Postgres, Mailpit, AWS CLI e Terraform), `Dockerfile` (fases `app` e `lambda`) e `.github/workflows/` (backend, frontend, mobile, e2e, docker, infra, deploy e alerts).

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

# App móvel (pasta mobile/)
npm run lint && npm run typecheck && npm test
npx expo export --platform android --output-dir /tmp/expo-export   # bundle, como no CI
EXPO_OFFLINE=1 npx expo install <pacote>      # versões compatíveis com o SDK; offline se a api.expo.dev estiver bloqueada

# Infraestrutura (pasta infra/)
terraform fmt -recursive && terraform -chdir=app init -backend=false && terraform -chdir=app validate
```

## Convenções

- Interface, mensagens de erro, README, DEVLOG e descrições de PR em **português de Portugal**; mensagens de commit em inglês.
- Cada alteração vai num PR a partir de um ramo; o CI (backend, frontend, E2E e Docker) tem de estar verde antes do merge. O utilizador decide quando se faz o merge.
- No fim de cada trabalho: entrada nova no `DEVLOG.md` (o que se fez, decisões e lições) e o plano da próxima sessão atualizado.
- Mudanças no modelo levam sempre uma migração gerada com `--autogenerate`, revista e testada com upgrade, downgrade e `alembic check`.
- Testes do backend: cada teste corre numa transação desfeita no fim (fixtures `db_session`, `client`, `auth_client` e `user` em `tests/conftest.py`); as faturas vão para uma pasta temporária.
- Testes E2E: cada teste cria o seu utilizador `e2e-…@example.com`. A API dos E2E grava os emails em ficheiros (`MAIL_BACKEND=file`, pasta em `E2E_MAIL_DIR`), e o `lastEmailTo` do `e2e/helpers.ts` lê-os já descodificados (o corpo vem em quoted-printable, e o `=` aparece como `=3D`). Na base de dados de desenvolvimento, limpar com `DELETE FROM users WHERE email LIKE 'e2e-%@example.com'`.

## Armadilhas já encontradas

- Não usar `pkill -f uvicorn` (ou padrões parecidos): também apanha a shell que corre o comando. Usar o PID ou `ps -eo pid,args | awk '/[u]vicorn/ {print $1}' | xargs -r kill`.
- O Chromium "headless shell" do Playwright não tem visualizador de PDF, porque trata um PDF como download; testar o pedido da fatura, não a página.
- O Chromium não lê ficheiros de upload com acentos no caminho; nos testes, passar o ficheiro a partir da memória (`setInputFiles({ name, mimeType, buffer })`).
- `getByLabel('Loja')` no Playwright também apanha "Email da loja": usar `{ exact: true }`.
- As migrações geradas passam pelo ruff (hooks no `alembic.ini`), por isso o `ruff` tem de estar no PATH ao correr `alembic revision`. O isort do ruff trata `alembic` como pacote externo (`known-third-party`), apesar da pasta `alembic/`.
- Acessibilidade: o `e2e/a11y.spec.ts` (axe, WCAG 2.2 AA) tem de continuar limpo. Cores novas passam pelos tokens em `src/index.css` com contraste ≥ 4.5:1 nos dois temas; cada página chama `usePageTitle` e tem um `h1`; nada clicável só com o rato (usar `button`/`a`).
- Segurança: o servidor de produção (`app/server.py`) envia uma CSP sem scripts inline, por isso nada de `<script>` inline no `index.html` (usar `public/`). Para testar a CSP, correr `uvicorn app.server:server` com `STATIC_DIR=../frontend/dist` e os E2E com `E2E_BASE_URL`. Os limites de tentativas (`app/rate_limit.py`) desligam-se com `RATE_LIMITS=false`, só nos E2E.
- OCR: precisa do programa `tesseract` com o português (`tesseract-ocr-por`); o hook e o `post-create.sh` instalam-no. Sem ele, só as fotografias deixam de dar sugestões e o teste de OCR é saltado. A leitura só sugere: na dúvida, é melhor não sugerir nada.
- Cloud: o alvo de produção é a AWS (roteiro em `docs/cloud.md`, decisões em `docs/adr/`, uma por ficheiro numerado). A app corre no Lambda (ADR 0002): não guardar nada em disco nem em memória que tenha de durar entre pedidos, e configurar por variáveis (`STORAGE_BACKEND`, `MAIL_BACKEND`, `DATABASE_POOL`, `SSM_PARAMETERS_PATH`). Testes que mexem em `os.environ` trabalham numa cópia (`monkeypatch.setattr(os, "environ", os.environ.copy())`). O código nunca lê ficheiros de faturas por caminho: usa `storage.save/load/delete`. Com S3, as faturas vão do browser diretamente para o bucket (POST pré-assinado, `uploads/<utilizador>/<token>`; `src/invoiceUpload.ts` no frontend); sem S3, pela API. Testes com S3 usam a fixture `s3` do `conftest.py` (moto), nunca a AWS real.
- App móvel: na Testing Library 14 o `fireEvent` é assíncrono (`await fireEvent.press(...)`); sem o `await`, os testes falham de formas estranhas. Os testes não podem ficar em `src/app/` (o Expo Router trata-os como rotas e o bundle parte). O `FormData` dos testes é o do React Native (`jest.setup.ts`), para os ficheiros `{ uri, name, type }`. Ao mudar `frontend/src/types.ts` ou `warranty.ts`, copiar para `mobile/src/shared/`. O TypeScript 6 só carrega os tipos listados em `types` no `tsconfig.json`. Push (`docs/push.md`): a Expo Go no Android não o recebe (é preciso uma development build); nos testes, o `expo-notifications`, o `expo-device` e o `expo-constants` estão simulados no `jest.setup.ts` (`__tap(data)` simula tocar numa notificação), e o backend nunca chama o Expo (fixture `no_real_push`). O `expo prebuild` muda os scripts do `package.json`: não fazer commit disso nem da pasta `android/`.
- Sessões: o token de acesso dura 15 minutos e os clientes (`frontend/src/api.ts`, `mobile/src/lib/api.ts`) renovam-no sozinhos com um 401. O cookie do refresh token tem o caminho `REFRESH_COOKIE_PATH` (`/api/auth`, como o browser vê a API); nos testes do backend, a API está em `/auth` e o `tests/test_sessions.py` muda o caminho. Os `mockApi` dos testes do frontend e da app respondem 401 ao `/auth/refresh` por omissão.
- O React StrictMode corre os efeitos duas vezes em desenvolvimento: não contar com "primeira execução" num `useEffect`.
- O pytest trata `StarletteDeprecationWarning` como erro: o `TestClient` precisa do `httpx2`, não do `httpx`.
- Variáveis vazias no `.env` contam como não definidas (`env_ignore_empty`); em produção, `ENVIRONMENT=production` recusa a `SECRET_KEY` de exemplo.
