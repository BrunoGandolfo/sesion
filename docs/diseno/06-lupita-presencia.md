# Lupita como presencia

Especificación para criticar **antes** de escribir código. Parte de una
decisión del dueño que no se discute acá: Lupita deja de ser un botón quieto
y pasa a ser una presencia en las pantallas del panel. Lo que sigue dice
cómo, con qué dibujos, con cuánto movimiento, qué archivos cambian y dónde
puede salir mal.

Las cuatro decisiones que quedaban abiertas (dónde vive, ojos, riesgo en el
aviso, borde clínico) están **tomadas** desde el 26-sep-2026 y aplicadas en
todo el documento; el registro está al final.

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
- **La esquina de abajo a la derecha, en el teléfono, ya está ocupada** en
  Agenda y Pacientes por el "+" flotante (`ui/fab.tsx`: `fixed bottom-20
  right-5`, 56 × 56). Ver la sección 2, "La posada".

---

## 1. Inventario de poses

Hoy hay tres. Hacen falta **cuatro más**, y cada pose gana una **variante de
hoja chica plegada** para el parpadeo (D1). Total: siete poses.

Condición para todas, nueva: **el tallo pasa a ser siempre una sola cúbica**
(`M x y C x1 y1 x2 y2 x y`) y cada hoja conserva la forma `M C C Z` que ya
tiene. Un tallo recto se escribe como cúbica con los controles sobre la
recta: se ve igual y puede morfar hacia cualquier otra pose. Un test nuevo
compara la firma de comandos de las siete poses y de sus hojas plegadas.

| # | Pose | Estado | Boceto en palabras |
|---|------|--------|--------------------|
| 1 | `saluda` | existe | Tallo vertical, hoja grande abierta a 45° a la izquierda, chica a la derecha, brote alto. **Es también la pose de reposo** y la que va en un círculo blanco cuando algo lleva "su cara". Se redibuja el tallo como cúbica. |
| 2 | `senala` | existe | Tallo inclinado 12° a la derecha, hoja grande estirada hacia ese lado, la chica atrás de contrapeso. Se usa para "mirá esto" y como un extremo del vaivén de `piensa`. |
| 3 | `celebra` | existe | Tallo vertical, las dos hojas arriba, punto dorado separado 3 px de la punta. Se redibuja el tallo como cúbica. |
| 4 | `saluda-alto` | **nueva** | Igual a `saluda` pero la hoja grande sube por encima de la horizontal, casi vertical, como una mano levantada; la chica no se mueve y el tallo se endereza medio punto. Es el cuadro del medio del saludo: `saluda → saluda-alto → saluda`. |
| 5 | `concentrada` | **nueva** | "Sentada": el tallo se acorta un 25 % (arranca más abajo, la base no se mueve) y se curva hacia adelante, hacia el texto de al lado; la hoja grande se pliega pegada al tallo, como brazos cruzados; la chica queda casi cerrada; el brote baja 2 unidades. Quieta y compacta: se lee "está trabajando", no "está triste". |
| 6 | `piensa` | **nueva** | Espejo parcial de `senala`: tallo inclinado 8° a la **izquierda**, hoja grande recogida hacia arriba, la chica abierta hacia la derecha. Sola no se usa: es el otro extremo del vaivén `senala ↔ piensa` del chat. |
| 7 | `asiente` | **nueva** | La mitad de arriba del tallo se dobla 15° hacia adelante y el brote baja 1,5 unidades; las hojas bajan con él sin cerrarse. Es el cuadro del medio de un "sí" con la cabeza: `saluda → asiente → saluda`. |
| — | *hoja chica plegada* (variante de cada pose) | **nueva** | **Sin ojos (D1).** La hoja chica se cierra sobre su nervio: el mismo `M C C Z` con los dos controles llevados casi sobre la línea que une base y punta, de modo que queda como una hoja doblada de canto. Un cuadro de 120 ms y vuelve. Eso es el parpadeo. En `concentrada`, donde la chica ya está casi cerrada, el parpadeo casi no se ve, y está bien: está concentrada. |

Lo que **no** se dibuja, igual que en 04: ni cara, ni ojos, ni triste, ni
error, ni dormida, ni "cargando". En un error hablan las palabras; en una
espera, el indicador.

No hace falta pose para "aparece" ni "se retira": son opacidad + 4 px de
desplazamiento vertical del grupo entero (`brota`, y `brota` invertido
para salir), y trasladar no le cambia el peso al trazo como sí lo hace rotar.

---

## 2. Pantalla × momento

### La posada (D0)

La presencia permanente **no** es el ítem del menú. Es un dibujo aparte,
**la posada**:

