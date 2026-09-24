# Identidad y consentimiento: lo que sigue abierto

- **Consentimiento y audio:** el texto todavía promete cifrado del audio en el
  teléfono y la app ya no lo hace. Es la misma decisión que
  `consentimiento-sin-cifrado-de-audio.md`; se resuelve ahí.
- **Re-firma:** la API devuelve `sugiereRefirmar` para firmas de versiones
  anteriores, pero ninguna pantalla lo muestra. `CONSENTIMIENTO_NUEVO_TEXTO`
  está en el glosario sin uso. Las firmas anteriores siguen válidas; no se
  deben bloquear.
- **Rutas con Prisma directo:** `cuenta/password` y
  `pacientes/[id]/documentacion` siguen como excepciones en
  `src/lib/__tests__/rutas-sin-prisma.test.ts`. Hay que pasarlas a casos de uso
  y sacarlas de la lista.
- **Consolas (sólo el dueño):** verificar en Vercel que no queden variables
  retiradas (`AUTH_SECRET`, `AUTH_URL`, la clave ENC1) y en Anthropic la
  configuración de retención. La fecha que informa el consentimiento es la
  verificación del 4 de septiembre de 2026.

Decisiones tomadas, sin acción pendiente: el texto "Origen no permitido" queda
literal en `src/proxy.ts` (el proxy no importa el glosario); la enumeración de
emails con invitación válida y la confianza en `x-forwarded-for` se aceptaron.
