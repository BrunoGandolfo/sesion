"use client";

// Tu consultorio: lo que la app necesita saber de ella y de cómo trabaja.
//
// Cinco secciones, en el orden en que las piensa: quién es (Vos), cuánto
// cobra, con qué enfoque trabaja, qué recordatorio reciben los pacientes y
// la cuenta. Todo se guarda solo, con un aviso discreto.
//
// El enfoque teórico es una decisión clínica y se dice completa: cada
// orientación nombra el instrumento con el que se evalúa su práctica.

import * as React from "react";
import { LogOut } from "lucide-react";
import { getSession, signOut } from "next-auth/react";

import { Button, Card, EditorialRule, Input } from "@/components/ui";
import { ApiClientError, apiGet, apiPatch, esAbort } from "@/lib/api-client";
import { ALGO_FALLO, CTSR, GTFS, MITI, TU_CONSULTORIO } from "@/lib/glosario";
import { buildSmsMessage, TEMPLATE_SMS_SUGERIDO } from "@/lib/sms-texto";
import type { Configuracion, OrientacionTeorica } from "@/types/domain";

import { EditorRecordatorio, FICHAS_INSERTABLES } from "./editor-recordatorio";

// Datos de ejemplo de la vista previa: martes 21 de abril, 10:00.
const FECHA_PREVIEW = new Date(2026, 3, 21, 10, 0);

type CampoConfig =
  | "nombreProfesional"
  | "direccion"
  | "whatsappOrigen"
  | "tarifaDefault"
  | "horasAnticipacion"
  | "templateRecordatorio"
  | "orientacionTeorica";

type FormConfig = {
  nombreProfesional: string;
  direccion: string;
  whatsappOrigen: string;
  tarifaDefault: string;
  horasAnticipacion: number;
  templateRecordatorio: string;
  orientacionTeorica: OrientacionTeorica;
};

type PatchConfig = Partial<{
  nombreProfesional: string;
  direccion: string;
  whatsappOrigen: string;
  tarifaDefault: number;
  horasAnticipacion: number;
  templateRecordatorio: string;
  orientacionTeorica: OrientacionTeorica;
}>;

type EstadoGuardado = "idle" | "guardando" | "guardado" | "error";

// Sin datos inventados: los campos de "Vos" arrancan vacíos hasta que llega
// la configuración real. Lo único con valor propio es lo que también tiene
// default en la base (24 h) y el template sugerido.
const FORM_VACIO: FormConfig = {
  nombreProfesional: "",
  direccion: "",
  whatsappOrigen: "",
  tarifaDefault: "",
  horasAnticipacion: 24,
  templateRecordatorio: TEMPLATE_SMS_SUGERIDO,
  orientacionTeorica: "cbt_mi",
};

function formDesdeConfig(config: Configuracion): FormConfig {
  return {
    nombreProfesional: config.nombreProfesional,
    direccion: config.direccion,
    whatsappOrigen: config.whatsappOrigen,
    tarifaDefault: String(config.tarifaDefault),
    horasAnticipacion: config.horasAnticipacion,
    templateRecordatorio: config.templateRecordatorio,
    orientacionTeorica: config.orientacionTeorica,
  };
}

function patchDesdeCampos(
  form: FormConfig,
  campos: CampoConfig[],
): { patch: PatchConfig; campos: CampoConfig[]; invalido: boolean } {
  const patch: PatchConfig = {};
  const incluidos: CampoConfig[] = [];
  let invalido = false;

  for (const campo of campos) {
    if (campo === "tarifaDefault") {
      const valor = Number(form.tarifaDefault);
      if (
        !form.tarifaDefault.trim() ||
        !Number.isInteger(valor) ||
        valor < 0
      ) {
        invalido = true;
        continue;
      }
      patch.tarifaDefault = valor;
      incluidos.push(campo);
      continue;
    }

    if (campo === "templateRecordatorio") {
      if (!form.templateRecordatorio.trim()) {
        invalido = true;
        continue;
      }
      patch.templateRecordatorio = form.templateRecordatorio;
      incluidos.push(campo);
      continue;
    }

    if (campo === "nombreProfesional") {
      if (!form.nombreProfesional.trim()) {
        invalido = true;
        continue;
      }
      patch.nombreProfesional = form.nombreProfesional;
      incluidos.push(campo);
      continue;
    }

    if (campo === "horasAnticipacion") {
      patch.horasAnticipacion = form.horasAnticipacion;
      incluidos.push(campo);
      continue;
    }

    if (campo === "orientacionTeorica") {
      patch.orientacionTeorica = form.orientacionTeorica;
      incluidos.push(campo);
      continue;
    }

    patch[campo] = form[campo];
    incluidos.push(campo);
  }

  return { patch, campos: incluidos, invalido };
}

