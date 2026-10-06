"use client";

import * as React from "react";
import { Button, Card, Input } from "@/components/ui";
import { MAX_PALABRAS_TERMINO } from "@/lib/hot-words";
import { REINTENTAR } from "@/lib/glosario";

import {
  BUSQUEDA_DESDE,
  filtrarPorTermino,
  tituloScope,
  type Scope,
} from "./hot-words-datos";
import {
  CargaMasiva,
  ChipTermino,
  EmptyState,
  Leyenda,
  ListaSkeleton,
  SelectCategoria,
} from "./hot-words-partes";
import { useHotWords } from "./useHotWords";

// LA LISTA ES UNA NUBE, NO UNA TABLA
//
// Los términos se dibujaban uno por fila, con su categoría y su botón de
// borrar: con veinte modismos —que es lo normal— eran veinte renglones y la
// sección se volvía interminable, tanto en la ficha ("Vocabulario de esta
// persona") como en Tu consultorio. Ahora son chips que envuelven: el
// término, la categoría por color, y una x para quitarlo. Veinte términos
// entran en tres renglones y se leen de un vistazo.
//
// El chip es el mismo componente de la app en su variante de texto libre
// (ui/chip.tsx): un término puede ser "trastorno límite de la personalidad"
// y tiene que envolver, no recortarse.
//
// Las llamadas a la API y las reglas están en hot-words-datos.ts; el estado,
// en useHotWords.ts; las piezas (chip, carga masiva, leyenda), en
// hot-words-partes.tsx.

interface HotWordsManagerProps {
  scope: Scope;
  pacienteId?: string;
  pacienteNombre?: string;
  /**
   * Sin card ni encabezado propio: para cuando quien lo monta ya puso el
   * rótulo (el plegable de "Tu consultorio", el bloque de la ficha). El
   * formulario, la lista y la carga masiva son los mismos.
   */
  compacto?: boolean;
}

export function HotWordsManager({
  scope,
  pacienteId,
  pacienteNombre,
  compacto = false,
}: HotWordsManagerProps) {
  const vocabulario = useHotWords(scope, pacienteId);
  const { items, loading, loadError, cantidadActivos, alta } = vocabulario;
  const [busqueda, setBusqueda] = React.useState("");

  const itemsFiltrados = React.useMemo(
    () => filtrarPorTermino(items, busqueda),
    [items, busqueda],
  );

  const titulo = tituloScope(scope, pacienteNombre);
  // En compacto el contenedor de afuera ya puso el margen lateral: repetirlo
  // acá dejaba el formulario cinco pixeles adentro de su propio bloque.
  const px = compacto ? "" : "px-5 md:px-6";
  // La búsqueda es útil sobre una lista larga; en la ficha de una paciente
  // son tres o cuatro términos y el campo era más ruido que ayuda.
  const mostrarBusqueda = !compacto || items.length > BUSQUEDA_DESDE;
  const buscarId = React.useId();
  const categoriaId = React.useId();
  const terminoId = React.useId();

  const resumen = (
    <p className="font-sans text-[13px] text-ink-500">
      {cantidadActivos} {cantidadActivos === 1 ? "término activo" : "términos activos"}
      {items.length !== cantidadActivos && (
        <span className="text-ink-300">
          {" "}· {items.length - cantidadActivos} inactivos
        </span>
      )}
    </p>
  );

  const cuerpo = (
    <>
      {compacto ? (
        resumen
      ) : (
        <div className="flex flex-col gap-1 border-b border-[color:var(--border-subtle)] px-5 py-5 md:px-6 md:py-6">
          <h2 className="font-display text-[20px] md:text-[24px] font-medium tracking-[-0.01em] text-ink-900">
            {titulo}
          </h2>
          {resumen}
        </div>
      )}

      <div className={compacto ? "pt-4" : "px-5 py-5 md:px-6 md:py-6"}>
        <form
          onSubmit={alta.agregar}
          className="flex flex-col gap-3 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 p-4 md:flex-row md:items-end"
        >
          <div className="flex-1">
            <Input
              id={terminoId}
              label="Nuevo término"
              placeholder="Ej. transferencia, gurí, Lacan…"
              value={alta.termino}
              error={alta.error ?? undefined}
              onChange={(e) => alta.escribirTermino(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2 md:w-[180px]">
            <label
              htmlFor={categoriaId}
              className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
            >
              Categoría
            </label>
            <SelectCategoria
              id={categoriaId}
              value={alta.categoria}
              onChange={alta.setCategoria}
            />
          </div>
          <Button
            type="submit"
            disabled={alta.agregando || alta.termino.trim().length === 0}
          >
            {alta.agregando ? "Agregando…" : "Agregar"}
          </Button>
        </form>
        <p className="mt-2 font-sans text-[12px] text-ink-300">
          Hasta {MAX_PALABRAS_TERMINO} palabras por término.
        </p>
      </div>

      {mostrarBusqueda ? (
        <div
          className={`border-t border-[color:var(--border-subtle)] py-4 ${px}`}
        >
          <Input
            id={buscarId}
            label="Buscar"
            placeholder="Filtrá por término…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      ) : null}

      <div className="border-t border-[color:var(--border-subtle)]">
        {loading ? (
          <ListaSkeleton px={px} />
        ) : loadError ? (
          <div className={`flex flex-col items-start gap-3 py-6 ${px}`}>
            <p className="font-sans text-[14px] text-ink-700">
              No pudimos cargar el vocabulario.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={vocabulario.reintentarCarga}
            >
              {REINTENTAR}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState px={px} />
        ) : itemsFiltrados.length === 0 ? (
          <div className={`py-6 ${px}`}>
            <p className="font-sans text-[14px] text-ink-500">
              No hay términos que coincidan con “{busqueda}”.
            </p>
          </div>
        ) : (
          <div className={`py-4 ${px}`}>
            <ul className="flex flex-wrap gap-2">
              {itemsFiltrados.map((item) => (
                <li key={item.id}>
                  <ChipTermino
                    item={item}
                    enConfirmacion={vocabulario.confirmDelete === item.id}
                    onAlternar={() => void vocabulario.alternar(item.id, !item.activo)}
                    onBorrar={() => void vocabulario.borrar(item.id)}
                  />
                </li>
              ))}
            </ul>
            <Leyenda />
          </div>
        )}
      </div>

      {scope === "global" && <CargaMasiva masiva={vocabulario.masiva} px={px} />}
    </>
  );

  if (compacto) return <div className="flex flex-col">{cuerpo}</div>;
  return <Card className="!p-0">{cuerpo}</Card>;
}
