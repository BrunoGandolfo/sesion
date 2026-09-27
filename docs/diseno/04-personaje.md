# El personaje

Lupita, "el brote": el personaje de la app. Vive en `src/components/ui/lupita.tsx`;
su nombre sale de `LUPITA` en `src/lib/glosario.ts`, de donde lo lee también el
prompt del asistente (`src/lib/ayuda-corpus.ts`). Todo lo que sigue usa los
tokens de color que ya existen en `src/app/globals.css`: no se agrega un color
a la paleta para que entre un personaje. Los otros conceptos que se evaluaron
(el canto rodado, el hornero) están en el historial de Git.

Desde el 26-sep-2026 Lupita es además una **presencia**: vive posada sobre
el menú de abajo (en la computadora, en el lateral) en cinco pantallas,
respira, parpadea y hace tres gestos. Cómo, dónde y con qué límites está en
`docs/diseno/06-lupita-presencia.md`, que manda sobre este documento donde
difieren; lo de abajo quedó actualizado a esa decisión.

## La regla de tono, escrita como se va a aplicar

**Aparece en:** la ayuda (`docs/ayuda/*` y cualquier pantalla de ayuda que
salga de ahí), los estados vacíos, el onboarding, las confirmaciones
alegres —cobrar y sesión aprobada, como gesto de la posada— y, como
presencia, posada en Hoy, Agenda, Pacientes, Cobros y Tu consultorio
(06, D0). Fuera de esas cinco pantallas la posada se retira.

**No aparece nunca en:**

- La nota clínica: `src/app/(dashboard)/sesiones/[id]/` completo, incluida
  la barra de acciones (`barra-acciones.tsx`, que es donde vive hoy la
  confirmación de "Nota guardada"). Esa barra está en la misma pantalla que
  el bloque de riesgo, así que la confirmación de aprobación **se celebra
  después, en Hoy**, no ahí.
- El brief pre-sesión: `brief-pre-sesion.tsx` y `components/clinico/brief-corto.tsx`,
  incluido su uso dentro de la card de Hoy (`card-ahora.tsx`).
- El Recorrido: `recorrido-tab.tsx` y todo `pacientes/[id]/_components/graficos/`.
- La ficha entera y `/grabar/*` como presencia: ahí la posada se retira y el
  panel de ayuda se abre sin dibujo (06, D3). La única excepción es el
  recordatorio de la pantalla prendida, antes de empezar a grabar, quieto.
- A menos de una pantalla de una señal de riesgo. En código, eso es
  concreto: si `clavesDeRiesgo(...)` (`RiesgoDetectadoBanner.tsx`)
  devuelve algo distinto de una lista vacía para esa sesión, la sesión no
  se celebra con el personaje **en ninguna pantalla**, ni en el toast de
  vuelta a Hoy. Se confirma con el `CheckDibujado` de siempre
  (`toast.tsx`) y nada más.

Ese último punto es el que decide si el personaje puede existir: no alcanza
con que no esté en la pantalla del riesgo, tiene que no estar en el camino
de esa sesión. Con la posada, en código: en Hoy no aparece hasta que la
pantalla confirmó que el día no trae ninguna señal; aprobar una nota sólo le
avisa si `clavesDeRiesgo` está vacío; y el aviso de "nota lista" y el cobro
fuera de Hoy no la llevan hasta que la respuesta del aviso traiga el dato
de riesgo (06, D2). Lo vigila `src/lib/__tests__/lupita-sin-riesgo.test.ts`.

## Cómo entra al código

En los tres conceptos el personaje es **un SVG propio en
`src/components/ui/`**, no una imagen, no una fuente de íconos, no Lottie.
Motivos: entra en el bundle que ya existe, hereda `currentColor` donde
convenga, y —lo importante— si alguna vez se anima, se anima con los
primitivos de `movimiento.tsx` y degrada solo con `prefers-reduced-motion`.
Un GIF o un Lottie no degradan.

---

## Concepto A · El brote

**Forma.** Un tallo corto y recto del que salen **dos hojas y media**: una
hoja grande a la izquierda, una chica a la derecha y un brote nuevo,
apenas insinuado, arriba. Silueta ovalada, contorno cerrado de trazo
uniforme (1,8 px al tamaño base, el mismo peso que los íconos de la app,
`session-row.tsx` y compañía). Sin cara. La expresión está en la
inclinación del tallo, no en dos ojitos: es lo que lo vuelve original y lo
que hace que a 24 px siga siendo legible.

