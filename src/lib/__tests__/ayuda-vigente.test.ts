import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { ASR_BORRADO_DIAS_APROX, ASR_BORRADO_MAX_INTENTOS, AUDIO_DESCIFRADO_EN_ARCHIVO_TEMPORAL, BACKUP_INCLUYE_CLAVE_AUDIO, CLAVE_AUDIO_DESTRUIDA_AL_APROBAR, LIMPIEZA_AUDIO_DIAS_APROX, LIMPIEZA_AUDIO_MAX_INTENTOS, RECORRIDO_EXPORTABLE, RESPALDO_LOCAL_CIFRADO, RESUMEN_PROPUESTO_POR_IA, RETENCION_BACKUPS_DIAS, RETENCION_BACKUPS_MENSUALES_MESES, VOCABULARIO_A_ASR, VOCABULARIO_INCLUYE_NOMBRES, ANTHROPIC_RETENCION_VERIFICADA_EL } from "@/lib/consentimiento-hechos";
import { CONSENTIMIENTO_VERSION, generarTextoConsentimiento } from "@/lib/consentimiento";
import { LIMITE_SEGUNDOS, AVISO_LIMITE_SEGUNDOS } from "@/lib/audio/contrato";
import { POLITICA_POR_TIPO } from "@/app/api/_lib/casos-uso/trabajos/politica";
import { DISPERSION_MINUTOS } from "@/lib/recordatorios-programacion";
import { ENTRADA_CONFIDENCIALIDAD, FEEDBACK_PEDIR, FEEDBACK_REINTENTAR, INVITAR_WHATSAPP, LEI_LAS_MENCIONES, LINEA_CONTACTO, REMITENTE_SMS, SMS_BAJA_CONFIRMADA } from "@/lib/glosario";

import { beforeEach, describe, expect, it } from "vitest";

import { leerCorpus, olvidarCorpus, systemPromptAyuda } from "@/lib/ayuda-corpus";

/** El código que respalda una afirmación de la ayuda, leído del disco. */
const codigo = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

function componentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === "__tests__" ? [] : componentes(ruta);
    return ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

// Se prueba el material que recibe Lupita, no una copia de los documentos.
// Estas restricciones editoriales no certifican la respuesta del modelo.
function documento(nombre: string): string {
  const marca = `----- ${nombre} -----`;
  const corpus = leerCorpus();
  expect(corpus).toContain(marca);
  return corpus.split(marca)[1].split("----- ")[0].replace(/\s+/g, " ");
}

beforeEach(olvidarCorpus);

describe("la ayuda describe las acciones disponibles", () => {
  it.each([
    "00-que-es-sesion.md",
    "05-cobros.md",
    "06-recordatorios-sms.md",
  ])("%s explica el cobro por SMS con confirmación", (archivo) => {
    const texto = documento(archivo);
    expect(texto).toMatch(/Recordar\s+(?:\*\*)?cobro/i);
    expect(texto).toContain("SMS");
    expect(texto).toMatch(/confirmás el envío/);
    expect(texto).not.toMatch(/abre\s+\*?\*?WhatsApp|desde WhatsApp|lo mandás vos\)/i);
  });
});

it.each(["05-cobros.md", "13-preguntas-frecuentes.md"])("%s permite corregir un cobro sin reabrir el turno", (archivo) => {
  const texto = documento(archivo);
  expect(texto).toContain("**Deshacer cobro**");
  expect(texto).toContain("vuelve a la deuda");
  expect(texto).toMatch(/no vuelve a Agendado/i);
  expect(texto).not.toMatch(/no hay un botón para deshacer|No hay botón para deshacer/);
});

it("la ayuda explica el rechazo de solapamientos y permite turnos consecutivos", () => {
  const texto = documento("03-agenda-y-turnos.md");
  expect(texto).toContain("No permite superponer turnos");
  expect(texto).toContain("no se guarda el cambio");
  expect(texto).toContain("justo cuando termina el anterior");
  expect(texto).not.toContain("No avisa de choques");
});

it("no aconseja bloquear el teléfono ni garantiza recuperar una interrupción", () => {
  for (const archivo of ["07-grabar-una-sesion.md", "13-preguntas-frecuentes.md"]) {
    expect(documento(archivo)).toMatch(/No bloquees la pantalla/);
    expect(documento(archivo)).not.toContain("Podés bloquear la pantalla");
  }
  const prompt = systemPromptAyuda();
  expect(prompt).toContain("La recuperación completa no está garantizada");
  expect(prompt).not.toContain("La llamada se llevó el micrófono, no la sesión");
});

