"use client";

import { Button } from "@/components/ui";
import { fechaInputMvd, formatearFechaCompletaMvd, formatearHoraMvd } from "@/lib/fechas-montevideo";
import { formatearEtiqueta } from "@/lib/etiquetas";
import type { ContenidoHilo } from "@/lib/hilo/contenido";
import { flagRiesgoSchema, tipoIntervencionSchema, confianzaModeloSchema } from "@/lib/sesion-clinica/schema";

const campo = "mt-1 w-full rounded border border-cream-300 bg-white p-2 text-ink-900";
export function HiloEditor({ valor, cambiar, disabled, sesiones }: { valor: ContenidoHilo; cambiar: (v: ContenidoHilo) => void; disabled: boolean; sesiones: { id: string; fecha: string }[] }) {
  const poner = <K extends keyof ContenidoHilo>(clave: K, dato: ContenidoHilo[K]) => cambiar({ ...valor, [clave]: dato });
  return <fieldset disabled={disabled} className="space-y-5">
    <label className="block">Hipótesis clínica<textarea className={campo} rows={3} value={valor.hipotesisDiagnostica ?? ""} onChange={e => poner("hipotesisDiagnostica", e.target.value || null)} /></label>
    <label className="block">El recorrido hasta hoy<textarea className={campo} rows={8} value={valor.resumenAcumulativo ?? ""} onChange={e => poner("resumenAcumulativo", e.target.value || null)} /></label>
    <section className="space-y-3"><h4 className="font-semibold">Objetivos</h4>
      {valor.objetivosTerapeuticos.map((o, i) => {
        const editar = (parche: Partial<typeof o>) => poner("objetivosTerapeuticos", valor.objetivosTerapeuticos.map((x, j) => j === i ? { ...x, ...parche } : x));
        return <fieldset key={o.id} className="rounded border border-cream-300 p-3"><legend>Objetivo {i + 1}</legend>
          <label className="block">Descripción<textarea className={campo} value={o.descripcion} onChange={e => editar({ descripcion: e.target.value })} /></label>
          <label>Estado<select className={campo} value={o.estado} onChange={e => editar({ estado: e.target.value as typeof o.estado })}>{["activo", "cerrado", "pausado"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Fecha de inicio<input className={campo} type="date" value={o.fechaInicio} onChange={e => editar({ fechaInicio: e.target.value })} /></label>
          <label>Fecha de cierre<input className={campo} type="date" value={o.fechaCierre ?? ""} onChange={e => editar({ fechaCierre: e.target.value || null })} /></label>
          <Button type="button" variant="ghost" onClick={() => poner("objetivosTerapeuticos", valor.objetivosTerapeuticos.filter((_, j) => j !== i))}>Quitar objetivo {i + 1}</Button>
        </fieldset>;
      })}
      <Button type="button" variant="ghost" onClick={() => poner("objetivosTerapeuticos", [...valor.objetivosTerapeuticos, { id: crypto.randomUUID(), descripcion: "", estado: "activo", fechaInicio: fechaInputMvd(new Date()), fechaCierre: null }])}>Agregar objetivo</Button>
    </section>
    <section className="space-y-3"><h4 className="font-semibold">Intervenciones</h4>
      {valor.intervencionesProbadas.map((x, i) => {
        const editar = (parche: Partial<typeof x>) => poner("intervencionesProbadas", valor.intervencionesProbadas.map((v, j) => i === j ? { ...v, ...parche } : v));
        return <fieldset key={i} className="rounded border border-cream-300 p-3"><legend>Intervención {i + 1}</legend>
          <label>Técnica<select className={campo} value={x.tecnica} onChange={e => editar({ tecnica: e.target.value as typeof x.tecnica })}>{tipoIntervencionSchema.options.map(v => <option key={v} value={v}>{formatearEtiqueta(v)}</option>)}</select></label>
          <label>Eficacia registrada<select className={campo} value={x.eficaciaPercibida} onChange={e => editar({ eficaciaPercibida: e.target.value as typeof x.eficaciaPercibida })}>{confianzaModeloSchema.options.map(v => <option key={v}>{v}</option>)}</select></label>
          <fieldset className="my-3"><legend>Notas de origen</legend>{sesiones.map(s => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" checked={x.sesiones.includes(s.id)} onChange={e => editar({ sesiones: e.target.checked ? [...x.sesiones, s.id] : x.sesiones.filter(id => id !== s.id) })} />{formatearFechaCompletaMvd(new Date(s.fecha))}, {formatearHoraMvd(new Date(s.fecha))}</label>)}</fieldset>
          <Button type="button" variant="ghost" onClick={() => poner("intervencionesProbadas", valor.intervencionesProbadas.filter((_, j) => j !== i))}>Quitar intervención {i + 1}</Button>
        </fieldset>;
      })}
      <Button type="button" variant="ghost" onClick={() => poner("intervencionesProbadas", [...valor.intervencionesProbadas, { tecnica: "otra", eficaciaPercibida: "media", sesiones: [] }])}>Agregar intervención</Button>
    </section>
    <section className="space-y-3"><h4 className="font-semibold">Temas recurrentes</h4>
      {valor.temasRecurrentes.map((x, i) => <fieldset key={i} className="rounded border border-cream-300 p-3"><legend>Tema {i + 1}</legend>
        <label>Tema<input className={campo} value={x.tema} onChange={e => poner("temasRecurrentes", valor.temasRecurrentes.map((v, j) => i === j ? { ...v, tema: e.target.value } : v))} /></label>
        <label>Cantidad de sesiones<input className={campo} type="number" min={1} value={x.conteo} onChange={e => poner("temasRecurrentes", valor.temasRecurrentes.map((v, j) => i === j ? { ...v, conteo: Number(e.target.value) } : v))} /></label>
        <Button type="button" variant="ghost" onClick={() => poner("temasRecurrentes", valor.temasRecurrentes.filter((_, j) => j !== i))}>Quitar tema {i + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="ghost" onClick={() => poner("temasRecurrentes", [...valor.temasRecurrentes, { tema: "", conteo: 1 }])}>Agregar tema</Button>
    </section>
    <section className="space-y-3"><h4 className="font-semibold">Señales anteriores</h4>
      {valor.riesgosHistoricos.map((x, i) => {
        const editar = (parche: Partial<typeof x>) => poner("riesgosHistoricos", valor.riesgosHistoricos.map((v, j) => i === j ? { ...v, ...parche } : v));
        return <fieldset key={i} className="rounded border border-cream-300 p-3"><legend>Señal {i + 1}</legend>
          <label>Señal<select className={campo} value={x.flag} onChange={e => editar({ flag: e.target.value as typeof x.flag })}>{flagRiesgoSchema.options.map(v => <option key={v} value={v}>{formatearEtiqueta(v)}</option>)}</select></label>
          <label>Fecha<input className={campo} type="date" value={x.fecha} onChange={e => editar({ fecha: e.target.value })} /></label>
          <label>Detalle<textarea className={campo} value={x.detalle} onChange={e => editar({ detalle: e.target.value })} /></label>
          <Button type="button" variant="ghost" onClick={() => poner("riesgosHistoricos", valor.riesgosHistoricos.filter((_, j) => j !== i))}>Quitar señal {i + 1}</Button>
        </fieldset>;
      })}
      <p className="text-sm text-ink-500">Las señales conservan su sesión de origen. Podés corregirlas o quitarlas de esta versión; las anteriores quedan en el historial.</p>
    </section>
  </fieldset>;
}
