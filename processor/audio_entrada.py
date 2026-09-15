"""Audio comprimido independiente -> validar, descifrar, decodificar y recortar.
Un segmento en RAM; ffmpeg escribe el resultado en disco temporal privado.
Nunca concatena archivos Opus/AAC por sus bytes ni rellena huecos con silencio.
"""
import base64
import hashlib
import json
import math
import subprocess
import tempfile
import wave
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from Crypto.Cipher import AES

import r2_client
from errores import PipelineError

MAX_BYTES_SEGMENTO = 4 * 1024 * 1024


def _ffmpeg(argumentos):
    try:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *argumentos], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    except FileNotFoundError as exc:
        raise PipelineError("audio_infraestructura", "Falta ffmpeg en el worker", definitivo=False) from exc
    except (subprocess.SubprocessError, OSError) as exc:
        raise PipelineError("audio_invalido", "No se pudo decodificar el audio", definitivo=True) from exc


def fin_aac(entrada):
    """MP4 indica el fin válido antes del padding del último frame AAC.
    No es una duración estimada con el reloj ni un relleno de huecos.
    """
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0",
                            "-show_entries", "stream=codec_name,duration", "-of", "json", str(entrada)],
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           text=True, timeout=30)
        stream = json.loads(r.stdout)["streams"][0]
        if stream["codec_name"] == "opus": return None
        if stream["codec_name"] != "aac": raise ValueError("Codec no admitido")
        fin = float(stream["duration"])
        if not math.isfinite(fin) or not 0 < fin <= 65: raise ValueError("Duración inválida")
        return fin
    except FileNotFoundError as exc:
        raise PipelineError("audio_infraestructura", "Falta ffprobe en el worker") from exc
    except (subprocess.SubprocessError, OSError, ValueError, KeyError, IndexError) as exc:
        raise PipelineError("audio_invalido", "No se pudo leer la duración del contenedor", definitivo=True) from exc


def descifrar_segmento(cifrado, clave, iv, organization_id, sesion_id, indice):
    try:
        llave = base64.b64decode(clave, validate=True)
        nonce = base64.b64decode(iv, validate=True)
        if len(llave) != 32 or len(nonce) != 12 or len(cifrado) < 17:
            raise ValueError("Largo inválido")
        cipher = AES.new(llave, AES.MODE_GCM, nonce=nonce)
        cipher.update(json.dumps([organization_id, sesion_id, indice], separators=(",", ":"), ensure_ascii=False).encode())
        return cipher.decrypt_and_verify(cifrado[:-16], cifrado[-16:])
    except (ValueError, TypeError) as exc:
        raise PipelineError("descifrado_error", "No se pudo autenticar un segmento") from exc


@dataclass
class AudioPreparado:
    archivo: Path
    duracion_ms: float
    huecos: list[dict]


@contextmanager
def armar_audio(sesion_id: str, audio: dict):
    if not audio or not audio.get("clave"):
        raise PipelineError("audio_sin_clave", "Falta la clave de la grabación")
    segmentos = audio.get("segmentos") or []
    if not segmentos:
        raise PipelineError("audio_sin_segmentos", "Faltan los segmentos de la grabación")
    org = audio.get("organizationId")
    if not org or len(segmentos) > 1800 or any(s.get("indice") != i for i, s in enumerate(segmentos)):
        raise PipelineError("audio_invalido", "El inventario de audio no es consecutivo", definitivo=True)
    hasta = 0
    inicio_anterior = -1
    muestras_esperadas = 0
    huecos = []
    archivos = []
    frecuencia = 16000
    with tempfile.TemporaryDirectory(prefix="sesion-audio-") as temporal:
        carpeta = Path(temporal)
        for i, segmento in enumerate(segmentos):
            key = f"{org}/{sesion_id}/{i}"
            esperado = segmento.get("bytes", 0)
            if segmento.get("key") != key or not 17 <= esperado <= MAX_BYTES_SEGMENTO:
                raise PipelineError("audio_invalido", "Ubicación o tamaño de segmento inválido", definitivo=True)
            inicio_ms = segmento.get("inicioMs")
            if (type(inicio_ms) not in (int, float) or not math.isfinite(inicio_ms)
                    or not 0 <= inicio_ms <= 9_000_000 or inicio_ms <= inicio_anterior
                    or (i == 0 and inicio_ms != 0)):
                raise PipelineError("audio_inicio", "Falta un inicio medido válido; se conserva para revisión", definitivo=True)
            inicio_anterior = inicio_ms
            # La precisión del recorte es una muestra (0,0625 ms a 16 kHz).
            inicio = round(inicio_ms * frecuencia / 1000)
            try:
                cifrado = r2_client.descargar_segmento(key, esperado)
            except Exception as exc:
                raise PipelineError("r2_error", "No se pudo descargar un segmento") from exc
            if len(cifrado) != esperado or hashlib.sha256(cifrado).hexdigest() != segmento.get("sha256"):
                raise PipelineError("audio_invalido", "La huella del segmento no coincide", definitivo=True)
            claro = descifrar_segmento(cifrado, audio["clave"], segmento["iv"], org, sesion_id, i)
            entrada = carpeta / "segmento"
            entrada.write_bytes(claro)
            del cifrado, claro
            completo = carpeta / "completo.wav"
            fin = fin_aac(entrada)
            # Normalizar PTS ANTES de cortar evita perder el pre-skip de Opus.
            filtros = "asetpts=PTS-STARTPTS" + (f",atrim=end={fin:.9f}" if fin is not None else "")
            _ffmpeg(["-i", str(entrada), "-map", "0:a:0", "-vn", "-af", filtros,
                     "-ac", "1", "-ar", str(frecuencia), "-c:a", "pcm_s16le", str(completo)])
            entrada.unlink()
            with wave.open(str(completo), "rb") as wav:
                muestras = wav.getnframes()
            if not 0 < muestras <= 65 * frecuencia:
                raise PipelineError("audio_invalido", "Duración de segmento inválida", definitivo=True)
            if inicio > hasta:
                huecos.append({"inicio": hasta * 1000 / frecuencia,
                               "fin": inicio * 1000 / frecuencia,
                               "siguienteIndice": i, "motivo": "interrupcion"})
            recorte = min(muestras, max(0, hasta - inicio))
            hasta = max(hasta, inicio + muestras)
            conservadas = muestras - recorte
            if conservadas:
                salida = carpeta / f"{i}.wav"
                _ffmpeg(["-i", str(completo), "-af", f"atrim=start_sample={recorte},asetpts=PTS-STARTPTS",
                         "-c:a", "pcm_s16le", str(salida)])
                archivos.append(salida.name)
                muestras_esperadas += conservadas
            completo.unlink()
        lista = carpeta / "archivos.txt"
        lista.write_text("\n".join(f"file '{nombre}'" for nombre in archivos))
        salida = carpeta / "sesion.wav"
        _ffmpeg(["-f", "concat", "-safe", "1", "-i", str(lista), "-c:a", "pcm_s16le", str(salida)])
        with wave.open(str(salida), "rb") as wav:
            muestras_finales = wav.getnframes()
        # Igualdad exacta con las muestras medidas menos los recortes. Nunca
        # se acepta una pérdida porque entre en el redondeo del reloj de UI.
        if muestras_finales != muestras_esperadas:
            raise PipelineError("audio_duracion", "El ensamblado perdió o repitió muestras; requiere revisión", definitivo=True)
        yield AudioPreparado(salida, muestras_finales * 1000 / frecuencia, huecos)
