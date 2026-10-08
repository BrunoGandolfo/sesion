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
import { crearTurno, mensajeTurnoAgendado } from "@/lib/agendar-turno";
import { SheetNuevoTurno } from "@/components/forms/sheet-nuevo-turno";
import { COBRADO, HOY_SIN_PROXIMA } from "@/lib/glosario";
import type { MetodoPago, TurnoCreado } from "@/types/domain";

import { cobrarTurno } from "@/lib/cobrar-cliente";
import { esMismoDiaMvd } from "@/lib/fechas-montevideo";
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
import { SegunLectura, type Carga } from "./segun-lectura";
import { Kpis } from "./kpis";
import { Pendientes } from "./pendientes";
import { RecordatoriosWhatsapp } from "./recordatorios-whatsapp";
import { relojDelSistema, type Reloj } from "./reloj";
import { Saludo } from "./saludo";

export function Dashboard({ hora = relojDelSistema }: { hora?: Reloj } = {}) {
  const [estado, setEstado] = React.useState<EstadoHoy | null>(null);
  const [carga, setCarga] = React.useState<Carga>("cargando");
  // El reloj de la pantalla (ver el efecto de abajo). null hasta el primer
  // minuto: mientras tanto vale el `ahora` de la lectura.
  const [reloj, setReloj] = React.useState<Date | null>(null);
  // El `ahora` de la última lectura, para que el tic sepa si cambió el día.
  const leidoEn = React.useRef<Date | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [resultadoSerie, setResultadoSerie] = React.useState<TurnoCreado["serie"]>(null);
  const toast = useToast();
  const { confirmar } = toast;
  const [turnoSheet, setTurnoSheet] = React.useState(false);
  const [cobrando, setCobrando] = React.useState<string | null>(null);
  // El turno cuyo cobro se está confirmando en su propia fila (delta D9).
  const [cobroConfirmado, setCobroConfirmado] = React.useState<string | null>(
    null,
  );

  const recargar = React.useCallback(() => {
    setCarga("cargando");
    setReloadKey((k) => k + 1);
  }, []);

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
    leerHoy(hora)
      .then((siguiente) => {
        if (cancelado) return;
        leidoEn.current = siguiente.ahora;
        setEstado(siguiente);
        setCarga("listo");
      })
      .catch(() => {
        if (!cancelado) setCarga("error");
      });
    return () => {
      cancelado = true;
    };
  }, [reloadKey, hora]);

  // Hoy abierto no se queda en la hora en que se leyó (forense 03, P3-09):
  // el reloj avanza al empezar cada minuto, así un turno que llega a su hora
  // pasa a "En curso" y ofrece Cobrar sin recargar. Pasada la medianoche,
  // "hoy" es otro día y se lee de nuevo; y al volver a la pestaña también:
  // pudo haber pasado cualquier cosa.
  React.useEffect(() => {
    let intervalo: number | undefined;
    const avanzar = () => {
      const tic = hora();
      setReloj(tic);
      if (leidoEn.current && !esMismoDiaMvd(tic, leidoEn.current)) recargar();
    };
    const primero = window.setTimeout(() => {
      avanzar();
      intervalo = window.setInterval(avanzar, 60_000);
    }, 60_000 - (hora().getTime() % 60_000));
    const alVolver = () => {
      if (document.visibilityState === "visible") recargar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearTimeout(primero);
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [recargar, hora]);

  // El más nuevo entre el reloj y la lectura: una recarga trae su propio
  // `ahora`, que puede ser posterior al último tic.
  const ahora = estado
    ? reloj && reloj.getTime() > estado.ahora.getTime()
      ? reloj
      : estado.ahora
    : null;

  // Las notas del día que se están escribiendo: las sigue el aviso del panel
  // (avisos-de-notas.tsx) y, cuando alguna termina, Hoy se vuelve a leer
  // para que la fila pase de "Procesando" a "Revisar nota" sin recargar.
  const enProcesoHoy = React.useMemo(
    () => (estado && ahora ? sesionesEnProceso(estado.data.sesionesHoy, ahora) : []),
    [estado, ahora],
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

  const abrirTurno = React.useCallback(() => setTurnoSheet(true), []);

  // El sheet ya no se cierra acá: se cierra solo cuando terminó de dibujar
  // el check sobre el método elegido (ver SheetMetodoPago). Por eso `cobrar`
  // devuelve la promesa y deja pasar el error: el selector necesita saber
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
              data: aplicarCobro(previo.data, turnoId, metodo, hora()),
            }
          : previo,
      );
      setCobroConfirmado(turnoId);
      confirmar(COBRADO);
    },
    [cobrando, confirmar, hora],
  );

  // Si la API rechaza (un 409 por solapamiento, por ejemplo), crearTurno
  // relanza: el formulario muestra el motivo y se queda abierto con lo
  // escrito, igual que en la agenda.
  const agendar = React.useCallback(
    async (valores: NuevoTurnoData) => {
      const creado = await crearTurno(valores);
      setTurnoSheet(false);
      if (creado.serie) setResultadoSerie(creado.serie);
      else confirmar(mensajeTurnoAgendado(creado));
      recargar();
    },
    [recargar, confirmar],
  );

  return (
    <>
      <SegunLectura
        carga={carga}
        datos={estado && ahora ? { ...estado, ahora } : null}
        // La segunda espera: la ruta ya llegó (su loading.tsx mostró este
        // mismo esqueleto) y ahora falta /api/dashboard. Se dibuja lo mismo,
        // así que la pantalla no parpadea entre una espera y la otra.
        esqueleto={<EsqueletoHoy />}
        error={<FalloDeCarga onReintentar={recargar} />}
        onReintentar={recargar}
      >
        {(hoy, { aviso, ocupado }) => (
          <DiaDeHoy
            hoy={hoy}
            aviso={aviso}
            ocupado={ocupado}
            enProcesoHoy={enProcesoHoy}
            cobroConfirmado={cobroConfirmado}
            reloadKey={reloadKey}
            onCobrar={setCobrando}
            onAgendar={abrirTurno}
            onCambio={recargar}
          />
        )}
      </SegunLectura>

      <SheetNuevoTurno
        open={turnoSheet}
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

function DiaDeHoy({
  hoy,
  aviso,
  ocupado,
  enProcesoHoy,
  cobroConfirmado,
  reloadKey,
  onCobrar,
  onAgendar,
  onCambio,
}: {
  hoy: EstadoHoy;
  aviso: React.ReactNode;
  ocupado: boolean;
  enProcesoHoy: ReturnType<typeof sesionesEnProceso>;
  cobroConfirmado: string | null;
  reloadKey: number;
  onCobrar: (turnoId: string) => void;
  onAgendar: () => void;
  onCambio: () => void;
}) {
  const { data, nombre, ahora, riesgoEnElDia } = hoy;
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
    // Los bloques entran escalonados, de arriba abajo: el orden en que se
    // leen es el orden en que aparecen. El saludo va fuera de la cascada
    // porque es lo primero que tiene que estar, sin espera.
    <div
      aria-busy={ocupado}
      className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-7 p-5 lg:gap-10 lg:p-14"
    >
      <Saludo ahora={ahora} nombre={nombre} sesiones={turnos.length} />

      {aviso}

      {/* Un bloque que decide no dibujarse (los recordatorios con SMS
          automático) deja vacía su envoltura de la cascada: se oculta para
          que no sume un hueco más entre bloques. */}
      <ListaEnCascada className="flex flex-col gap-7 lg:gap-10 [&>:empty]:hidden">
        {/* Primero quién viene ahora o después: es lo que se busca entre
            pacientes, con el teléfono en la mano. La agenda del día y los
            pendientes vienen después. */}
        {ahoraTurno ? (
          <CardAhora
            // Cada turno con su card: sin la clave, al pasar de un turno al
            // siguiente la card mostraba la sesión y el brief del anterior
            // hasta que llegaba la lectura nueva (forense 03, P3-21).
            key={ahoraTurno.id}
            turno={ahoraTurno}
            ahora={ahora}
            enCurso={enCurso}
            sinAutorizacion={sinAutorizacion.has(ahoraTurno.id)}
            sinCobrar={ahoraSinCobrar}
            onCobrar={() => onCobrar(ahoraTurno.id)}
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
          onCobrar={onCobrar}
          onAgendar={onAgendar}
          turnoCobrado={cobroConfirmado}
          riesgoEnElDia={riesgoEnElDia}
        />

        <RecordatoriosWhatsapp reloadKey={reloadKey} ahora={ahora} />

        <Pendientes pendientes={pendientes} inicio={inicio} onCambio={onCambio} />

        <Kpis ahora={ahora} data={data} />
      </ListaEnCascada>
    </div>
  );
}