export function ConfigView() {
  const [form, setForm] = React.useState<FormConfig>(FORM_VACIO);
  const [cargando, setCargando] = React.useState(true);
  const [errorCarga, setErrorCarga] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [estadoGuardado, setEstadoGuardado] =
    React.useState<EstadoGuardado>("idle");
  const [emailSesion, setEmailSesion] = React.useState<string | null>(null);

  const formRef = React.useRef(form);
  const debounceRef = React.useRef<number | null>(null);
  const avisoRef = React.useRef<number | null>(null);
  const guardarPendientesRef = React.useRef<() => Promise<void>>(
    async () => {},
  );
  const camposSuciosRef = React.useRef<Set<CampoConfig>>(new Set());
  const enVueloRef = React.useRef(false);
  const volverAGuardarRef = React.useRef(false);
  const montadoRef = React.useRef(true);

  const limpiarAviso = React.useCallback(() => {
    if (avisoRef.current !== null) {
      window.clearTimeout(avisoRef.current);
      avisoRef.current = null;
    }
  }, []);

  const mostrarGuardado = React.useCallback(() => {
    limpiarAviso();
    setEstadoGuardado("guardado");
    avisoRef.current = window.setTimeout(() => {
      if (montadoRef.current) setEstadoGuardado("idle");
      avisoRef.current = null;
    }, 2000);
  }, [limpiarAviso]);

  const programarGuardado = React.useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void guardarPendientesRef.current();
    }, 1500);
  }, []);

  const guardarPendientes = React.useCallback(async () => {
    if (enVueloRef.current) {
      volverAGuardarRef.current = true;
      return;
    }

    const campos = Array.from(camposSuciosRef.current);
    if (campos.length === 0) return;

    const { patch, campos: enviados, invalido } = patchDesdeCampos(
      formRef.current,
      campos,
    );

    if (invalido) {
      setEstadoGuardado("error");
      return;
    }
    if (enviados.length === 0) return;

    for (const campo of enviados) camposSuciosRef.current.delete(campo);

    enVueloRef.current = true;
    limpiarAviso();
    setEstadoGuardado("guardando");

    let guardado = false;
    try {
      await apiPatch<Configuracion>("/api/config", patch);
      guardado = true;
    } catch {
      for (const campo of enviados) camposSuciosRef.current.add(campo);
      if (montadoRef.current) setEstadoGuardado("error");
    } finally {
      enVueloRef.current = false;
      const volver = volverAGuardarRef.current;
      volverAGuardarRef.current = false;

      if (montadoRef.current) {
        if (guardado && camposSuciosRef.current.size === 0) mostrarGuardado();
        if (camposSuciosRef.current.size > 0 && (guardado || volver)) {
          programarGuardado();
        }
      }
    }
  }, [limpiarAviso, mostrarGuardado, programarGuardado]);

  React.useEffect(() => {
    guardarPendientesRef.current = guardarPendientes;
  }, [guardarPendientes]);

  // Carga inicial. El estado "cargando" es el inicial y el reintento lo
  // vuelve a poner desde su handler; acá solo se setea cuando responde la red.
  React.useEffect(() => {
    montadoRef.current = true;
    const controller = new AbortController();

    Promise.all([
      apiGet<Configuracion>("/api/config", { signal: controller.signal }),
      getSession().catch(() => null),
    ])
      .then(([config, session]) => {
        const siguiente = formDesdeConfig(config);
        formRef.current = siguiente;
        camposSuciosRef.current.clear();
        setForm(siguiente);
        setEmailSesion(session?.user?.email ?? null);
        setEstadoGuardado("idle");
        setCargando(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setErrorCarga(
          err instanceof ApiClientError ? err.mensaje : ALGO_FALLO,
        );
        setCargando(false);
      });

    return () => {
      montadoRef.current = false;
      controller.abort();
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      if (avisoRef.current !== null) window.clearTimeout(avisoRef.current);
    };
  }, [reloadKey]);

  const reintentarCarga = () => {
    setCargando(true);
    setErrorCarga(null);
    setReloadKey((k) => k + 1);
  };

  const actualizarCampo = React.useCallback(
    <T extends CampoConfig>(campo: T, valor: FormConfig[T]) => {
      setForm((actual) => {
        const siguiente = { ...actual, [campo]: valor };
        formRef.current = siguiente;
        return siguiente;
      });
      camposSuciosRef.current.add(campo);
      limpiarAviso();
      setEstadoGuardado((estado) =>
        estado === "guardado" || estado === "error" ? "idle" : estado,
      );
      programarGuardado();
    },
    [limpiarAviso, programarGuardado],
  );

  const reintentarGuardado = React.useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void guardarPendientes();
  }, [guardarPendientes]);

  const vistaPrevia = React.useMemo(
    () =>
      buildSmsMessage(form.templateRecordatorio, {
        nombre: "Lucía",
        apellido: "Fernández",
        fecha: FECHA_PREVIEW,
        direccion: form.direccion,
        profesional: form.nombreProfesional,
        telefonoConsultorio: form.whatsappOrigen,
      }),
    [form],
  );

  if (cargando) {
    return (
      <Marco>
        <p className="py-16 text-center text-[14px] text-ink-500">Cargando…</p>
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
              Reintentar
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
              <Input
                label="Dirección del consultorio"
                autoComplete="street-address"
                placeholder="Calle y número, ciudad"
                value={form.direccion}
                onChange={(e) => actualizarCampo("direccion", e.target.value)}
              />
              {/* La columna conserva el nombre whatsappOrigen hasta la próxima migración. */}
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
              <p className="text-[12px] leading-[1.5] text-ink-500">
                Tu nombre y tu teléfono van al final de cada recordatorio,
                para que la paciente sepa a quién escribirle.
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
                className="pointer-events-none absolute left-[14px] top-1/2 z-10 -translate-y-1/2 text-[14px] font-semibold text-ink-500"
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
                    : undefined
                }
              />
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
            <SelectorEnfoque
              value={form.orientacionTeorica}
              onChange={(valor) => actualizarCampo("orientacionTeorica", valor)}
            />
            <p className="mt-3 text-[12px] leading-[1.5] text-ink-500">
              Es una decisión clínica: define con qué instrumento se lee tu
              práctica en cada sesión. Podés cambiarla cuando quieras; las
              sesiones ya analizadas conservan el instrumento con que se
              generaron.
            </p>
          </Card>
        </section>

        {/* ─── Recordatorio ────────────────────────────────────── */}
        <section>
          <TituloSeccion>Recordatorio</TituloSeccion>
          <Card>
            <div className="flex flex-col gap-6">
              <Anticipacion
                value={form.horasAnticipacion}
                onChange={(valor) => actualizarCampo("horasAnticipacion", valor)}
              />

              <div>
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Mensaje
                </span>
                <EditorRecordatorio
                  template={form.templateRecordatorio}
                  onChange={(valor) =>
                    actualizarCampo("templateRecordatorio", valor)
                  }
                  fichas={FICHAS_INSERTABLES}
                />
                {form.templateRecordatorio.trim() === "" ? (
                  <p
                    role="alert"
                    className="mt-2 text-[12px] text-[color:var(--color-error)]"
                  >
                    El recordatorio no puede quedar vacío.
                  </p>
                ) : null}
                <p className="mt-2 text-[12px] leading-[1.5] text-ink-500">
                  Tocá una ficha para agregarla donde está el cursor. La línea
                  de contacto con tu nombre y tu teléfono se agrega sola si la
                  borrás.
                </p>
              </div>

              <div>
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Así lo recibe la paciente
                </span>
                <div className="whitespace-pre-wrap rounded-[10px] border-l-[3px] border-l-sage-500 bg-cream-100 px-4 py-[14px] text-[14px] italic leading-[1.5] text-ink-900">
                  {vistaPrevia}
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* ─── Cuenta ──────────────────────────────────────────── */}
        <section className="pt-2">
          <TituloSeccion>Cuenta</TituloSeccion>
          <Card className="!p-6">
            <div className="flex flex-col gap-5">
              <div className="min-w-0">
                <p className="truncate font-display text-[20px] font-medium leading-tight text-ink-900">
                  {form.nombreProfesional || "Tu cuenta"}
                </p>
                {emailSesion ? (
                  <p className="mt-1 truncate text-[13px] text-ink-500">
                    {emailSesion}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="secondary"
                  disabled
                  title="Próximamente"
                  className="w-full sm:w-auto"
                >
                  Cambiar contraseña · próximamente
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  icon={<LogOut size={16} strokeWidth={2} aria-hidden="true" />}
                  className="w-full sm:w-auto"
                  onClick={() => {
                    void signOut({ callbackUrl: "/login" });
                  }}
                >
                  Cerrar sesión
                </Button>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </Marco>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[800px] px-5 py-6 lg:px-12 lg:py-10">
      <h1 className="mb-6 font-display text-[30px] font-medium leading-tight tracking-tight text-ink-900 lg:text-[36px]">
        {TU_CONSULTORIO}
      </h1>
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
            No se pudo guardar. Revisá los campos marcados.
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
      <EditorialRule />
      <span>{children}</span>
    </h2>
  );
}

