# El personaje

> **Decisión de producto · 9 de septiembre de 2026.** Queda revocada la
> indicación “Movimiento: ninguno en la primera versión” de este documento.
> La revisión con evidencia del celular reemplaza el vaivén de ±3° y el
> fundido de 240 ms. El encabezado usa `TAMANOS_LUPITA.encabezado = 72 px`.
> El panel es quien decide la secuencia de `movimiento` en `lupita.tsx`:
>
> - **brota**, al abrir: escala 0,4→1 desde abajo y balanceo -12°→0°;
>   a los 500 ms pasa al reposo. Spring de framer-motion, stiffness 220,
>   damping 14, con leve sobreimpulso.
> - **respira**, sólo mientras la ayuda está abierta: escala 1→1,04→1,
>   rotación -2°→2°→-2°, ciclo de 3,5 s, easeInOut, repetido.
>   Es el único loop de reposo de la app: nunca en menú ni estados vacíos.
> - **piensa**, desde la pregunta hasta el primer fragmento: inclinación
>   -10°→10°→-10°, ciclo de 1,2 s; reemplaza la respiración.
> - **habla**, por cada fragmento: bob vertical 0→-2→0 px en 150 ms;
>   reemplaza la búsqueda, sin repetir mientras espera otro fragmento.
> - **celebra**, al completar: salto 0→-10→0 px y escala 1→1,15→1 en
>   450 ms con spring (subida y regreso), mientras las hojas se abren a
>   la pose celebra. Una sola vez; después vuelve a respira.
> - **quieta**: figuras del hilo y estados vacíos, sin animación.
>
> El menú inferior conserva 20 px: un bob 0→-3→0 px en 150 ms al tocar
> el ítem (también al activarlo con teclado), sin loop. Las duraciones
> tienen constantes con nombre en `lupita.tsx`.
>
> Con `prefers-reduced-motion` no se renderiza ningún `motion.span` de
> Lupita ni se animan las hojas: entrada fija, pose señala durante la
> espera y pose celebra al terminar, que permanece fija.

Tres conceptos, una recomendación. Todo dentro de los tokens que ya existen
en `src/app/globals.css:9-80`: no se agrega un color a la paleta para que
entre un personaje.

> **Decidido.** Se eligió el concepto A —el brote— con todas las reglas de
> este documento tal como están escritas, y se llama **Lupita**. El nombre es
> lo único que cambió respecto de la recomendación original, que proponía
> "Yuyo": la forma, la paleta, las poses, los tamaños y la regla de tono no se
> tocaron. En el código vive en `src/components/ui/lupita.tsx`, el nombre sale
> de `LUPITA` en `src/lib/glosario.ts` —de ahí lo lee también el system prompt
> del asistente, en `ayuda-corpus.ts`— y la primera pantalla donde aparece es
> el panel de ayuda (`src/components/ayuda/panel-ayuda.tsx`).

Antes de los conceptos, dos cosas que valen para los tres.

## La regla de tono, escrita como se va a aplicar

**Aparece en:** la ayuda (`docs/ayuda/*` y cualquier pantalla de ayuda que
salga de ahí), los estados vacíos, el onboarding y las confirmaciones
alegres —cobrar y sesión aprobada—.

**No aparece nunca en:**

- La nota clínica: `src/app/(dashboard)/sesiones/[id]/` completo, incluida
  la barra de acciones (`barra-acciones.tsx:57-69`, que es donde vive hoy la
  confirmación de "Nota guardada"). Esa barra está en la misma pantalla que
  el bloque de riesgo, así que la confirmación de aprobación **se celebra
  después, en Hoy**, no ahí.
- El brief pre-sesión: `brief-pre-sesion.tsx` y `components/clinico/brief-corto.tsx`,
  incluido su uso dentro de la card de Hoy (`card-ahora.tsx:193`).
