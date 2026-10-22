"use client";

// Lo que se ve cuando la app se abre sin señal. El service worker sirve esta
// pantalla en lugar de la que se pidió, sin cambiar la dirección: por eso se
// lee `location.pathname` y no la ruta de Next.
//
//   /grabar/<turnoId>  → el grabador de siempre (grabar-view.tsx) con el
//                        turno de la agenda local y su flujo sin conexión:
//                        la grabación queda en el teléfono y, con señal, se
//                        envía al tocar Reintentar (no sale sola).
//   cualquier otra     → los turnos de hoy guardados en el teléfono, cada uno
//                        con su botón Grabar.
//
// La autorización de la paciente no está en la agenda local (sólo guarda
// turno, paciente, nombre, fecha y hora): sin señal se deja grabar, y al
// subir el servidor la exige como siempre (POST /api/sesion-clinica). Si
// falta, la pantalla lo dice y la grabación sigue en el teléfono.
//
// Esta pantalla no está dentro del dashboard (providers.tsx), así que trae
// su propia ProteccionTrabajo: sin ella, el aviso de salida del grabador
// (useProtegerTrabajo) no tiene a quién registrarse.

import * as React from "react";
import { Mic } from "lucide-react";

import { GrabarView } from "@/app/(dashboard)/grabar/[turnoId]/_components/grabar-view";
import { ProteccionTrabajo } from "@/components/layout/proteccion-trabajo";
import { Button } from "@/components/ui";
import { buscarTurnoLocal, diasQueSeGuardan, turnosLocalesDeHoy, type TurnoLocal } from "@/lib/agenda-local";
import {
  GRABAR,
  SIN_CONEXION_AVISO,
  SIN_CONEXION_FRANJA,
  SIN_CONEXION_FRANJA_SIN_COPIA,
  SIN_CONEXION_PROBAR,
  SIN_CONEXION_SIN_TURNOS,
  SIN_CONEXION_TITULO,
  SIN_CONEXION_TURNO_NO_GUARDADO,
  SIN_CONEXION_TURNO_OTRO_DIA,
} from "@/lib/glosario";

type Vista =
  | { tipo: "cargando" }
  | { tipo: "grabar"; turno: TurnoLocal; esDeHoy: boolean }
  | { tipo: "agenda"; turnos: TurnoLocal[]; turnoNoGuardado: boolean };

/** El turno de una dirección /grabar/<turnoId>, o null. `/grabar/nuevo`
 *  (grabar sin turno) necesita la ficha, que no está guardada. */
export function turnoDeLaRuta(ruta: string): string | null {
  const partes = /^\/grabar\/([^/]+)\/?$/.exec(ruta);
  if (!partes || partes[1] === "nuevo") return null;
  return decodeURIComponent(partes[1]);
}

async function leerVista(ruta: string, ahora: Date): Promise<Vista> {
  const turnoId = turnoDeLaRuta(ruta);
  if (turnoId) {
    const turno = await buscarTurnoLocal(turnoId, ahora);
    if (turno) return { tipo: "grabar", turno, esDeHoy: turno.fecha === diasQueSeGuardan(ahora)[0] };
  }
  return { tipo: "agenda", turnos: await turnosLocalesDeHoy(ahora), turnoNoGuardado: turnoId !== null };
}

/** Sin copia en el teléfono (cuota llena, modo privado) la franja no promete
 *  que la grabación queda ahí. */
function Franja({ copiaFallida }: { copiaFallida: boolean }) {
  return (
    <p role="status" className="border-b border-[color:var(--border-subtle)] bg-cream-100 px-4 py-2 text-center text-[13px] leading-[1.5] text-ink-700">
      {copiaFallida ? SIN_CONEXION_FRANJA_SIN_COPIA : SIN_CONEXION_FRANJA}
    </p>
  );
}

export function SinConexion({ reloj = () => new Date() }: { reloj?: () => Date }) {
  const [vista, setVista] = React.useState<Vista>({ tipo: "cargando" });
  const [copiaFallida, setCopiaFallida] = React.useState(false);

  React.useEffect(() => {
    let vigente = true;
    void leerVista(window.location.pathname, reloj()).then((siguiente) => {
      if (vigente) setVista(siguiente);
    });
    return () => {
      vigente = false;
    };
    // El reloj se lee una vez, al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (vista.tipo === "cargando") return <div className="min-h-dvh bg-cream-50" />;

  if (vista.tipo === "grabar") {
    const { turno, esDeHoy } = vista;
    return (
      <div className="min-h-dvh bg-cream-50">
        <Franja copiaFallida={copiaFallida} />
        <ProteccionTrabajo>
          <GrabarView
            turnoId={turno.turnoId}
            turnoProgramado
            motivoSinGrabar={esDeHoy ? null : SIN_CONEXION_TURNO_OTRO_DIA}
            horaTexto={turno.hora}
            pacienteId={turno.pacienteId}
            pacienteNombre={turno.nombreParaMostrar}
            autorizacionVigente
            prueba={null}
            alCambiarCopia={setCopiaFallida}
          />
        </ProteccionTrabajo>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-cream-50">
      <main className="mx-auto w-full max-w-[560px] px-4 py-6 lg:py-10">
        <h1 className="font-display text-[22px] font-medium text-ink-900 lg:text-[30px]">{SIN_CONEXION_TITULO}</h1>
        <p role="status" className="mt-2 text-[14px] leading-[1.5] text-ink-700">
          {SIN_CONEXION_AVISO}
        </p>
        {vista.turnoNoGuardado ? (
          <p className="mt-3 text-[14px] leading-[1.5] text-ink-700">{SIN_CONEXION_TURNO_NO_GUARDADO}</p>
        ) : null}

        {vista.turnos.length > 0 ? (
          <ul className="mt-6 divide-y divide-[color:var(--border-subtle)] border-y border-[color:var(--border-subtle)]">
            {vista.turnos.map((turno) => (
              <li key={turno.turnoId} className="flex items-center gap-3 py-3">
                <span className="w-12 shrink-0 text-[14px] tabular-nums text-ink-500">{turno.hora}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink-900">{turno.nombreParaMostrar}</span>
                {/* Un enlace de verdad, no <Link>: sin señal la navegación de
                    Next no llega al servidor; ésta la atiende el service
                    worker con esta misma pantalla, que abre el grabador. */}
                <Button asChild size="sm" icon={<Mic size={16} strokeWidth={1.8} aria-hidden="true" />}>
                  <a href={`/grabar/${encodeURIComponent(turno.turnoId)}`}>{GRABAR}</a>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-[14px] leading-[1.5] text-ink-500">{SIN_CONEXION_SIN_TURNOS}</p>
        )}

        <Button variant="secondary" className="mt-6" onClick={() => window.location.reload()}>
          {SIN_CONEXION_PROBAR}
        </Button>
      </main>
    </div>
  );
}
