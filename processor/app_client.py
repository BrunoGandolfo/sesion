"""
Cliente HTTP unico hacia la app Sesion (Vercel).

Todo lo que el worker le pide a la app pasa por aca: los headers se arman en
un solo lugar, los timeouts son constantes y la interpretacion de los status
es una sola.

Dos credenciales:
  - PROCESSING_SECRET solo autoriza RECLAMAR (GET /pendientes y
    GET /trabajos/pendientes).
  - El TICKET que viene con cada sesion o trabajo reclamado autoriza todo lo
    demas sobre ESE item (lease, asr, transcripcion, resultado). Cada reclamo
    emite un ticket nuevo: el de un reclamo viejo deja de valer.

Contrato de respuestas (src/app/api/sesion-clinica/[id]/* y /api/trabajos/*):
  2xx        ok
  401 / 409  rechazado: el ticket o el intento ya no son los vigentes
             (otro worker reclamo la sesion). Terminal: se abandona.
  4xx        error de contrato. Terminal: reintentar no ayuda.
  5xx / sin respuesta: no terminal; el lease de la app decide.

Todos los pedidos llevan X-Worker-Id y X-Worker-Version: es el latido que la
app guarda en worker_estado.

Privacidad de logs: solo ids, status y el campo `error` de la app (120
chars). Nunca el payload: contiene transcripcion, nota y contexto.
"""
import logging
import json
import os
import socket
from dataclasses import dataclass

import requests

import config
from schemas_llm import validar_estructura_contexto

logger = logging.getLogger(__name__)

TIMEOUT_LECTURA_SEG = 15   # GETs: pendientes, trabajos, contexto para el LLM
TIMEOUT_ESCRITURA_SEG = 30  # POSTs: lease, asr, transcripcion, resultado

