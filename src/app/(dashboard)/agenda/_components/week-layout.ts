import type { TurnoConPaciente } from "@/types/domain";

export const ALTO_HORA = 64;

/** Distribuye los rectángulos que se cruzan, sin cambiar fechas ni duración. */
export function distribuirTurnos(turnos: TurnoConPaciente[], horaInicial: number) {
  const ordenados = turnos.map((turno) => {
    const minutos = turno.fecha.getHours() * 60 + turno.fecha.getMinutes();
    const top = ((minutos - horaInicial * 60) / 60) * ALTO_HORA;
    const height = Math.max(32, (turno.duracion / 60) * ALTO_HORA) - 2;
    return { turno, top, height, columna: 0, columnas: 1 };
  }).sort((a, b) => a.top - b.top || a.turno.id.localeCompare(b.turno.id));

  let grupo: typeof ordenados = [];
  let finales: number[] = [];
  let finGrupo = -Infinity;
  const cerrarGrupo = () => {
    for (const item of grupo) item.columnas = finales.length;
    grupo = [];
    finales = [];
  };

  for (const item of ordenados) {
    if (item.top >= finGrupo) cerrarGrupo();
    let columna = finales.findIndex((fin) => fin <= item.top);
    if (columna < 0) columna = finales.length;
    item.columna = columna;
    finales[columna] = item.top + item.height;
    finGrupo = Math.max(...finales);
    grupo.push(item);
  }
  cerrarGrupo();
  return ordenados;
}
