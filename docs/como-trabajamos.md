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
  toca a mano), `main` (mesa de trabajo; puede estar rota mientras se reconstruye), y
  una rama por agente que se borra al fusionar. Sin pull requests.
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
- El CI corre la suite completa con un Postgres propio; el recorrido automático de
  Playwright (`pruebas/e2e`) recorre la app como la usuaria. Los dos son el juez de
  cada rama antes de fusionar.
- La prueba final siempre es el dueño en el celular. Nada llega a `release` sin eso.

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
