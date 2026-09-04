// Los dos estados de la pantalla de Hoy antes de tener datos. En minúscula
// y sin spinner: es medio segundo, no un proceso.

import { Button } from "@/components/ui";
import { ALGO_FALLO } from "@/lib/glosario";

export function Cargando() {
  return (
    <div
      aria-busy="true"
      className="mx-auto w-full max-w-[1200px] p-5 text-[13px] text-ink-500 lg:p-14"
    >
      cargando tu día…
    </div>
  );
}

export function FalloDeCarga({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col items-center justify-center gap-4 p-10 text-center">
      <p className="font-[family-name:var(--font-display)] text-[22px] font-medium italic text-ink-900">
        {ALGO_FALLO}
      </p>
      <Button variant="secondary" size="sm" onClick={onReintentar}>
        Reintentar
      </Button>
    </div>
  );
}
