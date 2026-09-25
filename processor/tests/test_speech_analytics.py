"""speech_analytics.compute: lo que se guarda como datos.speechAnalytics y ve el prompt."""
import speech_analytics


def _seg(speaker: str, start: float, end: float) -> dict:
    return {"speaker": speaker, "start": start, "end": end, "text": "…"}


def test_ratios_silencios_y_total():
    metricas = speech_analytics.compute(
        [
            _seg("S0", 0.0, 10.0),
            _seg("S1", 12.0, 30.0),   # 2 s: no es silencio (umbral 3 s)
            _seg("S0", 35.0, 40.0),   # 5 s
            _seg("S2", 50.0, 60.0),   # 10 s; S2 cuenta como paciente
        ]
    )
    assert metricas == {
        "ratioHablaTerapeuta": 25.0,   # 15 s de 60
        "ratioHablaPaciente": 46.7,    # 28 s de 60
        "cantidadSilencios": 2,
        "duracionPromedioSilenciosSeg": 7.5,
        "tiempoTotalHablaSeg": 60.0,   # fin del ultimo segmento
        "speakersDetectados": 3,
    }


def test_exactamente_el_umbral_no_es_silencio_y_el_orden_no_importa():
    metricas = speech_analytics.compute([_seg("S1", 13.0, 20.0), _seg("S0", 0.0, 10.0)])
    assert metricas["cantidadSilencios"] == 0
    assert metricas["tiempoTotalHablaSeg"] == 20.0


def test_un_segmento_con_fin_antes_del_inicio_no_resta():
    metricas = speech_analytics.compute([_seg("S0", 0.0, 10.0), _seg("S1", 10.0, 9.0)])
    assert metricas["ratioHablaPaciente"] == 0.0


def test_sin_segmentos_todo_en_cero():
    assert speech_analytics.compute([]) == {
        "ratioHablaTerapeuta": 0.0,
        "ratioHablaPaciente": 0.0,
        "cantidadSilencios": 0,
        "duracionPromedioSilenciosSeg": 0.0,
        "tiempoTotalHablaSeg": 0.0,
        "speakersDetectados": 0,
    }
