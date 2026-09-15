"use client";

// Pestaña Recorrido: el hilo (contexto longitudinal editable) y, debajo, los
// gráficos de progreso con su selector de período.
//
// El Suspense es por el useSearchParams del contenedor (el período vive en
// la URL): sin él, Next exige el límite de cliente al construir.

import * as React from "react";

import { HiloView } from "@/components/clinico/HiloView";
import { EL_HILO } from "@/lib/glosario";

import { GraficosProgreso } from "./graficos/contenedor";

export function RecorridoTab({ pacienteId }: { pacienteId: string }) {
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="el-hilo-heading">
        <h2 id="el-hilo-heading" className="sr-only">
          {EL_HILO}
        </h2>
        <HiloView key={pacienteId} pacienteId={pacienteId} />
      </section>

      <React.Suspense fallback={null}>
        <GraficosProgreso pacienteId={pacienteId} />
      </React.Suspense>
    </div>
  );
}
