<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Reglas del repositorio

9. NUNCA importar módulos de Node en ningún archivo alcanzable desde el
   middleware/proxy. Las DOS formas están prohibidas: `node:crypto` y
   `crypto` pelado son el mismo módulo y rompen el Edge igual. Web Crypto
   (`globalThis.crypto`) sí.
   Alcanzable incluye los `await import()` dinámicos: el empaquetador los
   sigue igual aunque el código nunca corra en el edge.
   Ejemplo de hoy: `src/lib/login-eventos.ts` importaba `node:crypto` para
   hashear el email, entraba al bundle por el import dinámico de
   `authorize()` en `src/lib/auth.ts`, pasó CI entero y reventó recién en el
   deploy de Vercel con `The Edge Function "_middleware" is referencing
   unsupported modules: node:crypto`.
   El guardián que lo atrapa antes del merge es
   `src/lib/__tests__/middleware-edge.test.ts`: camina el grafo de imports
   desde `src/middleware.ts` y falla ante cualquier módulo built-in, con o
   sin prefijo (la lista sale de `builtinModules` de `node:module`, no está
   escrita a mano).

# Content-Security-Policy: el plan para pasar a enforce

Hoy la CSP sale del middleware (`src/middleware.ts`, política en
`src/lib/csp.ts`) en modo **Report-Only**: el navegador no bloquea nada y
postea las violaciones a `/api/csp-report`, que las deja en el log de la
función (no en `eventos_auditoria`: son ruido de diagnóstico, no rastro
clínico).

Pasar a enforce es cambiar `Content-Security-Policy-Report-Only` por
`Content-Security-Policy` en `conReporteCsp`. **Pero antes de enforzar hay
que verificar que `DESTINOS_EXTERNOS` (`src/lib/csp.ts`) cubre todo lo que
el navegador usa.** Cuando esta política se escribió, no cubría R2 y
enforzar habría roto la subida de toda grabación: el navegador hace PUT del
audio cifrado directo al bucket, y `connect-src` gobierna ese PUT. Hoy R2
entra por `R2_PUBLIC_HOST` (origen exacto de la URL prefirmada, que lleva el
**bucket** como primer subdominio:
`https://<bucket>.<accountId>.r2.cloudflarestorage.com`; sin comodín;
obligatoria en producción) y `src/lib/__tests__/csp-destinos.test.ts` falla ante cualquier
host `https://` nuevo en `src/**` que no esté declarado. Ese test es la
condición previa; el log de reportes es la confirmación.

## Qué mirar en los reportes

Cada línea del log tiene la forma:

```
[csp] directiva="script-src-elem" bloqueado="https://…" documento="https://…" archivo="…:42" disposicion="report"
```

Se clasifican en tres montones, y cada uno se resuelve distinto:

1. **`directiva="script-src-elem"` o `"script-src"` con `bloqueado="inline"`**
   — un `<script>` sin nonce. Es el montón que decide todo. Si aparece con
   `documento` de una página de la app, hay un script que Next no está
   nonciando y **no se puede enforzar**: hay que averiguar cuál y por qué.
   La causa más probable es una página que quedó **prerenderizada en el
   build**: sin request no hay nonce que ponerle a los scripts. Hoy
   `src/app/(dashboard)/layout.tsx` y `src/app/(auth)/layout.tsx` declaran
   `dynamic = "force-dynamic"` y entre los dos cubren todas las páginas; una
   página nueva fuera de esos dos grupos tiene que declararlo también, o
   aparece en este montón para siempre.
   Si el `documento` es de una extensión (`chrome-extension://`, `moz-…`) o
   el `archivo` no es del dominio, es ruido del navegador de quien mira y no
   cuenta.

2. **`directiva="style-src"` o `"style-src-attr"`** — esperables y hoy
   permitidos: la política conserva `'unsafe-inline'` en `style-src` porque
   Tailwind v4 y framer-motion escriben en el atributo `style`, que los
   nonces no cubren (sólo cubren elementos `<style>`). **Sacar ese
   `'unsafe-inline'` es una pelea aparte y posterior**: no bloquea el paso a
   enforce de `script-src`, que es lo que de verdad importa contra un XSS.

3. **`connect-src`, `img-src`, `media-src`, `font-src`** — algo que la app
   pide y la política no contempla. Se agrega el destino a
   `DESTINOS_EXTERNOS` en `src/lib/csp.ts` con un comentario que diga qué lo
   pide, y a `csp-destinos.test.ts` si es un host que sólo usa el servidor.
   **Un reporte de `connect-src` con `bloqueado` en
   `r2.cloudflarestorage.com` ya debería haber aparecido** en el log desde
   que existe la política (cada grabación subida generaba uno, hasta que
   R2 entró a la política). Si en el log no hay ninguno de antes de ese
   cambio, eso significa que nadie estaba mirando el log, no que no
   existiera: revisar cómo se leen los reportes antes de confiar en las
   cuatro semanas de abajo.

## Cuánto tiempo

**Cuatro semanas de uso real**, contadas desde el deploy, no desde el merge.
No es un número mágico: es lo que hace falta para que la profesional haya
pasado al menos una vez por cada pantalla —agenda, ficha de paciente,
grabación, aprobación de nota, configuración, cobros— en su teléfono y en su
computadora, y para que hayan entrado uno o dos ciclos de dependencias de
Next.

Antes de cambiar la línea, cuatro condiciones:

- `csp-destinos.test.ts` en verde y `R2_PUBLIC_HOST` cargada en Vercel con
  el host exacto de la cuenta (`/api/health` contesta 503 si falta);
- **cero** reportes del montón 1 que vengan del dominio propio en las últimas
  dos semanas;
- se hizo al menos una grabación completa de una sesión real bajo la política
  (la pantalla de grabar es la que más JavaScript mueve, y la subida a R2 es
  el único `connect-src` externo con datos clínicos);
- se leyó el log después del último deploy de Next o de una dependencia
  grande: una versión nueva puede inyectar un script nuevo.

## Cuando se enforce

Dejar `Content-Security-Policy-Report-Only` **también**, con la misma
política, durante un mes más. Las dos cabeceras conviven: la enforzada
bloquea y la de reporte sigue avisando, así queda el rastro de qué habría
bloqueado si algo se rompe. Después se saca la de reporte.

Y en ese momento se puede fusionar la CSP mínima de `next.config.ts`
(`frame-ancestors 'none'`, que hoy existe aparte porque una política
report-only no impide el embebido) con la del middleware.
