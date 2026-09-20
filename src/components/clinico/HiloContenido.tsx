import { formatearEtiqueta } from "@/lib/etiquetas";
import Link from "next/link";
import { formatearFechaCompletaMvd, instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import { EL_RECORRIDO_HASTA_HOY, RELATO_UN_PARRAFO_POR_SESION, SIN_INTERVENCIONES, SIN_OBJETIVOS, SIN_SENALES_ANTERIORES, SIN_TEMAS } from "@/lib/glosario";
import type { ContenidoHilo } from "@/lib/hilo/contenido";

const dia = (valor: string) => formatearFechaCompletaMvd(instanteDesdeFechaHoraMvd(valor, "12:00"));

// Lo mismo se lee en pantalla y se imprime (la hoja del Recorrido). Para el
// papel: una sección corta no se parte entre páginas, un título no queda
// solo al pie, y un texto libre se parte entre párrafos, nunca dentro de uno.
// El resumen acumulado es la excepción a la sección entera: crece un párrafo
// por sesión y pasa de una página, así que mandarlo completo a la hoja
// siguiente solo dejaría la anterior en blanco.
//
// EN PANTALLA (`pantalla`) cambia el orden, no el contenido: primero lo que
// el Recorrido tiene y la lista de sesiones no —objetivos, hipótesis, temas,
// intervenciones, señales— y al final, plegado, el relato acumulado, que
// repite lo que ya dicen las notas. Sin `pantalla` sale el orden del papel,
// que no se toca: lo cuida hoja-igual-que-antes.test.tsx.

type Campo = keyof ContenidoHilo;
const ORDEN_PAPEL: Campo[] = ["hipotesisDiagnostica", "resumenAcumulativo", "objetivosTerapeuticos", "intervencionesProbadas", "temasRecurrentes", "riesgosHistoricos"];
/** También es el orden de la comparación de una propuesta (HiloView). */
export const ORDEN_PANTALLA = ["objetivosTerapeuticos", "hipotesisDiagnostica", "temasRecurrentes", "intervencionesProbadas", "riesgosHistoricos", "resumenAcumulativo"] as const satisfies readonly Campo[];

/** Un texto libre como párrafos: los separa la línea en blanco que ya trae. */
function Parrafos({ texto, vacio }: { texto: string | null; vacio: string }) {
  const parrafos = (texto ?? "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (parrafos.length === 0) return <p>{vacio}</p>;
  return <div className="space-y-3">{parrafos.map((p, i) => <p key={i} className="whitespace-pre-wrap break-inside-avoid">{p}</p>)}</div>;
}

export function HiloContenido({ contenido, anterior, sesiones = [], solo, pantalla = false }: { contenido: ContenidoHilo; anterior?: ContenidoHilo; solo?: Campo; sesiones?: { id: string; fecha: string }[]; pantalla?: boolean }) {
  const cambiado = (campo: Campo) => anterior && JSON.stringify(contenido[campo]) !== JSON.stringify(anterior[campo]);
  const marca = (campo: Campo) => cambiado(campo) ? <span className="ml-2 text-xs text-sage-700">Con cambios</span> : null;
  // En pantalla una lista vacía lo dice; en el papel queda como estaba.
  const lista = (items: React.ReactNode[], vacio: string) => pantalla && items.length === 0 ? <p className="text-ink-500">{vacio}</p> : <ul>{items}</ul>;
  const cuerpos: Partial<Record<Campo, { titulo: string; cuerpo: React.ReactNode; partible?: boolean }>> = {
    hipotesisDiagnostica: { titulo: "Hipótesis clínica", cuerpo: <Parrafos texto={contenido.hipotesisDiagnostica} vacio="Sin hipótesis registrada." /> },
    resumenAcumulativo: { titulo: EL_RECORRIDO_HASTA_HOY, cuerpo: <Parrafos texto={contenido.resumenAcumulativo} vacio="Sin resumen registrado." />, partible: true },
    objetivosTerapeuticos: { titulo: "Objetivos", cuerpo: lista(contenido.objetivosTerapeuticos.map(o => <li key={o.id} className="mb-2 break-inside-avoid">{o.descripcion} · {o.estado}<br /><span className="text-ink-500">Desde {dia(o.fechaInicio)}{o.fechaCierre ? ` · Cierre: ${dia(o.fechaCierre)}` : ""}</span></li>), SIN_OBJETIVOS) },
    intervencionesProbadas: { titulo: "Intervenciones", cuerpo: lista(contenido.intervencionesProbadas.map((x, i) => <li key={i} className="break-inside-avoid">{formatearEtiqueta(x.tecnica)} · Eficacia registrada: {x.eficaciaPercibida}
      <ul>{x.sesiones.map(id => { const s = sesiones.find(s => s.id === id); return <li key={id}><Link className="underline" href={`/sesiones/${id}`}>{s ? `Nota del ${formatearFechaCompletaMvd(new Date(s.fecha))}` : "Ver nota de origen"}</Link></li>; })}</ul>
    </li>), SIN_INTERVENCIONES) },
    temasRecurrentes: { titulo: "Temas recurrentes", cuerpo: lista(contenido.temasRecurrentes.map((x, i) => <li key={i} className="break-inside-avoid">{x.tema} · {x.conteo} sesiones</li>), SIN_TEMAS) },
    riesgosHistoricos: { titulo: "Señales anteriores", cuerpo: lista(contenido.riesgosHistoricos.map((x, i) => <li key={i} className="mb-2 break-inside-avoid">{dia(x.fecha)} · {formatearEtiqueta(x.flag)}<blockquote>{x.detalle}</blockquote></li>), SIN_SENALES_ANTERIORES) },
  };
  const seccion = (campo: Campo) => {
    const { titulo, cuerpo, partible = false } = cuerpos[campo]!;
    // El relato, plegado: solo en la lectura de pantalla. Al comparar una
    // propuesta (`solo`) va abierto, porque ahí lo que importa es qué cambió.
    if (pantalla && !solo && campo === "resumenAcumulativo") {
      return <details key={campo} className="rounded-md border border-[color:var(--border-subtle)] p-3">
        <summary className="cursor-pointer py-2.5 font-semibold">{titulo} <span className="font-normal text-ink-500">· {RELATO_UN_PARRAFO_POR_SESION}</span></summary>
        <div className="mt-2">{cuerpo}</div>
      </details>;
    }
    return <section key={campo} className={`space-y-2 ${partible ? "" : "break-inside-avoid"}`}>
      <h4 className="font-semibold break-after-avoid">{titulo}{marca(campo)}</h4>{cuerpo}
    </section>;
  };
  const orden: readonly Campo[] = pantalla ? ORDEN_PANTALLA : ORDEN_PAPEL;
  return <div className="space-y-5 text-sm leading-relaxed">
    {orden.filter(campo => !solo || solo === campo).map(seccion)}
  </div>;
}
