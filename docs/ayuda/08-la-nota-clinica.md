# La nota clínica

**Para qué sirve.** Revisar, editar y aprobar el borrador de nota que la app
escribe de la sesión grabada. Nada entra a la historia sin tu firma.

## Llegar a la nota

Desde **Hoy**, desde el turno en la agenda, o desde la pestaña **Sesiones**.
Mientras se escribe dice **"Escribiendo la nota…"**; al estar lista, el chip pasa
a **Para revisar**.

## Qué contiene, en orden

1. **Cabecera** — *Nota clínica (SOAP)*, el nombre, la fecha y un chip: **Para
   revisar** (dorado) o **Nota guardada** (verde).
2. **Señal de riesgo**, si la hay (ver abajo).
3. **Resumen** y **Estado emocional observado**.
4. Las cuatro secciones **SOAP**, con su letra y una línea de ayuda:
   - **Subjetivo (S)** — *Lo que la paciente relató*
   - **Objetivo (O)** — *Lo que observaste*
   - **Análisis (A)** — *Tu lectura clínica*
   - **Plan (P)** — *Para la próxima sesión*
5. **Más de esta sesión** (plegado) — **Temas**, **Emociones**,
   **Intervenciones** (con tipo y minuto), **Apareció por primera vez**, **Vuelve
   a aparecer**, **Se llevó**, **Intensidad emocional** (1 a 10) y **Alianza
   terapéutica** (frágil, inestable, estable, fuerte).
6. **Ver el borrador original** (plegado) — la nota tal como la escribió el
   modelo, antes de que la tocaras. Se conserva al aprobar; pedir una nueva generación reemplaza el borrador de esa generación.

**Para vos** tiene una vista separada, con dirección propia. Cuando hay análisis
disponible, el selector de arriba permite pasar de **Nota clínica** a
**Para vos**. Si falta, ese acceso puede no aparecer: no significa que se haya
borrado la nota. Ver `09-para-vos-feedback.md`.

Lo que no vino en el análisis no se dibuja.

## Editar

Con la nota en **Para revisar**, cada sección tiene **Editar** (o tocás el
texto). Lo que escribís vive en la pantalla: **la nota se guarda una sola vez, al
aprobar**.

## La señal de riesgo

Un bloque terracotta titulado **Señal de riesgo** y, si está graduada, el nivel:
*bajo*, *moderado* o *alto*. Puede traer los indicadores marcados (**Ideación
suicida**, **Autolesión**, **Violencia hacia terceros**, **Síntomas psicóticos**,
**Crisis de pánico**), **Lo que dijo** —las citas literales con su minuto; sin
cita textual la señal no se gradúa— y una nota breve para vos. Al pie, siempre:
*"Detectado desde la transcripción — evaluá con tu criterio clínico."*

### Confirmar lo que revisaste

Con riesgo moderado o alto, marcá que revisaste la señal antes de aprobar.
El servidor también exige confirmar las menciones sin riesgo graduado, pero
**Leí las menciones todavía no está disponible en la pantalla**. Si ese requisito
impide aprobar, avisale a quien administra Sesión; no hay una casilla que puedas
marcar en esta versión para resolverlo.

## Aprobar

Tocá **✓ Aprobar nota** y revisá la confirmación. Guarda la nota editada y
la aprobación no se puede deshacer. Aparece **Nota guardada** y permanecés en la nota.
La clave que abre el audio se destruye en ese momento; el borrado remoto queda
en segundo plano y se reintenta hasta su confirmación. No equivale a borrar los
respaldos anteriores. Ver `12-camino-del-audio-y-privacidad.md`.

La nota aprobada no se puede volver a escribir ni eliminar desde estas acciones.
El reintento de **Para vos** después de aprobar está previsto en el servidor,
pero todavía no está disponible en la pantalla.

## Volver a escribirla

Mientras está **Para revisar**, **Volver a escribirla** pide una nueva redacción
usando la transcripción guardada. No vuelve a transcribir. Los datos de la nota anterior se conservan mientras llega la nueva; la pantalla
puede mostrar solo el aviso de procesamiento. No se guarda una biblioteca
de todas las generaciones anteriores. Guardá aparte cualquier texto que necesites conservar.

## Si falló

**Reintentar** usa lo que ya quedó guardado: si hay transcripción, no vuelve a
transcribir. **Eliminar** borra la sesión, su transcripción y lo generado;
el audio se manda a borrar y el turno queda libre para volver a grabar.
La eliminación no se puede deshacer y queda registrada en la auditoría.

Si se agotaron los intentos, se informa que se intentó cinco veces seguidas.
Una grabación que quedó a medias se distingue de un fallo de procesamiento.

## Ver transcripción

La transcripción se conserva cifrada. **Ver transcripción todavía no está disponible
en la pantalla**. El servidor ya permite la consulta autorizada con la nota en
revisión o aprobada y cada lectura queda registrada; falta conectar ese acceso.

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
- **Editar no cambia el borrador de la generación actual**: queda plegado abajo.

<!-- fuentes:
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/nota-sesion-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/mas-de-esta-sesion.tsx
src/app/(dashboard)/sesiones/[id]/_components/seccion-soap.tsx
src/app/(dashboard)/sesiones/[id]/_components/barra-acciones.tsx
src/components/grabacion/RiesgoDetectadoBanner.tsx
src/lib/glosario.ts
processor/prompts/clinical_note_v3.1.1.md
docs/pipeline.md
-->
