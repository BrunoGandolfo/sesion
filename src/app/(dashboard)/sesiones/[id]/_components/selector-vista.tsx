"use client";

// Las dos caras de una sesión, en un solo control: la nota clínica y
// "Para vos".
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
// LO QUE ESTE CONTROL PUEDE ROMPER, Y CÓMO NO LO ROMPE
//
// El texto que ella corrige en una nota en revisión vive en el estado de la
// pantalla y sólo se escribe al aprobar. Navegar desmonta esa pantalla: si
// tocara "Para vos" con correcciones a medio hacer, se perderían sin que
// nada lo dijera. Antes ese riesgo no existía —desde la nota no había a
// dónde ir— y lo creó este selector.
//
// Por eso, con cambios sin aprobar, tocar la otra opción NO navega: abre el
// Confirmar de la app y sólo "Ir igual" navega. Sin cambios, navega directo:
// una confirmación que aparece siempre se aprende a saltear, y entonces deja
// de proteger nada. Quien sabe si hay cambios es el contenedor, que tiene la
// nota editada y la nota de la fila; acá sólo llega la respuesta.

import * as React from "react";
import { useRouter } from "next/navigation";

import { Segmented } from "@/components/ui";

import { ConfirmarSalida } from "./confirmar-salida";
import { PARA_VOS, SELECTOR_VISTA_SESION, VISTA_NOTA } from "./textos";

/** Cuál de las dos caras se está mirando. */
export type VistaSesion = "nota" | "para-vos";

export function hrefDeVista(id: string, vista: VistaSesion): string {
  return vista === "para-vos" ? `/sesiones/${id}/para-vos` : `/sesiones/${id}`;
}

interface SelectorVistaProps {
  id: string;
  vista: VistaSesion;
  /** Hay correcciones en la nota que todavía no se aprobaron. Sólo puede ser
   *  true estando en la nota, en revisión. */
  tieneCambios?: boolean;
}

export function SelectorVista({
  id,
  vista,
  tieneCambios = false,
}: SelectorVistaProps) {
  const router = useRouter();
  // La vista a la que se quiso ir y todavía no se fue: lo que el Confirmar
  // está preguntando.
  const [pendiente, setPendiente] = React.useState<VistaSesion | null>(null);

  const ir = (destino: VistaSesion) => {
    setPendiente(null);
    router.push(hrefDeVista(id, destino));
  };

  return (
    <div className="flex flex-col gap-3">
      <Segmented<VistaSesion>
        ariaLabel={SELECTOR_VISTA_SESION}
        value={vista}
        onChange={(siguiente) => {
          if (siguiente === vista) return;
          if (tieneCambios) {
            setPendiente(siguiente);
            return;
          }
          ir(siguiente);
        }}
        options={[
          { value: "nota", label: VISTA_NOTA },
          { value: "para-vos", label: PARA_VOS },
        ]}
      />

      {pendiente !== null ? (
        <ConfirmarSalida
          onConfirmar={() => ir(pendiente)}
          onCancelar={() => setPendiente(null)}
        />
      ) : null}
    </div>
  );
}
