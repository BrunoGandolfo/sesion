import { RESPALDO_LOCAL_CIFRADO, ASR_BORRADO_CON_REINTENTO, LIMPIEZA_AUDIO_REINTENTA, RETENCION_BACKUPS_DIAS, VOCABULARIO_A_ASR, VOCABULARIO_INCLUYE_NOMBRES, ANTHROPIC_RETENCION_VERIFICADA_EL } from "@/lib/consentimiento-hechos";
import { LIMITE_SEGUNDOS, AVISO_LIMITE_SEGUNDOS } from "@/lib/grabacion-captura";

import { beforeEach, describe, expect, it } from "vitest";

import { leerCorpus, olvidarCorpus, systemPromptAyuda } from "@/lib/ayuda-corpus";

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
  expect(texto).toContain("todavía tenés que terminar y guardar");
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
  expect(documento("09-para-vos-feedback.md")).toContain("abrir la vista no genera un análisis nuevo");
});

it("la ayuda avisa que un campo inválido frena el lote de configuración", () => {
  const texto = documento("11-tu-consultorio.md");
  expect(texto).toContain("no se guarda ninguno de esos cambios");
  expect(texto).toContain("**Reintentar**");
  expect(texto).toContain("antes de salir");
  expect(texto).not.toMatch(/lo demás se guarda igual|Cada campo se guarda por separado|Todo se guarda solo/);
});

it("la ayuda distingue el consentimiento 2.0 de la protección todavía pendiente", () => {
  // Verifica el texto informado, no certifica la implementación del grabador.
  expect(RESPALDO_LOCAL_CIFRADO).toBe(true);
  expect(ASR_BORRADO_CON_REINTENTO).toBe(true);
  expect(LIMPIEZA_AUDIO_REINTENTA).toBe(true);
  expect(VOCABULARIO_A_ASR && VOCABULARIO_INCLUYE_NOMBRES).toBe(true);
  for (const archivo of ["00-que-es-sesion.md", "07-grabar-una-sesion.md", "12-camino-del-audio-y-privacidad.md"]) {
    expect(documento(archivo)).toContain("El consentimiento 2.0 exige cifrar el audio por tramos");
    expect(documento(archivo)).toContain("la copia local previa no está cifrada");
    expect(documento(archivo)).toContain("Todavía no está implementado en este grabador");
  }
  const texto = documento("12-camino-del-audio-y-privacidad.md");
  expect(texto).toContain("**" + RETENCION_BACKUPS_DIAS + " días**");
  expect(texto).toContain(ANTHROPIC_RETENCION_VERIFICADA_EL);
  expect(texto).toContain("hasta que el proveedor confirma");
  expect(texto).toContain("pueden contener cifrada la clave");
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

it("no promete un hilo inmutable ni un brief siempre aprobado", () => {
  const texto = documento("10-el-hilo-y-el-recorrido.md");
  expect(texto).toContain("una actualización automática puede reemplazar contenido");
  expect(texto).toContain("puede usar un borrador");
  expect(texto).toContain("esa tarea puede quedar pendiente o fallar");
  expect(texto).not.toMatch(/Nunca se reinician|Nunca se borran|no se reescriben nunca|Todo se compone de notas ya aprobadas/);
});

it("la ayuda describe dos importes de Cobros y sus cantidades debajo", () => {
  const texto = documento("05-cobros.md");
  expect(texto).toContain("dos importes: **Cobraste este mes** y **Sin cobrar**");
  expect(texto).toContain("cantidad de sesiones correspondiente");
  expect(texto).not.toContain("cuatro números");
});

it("el corpus no enseña acciones retiradas ni deja sesiones vivas tras cambiar la contraseña", () => {
  const corpus = leerCorpus();
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
  expect(documento("09-para-vos-feedback.md")).toContain("Pedir de nuevo");
  expect(documento("09-para-vos-feedback.md")).toContain("aunque la nota ya esté aprobada");
});

// Regresión P2: el corpus de Lupita no debe ofrecer controles que sólo existen en el servidor.
it("declara indisponibles los controles clínicos que todavía no tienen interfaz", () => {
  for (const [archivo, control] of [
    ["08-la-nota-clinica.md", "Leí las menciones"],
    ["08-la-nota-clinica.md", "Ver transcripción"],
    ["09-para-vos-feedback.md", "Pedir de nuevo"],
    ["13-preguntas-frecuentes.md", "Leí las menciones"],
    ["14-cuando-algo-falla.md", "Pedir de nuevo"],
  ]) {
    expect(documento(archivo)).toContain(control + " todavía no está disponible en la pantalla");
  }
});
