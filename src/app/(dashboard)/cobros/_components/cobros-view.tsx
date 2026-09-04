"use client";

// Cobros: lo que entró este mes y lo que todavía te deben, en una sola
// pantalla. Reúne lo que antes vivía en /finanzas (KPIs + cobros del mes) y
// en /deudores (lista con "Recordar cobro" por WhatsApp).
//
// No se calcula "trabajaste N horas gratis": la deuda se cuenta en sesiones,
// que es como ella la piensa.

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  MessageCircle,
  Settings,
  Wallet,
} from "lucide-react";

import {
  Avatar,
  Button,
  Card,
  EditorialRule,
  Segmented,
} from "@/components/ui";
import { apiGet, esAbort } from "@/lib/api-client";
import {
  TEMPLATE_COBRO_DEFAULT,
  buildWhatsAppUrl,
  interpolarTemplateCobro,
  textoAtraso,
  zonaDeuda,
  type ZonaDeuda,
} from "@/lib/deudas";
import { fechaCorta, fechaLarga, money, moneyShort } from "@/lib/format";
import { ALGO_FALLO, NAV, TE_DEBEN, TU_CONSULTORIO, pluralizar } from "@/lib/glosario";
import type {
  Configuracion,
  DeudaPaciente,
  KPIsDashboard,
  MetodoPago,
  TurnoConPaciente,
} from "@/types/domain";

// ============================================
// Tipos de fetch — JSON → Date donde la UI lo necesita
// ============================================

type DeudorItem = DeudaPaciente & {
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

type Pestana = "te-deben" | "cobros";
type Carga = "cargando" | "listo" | "error";

type DatosCobros = {
  kpis: KPIsDashboard;
  deudores: DeudorItem[];
  cobros: TurnoConPaciente[];
  nombreProfesional: string;
};

async function cargarCobros(signal: AbortSignal): Promise<DatosCobros> {
  const [dashboard, deudores, cobros, config] = await Promise.all([
    apiGet<{ kpis: KPIsDashboard }>("/api/dashboard", { signal }),
    apiGet<DeudorItem[]>("/api/deudores", { signal }),
    apiGet<JsonTurno[]>("/api/turnos/cobros", { signal }),
    // La configuración puede no existir todavía: el recordatorio sale sin
    // firma y la pantalla igual se muestra.
    apiGet<Configuracion>("/api/config", { signal }).catch((err: unknown) => {
      if (esAbort(err)) throw err;
      return null;
    }),
  ]);

  return {
    kpis: dashboard.kpis,
    deudores,
    cobros: cobros.map(parseTurno),
    nombreProfesional: config?.nombreProfesional ?? "",
  };
}

// ============================================
export function CobrosView() {
  const [pestana, setPestana] = React.useState<Pestana>("te-deben");
  const [datos, setDatos] = React.useState<DatosCobros | null>(null);
  const [ahora, setAhora] = React.useState<Date | null>(null);
  const [carga, setCarga] = React.useState<Carga>("cargando");
  const [reloadKey, setReloadKey] = React.useState(0);

  // "cargando" es el estado inicial y el reintento lo vuelve a poner en su
  // propio handler: el efecto no toca estado antes de que responda la red.
  React.useEffect(() => {
    const controller = new AbortController();

    cargarCobros(controller.signal)
      .then((resultado) => {
        setDatos(resultado);
        setAhora(new Date());
        setCarga("listo");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setCarga("error");
      });

    return () => controller.abort();
  }, [reloadKey]);

  const reintentar = () => {
    setCarga("cargando");
    setReloadKey((k) => k + 1);
  };

  if (carga === "cargando" && !datos) {
    return (
      <Marco ahora={null}>
        <p className="py-16 text-center text-[14px] text-ink-500">Cargando…</p>
      </Marco>
    );
  }

  if (carga === "error" && !datos) {
    return (
      <Marco ahora={null}>
        <EstadoVacio
          icono={<Wallet size={28} strokeWidth={1.6} aria-hidden="true" />}
          titulo={ALGO_FALLO}
          lineas={[
            "No pudimos traer los cobros.",
            "Puede ser la conexión.",
            "Tus datos no se perdieron.",
          ]}
          accion={{ label: "Reintentar", onClick: reintentar }}
        />
      </Marco>
    );
  }

  if (!datos || !ahora) return null;

  const { kpis, deudores, cobros, nombreProfesional } = datos;

  const sesionesSinCobrar = deudores.reduce(
    (sum, d) => sum + d.sesionesImpagas,
    0,
  );
  // Regla del pilar Cobros: ordenar por monto desc (no por días de atraso).
  const deudoresPorMonto = [...deudores].sort(
    (a, b) => b.montoTotal - a.montoTotal,
  );

  return (
    <Marco ahora={ahora}>
      <KpiGrid
        ingresosMes={kpis.ingresosMes}
        deudaTotal={kpis.deudaAcumulada}
        cobradasCount={cobros.length}
        sinCobrarCount={sesionesSinCobrar}
      />

      <Segmented<Pestana>
        options={[
          { value: "te-deben", label: TE_DEBEN },
          { value: "cobros", label: "Cobros del mes" },
        ]}
        value={pestana}
        onChange={setPestana}
        ariaLabel="Vista de cobros"
        className="self-start"
      />

      {pestana === "te-deben" ? (
        <TeDeben
          deudores={deudoresPorMonto}
          sesionesSinCobrar={sesionesSinCobrar}
          nombreProfesional={nombreProfesional}
          onVerCobros={() => setPestana("cobros")}
        />
      ) : (
        <CobrosDelMes cobros={cobros} onVerTeDeben={() => setPestana("te-deben")} />
      )}
    </Marco>
  );
}

// ============================================
// Marco: título, mes y acceso a "Tu consultorio" en mobile (el menú
// inferior no lo lleva).
// ============================================
function Marco({
  ahora,
  children,
}: {
  ahora: Date | null;
  children: React.ReactNode;
}) {
  const mesLargo = ahora
    ? capitalize(fechaLarga(ahora).split(" de ").at(-1) ?? "")
    : "";
  const anio = ahora ? ahora.getFullYear() : "";

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10">
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex h-5 items-center text-[13px] font-medium text-ink-500">
            <EditorialRule />
            <span>{ahora ? `${mesLargo} ${anio}` : " "}</span>
          </div>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[40px] font-medium italic leading-[0.95] tracking-[-0.02em] text-ink-900 lg:text-[56px]">
            {NAV.COBROS}
          </h1>
        </div>
        <Link
          href="/config"
          aria-label={TU_CONSULTORIO}
          title={TU_CONSULTORIO}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors duration-150 hover:bg-cream-100 hover:text-ink-900 lg:hidden"
        >
          <Settings size={20} strokeWidth={1.6} aria-hidden="true" />
        </Link>
      </header>
      {children}
    </div>
  );
}

