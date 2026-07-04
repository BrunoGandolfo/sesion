// Lecturas clínicas del tab Progreso — derivaciones determinísticas.
//
// Cada función es pura: recibe los datos que ya llegan en la respuesta de
// /api/pacientes/[id]/progreso y devuelve una lectura en prosa (1-2 frases).
// Acá NO hay llamadas a LLM ni datos nuevos: si el texto no puede derivarse
// aritméticamente de la serie, se devuelve la lectura de datos insuficientes.
// Tono: sobrio y sin diagnosticar — el juicio clínico es de la profesional.

export type TonoLectura = "neutral" | "positivo" | "atencion";

export interface Lectura {
  texto: string;
  tono: TonoLectura;
}

/** |Δ| entre las dos últimas sesiones que se considera salto brusco. */
const SALTO_BRUSCO = 3;
/** Sesiones mínimas en una misma dirección para hablar de tendencia. */
const TRAMO_TENDENCIA = 3;
/** Amplitud máxima (max - min) del tramo reciente para hablar de estabilidad. */
const AMPLITUD_ESTABLE = 1;

const LECTURA_INSUFICIENTE: Lectura = {
  texto:
    "Todavía no hay sesiones suficientes con este dato para derivar una lectura.",
  tono: "neutral",
};

function validos(valores: ReadonlyArray<number | null | undefined>): number[] {
  return valores.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
}

/** Largo del tramo final de la serie donde cada paso cumple `cumple(delta)`. */
function tramoFinal(
  serie: ReadonlyArray<number>,
  cumple: (delta: number) => boolean,
): number {
  let largo = 1;
  for (let i = serie.length - 1; i > 0; i--) {
    if (cumple(serie[i] - serie[i - 1])) largo++;
    else break;
  }
  return largo;
}

// ============================================
// Intensidad emocional
// ============================================
// Prioridad: 1) salto brusco entre las dos últimas sesiones, 2) tendencia
// sostenida (3+ sesiones monótonas con cambio neto), 3) estabilidad,
// 4) oscilación sin patrón. La comparación primera-vs-última sola es ciega
// a lo reciente, por eso no se usa.
export function lecturaIntensidad(
  valores: ReadonlyArray<number | null | undefined>,
): Lectura {
  const serie = validos(valores);
  if (serie.length === 0) return LECTURA_INSUFICIENTE;
  if (serie.length === 1) {
    return {
      texto: `Hay una sola sesión con registro (${serie[0]} de 10): todavía no hay recorrido para comparar.`,
      tono: "neutral",
    };
  }

  const ultima = serie[serie.length - 1];
  const previa = serie[serie.length - 2];
  const delta = ultima - previa;

  if (Math.abs(delta) >= SALTO_BRUSCO) {
    return delta > 0
      ? {
          texto: `Salto marcado en la última sesión: la intensidad pasó de ${previa} a ${ultima}. Puede valer la pena explorar qué ocurrió entre sesiones.`,
          tono: "atencion",
        }
      : {
          texto: `Descenso marcado en la última sesión: la intensidad pasó de ${previa} a ${ultima}. Conviene ver en la próxima si el alivio se sostiene.`,
          tono: "positivo",
        };
  }

  const largoBaja = tramoFinal(serie, (d) => d <= 0);
  if (largoBaja >= TRAMO_TENDENCIA) {
    const inicio = serie[serie.length - largoBaja];
    if (ultima < inicio) {
      return {
        texto: `La intensidad viene bajando de forma sostenida en las últimas ${largoBaja} sesiones (de ${inicio} a ${ultima}), consistente con una disminución del malestar al iniciar sesión.`,
        tono: "positivo",
      };
    }
  }
  const largoSube = tramoFinal(serie, (d) => d >= 0);
  if (largoSube >= TRAMO_TENDENCIA) {
    const inicio = serie[serie.length - largoSube];
    if (ultima > inicio) {
      return {
        texto: `La intensidad viene subiendo de forma sostenida en las últimas ${largoSube} sesiones (de ${inicio} a ${ultima}); podría indicar un aumento del malestar que conviene monitorear.`,
        tono: "atencion",
      };
    }
  }

  const recientes = serie.slice(-TRAMO_TENDENCIA);
  const max = Math.max(...recientes);
  const min = Math.min(...recientes);
  if (max - min <= AMPLITUD_ESTABLE) {
    return {
      texto: `La intensidad se mantiene estable alrededor de ${ultima} en las últimas sesiones, sin cambios marcados.`,
      tono: "neutral",
    };
  }

  return {
    texto: `Sin una tendencia clara: la intensidad osciló entre ${min} y ${max} en las últimas sesiones.`,
    tono: "neutral",
  };
}

// ============================================
// Alianza terapéutica
// ============================================
export interface PuntoAlianza {
  nivel: number | null | undefined;
  etiqueta: string | null | undefined;
}

