#!/bin/sh
# Os volumes (ex.: Fly) são montados como root: cria a pasta das faturas, dá-a ao utilizador
# da app e corre o comando sem privilégios de root.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOAD_DIR"
  chown -R warrantly:warrantly "$UPLOAD_DIR"
  exec setpriv --reuid=warrantly --regid=warrantly --init-groups "$@"
fi
exec "$@"
