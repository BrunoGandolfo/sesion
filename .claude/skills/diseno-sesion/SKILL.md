---
name: diseno-sesion
description: Sistema de diseño de Sesión (tokens, tipografía, grilla, movimiento, Lupita y prohibiciones). Usar SIEMPRE antes de crear o tocar cualquier pantalla, componente, clase de Tailwind, animación o estilo en src/app o src/components. UI de producto densa y sobria para una profesional clínica, no una landing.
---

# Diseño de Sesión

Sesión es una herramienta de trabajo para una psicóloga que la usa entre
pacientes, en el teléfono y en la computadora. El modo es **UI de producto
densa y sobria**: cada píxel tiene que ayudar a leer o a tocar algo. No es una
landing, no vende, no sorprende.

Cada valor de abajo sale de un archivo del repo; la referencia va entre
paréntesis. Si el archivo cambió y no coincide, **manda el archivo**: corregí
este skill en la misma rama.

## Antes de escribir una línea

1. Buscá si ya existe el componente en `src/components/ui/` (card, sheet,
   input, select, plegable, toast, procesando, avatar, lupita, movimiento).
   Reusalo antes de escribir clases nuevas.
2. Usá los tokens por nombre (`bg-cream-50`, `text-ink-700`, `rounded-md`,
   `shadow-subtle`, `duration-[var(--duration-fast)]`). Nunca un hex, un px de
   radio o un ms escritos a mano.
3. Si necesitás un valor que no está acá, no lo inventes: preguntá o dejalo
   anotado como decisión pendiente.

## Color

Paleta cerrada. No se agrega un color para resolver una pantalla
(`docs/diseno/04-personaje.md:6-7`).

| Familia | Token | Valor | Para qué |
|---|---|---|---|
| Salvia | `sage-50`…`sage-900` | #F3F6F4 · #E2EBE6 · #C2D4CB · #9BB6AA · #6F9384 · **#4F7A6A** (500) · #3E6355 · #304E43 · #243A32 · #1A2A24 | Primario, marca, foco (`src/app/globals.css:10-20`) |
| Salvia texto | `sage-text` | #4A7364 | Texto salvia AA; `text-sage-500` ya lo usa (`globals.css:51`, `:123-125`) |
| Crema | `cream-50` / `100` / `200` | #FAFAF6 / #F4F0E8 / #E8E1D2 | Superficies cálidas; `cream-50` es el fondo del body (`globals.css:23-25`, `:102`) |
| Tinta | `ink-900` / `700` / `500` / `300` | #1A2628 / #3F4F52 / #627072 / #A5B0B2 | Texto: principal / secundario / meta / deshabilitado (`globals.css:28-34`) |
| Terracota | `terracotta-50` / `100` / `500` / `600` | #FBF3EB / #F5E0CC / #9A5C3B / #8F5436 | **Sólo** deudas, advertencias y riesgo (`globals.css:36-40`) |
| Oro | `gold-50` / `500` | #FAF4E4 / #866929 | Acento editorial, escaso (`globals.css:42-44`) |
| Semánticos | `success` / `warning` / `error` / `info` | #4F7A6A / terracotta-500 / #8F4B48 / #4A6B7D | Estados (`globals.css:62-65`) |
| Bordes | `--border-subtle` / `--border-strong` / `--border-control` / `--border-focus` | cream-200 / #C4BDAE / #858C86 / sage-500 | Separador / borde marcado / límite de control (3:1) / foco (`globals.css:90-94`) |

Reglas:
- Fondo de página `cream-50`, tarjetas en blanco o `cream-100`, texto `ink-900`
  (`globals.css:100-103`).
- Texto de color: `text-sage-500`, `text-terracotta-500` y `text-gold-500` ya
  apuntan a la variante AA (`globals.css:123-133`). No uses `sage-400` ni más
  claro para texto.
- Terracota significa plata que falta o riesgo. No la uses para decorar ni
  para un botón neutro (`docs/diseno/04-personaje.md:72-73`).
