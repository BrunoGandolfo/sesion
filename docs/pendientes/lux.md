# Lux: lo que queda abierto después de integrar

Cerrado en la integración (rama `lux`): los textos de la pestaña están en el
glosario; los máximos de la pantalla salen del contrato
(`src/lib/lux/contrato.ts`) y coinciden con la ruta; el consentimiento lo
decidió el dueño (la autorización 2.8 cubre a Lux, dicho en la ayuda 12).

De producto, sin decidir:

- **Probar con Anthropic de verdad.** Ningún test llama al proveedor: falta
  ver con una clave real que Haiku 5.5 respete el prompt (el bloque
  `<citas>` primero, el aviso antes de abrir una transcripción, el riesgo
  nombrado primero) y que la segunda pregunta lea el material del caché
  (`cacheLeido` en `lux.pregunta`).
- **Las notas que Lux lee no quedan auditadas una por una.** Cada
  transcripción deja `sesion.ver_transcripcion` con `via: "lux"`; las notas
  sólo cuentan en el detalle de `lux.abrir` / `lux.pregunta` (`notas: N`). La
  autorización promete rastro "cada vez que abre tu nota": decidir si leerla
  para Lux cuenta como abrirla.
- **Lupita en Haiku 5.5.** Sigue con su techo de 1024 tokens y el
  razonamiento por defecto del modelo; probar en el celular que ninguna
  respuesta llegue vacía.
- **"Ver en qué me baso" es texto.** Las citas dicen sesión, fecha y frase,
  pero no llevan a la nota: un enlace a la sesión citada sería el paso
  siguiente si ella lo pide.
