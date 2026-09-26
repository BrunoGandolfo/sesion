# Lupita como presencia

Especificación para criticar **antes** de escribir código. Parte de una
decisión del dueño que no se discute acá: Lupita deja de ser un botón quieto
y pasa a ser una presencia en todas las páginas del panel. Lo que sigue
dice cómo, con qué dibujos, con cuánto movimiento, qué archivos cambian y
dónde puede salir mal.

Se apoya en `docs/diseno/04-personaje.md` (forma, paleta, voz, regla de
tono) y en `src/components/ui/lupita.tsx` (el SVG). Donde esta
especificación contradice a 04, **gana esta** y 04 se actualiza en la misma
rama que construya esto; donde no dice nada, sigue valiendo 04.

---

## 0. Punto de partida: lo que hay hoy

- **El dibujo.** Un SVG sobre grilla de 24: tallo, hoja grande
  (`sage-500`), hoja chica (`sage-300`) y un punto dorado de 2 px
  (`gold-500`) que sólo se dibuja desde 32 px. **Sin cara**: la expresión
  está en la inclinación del tallo.
- **Tres poses** (`saluda`, `senala`, `celebra`), dibujadas y no rotadas
  para que el trazo mida 1,8 px en todas. Lo único que morfa hoy son las
  dos hojas de `saluda` a `celebra` (mismos comandos en el `d`). El tallo
  **no puede morfar**: en `saluda` y `celebra` es `M…V…` y en `senala` es
  `M…C…`; framer-motion no interpola dos `d` con comandos distintos, salta.
- **Movimiento.** Sólo dos gestos finitos (`brota`, `celebra`, 220 ms) y un
  saltito de 150 ms en el ítem del menú. `respira`, `piensa` y `habla`
  existen como nombres pero se dibujan quietos, y hay tests que lo exigen
  (`lupita.test.tsx`: "el estado %s no activa movimiento continuo";
  `limites-movimiento.test.tsx`: sólo 150/180/220 ms y nada de
  `repeat: Infinity`).
- **Dónde está.** Ítem 5 del menú de abajo (20 px, sobre blanco), ítem del
  lateral (20 px, sobre `cream-100`), encabezado del panel de ayuda (72 px),
  cuatro estados vacíos (Hoy sin turnos 72 px, Agenda día vacío 96, Pacientes
  sin nadie 96, Cobros "Nadie te debe" 96 celebrando).
- **Dónde no está, por regla escrita en código.** `PREFIJOS_RUTA_CLINICA`
  (`panel-ayuda.tsx`: `/sesiones/`, `/grabar/`, `/pacientes/`) le saca el
  dibujo al panel en esas rutas. `riesgoEnElDia` la saca del vacío de Hoy.
  El toast no la lleva (fondo `ink-900`). La barra de aprobar, el brief,
  `card-ahora.tsx` y el Recorrido tampoco.
- **Lo que no existe y la decisión nombra.** No hay "etapas" de la nota: hay
  un renglón, `IndicadorProcesando` ("Procesando la sesión de X" + anillo
  girando), en Hoy, en `card-ahora`, en la pestaña Sesiones de la ficha y en
  `/sesiones/[id]`. El servidor sólo distingue `subiendo` y `procesando`.

---

## 1. Inventario de poses

Hoy hay tres. Hacen falta **cuatro más** y una **capa** condicionada a la
decisión D1 (ojos). Total: siete poses + parpadeo.

Condición para todas, nueva: **el tallo pasa a ser siempre una sola cúbica**
(`M x y C x1 y1 x2 y2 x y`) y cada hoja conserva la forma `M C C Z` que ya
tiene. Un tallo recto se escribe como cúbica con los controles sobre la
recta: se ve igual y puede morfar hacia cualquier otra pose. Un test nuevo
compara la firma de comandos de las siete poses.

