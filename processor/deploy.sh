#!/usr/bin/env bash
#
# Deploy del worker como servicio systemd en La Escondida (Ubuntu 24.04).
# Idempotente: se puede correr varias veces sin efectos colaterales.
#
# Uso:
#   cd /home/bruno/sesion/processor
#   ./deploy.sh
#
# Requiere sudo para copiar el unit file y manejar systemd.

set -euo pipefail

# Corre relativo al directorio donde vive el script, no al CWD del invocador.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SERVICE_NAME="sesion-worker.service"
SERVICE_SRC="$SCRIPT_DIR/$SERVICE_NAME"
SERVICE_DST="/etc/systemd/system/$SERVICE_NAME"
VENV_DIR="$SCRIPT_DIR/venv"
ENV_FILE="$SCRIPT_DIR/.env"
REQUIREMENTS="$SCRIPT_DIR/requirements.txt"

log() { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# ── Pre-checks ────────────────────────────────────────────────────────────
[[ -f "$SERVICE_SRC"  ]] || fail "No encuentro $SERVICE_SRC"
[[ -f "$REQUIREMENTS" ]] || fail "No encuentro $REQUIREMENTS"
[[ -f "$ENV_FILE"     ]] || fail "Falta $ENV_FILE — copialo de .env.example y completá los valores antes de desplegar."

if ! command -v python3 >/dev/null; then
  fail "python3 no está instalado"
fi

# ── venv ─────────────────────────────────────────────────────────────────
if [[ ! -d "$VENV_DIR" ]]; then
  log "Creando venv en $VENV_DIR"
  python3 -m venv "$VENV_DIR"
else
  log "venv ya existe, lo reuso"
fi

log "Actualizando pip e instalando dependencias"
"$VENV_DIR/bin/pip" install --upgrade --quiet pip
"$VENV_DIR/bin/pip" install --quiet -r "$REQUIREMENTS"

# Sanity check: que el worker pueda importarse antes de tocar systemd.
log "Verificando import del worker"
( cd "$SCRIPT_DIR" && "$VENV_DIR/bin/python" -c "import worker" ) \
  || fail "El worker no importa limpio — revisá las deps o el código antes de continuar."

# ── systemd ──────────────────────────────────────────────────────────────
log "Copiando unit file a $SERVICE_DST"
sudo install -m 0644 "$SERVICE_SRC" "$SERVICE_DST"

log "Recargando systemd y habilitando el servicio"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

log "(Re)iniciando $SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# Dejá que el worker pase del 'activating' al 'active' (o caiga en failed).
sleep 2

log "Estado del servicio:"
sudo systemctl status "$SERVICE_NAME" --no-pager --lines=20 || true

log "Listo. Para seguir los logs:"
echo "    journalctl -u $SERVICE_NAME -f"
