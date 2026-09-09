// Lectura de la pantalla de Hoy: los tipos que viajan por la red, la vuelta
// a Date y la única función que pide los datos.
//
// Vive fuera de dashboard.tsx porque no es pantalla: es el borde entre
// /api/dashboard y el render. Sin estado, sin efectos, sin React.

import { esDeudaPendiente } from "@/app/api/_lib/domain";
import { clavesDeRiesgo } from "@/components/grabacion/RiesgoDetectadoBanner";
import { apiGet } from "@/lib/api-client";
import type {
  Configuracion,
  DashboardData,
  DeudaPaciente,
  MetodoPago,
  PacienteConDeuda,
  PendientesTerapeuta,
  SenalRiesgoDelDia,
  TurnoConPaciente,
} from "@/types/domain";

/** Lo que se muestra cuando /api/dashboard todavía no manda `pendientes`. */
export const SIN_PENDIENTES: PendientesTerapeuta = {
  notasParaRevisar: [],
  sinCobrar: [],
  sinAutorizacion: [],
  totalSinCobrar: { sesiones: 0, monto: 0, pacientes: 0 },
};

// JSON convierte Date → string. Volvemos a Date solo donde el UI lo necesita.
export type JsonTurno = Omit<
  TurnoConPaciente,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

export type JsonPaciente = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & { creadoEn: string; actualizadoEn: string; ultimaSesion: string | null };

export type JsonDashboard = Omit<
  DashboardData,
  "sesionesHoy" | "proximaSesion"
> & {
  sesionesHoy: JsonTurno[];
  proximaSesion: JsonTurno | null;
  /** La señal de riesgo de las sesiones del día (ver /api/dashboard). Puede
   *  no venir si la respuesta es de una versión anterior de la ruta. */
  riesgoDelDia?: SenalRiesgoDelDia[];
};

export function parseTurno(raw: JsonTurno): TurnoConPaciente {
  return {
    ...raw,
    fecha: new Date(raw.fecha),
    pagoFecha: raw.pagoFecha ? new Date(raw.pagoFecha) : null,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
  };
}

export function parsePaciente(raw: JsonPaciente): PacienteConDeuda {
  return {
    ...raw,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
    ultimaSesion: raw.ultimaSesion ? new Date(raw.ultimaSesion) : null,
  };
}

export interface EstadoHoy {
  data: DashboardData;
  /** Alguna sesión del día tiene señal de riesgo. Mientras sea true, Lupita
   *  no se dibuja en ninguna parte de esta pantalla (ver
   *  docs/diseno/04-personaje.md, "la regla de tono"). */
  riesgoEnElDia: boolean;
  nombre: string | null;
  /** `ahora` se construye recién con los datos, ya en el cliente: armarlo
   *  durante el render del servidor (UTC) daba textos distintos a los de
   *  Montevideo y disparaba el mismatch de hidratación React #418. */
  ahora: Date;
}

export interface DiaRepartido {
  inicio: DashboardData["inicio"];
  pendientes: PendientesTerapeuta;
  /** Los turnos del día, en hora ascendente. */
  turnos: TurnoConPaciente[];
  /** turnoId → sesionId de la nota que espera revisión. */
  notaPorTurno: Map<string, string>;
  /** turnoIds cuya paciente no firmó la autorización de grabación. */
  sinAutorizacion: Set<string>;
  /** La sesión en curso, o la próxima del día si no hay ninguna abierta. */
  ahoraTurno: TurnoConPaciente | null;
  /** `ahoraTurno` ya empezó y todavía no terminó. */
  enCurso: boolean;
  /** `ahoraTurno` tiene algo que cobrar. */
  ahoraSinCobrar: boolean;
}

/**
 * Reparte la respuesta del día entre los bloques de la pantalla. Derivación
 * pura: no aplica ninguna regla nueva, solo indexa lo que ya vino resuelto
 * por casos-uso/pendientes-terapeuta.ts.
 *
 * `sinCobrar` viene agrupado por paciente (quien debe seis sesiones es un
 * pendiente, no seis), así que para el turno de AHORA se cruza la pertenencia
 * del paciente con el estado de pago del propio turno: eso es lo que decide
 * si hay algo que cobrar en ESTE turno.
 */
export function repartirElDia(data: DashboardData, ahora: Date): DiaRepartido {
  const pendientes = data.pendientes ?? SIN_PENDIENTES;
  const turnos = [...data.sesionesHoy].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime(),
  );

  const abierto = turnos.find(
    (t) =>
      t.fecha.getTime() <= ahora.getTime() &&
      ahora.getTime() < t.fecha.getTime() + t.duracion * 60000,
  );
  const ahoraTurno =
    abierto ?? turnos.find((t) => t.fecha.getTime() >= ahora.getTime()) ?? null;

  const debenPacientes = new Set(pendientes.sinCobrar.map((d) => d.pacienteId));

  return {
    inicio: data.inicio,
    pendientes,
    turnos,
    notaPorTurno: new Map(
      pendientes.notasParaRevisar.map((n) => [n.turnoId, n.sesionId]),
    ),
    sinAutorizacion: new Set(
      pendientes.sinAutorizacion.map((t) => t.turnoId),
    ),
    ahoraTurno,
    enCurso: Boolean(abierto),
    ahoraSinCobrar:
      ahoraTurno !== null &&
      debenPacientes.has(ahoraTurno.paciente.id) &&
      esDeudaPendiente(ahoraTurno),
  };
}

