"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button, Card, Chip, Input, Plegable } from "@/components/ui";
import {
  excedeMaximoPalabras,
  MAX_PALABRAS_TERMINO,
  TERMINO_MUY_LARGO,
} from "@/lib/hot-words";
import {
  VOCABULARIO_CARGA_MASIVA,
  VOCABULARIO_CARGA_MASIVA_AYUDA,
  VOCABULARIO_QUITAR,
  VOCABULARIO_QUITAR_CONFIRMAR,
} from "@/lib/glosario";

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

type Categoria =
  | "termino_clinico"
  | "modismo_rioplatense"
  | "nombre_propio"
  | "otro";

type Scope = "global" | "profesional" | "paciente";

type ChipVariant = "sage" | "terracotta" | "gold" | "neutral";

// Lo que devuelve la API, no lo que uno querría que devolviera: `categoria`
// es String? en la base (puede venir null o con un valor viejo que ya no está
// en CATEGORIAS) y el select de la ruta no incluye `pacienteId`, que este
// componente además ya sabe porque se lo pasan por prop.
interface HotWord {
  id: string;
  termino: string;
  categoria: string | null;
  activo: boolean;
  scope: Scope;
}

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

interface CategoriaInfo {
  value: Categoria;
  label: string;
  chipLabel: string;
  variant: ChipVariant;
}

const CATEGORIAS: ReadonlyArray<CategoriaInfo> = [
  {
    value: "termino_clinico",
    label: "Término clínico",
    chipLabel: "Clínico",
    variant: "sage",
  },
  {
    value: "modismo_rioplatense",
    label: "Modismo rioplatense",
    chipLabel: "Modismo",
    variant: "gold",
  },
  {
    value: "nombre_propio",
    label: "Nombre propio",
    chipLabel: "Nombre",
    variant: "neutral",
  },
  {
    value: "otro",
    label: "Otro",
    chipLabel: "Otro",
    variant: "neutral",
  },
];

/** A partir de cuántos términos el modo compacto muestra el buscador. */
const BUSQUEDA_DESDE = 8;

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

function infoCategoria(cat: string | null): CategoriaInfo {
  return CATEGORIAS.find((c) => c.value === cat) ?? CATEGORIAS[3];
}

async function cargarHotWords(
  scope: Scope,
  pacienteId: string | undefined,
  signal: AbortSignal,
): Promise<HotWord[]> {
  const params = new URLSearchParams({ scope });
  if (pacienteId) params.set("pacienteId", pacienteId);
  const res = await fetch(`/api/hot-words?${params.toString()}`, { signal });
  if (!res.ok) throw new Error("No se pudo cargar el vocabulario.");
  const json = (await res.json()) as { data: HotWord[] };
  return json.data;
}

function tituloScope(scope: Scope, pacienteNombre?: string): string {
  if (scope === "global") return "Vocabulario global";
  if (scope === "profesional") return "Vocabulario propio";
  return pacienteNombre
    ? `Vocabulario de ${pacienteNombre}`
    : "Vocabulario del paciente";
}

