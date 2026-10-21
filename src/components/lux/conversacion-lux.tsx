"use client";

// La pestaña Lux de la ficha: el chat con el personaje que leyó el Recorrido,
// las notas y las últimas sesiones de esta paciente.
//
// Arriba, fija, la línea que dice qué lee Lux y que recuerda la charla.
// Después el hilo: lo que quedó
// guardado de otras veces, con un separador por día ("Conversación del
// DD/MM"); el saludo de la app (no viaja a Lux); las respuestas en
// streaming, con sus citas plegadas y sus "mirando la transcripción…" en
// gris. Abajo el campo: Enter envía, Shift+Enter baja de línea.
//
// Si ella dejó algo escrito sin mandar, salir de la pestaña (o de la ficha)
// pregunta lo mismo que las notas privadas: useProtegerTrabajo.

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Lux, TAMANOS_LUX } from "@/components/ui/lux";
import { useProtegerTrabajo } from "@/components/layout/proteccion-trabajo";

import { fechaInputMvd } from "@/lib/fechas-montevideo";
import { LARGO_MAX_PREGUNTA_LUX, type RespuestaLux } from "@/lib/lux/contrato";

import { PuntosLeyendo } from "./puntos-leyendo";
import { leerRespuesta } from "./respuesta";
import {
  LUX,
  LUX_CONVERSACION,
  LUX_DIJO,
  LUX_DIJO_ELLA,
  LUX_EN_QUE_ME_BASO,
  LUX_ENVIAR,
  LUX_NUEVA,
  LUX_LEYENDO,
  LUX_PLACEHOLDER,
  LUX_RESPUESTA_CORTADA,
  LUX_SALIR,
  luxConversacionDel,
  luxMirando,
  luxQueLee,
  luxSaludo,
} from "@/lib/glosario";
import { useConversacionLux, type TurnoLux } from "./use-conversacion-lux";

interface ConversacionLuxProps {
  pacienteId: string;
  /** Nombre de pila de la paciente, para el saludo y la línea de arriba. */
  paciente: string;
  /** Nombre de pila de la profesional; vacío si la configuración no está. */
  profesional: string;
}

const TEXTO_LUX = "whitespace-pre-wrap break-words font-sans text-[14px] leading-[1.6] text-ink-700";

function MensajeLux({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-[92%] items-start gap-2">
      <Lux tamano={TAMANOS_LUX.inline} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

function RespuestaDeLux({ respuesta, cortada }: { respuesta: RespuestaLux; cortada: boolean }) {
  return (
    <>
      {respuesta.bloques.map((bloque, i) =>
        bloque.tipo === "estado" ? (
          <p key={i} className="font-sans text-[13px] leading-[1.5] text-ink-500">
            {luxMirando(bloque.fecha)}
          </p>
        ) : (
          <MensajeLux key={i}>
            <p className={TEXTO_LUX}>
              <span className="sr-only">{LUX_DIJO} </span>
              {bloque.texto}
            </p>
          </MensajeLux>
        ),
      )}
      {respuesta.citas !== null ? (
        <details className="ml-7 max-w-[85%] min-w-0 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-sans text-[13px] font-medium text-sage-500">
            {LUX_EN_QUE_ME_BASO}
          </summary>
          <p className="whitespace-pre-wrap break-words pb-1 font-sans text-[13px] leading-[1.5] text-ink-500">
            {respuesta.citas}
          </p>
        </details>
      ) : null}
      {cortada ? (
        <p className="ml-7 font-sans text-[12px] leading-[1.5] text-ink-500">{LUX_RESPUESTA_CORTADA}</p>
      ) : null}
    </>
  );
}

/** "DD/MM" del día de Montevideo. */
function diaDe(instante: Date): string {
  const [, mes, dia] = fechaInputMvd(instante).split("-");
  return `${dia}/${mes}`;
}

function Separador({ dia }: { dia: string }) {
  const texto = luxConversacionDel(dia);
  return (
    <div role="separator" aria-label={texto} className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--border-subtle)]" />
      <span className="shrink-0 font-sans text-[12px] leading-[1.5] text-ink-500">{texto}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-[color:var(--border-subtle)]" />
    </div>
  );
}

