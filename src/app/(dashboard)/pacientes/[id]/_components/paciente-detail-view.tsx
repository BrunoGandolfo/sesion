"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Archive,
  Calendar as CalendarIcon,
  ChevronLeft,
  Edit3,
  Mail,
  Phone,
  Wallet,
} from "lucide-react";
import {
  Avatar,
  Button,
  Chip,
  EditorialRule,
  Sheet,
  Textarea,
  Toast,
} from "@/components/ui";
import { fechaCorta, hora, money, moneyShort } from "@/lib/format";
import { EditarPacienteForm } from "./editar-paciente-form";
import type {
  MetodoPago,
  Modalidad,
  Paciente,
  PacienteConDeuda,
  Turno,
  TurnoEstado,
} from "@/types/domain";

const MAX_VISIBLES = 12;

type PacienteJson = Omit<
  PacienteConDeuda,
  "creadoEn" | "actualizadoEn" | "ultimaSesion"
> & {
  creadoEn: string;
  actualizadoEn: string;
  ultimaSesion: string | null;
};

type TurnoJson = Omit<Turno, "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
};

type PacienteDetailResponse = {
  data: PacienteJson;
  turnos: TurnoJson[];
};

type PacientePatchResponse = {
  data: Paciente;
};

type TurnoResponse = {
  data: TurnoJson;
};

type ToastState = {
  open: boolean;
  message: string;
};

function parsePaciente(paciente: PacienteJson): PacienteConDeuda {
  return {
    ...paciente,
    creadoEn: new Date(paciente.creadoEn),
    actualizadoEn: new Date(paciente.actualizadoEn),
    ultimaSesion: paciente.ultimaSesion ? new Date(paciente.ultimaSesion) : null,
  };
}

function parseTurno(turno: TurnoJson): Turno {
  return {
    ...turno,
    fecha: new Date(turno.fecha),
    pagoFecha: turno.pagoFecha ? new Date(turno.pagoFecha) : null,
    creadoEn: new Date(turno.creadoEn),
    actualizadoEn: new Date(turno.actualizadoEn),
  };
}

async function fetchPacienteDetail(
  id: string,
  signal?: AbortSignal,
): Promise<{ paciente: PacienteConDeuda; turnos: Turno[] }> {
  const response = await fetch(`/api/pacientes/${id}`, { signal });

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "No encontramos ese paciente."
        : "No se pudo cargar la ficha.",
    );
  }

  const json = (await response.json()) as PacienteDetailResponse;
  return {
    paciente: parsePaciente(json.data),
    turnos: json.turnos.map(parseTurno),
  };
}

