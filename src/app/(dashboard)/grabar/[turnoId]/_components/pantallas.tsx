"use client";

// Las pantallas de /grabar/[turnoId], una por momento de la grabación. Sin
// estado ni red: reciben lo que muestran y avisan lo que se toca. Cuál toca
// lo decide pantallaDe (flujo-grabacion.ts); la que graba vive aparte, en
// pantalla-grabando.tsx.

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, Mic, MicOff, Sun } from "lucide-react";

import { Button } from "@/components/ui";
import { AnilloProgreso, Aparece } from "@/components/ui/movimiento";
import {
  AVISO_PANTALLA_APAGADA,
  AVISO_SIN_PANTALLA_ENCENDIDA,
  ENTENDIDO,
  ENVIANDO_GRABACION,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
  GRABACION_LLEGO,
  GRABACION_MUY_CORTA,
  GRABAR_SESION,
  PREPARANDO_GRABACION,
  REINTENTAR,
  VOLVER_A_LA_FICHA,
} from "@/lib/glosario";

/** Una grabación que quedó en el teléfono sin enviar. */
function OfertaPendiente({ minutos, onEnviar, onDescartar }: { minutos: number; onEnviar: () => void; onDescartar: () => void }) {
  return (
    <div className="w-full rounded-md border border-[color:var(--border-subtle)] bg-cream-100 px-4 py-4 text-left">
      <p className="font-sans text-[14px] font-semibold text-ink-900">
        Quedó una grabación de ~{minutos} min sin enviar
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button className="flex-1" onClick={onEnviar}>
          Guardarla ahora
        </Button>
        <Button variant="secondary" onClick={onDescartar}>
          Descartarla
        </Button>
      </div>
    </div>
  );
}

export function PantallaPrevia({
  autorizacionVigente,
  motivoSinGrabar,
  pacienteId,
  preparando,
  sinCupo,
  sinPantallaEncendida,
  muyCorta,
  pendienteMinutos,
  onEmpezar,
  onEnviarPendiente,
  onDescartarPendiente,
}: {
  autorizacionVigente: boolean;
  motivoSinGrabar: string | null;
  pacienteId: string;
  preparando: boolean;
  /** Tope de grabaciones de la prueba alcanzado: Grabar sesión apagado. */
  sinCupo: boolean;
  /** El teléfono no concedió el wake lock: se dice ANTES de empezar. */
  sinPantallaEncendida: boolean;
  /** Se acaba de descartar un toque accidental: se dice, y se puede grabar. */
  muyCorta: boolean;
  pendienteMinutos: number | null;
  onEmpezar: () => void;
  onEnviarPendiente: () => void;
  onDescartarPendiente: () => void;
}) {
  if (motivoSinGrabar) {
    // El motivo es para una grabación NUEVA. Una que ya quedó guardada en el
    // teléfono se ofrece igual: la sesión nace al subir, así que la de un
    // turno de ayer que no llegó a subir no tiene sesión que la deje pasar,
    // y el servidor la acepta por su inicio (plazo-grabacion.ts).
    return (
      <div className="flex w-full flex-col items-center gap-4">
        {pendienteMinutos !== null ? (
          <OfertaPendiente
            minutos={pendienteMinutos}
            onEnviar={onEnviarPendiente}
            onDescartar={onDescartarPendiente}
          />
        ) : null}
        <p className="max-w-[340px] font-sans text-[15px] leading-[1.55] text-ink-900">
          {motivoSinGrabar}
        </p>
        <Button asChild variant="secondary">
          <Link href={`/pacientes/${pacienteId}`}>{VOLVER_A_LA_FICHA}</Link>
        </Button>
      </div>
    );
  }

  if (!autorizacionVigente) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="font-display text-[20px] text-ink-900">
          {FALTA_AUTORIZACION}
        </p>
        <Button asChild variant="secondary">
          <Link href={`/pacientes/${pacienteId}`}>{FIRMAR_AUTORIZACION}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {muyCorta ? (
        <p role="status" className="font-sans text-[15px] font-semibold text-ink-900">
          {GRABACION_MUY_CORTA}
        </p>
      ) : null}
      {pendienteMinutos !== null ? (
        <OfertaPendiente
          minutos={pendienteMinutos}
          onEnviar={onEnviarPendiente}
          onDescartar={onDescartarPendiente}
        />
      ) : null}

      <button
        type="button"
        onClick={onEmpezar}
        disabled={preparando || sinCupo}
        className="inline-flex h-[132px] w-[132px] flex-col items-center justify-center gap-2 rounded-full bg-sage-500 text-white shadow-raised transition-colors duration-150 hover:bg-sage-600 active:bg-sage-700 disabled:opacity-60 focus:outline-none focus:ring-[3px] focus:ring-sage-500/30"
      >
        {preparando ? (
          <Loader2
            size={32}
            strokeWidth={1.8}
            aria-hidden="true"
            className="animate-spin"
          />
        ) : (
          <Mic size={32} strokeWidth={1.8} aria-hidden="true" />
        )}
        <span className="font-sans text-[15px] font-semibold leading-tight">
          {GRABAR_SESION}
        </span>
      </button>

      {sinPantallaEncendida ? (
        <div role="status" className="w-full">
          <Aviso icono={<Sun size={15} strokeWidth={1.8} aria-hidden="true" />}>
            {AVISO_SIN_PANTALLA_ENCENDIDA}
          </Aviso>
        </div>
      ) : null}
    </div>
  );
}

