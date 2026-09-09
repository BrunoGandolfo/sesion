// El esqueleto de Cobros.
//
// Dos piezas, por el mismo motivo que en Pacientes:
//
//   EsqueletoCobrosCuerpo — los dos números, el Segmented y la lista. Es lo
//     que va dentro del <Marco> en la rama "cargando" de cobros-view.tsx:
//     ahí la cabecera y el título "Cobros" ya están dibujados por el Marco
//     de verdad.
//   EsqueletoCobros — la pantalla entera, para loading.tsx.
//
// El marco reproduce cobros-view.tsx:312 (max-w-[1100px], gap-7 / lg:gap-10)
// y su cabecera: la CabeceraUsuario de mobile, la línea del mes con la regla
// editorial, y el título en 40 / 56 px de Fraunces itálica. Ese título es
// alto: sin reservarlo, todo lo de abajo salta media pantalla.

import { CARGANDO_COBROS } from "@/lib/glosario";

import { Esqueleto, Hueco, TARJETA } from "./base";

/** Los DOS números de la grilla (no cuatro: cobros-view.tsx ya los unificó). */
function DosNumeros() {
  return (
    <div className={`${TARJETA} overflow-hidden p-0`}>
      <div className="grid grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className={`min-w-0 p-4 lg:p-5 ${
              i === 0 ? "border-r border-[color:var(--border-subtle)]" : ""
            }`}
          >
            <Hueco className="h-3 w-28 max-w-full" />
            <Hueco tono="fuerte" className="mt-2 h-6 w-24 max-w-full lg:h-7" />
            <Hueco className="mt-1.5 h-3 w-20 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EsqueletoCobrosCuerpo() {
  return (
    <>
      <DosNumeros />

      <Hueco className="h-10 w-56 self-start rounded-md" />

      <div className={`${TARJETA} overflow-hidden p-0`}>
        <div className="divide-y divide-[color:var(--border-subtle)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-4">
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <Hueco tono="fuerte" className="h-3 w-36 max-w-full" />
                <Hueco className="h-3 w-24 max-w-full" />
              </span>
              <Hueco tono="fuerte" className="h-4 w-20 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function EsqueletoCobros() {
  return (
    <Esqueleto
      etiqueta={CARGANDO_COBROS}
      className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10"
    >
      <header className="flex min-w-0 flex-col gap-4">
        {/* La cabecera de usuario, sólo en mobile: acá vive el único acceso
            a "Tu consultorio" desde esta pantalla. */}
        <div className="flex items-center gap-3 py-1 lg:hidden">
          <Hueco tono="fuerte" className="h-11 w-11 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Hueco className="h-3 w-28" />
            <Hueco tono="fuerte" className="h-3.5 w-24" />
            <Hueco className="h-3 w-28" />
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex h-5 items-center gap-2">
            <Hueco tono="fuerte" className="h-[1px] w-6" />
            <Hueco className="h-3 w-32" />
          </div>
          <Hueco tono="fuerte" className="mt-3 h-9 w-48 lg:h-14 lg:w-72" />
        </div>
      </header>

      <EsqueletoCobrosCuerpo />
    </Esqueleto>
  );
}
