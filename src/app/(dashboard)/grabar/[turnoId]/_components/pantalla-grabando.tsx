"use client";

// La pantalla mientras graba: el reloj, el medidor, los avisos de lo que pasa
// con el micrófono y la pantalla, y Pausar / Terminar / Descartar.

import { MicOff, Pause, Play, Square, Sun } from "lucide-react";

import {
  formatearDuracion,
  type AvisoHueco,
  type EstadoGrabador,
} from "@/components/grabacion/GrabadorSesion";
import { Button, Confirmar } from "@/components/ui";
import { Aparece, Latido } from "@/components/ui/movimiento";
import {
  AVISO_HUECO,
  AVISO_LIMITE_GRABACION,
  AVISO_MICROFONO_SILENCIADO,
  AVISO_PANTALLA_APAGADA,
  AVISO_SIN_AUDIO_DESDE,
  CORTE_LIMITE,
  EN_PAUSA,
  ENTENDIDO,
  GRABACION_TERMINO_MICROFONO,
  GUARDAR_LO_GRABADO,
  PAUSAR,
  REANUDAR,
  SEGUIR_GRABANDO,
  TERMINAR_SESION,
} from "@/lib/glosario";

import { MedidorAudio } from "./medidor-audio";
import { Aviso } from "./pantallas";

export function PantallaGrabando({
  estado,
  segundos,
  nivel,
  silencioso,
  microfonoSilenciado,
  hueco,
  pantallaApagada,
  avisoLimite,
  limiteAlcanzado,
  conmutando,
  confirmando,
  onPausar,
  onReanudar,
  onTerminar,
  onCerrarAvisoHueco,
  onCerrarAvisoPantalla,
  onPedirDescarte,
  onCancelarDescarte,
  onDescartar,
}: {
  estado: EstadoGrabador;
  segundos: number;
  nivel: number;
  silencioso: boolean;
  microfonoSilenciado: boolean;
  hueco: AvisoHueco | null;
  pantallaApagada: boolean;
  avisoLimite: boolean;
  limiteAlcanzado: boolean;
  conmutando: boolean;
  confirmando: boolean;
  onPausar: () => void;
  onReanudar: () => void;
  onTerminar: () => void;
  onCerrarAvisoHueco: () => void;
  onCerrarAvisoPantalla: () => void;
  onPedirDescarte: () => void;
  onCancelarDescarte: () => void;
  onDescartar: () => void;
}) {
  // El micrófono se fue: la grabación terminó y sólo queda guardarla.
  const terminada = estado === "terminada";

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {/* El punto respira solo mientras entra audio. En pausa se queda
          quieto y atenuado: que deje de moverse ES la confirmación de que
          la grabación está detenida, sin tener que leer la palabra. */}
      <div className="flex items-center gap-2">
        {estado === "grabando" ? (
          <Latido tamano={10} className="bg-[color:var(--color-error)]" />
        ) : (
          <span
            aria-hidden="true"
            className="inline-block h-[10px] w-[10px] shrink-0 rounded-full bg-ink-300"
          />
        )}
        <Aparece
          como="span"
          key={estado}
          className="font-sans text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500"
        >
          {estado === "grabando" ? "REC" : terminada ? "Terminada" : EN_PAUSA}
        </Aparece>
      </div>

      <p
        className="min-w-[8ch] text-center text-[52px] font-semibold leading-none tabular-nums text-ink-900"
        aria-label={`${Math.floor(segundos)} segundos grabados`}
      >
        {formatearDuracion(segundos)}
      </p>

      {terminada ? (
        <div role="alert" className="flex flex-col items-center gap-2">
          <MicOff
            size={20}
            strokeWidth={1.9}
            aria-hidden="true"
            className="text-[color:var(--color-error)]"
          />
          <p className="max-w-[340px] font-sans text-[14px] leading-[1.5] text-ink-700">
            {GRABACION_TERMINO_MICROFONO}
          </p>
        </div>
      ) : (
        <>
          <MedidorAudio nivel={nivel} silencioso={silencioso} />
          <div role="status" className="flex w-full flex-col gap-2 empty:hidden">
            {pantallaApagada ? (
              <Aviso
                icono={<Sun size={15} strokeWidth={1.8} aria-hidden="true" />}
                accion={ENTENDIDO}
                onAccion={onCerrarAvisoPantalla}
              >
                {AVISO_PANTALLA_APAGADA}
              </Aviso>
            ) : null}
            {hueco ? (
              hueco.hasta === null ? (
                <Aviso icono={<MicOff size={15} strokeWidth={1.8} aria-hidden="true" />}>
                  {AVISO_SIN_AUDIO_DESDE(hueco.desde)}
                </Aviso>
              ) : (
                <Aviso
                  icono={<MicOff size={15} strokeWidth={1.8} aria-hidden="true" />}
                  accion={SEGUIR_GRABANDO}
                  onAccion={onCerrarAvisoHueco}
                >
                  {AVISO_HUECO(hueco.desde, hueco.hasta)}
                </Aviso>
              )
            ) : null}
            {microfonoSilenciado ? (
              <Aviso icono={<MicOff size={15} strokeWidth={1.8} aria-hidden="true" />}>
                {AVISO_MICROFONO_SILENCIADO}
              </Aviso>
            ) : null}
            {limiteAlcanzado ? (
              <Aviso icono={<Square size={13} strokeWidth={2} aria-hidden="true" />}>
                {CORTE_LIMITE}
              </Aviso>
            ) : avisoLimite ? (
              <Aviso icono={<Square size={13} strokeWidth={2} aria-hidden="true" />}>
                {AVISO_LIMITE_GRABACION}
              </Aviso>
            ) : null}
          </div>
        </>
      )}

      {confirmando ? (
        <Confirmar
          className="w-full text-left"
          titulo="¿Descartar la grabación?"
          mensaje="Se borra el audio de este teléfono. No se puede recuperar."
          accion="Descartar"
          variante="peligro"
          onConfirmar={onDescartar}
          onCancelar={onCancelarDescarte}
        />
      ) : (
        <>
          <div className="flex w-full flex-col gap-3 sm:flex-row">
            {terminada || limiteAlcanzado ? null : estado === "pausado" ? (
              <Button
                className="flex-1"
                onClick={onReanudar}
                disabled={conmutando}
                icon={<Play size={16} strokeWidth={1.8} aria-hidden="true" />}
              >
                {REANUDAR}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="flex-1"
                onClick={onPausar}
                disabled={conmutando}
                icon={<Pause size={16} strokeWidth={1.8} aria-hidden="true" />}
              >
                {PAUSAR}
              </Button>
            )}

            <Button
              className="flex-1"
              onClick={onTerminar}
              icon={<Square size={15} strokeWidth={2} aria-hidden="true" />}
            >
              {terminada ? GUARDAR_LO_GRABADO : TERMINAR_SESION}
            </Button>
          </div>

          <button
            type="button"
            onClick={onPedirDescarte}
            className="font-sans text-[13px] text-ink-500 underline underline-offset-4 transition-colors duration-150 hover:text-terracotta-600"
          >
            Descartar grabación
          </button>
        </>
      )}

      {/* El 7/9 y el 18/9 el teléfono se bloqueó a mitad de sesión y dejó de
          entregar audio sin avisar. La app pide mantener la pantalla
          encendida, pero el teléfono puede no hacer caso: se le dice a ella. */}
      <p className="max-w-[320px] font-sans text-[13px] leading-[1.55] text-ink-500">
        Dejá la pantalla encendida mientras grabás.
      </p>
    </div>
  );
}
