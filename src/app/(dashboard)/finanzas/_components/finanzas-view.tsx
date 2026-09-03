"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import {
  Avatar,
  Button,
  Card,
  EditorialRule,
  Segmented,
} from "@/components/ui";
import { fechaCorta, fechaLarga, money, moneyShort } from "@/lib/format";
import type {
  DeudaPaciente,
  KPIsDashboard,
  MetodoPago,
  TurnoConPaciente,
} from "@/types/domain";

// ============================================
// Tipos de fetch — JSON → Date donde la UI lo
// necesita (pagoFecha para listar cobros)
// ============================================
type DeudoresApiItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
};

type JsonTurno = Omit<
  TurnoConPaciente,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

function parseTurno(raw: JsonTurno): TurnoConPaciente {
  return {
    ...raw,
    fecha: new Date(raw.fecha),
    pagoFecha: raw.pagoFecha ? new Date(raw.pagoFecha) : null,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
  };
}

const METODO_LABEL: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercadopago: "MercadoPago",
  debito: "Débito",
  credito: "Crédito",
  otro: "Otro",
};

type TabKey = "deudores" | "cobros";
type LoadState = "loading" | "ready" | "error";

type DatosFinanzas = {
  kpis: KPIsDashboard;
  deudores: DeudoresApiItem[];
  cobros: TurnoConPaciente[];
};

async function cargarFinanzas(signal: AbortSignal): Promise<DatosFinanzas> {
  const [resDashboard, resDeudores, resCobros] = await Promise.all([
    fetch("/api/dashboard", { cache: "no-store", signal }),
    fetch("/api/deudores", { cache: "no-store", signal }),
    fetch("/api/turnos/cobros", { cache: "no-store", signal }),
  ]);
  if (!resDashboard.ok || !resDeudores.ok || !resCobros.ok) {
    throw new Error("finanzas fetch failed");
  }

  const dashboardJson = (await resDashboard.json()) as {
    data: { kpis: KPIsDashboard };
  };
  const deudoresJson = (await resDeudores.json()) as {
    data: DeudoresApiItem[];
  };
  const cobrosJson = (await resCobros.json()) as { data: JsonTurno[] };

  return {
    kpis: dashboardJson.data.kpis,
    deudores: deudoresJson.data,
    cobros: cobrosJson.data.map(parseTurno),
  };
}

