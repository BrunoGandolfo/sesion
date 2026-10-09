"use client";

// Pestaña Lux. La conversación entera vive en src/components/lux/; acá solo
// se decide con qué nombres saluda y se ata a la paciente con `key`: al
// cambiar de paciente se monta de cero, sin nada de la anterior.

import { ConversacionLux } from "@/components/lux/conversacion-lux";
import { nombreDePila } from "@/components/lux/textos";
import type { Configuracion, PacienteConDeuda } from "@/types/domain";

interface LuxTabProps {
  paciente: PacienteConDeuda;
  config: Configuracion | null;
}

export function LuxTab({ paciente, config }: LuxTabProps) {
  return (
    <ConversacionLux
      key={paciente.id}
      pacienteId={paciente.id}
      paciente={paciente.nombre.trim()}
      profesional={nombreDePila(config?.nombreProfesional)}
    />
  );
}
