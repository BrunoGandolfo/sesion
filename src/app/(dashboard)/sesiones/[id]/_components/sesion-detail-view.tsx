"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft } from "lucide-react";

import { EsqueletoNotaCuerpo } from "@/components/esqueletos";
import { Button, Confirmar, Toast } from "@/components/ui";
import { AnilloProgreso } from "@/components/ui/movimiento";
import { hayParaVos } from "@/components/grabacion/FeedbackTerapeutaView";
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
import { ConfirmarSalida } from "./confirmar-salida";
import { NotaSesionView } from "./nota-sesion-view";
import { ParaVosView } from "./para-vos-view";
import { hrefDeVista, SelectorVista, type VistaSesion } from "./selector-vista";
import {
  ALGO_FALLO,
  ELIMINANDO,
  ELIMINAR,
  ELIMINAR_MENSAJE,
  ELIMINAR_TITULO,
  ESCRIBIENDO_NOTA,
  LEER_PARA_VOS,
  NOTA_APROBADA_AVISO,
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
// DOS VISTAS, UN SOLO CONTENEDOR
//
// La sesión tiene dos caras: la nota clínica (/sesiones/[id]) y "Para vos"
// (/sesiones/[id]/para-vos). Las dos leen la misma fila, comparten cabecera
// y se eligen con el mismo selector, así que las dos rutas montan este
// componente con `vista` distinta. Duplicar la carga, el polling y los
// estados de pipeline en dos contenedores habría sido dos veces la misma
// pantalla con dos formas de fallar.
//
// La barra de acciones —aprobar, descartar— es sólo de la nota: es donde se
// firma el documento clínico.
//
// Un solo origen de datos: GET /api/sesion-clinica/[id] por el cliente de
// API. Mientras la sesión está en el pipeline se relee con
// useSesionClinicaPolling, que ya deja de consultar solo cuando el estado
// sale de ESTADOS_ACTIVOS (grabando, subiendo, procesando).
//
// El texto que ella edita vive acá, en el estado local, y viaja entero como
// notaEditada al aprobar. Nunca se guarda por sección: aprobar es el único
// momento en que la nota se escribe.
//
// DESPUÉS DE APROBAR NO SE VA A NINGÚN LADO
//
// Antes la pantalla se volvía sola a los 1,1 s (`router.back()` con un
// timeout). O sea que el momento en que ella terminaba de revisar la nota
// —justo cuando "Para vos" es lo que quiere leer— era el momento en que la
// app la expulsaba. Ahora se queda: la fila aprobada que devuelve el POST
// entra en pantalla, la nota pasa a decir "Nota guardada" en su chip, la
// barra de acciones desaparece porque ya no hay nada que firmar, y en su
// lugar queda un aviso con el camino a "Para vos".

function notaDeSesion(sesion: SesionClinicaResponse): NotaSoap {
  return {
    subjetivo: sesion.notaSubjetivo ?? "",
    objetivo: sesion.notaObjetivo ?? "",
    analisis: sesion.notaAnalisis ?? "",
    plan: sesion.notaPlan ?? "",
  };
}

/** Dos notas con el mismo texto en las cuatro secciones. */
function mismaNota(a: NotaSoap, b: NotaSoap): boolean {
  return (
    a.subjetivo === b.subjetivo &&
    a.objetivo === b.objetivo &&
    a.analisis === b.analisis &&
    a.plan === b.plan
  );
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

export function SesionDetailView({
  id,
  vista = "nota",
}: {
  id: string;
  vista?: VistaSesion;
}) {
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
  // "Volver" con correcciones sin aprobar: pregunta antes de irse.
  const [confirmarVolver, setConfirmarVolver] = React.useState(false);
  // La nota se acaba de aprobar en esta pantalla. No es lo mismo que
  // `estado === "aprobado"`: una nota abierta ya aprobada no muestra el
  // aviso, porque no acaba de pasar nada.
  const [aprobadaAhora, setAprobadaAhora] = React.useState(false);
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
      // La respuesta ES la fila aprobada: se aplica en vez de descartarse.
      // Con eso el chip pasa a "Nota guardada", `editable` se apaga y la
      // barra de acciones se va sola, sin recargar ni navegar.
      const fila = await apiPost<SesionClinicaResponse>(
        `/api/sesion-clinica/${id}/aprobar`,
        {
          notaEditada: edicion.nota,
          ...(exigeConfirmarRiesgo ? { confirmoRiesgo: true } : {}),
        },
      );
      aplicar(fila);
      setAprobadaAhora(true);
      setEnviando(false);
      setToast({ open: true, mensaje: NOTA_GUARDADA });
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

  // Sólo la nota se firma: "Para vos" es lectura.
  const editable = vista === "nota" && sesion?.estado === "revision";

  // La nota escrita y "Para vos" son las dos caras de la misma sesión.
  const conNota =
    sesion !== null &&
    (sesion.estado === "revision" || sesion.estado === "aprobado");

  // Correcciones escritas y todavía no aprobadas. El borrador vive acá y sólo
  // se escribe al aprobar, así que irse de la pantalla lo borra.
  //
  // Se compara contra la nota de la fila, que es de donde salió el borrador
  // (`aplicar`): así, deshacer a mano una corrección vuelve a dejar la nota
  // sin cambios y el aviso no aparece por nada.
  const tieneCambios =
    editable &&
    sesion !== null &&
    edicion !== null &&
    !mismaNota(edicion.nota, notaDeSesion(sesion));

  // ── Las tres puertas por las que se pierde el borrador ──────────────────
  //
  // 1. El selector de vista (selector-vista.tsx) y 2. el botón "Volver" de
  //    acá abajo: las dos preguntan con el mismo ConfirmarSalida.
  // 3. Cerrar la pestaña o recargar: el aviso lo da el navegador, abajo.
  //
  // EL GESTO DE ATRÁS DEL TELÉFONO QUEDA SIN CUBRIR, A PROPÓSITO.
  //
  // La única forma de interceptarlo es empujar una entrada falsa al historial
  // con pushState y devolverla en cada popstate. Ese hack le miente al
  // historial de toda la app: rompe el "atrás" de las demás pantallas, deja
  // entradas fantasma cuando el componente se desmonta por cualquier otro
  // camino, y en el navegador del teléfono —que es donde ella trabaja— el
  // gesto es el que más se usa, o sea el que peor se puede permitir romper.
  // El precio de no interceptarlo es perder correcciones en un caso; el de
  // interceptarlo, una navegación impredecible en toda la app. Se elige el
  // primero, y queda escrito acá para que nadie lo "arregle" sin leer esto.

  // Cerrar la pestaña o recargar. El navegador muestra su propio diálogo y no
  // se puede escribir su texto: desde 2019 Chrome, Firefox y Safari ignoran
  // cualquier string que se devuelva. Alcanza igual — lo que hace falta es
  // que pregunte, no cómo lo diga.
  React.useEffect(() => {
    if (!tieneCambios) return;
    const alSalir = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [tieneCambios]);

  // El selector no se ofrece si la otra cara está vacía: un control de dos
  // opciones donde una lleva a una pantalla sin nada enseña lo contrario de
  // lo que vino a enseñar. Estando en "Para vos" siempre se ofrece, para
  // poder salir por donde se entró.
  const selector =
    conNota && (vista === "para-vos" || hayParaVos(datos?.feedbackTerapeuta)) ? (
      <SelectorVista id={id} vista={vista} tieneCambios={tieneCambios} />
    ) : null;

  return (
    <>
      <div
        className={`mx-auto max-w-[1120px] px-5 py-6 lg:px-10 lg:py-8 ${
          editable ? "pb-[180px] lg:pb-[120px]" : ""
        }`}
      >
        {/* Volver, y la pregunta justo debajo cuando hay correcciones sin
            aprobar: el panel sale de donde está el botón que lo abrió, no en
            un rincón de la pantalla. */}
        <div className="mb-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              if (tieneCambios) {
                setConfirmarVolver(true);
                return;
              }
              router.back();
            }}
            className="inline-flex min-h-[44px] items-center gap-1 self-start font-sans text-[13px] text-ink-500 transition-colors duration-150 hover:text-ink-700"
          >
            <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
            <span>{VOLVER}</span>
          </button>

          {confirmarVolver ? (
            <ConfirmarSalida
              onConfirmar={() => router.back()}
              onCancelar={() => setConfirmarVolver(false)}
            />
          ) : null}
        </div>

        {/* La segunda espera: la ruta ya llegó —su loading.tsx dibujó este
            mismo cuerpo— y falta GET /api/sesion-clinica/[id]. El "Volver"
            de arriba queda afuera del esqueleto porque ya está dibujado y ya
            es tocable: si la nota tarda, volverse tiene que seguir siendo
            posible. */}
        {cargando && !sesion ? <EsqueletoNotaCuerpo /> : null}

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

        {conNota && sesion && vista === "para-vos" ? (
          <ParaVosView sesion={sesion} selector={selector} />
        ) : null}

        {conNota && sesion && edicion && vista === "nota" ? (
          <NotaSesionView
            sesion={sesion}
            nota={edicion.nota}
            editable={sesion.estado === "revision"}
            onEditarSeccion={
              sesion.estado === "revision" ? editarSeccion : undefined
            }
            revisadas={revisadas}
            onRevisar={marcarRevisada}
            selector={selector}
            aviso={
              aprobadaAhora ? (
                <AvisoAprobada
                  id={id}
                  conParaVos={hayParaVos(datos?.feedbackTerapeuta)}
                />
              ) : null
            }
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

/**
 * Lo que queda en la nota después de aprobar: que quedó guardada, y el
 * camino a "Para vos".
 *
 * Es una confirmación, no una celebración. Sin Lupita, sin check dibujado,
 * sin felicitación: la nota clínica no lleva personaje ni celebración
 * (docs/diseno/04-personaje.md), y esto está en la misma pantalla que el
 * bloque de riesgo. Verde salvia porque algo salió bien, y nada más.
 *
 * El enlace no se dibuja si no hay análisis: ofrecer una pantalla vacía
 * justo después de aprobar sería la peor primera impresión posible de la
 * mitad del producto que esta tanda vino a poner a la vista.
 */
function AvisoAprobada({
  id,
  conParaVos,
}: {
  id: string;
  conParaVos: boolean;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sage-200 bg-sage-50 px-4 py-3"
    >
      <p className="font-sans text-[14px] leading-[1.5] text-ink-900">
        {NOTA_APROBADA_AVISO}
      </p>
      {conParaVos ? (
        <Link
          href={hrefDeVista(id, "para-vos")}
          className="inline-flex min-h-[44px] items-center font-sans text-[14px] font-semibold text-sage-600 transition-colors duration-150 hover:text-sage-700"
        >
          {LEER_PARA_VOS}
        </Link>
      ) : null}
    </div>
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
