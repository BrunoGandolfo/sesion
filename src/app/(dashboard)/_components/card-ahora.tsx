"use client";

// AHORA: la sesión en curso, o la próxima del día si no hay ninguna abierta.
//
// Es la única tarjeta de la pantalla de Hoy y va ARRIBA de todo: en el
// teléfono, entre pacientes, lo primero que se necesita es quién viene ahora.
// Grabar y Cobrar son independientes: si la sesión empezó cinco minutos
// tarde y la hora ya pasó, se sigue pudiendo grabar, y el cobro se ofrece
// además, no en lugar de. Grabar se ofrece mientras el turno sea de hoy y no
// haya una grabación de él (sin sesión, o con la sesión todavía en
// "grabando"). Sin la firma de la autorización no se graba: en su lugar va
// "Firmar autorización". Cuando la nota falló, espera revisión o se está
// escribiendo, esa es la única acción: es un problema clínico, no una deuda.
// Aparte, siempre, "Preparar sesión". La misma regla la aplica la fila de la
// agenda (components/ui/session-row.tsx).
//
// El brief va en versión corta —última vez y foco— porque acá se lee de
// pie, con la paciente entrando: el mismo componente que usa el sheet del
// turno (components/clinico/brief-corto.tsx). La versión completa
// (brief-pre-sesion.tsx) sigue viviendo en la ficha.

import * as React from "react";
import Link from "next/link";
import { MapPin, Video } from "lucide-react";

import {
  BriefCorto,
  type UltimaSesionCorta,
} from "@/components/clinico/brief-corto";
import { Avatar, Button, Card, Chip } from "@/components/ui";
import { Latido } from "@/components/ui/movimiento";
import { IndicadorProcesando } from "@/components/ui/procesando";
import { estadoClinicoDe, puedeGrabarseHoy } from "@/components/ui/session-row";
import { esGrabacionSinTerminar } from "@/lib/sesion-clinica/estados";
import { apiGet } from "@/lib/api-client";
import { hora, money } from "@/lib/format";
import {
  COBRAR,
  EN_CURSO,
  ENSEGUIDA,
  FALTA_AUTORIZACION,
  FIRMAR_AUTORIZACION,
  GRABAR_SESION,
  NOTA_LISTA,
  PARA_REVISAR,
  PREPARAR_SESION,
  VER_FICHA,
} from "@/lib/glosario";
import type { EstadoProcesamiento, TurnoConPaciente } from "@/types/domain";

/** Lo único que esta card necesita de /api/sesion-clinica. */
type SesionDelTurno = {
  id: string;
  estado: EstadoProcesamiento | string;
  actualizadaEn?: Date | string;
} | null;

/** Lo único que esta card necesita de /api/pacientes/[id]/brief. */
type RespuestaBrief = {
  ultimaSesion: UltimaSesionCorta | null;
  notaPendiente?: boolean;
  propuestaPendiente?: boolean;
} | null;

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
  | { tipo: "fallida"; sesionId: string }
  | { tipo: "revisar"; sesionId: string }
  | { tipo: "escribiendo" }
  | {
      tipo: "turno";
      /** Grabar, o "Firmar autorización" si falta la firma. */
      grabar: "grabar" | "autorizar" | null;
      cobrar: boolean;
      /** Falta la firma y no hay nada que grabar: si se cobra, se avisa al
       *  lado; si no, es el botón. */
      firma: "aviso" | "boton" | null;
      /** No queda nada por hacer y la nota está aprobada. */
      hecho: boolean;
    };

/**
 * Qué ofrece la tarjeta. Una nota que FALLÓ va antes que todo (es un
 * problema clínico, no una deuda); una nota escrita espera revisión; y
 * mientras el pipeline trabaja no hay nada que apretar. Fuera de eso, Grabar
 * y Cobrar no se excluyen: Grabar mientras el turno sea de hoy y no se haya
 * grabado —la hora no cuenta: una sesión que empezó tarde se graba igual—,
 * y Cobrar cuando hay algo que cobrar. Exportada para probarse sin montar
 * la card.
 */
export function accionDe(
  sesion: SesionDelTurno,
  turno: Pick<TurnoConPaciente, "estado" | "fecha">,
  ahora: Date,
  sinAutorizacion: boolean,
  sinCobrar: boolean,
): Accion {
  if (sesion?.estado === "fallida") return { tipo: "fallida", sesionId: sesion.id };
  if (sesion?.estado === "revision") {
    return { tipo: "revisar", sesionId: sesion.id };
  }
  // Una subida quieta más de 30 min no se está escribiendo: quedó a medias,
  // y se retoma como una grabación (la pantalla de grabar ofrece la copia
  // guardada en el teléfono).
  const sinTerminar = esGrabacionSinTerminar(sesion, ahora);
  if (
    (sesion?.estado === "subiendo" && !sinTerminar) ||
    sesion?.estado === "procesando"
  ) {
    return { tipo: "escribiendo" };
  }
  const sinGrabar = sesion === null || sesion.estado === "grabando" || sinTerminar;
  const grabable = sinGrabar && puedeGrabarseHoy(turno, ahora);
  const grabar = grabable ? (sinAutorizacion ? "autorizar" : "grabar") : null;
  const firma =
    sinAutorizacion && !grabable ? (sinCobrar ? "aviso" : "boton") : null;
  return {
    tipo: "turno",
    grabar,
    cobrar: sinCobrar,
    firma,
    hecho:
      sesion?.estado === "aprobada" && !grabar && !sinCobrar && firma === null,
  };
}

