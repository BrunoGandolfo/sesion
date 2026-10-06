"use client";

// El estado de la nota de una sesión: la fila (carga, relectura mientras
// está en el pipeline), el borrador que ella corrige, las casillas que exige
// aprobar y las acciones que la firman o la mandan a reescribir.
//
// El texto que ella edita vive acá, en el estado local, y viaja entero como
// notaEditada al aprobar. Nunca se guarda por sección: aprobar es el único
// momento en que la nota se escribe.

import * as React from "react";
import { useRouter } from "next/navigation";

import { ESTADOS_ACTIVOS, useSesionClinicaPolling } from "@/hooks/useSesionClinicaPolling";
import { ApiClientError, apiPost, esAbort, mensajeParaElla } from "@/lib/api-client";
import {
  clavesDeConfirmacion,
  confirmacionesDeCasillas,
  confirmacionesParaAprobar,
} from "@/lib/sesion-clinica/aprobacion";
import type { NotaSoap, SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { leerSesion, motivoBloqueo, notaDeSesion, versionDe, type Edicion } from "./datos";

export function useRevisionNota(id: string, { onAprobada }: { onAprobada: () => void }) {
  const router = useRouter();

  const [sesion, setSesion] = React.useState<SesionClinicaResponse | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [errorCarga, setErrorCarga] = React.useState<string | null>(null);
  const [edicion, setEdicion] = React.useState<Edicion | null>(null);
  const [revision, setRevision] = React.useState<{ version: string; claves: ReadonlySet<string> } | null>(null);
  const revisadas = revision && revision.version === edicion?.version ? revision.claves : new Set<string>();
  const [conflictoAprobacion, setConflictoAprobacion] = React.useState(false);
  const [borradorAnterior, setBorradorAnterior] = React.useState<NotaSoap | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [errorAccion, setErrorAccion] = React.useState<string | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = React.useState(false);
  // La nota se acaba de aprobar en esta pantalla. No es lo mismo que
  // `estado === "aprobada"`: una nota abierta ya aprobada no muestra el
  // aviso, porque no acaba de pasar nada.
  const [aprobadaAhora, setAprobadaAhora] = React.useState(false);

  const aplicar = React.useCallback((fila: SesionClinicaResponse) => {
    setSesion(fila);
    setEdicion((previa) => {
      const version = versionDe(fila);
      return previa && previa.version === version
        ? previa
        : { version, generacion: fila.generacion, nota: notaDeSesion(fila) };
    });
  }, []);

  // Carga inicial y recarga manual. El estado se escribe al resolverse la
  // promesa, nunca en el cuerpo del efecto.
  const [intentoCarga, setIntentoCarga] = React.useState(0);
  React.useEffect(() => {
    const controlador = new AbortController();
    leerSesion(id, controlador.signal)
      .then((fila) => {
        aplicar(fila);
        setErrorCarga(null);
        setCargando(false);
      })
      .catch((error: unknown) => {
        if (esAbort(error) || controlador.signal.aborted) return;
        setErrorCarga(mensajeParaElla(error));
        setCargando(false);
      });
    return () => controlador.abort();
  }, [id, intentoCarga, aplicar]);

  const recargar = () => {
    setCargando(true);
    setErrorCarga(null);
    setIntentoCarga((n) => n + 1);
  };

  // Relectura mientras la sesión sigue en el pipeline. Con la sesión ya
  // fuera de esos estados el hook queda deshabilitado y no consulta.
  const enPipeline = sesion !== null && ESTADOS_ACTIVOS.has(sesion.estado);
  const onSesion = React.useCallback(
    ({ fila }: { fila: SesionClinicaResponse }) => {
      aplicar(fila);
    },
    [aplicar],
  );
  useSesionClinicaPolling({
    sesionClinicaId: id,
    enabled: enPipeline,
    onSesion,
  });

  // Las casillas que exige aprobar: una por flag activo, la de la señal
  // graduada y la de las menciones. Es la MISMA regla con que el servidor
  // rechaza una aprobación sin confirmar (lib/sesion-clinica/aprobacion.ts).
  const datos = sesion?.datos ?? null;
  const exigidas = React.useMemo(() => confirmacionesParaAprobar(datos), [datos]);
  const claves = clavesDeConfirmacion(exigidas);
  // Aprobar no se habilita hasta que TODAS estén marcadas. Sin señales, la
  // lista está vacía y `every` es true.
  const puedeAprobar = !conflictoAprobacion && claves.every((clave) => revisadas.has(clave));
  const motivo = motivoBloqueo({ conflicto: conflictoAprobacion, claves, revisadas });

  const marcarRevisada = React.useCallback((clave: string, marcada: boolean) => {
    if (!edicion) return;
    setRevision((previa) => {
      const claves = new Set(previa?.version === edicion.version ? previa.claves : []);
      if (marcada) claves.add(clave);
      else claves.delete(clave);
      return { version: edicion.version, claves };
    });
  }, [edicion]);

  const editarSeccion = React.useCallback(
    (clave: keyof NotaSoap, valor: string) => {
      setEdicion((previa) =>
        previa ? { ...previa, nota: { ...previa.nota, [clave]: valor } } : previa,
      );
    },
    [],
  );

  const revisarNotaActual = async () => {
    setEnviando(true);
    try {
      const fila = await leerSesion(id);
      if (edicion) setBorradorAnterior(edicion.nota);
      aplicar(fila);
      setRevision(null);
      setConflictoAprobacion(false);
      setErrorAccion(null);
    } catch (error) {
      setErrorAccion(mensajeParaElla(error));
    } finally {
      setEnviando(false);
    }
  };

  const aprobar = async () => {
    if (!edicion || !puedeAprobar) return;
    setEnviando(true);
    setErrorAccion(null);
    try {
      // La respuesta ES la fila aprobada: se aplica en vez de descartarse.
      // Con eso el chip pasa a "Nota guardada", `editable` se apaga y la
      // barra de acciones se va sola, sin recargar ni navegar.
      const fila = await apiPost<SesionClinicaResponse>(
        `/api/sesion-clinica/${id}/aprobar`,
        {
          generacion: edicion.generacion,
          notaEditada: edicion.nota,
          ...confirmacionesDeCasillas(exigidas, revisadas),
        },
      );
      aplicar(fila);
      setBorradorAnterior(null);
      setAprobadaAhora(true);
      setEnviando(false);
      onAprobada();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) setConflictoAprobacion(true);
      setErrorAccion(mensajeParaElla(error));
      setEnviando(false);
    }
  };

  // Descartar: la nota se manda a escribir de nuevo (POST /reprocesar). No
  // se borra nada y no se vuelve a transcribir; la sesión vuelve a
  // "procesando" y la pantalla la relee. Si cambió de estado mientras la
  // pantalla estaba abierta, la API contesta 409.
  const descartar = async () => {
    setEnviando(true);
    setErrorAccion(null);
    try {
      await apiPost(`/api/sesion-clinica/${id}/reprocesar`, {});
      setIntentoCarga((n) => n + 1);
    } catch (error) {
      setErrorAccion(mensajeParaElla(error));
    } finally {
      setEnviando(false);
    }
  };

  const reintentar = async () => {
    setEnviando(true);
    setErrorAccion(null);
    try {
      const fila = await apiPost<SesionClinicaResponse>(
        `/api/sesion-clinica/${id}/reintentar`,
        {},
      );
      aplicar(fila);
    } catch (error) {
      setErrorAccion(mensajeParaElla(error));
    } finally {
      setEnviando(false);
    }
  };

  // Eliminar desde "fallida": borrado definitivo de la sesión y su audio.
  const eliminar = async () => {
    setEnviando(true);
    setErrorAccion(null);
    try {
      await apiPost(`/api/sesion-clinica/${id}/eliminar`, {});
      router.back();
    } catch (error) {
      setErrorAccion(mensajeParaElla(error));
      setConfirmarEliminar(false);
      setEnviando(false);
    }
  };

  return {
    sesion,
    aplicar,
    cargando,
    errorCarga,
    recargar,
    edicion,
    editarSeccion,
    revisadas,
    marcarRevisada,
    puedeAprobar,
    motivo,
    conflictoAprobacion,
    revisarNotaActual,
    borradorAnterior,
    enviando,
    errorAccion,
    confirmarEliminar,
    setConfirmarEliminar,
    aprobadaAhora,
    aprobar,
    descartar,
    reintentar,
    eliminar,
  };
}