/** Un aviso persistente. Con `accion`, queda hasta que ella lo cierra. */
export function Aviso({
  icono,
  children,
  accion,
  onAccion,
}: {
  icono: React.ReactNode;
  children: React.ReactNode;
  accion?: string;
  onAccion?: () => void;
}) {
  return (
    <div className="flex w-full items-start gap-2 rounded-md border border-[color:var(--border-subtle)] bg-cream-100 px-3 py-2 text-left">
      <span className="mt-[2px] shrink-0 text-ink-500">{icono}</span>
      <div className="flex flex-col items-start gap-1">
        <p className="font-sans text-[13px] leading-[1.45] text-ink-700">
          {children}
        </p>
        {accion && onAccion ? (
          <button
            type="button"
            onClick={onAccion}
            className="min-h-8 font-sans text-[13px] font-semibold text-sage-700 underline underline-offset-4"
          >
            {accion}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Después de Terminar. Tapa toda la pantalla, menú inferior incluido: mientras
// la grabación viaja no hay adónde ir, y tocar el menú sin querer la cortaba.
// Siempre hay algo que se mueve: una pantalla quieta se lee como "se colgó".
export function PantallaEnviando({
  progreso,
  pantallaApagada,
  onCerrarAvisoPantalla,
}: {
  /** null mientras se prepara el archivo; 0-100 mientras viaja. */
  progreso: number | null;
  pantallaApagada: boolean;
  onCerrarAvisoPantalla: () => void;
}) {
  const texto = progreso === null ? PREPARANDO_GRABACION : ENVIANDO_GRABACION(progreso);

  return (
    <div
      data-testid="enviando"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-cream-50 px-6 text-center"
    >
      <span className="gira-procesando inline-flex text-sage-500">
        <AnilloProgreso tamano={34} />
      </span>
      <p role="status" aria-live="polite" className="max-w-[320px] font-sans tabular-nums text-[16px] font-semibold leading-[1.45] text-ink-900">
        {texto}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progreso ?? undefined}
        aria-label={texto}
        className="h-[6px] w-full max-w-[280px] overflow-hidden rounded-full bg-cream-200"
      >
        <div
          className="h-full rounded-full bg-sage-500 transition-[width] duration-200"
          style={{ width: `${Math.max(progreso ?? 0, 4)}%` }}
        />
      </div>
      {pantallaApagada ? (
        <div className="w-full max-w-[340px]">
          <Aviso
            icono={<Sun size={15} strokeWidth={1.8} aria-hidden="true" />}
            accion={ENTENDIDO}
            onAccion={onCerrarAvisoPantalla}
          >
            {AVISO_PANTALLA_APAGADA}
          </Aviso>
        </div>
      ) : null}
    </div>
  );
}

// La grabación llegó. La pantalla se queda acá hasta que ella decida irse.
export function PantallaLlego({ onVolver }: { onVolver: () => void }) {
  return (
    <Aparece className="flex w-full flex-col items-center gap-5">
      <Check size={30} strokeWidth={2} aria-hidden="true" className="text-sage-600" />
      <p role="status" className="max-w-[340px] font-sans text-[16px] font-semibold leading-[1.5] text-ink-900">
        {GRABACION_LLEGO}
      </p>
      <Button className="w-full sm:w-auto" onClick={onVolver}>
        {VOLVER_A_LA_FICHA}
      </Button>
    </Aparece>
  );
}

// Un mensaje y un botón para volver a intentar. Lo usan los dos fallos que
// no pierden nada: la subida del audio y el turno que no quedó realizado.
export function PantallaConReintento({
  mensaje,
  onReintentar,
}: {
  mensaje: string;
  onReintentar: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <p className="max-w-[340px] font-sans text-[15px] leading-[1.55] text-ink-900">
        {mensaje}
      </p>
      <Button className="w-full sm:w-auto" onClick={onReintentar}>
        {REINTENTAR}
      </Button>
    </div>
  );
}

/** Una subida que el servidor no va a aceptar: sin Reintentar. */
export function PantallaRechazada({ mensaje, onVolver }: { mensaje: string; onVolver: () => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <p role="alert" className="max-w-[340px] font-sans text-[15px] leading-[1.55] text-ink-900">
        {mensaje}
      </p>
      <Button className="w-full sm:w-auto" onClick={onVolver}>
        {VOLVER_A_LA_FICHA}
      </Button>
    </div>
  );
}

export function PantallaErrorMicrofono({
  mensaje,
  onReintentar,
}: {
  mensaje: string;
  onReintentar: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <MicOff
        size={24}
        strokeWidth={1.9}
        aria-hidden="true"
        className="text-[color:var(--color-error)]"
      />
      <p className="max-w-[340px] font-sans text-[15px] leading-[1.55] text-ink-900">
        {mensaje}
      </p>
      <Button variant="secondary" onClick={onReintentar}>
        Probá de nuevo
      </Button>
    </div>
  );
}
