"use client";

// Las piezas de HotWordsManager: el chip de un término, la carga masiva, la
// leyenda de colores, el esqueleto y el vacío.

import * as React from "react";
import { X } from "lucide-react";

import { Button, Chip, Plegable } from "@/components/ui";
import {
  VOCABULARIO_CARGA_MASIVA,
  VOCABULARIO_CARGA_MASIVA_AYUDA,
  VOCABULARIO_QUITAR,
  VOCABULARIO_QUITAR_CONFIRMAR,
} from "@/lib/glosario";

import {
  CATEGORIAS,
  infoCategoria,
  type Categoria,
  type ChipVariant,
  type HotWord,
} from "./hot-words-datos";
import type { useHotWords } from "./useHotWords";

/** El punto de la leyenda, del color con el que se pinta cada categoría.
 *  "Nombre propio" y "Otro" comparten el crema: son dos y no hay dos colores
 *  más en la paleta que no signifiquen otra cosa (terracotta es deuda y
 *  riesgo en toda la app). */
const PUNTO_CATEGORIA: Record<ChipVariant, string> = {
  sage: "bg-sage-500",
  gold: "bg-gold-500",
  terracotta: "bg-terracotta-500",
  neutral: "bg-cream-200",
};

const ROTULO =
  "font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500";