- Foco: contorno 2 px `sage-500` con 2 px de separación, global
  (`globals.css:137-140`). No lo saques ni lo reemplaces por un `ring` propio.

## Tipografía

Dos familias, cada una con su rol (`src/lib/fonts.ts:3-15`, `globals.css:78-79`):

- **Fraunces** (`font-display`) — **sólo títulos**: h1/h2/h3 de pantalla, de
  sheet y de sección. Pesos 400–700; en la app se usa `font-medium`.
- **Plus Jakarta Sans** (`font-sans`, default del body, `globals.css:101`) —
  todo lo demás: texto, rótulos, botones, cifras, campos.
- Cifras siempre con `tabular-nums`, que fuerza Jakarta: Fraunces no tiene
  cifras tabulares (`globals.css:113-121`).
- En teléfono los campos van a 16 px para que iOS no haga zoom; ya lo hace
  `globals.css:185-191`, no lo pises.

### Escala

Hoy los tamaños están escritos a mano (`text-[13px]`). La escala sale de lo
que más se usa, con **piso de 12 px**. Conteos por grep de `text-[…px]` en
`src/` al 2026-09-26.

| Paso | Tamaño | Rol | Usos hoy | Ejemplo |
|---|---|---|---|---|
| meta | 12 px | Rótulos en mayúscula, fechas, notas al pie | 120 | `src/components/layout/cabecera-usuario.tsx:75` |
| secundario | 13 px | Texto de apoyo, filas densas | 122 | `src/components/ui/guardado-campo.tsx:8` |
| cuerpo | 14 px | Texto corriente | 75 | `src/components/grabacion/HotWordsManager.tsx:443` |
| campo | 15 px | Valor de input y select | 41 | `src/components/ui/input.tsx:53`, `src/components/ui/select.tsx:11` |
| título chico | 16 px | Título de bloque o plegable (Fraunces) | 12 | `src/components/ui/plegable.tsx:60` |
| título de sección | 18 px | Título de sección (Fraunces) | 16 | `src/app/(dashboard)/pacientes/[id]/_components/graficos/base.tsx:166` |
| título de sheet | 22 px | Encabezado de formulario o sheet (Fraunces) | 14 | `src/components/forms/nuevo-turno-form.tsx:424` |
| título de pantalla | 30 px | h1 de pantalla en escritorio (Fraunces) | 9 | `src/app/(dashboard)/agenda/_components/agenda-header.tsx:62` |

Fuera de la escala (no uses en código nuevo; al tocar un archivo, llevalo al
paso vecino): 10 y 11 px → 12; 17 → 18; 19 y 20 → 18 o 22 según jerarquía;
24 y 28 → 22 en teléfono, 30 en escritorio. 34/40/52/56 px son sólo la
presentación de `/login` (`src/app/(auth)/login/_components/presencia.tsx:42`)
y el total de Cobros (`src/app/(dashboard)/cobros/_components/cobros-view.tsx:326`):
no se copian a otras pantallas.

Rótulo en mayúscula: 12 px, `font-semibold uppercase tracking-[0.08em]
text-ink-500` (el tracking es el de `src/components/ui/input.tsx:35`, con el
tamaño llevado al piso). Interlineado de texto corrido: `leading-[1.5]`
(63 usos, p. ej. `src/components/clinico/brief-corto.tsx:306`).

## Espacio

Grilla de **4 px**: la escala de espaciado de Tailwind v4 (1 unidad = 4 px),
que `@theme` no redefine (`globals.css:9-80`). Usá `p-4`, `gap-3`, `mt-6`;
nada de `px-[14px]` ni `mt-[3px]` en código nuevo.

- Densidad: separá con espacio y con un borde `--border-subtle` antes que con
  tarjetas y sombras.
- Blanco táctil: `min-h-11` (44 px) en todo lo que se toca
  (`src/components/ui/select.tsx:11`).

## Radios

