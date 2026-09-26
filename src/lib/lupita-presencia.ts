// Lupita como presencia: el estado de "la posada", sin React.
//
// La especificación es docs/diseno/06-lupita-presencia.md. En corto: la
// presencia permanente de Lupita es un dibujo de 34 px posado sobre el menú
// de abajo (en la computadora, en un hueco del lateral), sólo en cinco
// pantallas. Se retira en /grabar/*, en las rutas clínicas, con un sheet
// abierto y en Hoy el día que alguna sesión trae una señal de riesgo. Hace
// tres gestos —saludo, cobro, asiente— con un enfriamiento entre uno y otro.
//
// Las funciones de arriba son puras y se testean solas
// (src/lib/__tests__/lupita-presencia.test.ts); el almacén de abajo es lo
// mínimo para compartirlas entre el layout, los menús y las pantallas con
// useSyncExternalStore, con el mismo patrón que notas-en-proceso.ts.
//
// Este módulo no importa nada de la app a propósito: lo importan pantallas
// clínicas (la nota avisa que se aprobó) y el guardián de imports
// (src/lib/__tests__/lupita-sin-riesgo.test.ts) sólo les permite esto, no
// el dibujo.

/** Las pantallas donde vive la posada. Es una lista de PERMITIDAS: una ruta
 *  nueva, o /deudores y /finanzas, no la tienen hasta que alguien la agregue
 *  acá a propósito (06, sección 2, "La posada"). */
export const RUTAS_CON_POSADA = ["/", "/agenda", "/pacientes", "/cobros", "/config"] as const;

/** Superficies clínicas: ahí Lupita no aparece en ninguna forma, ni en el
 *  encabezado del panel de ayuda (06, D3). `/pacientes/` con barra es la
 *  ficha; la lista, `/pacientes`, no entra. */
export const PREFIJOS_RUTA_CLINICA = ["/sesiones/", "/grabar/", "/pacientes/"] as const;

export function esRutaClinica(pathname: string): boolean {
  return PREFIJOS_RUTA_CLINICA.some((prefijo) => pathname.startsWith(prefijo));
}

export function admitePosada(pathname: string | null): boolean {
  if (!pathname) return false;
  const limpia = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (RUTAS_CON_POSADA as readonly string[]).includes(limpia);
}

// ─── Medidas compartidas ────────────────────────────────────────────────────
// Tres números que antes habrían quedado sueltos en tres archivos: el menú de
// abajo, la posada que se apoya en él y el "+" flotante que sube por encima
// de ella. El toast se apoya arriba del "+" (ui/toast.tsx).

/** Alto del menú de abajo en el teléfono: 10 + 22 (ícono) + 4 + 15 (rótulo)
 *  + 10, más el borde de 1 px (bottom-nav.tsx). */
export const ALTO_MENU_MOVIL = 62;
/** Lado del dibujo de la posada (06: 32 a 36 px; se eligió 34). */
export const LADO_POSADA = 34;
/** Aire entre la posada y el "+" que queda arriba. */
export const AIRE_POSADA = 12;
/** Dónde se apoya el "+" flotante en el teléfono: arriba de la posada. */
export const BOTTOM_FAB_MOVIL = ALTO_MENU_MOVIL + LADO_POSADA + AIRE_POSADA;
/** Alto del "+" flotante (ui/fab.tsx: w-14 h-14). */
export const ALTO_FAB = 56;

// ─── Reglas de convivencia ──────────────────────────────────────────────────

/** Entre un gesto de la posada y el siguiente. Cobrar varios turnos seguidos
 *  es un gesto, no varios. */
export const ENFRIAMIENTO_MS = 10_000;
/** La aprobación de una nota ocurre donde la posada no está (la nota es
 *  clínica). Se guarda UNA y la hace al volver, si vuelve antes de esto. */
export const VENCE_APROBACION_MS = 10 * 60_000;

export type GestoPosada = "saludo" | "cobro" | "asiente";
export type EventoLupita = "toque" | "cobrada" | "aprobada";
export type MotivoRetiro = "sheet" | "riesgo-del-dia" | "teclado";

export interface EstadoLupita {
  /** La ruta actual, la anota la posada desde el layout. */
  ruta: string | null;
  /** Motivos que la sacan aunque la ruta la admita. */
  retiradaPor: readonly MotivoRetiro[];
  /** El último gesto aceptado. `n` sube en cada uno para reiniciar la
   *  animación aunque se repita el tipo. */
  gesto: { tipo: GestoPosada; n: number } | null;
  ultimoGestoEn: number | null;
  /** Cuándo se aprobó una nota sin riesgo con la posada retirada. */
  aprobacionGuardada: number | null;
  /** Lupitas de contenido de 32 px o más a la vista (estados vacíos, el
   *  "procesando", el encabezado del panel). Con alguna, la posada queda
   *  quieta: una sola Lupita viva por pantalla. */
  vivasEnContenido: number;
}

export const ESTADO_INICIAL: EstadoLupita = {
  ruta: null,
  retiradaPor: [],
  gesto: null,
  ultimoGestoEn: null,
  aprobacionGuardada: null,
  vivasEnContenido: 0,
};

export function posadaVisible(e: EstadoLupita): boolean {
  return admitePosada(e.ruta) && e.retiradaPor.length === 0;
}

