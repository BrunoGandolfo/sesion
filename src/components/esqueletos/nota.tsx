// El esqueleto de la nota clínica.
//
// Dos piezas, como en las otras dos:
//
//   EsqueletoNotaCuerpo — la nota. Es lo que usa la rama "cargando" de
//     sesion-detail-view.tsx, donde el "Volver" ya está dibujado y ya es
//     tocable: si la nota tarda, volverse tiene que seguir siendo posible.
//   EsqueletoNota — la pantalla entera, para loading.tsx.
//
// Reproduce nota-sesion-view.tsx en su orden de lectura: cabecera, resumen,
// las cuatro secciones SOAP y los plegados. Deliberadamente NO dibuja el
// bloque de riesgo: un rectángulo donde a veces va una señal de riesgo
// insinúa una señal que puede no existir, y esa es la única cosa de la app
// que no se anticipa (docs/diseno/03-plan-de-movimiento.md, D10). Cuando la
// nota llega con señal, el bloque entra empujando; es el único salto que
// vale la pena.
//
// El contenedor es el de sesion-detail-view.tsx:448 (max-w-[1120px],
// px-5 py-6 / lg:px-10 lg:py-8).

import { ABRIENDO_NOTA } from "@/lib/glosario";

import { Esqueleto, Hueco, TARJETA } from "./base";

/** Un párrafo: tres renglones, el último corto, como termina un párrafo. */
function Parrafo() {
  return (
    <div className="flex flex-col gap-2">
      <Hueco className="h-3 w-full" />
      <Hueco className="h-3 w-full" />
      <Hueco className="h-3 w-3/5" />
    </div>
  );
}

export function EsqueletoNotaCuerpo() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Hueco className="h-3 w-28" />
        <Hueco tono="fuerte" className="h-7 w-56 max-w-full lg:h-8" />
        <div className="flex items-center gap-3">
          <Hueco className="h-3.5 w-40 max-w-full" />
          <Hueco className="h-5 w-24 shrink-0 rounded-sm" />
        </div>
      </header>

      {/* El resumen va sobre crema, no sobre blanco (nota-sesion-view.tsx). */}
      <section className="rounded-lg bg-cream-100 px-4 py-4">
        <Hueco tono="fuerte" className="h-3 w-24" />
        <div className="mt-3">
          <Parrafo />
        </div>
      </section>

      {/* Las cuatro secciones SOAP, cada una con su letra y su párrafo. */}
      <div className="flex flex-col gap-6">
        {[0, 1, 2, 3].map((i) => (
          <section key={i} className="flex flex-col gap-3">
            <Hueco tono="fuerte" className="h-4 w-36 max-w-full" />
            <Parrafo />
          </section>
        ))}
      </div>

      {/* Los plegados: sólo la barra del título, porque nacen cerrados. */}
      {[0, 1].map((i) => (
        <div key={i} className={`${TARJETA} rounded-lg px-5 py-4`}>
          <div className="flex min-h-[44px] items-center justify-between gap-3">
            <Hueco tono="fuerte" className="h-4 w-44 max-w-full" />
            <Hueco className="h-4 w-4 shrink-0 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EsqueletoNota() {
  return (
    <Esqueleto
      etiqueta={ABRIENDO_NOTA}
      className="mx-auto max-w-[1120px] px-5 py-6 lg:px-10 lg:py-8"
    >
      {/* "Volver": mide 44 de alto y lleva 16 de margen abajo. */}
      <Hueco className="mb-4 h-11 w-20" />
      <EsqueletoNotaCuerpo />
    </Esqueleto>
  );
}
