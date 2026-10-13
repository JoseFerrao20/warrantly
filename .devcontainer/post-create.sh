#!/usr/bin/env bash
set -euo pipefail

# Cria o .env local a partir do exemplo, se ainda não existir.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Criado .env a partir de .env.example"
fi

python --version
node --version
