# Pendientes que deja el área 3 (identidad, cifrado y legal)

Fecha: 14 de septiembre de 2026. Rama `f3-identidad`. Lo que esta área no
tocó por barrera (sesión clínica, SMS, CI, formularios, esquema,
`glosario.ts`, `docs/ayuda`) y necesita que alguien más lo haga, más los
textos nuevos que deberían vivir en el glosario.

## 1. Textos nuevos para `src/lib/glosario.ts` (dueño del glosario)

Hoy están como constantes locales en los componentes que los usan. Mover al
glosario y reemplazar la constante local por el import.

`src/app/(dashboard)/config/_components/config-view.tsx`:

| Constante local | Texto |
| --- | --- |
| `PASSWORD_AVISO_CIERRE` | "Al cambiarla te vamos a pedir que entres de nuevo en todos tus dispositivos, este incluido." |
| `PASSWORD_CAMBIADA_REINGRESO` | "Contraseña cambiada. Entrá de nuevo." |
| `OTRAS_SESIONES_BOTON` | "Cerrar sesión en los demás dispositivos" |
| `OTRAS_SESIONES_DESCRIPCION` | "Si perdiste un teléfono o entraste desde una computadora ajena, esto cierra todas las demás sesiones. Esta sigue abierta." |
| `OTRAS_SESIONES_CERRANDO` | "Cerrando…" |
| (función) | "No había otras sesiones abiertas." / "Cerramos 1 sesión en otro dispositivo." / "Cerramos N sesiones en otros dispositivos." |

`src/app/(auth)/login/page.tsx`: aviso con `?aviso=password-cambiada`:
"Cambiaste la contraseña: entrá de nuevo en todos tus dispositivos."

Mensajes de las rutas de cuenta (hoy literales en `src/app/api/cuenta/*` y
`casos-uso/registrar-cuenta.ts`):

- "No podés invitar desde esta cuenta." (403)
- "Ya tenés 2 invitaciones vigentes. Esperá a que se usen o venzan." (429; el
  número sale de `MAX_INVITACIONES_VIGENTES`)
- "La contraseña actual no es correcta" (400)
- "No se pudo procesar el cambio de contraseña en este momento. Probá de nuevo." (503)
- "No pudimos procesar la entrada en este momento. Probá de nuevo." (503)
- "Origen no permitido" (403, lo contesta el proxy a un POST cross-site)

Texto de la pantalla de configuración sobre la contraseña: el viejo "No te
vamos a cerrar la sesión en este dispositivo" ya no es cierto y fue
reemplazado por `PASSWORD_AVISO_CIERRE`.

## 2. `vercel.json` (área 5 / CI)

Sumar el cron de mantenimiento. La ruta ya existe y exige `CRON_SECRET`:

```json
{ "path": "/api/cron/mantenimiento", "schedule": "0 4 * * *" }
```

Y en CI: `CLAVES_CIFRADO="1=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="` (32
bytes en cero) reemplaza a `NOTES_ENCRYPTION_KEY`; `AUTH_SECRET` y
`AUTH_URL` se retiran de Vercel y de CI. `PROCESSING_SECRET` y `CRON_SECRET`
aceptan lista separada por comas.

## 3. Proxy: rutas del worker y CSRF fuera del matcher (áreas 2 y 4)

El matcher de `src/proxy.ts` excluye las rutas de máquina a máquina que el
diseño nuevo nombra (`api/sesion-clinica/pendientes`,
`api/sesion-clinica/[id]/{lease,asr,resultado,transcripcion}`,
`api/trabajos/**`, `api/pacientes/[id]/hilo`). Toda ruta que el worker
llame tiene que estar en esa lista: si no, el proxy la redirige a `/login`
por no traer cookie. La ruta vieja `api/sesion-clinica/callback` NO está
excluida a propósito: desaparece con el contrato nuevo.

Contrapartida: el chequeo de `Origin` contra CSRF lo hace el proxy, así que
una ruta EXCLUIDA del matcher que acepte sesión de usuaria para un método
distinto de GET tiene que verificarlo ella misma con `esOrigenPropio` de
`@/lib/sesion-cookie` (hoy `api/pacientes/[id]/hilo` decide entre ticket y
sesión: si acepta PATCH con sesión, va ahí). `SameSite=Lax` sigue siendo la
primera capa.

## 4. Tests de otras áreas que rompió el cifrado v2

Importan `__resetKeyCacheForTests` de `@/lib/encryption`, que ya no existe.
El reemplazo es `__resetLlaveroForTests` de `@/lib/llavero` con
`process.env.CLAVES_CIFRADO = "1=<base64>"` (ver
`src/lib/__tests__/base-identidad.ts`, `CLAVES_CIFRADO_TEST`):

`casos-uso-recordatorios`, `casos-uso-sesion`, `casos-uso-worker`,
`cobrar-turno`, `config-contrato`, `contexto-clinico`, `multi-tenant`,
`pendientes-terapeuta`, `solapamiento-turnos`, `turno-recordatorios`.

