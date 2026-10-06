"use client";

// Tu consultorio: lo que la app necesita saber de ella y de cómo trabaja.
//
// Seis secciones, en el orden en que las piensa: quién es (Vos), cuánto
// cobra, con qué enfoque trabaja, qué palabras tiene que escuchar bien la
// transcripción (Vocabulario, que vive en vocabulario-seccion.tsx), qué
// recordatorio reciben los pacientes y la cuenta. Todo se guarda solo, con un
// aviso discreto.
//
// El enfoque teórico es una decisión clínica y se dice completa: cada
// orientación nombra el instrumento con el que se evalúa su práctica.

import * as React from "react";

import { AccesoConsultorio } from "@/components/layout/cabecera-usuario";
import { GuardadoCampo } from "@/components/ui/guardado-campo";
import { Button, Card, Input } from "@/components/ui";
import { CARGANDO, REINTENTAR, TU_CONSULTORIO } from "@/lib/glosario";

import { CuentaSeccion } from "./cuenta-seccion";
import type { EstadoGuardado } from "./datos";
import { InvitarColega } from "./invitar-colega";
import { MensajeRecordatorio } from "./mensaje-recordatorio";
import { CuandoAvisar, SelectorEnfoque } from "./opciones-radio";
import { TituloSeccion } from "./titulo-seccion";
import { useAutoguardado } from "./useAutoguardado";
import { VocabularioSeccion } from "./vocabulario-seccion";

/** Lo que espera el autoguardado después de la última tecla. */
const ESPERA_AUTOGUARDADO_MS = 1500;

