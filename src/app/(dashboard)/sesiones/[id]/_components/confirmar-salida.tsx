"use client";

// La pregunta que se hace antes de irse de una nota con correcciones sin
// aprobar.
//
// El texto que ella edita vive en el estado de la pantalla y sólo se escribe
// al aprobar (sesion-detail-view.tsx). Cualquier cosa que desmonte esa
// pantalla lo borra, así que las salidas preguntan antes. Hay dos, y las dos
// usan este componente para preguntar con las mismas palabras y los mismos
// dos botones: el selector de vista y el botón "Volver".
//
// El mensaje no nombra el destino a propósito: es el mismo aviso se vaya a
// "Para vos" o se vaya para atrás, y una sola frase se aprende una vez.
//
// "Ir igual" es lo que descarta el trabajo, así que es el botón en
// terracotta; "Quedarme" se lleva el foco al abrir, como en todas las
// confirmaciones de la app (ui/confirmar.tsx).

import { Confirmar } from "@/components/ui";

import {
  CAMBIOS_SIN_APROBAR_MENSAJE,
  CAMBIOS_SIN_APROBAR_TITULO,
  IR_IGUAL,
  QUEDARME,
} from "./textos";

interface ConfirmarSalidaProps {
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarSalida({
  onConfirmar,
  onCancelar,
}: ConfirmarSalidaProps) {
  return (
    <Confirmar
      titulo={CAMBIOS_SIN_APROBAR_TITULO}
      mensaje={CAMBIOS_SIN_APROBAR_MENSAJE}
      accion={IR_IGUAL}
      cancelar={QUEDARME}
      variante="peligro"
      onConfirmar={onConfirmar}
      onCancelar={onCancelar}
    />
  );
}
