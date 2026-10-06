"use client";

// Pestaña Sesiones: la lista de sesiones, y nada antes que ella.
//
// Una investigación de uso sobre producción encontró la lista enterrada: con
// dos sesiones, su título aparecía a 2060 px del comienzo en el celular,
// debajo de una tarjeta "Hoy" y de un resumen largo y abierto. Y la sesión de
// hoy se sacaba de la lista, así que el contador decía "2 sesiones" y se veía
// una. Ahora:
//
//   - el título de la lista es lo primero de la pestaña;
//   - cada sesión aparece UNA vez, la de hoy incluida, destacada en su lugar
//     —arriba, porque es la más reciente— con su acción pendiente adentro;
//   - el contador cuenta lo que la lista muestra;
//   - el resumen previo es el botón "Preparar sesión" del renglón del título
//     (brief-pre-sesion.tsx), cerrado salvo que la ficha venga con ?preparar=1;
//   - el resumen de cada fila va entero: ningún texto clínico se recorta.
//
// Acá no se graba ni se revisa nada: grabar vive en /grabar/[turnoId] y la
// nota en /sesiones/[id]. La sesión de hoy llega por props (polling del
// hook de grabación en el padre).

import * as React from "react";
import type { VarianteToast } from "@/components/ui/toast";

import { Button, Card } from "@/components/ui";
import { ESTADOS_CON_NOTA } from "@/lib/sesion-clinica/estados";
import { esAbort, mensajeParaElla } from "@/lib/api-client";
import { cobrarTurno } from "@/lib/cobrar-cliente";
import { SheetMetodoPago } from "@/components/cobro/sheet-metodo-pago";
import {
  COBRADO,
  pluralizar,
  REINTENTAR,
  CARGANDO,
} from "@/lib/glosario";
import type { SesionClinicaEnsamblada } from "@/hooks/useSesionClinicaPolling";
import type { Turno } from "@/types/domain";

import { BriefPreSesion } from "./brief-pre-sesion";
import { GrupoDeMes } from "./filas-sesion";
import {
  agruparPorMes,
  conPaginaSiguiente,
  conPrimeraPagina,
  leerDocumentacion,
  listaInicial,
  type Fila,
  type ListaState,
} from "./sesiones-datos";

interface SesionesTabProps {
  pacienteId: string;
  /** Nombre y apellido: lo dice el indicador mientras se escribe la nota. */
  pacienteNombre: string;
  turnoHoy: Turno | null;
  sesionHoy: SesionClinicaEnsamblada | null;
  sesionHoyCargando: boolean;
  onTurnoActualizado: () => void;
  onAviso: (mensaje: string, variante?: VarianteToast) => void;
  /** La ficha se pidió con ?preparar=1: "Preparar sesión" arranca abierto. */
  prepararAbierto?: boolean;
  /** Se vuelve de la nota de esta sesión: su mes se abre y la fila se trae a
   *  la vista. */
  volverA?: string | null;
  /** La fila ya se buscó (estuviera o no): el padre borra ?vuelve de la URL. */
  onVolvio?: () => void;
  /** Se tocó un enlace a la nota de esta sesión: el padre lo anota en la URL
   *  para que "volver" sepa a dónde. */
  onAbrirSesion?: (sesionClinicaId: string) => void;
}

