"use client";

// Cobros: lo que entró este mes y lo que todavía te deben, en una sola
// pantalla, con la entrada a Finanzas arriba de la lista. /deudores
// redirige acá.
//
// No se calcula "trabajaste N horas gratis": la deuda se cuenta en sesiones,
// que es como ella la piensa.
//
// La acción principal de cada fila de "Te deben" es registrar el pago: a
// esta pantalla se viene cuando una paciente pagó, y antes había que salir a
// su ficha para anotarlo. El cobro sigue siendo por turno (POST
// /api/turnos/[id]/cobrar): la fila trae la deuda sumada, sin ids, así que
// al abrir el panel se lee el detalle de esa paciente y ella marca qué
// sesiones le pagó. El método se elige con el mismo selector que usan Hoy,
// la Agenda y la ficha.
//
// El recordatorio de cobro es la acción secundaria. Sale por SMS desde acá, y lo aprieta ella: antes
// abría el teléfono con el texto cargado y la app no se enteraba de nada
// —ni si el mensaje había salido, ni cuándo—, así que no había forma de
// saber si ya le había avisado a alguien. Ahora se manda desde el servidor
// (POST /api/pacientes/[id]/recordar-cobro), queda en la auditoría y la fila
// muestra "Avisado hace N días". Nunca es automático: el mensaje se ve
// entero, con el número al que sale, antes de confirmar.

import * as React from "react";
import Link from "next/link";
import { Wallet } from "lucide-react";

import { Card, EditorialRule, Segmented, Toast } from "@/components/ui";
import { EsqueletoCobrosCuerpo } from "@/components/esqueletos";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { useToast } from "@/components/ui/toast";
import { CabeceraUsuario } from "@/components/layout/cabecera-usuario";
import { esAbort } from "@/lib/api-client";
import { formatearMesMvd, partesMvd } from "@/lib/fechas-montevideo";
import { fechaCorta, money } from "@/lib/format";
import {
  ALGO_FALLO,
  COBRADO,
  COBRASTE_ESTE_MES,
  COBROS_DEL_MES,
  COBROS_NO_CARGARON,
  METODO_PAGO_LABEL,
  NAV,
  REINTENTAR,
  SIN_COBRAR,
  SIN_COBROS_ESTE_MES,
  SIN_COBROS_ESTE_MES_LINEAS,
  SIN_METODO,
  TE_DEBEN,
  VER_TE_DEBEN,
  VISTA_DE_COBROS,
  pluralizar,
} from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

import { SegunLectura, type Carga } from "../../_components/segun-lectura";
import { cargarCobros, type DatosCobros } from "./datos";
import { TarjetaFinanzas } from "./tarjeta-finanzas";
import { TeDeben } from "./te-deben";

type Pestana = "te-deben" | "cobros";

// ============================================
export function CobrosView() {
  const [pestana, setPestana] = React.useState<Pestana>("te-deben");
  const [datos, setDatos] = React.useState<DatosCobros | null>(null);
  const [ahora, setAhora] = React.useState<Date | null>(null);
  const [carga, setCarga] = React.useState<Carga>("cargando");
  const [reloadKey, setReloadKey] = React.useState(0);
  const toast = useToast();

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

  return (
    <SegunLectura
      carga={carga}
      datos={datos && ahora ? { ...datos, ahora } : null}
      // La segunda espera: la ruta ya llegó y faltan sus datos. El cuerpo
      // es el mismo que dibujó el loading.tsx de esta carpeta, y el Marco
      // acá ya es el de verdad.
      esqueleto={
        <Marco ahora={null} nombreProfesional={null}>
          <EsqueletoCobrosCuerpo />
        </Marco>
      }
      error={
        <Marco ahora={null} nombreProfesional={null}>
          <EstadoVacio
            icono={<Wallet size={28} strokeWidth={1.6} aria-hidden="true" />}
            titulo={ALGO_FALLO}
            lineas={COBROS_NO_CARGARON}
            accion={{ label: REINTENTAR, onClick: reintentar }}
          />
        </Marco>
      }
      onReintentar={reintentar}
    >
      {(cargados, { aviso, ocupado }) => (
        <Pantalla
          datos={cargados}
          aviso={aviso}
          ocupado={ocupado}
          pestana={pestana}
          onPestana={setPestana}
          reloadKey={reloadKey}
          onRecargar={reintentar}
          toast={toast}
        />
      )}
    </SegunLectura>
  );
}

