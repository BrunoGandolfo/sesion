"use client";

// Cobros: lo que entró este mes y lo que todavía te deben, en una sola
// pantalla. Reúne lo que antes vivía en /finanzas (KPIs + cobros del mes) y
// en /deudores (la lista con "Recordar cobro").
//
// No se calcula "trabajaste N horas gratis": la deuda se cuenta en sesiones,
// que es como ella la piensa.
//
// El recordatorio de cobro sale por SMS desde acá, y lo aprieta ella: antes
// abría el teléfono con el texto cargado y la app no se enteraba de nada
// —ni si el mensaje había salido, ni cuándo—, así que no había forma de
// saber si ya le había avisado a alguien. Ahora se manda desde el servidor
// (POST /api/pacientes/[id]/recordar-cobro), queda en la auditoría y la fila
// muestra "Avisado hace N días". Nunca es automático: el mensaje se ve
// entero, con el número al que sale, antes de confirmar.

import * as React from "react";
import type { VarianteToast } from "@/components/ui/toast";
import Link from "next/link";
import { ChevronRight, Send, Wallet } from "lucide-react";

import {
  Avatar,
  Button,
  Card,
  Confirmar,
  EditorialRule,
  Lupita,
  Segmented,
  Toast,
} from "@/components/ui";
import { EsqueletoCobrosCuerpo } from "@/components/esqueletos";
import { TAMANOS_LUPITA } from "@/components/ui/lupita";
import { CabeceraUsuario } from "@/components/layout/cabecera-usuario";
import { ListaEnCascada } from "@/components/ui/movimiento";
import { ApiClientError, apiGet, apiPost, esAbort } from "@/lib/api-client";
import {
  TEMPLATE_COBRO_DEFAULT,
  interpolarTemplateCobro,
  textoAtraso,
  zonaDeuda,
  type ZonaDeuda,
} from "@/lib/deudas";
import { diasEnterosMvd } from "@/lib/fechas-montevideo";
import { fechaCorta, fechaLarga, money, moneyShort } from "@/lib/format";
import {
  ALGO_FALLO,
  AVISADO,
  COBRASTE_ESTE_MES,
  COBROS_DEL_MES,
  COBROS_NO_CARGARON,
  ENVIANDO_SMS,
  ENVIAR_SMS,
  METODO_PAGO_LABEL,
  NADIE_TE_DEBE,
  NADIE_TE_DEBE_LINEAS,
  NAV,
  RECORDAR_COBRO,
  RECORDAR_COBRO_TITULO,
  REINTENTAR,
  SIN_COBRAR,
  SIN_COBRAR_FRASE_FINAL,
  SIN_COBROS_ESTE_MES,
  SIN_COBROS_ESTE_MES_LINEAS,
  SIN_METODO,
  SMS_DESTINO,
  SMS_ENVIADO,
  SMS_SIN_CONFIGURAR,
  TE_DEBEN,
  VER_COBROS_DEL_MES,
  VER_TE_DEBEN,
  VISTA_DE_COBROS,
  pluralizar,
} from "@/lib/glosario";
import type {
  Configuracion,
  DeudaPaciente,
  KPIsDashboard,
  TurnoConPaciente,
} from "@/types/domain";

// ============================================
// Tipos de fetch — JSON → Date donde la UI lo necesita
// ============================================

type DeudorItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
  /** ISO del último aviso que salió; null si nunca se le avisó. */
  ultimoAvisoEn: string | null;
};

/** Lo que contesta GET /api/sms/estado. */
type SmsEstado = { ok: true } | { ok: false; motivo: string };

type JsonTurno = Omit<
  TurnoConPaciente,
  "fecha" | "pagoFecha" | "creadoEn" | "actualizadoEn"
