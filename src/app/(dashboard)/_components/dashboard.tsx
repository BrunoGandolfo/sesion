"use client";

// Hoy empieza por quién viene ahora; después la agenda del día y, al final,
// los pendientes. La deuda se muestra una vez en Pendientes.
// Las reglas y las acciones siguen en sus componentes originales.

import * as React from "react";

import { EsqueletoHoy } from "@/components/esqueletos";
import { useSeguimientoNotas } from "@/components/layout/avisos-de-notas";
import { IndicadorProcesando } from "@/components/ui/procesando";
import { seguirNota } from "@/lib/notas-en-proceso";
import { Toast } from "@/components/ui";
import { ResultadoSerie } from "@/components/forms/resultado-serie";
import { useToast } from "@/components/ui/toast";
import { ListaEnCascada, MS_CHECK_DIBUJADO } from "@/components/ui/movimiento";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { mensajeTurnoAgendado, payloadNuevoTurno } from "@/lib/agendar-turno";
import { ApiClientError, apiGet, apiPost } from "@/lib/api-client";
import {
  ALGO_FALLO,
  COBRADO,
  HOY_SIN_PROXIMA,
  NO_SE_PUDO_AGENDAR,
} from "@/lib/glosario";
import type {
  Configuracion,
  MetodoPago,
  PacienteConDeuda,
  TurnoCreado,
} from "@/types/domain";

import { parsePaciente, type PacienteJson } from "@/lib/json-turno";
import { cobrarTurno } from "@/lib/cobrar-cliente";
import { SheetMetodoPago } from "@/components/cobro/sheet-metodo-pago";

import { AgendaDelDia } from "./agenda-del-dia";
import { CardAhora } from "./card-ahora";
import {
  aplicarCobro,
  leerHoy,
  repartirElDia,
  sesionesEnProceso,
  type EstadoHoy,
} from "./datos";
import { FalloDeCarga } from "./estados-carga";
import { Kpis } from "./kpis";
import { Pendientes } from "./pendientes";
import { Saludo } from "./saludo";
import { SheetNuevoTurno } from "./sheet-nuevo-turno";

export function Dashboard() {
  const [estado, setEstado] = React.useState<EstadoHoy | null>(null);
  const [fallo, setFallo] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [resultadoSerie, setResultadoSerie] = React.useState<TurnoCreado["serie"]>(null);
  const toast = useToast();
  const { avisar, confirmar } = toast;
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

  // Las notas del día que se están escribiendo: las sigue el aviso del panel
  // (avisos-de-notas.tsx) y, cuando alguna termina, Hoy se vuelve a leer
  // para que la fila pase de "Procesando" a "Revisar nota" sin recargar.
  const enProcesoHoy = React.useMemo(
    () => (estado ? sesionesEnProceso(estado.data.sesionesHoy, estado.ahora) : []),
    [estado],
  );
  React.useEffect(() => {
    for (const sesion of enProcesoHoy) seguirNota(sesion);
  }, [enProcesoHoy]);

  const { resueltas } = useSeguimientoNotas();
  // Una vez por sesión: si la lectura nueva todavía la trajera en proceso,
  // no se entra en una vuelta de recargas.
  const recargadasPor = React.useRef(new Set<string>());
  React.useEffect(() => {
    const terminada = enProcesoHoy.find(
      (s) => resueltas.includes(s.sesionId) && !recargadasPor.current.has(s.sesionId),
    );
    if (!terminada) return;
    recargadasPor.current.add(terminada.sesionId);
    recargar();
  }, [enProcesoHoy, resueltas, recargar]);

  const abrirTurno = React.useCallback(() => {
    setTurnoSheet(true);
    if (pacientes !== null) return;
    // La tarifa es best-effort: sin ella el formulario agenda igual, solo
    // no deja crear pacientes desde ahí.
    Promise.all([
      apiGet<PacienteJson[]>("/api/pacientes"),
      apiGet<Configuracion>("/api/config").catch(() => null),
    ])
      .then(([lista, config]) => {
        setPacientes(lista.map(parsePaciente));
        setTarifaDefault(config?.tarifaDefault ?? null);
      })
      .catch(() => {
        setPacientes([]);
        avisar(ALGO_FALLO);
      });
  }, [pacientes, avisar]);

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
  const turnoCobrando = cobrando
    ? estado?.data.sesionesHoy.find((t) => t.id === cobrando)
    : undefined;
  const cobrar = React.useCallback(
    async (metodo: MetodoPago) => {
      const turnoId = cobrando;
      if (!turnoId) return;
      // Si falla, el selector se queda abierto y dice por qué.
      await cobrarTurno(turnoId, metodo);
      setEstado((previo) =>
        previo
          ? {
              ...previo,
              data: aplicarCobro(previo.data, turnoId, metodo, new Date()),
            }
          : previo,
      );
      setCobroConfirmado(turnoId);
      confirmar(COBRADO);
    },
    [cobrando, confirmar],
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
      else confirmar(mensajeTurnoAgendado(creado));
      recargar();
    },
    [recargar, confirmar],
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
          {/* Primero quién viene ahora o después: es lo que se busca entre
              pacientes, con el teléfono en la mano. La agenda del día y los
              pendientes vienen después. */}
          {ahoraTurno ? (
            <CardAhora
              turno={ahoraTurno}
              ahora={ahora}
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

          {/* La del turno de ahora la muestra su card, arriba. */}
          {enProcesoHoy.some((s) => s.turnoId !== ahoraTurno?.id) ? (
            <div className="flex flex-col gap-2">
              {enProcesoHoy
                .filter((s) => s.turnoId !== ahoraTurno?.id)
                .map((s) => (
                  <IndicadorProcesando key={s.sesionId} paciente={s.paciente} />
                ))}
            </div>
          ) : null}

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

          <Pendientes pendientes={pendientes} inicio={inicio} onCambio={recargar} />

          <Kpis ahora={ahora} data={data} />


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
        monto={turnoCobrando?.tarifaCobrada}
        cierraElTurno={turnoCobrando?.estado === "programado"}
        onElegir={cobrar}
      />

      <ResultadoSerie serie={resultadoSerie} onClose={() => setResultadoSerie(null)} />

      <Toast {...toast.props} />
    </>
  );
}
