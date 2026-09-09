# Carga y navegación

Por qué el paso entre pantallas se sentía abrupto, qué se cambió, y cómo
medirlo en el teléfono para tener un antes y un después.

## El diagnóstico

Eran dos esperas encadenadas, y la primera era invisible.

**Espera 1 — el hueco muerto.** `src/app/(dashboard)/layout.tsx` declara
`dynamic = "force-dynamic"`, y para una ruta dinámica Next sólo precarga *la
ruta parcial hasta el `loading.js` más cercano*
(`node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`,
sección `prefetch`). No había ningún `loading.tsx` en el proyecto, así que no
había nada que precargar: el toque quedaba bloqueado esperando el payload RSC
y durante ese tiempo **no se movía un solo pixel** — ni el subrayado del menú
(que depende de `usePathname`, y el pathname no cambia hasta que la
navegación commitea), ni el fundido del template, ni ningún aviso.

**Espera 2 — la pantalla nueva llegaba vacía.** Cada vista es un componente
cliente que pide sus datos al montar y mientras tanto dibujaba una línea de
texto: `cargando tu día…`, `Cargando…`, `Abriendo la nota…`. El fundido de
180 ms del template se gastaba fundiendo esa palabra, y el contenido real
aparecía después, de golpe, empujando el layout.

La única pantalla que no se sentía abrupta era la ficha de paciente, y es la
única que ya tenía un esqueleto de verdad.

## Lo que se cambió

- Un `loading.tsx` por pantalla —Hoy, Pacientes, Cobros, la nota— con el
  esqueleto de esa pantalla (`src/components/esqueletos/`). Cierra la
  espera 1 y, de paso, es lo que habilita el prefetch.
- El **mismo** esqueleto en la rama "cargando" del componente cliente, que es
  la espera 2. Un dibujo, dos usos: entre una espera y la otra no parpadea
  nada.
- El scroll volvió al documento (ver la cabecera de `layout.tsx`): con un
  esqueleto —que mide lo que va a medir la pantalla— el `<main>` interno ya
  no se recortaba solo a 0 y las pantallas abrían por la mitad.
- El fundido de la página y el subrayado del menú comparten
  `MS_NAVEGACION` (`src/components/ui/movimiento.tsx`): eran 180 y 260 y la
  pantalla se asentaba dos veces.

## Cómo medir el hueco muerto en el teléfono

Lo que se mide es **el tiempo entre el toque y el primer pixel distinto**, y
el número que lo explica es la duración de la petición RSC. Se mide sobre la
app deployada, no en `next dev`: el prefetch de Next sólo existe en
producción.

1. Teléfono por USB, con **depuración USB** habilitada.
2. En Chrome de escritorio, `chrome://inspect` → *Devices* → el teléfono →
   **inspect** sobre la pestaña de `sesion-seven.vercel.app`.
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

**Qué esperar.** Antes, el paso 4 y el paso 5 daban casi lo mismo: la
petición era todo el tiempo, porque hasta que no volvía no se dibujaba nada.
Después, el paso 4 debería dar parecido —la red no cambió— y el paso 5
debería caer a la decena de milisegundos: el esqueleto sale del prefetch y
se dibuja sin esperar al servidor. **La mejora está en la diferencia entre
los dos números, no en ninguno de los dos por separado.**

Dos comprobaciones más, en la consola del mismo inspector:

- **Scroll al cambiar de pantalla:** bajar hasta el fondo de Cobros, tocar
  Pacientes, y leer `document.scrollingElement.scrollTop`. Tiene que dar 0.
- **Scroll al volver de una nota:** bajar en la ficha o en Hoy, abrir una
  nota, volver con el botón del teléfono, y leer lo mismo. Tiene que dar el
  valor que tenía antes de entrar: eso lo restaura el navegador, y sólo
  puede hacerlo porque el que scrollea es el documento.

Para reproducirlo en la notebook sin el teléfono: DevTools con *Fast 3G* y
*4× CPU slowdown*. No es su red, pero ordena los mismos síntomas.
