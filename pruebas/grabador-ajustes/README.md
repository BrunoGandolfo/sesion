# Grabación real contra la app local

`verificar.mjs` graba en Chromium con micrófono falso contra `next dev` y un
Postgres local, y mira la base:

- **A.** Una grabación con una pausa y un cambio de pestaña deja en
  `eventos_auditoria.detalle` un `diagnostico` con esos eventos, sin texto
  libre (líneas `hora tipo [ms]`, tipos de la lista cerrada).
- **B.** Una grabación de 3 segundos no pide `upload-url`, no hace PUT, no
  crea trabajo ni auditoría de subida; la sesión queda en `grabando` y el
  mismo turno graba de nuevo y llega a `procesando` sin dejar otra sesión.

R2 no existe en local y `src/lib/r2.ts` no se puede apuntar a otro lado. El
guion levanta un S3 falso; el PUT del navegador se lo entrega `context.route`
de Playwright, y el HeadObject del servidor llega por
`r2-falso-preload.cjs` (un `--require` que sólo desvía
`*.r2.cloudflarestorage.com`). Las credenciales de R2 son inventadas: nada
sale a Cloudflare. Todo lo demás —login, consentimiento, rutas, casos de uso,
auditoría, base— es la app de verdad.

## Cómo

Postgres 17 local con una base `sesion_e2e_*` (el guion se niega a otra cosa),
y un `.env` con `DATABASE_URL`, la clave de desarrollo de `prisma/seed.ts` en
`CLAVES_CIFRADO`, y R2 inventado: `R2_ACCOUNT_ID=cuentafalsa`,
`R2_ACCESS_KEY_ID=falsa`, `R2_SECRET_ACCESS_KEY=falsa`,
`R2_BUCKET_NAME=sesion-audio`,
`R2_PUBLIC_HOST=https://sesion-audio.cuentafalsa.r2.cloudflarestorage.com`,
`R2_FALSO_URL=http://127.0.0.1:4599`.

    npx prisma migrate deploy
    node --env-file=.env prisma/seed.ts
    NODE_OPTIONS="--require $PWD/pruebas/grabador-ajustes/r2-falso-preload.cjs" npm run dev -- --port 3137
    node --env-file=.env pruebas/grabador-ajustes/verificar.mjs --url=http://localhost:3137

## Evidencia (19/09/2026, Chromium 145 headless, WSL2)

    "detalle": {
      "ok": true, "bytes": 236853, "duracionAudioSeg": 15,
      "diagnosticoChunks": 16, "diagnosticoBytes": 236853, "diagnosticoEventos": 6,
      "diagnostico": [
        "2026-09-19T21:47:06.370Z wakelock-rechazado",
        "2026-09-19T21:47:12.500Z pausa",
        "2026-09-19T21:47:14.534Z reanudar",
        "2026-09-19T21:47:16.583Z oculta",
        "2026-09-19T21:47:16.004Z visible",
        "2026-09-19T21:47:16.005Z wakelock-rechazado" ] }

`visible` aparece medio segundo ANTES que `oculta` aunque pasaron dos segundos
entre uno y otro: es el reloj de pared de WSL2, que retrocede ~2,4 s cada 30 s
(ya visto en `pruebas/grabador-dhh`). El orden de la lista es el real.

B: pedidos a la API durante los 3 segundos: `POST /api/turnos`,
`GET` y `POST /api/sesion-clinica`. Ningún `upload-*`, 0 PUT, 0 trabajos, 0
auditorías de subida; sesión en `grabando`. Regrabando 12 s en la misma
pantalla: la misma sesión pasa a `procesando` y no queda ninguna otra.

## Qué no cubre

Un teléfono de verdad, el bloqueo de pantalla y R2 real (CORS incluido).
