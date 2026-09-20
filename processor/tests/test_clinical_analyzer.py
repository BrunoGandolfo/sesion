"""
Reintento interno del LLM por salida mal formada.

Regla: una salida que no cumple la FORMA (JSON no parseable, seccion SOAP
faltante, enum invalido) se pide una segunda vez citandole al modelo el error.
Si la segunda tampoco valida, ahi si falla la sesion. Los fallos de transporte
no se reintentan aca: de eso se ocupa `max_retries` del SDK.

Sin red: se mockea _llamar_llm, que es la frontera con Anthropic.
"""
import pytest

import clinical_analyzer
import config
from clinical_analyzer import DiagnosticoLLM
from errores import PipelineError
from schemas_llm import SCHEMA_NOTA, validar_estructura_nota

RIESGO_SIN_SEÑAL = {
    "nivel": "ninguno",
    "indicadores": [],
    "evidencia": [],
    "notaParaTerapeuta": None,
}


def _nota(**datos) -> dict:
    base = {
        "intensidadEmocional": 7,
        "alianzaTerapeutica": "estable",
        "duracionRealMin": 50,
        "riesgoDetectado": dict(RIESGO_SIN_SEÑAL),
    }
    base.update(datos)
    return {
        "nota": {"subjetivo": "s", "objetivo": "o", "analisis": "a", "plan": "p"},
        "datosEstructurados": base,
    }


def _nota_sin_analisis() -> dict:
    resultado = _nota()
    del resultado["nota"]["analisis"]
    return resultado


@pytest.fixture
def llm(mocker):
    """Frontera con Anthropic. Cada test define su secuencia de respuestas."""
    return mocker.patch("clinical_analyzer._llamar_llm")


@pytest.fixture
def prompt(mocker):
    mocker.patch("clinical_analyzer._cargar_prompt", return_value="SYSTEM")


def _validando():
    return clinical_analyzer._llamar_validando(
        "sys", "user", SCHEMA_NOTA, validar_estructura_nota
    )


# _llamar_validando ─────────────────────────────────────────────────────────

def test_primera_valida_no_reintenta(llm):
    llm.side_effect = [_nota()]

    resultado, reintentos = _validando()

    assert reintentos == 0
    assert resultado["nota"]["analisis"] == "a"
    assert llm.call_count == 1


def test_estructura_invalida_y_luego_valida_da_exito_con_un_reintento(llm):
    llm.side_effect = [_nota_sin_analisis(), _nota()]

    resultado, reintentos = _validando()

    assert reintentos == 1
    assert llm.call_count == 2
    assert resultado["nota"]["analisis"] == "a"


def test_dos_estructuras_invalidas_terminan_en_pipeline_error(llm):
    llm.side_effect = [_nota_sin_analisis(), _nota_sin_analisis()]

    with pytest.raises(PipelineError) as exc:
        _validando()

    assert exc.value.codigo == "llm_estructura_invalida"
    assert "analisis" in exc.value.mensaje_publico
    assert llm.call_count == 2


def test_el_mensaje_de_correccion_cita_el_error_de_validacion(llm):
    llm.side_effect = [_nota_sin_analisis(), _nota()]

    _validando()

    contenido_segunda = llm.call_args_list[1].args[1]
    assert "<correccion>" in contenido_segunda
    assert "Error de validacion:" in contenido_segunda
    # El error concreto, no un texto generico.
    assert "analisis" in contenido_segunda
    assert "secciones SOAP" in contenido_segunda
    # El pedido original sigue estando: el modelo necesita la transcripcion.
    assert contenido_segunda.startswith("user")


def test_el_mensaje_de_correccion_no_reenvia_la_salida_anterior(llm):
    # Devolverle su propia nota duplicaria material clinico del paciente en
    # el input. Solo se le cita el error de forma.
    primera = _nota_sin_analisis()
    primera["nota"]["subjetivo"] = "La paciente refirio insomnio severo"
    llm.side_effect = [primera, _nota()]

    _validando()

    contenido_segunda = llm.call_args_list[1].args[1]
    assert "insomnio severo" not in contenido_segunda


def test_json_invalido_y_luego_valido_da_exito_con_un_reintento(llm):
    llm.side_effect = [
        PipelineError("llm_json_invalido", "El LLM no devolvio JSON valido"),
        _nota(),
    ]

    resultado, reintentos = _validando()

    assert reintentos == 1
    assert resultado["nota"]["plan"] == "p"
    assert "no era JSON parseable" in llm.call_args_list[1].args[1]


def test_json_invalido_dos_veces_propaga_el_error_original(llm):
    llm.side_effect = [
        PipelineError("llm_json_invalido", "El LLM no devolvio JSON valido"),
        PipelineError("llm_json_invalido", "El LLM no devolvio JSON valido"),
    ]

    with pytest.raises(PipelineError) as exc:
        _validando()

    assert exc.value.codigo == "llm_json_invalido"
    assert llm.call_count == 2


