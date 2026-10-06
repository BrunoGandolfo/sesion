"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { EsqueletoNotaCuerpo } from "@/components/esqueletos";
import { Button, Confirmar, Toast } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { AnilloProgreso } from "@/components/ui/movimiento";
import { hayParaVos } from "@/components/grabacion/FeedbackTerapeutaView";
import { useProtegerTrabajo, useSalidaProtegida } from "@/components/layout/proteccion-trabajo";
import { CAMBIOS_SIN_APROBAR_MENSAJE, SESION_FALLO_LABEL } from "@/lib/glosario";
import { estaEnProceso } from "@/lib/sesion-clinica/estados";

import { accionesDeUsuaria, cuerpoDe } from "./acciones-sesion";
import { Aviso, AvisoAprobada } from "./avisos-sesion";
import { BarraAcciones } from "./barra-acciones";
import { mismaNota, notaDeSesion } from "./datos";
import { NotaSesionView } from "./nota-sesion-view";
import { ParaVosView } from "./para-vos-view";
import { SelectorVista, type VistaSesion } from "./selector-vista";
import { TranscripcionView } from "./transcripcion-view";
import { useParaVos } from "./use-para-vos";
import { useRevisionNota } from "./use-revision-nota";
import {
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
  SECCIONES_SOAP,
  SIN_NOTA_TODAVIA,
  VOLVER,
} from "./textos";

// Pantalla completa de una sesión. Reemplaza al sheet: la nota es el
// documento clínico de la sesión y se lee entera, con su propia URL, no
// dentro de un panel que tapa la ficha.
//
// TRES VISTAS, UN SOLO CONTENEDOR
//
// La sesión tiene tres caras: la nota clínica (/sesiones/[id]), "Para vos"
// (/sesiones/[id]/para-vos) y la transcripción (/sesiones/[id]/transcripcion,
// que pide su texto aparte y recién al abrirse). Todas leen la misma fila, comparten cabecera
// y se eligen con el mismo selector, así que las tres rutas montan este
// componente con `vista` distinta. Duplicar la carga, el polling y los
// estados de pipeline en dos contenedores habría sido dos veces la misma
// pantalla con dos formas de fallar.
//
// La barra de acciones —aprobar, descartar— es sólo de la nota: es donde se
// firma el documento clínico.
//
// Un solo origen de datos: GET /api/sesion-clinica/[id] (datos.ts). La fila,
// la relectura mientras está en el pipeline, el borrador y las acciones que
// lo firman viven en useRevisionNota; la relectura de "Para vos" mientras se
// escribe, en useParaVos. Acá queda la presentación.
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

