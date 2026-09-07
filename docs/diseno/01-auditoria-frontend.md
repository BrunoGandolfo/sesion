# Auditoría de front, pantalla por pantalla

Hecha sobre la app en producción (`sesion-seven.vercel.app`), navegada con
Chromium a 390×844 (iPhone 14), `deviceScaleFactor` 2, locale `es-UY`, zona
Montevideo, el 7 de septiembre de 2026. Cuenta `admin@sesion.uy`.

Las capturas están en `docs/diseno/capturas/` y las genera
`docs/diseno/capturas/tomar-capturas.mjs`, que se puede volver a correr. Cada
pantalla tiene capturas `-p1`, `-p2`… (lo que se ve en cada scroll) y una
`-completa`.

**Recorrido en modo lectura.** No se tocó Aprobar, Descartar, Cobrar,
Deshacer, Eliminar, Archivar, Grabar, Reintentar, Guardar, ni la casilla
"Revisé esta señal". Se abrieron pestañas, plegables, el desplegable del mes
y un sheet, y se cerró sesión al final. Nada quedó modificado.

**Dos cosas no se pudieron capturar y no es un olvido:** el sheet de cobrar
—hoy no hay ningún turno pasado sin pagar, así que el botón "Cobrar" no
existe en pantalla— y el toast, que sólo aparece después de una acción que
escribe. En su lugar hay `16-sheet-agendar.png`, que es el mismo componente
`Sheet` (`src/components/ui/sheet.tsx`).

## Cuánto mide cada pantalla

Medido sobre el contenedor que scrollea (`main`), no sobre el documento.

| Pantalla | Alto | Pantallas de 844 px |
| --- | --- | --- |
| Hoy | 1243 px | 1,5 |
| Agenda (día vacío) | 844 px | 1 |
| Pacientes | 1921 px | 2,3 |
| Ficha de paciente | 2093 px | 2,5 |
| Cobros | 2456 px | 2,9 |
| Tu consultorio | 2394 px | 2,8 |
| Nota clínica | 5125 / 6573 / 7089 px | **6 a 8,4** |

La nota es, con distancia, la pantalla más larga de la app.

---

## 0 · Lo primero: un desborde horizontal que recorta texto clínico

`07-ficha-sesiones-p1.png` · **`src/components/ui/chip.tsx:38`** consumido
desde **`pacientes/[id]/_components/brief-pre-sesion.tsx:250-252`**

En la ficha de paciente, `main.scrollWidth` mide **464 px sobre un viewport
de 390**. El contenedor del layout es `h-screen overflow-hidden`
(`(dashboard)/layout.tsx:14`), así que esos 74 px no se pueden scrollear:
**se recortan**. Lo medí en las seis pantallas y la ficha es la única que
desborda.

El culpable es un chip del brief pre-sesión. `Chip` lleva
`whitespace-nowrap` (`chip.tsx:38`) y los temas recurrentes del hilo se
renderizan como chips (`brief-pre-sesion.tsx:250`). El tema
"devolución diagnóstica e inestabilidad emocional · 1" produce un chip de
**423 px de ancho** que se corta contra el borde de la pantalla.

Que sea el brief lo empeora: es lo que ella lee un minuto antes de que entre
la paciente.

Lo curioso es que el mismo dato, en el Recorrido, se dibuja bien: ahí no usa
`Chip` sino un `span` propio sin `nowrap` y los temas largos envuelven en dos
líneas (`ContextoGoldenThreadView.tsx:693-698`, ver
`08-ficha-recorrido-p4.png`). O sea que la solución ya está escrita en la
app, sólo que en el otro archivo.

---

## 1 · Hoy

`01-hoy-p1.png`, `01-hoy-p2.png`

### Qué funciona

- El orden de bloques es el correcto y está bien argumentado en el código
  (`_components/dashboard.tsx:3-7`): primero lo que espera una acción,
  después lo que viene, después el día, después la deuda.
