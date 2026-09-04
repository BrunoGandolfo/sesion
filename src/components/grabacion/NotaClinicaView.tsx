"use client";

import Link from "next/link";

import { Button } from "@/components/ui";
import { NOTA_CLINICA, REVISAR_NOTA } from "@/lib/glosario";

// DEPRECADO. La nota clínica ya no se lee ni se aprueba dentro de un sheet:
// vive en su propia pantalla, /sesiones/[id], con su URL, su barra de
// acciones fija y el orden de lectura completo (cabecera, señal de riesgo,
// resumen, S-O-A-P, "Más de esta sesión", "Para vos", "Ver el borrador
// original").
//
// Este archivo queda como puente para los call sites que todavía montan el
// sheet (paciente-detail-view, historia-tab): en vez de duplicar el editor,
// manda a la pantalla. Cuando esos dos archivos enlacen directo a la ruta,
// este módulo se borra.
//
// Lo que había acá se repartió así:
//   - el editor SOAP y el orden de lectura →
//     src/app/(dashboard)/sesiones/[id]/_components/nota-sesion-view.tsx
//   - las casillas de flagsRiesgo → RiesgoDetectadoBanner (un solo bloque)
//   - Descartar / Aprobar → _components/barra-acciones.tsx
//   - el chip de confianza, el banner "Generada por IA" y speech analytics
//     no se reimplementaron: no son de la nota.

interface NotaClinicaViewProps {
  sesionClinicaId: string;
  /** @deprecated La pantalla lee la nota de la API, no de props. */
  nota?: unknown;
  /** @deprecated Idem. */
  notaOriginal?: unknown;
  /** @deprecated Idem. */
  datosEstructurados?: unknown;
  pacienteNombre?: string;
  fechaSesion?: string;
  /** @deprecated La aprobación ocurre en /sesiones/[id]. */
  onAprobado?: () => void;
}

/** @deprecated Enlazá a `/sesiones/${sesionClinicaId}`. */
export function NotaClinicaView({
  sesionClinicaId,
  pacienteNombre,
  fechaSesion,
}: NotaClinicaViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-col gap-1">
        <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          {NOTA_CLINICA}
        </p>
        {pacienteNombre ? (
          <p className="font-display text-[20px] font-medium text-ink-900">
            {pacienteNombre}
          </p>
        ) : null}
        {fechaSesion ? (
          <p className="font-sans text-[14px] text-ink-500">{fechaSesion}</p>
        ) : null}
      </div>

      <Button asChild variant="primary" className="w-full sm:w-auto">
        <Link href={`/sesiones/${sesionClinicaId}`}>{REVISAR_NOTA}</Link>
      </Button>
    </div>
  );
}
