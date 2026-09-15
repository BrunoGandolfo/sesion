# El camino del audio y la privacidad

**Para qué sirve.** Entender el tratamiento informado en el consentimiento 2.0,
qué queda guardado y qué necesita verificación de quien administra Sesión.

## Una diferencia pendiente en el grabador

El consentimiento 2.0 exige cifrar el audio por tramos durante la grabación.
**Todavía no está implementado en este grabador:** la copia local previa no está cifrada.
Actualmente se cifra al terminar, antes de subir. La captura y subida se están
reconstruyendo; el texto firmado no demuestra que esa protección ya esté funcionando.

## Tratamiento del audio subido

1. El archivo se envía cifrado a **Cloudflare R2**. La subida por segmentos
   independientes todavía está pendiente.
2. El proceso que corre en **Railway** descarga el archivo y lo descifra para
   transcribir. **AssemblyAI** recibe el audio sin cifrar y el vocabulario.
3. Al terminar la transcripción se programa su borrado en AssemblyAI. El pedido
   se reintenta hasta que el proveedor confirma el borrado.
4. **Anthropic** recibe la transcripción y el hilo del paciente para redactar
   la nota y el análisis de tu trabajo.
5. Al aprobar, la clave del audio se destruye en el registro activo y se
   programa el borrado de los archivos de R2. Si falla, se reintenta hasta
   confirmar la eliminación. La transcripción y la nota se conservan.

## Nombres y proveedores

El vocabulario que cargás también se envía a AssemblyAI y puede incluir nombres
propios, incluso el de la paciente. El audio y su transcripción pueden contener
lo que se diga en sesión. Por este camino no se manda automáticamente el teléfono
ni el documento de la ficha.

La configuración registrada de Anthropic indica retención deshabilitada y
contenido sin uso para entrenamiento, verificada por el dueño el **2026-09-04**.
Esa configuración debe volver a comprobarse si cambia la cuenta o el proveedor.
Los accesos humanos y las copias del proveedor dependen de sus condiciones:
esta app no puede verificar por sí sola que nunca acceda una persona.

## Qué se cifra en la base

La nota, la transcripción, el análisis para vos, el hilo, las notas privadas de
la ficha, las notas del turno, el vocabulario y el consentimiento con su firma
se guardan cifrados. También se cifra la clave del audio mientras debe conservarse.

Eso no convierte todos los campos de la base en secretos cifrados: datos de
contacto, fechas, estados e importes administrativos siguen disponibles para
organizar el consultorio. Hay un registro de auditoría; no es una copia de las notas.
Cada lectura de la transcripción queda registrada.

## Respaldos y eliminación

Los respaldos de la base se conservan **30 días**. No contienen audio, pero sí
pueden contener cifrada la clave de una sesión que todavía no estaba aprobada
cuando se hizo la copia. Aprobar hoy no cambia los respaldos anteriores.

Quitar la clave activa no garantiza que hayan desaparecido todas las copias.
Los pedidos de borrado se siguen hasta su confirmación; el funcionamiento y
la restauración de los respaldos requieren comprobación.

Revocar la autorización impide grabaciones futuras. No borra la historia que
ya quedó guardada. Las firmas de versiones anteriores siguen vigentes; se puede
sugerir firmar la versión 2.0 en la próxima sesión.

<!-- fuentes:
src/lib/consentimiento-hechos.ts
src/lib/consentimiento.ts
src/lib/prisma-encryption.ts
src/app/api/_lib/casos-uso/sesion/aprobar.ts
.github/workflows/backup.yml
-->