| # | Pose | Estado | Boceto en palabras |
|---|------|--------|--------------------|
| 1 | `saluda` | existe | Tallo vertical, hoja grande abierta a 45° a la izquierda, chica a la derecha, brote alto. **Es también la pose de reposo.** Se redibuja el tallo como cúbica. |
| 2 | `senala` | existe | Tallo inclinado 12° a la derecha, hoja grande estirada hacia ese lado, la chica atrás de contrapeso. Se usa para "mirá esto" y como un extremo del vaivén de `piensa`. |
| 3 | `celebra` | existe | Tallo vertical, las dos hojas arriba, punto dorado separado 3 px de la punta. Se redibuja el tallo como cúbica. |
| 4 | `saluda-alto` | **nueva** | Igual a `saluda` pero la hoja grande sube por encima de la horizontal, casi vertical, como una mano levantada; la chica no se mueve y el tallo se endereza medio punto. Es el cuadro del medio del saludo: `saluda → saluda-alto → saluda`. |
| 5 | `concentrada` | **nueva** | "Sentada": el tallo se acorta un 25 % (arranca más abajo, la base no se mueve) y se curva hacia adelante, hacia el texto de al lado; la hoja grande se pliega pegada al tallo, como brazos cruzados; la chica queda casi cerrada; el brote baja 2 unidades. Quieta y compacta: se lee "está trabajando", no "está triste". |
| 6 | `piensa` | **nueva** | Espejo parcial de `senala`: tallo inclinado 8° a la **izquierda**, hoja grande recogida hacia arriba, la chica abierta hacia la derecha. Sola no se usa: es el otro extremo del vaivén `senala ↔ piensa` del chat. |
| 7 | `asiente` | **nueva** | La mitad de arriba del tallo se dobla 15° hacia adelante y el brote baja 1,5 unidades; las hojas bajan con él sin cerrarse. Es el cuadro del medio de un "sí" con la cabeza: `saluda → asiente → saluda`. |
| — | *ojos* (capa) | **según D1** | Dos puntos de `ink-700`, 1,2 unidades, a la altura del brote y a ambos lados del tallo, sólo desde 32 px. Parpadear = los dos puntos pasan a dos rayitas de 1,2 × 0,4 durante un cuadro. Si el dueño no acepta ojos, esta fila no existe y el "parpadeo" se resuelve como dice D1. |

Lo que **no** se dibuja, igual que en 04: ni triste, ni error, ni dormida,
ni "cargando". En un error hablan las palabras; en una espera, el
indicador.

No hace falta pose para "aparece" ni "se va": son opacidad + 4 px de
desplazamiento vertical del grupo entero (`brota` ya lo hace), y trasladar
no le cambia el peso al trazo como sí lo hace rotar.

---

## 2. Pantalla × momento

Convenciones de la tabla:

- **Menú** = la Lupita del ítem 5 del menú de abajo (teléfono, sobre blanco)
  o del ítem del lateral (computadora, sobre `cream-100`). Es la presencia
  permanente. Tamaño: 22 px en el teléfono (el de los íconos del menú),
  20 px en el lateral.
- **Reposo** = respira + parpadea (sección 3).
- Duraciones de gesto son ida y vuelta completas.
- Los textos son **propuestas**; van a `src/lib/glosario.ts` como todo texto.
- Toda fila está sujeta a la **regla del riesgo** (sección 6, R1): si la
  sesión involucrada o el día tiene señal de riesgo, la fila no pasa.

