"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

import { ApiClientError, esAbort } from "@/lib/api-client";
import {
  ALGO_FALLO,
  AYUDA_BIENVENIDA,
  AYUDA_CERRAR,
  AYUDA_DIJO_LUPITA,
  AYUDA_DIJO_USUARIA,
  AYUDA_ENVIAR,
  AYUDA_ESPERANDO,
  AYUDA_HILO,
  AYUDA_NO_SE_GUARDA,
  AYUDA_PANEL,
  AYUDA_PLACEHOLDER,
  AYUDA_PREGUNTAS_INICIALES,
  AYUDA_PRIVACIDAD,
  AYUDA_SIN_CONEXION,
  AYUDA_STREAM_CORTADO,
  AYUDA_TOPE_DIARIO,
  LUPITA,
} from "@/lib/glosario";
import {
  Lupita, TAMANOS_LUPITA, DURACION_BROTA, DURACION_CELEBRA,
  type MovimientoLupita,
} from "@/components/ui/lupita";
import { AnilloProgreso } from "@/components/ui/movimiento";
import { Sheet } from "@/components/ui/sheet";

const LARGO_MAX_PREGUNTA = 600;
const MAX_TURNOS_ENVIADOS = 12;
const STATUS_TOPE_DIARIO = 429;

/** Única definición de superficies donde el personaje no puede aparecer. */
export const PREFIJOS_RUTA_CLINICA = [
  "/sesiones/",
  "/grabar/",
  "/pacientes/",
] as const;

interface Turno {
  rol: "usuaria" | "asistente";
  texto: string;
  completo?: boolean;
}

export function esRutaClinica(pathname: string): boolean {
  return PREFIJOS_RUTA_CLINICA.some((prefijo) => pathname.startsWith(prefijo));
}

export function textoDeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.status === STATUS_TOPE_DIARIO ? AYUDA_TOPE_DIARIO : ALGO_FALLO;
  }
  return AYUDA_SIN_CONEXION;
}

export interface PanelAyudaProps {
  abierto: boolean;
  alCerrar: () => void;
}