- **En el teléfono:** posada **sobre** el menú de abajo, en la esquina
  derecha, con la base del tallo apoyada en el borde superior de la barra,
  como si estuviera parada ahí. **34 px** (dentro del rango 32–36 del dueño;
  en la grilla de 24 da un trazo de 2,6 px, que todavía se lee como el de
  los íconos del menú). Fondo: lo que haya detrás, que en estas cinco
  pantallas es `cream-50` o una card blanca; nunca salvia.
  - **No toca el recorrido del pulgar sobre los ítems:** su área tocable
    (44 × 44) empieza en el borde superior del menú y sube; no pisa ni un
    píxel de la barra.
  - **No tapa botones: el "+" flotante sube.** Hoy el "+" de Agenda y
    Pacientes está en `bottom-20 right-5` (80 px del fondo, 56 de alto) y
    el menú mide ~61 px: la posada ocuparía de 61 a 95 px, justo debajo y
    detrás del "+". El "+" pasa a apoyarse **arriba** de la posada
    (`bottom` = alto del menú + 34 + 12 de aire ≈ 108 px), y el toast, que
    hoy se calcula contra el flotante más alto (`BOTTOM_MOBILE = 160` en
    `toast.tsx`), se recalcula contra ese nuevo tope. El flotante de grabar
    de la ficha no se mueve: en la ficha la posada no está. Los tres números
    (alto del menú, tamaño de la posada, aire) pasan a ser constantes
    compartidas, no números sueltos en tres archivos.
  - **No tapa contenido:** el `pb-20` del `<main>` crece lo que mide la
    posada, para que al final del scroll el último renglón quede por encima
    de ella. Mientras se scrollea, el contenido pasa por detrás, como pasa
    hoy por detrás del "+".
  - Con un sheet abierto (formularios, el panel de ayuda) la posada se
    retira: el velo la cubriría igual, y en el caso del chat ella "se muda"
    al encabezado del panel.
- **En la computadora:** un sitio fijo en el lateral (`cream-100`), del
  mismo tamaño, al pie de la lista de destinos y **encima del bloque de
  usuario**, alineada con los íconos. El lateral es `sticky` y de alto de
  pantalla, así que está siempre a la vista.
- **Dónde aparece:** sólo en **Hoy (`/`), Agenda (`/agenda`), Pacientes
  (`/pacientes`, la lista), Cobros (`/cobros`) y Configuración (`/config`)**.
  Es una lista de permitidas, no de prohibidas: una ruta nueva, o las que
  hoy quedan fuera (`/deudores`, `/finanzas`), no la tienen hasta que
  alguien la agregue a propósito.
