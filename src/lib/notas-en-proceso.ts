// Las notas que se están escribiendo y el aviso de que quedaron listas.
//
// La grabación termina, la pantalla dice "Te avisamos cuando la nota esté
// lista" y la nota tarda entre 3 y 10 minutos. Sin esto, nadie avisaba: la
// nota aparecía en Pendientes solo si ella iba a mirar.
//
// CÓMO SE ENTERA LA APP
//
// No hay push ni service worker. La app consulta al servidor cada tanto, y
// SOLO mientras sigue alguna sesión en proceso: con la lista vacía no sale
// ningún pedido. La lista la llenan las pantallas que ya ven una sesión en
// proceso (la ficha y Hoy) llamando a `seguirNota`; nada la descubre por su
// cuenta.
//
// Cada consulta va a GET /api/sesion-clinica?turnoId=, que ya existe y no
// escribe auditoría. GET /api/sesion-clinica/[id] también contesta el estado,
// pero registra un "sesion.ver" por pedido: consultar cada 15 s llenaría el
// rastro clínico de lecturas que nadie hizo.
//
// DÓNDE VIVE
//
// En sessionStorage: sobrevive a una recarga de la pestaña (el teléfono
// recarga la PWA cuando vuelve de segundo plano) y se borra al cerrarla. Lleva
// el nombre de la paciente, que es lo que el aviso dice; por eso no va en
// localStorage, y `olvidarNotas` lo borra al cerrar sesión.
//
// Las funciones de arriba son puras y se testean solas
// (src/lib/__tests__/notas-en-proceso.test.ts); el almacén de abajo es lo
// mínimo para compartirlas entre pantallas con useSyncExternalStore.

import type { EstadoSesion } from "@/lib/sesion-clinica/schema";

export interface NotaSeguida {
  sesionId: string;
  /** Con él se consulta el estado sin dejar auditoría (ver arriba). */
  turnoId: string;
  paciente: string;
}

export interface AvisoNota {
  sesionId: string;
  paciente: string;
  tipo: "lista" | "fallida";
}

export interface Seguimiento {
  seguidas: NotaSeguida[];
  avisos: AvisoNota[];
  /** Sesiones que ya salieron del proceso. Una pantalla con datos viejos
   *  (Hoy cargado antes de que terminara) no las vuelve a seguir, y un aviso
   *  cerrado no reaparece. */
  resueltas: string[];
}

export const SEGUIMIENTO_VACIO: Seguimiento = {
  seguidas: [],
  avisos: [],
  resueltas: [],
};

/** Entre 3 y 10 minutos de espera: 15 s de demora en enterarse no se notan. */
export const INTERVALO_CONSULTA_MS = 15_000;

/** Cuántas resueltas se recuerdan: las del día, con margen. */
const MAX_RESUELTAS = 30;

/** La sesión está en camino hacia la nota: subida o en manos del worker. */
export function enProceso(estado: string | null | undefined): boolean {
  return estado === "subiendo" || estado === "procesando";
}

/** Empieza a seguir una sesión. Devuelve el mismo objeto si no cambia nada. */
export function seguir(s: Seguimiento, nota: NotaSeguida): Seguimiento {
  if (
    s.resueltas.includes(nota.sesionId) ||
    s.seguidas.some((n) => n.sesionId === nota.sesionId)
  ) {
    return s;
  }
  return { ...s, seguidas: [...s.seguidas, nota] };
}

/** La única condición para consultar al servidor. */
export function hayQueConsultar(s: Seguimiento): boolean {
  return s.seguidas.length > 0;
}

/**
 * Lo que contestó el servidor sobre una sesión seguida. `estado` null
 * significa que la sesión ya no está (se borró, o el turno tiene otra).
 *
 * Sigue en proceso → nada cambia. "revision" → aviso de nota lista.
 * "fallida" → aviso de fallo. Cualquier otra cosa (aprobada, vuelta a
 * grabando, borrada) sale de la lista sin aviso: no hay nada que revisar.
 */
export function aplicarEstado(
  s: Seguimiento,
  sesionId: string,
  estado: EstadoSesion | null,
): Seguimiento {
  const nota = s.seguidas.find((n) => n.sesionId === sesionId);
  if (!nota || enProceso(estado)) return s;

  const tipo =
    estado === "revision" ? "lista" : estado === "fallida" ? "fallida" : null;

  return {
    seguidas: s.seguidas.filter((n) => n.sesionId !== sesionId),
    avisos: tipo
      ? [...s.avisos, { sesionId, paciente: nota.paciente, tipo }]
      : s.avisos,
    resueltas: [...s.resueltas, sesionId].slice(-MAX_RESUELTAS),
  };
}

export function cerrarAviso(s: Seguimiento, sesionId: string): Seguimiento {
  if (!s.avisos.some((a) => a.sesionId === sesionId)) return s;
  return { ...s, avisos: s.avisos.filter((a) => a.sesionId !== sesionId) };
}

// ────────────────────────────────────────────────────────────────────────────
// Almacén compartido
// ────────────────────────────────────────────────────────────────────────────

const CLAVE = "sesion:notas-en-proceso";

let actual: Seguimiento | null = null;
const oyentes = new Set<() => void>();

function leerGuardado(): Seguimiento {
  try {
    const crudo = window.sessionStorage.getItem(CLAVE);
    const valor = crudo ? (JSON.parse(crudo) as Partial<Seguimiento>) : null;
    if (
      valor &&
      Array.isArray(valor.seguidas) &&
      Array.isArray(valor.avisos) &&
      Array.isArray(valor.resueltas)
    ) {
      return valor as Seguimiento;
    }
  } catch {
    // Sin almacenamiento (ventana privada, bloqueado): se sigue en memoria.
  }
  return SEGUIMIENTO_VACIO;
}

export function obtenerSeguimiento(): Seguimiento {
  if (typeof window === "undefined") return SEGUIMIENTO_VACIO;
  actual ??= leerGuardado();
  return actual;
}

export function suscribirSeguimiento(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function actualizarSeguimiento(
  cambio: (s: Seguimiento) => Seguimiento,
): void {
  const previo = obtenerSeguimiento();
  const nuevo = cambio(previo);
  if (nuevo === previo) return;
  actual = nuevo;
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify(nuevo));
  } catch {
    // Queda en memoria; el aviso funciona igual mientras no se recargue.
  }
  for (const oyente of oyentes) oyente();
}

/** Lo que llaman la ficha y Hoy al ver una sesión en proceso. */
export function seguirNota(nota: NotaSeguida): void {
  actualizarSeguimiento((s) => seguir(s, nota));
}

/** Al cerrar sesión: el nombre de la paciente no queda en el teléfono. */
export function olvidarNotas(): void {
  actual = SEGUIMIENTO_VACIO;
  try {
    window.sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada guardado que borrar.
  }
  for (const oyente of oyentes) oyente();
}
