// "Para vos": la vista hermana de la nota.
//
// Misma cabecera que la nota —misma paciente, misma fecha, mismo chip de
// estado—, mismo selector arriba, y abajo el análisis de su propia práctica
// en esa sesión: el instrumento, las fortalezas con su cita y su minuto, las
// áreas de crecimiento y el disclaimer.
//
// LAS REGLAS QUE ESTA PANTALLA NO ROMPE (docs/diseno/04-personaje.md)
//
//   - Sin Lupita. El personaje aparece en la ayuda, en los estados vacíos,
//     en el onboarding y en las confirmaciones alegres. Esto no es ninguna
//     de las cuatro: es material sobre su trabajo clínico.
//   - Sin celebración. No hay check, no hay felicitación, no hay racha. Las
//     "Fortalezas observadas" no son un premio: son una lectura con cita
//     textual que ella puede discutir.
//   - Sin animación de entrada. Ni `Aparece` ni `ListaEnCascada`: el
//     contenido está cuando la pantalla está. Una entrada escalonada le
//     pondría ritmo de novedad a algo que se lee despacio.
//   - Con señal de riesgo en la sesión, esta vista es IDÉNTICA. No cambia el
//     tono, no se agrega un aviso, no se saca nada: el riesgo se trabaja en
//     la nota, que es donde vive su bloque y su casilla. Por eso acá no se
//     consulta `clavesDeRiesgo`: no hay ninguna rama que dependa de él, y
//     esa ausencia es la implementación de la regla.

import Link from "next/link";

import {
  FeedbackTerapeutaView,
  hayParaVos,
} from "@/components/grabacion/FeedbackTerapeutaView";
import type { SesionClinicaResponse } from "@/lib/sesion-clinica/schema";

import { CabeceraSesion } from "./cabecera-sesion";
import {
  PARA_VOS,
  PARA_VOS_SIN_ANALISIS,
  PARA_VOS_SUBTITULO,
  VISTA_NOTA,
} from "./textos";

interface ParaVosViewProps {
  sesion: SesionClinicaResponse;
  /** El selector de vista, armado por el contenedor. */
  selector?: React.ReactNode;
}

export function ParaVosView({ sesion, selector }: ParaVosViewProps) {
  const feedback = sesion.datosEstructurados?.feedbackTerapeuta;

  return (
    <div className="flex flex-col gap-6">
      <CabeceraSesion sesion={sesion} rotulo={PARA_VOS} />

      {selector}

      <p className="font-sans text-[14px] leading-[1.6] text-ink-500">
        {PARA_VOS_SUBTITULO}
      </p>

      {/* Sin análisis no queda nada abajo del subtítulo. Se dice, con el
          camino de vuelta a mano: llegar por el selector y encontrar una
          pantalla en blanco se lee como que la app se rompió. El criterio es
          el mismo que usa el componente para decidir si dibuja, así no hay
          forma de que una rama diga que hay y la otra que no. */}
      {hayParaVos(feedback) ? (
        <FeedbackTerapeutaView feedbackTerapeuta={feedback} />
      ) : (
        <SinAnalisis sesionId={sesion.id} />
      )}
    </div>
  );
}

function SinAnalisis({ sesionId }: { sesionId: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-[color:var(--border-subtle)] bg-white px-5 py-6">
      <p className="font-sans text-[14px] leading-[1.6] text-ink-700">
        {PARA_VOS_SIN_ANALISIS}
      </p>
      <Link
        href={`/sesiones/${sesionId}`}
        className="inline-flex min-h-[44px] items-center font-sans text-[14px] font-semibold text-sage-600 transition-colors duration-150 hover:text-sage-700"
      >
        {VISTA_NOTA}
      </Link>
    </div>
  );
}
