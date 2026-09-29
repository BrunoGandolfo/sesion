import * as React from "react";

import { Button } from "./button";
import { Card } from "./card";
import { Lupita, TAMANOS_LUPITA } from "./lupita";

/**
 * El estado vacío (o de error) de una pantalla: un disco crema con un ícono o
 * con Lupita, un titular, tres líneas y un botón.
 *
 * Había tres copias —Agenda, Cobros y Finanzas— que ya se habían separado en
 * el tamaño del disco, el nivel del titular y el borde (forense 03, P3-16).
 *
 * `lupita` pone al personaje en vez del ícono, con la pose que corresponde,
 * sólo donde docs/diseno/04-personaje.md la deja entrar (un día sin turnos,
 * nadie te debe, todavía no hay sesiones). Un error lleva ícono: Lupita no
 * tiene pose de error.
 */
export function EstadoVacio({
  icono,
  lupita,
  titulo,
  lineas,
  accion,
}: {
  icono?: React.ReactNode;
  lupita?: "saluda" | "celebra";
  titulo: string;
  lineas: readonly [string, string, string];
  accion: { label: string; onClick: () => void };
}) {
  return (
    <Card className="flex flex-col items-center rounded-[8px] px-6 py-12 text-center">
      {lupita ? (
        <span className="inline-flex h-[128px] w-[128px] items-center justify-center rounded-full bg-cream-100">
          <Lupita pose={lupita} tamano={TAMANOS_LUPITA.vacio} />
        </span>
      ) : (
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 text-sage-600">
          {icono}
        </span>
      )}
      {/* Un h2: debajo del h1 de la pantalla, es el titular de lo que hay (o no). */}
      <h2 className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-medium italic leading-tight text-ink-900">
        {titulo}
      </h2>
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