- El estado vacío de la agenda del día (`agenda-del-dia.tsx:82-89`) es de lo
  mejor de la app: "Hoy tu agenda está libre. / Buen día para ordenar
  pendientes, o para descansar un rato." Dice algo, y lo dice como una
  persona.
- La regla editorial + versalitas de `titulo.tsx:17` da un ritmo de página
  que se lee como papel, no como panel de control.

### Qué no

**(c) Jerarquía visual.** Lo más grande de la pantalla es la palabra
"lunes", a 52 px (`saludo.tsx:29`). Ocupa un cuarto de la primera pantalla
para decir algo que ella ya sabe: qué día es. Justo debajo, en 13 px, está el
único dato que cambia su día — "sin sesiones agendadas" (`saludo.tsx:33`).
La jerarquía está exactamente al revés de la importancia.

Peor: hoy el día estaba vacío, y aun así la pantalla dedica su bloque más
grande al día de la semana. Con seis turnos, "lunes" seguiría midiendo lo
mismo.

**La deuda se dice tres veces en una pantalla y media, con dos números
distintos.**

1. Bloque de pendientes: "**11 pacientes** te deben · $ 45.300"
   (`pendientes.tsx:142-146`), con tres nombres.
2. KPI "Por cobrar": "$ 45.3k · **10 pacientes**" (`kpis.tsx:41-45`).
3. Bloque "Te deben" al pie (`te-deben.tsx:31-44`), con otros tres nombres.

Once contra diez. Son dos cuentas distintas —`totalSinCobrar.pacientes` de
`casos-uso/pendientes-terapeuta.ts` contra `data.deudores.length`— mostradas
a 400 px de distancia. Para ella no hay dos criterios: hay un número que no
coincide consigo mismo.

Y los tres nombres de arriba (Bruno Gandolfo, Rodrigo Acosta, Diego Martínez)
no son los tres de abajo (Alejandro Sosa, Diego Martínez, Gonzalo Méndez):
arriba se ordena por lo que devuelve el caso de uso y abajo por el orden
crudo de `data.deudores` (`te-deben.tsx:31`, un `slice(0,3)` sin ordenar).
En Cobros, en cambio, sí se ordena por monto descendente
(`cobros-view.tsx:177-179`). Tres listas de deudores, tres criterios.

**Los KPI se rompen a 390 px.** `01-hoy-p1.png`: "$ 45.3k" parte en dos
líneas ("$" arriba, "45.3k" abajo), y "$ 26.3k" también. La grilla es de tres
columnas fijas (`kpis.tsx:59`) y cada celda queda en ~110 px, con un número
en 26 px de Fraunces (`kpis.tsx:72`). Los rótulos también parten: "SESIONES /
HOY", "POR / COBRAR". El bloque más "dato" de la pantalla es el peor
compuesto.

**Dos accesos a crear un turno a 300 px uno del otro:** el botón "+ Turno"
del rótulo de sección (`agenda-del-dia.tsx:42-48`) y, si se scrollea, ninguno
más — pero en Agenda hay dos más (ver abajo). El mismo verbo se llama "Turno"
acá y "Agendar" allá.

---

## 2 · Agenda

`02-agenda-dia-p1.png`, `03-agenda-mes-desplegado-p1.png`

### Qué funciona

- El mes desplegable detrás del título (`agenda-header.tsx:86-104`) es la
  decisión correcta para mobile: no hay vista "mes" que ocupe la pantalla, se
  asoma y se cierra.
- Los puntos por día en el mes (`month-view.tsx`) dan la densidad de la
  semana de un vistazo.

### Qué no

- **El título se corta:** "lunes 7 de septiem…" (`agenda-header.tsx:93`,
  `truncate`). Es el control que abre el mes, y es lo único que dice qué día
  se está mirando.
- **Los puntos del mes no tienen leyenda.** Hay puntos dorados y verdes y un
  "+4" (`03-agenda-mes-desplegado-p1.png`). En el resto de la app dorado es
  "agendado" y verde "pagado" (`session-row.tsx:46-59`), pero eso no se dice
  en ningún lado de esta pantalla.