@pytest.mark.parametrize(
    "codigo", ["llm_timeout", "llm_error", "llm_rechazo"]
)
def test_los_fallos_de_transporte_no_se_reintentan(llm, codigo):
    # `llm_truncado` salio de esta lista el 2026-09-07: dejo de tratarse como
    # un fallo terminal y pasa a reintentarse (ver los tests de mas abajo).
    llm.side_effect = [PipelineError(codigo, "fallo"), _nota()]

    with pytest.raises(PipelineError) as exc:
        _validando()

    assert exc.value.codigo == codigo
    assert llm.call_count == 1


def test_riesgo_mal_formado_dispara_el_reintento(llm):
    # La señal de riesgo es bloqueante: se pide de nuevo antes de rendirse.
    malo = _nota(riesgoDetectado={"nivel": "altisimo", "indicadores": [],
                                  "evidencia": [], "notaParaTerapeuta": None})
    llm.side_effect = [malo, _nota()]

    resultado, reintentos = _validando()

    assert reintentos == 1
    assert resultado["datosEstructurados"]["riesgoDetectado"]["nivel"] == "ninguno"
    assert "riesgoDetectado.nivel" in llm.call_args_list[1].args[1]


# analizar() ────────────────────────────────────────────────────────────────

def test_analizar_devuelve_diagnostico_limpio(llm, prompt):
    llm.side_effect = [_nota()]

    resultado, nombre, diagnostico = clinical_analyzer.analizar("[00:00] Terapeuta: hola")

    assert nombre == "clinical_note_v3.1.1.md"
    assert diagnostico == DiagnosticoLLM(reintentos=0, advertencias=[])
    assert resultado["datosEstructurados"]["intensidadEmocional"] == 7


def test_analizar_con_intensidad_cero_no_falla_y_deja_advertencia(llm, prompt):
    """El caso del 4/9: antes tiraba llm_rango_invalido y perdia la sesion."""
    llm.side_effect = [_nota(intensidadEmocional=0)]

    resultado, _, diagnostico = clinical_analyzer.analizar("[00:00] Terapeuta: hola")

    assert diagnostico.reintentos == 0
    assert diagnostico.advertencias == [
        "intensidadEmocional=0 fuera de rango 1..10, anulado"
    ]
    assert "intensidadEmocional" not in resultado["datosEstructurados"]
    assert resultado["nota"]["subjetivo"] == "s"
    assert llm.call_count == 1  # no hace falta segunda pasada


def test_analizar_cuenta_el_reintento_en_el_diagnostico(llm, prompt):
    llm.side_effect = [_nota_sin_analisis(), _nota(intensidadEmocional=0)]

    _, _, diagnostico = clinical_analyzer.analizar("[00:00] Terapeuta: hola")

    assert diagnostico.reintentos == 1
    assert len(diagnostico.advertencias) == 1


def test_analizar_falla_si_la_segunda_tampoco_valida(llm, prompt):
    llm.side_effect = [_nota_sin_analisis(), _nota_sin_analisis()]

    with pytest.raises(PipelineError) as exc:
        clinical_analyzer.analizar("[00:00] Terapeuta: hola")

    assert exc.value.codigo == "llm_estructura_invalida"


# generar_feedback_terapeuta() ──────────────────────────────────────────────

def _feedback_cbt_mi(score=4) -> dict:
    return {
        "mitiGlobales": {"empathy": {"score": score, "evidence": [], "razon": None}},
        "mitiCounts": {"Q": 1},
        "ctsrSubset": {"agendaSetting": {"score": 3, "evidence": [], "razon": None}},
        "fortalezas": [],
        "areasCrecimiento": [],
    }


def test_feedback_reintenta_y_reporta_el_reintento(llm, prompt):
    llm.side_effect = [{"mitiGlobales": {}}, _feedback_cbt_mi()]

    feedback, nombre, diagnostico = clinical_analyzer.generar_feedback_terapeuta("t")

    assert nombre == "therapist_feedback_v1.1.md"
    assert diagnostico.reintentos == 1
    assert feedback["mitiCounts"]["Q"] == 1


def test_feedback_con_puntaje_fuera_de_escala_queda_en_null(llm, prompt):
    llm.side_effect = [_feedback_cbt_mi(score=0)]

    feedback, _, diagnostico = clinical_analyzer.generar_feedback_terapeuta("t")

    assert feedback["mitiGlobales"]["empathy"]["score"] is None
    assert diagnostico.advertencias == [
        "mitiGlobales.empathy.score=0 fuera de rango 1..5, anulado"
    ]