/** Visible y sin otra Lupita viva en pantalla: respira y parpadea. */
export function posadaViva(e: EstadoLupita): boolean {
  return posadaVisible(e) && e.vivasEnContenido === 0;
}

function enEnfriamiento(e: EstadoLupita, ahora: number): boolean {
  return e.ultimoGestoEn !== null && ahora - e.ultimoGestoEn < ENFRIAMIENTO_MS;
}

/** Intenta un gesto. Si la posada no está o está en enfriamiento, se pierde:
 *  nunca se encola. */
function gesticular(e: EstadoLupita, tipo: GestoPosada, ahora: number): EstadoLupita {
  if (!posadaVisible(e) || enEnfriamiento(e, ahora)) return e;
  return {
    ...e,
    gesto: { tipo, n: (e.gesto?.n ?? 0) + 1 },
    ultimoGestoEn: ahora,
  };
}

/** Si la posada acaba de volver y hay una aprobación guardada vigente, la
 *  hace; vencida o no, la descarta. */
function alVolver(previo: EstadoLupita, e: EstadoLupita, ahora: number): EstadoLupita {
  if (posadaVisible(previo) || !posadaVisible(e) || e.aprobacionGuardada === null) return e;
  const vigente = ahora - e.aprobacionGuardada < VENCE_APROBACION_MS;
  const sin = { ...e, aprobacionGuardada: null };
  return vigente ? gesticular(sin, "asiente", ahora) : sin;
}

export function cambiarRuta(e: EstadoLupita, ruta: string | null, ahora: number): EstadoLupita {
  if (e.ruta === ruta) return e;
  return alVolver(e, { ...e, ruta }, ahora);
}

export function retirar(
  e: EstadoLupita,
  motivo: MotivoRetiro,
  activo: boolean,
  ahora: number,
): EstadoLupita {
  const esta = e.retiradaPor.includes(motivo);
  if (esta === activo) return e;
  const retiradaPor = activo
    ? [...e.retiradaPor, motivo]
    : e.retiradaPor.filter((m) => m !== motivo);
  return alVolver(e, { ...e, retiradaPor }, ahora);
}

export function avisar(e: EstadoLupita, evento: EventoLupita, ahora: number): EstadoLupita {
  switch (evento) {
    case "toque":
      return gesticular(e, "saludo", ahora);
    case "cobrada":
      return gesticular(e, "cobro", ahora);
    case "aprobada":
      // Con la posada a la vista, asiente ahí. Si no —lo normal: se aprueba
      // en la nota, que es clínica—, se guarda una sola para cuando vuelva.
      return posadaVisible(e)
        ? gesticular(e, "asiente", ahora)
        : { ...e, aprobacionGuardada: ahora };
  }
}

export function contarViva(e: EstadoLupita, delta: 1 | -1): EstadoLupita {
  return { ...e, vivasEnContenido: Math.max(0, e.vivasEnContenido + delta) };
}

// ────────────────────────────────────────────────────────────────────────────
// Almacén compartido, en memoria.
// ────────────────────────────────────────────────────────────────────────────

let actual: EstadoLupita = ESTADO_INICIAL;
const oyentes = new Set<() => void>();

export function obtenerLupita(): EstadoLupita {
  return actual;
}

export function suscribirLupita(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

function actualizar(cambio: (e: EstadoLupita) => EstadoLupita): void {
  const nuevo = cambio(actual);
  if (nuevo === actual) return;
  actual = nuevo;
  for (const oyente of oyentes) oyente();
}

/** Algo que ella hizo y que la posada celebra (o guarda, si no está).
 *  Devuelve si hubo gesto: el toque lo usa para esperar el saludo antes de
 *  abrir el panel. Quien llama decide la regla del riesgo ANTES: `aprobada`
 *  sólo con `clavesDeRiesgo` vacío, `cobrada` sólo en Hoy y sin riesgo en el
 *  día (06, D2). */
export function avisarLupita(evento: EventoLupita): boolean {
  const antes = actual.gesto;
  actualizar((e) => avisar(e, evento, Date.now()));
  return actual.gesto !== antes;
}

export function retirarLupita(motivo: MotivoRetiro, activo: boolean): void {
  actualizar((e) => retirar(e, motivo, activo, Date.now()));
}

export function anotarRutaLupita(ruta: string | null): void {
  actualizar((e) => cambiarRuta(e, ruta, Date.now()));
}

export function anotarLupitaViva(delta: 1 | -1): void {
  actualizar((e) => contarViva(e, delta));
}

// ─── Parpadeo ───────────────────────────────────────────────────────────────
// Un contador aparte, para que cada parpadeo re-dibuje sólo a las Lupitas
// vivas que se suscriben a él y no a todo lo que lee el estado de arriba.
// El reloj lo lleva la posada (presencia-lupita.tsx): uno solo para la app.

let parpadeos = 0;
const oyentesParpadeo = new Set<() => void>();

export function obtenerParpadeo(): number {
  return parpadeos;
}

export function suscribirParpadeo(oyente: () => void): () => void {
  oyentesParpadeo.add(oyente);
  return () => oyentesParpadeo.delete(oyente);
}

export function parpadear(): void {
  parpadeos += 1;
  for (const oyente of oyentesParpadeo) oyente();
}

/** Sólo para tests: vuelve el almacén al principio. */
export function reiniciarLupitaParaTests(): void {
  actual = ESTADO_INICIAL;
  parpadeos = 0;
}
