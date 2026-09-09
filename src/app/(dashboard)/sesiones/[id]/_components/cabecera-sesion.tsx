// La cabecera de una sesión: de quién es, qué día fue y en qué estado está
// la nota.
//
// Vive suelta y no dentro de la nota porque ahora la comparten dos vistas
// hermanas —la nota clínica y "Para vos"— y las dos tienen que decir lo
// mismo, igual, en el mismo lugar. Si al cambiar de pestaña se moviera el
// nombre de la paciente, dejaría de leerse como dos caras de una sesión y
// pasaría a leerse como dos pantallas distintas.
//
// El rótulo de arriba es lo único que cambia entre las dos: dice cuál de las
// dos se está mirando.

import { Chip } from "@/components/ui";
import { fechaLarga } from "@/lib/format";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { APROBADA, BORRADOR, NOTA_CLINICA } from "./textos";

interface CabeceraSesionProps {
  sesion: SesionClinicaResponse;
  /** Rótulo en versalitas, arriba del nombre: qué vista es esta. */
  rotulo: string;
}

export function CabeceraSesion({ sesion, rotulo }: CabeceraSesionProps) {
  const paciente = sesion.turno?.paciente;
  const nombrePaciente = paciente
    ? `${paciente.nombre} ${paciente.apellido}`
    : NOTA_CLINICA;
  const fecha = sesion.turno ? fechaLarga(new Date(sesion.turno.fecha)) : null;
  const aprobada = sesion.estado === "aprobado";

  return (
    <header className="flex flex-col gap-2">
      <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {rotulo}
      </p>
      <h1 className="font-display text-[24px] font-medium tracking-[-0.01em] text-ink-900 md:text-[30px]">
        {nombrePaciente}
      </h1>
      <div className="flex flex-wrap items-center gap-3">
        {fecha ? (
          <span className="font-sans text-[14px] text-ink-500">{fecha}</span>
        ) : null}
        <Chip variant={aprobada ? "sage" : "gold"}>
          {aprobada ? APROBADA : BORRADOR}
        </Chip>
      </div>
    </header>
  );
}
