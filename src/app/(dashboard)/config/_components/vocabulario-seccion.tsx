"use client";

// Vocabulario: la sección de "Tu consultorio" donde ella carga las palabras
// que la transcripción tiene que escuchar bien.
//
// Es un archivo propio y no un bloque más dentro de config-view.tsx a
// propósito: ese componente ya tiene 900 líneas y es el más complejo del
// repo, así que lo que se suma a la pantalla se suma al lado, no adentro.
// config-view solo la monta, como monta cualquier otra sección.
//
// Los dos scopes que se administran acá son los de la cuenta —lo global y lo
// de ella—. El vocabulario de una paciente es de esa paciente y vive en su
// ficha: acá no tendría cómo elegirse a quién pertenece.
//
// Van plegados y cerrados: son listas largas y esta pantalla se abre para
// cambiar una tarifa o un recordatorio mucho más seguido que para editar
// vocabulario.

import { Plegable } from "@/components/ui";
import { HotWordsManager } from "@/components/grabacion/HotWordsManager";
import {
  VOCABULARIO,
  VOCABULARIO_AYUDA,
  VOCABULARIO_GLOBAL,
  VOCABULARIO_GLOBAL_AYUDA,
  VOCABULARIO_PROFESIONAL,
  VOCABULARIO_PROFESIONAL_AYUDA,
} from "@/lib/glosario";

import { TituloSeccion } from "./titulo-seccion";

export function VocabularioSeccion() {
  return (
    <section>
      <TituloSeccion>{VOCABULARIO}</TituloSeccion>
      <p className="mb-3 text-[12px] leading-[1.5] text-ink-500">
        {VOCABULARIO_AYUDA}
      </p>
      <div className="flex flex-col gap-3">
        <Plegable titulo={VOCABULARIO_GLOBAL} ayuda={VOCABULARIO_GLOBAL_AYUDA}>
          <HotWordsManager scope="global" />
        </Plegable>
        <Plegable
          titulo={VOCABULARIO_PROFESIONAL}
          ayuda={VOCABULARIO_PROFESIONAL_AYUDA}
        >
          <HotWordsManager scope="profesional" />
        </Plegable>
      </div>
    </section>
  );
}
