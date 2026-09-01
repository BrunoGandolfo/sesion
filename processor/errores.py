"""
Excepciones del pipeline.

PipelineError lleva un codigo tecnico corto (asr_error, llm_truncado, ...) y
un mensaje publico apto para el callback y los logs: nunca contiene texto de
transcripcion, nota clinica, claves ni cuerpos de respuesta de proveedores.
"""


class PipelineError(Exception):
    def __init__(self, codigo: str, mensaje_publico: str):
        self.codigo = codigo
        self.mensaje_publico = mensaje_publico
        super().__init__(f"{codigo}: {mensaje_publico}")
