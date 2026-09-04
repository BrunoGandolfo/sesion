# Sesión Processor

Worker Python que procesa las sesiones grabadas: descarga el audio cifrado
de R2, lo descifra en memoria, transcribe con AssemblyAI, genera la nota SOAP
y el feedback con Anthropic y reporta el resultado al callback de la app.
Toda la comunicación con la app pasa por `app_client.py`.

## Correr el worker localmente

```bash
cd processor
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # completar credenciales reales
set -a && source .env && set +a
python worker.py         # loop: cada POLL_INTERVAL_SECONDS consulta /pendientes
```

Modo manual para una sola sesión:

```bash
python worker.py manual <sesion_clinica_id> <audio_r2_key> <clave_cifrado> <iv>
```

## Correr los tests

Sin red: AssemblyAI, Anthropic, R2 y la app se mockean.

```bash
cd processor
pip install -r requirements-dev.txt
python -m pytest tests -q
```
