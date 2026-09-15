import { parseDatosEstructurados, flagRiesgoSchema } from "@/lib/sesion-clinica/schema";
import { normalizarRiesgo } from "@/lib/sesion-clinica/normalizar";
import { exigirPaciente, filtroHilo, leerVersion, type BaseHilo, type IdentidadHilo } from "./base";

/** Composición determinística: solo la nota aprobada y el Recorrido vigente. */
export async function leerBrief(prisma: BaseHilo, identidad: IdentidadHilo, ahora = new Date()) {
  return prisma.$transaction(async tx => {
    await exigirPaciente(tx, identidad);
    const hilo = await tx.hilo.findFirst({ where: filtroHilo(identidad), select: { vigente: { select: { version: true } } } });
    const vigente = hilo?.vigente ? await leerVersion(tx, identidad, hilo.vigente.version) : null;
    const propuestaPendiente = await tx.hiloVersion.count({ where: { ...filtroHilo(identidad), estado: "propuesta" } }) > 0;
    const sesion = await tx.sesionClinica.findFirst({
      where: { organizationId: identidad.organizationId, estado: "aprobada", turno: { pacienteId: identidad.pacienteId } },
      orderBy: [{ turno: { fecha: "desc" } }, { id: "desc" }],
      select: { datos: true, notaFinal: true, turno: { select: { fecha: true } } },
    });
    const notaPendiente = await tx.sesionClinica.count({ where: { organizationId: identidad.organizationId, estado: "revision", turno: { pacienteId: identidad.pacienteId } } }) > 0;
    const proximo = await tx.turno.findFirst({ where: { ...filtroHilo(identidad), fecha: { gte: ahora }, estado: { not: "cancelado" } }, orderBy: { fecha: "asc" }, select: { fecha: true, duracion: true, modalidad: true } });
    const datos = parseDatosEstructurados(sesion?.datos);
    const riesgo = normalizarRiesgo(datos?.riesgoDetectado);
    const c = vigente?.contenido;
    return {
      pacienteId: identidad.pacienteId, propuestaPendiente, notaPendiente,
      ultimaSesion: sesion ? {
        fecha: sesion.turno.fecha.toISOString(), pendienteAprobacion: false,
        resumenSesion: datos?.resumenSesion ?? sesion.notaFinal?.analisis ?? null,
        focoProximaSesion: datos?.focoProximaSesion ?? sesion.notaFinal?.plan ?? null,
        progresoPercibido: datos?.progresoPercibido ?? null, temas: datos?.temas ?? [],
        riesgo: { ...riesgo, flagsActivos: Object.entries(datos?.flagsRiesgo ?? {}).filter(([flag, valor]) => flagRiesgoSchema.options.includes(flag) && valor === true).map(([flag]) => flag) },
      } : null,
      hiloLongitudinal: c ? {
        resumenAcumulativo: c.resumenAcumulativo, hipotesisDiagnostica: c.hipotesisDiagnostica,
        temasRecurrentes: c.temasRecurrentes, objetivosActivos: c.objetivosTerapeuticos.filter(o => o.estado === "activo").map(o => o.descripcion),
        riesgosHistoricos: c.riesgosHistoricos, revisadoPorTerapeuta: true,
      } : null,
      proximoTurno: proximo ? { ...proximo, fecha: proximo.fecha.toISOString() } : null,
    };
  }, { isolationLevel: "RepeatableRead" });
}
