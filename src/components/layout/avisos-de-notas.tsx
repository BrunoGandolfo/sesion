"use client";

// El aviso de "la nota está lista", en cualquier pantalla del panel.
//
// Vive en el layout del panel, así que no se desmonta al navegar: ella puede
// estar en la agenda, en cobros o en otra ficha, y el aviso aparece igual.
// Qué seguir y cuándo avisar lo decide src/lib/notas-en-proceso.ts; acá está
// la consulta periódica (solo mientras haya algo en proceso) y el dibujo.
//
// El aviso NO se va solo. Una nota que espera revisión es trabajo pendiente y
// ella mira el teléfono entre paciente y paciente: un cartel que se borra a
// los tres segundos es un cartel que no vio. Se va cuando toca Revisar o la
// cruz.
//
// POSICIÓN
//
// Abajo, a la misma altura que el Toast (ver ui/toast.tsx): por encima del
// menú de abajo y del "+" flotante, nunca sobre ellos. Arriba taparía el
// botón Agendar de Hoy y el de la agenda. En escritorio, abajo a la derecha.

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { Button } from "@/components/ui";
import { Aparece } from "@/components/ui/movimiento";
import { apiGet } from "@/lib/api-client";
import {
  CERRAR_AVISO,
  NOTA_FALLIDA_DETALLE,
  REVISAR,
  VER_QUE_PASO,
  notaFallidaDe,
  notaListaDe,
} from "@/lib/glosario";
import {
  INTERVALO_CONSULTA_MS,
  SEGUIMIENTO_VACIO,
  actualizarSeguimiento,
  aplicarEstado,
  cerrarAviso,
  hayQueConsultar,
  obtenerSeguimiento,
  suscribirSeguimiento,
  type AvisoNota,
} from "@/lib/notas-en-proceso";
import type { EstadoSesion } from "@/lib/sesion-clinica/schema";

type SesionDelTurno = { id: string; estado: EstadoSesion } | null;

/** Una vuelta: pregunta por cada sesión seguida y aplica lo que contesta. Un
 *  error de red deja la sesión como estaba: se vuelve a preguntar después. */
async function consultarUnaVez(): Promise<void> {
  for (const nota of obtenerSeguimiento().seguidas) {
    try {
      const fila = await apiGet<SesionDelTurno>(
        `/api/sesion-clinica?turnoId=${encodeURIComponent(nota.turnoId)}`,
      );
      const estado = fila && fila.id === nota.sesionId ? fila.estado : null;
      actualizarSeguimiento((s) => aplicarEstado(s, nota.sesionId, estado));
    } catch {
      // Sin red o sesión vencida: la próxima vuelta lo intenta de nuevo.
    }
  }
}

export function useSeguimientoNotas() {
  return React.useSyncExternalStore(
    suscribirSeguimiento,
    obtenerSeguimiento,
    () => SEGUIMIENTO_VACIO,
  );
}

export function AvisosDeNotas() {
  const seguimiento = useSeguimientoNotas();
  const consultar = hayQueConsultar(seguimiento);

  React.useEffect(() => {
    if (!consultar) return;

    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const vuelta = async () => {
      // Con la pantalla apagada o en otra app no se pregunta: se agenda la
      // próxima y al volver se entera en la vuelta siguiente.
      if (document.visibilityState === "visible") await consultarUnaVez();
      if (vivo && hayQueConsultar(obtenerSeguimiento())) {
        timer = setTimeout(() => void vuelta(), INTERVALO_CONSULTA_MS);
      }
    };

    timer = setTimeout(() => void vuelta(), INTERVALO_CONSULTA_MS);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [consultar]);

  if (seguimiento.avisos.length === 0) return null;

  return (
    <div className="fixed inset-x-4 bottom-[160px] z-40 flex flex-col gap-2 lg:inset-x-auto lg:bottom-[104px] lg:right-8 lg:w-[380px]">
      {seguimiento.avisos.map((aviso) => (
        <AvisoDeNota key={aviso.sesionId} aviso={aviso} />
      ))}
    </div>
  );
}

function AvisoDeNota({ aviso }: { aviso: AvisoNota }) {
  const cerrar = () =>
    actualizarSeguimiento((s) => cerrarAviso(s, aviso.sesionId));
  const lista = aviso.tipo === "lista";

  return (
    <Aparece>
      <div
        role={lista ? "status" : "alert"}
        className={`flex items-start gap-3 rounded-md border bg-white p-4 shadow-raised ${
          lista
            ? "border-sage-200"
            : "border-[color:var(--color-error)]"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="font-sans text-[15px] font-semibold leading-snug text-ink-900">
            {lista ? notaListaDe(aviso.paciente) : notaFallidaDe(aviso.paciente)}
          </p>
          {lista ? null : (
            <p className="mt-1 font-sans text-[13px] leading-snug text-ink-700">
              {NOTA_FALLIDA_DETALLE}
            </p>
          )}
          <Button
            asChild
            size="sm"
            variant={lista ? "primary" : "secondary"}
            className="mt-3"
          >
            <Link href={`/sesiones/${aviso.sesionId}`} onClick={cerrar}>
              {lista ? REVISAR : VER_QUE_PASO}
            </Link>
          </Button>
        </div>
        <button
          type="button"
          onClick={cerrar}
          aria-label={CERRAR_AVISO}
          className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-500 hover:text-ink-900"
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </Aparece>
  );
}
