// Caso de uso: qué notas tiene que avisarle el panel a esta usuaria.
//
// Dos cosas, en una sola lista:
//
//   - las sesiones que se están escribiendo (subiendo o procesando): mientras
//     haya alguna, el panel vuelve a preguntar cada tanto;
//   - las que quedaron listas (revision) o fallidas y ELLA todavía no abrió:
//     son la franja de arriba y el globito de Hoy.
//
// Antes esto vivía en la pestaña (sessionStorage): si la cerraba, no había
// aviso. Ahora la verdad es de la base y el panel solo la pregunta.
//
// "LA ABRIÓ" SIN TABLA NUEVA
//
// Cada GET /api/sesion-clinica/[id] deja un evento `sesion.ver` en
// eventos_auditoria, con el actor y `detalle.estado` (el estado en que la
// vio). Con eso alcanza:
//
//   - lista: está vista si hay un `sesion.ver` de esta usuaria posterior a
//     `procesadaEn`, que es el momento exacto en que el worker entregó la
//     nota (resultado.ts). "Volver a escribirla" la vuelve a procesar y
//     mueve `procesadaEn`: la nota nueva vuelve a avisar.
//   - fallida: no hay columna con el momento del fallo (`actualizadaEn`
//     también lo mueve el borrado del audio, y `agotar` no deja evento). Pero
//     un `sesion.ver` con `detalle.estado = "fallida"` sólo puede existir
//     mientras la sesión está fallida, y de fallida se sale únicamente por
//     Reintentar (que deja `sesion.reintentar`) o Eliminar (la fila
//     desaparece). Entonces: está vista si hay un `sesion.ver` en estado
//     fallida de esta usuaria posterior al último `sesion.reintentar`.
//
// Por usuaria y no por organización: si una colega la abrió, ella todavía no.
//
// EL SONDEO NO ES ABRIRLA
//
// Mientras la sesión se procesa, la ficha de la paciente y la pantalla de la
// nota consultan GET /api/sesion-clinica/[id] cada 10 s
// (useSesionClinicaPolling), y cada consulta deja su `sesion.ver`. La última,
// la que ya ve `revision`, la deja aunque ella esté en la pestaña Datos de la
// ficha y no haya visto la nota. Se reconoce por la forma: es un `sesion.ver`
// con al menos otro de ella, sobre esa sesión y en proceso, en los
// VENTANA_SONDEO_MS anteriores (un intervalo de sondeo). Ese no cuenta. "Al
// menos otro" y no "el anterior": con la ficha abierta en dos dispositivos
// hay dos colas seguidas, y la segunda también es sondeo.
//
// La ventana es la del sondeo (10 s más la latencia) y no más: con una más
// larga, salir de la ficha mientras se procesa y tocar la franja al rato
// quedaba confundido con el sondeo (lo encontró la revisión de Codex).
//
// Lo que esto no distingue, y queda anotado: si ella miraba la pantalla de
// la nota mientras se escribía, la llegada de la nota también es cola de
// sondeo y la franja aparece al salir; si toca la franja a menos de
// VENTANA_SONDEO_MS de haber salido de la ficha de esa paciente, esa apertura
// tampoco cuenta. En los dos casos la franja se va con la apertura
// siguiente. Y si la pestaña estuvo oculta en la ficha, la consulta al
// volver cuenta como vista. Separarlo del todo es cosa de la ruta [id] o del
// hook, que no son de esta rama: que el sondeo no se registre como
// `sesion.ver`.
//
// LOS TOPES
//
//   - En proceso cuenta solo si la fila se movió en las últimas
//     VENTANA_EN_PROCESO_MS. Una subida que el teléfono abandonó queda en
//     `subiendo` para siempre, y con ella el panel preguntaría cada 15 s para
//     siempre. El worker renueva el lease cada minuto, así que una sesión que
//     de verdad se procesa nunca queda afuera.
//   - Listas y fallidas, de los últimos VENTANA_AVISOS_MS. Una nota de hace
//     un mes sin abrir sigue en Pendientes de Hoy; la franja es para enterarse.
//
// Sin transcripción ni texto clínico: id, nombre de la paciente, estado y la
// fecha del turno. Nada más sale de acá.

import type { db } from "@/lib/db";
import type { AvisoServidor } from "@/lib/notas-en-proceso";

type ClientePrisma = Pick<typeof db, "sesionClinica" | "eventoAuditoria">;

/** Lo único que viaja por GET /api/sesion-clinica/avisos: id, nombre y
 *  apellido de la paciente, estado y el inicio del turno (ISO). El tipo vive
 *  junto a quien lo consume, en src/lib/notas-en-proceso.ts. */
export type AvisoSesion = AvisoServidor;
type EstadoAviso = AvisoServidor["estado"];