| Pantalla | Momento | Dónde | Pose / movimiento | Duración | Disparador | Texto (propuesta) |
|---|---|---|---|---|---|---|
| Todas las del panel | Reposo | Menú | `saluda`, reposo | continuo | siempre, salvo las excepciones de abajo | — (el rótulo "Lupita" de siempre) |
| Todas | Ella toca a Lupita | Menú → panel | Menú: `saluda → saluda-alto → saluda`. Panel: `brota` en el encabezado (72 px) y después reposo | 450 ms + 220 ms, en secuencia | toque o Enter/Espacio en el ítem | El `AYUDA_BIENVENIDA` de hoy, sin cambios |
| Chat | Esperando la respuesta | Encabezado del panel | vaivén `senala ↔ piensa`, hojas incluidas | 900 ms por semiciclo; se corta al primer fragmento o a los 15 s (queda `senala` quieta) | `preguntar()` | El `AYUDA_ESPERANDO` de hoy |
| Chat | Llega el texto | Encabezado | `senala` quieta: lo que se mueve es el texto | — | primer fragmento | — |
| Chat | Respuesta completa | Encabezado | `celebra` (el de hoy) y vuelve a reposo | 220 ms | fin del stream | — |
| Chat | Error o corte | Encabezado | `saluda` quieta. Sin gesto | — | `catch` | Los de hoy |
| Hoy | Primera vez del día (en este dispositivo) | Una línea nueva debajo del día, con Lupita a 20 px a la izquierda | `saluda → saluda-alto → saluda`, una vez; después quieta (la que respira es la del menú) | 450 ms | primera carga de Hoy con fecha distinta a la guardada | Mañana: "Buen día. Hoy tenés {n}." · Tarde: "Buenas tardes. Te quedan {n} por delante." · Sin turnos: "Hoy no hay agenda. Buen momento para ponerte al día." · Con notas para revisar y sin turnos por delante: "Te quedaron {n} notas para revisar." |
| Hoy | Nota escribiéndose (lista de "en proceso", **no** la de `card-ahora`) | Dentro de `IndicadorProcesando`, en el lugar del anillo | `concentrada` a 32 px, reposo | continuo mientras dure | `enProcesoHoy` no vacío | Los de hoy: "Procesando la sesión de X" / `PROCESANDO_DETALLE`. Ella no dice nada: está trabajando |
| Todas menos `/grabar/*` | Nota lista | Franja de avisos (`avisos-de-notas.tsx`), en el lugar del `CheckCircle2`, dentro de un círculo **blanco** de 28 px (la franja es `sage-50`) | `brota` una vez, después quieta | 220 ms | aparece un `sesionId` nuevo en `useAvisosPendientes()` | El `notaListaDe(paciente)` de hoy. Con varias: igual, un solo dibujo en el resumen. **Fallida no la lleva**: sigue el `AlertCircle` |
| Grabar, antes de empezar | Recordatorio | Debajo del botón "Grabar sesión", 32 px a la izquierda del texto | `senala` hacia el texto, quieta; entra con `brota` | 220 ms | `PantallaPrevia` con autorización vigente, sin grabación pendiente y sin `muyCorta` | "Dejá la pantalla prendida mientras grabás." Si el teléfono rechazó el wake lock, **no aparece**: manda el aviso `AVISO_SIN_PANTALLA_ENCENDIDA` de siempre, que dice más |
| Grabar, grabando / enviando / llegó | — | Ni en la pantalla ni en el menú | Menú: el dibujo sale (opacidad a 0, 4 px abajo); el rótulo "Lupita" queda para que el menú no salte | 220 ms al salir | `pathname` empieza con `/grabar/` y la fase ya no es la previa | — |
| Sesión (`/sesiones/[id]`) | Aprobar nota | **Sólo menú** (borde) | `saluda → asiente → saluda` | 400 ms | el POST de aprobar volvió bien **y** `clavesDeRiesgo(...)` de esa sesión está vacío | Ninguno. El `NOTA_GUARDADA` y `AvisoAprobada` de hoy no cambian |
| Hoy, Agenda, Cobros, ficha → Turnos y pagos | Cobro registrado | **Sólo menú** | `saluda → celebra → saluda` | 450 ms | el cobro volvió bien (donde hoy se pone `COBRADO`) | Ninguno nuevo. El toast "Cobrado. Ese ya está." sigue igual y sin Lupita |
| Pacientes | Nadie cargado | Estado vacío (96 px, círculo crema) — existe | `saluda`, reposo | continuo | `kind === "noPatients"` | Los de hoy |
| Pacientes | Búsqueda sin resultado | Estado vacío — **nuevo**, hoy es un ícono | `senala`, quieta | — | `kind === "search"` | "No encontré a nadie con ese nombre." |
| Pacientes | Sin archivados | Estado vacío — **nuevo** | `saluda`, quieta | — | `kind === "noArchived"` | "No archivaste a nadie todavía." |
| Agenda | Día sin turnos | Estado vacío — existe | `saluda`, reposo | continuo | día vacío | Los de hoy |
| Agenda | Semana / mes sin turnos | Estado vacío — **nuevo** (hoy ícono) | `saluda`, quieta | — | los otros dos `EstadoVacio` de `agenda-view.tsx` | Los de hoy |
| Hoy | Día sin turnos | Estado vacío — existe | `saluda`, reposo | continuo | sin turnos y sin riesgo en el día | Los de hoy |
| Cobros | Nadie debe | Estado vacío — existe | `celebra`, reposo | continuo | `deudores.length === 0` | Los de hoy |
| Cobros | Mes sin cobros | Estado vacío — **nuevo** (hoy ícono) | `saluda`, quieta | — | los otros dos `EstadoVacio` de `cobros-view.tsx` | Los de hoy |
| Ficha, Recorrido, brief, `/sesiones/*`, `/pacientes/[id]/*` | Cualquier momento | **Sólo menú** (borde) | Menú **quieta**: sin respirar ni parpadear (ver D3) | — | `pathname` clínico | — |
| Configuración, Deudores, Finanzas | Cualquier momento | Menú | reposo | continuo | — | — |
| Entrada, registro, recuperar, términos | — | No está | — | — | — | Institucional, como hoy (`presencia.tsx` de login) |