- El Recorrido: `recorrido-tab.tsx` y todo `pacientes/[id]/_components/graficos/`.
- A menos de una pantalla de una señal de riesgo. En código, eso es
  concreto: si `clavesDeRiesgo(...)` (`RiesgoDetectadoBanner.tsx:66-75`)
  devuelve algo distinto de una lista vacía para esa sesión, la sesión no
  se celebra con el personaje **en ninguna pantalla**, ni en el toast de
  vuelta a Hoy. Se confirma con el `CheckDibujado` de siempre
  (`toast.tsx:60`) y nada más.

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
`session-row.tsx:167` y compañía). Sin cara. La expresión está en la
inclinación del tallo, no en dos ojitos: es lo que lo vuelve original y lo
que hace que a 24 px siga siendo legible.

**Paleta.** Hoja grande `sage-500` (#4F7A6A), hoja chica `sage-300`
(#9BB6AA), brote nuevo `gold-500` (#A88534) usado sólo como punto de 2 px,
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

**Nombres.** El elegido es el 1.
1. **Lupita** — el que quedó. Es un diminutivo de persona, no de cosa, y por
   eso no infantiliza al dibujo: le pone un nombre propio y ahí termina. Suena
   a alguien de confianza que pasa a dar una mano, que es exactamente el
   trabajo que hace —explicar dónde está algo y volverse a ir—, y de paso
   arrastra la lupa, que es lo que hace quien busca en la ayuda. El primer
   candidato fue **Yuyo** —en rioplatense, cualquier planta que crece sola
   donde no la plantaron: cariñoso, humilde, nada corporativo—; se descartó
   por decisión de producto, no por un problema del nombre.
2. **Retoño** — lo que vuelve a salir después de la poda. Dice
   exactamente lo que hace un proceso terapéutico, sin decirlo.
3. **Malvón** — la planta de balcón de cualquier casa del Río de la Plata.
   Doméstico antes que clínico; el nombre solo ya trae la maceta, la
   ventana y la abuela.

---

## Concepto B · El canto rodado

**Forma.** Una piedra de río: óvalo asimétrico, más ancho abajo, con una
sola veta curva que la cruza en diagonal. Un segundo canto mucho más chico
apoyado a un costado, que es el que se mueve en las poses (el grande nunca
se mueve: esa es la idea). Contorno de 1,8 px, esquinas todas redondeadas,
ninguna recta en todo el dibujo.

**Paleta.** Canto grande `cream-200` (#E8E1D2) con contorno `ink-300`
(#A5B0B2); veta `sage-300`. Canto chico `sage-500`. En celebración, la veta
pasa a `gold-500`.

**Poses.**
- *Saluda:* el canto chico apoyado a la derecha del grande, al ras.
- *Señala:* el canto chico se corre y queda a media altura del lado que
  importa, como una piedra que alguien movió.
- *Celebra:* el canto chico arriba del grande, apilado y centrado —el
  gesto de la pila de piedras que alguien deja en la orilla—.

**Nombres.**
1. **Piedrita** — el diminutivo es todo: algo chico, de la rambla, que se
   levanta y se guarda en el bolsillo.
2. **Canto** — canto rodado, pero también canto de cantar. La ambigüedad
   juega a favor en una app que escucha sesiones.
3. **Camalote** — las islas flotantes de plantas que baja el río. Muy
   rioplatense, aunque le queda grande a una piedra: sirve si el concepto
   deriva hacia algo que flota.

---

## Concepto C · El hornero

**Forma.** Un pájaro reducido a tres arcos: cuerpo (arco grande), cabeza
(arco chico apoyado arriba a la izquierda) y cola (línea corta hacia
abajo a la derecha). Un solo ojo, un punto de 1,5 px. Pico apenas un
triángulo de 3 px. Nunca de frente: siempre de perfil, que es como se ve un
hornero de verdad y lo que lo aleja de cualquier mascota redonda y frontal.

**Paleta.** Cuerpo `terracotta-500` (#B26B45) —el barro con el que
construye—, cabeza `terracotta-100` (#F5E0CC), ojo `ink-900`, pata y pico
`gold-500`.

**Poses.**
- *Saluda:* de perfil, cabeza levantada, cola baja.
- *Señala:* el cuerpo rota 8° y el pico apunta al contenido; la cola sube
  para compensar.
- *Celebra:* un arco más, debajo, que es el borde de su nido de barro
  terminado. Celebra habiendo construido algo, no saltando.

**Nombres.**
1. **Hornero** — el pájaro que construye su casa de barro, solo, sin
   apuro, y la termina. Es la metáfora exacta de lo que hace la app con las
   notas: material crudo que se convierte en registro.
2. **Barro** — el material antes que el pájaro. Sobrio, cálido, y no
   antropomorfiza.
3. **Churri** — por churrinche, el pajarito rojo del campo rioplatense.
   Es el más afectuoso de los tres, y el que más riesgo tiene de sonar
   infantil.

---

## Cómo habla

Vos, rioplatense, frases cortas, sin signos de admiración salvo que la
frase sea genuinamente una celebración chica. Nunca explica clínica. Nunca
usa "usuario", "sistema", "procesando".

**Ayuda**
- "Todo lo que grabás se cifra en tu teléfono antes de salir de acá."
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
- "Cobrado. Ese ya está." *(toast del cobro, `toast.tsx:56`)*
- "Nota guardada. El audio se borró." *(toast de vuelta en Hoy, sólo si la
  sesión no tuvo señal de riesgo)*

Lo que **no** dice, en ningún contexto: nada sobre el contenido de una
sesión, nada sobre una paciente, ningún "¡bien ahí!", ningún chiste sobre
el trabajo clínico, ninguna felicitación por una racha.

---

## Producción

- **Formato.** SVG original dibujado sobre una grilla de 24, en un
  `viewBox="0 0 24 24"` como el resto de los íconos (`movimiento.tsx:314`,
  lucide). Un componente por pose, o uno con una prop `pose`; nunca tres
  archivos de imagen.
- **Tamaños.** 20 px (inline en una línea de ayuda), 32 px (encabezado de
  onboarding y toast), 96 px (estado vacío, dentro del círculo crema de
  56 px que ya usan `day-view.tsx:68` y `cobros-view.tsx:588`, agrandado).
  A 20 px se dibuja sin el detalle chico —el brote dorado, el segundo
  canto, el ojo— porque a ese tamaño ensucia.
- **Estados.** Tres, no más: **neutro** (saluda), **apunta** (señala) y
  **contento** (celebra). No hay estado triste, ni de error, ni de carga: en
  un error hablan las palabras (`ALGO_FALLO`, `glosario.ts:452`) y en una
  espera habla `AnilloProgreso`.
- **Accesibilidad.** Siempre `aria-hidden="true"`: es decoración de un texto
  que ya dice todo. Si alguna vez el personaje quedara solo, sin texto al
  lado, está mal puesto.
- **Movimiento y tamaño del encabezado.** Rige la decisión de producto al
  inicio de este documento: 72 px en ayuda, seis movimientos explícitos
  y poses fijas con `prefers-reduced-motion`. Revoca la entrada con
  `Aparece` de 240 ms y la ausencia de movimiento de reposo.

---

## Recomendación: **A, el brote — "Lupita"**

**Por qué.** Es el único de los tres que ya está en la paleta sin
negociación: es verde salvia, que es el color de marca, y no le pide a la
app un acento nuevo. No tiene cara, así que no compite con nadie por ser
simpático y no se parece a ninguna mascota existente —el riesgo real del
encargo—. Funciona a 20 px, que es donde va a vivir el 90 % del tiempo. Y
el nombre "Lupita" hace el trabajo que ninguna ilustración hace sola: es
afectuoso sin ser infantil y no promete nada clínico.

**Por qué no B.** El canto rodado es el más elegante y el más silencioso —y
por eso mismo el que menos comunica. En un estado vacío que tiene que
enseñar el próximo paso, una piedra no señala nada; y sus tres poses son
casi la misma imagen. Si el objetivo fuera decorar, ganaría; el objetivo es
acompañar una explicación.

**Por qué no C.** El hornero es el que mejor cuenta la historia del
producto —construir algo sólido con material crudo— y el que tiene las
poses más ricas. Pierde por dos motivos concretos: su color es
`terracotta`, y en esta app terracotta significa **deuda y riesgo**
(`session-row.tsx:51-58`, `RiesgoDetectadoBanner.tsx:148`, la zona de
deudores en `cobros-view.tsx:454-458`). Un personaje del mismo color que la
señal de alarma es un problema de semántica, no de gusto. Y un pájaro con
ojo es, de los tres, el que más cerca queda de una mascota de app.
