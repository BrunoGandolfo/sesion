import base64
import hashlib
import json
import math
import struct
import subprocess
import wave
from pathlib import Path

import pytest
from Crypto.Cipher import AES
from audio_entrada import armar_audio, descifrar_segmento
from errores import PipelineError

CLAVE = bytes(range(32))


def cifrar(datos, indice):
    iv = indice.to_bytes(12, "big")
    c = AES.new(CLAVE, AES.MODE_GCM, nonce=iv)
    c.update(json.dumps(["org", "s1", indice], separators=(",", ":")).encode())
    texto, tag = c.encrypt_and_digest(datos)
    return texto + tag, base64.b64encode(iv).decode()


def entrada(archivos, inicios=None):
    blobs = {}
    descriptores = []
    for i, archivo in enumerate(archivos):
        cifrado, iv = cifrar(archivo.read_bytes(), i)
        key = f"org/s1/{i}"
        blobs[key] = cifrado
        descriptores.append(dict(indice=i, key=key, iv=iv, bytes=len(cifrado), sha256=hashlib.sha256(cifrado).hexdigest(), inicioMs=inicios[i] if inicios is not None else 59000*i))
    return {"organizationId": "org", "clave": base64.b64encode(CLAVE).decode(), "segmentos": descriptores, "pausas": []}, blobs


@pytest.fixture(scope="module")
def reales(tmp_path_factory):
    carpeta = tmp_path_factory.mktemp("opus-aac")
    referencia = carpeta / "fuente.wav"
    with wave.open(str(referencia), "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        for segundo in range(480):
            # Pitidos de frecuencia distinta: la posición y la identidad se
            # comprueban sobre el audio decodificado, no sobre metadata.
            w.writeframes(b"".join(struct.pack("<h", int(14000 * math.sin(2 * math.pi * (300 + segundo * 10) * j / 16000)) if 1600 <= j < 3200 else 0) for j in range(16000)))
    resultado = {}
    for codec, extension in [("libopus", "webm"), ("aac", "m4a")]:
        for nombre, inicios, total, maximo in [
            ("", [0, 59, 118], 125, 60),
            ("-variable", [58.9*i for i in range(8)], 472.3, 60),
            # Congelación: el primer recorder no rota hasta los 300 segundos.
            # El segundo arranca 875 ms antes: no se puede recortar un segundo fijo.
            ("-largo", [0, 299.125], 359, 300),
            ("-largo-hueco", [0, 300.25], 359, 300),
            ("-excesivo", [0], 301, 301),
        ]:
            archivos = []
            for i, inicio in enumerate(inicios):
                p = carpeta / f"{codec}{nombre}-{i}.{extension}"
                subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(inicio), "-i", str(referencia), "-t", str(min(maximo, total-inicio)), "-c:a", codec, "-b:a", "64k", str(p)], check=True)
                archivos.append(p)
            resultado[codec+nombre] = archivos
    return resultado


@pytest.mark.parametrize("codec", ["libopus", "aac"])
@pytest.mark.parametrize("caso", ["", "-variable", "-largo"])
def test_union_real_sin_perdidas_ni_repeticiones(codec, caso, reales, monkeypatch):
    total, pulsos, inicios = {
        "": (125, 125, [0, 59000, 118000]),
        "-variable": (472.3, 473, [58900*i for i in range(8)]),
        "-largo": (359, 359, [0, 299125]),
    }[caso]
    audio, blobs = entrada(reales[codec + caso], inicios)
    assert all(s["bytes"] <= 4 * 1024 * 1024 for s in audio["segmentos"])
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with armar_audio("s1", audio) as preparado:
        archivo = preparado.archivo
        with wave.open(str(archivo), "rb") as w:
            assert abs(w.getnframes() / 16000 - total) < .2
            if caso == "-largo":
                assert w.getnframes() == 359 * 16000
                assert preparado.duracion_ms == 359000
                assert preparado.huecos == []
            datos = struct.unpack("<" + "h" * w.getnframes(), w.readframes(w.getnframes()))
        # Detecta comienzos por energía en ventanas de 10 ms.
        activos = [sum(x*x for x in datos[i:i+160]) / 160 > 2_000_000 for i in range(0, len(datos), 160)]
        inicios = [i / 100 for i, valor in enumerate(activos) if valor and (i == 0 or not activos[i-1])]
        assert len(inicios) == pulsos, inicios
        assert max(abs((b-a)-1) for a, b in zip(inicios, inicios[1:])) < .04
        assert max(abs(t-(i+.1)) for i, t in enumerate(inicios)) < .04
        # Frecuencia del centro de cada pitido; ningún ID se repite ni falta.
        for segundo, comienzo in enumerate(inicios):
            centro = int((comienzo + .02) * 16000)
            bloque = datos[centro:centro+960]
            cruces = sum(a <= 0 < b for a, b in zip(bloque, bloque[1:]))
            assert abs(cruces / .06 - (300 + segundo * 10)) < 25
        guardado = archivo
    assert not guardado.exists()