**Una sola Lupita viva por pantalla.** Si en la pantalla hay una Lupita de
contenido que respira (un estado vacío, la del "procesando"), la del menú
se queda quieta hasta que esa sale de la vista. Dos dibujos respirando a
la vez ya son una mascota; uno es una presencia.

---

## 3. Presupuesto de movimiento

### En reposo

| Qué | Cuánto | Cómo |
|---|---|---|
| Respiración | Escala de 1 a **1,015** con origen en la base del tallo, ida y vuelta en **4 s**, curva senoidal (`ease-in-out`). A 20 px son 0,3 px; a 96 px, 1,4 px. Se nota si se mira fijo, no de reojo. | Animación CSS (`@keyframes lupita-respira` en `globals.css`), como la única excepción que ya existe (`.gira-procesando`). Corre en el compositor, no despierta a React, y la regla global de `prefers-reduced-motion` la apaga sola. |
| Parpadeo | **120 ms** cerrado. Intervalo al azar entre **3 y 8 s**; uno de cada seis es doble (dos cierres separados por 160 ms). | Un solo temporizador en el controlador (sección 4), no uno por dibujo. Sólo lo hace la Lupita viva. Se suspende con la pestaña oculta. Qué se cierra depende de D1. |

Nada más se mueve en reposo. En particular, no hay vaivén ni balanceo de
hojas en reposo: eso es `piensa` y sólo existe en el chat.

### Reacciones

Tope duro: **600 ms** ida y vuelta. Lo que se propone:

| Reacción | Duración |
|---|---|
| `brota` (aparece), salir | 220 ms (`TIEMPOS.pliegue`, ya existe) |
| saludo (`saluda-alto`) | 450 ms |
| cobro (`celebra` ida y vuelta) | 450 ms |
| aprobación (`asiente`) | 400 ms |

Reglas de convivencia:

- **Enfriamiento de 10 s** entre reacciones del menú. Cobrar cinco turnos de
  un deudor en un lote es **un** gesto, no cinco.
- Una reacción **interrumpe** la respiración y la retoma al terminar; no se
  suman escalas.
- Una reacción nunca se encola: si llega durante otra o durante el
  enfriamiento, se pierde. Mejor un gesto de menos que una fila de gestos.

### El único estado que se mueve de verdad y no es reposo

`piensa` en el chat: vaivén `senala ↔ piensa`, **900 ms por semiciclo**,
mientras no llegue el primer fragmento, con tope de **15 s**. Pasado el
tope queda `senala` quieta: si el servidor tarda, la animación no tiene que
recordárselo cada segundo.

### Lo que nunca se anima

- Nada en `/grabar/*` mientras se graba ni después: ni en la pantalla ni
  en el menú.
- Nada en pantallas con contenido clínico (nota, transcripción, "Para vos",
  ficha, brief, Recorrido): el menú está, pero quieto (D3).
- Nada que dependa de una sesión con señal de riesgo (R1).
- La posición: Lupita no camina por la pantalla, no se asoma desde un
  borde, no sigue al cursor ni al scroll.
- El color: nunca cambia de paleta, nunca pasa a terracotta, nunca se
  pone gris "dormida".
- Lo que no le pertenece: el toast, la franja entera, el texto. Se anima el
  dibujo, no lo que lo rodea.
