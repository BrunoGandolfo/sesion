"use client";

import { useSalidaProtegida } from "@/components/layout/proteccion-trabajo";
import { QUITAR_ELEMENTO_BORRADOR } from "@/lib/glosario";
import { Button, Input, Textarea } from "@/components/ui";
import { fechaInputMvd, formatearFechaCompletaMvd, formatearHoraMvd } from "@/lib/fechas-montevideo";
import { formatearEtiqueta } from "@/lib/etiquetas";
import type { ContenidoHilo } from "@/lib/hilo/contenido";
import { flagRiesgoSchema, tipoIntervencionSchema, confianzaModeloSchema } from "@/lib/sesion-clinica/schema";

import { Select } from "@/components/ui/select";
export function HiloEditor({ valor, cambiar, disabled, sesiones }: { valor: ContenidoHilo; cambiar: (v: ContenidoHilo) => void; disabled: boolean; sesiones: { id: string; fecha: string }[] }) {
  const confirmar = useSalidaProtegida();
  const quitar = (accion: () => void) => confirmar(accion, { mensaje: QUITAR_ELEMENTO_BORRADOR, etiqueta: "Quitar del borrador" });
  const poner = <K extends keyof ContenidoHilo>(clave: K, dato: ContenidoHilo[K]) => cambiar({ ...valor, [clave]: dato });
  return <fieldset disabled={disabled} className="space-y-5">
    <Textarea label="Hipótesis clínica" rows={3} value={valor.hipotesisDiagnostica ?? ""} onChange={e => poner("hipotesisDiagnostica", e.target.value || null)} />
    <Textarea label="El recorrido hasta hoy" rows={8} value={valor.resumenAcumulativo ?? ""} onChange={e => poner("resumenAcumulativo", e.target.value || null)} />
    <section className="space-y-3"><h4 className="font-semibold">Objetivos</h4>
      {valor.objetivosTerapeuticos.map((o, i) => {
        const editar = (parche: Partial<typeof o>) => poner("objetivosTerapeuticos", valor.objetivosTerapeuticos.map((x, j) => j === i ? { ...x, ...parche } : x));
        return <fieldset key={o.id} className="rounded-md border border-[color:var(--border-subtle)] p-3"><legend>Objetivo {i + 1}</legend>
          <Textarea label="Descripción" value={o.descripcion} onChange={e => editar({ descripcion: e.target.value })} />
          <Select label="Estado" value={o.estado} onChange={e => editar({ estado: e.target.value as typeof o.estado })}>{["activo", "cerrado", "pausado"].map(x => <option key={x}>{x}</option>)}</Select>
          <Input label="Fecha de inicio" type="date" value={o.fechaInicio} onChange={e => editar({ fechaInicio: e.target.value })} />
          <Input label="Fecha de cierre" type="date" value={o.fechaCierre ?? ""} onChange={e => editar({ fechaCierre: e.target.value || null })} />
          <Button type="button" variant="ghost" onClick={() => quitar(() => poner("objetivosTerapeuticos", valor.objetivosTerapeuticos.filter((_, j) => j !== i)))}>Quitar objetivo {i + 1}</Button>
        </fieldset>;
      })}
      <Button type="button" variant="ghost" onClick={() => poner("objetivosTerapeuticos", [...valor.objetivosTerapeuticos, { id: crypto.randomUUID(), descripcion: "", estado: "activo", fechaInicio: fechaInputMvd(new Date()), fechaCierre: null }])}>Agregar objetivo</Button>
    </section>
    <section className="space-y-3"><h4 className="font-semibold">Intervenciones</h4>
      {valor.intervencionesProbadas.map((x, i) => {
        const editar = (parche: Partial<typeof x>) => poner("intervencionesProbadas", valor.intervencionesProbadas.map((v, j) => i === j ? { ...v, ...parche } : v));
        return <fieldset key={i} className="rounded-md border border-[color:var(--border-subtle)] p-3"><legend>Intervención {i + 1}</legend>
          <Select label="Técnica" value={x.tecnica} onChange={e => editar({ tecnica: e.target.value as typeof x.tecnica })}>{tipoIntervencionSchema.options.map(v => <option key={v} value={v}>{formatearEtiqueta(v)}</option>)}</Select>
          <Select label="Eficacia registrada" value={x.eficaciaPercibida} onChange={e => editar({ eficaciaPercibida: e.target.value as typeof x.eficaciaPercibida })}>{confianzaModeloSchema.options.map(v => <option key={v}>{v}</option>)}</Select>
          <fieldset className="my-3"><legend>Notas de origen</legend>{sesiones.map(s => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" checked={x.sesiones.includes(s.id)} onChange={e => editar({ sesiones: e.target.checked ? [...x.sesiones, s.id] : x.sesiones.filter(id => id !== s.id) })} />{formatearFechaCompletaMvd(new Date(s.fecha))}, {formatearHoraMvd(new Date(s.fecha))}</label>)}</fieldset>
          <Button type="button" variant="ghost" onClick={() => quitar(() => poner("intervencionesProbadas", valor.intervencionesProbadas.filter((_, j) => j !== i)))}>Quitar intervención {i + 1}</Button>
        </fieldset>;
      })}
      <Button type="button" variant="ghost" onClick={() => poner("intervencionesProbadas", [...valor.intervencionesProbadas, { tecnica: "otra", eficaciaPercibida: "media", sesiones: [] }])}>Agregar intervención</Button>
    </section>
    <section className="space-y-3"><h4 className="font-semibold">Temas recurrentes</h4>
      {valor.temasRecurrentes.map((x, i) => <fieldset key={i} className="rounded-md border border-[color:var(--border-subtle)] p-3"><legend>Tema {i + 1}</legend>
        <Input label="Tema" value={x.tema} onChange={e => poner("temasRecurrentes", valor.temasRecurrentes.map((v, j) => i === j ? { ...v, tema: e.target.value } : v))} />
        <Input label="Cantidad de sesiones" type="number" min={1} value={x.conteo} onChange={e => poner("temasRecurrentes", valor.temasRecurrentes.map((v, j) => i === j ? { ...v, conteo: Number(e.target.value) } : v))} />
        <Button type="button" variant="ghost" onClick={() => quitar(() => poner("temasRecurrentes", valor.temasRecurrentes.filter((_, j) => j !== i)))}>Quitar tema {i + 1}</Button>
      </fieldset>)}
      <Button type="button" variant="ghost" onClick={() => poner("temasRecurrentes", [...valor.temasRecurrentes, { tema: "", conteo: 1 }])}>Agregar tema</Button>
    </section>
    <section className="space-y-3"><h4 className="font-semibold">Señales anteriores</h4>
      {valor.riesgosHistoricos.map((x, i) => {
        const editar = (parche: Partial<typeof x>) => poner("riesgosHistoricos", valor.riesgosHistoricos.map((v, j) => i === j ? { ...v, ...parche } : v));
        return <fieldset key={i} className="rounded-md border border-[color:var(--border-subtle)] p-3"><legend>Señal {i + 1}</legend>
          <Select label="Señal" value={x.flag} onChange={e => editar({ flag: e.target.value as typeof x.flag })}>{flagRiesgoSchema.options.map(v => <option key={v} value={v}>{formatearEtiqueta(v)}</option>)}</Select>
          <Input label="Fecha" type="date" value={x.fecha} onChange={e => editar({ fecha: e.target.value })} />
          <Textarea label="Detalle" value={x.detalle} onChange={e => editar({ detalle: e.target.value })} />
          <Button type="button" variant="ghost" onClick={() => quitar(() => poner("riesgosHistoricos", valor.riesgosHistoricos.filter((_, j) => j !== i)))}>Quitar señal {i + 1}</Button>
        </fieldset>;
      })}
      <p className="text-sm text-ink-500">Las señales conservan su sesión de origen. Podés corregirlas o quitarlas de esta versión; las anteriores quedan en el historial.</p>
    </section>
  </fieldset>;
}
