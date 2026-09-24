# Carga y navegación

Por qué cada pantalla del panel tiene un esqueleto de carga, qué regla hay
que respetar al agregar una, y cómo medir la navegación en el teléfono.

## Las dos esperas

Al tocar un destino del menú hay dos esperas encadenadas, y la primera es
invisible si no se la cubre.

**Espera 1 — el hueco muerto.** `src/app/(dashboard)/layout.tsx` declara
`dynamic = "force-dynamic"`, y para una ruta dinámica Next sólo precarga *la
ruta parcial hasta el `loading.js` más cercano*
(`node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`,
sección `prefetch`). Sin `loading.tsx` no hay nada que precargar: el toque
queda bloqueado esperando el payload RSC y no se mueve un solo pixel —ni el
subrayado del menú, que depende de `usePathname`, ni el fundido del template—.

**Espera 2 — la pantalla nueva llega vacía.** Cada vista es un componente
cliente que pide sus datos al montar. Si mientras tanto dibuja una línea de
texto, el fundido se gasta en esa palabra y el contenido real aparece
después, de golpe, empujando el layout.

## La regla

- Cada pantalla del panel tiene un `loading.tsx` con su esqueleto
  (`src/components/esqueletos/`): hoy Hoy, Pacientes, Cobros y la nota. Cubre
  la espera 1 y habilita el prefetch.
- El **mismo** esqueleto va en la rama "cargando" del componente cliente, que
  es la espera 2. Un dibujo, dos usos: entre una espera y la otra no parpadea
  nada.
- El que scrollea es el documento, no un `<main>` interno (ver la cabecera de
  `layout.tsx`): así Next vuelve arriba al cambiar de pantalla y el navegador
  restaura la posición al volver.
- El fundido de la página y el subrayado del menú comparten `MS_NAVEGACION`
  (`src/components/ui/movimiento.tsx`), para que la pantalla se asiente una
  sola vez.

## Cómo medir el hueco muerto en el teléfono

Lo que se mide es **el tiempo entre el toque y el primer pixel distinto**, y
el número que lo explica es la duración de la petición RSC. Se mide sobre la
app deployada, no en `next dev`: el prefetch de Next sólo existe en
producción.

1. Teléfono por USB, con **depuración USB** habilitada.
2. En Chrome de escritorio, `chrome://inspect` → *Devices* → el teléfono →
   **inspect** sobre la pestaña de `sesionapp.app`.
3. Pestaña **Network**. Marcar *Preserve log* y escribir **`_rsc`** en el
   campo de filtro: Next pide el payload de cada navegación con ese
   parámetro de query, así que ese filtro deja exactamente las peticiones de
   navegación y nada más.
4. En el teléfono, desde Hoy, tocar **Cobros**. Aparece una fila. Anotar su
   **Duration** (la columna *Time*); ése es el hueco muerto. Repetir con
   Pacientes y con una nota, y hacer cada una tres veces: la primera de cada
   ruta paga el arranque de la función en Vercel y no es representativa.
5. Para el número que ella siente, la pestaña **Performance**: grabar,
   tocar, parar, y leer del trazo la distancia entre el `pointerdown` y el
   primer *Paint* que cambia la pantalla.

**Qué esperar.** Con el esqueleto precargado, el paso 5 tiene que dar mucho
menos que el paso 4: el esqueleto se dibuja sin esperar al servidor. Si los
dos dan casi lo mismo, la pantalla perdió su `loading.tsx` o su prefetch. No
hay un número garantizado: depende de la red y del teléfono.

Dos comprobaciones más, en la consola del mismo inspector:

- **Scroll al cambiar de pantalla:** bajar hasta el fondo de Cobros, tocar
  Pacientes, y leer `document.scrollingElement.scrollTop`. Tiene que dar 0.
- **Scroll al volver de una nota:** bajar en la ficha o en Hoy, abrir una
  nota, volver con el botón del teléfono, y leer lo mismo. Tiene que dar el
  valor que tenía antes de entrar: eso lo restaura el navegador, y sólo
  puede hacerlo porque el que scrollea es el documento.

Para reproducirlo en la notebook sin el teléfono: DevTools con *Fast 3G* y
*4× CPU slowdown*. No es su red, pero ordena los mismos síntomas.
