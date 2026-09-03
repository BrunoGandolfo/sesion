"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, MessageCircle } from "lucide-react";
import { Avatar, Button, Card, EditorialRule } from "@/components/ui";
import { initials, money } from "@/lib/format";
import {
  TEMPLATE_COBRO_DEFAULT,
  buildWhatsAppUrl,
  interpolarTemplateCobro,
  textoAtraso,
  zonaDeuda,
  type ZonaDeuda,
} from "@/lib/deudas";
import type { Configuracion, DeudaPaciente } from "@/types/domain";

type DeudoresPageItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
};

type LoadState = "loading" | "ready" | "error";

type DatosDeudores = {
  deudores: DeudoresPageItem[];
  nombreProfesional: string;
};

async function cargarDeudores(signal: AbortSignal): Promise<DatosDeudores> {
  const [resDeudores, resConfig] = await Promise.all([
    fetch("/api/deudores", { cache: "no-store", signal }),
    fetch("/api/config", { cache: "no-store", signal }),
  ]);
  if (!resDeudores.ok) throw new Error("deudores fetch failed");

  const dJson = (await resDeudores.json()) as { data: DeudoresPageItem[] };

  // /api/config puede fallar (e.g. sin configuración inicial); en ese caso
  // dejamos el nombre vacío y el template sale sin firma.
  let nombreProfesional = "";
  if (resConfig.ok) {
    const cJson = (await resConfig.json()) as { data: Configuracion };
    nombreProfesional = cJson.data.nombreProfesional ?? "";
  }

  return { deudores: dJson.data, nombreProfesional };
}