- **El FAB tapa el estado vacío.** `03-agenda-mes-desplegado-p1.png`: el "+"
  (`ui/fab.tsx:15`, `bottom-20 right-5`) queda sobre la tarjeta punteada, a
  centímetros del botón "Agendar" que esa misma tarjeta ofrece
  (`day-view.tsx:81-85`). Dos botones para lo mismo, uno tapando al otro.
- **Tres caminos al mismo turno nuevo:** el FAB (`agenda-view.tsx:390`), el
  botón "Agendar" del estado vacío (`day-view.tsx:82`) y, en desktop, el del
  header (`agenda-header.tsx:118-125`).
- Con el mes abierto, la lista del día se va abajo del pliegue: hay que
  scrollear para ver los turnos del día que acabás de elegir.

---

## 3 · Pacientes

`06-pacientes-lista-p1.png`

### Qué funciona

- La fila es limpia y suficiente: avatar, nombre, tarifa, última sesión y,
  si debe, el monto en terracotta (`pacientes-view.tsx:427-470`).
- El orden por apellido es el correcto para buscar a alguien.

### Qué no

- **Es la única pantalla principal sin acceso a "Tu consultorio"** (ver
  sección (a)).
- **El FAB tapa la última fila visible** (`06-pacientes-lista-p1.png`:
  Mercedes Etcheverry queda debajo del "+").
- **El monto de deuda es un chip sin rótulo** (`pacientes-view.tsx:462`).
  En la misma fila hay otro número con signo de pesos —la tarifa— así que
  "$ 11.000" al lado de "$ 2.200 · Ayer" pide un segundo de interpretación.
- Truncados en cadena: "Hace 3 mes…" (`pacientes-view.tsx:455`).

---

## 4 · Ficha de paciente

`07-ficha-sesiones-p1.png`, `08-ficha-recorrido-p1.png`,
`09-ficha-datos-p1.png`

### Qué funciona

- Las tres pestañas son las tres preguntas reales: qué pasó, cómo viene, quién
  es. El glosario las nombra igual en todos lados (`glosario.ts:47-49`).
- "Para retomar" arriba de todo, con la señal de riesgo primero, es el orden
  clínicamente correcto.

### Qué no

- **El desborde del chip** (sección 0).
- **El FAB "Grabar" tapa texto clínico en las tres pestañas.**
  `07-ficha-sesiones-p1.png`: cubre el resumen de la última sesión.
  `08-ficha-recorrido-p4.png`: cubre "El recorrido hasta hoy".
  `09-ficha-datos-p1.png`: cubre el rótulo "AUTORIZACIÓN PARA GRABAR LAS…" y
  parte del botón "Revocar". Vive en `paciente-detail-view.tsx:291-300`
  (`fixed bottom-24 right-5`), es opaco y no se puede correr.
- **Dos botones "Editar" en la misma pantalla, uno arriba del otro**, para
  cosas distintas: el de la cabecera edita los datos del paciente
  (`cabecera-ficha.tsx:68-75`) y el del Recorrido edita el hilo
  (`ContextoGoldenThreadView.tsx`, ver `08-ficha-recorrido-p1.png`). Mismo
  texto, mismo tamaño, mismo peso.
- **"El recorrido hasta hoy" es un muro de texto sin plegar**
  (`08-ficha-recorrido-p4.png`: dos pantallas y media de párrafo corrido).
  El resto de la app ya tiene el patrón para esto: `Plegable`
  (`ui/plegable.tsx`).
- **La fecha de alta está escrita en otro idioma que el resto de la app.**
  "05 de **setiembre** de 2026" (`ficha-tab.tsx:39-43`, un
  `Intl.DateTimeFormat("es-UY")`), contra "7 de **septiembre**" en la agenda
  y "**Septiembre** 2026" en Cobros (date-fns con locale `es`, vía
  `fechas-montevideo.ts:201`). Dos ortografías del mismo mes en la misma
  sesión de uso. Y de paso ese formateador se saltea la regla de zona horaria
  de Montevideo que el resto del proyecto respeta.

