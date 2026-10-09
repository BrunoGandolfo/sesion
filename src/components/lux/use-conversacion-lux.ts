"use client";

// La conversación con Lux: el estado y el único pedido a la red.
//
// El historial vive acá, en estado de React, y en ningún otro lado: ni
// localStorage, ni sessionStorage, ni la URL, ni el historial del navegador.
// Al salir de la pestaña, recargar o cambiar de paciente, se va. Es lo que
// promete la línea de arriba del chat ("No guarda esta conversación").
//
// El stream se lee igual que en el panel de ayuda (panel-ayuda.tsx): fetch
// a mano y res.body por fragmentos, porque api-client espera el JSON entero.
//
// APERTURA
//
// Al montar, y con cada "Nueva conversación", sale un POST sin pregunta ni
// historial: Lux habla primero. Al cambiar de paciente la conversación se
// tira entera en el mismo render y la apertura vuelve a salir para el nuevo:
// nada de una paciente queda a la vista de la otra.

import * as React from "react";

import { ApiClientError, esAbort } from "@/lib/api-client";

import { LUX_CORTADO, LUX_NO_PUDO, LUX_SIN_CONEXION, LUX_TOPE } from "@/lib/glosario";
import {
  LARGO_MAX_PREGUNTA_LUX,
  LARGO_MAX_TURNO_LUX,
  MAX_TURNOS_HISTORIAL_LUX,
  STATUS_TOPE_LUX,
  type PeticionLux,
  type TurnoHistorialLux,
} from "@/lib/lux/contrato";

import { leerRespuesta, prosaDe } from "./respuesta";

export type TurnoLux =
  | { rol: "usuaria"; texto: string }
  | { rol: "asistente"; crudo: string; completo: boolean };

function textoDeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.status === STATUS_TOPE_LUX ? LUX_TOPE : LUX_NO_PUDO;
  }
  return LUX_SIN_CONEXION;
}

/** Lo que vuelve a viajar: los turnos terminados, con lo que Lux dijo (sin
 *  citas ni estados), dentro de los máximos del contrato. */
function historialDe(turnos: TurnoLux[]): TurnoHistorialLux[] {
  return turnos
    .flatMap((t): TurnoHistorialLux[] => {
      if (t.rol === "usuaria") return [{ rol: t.rol, texto: t.texto.slice(0, LARGO_MAX_PREGUNTA_LUX) }];
      if (!t.completo) return [];
      return [{ rol: t.rol, texto: prosaDe(leerRespuesta(t.crudo, true)).slice(0, LARGO_MAX_TURNO_LUX) }];
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
  return [...turnos, { rol: "asistente", crudo, completo }];
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
  const respuesta = await fetch(`/api/pacientes/${encodeURIComponent(paciente)}/lux`, {
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
  const [borrador, setBorrador] = React.useState("");
  const [esperando, setEsperando] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const peticion = React.useRef<AbortController | null>(null);

  if (conversacion.pacienteId !== pacienteId) {
    setConversacion({ pacienteId, numero: 0 });
    setTurnos([]);
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
          if (llego) setError(LUX_CORTADO);
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
  React.useEffect(() => {
    pedir(conversacion.pacienteId, {}, setError);
    return () => {
      peticion.current?.abort();
      peticion.current = null;
    };
  }, [conversacion, pedir]);

  function preguntar(pregunta: string) {
    const texto = pregunta.trim();
    if (texto === "" || esperando) return;
    const historial = historialDe(turnos);
    setTurnos((previos) => [...previos, { rol: "usuaria", texto }]);
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
    setBorrador("");
    setError(null);
    setEsperando(true);
    setConversacion((actual) => ({ ...actual, numero: actual.numero + 1 }));
  }

  return { turnos, borrador, setBorrador, esperando, error, preguntar, nueva };
}
