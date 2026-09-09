"use client";

import * as React from "react";

import { RiesgoDetectadoBanner } from "@/components/grabacion/RiesgoDetectadoBanner";
import type {
  NotaSoap,
  SesionClinicaResponse,
} from "@/lib/sesion-clinica/schema";

import { CabeceraSesion } from "./cabecera-sesion";
import { MasDeEstaSesion } from "./mas-de-esta-sesion";
import { Plegable } from "./plegable";
import { SeccionSoap } from "./seccion-soap";
import {
  ESTADO_EMOCIONAL_OBSERVADO,
  NOTA_CLINICA,
  RESUMEN,
  SECCIONES_SOAP,
  VER_BORRADOR_ORIGINAL,
} from "./textos";

// La nota, en el orden en que se lee.
//
// Cabecera → UN bloque de riesgo → Resumen → S, O, A, P → "Más de esta
// sesión" → "Ver el borrador original".
//
// "Para vos" YA NO ESTÁ ACÁ. Era el plegable del final —cerrado, a seis
// pantallas de scroll— y ahora es la vista hermana /sesiones/[id]/para-vos,
// a un toque del selector de arriba. La nota no cambió de contenido: perdió
// ese bloque y nada más.
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
  /** El selector de vista, que el contenedor arma porque conoce el id. Va
   *  entre la cabecera y el bloque de riesgo. */
  selector?: React.ReactNode;
  /** Aviso de después de aprobar. Va arriba de todo lo que se lee, porque
   *  es lo que acaba de pasar. */
  aviso?: React.ReactNode;
}

export function NotaSesionView({
  sesion,
  nota,
  editable,
  onEditarSeccion,
  revisadas,
  onRevisar,
  selector,
  aviso,
}: NotaSesionViewProps) {
  const datos = sesion.datosEstructurados;

  const original = sesion.notaSoapOriginal;
  const hayOriginal =
    original !== null &&
    SECCIONES_SOAP.some(({ clave }) => (original[clave] ?? "").trim() !== "");

  return (
    <div className="flex flex-col gap-6">
      <CabeceraSesion sesion={sesion} rotulo={NOTA_CLINICA} />

      {selector}
      {aviso}

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