WORKER_ID = os.getenv("WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"

# Endpoints ─────────────────────────────────────────────────────────────────

def url_sesion(sesion_id: str, accion: str) -> str:
    return f"{config.APP_BASE_URL}/api/sesion-clinica/{sesion_id}/{accion}"


def url_trabajos_pendientes(tipos: list[str] | None = None) -> str:
    base = f"{config.APP_BASE_URL}/api/trabajos/pendientes"
    return f"{base}?tipos={','.join(tipos)}" if tipos else base


def url_trabajo_resultado(trabajo_id: str) -> str:
    return f"{config.APP_BASE_URL}/api/trabajos/{trabajo_id}/resultado"


# Headers ───────────────────────────────────────────────────────────────────

def _headers(con_json: bool = False, ticket: str | None = None) -> dict:
    """Unico lugar donde se construye la autenticacion y el latido."""
    h = {
        "Authorization": f"Bearer {ticket or config.PROCESSING_SECRET}",
        "X-Worker-Id": WORKER_ID,
        "X-Worker-Version": config.WORKER_VERSION,
    }
    if con_json:
        h["Content-Type"] = "application/json"
    return h


def _error_del_body(response: requests.Response) -> str:
    """Primeros 120 chars del campo `error` del body (texto de la app, no PHI)."""
    try:
        body = response.json()
    except ValueError:
        return ""
    if isinstance(body, dict) and body.get("error"):
        return str(body["error"])[:120]
    return ""


def _json_esperado(response: requests.Response):
    """Una redirección, HTML o JSON inválido es un error de contrato, sin PHI."""
    response.raise_for_status()
    if response.status_code != 200:
        raise requests.RequestException(f"Respuesta inesperada: HTTP {response.status_code}")
    if response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise requests.RequestException("La app no respondió application/json")
    try:
        return response.json()
    except ValueError:
        raise requests.RequestException("La app no respondió JSON válido") from None


def _lista(url: str) -> list[dict]:
    """GET autenticado con PROCESSING_SECRET que espera una lista JSON. Lanza requests.RequestException."""
    response = requests.get(url, headers=_headers(), timeout=TIMEOUT_LECTURA_SEG, allow_redirects=False)
    body = _json_esperado(response)
    if not isinstance(body, list) or any(not isinstance(item, dict) for item in body):
        raise requests.RequestException("La app no respondió una lista de trabajos o sesiones")
    return body


# Respuestas ────────────────────────────────────────────────────────────────

@dataclass
class RespuestaApp:
    ok: bool
    status: int | None  # None = sin respuesta (error de red)

    @property
    def rechazado(self) -> bool:
        """401/409: el ticket o el intento ya no son los vigentes."""
        return self.status in (401, 409)

    @property
    def terminal(self) -> bool:
        """
        True si el pedido cerro su ciclo: 2xx, rechazado, o 4xx de contrato.
        False con 5xx o sin respuesta: el lease de la app reintentara.
        """
        if self.ok or self.rechazado:
            return True
        return self.status is not None and 400 <= self.status < 500


def _post(url: str, payload: dict, ticket: str, etiqueta: str) -> RespuestaApp:
    """POST con ticket. Nunca lanza: la clasificacion va en RespuestaApp."""
    try:
        response = requests.post(
            url, json=payload, headers=_headers(con_json=True, ticket=ticket), timeout=TIMEOUT_ESCRITURA_SEG,
            allow_redirects=False,
        )
    except requests.RequestException as e:
        logger.error(f"{etiqueta}: sin respuesta ({type(e).__name__})")
        return RespuestaApp(ok=False, status=None)

    status = response.status_code
    if 200 <= status < 300:
        return RespuestaApp(ok=True, status=status)

    detalle = _error_del_body(response)
    sufijo = f" error={detalle}" if detalle else ""
    if status in (401, 409):
        logger.warning(f"{etiqueta}: {status}, el intento ya no es el vigente; se abandona{sufijo}")
    elif 400 <= status < 500:
        logger.error(f"{etiqueta}: rechazado por contrato HTTP {status}; no se reintenta{sufijo}")
    else:
        logger.error(f"{etiqueta}: HTTP {status}{sufijo}")
    return RespuestaApp(ok=False, status=status)


# Sesiones ──────────────────────────────────────────────────────────────────

def obtener_pendientes(limite: int = 1) -> list[dict]:
    """
    Sesiones en "procesando" reclamadas con lease y ticket (ver
    casos-uso/sesion/reclamar.ts). De a UNA por defecto: este worker procesa
    en serie y solo renueva el lease de la sesion que tiene entre manos; lo
    que esperara en una cola local venceria y otro worker se lo llevaria.
    """
    return _lista(f"{config.PENDIENTES_URL}?limite={int(limite)}")


def renovar_lease(sesion_id: str, ticket: str, intento: int, paso: str | None = None, pausas_audio: list[dict] | None = None) -> RespuestaApp:
    payload: dict = {"intento": intento}
    if paso:
        payload["paso"] = paso[:40]
    if pausas_audio is not None:
        payload["pausasAudio"] = pausas_audio
    return _post(url_sesion(sesion_id, "lease"), payload, ticket, f"Lease {sesion_id}")


def registrar_asr(sesion_id: str, ticket: str, intento: int, transcript_id: str) -> RespuestaApp:
    """El transcript existe en AssemblyAI: la app anota el trabajo de borrarlo."""
    return _post(
        url_sesion(sesion_id, "asr"),
        {"intento": intento, "transcriptId": transcript_id},
        ticket,
        f"ASR {sesion_id}",
    )


def registrar_transcripcion(
    sesion_id: str,
    ticket: str,
    intento: int,
    transcripcion: str,
    modelo_asr: str,
    speech_analytics: dict | None = None,
    duracion_seg: int | None = None,
    asr_transcript_id: str | None = None,
) -> RespuestaApp:
    """Checkpoint tras el ASR: desde aca ningun reintento vuelve a transcribir."""
    payload: dict = {"intento": intento, "transcripcion": transcripcion, "modeloAsr": modelo_asr}
    if speech_analytics is not None:
        payload["speechAnalytics"] = speech_analytics
    if duracion_seg is not None:
        payload["duracionSeg"] = int(duracion_seg)
    if asr_transcript_id:
        payload["asrTranscriptId"] = asr_transcript_id
    logger.info(f"Checkpoint {sesion_id}: transcripcion ({len(transcripcion)} chars)")
    return _post(url_sesion(sesion_id, "transcripcion"), payload, ticket, f"Checkpoint {sesion_id}")


def enviar_resultado(sesion_id: str, ticket: str, payload: dict) -> RespuestaApp:
    """
    POST del resultado. `payload` ya trae `intento` y `resultado` ("nota" o
    "fallo") con la forma de resultadoSesionSchema (src/lib/sesion-clinica/schema.ts).
    """
    logger.info(f"Resultado {sesion_id}: {payload.get('resultado')} (intento {payload.get('intento')})")
    return _post(url_sesion(sesion_id, "resultado"), payload, ticket, f"Resultado {sesion_id}")


# Trabajos ──────────────────────────────────────────────────────────────────

def trabajos_pendientes(tipos: list[str] | None = None) -> list[dict]:
    """Trabajos reclamados para este worker, cada uno con ticket y adjunto."""
    return _lista(url_trabajos_pendientes(tipos))


def resolver_trabajo(trabajo_id: str, ticket: str, payload: dict) -> RespuestaApp:
    """`payload` con la forma de resultadoTrabajoSchema: {ok: true, ...} o {ok: false, error}."""
    return _post(url_trabajo_resultado(trabajo_id), payload, ticket, f"Trabajo {trabajo_id}")


# Contexto longitudinal (lectura para el prompt de la nota) ─────────────────

def obtener_contexto_clinico_llm(paciente_id: str, sesion_id: str, ticket: str) -> str | None:
    """Solo None ante un hilo explícitamente vacío; cualquier otro fallo se propaga."""
    if not paciente_id or not sesion_id or not ticket:
        raise requests.RequestException("Falta identidad o ticket para leer el Recorrido")
    response = requests.get(
        config.hilo_url(paciente_id), params={"format": "llm", "sesionId": sesion_id},
        headers=_headers(ticket=ticket), timeout=TIMEOUT_LECTURA_SEG, allow_redirects=False,
    )
    body = _json_esperado(response)
    if not isinstance(body, dict) or set(body) != {"data"}:
        raise requests.RequestException("Envoltura de Recorrido inválida")
    hilo = body["data"]
    if (not isinstance(hilo, dict) or set(hilo) != {"tipo", "pacienteId", "version", "contenido"}
            or hilo["tipo"] != "hilo_vigente" or hilo["pacienteId"] != paciente_id
            or type(hilo["version"]) is not int or hilo["version"] < 0):
        raise requests.RequestException("Identidad o versión de Recorrido inválida")
    if hilo["version"] == 0 and hilo["contenido"] is None:
        return None
    if hilo["version"] == 0 or hilo["contenido"] is None:
        raise requests.RequestException("Versión y contenido de Recorrido incompatibles")
    try:
        validar_estructura_contexto(hilo["contenido"])
    except ValueError:
        raise requests.RequestException("Contenido de Recorrido inválido") from None
    return json.dumps(hilo["contenido"], ensure_ascii=False)
