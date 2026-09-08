# El ícono

Tres propuestas de marca para la app, y una recomendación. Nada se monta
todavía: esto es para que Bruno elija mirando.

> **Cómo mirar este documento.** Los SVG están inline. Si tu previsualizador
> de Markdown los filtra (algunos lo hacen por seguridad), abrí
> `docs/diseno/05-icono.html` en el navegador: es el mismo contenido visual,
> con los mismos SVG, sin prosa.

---

## De qué se trata el encargo

Hoy la app no tiene identidad instalable. `public/icon.svg` es una **"S" en
Fraunces**, y un `<text>` dentro de un SVG **no carga fuentes web**: el
navegador dibuja lo que tenga a mano, o no dibuja nada. Es un ícono que
depende de algo que no está.

Ese es el problema de fondo, y no es tipográfico: **una letra en un cuadrado
no es una marca**. No dice nada de lo que hace el producto, no se distingue
de las otras cuarenta apps con una letra en un cuadrado, y en este caso
además no se ve.

Así que las tres propuestas cumplen las mismas reglas duras:

- **Paleta exclusivamente de `src/app/globals.css:9-80`.** Ni un color nuevo.
- **Sin letras ni texto como recurso principal.**
- **Legible a 32 px**, que es donde vive el favicon en la barra de favoritos.
- **Sin caras.** Ni ojos, ni sonrisas, ni siluetas de cabeza.
- **Sin parecerse a ninguna marca conocida** de salud, mensajería o notas:
  nada de cruces, corazones, pulsos, globos de diálogo, hojas de papel con
  renglones ni lápices.

### Cómo se verificó cada una

No alcanza con dibujar bien a 512 px. Cada boceto se **rasterizó a 32 px y
se miró ampliado**, que es la única forma de saber si una forma sobrevive.
Ese paso descartó cinco intentos antes de llegar a estos tres, y conviene
dejar escrito por qué, porque son las trampas de este encargo:

| Boceto descartado | Por qué murió |
| --- | --- |
| Trazo serpenteante continuo | A 32 px se leía como un **3**. Una letra por accidente sigue siendo una letra. |
| Arco grande con un punto adentro | Se leía como una **G**. Mismo problema. |
| Tres arcos anidados ("el nido") | Los huecos se **rellenaban** a 32 px: quedaba una mancha sólida. |
| Espiral | Se leía como un **6** o una **@**. |
| Cuenco con un disco encima | Se leía como una **cara sonriente**. Prohibido explícito. |

La conclusión que queda para el futuro: a 32 px sobreviven **masas
separadas con mucho aire entre ellas**, no los trazos largos y continuos.
Un trazo continuo casi siempre termina pareciéndose a un glifo.

### Una decisión que atraviesa las tres: monocromía

