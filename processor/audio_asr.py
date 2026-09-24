"""
Lo que se le manda al ASR: el audio del telefono reempaquetado para que su
duracion sea la de las muestras que contiene.

POR QUE

El grabador es un solo MediaRecorder (WebM/Opus) con pause() y resume(). El
24 y el 19 de septiembre de 2026 el telefono se bloqueo a mitad de sesion y
AssemblyAI informo (y facturo) 16.269 s contra 3.232 s medidos, y 4.143 s
contra 1.590 s. Con el proceso de Chrome suspendido, los sellos de tiempo
del WebM saltan hacia adelante; las muestras no. AssemblyAI cuenta la
duracion por los sellos: el salto es audio que se cobra y no existe.

QUE HACE

ffmpeg decodifica, pasa a mono 16 kHz, reescribe cada sello de tiempo desde
la cuenta de muestras (asetpts=N/SR/TB: el salto desaparece, no se rellena
con silencio) y codifica Opus en Ogg. Ogg porque la duracion la dan las
posiciones de granulo, que se escriben de corrido y no necesitan volver
atras en el archivo: sale por un pipe con la duracion bien declarada. (FLAC
por pipe queda sin duracion en la cabecera y WAV pesa 230 MB en dos horas.)

Todo por pipes, en memoria: el audio clinico no toca el disco del worker.

Dos horas de Opus tardan ~65 s en una maquina de 12 nucleos y ~55 MB de
memoria (medido el 24-09-2026 con ffmpeg 6.1.1).
"""
import logging
import subprocess

logger = logging.getLogger(__name__)

# Voz para un ASR: mono, 16 kHz (lo que AssemblyAI usa internamente), Opus a
# 32 kbit/s, que para voz en banda ancha es transparente.
FRECUENCIA_HZ = 16000
BITRATE = "32k"

# Holgura sobre lo medido: dos horas en ~65 s. Un archivo que tarda mas que
# esto esta roto o la maquina no da; se manda el original.
TIMEOUT_SEG = 600


class NormalizacionFallida(Exception):
    """ffmpeg no pudo reempaquetar el audio. `motivo` es seguro para el log."""

    def __init__(self, motivo: str):
        super().__init__(motivo)
        self.motivo = motivo


def comando() -> list[str]:
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-i", "pipe:0",
        "-vn",
        "-ac", "1",
        "-ar", str(FRECUENCIA_HZ),
        "-af", "asetpts=N/SR/TB",
        "-c:a", "libopus",
        "-b:a", BITRATE,
        "-f", "ogg",
        "pipe:1",
    ]


def normalizar(datos: bytes) -> bytes:
    """
    Audio del telefono -> Ogg/Opus mono 16 kHz cuya duracion es la de sus
    muestras. Lanza NormalizacionFallida si ffmpeg no esta, tarda de mas o
    no produce nada.
    """
    try:
        proceso = subprocess.run(comando(), input=datos, capture_output=True, timeout=TIMEOUT_SEG, check=False)
    except FileNotFoundError as e:
        raise NormalizacionFallida("ffmpeg_ausente") from e
    except OSError as e:
        # Sin permiso de ejecucion, sin memoria para el proceso hijo...
        raise NormalizacionFallida(f"ffmpeg_no_arranca: {type(e).__name__}") from e
    except subprocess.TimeoutExpired as e:
        raise NormalizacionFallida(f"timeout_{TIMEOUT_SEG}s") from e
    if proceso.returncode != 0 or not proceso.stdout:
        # stderr de ffmpeg: errores de formato, sin contenido del audio.
        detalle = proceso.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
        raise NormalizacionFallida(f"ffmpeg_codigo_{proceso.returncode}: {detalle[0][:200]}")
    return proceso.stdout
