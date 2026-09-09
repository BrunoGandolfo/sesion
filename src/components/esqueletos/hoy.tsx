// El esqueleto de Hoy.
//
// Replica dashboard.tsx: el mismo contenedor (max-w-[1200px], p-5 / lg:p-14,
// gap-7 / lg:gap-10) y los mismos cinco bloques en el mismo orden — saludo,
// pendientes, AHORA, los tres números, y la grilla de dos columnas
// 1.5fr/1fr con la agenda del día y "Te deben".
//
// Las alturas salen de las piezas reales: el avatar de la cabecera mide 44
// (cabecera-usuario.tsx), el de la tarjeta de AHORA también (card-ahora.tsx),
// la hora va en 32/38 px y los números de los KPI en 26/30 (kpis.tsx).
// Si alguno cambia de tamaño, este archivo queda desfasado y hay que
// seguirlo: es el precio de que la pantalla no salte.

import { CARGANDO_HOY } from "@/lib/glosario";

import { Esqueleto, Hueco, TARJETA } from "./base";

/** El bloque de "Pendientes": tarjeta con el filo dorado y dos filas. */
function Pendientes() {
  return (
    <div className={`${TARJETA} overflow-hidden border-l-2 border-l-cream-200 p-0`}>
      <div className="divide-y divide-[color:var(--border-subtle)]">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-4">
            <Hueco tono="fuerte" className="h-4 w-4 shrink-0 rounded-sm" />
            <Hueco tono="fuerte" className="h-3 w-40 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** La tarjeta de AHORA: avatar y nombre a la izquierda, hora a la derecha,
 *  el brief debajo y una acción al pie. Es el bloque más alto de la primera
 *  pantalla y el que más se nota si no está reservado. */
function Ahora() {
  return (
    <div className={`${TARJETA} border-l-2 border-l-cream-200 p-5 lg:p-6`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Hueco tono="fuerte" className="h-11 w-11 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-col gap-2">
            <Hueco tono="fuerte" className="h-5 w-40 max-w-full" />
            <Hueco className="h-3 w-32 max-w-full" />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Hueco tono="fuerte" className="h-8 w-20" />
          <Hueco className="h-5 w-16" />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <Hueco className="h-3 w-full" />
        <Hueco className="h-3 w-4/5" />
      </div>

      <Hueco tono="fuerte" className="mt-5 h-10 w-36 rounded-md" />
    </div>
  );
}

/** Los tres números. Dos columnas en mobile y tres en desktop, igual que
 *  kpis.tsx. */
function Kpis() {
  return (
    <div className={`${TARJETA} overflow-hidden p-0`}>
      <div className="grid grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`min-w-0 border-[color:var(--border-subtle)] p-4 lg:p-5 ${
              i < 2 ? "border-r" : ""
            } ${i === 2 ? "col-span-2 border-t lg:col-span-1 lg:border-t-0" : ""}`}
          >
            <Hueco className="h-3 w-20 max-w-full" />
            <Hueco tono="fuerte" className="mt-2 h-6 w-24 max-w-full lg:h-7" />
            <Hueco className="mt-1.5 h-3 w-16 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Rótulo de sección: la regla editorial y el nombre en versalitas
 *  (titulo.tsx). Mide 12 px de alto y 12 de margen inferior. */
function Rotulo() {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Hueco tono="fuerte" className="h-[1px] w-6" />
      <Hueco className="h-3 w-28" />
    </div>
  );
}

/** Las filas de la agenda del día: hora, avatar, nombre y la acción. La
 *  misma forma que SessionRow, que es la fila más repetida de la app. */
function FilaTurno() {
  return (
    <div className="flex items-center gap-4 rounded-md border border-l-[3px] border-[color:var(--border-subtle)] border-l-cream-200 bg-white py-[14px] pl-[13px] pr-4">
      <div className="flex min-w-[52px] shrink-0 flex-col gap-1.5">
        <Hueco tono="fuerte" className="h-4 w-11" />
        <Hueco className="h-2.5 w-10" />
      </div>
      <Hueco tono="fuerte" className="h-9 w-9 shrink-0 rounded-full" />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <Hueco tono="fuerte" className="h-3 w-32 max-w-full" />
        <Hueco className="h-3 w-20 max-w-full" />
      </span>
      <Hueco className="h-6 w-20 shrink-0 rounded-md" />
    </div>
  );
}

export function EsqueletoHoy() {
  return (
    <Esqueleto
      etiqueta={CARGANDO_HOY}
      className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col gap-7 p-5 lg:gap-10 lg:p-14"
    >
      {/* Saludo: la cabecera de usuario (avatar de 44 y tres líneas) y el
          día de la semana debajo. */}
      <section className="min-w-0">
        <div className="flex items-center gap-3 py-1">
          <Hueco tono="fuerte" className="h-11 w-11 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <Hueco className="h-3 w-32" />
            <Hueco tono="fuerte" className="h-3.5 w-24" />
            <Hueco className="h-3 w-28" />
          </div>
        </div>
        <Hueco tono="fuerte" className="mt-3 h-6 w-52 max-w-full lg:h-8" />
      </section>

      <Pendientes />
      <Ahora />
      <Kpis />

      <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr] lg:gap-10">
        <section className="min-w-0">
          <Rotulo />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <FilaTurno key={i} />
            ))}
          </div>
        </section>

        <section className="min-w-0">
          <Rotulo />
          <div className={`${TARJETA} overflow-hidden p-0`}>
            <div className="divide-y divide-[color:var(--border-subtle)]">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Hueco tono="fuerte" className="h-3 w-28 flex-1" />
                  <Hueco className="h-4 w-16 shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Esqueleto>
  );
}