export function DeudoresView() {
  const [deudores, setDeudores] = React.useState<DeudoresPageItem[]>([]);
  const [nombreProfesional, setNombreProfesional] = React.useState<string>("");
  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const [reloadKey, setReloadKey] = React.useState(0);

  // No pone "loading" acá: es el estado inicial, y el reintento lo setea en
  // su propio handler.
  React.useEffect(() => {
    const controller = new AbortController();

    cargarDeudores(controller.signal)
      .then((datos) => {
        setDeudores(datos.deudores);
        setNombreProfesional(datos.nombreProfesional);
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

  if (loadState === "loading" && deudores.length === 0) {
    return <DeudoresSkeleton />;
  }

  if (loadState === "error") {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-[960px] flex-col items-center justify-center gap-4 px-5 py-8 text-center">
        <p className="font-[family-name:var(--font-display)] text-[22px] font-medium italic text-ink-900">
          No se pudieron cargar los deudores.
        </p>
        <Button variant="secondary" size="sm" onClick={reintentar}>
          Reintentar
        </Button>
      </div>
    );
  }

  const totalDeuda = deudores.reduce((sum, d) => sum + d.montoTotal, 0);
  const totalSesiones = deudores.reduce((sum, d) => sum + d.sesionesImpagas, 0);
  const totalMinutos = deudores.reduce((sum, d) => sum + d.minutosTotales, 0);
  const conteoPorZona: Record<ZonaDeuda, number> = {
    sage: 0,
    gold: 0,
    terracotta: 0,
  };
  for (const d of deudores) conteoPorZona[zonaDeuda(d.diasAtraso)] += 1;

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-5 py-6 lg:gap-8 lg:px-10 lg:py-10">
      <header className="min-w-0">
        <div className="flex items-center text-[13px] font-medium text-ink-500">
          <EditorialRule />
          <span>Cobranza</span>
        </div>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-[40px] font-medium italic leading-[0.95] tracking-[-0.02em] text-ink-900 lg:text-[56px]">
          Deudores
        </h1>
        <p className="mt-2 text-[13px] text-ink-500">
          {deudores.length === 0
            ? "Nadie te debe."
            : `${deudores.length} ${deudores.length === 1 ? "paciente" : "pacientes"} · ${money(totalDeuda)} en total`}
        </p>
        {deudores.length > 0 ? (
          <ZonaResumen counts={conteoPorZona} />
        ) : null}
      </header>

      {deudores.length === 0 ? (
        <Card className="rounded-[8px] p-10 text-center text-[14px] text-ink-500">
          Día prolijo. Nadie tiene sesiones impagas.
        </Card>
      ) : (
        <>
          <ImpactoBanner
            minutos={totalMinutos}
            sesiones={totalSesiones}
          />
          <DesktopTable
            deudores={deudores}
            nombreProfesional={nombreProfesional}
          />
          <MobileList
            deudores={deudores}
            nombreProfesional={nombreProfesional}
          />
        </>
      )}
    </div>
  );
}

function ImpactoBanner({
  minutos,
  sesiones,
}: {
  minutos: number;
  sesiones: number;
}) {
  if (sesiones === 0) return null;
  const tiempo = formatHorasMinutos(minutos);
  const sesionesLabel = sesiones === 1 ? "1 sesión" : `${sesiones} sesiones`;

  return (
    <Card className="rounded-[8px] border-l-2 border-l-terracotta-500 bg-cream-100 px-5 py-5 lg:px-6 lg:py-6">
      <p className="text-[15px] leading-[1.55] text-ink-700">
        Trabajaste{" "}
        <span className="font-[family-name:var(--font-display)] text-[26px] font-bold leading-none text-terracotta-600 lg:text-[30px]">
          {tiempo}
        </span>{" "}
        gratis. Son {sesionesLabel} que todavía no cobraste.
      </p>
    </Card>
  );
}

function ZonaResumen({ counts }: { counts: Record<ZonaDeuda, number> }) {
  const items: { label: string; value: number; tone: ZonaDeuda }[] = [
    { label: "1–14 días", value: counts.sage, tone: "sage" },
    { label: "15–30 días", value: counts.gold, tone: "gold" },
    { label: "31+ días", value: counts.terracotta, tone: "terracotta" },
  ];
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.label}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${zonaPillClass(item.tone)}`}
        >
          <span>{item.label}</span>
          <span className="tabular-nums opacity-80">{item.value}</span>
        </span>
      ))}
    </div>
  );
}

function zonaPillClass(tone: ZonaDeuda): string {
  if (tone === "terracotta") return "bg-terracotta-50 text-terracotta-600";
  if (tone === "gold") return "bg-gold-50 text-gold-500";
  return "bg-sage-50 text-sage-600";
}

function ZonaIndicator({ dias }: { dias: number }) {
  const zona = zonaDeuda(dias);
  const texto = textoAtraso(dias);
  if (zona === "terracotta") {
    return (
      <span className="inline-flex items-center rounded-full bg-terracotta-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-terracotta-600">
        {texto}
      </span>
    );
  }
  if (zona === "gold") {
    return (
      <span className="text-[12px] font-medium text-gold-500">
        {texto} <span aria-hidden="true">⚠</span>
      </span>
    );
  }
  return <span className="text-[12px] text-sage-600">{texto}</span>;
}

function buildMensaje(
  deudor: DeudoresPageItem,
  nombreProfesional: string,
): string {
  return interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
    nombre: deudor.nombre,
    sesiones: deudor.sesionesImpagas,
    monto: money(deudor.montoTotal),
    profesional: nombreProfesional,
  });
}

function WhatsAppRecordatorio({
  deudor,
  nombreProfesional,
  block = false,
}: {
  deudor: DeudoresPageItem;
  nombreProfesional: string;
  block?: boolean;
}) {
  const telefono = deudor.telefono?.trim() ?? "";
  if (!telefono) return null;
  const url = buildWhatsAppUrl(telefono, buildMensaje(deudor, nombreProfesional));

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`Recordar cobro a ${deudor.nombre} ${deudor.apellido} por WhatsApp`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-sage-500 px-3 py-1.5 text-[12px] font-semibold text-sage-600 transition-colors duration-150 hover:bg-sage-50 ${
        block ? "w-full" : ""
      }`}
    >
      <MessageCircle size={14} strokeWidth={1.8} aria-hidden="true" />
      Recordar cobro
    </a>
  );
}

