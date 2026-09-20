# La nota clínica

**Para qué sirve.** Revisar, editar y aprobar el borrador de nota que la app
escribe de la sesión grabada. Nada entra a la historia sin tu aprobación.

## Llegar a la nota

Desde **Hoy**, desde el turno en la agenda, o desde la pestaña **Sesiones**.
Mientras se escribe dice **"Escribiendo la nota…"** y la pantalla se actualiza
sola; al estar lista, el chip pasa a **Para revisar**.

## Qué contiene, en orden

1. **Cabecera** — *Nota clínica (SOAP)*, el nombre, el día **y la hora** de la
   sesión (para distinguir dos del mismo día) y un chip: **Para revisar**
   (dorado) o **Nota guardada** (verde).
2. Un selector **Nota clínica | Para vos | Transcripción**, que aparece siempre
   que la nota está para revisar o guardada. Debajo, un **índice** de una línea
   (Resumen, Subjetivo, Objetivo, Análisis, Plan, Más de esta sesión) que queda
   a la vista mientras leés: tocá una sección y la pantalla salta ahí.
3. **Audio posiblemente incompleto**, si la grabación tuvo una interrupción:
   *"Revisá la nota teniendo en cuenta que puede faltar parte de lo conversado."*
4. **Frases para revisar**, si la transcripción tiene menciones (ver abajo).
5. **Señal de riesgo**, si la hay (ver abajo).
6. **Resumen** y **Estado emocional observado**.
7. Las cuatro secciones **SOAP**, con su letra y una línea de ayuda:
   - **Subjetivo (S)** — *Lo relatado en sesión*
   - **Objetivo (O)** — *Lo que observaste*
   - **Análisis (A)** — *Tu lectura clínica*
   - **Plan (P)** — *Para la próxima sesión*
8. **Más de esta sesión** (plegado) — **Temas**, **Emociones**,
   **Intervenciones** (con tipo, descripción y minuto), **Apareció por primera
   vez**, **Vuelve a aparecer**, **Se llevó**, **Para la próxima**, **Intensidad
   emocional** (de 1 a 10) y **Alianza terapéutica** (Frágil, Inestable, Estable,
   Fuerte).
9. **Ver el borrador original** (plegado) — aparece **después de aprobar**: es la
   nota tal como la escribió el modelo, antes de tus cambios. Si pedís que se
   vuelva a escribir, la nueva redacción reemplaza ese borrador.

**Para vos** tiene una vista separada, con dirección propia. Ver
`09-para-vos-feedback.md`.

Lo que no vino en el análisis no se dibuja.

## Editar

Con la nota en **Para revisar**, cada sección tiene **Editar** (o tocás el
texto). Lo que escribís vive en la pantalla: **la nota se guarda una sola vez, al
aprobar**. Si intentás salir con cambios sin aprobar, la app pregunta: *"Tenés
cambios sin aprobar en la nota."* *"Si salís de la nota ahora, se pierden."* con
**Quedarme** e **Ir igual**.

## Frases para revisar

Si la transcripción tiene frases que la app marca para leer, aparece el bloque
**Frases para revisar**: *"Estas menciones de la transcripción necesitan tu
lectura. Por sí solas no constituyen una evaluación de riesgo."* Cada frase
aparece con su minuto.

Cuando no hay una señal de riesgo moderada o alta, debajo está la casilla **Leí
las menciones**. Hay que marcarla para poder aprobar; el servidor tampoco aprueba
sin ella. Con riesgo moderado o alto, las frases se muestran igual y alcanza con
revisar la señal.

## La señal de riesgo

Un bloque terracotta titulado **Señal de riesgo** y, si está graduada, el nivel:
*bajo*, *moderado* o *alto*. Puede traer los indicadores marcados (**Ideación
suicida**, **Autolesión**, **Violencia hacia terceros**, **Síntomas psicóticos**,
**Crisis de pánico**), **Lo que dijo** —las citas literales con su minuto— y una
nota breve para vos. Al pie, siempre: *"Detectado desde la transcripción —
evaluá con tu criterio clínico."*

El modelo tiene instrucciones de no graduar una señal sin cita textual, pero la
app no lo comprueba: si ves un nivel sin cita, desconfiá del nivel.

### Confirmar lo que revisaste

Hay una casilla **Revisé esta señal** por cada indicador marcado y otra para la
señal graduada, con cualquier nivel, también bajo. Hay que marcarlas todas para
aprobar.

Si el botón de aprobar está apagado, debajo dice por qué:

- *"Marcá cada señal de riesgo antes de aprobar la nota."*
- *"Leé las frases para revisar y marcá «Leí las menciones» antes de aprobar."*
- *"Revisá las señales y las menciones de la transcripción antes de aprobar."*
- *"La nota cambió. Revisá la versión actual antes de aprobar."*

## Aprobar

Tocá **✓ Aprobar nota** y revisá la confirmación: *"La nota queda aprobada. Se
destruye la clave del audio y su borrado sigue en segundo plano, con reintentos.
La aprobación no se puede deshacer."* Guarda la nota editada. Aparece **Nota
guardada** y permanecés en la nota, con el aviso *"Nota aprobada. El audio se
borra en segundo plano."* y, si hay análisis, **Leer Para vos**.

