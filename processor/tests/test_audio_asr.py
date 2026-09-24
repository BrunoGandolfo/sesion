"""
Normalizacion del audio antes del ASR (audio_asr) y la guardia de duracion.

Los archivos se generan con ffmpeg, como los del telefono: WebM/Opus a 48 kHz.
El que reproduce el bloqueo del telefono tiene 60 s de muestras y la segunda
mitad con los sellos de tiempo corridos: ffprobe le cuenta 3 horas, igual que
AssemblyAI contaba 4 h 31 min en una sesion de 54 minutos.

Necesitan ffmpeg y ffprobe (el job worker-tests de CI los instala, la imagen
del worker los trae). Sin red: el ASR es un doble.
"""
import io
import json
import logging
import subprocess
from pathlib import Path

import pytest

import audio_asr
import processor
from app_client import RespuestaApp
from processor import SesionReclamada

TRES_HORAS = 3 * 3600


def _ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duracion_declarada(datos: bytes, tmp_path: Path) -> float:
    """La duracion que declara el contenedor, segun ffprobe."""
    archivo = tmp_path / f"probe-{len(datos)}"
    archivo.write_bytes(datos)
    salida = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(archivo)],
        check=True, capture_output=True, text=True,
    ).stdout
    return float(json.loads(salida)["format"]["duration"])


def muestras_decodificadas(datos: bytes) -> float:
    """Segundos de audio que salen al decodificar, sin mirar sellos de tiempo."""
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
        input=datos, check=True, capture_output=True,
    ).stdout
    return len(pcm) / 2 / 16000


@pytest.fixture(scope="module")
def webm_normal(tmp_path_factory) -> bytes:
    ruta = tmp_path_factory.mktemp("audio") / "normal.webm"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=60",
            "-c:a", "libopus", "-b:a", "32k", "-f", "webm", str(ruta))
    return ruta.read_bytes()


@pytest.fixture(scope="module")
def webm_con_salto(tmp_path_factory) -> bytes:
    """60 s de muestras; a los 30 s los sellos saltan para que el ultimo caiga a las 3 h."""
    ruta = tmp_path_factory.mktemp("audio") / "salto.webm"
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=60",
            "-af", f"asetpts='if(gte(T,30),PTS+({TRES_HORAS}-60)/TB,PTS)'",
            "-c:a", "libopus", "-b:a", "32k", "-f", "webm", str(ruta))
    return ruta.read_bytes()


# El archivo reproduce la falla ─────────────────────────────────────────────

def test_el_webm_con_salto_declara_tres_horas_con_sesenta_segundos_de_muestras(webm_con_salto, tmp_path):
    assert duracion_declarada(webm_con_salto, tmp_path) == pytest.approx(TRES_HORAS, rel=0.01)
    assert muestras_decodificadas(webm_con_salto) == pytest.approx(60, rel=0.02)


# La normalizacion ──────────────────────────────────────────────────────────

def test_normalizado_dura_lo_que_sus_muestras(webm_con_salto, tmp_path):
    salida = audio_asr.normalizar(webm_con_salto)
    assert duracion_declarada(salida, tmp_path) == pytest.approx(60, rel=0.02)
    # No se relleno el salto con silencio: las muestras siguen siendo 60 s.
    assert muestras_decodificadas(salida) == pytest.approx(60, rel=0.02)


def test_un_webm_normal_sale_con_la_misma_duracion(webm_normal, tmp_path):
    entrada = duracion_declarada(webm_normal, tmp_path)
    salida = audio_asr.normalizar(webm_normal)
    assert duracion_declarada(salida, tmp_path) == pytest.approx(entrada, rel=0.01)
    assert muestras_decodificadas(salida) == pytest.approx(muestras_decodificadas(webm_normal), rel=0.01)


def test_la_salida_es_ogg_opus_mono_16k(webm_normal, tmp_path):
    archivo = tmp_path / "salida.ogg"
    archivo.write_bytes(audio_asr.normalizar(webm_normal))
    info = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=format_name:stream=codec_name,channels",
         "-of", "json", str(archivo)],
        check=True, capture_output=True, text=True,
    ).stdout)
    assert info["format"]["format_name"] == "ogg"
    assert info["streams"][0]["codec_name"] == "opus"
    assert info["streams"][0]["channels"] == 1


