"use client";

// Pantalla de Hoy. Orquesta cuatro bloques en este orden: PENDIENTES (lo que
// espera una acción), AHORA (la sesión en curso o la que viene), AGENDA DEL
// DÍA y TE DEBEN. Acá no se decide ninguna regla clínica ni de cobro: se lee
// /api/dashboard una vez, se reparte y se vuelve a leer cuando algo cambió.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import {
  Button,
  Card,
  EditorialRule,
  SessionRow,
  Sheet,
  Toast,
} from "@/components/ui";
import { NuevoTurnoForm } from "@/components/forms";
import type { NuevoTurnoData } from "@/components/forms/nuevo-turno-form";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  diaSemana,
  fechaCorta,
  fechaLarga,
  money,
  moneyShort,
  saludo,
} from "@/lib/format";
import { ALGO_FALLO, NAV, TE_DEBEN, TU_CONSULTORIO } from "@/lib/glosario";
import type { DashboardData, PendientesTerapeuta } from "@/app/api/_lib/domain";
import type {
  Configuracion,
  DeudaPaciente,
  MetodoPago,
  PacienteConDeuda,
  TurnoConPaciente,
} from "@/types/domain";

import { CardAhora } from "./card-ahora";
import { Pendientes } from "./pendientes";

const METODOS_PAGO: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "otro", label: "Otro" },
];

const SIN_PENDIENTES: PendientesTerapeuta = {
  notasParaRevisar: [],
  sinCobrar: [],
  sinAutorizacion: [],
};

