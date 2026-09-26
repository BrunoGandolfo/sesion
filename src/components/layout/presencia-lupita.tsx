"use client";

// La posada: Lupita como presencia (docs/diseno/06-lupita-presencia.md).
//
// Un solo dibujo para toda la app, montado una vez en el layout del panel.
// En el teléfono está posada SOBRE el menú de abajo, en la esquina derecha,
// con la base del tallo apoyada en el borde de la barra; en la computadora,
// en un hueco fijo del lateral (sidebar.tsx lo expone arriba del bloque de
// usuario). Una instancia, un estado, dos lugares según el ancho.
//
// QUÉ HACE
//
// - Aparece sólo en Hoy, Agenda, Pacientes, Cobros y Configuración (la
//   lista vive en lib/lupita-presencia.ts) y se retira con el brota al revés
//   en cualquier otra ruta: /grabar/*, la ficha, la nota, /deudores...
// - Se retira también con un sheet abierto (el velo la cubriría igual; con
//   el chat, ella "se muda" al encabezado del panel), con el teclado del
//   teléfono abierto y en Hoy el día que hay una señal de riesgo.
// - En reposo respira y parpadea, salvo que haya otra Lupita viva en la
//   pantalla (un estado vacío, el "procesando"): una sola viva por pantalla.
// - Hace los gestos que le manda el almacén (saludo, cobro, asiente).
// - Se toca: saluda y abre el chat. Es un atajo de PUNTERO: aria-hidden y
//   fuera del orden de tabulación, porque el ítem "Lupita" del menú ya es el
//   control accesible, y dos botones con el mismo nombre uno arriba del otro
//   confunden a un lector de pantalla.
//
// Los menús no animan nada: su ítem de Lupita es un dibujo quieto de 20 px
// que llama a `useTocarLupita`, igual que la posada.

import * as React from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import { Lupita, DURACION_BROTA, DURACION_DE_GESTO } from "@/components/ui/lupita";
import { useMovimientoReducido } from "@/hooks/useMovimientoReducido";
import {
  ALTO_MENU_MOVIL,
  ESTADO_INICIAL,
  LADO_POSADA,
  anotarRutaLupita,
  avisarLupita,
  obtenerLupita,
  parpadear,
  posadaViva,
  posadaVisible,
  retirarLupita,
  suscribirLupita,
  type EstadoLupita,
} from "@/lib/lupita-presencia";
import { SUAVE, TIEMPOS_LUPITA } from "@/lib/movimiento";

import { useAbrirAyuda } from "./ayuda-del-panel";

/** El hueco del lateral donde se posa en la computadora. */
export const ID_HUECO_LATERAL = "lupita-posada-lateral";

/** Área tocable: 44 × 44, el mínimo de la app. */
const TOCABLE = 44;

/** En la grilla de 24 el tallo arranca en y = 21,5: debajo quedan 2,5
 *  unidades vacías. Se bajan para que la base toque el borde del menú. */
const AIRE_BAJO_EL_TALLO = Math.round((LADO_POSADA * 2.5) / 24);

// El reloj del parpadeo (06, sección 3): cada 4 a 9 s, y uno de cada seis es
// doble, con 160 ms entre el primero y el segundo. No son duraciones de
// animación —ésas están en TIEMPOS_LUPITA— sino cada cuánto pasa.
const PARPADEO_CADA_MIN_MS = 4000;
const PARPADEO_CADA_MAX_MS = 9000;
const ENTRE_PARPADEOS_DOBLES_MS = 160;
const PROBABILIDAD_DOBLE = 1 / 6;

// ─── El ancho ───────────────────────────────────────────────────────────────

/** El ancho en que se ve el lateral (`lg`, 64rem: el `hidden lg:flex` del
 *  <aside>). En el servidor, falso. Lo usan la posada y el lateral. */
const CONSULTA_ESCRITORIO = "(min-width: 64rem)";

