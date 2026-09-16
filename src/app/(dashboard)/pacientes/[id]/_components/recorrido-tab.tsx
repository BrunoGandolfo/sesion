"use client";

// Pestaña Recorrido: el hilo (contexto longitudinal editable) y, debajo, los
// gráficos de progreso con su selector de período. Arriba, la salida a la
// hoja de impresión: un toque la abre y el diálogo del navegador se abre solo.
//
// El Suspense es por el useSearchParams del contenedor (el período vive en
// la URL): sin él, Next exige el límite de cliente al construir.

import * as React from "react";
import Link from "next/link";
import { FileDown } from "lucide-react";

import { HiloView } from "@/components/clinico/HiloView";
import { Button } from "@/components/ui";
import { EL_HILO, EXPORTAR_PDF } from "@/lib/glosario";

import { GraficosProgreso } from "./graficos/contenedor";

export function RecorridoTab({ pacienteId }: { pacienteId: string }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="-mb-4 flex justify-end">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/pacientes/${pacienteId}/recorrido/imprimir`} prefetch={false}>
            <FileDown size={16} strokeWidth={1.8} aria-hidden="true" />
            {EXPORTAR_PDF}
          </Link>
        </Button>
      </div>

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
