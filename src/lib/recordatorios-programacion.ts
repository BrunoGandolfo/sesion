// Cuándo sale el recordatorio de un turno. Una sola cuenta para toda la app.
//
// Antes vivía copiada en tres lugares —POST /api/turnos, PATCH
// /api/turnos/[id] y el seed— siempre como `fecha - horasAnticipacion` en
// milisegundos. Esa resta tiene un problema práctico: con 24 horas, un turno
// de las 8 de la mañana avisaba a las 8 de la mañana del día anterior, y uno
// de las 19:30 avisaba a las 19:30. El recordatorio caía a cualquier hora.
//
// Ahora la profesional elige el momento, no un número de horas:
//   - dia_anterior    → la tarde anterior, 20:00
//   - dos_dias_antes  → la tarde de dos días antes, 20:00
//   - misma_manana    → 08:00 del mismo día del turno
//
// Y una sola excepción, la que importa: si el turno es antes de las 8:00, no
// hay "misma mañana" que sirva —el mensaje llegaría con la paciente ya
// viniendo—, así que se manda la tarde anterior a las 20:00.
//
// Todo se calcula en hora de Montevideo, no en la hora del servidor: el
// recordatorio es un mensaje que una persona lee en su teléfono, en su día.
// La conversión no vive acá: la hace src/lib/fechas-montevideo.ts, que es la
// única fuente de verdad del huso en toda la app. Este módulo tenía su propia
// copia del offset y de las dos conversiones —idénticas, pero copias— y
// alcanzaba con que alguien tocara una para que el recordatorio y la agenda
// dejaran de hablar del mismo día.

import { instanteMvd, partesMvd } from "@/lib/fechas-montevideo";

/** Los tres momentos posibles. Espejo de Configuracion.recordatorioModo. */
export const RECORDATORIO_MODOS = [
  "dia_anterior",
  "dos_dias_antes",
  "misma_manana",
] as const;

export type RecordatorioModo = (typeof RECORDATORIO_MODOS)[number];

/** El de siempre: la tarde anterior. Igual que el default de la columna. */
export const RECORDATORIO_MODO_DEFAULT: RecordatorioModo = "dia_anterior";

/** Hora de la tarde en que sale el aviso del día anterior. */
export const HORA_TARDE = 20;

/** Hora de la mañana del propio día del turno. */
export const HORA_MANANA = 8;

/** True si el string es uno de los tres modos. Para narrowear lo que viene
 *  de la base (columna String) o del body de PATCH /api/config. */
export function esRecordatorioModo(valor: unknown): valor is RecordatorioModo {
  return (
    typeof valor === "string" &&
    (RECORDATORIO_MODOS as readonly string[]).includes(valor)
  );
}

/** Lo que haya en la columna → un modo válido, con el default como red. */
export function normalizarRecordatorioModo(valor: unknown): RecordatorioModo {
  return esRecordatorioModo(valor) ? valor : RECORDATORIO_MODO_DEFAULT;
}

/**
 * Cuándo mandar el recordatorio de un turno.
 *
 * No mira si el resultado ya pasó: un turno agendado para mañana a la mañana
 * con modo "dos_dias_antes" da una fecha vieja, y eso es correcto acá — el
 * despachador decide qué hace con un recordatorio que nació tarde.
 */
export function calcularProgramadoEn(
  fechaTurno: Date,
  modo: RecordatorioModo = RECORDATORIO_MODO_DEFAULT,
): Date {
  const { anio, mes, dia, hora } = partesMvd(fechaTurno);

  if (modo === "misma_manana") {
    // Un turno antes de las 8 no tiene mañana propia útil: se avisa la
    // tarde anterior, como en dia_anterior.
    return hora < HORA_MANANA
      ? instanteMvd(anio, mes, dia - 1, HORA_TARDE)
      : instanteMvd(anio, mes, dia, HORA_MANANA);
  }

  const diasAntes = modo === "dos_dias_antes" ? 2 : 1;
  return instanteMvd(anio, mes, dia - diasAntes, HORA_TARDE);
}
