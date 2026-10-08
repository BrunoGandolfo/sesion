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
// Cómo se ve: papel crema (cream-50) con tarjetas blancas encima, como la
// app. Cabecera de documento en la primera página, "De un vistazo", y
// cuatro secciones con rótulo en oro y título en Fraunces. Las piezas viven
// al lado: cabecera.tsx, de-un-vistazo.tsx, secciones.tsx; los colores, por
// clase o var(--color-…), nunca escritos acá (lo vigila hoja-tokens.test.ts).
//
// Pedir los datos es exportar: el POST deja el registro en auditoría. Se pide
// una vez por apertura de la hoja, y el diálogo de impresión se abre solo
// cuando los datos, las fuentes y los gráficos ya están dibujados.

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

import { Button } from "@/components/ui";
import { apiPost, mensajeParaElla } from "@/lib/api-client";
import { COMO_VA, IMPRIMIR_O_GUARDAR_PDF, RECORRIDO, pieRecorridoPdf, pluralizar, PDF_RECORRIDO_NO_SALIO } from "@/lib/glosario";

import { CabeceraDocumento, EncabezadoDePagina } from "./cabecera";
import { DeUnVistazo } from "./de-un-vistazo";
import { dia, type Exportacion } from "./formato";
import { Anteriores, Graficos, Historial, RecorridoDeVersion, Seccion } from "./secciones";

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
      .catch((e: unknown) => setError(mensajeParaElla(e, PDF_RECORRIDO_NO_SALIO)));
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
  const { paciente, vigente, anteriores, versiones } = datos;

  return (
    <article
      data-hoja-recorrido
      className="mx-auto box-content w-[178mm] bg-cream-50 p-[12mm] font-sans text-ink-900 shadow-raised [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:p-0 print:shadow-none"
    >
      {/* El título del documento es el nombre que el navegador propone para el PDF. */}
      <title>{`${RECORRIDO} · ${paciente.apellido}, ${paciente.nombre} · ${dia(datos.exportadoEn)}`}</title>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <td className="pb-6">
              <EncabezadoDePagina datos={datos} />
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
              <CabeceraDocumento datos={datos} />
              <DeUnVistazo datos={datos} />

              <Seccion antetitulo={vigente ? `Versión ${vigente.version}` : "Sin versión"} titulo="El Recorrido vigente">
                {vigente ? (
                  <RecorridoDeVersion datos={datos} version={vigente} />
                ) : (
                  <p className="text-[10pt] text-ink-500">Todavía no hay un Recorrido revisado.</p>
                )}
              </Seccion>

              <Seccion antetitulo="Todas las sesiones con nota" titulo={COMO_VA} nuevaPagina>
                <Graficos datos={datos} />
              </Seccion>

              <Seccion antetitulo={pluralizar(versiones.length, "versión", "versiones")} titulo="Historial de versiones" nuevaPagina>
                <Historial datos={datos} />
              </Seccion>

              {anteriores.length > 0 ? (
                <Seccion
                  antetitulo={pluralizar(anteriores.length, "versión", "versiones")}
                  titulo="Versiones que estuvieron vigentes antes"
                  nuevaPagina
                >
                  <Anteriores datos={datos} />
                </Seccion>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