// ============================================
function KpiGrid({
  ingresosMes,
  deudaTotal,
  cobradasCount,
  sinCobrarCount,
}: {
  ingresosMes: number;
  deudaTotal: number;
  cobradasCount: number;
  sinCobrarCount: number;
}) {
  const items = [
    {
      label: "Cobraste este mes",
      value: moneyShort(ingresosMes),
      subtext: pluralizar(cobradasCount, "sesión", "sesiones"),
      tone: "sage" as const,
    },
    {
      label: TE_DEBEN,
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
      label: "Sin cobrar",
      value: sinCobrarCount,
      subtext: sinCobrarCount === 1 ? "sesión" : "sesiones",
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
// Te deben
// ============================================
function TeDeben({
  deudores,
  sesionesSinCobrar,
  nombreProfesional,
  onVerCobros,
}: {
  deudores: DeudorItem[];
  sesionesSinCobrar: number;
  nombreProfesional: string;
  onVerCobros: () => void;
}) {
  if (deudores.length === 0) {
    return (
      <EstadoVacio
        icono={<CheckCircle2 size={28} strokeWidth={1.6} aria-hidden="true" />}
        titulo="Nadie te debe"
        lineas={[
          "Todas las sesiones realizadas están cobradas.",
          "Cuando cobres un turno desde la agenda, el pago aparece en Cobros del mes.",
          "Si alguien queda sin pagar, va a aparecer acá con un botón para recordárselo.",
        ]}
        accion={{ label: "Ver cobros del mes", onClick: onVerCobros }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-[8px] border-l-2 border-l-terracotta-500 bg-cream-100 px-5 py-4 lg:px-6 lg:py-5">
        <p className="text-[15px] leading-[1.55] text-ink-700">
          Son{" "}
          <span className="font-[family-name:var(--font-display)] text-[24px] font-medium leading-none text-terracotta-600 lg:text-[28px]">
            {pluralizar(sesionesSinCobrar, "sesión", "sesiones")}
          </span>{" "}
          sin cobrar.
        </p>
      </Card>

      <Card className="overflow-hidden rounded-[8px] p-0">
        <ul className="divide-y divide-[color:var(--border-subtle)]">
          {deudores.map((d) => {
            const nombreCompleto = `${d.nombre} ${d.apellido}`;
            return (
              <li
                key={d.pacienteId}
                className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:gap-4 lg:px-5 lg:py-4"
              >
                <Link
                  href={`/pacientes/${d.pacienteId}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors duration-150 active:bg-cream-50"
                  aria-label={`Abrir ficha de ${nombreCompleto}`}
                >
                  <Avatar nombre={d.nombre} apellido={d.apellido} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink-900">
                      {nombreCompleto}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-500">
                      <span>
                        {pluralizar(d.sesionesImpagas, "sesión", "sesiones")}{" "}
                        sin cobrar
                      </span>
                      <span aria-hidden="true" className="text-ink-300">
                        ·
                      </span>
                      <ZonaIndicador dias={d.diasAtraso} />
                    </span>
                  </span>
                  <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-terracotta-600">
                    {money(d.montoTotal)}
                  </span>
                  <ChevronRight
                    size={16}
                    strokeWidth={1.6}
                    className="shrink-0 text-ink-300 lg:hidden"
                    aria-hidden="true"
                  />
                </Link>
                <div className="flex items-center gap-2 lg:shrink-0">
                  <RecordarCobro
                    deudor={d}
                    nombreProfesional={nombreProfesional}
                  />
                  <Link
                    href={`/pacientes/${d.pacienteId}`}
                    aria-label={`Ver ficha de ${nombreCompleto}`}
                    className="hidden text-ink-300 hover:text-ink-500 lg:inline-flex"
                  >
                    <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function ZonaIndicador({ dias }: { dias: number }) {
  const zona: ZonaDeuda = zonaDeuda(dias);
  const texto = textoAtraso(dias);
  if (zona === "terracotta") {
    return (
      <span className="inline-flex items-center rounded-full bg-terracotta-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-terracotta-600">
        {texto}
      </span>
    );
  }
  if (zona === "gold") {
    return <span className="font-medium text-gold-500">{texto}</span>;
  }
  return <span className="text-sage-600">{texto}</span>;
}

function RecordarCobro({
  deudor,
  nombreProfesional,
}: {
  deudor: DeudorItem;
  nombreProfesional: string;
}) {
  const telefono = deudor.telefono?.trim() ?? "";
  if (!telefono) return null;

  const mensaje = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
    nombre: deudor.nombre,
    sesiones: deudor.sesionesImpagas,
    monto: money(deudor.montoTotal),
    profesional: nombreProfesional,
  });
  const url = buildWhatsAppUrl(telefono, mensaje);

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Recordar cobro a ${deudor.nombre} ${deudor.apellido} por WhatsApp`}
      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full border border-sage-500 px-4 text-[13px] font-semibold text-sage-600 transition-colors duration-150 hover:bg-sage-50 lg:min-h-[36px] lg:w-auto"
    >
      <MessageCircle size={14} strokeWidth={1.8} aria-hidden="true" />
      Recordar cobro
    </a>
  );
}

// ============================================
// Cobros del mes
// ============================================
function CobrosDelMes({
  cobros,
  onVerTeDeben,
}: {
  cobros: TurnoConPaciente[];
  onVerTeDeben: () => void;
}) {
  if (cobros.length === 0) {
    return (
      <EstadoVacio
        icono={<Wallet size={28} strokeWidth={1.6} aria-hidden="true" />}
        titulo="Todavía no cobraste este mes"
        lineas={[
          "Los cobros se registran desde el turno, en la agenda o en Hoy.",
          "Cada pago aparece acá con la fecha y el método.",
          "Lo que quedó sin cobrar está en Te deben.",
        ]}
        accion={{ label: `Ver ${TE_DEBEN.toLowerCase()}`, onClick: onVerTeDeben }}
      />
    );
  }

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {cobros.map((t) => {
          const nombreCompleto = `${t.paciente.nombre} ${t.paciente.apellido}`;
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
                  {nombreCompleto}
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
// Estado vacío: ícono, titular, tres líneas, un botón.
// ============================================
function EstadoVacio({
  icono,
  titulo,
  lineas,
  accion,
}: {
  icono: React.ReactNode;
  titulo: string;
  lineas: [string, string, string];
  accion: { label: string; onClick: () => void };
}) {
  return (
    <Card className="flex flex-col items-center rounded-[8px] px-6 py-12 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 text-sage-600">
        {icono}
      </span>
      <p className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-medium italic leading-tight text-ink-900">
        {titulo}
      </p>
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

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
