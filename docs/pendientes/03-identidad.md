# Identidad y consentimiento: lo que sigue abierto

- **Consolas (sólo el dueño):** verificar en Vercel que no queden variables
  retiradas (`AUTH_SECRET`, `AUTH_URL`, la clave ENC1) y en Anthropic la
  configuración de retención. La fecha que informa el consentimiento es la
  verificación del 4 de septiembre de 2026.

Decisiones tomadas, sin acción pendiente: el texto "Origen no permitido" queda
literal en `src/proxy.ts` (el proxy no importa el glosario); la enumeración de
emails con invitación válida y la confianza en `x-forwarded-for` se aceptaron.