---

## 5 · Cobros

`10-cobros-te-deben-p1.png`, `11-cobros-del-mes-p1.png`

### Qué funciona

- Es la pantalla con la mejor frase de la app: "Son **21 sesiones** sin
  cobrar." (`cobros-view.tsx:376-382`). Cuenta la deuda en la unidad en que
  ella la piensa.
- "HACE 118 DÍAS" en terracotta (`cobros-view.tsx:451-465`) hace el trabajo
  de una alarma sin serlo.

### Qué no

- **La grilla de KPI dice "Te deben" y arriba del listado hay una pestaña que
  también dice "Te deben"** (`cobros-view.tsx:281` y `:192`). El mismo rótulo
  para un número y para una vista.
- **Cuatro KPI donde alcanzan dos.** "Cobraste este mes $26.3k / 12 sesiones"
  y "Sesiones cobradas 12 / este mes" son el mismo hecho dos veces
  (`cobros-view.tsx:273-298`). Igual "Te deben $45.3k" y "Sin cobrar 21
  sesiones".
- **El indicador del `Segmented` se sale de su caja.** Visible en
  `11-cobros-del-mes-p1.png` y en `09-ficha-datos-p1.png`: la pastilla blanca
  activa sobresale del riel crema por la derecha. El contenedor tiene `p-1`
  y no limita el ancho de los botones (`ui/segmented.tsx:27-42`).
- Nombres truncados en la lista de cobros: "Rodrigo …" (`cobros-view.tsx:552`).

---

## 6 · Tu consultorio

`12-consultorio-p1.png`, `12-consultorio-p2.png`

### Qué funciona

- Cinco secciones en el orden en que ella las piensa, con la vista previa del
  recordatorio tal como la recibe la paciente (`config-view.tsx:495-502`).
  Es un patrón excelente y no existe en ninguna otra pantalla.
- El guardado automático con aviso discreto evita el botón "Guardar" y su
  ansiedad.

### Qué no

- **(b) Llegar a "Tu enfoque" cuesta más de lo que parece** (abajo, sección
  propia).
- La orientación teórica se elige entre dos tarjetas cuyo subtítulo son
  siglas en inglés: "Feedback con CTS-R (Cognitive Therapy Scale — Revised) +
  MITI 4.2.1 (Motivational Interviewing Treatment Integrity)". Es correcto no
  ablandar los instrumentos (`glosario.ts:116-138`), pero es lo único de la
  app escrito en inglés y es lo primero que se lee de la opción.
- El prefijo "$UYU" está superpuesto dentro del input de tarifa
  (`config-view.tsx:412-433`, un `span` absoluto con `pl-[56px]`): funciona,
  pero es el único campo de la app con un adorno adentro, y `Input` ya tiene
  una prop `prefix` para eso (`ui/input.tsx:43-47`).

---

## 7 · La nota clínica

`13-nota-1-p1.png` … `13-nota-1-desplegada-*.png`

### Qué funciona

- El orden de lectura es el correcto y está documentado en
  `nota-sesion-view.tsx:31-37`: cabecera → riesgo → resumen → S/O/A/P →
  plegados.
- **Un solo bloque de riesgo**, con "Lo que dijo" y el timestamp de la cita
  (`RiesgoDetectadoBanner.tsx:15-26`). Es la mejor decisión de producto de
  toda la app.
- Los plegables usan un único componente (`ui/plegable.tsx`) y abren con su
  altura, sin saltos.

### Qué no

- **Mide entre 6 y 8,4 pantallas.** La más larga de las tres notas de Lucía
  mide 7089 px. No hay índice, no hay anclas, no hay forma de saltar a "Plan
  (P)" sin recorrer todo. Cada sección SOAP es un párrafo corrido de una
  pantalla entera (`13-nota-1-p3.png`, `13-nota-1-desplegada-p5.png`).
