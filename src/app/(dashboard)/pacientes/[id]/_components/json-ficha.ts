// El parseo JSON → Date vive en src/lib/json-turno.ts (una sola copia). Este
// reexport queda mientras paciente-detail-view.tsx lo importe desde acá.
export { parsePaciente, parseTurno, type PacienteJson, type TurnoJson } from "@/lib/json-turno";