> & {
  fecha: string;
  pagoFecha: string | null;
  creadoEn: string;
  actualizadoEn: string;
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

type Pestana = "te-deben" | "cobros";
type Carga = "cargando" | "listo" | "error";

type DatosCobros = {
  kpis: KPIsDashboard;
  deudores: DeudorItem[];
  cobros: TurnoConPaciente[];
  nombreProfesional: string;
  /** false solo si el servidor dijo que falta configurar el SMS. */
  smsOk: boolean;
};

async function cargarCobros(signal: AbortSignal): Promise<DatosCobros> {
  const [dashboard, deudores, cobros, config, sms] = await Promise.all([
    apiGet<{ kpis: KPIsDashboard }>("/api/dashboard", { signal }),
    apiGet<DeudorItem[]>("/api/deudores", { signal }),
    apiGet<JsonTurno[]>("/api/turnos/cobros", { signal }),
    // La configuración puede no existir todavía: el recordatorio sale sin
    // firma y la pantalla igual se muestra.
    apiGet<Configuracion>("/api/config", { signal }).catch((err: unknown) => {
      if (esAbort(err)) throw err;
      return null;
    }),
    // Si esta consulta falla no se puede saber si el canal está bien, y
    // esconder el botón por las dudas sería apagar algo que quizá funciona:
    // se ofrece igual y, si el SMS no está configurado, el servidor lo dice
    // con todas las letras al confirmar.
    apiGet<SmsEstado>("/api/sms/estado", { signal }).catch((err: unknown) => {
      if (esAbort(err)) throw err;
      return { ok: true } as SmsEstado;
    }),
  ]);

  return {
    kpis: dashboard.kpis,
    deudores,
    cobros: cobros.map(parseTurno),
    nombreProfesional: config?.nombreProfesional ?? "",
    smsOk: sms.ok,
  };
}

// ============================================
export function CobrosView() {
  const [pestana, setPestana] = React.useState<Pestana>("te-deben");
  const [datos, setDatos] = React.useState<DatosCobros | null>(null);
  const [ahora, setAhora] = React.useState<Date | null>(null);
  const [carga, setCarga] = React.useState<Carga>("cargando");
  const [reloadKey, setReloadKey] = React.useState(0);
  const [toast, setToast] = React.useState<{ open: boolean; message: string; variante: VarianteToast }>({ open: false, message: "", variante: "aviso" });

  // El aviso que acaba de salir se pega en la fila sin recargar la pantalla:
  // la lista ya está en pantalla y lo único que cambió es esa fecha.
  const marcarAvisado = React.useCallback(
    (pacienteId: string, enviadoEn: string) => {
      setDatos((previo) =>
        previo
          ? {
              ...previo,
              deudores: previo.deudores.map((d) =>
                d.pacienteId === pacienteId
                  ? { ...d, ultimoAvisoEn: enviadoEn }
                  : d,
              ),
            }
          : previo,
      );
    },
    [],
  );

  // "cargando" es el estado inicial y el reintento lo vuelve a poner en su
  // propio handler: el efecto no toca estado antes de que responda la red.
  React.useEffect(() => {
    const controller = new AbortController();

    cargarCobros(controller.signal)
      .then((resultado) => {
        setDatos(resultado);
        setAhora(new Date());
        setCarga("listo");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setCarga("error");
      });

    return () => controller.abort();
  }, [reloadKey]);

  const reintentar = () => {
    setCarga("cargando");
    setReloadKey((k) => k + 1);
  };

  if (carga === "cargando" && !datos) {
    return (
      // La segunda espera: la ruta ya llegó y falta /api/cobros. El cuerpo
      // es el mismo que dibujó el loading.tsx de esta carpeta, y el Marco
      // acá ya es el de verdad.
      <Marco ahora={null} nombreProfesional={null}>
        <EsqueletoCobrosCuerpo />
      </Marco>
    );
  }

  if (carga === "error" && !datos) {
    return (
      <Marco ahora={null} nombreProfesional={null}>
        <EstadoVacio
          icono={<Wallet size={28} strokeWidth={1.6} aria-hidden="true" />}
          titulo={ALGO_FALLO}
          lineas={COBROS_NO_CARGARON}
          accion={{ label: REINTENTAR, onClick: reintentar }}
        />
      </Marco>
    );
  }

  if (!datos || !ahora) return null;

  const { kpis, deudores, cobros, nombreProfesional, smsOk } = datos;

  const sesionesSinCobrar = deudores.reduce(
    (sum, d) => sum + d.sesionesImpagas,
    0,
  );
  // Regla del pilar Cobros: ordenar por monto desc (no por días de atraso).
  const deudoresPorMonto = [...deudores].sort(
    (a, b) => b.montoTotal - a.montoTotal,
  );

  return (
    <Marco ahora={ahora} nombreProfesional={nombreProfesional}>
      <KpiGrid
        ingresosMes={kpis.ingresosMes}
        deudaTotal={kpis.deudaAcumulada}
        cobradasCount={cobros.length}
        sinCobrarCount={sesionesSinCobrar}
      />

      <Segmented<Pestana>
        options={[
          { value: "te-deben", label: TE_DEBEN },
          { value: "cobros", label: COBROS_DEL_MES },
        ]}
        value={pestana}
        onChange={setPestana}
        ariaLabel={VISTA_DE_COBROS}
        className="self-start"
      />

      {pestana === "te-deben" ? (
        <TeDeben
          deudores={deudoresPorMonto}
          sesionesSinCobrar={sesionesSinCobrar}
          nombreProfesional={nombreProfesional}
          ahora={ahora}
          smsOk={smsOk}
          onAvisado={(pacienteId, enviadoEn) => {
            marcarAvisado(pacienteId, enviadoEn);
            setToast({ open: true, message: SMS_ENVIADO, variante: "confirmacion" });
          }}
          onError={(mensaje) => setToast({ open: true, message: mensaje, variante: "aviso" })}
          onVerCobros={() => setPestana("cobros")}
        />
      ) : (
        <CobrosDelMes cobros={cobros} onVerTeDeben={() => setPestana("te-deben")} />
      )}

      <Toast
        open={toast.open}
        message={toast.message}
        variante={toast.variante}
        onClose={() => setToast((actual) => ({ ...actual, open: false }))}
      />
    </Marco>
  );
}

// ============================================
// Marco: título, mes y acceso a "Tu consultorio" en mobile (el menú
// inferior no lo lleva).
// ============================================
function Marco({
  ahora,
  nombreProfesional,
  children,
}: {
  ahora: Date | null;
  /** null mientras carga: la cabecera muestra "Tu consultorio". */
  nombreProfesional: string | null;
  children: React.ReactNode;
}) {
  const mesLargo = ahora
    ? capitalize(fechaLarga(ahora).split(" de ").at(-1) ?? "")
    : "";
  const anio = ahora ? ahora.getFullYear() : "";

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10">
      {/* La misma cabecera que en Hoy, y por el mismo motivo: el menú de
          abajo no lleva a la configuración, y un engranaje suelto arriba a
          la derecha era el segundo acceso distinto a un mismo lugar.
          Sin saludo: Cobros no es la pantalla del día. */}
      <header className="flex min-w-0 flex-col gap-4">
        <CabeceraUsuario
          nombre={nombreProfesional}
          ahora={ahora}
          className="self-start lg:hidden"
        />
        <div className="min-w-0">
          <div className="flex h-5 items-center text-[13px] font-medium text-ink-500">
            <EditorialRule />
            <span>{ahora ? `${mesLargo} ${anio}` : " "}</span>
          </div>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-[40px] font-medium italic leading-[0.95] tracking-[-0.02em] text-ink-900 lg:text-[56px]">
            {NAV.COBROS}
          </h1>
        </div>
      </header>
      {children}
    </div>
  );
}