// JSON convierte Date → string. Volvemos a Date solo donde el UI lo necesita.
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
> & { creadoEn: string; actualizadoEn: string; ultimaSesion: string | null };
type JsonDashboard = Omit<DashboardData, "sesionesHoy" | "proximaSesion"> & {
  sesionesHoy: JsonTurno[];
  proximaSesion: JsonTurno | null;
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

function parsePaciente(raw: JsonPaciente): PacienteConDeuda {
  return {
    ...raw,
    creadoEn: new Date(raw.creadoEn),
    actualizadoEn: new Date(raw.actualizadoEn),
    ultimaSesion: raw.ultimaSesion ? new Date(raw.ultimaSesion) : null,
  };
}

interface EstadoHoy {
  data: DashboardData;
  nombre: string | null;
  /** `ahora` se construye recién con los datos, ya en el cliente: armarlo
   *  durante el render del servidor (UTC) daba textos distintos a los de
   *  Montevideo y disparaba el mismatch de hidratación React #418. */
  ahora: Date;
}

/** Lectura pura: sin estado ni efectos. El resultado entra por then(). */
async function leerHoy(): Promise<EstadoHoy> {
  const [raw, config] = await Promise.all([
    apiGet<JsonDashboard>("/api/dashboard"),
    apiGet<Pick<Configuracion, "nombreProfesional">>("/api/config").catch(
      () => null,
    ),
  ]);
  return {
    data: {
      ...raw,
      sesionesHoy: raw.sesionesHoy.map(parseTurno),
      proximaSesion: raw.proximaSesion ? parseTurno(raw.proximaSesion) : null,
    },
    nombre: config?.nombreProfesional?.trim().split(/\s+/)[0] || null,
    ahora: new Date(),
  };
}

export function Dashboard() {
  const router = useRouter();
  const [estado, setEstado] = React.useState<EstadoHoy | null>(null);
  const [fallo, setFallo] = React.useState(false);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [toast, setToast] = React.useState({ open: false, message: "" });
  const [turnoSheet, setTurnoSheet] = React.useState(false);
  const [pacientes, setPacientes] = React.useState<PacienteConDeuda[] | null>(
    null,
  );
  const [cobrando, setCobrando] = React.useState<string | null>(null);

  const recargar = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    let cancelado = false;
    leerHoy()
      .then((siguiente) => {
        if (cancelado) return;
        setEstado(siguiente);
        setFallo(false);
      })
      .catch(() => {
        if (!cancelado) setFallo(true);
      });
    return () => {
      cancelado = true;
    };
  }, [reloadKey]);

  const abrirTurno = React.useCallback(() => {
    setTurnoSheet(true);
    if (pacientes !== null) return;
    apiGet<JsonPaciente[]>("/api/pacientes")
      .then((lista) => setPacientes(lista.map(parsePaciente)))
      .catch(() => {
        setPacientes([]);
        setToast({ open: true, message: ALGO_FALLO });
      });
  }, [pacientes]);

  const cobrar = React.useCallback(
    (metodo: MetodoPago) => {
      const turnoId = cobrando;
      setCobrando(null);
      if (!turnoId) return;
      apiPost(`/api/turnos/${turnoId}/cobrar`, { metodo })
        .then(() => {
          setToast({ open: true, message: "Cobrado" });
          recargar();
        })
        .catch(() =>
          setToast({ open: true, message: "No se pudo cobrar. Probá de nuevo." }),
        );
    },
    [cobrando, recargar],
  );

  const agendar = React.useCallback(
    (valores: NuevoTurnoData) => {
      apiPost("/api/turnos", {
        pacienteId: valores.pacienteId,
        fecha: new Date(`${valores.fecha}T${valores.hora}:00`).toISOString(),
        duracion: valores.duracion,
        modalidad: valores.modalidad,
        notas: valores.notas?.trim() ? valores.notas.trim() : null,
      })
        .then(() => {
          setTurnoSheet(false);
          setToast({ open: true, message: "Turno agendado" });
          recargar();
        })
        .catch(() =>
          setToast({
            open: true,
            message: "No se pudo agendar. Probá de nuevo.",
          }),
        );
    },
    [recargar],
  );

  if (!estado) {
    return fallo ? <FalloDeCarga onReintentar={recargar} /> : <Cargando />;
  }

  const { data, nombre, ahora } = estado;
  const pendientes = data.pendientes ?? SIN_PENDIENTES;
  const turnos = [...data.sesionesHoy].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime(),
  );
  const notaPorTurno = new Map(
    pendientes.notasParaRevisar.map((n) => [n.turnoId, n.sesionId]),
  );
  const sinAutorizacion = new Set(
    pendientes.sinAutorizacion.map((t) => t.turnoId),
  );
  const sinCobrar = new Set(pendientes.sinCobrar.map((s) => s.turnoId));

  const enCurso = turnos.find(
    (t) =>
      t.fecha.getTime() <= ahora.getTime() &&
      ahora.getTime() < t.fecha.getTime() + t.duracion * 60000,
  );
  const ahoraTurno =
    enCurso ?? turnos.find((t) => t.fecha.getTime() >= ahora.getTime()) ?? null;

  return (
    <>
      <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-7 p-5 lg:gap-10 lg:p-14">
        <Saludo ahora={ahora} nombre={nombre} sesiones={turnos.length} />

        <Pendientes pendientes={pendientes} onCobrar={setCobrando} />

        {ahoraTurno ? (
          <CardAhora
            turno={ahoraTurno}
            enCurso={Boolean(enCurso)}
            sinAutorizacion={sinAutorizacion.has(ahoraTurno.id)}
            sinCobrar={sinCobrar.has(ahoraTurno.id)}
            onCobrar={() => setCobrando(ahoraTurno.id)}
            reloadKey={reloadKey}
          />
        ) : null}

        <Kpis ahora={ahora} data={data} />

        <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
          <section className="min-w-0">
            <Titulo
              accion={
                <div className="flex items-center gap-4">
                  <Button
                    size="sm"
                    onClick={abrirTurno}
                    icon={<Plus size={14} strokeWidth={1.8} aria-hidden="true" />}
                  >
                    Turno
                  </Button>
                  <Link
                    href="/agenda"
                    className="hidden text-[13px] font-semibold text-sage-600 hover:text-sage-700 lg:inline"
                  >
                    Ver semana →
                  </Link>
                </div>
              }
            >
              Agenda del día
            </Titulo>

            {turnos.length > 0 ? (
              <div className="space-y-2">
                {turnos.map((turno) => (
                  <SessionRow
                    key={turno.id}
                    turno={turno}
                    ahora={ahora}
                    notaParaRevisar={notaPorTurno.has(turno.id)}
                    sinAutorizacion={sinAutorizacion.has(turno.id)}
                    onCobrar={() => setCobrando(turno.id)}
                    onRevisarNota={() =>
                      router.push(`/sesiones/${notaPorTurno.get(turno.id)}`)
                    }
                    onGrabar={() => router.push(`/grabar/${turno.id}`)}
                    onAutorizar={() =>
                      router.push(`/pacientes/${turno.paciente.id}`)
                    }
                  />
                ))}
              </div>
            ) : (
              <Card className="rounded-[8px] p-6 text-center">
                <p className="font-[family-name:var(--font-display)] text-[20px] font-medium italic text-ink-900">
                  Hoy tu agenda está libre.
                </p>
                <p className="mt-2 text-[14px] text-ink-500">
                  Buen día para ordenar pendientes, o para descansar un rato.
                </p>
              </Card>
            )}
          </section>

          <TeDeben deudores={data.deudores} />
        </div>
      </div>

      <Sheet
        open={turnoSheet}
        onClose={() => setTurnoSheet(false)}
        ariaLabel="Agendar turno"
      >
        <div className="-mx-6 -mb-6 lg:-m-7">
          {pacientes === null ? (
            <div className="px-6 py-14 text-center text-[13px] text-ink-500">
              Cargando pacientes…
            </div>
          ) : (
            <NuevoTurnoForm
              pacientes={pacientes}
              onSubmit={agendar}
              onCancel={() => setTurnoSheet(false)}
            />
          )}
        </div>
      </Sheet>

      <Sheet
        open={cobrando !== null}
        onClose={() => setCobrando(null)}
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
              onClick={() => cobrar(m.value)}
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
        onClose={() => setToast((t) => ({ ...t, open: false }))}
      />
    </>
  );
}

