"use client";

// Las caras de una sesión, en un solo control: la nota clínica, "Para vos" y
// la transcripción (la tercera, que llegó después: el servidor ya la
// entregaba y no había cómo abrirla).
//
// POR QUÉ UN SELECTOR Y NO UN ENLACE
//
// "Para vos" era un plegable cerrado al pie de la nota, seis pantallas de
// scroll abajo, con un comentario que decía que "no es lo que vino a leer".
// Es exactamente al revés: es lo primero que ella busca cuando termina una
// sesión. Un enlace más, en una pantalla que ya mide siete pantallas, se
// habría perdido igual. Un selector arriba de todo dice que son dos, que
// están al mismo nivel, y que la otra existe aunque no la esté mirando.
//
// POR QUÉ Segmented
//
// Es el control de dos o tres opciones de la app (las pestañas de la ficha,
// el filtro de Pacientes, las dos listas de Cobros). Reusarlo hace que
// cambiar de cara de la sesión se sienta como cambiar de pestaña en la
// ficha, que es lo que es. No se agrega ningún control nuevo.
//
// Navega en vez de mostrar y ocultar: cada vista tiene URL propia, así el
// botón de volver del teléfono hace lo que ella espera y "Para vos" se puede
// enlazar desde afuera (el aviso de después de aprobar, la fila de la ficha).
//
// LO QUE ESTE CONTROL YA NO ROMPE
//
// El texto que ella corrige en una nota en revisión sólo se escribe al
// aprobar. Mientras cada cara era una página con su propio contenedor,
// cambiar de cara desmontaba la nota y lo borraba, y por eso este control
// preguntaba antes ("Ir igual"). Desde que las tres caras cuelgan del
// contenedor de sesiones/[id]/layout.tsx, el borrador sigue ahí al volver:
// cambiar de cara navega directo. Lo que sí lo pierde es irse de la sesión,
// y eso lo cuida sesion-detail-view con useProtegerTrabajo en cualquier cara.

import { useRouter } from "next/navigation";

import { Segmented } from "@/components/ui";

import { PARA_VOS, SELECTOR_VISTA_SESION, TRANSCRIPCION, VISTA_NOTA } from "./textos";

/** Cuál de las caras se está mirando. */
export type VistaSesion = "nota" | "para-vos" | "transcripcion";

export function hrefDeVista(id: string, vista: VistaSesion): string {
  return vista === "nota" ? `/sesiones/${id}` : `/sesiones/${id}/${vista}`;
}

interface SelectorVistaProps {
  id: string;
  vista: VistaSesion;
}

export function SelectorVista({ id, vista }: SelectorVistaProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <Segmented<VistaSesion>
        ariaLabel={SELECTOR_VISTA_SESION}
        value={vista}
        onChange={(siguiente) => {
          if (siguiente === vista) return;
          router.push(hrefDeVista(id, siguiente));
        }}
        options={[
          { value: "nota", label: VISTA_NOTA },
          { value: "para-vos", label: PARA_VOS },
          { value: "transcripcion", label: TRANSCRIPCION },
        ]}
      />
    </div>
  );
}
