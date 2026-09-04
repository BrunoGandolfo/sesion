"use client";

// Único componente de estado de la autorización de grabación + sheet de
// firma. Dos variantes:
//   - "completo": chip de estado, fecha de firma, Revocar (con confirmación
//     inline) o Firmar. Es la sección de la pestaña Ficha.
//   - "aviso": solo aparece cuando falta la autorización, como aviso corto
//     con el botón de firmar. Es el bloque bajo la cabecera de la ficha.

import * as React from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Button, Chip, Confirmar, Sheet } from "@/components/ui";
import { ApiClientError, apiDelete, esAbort } from "@/lib/api-client";
import {
  ALGO_FALLO,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
} from "@/lib/glosario";

import { ConsentimientoForm } from "./ConsentimientoForm";

interface ConsentimientoBadgeProps {
  pacienteId: string;
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
  variante?: "completo" | "aviso";
  /** Se invoca después de firmar o revocar, para que el padre recargue. */
  onCambio?: () => void;
}

interface ConsentimientoVigente {
  id: string;
  pacienteId: string;
  firmadoEn: string;
  textoVersion: string;
  vigente: boolean;
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

// GET /consentimiento responde { consentimiento } sin envolver en { data },
// por eso no pasa por apiGet. El manejo de error es el mismo del cliente.
async function cargarConsentimiento(
  pacienteId: string,
  signal?: AbortSignal,
): Promise<Estado> {
  const res = await fetch(`/api/pacientes/${pacienteId}/consentimiento`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new ApiClientError(ALGO_FALLO, res.status);
  }
  const data = (await res.json()) as {
    consentimiento: ConsentimientoVigente | null;
  };
  if (data.consentimiento && data.consentimiento.vigente) {
    return { tipo: "vigente", consentimiento: data.consentimiento };
  }
  return { tipo: "sin" };
}

export function ConsentimientoBadge({
  pacienteId,
  nombrePaciente,
  nombreProfesional,
  direccionConsultorio,
  variante = "completo",
  onCambio,
}: ConsentimientoBadgeProps) {
  const [estado, setEstado] = React.useState<Estado>({ tipo: "cargando" });
  const [sheetAbierto, setSheetAbierto] = React.useState(false);
  const [confirmandoRevocar, setConfirmandoRevocar] = React.useState(false);
  const [revocando, setRevocando] = React.useState(false);

  // El estado inicial ya es "cargando"; los handlers que recargan lo marcan
  // ellos mismos en el evento que los dispara.
  React.useEffect(() => {
    const controller = new AbortController();
    cargarConsentimiento(pacienteId, controller.signal)
      .then(setEstado)
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setEstado({ tipo: "error" });
      });
    return () => controller.abort();
  }, [pacienteId]);

  const recargar = async () => {
    try {
      setEstado(await cargarConsentimiento(pacienteId));
    } catch {
      setEstado({ tipo: "error" });
    }
    onCambio?.();
  };

  const handleFirmado = async () => {
    setSheetAbierto(false);
    setEstado({ tipo: "cargando" });
    await recargar();
  };

  const handleRevocar = async () => {
    setRevocando(true);
    try {
      await apiDelete(`/api/pacientes/${pacienteId}/consentimiento`);
      setConfirmandoRevocar(false);
      await recargar();
    } catch {
      setEstado({ tipo: "error" });
    } finally {
      setRevocando(false);
    }
  };

  const sheetFirma = (
    <Sheet
      open={sheetAbierto}
      onClose={() => setSheetAbierto(false)}
      ariaLabel="Firmar autorización de grabación"
    >
      <ConsentimientoForm
        pacienteId={pacienteId}
        nombrePaciente={nombrePaciente}
        nombreProfesional={nombreProfesional}
        direccionConsultorio={direccionConsultorio}
        onConsentimientoFirmado={() => void handleFirmado()}
        onCancelar={() => setSheetAbierto(false)}
      />
    </Sheet>
  );

  if (variante === "aviso") {
    if (estado.tipo !== "sin") return null;
    return (
      <>
        <div
          role="status"
          className="flex flex-col gap-3 rounded-md border border-gold-50 bg-gold-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle
              size={18}
              strokeWidth={1.9}
              aria-hidden="true"
              className="mt-[2px] shrink-0 text-gold-500"
            />
            <p className="font-sans text-[13px] leading-[1.5] text-ink-900">
              <span className="font-semibold">{FALTA_AUTORIZACION}</span>
              <span className="text-ink-700">
                {" "}
                para grabar las sesiones. La paciente la firma acá mismo.
              </span>
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setSheetAbierto(true)}
            className="sm:shrink-0"
          >
            {FIRMAR_AUTORIZACION}
          </Button>
        </div>
        {sheetFirma}
      </>
    );
  }

  if (estado.tipo === "cargando") {
    return (
      <div
        role="status"
        aria-label="Verificando autorización"
        className="inline-flex items-center gap-2"
      >
        <span className="h-5 w-40 animate-pulse rounded-full bg-cream-100" />
      </div>
    );
  }

  if (estado.tipo === "error") {
    return <p className="font-sans text-[13px] text-ink-500">{ALGO_FALLO}</p>;
  }

  if (estado.tipo === "vigente") {
    const firmadoEn = new Date(estado.consentimiento.firmadoEn);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip variant="sage" className="gap-1">
              <ShieldCheck aria-hidden="true" className="h-3 w-3" />
              Grabación autorizada
            </Chip>
            {!confirmandoRevocar ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmandoRevocar(true)}
                className="text-terracotta-500 hover:bg-terracotta-50"
              >
                Revocar
              </Button>
            ) : null}
          </div>
          <span className="font-sans text-[12px] text-ink-500">
            Firmada el {fechaFormatter.format(firmadoEn)}
          </span>
        </div>
        {confirmandoRevocar ? (
          <Confirmar
            titulo="¿Revocar la autorización de grabación?"
            mensaje="Las próximas sesiones no se van a grabar. Lo ya grabado y sus notas se conservan."
            accion="Revocar"
            variante="peligro"
            enviando={revocando}
            enviandoLabel="Revocando…"
            onConfirmar={() => void handleRevocar()}
            onCancelar={() => setConfirmandoRevocar(false)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip variant="neutral">{FALTA_AUTORIZACION}</Chip>
        <Button variant="secondary" size="sm" onClick={() => setSheetAbierto(true)}>
          {FIRMAR_AUTORIZACION}
        </Button>
      </div>
      {sheetFirma}
    </>
  );
}