export function PacienteDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [paciente, setPaciente] = React.useState<PacienteConDeuda | null>(null);
  const [turnos, setTurnos] = React.useState<Turno[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [archiving, setArchiving] = React.useState(false);
  const [showEditar, setShowEditar] = React.useState(false);
  const [cobroTarget, setCobroTarget] = React.useState<Turno | null>(null);
  const [toast, setToast] = React.useState<ToastState>({
    open: false,
    message: "",
  });

  React.useEffect(() => {
    const controller = new AbortController();

    fetchPacienteDetail(id, controller.signal)
      .then((data) => {
        setPaciente(data.paciente);
        setTurnos(data.turnos);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "No se pudo cargar la ficha.");
        setLoading(false);
      });

    return () => controller.abort();
  }, [id, reloadKey]);

  function retryLoad() {
    setLoading(true);
    setError(null);
    setReloadKey((current) => current + 1);
  }

  const sesionesRealizadas = React.useMemo(
    () => turnos.filter((turno) => turno.estado === "realizado"),
    [turnos],
  );
  const totalCobrado = React.useMemo(
    () =>
      sesionesRealizadas.reduce(
        (acc, turno) =>
          turno.pagoEstado === "pagado" ? acc + turno.tarifaCobrada : acc,
        0,
      ),
    [sesionesRealizadas],
  );
  const deudaTotal = React.useMemo(
    () =>
      sesionesRealizadas.reduce(
        (acc, turno) =>
          turno.pagoEstado === "pendiente" ? acc + turno.tarifaCobrada : acc,
        0,
      ),
    [sesionesRealizadas],
  );

  async function cobrar(turnoId: string, metodo: MetodoPago) {
    if (!paciente) return;

    const previousTurnos = turnos;
    const current = turnos.find((turno) => turno.id === turnoId);
    if (!current || current.pagoEstado === "pagado") return;

    setTurnos((items) =>
      items.map((turno) =>
        turno.id === turnoId
          ? {
              ...turno,
              pagoEstado: "pagado",
              pagoFecha: new Date(),
              pagoMetodo: metodo,
            }
          : turno,
      ),
    );
    setToast({
      open: true,
      message: `Cobrado · ${paciente.nombre} ${paciente.apellido}`,
    });

    try {
      const response = await fetch(`/api/turnos/${turnoId}/cobrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metodo }),
      });

      if (!response.ok) {
        throw new Error("No se pudo cobrar la sesión.");
      }

      const json = (await response.json()) as TurnoResponse;
      const updatedTurno = parseTurno(json.data);
      setTurnos((items) =>
        items.map((turno) => (turno.id === turnoId ? updatedTurno : turno)),
      );
    } catch {
      setTurnos(previousTurnos);
      setToast({ open: true, message: "No se pudo cobrar" });
    }
  }

  async function archivarPaciente() {
    if (!paciente) return;

    setArchiving(true);

    try {
      const response = await fetch(`/api/pacientes/${paciente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: false }),
      });

      if (!response.ok) {
        throw new Error("No se pudo archivar.");
      }

      router.push("/pacientes?archivado=1");
    } catch {
      setArchiving(false);
      setToast({ open: true, message: "No se pudo archivar" });
    }
  }

  const handleNotasSaved = React.useCallback((notas: string) => {
    setPaciente((current) => (current ? { ...current, notas } : current));
  }, []);

  function handleEditSuccess() {
    setShowEditar(false);
    setToast({ open: true, message: "Paciente actualizado" });
    setReloadKey((current) => current + 1);
  }

  function openCobroSelector(turno: Turno) {
    setCobroTarget(turno);
  }

  function handleMetodoCobro(metodo: MetodoPago) {
    if (!cobroTarget) return;

    const turnoId = cobroTarget.id;
    setCobroTarget(null);
    void cobrar(turnoId, metodo);
  }

  if (loading && !paciente) {
    return <DetailSkeleton />;
  }

  if (error || !paciente) {
    return (
      <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
        <BackLink />
        <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg px-6 py-14 text-center">
          <p className="font-display text-[18px] font-medium text-ink-900">
            No pudimos abrir la ficha.
          </p>
          <p className="mt-1 text-[13px] text-ink-500">
            {error ?? "Probá de nuevo en un momento."}
          </p>
          <div className="mt-5">
            <Button
              variant="secondary"
              onClick={retryLoad}
            >
              Reintentar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const visibles = turnos.slice(0, MAX_VISIBLES);

  return (
    <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
      <BackLink />

      <PatientHeader
        paciente={paciente}
        archiving={archiving}
        onEdit={() => setShowEditar(true)}
        onArchive={archivarPaciente}
      />

      <div className="grid grid-cols-3 gap-3 lg:gap-4 mt-6 lg:mt-8">
        <KpiTile label="Sesiones" value={sesionesRealizadas.length} />
        <KpiTile label="Total cobrado" value={moneyShort(totalCobrado)} />
        <KpiTile
          label="Deuda"
          value={deudaTotal > 0 ? moneyShort(deudaTotal) : "-"}
          accent={deudaTotal > 0 ? "terracotta" : "default"}
        />
      </div>

      <section className="mt-8 lg:mt-10">
        <h2 className="flex items-center text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-500 mb-3">
          <EditorialRule />
          <span>Historial</span>
        </h2>
        <HistorialList sesiones={visibles} onCobrar={openCobroSelector} />
      </section>

      <section className="mt-8 lg:mt-10">
        <h2 className="flex items-center text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-500 mb-3">
          <EditorialRule />
          <span>Notas clínicas</span>
        </h2>
        <NotasClinicas
          pacienteId={paciente.id}
          initial={paciente.notas ?? ""}
          onSaved={handleNotasSaved}
        />
      </section>

      <Toast
        open={toast.open}
        message={toast.message}
        onClose={() => setToast((current) => ({ ...current, open: false }))}
      />

      <Sheet
        open={showEditar}
        onClose={() => setShowEditar(false)}
        maxWidth={520}
        ariaLabel="Editar paciente"
      >
        <EditarPacienteForm
          paciente={paciente}
          onSuccess={handleEditSuccess}
          onCancel={() => setShowEditar(false)}
        />
      </Sheet>

      <Sheet
        open={cobroTarget !== null}
        onClose={() => setCobroTarget(null)}
        maxWidth={360}
        ariaLabel="Elegir método de pago"
        className="!h-auto"
      >
        {cobroTarget && (
          <MetodoPagoSelector
            pacienteNombre={`${paciente.nombre} ${paciente.apellido}`}
            monto={cobroTarget.tarifaCobrada}
            onSelect={handleMetodoCobro}
            onCancel={() => setCobroTarget(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="px-5 lg:px-10 py-6 lg:py-8 max-w-[1120px] mx-auto">
      <div className="h-4 w-24 rounded-sm bg-cream-200 mb-5" />
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 lg:h-20 lg:w-20 rounded-full bg-cream-200" />
        <div className="flex flex-col gap-3 flex-1">
          <div className="h-8 w-56 rounded-sm bg-cream-200" />
          <div className="h-4 w-full max-w-[520px] rounded-sm bg-cream-100" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 lg:gap-4 mt-8">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="bg-white border border-[color:var(--border-subtle)] rounded-lg p-[14px] lg:p-5"
          >
            <div className="h-3 w-20 rounded-sm bg-cream-200" />
            <div className="mt-3 h-6 w-16 rounded-sm bg-cream-100" />
          </div>
        ))}
      </div>
      <div className="mt-10 bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="border-b border-[color:var(--border-subtle)] last:border-b-0 px-5 py-[14px]"
          >
            <div className="h-4 w-full max-w-[420px] rounded-sm bg-cream-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/pacientes"
      className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-700 transition-colors duration-150 mb-4"
    >
      <ChevronLeft size={16} strokeWidth={1.6} aria-hidden="true" />
      <span>Pacientes</span>
    </Link>
  );
}

function PatientHeader({
  paciente,
  archiving,
  onEdit,
  onArchive,
}: {
  paciente: PacienteConDeuda;
  archiving: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const altaLabel = new Date(paciente.creadoEn).toLocaleDateString("es-UY", {
    month: "short",
    year: "numeric",
  });

  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6">
      <div className="flex flex-col items-start lg:flex-row lg:items-center gap-4 lg:flex-1 min-w-0">
        <div className="lg:self-start">
          <Avatar
            nombre={paciente.nombre}
            apellido={paciente.apellido}
            size={64}
            className="lg:hidden"
          />
          <Avatar
            nombre={paciente.nombre}
            apellido={paciente.apellido}
            size={80}
            className="hidden lg:inline-flex"
          />
        </div>
        <div className="min-w-0">
          <h1 className="font-display font-medium text-ink-900 text-[28px] lg:text-[34px] leading-tight tracking-[-0.02em] truncate">
            {paciente.nombre} {paciente.apellido}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-500">
            <a
              href={`tel:${paciente.telefono.replace(/\s/g, "")}`}
              className="inline-flex items-center gap-1 underline decoration-sage-200 underline-offset-2 hover:text-ink-700"
            >
              <Phone size={13} strokeWidth={1.6} aria-hidden="true" />
              {paciente.telefono}
            </a>
            {paciente.email && (
              <a
                href={`mailto:${paciente.email}`}
                className="inline-flex items-center gap-1 underline decoration-sage-200 underline-offset-2 hover:text-ink-700"
              >
                <Mail size={13} strokeWidth={1.6} aria-hidden="true" />
                {paciente.email}
              </a>
            )}
            <span className="inline-flex items-center gap-1">
              <Wallet size={13} strokeWidth={1.6} aria-hidden="true" />
              {money(paciente.tarifa)} / sesión
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarIcon size={13} strokeWidth={1.6} aria-hidden="true" />
              Desde {altaLabel.replace(/\.$/, "")}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-4 lg:mt-0 lg:shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={onEdit}
          icon={<Edit3 size={14} strokeWidth={1.6} aria-hidden="true" />}
        >
          Editar
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={archiving}
          onClick={onArchive}
          icon={<Archive size={14} strokeWidth={1.6} aria-hidden="true" />}
        >
          {archiving ? "Archivando..." : "Archivar"}
        </Button>
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: string | number;
  accent?: "default" | "terracotta";
}) {
  const valueColor =
    accent === "terracotta" ? "text-terracotta-500" : "text-ink-900";

  return (
    <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg p-[14px] lg:p-5 flex flex-col gap-1">
      <span className="font-sans font-semibold text-[10px] uppercase tracking-[0.08em] text-ink-500">
        {label}
      </span>
      <span
        className={`font-display font-medium tabular-nums leading-none text-[22px] lg:text-[26px] ${valueColor}`}
      >
        {value}
      </span>
    </div>
  );
}

const metodosPago: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "mercadopago", label: "MercadoPago" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "otro", label: "Otro" },
];

