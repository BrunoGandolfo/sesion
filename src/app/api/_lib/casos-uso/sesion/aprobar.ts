// Aprobar la nota: revision → aprobada.
//
// En UNA transacción: nota final (la editada, o la de la IA si no editó),
// comentarios, fecha, destrucción de la clave del audio (crypto-shredding:
// aunque el borrado en R2 tarde, el audio ya no se puede abrir) y los dos
// trabajos que nacen de aprobar: `borrar_audio_r2` (si hay audio) e
// `integrar_contexto` (la propuesta al Recorrido, diseño 04). El request no
// llama a R2 ni a nadie: o quedan todas las escrituras, o ninguna.
//
// Precondiciones de producto (400, antes de escribir):
//   - riesgo graduado moderado/alto ⇒ `confirmoRiesgo`;
//   - menciones léxicas con el modelo en `ninguno` o sin graduar ⇒
//     `confirmoMenciones` (diseño 04 §2.9: "Leí las menciones").

import {
  normalizarRiesgo,
} from "@/lib/sesion-clinica/normalizar";
import { prefijoAudio } from "@/lib/sesion-clinica/estados";
import {
  parseDatosEstructurados,
  type NotaSoap,
} from "@/lib/sesion-clinica/schema";

import { hashTexto, type EventoAuditoriaInput } from "../../auditoria-pura";
import { ApiError } from "../../responses";
import type { FilaSesionClinica } from "../../sesion-clinica";
import { crearTrabajo } from "../trabajos/crear";

import { cifrarSesion, descifrarSesion } from "./cifrado";
import { leerSesion } from "./leer";
import { transicionar, type ClienteTransaccional } from "./transicion";

export interface AprobarSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  usuarioId: string;
  notaEditada?: NotaSoap;
  notasEdicion?: string;
  confirmoRiesgo?: boolean;
  confirmoMenciones?: boolean;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
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
  notaEditada,
  notasEdicion,
  confirmoRiesgo,
  confirmoMenciones,
  registrarAuditoria,
  ahora = new Date(),
}: AprobarSesionInput): Promise<FilaSesionClinica> {
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId },
    select: {
      id: true,
      estado: true,
      audioEstado: true,
      notaIaEncrypted: true,
      datosEncrypted: true,
      turno: { select: { pacienteId: true } },
      segmentos: { select: { indice: true }, orderBy: { indice: "asc" } },
    },
  });
  if (!existente) throw new ApiError("Sesión clínica no encontrada", 404);
  if (existente.estado !== "revision") {
    throw new ApiError("Solo se puede aprobar una nota en revisión", 409);
  }

  const campos = descifrarSesion(existente.id, existente);
  const notaFinal = notaEditada ?? campos.notaIa ?? null;
  if (!notaFinal) {
    throw new ApiError("La sesión no tiene una nota para aprobar", 409);
  }

  const datos = parseDatosEstructurados(campos.datos);
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
          indices: existente.segmentos.map((s) => s.indice),
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

  await registrarAuditoria({
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