function Pantalla({
  datos,
  aviso,
  ocupado,
  pestana,
  onPestana,
  reloadKey,
  onRecargar,
  toast,
}: {
  datos: DatosCobros & { ahora: Date };
  aviso: React.ReactNode;
  ocupado: boolean;
  pestana: Pestana;
  onPestana: (pestana: Pestana) => void;
  reloadKey: number;
  onRecargar: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const { ahora } = datos;
  const { kpis, deudores, cobros, nombreProfesional } = datos;

  const sesionesSinCobrar = deudores.reduce(
    (sum, d) => sum + d.sesionesImpagas,
    0,
  );

  return (
    <Marco ahora={ahora} nombreProfesional={nombreProfesional} ocupado={ocupado}>
      {aviso}

      <KpiGrid
        ingresosMes={kpis.ingresosMes}
        deudaTotal={kpis.deudaAcumulada}
        cobradasCount={cobros.length}
        sinCobrarCount={sesionesSinCobrar}
      />

      {/* La entrada a Finanzas, arriba de la lista: con un dato vivo, y sin
          romper Cobros si ese dato no llega. */}
      <TarjetaFinanzas recarga={reloadKey} />

      <Segmented<Pestana>
        options={[
          { value: "te-deben", label: TE_DEBEN },
          { value: "cobros", label: COBROS_DEL_MES },
        ]}
        value={pestana}
        onChange={onPestana}
        ariaLabel={VISTA_DE_COBROS}
        className="self-start"
      />

      {pestana === "te-deben" ? (
        <TeDeben
          // En el orden en que llegan: el orden de la deuda lo decide el
          // servidor, una sola vez para Hoy y para Cobros (forense 03,
          // P3-15). Acá se ordenaba de nuevo, por monto y sin desempate.
          deudores={deudores}
          sesionesSinCobrar={sesionesSinCobrar}
          nombreProfesional={nombreProfesional}
          ahora={ahora}
          onCobrado={() => {
            // La deuda y los ingresos del mes salen del servidor: se vuelve a
            // pedir todo. Los datos viejos quedan en pantalla mientras tanto.
            onRecargar();
            toast.confirmar(COBRADO);
          }}
          onCobroIncompleto={(mensaje, huboCobros) => {
            if (huboCobros) onRecargar();
            toast.avisar(mensaje);
          }}
          onAvisado={(creado) => {
            toast.confirmar(creado ? "Aviso programado. Sale en los próximos minutos." : "Ya pediste este aviso hoy. No se programó otro.");
          }}
          onError={(mensaje) => toast.avisar(mensaje)}
          onVerCobros={() => onPestana("cobros")}
        />
      ) : (
        <CobrosDelMes cobros={cobros} onVerTeDeben={() => onPestana("te-deben")} />
      )}

      <Toast {...toast.props} />
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
  ocupado = false,
  children,
}: {
  ahora: Date | null;
  /** null mientras carga: la cabecera muestra "Tu consultorio". */
  nombreProfesional: string | null;
  /** Recargando con los datos anteriores en pantalla. */
  ocupado?: boolean;
  children: React.ReactNode;
}) {
  const mesLargo = ahora ? capitalize(formatearMesMvd(ahora)) : "";
  const anio = ahora ? partesMvd(ahora).anio : "";

  return (
    <div aria-busy={ocupado} className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10">
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
// "Te deben $45.3k" y "Sin cobrar 21 sesiones" también. Cada hecho quedó en
// una celda, con el monto arriba y las sesiones abajo, que es donde ya vivía
// el subtexto.
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

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}
