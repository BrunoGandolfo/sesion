"use client";

// Cobros: lo que entró este mes y lo que todavía te deben, en una sola
// pantalla. Reúne lo que antes vivía en /finanzas (KPIs + cobros del mes) y
// en /deudores (la lista con "Recordar cobro").
//
// No se calcula "trabajaste N horas gratis": la deuda se cuenta en sesiones,
// que es como ella la piensa.
//
// La acción principal de cada fila de "Te deben" es registrar el pago: a
// esta pantalla se viene cuando una paciente pagó, y antes había que salir a
// su ficha para anotarlo. El cobro sigue siendo por turno (POST
// /api/turnos/[id]/cobrar): la fila trae la deuda sumada, sin ids, así que
// al abrir el panel se lee el detalle de esa paciente y ella marca qué
// sesiones le pagó. El método se elige con el mismo sheet que usa Hoy.
//
// El recordatorio de cobro es la acción secundaria. Sale por SMS desde acá, y lo aprieta ella: antes
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
import { esDeudaPendiente } from "@/app/api/_lib/domain";
import {
  TEMPLATE_COBRO_DEFAULT,
  interpolarTemplateCobro,
  textoAtraso,
  zonaDeuda,
  type ZonaDeuda,
} from "@/lib/deudas";
import { diasEnterosMvd, partesMvd } from "@/lib/fechas-montevideo";
import { fechaCorta, fechaLarga, money } from "@/lib/format";
import {
  ALGO_FALLO,
  AVISADO,
  BUSCANDO_SESIONES,
  COBRADO,
  COBRASTE_ESTE_MES,
  COBRO_INCOMPLETO,
  COBROS_DEL_MES,
  COBROS_NO_CARGARON,
  ELEGIR_METODO_DE_PAGO,
  ENVIANDO_SMS,
  ENVIAR_SMS,
  MARCAR_TODAS,
  METODO_PAGO_LABEL,
  NADIE_TE_DEBE,
  NADIE_TE_DEBE_LINEAS,
  NAV,
  NO_SE_PUDO_COBRAR,
  RECORDAR_COBRO,
  RECORDAR_COBRO_TITULO,
  REGISTRAR_PAGO,
  REGISTRAR_PAGO_TITULO,
  REINTENTAR,
  SESIONES_NO_CARGARON,
  SIN_COBRAR,
  SIN_COBRAR_FRASE_FINAL,
  SIN_COBROS_ESTE_MES,
  SIN_COBROS_ESTE_MES_LINEAS,
  SIN_METODO,
  SMS_DESTINO,
  TE_DEBEN,
  VER_COBROS_DEL_MES,
  VER_TE_DEBEN,
  VISTA_DE_COBROS,
  YA_NO_DEBE,
  pluralizar,
} from "@/lib/glosario";
import type {
  Configuracion,
  DeudaPaciente,
  KPIsDashboard,
  MetodoPago,
  Turno,
  TurnoConPaciente,
} from "@/types/domain";

import { SheetMetodoPago } from "../../_components/sheet-metodo-pago";

// ============================================
// Tipos de fetch — JSON → Date donde la UI lo necesita
// ============================================

type DeudorItem = DeudaPaciente & {
  telefono: string;
  minutosTotales: number;
  /** ISO del último aviso que salió; null si nunca se le avisó. */
  ultimoAvisoEn: string | null;
};

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
};