export function SesionesTab({
  pacienteId,
  pacienteNombre,
  turnoHoy,
  sesionHoy,
  sesionHoyCargando,
  onTurnoActualizado,
  onAviso,
  prepararAbierto = false,
  volverA = null,
  onVolvio,
  onAbrirSesion,
}: SesionesTabProps) {
  const [lista, setLista] = React.useState<ListaState>(() => listaInicial(pacienteId));
  const [reloadKey, setReloadKey] = React.useState(0);
  const [cobroTarget, setCobroTarget] = React.useState<Turno | null>(null);

  const listaActual =
    lista.pacienteId === pacienteId ? lista : listaInicial(pacienteId);
  const notaDeHoy =
    sesionHoy && (ESTADOS_CON_NOTA as ReadonlyArray<string>).includes(sesionHoy.estado)
      ? sesionHoy.estado
      : null;

  React.useEffect(() => {
    const controller = new AbortController();
    leerDocumentacion(pacienteId, 1, controller.signal)
      .then((data) => setLista((prev) => conPrimeraPagina(prev, data, pacienteId)))
      .catch((err: unknown) => {
        if (esAbort(err)) return;
        setLista({
          ...listaInicial(pacienteId),
          loading: false,
          error: mensajeParaElla(err),
        });
      });
    return () => controller.abort();
    // `notaDeHoy`: cuando la sesión de hoy pasa a tener nota (el polling del
    // padre la ve llegar a "revision"), la lista se vuelve a pedir para que la
    // traiga con su resumen.
  }, [pacienteId, reloadKey, notaDeHoy]);

  // La sesión de hoy va UNA vez. Si ya tiene nota, /documentacion la trae y se
  // destaca en su fila. Si no, se agrega acá, primera: es la más reciente.
  const hoyEnLaLista =
    turnoHoy !== null && listaActual.docs.some((d) => d.turnoId === turnoHoy.id);
  const hoySuelta = turnoHoy !== null && !listaActual.loading && !hoyEnLaLista;

  const grupos = React.useMemo(() => {
    const filas: Fila[] = listaActual.docs.map((doc) => ({
      tipo: "nota",
      clave: doc.sesionClinicaId,
      fecha: new Date(doc.fecha),
      doc,
    }));
    if (hoySuelta && turnoHoy) {
      filas.unshift({ tipo: "hoy", clave: turnoHoy.id, fecha: turnoHoy.fecha, turno: turnoHoy });
    }
    return agruparPorMes(filas);
  }, [listaActual.docs, hoySuelta, turnoHoy]);

  // El contador cuenta lo que la lista muestra.
  const totalEnLista = listaActual.totalSesiones + (hoySuelta ? 1 : 0);

  // Volver de una nota: la fila de esa sesión, a la vista. Una sola vez, y
  // sólo con lo que la URL traía AL MONTAR: al tocar una sesión el padre
  // escribe ?vuelve en la entrada que se está dejando, y eso no es una vuelta.
  const [vuelveA] = React.useState(volverA);
  const yaVolvio = React.useRef(false);
  React.useEffect(() => {
    if (!vuelveA || yaVolvio.current || listaActual.loading) return;
    yaVolvio.current = true;
    document.getElementById(`sesion-${vuelveA}`)?.scrollIntoView?.({ block: "center" });
    onVolvio?.();
  }, [vuelveA, listaActual.loading, onVolvio]);

  function alTocarLaLista(evento: React.MouseEvent<HTMLElement>) {
    const enlace = (evento.target as HTMLElement).closest('a[href^="/sesiones/"]');
    const fila = enlace?.closest<HTMLElement>("[data-sesion-id]");
    if (fila?.dataset.sesionId) onAbrirSesion?.(fila.dataset.sesionId);
  }

  async function cargarMas() {
    const next = listaActual.page + 1;
    if (next > listaActual.totalPages) return;
    setLista((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await leerDocumentacion(pacienteId, next);
      setLista((prev) => conPaginaSiguiente(prev, data, pacienteId, next));
    } catch (err) {
      setLista((prev) => ({
        ...prev,
        loading: false,
        error: mensajeParaElla(err),
      }));
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" onClickCapture={alTocarLaLista}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-display text-[20px] font-medium tracking-[-0.01em] text-ink-900">
              Sesiones
            </h2>
            {totalEnLista > 0 ? (
              <span className="font-sans tabular-nums text-[12px] text-ink-500">
                {pluralizar(totalEnLista, "sesión", "sesiones")}
              </span>
            ) : null}
          </div>
          <BriefPreSesion pacienteId={pacienteId} abrir={prepararAbierto} />
        </div>

        {listaActual.error ? (
          <div className="flex items-center gap-3">
            <p className="font-sans text-[13px] text-[color:var(--color-error)]">
              {listaActual.error}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              {REINTENTAR}
            </Button>
          </div>
        ) : null}

        {listaActual.loading && listaActual.docs.length === 0 ? (
          <p className="font-sans text-[13px] text-ink-500">{CARGANDO}</p>
        ) : null}

        {!listaActual.loading && grupos.length === 0 && !listaActual.error ? (
          <Card className="border-[color:var(--border-subtle)]">
            <p className="font-sans text-[14px] leading-[1.6] text-ink-500">
              Todavía no hay sesiones grabadas. Cuando grabes la primera, la
              nota va a aparecer acá.
            </p>
          </Card>
        ) : null}

        {grupos.length > 0 ? (
          <div className="flex flex-col gap-4">
            {grupos.map((grupo, indice) => (
              <GrupoDeMes
                key={grupo.clave}
                grupo={grupo}
                abiertoPorDefecto={
                  indice === 0 || grupo.filas.some((f) => f.clave === vuelveA)
                }
                hoy={{
                  turno: turnoHoy,
                  sesion: sesionHoy,
                  cargando: sesionHoyCargando,
                  paciente: pacienteNombre,
                  onCobrar: () => setCobroTarget(turnoHoy),
                }}
              />
            ))}
          </div>
        ) : null}

        {listaActual.page < listaActual.totalPages ? (
          <div className="flex justify-center pt-2">
            <Button
              variant="secondary"
              onClick={() => void cargarMas()}
              disabled={listaActual.loading}
            >
              {listaActual.loading ? CARGANDO : "Cargar más"}
            </Button>
          </div>
        ) : null}
      </section>

      <SheetMetodoPago
        open={cobroTarget !== null}
        onClose={() => setCobroTarget(null)}
        monto={cobroTarget?.tarifaCobrada}
        cierraElTurno={cobroTarget?.estado === "programado"}
        onElegir={async (metodo) => {
          if (!cobroTarget) return;
          await cobrarTurno(cobroTarget.id, metodo);
          onAviso(COBRADO, "confirmacion");
          onTurnoActualizado();
        }}
      />
    </div>
  );
}