export function SesionDetailView({
  id,
  vista = "nota",
}: {
  id: string;
  vista?: VistaSesion;
}) {
  const router = useRouter();
  const toast = useToast();
  const {
    sesion, aplicar, cargando, errorCarga, recargar, edicion, editarSeccion, revisadas,
    marcarRevisada, puedeAprobar, motivo, conflictoAprobacion, revisarNotaActual,
    borradorAnterior, enviando, errorAccion, confirmarEliminar, setConfirmarEliminar,
    aprobadaAhora, aprobar, descartar, reintentar, eliminar,
  } = useRevisionNota(id, { onAprobada: () => toast.confirmar(NOTA_GUARDADA) });
  const paraVos = useParaVos({ id, vista, feedbackEstado: sesion?.feedbackEstado, aplicar });

  // El detalle del fallo es diagnóstico (a veces lo escribe el worker, con
  // recortes del pipeline): va a la consola, no a la pantalla. A ella se le
  // dice el motivo por su código, en castellano.
  const falloDetalle = sesion?.estado === "fallida" ? sesion.falloDetalle : null;
  React.useEffect(() => {
    if (falloDetalle) console.warn(`[sesion ${id}] fallo: ${falloDetalle}`);
  }, [id, falloDetalle]);
  const motivoFallo = sesion?.falloCodigo ? (SESION_FALLO_LABEL[sesion.falloCodigo] ?? null) : null;
  // "Volver" con correcciones sin aprobar: pregunta antes de irse.
  const confirmarSalida = useSalidaProtegida();
  const feedback = sesion?.feedback;

  // El cuerpo y las acciones salen de la tabla de operaciones
  // (acciones-sesion.ts), no de literales: un estado nuevo no compila hasta
  // ubicarlo en CUERPO.
  const cuerpo = sesion ? cuerpoDe(sesion.estado) : null;
  const acciones = sesion ? accionesDeUsuaria(sesion.estado) : null;

  // Sólo la nota se firma: "Para vos" es lectura.
  const editable = vista === "nota" && acciones?.aprobar === true;

  // La nota escrita y "Para vos" son las dos caras de la misma sesión.
  const conNota = cuerpo === "nota";

  // Correcciones escritas y todavía no aprobadas. El borrador vive acá y sólo
  // se escribe al aprobar, así que irse de la pantalla lo borra.
  //
  // Se compara contra la nota de la fila, que es de donde salió el borrador
  // (`aplicar`): así, deshacer a mano una corrección vuelve a dejar la nota
  // sin cambios y el aviso no aparece por nada.
  const tieneCambios = (editable && borradorAnterior !== null) ||
    editable &&
    sesion !== null &&
    edicion !== null &&
    !mismaNota(edicion.nota, notaDeSesion(sesion));

  // Menú, enlaces, Atrás y recarga usan la misma protección del dashboard.
  useProtegerTrabajo(tieneCambios || borradorAnterior !== null, CAMBIOS_SIN_APROBAR_MENSAJE);

  // Para vos también explica la espera y ofrece el reintento cuando corresponde.
  const selector =
    conNota ? (
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
            onClick={() => confirmarSalida(() => router.back(), { navegar: true })}
            className="inline-flex min-h-[44px] items-center gap-1 self-start font-sans text-[13px] text-ink-500 transition-colors duration-[var(--duration-fast)] hover:text-ink-700"
          >
            <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
            <span>{VOLVER}</span>
          </button>


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
              onClick={recargar}
            >
              {REINTENTAR}
            </Button>
          </Aviso>
        ) : null}

        {sesion && estaEnProceso(sesion.estado) ? (
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

        {cuerpo === "sin-nota" ? (
          <p role="status" className="font-sans text-[14px] text-ink-500">
            {SIN_NOTA_TODAVIA}
          </p>
        ) : null}

        {cuerpo === "fallida" ? (
          <div className="flex flex-col gap-4">
            <Aviso titulo={NOTA_NO_ESCRITA} detalle={motivoFallo}>
              <div className="flex flex-wrap items-center gap-3">
                {acciones?.reintentar ? (
                  <Button
                    variant="secondary"
                    onClick={() => void reintentar()}
                    disabled={enviando || confirmarEliminar}
                  >
                    {enviando && !confirmarEliminar ? REINTENTANDO : REINTENTAR}
                  </Button>
                ) : null}
                {acciones?.eliminar ? (
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmarEliminar(true)}
                    disabled={enviando || confirmarEliminar}
                    className="!text-terracotta-500"
                  >
                    {ELIMINAR}
                  </Button>
                ) : null}
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
          <ParaVosView sesion={sesion} selector={selector} onReintentar={() => void paraVos.pedir()}
            pidiendo={paraVos.pidiendo} error={paraVos.error} onActualizar={paraVos.actualizar} />
        ) : null}

        {conNota && sesion && vista === "transcripcion" ? (
          <TranscripcionView sesion={sesion} selector={selector} />
        ) : null}

        {conNota && sesion && edicion && vista === "nota" ? (
          <NotaSesionView
            sesion={sesion}
            nota={edicion.nota}
            editable={acciones?.aprobar === true}
            onEditarSeccion={acciones?.aprobar ? editarSeccion : undefined}
            revisadas={revisadas}
            onRevisar={marcarRevisada}
            selector={selector}
            aviso={
              aprobadaAhora ? (
                <AvisoAprobada
                  id={id}
                  conParaVos={hayParaVos(feedback)}
                />
              ) : null
            }
          />
        ) : null}

        {borradorAnterior ? (
          <details className="mt-4 rounded-lg border border-[color:var(--border-subtle)] p-4">
            <summary>Tu borrador anterior</summary>
            <p>Lo conservamos acá para que puedas recuperar tus correcciones mientras revisás la nota actual.</p>
            {SECCIONES_SOAP.map(({ clave, titulo }) => (
              <div key={clave} className="mt-3">
                <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">{titulo}</p>
                <p className="whitespace-pre-wrap">{borradorAnterior[clave]}</p>
              </div>
            ))}
          </details>
        ) : null}
        {conflictoAprobacion ? (
          <Button variant="secondary" disabled={enviando} onClick={() => void revisarNotaActual()}>
            Revisar nota actual
          </Button>
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
          key={edicion?.version}
          puedeAprobar={puedeAprobar}
          motivo={motivo}
          borradorAnterior={borradorAnterior !== null}
          enviando={enviando}
          onAprobar={() => void aprobar()}
          onDescartar={() => void descartar()}
        />
      ) : null}

      <Toast {...toast.props} />
    </>
  );
}