| Token | Valor | Uso |
|---|---|---|
| `rounded-sm` | 6 px | Campos, botones chicos (`globals.css:68`) |
| `rounded-md` | 10 px | Tarjetas y botones (`globals.css:69`) |
| `rounded-lg` | 14 px | Sheets y paneles grandes (`globals.css:70`) |
| `rounded-xl` | 20 px | Excepcional (`globals.css:71`) |
| `rounded-full` | — | Pastillas, avatares, puntos |

El radio sigue al tamaño: un chip no lleva el radio de un sheet.

## Sombras

| Token | Valor | Uso |
|---|---|---|
| `shadow-subtle` | `0 1px 2px rgba(26,38,40,.04), 0 1px 3px rgba(26,38,40,.06)` | Lo que se apoya sobre el fondo (`globals.css:74`) |
| `shadow-raised` | `0 2px 4px rgba(26,38,40,.04), 0 4px 12px rgba(26,38,40,.08)` | Lo que flota: sheet, menú, toast (`globals.css:75`) |

La mayoría de los bloques no llevan sombra: llevan borde.

## Movimiento

Una sola fuente: `src/lib/movimiento.ts`, publicada como variables CSS en
`<html>` por `src/app/layout.tsx:36`.

| Tiempo | Valor | Variable CSS | En JS | Para qué |
|---|---|---|---|---|
| breve | 150 ms | `--duration-fast` (también el default de `transition`) | `DURACION_BREVE` | Hover, color, aparece, check, toast (`src/lib/movimiento.ts:2`, `:6`, `:10`) |
| navegación | 180 ms | `--duration-normal` | `DURACION_NAVEGACION` | Cambio de pantalla, indicador de la barra (`movimiento.ts:2`, `:7`) |
| pliegue | 220 ms | `--duration-pliegue` | `DURACION_PANEL` / `MS_PLIEGUE` | Abrir y cerrar alturas, sheets (`movimiento.ts:2`, `:8`) |

**La curva** es una: `cubic-bezier(0.16, 1, 0.3, 1)` — `SUAVE` en JS,
`--ease-out` en CSS (`src/lib/movimiento.ts:3`, `:9`). Ya se aplica a toda
transición por `globals.css:170`; no escribas `ease-in`, `ease-in-out`,
`linear` ni resortes.

Primitivos (`src/components/ui/movimiento.tsx`), usá estos y no framer-motion
suelto:
- `Aparece` — entrada de 3 px, contenido visible desde el primer cuadro
  (`movimiento.tsx:21`, `:66-87`).
- `ListaEnCascada` — anima los primeros 8 ítems, sin espera entre filas
  (`movimiento.tsx:24`, `:31`, `:114-140`).
- `AlturaAnimada` — pliegue por altura en 220 ms (`movimiento.tsx:188-214`).
- `CheckDibujado` + `useConfirmacionDibujada` — confirmación de que algo se
  guardó (`movimiento.tsx:271-344`).
- `Contador` — los totales **no** animan (`movimiento.tsx:230-233`).
- `Latido` y `AnilloProgreso` — indicadores **quietos**
  (`movimiento.tsx:248-254`, `:365-397`).

En Tailwind: `transition-colors duration-[var(--duration-fast)]`, o
`transition-[propiedad]` cuando no es color. Con `prefers-reduced-motion` todo
queda quieto (`globals.css:172-178`) y los primitivos lo consultan en JS
(`movimiento.tsx:73`).

La única animación en loop permitida es `.gira-procesando` (1,2 s), para la
nota que se está escribiendo, y ya existe en `src/components/ui/procesando.tsx`
(`globals.css:163-168`). No se crea otra.

## Lupita

Personaje de la app: SVG propio en `src/components/ui/lupita.tsx`. Resumen de
`docs/diseno/04-personaje.md`; ante la duda, leé ese archivo.

- **Aparece en:** la ayuda, los estados vacíos, el onboarding y las
  confirmaciones alegres (cobrar, sesión aprobada) (`04-personaje.md:12-14`).
