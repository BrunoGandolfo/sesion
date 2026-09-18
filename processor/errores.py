"""
Excepciones del pipeline.

PipelineError lleva un codigo tecnico corto (asr_error, llm_truncado, ...) y
un mensaje publico apto para el resultado y los logs: nunca contiene texto de
transcripcion, nota clinica, claves ni cuerpos de respuesta de proveedores.

Cada fallo es TRANSITORIO o DEFINITIVO, y lo decide el worker (la app solo
aplica su politica: un transitorio vuelve a la cola con backoff y se agota a
los MAX fallos seguidos; un definitivo deja la sesion en `fallida` hasta que
la profesional reintente o elimine). Se puede fijar por excepcion
(`definitivo=`) o dejar que lo decida el codigo: los de CODIGOS_DEFINITIVOS
no se arreglan solos con el tiempo (audio que no se puede abrir, respuesta
del modelo con forma invalida dos veces), el resto si puede (red, timeouts,
5xx de un proveedor, error interno).
"""

CODIGOS_DEFINITIVOS = frozenset(
    {
        "audio_sin_clave",
        "descifrado_error",
        "asr_vacio",
        "asr_rechazado",
        "llm_invalido",
        "llm_truncado",
        "checkpoint_invalido",
    }
)


class PipelineError(Exception):
    def __init__(self, codigo: str, mensaje_publico: str, definitivo: bool | None = None):
        self.codigo = codigo
        self.mensaje_publico = mensaje_publico
        self._definitivo = definitivo
        super().__init__(f"{codigo}: {mensaje_publico}")

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
