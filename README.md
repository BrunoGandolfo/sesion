# Sesión

Aplicación para una consulta de psicoterapia: agenda, pacientes, cobros por sesión,
avisos por SMS y documentación clínica asistida por IA.

Estado documentado: **main e247d8b, 15 de septiembre de 2026**. Según el dueño,
el sitio está desplegado con una cuenta y datos de prueba. Este documento describe
el código de esa base; no certifica lo que esté desplegado en release ni la
configuración de los proveedores.

## Qué está disponible y qué falta

| Área | Estado en esta base |
| --- | --- |
| Hoy, Agenda y Cobros | Turnos, cobros y deudas. Alta única, semanal o quincenal; la quincenal avanza 14 días. La API informa fechas omitidas por choque. |
| Pacientes | Ficha, notas privadas, turnos/pagos, sesiones y consentimiento. Algunas vistas clínicas todavía dependen de la reconstrucción del Recorrido. |
| Configuración y cuenta | Perfil, tarifa, orientación, SMS, vocabulario, invitaciones y sesiones revocables. Un campo inválido rechaza el lote de configuración completo. |
| Lupita | Ayuda basada en los archivos de `docs/ayuda/`. El modelo declarado es claude-sonnet-5, en `src/lib/anthropic-mensajes.ts`. No consulta historias clínicas ni administra la agenda por conversación. |
| Procesamiento clínico | API con estados explícitos, reclamos con ticket, checkpoint de transcripción y trabajos durables. El worker implementa nota y feedback. |
| Grabación y subida | Reconstrucción pendiente: siguen consumidores de rutas de subida eliminadas. No hay un recorrido nuevo completo desde micrófono hasta nota en esta base. |
| Recorrido | Reconstrucción pendiente: faltan sus rutas nuevas y el ejecutor de integración longitudinal. Aprobar crea el trabajo, pero eso no significa que el Recorrido se actualice. |

Las bajas y dependencias están en `docs/pendientes/cierre-ola-1.md`.
Las ramas de Fase 4 se revisan y fusionan por separado; este README no las da por
incorporadas a main.

Hay dos diferencias que impiden presentar el consentimiento 2.0 como una
descripción ya cumplida: el respaldo local existente todavía conserva fragmentos
sin cifrar durante la captura, y el backup mensual conserva copias hasta 366 días
aunque el consentimiento sólo menciona 30. Detalles en `docs/pipeline.md`,
`docs/encryption.md` y `docs/operaciones.md`.

## Arquitectura

| Pieza | Implementación |
| --- | --- |
| Frontend/API | Next 16.3.3, React 19, TypeScript, Tailwind 4; versiones resueltas en `package-lock.json`. |
| Identidad | Cookie opaca y revocable, con hash en sesiones_acceso. Cambiar o restablecer la contraseña cierra todas las sesiones. |
| Datos | Prisma 5.22, Postgres 17; esquema en `prisma/schema.prisma`, migración inicial en `prisma/migrations/0_init/migration.sql`. |
| Cifrado de columnas | AES-256-GCM, ENC2 y AAD por fila; extensión de `src/lib/prisma-encryption.ts`. |
| Audio/proceso | R2 y worker Python en Railway; AssemblyAI para transcripción y Anthropic para nota/feedback. Contrato y límites en `docs/pipeline.md`. |
| SMS/correo | Twilio y Resend. La persistencia del envío vive en envios_sms. |
| Entrega y operación | GitHub Actions, Vercel y backups cifrados en R2; `docs/operaciones.md`. |

Las rutas HTTP validan y llaman a casos de uso en
`src/app/api/_lib/casos-uso/`. Quedan cinco excepciones explícitas en
`src/lib/__tests__/rutas-sin-prisma.test.ts`; no se afirma que la migración
de todas las rutas ya terminó. El proxy de `src/proxy.ts` no consulta la base.

## Arranque local con datos de prueba

Requisitos: Node 22.18 o posterior de la rama 22, npm y Docker con Postgres 17.
En una copia propia del repositorio:

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
~~~

`DATABASE_URL_TEST` debe apuntar al Postgres exclusivo de integración.
La suite vacía esa base; no comparte la base de la app. Si hay varias ramas,
asigná un contenedor y un puerto distintos a cada una. En CI se crea un
Postgres 17 efímero por corrida. Los helpers actuales de conexión son
`src/lib/__tests__/db-test.ts` y `src/lib/__tests__/base-identidad.ts`;
no tienen exactamente la misma guarda de hosts remotos: usá localhost.

Chequeo documental de una línea desde la raíz:

~~~bash
node scripts/ci/documentacion-vigente.mjs
~~~

Comprueba rutas de archivos, enlaces locales, métodos/rutas HTTP citados como
vigentes y variables de entorno citadas contra `.env.example`. No prueba el
despliegue, proveedores, micrófono ni que una promesa de producto ya esté cumplida.

## Trabajo y documentación

Leé `docs/como-trabajamos.md`, `docs/esquema.md` y `AGENTS.md`.
Se trabaja en ramas propias; main es la integración y release es la publicación.
Sin PR. El CI verde por sí solo no sustituye la prueba del dueño en teléfono.

- `docs/pipeline.md`: contrato clínico existente y partes pendientes.
- `docs/encryption.md`: columnas, formato y rotación.
- `docs/operaciones.md`: despliegue, alertas, backup y diagnóstico.
- `docs/pendientes/`: decisiones y textos pendientes de integración.

Privado.
