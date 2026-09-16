"use client";

// La hoja del Recorrido para imprimir o guardar en PDF.
//
// El PDF lo hace el navegador (su diálogo ofrece "Guardar como PDF"): no hay
// generador en el servidor ni dependencia nueva. Por eso todo lo que se ve
// sale de lo que ya usa la app: los tokens de globals.css por clase de
// Tailwind, las fuentes de fonts.ts y los mismos gráficos SVG del Recorrido.
//
// Cómo se pagina:
//   - La hoja entera es una tabla: el <thead> y el <tfoot> se repiten en cada
//     página impresa, y son el encabezado y el pie.
//   - Cada sección, fila, párrafo y gráfico lleva break-inside-avoid; cada
//     título, break-after-avoid. Un bloque que no entra en lo que queda de la
//     página pasa entero a la siguiente.
//   - La excepción es "El recorrido hasta hoy": crece un párrafo por sesión y
//     pasa de una página, así que se parte entre párrafos, nunca dentro de
//     uno (HiloContenido). Un solo párrafo más alto que una página entera no
//     tendría otra forma de imprimirse que partido.
//   - El ancho en pantalla es el ancho útil del A4 (impresion.css): los
//     gráficos se miden una sola vez y salen en papel con la misma escala.
//
// Pedir los datos es exportar: el POST deja el registro en auditoría. Se pide
// una vez por apertura de la hoja, y el diálogo de impresión se abre solo
// cuando los datos, las fuentes y los gráficos ya están dibujados.

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

import { AlianzaChart } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/alianza";
import type { ProgresoResponse } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/base";
import { CardDeLaUltima, SESIONES_PARA_GRAFICOS } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/contenedor";
import { FlagsRiesgoTimeline } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/flags";
import { IntensidadChart } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/intensidad";
import { IntervencionesChart } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/intervenciones";
import { TemasTable } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/temas";
import type { ExportacionRecorrido } from "@/app/api/_lib/casos-uso/hilo/exportar";
import { HiloContenido } from "@/components/clinico/HiloContenido";
import { Button } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import { formatearFechaCompletaMvd, formatearFechaCortaMvd, formatearHoraMvd, partesMvd } from "@/lib/fechas-montevideo";
import {
  COMO_VA,
  IMPRIMIR_O_GUARDAR_PDF,
  OBSERVACION_IA,
  POCO_RECORRIDO_DETALLE,
  POCO_RECORRIDO_TITULO,
  PROGRESO_PERCIBIDO,
  RECORRIDO,
  pieRecorridoPdf,
  pluralizar,
} from "@/lib/glosario";
import type { ResumenVersionHilo } from "@/lib/hilo/contenido";

type Exportacion = Omit<ExportacionRecorrido, "progreso"> & { progreso: ProgresoResponse };

const dia = (iso: string) => formatearFechaCompletaMvd(new Date(iso));
const diaYHora = (iso: string) => `${dia(iso)}, ${formatearHoraMvd(new Date(iso))}`;
/** "16 sep 2026": lo que entra en una columna del historial sin partirse. */
const diaCorto = (iso: string) => `${formatearFechaCortaMvd(new Date(iso))} ${partesMvd(new Date(iso)).anio}`;
const diaCortoYHora = (iso: string) => `${diaCorto(iso)}, ${formatearHoraMvd(new Date(iso))}`;
const autoria = (v: ResumenVersionHilo) => (v.actor === "ia" ? "Propuesta de la IA" : "Edición tuya");

/** El estado de una versión dicho como lo lee ella, no como lo guarda la base. */
function estadoLegible(v: ResumenVersionHilo, datos: Exportacion): string {
  if (v.id === datos.vigente?.id) return "Vigente";
  if (v.estado === "aplicada") {
    const edicion = datos.versiones.find((otra) => otra.propuestaOrigenId === v.id);
    return edicion ? `Aceptada con tus ediciones (versión ${edicion.version})` : "Estuvo vigente";
  }
  if (v.estado === "propuesta") return "Sin revisar";
  if (v.estado === "desactualizada") return "Desactualizada";
  return "Descartada";
}

