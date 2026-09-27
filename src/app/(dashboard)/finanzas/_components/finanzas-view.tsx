"use client";

// Finanzas: las dos platas del consultorio en un período.
//
// El servidor trae todo calculado en un pedido (GET /api/finanzas/resumen,
// docs/contrato-finanzas.md) y esta pantalla sólo dibuja. Las dos platas no
// se mezclan nunca: lo que ENTRÓ (cobrado, contado por la fecha del pago) y
// lo que TRABAJASTE (sesiones realizadas, por la fecha de la sesión).
//
// Carga, error y vacío siguen a Cobros, que es la pantalla hermana: el
// esqueleto dentro del marco de verdad mientras llega la primera respuesta,
// el error con "Reintentar", y el vacío con Lupita. Al cambiar de período los
// números viejos quedan en pantalla hasta que llegan los nuevos.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChartColumn, ChevronLeft, ChevronRight } from "lucide-react";

import type { ResumenFinanzas } from "@/app/api/_lib/casos-uso/finanzas";
import { Button, Card, EditorialRule, Lupita, Segmented } from "@/components/ui";
import { EsqueletoFinanzasCuerpo } from "@/components/esqueletos";
import { TAMANOS_LUPITA } from "@/components/ui/lupita";
import { apiGet, esAbort } from "@/lib/api-client";
import {
  ALGO_FALLO,
  ANIO_ANTERIOR,
  ANIO_SIGUIENTE,
  ELEGIR_PERIODO,
  FINANZAS,
  FINANZAS_NO_CARGARON,
  IR_A_LA_AGENDA,
  NAV,
  PERIODOS_FINANZAS,
  REINTENTAR,
  SIN_SESIONES_REGISTRADAS,
  SIN_SESIONES_REGISTRADAS_LINEAS,
  VOLVER_A_COBROS,
} from "@/lib/glosario";

import {
  PERIODO_INICIAL,
  aniosElegibles,
  mesDeHoy,
  queryDe,
  type Periodo,
} from "./periodo";

type Carga = "cargando" | "listo" | "error";
type TipoPeriodo = Periodo["tipo"];

export function FinanzasView() {
  const router = useRouter();
  const [periodo, setPeriodo] = React.useState<Periodo>(PERIODO_INICIAL);
  const [datos, setDatos] = React.useState<ResumenFinanzas | null>(null);
  const [carga, setCarga] = React.useState<Carga>("cargando");
  const [reloadKey, setReloadKey] = React.useState(0);
  // El mes de hoy según el servidor, y hasta dónde llega "Todo". Salen de la
  // última respuesta: la primera se pide sin ellos ("12 meses" no los usa).
  const hoy = datos?.deudaHoy.alDia ?? null;
  const primerMes = datos?.primerMesConDatos ?? null;
  const query = queryDe(periodo, hoy ?? mesDeHoy(new Date()), primerMes);

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<ResumenFinanzas>(`/api/finanzas/resumen${query}`, {
      signal: controller.signal,
    })
      .then((resultado) => {
        setDatos(resultado);
        setCarga("listo");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setCarga("error");
      });
    return () => controller.abort();
  }, [query, reloadKey]);

  const reintentar = () => {
    setCarga("cargando");
    setReloadKey((k) => k + 1);
  };

  const elegir = (nuevo: Periodo) => {
    setCarga("cargando");
    setPeriodo(nuevo);
  };

  if (carga === "cargando" && !datos) {
    return (
      <Marco>
        <EsqueletoFinanzasCuerpo />
      </Marco>
    );
  }

  if (!datos) {
    return (
      <Marco>
        <EstadoVacio
          icono={<ChartColumn size={28} strokeWidth={1.6} aria-hidden="true" />}
          titulo={ALGO_FALLO}
          lineas={FINANZAS_NO_CARGARON}
          accion={{ label: REINTENTAR, onClick: reintentar }}
        />
      </Marco>
    );
  }

  // Sin un solo turno ni un solo pago no hay período que elegir.
  if (datos.primerMesConDatos === null) {
    return (
      <Marco>
        <EstadoVacio
          lupita
          titulo={SIN_SESIONES_REGISTRADAS}
          lineas={SIN_SESIONES_REGISTRADAS_LINEAS}
          accion={{ label: IR_A_LA_AGENDA, onClick: () => router.push("/agenda") }}
        />
      </Marco>
    );
  }

  const anioHoy = Number(datos.deudaHoy.alDia.slice(0, 4));

  return (
    <Marco>
      <SelectorPeriodo
        periodo={periodo}
        anioHoy={anioHoy}
        anios={aniosElegibles(datos.deudaHoy.alDia, datos.primerMesConDatos)}
        onElegir={elegir}
      />

      {carga === "error" ? (
        <p role="alert" className="text-[13px] text-ink-700">
          {FINANZAS_NO_CARGARON[0]}{" "}
          <button
            type="button"
            onClick={reintentar}
            className="min-h-11 font-medium text-sage-600 underline underline-offset-2"
          >
            {REINTENTAR}
          </button>
        </p>
      ) : null}

      <div aria-busy={carga === "cargando"} className="flex flex-col gap-7 lg:gap-10">
        <Tablero datos={datos} />
      </div>
    </Marco>
  );
}