- **La cita del riesgo aparece dos veces seguidas** (`13-nota-1-p1.png`):
  primero como "Lo que dijo" con su marca de tiempo, y a continuación dentro
  del párrafo explicativo, entre comillas y con el `[05:49]` otra vez. Viene
  así del contrato, pero en pantalla se lee como un error de la app.
- **En las tres notas de Lucía no aparece el bloque "Para vos".** Lo verifiqué
  en las tres (`reporte.medidas.notas`, todas con `paraVos: false`): sólo
  tienen "Más de esta sesión" y "Ver el borrador original". O el feedback no
  se está generando, o no pasa el chequeo de forma de
  `nota-sesion-view.tsx:53-61`. Es la mitad del diferencial del producto y
  no está en pantalla; vale la pena mirarlo antes que cualquier cambio
  visual.
- El chip de estado en versalitas ("NOTA GUARDADA") tiene el mismo peso
  visual que el título "Señal de riesgo · nivel moderado" que va justo
  debajo.

---

## 8 · Grabar

`14-grabar-previo-p1.png`

**Es la mejor pantalla de la app.** Un nombre, un botón de 132 px, nada más
(`grabar-view.tsx:280-420`). No hay nada que sacar.

Dos observaciones:

- El menú inferior sigue ahí durante toda la pantalla
  (`(dashboard)/layout.tsx:19`). Un toque accidental en "Hoy" mientras se
  graba saca a la profesional de la grabación.
- Cuando se entra sin turno (`/grabar/nuevo?pacienteId=…`, que es el camino
  del FAB de la ficha) no se muestra ninguna hora ni ningún dato del turno,
  porque todavía no existe. Correcto, pero deja la pantalla sin ninguna
  confirmación de a quién se va a grabar más allá del nombre.

---

## 9 · El sheet

`16-sheet-agendar.png`

- El menú inferior **queda visible y tocable con el sheet abierto**. El
  componente reserva 64 px para que el último botón no quede tapado
  (`ui/sheet.tsx:16` y `:180-183`), pero el menú sigue arriba: un diálogo con
  `aria-modal="true"` (`sheet.tsx:157`) convive con cuatro destinos de
  navegación activos.
- Los campos de fecha y hora son inputs nativos y en esta corrida salieron
  como `09/07/2026` y `10:00 AM` — formato de EE.UU. y 12 horas, contra el
  `07/09` y las 24 horas que usa toda la app (`format.ts:59-61`). Depende del
  idioma del navegador, así que **hay que verificarlo en el teléfono de ella
  antes de tocar nada**: si su Chrome está en español rioplatense, se ve
  bien.

---

## (a) La cabecera con avatar que lleva a "Tu consultorio"

`01-hoy-p1.png` (arriba a la izquierda), `10-cobros-te-deben-p1.png`
Componente: `src/components/layout/cabecera-usuario.tsx:47-77`

### Por qué no se percibe como acceso a configuración

1. **No tiene ninguna marca de que sea tocable.** Es un avatar, un saludo, un
   nombre y una fecha. No hay chevron, no hay subrayado, no hay engranaje, no
   hay fondo. El único indicio es un `hover:bg-cream-100`
   (`cabecera-usuario.tsx:52`) — y en un teléfono no existe el hover.
2. **Se parece a un encabezado, no a un botón**, porque *es* el encabezado: el
   saludo "Buen día", el nombre y la fecha son el título de la pantalla. Lo
   que en otras apps es "tu foto arriba a la derecha, sola", acá es un bloque
   de tres líneas que ocupa el ancho y arranca la página.
3. **Está en dos de las cinco pantallas.** Existe en Hoy (`saludo.tsx:27`) y
   en Cobros, y sólo en mobile (`cobros-view.tsx:241-245`). En Agenda,
   Pacientes, la ficha, la nota y Grabar no hay ningún acceso a "Tu
   consultorio". Un destino que aparece en el 40 % de las pantallas no se
   aprende.
