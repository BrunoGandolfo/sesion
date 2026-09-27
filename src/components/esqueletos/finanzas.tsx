// El esqueleto de Finanzas.
//
// Dos piezas, como en Cobros:
//
//   EsqueletoFinanzasCuerpo — el selector de período, "Lo que entró", las
//     barras y un bloque de números. Va dentro del <Marco> en la rama
//     "cargando" de finanzas-view.tsx, donde el título ya está dibujado.
//   EsqueletoFinanzas — la pantalla entera, para loading.tsx.
//
// El marco reproduce el de finanzas-view.tsx (max-w-[1100px], gap-7 /
// lg:gap-10) con la línea de arriba y el título de 30 px.

import { CARGANDO_FINANZAS } from "@/lib/glosario";

import { Esqueleto, Hueco, TARJETA } from "./base";

/** Doce barras de alturas distintas: la forma de "12 meses", que es el
 *  período con que abre. Clases enteras para que Tailwind las vea. */
const ALTOS = [
  "h-[40%]", "h-[65%]", "h-[50%]", "h-[80%]", "h-[70%]", "h-[55%]",
  "h-[90%]", "h-[60%]", "h-[75%]", "h-[45%]", "h-[85%]", "h-[70%]",
] as const;

export function EsqueletoFinanzasCuerpo() {
  return (
    <>
      <Hueco className="h-[54px] w-full max-w-[380px] rounded-md" />

      <div className={`${TARJETA} p-5 lg:p-6`}>
        <Hueco className="h-3 w-28" />
        <Hueco tono="fuerte" className="mt-3 h-8 w-40" />
        <div className="mt-4 flex flex-col gap-2">
          <Hueco className="h-3 w-64 max-w-full" />
          <Hueco className="h-3 w-56 max-w-full" />
        </div>
      </div>

      <div className={`${TARJETA} p-5 lg:p-6`}>
        <Hueco className="h-3 w-32" />
        <div className="mt-4 flex h-40 items-end gap-2">
          {ALTOS.map((alto, i) => (
            <Hueco key={i} tono="fuerte" className={`w-full ${alto}`} />
          ))}
        </div>
      </div>

      <div className={`${TARJETA} p-5 lg:p-6`}>
        <Hueco className="h-3 w-36" />
        <Hueco tono="fuerte" className="mt-3 h-6 w-32" />
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Hueco key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </>
  );
}

export function EsqueletoFinanzas() {
  return (
    <Esqueleto
      etiqueta={CARGANDO_FINANZAS}
      className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-10"
    >
      <header className="min-w-0">
        <div className="flex h-5 items-center gap-2">
          <Hueco tono="fuerte" className="h-[1px] w-6" />
          <Hueco className="h-3 w-20" />
        </div>
        <Hueco tono="fuerte" className="mt-3 h-8 w-40" />
      </header>

      <EsqueletoFinanzasCuerpo />
    </Esqueleto>
  );
}