export function lecturaAlianza(
  puntos: ReadonlyArray<PuntoAlianza>,
): Lectura {
  const serie: Array<{ nivel: number; etiqueta: string }> = [];
  for (const p of puntos) {
    if (typeof p.nivel === "number" && Number.isFinite(p.nivel)) {
      serie.push({ nivel: p.nivel, etiqueta: p.etiqueta ?? `nivel ${p.nivel}` });
    }
  }

  if (serie.length === 0) return LECTURA_INSUFICIENTE;
  const ultima = serie[serie.length - 1];
  if (serie.length === 1) {
    return {
      texto: `Hay una sola sesión con registro: la alianza se valoró como «${ultima.etiqueta}».`,
      tono: "neutral",
    };
  }

  const previa = serie[serie.length - 2];
  if (ultima.nivel < previa.nivel) {
    return {
      texto: `La alianza pasó de «${previa.etiqueta}» a «${ultima.etiqueta}» en la última sesión. Una caída puntual podría indicar una ruptura que valga la pena explorar en el próximo encuentro.`,
      tono: "atencion",
    };
  }
  if (ultima.nivel > previa.nivel) {
    return {
      texto: `La alianza subió de «${previa.etiqueta}» a «${ultima.etiqueta}» en la última sesión.`,
      tono: "positivo",
    };
  }

  const iguales = tramoFinal(
    serie.map((p) => p.nivel),
    (d) => d === 0,
  );
  const sufijo =
    ultima.nivel <= 2
      ? " Sostenida en ese nivel, puede valer la pena revisar qué la está trabando."
      : "";
  return {
    texto: `La alianza se mantiene «${ultima.etiqueta}» en las últimas ${iguales} sesiones.${sufijo}`,
    tono: ultima.nivel >= 3 ? "positivo" : "neutral",
  };
}

// ============================================
// Temas recurrentes
// ============================================
export interface TemaFrecuente {
  tema: string;
  apariciones: number;
}

/** Temas ordenados por frecuencia descendente (desempate alfabético). */
export function topTemas(
  temasPorSesion: ReadonlyArray<ReadonlyArray<string>>,
  max = 5,
): TemaFrecuente[] {
  const conteo = new Map<string, number>();
  for (const temas of temasPorSesion) {
    for (const tema of temas) conteo.set(tema, (conteo.get(tema) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([tema, apariciones]) => ({ tema, apariciones }));
}

function listar(items: ReadonlyArray<string>): string {
  return items.map((i) => `«${i}»`).join(", ");
}

export function lecturaTemas(
  temasPorSesion: ReadonlyArray<ReadonlyArray<string>>,
): Lectura {
  const totalSesiones = temasPorSesion.length;
  const top = topTemas(temasPorSesion, 3);
  if (totalSesiones === 0 || top.length === 0) {
    return {
      texto: "Aún no hay temas registrados en las sesiones.",
      tono: "neutral",
    };
  }

  const ultima = temasPorSesion[totalSesiones - 1] ?? [];
  const previos = new Set(temasPorSesion.slice(0, -1).flat());
  if (
    totalSesiones >= 2 &&
    ultima.length > 0 &&
    ultima.every((t) => !previos.has(t))
  ) {
    return {
      texto: `Los temas de la última sesión (${listar(ultima)}) aparecen por primera vez: puede ser señal de un viraje en el material que trae.`,
      tono: "atencion",
    };
  }

  const sesionesPalabra = totalSesiones === 1 ? "sesión" : "sesiones";
  const partes = top.map((t, i) =>
    i === 0
      ? `«${t.tema}» apareció en ${t.apariciones} de ${totalSesiones} ${sesionesPalabra}`
      : `«${t.tema}», en ${t.apariciones}`,
  );
  return { texto: `${partes.join("; ")}.`, tono: "neutral" };
}

// ============================================
// Intervenciones del terapeuta
// ============================================
export function lecturaIntervenciones(
  porSesion: ReadonlyArray<Record<string, number>>,
  etiquetas: Record<string, string>,
): Lectura {
  if (porSesion.length === 0) return LECTURA_INSUFICIENTE;
  const ultima = porSesion[porSesion.length - 1] ?? {};
  const entradas = Object.entries(ultima).filter(([, v]) => v > 0);
  const total = entradas.reduce((acc, [, v]) => acc + v, 0);
  if (total === 0) {
    return {
      texto: "En la última sesión no quedaron intervenciones registradas.",
      tono: "neutral",
    };
  }
  entradas.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [clave, cantidad] = entradas[0];
  const nombre = etiquetas[clave] ?? clave;
  const unidad =
    total === 1 ? "intervención registrada" : "intervenciones registradas";
  return {
    texto: `En la última sesión predominó «${nombre}» (${cantidad} de ${total} ${unidad}).`,
    tono: "neutral",
  };
}

// ============================================
// Ratio de habla
// ============================================
/** Slot preparado con el mismo patrón que el resto de las lecturas. El dato
 *  del ratio está bajo diagnóstico (hoy el gráfico renderiza un 100/0 falso
 *  por doble escalado del porcentaje); hasta que el dato sea confiable esta
 *  función devuelve null y la card no muestra lectura. */
export function lecturaRatioHabla(): Lectura | null {
  return null;
}

// ============================================
// Progreso percibido — detección de términos de deterioro/riesgo
// ============================================
const TERMINOS_DETERIORO = [
  "retroceso",
  "deterioro",
  "empeor",
  "riesgo",
  "crisis",
  "recaida",
  "ideacion",
  "autolesion",
  "suicid",
  "descompensa",
];

/** True si el texto contiene términos de deterioro o riesgo (comparación
 *  sin tildes y sin mayúsculas). Decide el borde terracotta de la card. */
export function contieneTerminosDeterioro(texto: string): boolean {
  // NFD separa cada tilde en un combining mark (U+0300..U+036F), que acá
  // se descarta para comparar sin acentos.
  const plano = Array.from(texto.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join("")
    .toLowerCase();
  return TERMINOS_DETERIORO.some((t) => plano.includes(t));
}