function suscribirAncho(avisar: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const consulta = window.matchMedia(CONSULTA_ESCRITORIO);
  consulta.addEventListener("change", avisar);
  return () => consulta.removeEventListener("change", avisar);
}

export function useEsEscritorio(): boolean {
  return React.useSyncExternalStore(
    suscribirAncho,
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(CONSULTA_ESCRITORIO).matches,
    () => false,
  );
}

// ─── Tocarla ────────────────────────────────────────────────────────────────

/** Tocar a Lupita, desde la posada o desde el ítem del menú: si la posada
 *  está a la vista saluda, y el chat se abre cuando termina el saludo (06:
 *  "450 ms + 220 ms, en secuencia"). Si no hubo saludo —otra ruta, el
 *  enfriamiento, movimiento reducido—, se abre enseguida. */
export function useTocarLupita(): () => void {
  const abrir = useAbrirAyuda();
  const reducido = useMovimientoReducido();
  return React.useCallback(() => {
    const saludo = avisarLupita("toque");
    if (saludo && !reducido) window.setTimeout(abrir, TIEMPOS_LUPITA.gesto);
    else abrir();
  }, [abrir, reducido]);
}

// ─── Los motivos de retiro que se miran acá ─────────────────────────────────

/** Un sheet abierto: ui/sheet.tsx bloquea el scroll del body mientras está
 *  abierto, y eso es lo que se mira. Cubre los formularios y el panel de
 *  ayuda sin que cada uno tenga que avisar. */
function useRetiroPorSheet() {
  React.useEffect(() => {
    const mirar = () => retirarLupita("sheet", document.body.style.overflow === "hidden");
    mirar();
    const observador = new MutationObserver(mirar);
    observador.observe(document.body, { attributes: true, attributeFilter: ["style"] });
    return () => {
      observador.disconnect();
      retirarLupita("sheet", false);
    };
  }, []);
}

function abreTeclado(nodo: EventTarget | null): boolean {
  if (nodo instanceof HTMLTextAreaElement) return true;
  if (!(nodo instanceof HTMLInputElement)) return false;
  return !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(nodo.type);
}

/** El teclado del teléfono: en algunos navegadores los `fixed bottom` suben
 *  con él y la posada quedaría flotando sobre el campo (06, R4). */
function useRetiroPorTeclado(escritorio: boolean) {
  React.useEffect(() => {
    if (escritorio) return;
    const entra = (e: FocusEvent) => { if (abreTeclado(e.target)) retirarLupita("teclado", true); };
    const sale = (e: FocusEvent) => { if (abreTeclado(e.target)) retirarLupita("teclado", false); };
    document.addEventListener("focusin", entra);
    document.addEventListener("focusout", sale);
    return () => {
      document.removeEventListener("focusin", entra);
      document.removeEventListener("focusout", sale);
      retirarLupita("teclado", false);
    };
  }, [escritorio]);
}

/** Uno solo para la app, y sólo mientras haya alguna Lupita viva. */
function useRelojDeParpadeo(activo: boolean) {
  React.useEffect(() => {
    if (!activo) return;
    let siguiente: number | undefined;
    let doble: number | undefined;
    const programar = () => {
      const espera =
        PARPADEO_CADA_MIN_MS + Math.random() * (PARPADEO_CADA_MAX_MS - PARPADEO_CADA_MIN_MS);
      siguiente = window.setTimeout(() => {
        // Con la pestaña oculta no parpadea: el reloj sigue, el dibujo no.
        if (document.visibilityState === "visible") {
          parpadear();
          if (Math.random() < PROBABILIDAD_DOBLE) {
            doble = window.setTimeout(parpadear, TIEMPOS_LUPITA.parpadeo + ENTRE_PARPADEOS_DOBLES_MS);
          }
        }
        programar();
      }, espera);
    };
    programar();
    return () => {
      window.clearTimeout(siguiente);
      window.clearTimeout(doble);
    };
  }, [activo]);
}

