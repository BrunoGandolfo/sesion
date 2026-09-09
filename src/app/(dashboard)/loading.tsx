"use client";

// La pantalla que se ve entre el toque en el menú y el primer dato.
//
// QUÉ ARREGLA
//
// El layout de este grupo declara `dynamic = "force-dynamic"`, y para una
// ruta dinámica Next sólo precarga "la ruta parcial hasta el `loading.js`
// más cercano" (node_modules/next/dist/docs/.../components/link.md, sección
// `prefetch`). Sin ningún `loading.tsx` en el proyecto no había nada que
// precargar: el toque quedaba bloqueado esperando el payload del servidor y
// durante 300 a 800 ms no se movía un pixel — ni el menú, ni el fundido, ni
// un aviso. Este archivo es lo que convierte esa pausa en una pantalla.
//
// POR QUÉ ES UN COMPONENTE CLIENTE
//
// `loading.tsx` puede serlo (lo dice la doc del archivo) y acá hace falta,
// porque este fallback no cubre sólo a Hoy: cubre a toda ruta de
// `(dashboard)` que no tenga el suyo. Pacientes, Cobros y la nota tienen
// uno propio y no llegan hasta acá; Agenda, Tu consultorio, Grabar,
// deudores y finanzas sí. Mostrarles el dibujo de Hoy sería anunciarles una
// pantalla que no es la que viene, así que se mira la ruta y sólo Hoy —que
// es `/` exacto— recibe su esqueleto; el resto recibe el neutro.
//
// El "use client" no le saca nada: el fallback se sigue precargando y se
// sigue mostrando en el acto. Y si `usePathname` llegara a devolver la ruta
// vieja en el instante del fallback, lo que se ve es el esqueleto neutro y
// medio segundo después el de Hoy que dibuja el propio dashboard.tsx: se
// degrada a lo que ya había, no a un error.

import { usePathname } from "next/navigation";

import { EsqueletoHoy, EsqueletoPantalla } from "@/components/esqueletos";

export default function Loading() {
  const pathname = usePathname();
  return pathname === "/" ? <EsqueletoHoy /> : <EsqueletoPantalla />;
}
