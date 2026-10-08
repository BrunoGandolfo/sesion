// "De un vistazo": tres o cuatro cifras sacadas de lo mismo que la hoja ya
// trae (las notas aprobadas y la versión vigente). No hay cuenta nueva ni
// dato nuevo: es la misma exportación, leída de arriba.
//
// La última señal aparece solo si hay alguna, y es la única celda en
// terracota: terracota es riesgo y nada más.

import { formatearEtiqueta } from "@/lib/etiquetas";
import { instanteDesdeFechaHoraMvd } from "@/lib/fechas-montevideo";
import { pluralizar } from "@/lib/glosario";

import { diaCorto, type Exportacion } from "./formato";

interface Cifra {
  rotulo: string;
  valor: string;
  detalle?: string;
  senal?: boolean;
}

/** Las cifras, puras: se prueban sin dibujar. */
export function cifrasDeUnVistazo(datos: Exportacion): Cifra[] {
  const contenido = datos.vigente?.contenido;
  const activos = contenido?.objetivosTerapeuticos.filter((o) => o.estado === "activo").length;
  const temas = [...(contenido?.temasRecurrentes ?? [])].sort((a, b) => b.conteo - a.conteo);
  const senales = [...(contenido?.riesgosHistoricos ?? [])].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimaSenal = senales.at(-1);

  const cifras: Cifra[] = [
    { rotulo: "Sesiones con nota", valor: String(datos.sesiones.length) },
    { rotulo: "Objetivos activos", valor: activos === undefined ? "—" : String(activos) },
    temas[0]
      ? { rotulo: "El tema que más vuelve", valor: temas[0].tema, detalle: pluralizar(temas[0].conteo, "sesión", "sesiones") }
      : { rotulo: "El tema que más vuelve", valor: "—" },
  ];
  if (ultimaSenal) {
    cifras.push({
      rotulo: "Última señal",
      // Un día del consultorio, leído a mediodía como en HiloContenido.
      valor: diaCorto(instanteDesdeFechaHoraMvd(ultimaSenal.fecha, "12:00").toISOString()),
      detalle: formatearEtiqueta(ultimaSenal.flag),
      senal: true,
    });
  }
  return cifras;
}

export function DeUnVistazo({ datos }: { datos: Exportacion }) {
  const cifras = cifrasDeUnVistazo(datos);
  return (
    <section aria-label="De un vistazo" className="mt-6 break-inside-avoid rounded-md bg-cream-100 px-5 py-4">
      <dl className={`grid gap-x-5 gap-y-3 ${cifras.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        {cifras.map((c) => (
          <div key={c.rotulo} className={`min-w-0 ${c.senal ? "border-l-2 border-terracotta-500 pl-3" : ""}`}>
            <dt className={`text-[9pt] font-semibold uppercase leading-tight tracking-[0.08em] ${c.senal ? "text-terracotta-500" : "text-ink-500"}`}>
              {c.rotulo}
            </dt>
            <dd className={`mt-1 font-display text-[16pt] font-medium leading-[1.15] text-ink-900 ${c.senal ? "whitespace-nowrap" : "break-words"}`}>{c.valor}</dd>
            {c.detalle ? <dd className="mt-0.5 text-[9pt] text-ink-500">{c.detalle}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
