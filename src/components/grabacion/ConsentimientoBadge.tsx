"use client";

// Único componente de estado de la autorización de grabación + sheet de
// firma. Dos variantes:
//   - "completo": chip de estado, fecha de firma, Revocar (con confirmación
//     inline) o Firmar. Es la sección de la pestaña Datos.
//   - "aviso": solo aparece cuando falta la autorización, como aviso corto
//     con el botón de firmar. Es el bloque bajo la cabecera de la ficha.

import * as React from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";

import { Button, Chip, Confirmar, Sheet } from "@/components/ui";
import { apiDelete } from "@/lib/api-client";
import { fechaCompleta } from "@/lib/format";
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
  /** Lo que leyó la ficha (paciente-detail-view.tsx): UNA lectura de
   *  /consentimiento por recarga, compartida por las dos variantes. Antes
   *  cada Badge leía la suya y, con la de la ficha, eran tres. */
  estado: EstadoConsentimiento;
  /** Se invoca después de firmar o revocar: la ficha vuelve a leer. */
  onCambio: () => void;
}

export interface ConsentimientoVigente {
  id: string;
  pacienteId: string;
  firmadoEn: string;
  textoVersion: string;
  vigente: boolean;
  /** La firma es de un texto anterior al vigente (lo decide el servidor). */
  sugiereRefirmar?: boolean;
}

export type EstadoConsentimiento =
  | { tipo: "cargando" }
  | { tipo: "vigente"; consentimiento: ConsentimientoVigente }
  | { tipo: "sin" }
  | { tipo: "error" };

// La fecha de la firma sale de format.ts, como el resto de las fechas de la
// app: el Intl.DateTimeFormat("es-UY") que estaba acá escribía "setiembre"
// contra el "septiembre" de la agenda y de Cobros, y leía la zona del
// dispositivo en vez de la de Montevideo.

/**
 * El Badge NO se vuelve a montar cuando la ficha relee (antes llevaba como
 * `key` el contador de recargas de la ficha): el sheet de firma y la confirmación de Revocar viven
 * acá adentro, y un autoguardado de las notas privadas a mitad de una firma
 * los cerraba y se perdía lo que la paciente llevaba firmado (forense 03,
 * P3-20). El sheet se dibuja fuera de las ramas de estado por lo mismo: un
 * estado nuevo que llega mientras ella firma no lo desmonta.
 */
export function ConsentimientoBadge({
  pacienteId,
  nombrePaciente,
  nombreProfesional,
  direccionConsultorio,
  variante = "completo",
  estado,
  onCambio,
}: ConsentimientoBadgeProps) {
  const [sheetAbierto, setSheetAbierto] = React.useState(false);
  const [confirmandoRevocar, setConfirmandoRevocar] = React.useState(false);
  const [revocando, setRevocando] = React.useState(false);
  const [errorRevocar, setErrorRevocar] = React.useState(false);

  const handleFirmado = () => {
    setSheetAbierto(false);
    onCambio();
  };

  const handleRevocar = async () => {
    setRevocando(true);
    setErrorRevocar(false);
    try {
      await apiDelete(`/api/pacientes/${pacienteId}/consentimiento`);
      setConfirmandoRevocar(false);
      onCambio();
    } catch {
      setErrorRevocar(true);
    } finally {
      setRevocando(false);
    }
  };

  const abrirFirma = () => setSheetAbierto(true);

  return (
    <>
      {variante === "aviso"
        ? aviso(estado, abrirFirma)
        : completo(estado, {
            abrirFirma,
            confirmandoRevocar,
            setConfirmandoRevocar,
            revocando,
            errorRevocar,
            onRevocar: () => void handleRevocar(),
          })}
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
          onConsentimientoFirmado={handleFirmado}
          onCancelar={() => setSheetAbierto(false)}
        />
      </Sheet>
    </>
  );
}

/** Bajo la cabecera de la ficha: solo cuando falta la autorización. */
function aviso(estado: EstadoConsentimiento, abrirFirma: () => void): React.ReactNode {
  if (estado.tipo !== "sin") return null;
  return (
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
      <Button variant="primary" size="sm" onClick={abrirFirma} className="sm:shrink-0">
        {FIRMAR_AUTORIZACION}
      </Button>
    </div>
  );
}

interface AccionesCompleto {
  abrirFirma: () => void;
  confirmandoRevocar: boolean;
  setConfirmandoRevocar: (v: boolean) => void;
  revocando: boolean;
  errorRevocar: boolean;
  onRevocar: () => void;
}

/** La sección de la pestaña Datos: estado, fecha, Revocar o Firmar. */
function completo(estado: EstadoConsentimiento, a: AccionesCompleto): React.ReactNode {
  if (estado.tipo === "cargando") {
    return (
      <div
        role="status"
        aria-label="Verificando autorización"
        className="inline-flex items-center gap-2"
      >
        {/* D2: el pulso es `animate-pulse` y nada más. La regla de
            globals.css lo apaga con prefers-reduced-motion; un estilo inline
            acá la pisaría y el bloque seguiría latiendo. */}
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
            {!a.confirmandoRevocar ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => a.setConfirmandoRevocar(true)}
                className="text-terracotta-500 hover:bg-terracotta-50"
              >
                Revocar
              </Button>
            ) : null}
          </div>
          <span className="font-sans text-[12px] text-ink-500">
            Firmada el {fechaCompleta(firmadoEn)}
          </span>
        </div>
        {a.confirmandoRevocar ? (
          <Confirmar
            titulo="¿Revocar la autorización de grabación?"
            mensaje="Las próximas sesiones no se van a grabar. Lo ya grabado y sus notas se conservan."
            accion="Revocar"
            variante="peligro"
            enviando={a.revocando}
            enviandoLabel="Revocando…"
            onConfirmar={a.onRevocar}
            onCancelar={() => a.setConfirmandoRevocar(false)}
          />
        ) : null}
        {a.errorRevocar ? (
          <p role="alert" className="font-sans text-[13px] text-terracotta-600">{ALGO_FALLO}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip variant="neutral">{FALTA_AUTORIZACION}</Chip>
      <Button variant="secondary" size="sm" onClick={a.abrirFirma}>
        {FIRMAR_AUTORIZACION}
      </Button>
    </div>
  );
}