export function HotWordsManager({
  scope,
  pacienteId,
  pacienteNombre,
  compacto = false,
}: HotWordsManagerProps) {
  const [items, setItems] = React.useState<HotWord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

  const [busqueda, setBusqueda] = React.useState("");

  const [nuevoTermino, setNuevoTermino] = React.useState("");
  const [nuevaCategoria, setNuevaCategoria] =
    React.useState<Categoria>("termino_clinico");
  const [agregando, setAgregando] = React.useState(false);
  const [errorAgregar, setErrorAgregar] = React.useState<string | null>(null);

  const [bulkText, setBulkText] = React.useState("");
  const [bulkCategoria, setBulkCategoria] =
    React.useState<Categoria>("termino_clinico");
  const [importando, setImportando] = React.useState(false);
  const [bulkError, setBulkError] = React.useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  // No resetea loading/loadError acá: es el estado inicial, y el reintento lo
  // hace en su propio handler.
  React.useEffect(() => {
    const controller = new AbortController();

    cargarHotWords(scope, pacienteId, controller.signal)
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [scope, pacienteId, reloadKey]);

  const reintentarCarga = () => {
    setLoading(true);
    setLoadError(false);
    setReloadKey((k) => k + 1);
  };

  React.useEffect(() => {
    if (confirmDelete === null) return;
    const timer = window.setTimeout(() => setConfirmDelete(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  const itemsFiltrados = React.useMemo(() => {
    const needle = busqueda.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      item.termino.toLowerCase().includes(needle),
    );
  }, [items, busqueda]);

  const cantidadActivos = React.useMemo(
    () => items.filter((i) => i.activo).length,
    [items],
  );

  const terminosBulk = React.useMemo(
    () =>
      bulkText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    [bulkText],
  );

  const handleAgregar = async (event: React.FormEvent) => {
    event.preventDefault();
    const termino = nuevoTermino.trim();
    if (!termino || agregando) return;

    // El servidor es el que decide (mismo límite, en el schema del POST);
    // acá se avisa antes para no gastar un viaje de red en un error visible.
    if (excedeMaximoPalabras(termino)) {
      setErrorAgregar(TERMINO_MUY_LARGO);
      return;
    }

    setAgregando(true);
    setErrorAgregar(null);
    try {
      const res = await fetch("/api/hot-words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termino,
          categoria: nuevaCategoria,
          scope,
          pacienteId: pacienteId ?? null,
        }),
      });
      if (res.status === 409) {
        setErrorAgregar("Este término ya existe");
        return;
      }
      if (!res.ok) {
        setErrorAgregar("No pudimos agregar el término. Intentá de nuevo.");
        return;
      }
      const json = (await res.json()) as { data: HotWord };
      setItems((prev) => [json.data, ...prev]);
      setNuevoTermino("");
    } catch {
      setErrorAgregar("No pudimos agregar el término. Intentá de nuevo.");
    } finally {
      setAgregando(false);
    }
  };

  const handleToggle = async (id: string, activo: boolean) => {
    const previous = items;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, activo } : i)),
    );
    try {
      const res = await fetch(`/api/hot-words/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(previous);
    }
  };

  const handleBorrar = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    const previous = items;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      const res = await fetch(`/api/hot-words/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setItems(previous);
    }
  };

  const handleBulk = async () => {
    if (terminosBulk.length === 0 || importando) return;

    const largos = terminosBulk.filter(excedeMaximoPalabras);
    if (largos.length > 0) {
      setBulkError(`${TERMINO_MUY_LARGO} Revisá: ${largos.join(", ")}.`);
      return;
    }

    setImportando(true);
    setBulkError(null);
    try {
      // El POST masivo espera { hotWords: [...] }, un item completo por
      // término: mandaba { terminos, categoria, scope } —una forma que la
      // ruta nunca aceptó— y caía siempre en el 400 del item suelto.
      const res = await fetch("/api/hot-words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hotWords: terminosBulk.map((termino) => ({
            termino,
            scope,
            categoria: bulkCategoria,
            pacienteId: scope === "paciente" ? pacienteId ?? null : null,
          })),
        }),
      });
      if (!res.ok) {
        setBulkError("No pudimos importar la lista. Intentá de nuevo.");
        return;
      }
      // createMany devuelve { count }, no las filas: los repetidos se saltean
      // en silencio, así que la lista se relee en vez de adivinarla.
      setBulkText("");
      reintentarCarga();
    } catch {
      setBulkError("No pudimos importar la lista. Intentá de nuevo.");
    } finally {
      setImportando(false);
    }
  };

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
  const bulkId = React.useId();
  const bulkCategoriaId = React.useId();

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
          onSubmit={handleAgregar}
          className="flex flex-col gap-3 rounded-md border border-[color:var(--border-subtle)] bg-cream-50 p-4 md:flex-row md:items-end"
        >
          <div className="flex-1">
            <Input
              id={terminoId}
              label="Nuevo término"
              placeholder="Ej. transferencia, gurí, Lacan…"
              value={nuevoTermino}
              error={errorAgregar ?? undefined}
              onChange={(e) => {
                setNuevoTermino(e.target.value);
                if (errorAgregar) setErrorAgregar(null);
              }}
            />
          </div>
          <div className="flex flex-col gap-2 md:w-[180px]">
            <label
              htmlFor={categoriaId}
              className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
            >
              Categoría
            </label>
            <select
              id={categoriaId}
              value={nuevaCategoria}
              onChange={(e) => setNuevaCategoria(e.target.value as Categoria)}
              className="rounded-sm border border-[color:var(--border-subtle)] bg-cream-50 px-[14px] py-[10px] font-sans text-[15px] text-ink-900 outline-none transition-colors duration-150 focus-visible:border-sage-500 focus-visible:bg-white"
            >
              {CATEGORIAS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            disabled={agregando || nuevoTermino.trim().length === 0}
          >
            {agregando ? "Agregando…" : "Agregar"}
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
              onClick={reintentarCarga}
            >
              Reintentar
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
              {itemsFiltrados.map((item) => {
                const cat = infoCategoria(item.categoria);
                const enConfirmacion = confirmDelete === item.id;
                return (
                  <li key={item.id}>
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
                        onClick={() => void handleToggle(item.id, !item.activo)}
                        className="min-h-[26px] rounded-full px-[6px] py-[3px] text-left transition-colors duration-150 hover:bg-black/5"
                      >
                        {item.termino}
                      </button>

                      {enConfirmacion ? (
                        <button
                          type="button"
                          onClick={() => void handleBorrar(item.id)}
                          aria-label={`${VOCABULARIO_QUITAR} ${item.termino}, confirmar`}
                          className="min-h-[28px] rounded-full bg-terracotta-500 px-2 py-[4px] font-semibold text-white transition-colors duration-150 hover:bg-terracotta-600"
                        >
                          {VOCABULARIO_QUITAR_CONFIRMAR}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleBorrar(item.id)}
                          aria-label={`${VOCABULARIO_QUITAR} ${item.termino}`}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors duration-150 hover:bg-terracotta-50 hover:text-terracotta-500"
                        >
                          <X size={13} strokeWidth={2.2} aria-hidden="true" />
                        </button>
                      )}
                    </Chip>
                  </li>
                );
              })}
            </ul>
            <Leyenda />
          </div>
        )}
      </div>

      {/* La carga masiva se usa una vez, al principio, y después estorba:
          va plegada, con el mismo Plegable que el resto de la app. */}
      {scope === "global" && (
        <div
          className={`flex flex-col gap-3 border-t border-[color:var(--border-subtle)] py-5 ${px}`}
        >
          <Plegable
            titulo={VOCABULARIO_CARGA_MASIVA}
            ayuda={VOCABULARIO_CARGA_MASIVA_AYUDA}
          >
            <div className="flex flex-col gap-2">
              <label
                htmlFor={bulkId}
                className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
              >
                Términos
              </label>
              <textarea
                id={bulkId}
                value={bulkText}
                onChange={(e) => {
                  setBulkText(e.target.value);
                  if (bulkError) setBulkError(null);
                }}
                placeholder="transferencia, contratransferencia, encuadre&#10;gurí&#10;Lacan"
                rows={5}
                className="resize-y rounded-sm border border-[color:var(--border-subtle)] bg-cream-50 px-[14px] py-[10px] font-sans text-[15px] leading-[1.5] text-ink-900 outline-none transition-colors duration-150 focus-visible:border-sage-500 focus-visible:bg-white"
              />
            </div>

            <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
              <div className="flex flex-col gap-2 md:w-[220px]">
                <label
                  htmlFor={bulkCategoriaId}
                  className="font-sans font-semibold text-[11px] uppercase tracking-[0.08em] text-ink-500"
                >
                  Categoría para todos
                </label>
                <select
                  id={bulkCategoriaId}
                  value={bulkCategoria}
                  onChange={(e) => setBulkCategoria(e.target.value as Categoria)}
                  className="rounded-sm border border-[color:var(--border-subtle)] bg-cream-50 px-[14px] py-[10px] font-sans text-[15px] text-ink-900 outline-none transition-colors duration-150 focus-visible:border-sage-500 focus-visible:bg-white"
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                type="button"
                variant="primary"
                onClick={() => void handleBulk()}
                disabled={importando || terminosBulk.length === 0}
              >
                {importando
                  ? "Importando…"
                  : `Importar ${terminosBulk.length} ${
                      terminosBulk.length === 1 ? "término" : "términos"
                    }`}
              </Button>
            </div>

            {bulkError && (
              <p
                role="alert"
                className="font-sans text-[13px] text-[color:var(--color-error)]"
              >
                {bulkError}
              </p>
            )}
          </Plegable>
        </div>
      )}
    </>
  );

  if (compacto) return <div className="flex flex-col">{cuerpo}</div>;
  return <Card className="!p-0">{cuerpo}</Card>;
}

// D2: el pulso sale de `animate-pulse`, que la regla global de globals.css
// apaga con prefers-reduced-motion. Nada de estilos inline acá: un
// `style={{ animation: … }}` la pisaría y el bloque seguiría latiendo contra
// la preferencia declarada. Quieto, un bloque crema ya dice "falta el dato".
function ListaSkeleton({ px }: { px: string }) {
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
function Leyenda() {
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

function EmptyState({ px }: { px: string }) {
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
