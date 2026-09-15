"use client";

// Pantalla de Hoy. Orquesta cuatro bloques en este orden: PENDIENTES (lo que
// espera una acción), AHORA (la sesión en curso o la que viene), AGENDA DEL
// DÍA y TE DEBEN. Acá no se decide ninguna regla clínica ni de cobro: se lee
// /api/dashboard una vez (datos.ts), se reparte y se vuelve a leer cuando
// algo cambió. Cada bloque vive en su archivo.

import * as React from "react";

import { EsqueletoHoy } from "@/components/esqueletos";
import { Toast } from "@/components/ui";
import { ResultadoSerie } from "@/components/forms/resultado-serie";
import type { VarianteToast } from "@/components/ui/toast";
import { ListaEnCascada, MS_CHECK_DIBUJADO } from "@/components/ui/movimiento";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { mensajeTurnoAgendado, payloadNuevoTurno } from "@/lib/agendar-turno";
import { ApiClientError, apiGet, apiPost } from "@/lib/api-client";
import {
  ALGO_FALLO,
  COBRADO,
  HOY_SIN_PROXIMA,
  NO_SE_PUDO_AGENDAR,
  NO_SE_PUDO_COBRAR,
} from "@/lib/glosario";
import type {
  Configuracion,
  MetodoPago,
  PacienteConDeuda,
  TurnoCreado,
} from "@/types/domain";

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
import { TeDeben } from "./te-deben";

export function Dashboard() {
  const [estado, setEstado] = React.useState<EstadoHoy | null>(null);
  const [fallo, setFallo] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [resultadoSerie, setResultadoSerie] = React.useState<TurnoCreado["serie"]>(null);
  const [toast, setToast] = React.useState<{
    open: boolean;
    message: string;
    variante: VarianteToast;
  }>({ open: false, message: "", variante: "confirmacion" });
  const [turnoSheet, setTurnoSheet] = React.useState(false);
  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[] | null>(
    null,
  );
  // Tarifa de Tu consultorio, para "Crear a X" desde el formulario de turno.
  const [tarifaDefault, setTarifaDefault] = React.useState<number | null>(null);
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
    // La tarifa es best-effort: sin ella el formulario agenda igual, solo
    // no deja crear pacientes desde ahí.
    Promise.all([
      apiGet<JsonPaciente[]>("/api/pacientes"),
      apiGet<Configuracion>("/api/config").catch(() => null),
    ])
      .then(([lista, config]) => {
        setPacientes(lista.map(parsePaciente));
        setTarifaDefault(config?.tarifaDefault ?? null);
      })
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

  // Si la API rechaza (un 409 por solapamiento, por ejemplo) se relanza:
  // el formulario muestra el motivo y se queda abierto con lo escrito, igual
  // que en la agenda. Lo que no es un error de la API sale como aviso
  // general.
  const agendar = React.useCallback(
    async (valores: NuevoTurnoData) => {
      let creado: TurnoCreado;
      try {
        // El body y el mensaje son los mismos que en la agenda
        // (src/lib/agendar-turno.ts).
        creado = await apiPost<TurnoCreado>(
          "/api/turnos",
          payloadNuevoTurno(valores),
        );
      } catch (error) {
        if (error instanceof ApiClientError) throw error;
        throw new ApiClientError(NO_SE_PUDO_AGENDAR, 0);
      }
      setTurnoSheet(false);
      if (creado.serie) setResultadoSerie(creado.serie);
      else setToast({ open: true, message: mensajeTurnoAgendado(creado), variante: "confirmacion" });
      recargar();
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
          <Pendientes pendientes={pendientes} inicio={inicio} />

          {/* Lo primero que la pantalla tiene que decir es qué sesión viene
              ahora — o que no viene ninguna. Con el día ya empezado y todos
              los turnos pasados, la línea ocupa el lugar de la tarjeta en
              vez de dejar un hueco. */}
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

          <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
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

            <TeDeben deudores={data.deudores} />
          </div>
        </ListaEnCascada>
      </div>

      <SheetNuevoTurno
        open={turnoSheet}
        pacientes={pacientes}
        tarifaDefault={tarifaDefault}
        onClose={() => setTurnoSheet(false)}
        onSubmit={agendar}
      />

      <SheetMetodoPago
        open={cobrando !== null}
        onClose={() => setCobrando(null)}
        onElegir={cobrar}
      />

      <ResultadoSerie serie={resultadoSerie} onClose={() => setResultadoSerie(null)} />

      <Toast
        open={toast.open}
        message={toast.message}
        variante={toast.variante}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      />
    </>
  );
}