- Sin sonido, sin vibración, sin confeti, sin globitos de diálogo que
  aparezcan solos.

### `prefers-reduced-motion`

Quieta en todas partes: sin respiración, sin parpadeo, sin gestos, sin
vaivén. Las poses que son **estado** se muestran fijas (`concentrada` en el
"procesando", `senala` esperando en el chat, `celebra` en "Nadie te debe");
las que son **gesto** (saludo, asiente, celebrar un cobro) no se muestran:
no hay cambio de pose que valga por medio segundo de movimiento. Como hoy,
el primer render (servidor e hidratación) es siempre la versión quieta
(`useMovimientoReducido`).

### Tiempos nuevos

`src/lib/movimiento.ts` gana cuatro valores, **sólo para Lupita**:
`respiracion: 4000`, `gesto: 450`, `parpadeo: 120`, `pensamiento: 900`
(`asiente` usa `gesto` con un factor fijo de 0,9, no un quinto número).
`limites-movimiento.test.tsx` sigue prohibiéndolos fuera de
`lupita.tsx`, `presencia-lupita.tsx` y el bloque `lupita-*` de
`globals.css`: la app no gana duraciones nuevas por la puerta de atrás.

---

## 4. Arquitectura mínima

### Tres piezas

1. **`src/lib/lupita-presencia.ts` — el estado, sin React.** Un almacén
   chico con el mismo patrón que `src/lib/notas-en-proceso.ts`
   (`suscribir` / `obtener` + `useSyncExternalStore`). Guarda:
   - `modo`: `"viva" | "quieta" | "oculta"`;
   - `gesto`: `null | { tipo: "saludo" | "asiente" | "cobro", n: number }`
     (el `n` sube en cada gesto, como el `toque` de hoy, para reiniciar la
     animación);
   - `ultimoGestoEn` para el enfriamiento;
   - `vivasEnContenido`: cuántas Lupitas de contenido respirando hay
     montadas y visibles.

   Y exporta **una** función para el resto de la app:

   ```ts
   avisarLupita(evento: "toque" | "aprobada" | "cobrada"): void
   ```

   Es pura y se testea sin DOM. Aplica enfriamiento, descarta si el modo no
   es `viva`, y nada más.

2. **`src/components/layout/presencia-lupita.tsx` — el controlador, uno solo.**
   Componente cliente que **se monta una vez en
   `src/app/(dashboard)/layout.tsx`**, dentro de `AyudaDelPanel`, al lado de
   `AvisosDeNotas`. No dibuja nada. Mira:
   - `usePathname()` → `oculta` en `/grabar/*`; `quieta` en rutas clínicas
     (una lista única que reemplaza a `PREFIJOS_RUTA_CLINICA` y que el panel
     de ayuda también lee); `viva` en el resto;
   - `useAvisosPendientes()` (ya existe, ya consulta) → cuando aparece un
     `sesionId` que no había, dispara el `brota` de la franja;
   - `document.visibilityState` → suspende el parpadeo con la pestaña oculta;
   - lleva **el** temporizador del parpadeo y lo publica en el almacén.

3. **`<Lupita>` crece** (`src/components/ui/lupita.tsx`): cuatro poses
   nuevas, la capa de ojos si D1 dice que sí, y tres movimientos reales:
   `respira` (una clase CSS), `parpadea` (lee el almacén) y los gestos
   (morfan `d` con framer-motion, ya que todas las poses comparten
   comandos). Un componente nuevo y chico, `LupitaDelMenu`, reemplaza a
   `LupitaMenu` y al `<Lupita>` suelto del lateral: los dos menús están
   montados a la vez (uno oculto por CSS), leen el mismo almacén y el oculto
   no pinta nada.

### Cómo llegan los eventos sin tocar la API

Ningún endpoint nuevo, ningún campo nuevo en ninguna respuesta. Cada evento
sale de un lugar del cliente que **ya sabe** que pasó:

