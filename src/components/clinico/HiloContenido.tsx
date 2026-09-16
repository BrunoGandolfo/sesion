import { formatearEtiqueta } from "@/lib/etiquetas";
import Link from "next/link";
import { formatearFechaCompletaMvd, instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import type { ContenidoHilo } from "@/lib/hilo/contenido";

const dia = (valor: string) => formatearFechaCompletaMvd(instanteDesdeFechaHoraMvd(valor, "12:00"));
export function HiloContenido({ contenido, anterior, sesiones = [], solo }: { contenido: ContenidoHilo; anterior?: ContenidoHilo; solo?: keyof ContenidoHilo; sesiones?: { id: string; fecha: string }[] }) {
  const cambiado = (campo: keyof ContenidoHilo) => anterior && JSON.stringify(contenido[campo]) !== JSON.stringify(anterior[campo]);
  const seccion = (campo: keyof ContenidoHilo, titulo: string, cuerpo: React.ReactNode) => solo && solo !== campo ? null : <section className="space-y-2">
    <h4 className="font-semibold">{titulo}{cambiado(campo) ? <span className="ml-2 text-xs text-sage-700">Con cambios</span> : null}</h4>{cuerpo}
  </section>;
  return <div className="space-y-5 text-sm leading-relaxed">
    {seccion("hipotesisDiagnostica", "Hipótesis clínica", <p className="whitespace-pre-wrap">{contenido.hipotesisDiagnostica || "Sin hipótesis registrada."}</p>)}
    {seccion("resumenAcumulativo", "El recorrido hasta hoy", <p className="whitespace-pre-wrap">{contenido.resumenAcumulativo || "Sin resumen registrado."}</p>)}
    {seccion("objetivosTerapeuticos", "Objetivos", <ul>{contenido.objetivosTerapeuticos.map(o => <li key={o.id} className="mb-2">{o.descripcion} · {o.estado}<br /><span className="text-ink-500">Desde {dia(o.fechaInicio)}{o.fechaCierre ? ` · Cierre: ${dia(o.fechaCierre)}` : ""}</span></li>)}</ul>)}
    {seccion("intervencionesProbadas", "Intervenciones", <ul>{contenido.intervencionesProbadas.map((x, i) => <li key={i}>{formatearEtiqueta(x.tecnica)} · Eficacia registrada: {x.eficaciaPercibida}
      <ul>{x.sesiones.map(id => { const s = sesiones.find(s => s.id === id); return <li key={id}><Link className="underline" href={`/sesiones/${id}`}>{s ? `Nota del ${formatearFechaCompletaMvd(new Date(s.fecha))}` : "Ver nota de origen"}</Link></li>; })}</ul>
    </li>)}</ul>)}
    {seccion("temasRecurrentes", "Temas recurrentes", <ul>{contenido.temasRecurrentes.map((x, i) => <li key={i}>{x.tema} · {x.conteo} sesiones</li>)}</ul>)}
    {seccion("riesgosHistoricos", "Señales anteriores", <ul>{contenido.riesgosHistoricos.map((x, i) => <li key={i} className="mb-2">{dia(x.fecha)} · {formatearEtiqueta(x.flag)}<blockquote>{x.detalle}</blockquote></li>)}</ul>)}
  </div>;
}
