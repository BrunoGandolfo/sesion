"use client";

import { motion, useReducedMotion } from "framer-motion";

import { DURACION_NAVEGACION, SUAVE } from "@/components/ui/movimiento";

// Transición entre rutas del dashboard.
//
// template.tsx (y no layout.tsx) porque Next remonta el template en cada
// navegación: es el único lugar donde se puede montar una entrada de página
// sin que el menú y la barra lateral se remonten con ella.
//
// Es un fundido, sin desplazamiento. Deslizar la página entera obligaría a
// esperar a que se frene para leer, y entre sesión y sesión el tiempo de
// lectura es de dos minutos. Lo único que aporta el fundido es que el cambio
// no sea un corte seco.
//
// QUÉ SE FUNDE
//
// Desde que existen los `loading.tsx`, lo que entra con este fundido es el
// esqueleto de la pantalla nueva, no la palabra "Cargando…". El cambio de
// esqueleto a contenido ocurre debajo, dentro del Suspense, y no vuelve a
// fundir: el template está por ENCIMA del boundary (la doc de loading.js dice
// que no envuelve al template de su mismo segmento), así que se monta una
// vez por navegación. La pantalla aparece una sola vez y después se llena.
//
// LA DURACIÓN NO ES DE ACÁ
//
// Eran 180 ms, contra los 260 del subrayado del menú. Los dos arrancan en el
// mismo instante y terminaban en momentos distintos, así que la pantalla se
// asentaba dos veces. Ahora los dos leen DURACION_NAVEGACION de
// movimiento.tsx, donde está el porqué del número.
//
// El div lleva min-h-full para conservar la altura que el `main` del layout
// le daba a cada pantalla: sin eso, los fondos a pantalla completa de los
// estados vacíos se recortarían al alto del contenido.

export default function TemplateDashboard({
  children,
}: {
  children: React.ReactNode;
}) {
  const reducido = useReducedMotion();

  if (reducido) {
    return <div className="min-h-full">{children}</div>;
  }

  return (
    <motion.div
      className="min-h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: DURACION_NAVEGACION, ease: SUAVE }}
    >
      {children}
    </motion.div>
  );
}
