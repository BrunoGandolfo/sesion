"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Video } from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  EditorialRule,
  Fab,
  SessionRow,
  Sheet,
  Toast,
} from "@/components/ui";
import { NuevoTurnoForm } from "@/components/forms";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import {
  avatarColor,
  diaSemana,
  fechaCorta,
  fechaLarga,
  fechaRelativa,
  hora,
  initials,
  money,
  moneyShort,
  saludo,
} from "@/lib/format";
import type {
  Configuracion,
  DeudaPaciente,
  KPIsDashboard,
  MetodoPago,
  PacienteConDeuda,
  TurnoConPaciente,
} from "@/types/domain";

const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "otro", label: "Otro" },
];

const THOUGHTS = [
  {
    texto:
      "A veces el avance es apenas que la persona puede nombrar lo que antes le pasaba por encima.",
    fuente: "Apunte de supervisión",
  },
  {
    texto:
      "Escuchar también es sostener el silencio hasta que aparezca una forma más propia de decir.",
    fuente: "Cuaderno clínico",
  },
  {
    texto:
      "No todo lo urgente pide respuesta inmediata; algunas cosas primero piden encuadre.",
    fuente: "Notas de consultorio",
  },
  {
    texto:
      "La continuidad no siempre se ve en grandes cambios, a veces aparece en volver a tiempo.",
    fuente: "Registro semanal",
  },
  {
    texto:
      "Cuidar el vínculo terapéutico también es cuidar el ritmo de trabajo de quien escucha.",
    fuente: "Margen del cuaderno",
  },
] as const;

const WEEK_DAYS = ["L", "M", "M", "J", "V", "S", "D"] as const;

type DashboardData = {
  kpis: KPIsDashboard;
  sesionesHoy: TurnoConPaciente[];
  deudores: DeudaPaciente[];
  proximaSesion: TurnoConPaciente | null;
  sesionesSemana: number[];
};

// ============================================
// Deserialización: JSON convierte Date → string.
// Volvemos a Date solo donde el UI lo necesita.
// ============================================
type JsonTurno = Omit<
  TurnoConPaciente,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

type JsonPaciente = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & {
  creadoEn: string;
  actualizadoEn: string;
  ultimaSesion: string | null;
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

function parseDashboard(raw: {
  kpis: KPIsDashboard;
  sesionesHoy: JsonTurno[];
  deudores: DeudaPaciente[];
  proximaSesion: JsonTurno | null;
  sesionesSemana: number[];
}): DashboardData {
  return {
    kpis: raw.kpis,
    sesionesHoy: raw.sesionesHoy.map(parseTurno),
    deudores: raw.deudores,
    proximaSesion: raw.proximaSesion ? parseTurno(raw.proximaSesion) : null,
    sesionesSemana: raw.sesionesSemana,
  };
}

function parsePaciente(raw: JsonPaciente): PacienteConDeuda {
  return {
    ...raw,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
    ultimaSesion: raw.ultimaSesion ? new Date(raw.ultimaSesion) : null,
  };
}

function getFirstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first || null;
}

async function fetchNombreProfesional(): Promise<string | null> {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data: Pick<Configuracion, "nombreProfesional">;
    };
    return payload.data.nombreProfesional;
  } catch {
    return null;
  }
}

