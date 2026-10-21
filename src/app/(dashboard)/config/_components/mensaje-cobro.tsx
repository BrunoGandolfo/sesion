"use client";

// La plantilla del aviso de cobro: el mismo editor con fichas que el
// recordatorio de turno. La plantilla guardada dice "{{sesiones}} sesión/es
// pendiente/s" (interpolarTemplateCobro lo convierte en "2 sesiones
// pendientes"); en el editor ese trozo es UNA ficha, "Sesiones pendientes",
// y al guardar vuelve a ser el mismo texto: la plantilla de siempre sale
// igual, carácter por carácter.

import { textoDelCobro } from "@/lib/deudas";
import {
  COBRO_MENSAJE_AYUDA,
  COBRO_MENSAJE_EDITOR,
  COBRO_MENSAJE_VACIO,
  COBRO_VISTA_PREVIA,
} from "@/lib/glosario";

import { EditorRecordatorio, type ClaveFicha } from "./editor-recordatorio";

const FICHAS_COBRO: ClaveFicha[] = ["nombre", "sesionesPendientes", "monto"];
const SESIONES_EN_PLANTILLA = "{{sesiones}} sesión/es pendiente/s";

const aEditor = (template: string) =>
  template.replace(/\{\{sesiones\}\}\s*sesión\/es\s+pendiente\/s/g, "{{sesionesPendientes}}");
const desdeEditor = (template: string) =>
  template.replaceAll("{{sesionesPendientes}}", SESIONES_EN_PLANTILLA);

export function MensajeCobro({
  template, profesional, direccion, telefono, onChange,
}: {
  template: string;
  profesional: string;
  direccion: string;
  telefono: string;
  onChange: (template: string) => void;
}) {
  const vistaPrevia = textoDelCobro(
    { templateCobro: template, nombreProfesional: profesional, direccion, whatsappOrigen: telefono },
    { nombre: "Lucía", apellido: "Fernández" },
    { sesiones: 2, monto: 2400 },
  );

  return (
    <>
      <div>
        <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">Mensaje</span>
        <EditorRecordatorio
          template={aEditor(template)}
          onChange={(valor) => onChange(desdeEditor(valor))}
          fichas={FICHAS_COBRO}
          etiqueta={COBRO_MENSAJE_EDITOR}
        />
        {template.trim() === "" ? (
          <p role="alert" className="mt-2 text-[12px] text-[color:var(--color-error)]">{COBRO_MENSAJE_VACIO}</p>
        ) : null}
        <p className="mt-2 text-[12px] leading-[1.5] text-ink-500">{COBRO_MENSAJE_AYUDA}</p>
      </div>
      <div>
        <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">Así lo recibe la paciente</span>
        <div role="region" aria-label={COBRO_VISTA_PREVIA} className="whitespace-pre-wrap break-words rounded-[10px] border-l-[3px] border-l-sage-500 bg-cream-100 px-4 py-[14px] text-[14px] italic leading-[1.5] text-ink-900">
          {vistaPrevia}
        </div>
      </div>
    </>
  );
}
