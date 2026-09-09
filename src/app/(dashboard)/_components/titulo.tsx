// Rótulo de sección de la pantalla de Hoy: la regla editorial, el nombre en
// versalitas y, a la derecha, la acción de la sección.
//
// 12 px y no 10: es el piso que declara chip.tsx y que estos rótulos
// rompían. A un brazo de distancia, 10 px en versalitas con tracking no se
// leen —y quien mira esta pantalla tiene 52 años—.

import * as React from "react";

import { EditorialRule } from "@/components/ui";

export function Titulo({
  children,
  accion,
}: {
  children: React.ReactNode;
  accion?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-500">
        <EditorialRule />
        <span>{children}</span>
      </div>
      {accion}
    </div>
  );
}