/** Lo que se dibuja con una respuesta en la mano. */
function Tablero({ datos }: { datos: ResumenFinanzas }) {
  void datos;
  return null;
}

// ============================================
// Marco: la línea de arriba y el título. En el teléfono la línea es el
// camino de vuelta a Cobros: Finanzas no está en el menú de abajo.
// ============================================
function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10">
      <header className="min-w-0">
        <div className="flex h-5 items-center text-[13px] font-medium text-ink-500">
          <EditorialRule />
          <Link
            href="/cobros"
            aria-label={VOLVER_A_COBROS}
            className="-my-3 inline-flex min-h-11 items-center gap-1 text-sage-600 lg:hidden"
          >
            <ChevronLeft size={14} strokeWidth={1.8} aria-hidden="true" />
            {NAV.COBROS}
          </Link>
        </div>
        <h1 className="mt-3 font-display text-[30px] font-medium leading-tight text-ink-900">
          {FINANZAS}
        </h1>
      </header>
      {children}
    </div>
  );
}

// ============================================
// El selector: cuatro chips y, con "Este año", un ‹ año › para ir hacia
// atrás hasta el primer año con datos. Sin rangos a mano.
// ============================================
function SelectorPeriodo({
  periodo,
  anioHoy,
  anios,
  onElegir,
}: {
  periodo: Periodo;
  anioHoy: number;
  anios: { min: number; max: number };
  onElegir: (periodo: Periodo) => void;
}) {
  const alElegirTipo = (tipo: TipoPeriodo) => {
    if (tipo === periodo.tipo) return;
    onElegir(tipo === "anio" ? { tipo, anio: anioHoy } : { tipo });
  };

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
      <Segmented<TipoPeriodo>
        options={[
          { value: "mes", label: PERIODOS_FINANZAS.MES },
          { value: "anio", label: PERIODOS_FINANZAS.ANIO },
          { value: "doce", label: PERIODOS_FINANZAS.DOCE_MESES },
          { value: "todo", label: PERIODOS_FINANZAS.TODO },
        ]}
        value={periodo.tipo}
        onChange={alElegirTipo}
        ariaLabel={ELEGIR_PERIODO}
        className="self-start"
      />
      {periodo.tipo === "anio" ? (
        <div className="flex items-center gap-1 self-start">
          <button
            type="button"
            aria-label={ANIO_ANTERIOR}
            disabled={periodo.anio <= anios.min}
            onClick={() => onElegir({ tipo: "anio", anio: periodo.anio - 1 })}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-700 transition-colors duration-[var(--duration-fast)] hover:bg-cream-100 disabled:text-ink-300 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <span aria-live="polite" className="min-w-[3.5rem] text-center text-[15px] font-semibold tabular-nums text-ink-900">
            {periodo.anio}
          </span>
          <button
            type="button"
            aria-label={ANIO_SIGUIENTE}
            disabled={periodo.anio >= anios.max}
            onClick={() => onElegir({ tipo: "anio", anio: periodo.anio + 1 })}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-700 transition-colors duration-[var(--duration-fast)] hover:bg-cream-100 disabled:text-ink-300 disabled:hover:bg-transparent"
          >
            <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ============================================
// Estado vacío y error: la misma forma que en Cobros. En el vacío la
// ilustración es Lupita (saluda, 96 px, círculo crema); en el error, un
// ícono: Lupita no tiene pose de error.
// ============================================
function EstadoVacio({
  icono,
  lupita = false,
  titulo,
  lineas,
  accion,
}: {
  icono?: React.ReactNode;
  lupita?: boolean;
  titulo: string;
  lineas: readonly [string, string, string];
  accion: { label: string; onClick: () => void };
}) {
  return (
    <Card className="flex flex-col items-center rounded-md px-6 py-12 text-center">
      {lupita ? (
        <span className="inline-flex h-32 w-32 items-center justify-center rounded-full bg-cream-100">
          <Lupita pose="saluda" tamano={TAMANOS_LUPITA.vacio} />
        </span>
      ) : (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 text-sage-600">
          {icono}
        </span>
      )}
      <h2 className="mt-4 font-display text-[22px] font-medium leading-tight text-ink-900">
        {titulo}
      </h2>
      <div className="mt-3 flex max-w-[420px] flex-col gap-1">
        {lineas.map((linea) => (
          <p key={linea} className="text-[13px] leading-[1.5] text-ink-500">
            {linea}
          </p>
        ))}
      </div>
      <div className="mt-6">
        <Button variant="secondary" onClick={accion.onClick}>
          {accion.label}
        </Button>
      </div>
    </Card>
  );
}