**Paleta.** Hoja grande `sage-500` (#4F7A6A), hoja chica `sage-300`
(#9BB6AA), brote nuevo `gold-500` (#866929) usado sólo como punto de 2 px,
fondo del contenedor circular `cream-100` (#F4F0E8). En estados de error o
neutros, todo en `ink-300`.

**Poses.**
- *Saluda:* tallo vertical, hoja grande abierta a 45°, brote alto.
- *Señala:* el tallo se inclina 12° hacia el lado del contenido que
  importa y la hoja grande se estira en esa dirección; la hoja chica queda
  atrás, como contrapeso.
- *Celebra:* tallo vertical, las dos hojas arriba y el punto dorado del
  brote separado 3 px del tallo, como si acabara de abrirse. Nada de
  confeti ni de destellos.

**Nunca terracotta.** En esta app terracotta significa deuda y riesgo: un
personaje de ese color confundiría la señal de alarma.

**Nombre.** Lupita: un diminutivo de persona que no infantiliza al dibujo,
suena a alguien de confianza que pasa a dar una mano y arrastra la lupa, que
es lo que hace quien busca en la ayuda.

## Movimiento

Hasta el 26-sep-2026 Lupita se dibujaba quieta en reposo. Desde entonces
(06, sección 3), con los tiempos de `TIEMPOS_LUPITA` en
`src/lib/movimiento.ts`, que sólo pueden usar sus archivos:

- **Reposo:** respira (escala de 1 a 1,02 desde la base, un ciclo de 4 s,
  en CSS: `.lupita-respira`) y parpadea (la hoja chica se pliega 120 ms,
  cada 4 a 9 s, con un solo reloj para la app). Sólo desde 32 px; a 20 px
  —menú, líneas del chat— siempre quieta. **Una sola Lupita viva por
  pantalla**: con una de contenido a la vista, la posada se queda quieta.
- **Gestos**, de 600 ms como mucho y con 10 s de enfriamiento, sin cola:
  saludo (450 ms), cobro (450 ms), asiente (~400 ms). **brota** y su
  inverso, 220 ms. **celebra**, al completar una respuesta del chat.
- **piensa**, en el chat: vaivén `senala ↔ piensa` de 900 ms por semiciclo,
  con tope de 15 s. Es el único movimiento que no es reposo ni gesto.
- El ítem del menú es quieto: la que vive es la posada.
- Con `prefers-reduced-motion` no se anima nada: los estados se ven en su
  pose fija y los gestos no se ven.

## Cómo habla

Vos, rioplatense, frases cortas, sin signos de admiración salvo que la
frase sea genuinamente una celebración chica. Nunca explica clínica. Nunca
usa "usuario", "sistema", "procesando".

**Ayuda**
- "Lo que grabás queda en tu teléfono hasta que llega bien a Sesión."
- "¿Buscás cómo cambiar el recordatorio? Está en Tu consultorio, abajo de
  la tarifa."

**Estados vacíos**
- "Todavía no hay nadie acá. Cuando cargues tu primer paciente, aparece en
  esta lista."
- "Hoy no hay nada agendado. A veces eso también es parte del trabajo."

**Onboarding**
- "Vamos de a poco: primero tu nombre, después la tarifa. El resto lo
  cambiás cuando quieras."
- "Esto es Hoy: lo que tenés por delante y lo que quedó pendiente. Es la
  pantalla que más vas a mirar."

**Confirmaciones alegres**
- "Cobrado. Ese ya está." *(toast del cobro, `toast.tsx`, sin dibujo: el
  toast es `ink-900`; en Hoy la posada celebra con un gesto)*
- "Nota guardada." *(en la nota, sin dibujo; la posada asiente cuando
  vuelve a una de sus pantallas, sólo si la sesión no tuvo señal de riesgo)*

**La línea del día** *(Hoy, la primera vez del día en el dispositivo;
nunca un día con riesgo; sin "Buen día" adelante, porque la cabecera ya
saluda)*
- "Hoy tenés 3 sesiones." / "Te quedan 2 sesiones por delante."
- "Hoy no hay agenda. Buen momento para ponerte al día."

Lo que **no** dice, en ningún contexto: nada sobre el contenido de una
sesión, nada sobre una paciente, ningún "¡bien ahí!", ningún chiste sobre
el trabajo clínico, ninguna felicitación por una racha.

---

## Producción

- **Formato.** SVG propio sobre una grilla de 24 (`viewBox="0 0 24 24"`, como
  el resto de los íconos). Un componente con una prop `pose`; nunca archivos
  de imagen.
- **Tamaños** (`TAMANOS_LUPITA`): 20 px inline en una línea de ayuda o en el
  menú, 32 px junto al "procesando" de Hoy y al recordatorio de Grabar, 34 px
  la posada (`LADO_POSADA`), 72 px en el encabezado del panel de ayuda, 96 px
  en un estado vacío dentro del círculo crema. Debajo de 32 px
  (`TAMANO_CON_DETALLE`) se dibuja sin el punto dorado del brote, porque a ese
  tamaño ensucia, y no se mueve.
- **Poses.** Siete (06, sección 1): **saluda** (también el reposo),
  **señala**, **celebra**, **saluda-alto** y **asiente** (cuadros del medio
  de un gesto), **concentrada** (sentada junto a la nota que se escribe) y
  **piensa** (el otro extremo del vaivén del chat). Todas con los mismos
  comandos de trazo, para que cualquiera morfe a cualquiera
  (`lupita-formas.test.ts`). Sin ojos ni cara (06, D1): el parpadeo es la
  hoja chica plegada. No hay pose triste, de error ni de carga: en un error
  hablan las palabras y en una espera habla el indicador de progreso.
- **Accesibilidad.** Siempre `aria-hidden="true"`: es decoración de un texto
  que ya dice todo. Si alguna vez queda sola, sin texto al lado, está mal puesta.
  La posada es la excepción que confirma la regla: es un atajo de puntero,
  fuera del tabulador, del ítem "Lupita" del menú, que sí tiene su rótulo.