function DesktopTable({
  deudores,
  nombreProfesional,
}: {
  deudores: DeudoresPageItem[];
  nombreProfesional: string;
}) {
  // Paciente | Sesiones gratis | Atraso | Deuda | Acción
  const cols = "1.6fr 1.2fr 1.1fr 130px 160px";
  return (
    <div className="hidden lg:block bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
      <div
        className="grid items-center bg-cream-50 border-b border-[color:var(--border-subtle)] pl-[22px] pr-5 py-3 gap-4 text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-500"
        style={{ gridTemplateColumns: cols }}
      >
        <span>Paciente</span>
        <span>Trabajaste gratis</span>
        <span>Atraso</span>
        <span>Deuda</span>
        <span aria-hidden="true" />
      </div>
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {deudores.map((d) => {
          const fullName = `${d.nombre} ${d.apellido}`;
          const sesionesTexto =
            d.sesionesImpagas === 1
              ? "1 sesión gratis"
              : `${d.sesionesImpagas} sesiones gratis`;
          return (
            <li
              key={d.pacienteId}
              className="grid items-center pl-5 pr-5 py-[14px] gap-4 transition-colors duration-150 border-l-[2px] border-l-transparent hover:bg-cream-50 hover:border-l-sage-500"
              style={{ gridTemplateColumns: cols }}
            >
              <Link
                href={`/pacientes/${d.pacienteId}`}
                className="flex items-center gap-3 min-w-0 group"
                aria-label={`Abrir ficha de ${fullName}`}
              >
                <Avatar nombre={d.nombre} apellido={d.apellido} size={36} />
                <span className="min-w-0">
                  <span
                    className="block text-[14px] font-semibold text-ink-900 truncate group-hover:underline"
                    title={initials(d.nombre, d.apellido)}
                  >
                    {fullName}
                  </span>
                  <span className="block text-[11px] text-ink-500 truncate">
                    Trabajaste {sesionesTexto}
                  </span>
                </span>
              </Link>
              <span className="text-[13px] text-ink-700 tabular-nums">
                {formatHorasMinutos(d.minutosTotales)}
              </span>
              <span>
                <ZonaIndicator dias={d.diasAtraso} />
              </span>
              <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-terracotta-600">
                {money(d.montoTotal)}
              </span>
              <span className="flex items-center justify-end gap-2">
                <WhatsAppRecordatorio
                  deudor={d}
                  nombreProfesional={nombreProfesional}
                />
                <Link
                  href={`/pacientes/${d.pacienteId}`}
                  aria-label={`Ver ficha de ${fullName}`}
                  className="text-ink-300 hover:text-ink-500"
                >
                  <ChevronRight
                    size={16}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MobileList({
  deudores,
  nombreProfesional,
}: {
  deudores: DeudoresPageItem[];
  nombreProfesional: string;
}) {
  return (
    <div className="lg:hidden bg-white border border-[color:var(--border-subtle)] rounded-lg overflow-hidden">
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {deudores.map((d) => {
          const fullName = `${d.nombre} ${d.apellido}`;
          const sesionesTexto =
            d.sesionesImpagas === 1
              ? "1 sesión gratis"
              : `${d.sesionesImpagas} sesiones gratis`;
          return (
            <li
              key={d.pacienteId}
              className="flex flex-col gap-3 px-4 py-3"
            >
              <Link
                href={`/pacientes/${d.pacienteId}`}
                className="flex items-center gap-3 active:bg-cream-50 -mx-1 px-1 py-1 rounded-md"
              >
                <Avatar nombre={d.nombre} apellido={d.apellido} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink-900">
                    {fullName}
                  </span>
                  <span className="block text-[11px] text-ink-500">
                    Trabajaste {sesionesTexto}
                    {" · "}
                    {formatHorasMinutos(d.minutosTotales)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px]">
                    <ZonaIndicator dias={d.diasAtraso} />
                    <span aria-hidden="true" className="text-ink-300">
                      ·
                    </span>
                    <span className="font-[family-name:var(--font-display)] text-[14px] font-medium tabular-nums text-terracotta-600">
                      {money(d.montoTotal)}
                    </span>
                  </span>
                </span>
                <ChevronRight
                  size={16}
                  strokeWidth={1.6}
                  className="text-ink-300 shrink-0"
                  aria-hidden="true"
                />
              </Link>
              <WhatsAppRecordatorio
                deudor={d}
                nombreProfesional={nombreProfesional}
                block
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DeudoresSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-5 py-6 lg:gap-8 lg:px-10 lg:py-10"
    >
      <header>
        <div className="flex items-center text-[13px] font-medium text-ink-500">
          <EditorialRule />
          <span>Cobranza</span>
        </div>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-[40px] font-medium italic leading-[0.95] tracking-[-0.02em] text-ink-900 lg:text-[56px]">
          Deudores
        </h1>
        <p className="mt-2 text-[13px] text-ink-300">cargando…</p>
      </header>
      <Card className="rounded-[8px] p-0 overflow-hidden">
        <ul className="divide-y divide-[color:var(--border-subtle)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <span className="h-10 w-10 rounded-full bg-cream-200" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3 w-40 rounded-sm bg-cream-200" />
                <span className="h-3 w-28 rounded-sm bg-cream-100" />
              </span>
              <span className="h-5 w-16 rounded-sm bg-cream-100" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * "X horas y Y minutos" en castellano rioplatense, con singular/plural y sin
 * piezas vacías:
 *   125 → "2 horas y 5 minutos"
 *    60 → "1 hora"
 *    45 → "45 minutos"
 *     1 → "1 minuto"
 *     0 → "0 minutos"
 */
function formatHorasMinutos(totalMinutos: number): string {
  const m = Math.max(0, Math.round(totalMinutos));
  const horas = Math.floor(m / 60);
  const minutos = m % 60;
  const partes: string[] = [];
  if (horas > 0) {
    partes.push(`${horas} ${horas === 1 ? "hora" : "horas"}`);
  }
  if (minutos > 0 || horas === 0) {
    partes.push(`${minutos} ${minutos === 1 ? "minuto" : "minutos"}`);
  }
  return partes.join(" y ");
}
