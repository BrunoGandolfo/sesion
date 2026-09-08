"use client";

// El panel de ayuda: preguntarle a Lupita cómo se hace algo en la app.
//
// QUÉ ES Y QUÉ NO ES
//
// No es un chat. Es una ayuda que se abre encima de la pantalla en la que
// ella ya estaba, se pregunta algo y se cierra. Por eso el hilo vive en
// estado de React y se pierde al cerrar: guardar la conversación obligaría a
// decidir dónde se guarda —una pregunta de ayuda puede llevar adentro el
// nombre de una paciente ("no me sale la nota de X")— y la ruta ya se cuida
// de no auditar el texto justamente por eso.
//
// EL HISTORIAL
//
// Se manda entero en cada pedido, en la forma que pide preguntaSchema
// (src/app/api/ayuda/route.ts): una lista de { rol, texto } del más viejo al
// más nuevo. El servidor recorta a los últimos MAX_TURNOS_HISTORIAL; acá se
// recorta a lo que la ruta acepta para no armar un cuerpo que va a rebotar
// con 400.
//
// SIN STREAMING
//
// La respuesta llega entera o no llega: el cliente de Anthropic no
// transmite a propósito (ver anthropic-mensajes.ts). Mientras tanto se
// muestra AnilloProgreso, que es lo que la app usa para "esto está
// trabajando y no sabemos cuánto falta".
//
// LOS ERRORES
//
// Tres, y ninguno cuenta por qué: sin conexión, tope diario y cualquier otra
// cosa. El detalle técnico —el status, el proveedor, el mensaje del error—
// queda en el log de la función. Los textos salen del glosario.

import * as React from "react";
import { X } from "lucide-react";

import { ApiClientError, apiPost, esAbort } from "@/lib/api-client";
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
  AYUDA_SIN_CONEXION,
  AYUDA_TOPE_DIARIO,
  LUPITA,
} from "@/lib/glosario";
import { Lupita, TAMANOS_LUPITA } from "@/components/ui/lupita";
import { AnilloProgreso } from "@/components/ui/movimiento";
import { Sheet } from "@/components/ui/sheet";

/**
 * Largo máximo de la pregunta. Es el mismo LARGO_MAX_PREGUNTA del caso de
 * uso (src/app/api/_lib/casos-uso/responder-ayuda.ts), repetido acá porque
 * ese módulo arrastra Prisma y el corpus, que lee del disco: no se puede
 * importar desde un componente cliente. Si allá cambia, cambia acá.
 */
const LARGO_MAX_PREGUNTA = 600;

/**
 * Cuántos turnos se mandan. La ruta acepta hasta MAX_TURNOS_HISTORIAL * 2
 * = 12 y rechaza el cuerpo entero si se pasa; el caso de uso después se
 * queda con los últimos 6. Misma nota que arriba: el número está repetido, no
 * importado.
 */
const MAX_TURNOS_ENVIADOS = 12;

/** El status con el que la ruta contesta el tope diario. */
const STATUS_TOPE_DIARIO = 429;

/** Un turno del hilo, en la forma que espera la API. */
interface Turno {
  rol: "usuaria" | "asistente";
  texto: string;
}

interface RespuestaAyuda {
  respuesta: string;
}

