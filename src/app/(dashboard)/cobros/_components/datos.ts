// Cobros, del lado de los datos: los tipos que viajan por la red, las
// lecturas, el cobro de varias sesiones y qué se le dice a ella cuando el
// cobro termina o se corta. Sin estado, sin efectos, sin React.

import { esDeudaPendiente } from "@/app/api/_lib/domain";
import { apiGet, apiPost, esAbort, mensajeParaElla } from "@/lib/api-client";
import { cobrarTurno } from "@/lib/cobrar-cliente";
import type { AccionDeCobro } from "@/lib/aviso-cobro";
import { TEMPLATE_COBRO_DEFAULT, type ConfiguracionDelCobro } from "@/lib/deudas";
import { COBRO_INCOMPLETO, NO_SE_PUDO_COBRAR } from "@/lib/glosario";
import { parseTurno, type TurnoJson } from "@/lib/json-turno";
import { CANAL_RECORDATORIO_VIGENTE } from "@/lib/recordatorios-programacion";
import type {
  Configuracion,
  DeudaPaciente,
  KPIsDashboard,
  MetodoPago,
  Turno,
  TurnoConPaciente,
} from "@/types/domain";

export type DeudorItem = DeudaPaciente & {
  telefono: string;
  /** ISO del último aviso que salió; null si nunca se le avisó. */
  ultimoAvisoEn: string | null;
  /** Pidió no recibir más mensajes. Opcional: un servidor viejo no lo manda. */
  dadaDeBaja?: boolean;
};

export type DatosCobros = {
  kpis: KPIsDashboard;
  deudores: DeudorItem[];
  cobros: TurnoConPaciente[];
  nombreProfesional: string;
  /** Lo que arma el texto del aviso de cobro (textoDelCobro). null si no se
   *  pudo leer la configuración: el texto saldría sin su plantilla ni sus
   *  datos, y WhatsApp se abre con él antes de que conteste el servidor, así
   *  que sin esto no se ofrece el aviso. */
  configCobro: ConfiguracionDelCobro | null;
  /** Por dónde sale el aviso de cobro: lo que decide accionDeCobro. */
  canal: Configuracion["canalRecordatorio"];
};

export async function cargarCobros(signal: AbortSignal): Promise<DatosCobros> {
  const [dashboard, deudores, cobros, config] = await Promise.all([
    apiGet<{ kpis: KPIsDashboard }>("/api/dashboard", { signal }),
    apiGet<DeudorItem[]>("/api/deudores", { signal }),
    apiGet<TurnoJson<TurnoConPaciente>[]>("/api/turnos/cobros", { signal }),
    // Si la configuración no se puede leer, la pantalla igual se muestra,
    // sin Recordar cobro (configCobro null).
    apiGet<Configuracion>("/api/config", { signal }).catch((err: unknown) => {
      if (esAbort(err)) throw err;
      return null;
    }),
  ]);

  return {
    kpis: dashboard.kpis,
    deudores,
    cobros: cobros.map((t) => parseTurno(t)),
    nombreProfesional: config?.nombreProfesional ?? "",
    configCobro: config
      ? {
          templateCobro: config.templateCobro ?? TEMPLATE_COBRO_DEFAULT,
          nombreProfesional: config.nombreProfesional ?? "",
          direccion: config.direccion ?? "",
          whatsappOrigen: config.whatsappOrigen ?? "",
        }
      : null,
    // Sólo WhatsApp: ni lo que traiga la configuración lo cambia.
    canal: CANAL_RECORDATORIO_VIGENTE,
  };
}

/** Las sesiones sin cobrar de una paciente, con la misma regla que suma la
 *  deuda de su fila, y de la más vieja a la más nueva: es el orden en que se
 *  pagan. */
export async function leerSesionesImpagas(
  pacienteId: string,
  signal: AbortSignal,
): Promise<Turno[]> {
  const { turnos } = await apiGet<{ turnos: TurnoJson[] }>(`/api/pacientes/${pacienteId}`, {
    signal,
  });
  return turnos
    .map((t) => parseTurno(t))
    .filter(esDeudaPendiente)
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
}

/** El cobro es por turno: una llamada por sesión, en orden. `alCobrar` se
 *  llama con cada una que entra; si una falla se corta ahí y el error sale
 *  tal cual, para que reintentar cobre sólo las que faltan. */
export async function cobrarSesiones(
  turnoIds: readonly string[],
  metodo: MetodoPago,
  alCobrar: (turnoId: string) => void,
): Promise<void> {
  for (const id of turnoIds) {
    await cobrarTurno(id, metodo);
    alCobrar(id);
  }
}

/** Lo que contesta POST /api/pacientes/[id]/recordar-cobro, por canal. */
export type AvisoDeCobro =
  | { canal: "sms"; envioId: string; creado: boolean; programadoEn: string }
  | { canal: "whatsapp"; enlace: string; avisadoEn: string };

/** Pide el recordatorio de cobro. Por SMS, `creado` es false si ya se había
 *  pedido hoy y no se programó otro; por WhatsApp, anota que lo abrió. */
export async function recordarCobro(pacienteId: string, canal: AccionDeCobro["canal"]): Promise<AvisoDeCobro> {
  // El canal que usó la pantalla: si en Tu consultorio ya hay otro, el
  // servidor no hace nada y lo dice.
  return apiPost<AvisoDeCobro>(`/api/pacientes/${pacienteId}/recordar-cobro`, { canal });
}

export type CanalDelCobro = AccionDeCobro["canal"];

/** Cuántas sesiones eligió y cuántas entraron, a lo largo de los reintentos. */
export interface ResultadoCobro {
  registradas: number;
  elegidas: number;
}

/** Qué pasa al cerrarse el selector de método:
 *  - "nada": se fue sin elegir, o no entró ninguna; el panel sigue como estaba;
 *  - "cobrado": entraron todas;
 *  - "incompleto": entraron algunas y otras no, y se dice cuántas. */
export type DesenlaceCobro =
  | { tipo: "nada" }
  | { tipo: "cobrado" }
  | { tipo: "incompleto"; mensaje: string };

export function desenlaceDelCobro(resultado: ResultadoCobro | null): DesenlaceCobro {
  if (!resultado) return { tipo: "nada" };
  if (resultado.registradas === resultado.elegidas) return { tipo: "cobrado" };
  if (resultado.registradas > 0) {
    return {
      tipo: "incompleto",
      mensaje: COBRO_INCOMPLETO(resultado.registradas, resultado.elegidas),
    };
  }
  return { tipo: "nada" };
}

/** El error que muestra el selector cuando un cobro falla: si ya entraron
 *  algunas, cuántas; si no, el texto de la API o uno para ella. */
export function errorDelCobro(resultado: ResultadoCobro | null, err: unknown): string {
  return resultado && resultado.registradas > 0
    ? COBRO_INCOMPLETO(resultado.registradas, resultado.elegidas)
    : mensajeParaElla(err, NO_SE_PUDO_COBRAR);
}
