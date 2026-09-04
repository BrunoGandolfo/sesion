"use client";

import { motion, useReducedMotion } from "framer-motion";

// Transición entre rutas del dashboard.
//
// template.tsx (y no layout.tsx) porque Next remonta el template en cada
// navegación: es el único lugar donde se puede montar una entrada de página
// sin que el menú y la barra lateral se remonten con ella.
//
// Es un fundido de 180 ms, sin desplazamiento. Deslizar la página entera
// obligaría a esperar a que se frene para leer, y entre sesión y sesión el
// tiempo de lectura es de dos minutos. Lo único que aporta el fundido es
// que el cambio no sea un corte seco.
//
// El div lleva min-h-full para conservar la altura que el `main` del layout
// le daba a cada pantalla: sin eso, los fondos a pantalla completa de los
// estados vacíos se recortarían al alto del contenido.

const DURACION = 0.18;

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
      transition={{ duration: DURACION, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