export function PanelAyuda({ abierto, alCerrar }: PanelAyudaProps) {
  const pathname = usePathname();
  const sinPersonaje = esRutaClinica(pathname);
  const reducido = useReducedMotion();
  const [turnos, setTurnos] = React.useState<Turno[]>([]);
  const [borrador, setBorrador] = React.useState("");
  const [esperando, setEsperando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [movimiento, setMovimiento] = React.useState<MovimientoLupita>(abierto ? "brota" : "quieta");
  const [fragmentosRecibidos, setFragmentosRecibidos] = React.useState(0);
  const hilo = React.useRef<HTMLDivElement>(null);
  const peticion = React.useRef<AbortController | null>(null);
  const respuestaParcial = React.useRef("");

  const [estabaAbierto, setEstabaAbierto] = React.useState(abierto);
  if (estabaAbierto !== abierto) {
    setEstabaAbierto(abierto);
    setMovimiento(abierto ? "brota" : "quieta");
    setFragmentosRecibidos(0);
    if (!abierto) {
      setTurnos([]);
      setBorrador("");
      setError(null);
      setEsperando(false);
    }
  }

  React.useEffect(() => {
    if (abierto) return;
    peticion.current?.abort();
    peticion.current = null;
  }, [abierto]);

  React.useEffect(() => {
    const nodo = hilo.current;
    if (nodo) nodo.scrollTop = nodo.scrollHeight;
  }, [turnos, esperando, error]);

  React.useEffect(() => {
    if (!abierto || (movimiento !== "brota" && movimiento !== "celebra")) return;
    const duracion = movimiento === "brota" ? DURACION_BROTA : DURACION_CELEBRA;
    const timer = window.setTimeout(() => setMovimiento("respira"), duracion * 1000);
    return () => window.clearTimeout(timer);
  }, [abierto, movimiento]);

  async function preguntar(pregunta: string) {
    const historial = turnos
      .filter((turno) => turno.completo !== false)
      .slice(-MAX_TURNOS_ENVIADOS)
      .map(({ rol, texto }) => ({ rol, texto }));
    setTurnos((previos) => [...previos, { rol: "usuaria", texto: pregunta }]);
    setBorrador("");
    setError(null);
    setEsperando(true);
    setMovimiento("piensa");
    setFragmentosRecibidos(0);

    const control = new AbortController();
    peticion.current = control;
    const vigente = () => peticion.current === control;
    respuestaParcial.current = "";

    try {
      const respuesta = await fetch("/api/ayuda", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pregunta,
          ...(historial.length > 0 ? { historial } : {}),
        }),
        signal: control.signal,
      });
      if (!respuesta.ok) {
        throw new ApiClientError("No se pudo responder", respuesta.status);
      }
      if (!respuesta.body) throw new TypeError("respuesta sin stream");

      const lector = respuesta.body.getReader();
      const decodificador = new TextDecoder();
      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        if (!vigente()) return;
        const fragmento = decodificador.decode(value, { stream: true });
        if (fragmento === "") continue;
        setMovimiento("habla");
        setFragmentosRecibidos((cantidad) => cantidad + 1);
        respuestaParcial.current += fragmento;
        const acumulado = respuestaParcial.current;
        setTurnos((previos) => {
          const ultimo = previos.at(-1);
          if (ultimo?.rol === "asistente" && ultimo.completo === false) {
            return [
              ...previos.slice(0, -1),
              { ...ultimo, texto: acumulado },
            ];
          }
          return [
            ...previos,
            { rol: "asistente", texto: acumulado, completo: false },
          ];
        });
      }

      if (!vigente()) return;
      setTurnos((previos) => {
        const ultimo = previos.at(-1);
        return ultimo?.rol === "asistente"
          ? [...previos.slice(0, -1), { ...ultimo, completo: true }]
          : previos;
      });
      setMovimiento("celebra");
    } catch (e) {
      if (esAbort(e) || !vigente()) return;
      setMovimiento("respira");
      if (respuestaParcial.current !== "") {
        setError(AYUDA_STREAM_CORTADO);
      } else {
        setTurnos((previos) => previos.slice(0, -1));
        setBorrador(pregunta);
        setError(textoDeError(e));
      }
    } finally {
      if (vigente()) {
        setEsperando(false);
        peticion.current = null;
      }
    }
  }

  function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    const pregunta = borrador.trim();
    if (pregunta === "" || esperando) return;
    void preguntar(pregunta);
  }

  const primeraImpresion = turnos.length === 0 && !esperando && error === null;

  return (
    <Sheet
      open={abierto}
      onClose={alCerrar}
      variante="lateral"
      maxWidth={440}
      ariaLabel={AYUDA_PANEL}
    >
      <div className="flex h-[70vh] min-h-0 flex-col lg:h-auto lg:flex-1">
        <div className="flex shrink-0 items-start gap-3 pb-4">
          {!sinPersonaje ? (
            <span
              aria-hidden="true"
              className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-cream-100"
            >
              <Lupita
                pose={movimiento === "piensa" ? "senala"
                  : movimiento === "celebra" || (reducido && !esperando && turnos.at(-1)?.completo)
                    ? "celebra" : "saluda"}
                tamano={TAMANOS_LUPITA.encabezado}
                movimiento={movimiento}
                pulso={fragmentosRecibidos}
              />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="font-display text-[17px] font-medium leading-tight text-ink-900">
              {LUPITA}
            </p>
            <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink-500">
              {AYUDA_BIENVENIDA}
            </p>
            <p className="mt-1 font-sans text-[12px] leading-[1.5] text-ink-300">
              {AYUDA_PRIVACIDAD}
            </p>
          </div>
          <button
            type="button"
            onClick={alCerrar}
            aria-label={AYUDA_CERRAR}
            title={AYUDA_CERRAR}
            className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors duration-150 hover:bg-cream-100 hover:text-ink-900"
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <div
          ref={hilo}
          role="log"
          aria-label={AYUDA_HILO}
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-[color:var(--border-subtle)] py-4"
        >
          {primeraImpresion ? (
            <div className="flex flex-col gap-2">
              {AYUDA_PREGUNTAS_INICIALES.map((pregunta) => (
                <button
                  key={pregunta}
                  type="button"
                  onClick={() => void preguntar(pregunta)}
                  className="min-h-11 rounded-md border border-[color:var(--border-subtle)] bg-white px-3.5 py-2.5 text-left font-sans text-[14px] leading-[1.45] text-ink-700 transition-colors duration-150 hover:bg-cream-100"
                >
                  {pregunta}
                </button>
              ))}
            </div>
          ) : null}

          {turnos.map((turno, indice) =>
            turno.rol === "usuaria" ? (
              <p
                key={indice}
                className="ml-auto max-w-[85%] rounded-md bg-sage-50 px-3.5 py-2.5 font-sans text-[14px] leading-[1.5] text-ink-900"
              >
                <span className="sr-only">{AYUDA_DIJO_USUARIA} </span>
                {turno.texto}
              </p>
            ) : (
              <div key={indice} className="flex max-w-[92%] items-start gap-2">
                {!sinPersonaje ? (
                  <Lupita
                    pose="senala"
                    movimiento="quieta"
                    tamano={TAMANOS_LUPITA.inline}
                    className="mt-0.5 shrink-0"
                  />
                ) : null}
                <p className="whitespace-pre-wrap font-sans text-[14px] leading-[1.6] text-ink-700">
                  <span className="sr-only">{AYUDA_DIJO_LUPITA} </span>
                  {turno.texto}
                </p>
              </div>
            ),
          )}

          {esperando && turnos.at(-1)?.rol !== "asistente" ? (
            <p className="flex items-center gap-2 font-sans text-[13px] text-ink-500">
              {!sinPersonaje ? (
                <Lupita
                  pose="senala"
                  movimiento="quieta"
                  tamano={TAMANOS_LUPITA.inline}
                />
              ) : (
                <AnilloProgreso tamano={16} className="shrink-0 text-sage-500" />
              )}
              {AYUDA_ESPERANDO}
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-cream-100 px-3.5 py-2.5 font-sans text-[13px] leading-[1.5] text-ink-700"
            >
              {error}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={alEnviar}
          className="shrink-0 border-t border-[color:var(--border-subtle)] pt-4"
        >
          <div className="flex items-end gap-2">
            <input
              type="text"
              value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              maxLength={LARGO_MAX_PREGUNTA}
              placeholder={AYUDA_PLACEHOLDER}
              aria-label={AYUDA_PLACEHOLDER}
              autoComplete="off"
              className="min-h-[44px] min-w-0 flex-1 rounded-sm border border-[color:var(--border-subtle)] bg-cream-50 px-[14px] py-[10px] font-sans text-[15px] text-ink-900 outline-none transition-colors duration-150 placeholder:text-ink-300 focus:border-sage-500 focus:bg-white focus:ring-[3px] focus:ring-sage-500/20"
            />
            <button
              type="submit"
              disabled={esperando || borrador.trim() === ""}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-md bg-sage-500 px-4 font-sans text-[14px] font-semibold leading-none text-white transition-colors duration-150 hover:bg-sage-600 active:bg-sage-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {AYUDA_ENVIAR}
            </button>
          </div>
          <p className="mt-2 font-sans text-[12px] leading-[1.4] text-ink-300">
            {AYUDA_NO_SE_GUARDA}
          </p>
        </form>
      </div>
    </Sheet>
  );
}
