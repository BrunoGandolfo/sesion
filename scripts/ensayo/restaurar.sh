#!/usr/bin/env bash
# Descifra un respaldo .dump.gpg y lo restaura en una base VACÍA.
#
#   BACKUP_ENCRYPTION_KEY=… scripts/ensayo/restaurar.sh <archivo.dump.gpg> <url de la base destino>
#
# Lo corre .github/workflows/ensayo-restauracion.yml (una vez por copia) y
# src/lib/__tests__/ensayo-restauracion.test.ts con respaldos generados a
# propósito. Cada paso falla solo y dice qué fue: passphrase o archivo
# dañado (gpg), índice ilegible (pg_restore --list) o restauración cortada
# (pg_restore --exit-on-error). La verificación del contenido es de
# verificar-restauracion.mjs, después de esto.
#
# PG_BIN: carpeta de los binarios de Postgres 17 (vacío = los del PATH).
set -euo pipefail

archivo="${1:?uso: restaurar.sh <archivo.dump.gpg> <url de la base destino>}"
destino="${2:?uso: restaurar.sh <archivo.dump.gpg> <url de la base destino>}"
: "${BACKUP_ENCRYPTION_KEY:?falta BACKUP_ENCRYPTION_KEY}"
pg_restore="${PG_BIN:+${PG_BIN}/}pg_restore"

dump="$(mktemp)"
trap 'rm -f "${dump}"' EXIT

if ! printf '%s' "${BACKUP_ENCRYPTION_KEY}" | gpg --batch --yes --quiet \
    --decrypt --passphrase-fd 0 --output "${dump}" "${archivo}"; then
  echo "ERROR: ${archivo} no se pudo descifrar: passphrase equivocada o archivo dañado/truncado." >&2
  exit 1
fi

if ! "${pg_restore}" --list "${dump}" > /dev/null; then
  echo "ERROR: ${archivo} no tiene un índice legible: no es un dump custom o está corrupto/truncado." >&2
  exit 1
fi

inicio="$(date +%s)"
if ! "${pg_restore}" --no-owner --no-privileges --exit-on-error --dbname "${destino}" "${dump}"; then
  echo "ERROR: pg_restore se cortó restaurando ${archivo}: dump corrupto o base destino no vacía." >&2
  exit 1
fi
echo "restaurado ${archivo} en $(( $(date +%s) - inicio )) s"
