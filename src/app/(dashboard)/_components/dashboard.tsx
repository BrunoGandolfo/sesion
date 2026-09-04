"use client";

// Pantalla de Hoy. Orquesta cuatro bloques en este orden: PENDIENTES (lo que
// espera una acción), AHORA (la sesión en curso o la que viene), AGENDA DEL
// DÍA y TE DEBEN. Acá no se decide ninguna regla clínica ni de cobro: se lee
// /api/dashboard una vez (datos.ts), se reparte y se vuelve a leer cuando
// algo cambió. Cada bloque vive en su archivo.

import * as React from "react";

import { Toast } from "@/components/ui";
import { ListaEnCascada } from "@/components/ui/movimiento";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { apiGet, apiPost } from "@/lib/api-client";
import { ALGO_FALLO } from "@/lib/glosario";
import type { MetodoPago, PacienteConDeuda } from "@/types/domain";

import { AgendaDelDia } from "./agenda-del-dia";
import { CardAhora } from "./card-ahora";
import {
  leerHoy,
  parsePaciente,
  repartirElDia,
  type EstadoHoy,
  type JsonPaciente,
} from "./datos";
import { Cargando, FalloDeCarga } from "./estados-carga";
import { Kpis } from "./kpis";
import { Pendientes } from "./pendientes";
import { Saludo } from "./saludo";
import { SheetMetodoPago } from "./sheet-metodo-pago";
import { SheetNuevoTurno } from "./sheet-nuevo-turno";
import { TeDeben } from "./te-deben";

export function Dashboard() {
  const [estado, setEstado] = React.useState<EstadoHoy | null>(null);
  const [fallo, setFallo] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [toast, setToast] = React.useState({ open: false, message: "" });
  const [turnoSheet, setTurnoSheet] = React.useState(false);
  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[] | null>(
    null,
  );
  const [cobrando, setCobrando] = React.useState<string | null>(null);

  const recargar = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelado = false;
    leerHoy()
      .then((siguiente) => {
        if (cancelado) return;
        setEstado(siguiente);
        setFallo(false);
      })
      .catch(() => {
        if (!cancelado) setFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, [reloadKey]);

  const abrirTurno = React.useCallback(() => {
    setTurnoSheet(true);
    if (pacientes !== null) return;
    apiGet<JsonPaciente[]>("/api/pacientes")
      .then((lista) => setPacientes(lista.map(parsePaciente)))
      .catch(() => {
        setPacientes([]);
        setToast({ open: true, message: ALGO_FALLO });
      });
  }, [pacientes]);

  const cobrar = React.useCallback(
    (metodo: MetodoPago) => {
      const turnoId = cobrando;
      setCobrando(null);
      if (!turnoId) return;
      apiPost(`/api/turnos/${turnoId}/cobrar`, { metodo })
        .then(() => {
          setToast({ open: true, message: "Cobrado" });
          recargar();
        })
        .catch(() =>
          setToast({ open: true, message: "No se pudo cobrar. Probá de nuevo." }),
        );
    },
    [cobrando, recargar],
  );

  const agendar = React.useCallback(
    (valores: NuevoTurnoData) => {
      apiPost("/api/turnos", {
        pacienteId: valores.pacienteId,
        fecha: new Date(`${valores.fecha}T${valores.hora}:00`).toISOString(),
        duracion: valores.duracion,
        modalidad: valores.modalidad,
        notas: valores.notas?.trim() ? valores.notas.trim() : null,
      })
        .then(() => {
          setTurnoSheet(false);
          setToast({ open: true, message: "Turno agendado" });
          recargar();
        })
        .catch(() =>
          setToast({
            open: true,
            message: "No se pudo agendar. Probá de nuevo.",
          }),
        );
    },
    [recargar],
  );

  if (!estado) {
    return fallo ? <FalloDeCarga onReintentar={recargar} /> : <Cargando />;
  }

  const { data, nombre, ahora } = estado;
  const {
    pendientes,
    turnos,
    notaPorTurno,
    sinAutorizacion,
    ahoraTurno,
    enCurso,
    ahoraSinCobrar,
  } = repartirElDia(data, ahora);

  return (
    <>
      {/* Los bloques entran escalonados, de arriba abajo: el orden en que
          se leen es el orden en que aparecen. El saludo va fuera de la
          cascada porque es lo primero que tiene que estar, sin espera. */}
      <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-7 p-5 lg:gap-10 lg:p-14">
        <Saludo ahora={ahora} nombre={nombre} sesiones={turnos.length} />

        <ListaEnCascada className="flex flex-col gap-7 lg:gap-10">
          <Pendientes pendientes={pendientes} />

          {ahoraTurno ? (
            <CardAhora
              turno={ahoraTurno}
              enCurso={enCurso}
              sinAutorizacion={sinAutorizacion.has(ahoraTurno.id)}
              sinCobrar={ahoraSinCobrar}
              onCobrar={() => setCobrando(ahoraTurno.id)}
              reloadKey={reloadKey}
            />
          ) : null}

          <Kpis ahora={ahora} data={data} />

          <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
            <AgendaDelDia
              turnos={turnos}
              ahora={ahora}
              notaPorTurno={notaPorTurno}
              sinAutorizacion={sinAutorizacion}
              onCobrar={setCobrando}
              onAgendar={abrirTurno}
            />

            <TeDeben deudores={data.deudores} />
          </div>
        </ListaEnCascada>
      </div>

      <SheetNuevoTurno
        open={turnoSheet}
        pacientes={pacientes}
        onClose={() => setTurnoSheet(false)}
        onSubmit={agendar}
      />

      <SheetMetodoPago
        open={cobrando !== null}
        onClose={() => setCobrando(null)}
        onElegir={cobrar}
      />

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      />
    </>
  );
}
