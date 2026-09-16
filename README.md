# Sesión

Aplicación para una consulta de psicoterapia: agenda, pacientes, cobros por sesión,
avisos por SMS, grabación cifrada de sesiones, documentación clínica asistida por
IA y el Recorrido longitudinal de cada paciente.

Estado documentado: **main 1667576, 16 de septiembre de 2026**. Según el dueño,
el sitio está desplegado con una cuenta y datos de prueba. Este documento describe
el código de esa base; no certifica lo que esté desplegado en release ni la
configuración de los proveedores.

## Qué está disponible

| Área | Estado en esta base |
| --- | --- |
| Hoy, Agenda y Cobros | Turnos, cobros, deudas y deshacer un cobro. Alta única, semanal o quincenal; la quincenal avanza 14 días y la serie cubre tres meses. La API informa fechas omitidas por choque. |
| Pacientes | Ficha, notas privadas, vocabulario por paciente, turnos/pagos, sesiones, Recorrido y consentimiento. |
| Configuración y cuenta | Perfil, tarifa, orientación, recordatorio SMS, vocabulario, invitaciones y sesiones revocables. Un campo inválido rechaza el lote de configuración completo. |
| Lupita | Ayuda basada en los archivos de `docs/ayuda/`. El modelo declarado es claude-sonnet-5, en `src/lib/anthropic-mensajes.ts`. No consulta historias clínicas ni administra la agenda por conversación. |
| Grabación y subida | Construida. La captura corta segmentos de 60 s con 1 s de solape (`src/lib/audio/contrato.ts`), los cifra con AES-GCM en el navegador antes de guardarlos en IndexedDB (`src/lib/audio/grabadora.ts`, `src/lib/audio/cifrado.ts`) y sube cada uno con PUT prefirmado a R2 mientras se graba (`src/lib/audio/sincronizar.ts`). Recupera lo guardado tras un cierre, bloquea dos pestañas sobre la misma grabación y no reemplaza una copia existente. Límite de 150 minutos. |
| Procesamiento clínico | API con estados explícitos, reclamos con ticket, checkpoint de transcripción y trabajos durables. El worker descarga y verifica los segmentos, los une, transcribe con AssemblyAI, escribe nota y feedback, prepara propuestas del Recorrido y borra el transcript en AssemblyAI. |
| Nota clínica | Revisión, edición y aprobación con confirmación de señales de riesgo y de menciones léxicas («Leí las menciones», exigida también por `src/app/api/_lib/casos-uso/sesion/aprobar.ts`). Volver a escribir, reintentar y eliminar. Para vos con estados y pedido de nuevo. |
| Recorrido | Construido. Al aprobar una nota se encola `integrar_contexto`; el worker devuelve una propuesta que solo se aplica si la profesional la acepta, con o sin ediciones. Cada escritura es una versión nueva; la migración `20260916013000_inmutabilidad` impide cambiar el contenido o borrar versiones. Brief antes de la sesión y gráficos de progreso. |
| Exportación del Recorrido | Hoja de impresión del navegador en `src/app/(impresion)/pacientes/[id]/recorrido/imprimir/`. Pide los datos con `POST /api/pacientes/[id]/hilo/exportar`, que registra `hilo.exportar_pdf` en la misma transacción que lee. Lleva la versión vigente, las que estuvieron vigentes, el historial sin texto de propuestas no adoptadas y los gráficos. El consentimiento 2.1 lo informa. |

## Pendiente o a medias

- **Retención de respaldos:** `.github/workflows/backup.yml` conserva diarios 30
  días y mensuales 12 meses; el consentimiento solo menciona 30 días.
- **Descifrado en el worker:** el consentimiento dice que el audio se descifra
  «solo en memoria», pero `processor/audio_entrada.py` usa archivos temporales en
  disco para unir los segmentos.
- **Pantalla de entrada:** el texto de confidencialidad de `src/lib/glosario.ts`
  todavía dice que la copia local previa no está cifrada.
- **Re-firma:** la API devuelve `sugiereRefirmar`, pero ninguna pantalla lo muestra.
- **Copia local:** los segmentos cifrados quedan en IndexedDB después de
  entregados; la app no los borra.
- **Borrados externos:** los trabajos de borrado en R2 y AssemblyAI se rinden a
  los 20 intentos (`src/app/api/_lib/casos-uso/trabajos/politica.ts`), y queda
  una ventana entre crear el transcript y registrar su borrado durable.
- **Transcripción:** existe la ruta de lectura auditada, pero ninguna pantalla
  la ofrece.
- **Grabación abandonada:** las transiciones `abandonar` de
  `src/lib/sesion-clinica/estados.ts` no las usa ningún caso de uso.
- **Hoy:** cobrar desde la fila un turno programado con la hora pasada registra
  el cobro, pero la pantalla no se actualiza.
- **Restauración:** todavía no hay acta de ensayo en `docs/operaciones/actas/`;
  la guarda la exige desde el 20 de diciembre de 2026.

