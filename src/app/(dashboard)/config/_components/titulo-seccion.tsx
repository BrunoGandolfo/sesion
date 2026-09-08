// El rótulo de cada sección de "Tu consultorio".
//
// Vivía dentro de config-view.tsx. Salió cuando "Vocabulario" pasó a ser una
// sección hermana en su propio archivo: las dos tienen que rotularse igual, y
// la alternativa era exportarlo desde un componente de 900 líneas o copiar el
// h2. Es solo estilo, no tiene estado.

import { EditorialRule } from "@/components/ui";

export function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
      <EditorialRule />
      <span>{children}</span>
    </h2>
  );
}