Las tres marcas son de **un solo color** sobre el fondo (con a lo sumo un
segundo tono de apoyo de la misma familia). El dorado (`gold-500`, #A88534)
queda **deliberadamente afuera**: sobre salvia (#4F7A6A) son dos tonos
medios, y a 32 px el detalle dorado se convierte en barro. El dorado es un
acento editorial dentro de la app, no un recurso de marca.

---

## Propuesta A · El hilo

Tres cuentas de tamaño creciente enhebradas en una diagonal.

**Qué representa, en una frase.** Las sesiones se ensartan en un solo hilo y
cada una es un poco más que la anterior — es literalmente `EL_HILO` del
glosario (`glosario.ts`), el contexto longitudinal que la app arrastra de
sesión en sesión.

**Por qué funciona chico.** Son tres masas redondas separadas por aire, que
es la forma que mejor aguanta el rasterizado; el hilo es fino a propósito,
para que a 32 px las cuentas no se peguen entre sí. La diagonal evita que se
lea como una lista o como un signo de puntuación vertical.

**Qué riesgo tiene.** Es el más frágil de los tres: la cuenta chica está en
el límite de fundirse con el hilo a 32 px, y en la versión sobre crema queda
en `sage-300`, que es el elemento de menor contraste de todo el documento.
Además, tres puntos en diagonal es una forma con poca carga: sin el nombre
al lado, no dice "sesiones", dice "tres puntos".

### Sobre fondo salvia

<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><path d="M16 48L48 16" fill="none" stroke="#FAFAF6" stroke-width="3.5" stroke-linecap="round"/><circle cx="18" cy="46" r="5" fill="#9BB6AA"/><circle cx="32" cy="32" r="6.5" fill="#FAFAF6"/><circle cx="46" cy="18" r="8" fill="#FAFAF6"/></svg>
</p>
<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><path d="M16 48L48 16" fill="none" stroke="#FAFAF6" stroke-width="3.5" stroke-linecap="round"/><circle cx="18" cy="46" r="5" fill="#9BB6AA"/><circle cx="32" cy="32" r="6.5" fill="#FAFAF6"/><circle cx="46" cy="18" r="8" fill="#FAFAF6"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><path d="M16 48L48 16" fill="none" stroke="#FAFAF6" stroke-width="3.5" stroke-linecap="round"/><circle cx="18" cy="46" r="5" fill="#9BB6AA"/><circle cx="32" cy="32" r="6.5" fill="#FAFAF6"/><circle cx="46" cy="18" r="8" fill="#FAFAF6"/></svg>
</p>

### Sobre fondo crema

<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><path d="M16 48L48 16" fill="none" stroke="#4F7A6A" stroke-width="3.5" stroke-linecap="round"/><circle cx="18" cy="46" r="5" fill="#9BB6AA"/><circle cx="32" cy="32" r="6.5" fill="#4F7A6A"/><circle cx="46" cy="18" r="8" fill="#4F7A6A"/></svg>
</p>
<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><path d="M16 48L48 16" fill="none" stroke="#4F7A6A" stroke-width="3.5" stroke-linecap="round"/><circle cx="18" cy="46" r="5" fill="#9BB6AA"/><circle cx="32" cy="32" r="6.5" fill="#4F7A6A"/><circle cx="46" cy="18" r="8" fill="#4F7A6A"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><path d="M16 48L48 16" fill="none" stroke="#4F7A6A" stroke-width="3.5" stroke-linecap="round"/><circle cx="18" cy="46" r="5" fill="#9BB6AA"/><circle cx="32" cy="32" r="6.5" fill="#4F7A6A"/><circle cx="46" cy="18" r="8" fill="#4F7A6A"/></svg>
</p>

---

## Propuesta B · Dos

Dos arcos enfrentados, uno arriba y otro abajo, corridos en diagonal y sin
tocarse.

**Qué representa, en una frase.** Dos personas en una habitación y el
espacio que queda entre ellas, que es donde pasa el trabajo.

**Por qué funciona chico.** Es la que mejor aguanta de las tres, y por
razones medibles: dos masas de peso idéntico, el trazo más grueso del
documento (7,5 sobre 64), y el hueco central es el elemento más grande del
dibujo — a 32 px lo que se ve primero es el aire, y el aire no se rellena.
La simetría rotacional de 180° la vuelve imposible de confundir con un
glifo: no hay ninguna letra que se lea igual dada vuelta.

**Qué riesgo tiene.** Dos arcos enfrentados son un gesto **abstracto**: no
cuenta una historia, propone una relación, y hay que estar dispuesto a que
la marca no explique el producto. El riesgo concreto de forma es que, si
alguna vez se juntan o se alinean en vertical, empiezan a leerse como
paréntesis — o sea, como puntuación. La separación diagonal es lo que lo
evita, y no es negociable.

### Sobre fondo salvia

<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><g fill="none" stroke="#FAFAF6" stroke-width="7.5" stroke-linecap="round"><path d="M16 24A13 13 0 0 1 42 24"/><path d="M22 40A13 13 0 0 0 48 40"/></g></svg>
</p>
<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><g fill="none" stroke="#FAFAF6" stroke-width="7.5" stroke-linecap="round"><path d="M16 24A13 13 0 0 1 42 24"/><path d="M22 40A13 13 0 0 0 48 40"/></g></svg>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><g fill="none" stroke="#FAFAF6" stroke-width="7.5" stroke-linecap="round"><path d="M16 24A13 13 0 0 1 42 24"/><path d="M22 40A13 13 0 0 0 48 40"/></g></svg>
</p>

### Sobre fondo crema

<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><g fill="none" stroke="#4F7A6A" stroke-width="7.5" stroke-linecap="round"><path d="M16 24A13 13 0 0 1 42 24"/><path d="M22 40A13 13 0 0 0 48 40"/></g></svg>
</p>
<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><g fill="none" stroke="#4F7A6A" stroke-width="7.5" stroke-linecap="round"><path d="M16 24A13 13 0 0 1 42 24"/><path d="M22 40A13 13 0 0 0 48 40"/></g></svg>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><g fill="none" stroke="#4F7A6A" stroke-width="7.5" stroke-linecap="round"><path d="M16 24A13 13 0 0 1 42 24"/><path d="M22 40A13 13 0 0 0 48 40"/></g></svg>
</p>

---

## Propuesta C · El brote doble

Dos hojas que salen del mismo punto, una grande y una chica, sin tallo.

**Qué representa, en una frase.** Lo que crece cuando alguien lo acompaña —
y es la única de las tres que le da la mano a Lupita, el brote de
`04-personaje.md`, sin ser ella.

**Por qué funciona chico.** Son dos masas **llenas**, no trazos: el relleno
es lo que mejor sobrevive al rasterizado, y la silueta de punta afilada se
reconoce aun cuando los píxeles del borde se ensucian. La asimetría —una
hoja alta y una baja— le da una dirección de lectura que las formas
simétricas no tienen.

**Qué riesgo tiene.** Dos riesgos, y son los más serios del documento. El
primero: **el ícono se confunde con el personaje**. El encargo dice que la
marca puede dialogar con Lupita pero no *ser* Lupita; una hoja doble está
muy cerca de un brote de dos hojas, y si un día Lupita aparece en un estado
vacío al lado del ícono en la barra, se leen como lo mismo. El segundo: la
hoja es el lugar común del bienestar. Hay cientos de marcas de wellness con
una hoja, y ninguna es memorable por eso.

### Sobre fondo salvia

<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><path d="M32 54C20 44 16 26 26 12C38 22 40 42 32 54Z" fill="#FAFAF6"/><path d="M32 54C42 48 50 36 46 24C36 30 30 42 32 54Z" fill="#C2D4CB"/></svg>
</p>
<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><path d="M32 54C20 44 16 26 26 12C38 22 40 42 32 54Z" fill="#FAFAF6"/><path d="M32 54C42 48 50 36 46 24C36 30 30 42 32 54Z" fill="#C2D4CB"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32"><rect width="64" height="64" rx="14" fill="#4F7A6A"/><path d="M32 54C20 44 16 26 26 12C38 22 40 42 32 54Z" fill="#FAFAF6"/><path d="M32 54C42 48 50 36 46 24C36 30 30 42 32 54Z" fill="#C2D4CB"/></svg>
</p>

### Sobre fondo crema

<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><path d="M32 54C20 44 16 26 26 12C38 22 40 42 32 54Z" fill="#4F7A6A"/><path d="M32 54C42 48 50 36 46 24C36 30 30 42 32 54Z" fill="#9BB6AA"/></svg>
</p>
<p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="180" height="180"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><path d="M32 54C20 44 16 26 26 12C38 22 40 42 32 54Z" fill="#4F7A6A"/><path d="M32 54C42 48 50 36 46 24C36 30 30 42 32 54Z" fill="#9BB6AA"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="32" height="32"><rect width="64" height="64" rx="14" fill="#FAFAF6"/><path d="M32 54C20 44 16 26 26 12C38 22 40 42 32 54Z" fill="#4F7A6A"/><path d="M32 54C42 48 50 36 46 24C36 30 30 42 32 54Z" fill="#9BB6AA"/></svg>
</p>

---

## Recomendación: **B, "Dos"**

**Por qué.**

1. **Es la que mejor se ve a 32 px, y eso no es un detalle: es el encargo.**
   El favicon en la barra de favoritos es el tamaño donde el ícono trabaja
   de verdad. B tiene las dos masas más gruesas y el hueco más grande de las
   tres; A tiene una cuenta que se funde y C tiene una hoja de bajo
   contraste.

2. **Dice lo que es el producto sin ilustrarlo.** Sesión no es una app de
   notas ni una grabadora: es lo que pasa entre dos personas durante una
   hora. Dos arcos enfrentados es exactamente eso, y no hace falta explicarlo.
   Es además el único de los tres que se apoya en algo que el código ya
   afirma: la diada está en `SPEAKER_OPTIONS` (min y max de hablantes
   fijados en 2, `asr_assemblyai.py`) y en el mapeo S0/S1 = Terapeuta /
   Paciente.

3. **Los dos arcos pesan lo mismo.** En una app sobre psicoterapia, que
   ninguna de las dos formas domine a la otra es una decisión de contenido,
   no de composición. La simetría rotacional lo dice sin decirlo.

4. **No compite con Lupita.** El ícono es la app; el brote es quien
   acompaña. Con B, las dos cosas pueden estar en la misma pantalla sin
   pisarse — que es justamente lo que C no puede garantizar.

5. **Es a prueba de la falla que ya tuvimos dos veces.** No depende de
   ninguna fuente. Son dos arcos y nada más: se dibujan igual en un SVG, en
   un PNG generado por Satori o en el ícono maskable de Android.

**Por qué no A.** El hilo es la mejor idea del documento —es vocabulario
propio de la app, no una metáfora prestada— y la peor ejecución de las tres.
La verificación a 32 px lo dejó en el límite, y una marca que apenas pasa la
prueba en el escritorio de quien la dibuja no la pasa en un monitor viejo.
Si en algún momento hace falta un motivo gráfico secundario —una separación
entre secciones, el encabezado de la ayuda—, el hilo con cuentas es un
excelente candidato **a ese uso**, donde tiene 200 px para respirar.

**Por qué no C.** Es la más linda a 512 px y la que peor resuelve el
problema estratégico. La marca de la app y el personaje que la acompaña
tienen que ser distinguibles a primera vista, y dos hojas contra un brote de
dos hojas no lo son. Sumado a que la hoja es la forma más repetida del
rubro, C nos deja con un ícono que se parece a la vez a nuestro propio
personaje y a la competencia. Es mucho para pedirle a una decisión que se
toma una sola vez.

---

# Segunda fase · el plan técnico

Esto es lo que se hace **una vez elegida la marca**, para aprobar junto con
ella.

## Lo que ya está montado (y no estaba cuando arrancó este documento)

Entre que se leyó el estado del repo y que se escribió esto, aparecieron en
`src/app/` los archivos `icon.tsx`, `apple-icon.tsx` y `manifest.ts`. O sea
que **el andamiaje de la segunda fase ya existe**. Vale la pena mirarlo,
porque tiene tres cosas para corregir y ninguna es cosmética:

1. **Los dos íconos siguen dibujando la letra "S", ahora con
   `fontFamily: "Georgia, serif"`.** Es el mismo error de `public/icon.svg`,
   mudado de lugar: **Satori no trae fuentes del sistema**. Si no se le pasa
   un `font` en las opciones de `ImageResponse`, no hay Georgia que valga.
   Es el argumento más fuerte a favor de una marca que no sea una letra: ya
   falló dos veces por la misma razón.

2. **`manifest.ts` apunta sus dos íconos a `/icon.svg`**, que es el archivo
   roto de `public/`. El manifiesto está anunciando un ícono que no dibuja
   nada. Y `sizes: "any"` con un SVG, aunque es válido, no es lo que Chrome
   quiere para ofrecer la instalación: quiere **192 y 512 en PNG**.

3. **`src/app/favicon.ico` sigue siendo el de la plantilla de Next**
   (25 KB, con fecha del 13 de julio, la misma que los cinco SVG
   huérfanos).

Nada de esto se tocó desde este documento: la consigna era proponer, y
además `src/**` está fuera de lo que me toca. Queda anotado para que se
arregle en la misma pasada que la marca.

## Los cambios, archivo por archivo

### `src/app/icon.tsx`

Reemplazar el `<div>` con la "S" por la marca elegida, y generar **los tres
tamaños que hacen falta** en vez de uno solo. La convención está verificada
en la doc de Next 16 que viene en el repo
(`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`
y `.../04-functions/generate-image-metadata.md`):

- `generateImageMetadata()` devuelve un array de objetos, y cada uno **debe**
  traer un `id`; además acepta `size`, `contentType` y `alt`. Sustituye a
  los `export const size` / `export const contentType` de hoy, que son la
  variante de un solo ícono.
- La función que dibuja recibe entonces una prop `id`, y **en Next 16 ese
  `id` es una promesa**: la firma correcta es
  `async function Icon({ id }: { id: Promise<string | number> })` con un
  `const iconId = await id` adentro. El historial de versiones del mismo
  documento confirma el cambio (`v16.0.0`: los params pasaron a ser
  promesas); escribirlo con la firma sincrónica vieja compila y falla.
- Los tres ids: `32` (favicon), `192` y `512` (manifiesto).

**Cómo se dibuja la marca dentro de `ImageResponse`.** Acá hay una trampa y
conviene decidirla antes de escribir el archivo: `ImageResponse` es
`@vercel/og` + **Satori** + Resvg, y Satori soporta *"only flexbox and a
subset of CSS properties"* — nada de `grid`. Para una forma vectorial hay
dos caminos y el segundo es el seguro:

- inline JSX de `<svg>` dentro del árbol, que Satori soporta de forma parcial;
- **un `<img>` con la marca como `data:image/svg+xml;base64,…`**, que es el
  camino que Satori documenta y el que no depende de qué elementos SVG
  soporte la versión instalada.

Recomiendo el segundo, con la marca en una constante compartida. Si al
implementarlo el inline funciona bien, mejor; pero el plan no debería
apoyarse en eso.

### `src/app/apple-icon.tsx`

Igual, con la marca en lugar de la "S" y `size` 180×180 —que ya está bien—.
Acá **no** hace falta `generateImageMetadata`: iOS quiere uno solo. Dos
detalles propios de Apple:

- **sin esquinas redondeadas propias**: iOS aplica su máscara, y un radio
  nuestro adentro del suyo deja un halo. El `borderRadius: "22%"` que hoy
  tiene `icon.tsx` está bien para el favicon y **no** debe copiarse acá.
- **sin transparencia**: fondo salvia lleno hasta el borde.

### `src/app/manifest.ts`

Se mantiene lo que ya está bien —`name`, `short_name`, `theme_color`
`#4F7A6A` (coincide con el `viewport.themeColor` de `layout.tsx:19`),
`background_color` `#FAFAF6`, `display: "standalone"`, `start_url: "/"`— y
se corrige el bloque `icons`:

- sacar las dos entradas a `/icon.svg`;
- poner **192 y 512 en PNG**, apuntando a las URL que emite
  `generateImageMetadata`. **A verificar al implementarlo:** la doc muestra
  la forma `/icon?<generated>` para el ícono único y no deja escrita la URL
  exacta del caso con varios ids; se confirma con un `curl` al HTML generado
  antes de fijar el string en el manifiesto, no de memoria.
- la entrada `maskable` va **aparte** de la normal y con su propio dibujo:
  Android recorta hasta un 20 % de cada borde, así que la marca tiene que ir
  más chica dentro del lienzo. Una misma imagen sirviendo `purpose: "any"` y
  `purpose: "maskable"` —lo que hace el manifiesto de hoy— se ve recortada
  en Android.

### `src/app/favicon.ico`

Reemplazar el de la plantilla. Puede convivir con `icon.tsx`: `favicon.ico`
sólo vale en la raíz de `app/` y cubre a los clientes viejos que piden
`/favicon.ico` a pelo.

### Borrado

Los cinco SVG de la plantilla de Next en `public/`, que no los referencia
nadie:

```
public/file.svg
public/globe.svg
public/next.svg
public/vercel.svg
public/window.svg
```

Y **un sexto**, que el encargo no listaba pero corresponde: `public/icon.svg`,
la "S" rota. No se puede borrar antes de corregir `manifest.ts`, que hoy lo
referencia; el orden es: primero el manifiesto nuevo, después el borrado.

## Orden sugerido

1. Bruno elige marca.
2. La marca se guarda como SVG fuente en `docs/diseno/` (la referencia) y
   como constante en el código.
3. `icon.tsx` + `apple-icon.tsx` con la marca; se mira el resultado real a
   32 px en una pestaña antes de seguir.
4. `manifest.ts` con las URL confirmadas, más la entrada maskable propia.
5. `favicon.ico` nuevo.
6. Borrado de los seis SVG.
7. Verificación: instalar la PWA en un Android y en un iPhone, y mirar el
   ícono en la barra de favoritos del escritorio. Es el único test que vale.
