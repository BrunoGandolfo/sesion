# Pacientes y la ficha

**Para qué sirve.** Dar de alta pacientes, encontrarlos, y trabajar en su ficha:
sesiones, recorrido, datos, autorización y archivo.

## La lista

Dos solapas, **Activos** y **Archivados**, y un buscador (*"Buscar por
nombre..."*, busca por nombre o apellido). Ordenada por apellido. En la
computadora hay columnas —Nombre, Teléfono, Tarifa, Última sesión, Deuda—; en el
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
deuda, *"Próxima: …"* o *"Sin próximo turno"*, y **Editar**. Si falta la
autorización, ahí mismo aparece un aviso dorado —**"Falta la autorización** para
grabar las sesiones. La paciente la firma acá mismo."*— con el botón **Firmar
autorización**. El botón **Grabar** está en la cabecera de la ficha, junto
a las acciones del paciente; no es un botón flotante.

### Pestaña **Sesiones**

- **La sesión de hoy**, si hay turno hoy: la hora, la duración, la modalidad y un
  botón según el momento (**Grabar sesión**, *Escribiendo la nota…*,
  **Revisar nota**, **Cobrar** o **Ver nota**).
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
- **Notas privadas** — se guardan solas: *"Se guarda solo. Solo vos las ves."*
- **Autorización para grabar las sesiones** — ver abajo.
- **Turnos y pagos** — plegado; muestra cuántas sesiones hay sin cobrar y el
  historial completo de turnos con su estado, método y monto.
- **Archivo** — archivar o reactivar.

## La autorización de grabación (consentimiento)

1. En la ficha, tocá **Firmar autorización**.
2. Se abre **Autorización para grabar las sesiones**. **La lee la paciente**:
   qué se graba, para qué y qué reciben los proveedores: AssemblyAI recibe
   audio y vocabulario; Anthropic, transcripción e hilo. También explica el
   cifrado por tramos, el borrado con reintentos, los respaldos de 30 días,
   qué queda guardado (nota y transcripción), que puede revocarla cuando quiera y
   que aceptar no es obligatorio. Se enmarca en la **Ley 18.331**.
3. La paciente marca **"Leí y entiendo la información anterior"**.
4. Firma con el dedo donde dice **Firmá acá**.
5. Tocá **Firmar**.

Firmada, aparece el chip verde **Grabación autorizada** y la fecha de firma.
La versión vigente del texto es **2.0**. Las firmas anteriores siguen vigentes:
podés sugerir firmar el texto nuevo en la próxima sesión; no hace falta
revocar la firma anterior ni bloquear la grabación.

**Revocar**: el botón **Revocar** avisa *"Las próximas sesiones no se van a
grabar. Lo ya grabado y sus notas se conservan."*

**Sin autorización vigente no se puede grabar**: la app no deja crear la sesión.

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
src/app/api/sesion-clinica/route.ts
-->

La promesa de cifrado durante la grabación del consentimiento 2.0 todavía no
está implementada en el grabador actual: la copia local previa no está cifrada.
Ver `12-camino-del-audio-y-privacidad.md`.
