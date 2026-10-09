# Lux: lo que queda abierto después de integrar

Cerrado en la integración (rama `lux`): los textos de la pestaña están en el
glosario; los máximos de la pantalla salen del contrato
(`src/lib/lux/contrato.ts`) y coinciden con la ruta; el consentimiento lo
decidió el dueño (la autorización 2.8 cubre a Lux, dicho en la ayuda 12).

De producto, sin decidir:

- **Probado con Anthropic de verdad (9 de octubre).** Una corrida contra
  Haiku 5.5 con una paciente inventada: apertura, una pregunta que obliga a
  abrir una transcripción vieja y una segunda pregunta en la misma charla. El
  modelo que contestó fue `claude-haiku-5-5` en las cinco rondas; la segunda
  pregunta leyó del caché (3895 tokens por ronda); la auditoría quedó con
  `lux.abrir`, `lux.pregunta` y cada `sesion.ver_transcripcion` con
  `via: "lux"`; las tres llamadas costaron unos US$ 0,004. Lo que salió mal:
  - **RESUELTO — GRAVE: Lux negaba haber leído lo que leyó.** En la tercera
    llamada decía "No abrí la transcripción del 04/08… las citas que puse no
    salen de ningún documento", aunque la había abierto (ronda con
    `tool_use`, auditoría de 506 caracteres) y las citas eran exactas.
    Primero se creyó que era el historial recortado (la pantalla mandaba
    sólo la prosa): mandarlo entero (cfb3ed5) no alcanzó, porque la causa
    real era otra. El servidor rearma cada llamada con el material base, que
    sólo trae las dos transcripciones más recientes; lo leído con la
    herramienta no vuelve, y el prompt le pide no afirmar lo que no puede
    anclar. Con sus citas del 04/08 sin la fuente delante, concluía que las
    había inventado. Arreglo: cada línea "(mirando la transcripción del
    DD/MM)" de los turnos de Lux en el historial trae esa transcripción de
    vuelta al material, auditada ("leída en esta conversación", punto 5 de
    `docs/contrato-lux.md`), y el prompt dice que esas líneas significan que
    la leyó y que, si no la tiene delante, la vuelva a abrir sin decir que
    inventó.
  - **`<citas>` no llega primero.** En la apertura va después de un párrafo;
    en la segunda, después de una frase y de la línea de transcripción. El
    parser de la pantalla lo pliega igual. La tercera respuesta no trae
    `<citas>` aunque cita frases entre comillas.
- **Lupita en Haiku 5.5 (9 de octubre).** Una pregunta real a `/api/ayuda`:
  contestó 492 caracteres, sin razonamiento (0 tokens de thinking), 219 de
  salida con el techo de 1024. Escribió 61.506 tokens de caché en la primera
  pregunta (US$ 0,008, el doble que las tres llamadas de Lux).
- **Las notas que Lux lee no quedan auditadas una por una.** Cada
  transcripción deja `sesion.ver_transcripcion` con `via: "lux"`; las notas
  sólo cuentan en el detalle de `lux.abrir` / `lux.pregunta` (`notas: N`). La
  autorización promete rastro "cada vez que abre tu nota": decidir si leerla
  para Lux cuenta como abrirla.
- **Lupita en el celular.** La prueba de arriba fue una sola pregunta: falta
  ver en el teléfono que ninguna respuesta llegue vacía.
- **"Ver en qué me baso" es texto.** Las citas dicen sesión, fecha y frase,
  pero no llevan a la nota: un enlace a la sesión citada sería el paso
  siguiente si ella lo pide.
