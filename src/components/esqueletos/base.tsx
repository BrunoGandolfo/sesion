// Las piezas con las que se dibuja un esqueleto de pantalla.
//
// QUÉ ES UN ESQUELETO ACÁ
//
// El dibujo de la pantalla que todavía no llegó, con sus mismos bloques, sus
// mismas alturas y sus mismos anchos de columna, en gris crema. Sin texto y
// sin movimiento: no es un aviso de que algo está pasando —para eso está
// AnilloProgreso—, es el layout sosteniéndose solo mientras llegan los
// datos, para que el contenido no aparezca de golpe empujando todo.
//
// POR QUÉ NO PULSA
//
// Los esqueletos viejos de la app pulsan (`animate-pulse` en
// ContextoGoldenThreadView, HotWordsManager, ConsentimientoBadge) y
// globals.css los apaga bajo `prefers-reduced-motion: reduce`. Estos no
// pulsan nunca, ni con la preferencia apagada: es la pantalla que ella abre
// ocho a doce veces por día y un latido de fondo en cada apertura es
// exactamente el movimiento decorativo que movimiento.tsx no admite. Que
// sean quietos por construcción también los deja fuera de cualquier
// discusión de accesibilidad: no hay nada que degradar.
//
// UN ESQUELETO, DOS USOS
//
// Cada pantalla tiene UNO, y se consume dos veces:
//
//   1. desde su `loading.tsx`, que Next muestra apenas ella toca el menú
//      —sin esperar al servidor— y que además es lo que habilita el
//      prefetch de una ruta dinámica (ver docs/diseno/05-carga.md);
//   2. desde la rama "cargando" del componente cliente, que es la segunda
//      espera: la de su propio fetch.
//
// Las dos esperas se ven iguales porque son el mismo dibujo. Si alguna vez
// hay dos, se van a separar.

import * as React from "react";

/**
 * Los dos grises. Son los que ya usa el esqueleto de la ficha
 * (paciente-detail-view.tsx): `fuerte` para lo que va a ser un dato —un
 * nombre, un número, un avatar— y `suave` para lo que va a ser texto de
 * apoyo. La diferencia es la que da la jerarquía sin escribir una letra.
 */
export type TonoHueco = "fuerte" | "suave";

const FONDO: Record<TonoHueco, string> = {
  fuerte: "bg-cream-200",
  suave: "bg-cream-100",
};

/** Un bloque de gris. El alto y el ancho los pone quien lo usa, porque son
 *  los de la pieza real que va a ocupar ese lugar. */
export function Hueco({
  tono = "suave",
  className = "",
}: {
  tono?: TonoHueco;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-sm ${FONDO[tono]} ${className}`}
    />
  );
}

/** La caja blanca de una tarjeta, sin su padding: cada esqueleto reproduce
 *  el de la tarjeta que está imitando, que en esta app no es siempre el
 *  mismo (Card trae p-6, y las de Hoy lo pisan con p-0 o p-5). */
export const TARJETA =
  "rounded-[8px] border border-[color:var(--border-subtle)] bg-white";

/**
 * El envoltorio de todo esqueleto.
 *
 * Es lo único que habla: `role="status"` con una línea `sr-only` que nombra
 * la pantalla que está por llegar. Quien no ve el dibujo necesita saber QUÉ
 * está cargando, no que "algo" está cargando — por eso el texto sale del
 * glosario y es distinto por pantalla.
 *
 * Los huecos van todos con `aria-hidden`: son decoración de esa línea.
 */
export function Esqueleto({
  etiqueta,
  className = "",
  children,
}: {
  etiqueta: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{etiqueta}</span>
      {children}
    </div>
  );
}

/** Una fila de lista: avatar, dos líneas y un dato a la derecha. La misma
 *  forma de SessionRow y de la fila de Pacientes, que es la que se repite
 *  en casi todas las pantallas. */
export function FilaHueco({ conAvatar = true }: { conAvatar?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-[14px]">
      {conAvatar ? <Hueco tono="fuerte" className="h-10 w-10 rounded-full" /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <Hueco tono="fuerte" className="h-3 w-36 max-w-full" />
        <Hueco className="h-3 w-24 max-w-full" />
      </span>
      <Hueco className="h-5 w-16 shrink-0" />
    </div>
  );
}