## Arquitectura

| Pieza | Implementación |
| --- | --- |
| Frontend/API | Next 16.3.3, React 19, TypeScript, Tailwind 4; versiones resueltas en `package-lock.json`. |
| Identidad | Cookie opaca y revocable, con hash en sesiones_acceso; vence a los 30 días o tras 14 sin uso. Cambiar o restablecer la contraseña cierra todas las sesiones. |
| Datos | Prisma 5.22, Postgres 17; esquema en `prisma/schema.prisma` y tres migraciones en `prisma/migrations/`. |
| Cifrado de columnas | AES-256-GCM, ENC2 y AAD por fila; extensión de `src/lib/prisma-encryption.ts`. |
| Audio/proceso | Segmentos cifrados en el navegador, R2 y worker Python en Railway; AssemblyAI para transcripción y Anthropic para nota, feedback y propuestas del Recorrido. Contrato y límites en `docs/pipeline.md`. |
| SMS/correo | Twilio y Resend. La persistencia del envío vive en envios_sms. Los recordatorios se dispersan de 0 a 14 minutos por turno (`src/lib/recordatorios-programacion.ts`). |
| Crons | `vercel.json`: recordatorios cada 5 minutos, trabajos cada 10, salud cada hora y mantenimiento diario. |
| Entrega y operación | GitHub Actions (CI, backup diario, ensayo mensual de restauración, latido cada 15 minutos, aviso de CI rojo y publicación manual), Vercel, Sentry y backups cifrados en R2; `docs/operaciones.md`. |

Las rutas HTTP validan y llaman a casos de uso en
`src/app/api/_lib/casos-uso/`. Quedan tres excepciones explícitas en
`src/lib/__tests__/rutas-sin-prisma.test.ts`; no se afirma que la migración
de todas las rutas ya terminó. El proxy de `src/proxy.ts` no consulta la base.

## Arranque local con datos de prueba

Requisitos: Node 22 (`package.json` pide la rama 22; `prisma/seed.ts` se corre
sin flags desde 22.18), npm y Docker con Postgres 17. En una copia propia del
repositorio:

~~~bash
npm ci
cp .env.example .env
~~~

Completá `DATABASE_URL` con una base local exclusiva y `CLAVES_CIFRADO`
con una clave de prueba de 32 bytes en base64, formato 1=clave. No uses la base
de una persona ni la misma que vacía la suite de integración.

~~~bash
npx prisma migrate deploy
node --env-file=.env prisma/seed.ts
npm run dev -- -p 3001
~~~

El seed crea una organización, una cuenta, tres pacientes, ocho turnos, una serie
y dos SMS pendientes. La cuenta y la contraseña de prueba están en
`prisma/seed.ts`; el seed no crea contenido clínico. Sin credenciales de proveedores
podés probar agenda y formularios. Para Lupita hace falta `ANTHROPIC_API_KEY`.
Los tests locales no necesitan enviar SMS ni correos.

El catálogo es `.env.example`: distingue la app de los secretos de Actions
y de la base de test. El worker tiene su propio `processor/.env.example`;
su configuración efectiva está en `processor/config.py`.

## Verificación

~~~bash
cp .env.test.example .env.test
npm run db:test:up
npx tsc --noEmit
npm run lint
npm run test:unit
npm run test:integration
npm run guardias
~~~

`DATABASE_URL_TEST` debe apuntar al Postgres exclusivo de integración.
La suite vacía esa base; no comparte la base de la app. Si hay varias ramas,
asigná un contenedor y un puerto distintos a cada una. En CI se crea un
Postgres 17 efímero por corrida y se corre `npm test`, que junta las dos suites.
La única guarda de conexión está en `src/lib/__tests__/db-test.ts`;
`src/lib/__tests__/base-identidad.ts` la reexporta.

Chequeo documental de una línea desde la raíz:

~~~bash
node scripts/ci/documentacion-vigente.mjs
~~~

Comprueba rutas de archivos, enlaces locales, métodos/rutas HTTP citados como
vigentes y variables de entorno citadas contra `.env.example`; también corre
dentro de `npm test`. No prueba el despliegue, proveedores, micrófono ni que una
promesa de producto ya esté cumplida.

## Trabajo y documentación

Leé `docs/como-trabajamos.md`, `docs/esquema.md` y `AGENTS.md`.
Se trabaja en ramas propias; main es la integración y release es la publicación.
Sin PR. El CI verde por sí solo no sustituye la prueba del dueño en teléfono.

- `docs/ayuda/`: la ayuda de la profesional y la fuente de Lupita.
- `docs/pipeline.md`: contrato clínico existente y partes pendientes.
- `docs/encryption.md`: columnas, formato y rotación.
- `docs/operaciones.md`: despliegue, alertas, backup y diagnóstico.
- `docs/pendientes/`: decisiones y textos pendientes de integración.

Privado.