/** Esperar a que React pinte y a que los gráficos se midan con el ancho final. */
function despuesDelProximoCuadro(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function RecorridoImprimible({ pacienteId }: { pacienteId: string }) {
  const [datos, setDatos] = React.useState<Exportacion | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const pedido = React.useRef(false);
  const impreso = React.useRef(false);

  React.useEffect(() => {
    // Una exportación por apertura: el doble efecto de desarrollo no duplica
    // el registro en auditoría.
    if (pedido.current) return;
    pedido.current = true;
    apiPost<Exportacion>(`/api/pacientes/${pacienteId}/hilo/exportar`, {})
      .then(setDatos)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "No pudimos preparar el PDF. Probá de nuevo."));
  }, [pacienteId]);

  React.useEffect(() => {
    if (!datos || impreso.current) return;
    let cancelado = false;
    void (async () => {
      await document.fonts?.ready;
      await despuesDelProximoCuadro();
      if (cancelado || impreso.current) return;
      impreso.current = true;
      window.print();
    })();
    return () => { cancelado = true; };
  }, [datos]);

  const volver = `/pacientes/${pacienteId}`;

  return (
    <div className="min-h-screen bg-cream-100 py-6 print:min-h-0 print:bg-transparent print:py-0">
      <div className="mx-auto mb-4 flex w-[178mm] flex-wrap items-center justify-between gap-3 px-[12mm] box-content print:hidden">
        <Link href={volver} className="inline-flex min-h-[44px] items-center gap-2 text-[14px] text-ink-700 hover:text-ink-900">
          <ArrowLeft size={16} aria-hidden="true" /> Volver a la ficha
        </Link>
        <Button type="button" disabled={!datos} onClick={() => window.print()} icon={<Printer size={16} aria-hidden="true" />}>
          {IMPRIMIR_O_GUARDAR_PDF}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="mx-auto w-[178mm] rounded-md border border-terracotta-100 bg-terracotta-50 p-4 text-[14px] text-ink-900">
          {error}
        </p>
      ) : !datos ? (
        <p role="status" className="mx-auto w-[178mm] text-[14px] text-ink-500">Preparando el Recorrido…</p>
      ) : (
        <Hoja datos={datos} />
      )}
    </div>
  );
}