| Evento | Quién lo emite | Dónde, hoy |
|---|---|---|
| `cobrada` | La pantalla que registró el cobro, en la misma línea donde hoy pone el toast `COBRADO` | `dashboard.tsx`, `cobros-view.tsx`, `agenda-view.tsx` / `turno-detail-sheet.tsx`, `turnos-pagos-tab.tsx` |
| `aprobada` | `sesion-detail-view.tsx`, al aplicar la fila aprobada, **sólo si** `clavesDeRiesgo(...)` de esa sesión está vacío (el dato ya está en la pantalla) | la función `aprobar()` |
| nota lista | Nadie la emite: el controlador la **deriva** de `useAvisosPendientes()` | `avisos-de-notas.tsx` / `notas-en-proceso.ts` |
| `toque` | El botón del menú, como hoy incrementa `toquesLupita` | `bottom-nav.tsx`, `sidebar.tsx` |
| saludo del día | `SaludoDeLupita` en Hoy, con una clave en `localStorage` (`lupita:saludo` = fecha local), leída y escrita en `try/catch`; si el almacenamiento falla, **no saluda** (antes que saludar en cada visita) | `saludo.tsx` |

Lo que esto implica y está bien: el saludo del día es **por dispositivo**
(teléfono y computadora saludan cada uno una vez), y el gesto de cobro no
sabe si la sesión cobrada tuvo riesgo fuera de Hoy (ver R1 y D2).

---

## 5. Archivos que se tocarían

**Lógica (cambia comportamiento, lleva tests):**

| Archivo | Qué |
|---|---|
| `src/lib/lupita-presencia.ts` | **nuevo**: almacén, `avisarLupita`, enfriamiento |
| `src/lib/movimiento.ts` | cuatro tiempos nuevos |
| `src/components/layout/presencia-lupita.tsx` | **nuevo**: controlador (ruta, avisos, parpadeo) |
| `src/app/(dashboard)/layout.tsx` | montar el controlador (una línea) |
| `src/components/ayuda/panel-ayuda.tsx` | la lista de rutas clínicas pasa a vivir en `lupita-presencia.ts`; vaivén real en `piensa` |
| `src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx` | `avisarLupita("aprobada")` condicionado a `clavesDeRiesgo` — **el único cambio en una pantalla clínica, y no dibuja nada en ella** |
| `dashboard.tsx`, `cobros-view.tsx`, `agenda-view.tsx` / `turno-detail-sheet.tsx`, `turnos-pagos-tab.tsx` | `avisarLupita("cobrada")` junto al toast |
| Tests: `lupita.test.tsx`, `limites-movimiento.test.tsx`, `panel-ayuda-movimiento.test.tsx`, `panel-ayuda.test.tsx` | se reescriben las aserciones que hoy exigen quietud |
| Tests nuevos | `lupita-presencia.test.ts` (enfriamiento, modos, descarte), firma de comandos de las siete poses, y un **guardián**: ningún archivo bajo `sesiones/[id]/`, `pacientes/[id]/`, `graficos/`, `brief*` ni `RiesgoDetectadoBanner` importa `@/components/ui/lupita` (sí puede importar `avisarLupita`) |

**Sólo presentación:**

| Archivo | Qué |
|---|---|
| `src/components/ui/lupita.tsx` | poses nuevas, tallo como cúbica, ojos (D1), movimientos |
| `src/app/globals.css` | `@keyframes lupita-respira` (y el del parpadeo si es CSS) |
| `src/components/layout/bottom-nav.tsx`, `sidebar.tsx` | `LupitaDelMenu` en lugar de lo de hoy |
| `src/components/layout/avisos-de-notas.tsx` | la cara en la franja, sobre círculo blanco (D2) |
| `src/components/ui/procesando.tsx` | prop `conLupita` que cambia el anillo por `concentrada`; por defecto `false` |
| `src/app/(dashboard)/_components/dashboard.tsx` | `conLupita` en la lista de "en proceso" (no en `card-ahora`) |
| `src/app/(dashboard)/_components/saludo.tsx` | la línea del día (`SaludoDeLupita`, cliente) |
| `src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx` | el recordatorio en `PantallaPrevia` |
| `pacientes-view.tsx`, `agenda-view.tsx`, `day-view.tsx`, `cobros-view.tsx`, `agenda-del-dia.tsx` | estados vacíos: Lupita en los que hoy tienen ícono, reposo en los que ya la tienen |
| `src/lib/glosario.ts` | los textos nuevos de la tabla |
| `docs/diseno/04-personaje.md` | se actualizan "Poses: tres, no más", "Movimiento" y la lista de contextos |
| `docs/ayuda/*` | sólo si alguna página describe el ítem de Lupita del menú (revisar con el guardián de nombres) |