4. **El mismo avatar muestra iniciales distintas según la pantalla.** En Hoy
   dice **MA** y en Cobros **MR** (comparar `01-hoy-p1.png` con
   `10-cobros-te-deben-p1.png`), para la misma persona, "Mariana Roldán". La
   causa: Hoy manda sólo el primer nombre (`_components/datos.ts:150`,
   `.split(/\s+/)[0]`) y Cobros manda el nombre completo
   (`cobros-view.tsx:107`); `initials()` (`format.ts:157-162`) devuelve "MA"
   con una palabra y "MR" con dos. Si el ancla visual del acceso cambia de
   contenido entre pantallas, deja de ser un ancla.

### Tres alternativas concretas

**A. Que el destino esté en el menú, no en un rincón.**
Quinto ítem en la barra inferior (`layout/bottom-nav.tsx:14-19`) con el
avatar como ícono y "Vos" como etiqueta. Cinco destinos entran cómodos en
390 px (78 px cada uno; el mínimo táctil son 44). Deja de ser un lugar que
hay que descubrir y pasa a estar en las cinco pantallas.
*Costo:* toca el pilar de "cuatro pantallas". *A favor:* es exactamente lo
que hace la barra lateral de desktop, que ya tiene "Tu consultorio" como
quinto ítem (`layout/sidebar.tsx:28`). Hoy mobile y desktop no coinciden.

**B. Dejar la cabecera donde está, pero que se lea como control.**
Agregar un chevron a la derecha del bloque —el mismo `ChevronRight` de 16 px
que ya marca "esto se abre" en la lista de pacientes
(`pacientes-view.tsx:466`) y en Cobros (`cobros-view.tsx:422`)— y ponerla
también en Pacientes y en la ficha. Un solo componente ya existente
(`cabecera-usuario.tsx`), cuatro pantallas más.
*Costo:* bajo. *A favor:* mantiene el diseño editorial. *En contra:* sigue
siendo un patrón que hay que aprender una vez.

**C. Separar identidad de configuración.**
Que la cabecera deje de ser un enlace y sea sólo el encabezado que ya
parece, y que "Tu consultorio" se alcance desde un único lugar explícito: una
fila al pie de Pacientes, o el nombre en la barra inferior. Es la más honesta
con lo que la pantalla comunica hoy, y la que menos me gusta: agrega un lugar
en vez de sacar uno.

**Recomiendo A**, y arreglar las iniciales (`datos.ts:150`) en cualquiera de
los tres casos.

---

## (b) Cómo se llega a "Tu enfoque" y cuántos toques

Medido en la app: la sección "Tu enfoque" empieza a **715 px del tope** de
`/config`, y los dos botones de orientación quedan entre los 780 y los
1100 px (`12-consultorio-p1.png` los muestra apenas asomando en el borde
inferior; `12-consultorio-p2.png` los muestra enteros).

| Desde | Toques | Scroll |
| --- | --- | --- |
| Hoy | **1** (la cabecera) | ~1 pantalla (715 px al título, ~900 al selector) |
| Cobros | **1** (la cabecera) | igual |
| Agenda · Pacientes · ficha · nota · Grabar | **2** (ir a Hoy o Cobros, después la cabecera) | igual |

O sea: en el mejor caso, un toque **invisible** más una pantalla de scroll;
en el peor —que es el más frecuente, porque la ficha y la agenda son donde
vive— dos toques, uno de ellos por una pantalla que no le interesa.

Y el enfoque teórico es, según el propio texto de la app, "una decisión
clínica: define con qué instrumento se lee tu práctica en cada sesión"
(`config-view.tsx:450-455`). Es lo más clínico que hay en configuración y
está en el lugar más difícil de encontrar de la app.

Dos arreglos, en orden de esfuerzo:

1. **Subir "Tu enfoque" arriba de "Lo que cobrás"** (mover la sección en
   `config-view.tsx:442-457`, antes de `:408`): lo clínico antes que lo
   administrativo, y queda en la primera pantalla.
