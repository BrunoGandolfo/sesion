"use client";

// Recordatorios para hoy: los turnos que ella avisa por WhatsApp desde su
// propio teléfono. Sólo existe si en Tu consultorio eligió WhatsApp o Ambos;
// con SMS automático no se dibuja nada.
//
// Lee lo suyo aparte de /api/dashboard: si esta lectura falla, el resto de
// Hoy sigue en pie.
//
// "Abrir WhatsApp" es un enlace de verdad, no un botón que navega después
// de guardar: abrir WhatsApp NUNCA depende de que el registro salga bien.
// El click dispara además el registro (con keepalive) y, cuando vuelve, la
// fila pasa a "Avisado". El mensaje viene armado dentro del enlace; acá no
// se escribe ni una palabra de él.

import * as React from "react";
import Link from "next/link";

import { Button, Card } from "@/components/ui";
import { esAbort } from "@/lib/api-client";
import { fechaCorta, hora } from "@/lib/format";
import {
  ABRIR_WHATSAPP,
  NO_SE_ANOTO_AVISO,
  NO_SE_LEYERON_RECORDATORIOS,
  RECORDATORIOS_PARA_HOY,
  REINTENTAR,
  SIN_AVISAR,
  SIN_ENLACE,
  SIN_TELEFONO,
  SIN_TURNOS_PARA_AVISAR,
  VER_FICHA,
  avisadoA,
} from "@/lib/glosario";
import type { RecordatorioWhatsapp, RecordatoriosWhatsappDeHoy } from "@/types/domain";

import { leerRecordatoriosWhatsapp, muestraWhatsapp, registrarAbierto } from "./recordatorios-datos";
import { Titulo } from "./titulo";

export function RecordatoriosWhatsapp({ reloadKey = 0 }: { reloadKey?: number }) {
  const [lectura, setLectura] = React.useState<RecordatoriosWhatsappDeHoy | null>(null);
  const [error, setError] = React.useState(false);
  const [intento, setIntento] = React.useState(0);
  /** Turnos cuyo registro falló después de abrir WhatsApp. */
  const [sinAnotar, setSinAnotar] = React.useState<Set<string>>(new Set());

  // Hoy recarga al volver a la pestaña (reloadKey): un aviso hecho desde la
  // computadora aparece en el teléfono. Mientras tanto queda lo que había.
  React.useEffect(() => {
    const controller = new AbortController();
    leerRecordatoriosWhatsapp(controller.signal)
      .then((siguiente) => {
        setLectura(siguiente);
        setError(false);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted && !esAbort(err)) setError(true);
      });
    return () => controller.abort();
  }, [reloadKey, intento]);

  const alAbrir = React.useCallback((turno: RecordatorioWhatsapp) => {
    const { turnoId } = turno;
    setSinAnotar((previo) => sinElemento(previo, turnoId));
    registrarAbierto(turno)
      .then(({ avisadoEn }) =>
        setLectura((previa) =>
          previa
            ? {
                ...previa,
                turnos: previa.turnos.map((t) =>
                  t.turnoId === turnoId ? { ...t, avisadoEn } : t,
                ),
              }
            : previa,
        ),
      )
      .catch(() => setSinAnotar((previo) => new Set(previo).add(turnoId)));
  }, []);

  // Sin lectura buena todavía, un fallo se muestra igual: no se sabe el
  // canal. Con una lectura, manda su canal; si una recarga falla, queda lo
  // que había y además se dice que no está al día.
  const visible = lectura ? muestraWhatsapp(lectura.canal) : error;
  if (!visible) return null;

  return (
    <section className="min-w-0" aria-label={RECORDATORIOS_PARA_HOY}>
      <Titulo>{RECORDATORIOS_PARA_HOY}</Titulo>
      {error ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <p role="alert" className="text-[13px] text-ink-700">
            {NO_SE_LEYERON_RECORDATORIOS}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setIntento((i) => i + 1)}>
            {REINTENTAR}
          </Button>
        </div>
      ) : null}
      {!lectura ? null : lectura.turnos.length === 0 ? (
        <p className="text-[13px] text-ink-500">{SIN_TURNOS_PARA_AVISAR}</p>
      ) : (
        // !p-0: el padding de Card le gana a un p-0 común, y en 360 px esos
        // 48 px eran el nombre de la paciente.
        <Card className="rounded-[8px] !p-0">
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {lectura.turnos.map((turno) => (
              <FilaAviso
                key={turno.turnoId}
                turno={turno}
                sinAnotar={sinAnotar.has(turno.turnoId)}
                onAbrir={alAbrir}
              />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function FilaAviso({
  turno,
  sinAnotar,
  onAbrir,
}: {
  turno: RecordatorioWhatsapp;
  sinAnotar: boolean;
  onAbrir: (turno: RecordatorioWhatsapp) => void;
}) {
  const inicio = new Date(turno.fecha);
  const nombre = `${turno.paciente.nombre} ${turno.paciente.apellido}`.trim();
  const { enlace } = turno;

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p
          className={`break-words text-[13px] font-semibold ${
            enlace ? "text-ink-900" : "text-ink-500"
          }`}
        >
          {nombre}
        </p>
        <p className="text-[12px] tabular-nums text-ink-500">
          {fechaCorta(inicio)} · {hora(inicio)}
          {/* En el teléfono el estado va en su línea; en la computadora, a
              continuación. */}
          <span className="hidden sm:inline"> · </span>
          <br className="sm:hidden" />
          {enlace ? (
            turno.avisadoEn ? (
              <span className="font-semibold text-sage-600">
                {avisadoA(hora(new Date(turno.avisadoEn)))}
              </span>
            ) : (
              <span className="font-semibold text-gold-500">{SIN_AVISAR}</span>
            )
          ) : (
            <span>{turno.motivo === "sin_telefono" ? SIN_TELEFONO : SIN_ENLACE}</span>
          )}
        </p>
        {sinAnotar ? (
          <p role="alert" className="text-[12px] text-terracotta-600">
            {NO_SE_ANOTO_AVISO}
          </p>
        ) : null}
      </div>
      {enlace ? (
        <Button asChild variant="secondary" size="sm" className="shrink-0">
          <a
            href={enlace}
            target="_blank"
            rel="noopener"
            onClick={() => onAbrir(turno)}
          >
            {ABRIR_WHATSAPP}
          </a>
        </Button>
      ) : (
        <Link
          href={`/pacientes/${turno.paciente.id}`}
          className="inline-flex min-h-11 shrink-0 items-center text-[12px] font-semibold text-sage-600 hover:text-sage-700"
        >
          {VER_FICHA} →
        </Link>
      )}
    </li>
  );
}

function sinElemento(conjunto: Set<string>, elemento: string): Set<string> {
  if (!conjunto.has(elemento)) return conjunto;
  const siguiente = new Set(conjunto);
  siguiente.delete(elemento);
  return siguiente;
}
