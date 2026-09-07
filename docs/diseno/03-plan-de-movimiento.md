# Plan de movimiento

Auditoría de `src/components/ui/movimiento.tsx` y un plan de deltas.
Sin código: cada delta dice pantalla, archivo y línea, duración, curva, qué
sensación busca y cómo se degrada con `prefers-reduced-motion`.

Dos reglas duras que ningún delta puede romper:

1. **Nada suma más de 150 ms a una interacción frecuente.** Frecuente es lo
   que Mariana hace entre paciente y paciente: abrir Hoy, tocar Cobrar,
   elegir método, aprobar una nota, abrir la ficha. El presupuesto de un
   camino completo (entrada de página + entrada de bloque) es 240 ms, y hoy
   ya se gasta casi entero.
2. **`prefers-reduced-motion` degrada a estático, no a "más corto".** Es la
   regla que ya declara el encabezado de `movimiento.tsx:31-33` y que hoy
   tres archivos incumplen.

---

## 1. Qué existe hoy

Siete primitivos y un hook, todos en `src/components/ui/movimiento.tsx`:

| Primitivo | Línea | Duración / curva | Qué significa |
| --- | --- | --- | --- |
| `Aparece` | `movimiento.tsx:84` | 240 ms · `[0.16,1,0.3,1]` · +6 px | "algo entró" |
| `ListaEnCascada` | `movimiento.tsx:132` | 40 ms de paso, tope 8 ítems | "esta lista se lee de arriba abajo" |
| `AlturaAnimada` | `movimiento.tsx:192` | 220 ms · misma curva | "esto se abrió acá mismo" |
| `Contador` | `movimiento.tsx:248` | 600 ms | "este número se acaba de calcular" |
| `Latido` | `movimiento.tsx:296` | ciclo 1,8 s · opacidad 1→0,45 | "esto está pasando ahora" |
| `CheckDibujado` | `movimiento.tsx:341` | 300 ms de trazo | "lo que pediste se hizo" |
| `AnilloProgreso` | `movimiento.tsx:435` | giro 1,1 s, indeterminado | "está trabajando" |
| `useConfirmacionDibujada` | `movimiento.tsx:388` | 300 + 120 ms de respiro | sostiene el panel hasta que el check terminó |

La curva es siempre `--ease-out` (`globals.css:86`), sin rebotes. La
constante está duplicada como literal en cuatro archivos —
`movimiento.tsx:36`, `template.tsx:38`, `bottom-nav.tsx:63`, `sheet.tsx:139`,
`toast.tsx:49`— pero eso es limpieza, no movimiento.

### Dónde se usan

| Primitivo | Consumidores reales |
| --- | --- |
| `Aparece` | `barra-acciones.tsx:62`, `grabar-view.tsx:468` y `:576` |
| `ListaEnCascada` | `dashboard.tsx:142`, `agenda-del-dia.tsx:64`, `cobros-view.tsx:386`, `sesiones-tab.tsx:469` |
| `AlturaAnimada` | sólo vía `plegable.tsx:86` (los tres plegables de la nota, "Ver detalle" del instrumento, los temas del Recorrido) |
| `Contador` | `kpis.tsx:69` (los tres números de Hoy) |
| `Latido` | `card-ahora.tsx:183` (sesión en curso), `grabar-view.tsx:461` (REC) |
| `CheckDibujado` | `toast.tsx:60`, `sheet-metodo-pago.tsx:78`, `turnos-pagos-tab.tsx:395`, `barra-acciones.tsx:61`, `config-view.tsx:639` |
| `AnilloProgreso` | `card-ahora.tsx:198`, `grabar-view.tsx:577`, `sesion-detail-view.tsx:292`, `sesiones-tab.tsx:370` |
| `useConfirmacionDibujada` | `sheet-metodo-pago.tsx:39`, `turnos-pagos-tab.tsx:184` |

El sistema es bueno: pocos primitivos, cada uno con un significado
declarado, y ninguno decorativo. El problema no es que falte movimiento.
Es que **hay movimiento fuera del sistema**, y ese es el que no respeta la
preferencia de accesibilidad.

### Dónde falta

- **`prefers-reduced-motion` no llega a tres lugares.** Sólo tres archivos
  consultan `useReducedMotion`: `movimiento.tsx`, `template.tsx:27` y
  `bottom-nav.tsx:27`. `globals.css` no tiene ningún bloque
  `@media (prefers-reduced-motion: reduce)` (revisado entero: 142 líneas).
  Quedan afuera: `sheet.tsx:145-202` (el panel sube 100 % de su alto en
  280 ms), `toast.tsx:43-56` (entra desde +16 px), los cuatro esqueletos con
  `animate-pulse` (`ContextoGoldenThreadView.tsx:836,843-845`,
  `HotWordsManager.tsx:556-559`, `ConsentimientoBadge.tsx:184`) y el
  `animate-spin` de `grabar-view.tsx:410`.