it("los minutos que enseña la ayuda coinciden con los límites de captura", () => {
  const texto = documento("07-grabar-una-sesion.md");
  expect(texto).toContain(`**${LIMITE_SEGUNDOS / 60} minutos**`);
  expect(texto).toContain(`**${AVISO_LIMITE_SEGUNDOS / 60} minutos**`);
  expect(texto).toContain("todavía tenés que terminar");
  expect(texto).not.toContain("hora y media");
});

it.each(["04-pacientes-y-ficha.md", "07-grabar-una-sesion.md"])("%s ubica Grabar en la cabecera", (archivo) => {
  const texto = documento(archivo);
  expect(texto).toContain("cabecera");
  expect(texto).toContain("**Grabar**");
  expect(texto).not.toContain("Abajo del todo");
  expect(texto).not.toContain("Grabar** de abajo a la derecha");
});

it("la ayuda lleva a la vista separada de Para vos y no promete salir al aprobar", () => {
  const nota = documento("08-la-nota-clinica.md");
  expect(nota).toContain("vista separada");
  expect(nota).toContain("permanecés en la nota");
  expect(nota).not.toContain("**Para vos** (plegado)");
  expect(nota).not.toContain("pantalla vuelve sola");
  expect(documento("09-para-vos-feedback.md")).toContain("Abrir la vista no genera un análisis nuevo");
});

it("la ayuda avisa que un campo inválido frena el lote de configuración", () => {
  const texto = documento("11-tu-consultorio.md");
  expect(texto).toContain("no se guarda ninguno de esos cambios");
  expect(texto).toContain("**Reintentar**");
  expect(texto).toContain("antes de salir");
  expect(texto).not.toMatch(/lo demás se guarda igual|Cada campo se guarda por separado|Todo se guarda solo/);
});

it("la ayuda describe el cifrado por tramos que hace el grabador, no una protección pendiente", () => {
  // El grabador cifra cada segmento antes de guardarlo en el teléfono.
  expect(RESPALDO_LOCAL_CIFRADO).toBe(true);
  const grabadora = codigo("src/lib/audio/grabadora.ts");
  expect(grabadora.indexOf("cifrarSegmento(")).toBeGreaterThan(-1);
  expect(grabadora.indexOf("cifrarSegmento(")).toBeLessThan(grabadora.indexOf("guardarSegmento("));
  expect(VOCABULARIO_A_ASR && VOCABULARIO_INCLUYE_NOMBRES).toBe(true);
  for (const archivo of ["00-que-es-sesion.md", "07-grabar-una-sesion.md", "12-camino-del-audio-y-privacidad.md"]) {
    expect(documento(archivo)).toMatch(/se cifra(n)? en el teléfono/);
    expect(documento(archivo)).not.toContain("Todavía no está implementado en este grabador");
    expect(documento(archivo)).not.toMatch(/se cifra al terminar|cifra el archivo al terminar|subida por segmentos independientes todavía está pendiente/);
  }
  // Mientras la pantalla de entrada conserve el texto viejo, la ayuda lo desmiente.
  if (ENTRADA_CONFIDENCIALIDAD.includes("no está cifrada")) {
    expect(documento("12-camino-del-audio-y-privacidad.md")).toContain("Ese texto quedó de la versión anterior del grabador");
    expect(documento("01-entrar-y-cuenta.md")).toContain("Esa frase quedó vieja");
  }
  const texto = documento("12-camino-del-audio-y-privacidad.md");
  expect(texto).toContain("**" + RETENCION_BACKUPS_DIAS + " días**");
  // Los mensuales: 12 meses en backup.yml.
  expect(codigo(".github/workflows/backup.yml")).toContain("366 days ago");
  expect(texto).toContain("**12 meses**");
  expect(texto).toContain(ANTHROPIC_RETENCION_VERIFICADA_EL);
  for (const tipo of ["borrar_audio_r2", "borrar_transcript_asr"] as const) {
    expect(texto).toContain(`hasta ${POLITICA_POR_TIPO[tipo].tope} veces`);
  }
  expect(texto).not.toContain("hasta que el proveedor confirma");
  expect(texto).toContain("pueden contener cifrada la clave");
});