// ─── La posada ──────────────────────────────────────────────────────────────

const sinSuscripcion = () => () => {};

function useEstadoLupita(): EstadoLupita {
  return React.useSyncExternalStore(suscribirLupita, obtenerLupita, () => ESTADO_INICIAL);
}

/** El gesto que se está viendo. Si llega justo cuando la posada aparece
 *  —la aprobación guardada—, espera a que termine de brotar: son dos
 *  reacciones seguidas, no una encima de la otra. */
function useGestoEnCurso(
  gesto: EstadoLupita["gesto"],
  aparecioEn: React.RefObject<number>,
  reducido: boolean,
) {
  const [enCurso, setEnCurso] = React.useState<EstadoLupita["gesto"]>(null);
  React.useEffect(() => {
    if (!gesto || reducido) return;
    const espera = Math.max(0, aparecioEn.current + DURACION_BROTA * 1000 - Date.now());
    const empieza = window.setTimeout(() => setEnCurso(gesto), espera);
    const termina = window.setTimeout(
      () => setEnCurso(null),
      espera + DURACION_DE_GESTO[gesto.tipo] * 1000,
    );
    return () => {
      window.clearTimeout(empieza);
      window.clearTimeout(termina);
    };
  }, [gesto, aparecioEn, reducido]);
  return reducido ? null : enCurso;
}

export function PresenciaLupita() {
  const pathname = usePathname();
  const estado = useEstadoLupita();
  const reducido = useMovimientoReducido();
  const escritorio = useEsEscritorio();
  const tocar = useTocarLupita();

  React.useEffect(() => {
    anotarRutaLupita(pathname);
  }, [pathname]);
  useRetiroPorSheet();
  useRetiroPorTeclado(escritorio);

  const visible = posadaVisible(estado);
  const viva = posadaViva(estado);
  useRelojDeParpadeo(!reducido && (viva || estado.vivasEnContenido > 0));

  const aparecioEn = React.useRef(0);
  React.useEffect(() => {
    if (visible) aparecioEn.current = Date.now();
  }, [visible]);
  const gesto = useGestoEnCurso(estado.gesto, aparecioEn, reducido);

  // En la computadora se posa en el hueco del lateral; se busca después de
  // montar, cuando el lateral ya está en el DOM.
  const hueco = React.useSyncExternalStore(
    sinSuscripcion,
    () => (escritorio ? document.getElementById(ID_HUECO_LATERAL) : null),
    () => null,
  );

  const movimiento = gesto ? gesto.tipo : viva ? "respira" : "quieta";
  const entrada = reducido
    ? { initial: false as const }
    : {
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 4 },
        transition: { duration: DURACION_BROTA, ease: SUAVE },
      };

  const posada = (
    <AnimatePresence>
      {visible ? (
        <motion.button
          key="posada"
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          data-lupita-posada={escritorio ? "lateral" : "menu"}
          onClick={tocar}
          {...entrada}
          style={
            escritorio
              ? { width: TOCABLE, height: TOCABLE }
              : {
                  width: TOCABLE,
                  height: TOCABLE,
                  bottom: ALTO_MENU_MOVIL,
                  // Centrada sobre el quinto ítem del menú (cada uno es un
                  // quinto del ancho), que es el de Lupita.
                  right: `calc(10% - ${TOCABLE / 2}px)`,
                }
          }
          className={
            escritorio
              ? "flex items-end justify-center"
              : "fixed z-30 flex items-end justify-center lg:hidden"
          }
        >
          <span className="pointer-events-none flex" style={{ marginBottom: escritorio ? 0 : -AIRE_BAJO_EL_TALLO }}>
            <Lupita
              pose="saluda"
              tamano={LADO_POSADA}
              movimiento={movimiento}
              vez={gesto?.n ?? 0}
              enPosada
            />
          </span>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );

  if (escritorio) return hueco ? createPortal(posada, hueco) : null;
  return posada;
}