- **Dónde se retira** (sale con `brota` invertido, 220 ms): `/grabar/*` y
  todas las rutas clínicas —ficha (`/pacientes/[id]/*`, que incluye
  Recorrido, brief y Turnos y pagos) y nota (`/sesiones/*`, que incluye
  transcripción y "Para vos")— (D3). También se retira en Hoy el día en que
  `riesgoEnElDia` es verdadero: la regla de 04 ("ese día Lupita no aparece
  en Hoy") ahora alcanza a la posada.
- **El ítem 5 del menú** (y el de Lupita del lateral) **sigue existiendo**
  como acceso al chat, **quieto**, con su dibujo de 20 px y su rótulo. Se
  saca el saltito de 150 ms (`LupitaMenu`): la que vive es la posada.
- **La posada también se toca:** abre el chat igual que el ítem. Es un
  atajo de puntero: `aria-hidden` y fuera del orden de tabulación, porque
  el ítem del menú ya es el control accesible y dos botones con el mismo
  nombre uno arriba del otro confunden a un lector de pantalla.

### Convenciones de la tabla

- **Posada** = lo de arriba. **Reposo** = respira + parpadea (sección 3).
- Duraciones de gesto son ida y vuelta completas.
- Los textos son **propuestas**; van a `src/lib/glosario.ts` como todo texto.
- Toda fila está sujeta a la **regla del riesgo** (sección 6, R1).

| Pantalla | Momento | Dónde | Pose / movimiento | Duración | Disparador | Texto (propuesta) |
|---|---|---|---|---|---|---|
| Hoy, Agenda, Pacientes, Cobros, Config | Reposo | Posada | `saluda`, reposo | continuo | la ruta está en la lista y no hay otra Lupita viva en pantalla | — |
| Esas cinco | Llega a la pantalla | Posada | `brota` | 220 ms | se entra a una de las cinco desde una ruta donde estaba retirada. Entre dos de las cinco **no** se retira ni vuelve a brotar: se queda | — |
| Cualquier otra ruta del panel | Sale | Posada | `brota` invertido | 220 ms | se entra a `/grabar/*`, a una ruta clínica o a una fuera de la lista | — |
| Donde esté la posada | Ella toca la posada o el ítem del menú | Posada → panel | Posada: `saluda → saluda-alto → saluda` y se retira; panel: `brota` en el encabezado (72 px), después reposo | 450 ms + 220 ms, en secuencia | toque en la posada, o toque / Enter / Espacio en el ítem | El `AYUDA_BIENVENIDA` de hoy, sin cambios |
| Rutas sin posada | Ella toca el ítem del menú | Panel | Como hoy: `brota` en el encabezado **salvo en rutas clínicas y `/grabar/*`, donde el panel va sin dibujo** (D3) | 220 ms | ítem del menú | Los de hoy |
| Chat | Esperando la respuesta | Encabezado del panel | vaivén `senala ↔ piensa`, hojas incluidas | 900 ms por semiciclo; se corta al primer fragmento o a los 15 s (queda `senala` quieta) | `preguntar()` | El `AYUDA_ESPERANDO` de hoy |
| Chat | Llega el texto | Encabezado | `senala` quieta: lo que se mueve es el texto | — | primer fragmento | — |
| Chat | Respuesta completa | Encabezado | `celebra` (el de hoy) y vuelve a reposo | 220 ms | fin del stream | — |
| Chat | Error o corte | Encabezado | `saluda` quieta. Sin gesto | — | `catch` | Los de hoy |
| Chat | Se cierra | Posada | vuelve con `brota` si la ruta la admite | 220 ms | cierre del panel | — |
| Hoy | Primera vez del día (en este dispositivo) | Posada hace el gesto; la **línea** va debajo del día, en el encabezado, sin dibujo propio (el dibujo es la posada: dos Lupitas a la vez sería una de más) | `saluda → saluda-alto → saluda`, una vez | 450 ms | primera carga de Hoy con fecha distinta a la guardada, sin riesgo en el día | Mañana: "Buen día. Hoy tenés {n}." · Tarde: "Buenas tardes. Te quedan {n} por delante." · Sin turnos: "Hoy no hay agenda. Buen momento para ponerte al día." · Con notas para revisar y sin turnos por delante: "Te quedaron {n} notas para revisar." |
| Hoy | Nota escribiéndose (lista de "en proceso", **no** la de `card-ahora`) | Dentro de `IndicadorProcesando`, en el lugar del anillo | `concentrada` a 32 px, reposo. La posada, quieta (una sola viva) | continuo mientras dure | `enProcesoHoy` no vacío | Los de hoy: "Procesando la sesión de X" / `PROCESANDO_DETALLE`. Ella no dice nada: está trabajando |
| Todas | Nota lista | — | **Sin Lupita en v1 (D2).** La franja sigue con su `CheckCircle2`. Cuando una rama aparte agregue el dato de riesgo a la respuesta del aviso, "su cara" es `saluda` en un círculo blanco de 28 px en el lugar del ícono (la franja es `sage-50`), con `brota` una vez y sólo si esa sesión no tiene señal | — | — | El `notaListaDe(paciente)` de hoy |
| Grabar, antes de empezar | Recordatorio | En el contenido, debajo del botón "Grabar sesión", 32 px a la izquierda del texto. La posada ya se retiró (D0) | `senala` hacia el texto, quieta; entra con `brota` | 220 ms | `PantallaPrevia` con autorización vigente, sin grabación pendiente y sin `muyCorta` | "Dejá la pantalla prendida mientras grabás." Si el teléfono rechazó el wake lock, **no aparece**: manda el aviso `AVISO_SIN_PANTALLA_ENCENDIDA` de siempre, que dice más |
| Grabar, grabando / enviando / llegó | — | En ningún lado | La del recordatorio sale con `brota` invertido al tocar "Grabar sesión"; la posada ya no estaba | 220 ms | la fase deja de ser la previa | — |
| Sesión (`/sesiones/[id]`) | Aprobar nota | **Ahí no**: la posada está retirada (D3). El gesto se **guarda** y lo hace la posada la próxima vez que aparece | al volver a una de las cinco pantallas: `brota` y enseguida `saluda → asiente → saluda` | 220 + 400 ms | el POST de aprobar volvió bien **y** `clavesDeRiesgo(...)` de esa sesión está vacío. Se guarda uno solo y vence a los 10 min | Ninguno. El `NOTA_GUARDADA` y `AvisoAprobada` de hoy no cambian |
| Hoy | Cobro registrado | Posada | `saluda → celebra → saluda` | 450 ms | el cobro volvió bien (donde hoy se pone `COBRADO` en `dashboard.tsx`) **y** `riesgoEnElDia` es falso | Ninguno nuevo. El toast "Cobrado. Ese ya está." sigue igual y sin Lupita |
| Agenda, Cobros | Cobro registrado | — | **Sin gesto en v1 (D2)**: esas pantallas no saben si la sesión cobrada tuvo señal. Llega con el mismo dato que habilita el aviso | — | — | El toast de hoy |
| Pacientes | Nadie cargado | Estado vacío (96 px, círculo crema) — existe | `saluda`, reposo; la posada, quieta | continuo | `kind === "noPatients"` | Los de hoy |
| Pacientes | Búsqueda sin resultado | Estado vacío — **nuevo**, hoy es un ícono | `senala`, reposo | continuo | `kind === "search"` | "No encontré a nadie con ese nombre." |
| Pacientes | Sin archivados | Estado vacío — **nuevo** | `saluda`, reposo | continuo | `kind === "noArchived"` | "No archivaste a nadie todavía." |
| Agenda | Día sin turnos | Estado vacío — existe | `saluda`, reposo | continuo | día vacío | Los de hoy |
| Agenda | Semana / mes sin turnos | Estado vacío — **nuevo** (hoy ícono) | `saluda`, reposo | continuo | los otros dos `EstadoVacio` de `agenda-view.tsx` | Los de hoy |
| Hoy | Día sin turnos | Estado vacío — existe (72 px) | `saluda`, reposo | continuo | sin turnos y sin riesgo en el día | Los de hoy |
| Cobros | Nadie debe | Estado vacío — existe | `celebra`, reposo | continuo | `deudores.length === 0` | Los de hoy |
| Cobros | Mes sin cobros | Estado vacío — **nuevo** (hoy ícono) | `saluda`, reposo | continuo | los otros dos `EstadoVacio` de `cobros-view.tsx` | Los de hoy |
| Ficha, Recorrido, brief, `/sesiones/*`, `/pacientes/[id]/*` | Cualquier momento | **En ningún lado** (D3): posada retirada, panel sin dibujo, ítem del menú quieto | — | — | `pathname` clínico | — |
| `/deudores`, `/finanzas` | Cualquier momento | Posada retirada (fuera de la lista) | — | — | — | — |
| Entrada, registro, recuperar, términos | — | No está | — | — | — | Institucional, como hoy (`presencia.tsx` de login) |

**Una sola Lupita viva por pantalla.** Si en la pantalla hay una Lupita de
contenido de 32 px o más a la vista (un estado vacío, la del "procesando"),
la posada se queda **quieta** —sin respirar ni parpadear— hasta que esa
sale de la vista. Los gestos de la posada (saludo, cobro, aprobación
guardada) sí se hacen igual: son medio segundo y responden a algo que ella
hizo. Dos dibujos respirando a la vez ya son una mascota; uno es una
presencia.

---

## 3. Presupuesto de movimiento

### En reposo

Sólo respira y parpadea un dibujo de **32 px o más** (`TAMANO_CON_DETALLE`,
el mismo umbral que el punto dorado): la posada (34), la del "procesando"
(32), los estados vacíos (72–96) y el encabezado del panel (72). Los de
20 px —los ítems de menú, las líneas del chat— son siempre quietos. A
34 px el movimiento **sí se ve**, así que el número se elige para que se
vea poco, no para que no se vea:

| Qué | Cuánto | Cómo |
|---|---|---|
| Respiración | Escala de 1 a **1,02** con origen en la base del tallo, ida y vuelta en **4 s**, curva senoidal (`ease-in-out`). A 34 px es 0,7 px arriba del brote; a 96 px, 1,9 px. Se nota si se la mira; de reojo, apenas algo vivo en la esquina. | Animación CSS (`@keyframes lupita-respira` en `globals.css`), como la única excepción que ya existe (`.gira-procesando`). Corre en el compositor, no despierta a React, y la regla global de `prefers-reduced-motion` la apaga sola. |
| Parpadeo | La hoja chica se pliega (sección 1) durante **120 ms** y vuelve. Intervalo al azar entre **4 y 9 s**; uno de cada seis es doble (dos pliegues separados por 160 ms). A 34 px el pliegue recorre ~3 px: se ve, por eso el intervalo es más largo que un parpadeo humano. | Un solo temporizador en el componente de presencia (sección 4), no uno por dibujo. Sólo lo hace la Lupita viva. Se suspende con la pestaña oculta. |

Nada más se mueve en reposo. En particular, no hay vaivén ni balanceo en
reposo: eso es `piensa` y sólo existe en el chat.

### Reacciones

Tope duro: **600 ms** por reacción. Lo que se propone:

| Reacción | Duración |
|---|---|
| `brota` (llega), `brota` invertido (se retira) | 220 ms (`TIEMPOS.pliegue`, ya existe) |
| saludo (`saluda-alto`) | 450 ms |
| cobro (`celebra` ida y vuelta) | 450 ms |
| aprobación (`asiente`) | 400 ms |

La única secuencia es la aprobación guardada: `brota` (220) y después
`asiente` (400). Son dos reacciones seguidas, cada una bajo el tope, no una
de 620.

Reglas de convivencia:

- **Enfriamiento de 10 s** entre gestos de la posada. Cobrar varios turnos
  seguidos en Hoy es **un** gesto, no varios.
- Un gesto **interrumpe** la respiración y la retoma al terminar; no se
  suman escalas.
- Un gesto nunca se encola: si llega durante otro o durante el
  enfriamiento, se pierde. Mejor un gesto de menos que una fila de gestos.
  La excepción es la aprobación guardada, que espera a que la posada
  vuelva (una sola, vence a los 10 min).

### El único estado que se mueve de verdad y no es reposo

`piensa` en el chat: vaivén `senala ↔ piensa`, **900 ms por semiciclo**,
mientras no llegue el primer fragmento, con tope de **15 s**. Pasado el
tope queda `senala` quieta: si el servidor tarda, la animación no tiene que
recordárselo cada segundo.

### Lo que nunca se anima

- Nada en `/grabar/*` salvo el `brota` de entrada y salida del
  recordatorio previo. Nada mientras se graba ni después.
- Nada en las rutas clínicas: ahí no hay Lupita (D3).
- Nada que dependa de una sesión con señal de riesgo (R1).
- La posición: la posada no camina por la pantalla, no se asoma desde un
  borde, no sigue al cursor ni al scroll. Llega y se va en su lugar.
- El color: nunca cambia de paleta, nunca pasa a terracotta, nunca se
  pone gris "dormida".
- Lo que no le pertenece: el toast, la franja, el menú, el "+", el texto.
  Se anima el dibujo, no lo que lo rodea.
- El ítem del menú: quieto siempre.
- Sin sonido, sin vibración, sin confeti, sin globitos de diálogo.

### `prefers-reduced-motion`

Quieta en todas partes: sin respiración, sin parpadeo, sin gestos, sin
vaivén. La posada aparece y desaparece en su lugar, sin `brota`. Las poses
que son **estado** se muestran fijas (`concentrada` en el "procesando",
`senala` esperando en el chat, `celebra` en "Nadie te debe"); las que son
**gesto** (saludo, asiente, celebrar un cobro) no se muestran: no hay cambio
de pose que valga por medio segundo de movimiento. Como hoy, el primer
render (servidor e hidratación) es siempre la versión quieta
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
   - `visible`: si la ruta actual admite la posada (la **lista de rutas
     permitidas** vive acá, y también la de rutas clínicas que hoy es
     `PREFIJOS_RUTA_CLINICA` y que el panel de ayuda pasa a leer de acá);
   - `retiradaPor`: motivos que la sacan aunque la ruta la admita (`sheet`,
     `riesgo-del-dia`);
   - `gesto`: `null | { tipo: "saludo" | "asiente" | "cobro", n: number }`
     (el `n` sube en cada gesto para reiniciar la animación);
   - `aprobacionGuardada`: marca de tiempo o `null`;
   - `ultimoGestoEn` para el enfriamiento;
   - `vivasEnContenido`: cuántas Lupitas de contenido de ≥ 32 px hay a la
     vista.

   Y exporta para el resto de la app:

   ```ts
   avisarLupita(evento: "toque" | "aprobada" | "cobrada"): void
   retirarLupita(motivo: "riesgo-del-dia", activo: boolean): void
   ```

   Es pura y se testea sin DOM. Aplica enfriamiento, guarda la aprobación
   si la posada no está, descarta el resto si no está, y nada más.

2. **`src/components/layout/presencia-lupita.tsx` — la posada, una sola.**
   Componente cliente que **se monta una vez en
   `src/app/(dashboard)/layout.tsx`**, dentro de `AyudaDelPanel`. **Es el
   único que dibuja la posada**; los menús ya no animan nada. Hace:
   - lee `usePathname()` y lo pasa al almacén;
   - dibuja un `<button>` `fixed` en el teléfono (`right` alineado con el
     ítem 5, `bottom` = alto del menú) y, en la computadora, el mismo
     botón **por portal** dentro de un hueco que `sidebar.tsx` expone
     arriba del bloque de usuario. Una instancia, un estado, dos lugares
     según el ancho;
   - lleva **el** temporizador del parpadeo;
   - al tocarla: `avisarLupita("toque")` y, terminado el saludo, abre el
     panel con `useAbrirAyuda()`;
   - suspende el parpadeo con la pestaña oculta y se retira mientras haya
     un sheet abierto.

3. **`<Lupita>` crece** (`src/components/ui/lupita.tsx`): cuatro poses
   nuevas, la hoja chica plegada en cada una, y tres movimientos reales:
   `respira` (una clase CSS), `parpadea` (lee el almacén) y los gestos
   (morfan `d` con framer-motion, ya que todas las poses comparten
   comandos). `LupitaMenu` desaparece: el ítem del menú y el del lateral
   dibujan un `<Lupita pose="saluda" tamano={20}>` quieto.

Las Lupitas de contenido (estados vacíos, "procesando") se anotan en el
almacén al entrar en la vista (`IntersectionObserver`) y se borran al
salir: así la posada sabe cuándo quedarse quieta.

### Cómo llegan los eventos sin tocar la API

Ningún endpoint nuevo, ningún campo nuevo en ninguna respuesta. Cada evento
sale de un lugar del cliente que **ya sabe** que pasó:

| Evento | Quién lo emite | Dónde, hoy |
|---|---|---|
| `cobrada` | `dashboard.tsx`, en la misma línea donde hoy pone el toast `COBRADO`, sólo si `riesgoEnElDia` es falso. **Sólo Hoy en v1 (D2)** | la función que cobra en Hoy |
| `aprobada` | `sesion-detail-view.tsx`, al aplicar la fila aprobada, **sólo si** `clavesDeRiesgo(...)` de esa sesión está vacío (el dato ya está en la pantalla). La posada está retirada: el almacén la guarda para cuando vuelva | la función `aprobar()` |
| `retirarLupita("riesgo-del-dia", …)` | `dashboard.tsx`, con el `riesgoEnElDia` que ya calcula | el mismo lugar donde se lo pasa a `AgendaDelDia` |
| `toque` | La posada misma; y el ítem del menú / del lateral, además de abrir el panel como hoy | `presencia-lupita.tsx`, `bottom-nav.tsx`, `sidebar.tsx` |
| saludo del día | `SaludoDeLupita` en Hoy, con una clave en `localStorage` (`lupita:saludo` = fecha local), leída y escrita en `try/catch`; si el almacenamiento falla, **no saluda** (antes que saludar en cada visita) | `saludo.tsx` |
| nota lista | **Nadie en v1 (D2).** Cuando exista el dato de riesgo, se deriva de `useAvisosPendientes()` sin emisor | — |

Lo que esto implica y está bien: el saludo del día es **por dispositivo**
(teléfono y computadora saludan cada uno una vez).

---

## 5. Archivos que se tocarían

**Lógica (cambia comportamiento, lleva tests):**

| Archivo | Qué |
|---|---|
| `src/lib/lupita-presencia.ts` | **nuevo**: almacén, rutas permitidas y clínicas, `avisarLupita`, `retirarLupita`, enfriamiento, aprobación guardada |
| `src/lib/movimiento.ts` | cuatro tiempos nuevos |
| `src/components/layout/presencia-lupita.tsx` | **nuevo**: la posada (dibujo, posición, portal al lateral, parpadeo, toque) |
| `src/app/(dashboard)/layout.tsx` | montar la posada (una línea) y agrandar el `pb` del `<main>` |
| `src/components/ayuda/panel-ayuda.tsx` | la lista de rutas clínicas pasa a vivir en `lupita-presencia.ts`; vaivén real en `piensa`; sin dibujo en rutas clínicas, como hoy |
| `src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx` | `avisarLupita("aprobada")` condicionado a `clavesDeRiesgo` — **el único cambio en una pantalla clínica, y no dibuja nada en ella** |
| `src/app/(dashboard)/_components/dashboard.tsx` | `avisarLupita("cobrada")` y `retirarLupita("riesgo-del-dia", …)` |
| Tests: `lupita.test.tsx`, `limites-movimiento.test.tsx`, `panel-ayuda-movimiento.test.tsx`, `panel-ayuda.test.tsx` | se reescriben las aserciones que hoy exigen quietud |
| Tests nuevos | `lupita-presencia.test.ts` (rutas permitidas, retiro, enfriamiento, aprobación guardada y su vencimiento), firma de comandos de las siete poses y sus hojas plegadas, y un **guardián**: ningún archivo bajo `sesiones/[id]/`, `pacientes/[id]/`, `graficos/`, `brief*` ni `RiesgoDetectadoBanner` importa `@/components/ui/lupita` (sí puede importar `avisarLupita`) |

**Sólo presentación:**

| Archivo | Qué |
|---|---|
| `src/components/ui/lupita.tsx` | poses nuevas, tallo como cúbica, hoja chica plegada, movimientos; se va `LupitaMenu` |
| `src/app/globals.css` | `@keyframes lupita-respira` |
| `src/components/layout/bottom-nav.tsx` | el ítem 5 pasa a dibujo quieto; se va el contador de toques |
| `src/components/layout/sidebar.tsx` | el ítem queda quieto; el hueco para la posada arriba del bloque de usuario |
| `src/components/ui/fab.tsx` | el "+" sube arriba de la posada en el teléfono |
| `src/components/ui/toast.tsx` | `BOTTOM_MOBILE` se recalcula contra el nuevo tope del "+" (sólo esa constante: el toast sigue sin Lupita) |
| `src/components/ui/procesando.tsx` | prop `conLupita` que cambia el anillo por `concentrada`; por defecto `false` |
| `src/app/(dashboard)/_components/dashboard.tsx` | `conLupita` en la lista de "en proceso" (no en `card-ahora`) |
| `src/app/(dashboard)/_components/saludo.tsx` | la línea del día (`SaludoDeLupita`, cliente, sin dibujo propio) |
| `src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx` | el recordatorio en `PantallaPrevia` |
| `pacientes-view.tsx`, `agenda-view.tsx`, `day-view.tsx`, `cobros-view.tsx`, `agenda-del-dia.tsx` | estados vacíos: Lupita en los que hoy tienen ícono, reposo en los que ya la tienen |
| `src/lib/glosario.ts` | los textos nuevos de la tabla |
| `docs/diseno/04-personaje.md` | se actualizan "Poses: tres, no más", "Movimiento", "Sin cara" (sigue sin cara; el parpadeo es la hoja) y la lista de contextos |
| `docs/ayuda/*` | sólo si alguna página describe el ítem de Lupita del menú o la esquina del "+" (revisar con el guardián de nombres) |

**No se toca:** nada bajo `src/app/api/`, `prisma/`, el worker,
`src/proxy.ts`, `avisos-de-notas.tsx` (D2), `barra-acciones.tsx`,
`RiesgoDetectadoBanner.tsx`, el brief, el Recorrido, `card-ahora.tsx`.

---

## 6. Riesgos

### R1 — Lupita en el camino de una sesión con riesgo

La regla de 04 no es "no en la pantalla del riesgo" sino "no en el camino de
esa sesión, en ninguna pantalla". Cómo queda cada punto:

- **Aprobar:** `sesion-detail-view` tiene `clavesDeRiesgo` y no guarda el
  gesto si hay algo. El gesto se hace después, lejos de la nota.
- **Nota lista:** sin Lupita en v1 (D2). La franja no sabe si la sesión
  tiene señal (`AvisoServidor` trae `id`, `paciente`, `estado` y `fecha`).
- **Cobro:** sólo en Hoy y sólo sin `riesgoEnElDia` (D2).
- **Hoy con riesgo en el día:** la posada se retira de Hoy, además del
  vacío que ya se retiraba.

### R2 — Clippy

Clippy no molestaba por ser un dibujo: molestaba porque **interrumpía**,
**adivinaba** y **no se callaba**. Y la posada, a diferencia del ítem del
menú, está **sobre** la pantalla: es el punto donde esto más fácil se
vuelve Clippy. Cómo se evita cada cosa:

| Cómo se vuelve Clippy | Cómo no |
|---|---|
| Habla sin que le pregunten | Una sola frase no pedida en toda la app: el saludo de Hoy, **una vez por día por dispositivo**, en el encabezado y no en un globito junto a ella. El recordatorio de Grabar es texto de la pantalla. Nunca un "¿Necesitás ayuda?" por inactividad, nunca un consejo por contexto. |
| Tapa lo que ella está haciendo | Vive en una esquina que se le reserva (el "+" sube, el `pb` crece), fuera de la barra y del recorrido del pulgar. Se retira con cualquier sheet. No se superpone a botones ni mueve el diseño cuando reacciona. |
| Reacciona a todo | Reacciona a tres cosas (su propio toque, aprobar, cobrar en Hoy) con enfriamiento de 10 s y sin cola. No reacciona a navegar entre sus cinco pantallas, a escribir, a scrollear, a errores. |
| Se mueve siempre | Reposo chico (2 %, un parpadeo cada 4–9 s). Una sola Lupita viva por pantalla. Ausente en lo clínico. |
| Opina | No felicita rachas, no comenta cantidades ("¡5 sesiones hoy!"), no nombra pacientes en su voz, no usa "¡". Si una frase suya puede leerse como juicio sobre el trabajo, se saca. |
| No se puede ignorar | Siempre `aria-hidden`; la posada no toma foco; nunca bloquea una acción. Si se la borra de cualquier pantalla, la pantalla dice lo mismo. |

Prueba de humo para cada texto y cada gesto antes de mergear: **¿lo
aguantaría a las 19:40, en la octava sesión del día, con la paciente de
recién todavía en la cabeza?** Si no, afuera.

### R3 — La paciente mirando

En Grabar, antes de empezar, la paciente puede estar sentada enfrente mirando
el teléfono. Por eso ahí la posada ya se fue, el recordatorio es `senala`
quieta, sin saludo y sin respirar, y al tocar "Grabar sesión" se va.

### R4 — La esquina en el teléfono

La posada fija en la esquina derecha se cruza con tres cosas que hay que
mirar en un teléfono real (390 px) antes de dejarla prendida:

- **El "+"**: resuelto subiéndolo (sección 2), pero cambia un lugar que
  ella ya tiene en la memoria del pulgar. Se prueba en Agenda y Pacientes.
- **El teclado**: en algunos navegadores, al abrir el teclado los
  elementos `fixed bottom` suben con él. Mientras haya un campo de texto
  con foco fuera de un sheet (el buscador de Pacientes), la posada se
  retira.
- **La franja de avisos y el toast** no chocan (arriba y a 160+ px), pero
  el toast centrado de ancho máximo pasa por encima de la esquina: se
  verifica que no la tape a medias.

### R5 — Costo

Siete dibujos que morfan y un temporizador. Lo que cuesta de verdad es un
`setState` por parpadeo: el temporizador escribe en el almacén y **sólo**
el dibujo vivo se suscribe al parpadeo. La respiración es CSS y no pasa por
React. Los menús ya no se suscriben a nada.

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
- **Lupita en el aviso de "nota lista"** y **gesto de cobro fuera de Hoy**
  (D2): esperan a que una rama aparte agregue el dato de riesgo a la
  respuesta de `/api/sesion-clinica/avisos`, con su test de contrato. Esa
  rama no es ésta.
- **Lupita en `card-ahora`**, aunque ahí también aparezca "Procesando": la
  card lleva el brief (04 la excluye entera).
- **Lupita en cualquier ruta clínica o en `/grabar/*`** fuera del
  recordatorio previo (D3).
- **La posada en `/deudores` y `/finanzas`**: quedan fuera de la lista de
  permitidas hasta que alguien las agregue a propósito.
- **Lupita en el toast.** Sigue siendo `ink-900`.
- **Onboarding con Lupita** (los "Vamos de a poco…" de 04): es otra
  especificación.
- **Frases nuevas del chat** o cambios en `ayuda-corpus.ts`: el chat cambia
  de movimiento, no de voz.
- **Preferencia "Lupita quieta"** en Tu consultorio. Si con
  `prefers-reduced-motion` no alcanza, se agrega en v2.
- **Lupita en la entrada, el registro o los términos**: institucional, como
  hoy.
- **Ojos, cara, Lottie, GIF, sonidos, vibración, variantes de temporada.**

---

## Decisiones tomadas (26-sep-2026)

El dueño leyó la primera versión de esta especificación y decidió. Quedan
aplicadas en todo el documento.

**D0 — Dónde vive en reposo.** No en el ítem del menú. Lupita queda
**posada** sobre la barra inferior, en la esquina derecha, apoyada en el
borde superior de la barra, de 32 a 36 px (se eligió 34), sin tapar
contenido ni botones y fuera del recorrido del pulgar sobre los ítems.
Aparece en Hoy, Agenda, Pacientes, Cobros y Configuración; se retira (sale
con `brota` invertido) en `/grabar/*` y en las rutas clínicas (ficha, nota,
Recorrido, brief). El ítem 5 del menú sigue como acceso al chat, quieto, con
su rótulo. En la computadora, el equivalente es un sitio fijo en el lateral,
del mismo tamaño. Se mantiene "una sola Lupita viva por pantalla": con una
Lupita de contenido a la vista, la posada se queda quieta.
*Consecuencia que esta especificación resuelve:* el "+" flotante de Agenda y
Pacientes ocupaba esa esquina y sube; el toast se recalcula.

**D1 — Sin ojos.** El parpadeo es la hoja chica plegándose 120 ms. "Su
cara", en cualquier aviso, es su dibujo en `saluda` dentro de un círculo
blanco.

**D2 — (b) en v1.** El aviso de "nota lista" no lleva a Lupita hasta que
una rama aparte agregue el dato de riesgo a la respuesta del aviso. Lo mismo
para celebrar cobros fuera de Hoy.

**D3 — Borde clínico.** En las pantallas clínicas, con D0, directamente
retirada; y sin dibujo en el panel de ayuda en esas rutas, como hoy.
*Consecuencia:* el gesto de aprobar una nota, que ocurre en una ruta
clínica, se guarda y lo hace la posada al volver a una de sus cinco
pantallas.
