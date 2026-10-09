// Cómo se lee una respuesta de Lux mientras llega.
//
// El stream de POST /api/pacientes/{id}/lux es texto plano, como el de
// /api/ayuda, con dos marcas dentro (las define src/lib/lux/contrato.ts):
//
//   <citas>…</citas>     al principio de una respuesta: en qué se basa. Se
//                        pliega bajo "Ver en qué me baso".
//   _(mirando la transcripción del DD/MM)_
//                        una línea sola: es un estado de la app, no algo que
//                        Lux le dice a ella. Se muestra en gris.
//
// Puro y sin estado: se vuelve a leer el texto acumulado entero con cada
// fragmento. Una respuesta de chat mide unos pocos kilobytes, y releerla es
// más simple y más difícil de romper que un autómata que recuerde a mitad de
// qué marca quedó el fragmento anterior.
//
// Lo que todavía puede ser el comienzo de una marca ("<ci", "_(mira") no se
// muestra hasta que llega lo que lo decide: así una marca nunca asoma un
// instante como prosa.

import { limpiarMarkdown } from "@/lib/ayuda-texto";
import {
  ABRE_CITAS,
  CIERRA_CITAS,
  LINEA_AVISO_MIRANDO,
  PREFIJO_AVISO_MIRANDO,
  type BloqueLux,
  type RespuestaLux,
} from "@/lib/lux/contrato";

/** ¿Puede este pedazo final de línea terminar siendo una línea de estado? */
function puedeSerEstado(linea: string): boolean {
  const inicio = linea.trimStart();
  if (inicio === "") return false;
  const sinGuion = PREFIJO_AVISO_MIRANDO.slice(1);
  return (
    PREFIJO_AVISO_MIRANDO.startsWith(inicio) ||
    sinGuion.startsWith(inicio) ||
    inicio.startsWith(PREFIJO_AVISO_MIRANDO) ||
    inicio.startsWith(sinGuion)
  );
}

function limpiar(texto: string, final: boolean): string {
  return limpiarMarkdown(texto, { pendiente: "", linea: "inicio" }, final).texto;
}

/** Separa citas, prosa y estados. `final` es true cuando el stream terminó:
 *  ahí ya no hay nada que esperar y lo pendiente se muestra como vino. */
export function leerRespuesta(crudo: string, final: boolean): RespuestaLux {
  let citas: string | null = null;
  let resto = crudo;

  const sinBlancos = crudo.trimStart();
  if (sinBlancos.startsWith(ABRE_CITAS)) {
    const cierre = sinBlancos.indexOf(CIERRA_CITAS);
    if (cierre === -1) {
      // Las citas todavía están llegando: no hay prosa que mostrar.
      if (!final) return { citas: null, bloques: [] };
      citas = sinBlancos.slice(ABRE_CITAS.length).trim();
      resto = "";
    } else {
      citas = sinBlancos.slice(ABRE_CITAS.length, cierre).trim();
      resto = sinBlancos.slice(cierre + CIERRA_CITAS.length);
    }
  } else if (!final && sinBlancos !== "" && ABRE_CITAS.startsWith(sinBlancos)) {
    return { citas: null, bloques: [] };
  }

  const lineas = resto.split("\n");
  if (!final && puedeSerEstado(lineas.at(-1) ?? "")) lineas.pop();

  const bloques: BloqueLux[] = [];
  let prosa: string[] = [];
  const cerrarProsa = () => {
    const texto = limpiar(prosa.join("\n"), final).trim();
    if (texto !== "") bloques.push({ tipo: "prosa", texto });
    prosa = [];
  };
  for (const linea of lineas) {
    const estado = LINEA_AVISO_MIRANDO.exec(linea);
    if (estado) {
      cerrarProsa();
      bloques.push({ tipo: "estado", fecha: estado[1] });
    } else {
      prosa.push(linea);
    }
  }
  cerrarProsa();

  return { citas: citas === "" ? null : citas, bloques };
}

/** Lo que Lux dijo, sin citas ni estados: es lo que vuelve en el historial. */
export function prosaDe(respuesta: RespuestaLux): string {
  return respuesta.bloques
    .flatMap((b) => (b.tipo === "prosa" ? [b.texto] : []))
    .join("\n\n");
}
