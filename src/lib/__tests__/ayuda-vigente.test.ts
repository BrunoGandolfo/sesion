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

it("explica el cifrado al terminar y la copia local previa sin cifrar", () => {
  for (const archivo of ["00-que-es-sesion.md", "07-grabar-una-sesion.md", "12-camino-del-audio-y-privacidad.md"]) {
    expect(documento(archivo)).toContain("copia local previa no está cifrada");
    expect(documento(archivo)).toMatch(/Al terminar/i);
  }
});

it("no convierte borrado, cifrado parcial y proveedores en garantías absolutas", () => {
  const privacidad = documento("12-camino-del-audio-y-privacidad.md");
  expect(privacidad).toContain("intenta borrar el audio remoto");
  expect(privacidad).toContain("No todo dato clínico tiene ese cifrado");
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
