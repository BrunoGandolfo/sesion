"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Chip, Sheet } from "@/components/ui";
import { ConsentimientoForm } from "./ConsentimientoForm";

interface ConsentimientoBadgeProps {
  pacienteId: string;
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
}

interface ConsentimientoVigente {
  id: string;
  pacienteId: string;
  firmadoEn: string;
  textoVersion: string;
  vigente: boolean;
}

interface ConsentimientoApiResponse {
  consentimiento: ConsentimientoVigente | null;
}

type Estado =
  | { tipo: "cargando" }
  | { tipo: "vigente"; consentimiento: ConsentimientoVigente }
  | { tipo: "sin" }
  | { tipo: "error" };

const fechaFormatter = new Intl.DateTimeFormat("es-UY", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export function ConsentimientoBadge({
  pacienteId,
  nombrePaciente,
  nombreProfesional,
  direccionConsultorio,
}: ConsentimientoBadgeProps) {
  const [estado, setEstado] = React.useState<Estado>({ tipo: "cargando" });
  const [sheetAbierto, setSheetAbierto] = React.useState(false);
  const [revocando, setRevocando] = React.useState(false);

  const cargarEstado = React.useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(
          `/api/pacientes/${pacienteId}/consentimiento`,
          { signal, cache: "no-store" },
        );

        if (!res.ok) {
          throw new Error("fetch_failed");
        }

        const data = (await res.json()) as ConsentimientoApiResponse;

        if (data.consentimiento && data.consentimiento.vigente) {
          setEstado({ tipo: "vigente", consentimiento: data.consentimiento });
        } else {
          setEstado({ tipo: "sin" });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setEstado({ tipo: "error" });
      }
    },
    [pacienteId],
  );

  React.useEffect(() => {
    const controller = new AbortController();
    setEstado({ tipo: "cargando" });
    void cargarEstado(controller.signal);
    return () => controller.abort();
  }, [cargarEstado]);

  const handleFirmado = async () => {
    setSheetAbierto(false);
    setEstado({ tipo: "cargando" });
    await cargarEstado();
  };

  const handleRevocar = async () => {
    const confirmar = window.confirm(
      "¿Querés revocar la autorización de grabación? Las próximas sesiones no se van a grabar.",
    );
    if (!confirmar) return;

    setRevocando(true);
    try {
      const res = await fetch(
        `/api/pacientes/${pacienteId}/consentimiento`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error("delete_failed");
      }
      await cargarEstado();
    } catch {
      setEstado({ tipo: "error" });
    } finally {
      setRevocando(false);
    }
  };

  if (estado.tipo === "cargando") {
    return (
      <div
        role="status"
        aria-label="Verificando consentimiento"
        className="inline-flex items-center gap-2"
      >
        <span className="h-5 w-40 animate-pulse rounded-full bg-cream-100" />
      </div>
    );
  }

  if (estado.tipo === "error") {
    return (
      <p className="font-sans text-[13px] text-ink-500">
        Error al verificar consentimiento
      </p>
    );
  }

  if (estado.tipo === "vigente") {
    const firmadoEn = new Date(estado.consentimiento.firmadoEn);
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="sage" className="gap-1">
            <ShieldCheck aria-hidden="true" className="h-3 w-3" />
            Grabación autorizada
          </Chip>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRevocar}
            disabled={revocando}
            aria-disabled={revocando}
            className="text-terracotta-500 hover:bg-terracotta-50"
          >
            {revocando ? "Revocando…" : "Revocar"}
          </Button>
        </div>
        <span className="font-sans text-[12px] text-ink-500">
          Firmado el {fechaFormatter.format(firmadoEn)}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip variant="neutral">Sin autorización de grabación</Chip>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSheetAbierto(true)}
        >
          Autorizar grabación
        </Button>
      </div>

      <Sheet
        open={sheetAbierto}
        onClose={() => setSheetAbierto(false)}
        ariaLabel="Firmar consentimiento de grabación"
      >
        <ConsentimientoForm
          pacienteId={pacienteId}
          nombrePaciente={nombrePaciente}
          nombreProfesional={nombreProfesional}
          direccionConsultorio={direccionConsultorio}
          onConsentimientoFirmado={handleFirmado}
          onCancelar={() => setSheetAbierto(false)}
        />
      </Sheet>
    </>
  );
}
