"use client";

import * as React from "react";

import { Chip } from "@/components/ui";
import { FeedbackTerapeutaView } from "@/components/grabacion/FeedbackTerapeutaView";
import { RiesgoDetectadoBanner } from "@/components/grabacion/RiesgoDetectadoBanner";
import { fechaLarga } from "@/lib/format";
import type {
  NotaSoap,
  SesionClinicaResponse,
} from "@/lib/sesion-clinica/schema";
import type {
  FeedbackTerapeuta,
  FeedbackTerapeutaLegacy,
} from "@/types/domain";

import { MasDeEstaSesion } from "./mas-de-esta-sesion";
import { Plegable } from "./plegable";
import { SeccionSoap } from "./seccion-soap";
import {
  CHIP_APROBADA,
  CHIP_BORRADOR,
  ESTADO_EMOCIONAL_OBSERVADO,
  NOTA_CLINICA,
  RESUMEN,
  SECCIONES_SOAP,
  VER_BORRADOR_ORIGINAL,
} from "./textos";

// La nota, en el orden en que se lee.
//
// Cabecera → UN bloque de riesgo → Resumen → S, O, A, P → "Más de esta
// sesión" → "Para vos" → "Ver el borrador original".
//
// Lo que se ve es lo que devolvió la API: acá no se resume, no se recorta y
// no se infiere nada. Un campo ausente es un bloque que no se dibuja.

interface NotaSesionViewProps {
  sesion: SesionClinicaResponse;
  /** Nota en edición (estado local de la pantalla). En la nota aprobada es
   *  la nota persistida, sin editar. */
  nota: NotaSoap;
  editable: boolean;
  onEditarSeccion?: (clave: keyof NotaSoap, valor: string) => void;
  revisadas?: ReadonlySet<string>;
  onRevisar?: (clave: string, marcada: boolean) => void;
}

/** El contrato transporta feedbackTerapeuta como `unknown` (su forma se
 *  valida al leer, con normalizarFeedback). Antes de pasárselo a la vista se
 *  chequea lo mínimo que esa vista lee sin preguntar: el núcleo panteórico. */
function esFeedbackRenderizable(
  valor: unknown,
): valor is FeedbackTerapeuta | FeedbackTerapeutaLegacy {
  if (typeof valor !== "object" || valor === null) return false;
  const objeto = valor as Record<string, unknown>;
  return (
    Array.isArray(objeto.fortalezas) && Array.isArray(objeto.areasCrecimiento)
  );
}

export function NotaSesionView({
  sesion,
  nota,
  editable,
  onEditarSeccion,
  revisadas,
  onRevisar,
}: NotaSesionViewProps) {
  const datos = sesion.datosEstructurados;
  const paciente = sesion.turno?.paciente;
  const nombrePaciente = paciente
    ? `${paciente.nombre} ${paciente.apellido}`
    : NOTA_CLINICA;
  const fecha = sesion.turno ? fechaLarga(new Date(sesion.turno.fecha)) : null;
  const aprobada = sesion.estado === "aprobado";

  const original = sesion.notaSoapOriginal;
  const hayOriginal =
    original !== null &&
    SECCIONES_SOAP.some(({ clave }) => (original[clave] ?? "").trim() !== "");

  const feedback = datos?.feedbackTerapeuta;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          {NOTA_CLINICA}
        </p>
        <h1 className="font-display text-[24px] font-medium tracking-[-0.01em] text-ink-900 md:text-[30px]">
          {nombrePaciente}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {fecha ? (
            <span className="font-sans text-[14px] text-ink-500">{fecha}</span>
          ) : null}
          <Chip variant={aprobada ? "sage" : "gold"}>
            {aprobada ? CHIP_APROBADA : CHIP_BORRADOR}
          </Chip>
        </div>
      </header>

      <RiesgoDetectadoBanner
        riesgoDetectado={datos?.riesgoDetectado}
        flagsRiesgo={datos?.flagsRiesgo ?? null}
        revisadas={revisadas}
        onRevisar={onRevisar}
        editable={editable}
      />

      {datos?.resumenSesion ? (
        <section className="rounded-lg bg-cream-100 px-4 py-4">
          <h2 className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {RESUMEN}
          </h2>
          <p className="mt-2 font-sans text-[15px] leading-[1.7] text-ink-900">
            {datos.resumenSesion}
          </p>
        </section>
      ) : null}

      {datos?.estadoEmocionalObservado ? (
        <section className="rounded-lg bg-cream-100 px-4 py-4">
          <h2 className="font-sans text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
            {ESTADO_EMOCIONAL_OBSERVADO}
          </h2>
          <p className="mt-2 font-sans text-[15px] leading-[1.7] text-ink-900">
            {datos.estadoEmocionalObservado}
          </p>
        </section>
      ) : null}

      <div className="flex flex-col gap-6">
        {SECCIONES_SOAP.map(({ clave, titulo, ayuda }) => (
          <SeccionSoap
            key={clave}
            titulo={titulo}
            ayuda={ayuda}
            valor={nota[clave]}
            editable={editable}
            onGuardar={
              onEditarSeccion
                ? (valor) => onEditarSeccion(clave, valor)
                : undefined
            }
          />
        ))}
      </div>

      <MasDeEstaSesion datos={datos} />

      {esFeedbackRenderizable(feedback) ? (
        <FeedbackTerapeutaView feedbackTerapeuta={feedback} />
      ) : null}

      {hayOriginal && original ? (
        <Plegable titulo={VER_BORRADOR_ORIGINAL}>
          {SECCIONES_SOAP.map(({ clave, titulo, ayuda }) => (
            <div key={clave} className="flex flex-col gap-1">
              <span className="font-display text-[15px] font-medium text-ink-900">
                {titulo}
              </span>
              <span className="font-sans text-[13px] text-ink-500">
                {ayuda}
              </span>
              <p className="mt-1 whitespace-pre-wrap font-sans text-[14px] leading-[1.65] text-ink-700">
                {original[clave]?.trim() ? original[clave] : "—"}
              </p>
            </div>
          ))}
        </Plegable>
      ) : null}
    </div>
  );
}