@pytest.mark.parametrize("campo", ["iv", "sha256", "key", "indice", "bytes"])
def test_rechaza_corrupcion_sin_producir_audio(campo, reales, monkeypatch):
    audio, blobs = entrada(reales["libopus"])
    audio["segmentos"][0][campo] = {"iv": "A" * 16, "sha256": "b"*64, "key": "otra/s1/0", "indice": 3, "bytes": 25}[campo]
    # IV original cero: se altera a un nonce realmente distinto.
    if campo == "iv": audio["segmentos"][0][campo] = base64.b64encode(b"x"*12).decode()
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with pytest.raises(PipelineError):
        with armar_audio("s1", audio):
            pytest.fail("No debe entregar audio corrupto")


def test_webcrypto_real_es_compatible_con_python():
    script = '''const clave=Uint8Array.from({length:32},(_,i)=>i); const iv=new Uint8Array(12); const k=await crypto.subtle.importKey("raw",clave,"AES-GCM",false,["encrypt"]); const c=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(JSON.stringify(["org","s1",0]))},k,new TextEncoder().encode("audio sintético")); console.log(Buffer.from(c).toString("base64"));'''
    cifrado = base64.b64decode(subprocess.check_output(["node", "--input-type=module", "-e", script]))
    assert descifrar_segmento(cifrado, base64.b64encode(CLAVE), base64.b64encode(bytes(12)), "org", "s1", 0) == "audio sintético".encode()


def test_red_no_es_corrupcion(reales, monkeypatch):
    audio, _ = entrada(reales["libopus"])
    def red(*_): raise OSError("red")
    monkeypatch.setattr("r2_client.descargar_segmento", red)
    with pytest.raises(PipelineError) as error:
        with armar_audio("s1", audio): pass
    assert error.value.codigo == "r2_error" and not error.value.definitivo


@pytest.mark.parametrize("inicio", [None, -1, float("nan"), float("inf"), 9000001, "59000", True, 0])
def test_no_inventa_inicios_para_segmentos_sin_medida_valida(inicio, reales, monkeypatch):
    audio, blobs = entrada(reales["libopus"])
    audio["segmentos"][1]["inicioMs"] = inicio
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with pytest.raises(PipelineError) as error:
        with armar_audio("s1", audio): pass
    assert error.value.codigo == "audio_inicio"


def test_primer_segmento_exige_inicio_cero(reales, monkeypatch):
    audio, blobs = entrada(reales["libopus"])
    audio["segmentos"][0]["inicioMs"] = 1
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with pytest.raises(PipelineError) as error:
        with armar_audio("s1", audio): pass
    assert error.value.codigo == "audio_inicio"


@pytest.mark.parametrize("codec", ["libopus", "aac"])
def test_ensamblado_verifica_muestras_no_reloj_redondeado(codec, reales, monkeypatch):
    import audio_entrada
    audio, blobs = entrada(reales[codec])
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    ffmpeg = audio_entrada._ffmpeg
    def perder_200ms(argumentos):
        ffmpeg(argumentos)
        salida = Path(argumentos[-1])
        if salida.name == "sesion.wav":
            with wave.open(str(salida), "rb") as wav:
                params = wav.getparams()
                muestras = wav.readframes(wav.getnframes() - 3200)
            with wave.open(str(salida), "wb") as wav:
                wav.setparams(params)
                wav.writeframes(muestras)
    monkeypatch.setattr(audio_entrada, "_ffmpeg", perder_200ms)
    with pytest.raises(PipelineError) as error:
        with armar_audio("s1", audio): pass
    assert error.value.codigo == "audio_duracion"


def test_worker_no_reclama_sesiones_sin_ffmpeg(monkeypatch):
    import worker
    monkeypatch.setattr("shutil.which", lambda _: None)
    monkeypatch.setattr(worker, "loop_principal", lambda: pytest.fail("No debe reclamar"))
    with pytest.raises(RuntimeError, match="ffmpeg"):
        worker.main()


