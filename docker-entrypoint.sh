#!/bin/sh
# Com faturas em disco (volume montado como root), cria a pasta, dá-a ao utilizador da app e
# corre o comando sem privilégios de root. No Lambda (STORAGE_BACKEND=s3) não há pasta: o
# sistema de ficheiros é só de leitura e o Lambda já corre a app sem root.
set -e
if [ "$(id -u)" = "0" ]; then
  if [ "${STORAGE_BACKEND:-local}" = "local" ]; then
    mkdir -p "$UPLOAD_DIR"
    chown -R warrantly:warrantly "$UPLOAD_DIR"
  fi
  exec setpriv --reuid=warrantly --regid=warrantly --init-groups "$@"
fi
exec "$@"