2. **Mostrarlo donde se usa:** una línea en el pie del bloque "Para vos" de
   la nota que diga con qué instrumento se leyó esa sesión y enlace a
   `/config`. Hoy el instrumento aparece en la nota (GTFS, MITI, CTS-R) sin
   decir nunca que eso se elige, ni dónde.

---

## (c) Jerarquía visual de Hoy

Está en la sección 1, pero resumida como orden de prioridades:

| Hoy manda | Debería mandar |
| --- | --- |
| "lunes", 52 px | qué sesión viene ahora, o si no hay ninguna |
| tres KPI que se parten en dos líneas | un número, el que pide acción |
| tres bloques distintos de deuda | uno |
| la cabecera, que es un enlace invisible | lo mismo, pero visible |

El bloque AHORA (`card-ahora.tsx`) —el que tiene el nombre de la paciente en
26 px, la hora en 32 y **un solo botón**— es el mejor diseñado de la
pantalla, y hoy no se ve nunca que la agenda esté vacía. Cuando la agenda
tiene turnos, aparece debajo de tres bloques de deuda.

---

## (d) Consistencia de chips, sheets y toasts

### Chips

Un componente (`ui/chip.tsx`), cuatro variantes, y **al menos cinco chips que
no lo usan**:

| Dónde | Qué usa | Diferencia |
| --- | --- | --- |
| `ui/chip.tsx:38` | el componente | versalitas, `tracking-.08em`, 12 px, `nowrap` |
| `session-row.tsx:165-169` | `span` propio | mismo aspecto, escrito de nuevo, con `group-hover` |
| `cobros-view.tsx:456-458` | `span` propio | 11 px y `tracking-.04em`: más chico que el piso que `chip.tsx:20-24` declara |
| `ContextoGoldenThreadView.tsx:693` | `span` propio | sin versalitas y **sin `nowrap`** (por eso no desborda) |
| `pendientes.tsx:63-65` | texto suelto | "y N más" |

Resultado visible: en la ficha, los temas del hilo se ven en VERSALITAS en el
brief (y se cortan) y en minúscula en el Recorrido (y envuelven). Mismo dato,
misma pantalla, dos tipografías.

Además, el piso de 12 px que `chip.tsx:20-24` documenta como regla se rompe
en `cobros-view.tsx:456` (11 px) y en los rótulos de sección de 10 px
(`titulo.tsx:17`, `kpis.tsx:66`, `cobros-view.tsx:320`), que a un brazo de
distancia son ilegibles para alguien de 52 años.

### Sheets

Un solo componente (`ui/sheet.tsx`) y se nota: mismo tirador, mismo fondo,
mismo comportamiento de foco y de Escape. Es lo más consistente de la app.
Lo que falta:

- El menú inferior sigue activo con el sheet abierto (sección 9).
- Ninguno de los sheets respeta `prefers-reduced-motion` (`sheet.tsx:145-202`
  anima sin consultar la preferencia; ver `03-plan-de-movimiento.md`, D1).
- Los sheets con formulario cancelan el padding del contenedor con márgenes
  negativos (`pacientes-view.tsx:275`, `sheet-metodo-pago.tsx:63`), tres
  veces con tres valores distintos.

### Toasts

Un solo componente (`ui/toast.tsx`), con check dibujado y posición calculada
para no tapar los flotantes (`toast.tsx:8-19`). Bien pensado. Dos cosas:

- **Siempre lleva un check**, incluso cuando el mensaje es un error: el mismo
  `CheckDibujado` acompaña "Cobrado" y "No se pudo cobrar. Probá de nuevo."
  (`toast.tsx:60`, con mensajes de `dashboard.tsx:86`). Un tilde verde sobre
  un fracaso es la peor confirmación posible.
- Los mensajes viven sueltos en cada pantalla ("Turno agendado",
  "Paciente creado", "Cobrado", "Paciente archivado") y no en `glosario.ts`,
  que es el módulo que existe precisamente para que un concepto se diga de una
  sola manera.

No pude capturar ninguno en modo lectura: todos aparecen después de una
acción que escribe.
