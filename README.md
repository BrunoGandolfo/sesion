# Sesión

App web para una consulta de psicoterapia: agenda, pacientes, cobros,
recordatorios por SMS y documentación clínica asistida por IA a partir de la
grabación de cada sesión.

## Para quién

Una psicóloga clínica que atiende adultos en consulta privada en Uruguay.
Un solo usuario por organización hoy; el modelo de datos ya separa por
organización para crecer a varias.

## Qué hace

- **Hoy:** agenda del día, próxima sesión, KPIs (pacientes activos, sesiones,
  por cobrar, cobrado en el mes), deudores.
- **Agenda:** turnos por semana; alta, edición, cancelación, ausencias.
- **Pacientes:** ficha con pestañas Resumen, Historia (grabación y notas),
  Progreso (contexto longitudinal), Turnos y Datos (consentimiento de
  grabación).
- **Finanzas:** cobros por sesión con método de pago, deuda por paciente.
- **Configuración:** datos de la profesional, tarifa, plantilla del
  recordatorio, orientación teórica (CBT/MI o Gestalt).
- **Recordatorios por SMS (Twilio):** un cron cada 5 minutos envía el
  recordatorio de cada turno en el momento configurado. La app **no envía
  WhatsApp**: no hay integración con la API de WhatsApp y no hay forma de que
  mande un mensaje por ese canal. Lo único que la nombra es el botón
  "Recordar cobro" de Cobros, que abre `wa.me` con el texto ya armado
  (`buildWhatsAppUrl`, `src/lib/deudas.ts`) para que lo mande la profesional
  desde su propio WhatsApp; la app no envía nada ni se entera de si se mandó.
- **Sesión grabada → nota clínica:** el navegador graba y cifra el audio, lo
  sube directo a R2, un worker lo transcribe con AssemblyAI, genera la nota
  SOAP y un feedback de auto-supervisión con Anthropic, y la profesional
  revisa, edita y aprueba. Al aprobar, el audio se borra y su clave se
  destruye. Cada sesión aprobada actualiza el contexto longitudinal del
  paciente. Detalle en `docs/pipeline.md`.
- **Cifrado en reposo** de transcripciones, notas y contexto clínico en la
  base (`docs/encryption.md`). **Auditoría** append-only de acciones sobre
  datos clínicos, sin texto clínico.

## Arquitectura y stack

```
Navegador (PWA) ──► Vercel: Next.js 16 (App Router, API routes, crons)
                        │            │
                        ▼            ▼
                   Neon Postgres 17   Cloudflare R2 (audio cifrado, backups)
                        ▲            ▲
                        │            │
                   Railway: worker Python ──► AssemblyAI (ASR) / Anthropic (LLM)
GitHub Actions: CI (typecheck, build, lint, tests) y backup nocturno cifrado
```

| Pieza | Tecnología |
| --- | --- |
| Frontend y API | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4 |
| Auth | Auth.js v5 (credenciales, JWT) |
| ORM y base | Prisma 5.22, PostgreSQL 17 en Neon (ramas `production` y `test`) |
| Almacenamiento de audio | Cloudflare R2, bucket `sesion-audio`, subida con URL prefirmada |
| Worker | Python 3 en Railway (`processor/`), sin SDKs de ASR: cliente REST |
| Transcripción | AssemblyAI `universal-3-5-pro`, fallback `universal-2`, diarización con roles; transcript borrado por API al terminar |
| Notas y feedback | Anthropic `claude-sonnet-5` con structured outputs, workspace dedicado con retención deshabilitada |
| SMS | Twilio |
| Cifrado en reposo | AES-256-GCM en una extensión de Prisma Client |
| Backups | `pg_dump` 17 → gpg AES-256 → R2, diario, retención 30 días (GitHub Actions) |
| CI | GitHub Actions: `tsc --noEmit`, `next build`, ESLint, Vitest secuencial contra la rama `test` |
| Errores | Sentry (opcional) |

Operación, secretos y restauración: `docs/operaciones.md`.

## Cómo correr en local

Requisitos: Node 22, npm, una base Postgres 17 (una rama propia de Neon es lo
más simple).

```bash
git clone https://github.com/BrunoGandolfo/sesion.git
cd sesion
npm install
cp .env.example .env
```

Completar en `.env` como mínimo:

- `DATABASE_URL` (con `sslmode=require` si es Neon).
- `AUTH_SECRET` y `NEXTAUTH_URL=http://localhost:3001`.
- `NOTES_ENCRYPTION_KEY` (`openssl rand -base64 32`); sin ella la app no arranca.
- `PROCESSING_SECRET` y `CRON_SECRET` (cualquier valor largo en local).
- `SEED_SECRET` y `SEED_USER_PASSWORD` para crear el usuario inicial.

Opcionales: Twilio (sin `TWILIO_SMS_FROM` el cron no envía nada), Sentry,
`ALERTA_WEBHOOK_URL`. Para grabar y procesar sesiones hacen falta además las
variables de R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_NAME`; no están en `.env.example`) y el worker corriendo con su
propio `processor/.env` (ver `processor/.env.example`).

```bash
npx prisma generate
npx prisma migrate deploy     # nunca `migrate dev` contra una base compartida
npm run dev -- -p 3001
```

Tests: `npm test`. Los de integración necesitan `DATABASE_URL_TEST` apuntando
a una rama de Neon dedicada (la vacían en cada corrida).

Worker en local:

```bash
cd processor
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # completar
python worker.py
```

## Estructura

```text
src/app/(dashboard)/     Pantallas: hoy, agenda, pacientes, finanzas, config
src/app/api/             API routes; reglas en src/app/api/_lib/casos-uso/
src/components/          UI, grabación, formularios
src/hooks/               Grabación y polling de sesión clínica
src/lib/                 Auth, Prisma + cifrado, R2, SMS, contrato de sesión
src/types/domain.ts      Tipos de dominio
prisma/                  Schema y migraciones
processor/               Worker Python (ASR, LLM, callback, contexto)
docs/                    Documentación; docs/historico/ para lo que ya no existe
```

## Documentación

- `docs/pipeline.md` — flujo de una sesión de punta a punta.
- `docs/encryption.md` — cifrado en reposo.
- `docs/operaciones.md` — infraestructura, secretos, backup y restauración.
- `docs/contrato-multi-orientacion.md` — feedback por orientación teórica.
- `docs/contrato-riesgo-clinico.md` — señal graduada de riesgo.

## Glosario

- **Sesión clínica:** la fila que une un turno con su grabación, transcripción y nota.
- **Nota SOAP:** subjetivo, objetivo, análisis, plan.
- **Golden Thread / contexto longitudinal:** resumen acumulado por paciente que se inyecta al generar cada nota.
- **Llamada A / B / C:** nota SOAP / actualización del contexto / feedback de auto-supervisión.
- **Lease:** reserva temporal de una sesión para el worker (45 min, 3 intentos).
- **Crypto-shredding:** destruir la clave del audio para que el blob quede inaccesible aunque no se haya borrado.

## Licencia

Privado.