// ─── Enfoque ────────────────────────────────────────────────────────────────
// Cada opción dice qué instrumento de feedback usa. Las siglas no se
// traducen: son instrumentos publicados y ella tiene que poder rastrearlos.

const ENFOQUES: Array<{
  value: OrientacionTeorica;
  label: string;
  instrumentos: string;
}> = [
  {
    value: "gestalt",
    label: "Gestalt",
    instrumentos: `Feedback con ${GTFS.sigla} (${GTFS.nombre})`,
  },
  {
    value: "cbt_mi",
    label: "Cognitivo-conductual",
    instrumentos: `Feedback con ${CTSR.sigla} (${CTSR.nombre}) + ${MITI.sigla} (${MITI.nombre})`,
  },
];

function SelectorEnfoque({
  value,
  onChange,
}: {
  value: OrientacionTeorica;
  onChange: (v: OrientacionTeorica) => void;
}) {
  const nombreGrupo = React.useId();

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Orientación teórica
      </legend>
      {ENFOQUES.map((opcion) => {
        const activo = opcion.value === value;
        return (
          <label
            key={opcion.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors duration-150 ${
              activo
                ? "border-sage-500 bg-sage-50"
                : "border-[color:var(--border-subtle)] bg-cream-50 hover:bg-cream-100"
            }`}
          >
            <input
              type="radio"
              name={nombreGrupo}
              value={opcion.value}
              checked={activo}
              onChange={() => onChange(opcion.value)}
              className="mt-[3px] h-4 w-4 accent-[var(--color-sage-500)]"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-ink-900">
                {opcion.label}
              </span>
              <span className="text-[12px] leading-[1.5] text-ink-500">
                {opcion.instrumentos}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

// ─── Anticipación ───────────────────────────────────────────────────────────
// Tres momentos dichos como los diría ella. Se guardan como horas antes del
// turno, que es lo único que el envío sabe calcular hoy.

const ANTICIPACIONES: Array<{
  label: string;
  detalle: string;
  horas: number | null;
}> = [
  { label: "El día anterior", detalle: "24 horas antes", horas: 24 },
  { label: "Dos días antes", detalle: "48 horas antes", horas: 48 },
  {
    label: "La misma mañana",
    detalle: "A las 8:00 del día del turno · próximamente",
    horas: null,
  },
];

function Anticipacion({
  value,
  onChange,
}: {
  value: number;
  onChange: (horas: number) => void;
}) {
  const nombreGrupo = React.useId();
  const coincideAlguna = ANTICIPACIONES.some((a) => a.horas === value);

  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        Cuándo se envía
      </legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        {ANTICIPACIONES.map((opcion) => {
          const disponible = opcion.horas !== null;
          const activo = disponible && opcion.horas === value;
          return (
            <label
              key={opcion.label}
              className={`flex flex-1 items-start gap-3 rounded-md border px-4 py-3 transition-colors duration-150 ${
                activo
                  ? "border-sage-500 bg-sage-50"
                  : "border-[color:var(--border-subtle)] bg-cream-50"
              } ${
                disponible
                  ? "cursor-pointer hover:bg-cream-100"
                  : "cursor-not-allowed opacity-60"
              }`}
            >
              <input
                type="radio"
                name={nombreGrupo}
                checked={activo}
                disabled={!disponible}
                onChange={() => {
                  if (opcion.horas !== null) onChange(opcion.horas);
                }}
                className="mt-[3px] h-4 w-4 accent-[var(--color-sage-500)]"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] font-semibold text-ink-900">
                  {opcion.label}
                </span>
                <span className="text-[12px] leading-[1.4] text-ink-500">
                  {opcion.detalle}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {!coincideAlguna ? (
        <p className="mt-2 text-[12px] text-ink-500">
          Hoy está configurado {value} {value === 1 ? "hora" : "horas"} antes
          del turno. Elegí una opción para cambiarlo.
        </p>
      ) : null}
    </fieldset>
  );
}