/** El select de categoría, el mismo en el alta y en la carga masiva. */
export function SelectCategoria({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Categoria;
  onChange: (valor: Categoria) => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Categoria)}
      className="rounded-sm border border-[color:var(--border-control)] bg-cream-50 px-[14px] py-[10px] font-sans text-[15px] text-ink-900 outline-none transition-colors duration-150 focus-visible:border-sage-500 focus-visible:bg-white"
    >
      {CATEGORIAS.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export function ChipTermino({
  item,
  enConfirmacion,
  onAlternar,
  onBorrar,
}: {
  item: HotWord;
  enConfirmacion: boolean;
  onAlternar: () => void;
  onBorrar: () => void;
}) {
  const cat = infoCategoria(item.categoria);
  return (
    <Chip
      variant={enConfirmacion ? "terracotta" : cat.variant}
      texto="libre"
      className={`gap-1 py-[3px] pr-[3px] pl-[4px] text-[13px] transition-opacity duration-150 ${
        item.activo ? "" : "opacity-50"
      }`}
    >
      {/* El término es el que enciende y apaga: apagado no se
          borra, deja de mandarse a la transcripción. Era un
          switch por fila; en una nube no entra uno por chip y
          el propio chip lo dice mejor. */}
      <button
        type="button"
        aria-pressed={item.activo}
        // El color dice la categoría a quien la ve; el
        // rótulo, a quien la escucha.
        aria-label={`${item.termino}, ${cat.label}`}
        title={cat.label}
        onClick={onAlternar}
        className="min-h-[26px] rounded-full px-[6px] py-[3px] text-left transition-colors duration-150 hover:bg-black/5"
      >
        {item.termino}
      </button>

      {enConfirmacion ? (
        <button
          type="button"
          onClick={onBorrar}
          aria-label={`${VOCABULARIO_QUITAR} ${item.termino}, confirmar`}
          className="min-h-[28px] rounded-full bg-terracotta-500 px-2 py-[4px] font-semibold text-white transition-colors duration-150 hover:bg-terracotta-600"
        >
          {VOCABULARIO_QUITAR_CONFIRMAR}
        </button>
      ) : (
        <button
          type="button"
          onClick={onBorrar}
          aria-label={`${VOCABULARIO_QUITAR} ${item.termino}`}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors duration-150 hover:bg-terracotta-50 hover:text-terracotta-500"
        >
          <X size={13} strokeWidth={2.2} aria-hidden="true" />
        </button>
      )}
    </Chip>
  );
}

/** La carga masiva se usa una vez, al principio, y después estorba: va
 *  plegada, con el mismo Plegable que el resto de la app. */
export function CargaMasiva({
  masiva,
  px,
}: {
  masiva: ReturnType<typeof useHotWords>["masiva"];
  px: string;
}) {
  const bulkId = React.useId();
  const bulkCategoriaId = React.useId();
  const cantidad = masiva.terminos.length;

  return (
    <div
      className={`flex flex-col gap-3 border-t border-[color:var(--border-subtle)] py-5 ${px}`}
    >
      <Plegable
        titulo={VOCABULARIO_CARGA_MASIVA}
        ayuda={VOCABULARIO_CARGA_MASIVA_AYUDA}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor={bulkId} className={ROTULO}>
            Términos
          </label>
          <textarea
            id={bulkId}
            value={masiva.texto}
            onChange={(e) => masiva.escribir(e.target.value)}
            placeholder="transferencia, contratransferencia, encuadre&#10;gurí&#10;Lacan"
            rows={5}
            className="resize-y rounded-sm border border-[color:var(--border-control)] bg-cream-50 px-[14px] py-[10px] font-sans text-[15px] leading-[1.5] text-ink-900 outline-none transition-colors duration-150 focus-visible:border-sage-500 focus-visible:bg-white"
          />
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
          <div className="flex flex-col gap-2 md:w-[220px]">
            <label htmlFor={bulkCategoriaId} className={ROTULO}>
              Categoría para todos
            </label>
            <SelectCategoria
              id={bulkCategoriaId}
              value={masiva.categoria}
              onChange={masiva.setCategoria}
            />
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={() => void masiva.importar()}
            disabled={masiva.importando || cantidad === 0}
          >
            {masiva.importando
              ? "Importando…"
              : `Importar ${cantidad} ${cantidad === 1 ? "término" : "términos"}`}
          </Button>
        </div>

        {masiva.error && (
          <p
            role="alert"
            className="font-sans text-[13px] text-[color:var(--color-error)]"
          >
            {masiva.error}
          </p>
        )}
      </Plegable>
    </div>
  );
}

// D2: el pulso sale de `animate-pulse`, que la regla global de globals.css
// apaga con prefers-reduced-motion. Nada de estilos inline acá: un
// `style={{ animation: … }}` la pisaría y el bloque seguiría latiendo contra
// la preferencia declarada. Quieto, un bloque crema ya dice "falta el dato".
export function ListaSkeleton({ px }: { px: string }) {
  const anchos = ["w-24", "w-32", "w-20", "w-28", "w-36", "w-24"];
  return (
    <ul aria-hidden="true" className={`flex flex-wrap gap-2 py-4 ${px}`}>
      {anchos.map((ancho, i) => (
        <li
          key={i}
          className={`h-8 ${ancho} animate-pulse rounded-full bg-cream-100`}
        />
      ))}
    </ul>
  );
}

/**
 * Qué significa cada color de la nube. Sin esto los chips son tres tonos sin
 * explicación, que es exactamente lo que la auditoría le señala a los puntos
 * del mes en la agenda.
 */
export function Leyenda() {
  const porColor = CATEGORIAS.reduce<Map<ChipVariant, string[]>>((acc, cat) => {
    const previas = acc.get(cat.variant) ?? [];
    acc.set(cat.variant, [...previas, cat.label]);
    return acc;
  }, new Map());

  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-[11px] text-ink-500">
      {[...porColor.entries()].map(([variant, labels]) => (
        <span key={variant} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`h-[6px] w-[6px] rounded-full ${PUNTO_CATEGORIA[variant]}`}
          />
          {labels.join(" · ")}
        </span>
      ))}
      <span className="text-ink-300">
        Tocá un término para apagarlo sin borrarlo.
      </span>
    </p>
  );
}

export function EmptyState({ px }: { px: string }) {
  return (
    <div className={`flex flex-col items-start gap-2 py-8 md:py-10 ${px}`}>
      <p className="font-display text-[16px] font-medium text-ink-900">
        Sin vocabulario cargado
      </p>
      <p className="font-sans text-[14px] leading-[1.5] text-ink-500">
        No hay términos cargados. Agregá vocabulario clínico, modismos o
        nombres propios para mejorar la transcripción.
      </p>
    </div>
  );
}
