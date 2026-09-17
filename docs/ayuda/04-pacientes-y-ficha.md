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
a las acciones del paciente; no es un botón flotante. Si la paciente no tiene
turno hoy, **Grabar** lleva a *"Agendá el turno para grabar la sesión"* con el
enlace **Ir a la agenda**: primero hay que agendar.

### Pestaña **Sesiones**

- **Hoy**, si hay turno hoy: la hora, la duración, la modalidad y un botón según
  el momento (**Grabar sesión**, *Escribiendo la nota…*, **Revisar nota**,
  **Cobrar** o **Ver nota**). Si la grabación quedó sin terminar, **Grabar
  sesión** sirve para retomarla. Si la sesión falló, el enlace dice **Ver**.
- **Para retomar** — el brief antes de la sesión (ver `10-el-hilo-y-el-recorrido.md`).
- **Sesiones** — todas las sesiones documentadas, agrupadas por mes (el más
  reciente abierto, los anteriores plegados). Cada fila: fecha, hora, duración,
  modalidad, un chip **Para revisar** o **Nota guardada** y un resumen de dos
  líneas. Se cargan de a 10 con **Cargar más**.

### Pestaña **Recorrido**

El hilo del proceso y los gráficos. Ver `10-el-hilo-y-el-recorrido.md`.

### Pestaña **Ficha**

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
   qué se graba, para qué y por dónde pasa: el cifrado por tramos en el
   teléfono, el almacenamiento en Cloudflare R2, el proceso en Railway, la base
   en Neon, que AssemblyAI recibe audio y vocabulario, y que Anthropic recibe
   la transcripción y el resumen del proceso y, después de aprobar, la nota
   aprobada. También explica que el borrador de la IA se guarda antes de que lo
   apruebes, que el resumen del proceso lo propone la IA y solo queda vigente
   cuando lo aceptás, que el servidor descifra el audio en un archivo temporal
   que se borra al terminar, cómo se pide el borrado en AssemblyAI y hasta
   cuándo se reintenta, que al aprobar se destruye la clave del audio y el
   borrado se reintenta durante unos 15 días, que en el teléfono queda una copia
   cifrada, los respaldos (diarios de 30 días y mensuales de hasta 12 meses, que
   pueden conservar la clave), qué queda guardado (nota,
   transcripción, resumen del proceso, autorización y firma), que podés imprimir
   el resumen del proceso para tu propio archivo, qué puede pedirte (que le
   muestres sus notas aprobadas y el resumen de su proceso, y que corrijas sus
   datos de contacto o ese resumen) y qué no se puede hacer desde la app (borrar
   sus datos, corregir una nota aprobada, ver la transcripción o la autorización
   firmada), que puede revocarla cuando quiera y que aceptar no es obligatorio.
   Se enmarca en la **Ley 18.331**.
3. La paciente marca **"Leí y entiendo la información anterior"**.
4. Firma con el dedo donde dice **Firmá acá**.
5. Tocá **Firmar**.

Firmada, aparece el chip verde **Grabación autorizada** y *"Firmada el …"*.
La versión vigente del texto es **2.5**. Las firmas anteriores, incluidas la
2.1, la 2.2, la 2.3 y la 2.4, siguen sirviendo para grabar y no hace falta revocarlas,
pero **necesitan que la paciente firme la 2.5**: no cuentan el acceso de Lupita a la agenda ni lo que corrige la
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
src/lib/glosario.ts
-->
