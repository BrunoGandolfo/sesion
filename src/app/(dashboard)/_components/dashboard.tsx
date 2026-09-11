"use client";

// Hoy empieza por la agenda. La deuda se muestra una vez en Pendientes.
// Las reglas y las acciones siguen en sus componentes originales.

import * as React from "react";

import { EsqueletoHoy } from "@/components/esqueletos";
import { Toast } from "@/components/ui";
import type { VarianteToast } from "@/components/ui/toast";
import { ListaEnCascada, MS_CHECK_DIBUJADO } from "@/components/ui/movimiento";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { ApiClientError, apiGet, apiPost } from "@/lib/api-client";
import { instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import {
  ALGO_FALLO,
  COBRADO,
  HOY_SIN_PROXIMA,
  NO_SE_PUDO_AGENDAR,
  NO_SE_PUDO_COBRAR,
  TURNO_AGENDADO,
} from "@/lib/glosario";
import type { MetodoPago, PacienteConDeuda } from "@/types/domain";

import { AgendaDelDia } from "./agenda-del-dia";
import { CardAhora } from "./card-ahora";
import {
  aplicarCobro,
  leerHoy,
  parsePaciente,
  repartirElDia,
  type EstadoHoy,
  type JsonPaciente,
} from "./datos";
import { FalloDeCarga } from "./estados-carga";
import { Kpis } from "./kpis";
import { Pendientes } from "./pendientes";
import { Saludo } from "./saludo";
import { SheetMetodoPago } from "./sheet-metodo-pago";
import { SheetNuevoTurno } from "./sheet-nuevo-turno";

export function Dashboard() {
  const [estado, setEstado] = React.useState<EstadoHoy | null>(null);
  const [fallo, setFallo] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [toast, setToast] = React.useState<{
    open: boolean;
    message: string;
    variante: VarianteToast;
  }>({ open: false, message: "", variante: "confirmacion" });
  const [turnoSheet, setTurnoSheet] = React.useState(false);
  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[] | null>(
    null,
  );
  const [cobrando, setCobrando] = React.useState<string | null>(null);
  // El turno cuyo cobro se está confirmando en su propia fila (delta D9).
  const [cobroConfirmado, setCobroConfirmado] = React.useState<string | null>(
    null,
  );

  const recargar = React.useCallback(() => setReloadKey((k) => k + 1), []);

  // La marca del cobro en la fila dura lo que el sheet tarda en irse —su
  // trazo más el respiro de 120 ms de useConfirmacionDibujada— más su propio
  // trazo. Empieza cuando el cobro entró, así que se superpone con el cierre
  // del sheet y no agrega ni un milisegundo de espera: cuando el panel se
  // corre, la fila que ella tocó ya está confirmando.
  React.useEffect(() => {
    if (!cobroConfirmado) return;
    const timer = window.setTimeout(
      () => setCobroConfirmado(null),
      MS_CHECK_DIBUJADO + 120 + MS_CHECK_DIBUJADO,
    );
    return () => window.clearTimeout(timer);
  }, [cobroConfirmado]);

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
        setToast({ open: true, message: ALGO_FALLO, variante: "aviso" });
      });
  }, [pacientes]);

  // El sheet ya no se cierra acá: se cierra solo cuando terminó de dibujar
  // el check sobre el método elegido (ver SheetMetodoPago). Por eso `cobrar`
  // devuelve la promesa y vuelve a lanzar el error: el sheet necesita saber
  // si el cobro entró antes de confirmar nada.
  //
  // Cobrar NO recarga la pantalla (delta D12): el turno cobrado se actualiza
  // en el estado que ya está en pantalla, como hace cobros-view con el aviso
  // de cobro. Con `recargar()` volvían a entrar los cuatro bloques, la
  // cascada y el fundido de página, varias veces por jornada, para cambiar
  // un renglón. La cuenta de la deuda la baja `aplicarCobro`, que toca el
  // turno, el KPI y la lista de deudores a la vez.
  const cobrar = React.useCallback(
    async (metodo: MetodoPago) => {
      const turnoId = cobrando;
      if (!turnoId) return;
      try {
        await apiPost(`/api/turnos/${turnoId}/cobrar`, { metodo });
      } catch (error) {
        setToast({
          open: true,
          message: NO_SE_PUDO_COBRAR,
          variante: "aviso",
        });
        throw error;
      }
      setEstado((previo) =>
        previo
          ? {
              ...previo,
              data: aplicarCobro(previo.data, turnoId, metodo, new Date()),
            }
          : previo,
      );
      setCobroConfirmado(turnoId);
      setToast({ open: true, message: COBRADO, variante: "confirmacion" });
    },
    [cobrando],
  );

  const agendar = React.useCallback(
    (valores: NuevoTurnoData) => {
      apiPost("/api/turnos", {
        pacienteId: valores.pacienteId,
        // La hora del formulario es la del consultorio, no la del aparato.
        fecha: instanteDesdeFechaHoraMvd(
          valores.fecha,
          valores.hora,
        ).toISOString(),
        duracion: valores.duracion,
        modalidad: valores.modalidad,
        notas: valores.notas?.trim() ? valores.notas.trim() : null,
      })
        .then(() => {
          setTurnoSheet(false);
          setToast({
            open: true,
            message: TURNO_AGENDADO,
            variante: "confirmacion",
          });
          recargar();
        })
        .catch((error: unknown) =>
          setToast({
            open: true,
            message:
              error instanceof ApiClientError && error.status === 409
                ? error.mensaje
                : NO_SE_PUDO_AGENDAR,
            variante: "aviso",
          }),
        );
    },
    [recargar],
  );

  // La segunda espera: la ruta ya llegó (su loading.tsx mostró este mismo
  // esqueleto) y ahora falta /api/dashboard. Se dibuja lo mismo, así que la
  // pantalla no parpadea entre una espera y la otra.
  if (!estado) {
    return fallo ? <FalloDeCarga onReintentar={recargar} /> : <EsqueletoHoy />;
  }

  const { data, nombre, ahora, riesgoEnElDia } = estado;
  const {
    inicio,
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
          <AgendaDelDia
          turnos={turnos}
          ahora={ahora}
          notaPorTurno={notaPorTurno}
          sinAutorizacion={sinAutorizacion}
          onCobrar={setCobrando}
          onAgendar={abrirTurno}
          turnoCobrado={cobroConfirmado}
          riesgoEnElDia={riesgoEnElDia}
          />

          <Pendientes pendientes={pendientes} inicio={inicio} />

          {/* El detalle de la próxima sesión acompaña a la agenda. */}
          {ahoraTurno ? (
            <CardAhora
              turno={ahoraTurno}
              enCurso={enCurso}
              sinAutorizacion={sinAutorizacion.has(ahoraTurno.id)}
              sinCobrar={ahoraSinCobrar}
              onCobrar={() => setCobrando(ahoraTurno.id)}
              reloadKey={reloadKey}
            />
          ) : turnos.length > 0 ? (
            <p className="font-[family-name:var(--font-display)] text-[20px] font-medium italic text-ink-500">
              {HOY_SIN_PROXIMA}
            </p>
          ) : null}

          <Kpis ahora={ahora} data={data} />


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
        variante={toast.variante}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      />
    </>
  );
}