export function ConfigView() {
  const {
    form,
    cargando,
    errorCarga,
    estadoGuardado,
    reintentarCarga,
    actualizarCampo,
    reintentarGuardado,
    estadoDelCampo,
  } = useAutoguardado(ESPERA_AUTOGUARDADO_MS);

  if (cargando) {
    return (
      <Marco>
        <p className="py-16 text-center text-[14px] text-ink-500">{CARGANDO}</p>
      </Marco>
    );
  }

  if (errorCarga) {
    return (
      <Marco>
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-ink-700">{errorCarga}</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={reintentarCarga}
            >
              {REINTENTAR}
            </Button>
          </div>
        </Card>
      </Marco>
    );
  }

  return (
    <Marco>
      <IndicadorGuardado estado={estadoGuardado} onRetry={reintentarGuardado} />

      <div className="flex flex-col gap-9">
        {/* ─── Vos ─────────────────────────────────────────────── */}
        <section>
          <TituloSeccion>Vos</TituloSeccion>
          <Card>
            <div className="flex flex-col gap-4">
              <div>
                <Input
                  label="Nombre"
                  autoComplete="name"
                  placeholder="Como querés que te nombren los pacientes"
                  value={form.nombreProfesional}
                  error={
                    form.nombreProfesional.trim() === ""
                      ? "Falta tu nombre"
                      : undefined
                  }
                  onChange={(e) =>
                    actualizarCampo("nombreProfesional", e.target.value)
                  }
                />
                <GuardadoCampo estado={estadoDelCampo("nombreProfesional")} />
              </div>
              <div>
                <Input
                  label="Dirección del consultorio"
                  autoComplete="street-address"
                  placeholder="Calle y número, ciudad"
                  value={form.direccion}
                  onChange={(e) => actualizarCampo("direccion", e.target.value)}
                />
                <GuardadoCampo estado={estadoDelCampo("direccion")} />
              </div>
              {/* La columna conserva el nombre whatsappOrigen hasta la próxima migración. */}
              <div>
                <Input
                  label="Teléfono"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+598 99 123 456"
                  value={form.whatsappOrigen}
                  onChange={(e) =>
                    actualizarCampo("whatsappOrigen", e.target.value)
                  }
                />
                <GuardadoCampo estado={estadoDelCampo("whatsappOrigen")} />
              </div>
              <p className="text-[12px] leading-[1.5] text-ink-500">
                Tu nombre y «Consultorio» van al principio de cada recordatorio.
                Para cambios, el mensaje indica que te llamen al teléfono configurado.
              </p>
            </div>
          </Card>
        </section>

        {/* ─── Lo que cobrás ───────────────────────────────────── */}
        <section>
          <TituloSeccion>Lo que cobrás por sesión</TituloSeccion>
          <Card>
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[14px] top-[22px] z-10 -translate-y-1/2 text-[14px] font-semibold text-ink-500"
              >
                $UYU
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={form.tarifaDefault}
                onChange={(e) => actualizarCampo("tarifaDefault", e.target.value)}
                aria-label="Lo que cobrás por sesión"
                className="pl-[56px] tabular-nums"
                error={
                  form.tarifaDefault.trim() === ""
                    ? "Falta la tarifa"
                    : !Number.isInteger(Number(form.tarifaDefault)) || Number(form.tarifaDefault) < 0
                      ? "Usá un importe entero, de cero en adelante."
                      : undefined
                }
              />
              <GuardadoCampo estado={estadoDelCampo("tarifaDefault")} />

            </div>
            <p className="mt-2 text-[12px] leading-[1.5] text-ink-500">
              Es la tarifa que se propone al crear un paciente. Cada paciente
              puede tener la suya.
            </p>
          </Card>
        </section>

        {/* ─── Tu enfoque ──────────────────────────────────────── */}
        <section>
          <TituloSeccion>Tu enfoque</TituloSeccion>
          <Card>
            <div>
              <SelectorEnfoque
                value={form.orientacionTeorica}
                onChange={(valor) => actualizarCampo("orientacionTeorica", valor)}
              />
              <GuardadoCampo estado={estadoDelCampo("orientacionTeorica")} />
            </div>
            <p className="mt-3 text-[12px] leading-[1.5] text-ink-500">
              Es una decisión clínica: define con qué instrumento se lee tu
              práctica en cada sesión. Podés cambiarla cuando quieras; las
              sesiones ya analizadas conservan el instrumento con que se
              generaron.
            </p>
          </Card>
        </section>

        <VocabularioSeccion />

        {/* ─── Recordatorio ────────────────────────────────────── */}
        <section>
          <TituloSeccion>Recordatorio</TituloSeccion>
          <Card>
            <div className="flex flex-col gap-6">
              <div>
                <CuandoAvisar
                  value={form.recordatorioModo}
                  onChange={(valor) => actualizarCampo("recordatorioModo", valor)}
                />
                <GuardadoCampo estado={estadoDelCampo("recordatorioModo")} />
              </div>

              <div>
                <MensajeRecordatorio
                    template={form.templateRecordatorio}
                    profesional={form.nombreProfesional}
                    direccion={form.direccion}
                    telefono={form.whatsappOrigen}
                    onChange={(valor) =>
                      actualizarCampo("templateRecordatorio", valor)
                    }
                />
                <GuardadoCampo estado={estadoDelCampo("templateRecordatorio")} />
              </div>
            </div>
          </Card>
        </section>

        <InvitarColega />

        <CuentaSeccion nombreProfesional={form.nombreProfesional} />
      </div>
    </Marco>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[800px] px-5 py-6 lg:px-12 lg:py-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-[30px] font-medium leading-tight tracking-tight text-ink-900 lg:text-[36px]">
          {TU_CONSULTORIO}
        </h1>
        <AccesoConsultorio activo />
      </div>
      {children}
    </div>
  );
}

function IndicadorGuardado({
  estado,
  onRetry,
}: {
  estado: EstadoGuardado;
  onRetry: () => void;
}) {
  if (estado === "idle") return null;

  return (
    <div
      aria-live="polite"
      className="mb-5 flex min-h-8 items-center justify-end"
    >
      {estado === "guardando" ? (
        <span className="text-[12px] font-semibold text-ink-500">
          Guardando…
        </span>
      ) : null}
      {estado === "guardado" ? (
        <span className="text-[12px] font-semibold text-sage-600">
          Guardado.
        </span>
      ) : null}
      {estado === "error" ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-[color:var(--color-error)]">
            Hay cambios sin guardar. Revisá los datos y reintentá.
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {REINTENTAR}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