**No se toca:** nada bajo `src/app/api/`, `prisma/`, el worker, `src/proxy.ts`,
`toast.tsx`, `barra-acciones.tsx`, `RiesgoDetectadoBanner.tsx`, el brief, el
Recorrido.

---

## 6. Riesgos

### R1 — Lupita en el camino de una sesión con riesgo

La regla de 04 no es "no en la pantalla del riesgo" sino "no en el camino de
esa sesión, en ninguna pantalla". Con esta especificación hay tres puntos
por donde se cuela:

- **Aprobar:** resuelto; `sesion-detail-view` tiene `clavesDeRiesgo` y no
  emite si hay algo.
- **Nota lista:** la franja no sabe si la sesión tiene señal. `AvisoServidor`
  trae `id`, `paciente`, `estado` y `fecha`, nada más. Ponerle la cara a
  ciegas es celebrar con el personaje, arriba de cualquier pantalla, justo
  la nota que trae una ideación suicida. **Decisión D2.**
- **Cobro:** en Hoy existe `riesgoEnElDia` y se usa; en Cobros, Agenda y la
  ficha no hay dato. Un cobro no es la sesión, pero 04 lo pone en la misma
  bolsa. Entra en D2.

### R2 — Clippy

Clippy no molestaba por ser un dibujo: molestaba porque **interrumpía**,
**adivinaba** y **no se callaba**. Cómo se evita cada una:

| Cómo se vuelve Clippy | Cómo no |
|---|---|
| Habla sin que le pregunten | Una sola frase no pedida en toda la app: el saludo de Hoy, **una vez por día por dispositivo**. El recordatorio de Grabar es texto de la pantalla, no un globito. Nunca un "¿Necesitás ayuda?" por inactividad, nunca un consejo por contexto. |
| Tapa lo que ella está haciendo | Nunca flota: vive en el menú, en un estado vacío o en un renglón que ya existía. No agrega capas, no se superpone a botones, no mueve el diseño cuando reacciona. |
| Reacciona a todo | Reacciona a tres cosas (su propio toque, aprobar, cobrar) con enfriamiento de 10 s y sin cola. No reacciona a navegar, a escribir, a scrollear, a errores. |
| Se mueve siempre | Reposo por debajo del umbral de reojo (1,5 %). Una sola Lupita viva por pantalla. Quieta en lo clínico. |
| Opina | No felicita rachas, no comenta cantidades ("¡5 sesiones hoy!"), no nombra pacientes en su voz, no usa "¡". Si una frase suya puede leerse como juicio sobre el trabajo, se saca. |
| No se puede ignorar | Siempre `aria-hidden`; nunca foco propio salvo el ítem del menú; nunca bloquea una acción. Si se la borra de cualquier pantalla, la pantalla dice lo mismo. |

Prueba de humo para cada texto y cada gesto antes de mergear: **¿lo
aguantaría a las 19:40, en la octava sesión del día, con la paciente de
recién todavía en la cabeza?** Si no, afuera.

### R3 — La paciente mirando

En Grabar, antes de empezar, la paciente puede estar sentada enfrente mirando
el teléfono. Un personaje que saluda en la pantalla que se usa para grabarla
cambia el tono del momento. Por eso ahí `senala` quieta, sin saludo y sin
respirar, y al tocar "Grabar sesión" se va con la pantalla (y del menú).

### R4 — Legibilidad a 20–22 px

El reposo es sub-píxel a ese tamaño: en algunos teléfonos se ve como un
temblor de antialias más que como respiración. Se prueba en un Android de
gama baja real antes de dejarlo prendido; si tiembla, a 20–22 px se
respira **sólo** con la hoja grande (1 unidad de desplazamiento de la punta)
en vez de escalar el dibujo. Y el parpadeo con ojos no se ve a ese tamaño:
ver D1.

### R5 — Costo