def test_basura_o_sin_ffmpeg_es_normalizacion_fallida(mocker):
    with pytest.raises(audio_asr.NormalizacionFallida) as exc:
        audio_asr.normalizar(b"esto no es audio")
    assert exc.value.motivo.startswith("ffmpeg_codigo_")

    mocker.patch("audio_asr.comando", return_value=["ffmpeg-que-no-existe"])
    with pytest.raises(audio_asr.NormalizacionFallida) as exc:
        audio_asr.normalizar(b"x")
    assert exc.value.motivo == "ffmpeg_ausente"


def test_si_ffmpeg_no_arranca_tambien_es_normalizacion_fallida(mocker):
    mocker.patch("audio_asr.subprocess.run", side_effect=PermissionError("sin permiso"))
    with pytest.raises(audio_asr.NormalizacionFallida) as exc:
        audio_asr.normalizar(b"x")
    assert exc.value.motivo == "ffmpeg_no_arranca: PermissionError"


def test_la_imagen_del_worker_instala_ffmpeg():
    # Sin ffmpeg en la imagen el worker manda el original y vuelve la factura inflada.
    dockerfile = (Path(__file__).resolve().parent.parent / "Dockerfile").read_text()
    assert "apt-get install" in dockerfile and "ffmpeg" in dockerfile


# El pipeline le entrega al ASR el archivo normalizado ──────────────────────

TICKET = "a" * 64


def _sesion(duracion_audio_seg: int | None = 60) -> SesionReclamada:
    return SesionReclamada(
        sesion_clinica_id="s1", intento=1, ticket=TICKET, paciente_id="p1",
        terminos_asr=[], audio={"key": "org/s1/0"},
        checkpoint=None, duracion_audio_seg=duracion_audio_seg,
    )


class AsrDoble:
    """Hace de asr_assemblyai.transcribir: guarda lo que recibe y devuelve un texto fijo."""

    def __init__(self, duracion_seg: int = 60):
        self.recibido: list[bytes] = []
        self.duracion_seg = duracion_seg

    def __call__(self, audio: io.BufferedIOBase, keyterms) -> dict:
        self.recibido.append(audio.read())
        return {
            "duration_seconds": self.duracion_seg,
            "segments": [
                {"speaker": "S0", "start": 0.0, "end": 4.0, "text": "Hola, ¿cómo llegaste hoy?"},
                {"speaker": "S1", "start": 4.5, "end": 9.0, "text": "Bastante cansada, dormí poco."},
            ],
            "roles_origen": "asr_role",
            "asr_id": "tr1",
            "speech_model": "universal-3-5-pro",
        }


@pytest.fixture
def pipeline(mocker):
    """procesar_sesion con R2, app y modelo de dobles; la normalizacion y el formateo son reales."""
    mocker.patch("processor.LEASE_RENOVACION_SEG", 3600)
    ok = RespuestaApp(ok=True, status=200)
    mocker.patch("processor.app_client.registrar_asr", return_value=ok)
    mocker.patch("processor.app_client.renovar_lease", return_value=ok)
    mocker.patch("processor.app_client.enviar_resultado", return_value=ok)
    mocker.patch("processor.analizar", return_value=processor.Analisis({}, {}, "p"))
    checkpoint = mocker.patch("processor.app_client.registrar_transcripcion", return_value=ok)

    def correr(audio: bytes, asr: AsrDoble, sesion: SesionReclamada | None = None):
        mocker.patch("processor.r2_client.descargar_audio", return_value=(audio, {}))
        mocker.patch("processor.asr_assemblyai.transcribir", side_effect=asr)
        processor.procesar_sesion(sesion or _sesion())
        return checkpoint.call_args

    return correr


def test_al_asr_llega_el_archivo_normalizado_de_sesenta_segundos(pipeline, webm_con_salto, tmp_path):
    asr = AsrDoble()
    pipeline(webm_con_salto, asr)
    assert len(asr.recibido) == 1
    assert duracion_declarada(asr.recibido[0], tmp_path) == pytest.approx(60, rel=0.02)


