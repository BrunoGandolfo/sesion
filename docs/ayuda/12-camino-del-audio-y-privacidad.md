# El camino del audio y la privacidad

**Para qué sirve.** Entender por dónde pasa el audio, qué queda guardado, qué se
borra y cuándo, y qué necesita todavía verificación de quien administra Sesión.

## En el teléfono

1. Mientras grabás, la app corta el audio en tramos de un minuto.
2. Cada tramo **se cifra en el teléfono** con una clave propia de esa sesión y
   recién después se guarda en el almacenamiento del navegador. En el teléfono no
   queda audio sin cifrar. El tramo que se está grabando existe sin cifrar solo
   en la memoria, hasta un minuto.
3. Cada tramo se envía ya cifrado mientras seguís grabando.

La copia cifrada queda en el navegador aunque la nota ya esté aprobada: la app no
la borra. Sin la clave, que se destruye al aprobar, no se puede abrir.

La pantalla de entrada todavía dice que *"La copia local previa no está
cifrada"*. Ese texto quedó de la versión anterior del grabador y ya no es cierto;
está pendiente de corregir.

## En los servicios

1. Los tramos se guardan cifrados en **Cloudflare R2**, uno por uno.
2. El proceso que corre en **Railway** descarga los tramos, comprueba que ninguno
   haya cambiado, los descifra y los une para transcribir. Para unirlos usa
   archivos temporales en un disco privado del servidor, que se borran al
   terminar. El texto del consentimiento dice que se descifra *"solo en
   memoria"*: esa frase no describe este paso y está pendiente de corregir.
3. **AssemblyAI** recibe el audio sin cifrar y el vocabulario.
4. Al terminar la transcripción, la app le pide a AssemblyAI que la borre. Si
   falla, se reintenta, cada vez más espaciado, **hasta 20 veces**; si no lo
   logra, avisa a quien administra Sesión. Hay un caso raro, una caída del
   proceso en el momento justo, en el que ese reintento no queda registrado.
5. **Anthropic** recibe la transcripción y el Recorrido vigente de la paciente
   para redactar la nota, la transcripción para el análisis **Para vos**, y la
   nota aprobada con el Recorrido vigente para preparar una propuesta del
   Recorrido.
6. Al aprobar la nota, la clave del audio se destruye en el registro activo y se
   programa el borrado de los tramos en R2. Si falla, se reintenta hasta 20 veces
   y se comprueba que el archivo ya no esté. La transcripción y la nota se
   conservan.

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

La nota, el borrador original, la transcripción, los datos de la sesión, el
análisis para vos, cada versión del Recorrido, las notas privadas de la ficha,
las notas del turno, el vocabulario y el consentimiento con su firma se guardan
cifrados. También se cifra la clave del audio mientras debe conservarse.

Eso no convierte todos los campos de la base en secretos cifrados: nombre,
apellido, teléfono, fechas, estados e importes administrativos siguen
disponibles para organizar el consultorio.

## Qué queda registrado

Hay un registro de auditoría: no es una copia de las notas y no guarda su texto.
Queda registrado, entre otras cosas, cada vez que abrís una nota, cada lectura de
la transcripción, cada exportación del Recorrido a PDF y cada cambio del
Recorrido. Ese registro no se puede modificar ni borrar desde la app, y la base
lo impide también.

## El PDF del Recorrido

El PDF que exportás desde el Recorrido sale de la app **sin cifrar**: queda bajo
tu cuidado, como cualquier registro en papel. El consentimiento 2.1 se lo cuenta
a la paciente. Ver `10-el-hilo-y-el-recorrido.md`.

## Respaldos y eliminación

Hay dos clases de respaldo de la base:

- Los **diarios** se conservan **30 días**.
- El primer día de cada mes se guarda además una copia **mensual**, que se
  conserva **12 meses**.

No contienen audio, pero sí pueden contener cifrada la clave de una sesión que
todavía no estaba aprobada cuando se hizo la copia. Aprobar hoy no cambia los
respaldos anteriores. El consentimiento menciona solo los 30 días: esa diferencia
está pendiente de una decisión del dueño.

Quitar la clave activa no garantiza que hayan desaparecido todas las copias.
Los pedidos de borrado se siguen con reintentos; el funcionamiento y la
restauración de los respaldos requieren comprobación.

## Autorización y revocación

La versión vigente del texto de autorización es la **2.1**. Revocar la
autorización impide grabaciones futuras. No borra la historia que ya quedó
guardada. Las firmas de versiones anteriores siguen vigentes para grabar, pero no
cuentan que el Recorrido se puede exportar a PDF: conviene que la paciente firme
la 2.1. La app no te lo sugiere en pantalla; depende de que lo pidas vos.

<!-- fuentes:
src/lib/consentimiento-hechos.ts
src/lib/consentimiento.ts
src/lib/audio/grabadora.ts
src/lib/audio/cifrado.ts
src/lib/audio/almacen.ts
src/lib/audio/sincronizar.ts
src/lib/glosario.ts
src/lib/prisma-encryption.ts
src/app/api/_lib/casos-uso/audio.ts
src/app/api/_lib/casos-uso/sesion/aprobar.ts
src/app/api/_lib/casos-uso/trabajos/politica.ts
src/app/api/_lib/casos-uso/trabajos/ejecutar-borrado-r2.ts
src/app/api/_lib/casos-uso/hilo/exportar.ts
processor/audio_entrada.py
processor/asr_assemblyai.py
processor/processor.py
prisma/migrations/20260916013000_inmutabilidad/migration.sql
.github/workflows/backup.yml
-->