function Turno({ turno, respuesta }: { turno: TurnoLux; respuesta: RespuestaLux | null }) {
  if (turno.rol === "asistente") {
    return <RespuestaDeLux respuesta={respuesta as RespuestaLux} cortada={turno.interrumpida} />;
  }
  return (
    <p className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-md bg-sage-50 px-3.5 py-2.5 font-sans text-[14px] leading-[1.5] text-ink-900">
      <span className="sr-only">{LUX_DIJO_ELLA} </span>
      {turno.texto}
    </p>
  );
}

export function ConversacionLux({ pacienteId, paciente, profesional }: ConversacionLuxProps) {
  const { turnos, guardados, borrador, setBorrador, esperando, error, preguntar, nueva } =
    useConversacionLux(pacienteId);
  const [abierta] = React.useState(() => new Date());
  const hilo = React.useRef<HTMLDivElement>(null);
  useProtegerTrabajo(borrador.trim() !== "", LUX_SALIR);

  const respuestas = turnos.map((turno) =>
    turno.rol === "asistente" ? leerRespuesta(turno.crudo, turno.completo) : null,
  );
  const ultima = respuestas.at(-1);
  // Lo guardado, el saludo de hoy y lo nuevo, en ese orden. `i` es el índice
  // en `turnos`; null, el saludo.
  const items: { i: number | null; en: Date }[] = [
    ...turnos.slice(0, guardados).map((t, i) => ({ i, en: t.en })),
    { i: null, en: abierta },
    ...turnos.slice(guardados).map((t, i) => ({ i: guardados + i, en: t.en })),
  ];
  const leyendo = esperando && !(ultima && ultima.bloques.length > 0);

  React.useEffect(() => {
    const nodo = hilo.current;
    if (nodo) nodo.scrollTop = nodo.scrollHeight;
  }, [turnos, esperando, error]);

  function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    preguntar(borrador);
  }

  function alTeclear(evento: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key !== "Enter" || evento.shiftKey || evento.nativeEvent.isComposing) return;
    evento.preventDefault();
    preguntar(borrador);
  }

  return (
    <section aria-labelledby="lux-heading" className="flex min-w-0 flex-col gap-4">
      <h2 id="lux-heading" className="sr-only">{LUX}</h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="min-w-0 font-sans text-[12px] leading-[1.5] text-ink-500">
          {luxQueLee(paciente)}
        </p>
        <Button variant="secondary" size="sm" onClick={nueva} className="self-start shrink-0">
          {LUX_NUEVA}
        </Button>
      </div>

      <div
        ref={hilo}
        role="log"
        aria-label={LUX_CONVERSACION}
        aria-live="polite"
        className="flex max-h-[60vh] min-h-[240px] min-w-0 flex-col gap-4 overflow-y-auto overflow-x-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white p-4"
      >
        {items.map((item, n) => {
          const dia = diaDe(item.en);
          const separador = guardados > 0 && (n === 0 || diaDe(items[n - 1].en) !== dia);
          return (
            <React.Fragment key={item.i ?? "saludo"}>
              {separador ? <Separador dia={dia} /> : null}
              {item.i === null ? (
                <MensajeLux>
                  <p className={TEXTO_LUX}>{luxSaludo(profesional, paciente)}</p>
                </MensajeLux>
              ) : (
                <Turno turno={turnos[item.i]} respuesta={respuestas[item.i]} />
              )}
            </React.Fragment>
          );
        })}

        {leyendo ? (
          <p role="status" className="font-sans text-[13px] leading-[1.5] text-ink-500">
            {LUX_LEYENDO}
            <PuntosLeyendo />
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

      <form onSubmit={alEnviar} className="flex min-w-0 items-end gap-2">
        <textarea
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={alTeclear}
          maxLength={LARGO_MAX_PREGUNTA_LUX}
          rows={2}
          placeholder={LUX_PLACEHOLDER}
          aria-label={LUX_PLACEHOLDER}
          autoComplete="off"
          className="min-h-[44px] min-w-0 flex-1 resize-none rounded-sm border border-[color:var(--border-control)] bg-cream-50 px-[14px] py-[10px] font-sans text-[15px] leading-[1.4] text-ink-900 outline-none transition-colors duration-[var(--duration-fast)] placeholder:text-ink-500 focus:border-sage-500 focus:bg-white focus:ring-[3px] focus:ring-sage-500/20"
        />
        <Button type="submit" disabled={esperando || borrador.trim() === ""} className="shrink-0">
          {LUX_ENVIAR}
        </Button>
      </form>
    </section>
  );
}
