// Las notas que se están escribiendo y el aviso de que quedaron listas.
//
// La grabación termina, la pantalla dice "Te avisamos cuando la nota esté
// lista" y la nota tarda entre 3 y 10 minutos. El aviso es la franja de
// arriba del panel y el globito de Hoy (src/components/layout/).
//
// LA VERDAD ES DEL SERVIDOR
//
// Antes la lista vivía en sessionStorage y la llenaban la ficha y Hoy: si
// ella cerraba la pestaña, no había aviso. Ahora el panel le pregunta a
// GET /api/sesion-clinica/avisos qué se está escribiendo y qué quedó listo o
// fallido sin que ELLA lo haya abierto (el servidor lo sabe por los
// `sesion.ver` de auditoría). Lo de acá es la última respuesta, en memoria.
//
// Nunca se consulta GET /api/sesion-clinica/[id] para esto: cada pedido
// deja un "sesion.ver", y sondear con él marcaría como vistas notas que
// nadie abrió.
//
// CUÁNDO SE PREGUNTA
//
// Periódicamente, solo mientras haya algo en proceso o sin ver, o la última
// consulta falló, y con la pestaña visible (el reloj lo lleva
// avisos-de-notas.tsx). Con nada pendiente, ningún pedido periódico. Además,
// una vez: al montar el panel, al volver a la pestaña, al salir de la
// pantalla de grabar o de una nota, y cuando la ficha o Hoy ven una sesión en
// proceso que acá no estaba (`seguirNota`).
//
// Las funciones de arriba son puras y se testean solas
// (src/lib/__tests__/notas-en-proceso.test.ts); el almacén de abajo es lo
// mínimo para compartirlas entre pantallas con useSyncExternalStore.

/** Lo que devuelve GET /api/sesion-clinica/avisos, fila por fila. */
export interface AvisoServidor {
  id: string;
  paciente: string;
  estado: "subiendo" | "procesando" | "revision" | "fallida";
  fecha: string;
}

export const RUTA_AVISOS = "/api/sesion-clinica/avisos";

export interface NotaSeguida {
  sesionId: string;
  /** Lo mandan la ficha y Hoy; la consulta ya no lo necesita. */
  turnoId: string;
  paciente: string;
}

export interface AvisoNota {
  sesionId: string;
  paciente: string;
  tipo: "lista" | "fallida";
}

export interface Seguimiento {
  /** Se están escribiendo. `desde` es cuándo se empezó a seguir: solo una
   *  respuesta a un pedido que salió después puede darla por terminada. */
  enProceso: { sesionId: string; paciente: string; desde: number }[];
  /** Listas o fallidas que el servidor dice que ella no abrió. */
  avisos: AvisoNota[];
  /** Abiertas en esta pestaña y todavía no confirmadas por el servidor: la
   *  franja se va al tocar Revisar, sin esperar la vuelta siguiente. `desde`
   *  es cuándo se la abrió (o se salió de ella): ver `aplicarRespuesta`. */
  vistas: { sesionId: string; desde: number }[];
  /** Sesiones que salieron del proceso. Hoy las mira para volver a leer su
   *  lista y que la fila pase de "Procesando" a "Revisar nota". */
  resueltas: string[];
  /** Sube cada vez que alguien pide consultar ya (una sesión nueva en
   *  proceso, salir de grabar). El panel mira el cambio, no el número. */
  consultarYa: number;
  /** La última consulta falló (red, servidor): se reintenta aunque no se
   *  sepa de nada pendiente, porque justamente no se sabe. */
  fallo: boolean;
}

export const SEGUIMIENTO_VACIO: Seguimiento = {
  enProceso: [],
  avisos: [],
  vistas: [],
  resueltas: [],
  consultarYa: 0,
  fallo: false,
};

/** Con algo en proceso: la nota tarda minutos y 15 s de demora en
 *  enterarse no se notan (el criterio es menos de 20 s). */
export const INTERVALO_CONSULTA_MS = 15_000;