async function cargarCobros(signal: AbortSignal): Promise<DatosCobros> {
  const [dashboard, deudores, cobros, config] = await Promise.all([
    apiGet<{ kpis: KPIsDashboard }>("/api/dashboard", { signal }),
    apiGet<DeudorItem[]>("/api/deudores", { signal }),
    apiGet<JsonTurno[]>("/api/turnos/cobros", { signal }),
    // La configuración puede no existir todavía: el recordatorio sale sin
    // firma y la pantalla igual se muestra.
    apiGet<Configuracion>("/api/config", { signal }).catch((err: unknown) => {
      if (esAbort(err)) throw err;
      return null;
    }),
  ]);

  return {
    kpis: dashboard.kpis,
    deudores,
    cobros: cobros.map(parseTurno),
    nombreProfesional: config?.nombreProfesional ?? "",
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

  const { kpis, deudores, cobros, nombreProfesional } = datos;

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
          onCobrado={() => {
            // La deuda y los ingresos del mes salen del servidor: se vuelve a
            // pedir todo. Los datos viejos quedan en pantalla mientras tanto.
            setReloadKey((k) => k + 1);
            setToast({ open: true, message: COBRADO, variante: "confirmacion" });
          }}
          onCobroIncompleto={(mensaje, huboCobros) => {
            if (huboCobros) setReloadKey((k) => k + 1);
            setToast({ open: true, message: mensaje, variante: "aviso" });
          }}
          onAvisado={(creado) => {
            setToast({ open: true, message: creado ? "Aviso programado. Sale en los próximos minutos." : "Ya pediste este aviso hoy. No se programó otro.", variante: "confirmacion" });
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
  const anio = ahora ? partesMvd(ahora).anio : "";

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
      value: money(ingresosMes),
      subtext: pluralizar(cobradasCount, "sesión", "sesiones"),
      tone: "sage" as const,
    },
    {
      label: SIN_COBRAR,
      value: money(deudaTotal),
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
              className={`mt-2 block whitespace-nowrap text-[22px] font-medium leading-none tabular-nums lg:text-[30px] ${kpiValueClass(item.tone)}`}
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
/** Qué tiene abierto debajo una fila. De a una por vez en toda la lista: dos
 *  paneles abiertos son dos lugares donde tocar sin querer. */
type PanelAbierto = { pacienteId: string; modo: "pago" | "sms" } | null;

function TeDeben({
  deudores,
  sesionesSinCobrar,
  nombreProfesional,
  ahora,
  onCobrado,
  onCobroIncompleto,
  onAvisado,
  onError,
  onVerCobros,
}: {
  deudores: DeudorItem[];
  sesionesSinCobrar: number;
  nombreProfesional: string;
  ahora: Date;
  /** Todas las sesiones elegidas quedaron cobradas. */
  onCobrado: () => void;
  /** Alguna falló. `huboCobros` dice si antes de fallar entró alguna. */
  onCobroIncompleto: (mensaje: string, huboCobros: boolean) => void;
  onAvisado: (creado: boolean) => void;
  onError: (mensaje: string) => void;
  onVerCobros: () => void;
}) {
  const [panel, setPanel] = React.useState<PanelAbierto>(null);
  // Las sesiones marcadas, mientras el selector de método está abierto.
  const [porCobrar, setPorCobrar] = React.useState<string[] | null>(null);
  // Cómo terminó el cobro. Lo escribe `cobrar` y lo lee el cierre del sheet,
  // que llega después: el sheet se queda abierto lo que dura el tilde.
  const resultadoRef = React.useRef<
    | { registradas: number; elegidas: number; error: string | null; terminado: boolean }
    | null
  >(null);

  // El cobro es por turno: una llamada por sesión marcada, en orden. Si una
  // falla se corta ahí y se dice cuántas entraron. Rechaza para que el sheet
  // no dibuje el tilde sobre un cobro que no quedó completo.
  async function cobrar(metodo: MetodoPago) {
    const ids = porCobrar ?? [];
    const resultado = {
      registradas: 0,
      elegidas: ids.length,
      error: null as string | null,
      terminado: false,
    };
    resultadoRef.current = resultado;
    try {
      for (const id of ids) {
        await apiPost(`/api/turnos/${id}/cobrar`, { metodo });
        resultado.registradas += 1;
      }
    } catch (error) {
      resultado.error =
        error instanceof ApiClientError ? error.mensaje : NO_SE_PUDO_COBRAR;
      throw error;
    } finally {
      resultado.terminado = true;
    }
  }

  function alCerrarMetodo() {
    const resultado = resultadoRef.current;
    // Con cobros en vuelo el sheet no se cierra (Escape, tocar afuera): se
    // cierra solo cuando terminan, y recién ahí se sabe qué decir.
    if (resultado && !resultado.terminado) return;
    resultadoRef.current = null;
    setPorCobrar(null);
    if (!resultado) return; // cerró sin elegir: el panel sigue como estaba
    if (resultado.error === null) {
      setPanel(null);
      onCobrado();
      return;
    }
    if (resultado.registradas > 0) setPanel(null);
    onCobroIncompleto(
      resultado.registradas > 0
        ? COBRO_INCOMPLETO(resultado.registradas, resultado.elegidas)
        : resultado.error,
      resultado.registradas > 0,
    );
  }

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
          {sesionesSinCobrar === 1 ? "Es" : "Son"}{" "}
          <span className="tabular-nums text-[24px] font-medium leading-none text-terracotta-600 lg:text-[28px]">
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
              abierto={panel?.pacienteId === d.pacienteId ? panel.modo : null}
              onAbrir={(modo) =>
                setPanel(modo ? { pacienteId: d.pacienteId, modo } : null)
              }
              onElegirMetodo={setPorCobrar}
              onAvisado={onAvisado}
              onError={onError}
            />
          ))}
        </ListaEnCascada>
      </Card>

      <SheetMetodoPago
        open={porCobrar !== null}
        onClose={alCerrarMetodo}
        onElegir={cobrar}
      />
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
// La fila de una deudora: quién es, cuánto debe, cuándo se le avisó y dos
// acciones. "Registrar pago" es la principal, con el peso de un botón lleno;
// el recordatorio es un enlace de texto que dice que manda un SMS. Lo que
// abre cada una se despliega debajo, a lo ancho: ni la lista de sesiones ni
// el mensaje entero entran al lado del botón.
// ============================================
function FilaDeudor({
  deudor,
  nombreProfesional,
  ahora,
  abierto,
  onAbrir,
  onElegirMetodo,
  onAvisado,
  onError,
}: {
  deudor: DeudorItem;
  nombreProfesional: string;
  ahora: Date;
  /** Qué panel de esta fila está desplegado; lo decide la lista. */
  abierto: "pago" | "sms" | null;
  onAbrir: (modo: "pago" | "sms" | null) => void;
  /** Las sesiones marcadas: abre el selector de método. */
  onElegirMetodo: (turnoIds: string[]) => void;
  onAvisado: (creado: boolean) => void;
  onError: (mensaje: string) => void;
}) {
  const confirmando = abierto === "sms";
  const setConfirmando = (valor: boolean) => onAbrir(valor ? "sms" : null);
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
      const resultado = await apiPost<{ envioId: string; creado: boolean; programadoEn: string }>(
        `/api/pacientes/${deudor.pacienteId}/recordar-cobro`,
        {},
      );
      setConfirmando(false);
      onAvisado(resultado.creado);
    } catch (error) {
      // El servidor rechazó programarlo. El envío lo resuelve el despachador.
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
          className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-md transition-colors duration-[var(--duration-fast)] active:bg-cream-50"

          aria-label={`Abrir ficha de ${nombreCompleto}`}
        >
          <span className="contents">
            <span className="col-start-1 row-start-1 block min-w-0 break-words text-[14px] font-semibold leading-[1.35] text-ink-900">
              {nombreCompleto}
            </span>
            <span className="col-span-2 row-start-2 mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-500">
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
          <span className="col-start-2 row-start-1 whitespace-nowrap text-[15px] font-medium tabular-nums text-terracotta-600">
            {money(deudor.montoTotal)}
          </span>
        </Link>
        <div className="flex flex-col gap-1 lg:shrink-0 lg:flex-row-reverse lg:items-center lg:gap-2">
          {abierto === null ? (
            <Button
              size="sm"
              onClick={() => onAbrir("pago")}
              aria-label={`${REGISTRAR_PAGO} de ${nombreCompleto}`}
              className="w-full lg:w-auto"
            >
              {REGISTRAR_PAGO}
            </Button>
          ) : null}
          {telefono && abierto === null ? (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              // El nombre accesible es el de siempre ("Recordar cobro a … por
              // SMS"): lo busca avisos-operaciones.test.tsx, que es de todas
              // las pantallas.
              aria-label={`Recordar cobro a ${nombreCompleto} por SMS`}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-ink-500 transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 hover:text-ink-700 lg:min-h-[36px] lg:w-auto"
            >
              <Send size={14} strokeWidth={1.8} aria-hidden="true" />
              {RECORDAR_COBRO}
            </button>
          ) : null}
        </div>
        <div className="hidden lg:flex lg:shrink-0 lg:items-center">
          <Link
            href={`/pacientes/${deudor.pacienteId}`}
            aria-label={`Ver ficha de ${nombreCompleto}`}
            className="hidden text-ink-300 hover:text-ink-500 lg:inline-flex"
          >
            <ChevronRight size={16} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {abierto === "pago" ? (
        <RegistrarPago
          pacienteId={deudor.pacienteId}
          onElegirMetodo={onElegirMetodo}
          onCancelar={() => onAbrir(null)}
        />
      ) : null}

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

// ============================================
// Registrar pago: las sesiones sin cobrar de esa paciente, para marcar las
// que pagó. Con una sola ya viene marcada; con varias no se marca ninguna
// por ella: anotar de más un cobro es peor que un toque extra, y "Marcar
// todas" queda a mano. El método se elige después, una vez para todas.
// ============================================
type TurnoJson = Omit<Turno, "fecha"> & { fecha: string };

function RegistrarPago({
  pacienteId,
  onElegirMetodo,
  onCancelar,
}: {
  pacienteId: string;
  onElegirMetodo: (turnoIds: string[]) => void;
  onCancelar: () => void;
}) {
  const [sesiones, setSesiones] = React.useState<TurnoJson[] | "error" | null>(null);
  const [marcadas, setMarcadas] = React.useState<ReadonlySet<string>>(new Set());
  const [intento, setIntento] = React.useState(0);
  const tituloId = React.useId();

  React.useEffect(() => {
    const controller = new AbortController();
    apiGet<{ turnos: TurnoJson[] }>(`/api/pacientes/${pacienteId}`, {
      signal: controller.signal,
    })
      .then(({ turnos }) => {
        // La misma regla que suma la deuda de la fila, y de la más vieja a
        // la más nueva: es el orden en que se pagan.
        const impagas = turnos
          .filter(esDeudaPendiente)
          .sort((a, b) => a.fecha.localeCompare(b.fecha));
        setSesiones(impagas);
        setMarcadas(new Set(impagas.length === 1 ? [impagas[0].id] : []));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || esAbort(err)) return;
        setSesiones("error");
      });
    return () => controller.abort();
  }, [pacienteId, intento]);

  const alternar = (id: string) =>
    setMarcadas((actual) => {
      const siguiente = new Set(actual);
      if (!siguiente.delete(id)) siguiente.add(id);
      return siguiente;
    });

  const lista = Array.isArray(sesiones) ? sesiones : [];
  const elegidas = lista.filter((t) => marcadas.has(t.id));
  const total = elegidas.reduce((suma, t) => suma + t.tarifaCobrada, 0);

  return (
    <section
      aria-labelledby={tituloId}
      className="mt-3 rounded-[10px] border border-[color:var(--border-subtle)] bg-cream-50 px-4 py-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={tituloId} className="text-[14px] font-semibold text-ink-900">
          {REGISTRAR_PAGO_TITULO}
        </h3>
        {lista.length > 1 && elegidas.length < lista.length ? (
          <button
            type="button"
            onClick={() => setMarcadas(new Set(lista.map((t) => t.id)))}
            className="min-h-[44px] shrink-0 px-1 text-[13px] font-medium text-sage-600 underline-offset-2 hover:underline lg:min-h-0"
          >
            {MARCAR_TODAS}
          </button>
        ) : null}
      </div>

      {sesiones === null ? (
        <p className="mt-2 text-[13px] text-ink-500">{BUSCANDO_SESIONES}</p>
      ) : sesiones === "error" ? (
        <p role="alert" className="mt-2 text-[13px] text-ink-700">
          {SESIONES_NO_CARGARON}{" "}
          <button
            type="button"
            onClick={() => {
              setSesiones(null);
              setIntento((n) => n + 1);
            }}
            className="font-medium text-sage-600 underline underline-offset-2"
          >
            {REINTENTAR}
          </button>
        </p>
      ) : lista.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-500">{YA_NO_DEBE}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[color:var(--border-subtle)]">
          {lista.map((t) => (
            <li key={t.id}>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={marcadas.has(t.id)}
                  onChange={() => alternar(t.id)}
                  className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-sage-500"
                />
                <span className="min-w-0 flex-1 text-[14px] text-ink-900">
                  Sesión del {fechaLarga(new Date(t.fecha))}
                </span>
                <span className="whitespace-nowrap text-[14px] font-medium tabular-nums text-ink-700">
                  {money(t.tarifaCobrada)}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p aria-live="polite" className="text-[13px] text-ink-500">
          {elegidas.length > 0
            ? `${pluralizar(elegidas.length, "sesión", "sesiones")} · ${money(total)}`
            : " "}
        </p>
        {/* En el teléfono van apilados, el principal arriba: lado a lado,
            "Elegir método de pago" se partía en tres renglones. */}
        <div className="flex flex-col-reverse gap-2 lg:flex-row">
          <Button variant="secondary" size="sm" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={elegidas.length === 0}
            onClick={() => onElegirMetodo(elegidas.map((t) => t.id))}
          >
            {ELEGIR_METODO_DE_PAGO}
          </Button>
        </div>
      </div>
    </section>
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
            <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-4 py-3 lg:px-5 lg:py-4">
              <Link href={`/pacientes/${t.paciente.id}`} className="min-w-0 break-words text-[14px] font-semibold leading-[1.35] text-ink-900 hover:underline">
                {nombreCompleto}
              </Link>
              <span className="whitespace-nowrap text-[15px] font-medium tabular-nums text-sage-700">
                {money(t.tarifaCobrada)}
              </span>
              <span className="col-span-2 text-[12px] text-ink-500">
                {fechaCorta(fecha)} · {metodoLabel}
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
