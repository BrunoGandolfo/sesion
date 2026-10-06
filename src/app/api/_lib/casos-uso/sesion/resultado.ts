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

import { backoffSesionMs, OPERACIONES } from "@/lib/sesion-clinica/estados";
import type { ResultadoSesion } from "@/lib/sesion-clinica/schema";
import type { Prisma } from "@prisma/client";

import { registrarAuditoria } from "../../auditoria";
import { ApiError } from "../../responses";
import { crearTrabajo } from "../trabajos/crear";

import { cifrarSesion } from "@/lib/prisma-encryption";
import { transicionar, type ClienteTransaccional } from "./transicion";
import { ACCIONES } from "@/lib/auditoria-acciones";

export interface ResultadoSesionInput {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  resultado: ResultadoSesion;
  ahora?: Date;
}

/** El 409 de un resultado que llega con un intento que ya no es el vigente. */
export const MENSAJE_INTENTO_VIEJO = "El intento ya no es el vigente; resultado ignorado";

/** Las tres operaciones de la tabla que puede disparar un resultado. */
type RamaResultado =
  | "resultado_nota"
  | "resultado_fallo_definitivo"
  | "resultado_fallo_transitorio";

export type EstadoTrasResultado = "revision" | "procesando" | "fallida";

function ramaDe(resultado: ResultadoSesion): RamaResultado {
  if (resultado.resultado === "nota") return "resultado_nota";
  return resultado.definitivo ? "resultado_fallo_definitivo" : "resultado_fallo_transitorio";
}

/** Dónde queda la fila después de la rama: el `hacia` de la tabla ("mismo"
 *  es el estado de partida, `procesando`). */
function estadoTras(rama: RamaResultado): EstadoTrasResultado {
  const { desde, hacia } = OPERACIONES[rama];
  return (hacia === "mismo" ? desde[0] : hacia) as EstadoTrasResultado;
}

interface Contexto<R extends ResultadoSesion> {
  prisma: ClienteTransaccional;
  sesionId: string;
  organizationId: string;
  resultado: R;
  intento: number;
  ahora: Date;
  /** Consumo y liberación del lease: lo escriben las tres ramas. */
  comun: {
    leaseVenceEn: null;
    ticketHash: null;
    uso?: Prisma.InputJsonValue;
  };
}

type Nota = Extract<ResultadoSesion, { resultado: "nota" }>;
type Fallo = Extract<ResultadoSesion, { resultado: "fallo" }>;

/** procesando → revision, con la nota de ESTA generación y, en la misma
 *  transacción, el trabajo de "Para vos" (esquema §2, punto 14). */
async function aplicarNota(ctx: Contexto<Nota>): Promise<void> {
  const { prisma, sesionId, organizationId, resultado, intento, ahora } = ctx;
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId, intento },
    select: { modeloAsr: true, generacion: true, turno: { select: { pacienteId: true } } },
  });
  if (!existente) throw new ApiError(MENSAJE_INTENTO_VIEJO, 409);
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
        ...ctx.comun,
        ...cifrarSesion(sesionId, { notaIa: resultado.nota, datos: resultado.datos }),
      },
      conflicto: MENSAJE_INTENTO_VIEJO,
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
}

/** procesando → fallida, con código y detalle. */
async function aplicarFalloDefinitivo(ctx: Contexto<Fallo>): Promise<void> {
  const { resultado } = ctx;
  await transicionar({
    prisma: ctx.prisma,
    operacion: "resultado_fallo_definitivo",
    sesionId: ctx.sesionId,
    organizationId: ctx.organizationId,
    intento: ctx.intento,
    data: {
      falloCodigo: resultado.codigo,
      falloDetalle: resultado.detalle ?? null,
      ...ctx.comun,
    },
    conflicto: MENSAJE_INTENTO_VIEJO,
  });
}

/** Sigue en procesando con fallosSeguidos += 1 y backoff; el reclamo
 *  siguiente la vuelve a entregar, o la agota. */
async function aplicarFalloTransitorio(ctx: Contexto<Fallo>): Promise<void> {
  const { prisma, sesionId, organizationId, resultado, intento, ahora } = ctx;
  const existente = await prisma.sesionClinica.findFirst({
    where: { id: sesionId, organizationId, intento },
    select: { fallosSeguidos: true },
  });
  if (!existente) throw new ApiError(MENSAJE_INTENTO_VIEJO, 409);
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
      ...ctx.comun,
    },
    conflicto: MENSAJE_INTENTO_VIEJO,
  });
}

export async function aplicarResultadoSesion({
  prisma,
  sesionId,
  organizationId,
  resultado,
  ahora = new Date(),
}: ResultadoSesionInput): Promise<{ estado: EstadoTrasResultado }> {
  const intento = resultado.intento;
  const uso = resultado.uso as Prisma.InputJsonValue | undefined;
  const base = {
    prisma,
    sesionId,
    organizationId,
    intento,
    ahora,
    comun: { leaseVenceEn: null, ticketHash: null, ...(uso !== undefined ? { uso } : {}) },
  };

  const rama = ramaDe(resultado);
  if (resultado.resultado === "nota") {
    await aplicarNota({ ...base, resultado });
  } else if (rama === "resultado_fallo_definitivo") {
    await aplicarFalloDefinitivo({ ...base, resultado });
  } else {
    await aplicarFalloTransitorio({ ...base, resultado });
  }
  const estado = estadoTras(rama);

  await registrarAuditoria(prisma, {
    organizationId,
    actorTipo: "worker",
    actorId: null,
    accion: ACCIONES.sesion.resultado,
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