- **Listas largas sin cascada, al lado de listas cortas con cascada.**
  Pacientes (`pacientes-view.tsx:346` tabla, `:427` lista mobile) y el día de
  la Agenda (`day-view.tsx:42`) entran de golpe; Hoy, Cobros y Sesiones de la
  ficha entran escalonadas. Misma fila (`SessionRow`), dos entradas
  distintas según la pantalla.
- **`Confirmar` aparece de golpe** (`confirmar.tsx:86`) dentro de sheets y de
  la barra de la nota, empujando el contenido de abajo sin transición. Es
  exactamente el problema que `AlturaAnimada` resolvió para los plegables.

### Dónde sobra

- **Cascada dentro de cascada en Hoy.** `dashboard.tsx:142` escalona cuatro
  bloques (40, 80, 120 ms) y adentro `agenda-del-dia.tsx:64` vuelve a
  escalonar los turnos. El primer turno del día arranca su entrada a los
  120 ms del padre y el octavo a 120 + 280 = 400 ms, más los 180 ms del
  fundido de página: casi 0,6 s para que la agenda del día esté quieta. Es
  la pantalla que ella abre 8 a 12 veces por día.
- **`Contador` a 600 ms en "Sesiones hoy"** (`kpis.tsx:69`). Para un número
  de un dígito no hay nada que leer mientras sube: hay un dígito ilegible
  durante medio segundo. En "Por cobrar" y "Este mes" el conteo sí aporta
  (son cifras que cambian), pero 600 ms sigue siendo el doble de lo que hace
  falta para leer "$ 12,4k".
- **Dos indicadores de espera distintos en la misma pantalla de grabar:**
  `AnilloProgreso` (`grabar-view.tsx:577`) y `Loader2` con `animate-spin`
  (`grabar-view.tsx:410`). Giran distinto y uno ignora la preferencia.

---

## 2. Deltas, por impacto sobre esfuerzo

Doce, ordenados. Del 1 al 4 son de accesibilidad y de quitar; recién del 5
en adelante se agrega algo.

### D1 · Cobertura de `prefers-reduced-motion` en el sheet
**Pantalla:** todas (Hoy, Agenda, Pacientes, Cobros: los sheets de cobrar,
agendar, nuevo paciente, detalle de turno).
**Archivo:** `src/components/ui/sheet.tsx:145` (overlay), `:155` (drawer
mobile), `:187` (modal desktop).
**Duración/curva:** las de hoy cuando hay movimiento (200 ms overlay,
280 ms drawer, 200 ms modal, `[0.16,1,0.3,1]`). Sin cambios de tiempo.
**Sensación:** ninguna nueva. Es cumplir lo que el sistema ya promete.
**Reduced-motion:** el overlay aparece sin fundido y el panel sin
desplazamiento ni escala: está o no está. El sheet sigue atrapando el foco
igual (`sheet.tsx:86-137`), que es lo que importa.
**Esfuerzo:** bajo. **Impacto:** alto — es la pieza que más se abre en el
día y hoy desplaza 90 vh de pantalla contra la preferencia declarada.

### D2 · Cobertura de `prefers-reduced-motion` en el toast y en los esqueletos
**Pantalla:** todas (el toast) · ficha de paciente y Recorrido (esqueletos).
**Archivo:** `src/components/ui/toast.tsx:46-49`;
`ContextoGoldenThreadView.tsx:836` y `:843-845`;
`HotWordsManager.tsx:556-559`; `ConsentimientoBadge.tsx:184`.
**Duración/curva:** toast 240 ms, sin cambios. Los esqueletos hoy pulsan con
la animación de Tailwind (2 s, `cubic-bezier(.4,0,.6,1)`).
**Sensación:** el toast sigue confirmando; el esqueleto sigue diciendo
"esto todavía no es el dato".
**Reduced-motion:** el toast entra y sale sin desplazamiento (sólo aparece y
desaparece); los bloques del esqueleto quedan en un gris fijo — un bloque
crema quieto ya se lee como "falta el contenido".
**Esfuerzo:** bajo (una regla global en `globals.css` que desactive
`animate-pulse`/`animate-spin` bajo la media query cubre los cuatro
esqueletos y el spinner de D3 de una sola vez). **Impacto:** alto.

