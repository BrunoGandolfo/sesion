import { PRUEBA_AVISO, PRUEBA_CERCA, PRUEBA_TOPE } from "@/lib/glosario";
import { AVISO_GRABACIONES_RESTANTES, type EstadoPrueba } from "@/lib/limites-prueba";

// Aviso del consultorio creado por invitación, en Hoy y al grabar: que está en
// una prueba con un tope de grabaciones, cuándo se acerca y cuándo llegó.
// Sin prueba (la cuenta de quien invita) no muestra nada.
export function AvisoPrueba({ prueba, className = "" }: { prueba: EstadoPrueba | null; className?: string }) {
  if (!prueba) return null;
  const tope = prueba.restantes === 0;
  const cerca = !tope && prueba.restantes <= AVISO_GRABACIONES_RESTANTES;
  return (
    <div
      role={tope ? "alert" : "status"}
      className={`rounded-md border p-4 text-sm leading-relaxed text-ink-900 ${tope || cerca ? "border-terracotta-500/30 bg-terracotta-50" : "border-[color:var(--border-subtle)] bg-white"} ${className}`}
    >
      <p>{PRUEBA_AVISO(prueba.usadas)}</p>
      {cerca && <p className="mt-1 font-semibold">{PRUEBA_CERCA(prueba.restantes)}</p>}
      {tope && <p className="mt-1 font-semibold">{PRUEBA_TOPE}</p>}
    </div>
  );
}
