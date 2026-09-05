<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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
