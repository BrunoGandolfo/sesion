"""
Excepciones del pipeline.

PipelineError lleva un codigo tecnico corto (asr_error, llm_truncado, ...) y
un mensaje publico apto para el resultado y los logs: nunca contiene texto de
transcripcion, nota clinica, claves ni cuerpos de respuesta de proveedores.

Cada fallo es TRANSITORIO o DEFINITIVO, y lo decide el worker (la app solo
aplica su politica: un transitorio vuelve a la cola con backoff y se agota a
los MAX fallos seguidos; un definitivo deja la sesion en `fallida` hasta que
la profesional reintente o elimine). Se puede fijar por excepcion
(`definitivo=`) o dejar que lo decida el codigo.

Los de CODIGOS_DEFINITIVOS no se arreglan solos con el tiempo: repetir la
sesion repite el mismo resultado, y en el caso del modelo lo paga de nuevo.
El resto si puede (red, timeouts, 429 y 5xx de un proveedor, la app que no
guardo, error interno).
"""

CODIGOS_DEFINITIVOS = frozenset(
    {
        # El archivo de audio: falta la key o son dos grabaciones pegadas.
        "audio_sin_key",
        "audio_varias_cabeceras",
        # AssemblyAI: transcripcion sin segmentos, o un 4xx (que no sea 429)
        # contra la request: payload, audio o credencial que no cambian solos.
        "asr_vacio",
        "asr_rechazado",
        # El modelo: estas salidas llegan despues de agotar el reintento de
        # forma de clinical_analyzer (JSON invalido o estructura invalida dos
        # veces, truncado aun con el techo del reintento), o son un rechazo o
        # una respuesta sin texto, que no se reintentan.
        "llm_truncado",
        "llm_json_invalido",
        "llm_estructura_invalida",
        "llm_rechazo",
        "llm_sin_texto",
        # La app entrego un checkpoint sin transcripcion.
        "checkpoint_invalido",
    }
)


class PipelineError(Exception):
    def __init__(self, codigo: str, mensaje_publico: str, definitivo: bool | None = None):
        self.codigo = codigo
        self.mensaje_publico = mensaje_publico
        self._definitivo = definitivo
        super().__init__(f"{codigo}: {mensaje_publico}")

    def ampliar_detalle(self, extra: str) -> "PipelineError":
        """
        Agrega contexto al detalle que viaja a la app, sin tocar el codigo ni
        si es definitivo. El codigo es contrato con la app; el detalle es el
        texto que despues se lee para no volver a adivinar.

        Devuelve self para poder escribir `raise e.ampliar_detalle(...)`.
        """
        self.mensaje_publico = f"{self.mensaje_publico}; {extra}"
        self.args = (f"{self.codigo}: {self.mensaje_publico}",)
        return self

    @property
    def definitivo(self) -> bool:
        if self._definitivo is not None:
            return self._definitivo
        return self.codigo in CODIGOS_DEFINITIVOS


class LeasePerdido(Exception):
    """
    La app rechazo el ticket o el intento (401/409): otro reclamo se llevo la
    sesion. Se abandona la corrida sin informar nada: el resultado ya no es
    de nadie.
    """