Siete dibujos que morfan y un temporizador. Lo que cuesta de verdad es un
`setState` por parpadeo que re-renderice los menús: el temporizador
escribe en el almacén y **sólo** el dibujo vivo se suscribe al parpadeo. La
respiración es CSS y no pasa por React.

### R6 — Tests que hoy dicen lo contrario

`lupita.test.tsx` y `limites-movimiento.test.tsx` exigen hoy que Lupita no
tenga movimiento continuo. Se reescriben a propósito, con el porqué en el
mensaje: si en la revisión aparece un diff que "arregla" esos tests sin esta
especificación al lado, está mal.

---

## 7. Qué NO entra en la primera versión

- **Etapas de la nota.** No existen: hay "Procesando". Mostrar "Subiendo →
  Transcribiendo → Escribiendo" necesita datos que el servidor no expone
  hoy (sólo `subiendo` y `procesando`) y eso es tocar la API. En v1 ella se
  sienta junto al "Procesando" de siempre, y sólo en la lista de Hoy.
- **Lupita en `card-ahora`**, aunque ahí también aparezca "Procesando": la
  card lleva el brief (04 la excluye entera).
- **Lupita en la ficha y en `/sesiones/[id]`** en cualquier forma que no sea
  la del menú quieto.
- **Lupita en el toast.** Sigue siendo `ink-900`; el cobro celebra en el
  menú.
- **Onboarding con Lupita** (los "Vamos de a poco…" de 04): es otra
  especificación.
- **Frases nuevas del chat** o cambios en `ayuda-corpus.ts`: el chat cambia
  de movimiento, no de voz.
- **Un campo de riesgo en `/api/sesion-clinica/avisos`**, aunque D2 lo
  pida: si hace falta, es una rama propia con su test de contrato, antes o
  después de esta, nunca adentro.
- **Preferencia "Lupita quieta"** en Tu consultorio. Si con `prefers-reduced-motion`
  no alcanza, se agrega en v2.
- **Lupita en la entrada, el registro o los términos**: institucional, como
  hoy.
- **Lottie, GIF, sonidos, vibración, variantes de temporada.**

---

## Decisiones que el dueño tiene que tomar antes de construir

**D1 — ¿Lupita tiene ojos?** "Parpadea" y "el aviso lleva su cara"
necesitan una cara, y el concepto A se eligió justamente por no tenerla
("la expresión está en la inclinación del tallo, no en dos ojitos"). Tres
salidas:
(a) dos puntos que aparecen desde 32 px — la del menú, a 20–22 px, igual no
podría parpadear;
(b) sin ojos: el "parpadeo" es la hoja chica que se pliega 1 unidad por
120 ms, legible a cualquier tamaño y fiel a 04;
(c) no hay parpadeo.
Recomendación: **(b)**. "Su cara" en la franja pasa a ser su dibujo en
`saluda` dentro del círculo blanco.

**D2 — La cara en "nota lista" y el riesgo.** La franja no sabe si esa sesión
trajo una señal de riesgo y no hay forma de saberlo sin tocar la API.
(a) La franja lleva a Lupita sólo después de que una rama aparte agregue un
booleano `conSenal` a `/api/sesion-clinica/avisos`;
(b) la franja no la lleva en v1;
(c) la lleva siempre, aceptando romper la regla de 04.
Recomendación: **(b) en v1 y (a) como rama siguiente**. La misma respuesta
decide el gesto de cobro fuera de Hoy.

**D3 — Qué hace en el borde de las pantallas clínicas.** La decisión dice
"respira en todas las páginas" y "puede estar en el borde" de la nota, la
ficha y el Recorrido. Esta especificación la deja **quieta** en el menú de
esas rutas (sin respirar ni parpadear) y sólo le permite el `asiente` al
aprobar una sesión sin riesgo. La alternativa es que respire también ahí,
en la visión periférica mientras se lee un bloque de riesgo. Y en la misma
línea: en la computadora el panel de ayuda es **lateral** y se abre al lado
de la nota; hoy esconde el dibujo en rutas clínicas (`esRutaClinica`).
¿"Al tocarla en cualquier lado entra al chat" incluye entrar al lado de la
nota? Recomendación: **quieta en el menú y sin dibujo en el panel en esas
rutas**, como hoy.