@pytest.mark.parametrize("codec,extension", [("libopus", "webm"), ("aac", "m4a")])
@pytest.mark.parametrize("hueco", [False, True])
def test_truncado_salva_tono_y_hueco_real_avisa_sin_recortar_ni_rellenar(codec, extension, hueco, tmp_path, monkeypatch):
    # Primer archivo truncado a 59,8 s. Si el segundo empezó en 59, se
    # recortan 800 ms y sobrevive el tono en 59,9. Si empezó en 60, hay un
    # hueco de 200 ms y se conserva TODO el segundo, incluido su tono inicial.
    fuente = tmp_path / "fuente.wav"
    tono = 60.01 if hueco else 59.88
    expresion = f"aevalsrc=if(between(t\\,{tono}\\,{tono+.06})\\,0.7*sin(2*PI*2300*t)\\,0):s=16000:d=118"
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", expresion, str(fuente)], check=True)
    segundo = 60 if hueco else 59
    archivos = []
    for i, (inicio, duracion) in enumerate([(0, 59.8), (segundo, 118-segundo)]):
        archivo = tmp_path / f"{i}.{extension}"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(inicio), "-i", str(fuente), "-t", str(duracion), "-c:a", codec, "-b:a", "64k", str(archivo)], check=True)
        archivos.append(archivo)
    audio, blobs = entrada(archivos, [0, segundo*1000])
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with armar_audio("s1", audio) as preparado:
        with wave.open(str(preparado.archivo), "rb") as w:
            duracion = w.getnframes() / w.getframerate()
            datos = struct.unpack("<" + "h" * w.getnframes(), w.readframes(w.getnframes()))
        assert duracion == pytest.approx(117.8 if hueco else 118, abs=1/16000)
        assert preparado.duracion_ms == pytest.approx(duracion*1000)
        assert max(abs(x) for x in datos) > 10_000
        # El tono mantiene su posición en el audio conservado, sin silencio añadido.
        posicion = (tono - (.2 if hueco else 0)) * 16000
        assert max(abs(x) for x in datos[int(posicion):int(posicion+960)]) > 10_000
        assert preparado.huecos == ([{"inicio": 59800, "fin": 60000, "siguienteIndice": 1, "motivo": "interrupcion"}] if hueco else [])


@pytest.mark.parametrize("codec", ["libopus", "aac"])
def test_segmento_largo_con_hueco_conserva_audio_y_avisa(codec, reales, monkeypatch):
    audio, blobs = entrada(reales[codec + "-largo-hueco"], [0, 300250])
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with armar_audio("s1", audio) as preparado:
        with wave.open(str(preparado.archivo), "rb") as w:
            assert w.getnframes() == 358.75 * 16000
        assert preparado.duracion_ms + 250 == 359000
        assert preparado.huecos == [
            {"inicio": 300000, "fin": 300250, "siguienteIndice": 1, "motivo": "interrupcion"},
        ]


@pytest.mark.parametrize("codec", ["libopus", "aac"])
def test_rechaza_segmento_mayor_a_cinco_minutos(codec, reales, monkeypatch):
    # Archivo REAL de 301 segundos, bien cifrado y dentro del tope de bytes:
    # debe rechazarlo por duración, no por tamaño, autenticación ni metadata rota.
    audio, blobs = entrada(reales[codec + "-excesivo"], [0])
    assert audio["segmentos"][0]["bytes"] <= 4 * 1024 * 1024
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with pytest.raises(PipelineError) as error:
        with armar_audio("s1", audio):
            pytest.fail("No debe entregar un segmento que excede cinco minutos")
    assert error.value.codigo == "audio_invalido"
    assert error.value.definitivo


def test_rechaza_archivo_que_no_es_audio_aunque_su_cifrado_y_huella_sean_validos(tmp_path, monkeypatch):
    archivo = tmp_path / "corrupto.webm"
    archivo.write_bytes(b"Esto no es un contenedor de audio")
    audio, blobs = entrada([archivo], [0])
    monkeypatch.setattr("r2_client.descargar_segmento", lambda key, n: blobs[key])
    with pytest.raises(PipelineError) as error:
        with armar_audio("s1", audio):
            pytest.fail("No debe entregar un archivo corrupto")
    assert error.value.codigo == "audio_invalido"
    assert error.value.definitivo
