import { fechaInputMvd } from "@/lib/fechas-montevideo";
import { contenidoHiloSchema } from "@/lib/hilo/contenido";
import { parseDatosEstructurados } from "@/lib/sesion-clinica/schema";

import { ApiError } from "../../responses";
import type { Adjuntador } from "../trabajos/entregar";
import type { Aplicador } from "../trabajos/resultado-worker";
import { auditarHilo, bloquearHilo, insertarVersion, leerVersion } from "./base";

export function versionDelTrabajo(payload: unknown): number {
  const version = (payload as { basadaEnVersion?: unknown } | null)?.basadaEnVersion;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) throw new ApiError("El trabajo no tiene una versión de origen válida", 400);
  return version;
}

export const adjuntoContexto: Adjuntador = async (prisma, trabajo) => {
  if (!trabajo.pacienteId || !trabajo.sesionId) throw new ApiError("Trabajo de Recorrido incompleto", 409);
  const identidad = { pacienteId: trabajo.pacienteId, organizationId: trabajo.organizationId };
  const version = versionDelTrabajo(trabajo.payload);
  const sesion = await prisma.sesionClinica.findFirst({
    where: { id: trabajo.sesionId, organizationId: trabajo.organizationId, estado: "aprobada", turno: { pacienteId: trabajo.pacienteId } },
    select: { id: true, notaFinal: true, datos: true, turno: { select: { fecha: true } } },
  });
  if (!sesion?.notaFinal) throw new ApiError("La sesión aprobada ya no está disponible", 409);
  const datos = parseDatosEstructurados(sesion.datos);
  // Las menciones léxicas se revisan en la nota; no alimentan riesgos del hilo.
  const datosParaContexto = { ...datos };
  delete datosParaContexto.riesgoLexico;
  return {
    tipo: "integrar_contexto", pacienteId: trabajo.pacienteId, sesionId: trabajo.sesionId,
    contextoVigente: version ? (await leerVersion(prisma, identidad, version)).contenido : null,
    version, notaFinal: sesion.notaFinal, datos: datosParaContexto,
    fechaSesion: fechaInputMvd(sesion.turno.fecha),
  };
};

export const aplicarPropuesta: Aplicador = async (tx, trabajo, resultado, _resolucion, ahora) => {
  if (!resultado.ok) return;
  if (!trabajo.pacienteId || !trabajo.sesionId) throw new ApiError("Trabajo de Recorrido incompleto", 400);
  const contenido = contenidoHiloSchema.parse(resultado.propuesta);
  if (!resultado.promptVersion || !resultado.modeloLlm) throw new ApiError("La propuesta debe identificar prompt y modelo", 400);
  const identidad = { pacienteId: trabajo.pacienteId, organizationId: trabajo.organizationId };
  const hilo = await bloquearHilo(tx, identidad);
  const sesion = await tx.sesionClinica.findFirst({ where: {
    id: trabajo.sesionId, organizationId: trabajo.organizationId, estado: "aprobada", turno: { pacienteId: trabajo.pacienteId },
  }, select: { id: true } });
  if (!sesion) throw new ApiError("La sesión aprobada ya no está disponible", 409);
  const basadaEnVersion = versionDelTrabajo(trabajo.payload);
  const estado = basadaEnVersion === (hilo.vigente?.version ?? 0) ? "propuesta" : "desactualizada";
  if (estado === "propuesta" && await tx.hiloVersion.count({ where: { ...identidad, estado: "propuesta" } })) throw new ApiError("Ya hay una propuesta por revisar", 409);
  const nueva = await insertarVersion(tx, identidad, hilo, {
    contenido, actor: "ia", estado, basadaEnVersion, sesionOrigenId: trabajo.sesionId,
    promptVersion: resultado.promptVersion, modeloLlm: resultado.modeloLlm, ahora,
  });
  await auditarHilo(tx, identidad, "hilo.proponer", nueva.version, null, ahora, trabajo.trabajoId);
};