`src/app/api/_lib/contexto-clinico/actualizar.ts` importa `cifrarContexto`,
que no existe: el contexto pasó a `hilo_versiones` y se escribe con
`cifrarHiloVersion(id, { contenido })` (área 2/4).

## 5. Documentación de otras áreas

- `docs/pipeline.md` nombra `NOTES_ENCRYPTION_KEY`: es `CLAVES_CIFRADO`.
- `docs/ayuda/12-camino-del-audio-y-privacidad.md` (Lupita) no puede
  contradecir el consentimiento 2.0: el vocabulario con nombres viaja a
  AssemblyAI; el borrado en AssemblyAI y en R2 son trabajos durables con
  reintento; el audio se cifra en el teléfono por tramos; los backups
  duran 30 días y pueden contener la clave cifrada de un audio no aprobado.
  `ayuda-vigente.test.ts` puede importar las constantes de
  `src/lib/consentimiento-hechos.ts`.

## 6. Promesas del consentimiento 2.0 que dependen de otras áreas

Cada constante de `src/lib/consentimiento-hechos.ts` es una afirmación que
la paciente firma. Si el área responsable no la cumple, la constante pasa a
`false` y el texto cambia solo (y `consentimiento.test.ts` lo exige):

| Constante | Quién la hace verdadera |
| --- | --- |
| `RESPALDO_LOCAL_CIFRADO = true` (el audio se cifra en el teléfono por tramos, no queda audio en claro) | Área 1 (grabación) |
| `ASR_BORRADO_CON_REINTENTO = true` (trabajo `borrar_transcript_asr` hasta confirmación) | Áreas 2 y 4 |
| `LIMPIEZA_AUDIO_REINTENTA = true` (trabajo `borrar_audio_r2`; la clave se destruye al aprobar) | Área 2 |
| `ANTHROPIC_RETENCION_VERIFICADA_EL` | El dueño renueva la fecha a mano al revisar la consola |
| `RETENCION_BACKUPS_DIAS = 30` | Área 5 (`backup.yml`) |

## 7. Ficha de paciente: sugerir re-firma (área de formularios)

`GET /api/pacientes/{id}/consentimiento` devuelve `sugiereRefirmar: true`
cuando la firma vigente es de una versión anterior a la 2.0. Las firmas 1.1
siguen vigentes (decisión del dueño): la ficha debería mostrar "hay un texto
nuevo, sugerí firmarlo en la próxima sesión", no bloquear la grabación.

## 8. Auditoría de Codex (14-09-2026): lo que queda abierto

Codex auditó las rutas de cuenta, el proxy, el cifrado y el mantenimiento
como atacante. Confirmó cinco cosas; tres se cerraron en la rama (login y
cambio de contraseña se excluyen por lock por usuaria; el cambio se escribe
con compare-and-set sobre el hash verificado; el tope de invitaciones cuenta
y crea bajo lock). Quedan dos, de severidad baja:

1. **Logout CSRF por `/login?sesion=x`** (formularios). La pantalla de
   entrada, al llegar con `?sesion=`, hace `POST /api/cuenta/salir`; una
   navegación inducida a esa URL cierra una sesión viva. Ya existe
   `POST /api/cuenta/limpiar`, que borra la cookie SOLO si no resuelve a una
   sesión viva. El arreglo es una línea en `src/app/(auth)/login/page.tsx`:
   en el `useEffect` de `sesionVencida`, llamar a `/api/cuenta/limpiar` en
   vez de `/api/cuenta/salir`.
2. **Enumeración de emails con una invitación válida** (aceptado). Quien
   tiene una invitación puede probar un registro con un email y distinguir
   "ya existe" (400) de "libre" (201, y consume la invitación). Las
   invitaciones las crean solo las cuentas de `INVITACIONES_PERMITIDAS`, hay
   dos vigentes como mucho y quien las recibe es una colega: se acepta.
   Cerrarlo de verdad exige verificación del correo antes del alta (otro
   diseño).

Dudas que dejó y no se resolvieron en código: `x-forwarded-for` se confía
tal cual (en Vercel lo pone la plataforma); `INVITACIONES_PERMITIDAS` solo
debe listar cuentas ya creadas (documentado en `.env.example`).

## 9. Cómo correr los tests de integración del área

La rama `test` de Neon es compartida entre agentes y produce deadlocks y
violaciones de clave foránea ajenas; Neon queda solo para producción. Los
tests del área (`login-atomico`, `password-atomico`, `registro-atomico`,
`recuperacion-atomica`, `prisma-encryption` con el mantenimiento: 66 casos)
pasan limpios contra un Postgres 17 propio:

```sh
docker run -d --name pg-sesion -p 0:5432 -e POSTGRES_PASSWORD=test postgres:17
PUERTO=$(docker port pg-sesion 5432 | head -1 | sed 's/.*://')
URL="postgresql://postgres:test@localhost:$PUERTO/postgres"
DATABASE_URL="$URL" npx prisma migrate deploy
DATABASE_URL_TEST="$URL" npm run test:integration
```

`base-identidad.ts` acepta `localhost` como host de test. Verificado el
14-09-2026: 5 archivos, 66 tests, 7 s.
