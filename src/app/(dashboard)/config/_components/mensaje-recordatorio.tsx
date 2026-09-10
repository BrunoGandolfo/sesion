"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import { asegurarLineaContacto, buildSmsMessage } from "@/lib/sms-texto";
import { EditorRecordatorio, FICHAS_INSERTABLES } from "./editor-recordatorio";

const FECHA_PREVIEW = new Date("2026-04-21T10:00:00-03:00");

export function MensajeRecordatorio({
  template, profesional, direccion, telefono, onChange,
}: {
  template: string;
  profesional: string;
  direccion: string;
  telefono: string;
  onChange: (template: string) => void;
}) {
  const [revisionEditor, setRevisionEditor] = React.useState(0);
  const templateSeparado = template.replace(/\{\{profesional\}\}(?=\p{L})/gu, "{{profesional}}\n");
  const nombrePegado = templateSeparado !== template;
  // La misma preparación que usa el envío, incluida su línea de contacto.
  const vistaPrevia = buildSmsMessage(asegurarLineaContacto(template), {
    nombre: "Lucía", apellido: "Fernández", fecha: FECHA_PREVIEW,
    direccion, profesional, telefonoConsultorio: telefono,
  });

  return (
    <>
      <div>
        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Mensaje</span>
        <EditorRecordatorio key={revisionEditor} template={template} onChange={onChange} fichas={FICHAS_INSERTABLES} />
        {template.trim() === "" ? (
          <p role="alert" className="mt-2 text-[12px] text-[color:var(--color-error)]">El recordatorio no puede quedar vacío.</p>
        ) : null}
        {nombrePegado ? (
          <div className="mt-3 rounded-lg bg-cream-100 p-3">
            <p className="mb-2 text-[13px] leading-relaxed text-ink-700">
              Tu nombre quedó pegado al texto siguiente. En el SMS también se leería así.
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => {
              onChange(templateSeparado);
              // El editor conserva el cursor mientras se escribe; sólo se
              // vuelve a montar al aplicar esta corrección explícita.
              setRevisionEditor((revision) => revision + 1);
            }}>Separar nombre y texto</Button>
          </div>
        ) : null}
        <p className="mt-2 text-[12px] leading-[1.5] text-ink-500">
          Tocá una ficha para agregarla donde está el cursor. La línea de contacto con tu nombre y tu teléfono se agrega sola si la borrás.
        </p>
      </div>
      <div>
        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Así lo recibe la paciente</span>
        <div role="region" aria-label="Vista previa del SMS" className="whitespace-pre-wrap break-words rounded-[10px] border-l-[3px] border-l-sage-500 bg-cream-100 px-4 py-[14px] text-[14px] italic leading-[1.5] text-ink-900">
          {vistaPrevia}
        </div>
      </div>
    </>
  );
}