La clave que abre el audio se destruye en ese momento; el borrado remoto queda
en segundo plano y se reintenta durante unos 15 días, hasta marcarse como fallido
si no lo logra. No equivale a borrar los respaldos anteriores, que pueden
conservar la clave hasta 12 meses.
Ver `12-camino-del-audio-y-privacidad.md`.

Si la nota cambió mientras la revisabas (por ejemplo, porque llegó una nueva
redacción), no se aprueba: la pantalla ofrece **Revisar nota actual** y conserva
tus correcciones en **Tu borrador anterior** para que las recuperes.

La nota aprobada no se puede volver a escribir ni eliminar. **Para vos** sí se
puede volver a pedir después de aprobar.

## Volver a escribirla

Mientras está **Para revisar**, **Volver a escribirla** pide confirmación: *"Se
pide una nueva nota con la transcripción guardada. No se vuelve a transcribir."*
No vuelve a transcribir. Los datos de la nota anterior se conservan mientras llega
la nueva; la pantalla muestra solo *"Escribiendo la nota…"*. No se guarda una
biblioteca de todas las redacciones anteriores. Guardá aparte cualquier texto que
necesites conservar.

## Si falló

Aparece **"No pudimos escribir la nota"** con el motivo. **Reintentar** usa lo que
ya quedó guardado: si hay transcripción, no vuelve a transcribir. **Eliminar**
pide confirmación: *"Se borran la sesión, la transcripción y lo generado; el
audio se manda a borrar. El turno queda libre para volver a grabar. No se puede
deshacer."* La eliminación queda registrada en la auditoría.

Si se agotaron los reintentos automáticos, el motivo lo dice: *"Se agotaron los
reintentos automáticos (5 fallos seguidos). Reintentá o eliminá la sesión."*

Si eliminaste la sesión y querés grabar de nuevo ese turno en el mismo teléfono,
la pantalla de grabar ofrece **Conservar copia y habilitar otra grabación**. Ver
`07-grabar-una-sesion.md`.

## Ver transcripción

En el selector de arriba, tocá **Transcripción**. Es la tercera vista de la
sesión, con la misma cabecera que la nota. El texto se pide recién en ese
momento —abrir la nota no lo trae— y **cada lectura queda registrada**. No se
guarda en el teléfono ni en el navegador.

Se lee en bloques, cada uno con su **minuto** y quién habla (**Terapeuta** o
**Paciente**). *"Quién habla en cada parte lo asignó el sistema automáticamente
y puede estar equivocado."* Si alguna línea no tiene esa forma, se muestra
entera igual: no se descarta nada.

Arriba queda fijo el **buscador**: escribí una palabra (dos letras o más, sin
preocuparte por mayúsculas ni tildes) y muestra cuántas veces aparece (*"2 de
7"*), la resalta y te lleva al lugar; con las flechas, o con Enter, pasás a la
siguiente o a la anterior. Si no está: *"No aparece «…» en esta
transcripción."* La búsqueda es sobre lo que se dijo, no sobre los minutos ni
los nombres.

Si la sesión todavía no tiene texto dice **"Todavía no hay transcripción"**; si
no se pudo abrir, **"No pudimos abrir la transcripción"**, con **Reintentar**.

No tiene audio, no se puede editar ni exportar. La transcripción se conserva
cifrada.

## Qué hace la app por detrás

El modelo recibe instrucciones para basarse en la transcripción y dejar vacío
lo que no puede evaluar. **Puede equivocarse o agregar contenido incorrecto:**
revisá el borrador y las citas antes de aprobar. Las instrucciones no garantizan
que cada afirmación sea correcta.

## Lo que NO hace

- **No guarda mientras escribís.** Si salís sin aprobar, se pierden tus cambios.
- **No aprueba sola** ni con el tiempo.
- **No se puede desaprobar** una nota, ni recuperar el audio.
- **No diagnostica.**
- **Editar no cambia el borrador original**: se ve plegado abajo después de
  aprobar.

<!-- fuentes:
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/nota-sesion-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/mas-de-esta-sesion.tsx
src/app/(dashboard)/sesiones/[id]/_components/seccion-soap.tsx
src/app/(dashboard)/sesiones/[id]/_components/barra-acciones.tsx
src/app/(dashboard)/sesiones/[id]/_components/cabecera-sesion.tsx
src/app/(dashboard)/sesiones/[id]/_components/indice-nota.tsx
src/app/(dashboard)/sesiones/[id]/_components/transcripcion-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/transcripcion.ts
src/components/clinico/MencionesNota.tsx
src/components/grabacion/RiesgoDetectadoBanner.tsx
src/app/api/_lib/casos-uso/sesion/aprobar.ts
src/app/api/_lib/casos-uso/sesion/reclamar.ts
src/app/api/_lib/casos-uso/sesion/ver-transcripcion.ts
src/lib/glosario.ts
processor/prompts/clinical_note_v3.1.1.md
-->
