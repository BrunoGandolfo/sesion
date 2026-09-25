<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Sesión

Leé `docs/como-trabajamos.md` para trabajar y verificar. Las operaciones de
producción están en `docs/operaciones.md` y requieren autorización del dueño.

- `src/proxy.ts` sólo importa `@/lib/csp`, `@/lib/sesion-cookie` y
  `next/server`. No arrastres Node, DB ni autenticación; verificá
  `src/lib/__tests__/proxy-liviano.test.ts`.
- Las rutas validan, autorizan y llaman casos de uso; las consultas y reglas
  viven en `src/app/api/_lib/casos-uso/`. No agregues excepciones al guardián
  `rutas-sin-prisma.test.ts`; retiralas cuando migres su ruta.
- Las listas del turno salen de `src/lib/constantes-turno.ts`; los enums
  clínicos, de `processor/contrato/enums-clinicos.json`. Si cambia la base,
  verificá la correspondencia con enums y CHECK.
- No actives el bloqueo CSP sin completar su procedimiento en
  `docs/operaciones.md`. Los destinos del navegador se declaran en
  `src/lib/csp.ts` y se verifican con `csp-destinos.test.ts`.