def test_un_webm_normal_se_transcribe_igual_que_sin_normalizar(pipeline, webm_normal, tmp_path, mocker):
    asr = AsrDoble()
    con = pipeline(webm_normal, asr)
    assert duracion_declarada(asr.recibido[0], tmp_path) == pytest.approx(
        duracion_declarada(webm_normal, tmp_path), rel=0.01
    )

    # La misma sesion con el paso apagado, como en origin/main.
    mocker.patch("processor.preparar_para_asr", side_effect=lambda _e, audio: audio)
    sin_asr = AsrDoble()
    sin = pipeline(webm_normal, sin_asr)
    assert sin_asr.recibido[0] == webm_normal
    assert con.args[3] == sin.args[3]  # transcripcion formateada, identica
    assert con.kwargs["speech_analytics"] == sin.kwargs["speech_analytics"]


def test_si_ffmpeg_falla_va_el_original_y_queda_en_el_log(pipeline, mocker, caplog):
    mocker.patch("audio_asr.comando", return_value=["ffmpeg-que-no-existe"])
    asr = AsrDoble()
    with caplog.at_level(logging.ERROR):
        pipeline(b"\x1a\x45\xdf\xa3original", asr)
    assert asr.recibido == [b"\x1a\x45\xdf\xa3original"]
    assert any("normalizacion_fallida ffmpeg_ausente" in r.getMessage() for r in caplog.records)


def test_dos_cabeceras_se_rechazan_antes_de_normalizar_y_del_asr(pipeline, webm_normal, mocker):
    normalizar = mocker.patch("processor.audio_asr.normalizar")
    asr = AsrDoble()
    fallo = mocker.patch("processor.reportar_fallo")
    pipeline(webm_normal + webm_normal, asr)
    assert fallo.call_args.args[1].codigo == "audio_varias_cabeceras"
    normalizar.assert_not_called()
    assert asr.recibido == []


# Guardia: duracion del ASR contra la del telefono ──────────────────────────

@pytest.mark.parametrize(
    ("asr_seg", "telefono_seg", "aviso"),
    [
        (16269, 3232, {"duracionTelefonoSeg": 3232, "excesoPct": 403.4}),  # 24-09
        (4143, 1590, {"duracionTelefonoSeg": 1590, "excesoPct": 160.6}),   # 19-09
        (3556, 3232, {"duracionTelefonoSeg": 3232, "excesoPct": 10.0}),    # 10 % y un segundo
        (3555, 3232, None),                                                  # hasta 10 %: nada
        (81, 20, {"duracionTelefonoSeg": 20, "excesoPct": 305.0}),         # 61 s de exceso
        (80, 20, None),                                                      # 300 %, pero 60 s: nada
        (30, 20, None),                                                      # corta: 50 % son 10 s
        (3232, 3232, None),
        (3000, 3232, None),                                                  # menor: nada
        (3600, None, None),                                                  # sin medida del telefono
        (3600, 0, None),
        (None, 3232, None),
    ],
)
def test_aviso_duracion(asr_seg, telefono_seg, aviso):
    assert processor.aviso_duracion(asr_seg, telefono_seg) == aviso


def test_asr_mas_de_diez_por_ciento_y_mas_de_un_minuto_mayor_registra_el_aviso_y_no_falla(pipeline, webm_normal, caplog, mocker):
    fallo = mocker.patch("processor.reportar_fallo")
    with caplog.at_level(logging.WARNING):
        llamada = pipeline(webm_normal, AsrDoble(duracion_seg=667), _sesion(duracion_audio_seg=600))
    assert llamada.kwargs["aviso_duracion"] == {"duracionTelefonoSeg": 600, "excesoPct": 11.2}
    assert llamada.kwargs["duracion_seg"] == 667
    assert any("duracion_asr_inflada: ASR 667s, telefono 600s" in r.getMessage() for r in caplog.records)
    fallo.assert_not_called()


def test_asr_menor_que_el_telefono_no_avisa(pipeline, webm_normal, caplog):
    with caplog.at_level(logging.WARNING):
        llamada = pipeline(webm_normal, AsrDoble(duracion_seg=58), _sesion(duracion_audio_seg=60))
    assert llamada.kwargs["aviso_duracion"] is None
    assert not any("duracion_asr_inflada" in r.getMessage() for r in caplog.records)
