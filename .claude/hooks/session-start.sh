#!/bin/bash
# Prepara uma sessão cloud do Claude Code para trabalhar no Warrantly:
# Postgres a correr com a base de dados da app, dependências do backend, do frontend e da app móvel,
# migrações aplicadas e variáveis de ambiente para os testes (incluindo os E2E).
# Só corre nas sessões cloud; no dev container e no Codespace quem prepara é o post-create.sh.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
log() { echo "[session-start] $*" >&2; }

# 1. Postgres (o mesmo utilizador, palavra-passe e base de dados do dev container).
if command -v pg_lsclusters >/dev/null 2>&1; then
  cluster=$(pg_lsclusters --no-header | awk 'NR==1 {print $1" "$2" "$4}')
  if [ -n "$cluster" ]; then
    read -r version name status <<<"$cluster"
    if [ "$status" != "online" ]; then
      log "a arrancar o Postgres $version/$name"
      pg_ctlcluster "$version" "$name" start
    fi
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='warrantly'\"" | grep -q 1 ||
      su postgres -c "psql -qc \"CREATE ROLE warrantly LOGIN PASSWORD 'warrantly'\""
    su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='warrantly'\"" | grep -q 1 ||
      su postgres -c "psql -qc 'CREATE DATABASE warrantly OWNER warrantly'"
  else
    log "sem cluster do Postgres: os testes do backend vão falhar"
  fi
else
  log "Postgres não instalado: os testes do backend vão falhar"
fi

# Tesseract para o OCR das faturas (sem ele, só as fotografias deixam de dar sugestões).
if ! command -v tesseract >/dev/null 2>&1; then
  { apt-get update -q && apt-get install -y -q --no-install-recommends tesseract-ocr tesseract-ocr-por; } \
    >/dev/null 2>&1 || log "não foi possível instalar o tesseract: o OCR das fotografias fica desligado"
fi

# 2. Backend: venv com as dependências (incluindo as de desenvolvimento) e migrações.
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install --quiet --disable-pip-version-check -e '.[dev]'
.venv/bin/alembic upgrade head >/dev/null

# 3. Frontend e app móvel (npm install aproveita a cache do contentor entre sessões).
cd "$ROOT/frontend"
npm install --no-audit --no-fund --loglevel=error
cd "$ROOT/mobile"
npm install --no-audit --no-fund --loglevel=error

# 4. Variáveis para o resto da sessão: venv no PATH e o Chromium já instalado para o Playwright.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$ROOT/backend/.venv/bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
  shell=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell 2>/dev/null | head -1 || true)
  if [ -n "$shell" ]; then
    echo "export PW_CHROMIUM_PATH=\"$shell\"" >>"$CLAUDE_ENV_FILE"
  fi
fi

log "pronto"
