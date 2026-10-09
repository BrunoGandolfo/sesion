# Lux: lo que queda abierto después de la rama lux-ui

- **Textos al glosario:** los textos de la pestaña viven en
  `src/components/lux/textos.ts` porque `src/lib/glosario.ts` no se toca en
  paralelo. Al integrar se mudan al glosario (`LUX`, `LUX_*`, `luxSaludo`,
  `luxQueLee`, `luxMirando`, `nombreDePila`) y `textos.ts` queda como
  re-export, como `graficos/textos.ts`.
- **Contrato con la ruta:** la pantalla manda `pregunta` de hasta 600
  caracteres (como la ayuda), hasta 12 turnos de historial y cada turno
  recortado a 4000. El historial lleva lo que Lux dijo sin `<citas>` ni las
  líneas de transcripción. Si `POST /api/pacientes/{id}/lux` valida otros
  máximos, alinear `use-conversacion-lux.ts`.
- **Consentimiento:** la ayuda (`12`, `16`) dice que con Lux viajan a
  Anthropic el Recorrido, las notas y las transcripciones que mira. Falta
  decidir si el texto de la autorización (2.8) cubre ese uso o hace falta una
  versión nueva.
