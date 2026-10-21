"use client";

// La conversación con Lux: el estado y los pedidos a la red.
//
// La conversación se guarda en el servidor (conversaciones_lux, cifrada),
// no en el navegador: ni localStorage, ni sessionStorage, ni la URL, ni el
// historial del navegador. Al abrir, la pantalla pide lo guardado (GET) y lo
// muestra; después, Lux abre.
//
// El stream se lee igual que en el panel de ayuda (panel-ayuda.tsx): fetch
// a mano y res.body por fragmentos, porque api-client espera el JSON entero.
// Lo guardado sí es JSON entero: apiGet.
//
// APERTURA
//
// Al montar, y con cada "Nueva conversación", se trae lo guardado y sale un
// POST sin pregunta ni historial: Lux habla primero (el servidor le pasa lo
// guardado). Al cambiar de paciente la conversación se tira entera en el
// mismo render y vuelve a empezar para el nuevo: nada de una paciente queda
// a la vista de la otra.

import * as React from "react";

import { ApiClientError, apiGet, esAbort } from "@/lib/api-client";

import { LUX_CORTADO, LUX_HISTORIAL_NO_CARGO, LUX_NO_PUDO, LUX_SIN_CONEXION, LUX_TOPE } from "@/lib/glosario";
import {
  LARGO_MAX_PREGUNTA_LUX,
  LARGO_MAX_TURNO_LUX,
  MAX_TURNOS_HISTORIAL_LUX,
  STATUS_TOPE_LUX,
  type ConversacionGuardadaLux,
  type PeticionLux,
  type TurnoConversacionLux,
  type TurnoHistorialLux,
} from "@/lib/lux/contrato";

/** `en`: cuándo se dijo, para los separadores por día. */
export type TurnoLux =
  | { rol: "usuaria"; texto: string; en: Date }
  | { rol: "asistente"; crudo: string; completo: boolean; en: Date;
      /** Se cortó (ahora, o cuando se guardó): es lo que llegó. */
      interrumpida: boolean };

const urlDe = (paciente: string) => `/api/pacientes/${encodeURIComponent(paciente)}/lux`;

function deGuardado(turno: TurnoConversacionLux): TurnoLux {
  const en = new Date(turno.creadoEn);
  return turno.rol === "profesional"
    ? { rol: "usuaria", texto: turno.texto, en }
    : { rol: "asistente", crudo: turno.texto, completo: true, en, interrumpida: turno.interrumpida };
}

function textoDeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.status === STATUS_TOPE_LUX ? LUX_TOPE : LUX_NO_PUDO;
  }
  return LUX_SIN_CONEXION;
}

/** Lo que vuelve a viajar: exactamente lo que ella vio. De cada turno de Lux
 *  terminado va el texto completo, como llegó: la prosa, el bloque <citas> y
 *  las líneas "(mirando la transcripción del DD/MM)". Sin las citas ni los
 *  avisos, en la pregunta siguiente Lux veía frases literales sin fuente y
 *  negaba haber leído lo que había leído (prueba real del 9/10/2026). */
function historialDe(turnos: TurnoLux[]): TurnoHistorialLux[] {
  return turnos
    .flatMap((t): TurnoHistorialLux[] => {
      if (t.rol === "usuaria") return [{ rol: t.rol, texto: t.texto.slice(0, LARGO_MAX_PREGUNTA_LUX) }];
      if (!t.completo || t.interrumpida) return [];
      return [{ rol: t.rol, texto: t.crudo.trim().slice(0, LARGO_MAX_TURNO_LUX) }];
    })
    .filter((t) => t.texto.trim() !== "")
    .slice(-MAX_TURNOS_HISTORIAL_LUX);
}

/** Reemplaza (o agrega) la respuesta que está llegando. */
function conRespuesta(turnos: TurnoLux[], crudo: string, completo: boolean): TurnoLux[] {
  const ultimo = turnos.at(-1);
  if (ultimo?.rol === "asistente" && !ultimo.completo) {
    return [...turnos.slice(0, -1), { ...ultimo, crudo, completo }];
  }
  return [...turnos, { rol: "asistente", crudo, completo, en: new Date(), interrumpida: false }];
}

/** El POST y la lectura del stream. Avisa el texto acumulado con cada
 *  fragmento (y una última vez con completo=true); tira ApiClientError si la
 *  ruta contesta un error, y lo que tire fetch si no hay red. */
