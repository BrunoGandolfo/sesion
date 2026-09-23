// "Para vos": la vista hermana de la nota.
//
// Misma cabecera que la nota —misma paciente, misma fecha, mismo chip de
// estado—, mismo selector arriba, y abajo el análisis de su propia práctica
// en esa sesión: las fortalezas con su cita y su minuto, las áreas de
// crecimiento y la observación general; después, plegado, el instrumento y
// su puntaje; al pie, el disclaimer.
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
import { Button } from "@/components/ui";
import { FEEDBACK_ESTADO_LABEL, FEEDBACK_PEDIR, FEEDBACK_REINTENTAR, FEEDBACK_PIDIENDO, FEEDBACK_ESPERA, FEEDBACK_NO_DISPONIBLE } from "@/lib/glosario";

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
  onReintentar?: () => void;
  pidiendo?: boolean;
  error?: string | null;
  onActualizar?: () => void;
}

export function ParaVosView({ sesion, selector, onReintentar, pidiendo = false, error, onActualizar }: ParaVosViewProps) {
  const feedback = sesion.feedback;

  return (
    <div className="flex flex-col gap-6">
      <CabeceraSesion sesion={sesion} rotulo={PARA_VOS} />

      {selector}

      <p className="font-sans text-[14px] leading-[1.6] text-ink-500">
        {PARA_VOS_SUBTITULO}
      </p>

      {hayParaVos(feedback) ? (
        <FeedbackTerapeutaView feedbackTerapeuta={feedback} />
      ) : (
        <SinAnalisis sesion={sesion} onReintentar={onReintentar} pidiendo={pidiendo} error={error} onActualizar={onActualizar} />
      )}
    </div>
  );
}

function SinAnalisis({ sesion, onReintentar, pidiendo, error, onActualizar }: ParaVosViewProps) {
  const estado = sesion.feedbackEstado;
  const pendiente = estado === "pendiente";
  const puedePedir = (estado === "no_pedido" || estado === "fallido") && sesion.modeloAsr !== null;
  return (
    <section className="flex flex-col items-start gap-4 rounded-lg border border-[color:var(--border-subtle)] border-t-2 border-t-sage-500 bg-white px-5 py-6" aria-label={PARA_VOS}>
      <p className="font-display text-xl text-ink-900" role="status">{FEEDBACK_ESTADO_LABEL[estado]}</p>
      <p className="text-sm leading-relaxed text-ink-700">{pendiente ? FEEDBACK_ESPERA : estado === "listo" ? FEEDBACK_NO_DISPONIBLE : PARA_VOS_SIN_ANALISIS}</p>
      {error && <p role="alert" className="text-sm text-terracotta-600">{error}</p>}
      {puedePedir && onReintentar && <Button onClick={onReintentar} disabled={pidiendo}>{pidiendo ? FEEDBACK_PIDIENDO : estado === "fallido" ? FEEDBACK_REINTENTAR : FEEDBACK_PEDIR}</Button>}
      {pendiente && error && onActualizar && <Button variant="secondary" onClick={onActualizar}>Actualizar estado</Button>}
      <Link href={`/sesiones/${sesion.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-sage-700 hover:underline">{VISTA_NOTA}</Link>
    </section>
  );
}