/** Con solo avisos sin ver: lo único que puede cambiar es que ella la abra
 *  en otro dispositivo. No hace falta más seguido. */
export const INTERVALO_SIN_VER_MS = 60_000;

/** Cuánto tapa una marca de "ya la abrió" a una respuesta que todavía trae
 *  el aviso: la de un pedido que salió antes de que la pantalla de la nota
 *  registrara su `sesion.ver`. Un pedido que sale más tarde y la sigue
 *  trayendo dice que la nota no se llegó a leer (falló la carga): vuelve. */
export const MARGEN_VISTA_MS = 5_000;

/** Cuántas resueltas se recuerdan: las del día, con margen. */
const MAX_RESUELTAS = 30;

/** La sesión está en camino hacia la nota: subida o en manos del worker. */
export function enProceso(estado: string | null | undefined): boolean {
  return estado === "subiendo" || estado === "procesando";
}

/** Lo que dicen la franja y el globito: los avisos menos los ya abiertos acá. */
export function avisosVisibles(s: Seguimiento): AvisoNota[] {
  return s.avisos.filter((a) => !s.vistas.some((v) => v.sesionId === a.sesionId));
}

/** Cada cuánto preguntar, o null si no hay que preguntar. */
export function intervaloDeConsulta(s: Seguimiento): number | null {
  if (s.enProceso.length > 0 || s.fallo) return INTERVALO_CONSULTA_MS;
  // Con avisos, aunque estén vistos acá: se sigue hasta que el servidor lo
  // confirme, así el aviso no reaparece por una respuesta atrasada.
  if (s.avisos.length > 0) return INTERVALO_SIN_VER_MS;
  return null;
}

/**
 * Una sesión que una pantalla vio en proceso. Si el panel ya la conocía o ya
 * terminó, nada cambia (mismo objeto). Si no, entra a la lista y pide una
 * consulta: el servidor dirá si de verdad sigue en proceso.
 */
export function seguir(
  s: Seguimiento,
  nota: NotaSeguida,
  ahora: number,
): Seguimiento {
  if (
    s.resueltas.includes(nota.sesionId) ||
    s.enProceso.some((n) => n.sesionId === nota.sesionId) ||
    s.avisos.some((a) => a.sesionId === nota.sesionId)
  ) {
    return s;
  }
  return {
    ...s,
    enProceso: [
      ...s.enProceso,
      { sesionId: nota.sesionId, paciente: nota.paciente, desde: ahora },
    ],
    consultarYa: s.consultarYa + 1,
  };
}

/** Pide una consulta ya, sin cambiar nada más. */
export function pedirConsulta(s: Seguimiento): Seguimiento {
  return { ...s, consultarYa: s.consultarYa + 1 };
}

/** La consulta falló: queda lo que había, y el reloj reintenta. */
export function marcarFallo(s: Seguimiento): Seguimiento {
  return s.fallo ? s : { ...s, fallo: true };
}

/**
 * La respuesta del servidor reemplaza lo que había: es la verdad. Lo que
 * estaba en proceso y ya no está pasa a `resueltas`, salvo que se lo haya
 * empezado a seguir después de que salió el pedido: esa respuesta no sabía
 * de ella, así que se la sigue hasta la próxima.
 *
 * Una marca de vista local se olvida cuando el servidor deja de traer el
 * aviso (ya registró el `sesion.ver`), y también cuando lo sigue trayendo en
 * un pedido que salió más de MARGEN_VISTA_MS después de la marca: la nota no
 * se llegó a leer y el aviso vuelve. `pedidoEn` es cuándo salió el pedido.
 */
