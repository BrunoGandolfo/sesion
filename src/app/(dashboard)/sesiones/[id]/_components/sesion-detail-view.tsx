"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft } from "lucide-react";

import { Button, Confirmar, Toast } from "@/components/ui";
import { AnilloProgreso } from "@/components/ui/movimiento";
import {
  clavesDeRiesgo,
  CLAVE_RIESGO_GRADUADO,
} from "@/components/grabacion/RiesgoDetectadoBanner";
import {
  ESTADOS_ACTIVOS,
  useSesionClinicaPolling,
} from "@/hooks/useSesionClinicaPolling";
import { apiDelete, apiGet, apiPatch, apiPost, esAbort } from "@/lib/api-client";
import type {
  NotaSoap,
  SesionClinicaResponse,
} from "@/lib/sesion-clinica/schema";

import { BarraAcciones } from "./barra-acciones";
import { NotaSesionView } from "./nota-sesion-view";
import {
  ABRIENDO_NOTA,
  ALGO_FALLO,
  ELIMINANDO,
  ELIMINAR,
  ELIMINAR_MENSAJE,
  ELIMINAR_TITULO,
  ESCRIBIENDO_NOTA,
  NOTA_GUARDADA,
  NOTA_NO_ESCRITA,
  REINTENTANDO,
  REINTENTAR,
  SIN_NOTA_TODAVIA,
  VOLVER,
} from "./textos";

// Pantalla completa de una sesión. Reemplaza al sheet: la nota es el
// documento clínico de la sesión y se lee entera, con su propia URL, no
// dentro de un panel que tapa la ficha.
//
// Un solo origen de datos: GET /api/sesion-clinica/[id] por el cliente de
// API. Mientras la sesión está en el pipeline se relee con
// useSesionClinicaPolling, que ya deja de consultar solo cuando el estado
// sale de ESTADOS_ACTIVOS (grabando, subiendo, procesando).
//
// El texto que ella edita vive acá, en el estado local, y viaja entero como
// notaEditada al aprobar. Nunca se guarda por sección: aprobar es el único
// momento en que la nota se escribe.

/** Espera antes de volver, para que el toast "Nota guardada" se llegue a
 *  leer en la pantalla en la que ella estaba trabajando. */
const MS_ANTES_DE_VOLVER = 1100;

function notaDeSesion(sesion: SesionClinicaResponse): NotaSoap {
  return {
    subjetivo: sesion.notaSubjetivo ?? "",
    objetivo: sesion.notaObjetivo ?? "",
    analisis: sesion.notaAnalisis ?? "",
    plan: sesion.notaPlan ?? "",
  };
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : ALGO_FALLO;
}

/** Edición atada a la versión de la fila que la originó: si la sesión se
 *  reescribe (descarte, reproceso), el borrador viejo deja de aplicar sin
 *  necesidad de un efecto que lo resetee. */
type Edicion = { version: string; nota: NotaSoap };

function versionDe(sesion: SesionClinicaResponse): string {
  return `${sesion.id}:${sesion.updatedAt}`;
}

