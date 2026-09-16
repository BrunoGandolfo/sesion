#!/usr/bin/env bash
# Ensayo trimestral A MANO, en la máquina del dueño: restaura un respaldo en
# un Postgres 17 local vacío y DESCIFRA con el llavero la nota clínica y la
# versión del Recorrido más vieja y más nueva. Es el único ensayo que prueba
# que la clave abre lo que está en la copia: el automático (GitHub Actions)
# no tiene la clave, a propósito.
#
#   read -rs BACKUP_ENCRYPTION_KEY && export BACKUP_ENCRYPTION_KEY
#   read -rs CLAVES_CIFRADO && export CLAVES_CIFRADO
#   scripts/ensayo/ensayo-manual.sh <archivo.dump.gpg>
#
# CLAVES_CIFRADO: el llavero completo de la época del respaldo, con el formato
# de la app ("1=<base64>,2=…"), incluidas las claves que la app ya retiró.
#
# Base destino: si DATABASE_URL está definida se usa ese servidor (tiene que
# ser local: localhost o 127.0.0.1) y se crea ahí la base `ensayo_manual`;
# si no, se levanta un contenedor efímero postgres:17 en tmpfs que se borra
# al terminar. Nunca una base real. PG_BIN: binarios 17 si no son los del PATH.
#
# Deja resultado-manual.json en la carpeta actual. Nada del texto clínico
# se imprime ni se guarda: solo ids y sí/no. Lo que va al acta es la salida
# de este script y ese json.
set -euo pipefail

archivo="${1:?uso: ensayo-manual.sh <archivo.dump.gpg>}"
: "${BACKUP_ENCRYPTION_KEY:?falta BACKUP_ENCRYPTION_KEY (passphrase del respaldo)}"
: "${CLAVES_CIFRADO:?falta CLAVES_CIFRADO (el llavero completo de la época del respaldo)}"
aqui="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql="${PG_BIN:+${PG_BIN}/}psql"
contenedor=""

limpiar() {
  if [ -n "${contenedor}" ]; then docker rm -f "${contenedor}" > /dev/null 2>&1 || true; fi
}
trap limpiar EXIT

if [ -z "${DATABASE_URL:-}" ]; then
  contenedor="sesion-ensayo-manual-$$"
  docker run -d --name "${contenedor}" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=ensayo \
    --tmpfs /var/lib/postgresql/data postgres:17 > /dev/null
  for _ in $(seq 1 30); do
    if docker exec "${contenedor}" pg_isready -U postgres > /dev/null 2>&1; then break; fi
    sleep 1
  done
  puerto="$(docker port "${contenedor}" 5432/tcp | head -1 | sed 's/.*://')"
  DATABASE_URL="postgresql://postgres:ensayo@127.0.0.1:${puerto}/postgres"
fi

host="$(printf '%s' "${DATABASE_URL}" | sed -E 's#^[a-z]+://([^@]*@)?([^/:?]+).*#\2#')"
case "${host}" in
  localhost|127.0.0.1|::1|\[::1\]) ;;
  *) echo "ERROR: DATABASE_URL apunta a ${host}; el ensayo solo restaura en una base local." >&2; exit 1 ;;
esac

destino="$(printf '%s' "${DATABASE_URL}" | sed -E 's#(^[a-z]+://[^/]+)/[^?]*#\1/ensayo_manual#')"
"${psql}" -X -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE ensayo_manual' "${DATABASE_URL}" \
  || { echo "ERROR: no se pudo crear la base ensayo_manual (¿ya existe? borrarla primero)." >&2; exit 1; }

"${aqui}/restaurar.sh" "${archivo}" "${destino}"
DATABASE_URL="${destino}" BACKUP_ARCHIVO="$(basename "${archivo}")" \
  node "${aqui}/verificar-restauracion.mjs" --etiqueta manual --salida "${PWD}"
echo
echo "Pegar en el acta (docs/operaciones/actas/): las líneas de arriba y resultado-manual.json."
