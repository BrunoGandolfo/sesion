# Pacientes y la ficha

**Para qué sirve.** Dar de alta pacientes, encontrarlos, y trabajar en su ficha:
sesiones, recorrido, datos, autorización y archivo.

## La lista

Dos solapas, **Activos** y **Archivados**, y un buscador (*"Buscar por
nombre..."*, busca por nombre o apellido). Ordenada por apellido. En la
computadora hay columnas —Nombre, Teléfono, Tarifa, Última sesión, Deuda—; en
**Archivados**, la última columna es el estado, con **Reactivar**. En el
teléfono, una fila por persona con la deuda en un chip terracotta.

## Dar de alta un paciente

1. Tocá **Nuevo paciente**.
2. Completá **Nombre**, **Apellido** y **Teléfono** (obligatorios).
3. **Tarifa por sesión** — viene propuesta la de "Tu consultorio"; podés
   cambiarla. Tiene que ser mayor a 0.
4. Opcional: **Notas (opcional)**.
5. Tocá **Crear paciente**. Aparece **"Paciente creado"**.

El teléfono se guarda normalizado para que el SMS salga bien.

## La ficha

Arriba: el nombre, un chip **Archivado** si corresponde, *"Debe $ …"* si hay
deuda, *"Próxima: …"* o *"Sin próximo turno"*, y **Editar datos**. Si falta la
autorización, ahí mismo aparece un aviso dorado —**"Falta la autorización** para
grabar las sesiones. La paciente la firma acá mismo."*— con el botón **Firmar
autorización**. El botón **Grabar** está en la cabecera de la ficha, junto
a las acciones del paciente; no es un botón flotante. Si la paciente tiene
turno hoy, **Grabar** abre ese turno. Si no, abre la pantalla de grabar igual y
el turno se crea recién cuando tocás **Grabar sesión**. No hace falta agendar
antes. Ver `07-grabar-una-sesion.md`.

### Pestaña **Sesiones**

Lo primero que se ve es la lista **Sesiones**, con la cuenta al lado (*"8
sesiones"*): de la más reciente a la más antigua, agrupadas por mes (el más
reciente abierto, los anteriores plegados con su cuenta). Cada sesión aparece
una sola vez y la cuenta coincide con lo que la lista muestra.

- Cada fila: la **fecha y la hora** (dos sesiones del mismo día se distinguen),
  duración, modalidad, un chip **Para revisar** o **Nota guardada**, el resumen
  **entero** —no se corta— y **Ver nota** (o **Revisar nota**). Tocar la fila
  abre la nota. Si la sesión tiene análisis, también está **Para vos**. Dentro
  de la sesión, el selector de arriba tiene **Nota clínica**, **Para vos** y
  **Transcripción**, que muestra lo que se dijo. Ver `08-la-nota-clinica.md`.
- La sesión de **hoy** está en la misma lista, arriba, marcada **Hoy** y con su
  botón adentro según el momento: **Grabar sesión**, *Procesando la sesión de
  …*, **Revisar nota**, **Cobrar** o **Ver nota**. Si la grabación quedó sin
  terminar, **Grabar sesión** sirve para retomarla. Si la sesión falló, el
  enlace dice **Ver**.
- **Preparar sesión** — el botón a la derecha del título de la lista (en el
  celular, debajo). Está cerrado; al tocarlo se abre el resumen para antes de la
  sesión: la señal de riesgo, la última nota aprobada, *Para la próxima* y *El
  recorrido hasta hoy* con los objetivos y los temas, todo entero (ver
  `10-el-hilo-y-el-recorrido.md`). Si hay una **señal de riesgo**, se avisa al
  lado del botón aunque esté cerrado. Desde Hoy y Agenda se puede llegar con el
  bloque ya abierto (la dirección termina en `?preparar=1`).
- Se cargan de a 10 con **Cargar más**.
- Al volver de una nota, la ficha queda en la misma pestaña y con esa sesión a
  la vista.

### Pestaña **Recorrido**

El Recorrido del proceso, los indicadores por sesión y **Exportar PDF**. Ver `10-el-hilo-y-el-recorrido.md`.

### Pestaña **Datos**

Se llamaba **Ficha**. Tiene lo mismo: los datos administrativos de la paciente.

- **Datos de contacto** — teléfono (se puede tocar para llamar), tarifa
  por sesión y fecha de alta.
- **Notas privadas** — se guardan solas: *"Se guarda solo. Solo vos las ves."* Si
  intentás salir antes de que se guarden, la app avisa.
- **Autorización para grabar las sesiones** — ver abajo.
- **Vocabulario de esta persona** — *"Nombres y palabras que aparecen solo en las
  sesiones de este paciente. Se suman a las de toda la cuenta."* Ver
  `11-tu-consultorio.md`.
- **Turnos y pagos** — plegado; muestra cuántas sesiones hay sin cobrar y el
  historial completo de turnos con su estado, método y monto. Desde ahí se
  cobran los turnos realizados y se deshace un cobro.
- **Archivo** — archivar o reactivar.

## La autorización de grabación (consentimiento)

1. En la ficha, tocá **Firmar autorización**.
2. Se abre **Autorización para grabar las sesiones**. **La lee la paciente**:
   qué se graba, para qué y por dónde pasa (Cloudflare R2, Railway, Neon,
   AssemblyAI y Anthropic), que el resumen del proceso lo propone la IA y solo
   queda vigente cuando lo aceptás, quién puede leerlo, cuándo se borra, los
   respaldos, qué queda guardado, qué puede pedirte (que le muestres sus notas
   aprobadas y el resumen de su proceso, y que corrijas sus datos de contacto o
   ese resumen) y qué no se puede hacer desde la app (borrar sus datos,
   corregir una nota aprobada, ver la transcripción o la autorización firmada),
   que puede revocarla cuando quiera y que aceptar no es obligatorio.
   **Ojo: la 2.6 todavía describe el cifrado del audio que la app ya no
   hace** (que se cifra en el teléfono y que su clave se destruye al aprobar),
   y dice que la transcripción no se puede ver, aunque hoy la ves en la vista
   **Transcripción**. Está pendiente de corrección. Ver `12-camino-del-audio-y-privacidad.md`.
   Se enmarca en la **Ley 18.331**.
3. La paciente marca **"Leí y entiendo la información anterior"**.
4. Firma con el dedo donde dice **Firmá acá**.
5. Tocá **Firmar**.

Firmada, aparece el chip verde **Grabación autorizada** y *"Firmada el …"*.
La versión vigente del texto es **2.6**. Las firmas anteriores, incluidas la
2.1, la 2.2, la 2.3, la 2.4 y la 2.5, siguen sirviendo para grabar y no hace falta revocarlas,
pero **necesitan que la paciente firme la 2.6**: no cuentan que el audio se sube entero al terminar, el acceso de Lupita a la agenda ni lo que corrige la
versión nueva. Ver `12-camino-del-audio-y-privacidad.md`. Pedíselo
en la próxima sesión. La app no te lo sugiere en pantalla; depende de que lo
pidas vos.

**Revocar**: el botón **Revocar** avisa *"Las próximas sesiones no se van a
grabar. Lo ya grabado y sus notas se conservan."*

**Sin autorización vigente no se puede grabar** ni reanudar una grabación: la app
no deja crear la sesión.

## Archivar

**Archivar paciente** pregunta: *"¿Archivar este paciente? Deja de aparecer en la
lista. Las sesiones, las notas y los pagos se conservan; podés reactivarlo cuando
quieras."* Después aparece en la solapa **Archivados**, con **Reactivar**.

## Lo que NO hace

- **No borra pacientes.** Solo se archivan.
- **No manda la autorización por mail** para firmar a distancia: se firma en la
  app, en el momento.
- **Archivar no borra ni oculta** las sesiones, notas ni pagos.

<!-- fuentes:
src/app/(dashboard)/pacientes/_components/pacientes-view.tsx
src/app/(dashboard)/pacientes/_components/nuevo-paciente-form.tsx
src/app/(dashboard)/pacientes/[id]/_components/paciente-detail-view.tsx
src/app/(dashboard)/pacientes/[id]/_components/cabecera-ficha.tsx
src/app/(dashboard)/pacientes/[id]/_components/ficha-tab.tsx
src/app/(dashboard)/pacientes/[id]/_components/sesiones-tab.tsx
src/app/(dashboard)/pacientes/[id]/_components/turnos-pagos-tab.tsx
src/components/grabacion/ConsentimientoBadge.tsx
src/components/grabacion/ConsentimientoForm.tsx
src/lib/consentimiento.ts
src/app/api/pacientes/route.ts
src/app/api/_lib/casos-uso/audio.ts
src/app/(dashboard)/grabar/[turnoId]/page.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/app/(dashboard)/sesiones/[id]/_components/selector-vista.tsx
src/lib/consentimiento-hechos.ts
src/lib/glosario.ts
-->
