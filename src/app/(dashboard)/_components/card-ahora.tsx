"use client";

// AHORA: la sesión en curso, o la próxima del día si no hay ninguna abierta.
//
// Es la única tarjeta de la pantalla de Hoy y tiene un solo botón, el que
// corresponde al momento del turno: grabar, esperar la nota, revisarla,
// cobrar o hacer firmar la autorización. Nunca dos a la vez: si hay dos
// cosas posibles, la que se ofrece es la que no se puede saltear.
//
// El brief va en versión corta —última vez y foco— porque acá se lee de
// pie, con la paciente entrando: el mismo componente que usa el sheet del
// turno (components/clinico/brief-corto.tsx). La versión completa ("Para
// retomar", brief-pre-sesion.tsx) sigue viviendo en la ficha.

import * as React from "react";
import Link from "next/link";
import { MapPin, Video } from "lucide-react";

import {
  BriefCorto,
  type UltimaSesionCorta,
} from "@/components/clinico/brief-corto";
import { Avatar, Button, Card, Chip } from "@/components/ui";
import { AnilloProgreso, Latido } from "@/components/ui/movimiento";
import { apiGet } from "@/lib/api-client";
import { hora, money } from "@/lib/format";
import {
  COBRAR,
  EN_CURSO,
  ENSEGUIDA,
  ESCRIBIENDO_NOTA,
  FIRMAR_AUTORIZACION,
  GRABAR_SESION,
  NOTA_GUARDADA,
  REVISAR_NOTA,
  VER_FICHA,
} from "@/lib/glosario";
import type { EstadoProcesamiento, TurnoConPaciente } from "@/types/domain";

/** Lo único que esta card necesita de /api/sesion-clinica. */
type SesionDelTurno = { id: string; estado: EstadoProcesamiento } | null;

/** Lo único que esta card necesita de /api/pacientes/[id]/brief. */
type RespuestaBrief = { ultimaSesion: UltimaSesionCorta | null } | null;

interface Contexto {
  sesion: SesionDelTurno;
  brief: RespuestaBrief;
}

function opcional<T>(promesa: Promise<T>): Promise<T | null> {
  return promesa.catch(() => null);
}

/** Función pura de lectura: sin estado, sin efectos. La llama el efecto de
 *  abajo y el resultado entra por then(). */
async function leerContexto(
  turnoId: string,
  pacienteId: string,
  signal: AbortSignal,
): Promise<Contexto> {
  const [sesion, brief] = await Promise.all([
    opcional(apiGet<SesionDelTurno>(`/api/sesion-clinica?turnoId=${turnoId}`, { signal })),
    opcional(
      apiGet<RespuestaBrief>(`/api/pacientes/${pacienteId}/brief`, { signal }),
    ),
  ]);
  return { sesion, brief };
}

type Accion =
  | { tipo: "autorizar" }
  | { tipo: "revisar"; sesionId: string }
  | { tipo: "escribiendo" }
  | { tipo: "cobrar" }
  | { tipo: "grabar" }
  | { tipo: "hecho" };

/**
 * Un solo botón, en este orden: sin autorización firmada no se graba; una
 * nota escrita espera revisión antes que cualquier otra cosa; mientras el
 * pipeline trabaja no hay nada que apretar; después viene el cobro; y si
 * nada de eso aplica, se graba.
 */
function accionDe(
  sesion: SesionDelTurno,
  sinAutorizacion: boolean,
  sinCobrar: boolean,
): Accion {
  if (sinAutorizacion) return { tipo: "autorizar" };
  if (sesion?.estado === "revision") {
    return { tipo: "revisar", sesionId: sesion.id };
  }
  if (sesion?.estado === "subiendo" || sesion?.estado === "procesando") {
    return { tipo: "escribiendo" };
  }
  if (sinCobrar) return { tipo: "cobrar" };
  if (sesion?.estado === "aprobado") return { tipo: "hecho" };
  return { tipo: "grabar" };
}

interface CardAhoraProps {
  turno: TurnoConPaciente;
  /** La hora del turno ya empezó y todavía no terminó. */
  enCurso: boolean;
  /** El turno está en pendientes.sinAutorizacion. */
  sinAutorizacion: boolean;
  /** El turno está en pendientes.sinCobrar. */
  sinCobrar: boolean;
  /** Abre el sheet de cobrar de la pantalla de Hoy. */
  onCobrar: () => void;
  /** Cambia cuando la pantalla de Hoy vuelve a leer: releemos con ella. */
  reloadKey?: number;
}

