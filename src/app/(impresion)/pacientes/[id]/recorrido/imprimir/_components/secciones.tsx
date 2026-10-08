// Las secciones de la hoja y lo que va adentro de cada una.
//
// Cada sección: el rótulo de serie en oro (meta, mayúscula, con aire), el
// título en Fraunces y un filete salvia claro debajo. Las subsecciones del
// Recorrido las dibuja HiloContenido —el mismo componente que la pantalla—
// y la hoja les da su forma desde afuera (Contenido): título salvia, barra
// de 2 px a la izquierda, y las señales anteriores sobre terracota.

import { AlianzaChart } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/alianza";
import { SESIONES_PARA_GRAFICOS } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/contenedor";
import { FlagsRiesgoTimeline } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/flags";
import { IntensidadChart } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/intensidad";
import { IntervencionesChart } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/intervenciones";
import { HiloContenido } from "@/components/clinico/HiloContenido";
import { POCO_RECORRIDO_DETALLE, POCO_RECORRIDO_TITULO } from "@/lib/glosario";

import { LecturasDelPeriodo } from "./lecturas";
import { TemasDelPeriodo } from "./temas";
import { autoria, diaCorto, diaCortoYHora, diaYHora, estadoLegible, type Exportacion } from "./formato";

export function Seccion({
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
      <div className="mb-5 break-after-avoid border-b border-sage-200 pb-2">
        <p className="text-[9pt] font-semibold uppercase tracking-[0.12em] text-gold-500">{antetitulo}</p>
        <h2 className="mt-0.5 font-display text-[18pt] font-medium leading-tight tracking-[-0.01em] text-ink-900">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

// Selectores sobre el DOM de HiloContenido: un <div> con una <section> por
// campo, cada una con su <h4>. Las señales anteriores son la única sección
// con <blockquote> (el detalle de cada señal); sin señales no hay bloque
// terracota, porque no hay riesgo que marcar.
const CONTENIDO = [
  "[&>div]:space-y-6 [&>div]:text-[10pt] [&>div]:leading-[1.5]",
  "[&>div>section]:border-l-2 [&>div>section]:border-sage-500 [&>div>section]:pl-4",
  "[&_h4]:font-display [&_h4]:text-[12pt] [&_h4]:font-medium [&_h4]:text-sage-700",
  "[&>div>section:has(blockquote)]:rounded-r-md [&>div>section:has(blockquote)]:border-terracotta-500 [&>div>section:has(blockquote)]:bg-terracotta-50 [&>div>section:has(blockquote)]:py-3 [&>div>section:has(blockquote)]:pr-4",
  "[&_li_ul]:mb-1 [&_li_ul]:ml-4 [&_li_ul]:text-ink-700 [&_a]:text-ink-900 [&_a]:no-underline",
  "[&_blockquote]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-terracotta-100 [&_blockquote]:pl-3",
].join(" ");

/** El contenido del hilo con la jerarquía de la hoja. */
export function Contenido({ children }: { children: React.ReactNode }) {
  return <div className={CONTENIDO}>{children}</div>;
}

export function RecorridoDeVersion({ datos, version }: { datos: Exportacion; version: NonNullable<Exportacion["vigente"]> }) {
  return (
    <Contenido>
      <HiloContenido contenido={version.contenido} sesiones={datos.sesiones} />
    </Contenido>
  );
}

/** "Cómo va": los mismos gráficos de la pantalla, cada uno en su tarjeta;
 *  temas y lecturas con su versión de papel (temas.tsx, lecturas.tsx). */
export function Graficos({ datos }: { datos: Exportacion }) {
  const { progreso } = datos;
  const sesiones = progreso.sesiones;
  const ultima = sesiones.at(-1);
  if (progreso.totalSesiones < SESIONES_PARA_GRAFICOS || !ultima) {
    return (
      <div className="break-inside-avoid rounded-md border border-dashed border-[color:var(--border-strong)] bg-white px-6 py-6 text-center">
        <p className="font-display text-[12pt]">{POCO_RECORRIDO_TITULO}</p>
        <p className="mt-1 text-[9pt] text-ink-500">{POCO_RECORRIDO_DETALLE}</p>
      </div>
    );
  }
  return (
    <div data-graficos className="flex flex-col gap-5">
      <FlagsRiesgoTimeline riesgos={progreso.riesgos} />
      <IntensidadChart sesiones={sesiones} />
      <AlianzaChart sesiones={sesiones} />
      <TemasDelPeriodo temas={progreso.temas} sesiones={sesiones} />
      <IntervencionesChart sesiones={sesiones} />
      {/* La pantalla muestra sólo la última; el papel, todas. */}
      <LecturasDelPeriodo sesiones={sesiones} />
    </div>
  );
}

export function Historial({ datos }: { datos: Exportacion }) {
  const { versiones, sesiones } = datos;
  const fechaDeSesion = new Map(sesiones.map((s) => [s.id, diaCorto(s.fecha)]));
  if (versiones.length === 0) return <p className="text-[10pt] text-ink-500">Todavía no hay versiones.</p>;
  return (
    <>
      <p className="mb-4 break-after-avoid text-[10pt] leading-[1.5] text-ink-700">
        Van completas la vigente y las que estuvieron vigentes antes; de las propuestas que no adoptaste queda solo el registro.
      </p>
      <table className="w-full border-collapse rounded-md bg-white text-left text-[9pt] leading-snug">
        <thead>
          <tr className="border-b border-sage-200 text-ink-500">
            <th scope="col" className="px-2 py-2 font-semibold">Versión</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Escrita</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Autoría</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Estado</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Nota de origen</th>
            <th scope="col" className="py-2 pr-2 font-semibold">Resuelta</th>
          </tr>
        </thead>
        <tbody>
          {versiones.map((v) => (
            <tr key={v.id} className="break-inside-avoid border-b border-cream-200 align-top last:border-b-0">
              <td className="px-2 py-2 tabular-nums">{v.version}</td>
              <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{diaCortoYHora(v.creadaEn)}</td>
              <td className="py-2 pr-3">{autoria(v)}</td>
              <td className="py-2 pr-3">{estadoLegible(v, datos)}</td>
              <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{v.sesionOrigenId ? (fechaDeSesion.get(v.sesionOrigenId) ?? "No disponible") : "—"}</td>
              <td className="whitespace-nowrap py-2 pr-2 tabular-nums">{v.resueltaEn ? diaCortoYHora(v.resueltaEn) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Anteriores({ datos }: { datos: Exportacion }) {
  return (
    <div className="flex flex-col gap-8">
      {datos.anteriores.map((v) => (
        <section key={v.id} className="border-t border-cream-200 pt-5 first:border-t-0 first:pt-0">
          <h3 className="mb-3 break-after-avoid font-display text-[14pt] font-medium text-ink-900">
            Versión {v.version}
            <span className="ml-2 font-sans text-[9pt] font-normal text-ink-500">
              {autoria(v)} · vigente desde el {diaYHora(v.resueltaEn ?? v.creadaEn)}
            </span>
          </h3>
          <RecorridoDeVersion datos={datos} version={v} />
        </section>
      ))}
    </div>
  );
}
