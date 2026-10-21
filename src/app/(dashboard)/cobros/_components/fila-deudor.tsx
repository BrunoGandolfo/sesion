"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Send } from "lucide-react";

import { Button, Confirmar } from "@/components/ui";
import { ApiClientError, mensajeParaElla } from "@/lib/api-client";
import {
  textoAtraso,
  textoDelCobro,
  zonaDeuda,
  type ConfiguracionDelCobro,
  type ZonaDeuda,
} from "@/lib/deudas";
import { diasEnterosMvd } from "@/lib/fechas-montevideo";
import { money } from "@/lib/format";
import {
  AVISADO,
  ENVIANDO,
  NO_SE_ANOTO_AVISO,
  RECORDAR_COBRO_TEXTOS as textos,
  RECORDAR_COBRO_TITULO,
  REGISTRAR_PAGO,
  pluralizar,
} from "@/lib/glosario";
import { formatPhoneDisplay } from "@/lib/phone";
import { enlaceWhatsapp } from "@/lib/whatsapp";

import { recordarCobro, type AvisoDeCobro, type DeudorItem } from "./datos";
import { RegistrarPago } from "./registrar-pago";

// ============================================
// La fila de una deudora: quién es, cuánto debe, cuándo se le avisó y dos
// acciones. "Registrar pago" es la principal, con el peso de un botón lleno;
// el recordatorio es un enlace de texto que abre WhatsApp con el mensaje.
// Lo que abre cada una se despliega debajo, a lo ancho: ni la lista de sesiones ni
// el mensaje entero entran al lado del botón.
// ============================================
export function FilaDeudor({
  deudor,
  configCobro,
  ahora,
  abierto,
  onAbrir,
  onElegirMetodo,
  onAvisado,
  onError,
}: {
  deudor: DeudorItem;
  /** null: no se leyó la configuración y no se ofrece el aviso. */
  configCobro: ConfiguracionDelCobro | null;
  ahora: Date;
  /** Qué panel de esta fila está desplegado; lo decide la lista. */
  abierto: "pago" | "aviso" | null;
  onAbrir: (modo: "pago" | "aviso" | null) => void;
  /** Las sesiones marcadas: abre el selector de método. */
  onElegirMetodo: (turnoIds: string[]) => void;
  onAvisado: (aviso: AvisoDeCobro) => void;
  onError: (mensaje: string) => void;
}) {
  const confirmando = abierto === "aviso";
  const setConfirmando = (valor: boolean) => onAbrir(valor ? "aviso" : null);
  const [enviando, setEnviando] = React.useState(false);
  const nombreCompleto = `${deudor.nombre} ${deudor.apellido}`;
  const telefono = deudor.telefono?.trim() ?? "";

  // El mismo texto que arma el servidor: la plantilla de Tu consultorio y la
  // misma función (textoDelCobro). Lo que ella lee acá es, carácter por
  // carácter, lo que le va a llegar a la paciente.
  const mensaje = configCobro
    ? textoDelCobro(configCobro, deudor, {
        sesiones: deudor.sesionesImpagas,
        monto: deudor.montoTotal,
      })
    : "";

  // El mismo enlace que arma el servidor.
  const enlace = enlaceWhatsapp(telefono, mensaje);

  // Guarda síncrona: `enviando` deshabilita el botón recién en el render
  // siguiente, y un doble toque abriría dos WhatsApp.
  const enCurso = React.useRef(false);

  async function enviar() {
    if (enCurso.current) return;
    enCurso.current = true;
    // WhatsApp se abre dentro del toque, antes de esperar a la red: después
    // de un await el navegador bloquea la ventana nueva.
    if (enlace) window.open(enlace, "_blank", "noopener");
    const abrioWhatsapp = enlace !== null;
    setEnviando(true);
    try {
      const aviso = await recordarCobro(deudor.pacienteId);
      setConfirmando(false);
      onAvisado(aviso);
    } catch (error) {
      // Si WhatsApp ya se abrió, lo que falló es anotarlo.
      setConfirmando(false);
      // Un 409 dice por qué no (ya no debe, no tiene teléfono): eso pesa más
      // que "no quedó anotado", aunque WhatsApp ya se abrió.
      const rechazo = error instanceof ApiClientError && error.status === 409;
      onError(abrioWhatsapp && !rechazo ? NO_SE_ANOTO_AVISO : mensajeParaElla(error));
    } finally {
      enCurso.current = false;
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
          {telefono && configCobro && abierto === null ? (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              aria-label={textos.botonPara(nombreCompleto)}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-ink-500 transition-colors duration-[var(--duration-fast)] hover:bg-cream-50 hover:text-ink-700 lg:min-h-[36px] lg:w-auto"
            >
              <Send size={14} strokeWidth={1.8} aria-hidden="true" />
              {textos.boton}
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
                {textos.destino}{" "}
                <span className="font-medium tabular-nums text-ink-700">
                  {formatPhoneDisplay(telefono)}
                </span>
              </span>
            </>
          }
          accion={textos.accion}
          enviando={enviando}
          enviandoLabel={ENVIANDO}
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
