"use client";

// Pestaña Recorrido: el hilo (contexto longitudinal editable) y, debajo,
// los gráficos de progreso, plegados hasta la tercera sesión.

import { ContextoGoldenThreadView } from "@/components/clinico/ContextoGoldenThreadView";
import { EL_HILO } from "@/lib/glosario";

import { GraficosProgreso } from "./graficos/contenedor";

export function RecorridoTab({ pacienteId }: { pacienteId: string }) {
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="el-hilo-heading">
        <h2 id="el-hilo-heading" className="sr-only">
          {EL_HILO}
        </h2>
        <ContextoGoldenThreadView pacienteId={pacienteId} />
      </section>

      <GraficosProgreso pacienteId={pacienteId} />
    </div>
  );
}
