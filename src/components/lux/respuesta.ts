// Cómo se lee una respuesta de Lux mientras llega.
//
// El stream de POST /api/pacientes/{id}/lux es texto plano, como el de
// /api/ayuda, con dos marcas dentro (las define src/lib/lux/contrato.ts):
//
//   <citas>…</citas>     al principio de una respuesta: en qué se basa. Se
//                        pliega bajo "Ver en qué me baso".
//   MARCA_ESTADO_LUX + _(mirando la transcripción del DD/MM)_
//                        una línea sola: es un estado de la app, no algo que
//                        Lux le dice a ella. Se muestra en gris. Sólo con la
//                        marca, que el modelo no puede escribir: la misma
//                        frase sin marca es prosa.
//
// Puro y sin estado: se vuelve a leer el texto acumulado entero con cada
// fragmento. Una respuesta de chat mide unos pocos kilobytes, y releerla es
// más simple y más difícil de romper que un autómata que recuerde a mitad de
// qué marca quedó el fragmento anterior.
//
// Lo que todavía puede ser el comienzo de una marca ("<ci", una línea que
// empieza con MARCA_ESTADO_LUX) no se muestra hasta que llega lo que lo
// decide: así una marca nunca asoma un instante como prosa.

import { limpiarMarkdown } from "@/lib/ayuda-texto";
import {
  ABRE_CITAS,
  CIERRA_CITAS,
  LINEA_AVISO_MIRANDO,
  MARCA_ESTADO_LUX,
  type BloqueLux,
  type RespuestaLux,
} from "@/lib/lux/contrato";

/** ¿Puede este pedazo final de línea terminar siendo una línea de estado? */
function puedeSerEstado(linea: string): boolean {
  return linea.startsWith(MARCA_ESTADO_LUX);
}

function limpiar(texto: string, final: boolean): string {
  return limpiarMarkdown(texto, { pendiente: "", linea: "inicio" }, final).texto;
}

/** Separa citas, prosa y estados. `final` es true cuando el stream terminó:
 *  ahí ya no hay nada que esperar y lo pendiente se muestra como vino.
 *
 *  Un bloque <citas> vale al comienzo de cualquier línea, no sólo del
 *  stream: cuando Lux abre una transcripción, el servidor escribe el aviso y
 *  la respuesta que sigue empieza con sus citas. Si hay más de un bloque, se
 *  juntan. */
export function leerRespuesta(crudo: string, final: boolean): RespuestaLux {
  const citas: string[] = [];
  const bloques: BloqueLux[] = [];
  let prosa: string[] = [];
  const cerrarProsa = () => {
    const texto = limpiar(prosa.join("\n"), final).trim();
    if (texto !== "") bloques.push({ tipo: "prosa", texto });
    prosa = [];
  };

  const lineas = crudo.split("\n");
  for (let i = 0; i < lineas.length; i++) {
    const inicio = lineas[i].trimStart();
    const esUltima = i === lineas.length - 1;

    if (inicio.startsWith(ABRE_CITAS)) {
      let bloque = inicio.slice(ABRE_CITAS.length);
      let j = i;
      while (!bloque.includes(CIERRA_CITAS) && j < lineas.length - 1) {
        j += 1;
        bloque += `\n${lineas[j]}`;
      }
      const cierre = bloque.indexOf(CIERRA_CITAS);
      if (cierre === -1) {
        // Las citas todavía están llegando: desde acá no hay nada que mostrar.
        if (!final) break;
        citas.push(bloque.trim());
        i = j;
        continue;
      }
      citas.push(bloque.slice(0, cierre).trim());
      const despues = bloque.slice(cierre + CIERRA_CITAS.length);
      if (despues.trim() !== "") prosa.push(despues);
      i = j;
      continue;
    }

    // Lo que todavía puede ser el comienzo de una marca no se muestra.
    if (!final && esUltima && inicio !== "" && (ABRE_CITAS.startsWith(inicio) || puedeSerEstado(lineas[i]))) break;

    const estado = LINEA_AVISO_MIRANDO.exec(lineas[i]);
    if (estado) {
      cerrarProsa();
      bloques.push({ tipo: "estado", fecha: estado[1] });
    } else {
      // Una marca suelta (una línea de estado rota) no se muestra.
      prosa.push(lineas[i].replaceAll(MARCA_ESTADO_LUX, ""));
    }
  }
  cerrarProsa();

  const juntas = citas.filter((c) => c !== "").join("\n");
  return { citas: juntas === "" ? null : juntas, bloques };
}
