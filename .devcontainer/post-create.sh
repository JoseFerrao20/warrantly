#!/usr/bin/env bash
set -euo pipefail

# Cria o .env local a partir do exemplo, se ainda não existir.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Criado .env a partir de .env.example"
fi

python --version
node --version

# Tesseract (OCR das fotografias das faturas), com o português.
if ! command -v tesseract >/dev/null; then
  sudo apt-get update -q
  sudo apt-get install -y -q --no-install-recommends tesseract-ocr tesseract-ocr-por
fi

# Dependências do backend e do frontend.
pip install --quiet -e './backend[dev]'
npm ci --prefix frontend
