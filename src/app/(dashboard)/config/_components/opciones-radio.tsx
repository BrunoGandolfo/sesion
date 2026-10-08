"use client";

// Un grupo de radios dibujado como tarjetas: cada opción con su título y una
// línea que dice qué implica. Lo usan los selectores de Tu consultorio (el
// enfoque, cómo y cuándo se avisa), que antes eran copias del mismo JSX.

import * as React from "react";

import {
  CTSR,
  GTFS,
  MITI,
  RECORDATORIO_CANAL_LEYENDA,
  RECORDATORIO_CANALES,
  RECORDATORIO_MISMA_MANANA_EXCEPCION,
  RECORDATORIO_MOMENTOS,
} from "@/lib/glosario";
import { formatearHoraMvd, instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import {
  CANALES_RECORDATORIO,
  DISPERSION_MINUTOS,
  RECORDATORIO_MODOS,
  calcularProgramadoEn,
  type RecordatorioModo,
} from "@/lib/recordatorios-programacion";
import type { CanalRecordatorio, OrientacionTeorica } from "@/types/domain";

interface Opcion<T extends string> {
  valor: T;
  titulo: string;
  detalle: string;
}

export function OpcionesRadio<T extends string>({
  leyenda,
  opciones,
  valor,
  onChange,
  enFila = false,
  tamanoTitulo = "text-[14px]",
  interlineadoDetalle = "leading-[1.5]",
  children,
}: {
  leyenda: string;
  opciones: Opcion<T>[];
  valor: T;
  onChange: (valor: T) => void;
  /** En pantallas anchas las opciones van una al lado de la otra. */
  enFila?: boolean;
  /** Las dos medidas en que los selectores ya diferían antes de compartir
   *  este componente; se conservan para no cambiar lo que ella ve. */
  tamanoTitulo?: string;
  interlineadoDetalle?: string;
  /** Lo que va debajo de las opciones, dentro del mismo grupo. */
  children?: React.ReactNode;
}) {
  const nombreGrupo = React.useId();

  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        {leyenda}
      </legend>
      <div className={`flex flex-col gap-2${enFila ? " sm:flex-row" : ""}`}>
        {opciones.map((opcion) => {
          const activo = opcion.valor === valor;
          return (
            <label
              key={opcion.valor}
              className={`flex ${enFila ? "flex-1 " : ""}cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors duration-[var(--duration-fast)] ${
                activo
                  ? "border-sage-500 bg-sage-50"
                  : "border-[color:var(--border-subtle)] bg-cream-50 hover:bg-cream-100"
              }`}
            >
              <input
                type="radio"
                name={nombreGrupo}
                value={opcion.valor}
                checked={activo}
                onChange={() => onChange(opcion.valor)}
                className="mt-[3px] h-4 w-4 accent-[var(--color-sage-500)]"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`${tamanoTitulo} font-semibold text-ink-900`}>
                  {opcion.titulo}
                </span>
                <span className={`text-[12px] ${interlineadoDetalle} text-ink-500`}>
                  {opcion.detalle}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {children}
    </fieldset>
  );
}

// ─── Enfoque ────────────────────────────────────────────────────────────────
// Cada opción dice qué instrumento de feedback usa. Las siglas no se
// traducen: son instrumentos publicados y ella tiene que poder rastrearlos.

const ENFOQUES: Opcion<OrientacionTeorica>[] = [
  {
    valor: "gestalt",
    titulo: "Gestalt",
    detalle: `Feedback con ${GTFS.sigla} (${GTFS.nombre})`,
  },
  {
    valor: "cbt_mi",
    titulo: "Cognitivo-conductual",
    detalle: `Feedback con ${CTSR.sigla} (${CTSR.nombre}) + ${MITI.sigla} (${MITI.nombre})`,
  },
];

export function SelectorEnfoque({
  value,
  onChange,
}: {
  value: OrientacionTeorica;
  onChange: (v: OrientacionTeorica) => void;
}) {
  return (
    <OpcionesRadio
      leyenda="Orientación teórica"
      opciones={ENFOQUES}
      valor={value}
      onChange={onChange}
      tamanoTitulo="text-[15px]"
    />
  );
}

// ─── Cuándo se avisa ────────────────────────────────────────────────────────
// Tres momentos, dichos como los diría ella. Ya no se guarda un número de
// horas: se guarda el momento (recordatorioModo) y la hora exacta la calcula
// calcularProgramadoEn, una sola vez para toda la app.
//
// La hora que se muestra sale de esa misma cuenta, con un turno de ejemplo
// al mediodía, y el margen de DISPERSION_MINUTOS: los avisos del día se
// reparten unos minutos. Antes decía "A las 20:00" escrito a mano (forense
// 03, P3-14).

function ventanaDe(modo: RecordatorioModo): { desde: string; hasta: string; limite: string } {
  const mediodia = instanteDesdeFechaHoraMvd("2026-01-15", "12:00");
  const desde = calcularProgramadoEn(mediodia, modo);
  const minuto = 60_000;
  const hasta = new Date(desde.getTime() + (DISPERSION_MINUTOS - 1) * minuto);
  // El primer minuto en que un turno ya siempre llega a su aviso del día.
  const limite = new Date(desde.getTime() + DISPERSION_MINUTOS * minuto);
  return {
    desde: formatearHoraMvd(desde),
    hasta: formatearHoraMvd(hasta),
    limite: formatearHoraMvd(limite),
  };
}

export function CuandoAvisar({
  value,
  onChange,
}: {
  value: RecordatorioModo;
  onChange: (modo: RecordatorioModo) => void;
}) {
  const opciones = RECORDATORIO_MODOS.map((modo) => {
    const { desde, hasta } = ventanaDe(modo);
    const momento = RECORDATORIO_MOMENTOS[modo];
    return { valor: modo, titulo: momento.label, detalle: momento.detalle(desde, hasta) };
  });

  return (
    <OpcionesRadio
      leyenda="Cuándo se avisa"
      opciones={opciones}
      valor={value}
      onChange={onChange}
      enFila
      interlineadoDetalle="leading-[1.4]"
    >
      {value === "misma_manana" ? (
        <p className="mt-2 text-[12px] leading-[1.5] text-ink-500">
          {RECORDATORIO_MISMA_MANANA_EXCEPCION(
            ventanaDe("misma_manana").limite,
            ventanaDe("dia_anterior").desde,
            ventanaDe("dia_anterior").hasta,
          )}
        </p>
      ) : null}
    </OpcionesRadio>
  );
}

// ─── Cómo se recuerdan los turnos ───────────────────────────────────────────
// SMS es lo de siempre: sale solo, desde un número de servicio. Con WhatsApp
// el mensaje lo manda ella desde su teléfono, y por eso las respuestas le
// llegan a ella.

const CANALES: Opcion<CanalRecordatorio>[] = CANALES_RECORDATORIO.map((valor) => ({
  valor,
  titulo: RECORDATORIO_CANALES[valor].label,
  detalle: RECORDATORIO_CANALES[valor].detalle,
}));

export function SelectorCanal({
  value,
  onChange,
}: {
  value: CanalRecordatorio;
  onChange: (canal: CanalRecordatorio) => void;
}) {
  return (
    <OpcionesRadio
      leyenda={RECORDATORIO_CANAL_LEYENDA}
      opciones={CANALES}
      valor={value}
      onChange={onChange}
    />
  );
}
