// El esqueleto de Pacientes.
//
// Se compone en dos piezas porque la pantalla espera dos veces y en cada una
// hay dibujado distinto en pantalla:
//
//   EsqueletoListaPacientes — sólo la lista. Es lo que usa la rama
//     "cargando" de pacientes-view.tsx, donde el título, el Segmented y el
//     buscador YA están dibujados y son tocables: reemplazarlos por gris
//     sería un paso atrás.
//   EsqueletoPacientes — la pantalla entera (el marco más la lista). Es lo
//     que usa loading.tsx, donde todavía no hay nada.
//
// La lista es la MISMA en los dos casos. El marco no se duplica: cuando
// existe de verdad, se usa el de verdad.
//
// La grilla de la tabla de desktop es la de pacientes-view.tsx:346
// (1.8fr 1fr 110px 1fr 120px 24px). Si cambia allá, cambia acá.

import { CARGANDO_PACIENTES } from "@/lib/glosario";

import { Esqueleto, FilaHueco, Hueco } from "./base";

const COLUMNAS = "grid-cols-[1.8fr_1fr_110px_1fr_120px_24px]";

/** La caja blanca con la tabla de desktop y la lista de mobile. Vino tal
 *  cual del `PacientesSkeleton` que vivía dentro de pacientes-view.tsx. */
export function EsqueletoListaPacientes() {
  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white">
      <div
        className={`hidden gap-4 border-b border-[color:var(--border-subtle)] bg-cream-50 px-5 py-3 lg:grid ${COLUMNAS}`}
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <Hueco key={index} tono="fuerte" className="h-3" />
        ))}
      </div>
      <div className="divide-y divide-[color:var(--border-subtle)]">
        {Array.from({ length: 6 }).map((_, index) => (
          <FilaHueco key={index} />
        ))}
      </div>
    </div>
  );
}

/** La pantalla entera: el marco de pacientes-view.tsx (título de mobile,
 *  Segmented, buscador) más la lista. */
export function EsqueletoPacientes() {
  return (
    <Esqueleto
      etiqueta={CARGANDO_PACIENTES}
      className="mx-auto max-w-[1120px] px-5 py-6 lg:px-10 lg:py-8"
    >
      <Hueco tono="fuerte" className="mb-4 h-8 w-40 lg:hidden" />

      <div className="mb-5 flex items-center justify-between gap-3">
        <Hueco className="h-10 w-52 rounded-md" />
        <Hueco tono="fuerte" className="hidden h-9 w-40 rounded-md lg:block" />
      </div>

      {/* El buscador mide 44 de alto: es el mínimo táctil que usa Input. */}
      <Hueco className="mb-5 h-11 w-full rounded-sm" />

      <EsqueletoListaPacientes />
    </Esqueleto>
  );
}
