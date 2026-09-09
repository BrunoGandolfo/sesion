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
   modelo, antes de que la tocaras. Queda ahí para siempre.

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

### La casilla "Revisé esta señal"

Por cada indicador marcado, y por la señal graduada, hay una casilla **Revisé
esta señal**. **Hay que marcarlas todas para poder aprobar.** Mientras falte
alguna, el botón queda apagado: *"Marcá cada señal de riesgo antes de aprobar la
nota."* Nunca viene pre-marcada.

## Aprobar

Tocá **✓ Aprobar nota**: *"El audio de la sesión se borra definitivamente y la
nota queda como registro. Esto no se puede deshacer."* Al confirmar aparece
**Nota guardada** y permanecés en la nota. Si hay análisis disponible, podés
tocar **Leer Para vos**; la app no te cambia de pantalla sola.

Aprobar guarda tu nota editada, intenta borrar el audio remoto, quita su clave
del registro activo y deja la sesión disponible para actualizar el hilo.
No confirma la eliminación de todas las copias; ver
`12-camino-del-audio-y-privacidad.md`.

## Descartar

**Descartar** avisa: *"Se puede deshacer: la sesión vuelve a error y la podés
volver a escribir. Se descarta la nota generada; la transcripción y el audio se
conservan."* Después la pantalla ofrece **Reintentar** o **Eliminar** (*"Se
borran la sesión y su audio. No queda registro y no se puede deshacer."*).

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
- **No borra el borrador original** cuando editás: queda plegado abajo.

<!-- fuentes:
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/nota-sesion-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/mas-de-esta-sesion.tsx
src/app/(dashboard)/sesiones/[id]/_components/seccion-soap.tsx
src/app/(dashboard)/sesiones/[id]/_components/barra-acciones.tsx
src/components/grabacion/RiesgoDetectadoBanner.tsx
src/app/api/_lib/casos-uso/aprobar-sesion.ts
src/lib/glosario.ts
processor/prompts/clinical_note_v3.1.1.md
docs/pipeline.md
-->