function MetodoPagoSelector({
  pacienteNombre,
  monto,
  onSelect,
  onCancel,
}: {
  pacienteNombre: string;
  monto: number;
  onSelect: (metodo: MetodoPago) => void;
  onCancel: () => void;
}) {
  return (
    <div className="pb-2 pt-1">
      <div className="mb-5">
        <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Cobrar sesión
        </p>
        <h2 className="mt-1 font-display text-[22px] font-medium tracking-[-0.01em] text-ink-900">
          Elegí el método
        </h2>
        <p className="mt-1 text-[13px] text-ink-500">
          {pacienteNombre} · {money(monto)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {metodosPago.map((metodo) => (
          <button
            key={metodo.value}
            type="button"
            onClick={() => onSelect(metodo.value)}
            className="rounded-md border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-3 text-left text-[14px] font-semibold text-ink-900 transition-colors duration-150 hover:border-sage-500 hover:bg-white focus:outline-none focus:ring-[3px] focus:ring-sage-500/20"
          >
            {metodo.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function HistorialList({
  sesiones,
  onCobrar,
}: {
  sesiones: Turno[];
  onCobrar: (turno: Turno) => void;
}) {
  if (sesiones.length === 0) {
    return (
      <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg px-6 py-10 text-center">
        <p className="text-[13px] text-ink-500">
          Todavía no hay sesiones registradas.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {sesiones.map((sesion) => (
          <SesionRow
            key={sesion.id}
            sesion={sesion}
            onCobrar={() => onCobrar(sesion)}
          />
        ))}
      </ul>
    </div>
  );
}

function estadoLabel(estado: TurnoEstado): string {
  switch (estado) {
    case "programado":
      return "Agendado";
    case "realizado":
      return "Realizado";
    case "cancelado":
      return "Cancelado";
    case "ausente":
      return "Ausente";
  }
}

function SesionRow({
  sesion,
  onCobrar,
}: {
  sesion: Turno;
  onCobrar: () => void;
}) {
  const mobileCols = "auto 1fr auto";
  const desktopCols = "110px 1fr auto auto 90px";

  const modalidadLabel: Record<Modalidad, string> = {
    presencial: "Presencial",
    online: "Online",
  };

  const pagoAction = () => {
    if (sesion.estado === "cancelado") return null;
    if (sesion.pagoEstado === "pagado") {
      return <Chip variant="sage">Pagado</Chip>;
    }
    if (sesion.estado === "realizado") {
      return (
        <AnimatePresence mode="wait" initial={false}>
          <motion.button
            key="cobrar"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCobrar();
            }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            whileTap={{ scale: 0.96 }}
            className="bg-gold-50 text-gold-500 rounded-full px-[10px] py-[6px] text-[10px] font-semibold uppercase tracking-[0.08em] hover:bg-gold-50/80 transition-colors duration-150"
          >
            Cobrar
          </motion.button>
        </AnimatePresence>
      );
    }
    return null;
  };

  return (
    <li>
      <div
        className="lg:hidden grid items-center gap-3 px-5 py-[14px]"
        style={{ gridTemplateColumns: mobileCols }}
      >
        <div className="flex flex-col">
          <span className="text-[13px] text-ink-700 tabular-nums font-medium">
            {fechaCorta(sesion.fecha)}
          </span>
          <span className="text-[11px] text-ink-300 tabular-nums">
            {hora(sesion.fecha)}
          </span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[12px] text-ink-500">
            {modalidadLabel[sesion.modalidad as Modalidad]} · {sesion.duracion}{" "}
            min
          </span>
          <span className="text-[11px] text-ink-300">
            {estadoLabel(sesion.estado as TurnoEstado)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[13px] text-ink-900 tabular-nums">
            {money(sesion.tarifaCobrada)}
          </span>
          {pagoAction()}
        </div>
      </div>

      <div
        className="hidden lg:grid items-center gap-4 px-5 py-[14px]"
        style={{ gridTemplateColumns: desktopCols }}
      >
        <div className="flex flex-col">
          <span className="text-[13px] text-ink-700 tabular-nums font-medium">
            {fechaCorta(sesion.fecha)}
          </span>
          <span className="text-[11px] text-ink-300 tabular-nums">
            {hora(sesion.fecha)}
          </span>
        </div>
        <span className="text-[12px] text-ink-500">
          {modalidadLabel[sesion.modalidad as Modalidad]} · {sesion.duracion} min
        </span>
        <Chip variant="neutral">
          {estadoLabel(sesion.estado as TurnoEstado).toLowerCase()}
        </Chip>
        <span className="text-[13px] text-ink-900 tabular-nums">
          {money(sesion.tarifaCobrada)}
        </span>
        <div className="flex justify-end">{pagoAction()}</div>
      </div>
    </li>
  );
}

function NotasClinicas({
  pacienteId,
  initial,
  onSaved,
}: {
  pacienteId: string;
  initial: string;
  onSaved: (notas: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  const [savedValue, setSavedValue] = React.useState(initial);
  const [status, setStatus] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  React.useEffect(() => {
    if (value === savedValue) return;

    let cancelled = false;
    const nextValue = value;
    const timer = window.setTimeout(async () => {
      setStatus("saving");

      try {
        const response = await fetch(`/api/pacientes/${pacienteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notas: nextValue }),
        });

        if (!response.ok) {
          throw new Error("No se pudieron guardar las notas.");
        }

        await response.json() as PacientePatchResponse;

        if (cancelled) return;
        setSavedValue(nextValue);
        onSaved(nextValue);
        setStatus("saved");
      } catch {
        if (cancelled) return;
        setStatus("error");
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pacienteId, value, savedValue, onSaved]);

  const hint =
    status === "saving"
      ? "Guardando..."
      : status === "saved"
        ? "Guardado."
        : status === "error"
          ? "No se pudo guardar. Probá de nuevo."
          : "Se guarda automáticamente.";

  return (
    <div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Notas breves, visible solo para vos."
        aria-label="Notas clínicas"
      />
      <p
        className={`mt-2 text-[11px] ${
          status === "error" ? "text-[color:var(--color-error)]" : "text-ink-300"
        }`}
      >
        {hint}
      </p>
    </div>
  );
}
