"use client";

// La grabación que quedó en el teléfono sin enviar, en la pantalla previa de
// /grabar (PantallaPrevia, pantallas.tsx): qué se ofrece hacer con ella según
// sea de este turno o de otro y haya o no autorización. Descartarla siempre
// pide confirmación.

import * as React from "react";
import Link from "next/link";

import { Button, Confirmar } from "@/components/ui";
import {
  DESCARTAR_PENDIENTE_ACCION,
  DESCARTAR_PENDIENTE_MENSAJE,
  DESCARTAR_PENDIENTE_TITULO,
  DESCARTAR_Y_GRABAR,
  DESCARTAR_Y_GRABAR_ACCION,
  DESCARTAR_Y_GRABAR_MENSAJE,
  DESCARTAR_Y_GRABAR_TITULO,
  ENVIAR_LA_QUE_QUEDO,
  FIRMAR_AUTORIZACION,
  PENDIENTE_SIN_AUTORIZACION,
} from "@/lib/glosario";

/** Una grabación que quedó en el teléfono sin enviar, con lo que se puede
 *  hacer con ella. */
export function OfertaPendiente({ minutos, children }: { minutos: number; children: React.ReactNode }) {
  return (
    <div className="w-full rounded-md border border-[color:var(--border-subtle)] bg-cream-100 px-4 py-4 text-left">
      <p className="font-sans text-[14px] font-semibold text-ink-900">
        Quedó una grabación de ~{minutos} min sin enviar
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const FILA_DE_ACCIONES = "flex flex-col gap-2 sm:flex-row";

/** Descartarla borra la copia para siempre, sea del turno que sea: pide
 *  confirmación, y mientras tanto ocupa el lugar de la fila de botones. */
function ConDescarteConfirmado({
  onDescartar,
  children,
}: {
  onDescartar: () => void;
  children: (pedirDescarte: () => void) => React.ReactNode;
}) {
  const [confirmando, setConfirmando] = React.useState(false);
  if (confirmando) {
    return (
      <Confirmar
        titulo={DESCARTAR_PENDIENTE_TITULO}
        mensaje={DESCARTAR_PENDIENTE_MENSAJE}
        accion={DESCARTAR_PENDIENTE_ACCION}
        variante="peligro"
        onConfirmar={() => {
          setConfirmando(false);
          onDescartar();
        }}
        onCancelar={() => setConfirmando(false)}
      />
    );
  }
  return <>{children(() => setConfirmando(true))}</>;
}

/** Guardarla o descartarla: grabar no la toca. */
export function AccionesPendiente({ onEnviar, onDescartar }: { onEnviar: () => void; onDescartar: () => void }) {
  return (
    <ConDescarteConfirmado onDescartar={onDescartar}>
      {(pedirDescarte) => (
        <div className={FILA_DE_ACCIONES}>
          <Button className="flex-1" onClick={onEnviar}>
            Guardarla ahora
          </Button>
          <Button variant="secondary" onClick={pedirDescarte}>
            Descartarla
          </Button>
        </div>
      )}
    </ConDescarteConfirmado>
  );
}

/** Es de este mismo turno: grabar de nuevo la borra. No hay un Grabar suelto
 *  que la pise sin querer (forense2 H2): o se envía, o se descarta para
 *  grabar de nuevo, con confirmación. */
export function EnviarODescartarYGrabar({
  deshabilitarGrabar,
  onEnviar,
  onDescartarYGrabar,
}: {
  deshabilitarGrabar: boolean;
  onEnviar: () => void;
  onDescartarYGrabar: () => void;
}) {
  const [confirmando, setConfirmando] = React.useState(false);
  if (confirmando) {
    return (
      <Confirmar
        titulo={DESCARTAR_Y_GRABAR_TITULO}
        mensaje={DESCARTAR_Y_GRABAR_MENSAJE}
        accion={DESCARTAR_Y_GRABAR_ACCION}
        variante="peligro"
        onConfirmar={() => {
          setConfirmando(false);
          onDescartarYGrabar();
        }}
        onCancelar={() => setConfirmando(false)}
      />
    );
  }
  return (
    <div className={FILA_DE_ACCIONES}>
      <Button className="flex-1" onClick={onEnviar}>
        {ENVIAR_LA_QUE_QUEDO}
      </Button>
      <Button variant="secondary" onClick={() => setConfirmando(true)} disabled={deshabilitarGrabar}>
        {DESCARTAR_Y_GRABAR}
      </Button>
    </div>
  );
}

/** Sin autorización vigente la copia se muestra igual, pero para enviarla
 *  primero se firma (forense2 H1). */
export function OfertaSinAutorizacion({
  minutos,
  pacienteId,
  onDescartar,
}: {
  minutos: number;
  pacienteId: string;
  onDescartar: () => void;
}) {
  return (
    <OfertaPendiente minutos={minutos}>
      <p className="mb-3 font-sans text-[13px] leading-[1.5] text-ink-700">
        {PENDIENTE_SIN_AUTORIZACION}
      </p>
      <ConDescarteConfirmado onDescartar={onDescartar}>
        {(pedirDescarte) => (
          <div className={FILA_DE_ACCIONES}>
            <Button asChild className="flex-1">
              <Link href={`/pacientes/${pacienteId}`}>{FIRMAR_AUTORIZACION}</Link>
            </Button>
            <Button variant="secondary" onClick={pedirDescarte}>
              Descartarla
            </Button>
          </div>
        )}
      </ConDescarteConfirmado>
    </OfertaPendiente>
  );
}
