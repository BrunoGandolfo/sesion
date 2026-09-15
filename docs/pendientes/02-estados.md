# Área 2 — Pendientes después de integrar los textos

15 de septiembre de 2026. Solo quedan trabajos fuera de la integración editorial.

- **Pantalla de la nota:** el servidor conserva los datos anteriores mientras
  reprocesa, pero la pantalla no los mantiene visibles en procesando. Falta esa
  vista. El botón ya dice Volver a escribirla y usa el POST existente.
- **Aprobación:** falta conectar la revisión de menciones con confirmoMenciones.
  El servidor la exige cuando corresponde. LEI_LAS_MENCIONES y MENCIONES_AYUDA
  están en el glosario; no se cambió el formulario clínico en esta tanda.
- **Transcripción:** falta el acceso de lectura en la pantalla. La ruta GET
  existe y registra la lectura; los textos quedaron en el glosario.
- **Para vos:** faltan la presentación de feedbackEstado/feedbackError y el
  botón que llama a POST /api/sesion-clinica/[id]/feedback/reintentar.
  Los textos de los cuatro estados y Pedir de nuevo están integrados.
- **Grabador:** reconstruir captura/subida y conectar las transiciones de
  src/lib/sesion-clinica/estados.ts. Las rutas de upload están retiradas.
  No se certificó la promesa de cifrado local por tramos del consentimiento.
- **Recorrido y worker:** completar integrar_contexto, sus adjuntos/aplicador
  y el consumo del hilo. Verificar la unión de archivos de audio independientes,
  el registro del id ASR antes de esperar y el registro de uso de tokens.
- **Tickets:** quedan implementaciones equivalentes de hash en auth y tickets;
  su posible unificación no fue parte de los textos.
