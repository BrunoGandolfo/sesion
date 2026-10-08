// La cabecera del documento, en la primera página: no hay portada aparte
// (una página entera de portada en un documento clínico es papel perdido).
// El nombre en Fraunces grande, una línea de datos en Jakarta, el filete
// salvia y, a la derecha, la marca chica.

import { RECORRIDO, pluralizar } from "@/lib/glosario";

import { dia, diaYHora, type Exportacion } from "./formato";

/** Encabezado que se repite en cada página impresa (el <thead> de la hoja). */
export function EncabezadoDePagina({ datos }: { datos: Exportacion }) {
  const { paciente } = datos;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-cream-200 pb-2 text-[9pt] text-ink-500">
      <span>
        {RECORRIDO} de {paciente.nombre} {paciente.apellido}
      </span>
      <span className="tabular-nums">exportado el {diaYHora(datos.exportadoEn)}</span>
    </div>
  );
}

export function CabeceraDocumento({ datos }: { datos: Exportacion }) {
  const { paciente, vigente, sesiones } = datos;
  const primera = sesiones[0];
  const ultima = sesiones.at(-1);
  const linea = [
    primera && ultima
      ? `${pluralizar(sesiones.length, "nota aprobada", "notas aprobadas")}, del ${dia(primera.fecha)} al ${dia(ultima.fecha)}`
      : "Ninguna nota aprobada todavía",
    vigente
      ? `versión ${vigente.version} vigente, ${vigente.actor === "ia" ? "propuesta aceptada" : "revisada por vos"} el ${diaYHora(vigente.resueltaEn ?? vigente.creadaEn)}`
      : "todavía no hay un Recorrido revisado",
    `exportado el ${diaYHora(datos.exportadoEn)}${datos.nombreProfesional ? ` por ${datos.nombreProfesional}` : ""}`,
  ];

  return (
    <header className="break-inside-avoid border-b-2 border-sage-500 pb-4">
      <div className="flex items-baseline justify-between gap-6">
        <p className="text-[9pt] font-semibold uppercase tracking-[0.12em] text-gold-500">{RECORRIDO}</p>
        <span className="shrink-0 font-display text-[12pt] font-medium text-sage-700">Sesión</span>
      </div>
      <h1 className="mt-1 font-display text-[28pt] font-medium leading-[1.1] tracking-[-0.01em] text-ink-900">
        {paciente.nombre} {paciente.apellido}
      </h1>
      <p className="mt-3 text-[9.5pt] leading-[1.5] text-ink-700">
        {linea.map((parte, i) => (
          <span key={i}>
            {i > 0 ? <span className="text-ink-300"> · </span> : null}
            {parte}
          </span>
        ))}
      </p>
    </header>
  );
}
