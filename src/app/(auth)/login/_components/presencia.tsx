// La mitad institucional de la pantalla de entrada: quién es esto y qué
// hace. La otra mitad es el formulario.
//
// POR QUÉ ESTÁ SEPARADO DE page.tsx
//
// page.tsx es "use client" porque el formulario tiene estado y llama a
// signIn(). Esto no tiene estado ni handlers: es texto y un SVG. Separado,
// se renderiza en el servidor y no viaja al navegador.
//
// LO QUE NO LLEVA
//
// - Lupita. La entrada es institucional y 04-personaje.md fija sus cuatro
//   contextos —ayuda, estados vacíos, onboarding, confirmaciones alegres—;
//   ninguno es éste. Además ahí no hay nada que explicar todavía.
// - Imágenes. La marca es el mismo SVG que dibuja el ícono de la app
//   (src/app/_marca.tsx), así que el cuadrado salvia que ella ve acá es
//   idéntico al que toca en la pantalla de inicio del teléfono. Ninguna
//   captura de producto, ninguna foto: el fondo crema plano es el mismo
//   sobre el que después se lee la nota clínica.

import { Marca, medidasPara } from "@/app/_marca";
import {
  ENTRADA_AFIRMACIONES,
  ENTRADA_CONFIDENCIALIDAD,
  ENTRADA_QUE_HACE,
  ESLOGAN,
  NOMBRE_PRODUCTO,
} from "@/lib/glosario";

/** El lado del cuadrado de la marca. 52 px es donde la cuenta chica del
 *  dibujo todavía sobresale del hilo con claridad —el problema que
 *  MEDIDAS_CHICAS corrige a 32 px no existe acá— y es también el tamaño al
 *  que se ve un ícono instalado. */
const LADO_MARCA = 52;

export function Presencia() {
  return (
    <section className="flex flex-col">
      <div className="flex items-center gap-4">
        <Marca lado={LADO_MARCA} medidas={medidasPara(LADO_MARCA)} />
        <div className="flex flex-col gap-[6px]">
          <h1 className="font-[family-name:var(--font-display)] text-[34px] font-medium leading-none tracking-[-0.015em] text-ink-900 lg:text-[40px]">
            {NOMBRE_PRODUCTO}
          </h1>
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-sage-500">
            {ESLOGAN}
          </p>
        </div>
      </div>

      <p className="mt-7 max-w-[30ch] text-[17px] leading-[1.45] text-ink-700 lg:mt-9 lg:text-[19px]">
        {ENTRADA_QUE_HACE}
      </p>

      {/* Tres afirmaciones, tres puntos del mismo tamaño. No crecen ni se
          unen con un hilo aunque la marca esté hecha de eso: acá no hay
          ninguna progresión que contar entre una y otra, y un movimiento o
          una jerarquía que no significan nada se sacan
          (docs/diseno/02-referencias.md, principio 8). */}
      <ul className="mt-8 flex flex-col gap-[14px] lg:mt-10">
        {ENTRADA_AFIRMACIONES.map((afirmacion) => (
          <li key={afirmacion} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-[8px] h-[5px] w-[5px] shrink-0 rounded-full bg-sage-500"
            />
            <span className="max-w-[34ch] text-[15px] leading-[1.5] text-ink-700">
              {afirmacion}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-8 max-w-[42ch] border-t border-[color:var(--border-subtle)] pt-5 text-[13px] leading-[1.5] text-ink-500 lg:mt-10">
        {ENTRADA_CONFIDENCIALIDAD}
      </p>
    </section>
  );
}
