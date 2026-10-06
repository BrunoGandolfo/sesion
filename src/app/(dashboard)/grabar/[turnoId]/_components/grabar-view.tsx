"use client";

// Capa visual de la grabación: arma la pantalla que toca con lo que le da
// useFlujoGrabacion (flujo-grabacion.ts), que es quien conversa con la API y
// con el grabador. Las pantallas viven en pantallas.tsx y
// pantalla-grabando.tsx.
//
// Después de Terminar siempre hay algo que se mueve y un texto que dice en
// qué está. La pantalla no navega sola: que desapareciera a los 1,6 segundos
// se leía como "no subió".

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { AvisoPrueba } from "@/components/layout/aviso-prueba";
import { Toast } from "@/components/ui";
import type { EstadoPrueba } from "@/lib/limites-prueba";
import {
  ALGO_FALLO,
  AUDIO_NO_GUARDADO,
  TURNO_NO_MARCADO,
  VOLVER,
} from "@/lib/glosario";

import { pantallaDe, useFlujoGrabacion } from "./flujo-grabacion";
import { PantallaGrabando } from "./pantalla-grabando";
import {
  PantallaConReintento,
  PantallaEnviando,
  PantallaErrorMicrofono,
  PantallaLlego,
  PantallaPrevia,
  PantallaRechazada,
} from "./pantallas";

export { pantallaDe, type Fase, type Pantalla } from "./flujo-grabacion";

interface GrabarViewProps {
  /** null cuando la ruta es /grabar/nuevo?pacienteId=… */
  turnoId: string | null;
  /** Por qué este turno no se puede grabar (otro día, cancelado), o null.
   *  Lo decide la página con la regla del servidor. */
  motivoSinGrabar?: string | null;
  /** El turno pasa a "realizado" al confirmar la subida solo si venía así. */
  turnoProgramado: boolean;
  horaTexto: string | null;
  pacienteId: string;
  pacienteNombre: string;
  autorizacionVigente: boolean;
  /** Consultorio creado por invitación: cuántas grabaciones lleva. null en
   *  la cuenta de quien invita. */
  prueba?: EstadoPrueba | null;
}

export function GrabarView({
  turnoId,
  motivoSinGrabar = null,
  turnoProgramado,
  horaTexto: horaInicial,
  pacienteId,
  pacienteNombre,
  autorizacionVigente,
  prueba = null,
}: GrabarViewProps) {
  const router = useRouter();
  const [confirmarDescarte, setConfirmarDescarte] = React.useState(false);
  const toast = useToast();
  const {
    horaTexto,
    fase,
    progreso,
    errorPantalla,
    grabador,
    pantalla,
    enCursoAhora,
    enviandoAhora,
    empezar,
    enviarPendiente,
    reintentarSubida,
    reintentarMarcarRealizado,
    reintentarMicrofono,
  } = useFlujoGrabacion({
    turnoId,
    turnoProgramado,
    horaTexto: horaInicial,
    pacienteId,
    avisar: toast.avisar,
  });

  function descartar() {
    setConfirmarDescarte(false);
    grabador.descartar();
    router.push(`/pacientes/${pacienteId}`);
  }

  // En el tope de la prueba no se inicia una grabación nueva; el servidor lo
  // rechaza igual (403). Una pendiente sí se puede enviar: ya está contada.
  const sinCupo = prueba?.restantes === 0;
  const volver = () => router.push(`/pacientes/${pacienteId}`);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-80px)] w-full max-w-[560px] flex-col px-5 py-6 lg:py-10">
      {!enCursoAhora && !enviandoAhora && fase !== "guardado" ? (
        <Link
          href={`/pacientes/${pacienteId}`}
          className="mb-6 inline-flex items-center gap-1 self-start text-[13px] text-ink-500 transition-colors duration-150 hover:text-ink-700"
        >
          <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
          <span>{VOLVER}</span>
        </Link>
      ) : null}

      <AvisoPrueba prueba={prueba} className="mb-6" />

      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <header className="space-y-1">
          <h1 className="font-display text-[28px] leading-tight text-ink-900">
            {pacienteNombre}
          </h1>
          {horaTexto ? (
            <p className="text-[14px] tabular-nums text-ink-500">
              {horaTexto}
            </p>
          ) : null}
        </header>

        {(() => {
          switch (pantallaDe(fase, grabador.estado)) {
            case "enviando":
              return (
                <PantallaEnviando
                  progreso={fase === "enviando" ? (progreso ?? 0) : null}
                  pantallaApagada={pantalla.seApago}
                  onCerrarAvisoPantalla={pantalla.cerrarAviso}
                />
              );
            case "llego":
              return <PantallaLlego onVolver={volver} />;
            case "reintentar-subida":
              return (
                <PantallaConReintento
                  mensaje={errorPantalla ?? AUDIO_NO_GUARDADO}
                  onReintentar={reintentarSubida}
                />
              );
            case "reintentar-turno":
              return (
                <PantallaConReintento
                  mensaje={errorPantalla ?? TURNO_NO_MARCADO}
                  onReintentar={() => void reintentarMarcarRealizado()}
                />
              );
            case "rechazada":
              return <PantallaRechazada mensaje={errorPantalla ?? ALGO_FALLO} onVolver={volver} />;
            case "grabando":
              return (
                <PantallaGrabando
                  estado={grabador.estado}
                  segundos={grabador.segundos}
                  nivel={grabador.nivelAudio}
                  silencioso={grabador.audioSilencioso}
                  microfonoSilenciado={grabador.microfonoSilenciado}
                  hueco={grabador.hueco}
                  pantallaApagada={pantalla.seApago}
                  avisoLimite={grabador.avisoLimite}
                  limiteAlcanzado={grabador.limiteAlcanzado}
                  conmutando={grabador.conmutando}
                  confirmando={confirmarDescarte}
                  onPausar={grabador.pausar}
                  onReanudar={grabador.reanudar}
                  onTerminar={grabador.terminar}
                  onCerrarAvisoHueco={grabador.cerrarAvisoHueco}
                  onCerrarAvisoPantalla={pantalla.cerrarAviso}
                  onPedirDescarte={() => setConfirmarDescarte(true)}
                  onCancelarDescarte={() => setConfirmarDescarte(false)}
                  onDescartar={descartar}
                />
              );
            case "error-mic":
              return (
                <PantallaErrorMicrofono
                  mensaje={grabador.mensajeError ?? ALGO_FALLO}
                  onReintentar={reintentarMicrofono}
                />
              );
            case "previa":
              return (
                <PantallaPrevia
                  autorizacionVigente={autorizacionVigente}
                  motivoSinGrabar={motivoSinGrabar}
                  pacienteId={pacienteId}
                  preparando={fase === "preparando"}
                  sinCupo={sinCupo}
                  sinPantallaEncendida={pantalla.estado === "rechazada"}
                  muyCorta={grabador.muyCorta}
                  pendienteMinutos={
                    grabador.pendienteSeg !== null
                      ? Math.max(1, Math.round(grabador.pendienteSeg / 60))
                      : null
                  }
                  onEmpezar={() => void empezar()}
                  onEnviarPendiente={() => void enviarPendiente()}
                  onDescartarPendiente={grabador.descartarPendiente}
                />
              );
          }
        })()}
      </div>

      <Toast {...toast.props} />
    </div>
  );
}