it("la ayuda describe los botones del grabador que existen", () => {
  const vista = codigo("src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx");
  const texto = documento("07-grabar-una-sesion.md");
  for (const boton of ["Grabar sesión", "Reanudar grabación", "Pausar", "Terminar y enviar", "Enviar grabación pendiente", "Comprobar y reintentar envío", "Conservar copia y habilitar otra grabación"]) {
    expect(vista).toContain(boton);
    expect(texto).toContain(boton);
  }
  // /grabar/nuevo no crea un turno: manda a agendarlo.
  expect(codigo("src/app/(dashboard)/grabar/[turnoId]/page.tsx")).toContain("Agendá el turno para grabar la sesión");
  expect(texto).toContain("Agendá el turno para grabar la sesión");
  // La base local tiene una grabación por turno: volver a grabar no reemplaza.
  expect(codigo("src/lib/audio/almacen.ts")).toContain('createIndex("turno", ["cuenta", "turnoId"], { unique: true })');
  expect(texto).toContain("Volver a grabar no reemplaza la copia anterior");
  for (const archivo of ["07-grabar-una-sesion.md", "13-preguntas-frecuentes.md", "14-cuando-algo-falla.md"]) {
    expect(documento(archivo)).not.toMatch(/Terminar la sesión|y un medidor de sonido|Se cortó el micrófono|Cortado|crea uno de 50 minutos|puede reemplazarse la copia/);
  }
});

it("no convierte borrado, cifrado parcial y proveedores en garantías absolutas", () => {
  const privacidad = documento("12-camino-del-audio-y-privacidad.md");
  expect(privacidad).toContain("Si falla, reintenta");
  expect(privacidad).toContain("las notas privadas de la ficha, las notas del turno");
  expect(privacidad).toContain("vocabulario que cargás también se envía");
  expect(privacidad).toContain("requieren comprobación");
  for (const archivo of ["00-que-es-sesion.md", "12-camino-del-audio-y-privacidad.md", "13-preguntas-frecuentes.md"]) {
    expect(documento(archivo)).not.toMatch(/Ninguna persona escucha|Ninguna persona\. El audio|sin que ninguna persona lo escuche/);
  }
  expect(documento("14-cuando-algo-falla.md")).not.toMatch(/Casi nada se pierde|Las dos únicas cosas/);
  expect(documento("08-la-nota-clinica.md")).toContain("Puede equivocarse o agregar contenido incorrecto");
  expect(documento("13-preguntas-frecuentes.md")).not.toContain("Al aprobar se borra el audio");
});

it("describe el Recorrido como versiones que la IA propone y no reemplaza", () => {
  // Las versiones no se modifican ni se borran: lo impide la base.
  expect(codigo("prisma/migrations/20260916013000_inmutabilidad/migration.sql")).toContain("hilo_versiones es inmutable");
  // El trabajo de la IA deja una propuesta; no aplica la versión vigente.
  expect(codigo("src/app/api/_lib/casos-uso/hilo/trabajo.ts")).not.toContain("aplicarVigente");
  // El brief lee solo notas aprobadas.
  expect(codigo("src/app/api/_lib/casos-uso/hilo/brief.ts")).toContain('estado: "aprobada"');
  const texto = documento("10-el-hilo-y-el-recorrido.md");
  expect(texto).toContain("La propuesta no cambia nada por sí sola");
  expect(texto).toContain("las anteriores no se pueden modificar ni borrar");
  expect(texto).toContain("Esa tarea puede quedar pendiente o fallar");
  expect(texto).toContain("usa **solo la última nota aprobada**");
  expect(texto).not.toMatch(/puede reemplazar contenido|pisar una corrección|puede usar un borrador|Generado por IA|Actualizado tras la última sesión/);
});

it("la pantalla de Hoy tiene dos números y ningún bloque Te deben", () => {
  const kpis = codigo("src/app/(dashboard)/_components/kpis.tsx");
  expect(kpis).toContain("SESIONES_HOY");
  expect(kpis).toContain("ESTE_MES");
  expect(kpis).not.toContain("POR_COBRAR");
  const texto = documento("02-pantalla-hoy.md");
  expect(texto).toContain("**Los dos números**");
  expect(texto).not.toMatch(/Por cobrar|Día prolijo|Hoy tu agenda está libre|Tocarla te lleva/);
});

