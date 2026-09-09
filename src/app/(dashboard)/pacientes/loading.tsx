// Lo que se ve al tocar "Pacientes", antes de que el servidor conteste.
// El mismo dibujo que usa la rama "cargando" de pacientes-view.tsx: allá va
// sólo la lista (el título, el filtro y el buscador ya están y son
// tocables), acá va la pantalla entera porque todavía no hay nada.

import { EsqueletoPacientes } from "@/components/esqueletos";

export default function Loading() {
  return <EsqueletoPacientes />;
}
