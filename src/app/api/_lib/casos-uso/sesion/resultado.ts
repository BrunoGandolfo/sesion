// Resultado del worker sobre una sesión, siempre con el intento vigente en
// el WHERE (409 si no lo es: un intento viejo no pisa nada).
//
//   - nota: procesando → revision. Escribe la nota IA y los datos de ESTA
//     generación (generacion += 1; la anterior queda reemplazada, no
//     borrada), modelos, consumo; suelta el lease y anula el ticket. En la
//     misma transacción "Para vos" pasa a `pendiente` y nace el trabajo
//     `generar_feedback` (esquema §2, punto 14).
//   - fallo transitorio: sigue en procesando con fallos_seguidos += 1 y
//     backoff; el reclamo siguiente la vuelve a entregar, o la agota.
//   - fallo definitivo: procesando → fallida con código y detalle.
//
// Qué es transitorio y qué definitivo lo decide el worker (Área 4); acá sólo
// se aplica la política.

import { backoffSesionMs } from "@/lib/sesion-clinica/estados";
import type { ResultadoSesion } from "@/lib/sesion-clinica/schema";
import type { Prisma } from "@prisma/client";

import type { EventoAuditoriaInput } from "../../auditoria-pura";
import { ApiError } from "../../responses";
import { crearTrabajo } from "../trabajos/crear";

import { cifrarSesion } from "@/lib/prisma-encryption";
import { transicionar, type ClienteTransaccional } from "./transicion";

export interface ResultadoSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  resultado: ResultadoSesion;
  registrarAuditoria: (evento: EventoAuditoriaInput) => Promise<void>;
  ahora?: Date;
}

export type EstadoTrasResultado = "revision" | "procesando" | "fallida";

export async function aplicarResultadoSesion({
  prisma,
  sesionId,
  organizationId,
  resultado,
  registrarAuditoria,
  ahora = new Date(),
}: ResultadoSesionInput): Promise<{ estado: EstadoTrasResultado }> {
  const intento = resultado.intento;
  const uso = resultado.uso as Prisma.InputJsonValue | undefined;
  const suelta = { leaseVenceEn: null, ticketHash: null };

  let estado: EstadoTrasResultado;
  if (resultado.resultado === "nota") {
    const existente = await prisma.sesionClinica.findFirst({
      where: { id: sesionId, organizationId, intento },
      select: { modeloAsr: true, generacion: true, turno: { select: { pacienteId: true } } },
    });
    if (!existente) {
      throw new ApiError("El intento ya no es el vigente; resultado ignorado", 409);
    }
    if (existente.modeloAsr === null) {
      throw new ApiError(
        "Falta el checkpoint de transcripción: registrala antes de entregar la nota",
        409,
      );
    }
    const pacienteId = existente.turno.pacienteId;

    await prisma.$transaction(async (tx) => {
      await transicionar({
        prisma: tx,
        operacion: "resultado_nota",
        sesionId,
        organizationId,
        intento,
        data: {
          generacion: { increment: 1 },
          modeloLlm: resultado.modeloLlm,
          promptVersion: resultado.promptVersion,
          procesadaEn: ahora,
          falloCodigo: null,
          falloDetalle: null,
          feedbackEstado: "pendiente",
          feedbackError: null,
          ...(uso !== undefined ? { uso } : {}),
          ...suelta,
          ...cifrarSesion(sesionId, { notaIa: resultado.nota, datos: resultado.datos }),
        },
        conflicto: "El intento ya no es el vigente; resultado ignorado",
      });
      await crearTrabajo({
        prisma: tx,
        tipo: "generar_feedback",
        // La generación que ESTE resultado deja (el UPDATE de arriba
        // incrementa desde la fila con el intento vigente).
        payload: { sesionId, pacienteId, generacion: existente.generacion + 1 },
        organizationId,
        sesionId,
        pacienteId,
      });
    });
    estado = "revision";
  } else if (resultado.definitivo) {
    await transicionar({
      prisma,
      operacion: "resultado_fallo_definitivo",
      sesionId,
      organizationId,
      intento,
      data: {
        falloCodigo: resultado.codigo,
        falloDetalle: resultado.detalle ?? null,
        ...(uso !== undefined ? { uso } : {}),
        ...suelta,
      },
      conflicto: "El intento ya no es el vigente; resultado ignorado",
    });
    estado = "fallida";
  } else {
    const existente = await prisma.sesionClinica.findFirst({
      where: { id: sesionId, organizationId, intento },
      select: { fallosSeguidos: true },
    });
    if (!existente) {
      throw new ApiError("El intento ya no es el vigente; resultado ignorado", 409);
    }
    const fallos = existente.fallosSeguidos + 1;
    await transicionar({
      prisma,
      operacion: "resultado_fallo_transitorio",
      sesionId,
      organizationId,
      intento,
      condiciones: { fallosSeguidos: existente.fallosSeguidos },
      data: {
        fallosSeguidos: fallos,
        proximoIntentoEn: new Date(ahora.getTime() + backoffSesionMs(fallos)),
        falloCodigo: resultado.codigo,
        falloDetalle: resultado.detalle ?? null,
        ...(uso !== undefined ? { uso } : {}),
        ...suelta,
      },
      conflicto: "El intento ya no es el vigente; resultado ignorado",
    });
    estado = "procesando";
  }

  await registrarAuditoria({
    organizationId,
    actorTipo: "worker",
    actorId: null,
    accion: "sesion.resultado",
    entidad: "sesion_clinica",
    entidadId: sesionId,
    detalle: {
      intento,
      resultado: resultado.resultado,
      estado,
      ...(resultado.resultado === "nota"
        ? {
            modeloLlm: resultado.modeloLlm,
            promptVersion: resultado.promptVersion,
            nivelRiesgo: resultado.datos.riesgoDetectado?.nivel ?? null,
            menciones: resultado.datos.riesgoLexico?.coincidencias.length ?? 0,
          }
        : { codigo: resultado.codigo, definitivo: resultado.definitivo, paso: resultado.paso ?? null }),
    },
  });

  return { estado };
}
