# Qué es Sesión

**Para qué sirve.** Sesión es la app de tu consulta: agenda, pacientes, cobros,
recordatorios por SMS y la nota clínica de cada sesión grabada.

## Lo que hace, en orden

1. **Hoy** — la agenda del día, lo que está pendiente y tres números: sesiones
   del día, "Por cobrar" y "Este mes".
2. **Agenda** — los turnos por día, semana y mes. Crear, reprogramar,
   cancelar, marcar "No vino".
3. **Pacientes** — la ficha de cada uno, con tres pestañas: **Sesiones**,
   **Recorrido** y **Ficha**.
4. **Cobros** — "Te deben" y "Cobros del mes".
5. **Tu consultorio** — tu nombre, tu dirección, tu teléfono, la tarifa, el
   enfoque teórico y el recordatorio.
6. **Grabar** — con la autorización firmada, grabás la sesión; la app escribe
   un borrador de nota clínica (SOAP) que vos revisás, editás y aprobás.

## Qué pasa con tus datos y los de tus pacientes

- El consentimiento 2.0 exige cifrar el audio por tramos durante la grabación.
  **Todavía no está implementado en este grabador:** la copia local previa no está cifrada.
  El cifrado actual ocurre al terminar, antes de subir. Esta diferencia sigue pendiente.
- Al aprobar, la clave se destruye en el registro activo y el borrado del audio
  remoto se reintenta hasta confirmar la eliminación.
- La nota, la transcripción, las notas privadas, las notas del turno y el hilo
  se guardan cifrados. Los datos administrativos tienen otro tratamiento.
- **AssemblyAI** recibe audio y vocabulario, que puede incluir nombres propios.
  **Anthropic** recibe la transcripción y el hilo para redactar. El borrado en
  AssemblyAI se reintenta hasta su confirmación.
- Los respaldos se conservan **30 días**. No contienen audio, pero pueden
  conservar cifrada la clave de una sesión todavía no aprobada.
- Ver el alcance y la configuración de proveedores en
  `12-camino-del-audio-y-privacidad.md`.

## Lo que NO hace

- Los recordatorios de turno salen por SMS.
  **Recordar cobro** también manda un SMS, pero solo cuando vos confirmás
  el envío desde Cobros.
- **No graba video.** Solo audio.
- **No diagnostica.** El borrador de nota no pone diagnósticos DSM/CIE: la
  hipótesis diagnóstica la escribís vos.
- **No decide por vos.** Ninguna nota entra a la historia clínica sin que la
  apruebes. La señal de riesgo y el feedback son orientativos.
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
src/components/grabacion/GrabadorSesion.tsx
docs/pipeline.md
docs/encryption.md
processor/prompts/clinical_note_v3.1.1.md
-->