// ============================================
// Dos números, no cuatro.
//
// La grilla decía cuatro cosas que eran dos: "Cobraste este mes $26.3k /
// 12 sesiones" y "Sesiones cobradas 12 / este mes" son el mismo hecho, y
// "Te deben $45.3k" y "Sin cobrar 21 sesiones" también
// (01-auditoria-frontend.md, 5). Cada hecho quedó en una celda, con el monto
// arriba y las sesiones abajo, que es donde ya vivía el subtexto.
//
// Y el rótulo de la deuda dejó de ser "Te deben": ese nombre es de la
// pestaña de al lado. Acá dice "Sin cobrar", que es el número.
// ============================================
function KpiGrid({
  ingresosMes,
  deudaTotal,
  cobradasCount,
  sinCobrarCount,
}: {
  ingresosMes: number;
  deudaTotal: number;
  cobradasCount: number;
  sinCobrarCount: number;
}) {
  const items = [
    {
      label: COBRASTE_ESTE_MES,
      value: moneyShort(ingresosMes),
      subtext: pluralizar(cobradasCount, "sesión", "sesiones"),
      tone: "sage" as const,
    },
    {
      label: SIN_COBRAR,
      value: moneyShort(deudaTotal),
      subtext: pluralizar(sinCobrarCount, "sesión", "sesiones"),
      tone: deudaTotal > 0 ? ("terracotta" as const) : ("default" as const),
    },
  ];

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <div className="grid grid-cols-2">
        {items.map((item, index) => (
          <div
            key={item.label}
            className={`min-w-0 p-4 lg:p-5 ${
              index === 0
                ? "border-r border-[color:var(--border-subtle)]"
                : ""
            }`}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {item.label}
            </span>
            <span
              className={`mt-2 block font-[family-name:var(--font-display)] text-[26px] font-medium leading-none tabular-nums lg:text-[30px] ${kpiValueClass(item.tone)}`}
            >
              {item.value}
            </span>
            <span className="mt-1.5 block text-[12px] text-ink-500">
              {item.subtext}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function kpiValueClass(tone: "sage" | "terracotta" | "default"): string {
  if (tone === "sage") return "text-sage-700";
  if (tone === "terracotta") return "text-terracotta-600";
  return "text-ink-900";
}

// ============================================
// Te deben
// ============================================
function TeDeben({
  deudores,
  sesionesSinCobrar,
  nombreProfesional,
  ahora,
  smsOk,
  onAvisado,
  onError,
  onVerCobros,
}: {
  deudores: DeudorItem[];
  sesionesSinCobrar: number;
  nombreProfesional: string;
  ahora: Date;
  smsOk: boolean;
  onAvisado: (pacienteId: string, enviadoEn: string) => void;
  onError: (mensaje: string) => void;
  onVerCobros: () => void;
}) {
  if (deudores.length === 0) {
    return (
      <EstadoVacio
        // La única confirmación alegre que 04-personaje.md le permite a
        // Cobros: nadie debe nada. Lupita a 96 px, celebrando, y el círculo
        // crema crece para recibirla.
        lupita
        titulo={NADIE_TE_DEBE}
        lineas={NADIE_TE_DEBE_LINEAS}
        accion={{ label: VER_COBROS_DEL_MES, onClick: onVerCobros }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-[8px] border-l-2 border-l-terracotta-500 bg-cream-100 px-5 py-4 lg:px-6 lg:py-5">
        <p className="text-[15px] leading-[1.55] text-ink-700">
          Son{" "}
          <span className="font-[family-name:var(--font-display)] text-[24px] font-medium leading-none text-terracotta-600 lg:text-[28px]">
            {pluralizar(sesionesSinCobrar, "sesión", "sesiones")}
          </span>{" "}
          {SIN_COBRAR_FRASE_FINAL}
        </p>
      </Card>

      <Card className="overflow-hidden rounded-[8px] p-0">
        <ListaEnCascada
          contenedor="ul"
          item="li"
          className="divide-y divide-[color:var(--border-subtle)]"
        >
          {deudores.map((d) => (
            <FilaDeudor
              key={d.pacienteId}
              deudor={d}
              nombreProfesional={nombreProfesional}
              ahora={ahora}
              smsOk={smsOk}
              onAvisado={onAvisado}
              onError={onError}
            />
          ))}
        </ListaEnCascada>
      </Card>
    </div>
  );
}

function ZonaIndicador({ dias }: { dias: number }) {
  const zona: ZonaDeuda = zonaDeuda(dias);
  const texto = textoAtraso(dias);
  if (zona === "terracotta") {
    return (
      // 12 px y el mismo tracking que ui/chip.tsx: era el único chip de la
      // app por debajo del piso que ese archivo documenta, y a un brazo de
      // distancia 11 px no se leen (01-auditoria-frontend.md, (d)).
      <span className="inline-flex items-center rounded-full bg-terracotta-50 px-2 py-0.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-terracotta-600">
        {texto}
      </span>
    );
  }
  if (zona === "gold") {
    return <span className="font-medium text-gold-500">{texto}</span>;
  }
  return <span className="text-sage-600">{texto}</span>;
}

// ============================================
// La fila de una deudora: quién es, cuánto debe, cuándo se le avisó y el
// botón. La confirmación se abre debajo, a lo ancho: el mensaje entero tiene
// que poder leerse antes de mandarlo, y no entra al lado del botón.
// ============================================
function FilaDeudor({
  deudor,
  nombreProfesional,
  ahora,
  smsOk,
  onAvisado,
  onError,
}: {
  deudor: DeudorItem;
  nombreProfesional: string;
  ahora: Date;
  smsOk: boolean;
  onAvisado: (pacienteId: string, enviadoEn: string) => void;
  onError: (mensaje: string) => void;
}) {
  const [confirmando, setConfirmando] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const nombreCompleto = `${deudor.nombre} ${deudor.apellido}`;
  const telefono = deudor.telefono?.trim() ?? "";

  // El mismo texto que arma el servidor: mismo template, misma interpolación
  // y el mismo money(). Lo que ella lee acá es, carácter por carácter, lo que
  // le va a llegar a la paciente.
  const mensaje = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
    nombre: deudor.nombre,
    sesiones: deudor.sesionesImpagas,
    monto: money(deudor.montoTotal),
    profesional: nombreProfesional,
  });

  async function enviar() {
    setEnviando(true);
    try {
      const resultado = await apiPost<{ enviadoEn: string }>(
        `/api/pacientes/${deudor.pacienteId}/recordar-cobro`,
        {},
      );
      setConfirmando(false);
      onAvisado(deudor.pacienteId, resultado.enviadoEn);
    } catch (error) {
      // El mensaje viene del servidor: si Twilio rechazó el envío, dice por
      // qué. Solo se cae al genérico si no hubo respuesta.
      setConfirmando(false);
      onError(error instanceof ApiClientError ? error.mensaje : ALGO_FALLO);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="px-4 py-3 lg:px-5 lg:py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <Link
          href={`/pacientes/${deudor.pacienteId}`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition-colors duration-150 active:bg-cream-50"
          aria-label={`Abrir ficha de ${nombreCompleto}`}
        >
          <Avatar nombre={deudor.nombre} apellido={deudor.apellido} size={40} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold leading-[1.35] text-ink-900">
              {nombreCompleto}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-500">
              <span>
                {pluralizar(deudor.sesionesImpagas, "sesión", "sesiones")} sin
                cobrar
              </span>
              <span aria-hidden="true" className="text-ink-300">
                ·
              </span>
              <ZonaIndicador dias={deudor.diasAtraso} />
              {deudor.ultimoAvisoEn ? (
                <>
                  <span aria-hidden="true" className="text-ink-300">
                    ·
                  </span>
                  <UltimoAviso enviadoEn={deudor.ultimoAvisoEn} ahora={ahora} />
                </>
              ) : null}
            </span>
          </span>
          <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-terracotta-600">
            {money(deudor.montoTotal)}
          </span>
          <ChevronRight
            size={16}
            strokeWidth={1.6}
            className="shrink-0 text-ink-300 lg:hidden"
            aria-hidden="true"
          />
        </Link>
        <div className="flex items-center gap-2 lg:shrink-0">
          {!smsOk ? (
            <p className="text-[12px] leading-[1.4] text-ink-500 lg:max-w-[220px] lg:text-right">
              {SMS_SIN_CONFIGURAR}
            </p>
          ) : telefono && !confirmando ? (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              aria-label={`${RECORDAR_COBRO} a ${nombreCompleto} por SMS`}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full border border-sage-500 px-4 text-[13px] font-semibold text-sage-600 transition-colors duration-150 hover:bg-sage-50 lg:min-h-[36px] lg:w-auto"
            >
              <Send size={14} strokeWidth={1.8} aria-hidden="true" />
              {RECORDAR_COBRO}
            </button>
          ) : null}
          <Link
            href={`/pacientes/${deudor.pacienteId}`}
            aria-label={`Ver ficha de ${nombreCompleto}`}
            className="hidden text-ink-300 hover:text-ink-500 lg:inline-flex"
          >
            <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {confirmando ? (
        <Confirmar
          className="mt-3"
          titulo={RECORDAR_COBRO_TITULO}
          mensaje={
            <>
              <span className="block whitespace-pre-wrap rounded-[10px] border-l-[3px] border-l-sage-500 bg-cream-100 px-4 py-[14px] italic">
                {mensaje}
              </span>
              <span className="mt-2 block text-[12px] text-ink-500">
                {SMS_DESTINO}{" "}
                <span className="font-medium tabular-nums text-ink-700">
                  {telefono}
                </span>
              </span>
            </>
          }
          accion={ENVIAR_SMS}
          enviando={enviando}
          enviandoLabel={ENVIANDO_SMS}
          onConfirmar={() => void enviar()}
          onCancelar={() => setConfirmando(false)}
        />
      ) : null}
    </div>
  );
}

/** "Avisado hace 3 días". Los días se cuentan por calendario de Montevideo,
 *  igual que el atraso de la deuda. */
function UltimoAviso({
  enviadoEn,
  ahora,
}: {
  enviadoEn: string;
  ahora: Date;
}) {
  const dias = diasEnterosMvd(new Date(enviadoEn), ahora);
  return (
    <span className="text-ink-500">
      {AVISADO} {textoAtraso(dias)}
    </span>
  );
}

// ============================================
// Cobros del mes
// ============================================
function CobrosDelMes({
  cobros,
  onVerTeDeben,
}: {
  cobros: TurnoConPaciente[];
  onVerTeDeben: () => void;
}) {
  if (cobros.length === 0) {
    return (
      <EstadoVacio
        // Este no se celebra: un mes sin cobrar nada no es una buena
        // noticia. Ícono de siempre, sin personaje.
        icono={<Wallet size={28} strokeWidth={1.6} aria-hidden="true" />}
        titulo={SIN_COBROS_ESTE_MES}
        lineas={SIN_COBROS_ESTE_MES_LINEAS}
        accion={{ label: VER_TE_DEBEN, onClick: onVerTeDeben }}
      />
    );
  }

  return (
    <Card className="overflow-hidden rounded-[8px] p-0">
      <ul className="divide-y divide-[color:var(--border-subtle)]">
        {cobros.map((t) => {
          const nombreCompleto = `${t.paciente.nombre} ${t.paciente.apellido}`;
          const fecha = t.pagoFecha ?? t.fecha;
          const metodoLabel = t.pagoMetodo
            ? METODO_PAGO_LABEL[t.pagoMetodo]
            : SIN_METODO;

          return (
            <li
              key={t.id}
              className="flex items-center gap-3 px-4 py-3 lg:px-5 lg:py-4"
            >
              <span className="w-[64px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-500">
                {fechaCorta(fecha)}
              </span>

              <Avatar
                nombre={t.paciente.nombre}
                apellido={t.paciente.apellido}
                size={32}
              />

              <span className="min-w-0 flex-1">
                {/* Sin truncate: "Rodrigo …" no es un nombre. A 390 px el
                    apellido baja a la segunda línea, que es lo que ya hace
                    el mismo dato en el Recorrido. */}
                <Link
                  href={`/pacientes/${t.paciente.id}`}
                  className="block text-[14px] font-semibold leading-[1.35] text-ink-900 hover:underline"
                >
                  {nombreCompleto}
                </Link>
                <span className="mt-0.5 block text-[11px] text-ink-500">
                  {metodoLabel}
                </span>
              </span>

              <span className="font-[family-name:var(--font-display)] text-[15px] font-medium tabular-nums text-sage-700">
                {money(t.tarifaCobrada)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ============================================
// Estado vacío: ícono, titular, tres líneas, un botón. La misma forma que en
// la agenda, y no aparece un cuarto formato.
//
// Lo único que cambia entre uno y otro es quién ocupa el círculo: un ícono
// de 28 px en el círculo de 56, o Lupita a 96 px en el círculo agrandado,
// donde la pantalla tiene algo que celebrar.
// ============================================
function EstadoVacio({
  icono,
  lupita = false,
  titulo,
  lineas,
  accion,
}: {
  icono?: React.ReactNode;
  /** Lupita celebrando en vez del ícono. Sólo donde 04-personaje.md la deja
   *  entrar; en Cobros, sólo en "Nadie te debe". */
  lupita?: boolean;
  titulo: string;
  lineas: readonly [string, string, string];
  accion: { label: string; onClick: () => void };
}) {
  return (
    <Card className="flex flex-col items-center rounded-[8px] px-6 py-12 text-center">
      {lupita ? (
        <span className="inline-flex h-[128px] w-[128px] items-center justify-center rounded-full bg-cream-100">
          <Lupita pose="celebra" tamano={TAMANOS_LUPITA.vacio} />
        </span>
      ) : (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 text-sage-600">
          {icono}
        </span>
      )}
      <p className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-medium italic leading-tight text-ink-900">
        {titulo}
      </p>
      <div className="mt-3 flex max-w-[420px] flex-col gap-1">
        {lineas.map((linea) => (
          <p key={linea} className="text-[13px] leading-[1.5] text-ink-500">
            {linea}
          </p>
        ))}
      </div>
      <div className="mt-6">
        <Button variant="secondary" onClick={accion.onClick}>
          {accion.label}
        </Button>
      </div>
    </Card>
  );
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