def test_feedback_que_falla_dos_veces_no_tira_la_sesion(llm, prompt):
    # El feedback es best-effort: la nota clinica ya esta generada.
    llm.side_effect = [{"mitiGlobales": {}}, {"mitiGlobales": {}}]

    feedback, nombre, diagnostico = clinical_analyzer.generar_feedback_terapeuta("t")

    assert feedback is None
    assert nombre == "therapist_feedback_v1.1.md"
    assert diagnostico.advertencias == [
        "feedback_no_generado: llm_estructura_invalida"
    ]


def test_feedback_gestalt_usa_su_prompt_y_su_validador(llm, prompt):
    llm.side_effect = [{
        "instrumento": "gestalt",
        "itemsGTFS": [{"id": "gtfs_01", "score": 1}],
        "fortalezas": [],
        "areasCrecimiento": [],
    }]

    feedback, nombre, diagnostico = clinical_analyzer.generar_feedback_terapeuta(
        "t", orientacion="gestalt"
    )

    assert nombre == "therapist_feedback_gestalt_v1.1.md"
    assert diagnostico.reintentos == 0
    assert feedback["itemsGTFS"][0]["score"] == 1


# Respuesta truncada (llm_truncado) ─────────────────────────────────────────
#
# El caso del fin de semana del 6-7/9/2026: 5 de 8 sesiones terminaron con
# "llm_truncado: Respuesta truncada en 8192 tokens" y quedaron sin "Para vos",
# sin reintento y sin rastro en el payload. Tres cosas se arreglaron y estas
# son las tres: el techo propio del feedback, el reintento, y la advertencia
# con clave estable cuando aun asi no sale.

def _truncado(tope: int = 8192) -> PipelineError:
    return PipelineError("llm_truncado", f"Respuesta truncada en {tope} tokens")


def test_feedback_truncado_reintenta_y_sale(llm, prompt):
    llm.side_effect = [_truncado(), _feedback_cbt_mi()]

    feedback, _, diagnostico = clinical_analyzer.generar_feedback_terapeuta("t")

    assert llm.call_count == 2
    assert diagnostico.reintentos == 1
    assert diagnostico.advertencias == []
    assert feedback["mitiCounts"]["Q"] == 1


def test_el_reintento_por_truncado_repite_el_pedido_sin_correccion(llm, prompt):
    # Un bloque de correccion pidiendo "algo mas corto" seria decidir por
    # Mariana cuanto dura el feedback. El pedido se repite igual.
    llm.side_effect = [_truncado(), _feedback_cbt_mi()]

    clinical_analyzer.generar_feedback_terapeuta("t")

    primera = llm.call_args_list[0].args[1]
    segunda = llm.call_args_list[1].args[1]
    assert segunda == primera
    assert "<correccion>" not in segunda


def test_feedback_truncado_dos_veces_deja_advertencia_y_no_inventa_nada(llm, prompt):
    llm.side_effect = [_truncado(16384), _truncado(16384)]

    feedback, nombre, diagnostico = clinical_analyzer.generar_feedback_terapeuta("t")

    assert llm.call_count == 2
    # Regla 13 del prompt de nota: null antes que inventar.
    assert feedback is None
    assert nombre == "therapist_feedback_v1.1.md"
    assert diagnostico.advertencias == ["feedback_no_generado: llm_truncado"]


def test_la_nota_tambien_reintenta_si_viene_truncada(llm):
    llm.side_effect = [_truncado(), _nota()]

    resultado, reintentos = _validando()

    assert reintentos == 1
    assert resultado["nota"]["analisis"] == "a"


def test_la_nota_truncada_dos_veces_propaga_el_codigo(llm):
    llm.side_effect = [_truncado(), _truncado()]

    with pytest.raises(PipelineError) as exc:
        _validando()

    assert exc.value.codigo == "llm_truncado"
    assert llm.call_count == 2


# El techo de tokens de cada llamada ────────────────────────────────────────

def test_el_feedback_pide_16384_tokens(llm, prompt):
    llm.side_effect = [_feedback_cbt_mi()]

    clinical_analyzer.generar_feedback_terapeuta("t")

    assert config.LLM_MAX_TOKENS_FEEDBACK == 16384
    assert llm.call_args.args[3] == 16384


def test_el_feedback_gestalt_usa_el_mismo_techo(llm, prompt):
    llm.side_effect = [{
        "instrumento": "gestalt",
        "itemsGTFS": [{"id": "gtfs_01", "score": 1}],
        "fortalezas": [],
        "areasCrecimiento": [],
    }]

    clinical_analyzer.generar_feedback_terapeuta("t", orientacion="gestalt")

    assert llm.call_args.args[3] == config.LLM_MAX_TOKENS_FEEDBACK