### D3 · Un solo indicador de espera en Grabar
**Pantalla:** Grabar sesión.
**Archivo:** `src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx:405-412`
(el `Loader2` con `animate-spin` dentro del botón de 132 px).
**Duración/curva:** la de `AnilloProgreso`, 1,1 s lineal, indeterminado.
**Sensación:** "estoy pidiendo el micrófono" con la misma forma que
"estoy guardando" tres pantallas más adelante. Hoy son dos giros distintos
en la misma pantalla.
**Reduced-motion:** `AnilloProgreso` ya queda quieto y sigue leyéndose como
anillo incompleto (`movimiento.tsx:435-447`); el texto del botón dice el
resto.
**Esfuerzo:** bajo. **Impacto:** medio-alto — es el botón más importante de
la app y el único momento en que ella espera algo con la paciente sentada
enfrente.

### D4 · Quitar la cascada anidada en Hoy
**Pantalla:** Hoy.
**Archivo:** `src/app/(dashboard)/_components/agenda-del-dia.tsx:64`
(la cascada interna; la de `dashboard.tsx:142` se conserva).
**Duración/curva:** los turnos entran con el bloque, sin paso propio; el
bloque conserva su retraso de 120 ms.
**Sensación:** la agenda del día aparece **como una lista**, no como ocho
cosas que llegan de a una después de que llegó su propio contenedor. Ahorra
hasta 280 ms al último turno visible.
**Reduced-motion:** ya era estático; no cambia nada.
**Esfuerzo:** bajo (es sacar un envoltorio). **Impacto:** alto — es el
delta que más se nota en la pantalla que más se abre.

### D5 · Bajar el `Contador` de Hoy y sacarlo de "Sesiones hoy"
**Pantalla:** Hoy, los tres números.
**Archivo:** `src/app/(dashboard)/_components/kpis.tsx:69-75`
(y el default de `movimiento.tsx:217`, que queda para quien lo pida).
**Duración/curva:** 360 ms con `--ease-out` para "Por cobrar" y "Este mes";
"Sesiones hoy" se escribe directo, sin contar.
**Sensación:** "esto se acaba de calcular" se conserva donde hay una cifra
que leer; donde hay un dígito, el número simplemente está.
**Reduced-motion:** `Contador` ya escribe el valor final y no anima
(`movimiento.tsx:250-259`); sin cambios.
**Esfuerzo:** bajo. **Impacto:** medio-alto — 240 ms menos hasta que el
número más consultado del día es legible.

### D6 · Cascada en la lista de Pacientes
**Pantalla:** Pacientes.
**Archivo:** `src/app/(dashboard)/pacientes/_components/pacientes-view.tsx:346`
(tabla desktop, `<ul>`) y `:427` (lista mobile, `<ul>`).
**Duración/curva:** `ListaEnCascada` con sus valores actuales — 40 ms de
paso, tope 8 (`movimiento.tsx:42` y `:49`), 240 ms por ítem.
**Sensación:** la misma que ya tienen Hoy, Cobros y Sesiones: la lista se
lee de arriba abajo. Hoy Pacientes es la única lista larga que aterriza de
golpe, y por eso se siente más "web" que el resto de la app.
**Reduced-motion:** entrada estática, como el resto de la cascada.
**Esfuerzo:** bajo. **Impacto:** medio (consistencia).

### D7 · Cascada en el día de la Agenda
**Pantalla:** Agenda (vista día, que en mobile es *la* vista).
**Archivo:** `src/app/(dashboard)/agenda/_components/day-view.tsx:42-50`.
**Duración/curva:** igual que D6.
**Sensación:** la misma fila (`SessionRow`) entra igual esté en Hoy o en la
Agenda. Hoy son dos entradas distintas para el mismo componente.
**Reduced-motion:** estático.
**Esfuerzo:** bajo. **Impacto:** medio.

### D8 · `Confirmar` se abre con su altura
**Pantalla:** Agenda (cancelar turno, "No vino", reintentar recordatorio),
la nota (descartar, aprobar), Ficha (archivar, revocar autorización).
**Archivo:** `src/components/ui/confirmar.tsx:86-92`; se ve empujando el
contenido en `barra-acciones.tsx:75-99` y en `turno-detail-sheet.tsx`.
**Duración/curva:** 220 ms, `--ease-out` (los mismos valores de
`AlturaAnimada`, `movimiento.tsx:165`).
**Sensación:** el panel de "¿Aprobar esta nota?" sale de donde estaba el
botón, en vez de aparecer y correr todo hacia abajo de un salto. En la
barra fija de la nota, hoy el salto ocurre debajo del pulgar.
**Reduced-motion:** `AlturaAnimada` ya devuelve el bloque sin transición
(`movimiento.tsx:196-202`): está o no está, exactamente como hoy.
**Esfuerzo:** bajo-medio (el foco entra en Cancelar al montar,
`confirmar.tsx:62`; hay que verificar que el foco no se adelante al
despliegue).
**Impacto:** medio-alto — son las tres confirmaciones irreversibles de la
app.

