# Sesión

Aplicación para una consulta de psicoterapia: agenda, pacientes, cobros por sesión,
avisos por SMS, grabación de sesiones, documentación clínica asistida por
IA y el Recorrido longitudinal de cada paciente.

Este documento describe el código de main. No certifica lo que esté desplegado
en release ni la configuración de los proveedores.

## Qué está disponible

| Área | Estado en esta base |
| --- | --- |
| Hoy, Agenda y Cobros | Turnos, cobros, deudas y deshacer un cobro. Alta única, semanal o quincenal; la quincenal avanza 14 días y la serie cubre tres meses. La API informa fechas omitidas por choque. |
| Pacientes | Ficha, notas privadas, vocabulario por paciente, turnos/pagos, sesiones, Recorrido y consentimiento. |
| Configuración y cuenta | Perfil, tarifa, orientación, recordatorio SMS, vocabulario, invitaciones y sesiones revocables. Un campo inválido rechaza el lote de configuración completo. |
| Lupita | Ayuda basada en los archivos de `docs/ayuda/`. El modelo declarado es claude-sonnet-5, en `src/lib/anthropic-mensajes.ts`. Consulta solo nombres, días, horas, duración y modalidad de los turnos de hoy, mañana o esta semana del propio consultorio. No consulta fichas, teléfonos, dinero ni historias clínicas, y no modifica datos. |
| Grabación y subida | Un solo MediaRecorder con pausa y reanudación (`src/components/grabacion/GrabadorSesion.tsx`). Nunca se pega la salida de dos recorders. Lo grabado se mide por los chunks recibidos, no por el reloj (`src/lib/grabacion-captura.ts`). La app no cifra el audio: cada trozo se guarda como Blob en IndexedDB (`src/lib/grabacion-storage.ts`) y el archivo se sube tal cual con PUT prefirmado a R2 (`src/hooks/useGrabacionSesion.ts`: upload-url → PUT → upload-confirmar); viaja por TLS, R2 lo cifra en reposo y se borra al aprobar. El servidor cierra la sesión solo cuando R2 confirma el objeto y guarda en auditoría un diagnóstico del grabador sin contenido clínico. Lo que quedó en el teléfono tras un cierre se puede enviar, no continuar. Límite de 150 minutos de audio. |
| Procesamiento clínico | API con estados explícitos, reclamos con ticket, checkpoint de transcripción y trabajos durables. El worker descarga el archivo, rechaza el que tenga más de una cabecera EBML (grabaciones pegadas), transcribe con AssemblyAI desde memoria, escribe nota y feedback, prepara propuestas del Recorrido y borra el transcript en AssemblyAI. |
| Nota clínica | Revisión, edición y aprobación con confirmación de señales de riesgo y de menciones léxicas («Leí las menciones», exigida también por `src/app/api/_lib/casos-uso/sesion/aprobar.ts`). Volver a escribir, reintentar y eliminar. Para vos con estados y pedido de nuevo. |
| Recorrido | Construido. Al aprobar una nota se encola `integrar_contexto`; el worker devuelve una propuesta que solo se aplica si la profesional la acepta, con o sin ediciones. Cada escritura es una versión nueva; la migración `20260916013000_inmutabilidad` impide cambiar el contenido o borrar versiones. Brief antes de la sesión y gráficos de progreso. |
| Exportación del Recorrido | Hoja de impresión del navegador en `src/app/(impresion)/pacientes/[id]/recorrido/imprimir/`. Pide los datos con `POST /api/pacientes/[id]/hilo/exportar`, que registra `hilo.exportar_pdf` en la misma transacción que lee. Lleva la versión vigente, las que estuvieron vigentes, el historial sin texto de propuestas no adoptadas y los gráficos. El consentimiento 2.1 lo informa. |

## Pendiente o a medias

- **Consentimiento y audio:** el texto del consentimiento todavía promete que el
  audio se cifra en el teléfono, y la app ya no lo hace. Decisión del dueño
  pendiente: `docs/pendientes/consentimiento-sin-cifrado-de-audio.md`.
- **Re-firma:** la API devuelve `sugiereRefirmar`, pero ninguna pantalla lo muestra.
- **Pantalla bloqueada:** el grabador no garantiza seguir capturando con la
  pantalla apagada; pausa y avisa.
