# Endurecimiento del cifrado y del historial

Rama `endurecer`, desde `origin/main` (`f1c1914`).

## Escrituras anidadas

La extensión aplica las mismas guardas a cada operación anidada. Recorre las
relaciones del schema generado por Prisma, sin duplicarlas en una tabla manual
y sin interpretar objetos JSON de negocio como operaciones. Incluye padres sin
campos cifrados, varios niveles, listas, `createMany`, `updateMany`, `upsert` y
`connectOrCreate`. No agrega consultas ni cambia las transacciones de Prisma.

Cada create exige su propio `data.id` cuando escribe un blob. Cada update exige
`where.id` string, también en relaciones singulares, y verifica el AAD contra ese
destino. La forma abreviada singular sigue funcionando si no escribe cifrado.
Se rechaza cambiar el id de los modelos cifrados: aun sin escribir un blob nuevo,
ese cambio dejaría ilegibles los anteriores. Los campos con `{ set: blob }`
conservan el rechazo que ya recibían en una escritura directa; se usa el blob
directamente, como devuelven `cifrarX`.

## Garantías en PostgreSQL

Migración aditiva `20260916013000_inmutabilidad`: dos funciones y tres triggers.
No agrega columnas, no reescribe filas y no borra datos.

- `eventos_auditoria`: rechaza UPDATE, DELETE y TRUNCATE.
- `hilo_versiones`: permite cambiar solamente estado, quién resolvió y cuándo.
  Protege también identidad y procedencia, y rechaza DELETE y TRUNCATE, incluidas
  las cascadas. Aceptar, editar o rechazar sigue el flujo de versiones existente.
- La protección aplica tanto al cliente extendido como a SQL directo.

Se eligieron triggers para no depender de la extensión, de comentarios ni de
roles nuevos en cada entorno. Un administrador con permisos DDL puede retirar
los triggers; no se presenta esto como protección contra ese administrador.
La app no recibe una bandera para saltarlos.

Reversión administrativa: `scripts/mantenimiento/revertir-inmutabilidad.sql`
retira únicamente los triggers y funciones de esta tanda. Conserva las filas.
Para restablecer la protección se aplica de nuevo el SQL de la migración; Prisma
no vuelve a ejecutarla por sí solo si figura aplicada. No se ejecutó en producción.

Las limpiezas de fixtures usan DDL transaccional solo mediante el helper de la
base de test validada: desactivan los triggers de borrado, limpian y los reactivan.
Un fallo revierte también la desactivación. Se eliminó el vaciado duplicado de
identidad para usar ese mismo helper. Las pruebas de las reglas corren con los
triggers activos, incluido un caso que comprueba su restauración tras un fallo.

## Guardián de migraciones

El caso exacto «sin rama base y sin SQL» ya fallaba desde `34187da`, incluido en
el main de partida. Se conservó y verificó su prueba de regresión.
Se cerraron dos variantes: sin base también se revisan archivos sin seguimiento,
y un archivo enumerado por Git que no existe ya no se omite dando verde.
Una base válida sin cambios sigue siendo un caso legítimo. Se distingue una
sentencia TRUNCATE del evento TRUNCATE en una declaración de trigger para que la
protección aditiva no se clasifique como un borrado.

## Pruebas y efectos

Las regresiones de create/update anidados, auditoría mutable y contenido del
Recorrido mutable fallaron contra el código original en PostgreSQL 17 local.
Luego se probaron rechazo y aceptación de escrituras válidas, atomicidad de la
transacción, operaciones masivas, relaciones singulares, cascadas, SQL directo,
resoluciones de propuestas y mantenimiento. El guardián se prueba en repositorios
Git temporales: ese caso no necesita una conexión a Postgres.

El recifrado en el lugar es incompatible con la inmutabilidad física de las
versiones del Recorrido. El cron ahora las informa como pendientes y errores,
sin abortar el mantenimiento de las otras columnas y sin anunciar que se puede
retirar su clave. Se agregó una regresión específica. No se inventó un escritor
privilegiado, una excepción de la base ni un segundo formato de cifrado.

## Fuera de alcance y desacuerdos

No se cambiaron consentimiento, release, publicación ni políticas de retención.
No se hizo rotación ni migración de datos reales. Una futura rotación del
historial necesita un procedimiento administrativo explícito y verificable;
mientras tanto se conservan las claves que permiten leerlo. Borrar una paciente
con historial no puede borrar sus versiones por cascada.

No discrepo con cerrar los agujeros. Sí señalo dos precisiones: el guardián exacto
ya estaba corregido, y prometer simultáneamente bytes históricos inmutables y
recifrado automático en el lugar sería contradictorio. Esta implementación da
prioridad a la garantía de inmutabilidad pedida, dejando visible la limitación.