### D9 · El check del cobro también en la fila, no sólo en el sheet
**Pantalla:** Hoy (fila de la agenda del día) y Agenda.
**Archivo:** `src/components/ui/session-row.tsx:150-167` (el botón de acción
de la fila); el sheet ya lo hace bien en `sheet-metodo-pago.tsx:78`.
**Duración/curva:** 300 ms de trazo (`MS_CHECK_DIBUJADO`,
`movimiento.tsx:368`), dentro del respiro que ya sostiene
`useConfirmacionDibujada`. No agrega tiempo: ocurre mientras el sheet se
cierra.
**Sensación:** cuando el sheet se va, la fila que originó el cobro queda con
su marca. Hoy la fila cambia de chip sin que nada indique que ese cambio es
consecuencia de lo que ella acaba de tocar.
**Reduced-motion:** el chip cambia de estado sin trazo, como hoy.
**Esfuerzo:** medio. **Impacto:** medio.

### D10 · Entrada del bloque de riesgo: ninguna, y explícita
**Pantalla:** la nota clínica.
**Archivo:** `src/components/grabacion/RiesgoDetectadoBanner.tsx:142-151`.
**Duración/curva:** 0 ms. El bloque se dibuja con la nota, sin fundido ni
desplazamiento, y queda anotado en el archivo que es a propósito.
**Sensación:** una señal de riesgo no "entra": estaba. Cualquier animación
sobre ella la convierte en un aviso de app.
**Reduced-motion:** idéntico, por construcción.
**Esfuerzo:** bajo (es una decisión escrita, más un comentario). **Impacto:**
medio — protege la regla más importante del producto de un delta futuro.

### D11 · El indicador de la barra inferior también en la barra lateral
**Pantalla:** desktop, todas.
**Archivo:** `src/components/layout/sidebar.tsx:96-117` (hoy sólo cambia
color de fondo); el patrón está resuelto en `bottom-nav.tsx:59-64`.
**Duración/curva:** 260 ms, `[0.16,1,0.3,1]`, identidad compartida, como en
mobile.
**Sensación:** en el teléfono el subrayado se desliza entre pestañas; en la
computadora el destino activo se prende y se apaga. Es la misma navegación.
**Reduced-motion:** barra que aparece en su lugar, sin recorrido — la rama
que `bottom-nav.tsx:53-57` ya tiene escrita.
**Esfuerzo:** medio. **Impacto:** bajo-medio (desktop es el uso minoritario
de Mariana).

### D12 · Volver del cobro a Hoy sin recargar la pantalla entera
**Pantalla:** Hoy.
**Archivo:** `src/app/(dashboard)/_components/dashboard.tsx:79-93` (`cobrar`
llama a `recargar()`, que reinicia `estado` y vuelve a montar la cascada de
`:142`).
**Duración/curva:** ninguna nueva; se trata de **no** re-disparar los 120 ms
de cascada ni el fundido de página después de cobrar.
**Sensación:** cobrar cambia un renglón, no repinta el día. Hoy, después de
un cobro, toda la pantalla vuelve a entrar como si se hubiera abierto de
nuevo — y eso ocurre varias veces por jornada.
**Reduced-motion:** no aplica (es supresión de re-entrada).
**Esfuerzo:** alto (toca cómo se refresca el estado, no el movimiento).
**Impacto:** alto, pero es el único delta que no es sólo de presentación:
va último a propósito.

---

## 3. Lo que este plan NO propone

- **Ningún indicador deslizante para `Segmented`** (`segmented.tsx:29-47`).
  Es un control de tres opciones que ella toca poco; el fondo blanco con
  sombra ya dice cuál está elegida y un `layoutId` más es superficie que
  mantener.
- **Ninguna transición de página con desplazamiento.** El fundido de 180 ms
  de `template.tsx:20` es correcto y ya está argumentado ahí mismo: deslizar
  la página obligaría a esperar a que frene para leer.
- **Ningún movimiento en el brief pre-sesión, el Recorrido ni la nota más
  allá de los plegables que ya tienen.** Son pantallas de lectura clínica.
- **Ningún rebote, en ningún lado.** Ya está escrito en
  `movimiento.tsx:27-29` y no hay motivo para revisarlo.
