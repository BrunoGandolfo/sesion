import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { RESPALDO_LOCAL_CIFRADO, RETENCION_BACKUPS_DIAS, VOCABULARIO_A_ASR, VOCABULARIO_INCLUYE_NOMBRES, ANTHROPIC_RETENCION_VERIFICADA_EL } from "@/lib/consentimiento-hechos";
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
  expect(privacidad).toContain("Si falla, se reintenta");
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
