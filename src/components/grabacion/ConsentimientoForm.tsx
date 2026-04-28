"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import { FirmaCanvas } from "./FirmaCanvas";

const TEXTO_VERSION = "1.0";

interface ConsentimientoFormProps {
  pacienteId: string;
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
  onConsentimientoFirmado: () => void;
  onCancelar: () => void;
}

function generarTexto(params: {
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
}): string {
  const { nombrePaciente, nombreProfesional, direccionConsultorio } = params;

  return `Consentimiento informado para grabación de sesiones
Versión ${TEXTO_VERSION}

Hola ${nombrePaciente}.

Antes de empezar, queremos contarte cómo funciona la grabación de las sesiones y pedirte que la autorices por escrito. Es un trámite simple y querés tomarte el tiempo de leerlo: se trata de tus datos y de tu intimidad.

¿Qué se graba?
Se graba el audio de tu sesión de psicoterapia con ${nombreProfesional}, en el consultorio ubicado en ${direccionConsultorio}. No se graba video.

¿Para qué se graba?
El audio se usa para generar, con ayuda de inteligencia artificial, una nota clínica escrita que ${nombreProfesional} usa para documentar la sesión en tu historia clínica. Esto le permite estar más presente durante la sesión y dedicarle menos tiempo a escribir después.

¿Quién puede escuchar el audio?
Solamente ${nombreProfesional}, que es la profesional que te atiende. Nadie más tiene acceso al audio de tus sesiones.

¿Dónde se procesa el audio?
El audio se procesa en un servidor privado al que solo accede ${nombreProfesional}. No se sube a servicios en internet de uso general ni queda guardado en servidores de empresas externas.

¿Cuánto tiempo se guarda el audio?
El audio se borra automáticamente apenas se genera la nota clínica. En la práctica esto pasa pocos minutos después de que termina la sesión. No queda una copia.

¿Qué queda guardado entonces?
Solo queda la nota clínica escrita, incorporada a tu historia clínica, igual que las notas que ${nombreProfesional} escribiría a mano. El audio no queda.

¿Podés cambiar de opinión?
Sí, en cualquier momento. Podés revocar esta autorización cuando quieras, simplemente avisándole a ${nombreProfesional}. A partir de ese momento las sesiones siguientes no se graban. Esto no afecta para nada la continuidad de tu tratamiento ni la relación con tu profesional.

¿Es obligatorio aceptar?
No. La grabación es totalmente opcional. Si preferís que no se grabe, la sesión sigue de manera normal y ${nombreProfesional} toma notas como siempre. No hay ninguna consecuencia por decir que no.

Marco legal
Esta autorización se enmarca en la Ley 18.331 de Protección de Datos Personales de la República Oriental del Uruguay, que exige que el tratamiento de datos sensibles —como los datos de salud— se haga con tu consentimiento previo, libre, expreso e informado.

Al firmar, declaro que:
- Leí y entendí esta información
- Autorizo la grabación de mis sesiones con ${nombreProfesional}
- Sé que puedo revocar esta autorización cuando quiera
`;
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
      generarTexto({
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
      const res = await fetch(
        `/api/pacientes/${pacienteId}/consentimiento`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firmaDigital: firma,
            textoVersion: TEXTO_VERSION,
          }),
        },
      );

      if (!res.ok) {
        throw new Error("No pudimos guardar el consentimiento. Intentá de nuevo.");
      }

      onConsentimientoFirmado();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No pudimos guardar el consentimiento. Intentá de nuevo.",
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-display text-[22px] md:text-[28px] font-medium tracking-[-0.01em] text-ink-900">
        Consentimiento para grabación
      </h2>

      <div
        id={textoId}
        role="region"
        aria-label="Texto del consentimiento"
        tabIndex={0}
        className="bg-cream-100 rounded-lg p-5 md:p-6 max-h-[420px] overflow-y-auto whitespace-pre-wrap font-sans text-[16px] leading-[1.6] text-ink-900"
      >
        {texto}
      </div>

      <label
        htmlFor={checkboxId}
        className="flex items-start gap-3 cursor-pointer"
      >
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
        <p
          role="alert"
          className="font-sans text-[14px] text-[color:var(--color-error)]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancelar}
          disabled={enviando}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleFirmar}
          disabled={!puedeFirmar}
          aria-disabled={!puedeFirmar}
        >
          {enviando ? "Firmando…" : "Firmar consentimiento"}
        </Button>
      </div>
    </div>
  );
}
