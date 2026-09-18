# El camino del audio y la privacidad

**Para qué sirve.** Entender por dónde pasa el audio, qué queda guardado, qué se
borra y cuándo, y qué necesita todavía verificación de quien administra Sesión.

## En el teléfono

1. Cada sesión tiene una clave propia, que genera el servidor y el teléfono
   pide al empezar a grabar. No se guarda en el teléfono.
2. Cada trozo de audio que entrega el micrófono, cada segundo, **se cifra en el
   teléfono** con esa clave y recién después se guarda en el almacenamiento del
   navegador. En el teléfono no queda audio sin cifrar.
3. Al terminar, el archivo completo **se cifra con esa misma clave** y recién
   entonces se envía. Mientras grabás no se sube nada.

La copia cifrada queda en el navegador hasta que el servidor confirma que el
archivo llegó: con esa confirmación, la app la borra. Si la subida falla, la
copia se conserva, cifrada, para reintentar; para abrirla la app le pide la
clave al servidor, que solo la entrega mientras la sesión sigue grabando.

## En los servicios

1. El archivo se guarda cifrado en **Cloudflare R2**.
2. El proceso que corre en **Railway** descarga el archivo y lo descifra **en
   memoria** para transcribir: no escribe ningún archivo con audio en claro en
   el servidor. El consentimiento lo cuenta así: *"lo descifra solo en
   memoria y lo manda a transcribir"*.
3. **AssemblyAI** recibe el audio sin cifrar y el vocabulario.
4. Apenas termina la transcripción, bien o mal, la app le pide a AssemblyAI que
   borre el audio y el texto. Ese primer pedido es uno solo.
   - **Si la transcripción se completó**, la app además repite el pedido, cada
     vez más espaciado, **hasta 20 veces**, durante **unos 15 días**, hasta que
     AssemblyAI responde que lo borró o que ya no existe. Si aun así no lo
     logra, el borrado queda marcado como fallido y avisa a quien administra
     Sesión.
   - **Si la transcripción falla**, o el proceso se interrumpe o no logra dejar
     anotado ese reintento, queda solo el primer pedido, o ninguno si el proceso
     se cortó antes, y la app no puede comprobar que AssemblyAI lo haya borrado.
   - Que AssemblyAI responda que el texto "ya no existe" cuenta como borrado: la
     app no puede distinguir si lo borró antes o si nunca llegó a existir.
5. **Anthropic** recibe la transcripción y el Recorrido vigente de la paciente
   para redactar la nota, la transcripción para el análisis **Para vos**, y la
   nota aprobada con el Recorrido vigente para preparar una propuesta del
   Recorrido. El resumen del proceso lo propone la misma IA que redacta la nota;
   solo queda vigente cuando lo aceptás.
6. Al aprobar la nota, la app destruye siempre la clave del audio en la base con
   la que trabaja: desde ahí ya no puede abrir el audio, aunque siga pendiente de
   borrado. Después intenta borrar el archivo en R2 y comprueba que ya no esté.
   Si falla, reintenta **hasta 20 veces**, durante **unos 15 días**; después el
   borrado queda marcado como fallido. La transcripción y la nota se conservan.

## La agenda y Lupita

Lupita puede consultar solo el nombre de pila, el día, la hora, la duración y la
modalidad de los turnos de hoy, mañana o esta semana de tu consultorio. No lee
fichas, teléfonos, montos, notas, transcripciones, Recorrido ni consentimientos.
Solo consulta; no modifica nada.

El servidor prepara esos listados. Si seguís conversando, las preguntas y
respuestas anteriores se envían a Anthropic, y pueden incluir esos nombres y
horarios. Evitá pegar datos clínicos o personales. El consentimiento 2.6 explica
este uso de la agenda. El acceso de Lupita no abre los registros clínicos.

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
la transcripción, la preparación de cada copia del Recorrido para PDF y cada
cambio del Recorrido. Ese registro no se puede modificar ni borrar desde la app, y la base
lo impide también.

## El PDF del Recorrido