function Hoja({ datos }: { datos: Exportacion }) {
  const { paciente, vigente, anteriores, versiones, sesiones, progreso } = datos;
  const nombre = `${paciente.nombre} ${paciente.apellido}`;
  const primera = sesiones[0];
  const ultima = sesiones.at(-1);
  const sesionesGraficos = progreso.sesiones;
  const ultimaConNota = sesionesGraficos.at(-1);
  const fechaDeSesion = new Map(sesiones.map((s) => [s.id, diaCorto(s.fecha)]));

  return (
    <article
      className="mx-auto box-content w-[178mm] bg-white p-[12mm] font-sans text-ink-900 shadow-raised [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:p-0 print:shadow-none"
    >
      {/* El título del documento es el nombre que el navegador propone para el PDF. */}
      <title>{`${RECORRIDO} · ${paciente.apellido}, ${paciente.nombre} · ${dia(datos.exportadoEn)}`}</title>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <td className="pb-6">
              <div className="flex items-baseline justify-between gap-4 border-b border-sage-200 pb-2 text-[8pt] text-ink-500">
                <span className="font-display text-[11pt] font-medium text-sage-700">Sesión</span>
                <span>
                  {RECORRIDO} de {nombre} · exportado el {diaYHora(datos.exportadoEn)}
                </span>
              </div>
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td className="pt-6">
              <p className="border-t border-cream-200 pt-2 text-[8pt] text-ink-500">{pieRecorridoPdf(datos.nombreProfesional)}</p>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td className="align-top">
              <header className="break-inside-avoid">
                <p className="text-[8pt] font-semibold uppercase tracking-[0.08em] text-sage-700">{RECORRIDO}</p>
                <h1 className="mt-1 font-display text-[24pt] font-medium leading-tight tracking-[-0.01em]">{nombre}</h1>
                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[9.5pt] leading-snug">
                  <dt className="text-ink-500">Versión vigente</dt>
                  <dd>
                    {vigente
                      ? `Versión ${vigente.version}, ${vigente.actor === "ia" ? "propuesta aceptada" : "revisada por vos"} el ${diaYHora(vigente.resueltaEn ?? vigente.creadaEn)}`
                      : "Todavía no hay un Recorrido revisado."}
                  </dd>
                  <dt className="text-ink-500">Notas aprobadas</dt>
                  <dd>
                    {primera && ultima
                      ? `${pluralizar(sesiones.length, "nota", "notas")}, del ${dia(primera.fecha)} al ${dia(ultima.fecha)}`
                      : "Ninguna todavía."}
                  </dd>
                  <dt className="text-ink-500">Historial</dt>
                  <dd>
                    {pluralizar(versiones.length, "versión", "versiones")}. Van completas la vigente y las que estuvieron vigentes antes; de las
                    propuestas que no adoptaste queda solo el registro.
                  </dd>
                  <dt className="text-ink-500">Exportado</dt>
                  <dd>
                    {diaYHora(datos.exportadoEn)}
                    {datos.nombreProfesional ? `, por ${datos.nombreProfesional}` : ""}
                  </dd>
                </dl>
              </header>

              <Seccion antetitulo={vigente ? `Versión ${vigente.version}` : "Sin versión"} titulo="El Recorrido vigente">
                {vigente ? (
                  <Contenido>
                    <HiloContenido contenido={vigente.contenido} sesiones={sesiones} />
                  </Contenido>
                ) : (
                  <p className="text-[10pt] text-ink-500">Todavía no hay un Recorrido revisado.</p>
                )}
              </Seccion>

              <Seccion
                antetitulo="Todas las sesiones con nota"
                titulo={COMO_VA}
                nuevaPagina
              >
                {progreso.totalSesiones < SESIONES_PARA_GRAFICOS || !ultimaConNota ? (
                  <div className="break-inside-avoid rounded-lg border border-dashed border-[color:var(--border-strong)] bg-cream-50 px-6 py-6 text-center">
                    <p className="font-display text-[12pt] italic">{POCO_RECORRIDO_TITULO}</p>
                    <p className="mt-1 text-[9pt] text-ink-500">{POCO_RECORRIDO_DETALLE}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    <FlagsRiesgoTimeline riesgos={progreso.riesgos} />
                    <IntensidadChart sesiones={sesionesGraficos} />
                    <AlianzaChart sesiones={sesionesGraficos} />
                    <TemasTable temas={progreso.temas} sesiones={sesionesGraficos} />
                    <IntervencionesChart sesiones={sesionesGraficos} />
                    <CardDeLaUltima
                      rotulo={PROGRESO_PERCIBIDO}
                      texto={ultimaConNota.progresoPercibido}
                      sesionId={ultimaConNota.sesionId}
                      fecha={new Date(ultimaConNota.fecha)}
                    />
                    <CardDeLaUltima
                      rotulo={OBSERVACION_IA}
                      texto={ultimaConNota.observacionIA}
                      sesionId={ultimaConNota.sesionId}
                      fecha={new Date(ultimaConNota.fecha)}
                    />
                  </div>
                )}
              </Seccion>

              <Seccion antetitulo={pluralizar(versiones.length, "versión", "versiones")} titulo="Historial de versiones" nuevaPagina>
                {versiones.length === 0 ? (
                  <p className="text-[10pt] text-ink-500">Todavía no hay versiones.</p>
                ) : (
                  <table className="w-full border-collapse text-left text-[8.5pt] leading-snug">
                    <thead>
                      <tr className="border-b border-sage-200 text-ink-500">
                        <th scope="col" className="py-1.5 pr-3 font-semibold">Versión</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">Escrita</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">Autoría</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">Estado</th>
                        <th scope="col" className="py-1.5 pr-3 font-semibold">Nota de origen</th>
                        <th scope="col" className="py-1.5 font-semibold">Resuelta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versiones.map((v) => (
                        <tr key={v.id} className="break-inside-avoid border-b border-cream-200 align-top">
                          <td className="py-1.5 pr-3 tabular-nums">{v.version}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{diaCortoYHora(v.creadaEn)}</td>
                          <td className="py-1.5 pr-3">{autoria(v)}</td>
                          <td className="py-1.5 pr-3">{estadoLegible(v, datos)}</td>
                          <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{v.sesionOrigenId ? (fechaDeSesion.get(v.sesionOrigenId) ?? "No disponible") : "—"}</td>
                          <td className="whitespace-nowrap py-1.5 tabular-nums">{v.resueltaEn ? diaCortoYHora(v.resueltaEn) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Seccion>

              {anteriores.length > 0 ? (
                <Seccion
                  antetitulo={pluralizar(anteriores.length, "versión", "versiones")}
                  titulo="Versiones que estuvieron vigentes antes"
                  nuevaPagina
                >
                  <div className="flex flex-col gap-8">
                    {anteriores.map((v) => (
                      <section key={v.id} className="border-t border-cream-200 pt-4 first:border-t-0 first:pt-0">
                        <h3 className="break-after-avoid font-display text-[13pt] font-medium">
                          Versión {v.version}
                          <span className="ml-2 font-sans text-[9pt] font-normal text-ink-500">
                            {autoria(v)} · vigente desde el {diaYHora(v.resueltaEn ?? v.creadaEn)}
                          </span>
                        </h3>
                        <Contenido>
                          <HiloContenido contenido={v.contenido} sesiones={sesiones} />
                        </Contenido>
                      </section>
                    ))}
                  </div>
                </Seccion>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}

function Seccion({
  antetitulo,
  titulo,
  nuevaPagina = false,
  children,
}: {
  antetitulo: string;
  titulo: string;
  nuevaPagina?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`mt-10 ${nuevaPagina ? "print:break-before-page print:mt-0" : ""}`}>
      <div className="mb-4 break-after-avoid border-b border-sage-200 pb-2">
        <p className="text-[8pt] font-semibold uppercase tracking-[0.08em] text-sage-700">{antetitulo}</p>
        <h2 className="font-display text-[17pt] font-medium leading-tight tracking-[-0.01em]">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

/** El contenido del hilo con la jerarquía de la hoja: títulos en la tipografía editorial. */
function Contenido({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10pt] [&_li_ul]:mb-1 [&_li_ul]:ml-4 [&_li_ul]:text-ink-700 [&_a]:text-ink-900 [&_a]:no-underline [&_blockquote]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-terracotta-100 [&_blockquote]:pl-3 [&_h4]:font-display [&_h4]:text-[12pt] [&_h4]:font-medium [&_h4]:text-sage-700">
      {children}
    </div>
  );
}