export const VENTANA_EN_PROCESO_MS = 2 * 60 * 60 * 1000;
export const VENTANA_AVISOS_MS = 7 * 24 * 60 * 60 * 1000;
/** Más que esto no entra en una franja; el resto está en Pendientes. */
export const TOPE_AVISOS = 20;

/** El intervalo de useSesionClinicaPolling (10 s) más la latencia de un
 *  pedido, con margen para una red lenta. */
export const VENTANA_SONDEO_MS = 20_000;

export const ACCION_VER = "sesion.ver";
const ACCION_REINTENTAR = "sesion.reintentar";
const EN_PROCESO: ReadonlySet<string> = new Set(["subiendo", "procesando"]);
const ENTIDAD = "sesion_clinica";

export interface AvisosNotasParams {
  prisma: ClientePrisma;
  organizationId: string;
  userId: string;
  ahora: Date;
}

export async function avisosNotas({
  prisma,
  organizationId,
  userId,
  ahora,
}: AvisosNotasParams): Promise<AvisoSesion[]> {
  const desdeProceso = new Date(ahora.getTime() - VENTANA_EN_PROCESO_MS);
  const desdeAvisos = new Date(ahora.getTime() - VENTANA_AVISOS_MS);

  const filas = await prisma.sesionClinica.findMany({
    where: {
      organizationId,
      OR: [
        {
          estado: { in: ["subiendo", "procesando"] },
          actualizadaEn: { gte: desdeProceso },
        },
        { estado: "revision", procesadaEn: { gte: desdeAvisos } },
        // El fallo movió `actualizadaEn`: todo fallo de la ventana entra; uno
        // más viejo que el borrado del audio volvió a mover, lo descarta el
        // `sesion.ver` de abajo.
        { estado: "fallida", actualizadaEn: { gte: desdeAvisos } },
      ],
    },
    select: {
      id: true,
      estado: true,
      procesadaEn: true,
      turno: {
        select: {
          fecha: true,
          paciente: { select: { nombre: true, apellido: true } },
        },
      },
    },
    orderBy: { turno: { fecha: "asc" } },
  });

  const terminadas = filas.filter(
    (f) => f.estado === "revision" || f.estado === "fallida",
  );
  const eventos = terminadas.length
    ? await prisma.eventoAuditoria.findMany({
        where: {
          organizationId,
          entidad: ENTIDAD,
          entidadId: { in: terminadas.map((f) => f.id) },
          OR: [
            { accion: ACCION_VER, actorId: userId },
            // De cualquiera: si la colega reintentó, el fallo de antes ya no
            // es el que hay que avisar.
            { accion: ACCION_REINTENTAR },
          ],
        },
        select: { accion: true, entidadId: true, detalle: true, creadoEn: true },
      })
    : [];

  const vista = (fila: (typeof filas)[number]): boolean => {
    const propios = eventos.filter((e) => e.entidadId === fila.id);
    const vers = propios
      .filter((e) => e.accion === ACCION_VER)
      .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());

    // Desde cuándo está en este estado: la entrega de la nota, o el último
    // Reintentar para una fallida.
    const desde =
      fila.estado === "revision"
        ? fila.procesadaEn
        : propios
            .filter((e) => e.accion === ACCION_REINTENTAR)
            .reduce<Date | null>(
              (max, e) => (max === null || e.creadoEn > max ? e.creadoEn : max),
              null,
            );

    const enProceso = vers.filter((e) =>
      EN_PROCESO.has(estadoDelDetalle(e.detalle) ?? ""),
    );
    return vers.some((e) => {
      if (estadoDelDetalle(e.detalle) !== fila.estado) return false;
      if (desde !== null && e.creadoEn < desde) return false;
      const colaDeSondeo = enProceso.some((p) => {
        const antes = e.creadoEn.getTime() - p.creadoEn.getTime();
        return antes >= 0 && antes <= VENTANA_SONDEO_MS;
      });
      return !colaDeSondeo;
    });
  };

  const enProceso = filas.filter(
    (f) => f.estado === "subiendo" || f.estado === "procesando",
  );
  const sinVer = terminadas.filter((f) => !vista(f)).slice(-TOPE_AVISOS);

  return [...enProceso, ...sinVer].map((f) => ({
    id: f.id,
    paciente: `${f.turno.paciente.nombre} ${f.turno.paciente.apellido}`.trim(),
    estado: f.estado as EstadoAviso,
    fecha: f.turno.fecha.toISOString(),
  }));
}

function estadoDelDetalle(detalle: unknown): string | null {
  if (typeof detalle !== "object" || detalle === null) return null;
  const estado = (detalle as Record<string, unknown>).estado;
  return typeof estado === "string" ? estado : null;
}