// ============================================
export function FinanzasView() {
  const [tab, setTab] = React.useState<TabKey>("deudores");
  const [kpis, setKpis] = React.useState<KPIsDashboard | null>(null);
  const [deudores, setDeudores] = React.useState<DeudoresApiItem[]>([]);
  const [cobros, setCobros] = React.useState<TurnoConPaciente[]>([]);
  const [now, setNow] = React.useState<Date | null>(null);
  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = React.useState(0);

  // No pone "loading" acá: es el estado inicial, y el reintento lo setea en
  // su propio handler.
  React.useEffect(() => {
    const controller = new AbortController();

    cargarFinanzas(controller.signal)
      .then((datos) => {
        setKpis(datos.kpis);
        setDeudores(datos.deudores);
        setCobros(datos.cobros);
        setNow(new Date());
        setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadState("error");
      });

    return () => controller.abort();
  }, [reloadKey]);

  const reintentar = () => {
    setLoadState("loading");
    setReloadKey((k) => k + 1);
  };

  if (loadState === "loading" && !kpis) {
    return <FinanzasSkeleton />;
  }

  if (loadState === "error" && !kpis) {
    return <FinanzasError onRetry={reintentar} />;
  }

  if (!kpis || !now) return null;

  const sesionesPendientes = deudores.reduce(
    (sum, d) => sum + d.sesionesImpagas,
    0,
  );
  // Regla del pilar Finanzas: ordenar por monto desc (no por días de atraso).
  const deudoresPorMonto = [...deudores].sort(
    (a, b) => b.montoTotal - a.montoTotal,
  );

  const mesLargo = capitalize(fechaLarga(now).split(" de ").at(-1) ?? "");
  const anio = now.getFullYear();

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10">
      <header className="min-w-0">
        <div className="flex items-center text-[13px] font-medium text-ink-500">
          <EditorialRule />
          <span>
            {mesLargo} {anio}
          </span>
        </div>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-[40px] font-medium italic leading-[0.95] tracking-[-0.02em] text-ink-900 lg:text-[56px]">
          Finanzas
        </h1>
      </header>

      <KpiGrid
        ingresosMes={kpis.ingresosMes}
        deudaTotal={kpis.deudaAcumulada}
        cobradasCount={cobros.length}
        pendientesCount={sesionesPendientes}
      />

      <Segmented<TabKey>
        options={[
          { value: "deudores", label: "Deudores" },
          { value: "cobros", label: "Cobros del mes" },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Vista de finanzas"
        className="self-start"
      />

      {tab === "deudores" ? (
        <DeudoresTab deudores={deudoresPorMonto} />
      ) : (
        <CobrosTab cobros={cobros} />
      )}
    </div>
  );
}

// ============================================
function KpiGrid({
  ingresosMes,
  deudaTotal,
  cobradasCount,
  pendientesCount,
}: {
  ingresosMes: number;
  deudaTotal: number;
  cobradasCount: number;
  pendientesCount: number;
}) {
  const items = [
    {
      label: "Ingresos del mes",
      value: moneyShort(ingresosMes),
      subtext: "cobrado",
      tone: "sage" as const,
    },
    {
      label: "Deuda acumulada",
      value: moneyShort(deudaTotal),
      subtext: deudaTotal > 0 ? "pendiente" : "al día",
      tone: deudaTotal > 0 ? ("terracotta" as const) : ("default" as const),
    },
    {
      label: "Sesiones cobradas",
      value: cobradasCount,
      subtext: "este mes",
      tone: "default" as const,
    },
    {
      label: "Pendientes de cobro",
      value: pendientesCount,
      subtext: pendientesCount === 1 ? "sesión" : "sesiones",
      tone: "default" as const,
    },
  ];

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {items.map((item, index) => (
          <div
            key={item.label}
            className={[
              "min-w-0 p-4 lg:p-5",
              index < 2 ? "border-b border-[color:var(--border-subtle)]" : "",
              index % 2 === 0
                ? "border-r border-[color:var(--border-subtle)]"
                : "",
              "lg:border-b-0",
              index < 3
                ? "lg:border-r lg:border-[color:var(--border-subtle)]"
                : "lg:border-r-0",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {item.label}
            </span>
            <span
              className={`mt-2 block font-[family-name:var(--font-display)] text-[26px] font-medium leading-none tabular-nums lg:text-[30px] ${kpiValueClass(item.tone)}`}
            >
              {item.value}
            </span>
            <span className="mt-1.5 block text-[12px] text-ink-500">
              {item.subtext}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function kpiValueClass(tone: "sage" | "terracotta" | "default"): string {
  if (tone === "sage") return "text-sage-700";
  if (tone === "terracotta") return "text-terracotta-600";
  return "text-ink-900";
}

// ============================================
function DeudoresTab({ deudores }: { deudores: DeudoresApiItem[] }) {
  if (deudores.length === 0) {
    return (
      <Card className="rounded-[8px] p-10 text-center text-[14px] text-ink-500">
        Día prolijo. Nadie tiene sesiones impagas.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {deudores.map((d) => {
          const fullName = `${d.nombre} ${d.apellido}`;
          const sesionesTexto =
            d.sesionesImpagas === 1
              ? "1 sesión"
              : `${d.sesionesImpagas} sesiones`;

          return (
            <li
              key={d.pacienteId}
              className="flex items-center gap-3 px-4 py-3 lg:px-5 lg:py-4"
            >
              <Avatar nombre={d.nombre} apellido={d.apellido} size={36} />

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink-900">
                  {fullName}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {sesionesTexto}
                </span>
              </span>

              <span className="hidden sm:block font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-terracotta-600">
                {money(d.montoTotal)}
              </span>

              <span className="sm:hidden font-[family-name:var(--font-display)] text-[14px] font-medium tabular-nums text-terracotta-600">
                {money(d.montoTotal)}
              </span>

              <Button asChild size="sm" variant="secondary">
                <Link
                  href={`/pacientes/${d.pacienteId}`}
                  aria-label={`Ver paciente ${fullName}`}
                >
                  <span className="hidden sm:inline">Ver paciente</span>
                  <ChevronRight
                    size={16}
                    strokeWidth={1.6}
                    aria-hidden="true"
                    className="sm:hidden"
                  />
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ============================================
function CobrosTab({ cobros }: { cobros: TurnoConPaciente[] }) {
  if (cobros.length === 0) {
    return (
      <Card className="rounded-[8px] p-10 text-center text-[14px] text-ink-500">
        Sin cobros registrados este mes.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {cobros.map((t) => {
          const fullName = `${t.paciente.nombre} ${t.paciente.apellido}`;
          const fecha = t.pagoFecha ?? t.fecha;
          const metodoLabel = t.pagoMetodo
            ? METODO_LABEL[t.pagoMetodo]
            : "Sin método";

          return (
            <li
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 lg:px-5 lg:py-4"
            >
              <span className="w-[64px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-500">
                {fechaCorta(fecha)}
              </span>

              <Avatar
                nombre={t.paciente.nombre}
                apellido={t.paciente.apellido}
                size={32}
              />

              <span className="min-w-0 flex-1">
                <Link
                  href={`/pacientes/${t.paciente.id}`}
                  className="block truncate text-[14px] font-semibold text-ink-900 hover:underline"
                >
                  {fullName}
                </Link>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {metodoLabel}
                </span>
              </span>

              <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-sage-700">
                {money(t.tarifaCobrada)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ============================================
function FinanzasSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10"
    >
      <header>
        <div className="flex items-center text-[13px] font-medium text-ink-500">
          <EditorialRule />
          <span> </span>
        </div>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-[40px] font-medium italic leading-[0.95] tracking-[-0.02em] text-ink-900 lg:text-[56px]">
          Finanzas
        </h1>
        <p className="mt-2 text-[13px] text-ink-300">cargando…</p>
      </header>

      <Card className="overflow-hidden rounded-[8px] p-0">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className={[
                "min-w-0 p-4 lg:p-5",
                index < 2 ? "border-b border-[color:var(--border-subtle)]" : "",
                index % 2 === 0
                  ? "border-r border-[color:var(--border-subtle)]"
                  : "",
                "lg:border-b-0",
                index < 3
                  ? "lg:border-r lg:border-[color:var(--border-subtle)]"
                  : "lg:border-r-0",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="block h-2 w-20 rounded-sm bg-cream-100" />
              <span className="mt-3 block h-7 w-24 rounded-sm bg-cream-200" />
              <span className="mt-2 block h-2 w-16 rounded-sm bg-cream-100" />
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden rounded-[8px] p-0">
        <ul className="divide-y divide-[color:var(--border-subtle)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <span className="h-9 w-9 rounded-full bg-cream-200" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3 w-40 rounded-sm bg-cream-200" />
                <span className="h-3 w-24 rounded-sm bg-cream-100" />
              </span>
              <span className="h-5 w-16 rounded-sm bg-cream-100" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function FinanzasError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-[1100px] flex-col items-center justify-center gap-4 px-5 py-10 text-center">
      <p className="font-[family-name:var(--font-display)] text-[22px] font-medium italic text-ink-900">
        No se pudieron cargar las finanzas.
      </p>
      <p className="text-[13px] text-ink-500">
        Revisá la conexión y probá de nuevo.
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
