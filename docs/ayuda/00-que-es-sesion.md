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

- **Al terminar**, el audio se cifra antes de subirse. **La copia local previa
  no está cifrada.** Su conservación depende del almacenamiento del navegador.
- Al aprobar, la app **intenta borrar el audio remoto** y quita la clave del
  registro activo. Esto no confirma la eliminación de todas las copias.
- La nota clínica y la transcripción se cifran en la base. El contexto tiene
  campos cifrados y otros sin ese cifrado: no todo el historial está protegido
  de la misma manera. Ver `12-camino-del-audio-y-privacidad.md`.
- **AssemblyAI** transcribe y **Anthropic** redacta. La app pide eliminar el
  material de transcripción al terminar; la retención y los accesos de los
  proveedores requieren verificación, no se garantizan desde esta ayuda.
- Hay un registro de auditoría de acciones. No debe contener texto clínico;
  no equivale a una copia de respaldo.

## Lo que NO hace

- **No manda WhatsApp.** Los recordatorios de turno salen por SMS.
  **Recordar cobro** también manda un SMS, pero solo cuando vos confirmás
  el envío desde Cobros.
- **No graba video.** Solo audio.
- **No diagnostica.** El borrador de nota no pone diagnósticos DSM/CIE: la
  hipótesis diagnóstica la escribís vos.
- **No decide por vos.** Ninguna nota entra a la historia clínica sin que la
  apruebes. La señal de riesgo y el feedback son orientativos.
- **No emite facturas** ni cobra plata: registra que cobraste y con qué método.
- **No comparte la cuenta.** Hoy es una sola usuaria.

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
src/lib/recordatorios-sms.ts
src/components/grabacion/GrabadorSesion.tsx
src/app/api/_lib/casos-uso/aprobar-sesion.ts
docs/pipeline.md
docs/encryption.md
processor/prompts/clinical_note_v3.1.1.md
-->
