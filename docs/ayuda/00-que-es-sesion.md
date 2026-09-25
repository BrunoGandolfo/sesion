# Qué es Sesión

**Para qué sirve.** Sesión es la app de tu consulta: agenda, pacientes, cobros,
recordatorios por SMS, la nota clínica de cada sesión grabada y el Recorrido de
cada paciente.

## Lo que hace, en orden

1. **Hoy** — la agenda del día, lo que está pendiente (incluido cuánto te deben)
   y dos números: **Sesiones hoy** y **Este mes**.
2. **Agenda** — los turnos por día, semana y mes. Crear, reprogramar,
   cancelar, marcar "No vino".
3. **Pacientes** — la ficha de cada uno, con tres pestañas: **Sesiones**,
   **Recorrido** y **Datos**. El Recorrido se puede exportar a PDF.
4. **Cobros** — "Te deben" y "Cobros del mes".
5. **Tu consultorio** — tu nombre, tu dirección, tu teléfono, la tarifa, el
   enfoque teórico, el recordatorio, el vocabulario, invitar a una colega y tu
   cuenta.
6. **Grabar** — con la autorización firmada, grabás la sesión. Si no hay
   turno, se crea en el momento de grabar. La app escribe un borrador de nota
   clínica (SOAP) que vos revisás, editás y aprobás, y después propone cómo
   actualizar el Recorrido.
7. **Lupita** — explica cómo usar la app con estos documentos. También puede
   consultar los turnos de hoy, mañana o esta semana de tu consultorio, solo
   con nombre de pila, día, hora, duración y modalidad. No modifica nada.

## Preguntarle a Lupita por la agenda

Podés preguntar «¿Qué turnos tengo hoy?», «¿Quién viene mañana?» o «¿A qué hora
y con quién tengo turnos esta semana?». Usa la hora de Montevideo; la semana
va de lunes a domingo. Muestra los turnos sin cancelar, incluidos los que ya
pasaron, ordenados por día y hora. Si no hay ninguno, lo dice. Si la consulta
falla, muestra un error: no lo confunde con una agenda vacía.

No consulta apellidos, teléfonos, tarifas, deudas, cobros, notas clínicas,
transcripciones, Recorrido, consentimientos ni fichas, aunque se lo pidas.
Tampoco ve otro consultorio ni agenda, cancela o modifica nada. Puede explicar
cómo usar esas pantallas; sus datos quedan fuera de su alcance. Si le pedís
algo fuera de ese alcance o de esos tres períodos, te lo dice con claridad.
Por ahora devuelve el listado completo del período, sin buscar por paciente.

Los listados los arma la aplicación, sin que la IA vuelva a escribir las horas.
La conversación puede enviarse a Anthropic en las preguntas siguientes, incluidos
los nombres y horarios ya consultados. Evitá pegar datos clínicos o personales.
El límite sigue siendo 40 preguntas por día de Montevideo; consultar la agenda
cuenta igual que pedir ayuda. Cerrar el panel borra la conversación de la pantalla.

## Qué pasa con tus datos y los de tus pacientes

- **La app no cifra el audio.** Mientras grabás queda en tu teléfono, protegido
  por el bloqueo del teléfono; viaja por una conexión cifrada (TLS) y el almacén
  donde espera lo cifra en reposo.
- Al aprobar la nota, o al eliminar la sesión, se pide borrar el audio remoto;
  si falla, se reintenta hasta 20 veces, durante unos 15 días, y después el
  borrado queda marcado como fallido. Hasta que se borra, ese archivo se puede escuchar con acceso al
  almacén.
- La nota, la transcripción, el Recorrido, las notas privadas, las notas del
  turno, el vocabulario y la autorización con su firma se guardan cifrados. Los
  datos administrativos tienen otro tratamiento.
- **AssemblyAI** recibe audio y vocabulario, que puede incluir nombres propios.
  **Anthropic** recibe la transcripción y el Recorrido para redactar, y propone
  los cambios del Recorrido. A AssemblyAI se le pide borrar apenas termina la
  transcripción y, si se completó, se reintenta durante unos 15 días.
- Los respaldos diarios se conservan **30 días** y hay además una copia mensual
  que se conserva **hasta 12 meses**. No contienen audio.
- Para transcribirlo, el servidor tiene el audio solo en memoria: no lo escribe
  en ningún archivo.
- El PDF del Recorrido que exportás sale **sin cifrar** y queda bajo tu cuidado.
- La autorización vigente es la **2.6**. Las firmas anteriores necesitan que la
  paciente firme la nueva. La 2.6 todavía describe un cifrado del audio que la
  app ya no hace. Ver `12-camino-del-audio-y-privacidad.md`.
- Ver el alcance y la configuración de proveedores en
  `12-camino-del-audio-y-privacidad.md`.

## Lo que NO hace

- Los recordatorios de turno salen por SMS.
  **Recordar cobro por SMS** también manda un SMS, pero solo cuando vos confirmás
  el envío desde Cobros.
- **No graba video.** Solo audio.
- **No diagnostica.** El borrador de nota no pone diagnósticos DSM/CIE: la
  hipótesis diagnóstica la escribís vos.
- **No decide por vos.** Ninguna nota entra a la historia clínica sin que la
  apruebes, y el Recorrido solo cambia cuando aceptás una propuesta o lo editás.
  La señal de riesgo y el feedback son orientativos.
- **No emite facturas** ni cobra plata: registra que cobraste y con qué método.
- Cada profesional usa su propia cuenta y su propio consultorio.

<!-- fuentes:
README.md
AGENTS.md
src/lib/glosario.ts
src/lib/consentimiento.ts
src/components/layout/sidebar.tsx
src/components/layout/bottom-nav.tsx
src/app/(dashboard)/pacientes/[id]/_components/paciente-detail-view.tsx
src/app/(dashboard)/cobros/_components/cobros-view.tsx
src/lib/deudas.ts
src/app/(dashboard)/_components/kpis.tsx
src/app/(dashboard)/config/_components/config-view.tsx
src/lib/grabacion-storage.ts
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/app/api/_lib/casos-uso/trabajos/politica.ts
src/components/clinico/HiloView.tsx
src/lib/ayuda-corpus.ts
.github/workflows/backup.yml
docs/pipeline.md
docs/encryption.md
processor/prompts/clinical_note_v3.1.1.md
-->
