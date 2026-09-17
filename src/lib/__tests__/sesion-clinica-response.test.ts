import { expect, test } from "vitest";
import { SESION_SELECT, toSesionClinicaResponse, type FilaSesionClinica } from "@/app/api/_lib/sesion-clinica";

const fecha = new Date("2026-09-17T12:00:00.000Z");
const secretos = {
  transcripcion: "TRANSCRIPCION_SOLO_ENDPOINT_AUDITADO", transcripcionEncrypted: "TRANSCRIPCION_CIFRADA_PRIVADA",
  audioClave: "CLAVE_AUDIO_PRIVADA", audioClaveEncrypted: "CLAVE_CIFRADA_PRIVADA",
  audioR2Key: "KEY_R2_PRIVADA",
};
function filaBase(): FilaSesionClinica {
  return {
    id: "s", turnoId: "t", estado: "revision", audioEstado: "en_r2", audioBorradoEn: null,
    duracionAudioSeg: 60, pausas: [], intento: 1, generacion: 1, falloCodigo: null, falloDetalle: null,
    modeloAsr: "asr", modeloLlm: "llm", promptVersion: "v1", procesadaEn: fecha, aprobadaEn: null,
    feedbackEstado: "no_pedido", feedbackError: null, feedback: null,
    notaIa: { subjetivo: "s", objetivo: "o", analisis: "a", plan: "p" },
    datos: { temas: ["trabajo"] }, notaFinal: null, notasEdicion: null, creadaEn: fecha, actualizadaEn: fecha,
    turno: { id: "t", fecha, paciente: { id: "p", nombre: "Prueba", apellido: "Sintética" } },
  };
}

test.each(Object.keys(secretos))("el select común nunca pide %s", campo => {
  expect(SESION_SELECT).not.toHaveProperty(campo);
});

test("la respuesta nunca filtra transcripción, clave ni key aunque la fila las traiga", () => {
  const salida = toSesionClinicaResponse({ ...filaBase(), ...secretos });
  for (const [campo, valor] of Object.entries(secretos)) {
    expect(salida).not.toHaveProperty(campo);
    expect(JSON.stringify(salida)).not.toContain(valor);
  }
  expect(salida.transcripcionDisponible).toBe(true);
  expect(toSesionClinicaResponse({ ...filaBase(), modeloAsr: null }).transcripcionDisponible).toBe(false);
});

test.each([false, true])("descarta la clave temporal histórica en datos, JSON serializado=%s", serializado => {
  const datos = { temas: ["trabajo"], _audioCifradoTemporal: { claveCifrado: "CLAVE_HISTORICA", ivCifrado: "IV_HISTORICO" }, ...secretos };
  const salida = toSesionClinicaResponse({ ...filaBase(), datos: serializado ? JSON.stringify(datos) : datos });
  expect(salida.datos).toEqual({ temas: ["trabajo"] });
  expect(JSON.stringify(salida)).not.toContain("CLAVE_HISTORICA");
  expect(JSON.stringify(salida)).not.toContain("IV_HISTORICO");
});

test("conserva la nota, serializa fechas y omite relaciones que no se seleccionaron", () => {
  const fila = filaBase(); const salida = toSesionClinicaResponse(fila);
  expect(salida.notaIa).toEqual(fila.notaIa);
  for (const campo of ["creadaEn", "actualizadaEn", "procesadaEn"] as const) expect(salida[campo]).toBe(fecha.toISOString());
  expect(salida.turno?.fecha).toBe(fecha.toISOString());
  expect(salida.turno?.paciente).not.toHaveProperty("telefono");
  delete fila.turno;
  expect(toSesionClinicaResponse(fila)).not.toHaveProperty("turno");
});