interface CardAhoraProps {
  turno: TurnoConPaciente;
  /** El reloj de la pantalla: decide si el turno es de hoy. */
  ahora: Date;
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
  ahora,
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

  // Mientras /api/sesion-clinica no contestó —o si falló— vale la sesión
  // que ya trajo el día: sin ella, una sesión aprobada o procesándose
  // ofrecía "Grabar sesión" hasta que llegara la respuesta, o para siempre.
  const sesion: SesionDelTurno = contexto.sesion ?? turno.sesionClinica;
  const accion = accionDe(sesion, turno, ahora, sinAutorizacion, sinCobrar);
  const notaClinica = estadoClinicoDe(sesion);
  const ultima = contexto.brief?.ultimaSesion ?? null;
  const preparar = `/pacientes/${turno.paciente.id}?preparar=1`;
  const ModalityIcon = turno.modalidad === "online" ? Video : MapPin;
  const nombre = `${turno.paciente.nombre} ${turno.paciente.apellido}`;

  return (
    <Card className="rounded-[8px] border-l-2 border-l-sage-500 p-5 lg:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            nombre={turno.paciente.nombre}
            apellido={turno.paciente.apellido}
            size={44}
          />
          <div className="min-w-0">
            <h2 className="break-words font-[family-name:var(--font-display)] text-[22px] font-medium leading-tight text-ink-900 lg:text-[26px]">
              {nombre}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 font-sans tabular-nums text-[13px] text-ink-500">
              <ModalityIcon size={14} strokeWidth={1.8} aria-hidden="true" />
              {turno.modalidad === "online" ? "Online" : "Presencial"} ·{" "}
              {turno.duracion}′ · {money(turno.tarifaCobrada)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-1.5 lg:flex-col lg:items-end">
          <time className="text-[32px] font-medium leading-none tabular-nums text-ink-900 lg:text-[38px]">
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

      <BriefCorto
        className="mt-4"
        ultimaSesion={ultima}
        pacienteId={turno.paciente.id}
        notaPendiente={contexto.brief?.notaPendiente ?? false}
        propuestaPendiente={contexto.brief?.propuestaPendiente ?? false}
      />

      {/* El estado clínico, aparte del cobro y con las mismas palabras que
          la fila. Cuando es el botón de acción (fallida, para revisar) no se
          repite acá. */}
      {notaClinica && accion.tipo !== "fallida" && accion.tipo !== "revisar" ? (
        <p className="mt-4">
          <Link
            href={`/sesiones/${notaClinica.sesionId}`}
            className="font-sans text-[13px] font-semibold text-sage-700 hover:text-sage-800"
          >
            {notaClinica.rotulo} →
          </Link>
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {accion.tipo === "escribiendo" ? (
          <IndicadorProcesando
            paciente={`${turno.paciente.nombre} ${turno.paciente.apellido}`.trim()}
            className="w-full"
          />
        ) : null}
        {accion.tipo === "fallida" ? (
          <Button asChild className="!bg-terracotta-600 hover:!bg-terracotta-700">
            <Link href={`/sesiones/${accion.sesionId}`}>{notaClinica?.rotulo}</Link>
          </Button>
        ) : null}
        {accion.tipo === "revisar" ? (
          <Button asChild>
            <Link href={`/sesiones/${accion.sesionId}`}>{PARA_REVISAR}</Link>
          </Button>
        ) : null}
        {accion.tipo === "turno" ? (
          <>
            {accion.hecho ? <Chip variant="sage">{NOTA_LISTA}</Chip> : null}
            {/* Grabar primero: es lo que no se puede dejar para después. Si
                además hay cobro, va al lado y en segundo plano. */}
            {accion.grabar === "grabar" ? (
              <Button asChild>
                <Link href={`/grabar/${turno.id}`}>{GRABAR_SESION}</Link>
              </Button>
            ) : null}
            {accion.grabar === "autorizar" || accion.firma === "boton" ? (
              <Button asChild>
                <Link href={`/pacientes/${turno.paciente.id}`}>
                  {FIRMAR_AUTORIZACION}
                </Link>
              </Button>
            ) : null}
            {accion.cobrar ? (
              <Button
                variant={accion.grabar ? "secondary" : "primary"}
                onClick={onCobrar}
              >
                {COBRAR}
              </Button>
            ) : null}
            {accion.firma === "aviso" ? (
              <Link
                href={`/pacientes/${turno.paciente.id}`}
                className="font-sans text-[13px] font-semibold text-terracotta-600 hover:text-terracotta-700"
              >
                {FALTA_AUTORIZACION} →
              </Link>
            ) : null}
          </>
        ) : null}

        <Button asChild variant="secondary">
          <Link href={preparar}>{PREPARAR_SESION}</Link>
        </Button>

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