- **Nunca en:** la nota clínica (`src/app/(dashboard)/sesiones/[id]/` entero,
  con la barra de acciones), el brief pre-sesión y su uso en la card de Hoy,
  el Recorrido y sus gráficos, ni en ninguna pantalla del camino de una sesión
  con señal de riesgo (`clavesDeRiesgo(...)` no vacío): ahí se confirma sólo
  con `CheckDibujado` (`04-personaje.md:16-35`).
- **Poses:** tres, no más: saluda, señala, celebra. Sin pose triste, de error
  ni de carga (`04-personaje.md:132-134`, `lupita.tsx:28`).
- **Tamaños:** 20 px inline, 72 px en el encabezado de la ayuda, 96 px en un
  estado vacío; debajo de 32 px sin el punto dorado
  (`src/components/ui/lupita.tsx:44`, `:47`).
- **Colores:** hoja grande `sage-500`, chica `sage-300`, brote `gold-500`,
  círculo `cream-100`; neutro en `ink-300`. **Nunca terracota**
  (`04-personaje.md:58-73`).
- **Movimiento:** brota y celebra una vez en 220 ms; gesto de menú en 150 ms;
  reposo quieto, sin pulsos ni loops (`04-personaje.md:79-88`,
  `lupita.tsx:98-103`).
- Siempre `aria-hidden="true"` y al lado de un texto que ya dice todo
  (`04-personaje.md:135-136`).
- Habla de vos, rioplatense, frases cortas; nunca "usuario", "sistema",
  "procesando" (`04-personaje.md:92-94`).

## Prohibido

- Rótulos numerados decorativos: `01`, `02`, `03` sobre secciones o pasos.
- Itálicas decorativas. La itálica sólo marca una cita literal (lo que dijo
  la paciente, el texto de un SMS).
- Gradientes (`bg-gradient-*`, `from-*`/`to-*`, `linear-gradient`).
- `transition-all`. Nombrá la propiedad: `transition-colors`,
  `transition-[height]`.
- `rounded-lg` en todo. El radio sigue al tamaño (tabla de radios).
- Glassmorphism: `backdrop-blur`, fondos translúcidos sobre contenido.
- Pulsos (`animate-pulse`, `animate-ping`, `animate-bounce`), latidos que
  laten, respiraciones.
- Loops de cualquier tipo, salvo `.gira-procesando` que ya existe.
- Confeti, destellos, partículas, celebraciones que no sean el
  `CheckDibujado` o la pose "celebra" de Lupita.
- Duraciones literales: `duration-300`, `duration-200`, `duration-150`,
  `duration: 0.3`, `setTimeout` de animación con ms a mano. Siempre la
  variable o la constante de `movimiento.ts`.
- Otras curvas: `ease-in`, `ease-in-out`, `linear`, `type: "spring"`.
- Sombras en todo. Sombra sólo para lo que flota o se apoya; el resto, borde.
- Modo oscuro: no hay `dark:` ni tokens oscuros; no los agregues.
- Colores fuera de la paleta: hex sueltos, `gray-*`, `slate-*`, `blue-*`.
- Tamaños de letra fuera de la escala y debajo de 12 px.
- Fraunces en texto que no es título (párrafos, citas, avatares, cifras).

## Cierre de cada tarea de frontend

1. **Capturas** de cada pantalla tocada a **390 px** y **1280 px** de ancho.
   Para `/login` alcanza con
   `CAPTURAS_URL=http://localhost:3000 npx vitest run pruebas/e2e/capturas.spec.ts`
   (ver `pruebas/e2e/README.md`); para pantallas con sesión, `npm run e2e`.
   Mirá las dos imágenes antes de dar la tarea por hecha: desborde
   horizontal, texto cortado, botones que no entran.
2. **Pase de "sacá un accesorio".** Mirá la pantalla y sacá una cosa que no
   hace falta: una sombra, un borde doble, un ícono que repite el texto, una
   animación, un color, un rótulo. Si no encontrás ninguna, buscá de nuevo.
3. Revisá la lista de prohibiciones contra tu diff
   (`git diff | grep -nE 'transition-all|duration-[0-9]|gradient|backdrop-blur|animate-|italic|dark:'`).
