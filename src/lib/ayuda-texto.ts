export interface EstadoMarkdown {
  pendiente: "" | "*" | "_";
  linea: "inicio" | "encabezado" | "texto";
}

/** Sin estado devuelve el texto completo; con estado procesa un fragmento.
 * No muta el estado recibido. Al cerrar el stream, pasar "" y final=true
 * para emitir cualquier asterisco o guion bajo literal que haya quedado. */
export function limpiarMarkdown(texto: string): string;
export function limpiarMarkdown(
  texto: string,
  estado: EstadoMarkdown,
  final?: boolean,
): { texto: string; estado: EstadoMarkdown };
export function limpiarMarkdown(
  texto: string,
  estado?: EstadoMarkdown,
  final = estado === undefined,
): string | { texto: string; estado: EstadoMarkdown } {
  let pendiente = estado?.pendiente ?? "";
  let linea = estado?.linea ?? "inicio";
  let limpio = "";

  for (const caracter of texto) {
    if (pendiente) {
      if (caracter === pendiente) {
        pendiente = "";
        continue;
      }
      limpio += pendiente;
      pendiente = "";
      linea = "texto";
    }
    if (caracter === "`") continue;
    if (caracter === "\n" || caracter === "\r") {
      limpio += caracter;
      linea = "inicio";
    } else if (linea !== "texto" && caracter === "#") {
      linea = "encabezado";
    } else if (linea !== "texto" && (caracter === " " || caracter === "\t")) {
      if (linea === "inicio") limpio += caracter;
    } else if (caracter === "*" || caracter === "_") {
      pendiente = caracter;
    } else {
      limpio += caracter;
      linea = "texto";
    }
  }
  if (final && pendiente) {
    limpio += pendiente;
    pendiente = "";
    linea = "texto";
  }
  return estado === undefined
    ? limpio
    : { texto: limpio, estado: { pendiente, linea } };
}
