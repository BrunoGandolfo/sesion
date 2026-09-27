"use client";

// El detalle de un período, al tocar su barra.
//
// Los números son los de esa entrada de la serie, tal como vinieron: no se
// pide nada nuevo para mostrarlos. Con granularidad mes, además, la lista de
// lo que entró ese mes sale de GET /api/turnos/cobros?mes=AAAA-MM, que ya
// existe (docs/contrato-finanzas.md, "El detalle al tocar una barra"). Con
// granularidad año no hay lista: serían cientos de filas.

import * as React from "react";
import Link from "next/link";

import { Button, Sheet } from "@/components/ui";
import { apiGet, esAbort } from "@/lib/api-client";
import { fechaCorta, money } from "@/lib/format";
import {
  AUSENCIAS_Y_CANCELADAS,
  BARRA_COBRADO,
  BARRA_SIN_COBRAR,
  BUSCANDO_COBROS,
  CERRAR_DETALLE,
  COBROS_DEL_PERIODO_NO_CARGARON,
  DETALLE_DEL_PERIODO,
  LO_QUE_ENTRO,
  LO_QUE_ENTRO_EN,
  LO_QUE_TRABAJASTE,
  METODO_PAGO_LABEL,
  PACIENTES_DISTINTAS,
  REINTENTAR,
  SIN_COBROS_EN,
  SIN_METODO,
  TARIFA_PROMEDIO,
  pluralizar,
} from "@/lib/glosario";
import type { MetodoPago } from "@/types/domain";

import type { EntradaSerie } from "./barras";
import { nombrePeriodo } from "./periodo";

/** Lo que usa la lista de un cobro de /api/turnos/cobros. */
interface CobroJson {
  id: string;
  fecha: string;
  pagoFecha: string | null;
  pagoMetodo: MetodoPago | null;
  tarifaCobrada: number;
  paciente: { id: string; nombre: string; apellido: string };
}

export function SheetPeriodo({
  entrada,
  onClose,
}: {
  /** La barra tocada; null con el sheet cerrado. */
  entrada: EntradaSerie | null;
  onClose: () => void;
}) {
  // Se recuerda la última para que el contenido no desaparezca mientras el
  // sheet se va.
  const [ultima, setUltima] = React.useState<EntradaSerie | null>(entrada);
  if (entrada && entrada !== ultima) setUltima(entrada);
  const e = entrada ?? ultima;
  const titulo = e ? capitalizar(nombrePeriodo(e.clave)) : DETALLE_DEL_PERIODO;

  return (
    <Sheet open={entrada !== null} onClose={onClose} ariaLabel={titulo} maxWidth={480}>
      {e ? (
        <>
          <h2 className="font-display text-[22px] font-medium leading-tight text-ink-900">{titulo}</h2>
          <NumerosDelPeriodo entrada={e} />
          {e.mes !== null ? <CobrosDelMes clave={e.clave} /> : null}
          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              {CERRAR_DETALLE}
            </Button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

function NumerosDelPeriodo({ entrada: e }: { entrada: EntradaSerie }) {
  const filas = [
    { rotulo: LO_QUE_ENTRO, valor: money(e.cobrado), nota: pluralizar(e.sesionesCobradas, "sesión cobrada", "sesiones cobradas") },
    { rotulo: LO_QUE_TRABAJASTE, valor: money(e.trabajado), nota: pluralizar(e.sesionesRealizadas, "sesión", "sesiones") },
    { rotulo: BARRA_COBRADO, valor: money(e.trabajadoCobrado), nota: pluralizar(e.sesionesRealizadasCobradas, "sesión", "sesiones") },
    { rotulo: BARRA_SIN_COBRAR, valor: money(e.trabajadoSinCobrar), nota: pluralizar(e.sesionesRealizadasSinCobrar, "sesión", "sesiones") },
    { rotulo: PACIENTES_DISTINTAS, valor: String(e.pacientesDistintas), nota: null },
    { rotulo: TARIFA_PROMEDIO, valor: e.tarifaPromedio === null ? "—" : money(e.tarifaPromedio), nota: null },
  ];
  return (
    <>
      <dl className="mt-4 divide-y divide-[color:var(--border-subtle)] border-y border-[color:var(--border-subtle)]">
        {filas.map(({ rotulo, valor, nota }) => (
          <div key={rotulo} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-2.5">
            <dt className="text-[14px] text-ink-700">
              {rotulo}
              {nota ? <span className="ml-2 text-[12px] text-ink-500">{nota}</span> : null}
            </dt>
            <dd className="text-[14px] font-medium tabular-nums text-ink-900">{valor}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[13px] leading-[1.5] text-ink-500">
        {AUSENCIAS_Y_CANCELADAS(e.ausencias, money(e.ausenciasMonto), e.canceladas)}
      </p>
    </>
  );
}

function CobrosDelMes({ clave }: { clave: string }) {
  const [cobros, setCobros] = React.useState<CobroJson[] | "error" | null>(null);
  const [intento, setIntento] = React.useState(0);
  const periodo = nombrePeriodo(clave);

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<CobroJson[]>(`/api/turnos/cobros?mes=${clave}`, { signal: controller.signal })
      .then(setCobros)
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setCobros("error");
      });
    return () => controller.abort();
  }, [clave, intento]);

  return (
    <section className="mt-6">
      <h3 className="font-display text-[16px] font-medium text-ink-900">{LO_QUE_ENTRO_EN(periodo)}</h3>
      {cobros === null ? (
        <p className="mt-2 text-[13px] text-ink-500">{BUSCANDO_COBROS}</p>
      ) : cobros === "error" ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-700">
          {COBROS_DEL_PERIODO_NO_CARGARON}{" "}
          <button
            type="button"
            onClick={() => {
              setCobros(null);
              setIntento((n) => n + 1);
            }}
            className="min-h-11 font-medium text-sage-600 underline underline-offset-2"
          >
            {REINTENTAR}
          </button>
        </p>
      ) : cobros.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-500">{SIN_COBROS_EN(periodo)}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[color:var(--border-subtle)]">
          {cobros.map((t) => (
            <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 py-2.5">
              <Link
                href={`/pacientes/${t.paciente.id}`}
                className="min-w-0 break-words text-[14px] font-semibold leading-[1.35] text-ink-900 hover:underline"
              >
                {t.paciente.nombre} {t.paciente.apellido}
              </Link>
              <span className="whitespace-nowrap text-[14px] font-medium tabular-nums text-sage-700">
                {money(t.tarifaCobrada)}
              </span>
              <span className="col-span-2 text-[12px] text-ink-500">
                {fechaCorta(new Date(t.pagoFecha ?? t.fecha))} ·{" "}
                {t.pagoMetodo ? METODO_PAGO_LABEL[t.pagoMetodo] : SIN_METODO}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function capitalizar(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
