#!/usr/bin/env bash
set -euo pipefail

# Cria o .env local a partir do exemplo, se ainda não existir.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Criado .env a partir de .env.example"
fi

python --version
node --version

# O volume da sessão do Claude Code é criado pelo Docker como root; o utilizador é o vscode.
claude_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
sudo mkdir -p "$claude_dir"
sudo chown -R "$(id -u):$(id -g)" "$claude_dir"

# Tesseract (OCR das fotografias das faturas), com o português.
if ! command -v tesseract >/dev/null; then
  sudo apt-get update -q
  sudo apt-get install -y -q --no-install-recommends tesseract-ocr tesseract-ocr-por
fi

# Dependências do backend, do frontend e da app móvel.
pip install --quiet -e './backend[dev]'
npm ci --prefix frontend
npm ci --prefix mobile
