"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Confirmar, Sheet } from "@/components/ui";
import { IR_IGUAL, QUEDARME, SALIDA_TRABAJO_TITULO } from "@/lib/glosario";

type OpcionesSalida = { mensaje?: string; navegar?: boolean; etiqueta?: string };
type Salida = { accion: () => void; mensaje: string; etiqueta: string };
type Proteccion = {
  registrar: (clave: symbol, mensaje: string) => () => void;
  solicitar: (accion: () => void, opciones?: OpcionesSalida) => void;
};
const Contexto = createContext<Proteccion | null>(null);
const POSICION = "__sesionPosicion";
const TRAMO = "__sesionTramo";

/** Una protección para nota, Recorrido y captura. En el historial solo guarda
 * índices de navegación, nunca texto clínico. */
export function ProteccionTrabajo({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const motivos = useRef(new Map<symbol, string>());
  const [salida, setSalida] = useState<Salida | null>(null);
  const autorizada = useRef(false);
  const registrar = useCallback((clave: symbol, mensaje: string) => {
    autorizada.current = false;
    motivos.current.set(clave, mensaje);
    return () => { motivos.current.delete(clave); };
  }, []);
  const solicitar = useCallback((accion: () => void, { mensaje, navegar = false, etiqueta = IR_IGUAL }: OpcionesSalida = {}) => {
    const motivo = mensaje ?? motivos.current.values().next().value;
    if (!motivo) { accion(); return; }
    setSalida({ accion: () => { autorizada.current = navegar; accion(); }, mensaje: motivo, etiqueta });
  }, []);

  useEffect(() => {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    let posicion = Number(history.state?.[POSICION] ?? 0);
    let tramo = history.state?.[TRAMO] ?? crypto.randomUUID();
    let estadoActual = history.state;
    let urlActual = location.href;
    let restaurando: (() => void) | null = null;
    originalReplace.call(history, { ...history.state, [POSICION]: posicion, [TRAMO]: tramo }, "");
    estadoActual = history.state;
    // Se conservan el estado y los manejadores de Next. Cada entrada real
    // recibe un índice para poder deshacer Atrás/Adelante sin desmontar el editor.
    const push: History["pushState"] = function (estado, titulo, url) {
      originalPush.call(history, { ...estado, [POSICION]: ++posicion, [TRAMO]: tramo }, titulo, url);
      estadoActual = history.state; urlActual = location.href;
    };
    const replace: History["replaceState"] = function (estado, titulo, url) {
      originalReplace.call(history, { ...estado, [POSICION]: posicion, [TRAMO]: tramo }, titulo, url);
      estadoActual = history.state; urlActual = location.href;
    };
    history.pushState = push;
    history.replaceState = replace;
    const alVolver = (e: PopStateEvent) => {
      const destino = e.state?.[TRAMO] === tramo && Number.isInteger(e.state?.[POSICION]) ? e.state[POSICION] as number : null;
      if (destino === null) {
        // History no informa cuántas entradas se saltaron antes de montar
        // el dashboard. Nunca adivinar un delta: preguntar sin ceder el
        // evento a Next. Al cancelar, reponer la entrada del editor y
        // empezar un tramo nuevo (el navegador descarta su rama Adelante).
        const motivo = motivos.current.values().next().value;
        const continuar = autorizada.current || !motivo || window.confirm(motivo);
        autorizada.current = false;
        tramo = crypto.randomUUID(); posicion = 0; restaurando = null;
        if (!continuar) {
          e.stopImmediatePropagation();
          originalPush.call(history, { ...estadoActual, [POSICION]: posicion, [TRAMO]: tramo }, "", urlActual);
        } else {
          originalReplace.call(history, { ...e.state, [POSICION]: posicion, [TRAMO]: tramo }, "");
          urlActual = location.href;
        }
        estadoActual = history.state;
        return;
      }
      if (restaurando) {
        if (destino !== posicion) { e.stopImmediatePropagation(); history.go(posicion - destino); return; }
        const preguntar = restaurando; restaurando = null;
        e.stopImmediatePropagation(); preguntar(); return;
      }
      if (autorizada.current || motivos.current.size === 0 || destino === posicion) {
        autorizada.current = false; posicion = destino;
        estadoActual = history.state; urlActual = location.href; return;
      }
      e.stopImmediatePropagation();
      const distancia = destino - posicion;
      restaurando = () => solicitar(() => history.go(distancia), { navegar: true });
      history.go(-distancia);
    };
    const alSalir = (e: BeforeUnloadEvent) => {
      if (motivos.current.size && !autorizada.current) { e.preventDefault(); e.returnValue = ""; }
    };
    const nuevaInteraccion = () => { autorizada.current = false; };
    const alEnlace = (e: MouseEvent) => {
      if (!motivos.current.size || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const enlace = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!enlace || enlace.hasAttribute("download") || (enlace.target && enlace.target !== "_self")) return;
      const destino = new URL(enlace.href, location.href);
      if (destino.protocol !== "http:" && destino.protocol !== "https:") return;
      if (destino.pathname === location.pathname && destino.search === location.search && destino.origin === location.origin) return;
      e.preventDefault(); e.stopPropagation();
      solicitar(() => {
        if (destino.origin === location.origin) router.push(destino.pathname + destino.search + destino.hash);
        else location.assign(destino.href);
      }, { navegar: destino.origin !== location.origin });
    };
    window.addEventListener("popstate", alVolver, true);
    window.addEventListener("beforeunload", alSalir);
    document.addEventListener("click", alEnlace, true);
    document.addEventListener("pointerdown", nuevaInteraccion, true);
    document.addEventListener("keydown", nuevaInteraccion, true);
    return () => {
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
      window.removeEventListener("popstate", alVolver, true);
      window.removeEventListener("beforeunload", alSalir);
      document.removeEventListener("click", alEnlace, true);
      document.removeEventListener("pointerdown", nuevaInteraccion, true);
      document.removeEventListener("keydown", nuevaInteraccion, true);
    };
  }, [router, solicitar]);

  const contexto = useMemo(() => ({ registrar, solicitar }), [registrar, solicitar]);
  return <Contexto.Provider value={contexto}>
    {children}
    <Sheet open={salida !== null} onClose={() => setSalida(null)} ariaLabel={SALIDA_TRABAJO_TITULO} maxWidth={480}>
      {salida && <Confirmar titulo={SALIDA_TRABAJO_TITULO} mensaje={salida.mensaje} accion={salida.etiqueta} cancelar={QUEDARME} variante="peligro"
        onCancelar={() => setSalida(null)} onConfirmar={() => {
          setSalida(null);
          salida.accion();
          // Atrás es asíncrono: el permiso dura hasta esa navegación o
          // hasta el siguiente gesto, no un temporizador que compita con ella.
        }} />}
    </Sheet>
  </Contexto.Provider>;
}

export function useProtegerTrabajo(activo: boolean, mensaje: string) {
  const proteccion = useContext(Contexto);
  const clave = useRef(Symbol("trabajo clínico"));
  useEffect(() => {
    if (activo && proteccion) return proteccion.registrar(clave.current, mensaje);
  }, [activo, mensaje, proteccion]);
}

/** Para pestañas y acciones que navegan sin un enlace. Fuera del dashboard
 * los componentes siguen siendo presentacionales (por ejemplo, en pruebas). */
export function useSalidaProtegida() {
  const proteccion = useContext(Contexto);
  return proteccion?.solicitar ?? ((accion: () => void) => accion());
}
