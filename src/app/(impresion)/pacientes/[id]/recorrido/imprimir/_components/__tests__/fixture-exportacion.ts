// La exportación de prueba de la hoja del Recorrido: la usan el snapshot
// (hoja-igual-que-antes), el contrato de fidelidad (hoja-fiel-a-la-fuente)
// y el guion que genera los PDF de entrega para el dueño. Sin alias de
// importación a propósito: el guion la carga con `node --experimental-strip-types`.
//
// Coherente consigo misma: la señal del 20 de agosto que figura en
// riesgosHistoricos del Recorrido es la misma que el progreso marca en esa
// sesión (flag, nivel y la fila de riesgos). Así el snapshot ejercita un
// punto con señal en los gráficos.

// Los imports son sólo de tipos: node --experimental-strip-types los borra.
import type { ContenidoHilo, ResumenVersionHilo } from "@/lib/hilo/contenido";

import type { Exportacion } from "../formato";

export const SESIONES = [
  "7b0c7e0a-1c4e-4d8a-9a51-0f5d7a9b2c11",
  "c3d9a4f2-6b1e-4f7a-8c2d-5e6f7a8b9c01",
  "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
] as const;

export const FECHAS = ["2026-08-01T14:00:00.000Z", "2026-08-20T14:00:00.000Z", "2026-09-10T14:00:00.000Z"] as const;

const SIN_FLAGS = { ideacionSuicida: false, autolesion: false, violenciaTerceros: false, sintomasPsicoticos: false, crisisPanico: false };

function contenido(resumen: string): ContenidoHilo {
  return {
    hipotesisDiagnostica: "Ansiedad generalizada con evitación.\n\nSe sostiene la hipótesis inicial.",
    resumenAcumulativo: resumen,
    objetivosTerapeuticos: [
      { id: "11111111-1111-4111-8111-111111111111", descripcion: "Dormir sin medicación", estado: "activo", fechaInicio: "2026-08-01", fechaCierre: null },
      { id: "22222222-2222-4222-8222-222222222222", descripcion: "Volver a manejar", estado: "cerrado", fechaInicio: "2026-08-01", fechaCierre: "2026-09-01" },
    ],
    intervencionesProbadas: [{ tecnica: "validacion", eficaciaPercibida: "alta", sesiones: [SESIONES[0], SESIONES[1]] }],
    temasRecurrentes: [{ tema: "Trabajo", conteo: 3 }, { tema: "Madre", conteo: 2 }],
    riesgosHistoricos: [{ sesionId: SESIONES[1], fecha: "2026-08-20", flag: "autolesion", detalle: "Lo mencionó al pasar" }],
    cambios: [],
  };
}

function version(v: Partial<ResumenVersionHilo> & { version: number }): ResumenVersionHilo {
  return {
    id: `00000000-0000-4000-8000-00000000000${v.version}`,
    basadaEnVersion: null, actor: "profesional", estado: "aplicada", sesionOrigenId: null,
    creadaPorUserId: null, creadaEn: "2026-08-01T15:00:00.000Z", resueltaEn: null,
    resueltaPorUserId: null, propuestaOrigenId: null, ...v,
  };
}

/** `ultimaConSenal`: además, la última sesión trae señal (segundo caso del snapshot). */
export function exportacionDePrueba(ultimaConSenal = false): Exportacion {
  const v1 = version({ version: 1, actor: "ia", sesionOrigenId: SESIONES[0], resueltaEn: "2026-08-02T12:00:00.000Z" });
  const v2 = version({ version: 2, basadaEnVersion: 1, creadaEn: "2026-08-25T12:00:00.000Z" });
  const conSenal = (i: number) => i === 1 || (ultimaConSenal && i === 2);
  return {
    paciente: { nombre: "Ana", apellido: "Pérez" },
    nombreProfesional: "Lic. Prueba",
    exportadoEn: "2026-09-16T17:30:00.000Z",
    vigente: { ...v2, contenido: contenido("Primera sesión: llegó derivada.\n\nSegunda sesión: habló del trabajo.\n\nTercera sesión: durmió mejor.") },
    anteriores: [{ ...v1, contenido: contenido("Primera sesión: llegó derivada.") }],
    versiones: [v2, v1],
    sesiones: SESIONES.map((id, i) => ({ id, fecha: FECHAS[i] })),
    progreso: {
      pacienteId: "p", totalSesiones: 3, rango: "todo",
      sesiones: SESIONES.map((sesionId, i) => ({
        sesionId, fecha: FECHAS[i], numero: i + 1,
        intensidadEmocional: 4 + i, alianzaTerapeutica: i === 0 ? "inestable" : "estable",
        temas: i < 2 ? ["Trabajo", "Madre"] : ["Trabajo"],
        nivelRiesgo: conSenal(i) ? "moderado" : "ninguno",
        flagsRiesgo: i === 1 ? { ...SIN_FLAGS, autolesion: true } : SIN_FLAGS,
        intervenciones: { validacion: 2, psicoeducacion: 1 },
        observacionIA: ["Llegó tensa y habló poco del trabajo.", "Hubo más silencios que en la sesión anterior.", "Más suelta; pudo nombrar el miedo a manejar."][i],
        progresoPercibido: ["Recién empezamos; todavía no duerme bien.", "Le cuesta, pero vino a todas.", "Sin riesgo a la vista; duerme mejor y retomó el trabajo."][i],
      })),
      temas: [
        { tema: "Trabajo", conteo: 3, deTotal: 3, primeraVez: FECHAS[0], ultimaVez: FECHAS[2], tendencia: "estable" },
        { tema: "Madre", conteo: 2, deTotal: 3, primeraVez: FECHAS[0], ultimaVez: FECHAS[1], tendencia: "baja" },
      ],
      riesgos: [{ sesionId: SESIONES[1], fecha: FECHAS[1], flag: "autolesion", nivel: "moderado", cita: "No sé, a veces me lastimo." }],
    },
  };
}

/** La paciente de una sola nota aprobada, sin Recorrido revisado y con la
 *  primera propuesta de la IA sin revisar: el caso que en producción salía
 *  en tres páginas casi vacías. Una página. */
export function exportacionMinima(): Exportacion {
  const sesion = SESIONES[0];
  const fecha = "2026-09-30T14:00:00.000Z";
  return {
    paciente: { nombre: "Ana", apellido: "Pérez" },
    nombreProfesional: "Lic. Prueba",
    exportadoEn: "2026-10-01T13:00:00.000Z",
    vigente: null,
    anteriores: [],
    versiones: [version({ version: 1, actor: "ia", estado: "propuesta", sesionOrigenId: sesion, creadaEn: "2026-09-30T16:00:00.000Z" })],
    sesiones: [{ id: sesion, fecha }],
    progreso: {
      pacienteId: "p", totalSesiones: 1, rango: "todo",
      sesiones: [{
        sesionId: sesion, fecha, numero: 1,
        intensidadEmocional: 5, alianzaTerapeutica: "estable", temas: ["Trabajo"],
        nivelRiesgo: "ninguno", flagsRiesgo: SIN_FLAGS, intervenciones: { validacion: 1 },
        observacionIA: "Primera sesión; llegó derivada.", progresoPercibido: "Recién empezamos.",
      }],
      temas: [{ tema: "Trabajo", conteo: 1, deTotal: 1, primeraVez: fecha, ultimaVez: fecha, tendencia: "nuevo" }],
      riesgos: [],
    },
  };
}