El PDF que exportás desde el Recorrido sale de la app **sin cifrar**: queda bajo
tu cuidado, como cualquier registro en papel. Queda registrada la preparación de
la copia; volver a imprimir desde la hoja ya abierta no agrega otro registro. El
consentimiento 2.6 se lo cuenta a la paciente. Ver
`10-el-hilo-y-el-recorrido.md`.

## Respaldos y eliminación

Hay dos clases de respaldo de la base:

- Los **diarios** se conservan **30 días**.
- El primer día de cada mes se guarda además una copia **mensual**, que se
  conserva **12 meses**.

No contienen audio, pero sí pueden contener cifrada la clave de una sesión que
todavía no estaba aprobada cuando se hizo la copia. Esa clave puede conservarse
**hasta 12 meses** en un respaldo mensual, aunque ya se haya borrado de la base
con la que trabaja la app. Si el audio no se pudo borrar, esa copia de la clave
podría permitir abrirlo. Aprobar hoy no cambia los respaldos anteriores. El
consentimiento 2.6 cuenta los dos plazos.

Quitar la clave activa no garantiza que hayan desaparecido todas las copias.
Los pedidos de borrado se siguen con reintentos; el funcionamiento y la
restauración de los respaldos requieren comprobación.

## Autorización y revocación

La versión vigente del texto de autorización es la **2.6**. Revocar la
autorización impide grabaciones futuras. No borra la historia que ya quedó
guardada.

## Qué puede pedir la paciente

La autorización le cuenta a la paciente lo que puede pedirte y la app hace:

- **Que le muestres** sus notas clínicas aprobadas y el resumen de su proceso,
  en pantalla o impreso.
- **Que corrijas** sus datos de contacto, con **Editar datos**, o el resumen de
  su proceso, con **Editar Recorrido**. Corregir el resumen agrega una versión:
  las anteriores se conservan.

Y le dice lo que **no se puede hacer desde la app**: borrar sus datos, corregir
una nota ya aprobada, y ver la transcripción o la autorización firmada. Hasta la
versión 2.3 el texto decía que tenía derecho a pedir que sus datos se eliminen;
la app no lo ejecuta, y la 2.4 dejó de prometerlo.

## Firmas anteriores

**Las firmas de versiones anteriores, incluida la 2.5, necesitan que la paciente firme la 2.6**. La 2.5 decía
que el audio se iba subiendo en partes mientras se grababa, que el servidor lo descifraba en un archivo temporal y
que la copia cifrada del teléfono no se borraba: el grabador de hoy sube el archivo entero al terminar, el
servidor lo descifra en memoria y la copia del teléfono se borra al confirmar la subida. Las anteriores a la 2.5
no explican la consulta de agenda de Lupita
ni que los datos de agenda pueden enviarse en el historial del chat. Las anteriores a la 2.4 prometen
derechos que la app no ejecuta. Las anteriores a la 2.3 no cuentan cómo ocurre el
borrado en AssemblyAI, que el borrador de la IA se guarda antes de aprobar ni
lo que Anthropic recibe después de aprobar. Las anteriores a la 2.2 tampoco
cuentan los plazos reales de borrado y de respaldo ni que el resumen del
proceso lo propone la IA. La app no bloquea
la grabación con una firma anterior y no te sugiere la nueva en pantalla:
depende de que la pidas vos.

<!-- fuentes:
src/lib/consentimiento-hechos.ts
src/lib/consentimiento.ts
src/components/grabacion/GrabadorSesion.tsx
src/lib/grabacion-storage.ts
src/lib/grabacion-cifrado.ts
src/hooks/useGrabacionSesion.ts
src/lib/glosario.ts
src/lib/prisma-encryption.ts
src/app/api/_lib/casos-uso/audio.ts
src/app/api/_lib/casos-uso/sesion/aprobar.ts
src/app/api/_lib/casos-uso/trabajos/politica.ts
src/app/api/_lib/casos-uso/trabajos/ejecutar-borrado-r2.ts
src/app/api/_lib/casos-uso/hilo/exportar.ts
processor/asr_assemblyai.py
processor/processor.py
prisma/migrations/20260916013000_inmutabilidad/migration.sql
.github/workflows/backup.yml
-->
