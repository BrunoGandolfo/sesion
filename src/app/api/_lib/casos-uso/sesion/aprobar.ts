// Aprobar la nota: revision → aprobada.
//
// En UNA transacción: nota final (la editada, o la de la IA si no editó),
// comentarios, fecha y los dos trabajos que nacen de aprobar: `borrar_audio_r2` (si hay audio) e
// `integrar_contexto` (la propuesta al Recorrido, diseño 04). El request no
// llama a R2 ni a nadie: o quedan todas las escrituras, o ninguna.
//
// Precondiciones de producto (400, antes de escribir):
//   - riesgo graduado moderado/alto ⇒ `confirmoRiesgo`;
//   - menciones léxicas con el modelo en `ninguno` o sin graduar ⇒
//     `confirmoMenciones` (diseño 04 §2.9: "Leí las menciones").

import { cifrarSesion } from "@/lib/prisma-encryption";
import { normalizarRiesgo } from "@/lib/sesion-clinica/normalizar";
import { prefijoAudio } from "@/lib/sesion-clinica/estados";
import {
  parseDatosEstructurados,
  type NotaSoap,
} from "@/lib/sesion-clinica/schema";

import { registrarAuditoria } from "../../auditoria";
import { hashTexto } from "../../auditoria-pura";
import { ApiError } from "../../responses";
import type { FilaSesionClinica } from "../../sesion-clinica";
import { crearTrabajo } from "../trabajos/crear";

import { leerSesion } from "./leer";
import { transicionar, type ClienteTransaccional } from "./transicion";

export interface AprobarSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  generacion: number;
  notaEditada?: NotaSoap;
  notasEdicion?: string;
  confirmoRiesgo?: boolean;
  confirmoMenciones?: boolean;
  ahora?: Date;
}

/** Cuántas menciones léxicas trae `datos`, o 0. */
function cantidadMenciones(datos: ReturnType<typeof parseDatosEstructurados>): number {
  return datos?.riesgoLexico?.coincidencias.length ?? 0;
}

export async function aprobarSesion({
  prisma,
  sesionId,
  organizationId,
  usuarioId,
  generacion,
  notaEditada,
  notasEdicion,
  confirmoRiesgo,
  confirmoMenciones,
  ahora = new Date(),
}: AprobarSesionInput): Promise<FilaSesionClinica> {
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: {
      id: true,
      estado: true,
      generacion: true,
      audioEstado: true,
      // Campos lógicos: la extensión los descifra al leer.
      notaIa: true,
      datos: true,
      turno: { select: { pacienteId: true } },
    },
  });
  if (!existente) throw new ApiError("Sesión clínica no encontrada", 404);
  if (existente.estado !== "revision") {
    throw new ApiError("Solo se puede aprobar una nota en revisión", 409);
  }

  if (existente.generacion !== generacion) {
    throw new ApiError("La nota cambió. Revisá la nota actual antes de aprobar; tu borrador se conserva en esta pantalla.", 409);
  }

  const notaFinal = notaEditada ?? existente.notaIa;
  if (!notaFinal) {
    throw new ApiError("La sesión no tiene una nota para aprobar", 409);
  }

  const datos = parseDatosEstructurados(existente.datos);
  const riesgo = normalizarRiesgo(datos?.riesgoDetectado);
  const nivelExigeConfirmacion =
    riesgo.nivel === "alto" || riesgo.nivel === "moderado";
  if (nivelExigeConfirmacion && confirmoRiesgo !== true) {
    throw new ApiError(
      `La nota tiene una señal de riesgo (nivel ${riesgo.nivel}): confirmá que la revisaste antes de aprobar`,
      400,
    );
  }
  const menciones = cantidadMenciones(datos);
  const mencionesExigenConfirmacion = menciones > 0 && !nivelExigeConfirmacion;
  if (mencionesExigenConfirmacion && confirmoMenciones !== true) {
    throw new ApiError(
      "La transcripción tiene menciones a revisar: confirmá que las leíste antes de aprobar",
      400,
    );
  }

  const pacienteId = existente.turno.pacienteId;
  const conAudio = existente.audioEstado === "en_r2";

  const trabajos = await prisma.$transaction(async (tx) => {
    await transicionar({
      prisma: tx,
      operacion: "aprobar",
      condiciones: { generacion },
      conflicto: "La nota cambió. Revisá la nota actual antes de aprobar; tu borrador se conserva en esta pantalla.",
      sesionId,
      organizationId,
      data: {
        aprobadaEn: ahora,
        ...cifrarSesion(sesionId, {
          notaFinal,
          notasEdicion: notasEdicion ?? null,
          audioClave: null,
        }),
      },
    });

    const creados: string[] = [];
    if (conAudio) {
      await crearTrabajo({
        prisma: tx,
        tipo: "borrar_audio_r2",
        payload: {
          prefijo: prefijoAudio(organizationId, sesionId),
          indices: [0],
        },
        organizationId,
        sesionId,
        pacienteId,
      });
      creados.push("borrar_audio_r2");
    }
    await crearTrabajo({
      prisma: tx,
      tipo: "integrar_contexto",
      payload: { sesionId, pacienteId },
      organizationId,
      sesionId,
      pacienteId,
    });
    creados.push("integrar_contexto");
    return creados;
  });

  const sesion = await leerSesion(prisma, sesionId, organizationId);

  await registrarAuditoria(prisma, {
    organizationId,
    actorTipo: "usuario",
    actorId: usuarioId,
    accion: "sesion.aprobar",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: {
      confirmoRiesgo: confirmoRiesgo === true,
      confirmoMenciones: confirmoMenciones === true,
      nivelRiesgo: riesgo.nivel,
      menciones,
      notaEditada: notaEditada !== undefined,
      // Solo el hash: permite probar después que lo aprobado es exactamente
      // esto, sin copiar texto clínico al registro.
      hashNotaAprobada: hashTexto(JSON.stringify(notaFinal)),
      trabajos,
    },
  });

  return sesion;
}
