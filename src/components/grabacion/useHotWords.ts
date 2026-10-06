"use client";

// El estado de HotWordsManager: la lista (con su carga y reintento), el alta
// de un término, la carga masiva y el borrado en dos toques. Las llamadas a
// la API y los textos están en hot-words-datos.ts.

import * as React from "react";

import { esAbort, mensajeParaElla } from "@/lib/api-client";
import { excedeMaximoPalabras, TERMINO_MUY_LARGO } from "@/lib/hot-words";

import {
  borrarHotWord,
  cambiarActivo,
  cargarHotWords,
  crearHotWord,
  importarHotWords,
  mensajeAlAgregar,
  terminosDeTexto,
  type Categoria,
  type HotWord,
  type Scope,
} from "./hot-words-datos";

export function useHotWords(scope: Scope, pacienteId: string | undefined) {
  const [items, setItems] = React.useState<HotWord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);

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
        if (controller.signal.aborted || esAbort(err)) return;
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

  const cantidadActivos = React.useMemo(
    () => items.filter((i) => i.activo).length,
    [items],
  );

  const terminosBulk = React.useMemo(() => terminosDeTexto(bulkText), [bulkText]);

  const agregar = async (event: React.FormEvent) => {
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
      const creado = await crearHotWord({
        termino,
        categoria: nuevaCategoria,
        scope,
        pacienteId,
      });
      setItems((prev) => [creado, ...prev]);
      setNuevoTermino("");
    } catch (err) {
      setErrorAgregar(mensajeAlAgregar(err));
    } finally {
      setAgregando(false);
    }
  };

  const escribirTermino = (valor: string) => {
    setNuevoTermino(valor);
    if (errorAgregar) setErrorAgregar(null);
  };

  const alternar = async (id: string, activo: boolean) => {
    const previous = items;
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, activo } : i)),
    );
    try {
      await cambiarActivo(id, activo);
    } catch {
      setItems(previous);
    }
  };

  const borrar = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    const previous = items;
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await borrarHotWord(id);
    } catch {
      setItems(previous);
    }
  };

  const escribirBulk = (valor: string) => {
    setBulkText(valor);
    if (bulkError) setBulkError(null);
  };

  const importar = async () => {
    if (terminosBulk.length === 0 || importando) return;

    const largos = terminosBulk.filter(excedeMaximoPalabras);
    if (largos.length > 0) {
      setBulkError(`${TERMINO_MUY_LARGO} Revisá: ${largos.join(", ")}.`);
      return;
    }

    setImportando(true);
    setBulkError(null);
    try {
      await importarHotWords({
        terminos: terminosBulk,
        categoria: bulkCategoria,
        scope,
        pacienteId,
      });
      // createMany devuelve { count }, no las filas: los repetidos se saltean
      // en silencio, así que la lista se relee en vez de adivinarla.
      setBulkText("");
      reintentarCarga();
    } catch (err) {
      setBulkError(mensajeParaElla(err, "No pudimos importar la lista. Intentá de nuevo."));
    } finally {
      setImportando(false);
    }
  };

  return {
    items,
    loading,
    loadError,
    reintentarCarga,
    cantidadActivos,
    confirmDelete,
    alternar,
    borrar,
    alta: {
      termino: nuevoTermino,
      escribirTermino,
      categoria: nuevaCategoria,
      setCategoria: setNuevaCategoria,
      agregando,
      error: errorAgregar,
      agregar,
    },
    masiva: {
      texto: bulkText,
      escribir: escribirBulk,
      categoria: bulkCategoria,
      setCategoria: setBulkCategoria,
      terminos: terminosBulk,
      importando,
      error: bulkError,
      importar,
    },
  };
}