it("los recordatorios se dispersan y el mensaje dice lo que arma el código", () => {
  const texto = documento("06-recordatorios-sms.md");
  expect(texto).toContain(`**0 a ${DISPERSION_MINUTOS - 1} minutos**`);
  expect(texto).toContain(LINEA_CONTACTO.replace(" {{telefonoConsultorio}}", ""));
  expect(REMITENTE_SMS.startsWith("Consultorio")).toBe(true);
  expect(texto).toContain(SMS_BAJA_CONFIRMADA);
  expect(texto).not.toMatch(/te recordamos tu sesión|cambió el horario de tu sesión|Listo: no vas a recibir/);
});

it("la ayuda describe dos importes de Cobros y sus cantidades debajo", () => {
  const texto = documento("05-cobros.md");
  expect(texto).toContain("dos importes: **Cobraste este mes** y **Sin cobrar**");
  expect(texto).toContain("cantidad de sesiones correspondiente");
  expect(texto).not.toContain("cuatro números");
});

it("el corpus no enseña acciones retiradas ni deja sesiones vivas tras cambiar la contraseña", () => {
  // Los únicos usos vigentes de esas palabras son botones que existen hoy.
  const vigentes = [INVITAR_WHATSAPP, "Descartar propuesta", "**Descartar**"];
  expect(codigo("src/components/clinico/HiloView.tsx")).toContain("Descartar propuesta");
  let corpus = leerCorpus();
  for (const texto of vigentes) corpus = corpus.replaceAll(texto, "");
  expect(corpus).not.toMatch(/WhatsApp|Descartar|Descartarla|Volver a intentarlo/i);
  expect(corpus).not.toMatch(/No recibe respuestas|hasta \*\*3 intentos|Seguís con la sesión abierta acá/);
  expect(documento("01-entrar-y-cuenta.md")).toContain("se cierran todas las sesiones abiertas");
  expect(documento("01-entrar-y-cuenta.md")).toContain("Esta sesión sigue abierta");
});
it("explica las series y sus límites sin prometer renovarlas solas", () => {
  const texto = documento("03-agenda-y-turnos.md");
  expect(texto).toContain("**tres meses**");
  expect(texto).toContain("cada semana o cada 15 días");
  expect(texto).toContain("Cada turno es independiente");
  expect(texto).toContain("Si choca la primera fecha, no se crea la serie");
  expect(texto).toContain("Cancelar el resto de la serie");
});
it("distingue la aceptación, la entrega, la baja y el resultado desconocido del SMS", () => {
  const texto = documento("06-recordatorios-sms.md");
  for (const frase of ["aceptado no es entregado", "BAJA", "STOP", "CANCELAR", "no se reenvía solo", "cambio de horario"])
    expect(texto.toLowerCase().replace(/\*\*/g, "")).toContain(frase.toLowerCase());
});
it("la ayuda distingue rehacer la nota, reintentar y pedir Para vos", () => {
  const nota = documento("08-la-nota-clinica.md");
  expect(nota).toContain("Volver a escribirla");
  expect(nota).toContain("No vuelve a transcribir");
  expect(nota).toContain("Leí las menciones");
  expect(nota).toContain("cada lectura queda registrada");
  expect(documento("09-para-vos-feedback.md")).toContain(FEEDBACK_REINTENTAR);
  expect(documento("09-para-vos-feedback.md")).toContain(FEEDBACK_PEDIR);
  expect(documento("09-para-vos-feedback.md")).toContain("aunque la nota ya esté aprobada");
});

// Regresión P2: el corpus de Lupita no debe ofrecer controles que sólo existen
// en el servidor, ni negar los que la pantalla ya ofrece.
it("describe los controles clínicos según lo que la pantalla ofrece hoy", () => {
  // Leí las menciones y el nuevo pedido de Para vos tienen interfaz.
  expect(codigo("src/components/clinico/MencionesNota.tsx")).toContain("{LEI_LAS_MENCIONES}");
  expect(codigo("src/app/(dashboard)/sesiones/[id]/_components/para-vos-view.tsx")).toContain("FEEDBACK_REINTENTAR");
  for (const [archivo, control] of [
    ["08-la-nota-clinica.md", LEI_LAS_MENCIONES],
    ["13-preguntas-frecuentes.md", LEI_LAS_MENCIONES],
    ["14-cuando-algo-falla.md", LEI_LAS_MENCIONES],
    ["09-para-vos-feedback.md", FEEDBACK_REINTENTAR],
    ["14-cuando-algo-falla.md", FEEDBACK_REINTENTAR],
  ]) {
    expect(documento(archivo)).toContain(control);
    expect(documento(archivo)).not.toContain(control + " todavía no está disponible");
  }
  expect(leerCorpus()).not.toContain("Pedir de nuevo todavía no está disponible");
  // Ver la transcripción sigue sin pantalla: ningún componente llama a su ruta.
  const conTranscripcion = [...componentes(join(process.cwd(), "src/app")), ...componentes(join(process.cwd(), "src/components"))]
    .filter((ruta) => readFileSync(ruta, "utf8").includes("/transcripcion"));
  if (conTranscripcion.length === 0) {
    expect(documento("08-la-nota-clinica.md")).toContain("Ver transcripción todavía no está disponible en la pantalla");
  } else {
    expect(documento("08-la-nota-clinica.md")).not.toContain("Ver transcripción todavía no está disponible");
  }
});

