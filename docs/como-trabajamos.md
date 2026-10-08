# Cómo trabajamos en Sesión

Vigente desde el 14 de septiembre de 2026. Todo agente que entra al repo lee esto
antes de tocar nada. Es corto a propósito.

## Quién hace qué

- **El dueño (Bruno)** decide producto, corre comandos y prueba en el celular. No lee código.
- **El orquestador (Claude, en el chat del proyecto)** conoce el sistema entero, escribe
  los prompts, fusiona las ramas y cruza lo que un agente necesita de otro.
- **Los agentes (Claude Code, Codex/Astra)** construyen. Cada uno una tarea, en su
  propia carpeta, con sus propios archivos. Astra además navega la app publicada como usuaria.

## Ramas y carpetas

- Tres tipos de rama y nada más: `release` (producción; Vercel publica desde ahí; no se
  toca a mano; se avanza con el workflow Publicar, `docs/operaciones.md`), `main`
  (mesa de trabajo) y una rama por agente. Sin pull requests. Al fusionar una rama,
  el orquestador borra la rama remota y el worktree en el mismo acto: sin PR,
  GitHub no la borra solo.
- Cada agente trabaja en su propio worktree: `~/proyectos/sesion-<rama>`, creado con
  `git worktree add ../sesion-<rama> -b <rama> origin/main`. Nunca dos agentes en la
  misma carpeta. Si al entrar ves cambios que no son tuyos, no los toques: avisá.
- Los agentes no tienen memoria entre sesiones. Al retomar, lo primero es `git status`
  y `git log`; lo que no se subió a GitHub no existe para los demás: commit y push seguido.

## Cómo es un prompt

Corto: la tarea, los documentos de referencia, las barreras (qué no tocar), el criterio
de salida en frases verificables ("debe quedar cierto que…") y cómo se verifica. No
trae lista de archivos ni orden de pasos: el agente decide el cómo. Si el diseño o el
esquema parecen equivocados, se dice con fundamento antes de rodearlos.

## Verificación

- Cada frase del criterio de salida tiene un test que la demuestra.
- `codex review --uncommitted` antes de cada commit; los P1/P2 se arreglan con test.
  Corre directo en el worktree, sin clonar aparte. Si falla con `Failed to read
  project hooks config file …/sesion/.codex/config.toml: Not a directory`, se
  juntaron un archivo `.codex` vacío en `~/proyectos/sesion` (versionado en las
  ramas anteriores a 850b2b5) y una carpeta `.codex/` vacía en el worktree
  (ignorada por `.gitignore`): se borra esa carpeta del worktree y se vuelve a
  correr.
- El CI corre la suite completa con un Postgres propio: es el juez de cada rama
  antes de fusionar. El recorrido de Playwright (`pruebas/e2e`) recorre la app
  como la usuaria, pero no corre en el CI: se lanza a mano contra una rama
  desplegada o un servidor local (ver abajo).
- La prueba final siempre es el dueño en el celular. Nada llega a `release` sin eso.

### Herramientas manuales de `pruebas/`

Salvo `pruebas/e2e/nombres-vigentes.test.mjs`, que vitest recolecta y corre en
cada `npm test`, nada de `pruebas/` corre solo: son herramientas para lanzar a
mano cuando se toca lo que prueban. Cada carpeta dice cómo en su README o en la
cabecera del archivo.

| Qué | Para qué | Cómo se corre |
| --- | --- | --- |
| `e2e/recorrido.mjs` | La app entera como la usuaria, a 1280 y 390 px, contra una rama desplegada o un servidor local, con una cuenta de prueba | `npm run e2e -- --url=…` (ver `pruebas/e2e/README.md`) |
| `e2e/capturas.spec.ts` | Capturas a 390 y 1280 px para el cierre de una tarea de frontend | `CAPTURAS_URL=… npx vitest run pruebas/e2e/capturas.spec.ts` |
| `e2e/comprobaciones.node.mjs` | Prueba del detector de desbordes que usa el recorrido | `node --test pruebas/e2e/comprobaciones.node.mjs` |
| `e2e/sembrar-local.mjs` | Siembra una base local `sesion_e2e_*` para correr el recorrido en local | ver su cabecera |
| `grabador-ajustes/` | Grabación real en Chromium contra `next dev` y un Postgres local: diagnóstico del grabador y grabación demasiado corta | `node pruebas/grabador-ajustes/verificar.mjs` (ver su README) |
| `grabador-dhh/` | El hook real del grabador con micrófono sintético, pausa y página congelada, y el archivo que llega a "R2" medido con ffprobe | `node pruebas/grabador-dhh/verificar.mjs` (necesita Chromium y ffmpeg; usa `vite`, que llega por vitest y no está declarado) |
| `vida/interacciones.test.tsx` | Mide cuánto tarda en responder un componente en el DOM | `MEDIR_UI=1 npx vitest run pruebas/vida/interacciones.test.tsx` (sin la variable se saltea) |

Si una de estas deja de reflejar la app (una ruta, un nombre accesible, una
versión del consentimiento), se corrige cuando se toca lo que prueba, no se
deja podrir: no hay CI que avise.

## Fusión y cierre

- El orquestador fusiona a `main` de a una rama, con la suite completa entre cada una.
- El reporte final de cada agente dice: qué quedó, qué se borró, qué contratos o firmas
  expone, qué le faltó de otras áreas, qué NO hizo y por qué, y desacuerdos con
  fundamento. Sin ese reporte la rama no se fusiona.
- Los textos de pantalla y de ayuda nuevos van a `docs/pendientes/<area>.md`; un solo
  agente los integra al cierre. `glosario.ts` y `docs/ayuda/**` no se tocan en paralelo.

## Principios

- Sin sobreingeniería: lo mínimo que cumpla el criterio de salida. Nada de frameworks
  encima de las herramientas que ya hay.
- Nada se borra ni se toca afuera (R2, AssemblyAI, Twilio) antes de que la base lo
  confirmó; los efectos externos son trabajos durables con reintentos.
- Los agentes no corren migraciones contra producción: se escalan al dueño.
- Cuando algo falla, la app lo dice; nunca un "quedó en el celular" silencioso.
- Cada seis meses, o con cada modelo nuevo: borrar `AGENTS.md`, usar el modelo, y
  volver a escribir solo las reglas que se rompen dos veces.