function Saludo({
  ahora,
  nombre,
  sesiones,
}: {
  ahora: Date;
  nombre: string | null;
  sesiones: number;
}) {
  const [dia, mes] = fechaCorta(ahora).split(" ");
  return (
    <section aria-label={fechaLarga(ahora)} className="min-w-0">
      <div className="flex items-center text-[13px] font-medium text-ink-500">
        <EditorialRule />
        <span>
          {saludo(ahora)}
          {nombre ? ", " : ""}
          {nombre ? (
            <Link
              href="/config"
              title={TU_CONSULTORIO}
              className="font-semibold text-ink-900 underline decoration-sage-300 underline-offset-4 hover:decoration-sage-500"
            >
              {nombre}
            </Link>
          ) : (
            <Link
              href="/config"
              className="ml-2 font-semibold text-sage-600 hover:text-sage-700"
            >
              {TU_CONSULTORIO}
            </Link>
          )}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-[52px] font-medium italic leading-[0.92] tracking-[-0.03em] text-ink-900 lg:text-[80px]">
          {diaSemana(ahora)}
        </h1>
        <span className="font-[family-name:var(--font-display)] text-[22px] font-medium leading-none text-ink-900 lg:text-[30px]">
          {dia} {mes}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-ink-500">
        {sesiones > 0 ? `${sesiones} sesiones en el día` : "sin sesiones agendadas"}
      </p>
    </section>
  );
}

function Kpis({ ahora, data }: { ahora: Date; data: DashboardData }) {
  const mes = fechaLarga(ahora).split(" de ").at(-1) ?? "";
  const items = [
    {
      label: "Sesiones hoy",
      valor: data.kpis.sesionesHoy,
      pie: `${data.sesionesHoy.filter((t) => t.pagoEstado === "pagado").length} pagas`,
      acento: false,
      href: null as string | null,
    },
    {
      label: "Por cobrar",
      valor: moneyShort(data.kpis.deudaAcumulada),
      pie: `${data.deudores.length} pacientes`,
      acento: data.kpis.deudaAcumulada > 0,
      href: "/cobros",
    },
    {
      label: "Este mes",
      valor: moneyShort(data.kpis.ingresosMes),
      pie: `cobrado ${mes}`,
      acento: false,
      href: null as string | null,
    },
  ];

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <div className="grid grid-cols-3">
        {items.map((item, i) => {
          const clases = `min-w-0 p-4 lg:p-5 ${
            i < 2 ? "border-r border-[color:var(--border-subtle)]" : ""
          }`;
          const cuerpo = (
            <>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                {item.label}
              </span>
              <span
                className={`mt-2 block font-[family-name:var(--font-display)] text-[26px] font-medium leading-none tabular-nums lg:text-[30px] ${
                  item.acento ? "text-terracotta-600" : "text-ink-900"
                }`}
              >
                {item.valor}
              </span>
              <span className="mt-1.5 block text-[12px] text-ink-500">
                {item.pie}
              </span>
            </>
          );
          return item.href ? (
            <Link
              key={item.label}
              href={item.href}
              className={`${clases} block transition-colors duration-150 hover:bg-cream-50`}
            >
              {cuerpo}
            </Link>
          ) : (
            <div key={item.label} className={clases}>
              {cuerpo}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function TeDeben({ deudores }: { deudores: DeudaPaciente[] }) {
  return (
    <section>
      <Titulo
        accion={
          <Link
            href="/cobros"
            className="text-[13px] font-semibold text-sage-600 hover:text-sage-700"
          >
            {NAV.COBROS} →
          </Link>
        }
      >
        {TE_DEBEN}
      </Titulo>
      {deudores.length > 0 ? (
        <Card className="overflow-hidden rounded-[8px] p-0">
          <div className="divide-y divide-[color:var(--border-subtle)]">
            {deudores.slice(0, 3).map((deudor) => (
              <Link
                key={deudor.pacienteId}
                href={`/pacientes/${deudor.pacienteId}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-cream-50"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-900">
                  {deudor.nombre} {deudor.apellido}
                </span>
                <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-terracotta-600">
                  {money(deudor.montoTotal)}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="rounded-[8px] p-6 text-center text-[13px] text-ink-500">
          Nadie te debe. Día prolijo.
        </Card>
      )}
    </section>
  );
}

function Titulo({
  children,
  accion,
}: {
  children: React.ReactNode;
  accion?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        <EditorialRule />
        <span>{children}</span>
      </div>
      {accion}
    </div>
  );
}

function Cargando() {
  return (
    <div
      aria-busy="true"
      className="mx-auto w-full max-w-[1200px] p-5 text-[13px] text-ink-500 lg:p-14"
    >
      cargando tu día…
    </div>
  );
}

function FalloDeCarga({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="font-[family-name:var(--font-display)] text-[22px] font-medium italic text-ink-900">
        {ALGO_FALLO}
      </p>
      <Button variant="secondary" size="sm" onClick={onReintentar}>
        Reintentar
      </Button>
    </div>
  );
}