/**
 * Traduce lo que falló a lo que se le dice. Nunca se muestra el mensaje del
 * error: ni el del servidor, ni el de fetch.
 *
 * Un fallo de red no llega como ApiClientError —fetch tira TypeError antes
 * de que haya respuesta que leer—, así que todo lo que no sea una respuesta
 * de la API se lee como falta de conexión.
 */
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
  const [turnos, setTurnos] = React.useState<Turno[]>([]);
  const [borrador, setBorrador] = React.useState("");
  const [esperando, setEsperando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const hilo = React.useRef<HTMLDivElement>(null);
  const peticion = React.useRef<AbortController | null>(null);

  // El hilo no sobrevive al cierre. El componente sí —lo monta el menú, que
  // no se desmonta al navegar—, así que vaciarlo es trabajo de acá.
  //
  // Se vacía durante el render en el que `abierto` pasó a false, y no en un
  // efecto: es el ajuste de estado ante un cambio de prop, que React resuelve
  // así y que además evita el render intermedio con el hilo viejo a la vista.
  const [estabaAbierto, setEstabaAbierto] = React.useState(abierto);
  if (estabaAbierto !== abierto) {
    setEstabaAbierto(abierto);
    if (!abierto) {
      setTurnos([]);
      setBorrador("");
      setError(null);
      setEsperando(false);
    }
  }

  // Si quedaba una pregunta en el aire cuando cerró, se corta. Sin esto la
  // respuesta llega después del cierre y aparece sola la próxima vez que
  // abra, contestando algo que ella ya no está preguntando.
  React.useEffect(() => {
    if (abierto) return;
    peticion.current?.abort();
    peticion.current = null;
  }, [abierto]);

  // El hilo se sigue leyendo desde abajo, como una conversación: cada turno
  // nuevo y cada espera dejan el final a la vista.
  React.useEffect(() => {
    const nodo = hilo.current;
    if (nodo) nodo.scrollTop = nodo.scrollHeight;
  }, [turnos, esperando, error]);

  async function preguntar(pregunta: string) {
    // El turno de ella entra al hilo antes de que conteste el servidor: lo
    // que escribió tiene que quedar a la vista mientras espera.
    const historial = turnos.slice(-MAX_TURNOS_ENVIADOS);
    setTurnos((previos) => [...previos, { rol: "usuaria", texto: pregunta }]);
    setBorrador("");
    setError(null);
    setEsperando(true);

    const control = new AbortController();
    peticion.current = control;

    // Identidad de la petición. Entre que esta sale y vuelve, el panel se
    // puede haber cerrado y reabierto con otra pregunta en curso: entonces
    // `peticion.current` ya no es este controller y esta petición dejó de
    // tener derecho a tocar el estado. Sin esta guarda, el `finally` de la
    // vieja apagaba el `esperando` de la nueva —el anillo desaparecía con la
    // respuesta todavía en camino— y una respuesta tardía se colaba en un
    // hilo que ya no era el suyo.
    //
    // No alcanza con abortar al cerrar: abortar corta el fetch, pero si la
    // respuesta ya había llegado, la promesa se resuelve igual y el `then`
    // corre lo mismo.
    const vigente = () => peticion.current === control;

    try {
      const { respuesta } = await apiPost<RespuestaAyuda>(
        "/api/ayuda",
        {
          pregunta,
          // El array vacío no se manda: el campo es opcional y una lista
          // vacía dice lo mismo con más bytes.
          ...(historial.length > 0 ? { historial } : {}),
        },
        { signal: control.signal },
      );
      if (!vigente()) return;
      setTurnos((previos) => [
        ...previos,
        { rol: "asistente", texto: respuesta },
      ]);
    } catch (e) {
      if (esAbort(e) || !vigente()) return;
      // La pregunta que no se contestó sale del hilo y vuelve al campo. Dos
      // motivos: así el hilo queda siempre en pares pregunta/respuesta, que
      // es lo que la API espera recibir, y así ella puede corregirla y
      // mandarla de nuevo sin volver a escribirla.
      setTurnos((previos) => previos.slice(0, -1));
      setBorrador(pregunta);
      setError(textoDeError(e));
    } finally {
      // El `finally` corre incluso después de los `return` de arriba, así
      // que la guarda va también acá: el `esperando` lo apaga la petición
      // que lo prendió, y ninguna otra.
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

  return (
    <Sheet
      open={abierto}
      onClose={alCerrar}
      variante="lateral"
      maxWidth={440}
      ariaLabel={AYUDA_PANEL}
    >
      {/* En mobile el panel mide 70vh y el resto de la pantalla sigue
          viéndose detrás; en desktop llena la columna lateral. En los dos, lo
          único que scrollea es el hilo. */}
      <div className="flex h-[70vh] min-h-0 flex-col lg:h-auto lg:flex-1">
        {/* Encabezado */}
        <div className="flex shrink-0 items-start gap-3 pb-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cream-100"
          >
            <Lupita pose="saluda" tamano={TAMANOS_LUPITA.encabezado} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[17px] font-medium leading-tight text-ink-900">
              {LUPITA}
            </p>
            <p className="mt-1 font-sans text-[13px] leading-[1.5] text-ink-500">
              {AYUDA_BIENVENIDA}
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

        {/* Hilo */}
        <div
          ref={hilo}
          role="log"
          aria-label={AYUDA_HILO}
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-[color:var(--border-subtle)] py-4"
        >
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
                <Lupita
                  pose="senala"
                  tamano={TAMANOS_LUPITA.inline}
                  className="mt-0.5 shrink-0"
                />
                <p className="whitespace-pre-wrap font-sans text-[14px] leading-[1.6] text-ink-700">
                  <span className="sr-only">{AYUDA_DIJO_LUPITA} </span>
                  {turno.texto}
                </p>
              </div>
            ),
          )}

          {esperando ? (
            <p className="flex items-center gap-2 font-sans text-[13px] text-ink-500">
              <AnilloProgreso tamano={16} className="shrink-0 text-sage-500" />
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

        {/* Campo */}
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