/**
 * ¿Alguna sesión del día tiene señal de riesgo?
 *
 * La regla no se reescribe acá: la decide `clavesDeRiesgo`
 * (RiesgoDetectadoBanner.tsx), la misma función que habilita el botón de
 * aprobar una nota. Una sola clave alcanza.
 *
 * Para qué: docs/diseno/04-personaje.md pone una regla dura sobre el
 * personaje — si la sesión tuvo señal de riesgo, no se la acompaña con
 * Lupita en NINGUNA pantalla ese día, ni siquiera en un estado vacío. No
 * alcanza con que Lupita no esté en la pantalla del riesgo: tiene que no
 * estar en el camino de esa sesión.
 */
export function hayRiesgoEnElDia(
  senales: SenalRiesgoDelDia[] | undefined,
): boolean {
  return (senales ?? []).some(
    (senal) =>
      clavesDeRiesgo(senal.riesgoDetectado, senal.flagsRiesgo).length > 0,
  );
}

/**
 * El estado de Hoy después de cobrar un turno, sin volver a la red.
 *
 * Cobrar cambia un renglón, no repinta el día (delta D12 del plan de
 * movimiento): antes esta acción llamaba a `recargar()` y toda la pantalla
 * volvía a entrar como si se hubiera abierto de nuevo, varias veces por
 * jornada.
 *
 * El cobro toca cuatro cosas a la vez, y por eso se aplican juntas y en una
 * función pura: el turno pasa a pagado, la deuda baja, lo cobrado del mes
 * sube y la paciente sale (o afloja) en la única lista de deudores. Si esto
 * se hiciera por partes, la pantalla volvería a decir dos números distintos
 * —que es exactamente lo que se acaba de arreglar—.
 *
 * Si el turno no era deuda pendiente (ya estaba pagado, o no está en el día)
 * devuelve los datos sin tocar.
 */
export function aplicarCobro(
  data: DashboardData,
  turnoId: string,
  metodo: MetodoPago,
  cuando: Date,
): DashboardData {
  const turno = data.sesionesHoy.find((t) => t.id === turnoId);
  if (!turno || !esDeudaPendiente(turno)) return data;

  const monto = turno.tarifaCobrada;
  const pacienteId = turno.paciente.id;

  const sesionesHoy = data.sesionesHoy.map((t) =>
    t.id === turnoId
      ? {
          ...t,
          pagoEstado: "pagado" as const,
          pagoMetodo: metodo,
          pagoFecha: cuando,
        }
      : t,
  );

  // Una sesión menos y un monto menos para esa paciente; si era la última que
  // debía, sale de la lista. Las dos listas se vuelven a ordenar con el mismo
  // criterio que usa el servidor (deudoresDeHoy): monto descendente y, a
  // igual monto, la deuda más vieja primero.
  const masAntiguo = new Map(
    data.pendientes.sinCobrar.map((p) => [p.pacienteId, p.masAntiguo]),
  );
  const porMonto = <T extends { pacienteId: string }>(
    monto: (item: T) => number,
  ) => (a: T, b: T) =>
    monto(b) !== monto(a)
      ? monto(b) - monto(a)
      : (masAntiguo.get(a.pacienteId) ?? "").localeCompare(
          masAntiguo.get(b.pacienteId) ?? "",
        );

  const deudores: DeudaPaciente[] = data.deudores
    .map((deudor) =>
      deudor.pacienteId === pacienteId
        ? {
            ...deudor,
            sesionesImpagas: deudor.sesionesImpagas - 1,
            montoTotal: deudor.montoTotal - monto,
          }
        : deudor,
    )
    .filter((deudor) => deudor.sesionesImpagas > 0)
    .sort(porMonto((deudor) => deudor.montoTotal));

  const sinCobrar = data.pendientes.sinCobrar
    .map((p) =>
      p.pacienteId === pacienteId
        ? { ...p, sesiones: p.sesiones - 1, monto: p.monto - monto }
        : p,
    )
    .filter((p) => p.sesiones > 0)
    .sort(porMonto((p) => p.monto));

  return {
    ...data,
    sesionesHoy,
    deudores,
    kpis: {
      ...data.kpis,
      deudaAcumulada: data.kpis.deudaAcumulada - monto,
      ingresosMes: data.kpis.ingresosMes + monto,
    },
    pendientes: {
      ...data.pendientes,
      sinCobrar,
      totalSinCobrar: {
        sesiones: sinCobrar.reduce((total, p) => total + p.sesiones, 0),
        monto: sinCobrar.reduce((total, p) => total + p.monto, 0),
        pacientes: sinCobrar.length,
      },
    },
  };
}

/** Lectura pura: sin estado ni efectos. El resultado entra por then(). */
export async function leerHoy(): Promise<EstadoHoy> {
  const [raw, config] = await Promise.all([
    apiGet<JsonDashboard>("/api/dashboard"),
    apiGet<Pick<Configuracion, "nombreProfesional">>("/api/config").catch(
      () => null,
    ),
  ]);
  return {
    data: {
      ...raw,
      sesionesHoy: raw.sesionesHoy.map(parseTurno),
      proximaSesion: raw.proximaSesion ? parseTurno(raw.proximaSesion) : null,
    },
    riesgoEnElDia: hayRiesgoEnElDia(raw.riesgoDelDia),
    // El nombre COMPLETO, no la primera palabra: la cabecera ya recorta lo
    // que muestra, pero las iniciales del avatar salen del nombre entero.
    // Mandando sólo "Mariana" el avatar decía "MA" en Hoy y "MR" en Cobros
    // para la misma persona, y un ancla visual que cambia de contenido entre
    // pantallas deja de ser un ancla.
    nombre: config?.nombreProfesional?.trim() || null,
    ahora: new Date(),
  };
}
