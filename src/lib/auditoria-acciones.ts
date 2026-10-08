// Catálogo de las acciones del registro de auditoría (eventos_auditoria.accion).
//
// Es la ÚNICA fuente de los nombres: quien escribe un evento (auditar,
// registrarAuditoria, auditarHilo) y quien lo lee (los avisos de notas, las
// métricas de salud, consentimiento-hechos.ts) importan de acá. Antes cada
// lado escribía "sesion.ver" a mano y un error de tipeo en uno de los dos
// dejaba al lector contando un evento que nadie escribía.
//
// No importa NADA a propósito: lo leen el servidor, los tests y
// consentimiento-hechos.ts, que también llega a pantallas. Un import acá
// arrastraría su cadena a todos ellos (misma idea que proxy-liviano.test.ts).
//
// Los valores ya están escritos en la tabla, que es append-only: renombrar
// uno parte el historial en dos nombres. Se agregan, no se cambian.
//
// Lo vigila auditoria-acciones.test.ts: ningún archivo de src (fuera de este
// y de los tests) escribe uno de estos valores como literal, y ninguna ruta
// de src/app/api audita por su cuenta.

export const ACCIONES = {
  sesion: {
    crear: "sesion.crear",
    ver: "sesion.ver",
    verTranscripcion: "sesion.ver_transcripcion",
    subirAudioInicio: "sesion.subir_audio_inicio",
    subirAudioFin: "sesion.subir_audio_fin",
    volverAGrabar: "sesion.volver_a_grabar",
    asrCreado: "sesion.asr_creado",
    transcripcionGuardada: "sesion.transcripcion_guardada",
    resultado: "sesion.resultado",
    aprobar: "sesion.aprobar",
    reprocesar: "sesion.reprocesar",
    reintentar: "sesion.reintentar",
    pedirFeedback: "sesion.pedir_feedback",
    eliminar: "sesion.eliminar",
    descartarGrabacion: "sesion.descartar_grabacion",
    abandonar: "sesion.abandonar",
    /** El historial clínico de la ficha: notas completas en lote. */
    exportar: "sesion.exportar",
  },
  paciente: {
    crear: "paciente.crear",
    editar: "paciente.editar",
    archivar: "paciente.archivar",
  },
  turno: {
    crear: "turno.crear",
    editar: "turno.editar",
    cancelar: "turno.cancelar",
  },
  consentimiento: {
    firmar: "consentimiento.firmar",
    revocar: "consentimiento.revocar",
  },
  hilo: {
    proponer: "hilo.proponer",
    editar: "hilo.editar",
    aceptar: "hilo.aceptar",
    aceptarEditada: "hilo.aceptar_editada",
    rechazar: "hilo.rechazar",
    regenerar: "hilo.regenerar",
    desactualizar: "hilo.desactualizar",
    exportarPdf: "hilo.exportar_pdf",
  },
  cuenta: {
    entrada: "cuenta.entrada",
    registro: "cuenta.registro",
    invitacionCreada: "cuenta.invitacion_creada",
    invitacionUsada: "cuenta.invitacion_usada",
    passwordCambiada: "cuenta.password_cambiada",
    restablecer: "cuenta.restablecer",
    salidaTodas: "cuenta.salida_todas",
  },
  cobro: {
    recordatorio: "cobro.recordatorio",
  },
  recordatorio: {
    /** La profesional abrió el enlace de WhatsApp del recordatorio de un
     *  turno (casos-uso/recordatorios-whatsapp.ts). Abrió, no "mandó": el
     *  mensaje sale de su teléfono y la app no lo ve. */
    whatsappAbierto: "recordatorio.whatsapp_abierto",
  },
  ayuda: {
    pregunta: "ayuda.pregunta",
  },
  salud: {
    /** El cron de salud mandó un correo; el detalle lleva la huella del
     *  contenido para no repetir el mismo aviso (casos-uso/salud.ts). */
    aviso: "salud.aviso",
    /** La corrida que vuelve a no tener nada que avisar después de un aviso:
     *  corta la ventana, para que el mismo problema, si reaparece, avise. */
    normal: "salud.normal",
  },
} as const;

type Hojas<T> = T extends string ? T : { [K in keyof T]: Hojas<T[K]> }[keyof T];

/** Una acción del catálogo. `EventoAuditoriaInput.accion` es de este tipo:
 *  un nombre nuevo entra acá o no compila. */
export type AccionAuditoria = Hojas<typeof ACCIONES>;

/** Todos los valores, para los guardianes. */
export const TODAS_LAS_ACCIONES: readonly AccionAuditoria[] = Object.values(ACCIONES).flatMap(
  (grupo) => Object.values(grupo) as AccionAuditoria[],
);
