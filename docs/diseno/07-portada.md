# La portada: qué se mueve y qué no

La portada (`/login`, `src/app/(auth)/login/_components/portada.tsx`) es lo
primero que ve una colega cuando la dueña le muestra Sesión. Tiene que
transmitir calidez y oficio en los primeros dos segundos sin volverse un sitio
de marketing. Estaba bien escrita pero quieta del todo. Se le agregaron tres
movimientos, **una sola vez cada uno**; después la página queda quieta como
el resto de la app. Textos, orden de secciones, formulario y tokens no
cambiaron.

## Qué se mueve

| Qué | Cómo | Cuándo | Cuánto |
| --- | --- | --- | --- |
| La marca del encabezado | La primera cuenta aparece, el hilo se traza de abajo hacia arriba (`stroke-dashoffset`) y las otras dos cuentas aparecen a mitad y al final del trazo | Al cargar | Hilo en `--duration-pliegue` (220 ms); cada cuenta en `--duration-fast` (150 ms); la última termina a los 370 ms |
| El nombre del producto | `brota` | Cuando la marca termina | Empieza a los 370 ms (`pliegue + breve`) y dura 220 ms: todo el encabezado está quieto a los ~590 ms |
| Titular y párrafo del héroe | `brota` | Desde el primer cuadro | 220 ms cada uno; el párrafo sale 80 ms después del titular |
| Lupita, en "Lupita, para orientarte" | `brota` (el gesto propio de `lupita.tsx`, pose saluda, 72 px, en el círculo crema de la ayuda) | Cuando la mitad de su lugar entra en la vista, una vez | 220 ms |

`brota` es el movimiento que Lupita ya tenía: sube 4 px y aparece, en el
tiempo de pliegue, con la curva común (`--ease-out`). Para el texto se
escribió en CSS (`@keyframes brota` en `src/app/globals.css`) con los mismos
valores; Lupita usa el suyo, sin modificar el componente.

**Por qué CSS y no framer-motion para la marca y el texto.** La animación
sale en el HTML del servidor y arranca con el primer pintado, sin esperar a
que cargue JavaScript ni escribir opacidades en línea que la hidratación
tenga que conciliar. Si el JS tarda, igual se ve la entrada; si no carga, la
página queda completa al terminar la animación.

**Por qué el héroe no espera a la marca.** El titular es lo que se lee
primero; esconderlo 370 ms para que entre "en orden" deja la pantalla vacía
justo en el momento que importa. Marca y héroe son zonas distintas: se
mueven a la vez sin competir.

**Por qué Lupita espera al scroll.** Se presenta donde se la nombra. Hasta
entonces el círculo crema ya ocupa su lugar, así nada se corre cuando ella
aparece.

## Qué no se mueve

- **El formulario.** Entra quieto y usable desde el primer cuadro: ni la
  tarjeta, ni los campos, ni el botón, ni el título "Entrar a tu cuenta".
  Quien viene a entrar no espera a nada.
- El link "Entrar" del encabezado, las funciones, el bloque de cifrado y el
  pie.
- Nada se repite ni queda latiendo. No hay hover nuevos.

## Movimiento reducido

Con `prefers-reduced-motion: reduce` la regla global de `globals.css` apaga
toda animación CSS: la marca, el nombre y el héroe aparecen completos en el
primer cuadro. Lupita no espera al scroll (está desde el principio) y no hace
el gesto (lo decide `lupita.tsx`). Comprobado en navegador: con la
preferencia, `document.getAnimations()` es 0 al cargar.

## Lupita en la entrada: una excepción a `04-personaje.md`

`docs/diseno/04-personaje.md` la pone en la ayuda, los estados vacíos, el
onboarding y las confirmaciones alegres; la entrada no está. La portada, en
cambio, ya tiene una sección que habla de ella, y un personaje nombrado que no
se ve es más raro que uno presente. Por eso aparece **sólo ahí**, al lado del
texto que la explica, y no en el encabezado ni junto al formulario: la
entrada sigue siendo institucional. Si esta excepción se consolida, hay que
agregarla a la lista de `04-personaje.md` (ese archivo no se tocó en esta
rama).

## Deuda anotada

- **80 ms** del escalonado es el único tiempo que no sale de
  `src/lib/movimiento.ts`. Vive como literal en `.brota-escalon`
  (`globals.css`) porque el pedido era exactamente ese valor y
  `movimiento.ts` quedaba fuera del alcance de la rama. Si se consolida,
  mudarlo a `TIEMPOS` y publicarlo como variable.

## Dónde está

- `src/app/_marca.tsx`: prop `trazada` (clase `marca-trazada` y
  `pathLength={1}` en el hilo). Sin el prop el SVG es el de siempre: el ícono
  y el favicon no cambian.
- `src/app/globals.css`: `@keyframes brota`, `traza-hilo`, `aparece-cuenta`
  y sus clases, al lado de `gira-procesando`.
- `src/app/(auth)/login/_components/portada.tsx`: dónde se aplica.
- `src/app/(auth)/login/_components/lupita-portada.tsx`: el lugar de Lupita
  y el IntersectionObserver.
- `src/app/(auth)/login/__tests__/portada-movimiento.test.tsx`: lo que se
  puede afirmar sin navegador.