export function aplicarRespuesta(
  s: Seguimiento,
  filas: AvisoServidor[],
  pedidoEn: number,
): Seguimiento {
  const previas = new Map(s.enProceso.map((n) => [n.sesionId, n]));
  const delServidor = filas
    .filter((f) => enProceso(f.estado))
    .map((f) => ({
      sesionId: f.id,
      paciente: f.paciente,
      desde: previas.get(f.id)?.desde ?? pedidoEn,
    }));
  const avisos: AvisoNota[] = filas
    .filter((f) => f.estado === "revision" || f.estado === "fallida")
    .map((f) => ({
      sesionId: f.id,
      paciente: f.paciente,
      tipo: f.estado === "revision" ? "lista" : "fallida",
    }));

  const siguen = new Set(delServidor.map((n) => n.sesionId));
  const conAviso = new Set(avisos.map((a) => a.sesionId));
  const ausentes = s.enProceso.filter((n) => !siguen.has(n.sesionId));
  // Se empezó a seguir después de que salió el pedido: todavía no se sabe.
  const sinConfirmar = ausentes.filter(
    (n) => n.desde > pedidoEn && !conAviso.has(n.sesionId),
  );
  const salieron = ausentes
    .filter((n) => !sinConfirmar.includes(n) && !s.resueltas.includes(n.sesionId))
    .map((n) => n.sesionId);

  return {
    enProceso: [...delServidor, ...sinConfirmar],
    avisos,
    vistas: s.vistas.filter(
      (v) => conAviso.has(v.sesionId) && pedidoEn <= v.desde + MARGEN_VISTA_MS,
    ),
    // Una que vuelve a procesarse (Volver a escribirla) deja de estar
    // resuelta: cuando termine, lo estará de nuevo.
    resueltas: [...s.resueltas.filter((id) => !siguen.has(id)), ...salieron].slice(
      -MAX_RESUELTAS,
    ),
    consultarYa: s.consultarYa,
    fallo: false,
  };
}

/** Ella abrió la sesión en esta pestaña (o salió de ella, `ahora`): la
 *  franja se va ya, sin esperar al servidor. */
export function marcarVista(
  s: Seguimiento,
  sesionId: string,
  ahora: number,
): Seguimiento {
  if (!s.avisos.some((a) => a.sesionId === sesionId)) return s;
  return {
    ...s,
    vistas: [
      ...s.vistas.filter((v) => v.sesionId !== sesionId),
      { sesionId, desde: ahora },
    ],
  };
}

/** El id de /sesiones/<id> (y de sus subpantallas), o null. */
export function sesionDeLaRuta(pathname: string | null): string | null {
  const m = pathname?.match(/^\/sesiones\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Almacén compartido. En memoria y no en sessionStorage: lleva nombres de
// pacientes y no tiene por qué sobrevivir a la pestaña, porque al volver a
// abrirla el servidor lo cuenta de nuevo.
// ────────────────────────────────────────────────────────────────────────────

let actual: Seguimiento = SEGUIMIENTO_VACIO;
const oyentes = new Set<() => void>();

export function obtenerSeguimiento(): Seguimiento {
  return actual;
}

export function suscribirSeguimiento(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function actualizarSeguimiento(
  cambio: (s: Seguimiento) => Seguimiento,
): void {
  const nuevo = cambio(actual);
  if (nuevo === actual) return;
  actual = nuevo;
  for (const oyente of oyentes) oyente();
}

/** Lo que llaman la ficha y Hoy al ver una sesión en proceso. */
export function seguirNota(nota: NotaSeguida): void {
  actualizarSeguimiento((s) => seguir(s, nota, Date.now()));
}

/** Donde la versión anterior guardaba el seguimiento, con nombres de
 *  pacientes. Una pestaña abierta desde antes del cambio todavía lo tiene. */
const CLAVE_VIEJA = "sesion:notas-en-proceso";

/** Borra lo que dejó la versión anterior. Lo llaman el panel al montarse y
 *  `olvidarNotas`. */
export function borrarRastroViejo(): void {
  try {
    window.sessionStorage.removeItem(CLAVE_VIEJA);
  } catch {
    // Sin almacenamiento: no hay nada que borrar.
  }
}

/** Al cerrar sesión: el nombre de la paciente no queda en la pestaña. */
export function olvidarNotas(): void {
  actual = SEGUIMIENTO_VACIO;
  borrarRastroViejo();
  for (const oyente of oyentes) oyente();
}