export function CardAhora({
  turno,
  enCurso,
  sinAutorizacion,
  sinCobrar,
  onCobrar,
  reloadKey = 0,
}: CardAhoraProps) {
  const [contexto, setContexto] = React.useState<Contexto>({
    sesion: null,
    brief: null,
  });

  React.useEffect(() => {
    const controlador = new AbortController();
    let cancelado = false;

    leerContexto(turno.id, turno.paciente.id, controlador.signal)
      .then((siguiente) => {
        if (!cancelado) setContexto(siguiente);
      })
      .catch(() => {
        /* sin contexto la card igual sirve: nombre, hora y botón de grabar */
      });

    return () => {
      cancelado = true;
      controlador.abort();
    };
  }, [turno.id, turno.paciente.id, reloadKey]);

  const accion = accionDe(contexto.sesion, sinAutorizacion, sinCobrar);
  const ultima = contexto.brief?.ultimaSesion ?? null;
  const ModalityIcon = turno.modalidad === "online" ? Video : MapPin;
  const nombre = `${turno.paciente.nombre} ${turno.paciente.apellido}`;

  return (
    <Card className="rounded-[8px] border-l-2 border-l-sage-500 p-5 lg:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            nombre={turno.paciente.nombre}
            apellido={turno.paciente.apellido}
            size={44}
          />
          <div className="min-w-0">
            <h2 className="truncate font-[family-name:var(--font-display)] text-[22px] font-medium leading-tight text-ink-900 lg:text-[26px]">
              {nombre}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 font-sans text-[13px] text-ink-500">
              <ModalityIcon size={14} strokeWidth={1.8} aria-hidden="true" />
              {turno.modalidad === "online" ? "Online" : "Presencial"} ·{" "}
              {turno.duracion}′ · {money(turno.tarifaCobrada)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <time className="font-[family-name:var(--font-display)] text-[32px] font-medium leading-none tabular-nums text-ink-900 lg:text-[38px]">
            {hora(turno.fecha)}
          </time>
          {/* El punto late solo mientras la sesión está abierta: es lo
              único de la pantalla que se mueve por sí solo, y significa
              exactamente eso. */}
          <Chip variant={enCurso ? "sage" : "neutral"} size="sm">
            {enCurso ? (
              <span className="inline-flex items-center gap-1.5">
                <Latido tamano={6} className="bg-sage-600" />
                {EN_CURSO}
              </span>
            ) : (
              ENSEGUIDA
            )}
          </Chip>
        </div>
      </div>

      <BriefCorto className="mt-4" ultimaSesion={ultima} />

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {accion.tipo === "escribiendo" ? (
          <p className="flex items-center gap-2 font-sans text-[14px] font-semibold text-gold-500">
            <AnilloProgreso tamano={16} etiqueta={ESCRIBIENDO_NOTA} />
            {ESCRIBIENDO_NOTA}
          </p>
        ) : null}
        {accion.tipo === "hecho" ? (
          <Chip variant="sage">{NOTA_GUARDADA}</Chip>
        ) : null}
        {accion.tipo === "autorizar" ? (
          <Button asChild>
            <Link href={`/pacientes/${turno.paciente.id}`}>
              {FIRMAR_AUTORIZACION}
            </Link>
          </Button>
        ) : null}
        {accion.tipo === "revisar" ? (
          <Button asChild>
            <Link href={`/sesiones/${accion.sesionId}`}>{REVISAR_NOTA}</Link>
          </Button>
        ) : null}
        {accion.tipo === "cobrar" ? (
          <Button onClick={onCobrar}>{COBRAR}</Button>
        ) : null}
        {accion.tipo === "grabar" ? (
          <Button asChild>
            <Link href={`/grabar/${turno.id}`}>{GRABAR_SESION}</Link>
          </Button>
        ) : null}

        <Link
          href={`/pacientes/${turno.paciente.id}`}
          className="font-sans text-[13px] font-semibold text-sage-600 hover:text-sage-700"
        >
          {VER_FICHA} →
        </Link>
      </div>
    </Card>
  );
}
