# El personaje

Lupita, "el brote": el personaje de la app. Vive en `src/components/ui/lupita.tsx`;
su nombre sale de `LUPITA` en `src/lib/glosario.ts`, de donde lo lee también el
prompt del asistente (`src/lib/ayuda-corpus.ts`). Todo lo que sigue usa los
tokens de color que ya existen en `src/app/globals.css`: no se agrega un color
a la paleta para que entre un personaje. Los otros conceptos que se evaluaron
(el canto rodado, el hornero) están en el historial de Git.

## La regla de tono, escrita como se va a aplicar

**Aparece en:** la ayuda (`docs/ayuda/*` y cualquier pantalla de ayuda que
salga de ahí), los estados vacíos, el onboarding y las confirmaciones
alegres —cobrar y sesión aprobada—.

**No aparece nunca en:**

- La nota clínica: `src/app/(dashboard)/sesiones/[id]/` completo, incluida
  la barra de acciones (`barra-acciones.tsx`, que es donde vive hoy la
  confirmación de "Nota guardada"). Esa barra está en la misma pantalla que
  el bloque de riesgo, así que la confirmación de aprobación **se celebra
  después, en Hoy**, no ahí.
- El brief pre-sesión: `brief-pre-sesion.tsx` y `components/clinico/brief-corto.tsx`,
  incluido su uso dentro de la card de Hoy (`card-ahora.tsx`).
- El Recorrido: `recorrido-tab.tsx` y todo `pacientes/[id]/_components/graficos/`.
- A menos de una pantalla de una señal de riesgo. En código, eso es
  concreto: si `clavesDeRiesgo(...)` (`RiesgoDetectadoBanner.tsx`)
  devuelve algo distinto de una lista vacía para esa sesión, la sesión no
  se celebra con el personaje **en ninguna pantalla**, ni en el toast de
  vuelta a Hoy. Se confirma con el `CheckDibujado` de siempre
  (`toast.tsx`) y nada más.

Ese último punto es el que decide si el personaje puede existir: no alcanza
con que no esté en la pantalla del riesgo, tiene que no estar en el camino
de esa sesión.

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

El panel de ayuda decide la secuencia (`movimiento` en `lupita.tsx`), con los
tiempos de `src/lib/movimiento.ts`:

- **brota**, al abrir la ayuda, y **celebra**, al completar una respuesta:
  aparece subiendo en `TIEMPOS.pliegue` (220 ms), una sola vez.
- Reposo, espera y texto se muestran **quietos**: sin pulsos ni loops.
- En el menú, un gesto breve (`TIEMPOS.breve`, 150 ms) al tocar el ítem, sin loop.
- Con `prefers-reduced-motion` no se anima nada: la pose cambia en su lugar.

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
- "Cobrado. Ese ya está." *(toast del cobro, `toast.tsx`)*
- "Nota guardada." *(toast de vuelta en Hoy, sólo si la sesión no tuvo
  señal de riesgo)*

Lo que **no** dice, en ningún contexto: nada sobre el contenido de una
sesión, nada sobre una paciente, ningún "¡bien ahí!", ningún chiste sobre
el trabajo clínico, ninguna felicitación por una racha.

---

## Producción

- **Formato.** SVG propio sobre una grilla de 24 (`viewBox="0 0 24 24"`, como
  el resto de los íconos). Un componente con una prop `pose`; nunca archivos
  de imagen.
- **Tamaños** (`TAMANOS_LUPITA`): 20 px inline en una línea de ayuda, 72 px en
  el encabezado del panel de ayuda, 96 px en un estado vacío dentro del círculo
  crema. Debajo de 32 px (`TAMANO_CON_DETALLE`) se dibuja sin el punto dorado
  del brote, porque a ese tamaño ensucia.
- **Poses.** Tres, no más: **saluda**, **señala** y **celebra**. No hay pose
  triste, de error ni de carga: en un error hablan las palabras y en una espera
  habla el indicador de progreso.
- **Accesibilidad.** Siempre `aria-hidden="true"`: es decoración de un texto
  que ya dice todo. Si alguna vez queda sola, sin texto al lado, está mal puesta.
