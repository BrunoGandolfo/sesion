import { formatearEtiqueta } from "@/lib/etiquetas";
import Link from "next/link";
import { formatearFechaCompletaMvd, instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import type { ContenidoHilo } from "@/lib/hilo/contenido";

const dia = (valor: string) => formatearFechaCompletaMvd(instanteDesdeFechaHoraMvd(valor, "12:00"));

// Lo mismo se lee en pantalla y se imprime (la hoja del Recorrido). Para el
// papel: una sección corta no se parte entre páginas, un título no queda
// solo al pie, y un texto libre se parte entre párrafos, nunca dentro de uno.
// El resumen acumulado es la excepción a la sección entera: crece un párrafo
// por sesión y pasa de una página, así que mandarlo completo a la hoja
// siguiente solo dejaría la anterior en blanco.

/** Un texto libre como párrafos: los separa la línea en blanco que ya trae. */
function Parrafos({ texto, vacio }: { texto: string | null; vacio: string }) {
  const parrafos = (texto ?? "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (parrafos.length === 0) return <p>{vacio}</p>;
  return <div className="space-y-3">{parrafos.map((p, i) => <p key={i} className="whitespace-pre-wrap break-inside-avoid">{p}</p>)}</div>;
}

export function HiloContenido({ contenido, anterior, sesiones = [], solo }: { contenido: ContenidoHilo; anterior?: ContenidoHilo; solo?: keyof ContenidoHilo; sesiones?: { id: string; fecha: string }[] }) {
  const cambiado = (campo: keyof ContenidoHilo) => anterior && JSON.stringify(contenido[campo]) !== JSON.stringify(anterior[campo]);
  const seccion = (campo: keyof ContenidoHilo, titulo: string, cuerpo: React.ReactNode, partible = false) => solo && solo !== campo ? null : <section className={`space-y-2 ${partible ? "" : "break-inside-avoid"}`}>
    <h4 className="font-semibold break-after-avoid">{titulo}{cambiado(campo) ? <span className="ml-2 text-xs text-sage-700">Con cambios</span> : null}</h4>{cuerpo}
  </section>;
  return <div className="space-y-5 text-sm leading-relaxed">
    {seccion("hipotesisDiagnostica", "Hipótesis clínica", <Parrafos texto={contenido.hipotesisDiagnostica} vacio="Sin hipótesis registrada." />)}
    {seccion("resumenAcumulativo", "El recorrido hasta hoy", <Parrafos texto={contenido.resumenAcumulativo} vacio="Sin resumen registrado." />, true)}
    {seccion("objetivosTerapeuticos", "Objetivos", <ul>{contenido.objetivosTerapeuticos.map(o => <li key={o.id} className="mb-2 break-inside-avoid">{o.descripcion} · {o.estado}<br /><span className="text-ink-500">Desde {dia(o.fechaInicio)}{o.fechaCierre ? ` · Cierre: ${dia(o.fechaCierre)}` : ""}</span></li>)}</ul>)}
    {seccion("intervencionesProbadas", "Intervenciones", <ul>{contenido.intervencionesProbadas.map((x, i) => <li key={i} className="break-inside-avoid">{formatearEtiqueta(x.tecnica)} · Eficacia registrada: {x.eficaciaPercibida}
      <ul>{x.sesiones.map(id => { const s = sesiones.find(s => s.id === id); return <li key={id}><Link className="underline" href={`/sesiones/${id}`}>{s ? `Nota del ${formatearFechaCompletaMvd(new Date(s.fecha))}` : "Ver nota de origen"}</Link></li>; })}</ul>
    </li>)}</ul>)}
    {seccion("temasRecurrentes", "Temas recurrentes", <ul>{contenido.temasRecurrentes.map((x, i) => <li key={i} className="break-inside-avoid">{x.tema} · {x.conteo} sesiones</li>)}</ul>)}
    {seccion("riesgosHistoricos", "Señales anteriores", <ul>{contenido.riesgosHistoricos.map((x, i) => <li key={i} className="mb-2 break-inside-avoid">{dia(x.fecha)} · {formatearEtiqueta(x.flag)}<blockquote>{x.detalle}</blockquote></li>)}</ul>)}
  </div>;
}
