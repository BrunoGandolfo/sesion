"use client";

import * as React from "react";

import { Button } from "@/components/ui";
import { apiPost } from "@/lib/api-client";
import {
  CONSENTIMIENTO_VERSION,
  generarTextoConsentimiento,
} from "@/lib/consentimiento";
import { ALGO_FALLO, AUTORIZACION_GRABACION } from "@/lib/glosario";

import { FirmaCanvas } from "./FirmaCanvas";

interface ConsentimientoFormProps {
  pacienteId: string;
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
  onConsentimientoFirmado: () => void;
  onCancelar: () => void;
}

export function ConsentimientoForm({
  pacienteId,
  nombrePaciente,
  nombreProfesional,
  direccionConsultorio,
  onConsentimientoFirmado,
  onCancelar,
}: ConsentimientoFormProps) {
  const [acepta, setAcepta] = React.useState(false);
  const [firma, setFirma] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const checkboxId = React.useId();
  const textoId = React.useId();

  const texto = React.useMemo(
    () =>
      generarTextoConsentimiento({
        nombrePaciente,
        nombreProfesional,
        direccionConsultorio,
      }),
    [nombrePaciente, nombreProfesional, direccionConsultorio],
  );

  const puedeFirmar = acepta && firma !== null && !enviando;

  const handleFirmar = async () => {
    if (!puedeFirmar || firma === null) return;

    setEnviando(true);
    setError(null);

    try {
      // La ruta responde ok({ consentimiento }); el resultado no se usa,
      // alcanza con que no falle.
      await apiPost(`/api/pacientes/${pacienteId}/consentimiento`, {
        firmaDigital: firma,
        textoVersion: CONSENTIMIENTO_VERSION,
      });
      onConsentimientoFirmado();
    } catch (err) {
      setError(err instanceof Error ? err.message : ALGO_FALLO);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-display text-[22px] md:text-[28px] font-medium tracking-[-0.01em] text-ink-900">
        {AUTORIZACION_GRABACION}
      </h2>

      <div
        id={textoId}
        role="region"
        aria-label="Texto de la autorización"
        tabIndex={0}
        className="bg-cream-100 rounded-lg p-5 md:p-6 max-h-[420px] overflow-y-auto whitespace-pre-wrap font-sans text-[16px] leading-[1.6] text-ink-900"
      >
        {texto}
      </div>

      <label htmlFor={checkboxId} className="flex items-start gap-3 cursor-pointer">
        <input
          id={checkboxId}
          type="checkbox"
          checked={acepta}
          onChange={(event) => setAcepta(event.target.checked)}
          aria-describedby={textoId}
          className="mt-[3px] h-[18px] w-[18px] shrink-0 cursor-pointer accent-sage-500"
        />
        <span className="font-sans text-[15px] leading-[1.5] text-ink-900">
          Leí y entiendo la información anterior
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Firmá acá
        </span>
        <FirmaCanvas onFirmaChange={setFirma} />
      </div>

      {error && (
        <p role="alert" className="font-sans text-[14px] text-[color:var(--color-error)]">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleFirmar}
          disabled={!puedeFirmar}
          aria-disabled={!puedeFirmar}
        >
          {enviando ? "Firmando…" : "Firmar"}
        </Button>
      </div>
    </div>
  );
}