// ============================================
export function Dashboard() {
  const router = useRouter();
  const [now, setNow] = React.useState(() => new Date());
  const [data, setData] = React.useState<DashboardData | null>(null);
  const [nombreProfesional, setNombreProfesional] = React.useState<
    string | null
  >(null);
  const [loadState, setLoadState] = React.useState<
    "loading" | "ready" | "error"
  >("loading");
  const [toast, setToast] = React.useState({ open: false, message: "" });
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[] | null>(
    null,
  );
  const [pacientesLoading, setPacientesLoading] = React.useState(false);
  const [paidPopId, setPaidPopId] = React.useState<string | null>(null);
  const [cobrandoTurnoId, setCobrandoTurnoId] = React.useState<string | null>(
    null,
  );
  const paidPopTimer = React.useRef<number | null>(null);

  const readDashboardData = React.useCallback(async () => {
    const [res, nextNombreProfesional] = await Promise.all([
      fetch("/api/dashboard", { cache: "no-store" }),
      fetchNombreProfesional(),
    ]);
    if (!res.ok) throw new Error("dashboard fetch failed");

    const payload = (await res.json()) as {
      data: Parameters<typeof parseDashboard>[0];
    };

    return {
      data: parseDashboard(payload.data),
      nombreProfesional: nextNombreProfesional,
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    readDashboardData()
      .then(({ data: nextData, nombreProfesional: nextNombreProfesional }) => {
        if (cancelled) return;
        setData(nextData);
        setNombreProfesional((current) => nextNombreProfesional ?? current);
        setNow(new Date());
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [readDashboardData]);

  const fetchDashboard = React.useCallback(async () => {
    setLoadState("loading");
    try {
      const { data: nextData, nombreProfesional: nextNombreProfesional } =
        await readDashboardData();
      setData(nextData);
      setNombreProfesional((current) => nextNombreProfesional ?? current);
      setNow(new Date());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [readDashboardData]);

  React.useEffect(() => {
    return () => {
      if (paidPopTimer.current !== null) {
        window.clearTimeout(paidPopTimer.current);
      }
    };
  }, []);

  const openSheet = React.useCallback(() => {
    setSheetOpen(true);
    if (pacientes !== null || pacientesLoading) return;

    setPacientesLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/pacientes", { cache: "no-store" });
        if (!res.ok) throw new Error("pacientes fetch failed");
        const payload = (await res.json()) as { data: JsonPaciente[] };
        setPacientes(payload.data.map(parsePaciente));
      } catch {
        setPacientes([]);
        setToast({
          open: true,
          message: "No se pudo cargar la lista de pacientes.",
        });
      } finally {
        setPacientesLoading(false);
      }
    })();
  }, [pacientes, pacientesLoading]);

  const closeSheet = React.useCallback(() => setSheetOpen(false), []);

  const handleCobrarTrigger = React.useCallback(
    (turno: TurnoConPaciente) => {
      setCobrandoTurnoId(turno.id);
    },
    [],
  );

  const cancelCobro = React.useCallback(() => setCobrandoTurnoId(null), []);

  const confirmCobro = React.useCallback(
    async (metodo: MetodoPago) => {
      if (!data || !cobrandoTurnoId) return;
      const turno = data.sesionesHoy.find((t) => t.id === cobrandoTurnoId);
      if (!turno) return;

      setCobrandoTurnoId(null);

      const snapshot = data;
      const nowDate = new Date();

      const nextSesiones = data.sesionesHoy.map((item) =>
        item.id === turno.id
          ? {
              ...item,
              pagoEstado: "pagado" as const,
              pagoFecha: nowDate,
              pagoMetodo: metodo,
              actualizadoEn: nowDate,
            }
          : item,
      );
      const nextDeudores = data.deudores
        .map((deudor) =>
          deudor.pacienteId === turno.paciente.id
            ? {
                ...deudor,
                sesionesImpagas: Math.max(0, deudor.sesionesImpagas - 1),
                montoTotal: Math.max(0, deudor.montoTotal - turno.tarifaCobrada),
              }
            : deudor,
        )
        .filter((deudor) => deudor.sesionesImpagas > 0);

      const nextKpis: KPIsDashboard = {
        ...data.kpis,
        ingresosMes: data.kpis.ingresosMes + turno.tarifaCobrada,
        deudaAcumulada: Math.max(
          0,
          data.kpis.deudaAcumulada - turno.tarifaCobrada,
        ),
      };

      setData({
        ...data,
        sesionesHoy: nextSesiones,
        deudores: nextDeudores,
        kpis: nextKpis,
      });

      setPaidPopId(turno.id);
      setToast({
        open: true,
        message: `Cobrado · ${turno.paciente.nombre} ${turno.paciente.apellido}`,
      });

      if (paidPopTimer.current !== null) {
        window.clearTimeout(paidPopTimer.current);
      }
      paidPopTimer.current = window.setTimeout(() => setPaidPopId(null), 430);

      try {
        const res = await fetch(`/api/turnos/${turno.id}/cobrar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metodo }),
        });
        if (!res.ok) throw new Error("cobrar failed");
      } catch {
        setData(snapshot);
        setToast({
          open: true,
          message: "No se pudo cobrar. Probá de nuevo.",
        });
      }
    },
    [data, cobrandoTurnoId],
  );

  const handleAgendar = React.useCallback(
    async (values: NuevoTurnoData) => {
      try {
        const fechaIso = new Date(
          `${values.fecha}T${values.hora}:00`,
        ).toISOString();
        const res = await fetch("/api/turnos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pacienteId: values.pacienteId,
            fecha: fechaIso,
            duracion: values.duracion,
            modalidad: values.modalidad,
            notas: values.notas?.trim() ? values.notas.trim() : null,
          }),
        });
        if (!res.ok) throw new Error("agendar failed");
        setSheetOpen(false);
        setToast({ open: true, message: "Turno agendado" });
        await fetchDashboard();
      } catch {
        setToast({
          open: true,
          message: "No se pudo agendar. Probá de nuevo.",
        });
      }
    },
    [fetchDashboard],
  );

  if (loadState === "loading" && !data) {
    return <DashboardSkeleton today={now} />;
  }

  if (loadState === "error" && !data) {
    return <DashboardError onRetry={fetchDashboard} />;
  }

  if (!data) return null;

  const turnos = data.sesionesHoy;
  const turnosOrdenados = [...turnos].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime(),
  );
  const proximaSesion =
    data.proximaSesion ??
    turnosOrdenados.find((turno) => turno.fecha.getTime() >= now.getTime()) ??
    null;
  const sesionesPagas = turnos.filter(
    (turno) => turno.pagoEstado === "pagado",
  ).length;
  const nombreProfesionalCorto = getFirstName(nombreProfesional);

  return (
    <>
      <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-7 p-5 lg:gap-10 lg:p-14">
        <HeroDelDia
          today={now}
          sesionesHoy={turnos.length}
          nombreProfesional={nombreProfesionalCorto}
        />

        {proximaSesion ? (
          <ProximaSesionCard turno={proximaSesion} now={now} />
        ) : null}

        <KpiStrip
          today={now}
          kpis={data.kpis}
          sesionesPagas={sesionesPagas}
          deudoresCount={data.deudores.length}
        />

        <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
          <AgendaDelDia
            turnos={turnosOrdenados}
            onCobrar={handleCobrarTrigger}
            onOpenPaciente={(id) => router.push(`/pacientes/${id}`)}
            onNuevoTurno={openSheet}
            paidPopId={paidPopId}
          />

          <aside className="flex flex-col gap-7 lg:gap-6">
            <PorCobrar deudores={data.deudores} />
            <RitmoSemana today={now} sesionesSemana={data.sesionesSemana} />
            <DelCuaderno today={now} />
          </aside>
        </div>
      </div>

      <Fab label="Agendar turno" onClick={openSheet} />

      <Sheet open={sheetOpen} onClose={closeSheet} ariaLabel="Agendar turno">
        <div className="-mx-6 -mb-6 lg:-m-7">
          {pacientes === null || pacientesLoading ? (
            <div className="px-6 py-14 text-center text-[13px] text-ink-500">
              Cargando pacientes…
            </div>
          ) : (
            <NuevoTurnoForm
              pacientes={pacientes}
              onSubmit={handleAgendar}
              onCancel={closeSheet}
            />
          )}
        </div>
      </Sheet>

      <Sheet
        open={cobrandoTurnoId !== null}
        onClose={cancelCobro}
        ariaLabel="Elegir método de pago"
        maxWidth={420}
      >
        <h3 className="mb-4 font-[family-name:var(--font-display)] text-[20px] font-medium text-ink-900">
          Método de pago
        </h3>
        <div className="-mx-6 overflow-hidden rounded-[8px] border border-[color:var(--border-subtle)] lg:-mx-1">
          {METODOS_PAGO.map((m, i) => (
            <button
              key={m.value}
              type="button"
              onClick={() => confirmCobro(m.value)}
              className={`flex w-full items-center bg-cream-50 px-4 py-3 text-left text-[14px] text-ink-900 transition-colors duration-150 hover:bg-cream-100 ${
                i !== METODOS_PAGO.length - 1
                  ? "border-b border-[color:var(--border-subtle)]"
                  : ""
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Sheet>

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
      />

      <style>{`
        .dashboard-session-row.dashboard-paid-pop > div:last-child > span {
          animation: dashboard-paid-pop 420ms var(--ease-out);
          transform-origin: center;
        }

        @keyframes dashboard-paid-pop {
          0% { transform: scale(1); }
          45% { transform: scale(1.12); }
          100% { transform: scale(1); }
        }
      `}</style>
    </>
  );
}

// ============================================
function DashboardSkeleton({ today }: { today: Date }) {
  const kpiLabels = ["Pacientes", "Sesiones hoy", "Por cobrar", "Este mes"];
  return (
    <div
      aria-busy="true"
      className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-7 p-5 lg:gap-10 lg:p-14"
    >
      <section className="min-w-0">
        <div className="flex items-center text-[13px] font-medium text-ink-500">
          <EditorialRule />
          <span>{saludo(today)}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-[family-name:var(--font-display)] text-[52px] font-medium italic leading-[0.92] tracking-[-0.03em] text-ink-900 lg:text-[80px]">
            {diaSemana(today)}
          </h1>
        </div>
        <p className="mt-2 text-[13px] text-ink-300">cargando tu día…</p>
      </section>

      <Card className="overflow-hidden rounded-[8px] p-0">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {kpiLabels.map((label, index) => (
            <div
              key={label}
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
                {label}
              </span>
              <span className="mt-2 block font-[family-name:var(--font-display)] text-[26px] font-medium leading-none tabular-nums text-ink-300 lg:text-[30px]">
                —
              </span>
              <span className="mt-1.5 block text-[12px] text-ink-300">—</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
        <Card className="rounded-[8px] p-6 text-[13px] text-ink-500">
          Cargando agenda…
        </Card>
        <Card className="rounded-[8px] p-6 text-[13px] text-ink-500">
          Cargando datos…
        </Card>
      </div>
    </div>
  );
}

function DashboardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="font-[family-name:var(--font-display)] text-[22px] font-medium italic text-ink-900">
        No se pudieron cargar los datos.
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

// ============================================
function HeroDelDia({
  today,
  sesionesHoy,
  nombreProfesional,
}: {
  today: Date;
  sesionesHoy: number;
  nombreProfesional: string | null;
}) {
  const [dayNumber, shortMonth] = fechaCorta(today).split(" ");
  const fechaCompleta = fechaLarga(today);

  return (
    <section aria-label={fechaCompleta} className="min-w-0">
      <div className="flex items-center text-[13px] font-medium text-ink-500">
        <EditorialRule />
        <span>
          {saludo(today)}
          {nombreProfesional ? `, ${nombreProfesional}` : ""}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-[52px] font-medium italic leading-[0.92] tracking-[-0.03em] text-ink-900 lg:text-[80px]">
          {diaSemana(today)}
        </h1>
        <span className="font-[family-name:var(--font-display)] text-[22px] font-medium leading-none text-ink-900 lg:text-[30px]">
          {dayNumber} {shortMonth}
        </span>
      </div>

      <p className="mt-2 text-[13px] text-ink-500">
        {sesionesHoy > 0
          ? `${sesionesHoy} sesiones en el día`
          : "sin sesiones agendadas"}
      </p>
    </section>
  );
}

function ProximaSesionCard({
  turno,
  now,
}: {
  turno: TurnoConPaciente;
  now: Date;
}) {
  const minutes = Math.max(
    0,
    Math.round((turno.fecha.getTime() - now.getTime()) / 60000),
  );
  const fullName = `${turno.paciente.nombre} ${turno.paciente.apellido}`;
  const avatarTone = avatarColor(fullName);
  const avatarInitials = initials(turno.paciente.nombre, turno.paciente.apellido);
  const ModalityIcon = turno.modalidad === "online" ? Video : MapPin;

  return (
    <Card className="relative overflow-hidden rounded-[8px] border-none bg-[linear-gradient(135deg,var(--color-sage-700)_0%,var(--color-sage-600)_60%,var(--color-sage-500)_100%)] p-5 text-white shadow-raised md:p-6 lg:p-7">
      <span
        aria-hidden="true"
        className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-[rgba(255,255,255,0.05)]"
      />
      <span
        aria-hidden="true"
        className="absolute -bottom-20 -right-16 h-52 w-52 rounded-full bg-[rgba(255,255,255,0.05)]"
      />

      <div className="relative">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/75">
          PRÓXIMA SESIÓN · EN {minutes} MIN
        </p>

        <div className="mt-4 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 lg:gap-4">
            <span
              className="inline-flex rounded-full"
              style={{ boxShadow: `0 0 0 2px ${avatarTone.bg}` }}
              title={avatarInitials}
            >
              <Avatar
                nombre={turno.paciente.nombre}
                apellido={turno.paciente.apellido}
                size={44}
                className="lg:hidden"
              />
              <Avatar
                nombre={turno.paciente.nombre}
                apellido={turno.paciente.apellido}
                size={52}
                className="hidden lg:inline-flex"
              />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-[family-name:var(--font-display)] text-[22px] font-medium leading-tight text-white lg:text-[28px]">
                {fullName}
              </h2>
              <div className="mt-1 flex items-center gap-1.5 text-[13px] text-white/85">
                <ModalityIcon size={14} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  {turno.modalidad === "online" ? "online" : "presencial"} ·{" "}
                  {turno.duracion}′ · {money(turno.tarifaCobrada)}
                </span>
              </div>
            </div>
          </div>

          <time className="shrink-0 font-[family-name:var(--font-display)] text-[38px] font-medium leading-none tabular-nums text-white lg:text-[48px]">
            {hora(turno.fecha)}
          </time>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full border-white/20 bg-white/[0.14] text-white hover:bg-white/20"
          >
            WhatsApp
          </Button>
          <Button
            asChild
            size="sm"
            variant="secondary"
            className="rounded-full border-white/20 bg-white/[0.14] text-white hover:bg-white/20"
          >
            <Link href={`/pacientes/${turno.paciente.id}`}>Ver ficha</Link>
          </Button>
          <Button
            size="sm"
            className="rounded-full bg-white text-sage-700 hover:bg-cream-100 sm:ml-auto"
          >
            Notas de sesión
          </Button>
        </div>
      </div>
    </Card>
  );
}

function KpiStrip({
  today,
  kpis,
  sesionesPagas,
  deudoresCount,
}: {
  today: Date;
  kpis: KPIsDashboard;
  sesionesPagas: number;
  deudoresCount: number;
}) {
  const mesActual = fechaLarga(today).split(" de ").at(-1) ?? "";
  const items = [
    {
      label: "Pacientes",
      value: kpis.pacientesActivos,
      subtext: "activos",
      accent: false,
    },
    {
      label: "Sesiones hoy",
      value: kpis.sesionesHoy,
      subtext: `${sesionesPagas} pagas`,
      accent: false,
    },
    {
      label: "Por cobrar",
      value: moneyShort(kpis.deudaAcumulada),
      subtext: `${deudoresCount} pacientes`,
      accent: kpis.deudaAcumulada > 0,
    },
    {
      label: "Este mes",
      value: moneyShort(kpis.ingresosMes),
      subtext: `cobrado ${mesActual}`,
      accent: false,
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
              className={`mt-2 block font-[family-name:var(--font-display)] text-[26px] font-medium leading-none tabular-nums lg:text-[30px] ${
                item.accent ? "text-terracotta-600" : "text-ink-900"
              }`}
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

function AgendaDelDia({
  turnos,
  onCobrar,
  onOpenPaciente,
  onNuevoTurno,
  paidPopId,
}: {
  turnos: TurnoConPaciente[];
  onCobrar: (turno: TurnoConPaciente) => void;
  onOpenPaciente: (id: string) => void;
  onNuevoTurno: () => void;
  paidPopId: string | null;
}) {
  return (
    <section className="min-w-0">
      <SectionCaption
        action={
          <div className="hidden items-center gap-4 lg:flex">
            <Button
              size="sm"
              onClick={onNuevoTurno}
              icon={<Plus size={14} strokeWidth={1.8} aria-hidden="true" />}
            >
              Nuevo turno
            </Button>
            <Link
              href="/agenda"
              className="text-[13px] font-semibold text-sage-600 hover:text-sage-700"
            >
              Ver semana →
            </Link>
          </div>
        }
      >
        Agenda del día
      </SectionCaption>

      {turnos.length > 0 ? (
        <div className="space-y-2">
          {turnos.map((turno) => (
            <div
              key={turno.id}
              role="link"
              tabIndex={0}
              onClick={() => onOpenPaciente(turno.paciente.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenPaciente(turno.paciente.id);
                }
              }}
            >
              <SessionRow
                turno={turno}
                onCobrar={() => onCobrar(turno)}
                className={`dashboard-session-row cursor-pointer ${
                  paidPopId === turno.id ? "dashboard-paid-pop" : ""
                }`}
              />
            </div>
          ))}
        </div>
      ) : (
        <AgendaEmptyState onNuevoTurno={onNuevoTurno} />
      )}
    </section>
  );
}

function AgendaEmptyState({ onNuevoTurno }: { onNuevoTurno: () => void }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--border-strong)] bg-white px-6 py-8 text-center">
      <svg
        width="52"
        height="52"
        viewBox="0 0 52 52"
        fill="none"
        aria-hidden="true"
        className="text-sage-500"
      >
        <circle
          cx="26"
          cy="26"
          r="20"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="3 4"
        />
        <path
          d="M26 14V27L34 31"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h2 className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-medium italic leading-tight text-ink-900">
        Hoy tu agenda está libre.
      </h2>
      <p className="mt-2 max-w-[320px] text-[14px] leading-6 text-ink-500">
        Buen día para ordenar pendientes, o simplemente descansar un rato.
      </p>
      <div className="mt-5 hidden lg:block">
        <Button
          size="sm"
          onClick={onNuevoTurno}
          icon={<Plus size={14} strokeWidth={1.8} aria-hidden="true" />}
        >
          Nuevo turno
        </Button>
      </div>
    </div>
  );
}

function PorCobrar({ deudores }: { deudores: DeudaPaciente[] }) {
  const visibles = deudores.slice(0, 4);

  return (
    <section>
      <SectionCaption>Por cobrar</SectionCaption>

      {visibles.length > 0 ? (
        <Card className="overflow-hidden rounded-[8px] p-0">
          <div className="divide-y divide-[color:var(--border-subtle)]">
            {visibles.map((deudor) => {
              const fullName = `${deudor.nombre} ${deudor.apellido}`;
              const avatarTone = avatarColor(fullName);
              const avatarInitials = initials(deudor.nombre, deudor.apellido);

              return (
                <Link
                  key={deudor.pacienteId}
                  href={`/pacientes/${deudor.pacienteId}`}
                  aria-label={`Abrir ficha de ${fullName}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-cream-50"
                  style={
                    {
                      "--deudor-color": avatarTone.bg,
                    } as React.CSSProperties
                  }
                >
                  <span
                    className="inline-flex rounded-full ring-1 ring-[var(--deudor-color)]"
                    title={avatarInitials}
                  >
                    <Avatar
                      nombre={deudor.nombre}
                      apellido={deudor.apellido}
                      size={32}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink-900">
                      {fullName}
                    </span>
                    <span className="block text-[11px] text-ink-500">
                      {deudor.sesionesImpagas}{" "}
                      {deudor.sesionesImpagas === 1 ? "sesión" : "sesiones"}
                    </span>
                  </span>
                  <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-terracotta-600">
                    {money(deudor.montoTotal)}
                  </span>
                </Link>
              );
            })}
          </div>

          {deudores.length > 4 ? (
            <Link
              href="/pacientes"
              className="block border-t border-[color:var(--border-subtle)] px-4 py-3 text-center text-[13px] font-semibold text-sage-600 hover:bg-cream-50"
            >
              Ver todos ({deudores.length})
            </Link>
          ) : null}
        </Card>
      ) : (
        <Card className="rounded-[8px] p-6 text-center text-[13px] text-ink-500">
          Nadie te debe. Día prolijo.
        </Card>
      )}
    </section>
  );
}

function RitmoSemana({
  today,
  sesionesSemana,
}: {
  today: Date;
  sesionesSemana: number[];
}) {
  const currentDay = (today.getDay() + 6) % 7;
  const maxSessions = Math.max(...sesionesSemana, 1);

  return (
    <section>
      <SectionCaption>Ritmo de la semana</SectionCaption>
      <Card className="rounded-[8px] p-4">
        <div className="flex h-[92px] items-end gap-2">
          {sesionesSemana.map((sessions, index) => {
            const height =
              sessions === 0 ? 4 : Math.max(10, (sessions / maxSessions) * 86);
            const active = index === currentDay;

            return (
              <div
                key={`${WEEK_DAYS[index]}-${index}`}
                className="flex flex-1 items-end"
              >
                <div
                  className={`w-full rounded-t-sm ${
                    active ? "bg-sage-500" : "bg-sage-200"
                  }`}
                  style={{ height }}
                  aria-label={`${WEEK_DAYS[index]}: ${sessions} sesiones`}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-2 text-center">
          {WEEK_DAYS.map((day, index) => (
            <span
              key={`${day}-${index}`}
              className={`text-[10px] ${
                index === currentDay
                  ? "font-semibold text-sage-600"
                  : "font-medium text-ink-300"
              }`}
            >
              {day}
            </span>
          ))}
        </div>
      </Card>
    </section>
  );
}

function DelCuaderno({ today }: { today: Date }) {
  const thought =
    THOUGHTS[(today.getDate() + today.getMonth() + 1) % THOUGHTS.length];

  return (
    <section>
      <SectionCaption>Del cuaderno</SectionCaption>
      <Card className="rounded-[8px] border-l-2 border-l-sage-500 bg-cream-100 p-5">
        <p className="font-[family-name:var(--font-display)] text-[16px] font-normal italic leading-[1.45] text-ink-900">
          «{thought.texto}»
        </p>
        <p className="mt-3 text-[11px] text-ink-500">
          {thought.fuente} · {fechaRelativa(today, today)}
        </p>
      </Card>
    </section>
  );
}

function SectionCaption({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        <EditorialRule />
        <span>{children}</span>
      </div>
      {action}
    </div>
  );
}
