"use client";

// Te deben: la frase con las sesiones sin cobrar y la lista de deudoras, con
// el selector de método que cobra las sesiones marcadas en una fila.

import * as React from "react";

import { SheetMetodoPago } from "@/components/cobro/sheet-metodo-pago";
import { Card } from "@/components/ui";
import { EstadoVacio } from "@/components/ui/estado-vacio";
import { ListaEnCascada } from "@/components/ui/movimiento";
import {
  NADIE_TE_DEBE,
  NADIE_TE_DEBE_LINEAS,
  SIN_COBRAR_FRASE_FINAL,
  VER_COBROS_DEL_MES,
  pluralizar,
} from "@/lib/glosario";
import type { MetodoPago } from "@/types/domain";

import {
  cobrarSesiones,
  desenlaceDelCobro,
  errorDelCobro,
  type DeudorItem,
  type ResultadoCobro,
} from "./datos";
import { FilaDeudor } from "./fila-deudor";

/** Qué tiene abierto debajo una fila. De a una por vez en toda la lista: dos
 *  paneles abiertos son dos lugares donde tocar sin querer. */
type PanelAbierto = { pacienteId: string; modo: "pago" | "sms" } | null;

export function TeDeben({
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
  // Las sesiones marcadas que falta cobrar, mientras el selector está abierto.
  const [porCobrar, setPorCobrar] = React.useState<string[] | null>(null);
  // Cuántas se eligieron y cuántas entraron. Lo escribe `cobrar` y lo lee el
  // cierre del selector, que llega después (se sostiene lo que dura el tilde).
  const resultadoRef = React.useRef<ResultadoCobro | null>(null);

  // Cada sesión que entra sale de `porCobrar`; si una falla, el selector se
  // queda abierto con el error y reintentar cobra sólo las que faltan.
  async function cobrar(metodo: MetodoPago) {
    const ids = porCobrar ?? [];
    const resultado = resultadoRef.current ?? { registradas: 0, elegidas: ids.length };
    resultadoRef.current = resultado;
    await cobrarSesiones(ids, metodo, (id) => {
      resultado.registradas += 1;
      setPorCobrar((actual) => actual?.filter((otro) => otro !== id) ?? null);
    });
  }

  // Se cierra con todo cobrado (después del tilde) o porque ella volvió.
  function alCerrarMetodo() {
    const desenlace = desenlaceDelCobro(resultadoRef.current);
    resultadoRef.current = null;
    setPorCobrar(null);
    if (desenlace.tipo === "nada") return;
    setPanel(null);
    if (desenlace.tipo === "cobrado") onCobrado();
    else onCobroIncompleto(desenlace.mensaje, true);
  }

  if (deudores.length === 0) {
    return (
      <EstadoVacio
        // La única confirmación alegre que 04-personaje.md le permite a
        // Cobros: nadie debe nada. Lupita a 96 px, celebrando, y el círculo
        // crema crece para recibirla.
        lupita="celebra"
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
        describirError={(err) => errorDelCobro(resultadoRef.current, err)}
      />
    </div>
  );
}