export function SesionDetailView({ id }: { id: string }) {
  const router = useRouter();

  const [sesion, setSesion] = React.useState<SesionClinicaResponse | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [errorCarga, setErrorCarga] = React.useState<string | null>(null);
  const [edicion, setEdicion] = React.useState<Edicion | null>(null);
  const [revisadas, setRevisadas] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [enviando, setEnviando] = React.useState(false);
  const [errorAccion, setErrorAccion] = React.useState<string | null>(null);
  const [confirmarEliminar, setConfirmarEliminar] = React.useState(false);
  // La nota ya se guardó: la barra pasa a confirmar mientras la pantalla
  // vuelve sola. Sin esto, el último segundo mostraba los botones todavía
  // ofreciendo aprobar algo que ya estaba aprobado.
  const [guardada, setGuardada] = React.useState(false);
  const [toast, setToast] = React.useState({ open: false, mensaje: "" });

  const aplicar = React.useCallback((fila: SesionClinicaResponse) => {
    setSesion(fila);
    setEdicion((previa) => {
      const version = versionDe(fila);
      return previa && previa.version === version
        ? previa
        : { version, nota: notaDeSesion(fila) };
    });
  }, []);

  // Carga inicial y recarga manual. El estado se escribe al resolverse la
  // promesa, nunca en el cuerpo del efecto.
  const [intentoCarga, setIntentoCarga] = React.useState(0);
  React.useEffect(() => {
    const controlador = new AbortController();
    apiGet<SesionClinicaResponse>(`/api/sesion-clinica/${id}`, {
      signal: controlador.signal,
    })
      .then((fila) => {
        aplicar(fila);
        setErrorCarga(null);
        setCargando(false);
      })
      .catch((error: unknown) => {
        if (esAbort(error) || controlador.signal.aborted) return;
        setErrorCarga(mensajeDeError(error));
        setCargando(false);
      });
    return () => controlador.abort();
  }, [id, intentoCarga, aplicar]);

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

  const volverRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (volverRef.current !== null) clearTimeout(volverRef.current);
    },
    [],
  );

  const datos = sesion?.datosEstructurados ?? null;
  const clavesRiesgo = React.useMemo(
    () => clavesDeRiesgo(datos?.riesgoDetectado, datos?.flagsRiesgo),
    [datos],
  );
  // Aprobar no se habilita hasta que TODAS las casillas estén marcadas: una
  // por flag activo más la de la señal graduada. Sin señales, la lista está
  // vacía y `every` es true.
  const puedeAprobar = clavesRiesgo.every((clave) => revisadas.has(clave));
  const exigeConfirmarRiesgo = clavesRiesgo.includes(CLAVE_RIESGO_GRADUADO);

  const marcarRevisada = React.useCallback((clave: string, marcada: boolean) => {
    setRevisadas((previas) => {
      const siguiente = new Set(previas);
      if (marcada) siguiente.add(clave);
      else siguiente.delete(clave);
      return siguiente;
    });
  }, []);

  const editarSeccion = React.useCallback(
    (clave: keyof NotaSoap, valor: string) => {
      setEdicion((previa) =>
        previa ? { ...previa, nota: { ...previa.nota, [clave]: valor } } : previa,
      );
    },
    [],
  );

  const aprobar = async () => {
    if (!edicion || !puedeAprobar) return;
    setEnviando(true);
    setErrorAccion(null);
    try {
      await apiPost<SesionClinicaResponse>(
        `/api/sesion-clinica/${id}/aprobar`,
        {
          notaEditada: edicion.nota,
          ...(exigeConfirmarRiesgo ? { confirmoRiesgo: true } : {}),
        },
      );
      setGuardada(true);
      setToast({ open: true, mensaje: NOTA_GUARDADA });
      volverRef.current = setTimeout(() => {
        router.back();
      }, MS_ANTES_DE_VOLVER);
    } catch (error) {
      setErrorAccion(mensajeDeError(error));
      setEnviando(false);
    }
  };

  // Descartar: la sesión vuelve a "error" conservando transcripción y audio.
  // No se navega a ningún lado — la pantalla pasa a mostrar el estado de
  // error, con Reintentar y Eliminar.
  //
  // `accion` va explícita: es la misma URL que usa `eliminar`, y lo único que
  // las distingue. Si la sesión cambió de estado mientras la pantalla estaba
  // abierta, la API contesta 409 y no hace la otra cosa (ver la cabecera de
  // casos-uso/eliminar-sesion.ts).
  const descartar = async () => {
    setEnviando(true);
    setErrorAccion(null);
    try {
      await apiDelete(`/api/sesion-clinica/${id}?accion=descartar`);
      setIntentoCarga((n) => n + 1);
    } catch (error) {
      setErrorAccion(mensajeDeError(error));
    } finally {
      setEnviando(false);
    }
  };

  const reintentar = async () => {
    setEnviando(true);
    setErrorAccion(null);
    try {
      const fila = await apiPatch<SesionClinicaResponse>(
        `/api/sesion-clinica/${id}`,
        { estado: "procesando" },
      );
      aplicar(fila);
    } catch (error) {
      setErrorAccion(mensajeDeError(error));
    } finally {
      setEnviando(false);
    }
  };

  // Eliminar desde "error": borrado definitivo de la sesión y su audio.
  const eliminar = async () => {
    setEnviando(true);
    setErrorAccion(null);
    try {
      await apiDelete(`/api/sesion-clinica/${id}?accion=eliminar`);
      router.back();
    } catch (error) {
      setErrorAccion(mensajeDeError(error));
      setConfirmarEliminar(false);
      setEnviando(false);
    }
  };

  const editable = sesion?.estado === "revision";

  return (
    <>
      <div
        className={`mx-auto max-w-[1120px] px-5 py-6 lg:px-10 lg:py-8 ${
          editable ? "pb-[180px] lg:pb-[120px]" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 inline-flex min-h-[44px] items-center gap-1 font-sans text-[13px] text-ink-500 transition-colors duration-150 hover:text-ink-700"
        >
          <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
          <span>{VOLVER}</span>
        </button>

        {cargando && !sesion ? (
          <p role="status" className="font-sans text-[14px] text-ink-500">
            {ABRIENDO_NOTA}
          </p>
        ) : null}

        {errorCarga !== null && !sesion ? (
          <Aviso titulo={ALGO_FALLO} detalle={errorCarga}>
            <Button
              variant="secondary"
              onClick={() => {
                setCargando(true);
                setErrorCarga(null);
                setIntentoCarga((n) => n + 1);
              }}
            >
              {REINTENTAR}
            </Button>
          </Aviso>
        ) : null}

        {sesion && (sesion.estado === "procesando" || sesion.estado === "subiendo") ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <AnilloProgreso tamano={30} className="text-gold-500" />
            <p
              role="status"
              className="font-display text-[18px] font-medium italic text-ink-900"
            >
              {ESCRIBIENDO_NOTA}
            </p>
          </div>
        ) : null}

        {sesion &&
        (sesion.estado === "pendiente" || sesion.estado === "grabando") ? (
          <p role="status" className="font-sans text-[14px] text-ink-500">
            {SIN_NOTA_TODAVIA}
          </p>
        ) : null}

        {sesion && sesion.estado === "error" ? (
          <div className="flex flex-col gap-4">
            <Aviso titulo={NOTA_NO_ESCRITA} detalle={sesion.error}>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => void reintentar()}
                  disabled={enviando || confirmarEliminar}
                >
                  {enviando && !confirmarEliminar ? REINTENTANDO : REINTENTAR}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmarEliminar(true)}
                  disabled={enviando || confirmarEliminar}
                  className="!text-terracotta-500"
                >
                  {ELIMINAR}
                </Button>
              </div>
            </Aviso>

            {confirmarEliminar ? (
              <Confirmar
                titulo={ELIMINAR_TITULO}
                mensaje={ELIMINAR_MENSAJE}
                accion={ELIMINAR}
                variante="peligro"
                enviando={enviando}
                enviandoLabel={ELIMINANDO}
                onConfirmar={() => void eliminar()}
                onCancelar={() => setConfirmarEliminar(false)}
              />
            ) : null}
          </div>
        ) : null}

        {sesion && edicion && (sesion.estado === "revision" || sesion.estado === "aprobado") ? (
          <NotaSesionView
            sesion={sesion}
            nota={edicion.nota}
            editable={sesion.estado === "revision"}
            onEditarSeccion={
              sesion.estado === "revision" ? editarSeccion : undefined
            }
            revisadas={revisadas}
            onRevisar={marcarRevisada}
          />
        ) : null}

        {errorAccion !== null ? (
          <p
            role="alert"
            className="mt-4 font-sans text-[14px] text-[color:var(--color-error)]"
          >
            {errorAccion}
          </p>
        ) : null}
      </div>

      {editable ? (
        <BarraAcciones
          puedeAprobar={puedeAprobar}
          enviando={enviando}
          guardada={guardada}
          onAprobar={() => void aprobar()}
          onDescartar={() => void descartar()}
        />
      ) : null}

      <Toast
        open={toast.open}
        message={toast.mensaje}
        onClose={() => setToast((previo) => ({ ...previo, open: false }))}
      />
    </>
  );
}

function Aviso({
  titulo,
  detalle,
  children,
}: {
  titulo: string;
  detalle?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <section
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-terracotta-100 bg-terracotta-50 px-4 py-4"
    >
      <div className="flex items-start gap-2">
        <AlertCircle
          size={18}
          strokeWidth={1.9}
          aria-hidden="true"
          className="mt-[2px] shrink-0 text-terracotta-500"
        />
        <div className="flex flex-col gap-1">
          <p className="font-sans text-[15px] font-semibold text-ink-900">
            {titulo}
          </p>
          {detalle ? (
            <p className="font-sans text-[13px] leading-[1.55] text-ink-700">
              {detalle}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}
