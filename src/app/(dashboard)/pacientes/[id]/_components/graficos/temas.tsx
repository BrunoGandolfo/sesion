"use client";

import { Plegable } from "@/components/ui";
import { formatearEtiqueta } from "@/lib/etiquetas";
import { fechaCorta } from "@/lib/format";
import { TEMAS, VER_DETALLE, pluralizar } from "@/lib/glosario";

import { lecturaTemas } from "../progreso-lecturas";
import { COLOR, ChartCard, fechaDe, type SesionProgreso, type TemaProgreso } from "./base";
import { DESDE, SUBTITULO_TEMAS, TENDENCIA_LABEL } from "./textos";

// Temas del período.
//
// Antes esto era una matriz tema × sesión, siempre visible. Con 40 sesiones
// eran 40 columnas de bolitas: nadie las lee y la card no entra en pantalla.
// Ahora lo primero que se ve es la lista con la cifra que importa —"12 de 40
// sesiones"— y la matriz queda detrás de "Ver detalle", acotada al período
// elegido.
//
// Las cifras (conteo, deTotal, primeraVez, tendencia) vienen calculadas de la
// API: acá no se recuenta ni se estima nada.

const CUANTOS_EN_LA_LISTA = 8;

const TONO_TENDENCIA: Record<TemaProgreso["tendencia"], string> = {
  nuevo: "text-sage-700",
  sube: "text-terracotta-600",
  baja: "text-ink-500",
  estable: "text-ink-500",
};

function LineaTema({ tema }: { tema: TemaProgreso }) {
  const primera = new Date(tema.primeraVez);
  return (
    <li className="flex flex-col gap-1 border-t border-[color:var(--border-subtle)] py-2 first:border-t-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <span className="text-[13px] text-ink-900">
        {formatearEtiqueta(tema.tema)}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] tabular-nums text-ink-500">
        <span>
          {tema.conteo} de {pluralizar(tema.deTotal, "sesión", "sesiones")}
        </span>
        <span aria-hidden="true">·</span>
        <span className={TONO_TENDENCIA[tema.tendencia]}>
          {TENDENCIA_LABEL[tema.tendencia]}
        </span>
        {Number.isNaN(primera.getTime()) ? null : (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {DESDE} {fechaCorta(primera)}
            </span>
          </>
        )}
      </span>
    </li>
  );
}

export function TemasTable({
  temas,
  sesiones,
}: {
  temas: TemaProgreso[];
  sesiones: SesionProgreso[];
}) {
  const lectura = lecturaTemas(sesiones.map((s) => s.temas ?? []));

  if (temas.length === 0) {
    return (
      <ChartCard title={TEMAS} subtitle={SUBTITULO_TEMAS}>
        <p className="py-6 text-center text-[13px] text-ink-500">
          Aún no hay temas registrados en este período.
        </p>
      </ChartCard>
    );
  }

  const enLista = temas.slice(0, CUANTOS_EN_LA_LISTA);
  const restantes = temas.length - enLista.length;

  return (
    <ChartCard title={TEMAS} subtitle={SUBTITULO_TEMAS} lectura={lectura}>
      <ul>
        {enLista.map((tema) => (
          <LineaTema key={tema.tema} tema={tema} />
        ))}
      </ul>

      <div className="mt-4">
        <Plegable
          titulo={VER_DETALLE}
          detalle={
            restantes > 0
              ? `${pluralizar(temas.length, "tema", "temas")} en total`
              : undefined
          }
        >
          {restantes > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                {pluralizar(restantes, "tema más", "temas más")}
              </p>
              <ul>
                {temas.slice(CUANTOS_EN_LA_LISTA).map((tema) => (
                  <LineaTema key={tema.tema} tema={tema} />
                ))}
              </ul>
            </div>
          ) : null}

          <MatrizTemas temas={temas} sesiones={sesiones} />
        </Plegable>
      </div>
    </ChartCard>
  );
}

/** Matriz tema × sesión, acotada al período elegido. Con "Últimas 10" son
 *  diez columnas; con "Todo" y 40 sesiones son cuarenta, y por eso está
 *  detrás de "Ver detalle" y no en la primera pantalla. Las columnas se
 *  rotulan con la fecha, no con "S27". */
function MatrizTemas({
  temas,
  sesiones,
}: {
  temas: TemaProgreso[];
  sesiones: SesionProgreso[];
}) {
  if (sesiones.length === 0) return null;

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
        {TEMAS} por sesión · {pluralizar(sesiones.length, "sesión", "sesiones")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] bg-white py-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                Tema
              </th>
              {sesiones.map((s) => (
                <th
                  key={s.sesionId}
                  scope="col"
                  className="whitespace-nowrap px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500"
                >
                  {fechaCorta(fechaDe(s))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {temas.map(({ tema }) => {
              const nombre = formatearEtiqueta(tema);
              return (
                <tr key={tema} className="border-t border-[color:var(--border-subtle)]">
                  <th
                    scope="row"
                    className="sticky left-0 z-[1] bg-white py-2 pr-3 text-left font-normal text-ink-900"
                  >
                    {nombre}
                  </th>
                  {sesiones.map((s) => {
                    const presente = (s.temas ?? []).includes(tema);
                    const cuando = fechaCorta(fechaDe(s));
                    return (
                      <td
                        key={s.sesionId}
                        className="px-1 py-2 text-center text-[16px] leading-none tabular-nums"
                        aria-label={
                          presente
                            ? `${nombre} apareció el ${cuando}`
                            : `${nombre} no apareció el ${cuando}`
                        }
                      >
                        <span
                          style={{ color: presente ? COLOR.sage : COLOR.inkSoft }}
                        >
                          {presente ? "●" : "○"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
