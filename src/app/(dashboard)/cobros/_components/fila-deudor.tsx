"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Send } from "lucide-react";

import { Button, Confirmar } from "@/components/ui";
import { mensajeParaElla } from "@/lib/api-client";
import {
  TEMPLATE_COBRO_DEFAULT,
  interpolarTemplateCobro,
  textoAtraso,
  zonaDeuda,
  type ZonaDeuda,
} from "@/lib/deudas";
import { diasEnterosMvd } from "@/lib/fechas-montevideo";
import { money } from "@/lib/format";
import {
  AVISADO,
  ENVIANDO_SMS,
  ENVIAR_SMS,
  RECORDAR_COBRO,
  RECORDAR_COBRO_TITULO,
  REGISTRAR_PAGO,
  SMS_DESTINO,
  pluralizar,
} from "@/lib/glosario";
import { formatPhoneDisplay } from "@/lib/phone";

import { recordarCobro, type DeudorItem } from "./datos";
import { RegistrarPago } from "./registrar-pago";

// ============================================
// La fila de una deudora: quién es, cuánto debe, cuándo se le avisó y dos
// acciones. "Registrar pago" es la principal, con el peso de un botón lleno;
// el recordatorio es un enlace de texto que dice que manda un SMS. Lo que
// abre cada una se despliega debajo, a lo ancho: ni la lista de sesiones ni
// el mensaje entero entran al lado del botón.
// ============================================
export function FilaDeudor({
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
      const creado = await recordarCobro(deudor.pacienteId);
      setConfirmando(false);
      onAvisado(creado);
    } catch (error) {
      // El servidor rechazó programarlo. El envío lo resuelve el despachador.
      setConfirmando(false);
      onError(mensajeParaElla(error));
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
                  {formatPhoneDisplay(telefono)}
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

function ZonaIndicador({ dias }: { dias: number }) {
  const zona: ZonaDeuda = zonaDeuda(dias);
  const texto = textoAtraso(dias);
  if (zona === "terracotta") {
    return (
      // 12 px y el mismo tracking que ui/chip.tsx: era el único chip de la
      // app por debajo del piso que ese archivo documenta, y a un brazo de
      // distancia 11 px no se leen.
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