// ────────────────────────────────────────────────────────────────────────────
// La ayuda sigue al consentimiento vigente. Cada caso lee la versión, los
// hechos y el texto que se genera: si el consentimiento cambia y la ayuda no,
// falla. La ayuda se ajusta al consentimiento, no al revés.
// ────────────────────────────────────────────────────────────────────────────

describe("la ayuda sigue al consentimiento vigente", () => {
  const consentimiento = generarTextoConsentimiento({ nombrePaciente: "P", nombreProfesional: "Profesional", direccionConsultorio: "D" });
  /** Toda la ayuda en una línea, para buscar frases partidas por el ancho. */
  const ayuda = () => leerCorpus().replace(/\s+/g, " ");

  it("nombra solo la versión vigente como la del texto de autorización", () => {
    expect(consentimiento).toContain(`Versión ${CONSENTIMIENTO_VERSION}`);
    // "consentimiento 2.3", "es la **2.3**", "firme la 2.3": ninguna otra versión.
    const menciones = [...ayuda().matchAll(/(?:consentimiento|texto es|autorización es la|autorización vigente es la|firme la|firmar la) \**(\d+\.\d+)\**/gi)].map((m) => m[1]);
    expect(menciones.length).toBeGreaterThanOrEqual(5);
    expect(new Set(menciones)).toEqual(new Set([CONSENTIMIENTO_VERSION]));
    for (const archivo of ["00-que-es-sesion.md", "04-pacientes-y-ficha.md", "10-el-hilo-y-el-recorrido.md", "12-camino-del-audio-y-privacidad.md"]) {
      expect(documento(archivo)).toContain(CONSENTIMIENTO_VERSION);
    }
    // Una firma anterior necesita la nueva: la ayuda no dice que alcance.
    expect(documento("12-camino-del-audio-y-privacidad.md")).toContain(`necesitan que la paciente firme la ${CONSENTIMIENTO_VERSION}`);
    expect(documento("04-pacientes-y-ficha.md")).toContain(`necesitan que la paciente firme la ${CONSENTIMIENTO_VERSION}`);
  });

  it("los plazos de respaldo son los del consentimiento", () => {
    expect(consentimiento).toContain(`${RETENCION_BACKUPS_DIAS} días si son diarias y hasta ${RETENCION_BACKUPS_MENSUALES_MESES} meses si son mensuales`);
    for (const archivo of ["00-que-es-sesion.md", "12-camino-del-audio-y-privacidad.md", "13-preguntas-frecuentes.md"]) {
      expect(documento(archivo)).toContain(`${RETENCION_BACKUPS_DIAS} días`);
      expect(documento(archivo)).toContain(`${RETENCION_BACKUPS_MENSUALES_MESES} meses`);
    }
    expect(BACKUP_INCLUYE_CLAVE_AUDIO).toBe(true);
    expect(consentimiento).toContain("esa copia de la clave podría permitir abrirlo");
    expect(documento("12-camino-del-audio-y-privacidad.md")).toContain("esa copia de la clave podría permitir abrirlo");
    expect(ayuda()).not.toMatch(/consentimiento menciona solo|sin la clave no se puede abrir|Sin la clave, que se destruye al aprobar, no se puede abrir/i);
  });

  it("el borrado del audio se rinde a los días que dice el consentimiento", () => {
    expect(CLAVE_AUDIO_DESTRUIDA_AL_APROBAR).toBe(true);
    expect(POLITICA_POR_TIPO.borrar_audio_r2.tope).toBe(LIMPIEZA_AUDIO_MAX_INTENTOS);
    expect(consentimiento).toContain(`durante unos ${LIMPIEZA_AUDIO_DIAS_APROX} días; después el borrado queda marcado como fallido`);
    for (const archivo of ["00-que-es-sesion.md", "08-la-nota-clinica.md", "12-camino-del-audio-y-privacidad.md", "13-preguntas-frecuentes.md"]) {
      expect(documento(archivo)).toContain(`unos ${LIMPIEZA_AUDIO_DIAS_APROX} días`);
    }
    expect(documento("12-camino-del-audio-y-privacidad.md")).toContain("queda marcado como fallido");
  });

  it("el resumen del Recorrido lo propone la IA y decide la profesional", () => {
    expect(RESUMEN_PROPUESTO_POR_IA).toBe(true);
    expect(consentimiento).toContain("Lo propone la misma inteligencia artificial que redacta la nota");
    expect(documento("10-el-hilo-y-el-recorrido.md")).toContain("La redacta la misma IA que escribe la nota");
    expect(documento("12-camino-del-audio-y-privacidad.md")).toContain("lo propone la misma IA que redacta la nota");
    expect(documento("04-pacientes-y-ficha.md")).toContain("lo propone la IA y solo queda vigente cuando lo aceptás");
  });

  it("el descifrado en el servidor usa un archivo temporal", () => {
    expect(AUDIO_DESCIFRADO_EN_ARCHIVO_TEMPORAL).toBe(true);
    expect(consentimiento).toContain("lo descifra en un archivo temporal del servidor");
    expect(documento("12-camino-del-audio-y-privacidad.md")).toContain("temporal del servidor");
    expect(documento("00-que-es-sesion.md")).toContain("archivo temporal del servidor");
    expect(ayuda()).not.toMatch(/solo en memoria/);
  });

  it("la exportación a PDF: registra la preparación de la copia", () => {
    expect(RECORRIDO_EXPORTABLE).toBe(true);
    expect(consentimiento).toContain("La preparación de esa copia queda registrada por la aplicación");
    expect(documento("10-el-hilo-y-el-recorrido.md")).toContain("Queda registrada la preparación de la copia");
    expect(documento("12-camino-del-audio-y-privacidad.md")).toContain("Queda registrada la preparación de la copia");
    expect(documento("13-preguntas-frecuentes.md")).toContain("registrada la preparación de cada copia");
    expect(ayuda()).not.toMatch(/cada exportación queda registrada|registra cada vez que lo hace/i);
  });

  it("el borrado en AssemblyAI: el consentimiento lo cuenta como ocurre y la ayuda ya no advierte una diferencia", () => {
    // Hasta la 2.2 el consentimiento prometía repetir el pedido hasta la
    // confirmación, y la ayuda lo advertía. Desde la 2.3 dice el tope, y la
    // advertencia no puede volver.
    expect(consentimiento).not.toContain("repite el pedido hasta que el servicio confirma que lo hizo");
    expect(consentimiento).toContain(`repite ese pedido durante unos ${ASR_BORRADO_DIAS_APROX} días, hasta que el servicio responde que lo borró o que ya no existe`);
    expect(POLITICA_POR_TIPO.borrar_transcript_asr.tope).toBe(ASR_BORRADO_MAX_INTENTOS);
    const privacidad = documento("12-camino-del-audio-y-privacidad.md");
    expect(privacidad).not.toMatch(/Esa frase del consentimiento|no menciona ese tope/);
    expect(ayuda()).not.toMatch(/Esa frase del consentimiento está pendiente de corregir/);
    // La ayuda cuenta las dos partes del borrado, igual que el consentimiento.
    expect(privacidad).toContain("Apenas termina la transcripción, bien o mal, la app le pide a AssemblyAI que borre el audio y el texto");
    expect(privacidad).toContain(`**hasta ${ASR_BORRADO_MAX_INTENTOS} veces**, durante **unos ${ASR_BORRADO_DIAS_APROX} días**, hasta que AssemblyAI responde que lo borró o que ya no existe`);
    expect(privacidad).toContain("la app no puede comprobar que AssemblyAI lo haya borrado");
    expect(documento("00-que-es-sesion.md")).toContain(`se reintenta durante unos ${ASR_BORRADO_DIAS_APROX} días`);
  });
});
