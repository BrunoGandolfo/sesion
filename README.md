# Sesión

App web para gestionar una consulta de salud mental: pacientes, turnos, cobros y recordatorios.

## Qué es

Sesión es una herramienta de gestión para profesionales de salud mental. Centraliza agenda, fichas de pacientes, seguimiento de pagos y recordatorios por WhatsApp en una interfaz simple. El MVP usa un único usuario autenticado y está preparado para evolucionar a multi-tenant.

## Stack

| Tecnología | Versión | Rol |
| --- | --- | --- |
| Next.js | 16.2.4 | App Router, frontend y API routes |
| React | 19.2.4 | UI |
| TypeScript | strict | Tipado de aplicación |
| Tailwind CSS | 4 | Estilos |
| Prisma | 5.22 | ORM |
| PostgreSQL | 17 | Base de datos |
| Auth.js / next-auth | 5.0.0-beta.31 | Login con credenciales y JWT |
| Vercel | Hobby | Hosting y API |
| Neon | Free | PostgreSQL administrado |
| Twilio SMS | — | Recordatorios por SMS |

## Requisitos

- Node.js 18+
- npm
- PostgreSQL 17 compatible
- Cuenta Neon para base de datos remota

## Setup local

1. Clonar el repo:

```bash
git clone https://github.com/BrunoGandolfo/sesion.git
cd sesion
```

2. Instalar dependencias:

```bash
npm install
```

3. Crear variables locales:

```bash
cp .env.example .env
```

4. Completar `.env` con valores locales o de desarrollo.

5. Generar Prisma Client:

```bash
npx prisma generate
```

6. Sincronizar la base:

```bash
npx prisma db push
```

7. Levantar desarrollo:

```bash
npm run dev -- -p 3001
```

## Puerto

El entorno local corre en `http://localhost:3001`.

## Estructura del proyecto

```text
src/
  app/                 Rutas App Router, pantallas y API routes
  components/          Componentes UI, layout y formularios
  lib/                 Auth, Prisma, formato y servicios externos
  types/               Tipos de dominio compartidos
prisma/
  schema.prisma        Modelo de datos
public/                Assets estáticos
```

## Scripts

| Script | Uso |
| --- | --- |
| `npm run dev -- -p 3001` | Levanta Next.js en desarrollo |
| `npm run build` | Compila producción |
| `npm run lint` | Ejecuta ESLint |
| `npx prisma generate` | Genera Prisma Client |
| `npx prisma studio` | Abre Prisma Studio |

## Variables de entorno

Las variables necesarias están documentadas en `.env.example`. No commitear `.env` ni secretos reales.

## Operación

- [Cifrado de notas clínicas](docs/operations/encryption.md) — cómo generar la clave, migrar datos, rotar y recuperar.

## Deploy

Push a `main` auto-deploya en Vercel.

## Licencia

Privado.
