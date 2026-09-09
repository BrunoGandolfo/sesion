// El esqueleto neutro: un marco de pantalla y nada más.
//
// POR QUÉ EXISTE
//
// `loading.tsx` no cubre sólo a su `page.tsx`: cubre también todas las rutas
// que cuelgan debajo y no tengan uno propio. El de `(dashboard)/` alcanza
// entonces a Agenda, Tu consultorio, Grabar, deudores y finanzas.
//
// Ninguna de esas cinco tiene esqueleto propio —Agenda a propósito: ya
// cachea sus rangos y avisa "Actualizando…", y un esqueleto encima sería
// desandar eso—, así que en vez de mostrarles el dibujo de Hoy (que sería
// mentirles sobre lo que viene) se les muestra esto: el ancho y el aire de
// una pantalla del dashboard, un encabezado y dos bloques. Dice "esta
// pantalla ya empezó a llegar" sin prometer ninguna forma en particular.
//
// Si alguna de esas rutas gana un esqueleto propio, se lo pone en su carpeta
// y deja de ver éste.

import { CARGANDO_PANTALLA } from "@/lib/glosario";

import { Esqueleto, Hueco, TARJETA } from "./base";

export function EsqueletoPantalla() {
  return (
    <Esqueleto
      etiqueta={CARGANDO_PANTALLA}
      className="mx-auto flex w-full max-w-[1120px] flex-col gap-7 px-5 py-6 lg:gap-10 lg:px-10 lg:py-8"
    >
      <div className="flex flex-col gap-3">
        <Hueco className="h-3 w-28" />
        <Hueco tono="fuerte" className="h-7 w-52 max-w-full lg:h-9" />
      </div>

      {[0, 1].map((i) => (
        <div key={i} className={`${TARJETA} p-5 lg:p-6`}>
          <Hueco tono="fuerte" className="h-4 w-40 max-w-full" />
          <div className="mt-4 flex flex-col gap-2">
            <Hueco className="h-3 w-full" />
            <Hueco className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </Esqueleto>
  );
}