- **Borrados externos:** los trabajos de borrado en R2 y AssemblyAI se rinden a
  los 20 intentos (`src/app/api/_lib/casos-uso/trabajos/politica.ts`), y queda
  una ventana entre crear el transcript y registrar su borrado durable.
- **Grabación abandonada:** la transición `abandonar` de
  `src/lib/sesion-clinica/estados.ts` ya tiene un usuario —la confirmación de
  subida la aplica cuando el audio es más corto que el mínimo— pero sigue sin
  haber forma de que la profesional abandone una grabación a mano.
- **Restauración:** todavía no hay acta de ensayo en `docs/operaciones/actas/`;
  la guarda la exige desde el 20 de diciembre de 2026. Las comprobaciones
  pendientes de los respaldos están en `docs/operaciones.md` §4.

## Arquitectura

| Pieza | Implementación |
| --- | --- |
| Frontend/API | Next 16.3.3, React 19, TypeScript, Tailwind 4; versiones resueltas en `package-lock.json`. |
| Identidad | Cookie opaca y revocable, con hash en sesiones_acceso; vence a los 30 días o tras 14 sin uso. Cambiar o restablecer la contraseña cierra todas las sesiones. |
| Datos | Prisma 5.22, Postgres 17; esquema en `prisma/schema.prisma` y ocho migraciones en `prisma/migrations/`. |
| Cifrado de columnas | AES-256-GCM, ENC2 y AAD por fila; extensión de `src/lib/prisma-encryption.ts`. |
| Audio/proceso | Archivo sin cifrar por la app (R2 lo cifra en reposo), worker Python en Railway; AssemblyAI para transcripción y Anthropic para nota, feedback y propuestas del Recorrido. Contrato y límites en `docs/pipeline.md`. |
| SMS/correo | Twilio y Resend. La persistencia del envío vive en envios_sms. Los recordatorios se dispersan de 0 a 14 minutos por turno (`src/lib/recordatorios-programacion.ts`). |
| Crons | `vercel.json`: recordatorios cada 5 minutos, trabajos cada 10, salud cada hora y mantenimiento diario. |
| Entrega y operación | GitHub Actions (CI, backup diario, ensayo mensual de restauración, latido cada 15 minutos, aviso de CI rojo y publicación manual), Vercel, Sentry y backups cifrados en R2; `docs/operaciones.md`. |

Las rutas HTTP validan y llaman a casos de uso en
`src/app/api/_lib/casos-uso/`. Quedan dos excepciones explícitas en
`src/lib/__tests__/rutas-sin-prisma.test.ts`: `cuenta/password` y
`pacientes/[id]/documentacion`. El proxy de `src/proxy.ts` no consulta la base.

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
La suite vacía esa base; no comparte la base de la app. La base tiene que
llamarse `sesion_test`: con cualquier otro nombre la guarda aborta antes de
conectar. El puerto del ejemplo (25433) no protege nada y puede estar ocupado
por otro sistema en tu máquina; revisalo antes de levantar el contenedor. Si hay varias ramas,
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

Para trabajar y entregar cambios, leé `docs/como-trabajamos.md` y `AGENTS.md`.

- `docs/ayuda/`: la ayuda de la profesional y la fuente de Lupita.
- `docs/pipeline.md`: flujo clínico, del audio a la nota y el Recorrido.
- `docs/esquema.md`: catálogo de tablas y columnas.
- `docs/encryption.md`: columnas cifradas, formato y rotación.
- `docs/operaciones.md`: publicación, variables, respaldos, incidentes, SMS y CSP.
- `docs/contrato-finanzas.md`: qué devuelve el tablero y qué significa cada número.
- `docs/contrato-pendientes-historial-cobros.md`: los campos y parámetros
  nuevos de Pendientes, el historial de la ficha y los cobros del mes.
- `docs/contrato-respuestas-api.md`: las dos formas de respuesta y cuál usar.
- `docs/pendientes/`: decisiones abiertas y textos pendientes de integrar al
  glosario. No guarda informes de entrega: la historia está en Git.

Privado.
