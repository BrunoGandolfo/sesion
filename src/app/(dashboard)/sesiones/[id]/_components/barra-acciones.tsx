"use client";

import * as React from "react";

import { Button, Confirmar } from "@/components/ui";

import {
  APROBANDO,
  APROBAR_MENSAJE,
  APROBAR_NOTA,
  APROBAR_TITULO,
  DESCARTANDO,
  DESCARTAR,
  DESCARTAR_MENSAJE,
  DESCARTAR_TITULO,
  FALTA_REVISAR_RIESGO,
} from "./textos";

// Barra fija de la nota en revisión: las dos únicas acciones que cierran la
// pantalla, siempre a la vista, sin scrollear hasta el final de una nota
// larga.
//
// Se apoya por encima del menú de abajo (BottomNav es fixed y mide ~64px en
// mobile; en desktop no existe y la barra baja a 0). Quien la usa agrega el
// padding inferior en el contenido para que la barra no tape la última
// sección.
//
// "Aprobar nota" está deshabilitado hasta que todas las casillas de riesgo
// estén marcadas. La razón se dice arriba del botón, no se deja adivinar.

interface BarraAccionesProps {
  /** false mientras falte marcar alguna casilla de señal de riesgo. */
  puedeAprobar: boolean;
  enviando: boolean;
  onAprobar: () => void;
  onDescartar: () => void;
}

type Pendiente = "aprobar" | "descartar" | null;

export function BarraAcciones({
  puedeAprobar,
  enviando,
  onAprobar,
  onDescartar,
}: BarraAccionesProps) {
  const [pendiente, setPendiente] = React.useState<Pendiente>(null);

  return (
    <div className="fixed inset-x-0 bottom-[64px] z-40 border-t border-[color:var(--border-subtle)] bg-cream-50/95 backdrop-blur lg:bottom-0">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-3 px-5 py-3 lg:px-10">
        {pendiente === "descartar" ? (
          <Confirmar
            titulo={DESCARTAR_TITULO}
            mensaje={DESCARTAR_MENSAJE}
            accion={DESCARTAR}
            variante="peligro"
            enviando={enviando}
            enviandoLabel={DESCARTANDO}
            onConfirmar={onDescartar}
            onCancelar={() => setPendiente(null)}
          />
        ) : null}

        {pendiente === "aprobar" ? (
          <Confirmar
            titulo={APROBAR_TITULO}
            mensaje={APROBAR_MENSAJE}
            accion={APROBAR_NOTA}
            variante="peligro"
            enviando={enviando}
            enviandoLabel={APROBANDO}
            onConfirmar={onAprobar}
            onCancelar={() => setPendiente(null)}
          />
        ) : null}

        {!puedeAprobar && pendiente === null ? (
          <p className="font-sans text-[13px] leading-[1.5] text-terracotta-600">
            {FALTA_REVISAR_RIESGO}
          </p>
        ) : null}

        {pendiente === null ? (
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={() => setPendiente("descartar")}
              disabled={enviando}
              className="!text-terracotta-500"
            >
              {DESCARTAR}
            </Button>
            <Button
              variant="primary"
              onClick={() => setPendiente("aprobar")}
              disabled={enviando || !puedeAprobar}
              aria-disabled={enviando || !puedeAprobar}
              className="flex-1 sm:flex-none"
            >
              {APROBAR_NOTA}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
