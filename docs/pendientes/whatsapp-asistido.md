# WhatsApp asistido — textos pendientes de integrar

Rama `whatsapp-asistido-api` (lado servidor). Lo que aparece en pantalla y no
pasó por `glosario.ts` (no se toca en paralelo):

- `MOTIVO_CANAL_WHATSAPP` = "el recordatorio va por WhatsApp, no por SMS"
  (`src/app/api/_lib/casos-uso/envios-del-turno.ts`). Es el
  `motivo_no_envio` del SMS que el cron cancela con canal `whatsapp`; lo
  muestra el detalle del turno junto a los demás motivos. Al integrar,
  moverlo junto a `MOTIVO_TURNO_CERRADO` y compañía en `glosario.ts`.
- La ayuda (`docs/ayuda/**`) no dice todavía que existe el canal ni qué
  significa "avisado" (abrió el enlace; la app no ve si el mensaje salió).
