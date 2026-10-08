// Progreso percibido y Observación IA de TODAS las sesiones del período, de
// la más vieja a la más nueva: en el papel queda el registro entero. La
// pantalla sigue mostrando sólo la última (LecturasDeLaUltima, graficos/).
//
// La alerta la decide el servidor, como en la pantalla (tieneSenal): una
// sesión con señal lleva la barra terracota y la misma frase de alerta en
// su progreso percibido. El texto "sin riesgo" no enciende nada.

import { tieneSenal, type SesionProgreso } from "@/app/(dashboard)/pacientes/[id]/_components/graficos/progreso-contrato";
import { OBSERVACION_IA, PROGRESO_PERCIBIDO, ULTIMA_SESION_CON_SENAL } from "@/lib/glosario";

import { dia } from "./formato";

type Campo = "progresoPercibido" | "observacionIA";

function Lista({ titulo, campo, sesiones, conAlerta }: { titulo: string; campo: Campo; sesiones: SesionProgreso[]; conAlerta: boolean }) {
  const conTexto = sesiones.filter((s) => s[campo]?.trim());
  if (conTexto.length === 0) return null;
  return (
    <section className="break-inside-avoid rounded-md border border-cream-200 bg-white p-4">
      <h3 className="mb-3 break-after-avoid font-display text-[13.5pt] font-medium leading-tight text-ink-900">{titulo}</h3>
      <ol className="flex flex-col gap-3">
        {conTexto.map((s) => {
          const alerta = conAlerta && tieneSenal(s);
          return (
            <li key={s.sesionId} className={`break-inside-avoid border-l-2 pl-3 ${alerta ? "border-terracotta-500" : "border-sage-200"}`}>
              <p className="text-[9pt] tabular-nums text-ink-500">{dia(s.fecha)}</p>
              <p className="mt-0.5 font-display text-[11pt] italic leading-[1.5] text-ink-900">«{s[campo]?.trim()}»</p>
              {alerta ? <p className="mt-1 text-[9pt] font-semibold text-terracotta-600">{ULTIMA_SESION_CON_SENAL}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function LecturasDelPeriodo({ sesiones }: { sesiones: SesionProgreso[] }) {
  const ordenadas = [...sesiones].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return (
    <>
      <Lista titulo={PROGRESO_PERCIBIDO} campo="progresoPercibido" sesiones={ordenadas} conAlerta />
      <Lista titulo={OBSERVACION_IA} campo="observacionIA" sesiones={ordenadas} conAlerta={false} />
    </>
  );
}