async function leerLux(
  paciente: string,
  cuerpo: PeticionLux,
  signal: AbortSignal,
  alLlegar: (crudo: string, completo: boolean) => void,
): Promise<void> {
  const respuesta = await fetch(urlDe(paciente), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
    signal,
  });
  if (!respuesta.ok) throw new ApiClientError("Lux no respondió", respuesta.status);
  if (!respuesta.body) throw new TypeError("respuesta sin stream");

  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let crudo = "";
  while (true) {
    const { done, value } = await lector.read();
    crudo += done ? decodificador.decode() : decodificador.decode(value, { stream: true });
    alLlegar(crudo, done);
    if (done) return;
  }
}

export function useConversacionLux(pacienteId: string) {
  const [conversacion, setConversacion] = React.useState({ pacienteId, numero: 0 });
  const [turnos, setTurnos] = React.useState<TurnoLux[]>([]);
  /** Cuántos de `turnos` vinieron guardados (los primeros). */
  const [guardados, setGuardados] = React.useState(0);
  const [borrador, setBorrador] = React.useState("");
  const [esperando, setEsperando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const peticion = React.useRef<AbortController | null>(null);

  if (conversacion.pacienteId !== pacienteId) {
    setConversacion({ pacienteId, numero: 0 });
    setTurnos([]);
    setGuardados(0);
    setBorrador("");
    setError(null);
    setEsperando(true);
  }

  const pedir = React.useCallback(
    (paciente: string, cuerpo: PeticionLux, alFallar: (mensaje: string) => void) => {
      // Quien llama ya dejó esperando=true y error=null: la apertura los
      // trae así del render, y preguntar() los pone en el evento.
      peticion.current?.abort();
      const control = new AbortController();
      peticion.current = control;
      const vigente = () => peticion.current === control;
      let llego = false;

      leerLux(paciente, cuerpo, control.signal, (crudo, completo) => {
        if (!vigente()) return;
        llego ||= crudo !== "";
        setTurnos((previos) => conRespuesta(previos, crudo, completo));
      })
        .catch((e: unknown) => {
          if (esAbort(e) || !vigente()) return;
          if (llego) {
            setTurnos((previos) => previos.map((t, i) =>
              i === previos.length - 1 && t.rol === "asistente" ? { ...t, interrumpida: true } : t));
            setError(LUX_CORTADO);
          }
          else alFallar(textoDeError(e));
        })
        .finally(() => {
          if (!vigente()) return;
          setEsperando(false);
          peticion.current = null;
        });
    },
    [],
  );

  // Apertura: al montar, al cambiar de paciente y con "Nueva conversación".
  // Primero lo guardado, para que la apertura quede abajo.
  React.useEffect(() => {
    const control = new AbortController();
    const paciente = conversacion.pacienteId;
    apiGet<ConversacionGuardadaLux>(urlDe(paciente), { signal: control.signal })
      .then(({ turnos: previos }) => {
        setTurnos(previos.map(deGuardado));
        setGuardados(previos.length);
      })
      .catch((e: unknown) => {
        if (!esAbort(e)) setError(LUX_HISTORIAL_NO_CARGO);
      })
      .finally(() => {
        if (!control.signal.aborted) pedir(paciente, {}, setError);
      });
    return () => {
      control.abort();
      peticion.current?.abort();
      peticion.current = null;
    };
  }, [conversacion, pedir]);

  function preguntar(pregunta: string) {
    const texto = pregunta.trim();
    if (texto === "" || esperando) return;
    const historial = historialDe(turnos);
    setTurnos((previos) => [...previos, { rol: "usuaria", texto, en: new Date() }]);
    setBorrador("");
    setEsperando(true);
    setError(null);
    pedir(
      pacienteId,
      { pregunta: texto, ...(historial.length > 0 ? { historial } : {}) },
      (mensaje) => {
        // No llegó nada: la pregunta vuelve al campo para mandarla de nuevo,
        // salvo que ella ya haya empezado a escribir otra: eso no se pisa.
        setTurnos((previos) => previos.slice(0, -1));
        setBorrador((actual) => (actual.trim() === "" ? texto : actual));
        setError(mensaje);
      },
    );
  }

  function nueva() {
    setTurnos([]);
    setGuardados(0);
    setBorrador("");
    setError(null);
    setEsperando(true);
    setConversacion((actual) => ({ ...actual, numero: actual.numero + 1 }));
  }

  return { turnos, guardados, borrador, setBorrador, esperando, error, preguntar, nueva };
}