def test_la_nota_pide_su_propio_techo(llm, prompt):
    # 2026-09-19: una sesion de 21 minutos termino "fallida" con llm_truncado
    # en el paso "nota" y la profesional se quedo sin nota. La nota dejo de ir
    # con el techo comun y paso al mismo numero que el feedback.
    llm.side_effect = [_nota()]

    clinical_analyzer.analizar("[00:00] Terapeuta: hola")

    assert config.LLM_MAX_TOKENS_NOTA == 16384
    assert llm.call_args.args[3] == config.LLM_MAX_TOKENS_NOTA
    assert config.LLM_MAX_TOKENS_NOTA > config.LLM_MAX_TOKENS


def test_el_contexto_sigue_con_el_techo_comun(llm, prompt):
    # Decision explicita: la Llamada B se queda en 8192 (no hay un solo caso de
    # truncado ahi, y si falla el Recorrido no se actualiza pero la nota ya
    # esta aprobada). Lo que gano es la segunda pasada con el doble.
    llm.side_effect = [{
        "hipotesisDiagnostica": None,
        "resumenAcumulativo": None,
        "objetivosTerapeuticos": [],
        "intervencionesProbadas": [],
        "temasRecurrentes": [],
        "riesgosHistoricos": [],
        "cambios": [],
    }]

    clinical_analyzer.actualizar_contexto_clinico({}, {}, {}, "s1", "2026-09-19")

    assert llm.call_args.args[3] == config.LLM_MAX_TOKENS
    assert config.LLM_MAX_TOKENS == 8192


# El techo de la segunda pasada ─────────────────────────────────────────────
#
# Hasta el 19-sep el reintento por llm_truncado repetia el pedido con el MISMO
# max_tokens: volvia a hacer la pregunta que acababa de no entrar, y dos
# truncados seguidos eran un fallo definitivo. Ahora la segunda pasada duplica.

def test_una_nota_truncada_y_despues_completa_termina_en_nota(llm, prompt):
    # Lo que en produccion dejo a la profesional sin nota: el primer intento
    # vuelve truncado. Con el techo mas alto en la segunda pasada, sale.
    llm.side_effect = [_truncado(config.LLM_MAX_TOKENS_NOTA), _nota()]

    resultado, nombre, diagnostico = clinical_analyzer.analizar("[00:00] Terapeuta: hola")

    assert llm.call_count == 2
    assert diagnostico.reintentos == 1
    assert resultado["nota"]["analisis"] == "a"
    assert nombre == clinical_analyzer.PROMPTS["nota"]

    primero = llm.call_args_list[0].args[3]
    segundo = llm.call_args_list[1].args[3]
    assert primero == config.LLM_MAX_TOKENS_NOTA
    assert segundo > primero
    assert segundo == config.LLM_MAX_TOKENS_REINTENTO


def test_la_nota_truncada_dos_veces_sigue_fallando(llm, prompt):
    # Subir el techo no convierte el truncado en imposible: dos veces seguidas
    # sigue siendo un fallo con el mismo codigo. La sesion no se inventa nada.
    llm.side_effect = [
        _truncado(config.LLM_MAX_TOKENS_NOTA),
        _truncado(config.LLM_MAX_TOKENS_REINTENTO),
    ]

    with pytest.raises(PipelineError) as exc:
        clinical_analyzer.analizar("[00:00] Terapeuta: hola")

    assert exc.value.codigo == "llm_truncado"
    assert llm.call_count == 2


def test_la_segunda_pasada_no_pasa_del_tope_sin_streaming(llm, prompt):
    # 20480: el SDK exige streaming por encima de 21333 tokens
    # (expected_time = 3600 * max_tokens / 128000 > 600 s). Este worker no
    # usa streaming.
    llm.side_effect = [_truncado(config.LLM_MAX_TOKENS_FEEDBACK), _feedback_cbt_mi()]

    clinical_analyzer.generar_feedback_terapeuta("t")

    assert config.LLM_MAX_TOKENS_REINTENTO == 20480
    assert config.LLM_MAX_TOKENS_REINTENTO <= 21333
    assert llm.call_args_list[1].args[3] == config.LLM_MAX_TOKENS_REINTENTO


def test_el_contexto_truncado_reintenta_con_el_doble(llm, prompt):
    llm.side_effect = [_truncado(), {
        "hipotesisDiagnostica": None,
        "resumenAcumulativo": None,
        "objetivosTerapeuticos": [],
        "intervencionesProbadas": [],
        "temasRecurrentes": [],
        "riesgosHistoricos": [],
        "cambios": [],
    }]

    clinical_analyzer.actualizar_contexto_clinico({}, {}, {}, "s1", "2026-09-19")

    assert llm.call_args_list[0].args[3] == 8192
    assert llm.call_args_list[1].args[3] == 16384


# Los prompts que declara PROMPTS existen en disco ──────────────────────────

def test_los_cuatro_prompts_se_cargan():
    for nombre in clinical_analyzer.PROMPTS.values():
        assert clinical_analyzer._cargar_prompt(nombre).strip()
