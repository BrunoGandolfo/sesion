// Métrica de salud: ¿se está perdiendo el rastro de auditoría informativo?
//
// EL PROBLEMA
//
// Los actos legales —firmar y revocar la autorización, exportar
// documentación— escriben su evento DENTRO de la transacción del acto: no se
// pueden perder, porque si el rastro falla el acto tampoco ocurre
// (_lib/auditoria.ts). Los INFORMATIVOS son best-effort a propósito: que una
// pregunta a la ayuda o un reintento del worker no se registre no puede
// voltear la operación. Su fallo va a `console.error("[auditoria] fallo"…)`,
// al log de la función, que nadie lee. Podía estar perdiéndose todos los días
// y nadie se enteraba.
//
// CÓMO SE CUENTA SIN TABLA NUEVA
//
// No hace falta anotar los fallos en ningún lado: ya hay con qué DEDUCIRLOS.
// Algunos actos dejan su propia marca de tiempo en su propia fila, y además
// deberían haber dejado un evento. Si en una ventana hubo más actos que
// eventos, la diferencia son rastros perdidos.
//
//   sesión creada   sesiones_clinicas.creada_en    ↔ evento `sesion.crear`
//   nota aprobada   sesiones_clinicas.aprobada_en  ↔ evento `sesion.aprobar`
//
// Dos consultas por par, ninguna escritura, cero migraciones. Y mide lo que
// de verdad importa —cuántos rastros faltan— en vez de cuántas veces se
// registró un fallo, que es una aproximación.
//
// POR QUÉ ESTOS DOS PARES Y NO MÁS
//
// Sirve cualquier acto que (a) sea best-effort y (b) deje una marca de tiempo
// propia e inmutable. Crear y aprobar son los dos de mayor volumen del
// sistema y los dos que más duele perder. Los demás eventos informativos
// —ayuda, lease, checkpoints— no dejan una fila fechada con la que
// compararlos, y contarlos exigiría guardar algo nuevo. Si un día hace falta
// más cobertura, el camino está en el reporte de la rama, con su SQL.
//
// POR QUÉ NUNCA AVISA DE MÁS
//
// `eventos_auditoria` es append-only y las filas de sesión se pueden borrar
// (eliminar una fallida). Entonces en una ventana puede haber MÁS eventos que
// actos, y la resta da negativo: se recorta en cero. Eso hace que la métrica
// prefiera callarse antes que inventar una alarma —puede tapar una pérdida
// real en la misma ventana en que se borró una sesión—, y es la dirección
// correcta: una alerta que grita en falso se aprende a ignorar, y esta tiene
// que significar algo el día que suene.

import type { FuenteMetricas } from "@/lib/salud-metricas";

/** La ventana que se mira. Un día: si se perdió algo, se ve al otro día. */
export const VENTANA_HORAS = 24;

/**
 * Cuánto se deja asentar antes de mirar. El evento se escribe apenas después
 * del acto, en la misma request; sin este margen, un acto de hace dos
 * segundos contaría como "sin rastro" sólo porque su evento todavía no
 * terminó de escribirse.
 */
export const MARGEN_MINUTOS = 5;

const MS_HORA = 60 * 60 * 1000;
const MS_MINUTO = 60 * 1000;

/** Acto con marca de tiempo propia ↔ evento que debería acompañarlo. */
const PARES = [
  { accion: "sesion.crear", columna: "creadaEn" },
  { accion: "sesion.aprobar", columna: "aprobadaEn" },
] as const;

export const fuenteAuditoria: FuenteMetricas = async ({ prisma, ahora }) => {
  const hasta = new Date(ahora.getTime() - MARGEN_MINUTOS * MS_MINUTO);
  const desde = new Date(ahora.getTime() - VENTANA_HORAS * MS_HORA);
  const rango = { gte: desde, lte: hasta };

  const faltantes = await Promise.all(
    PARES.map(async ({ accion, columna }) => {
      const [actos, eventos] = await Promise.all([
        prisma.sesionClinica.count({ where: { [columna]: rango } }),
        prisma.eventoAuditoria.count({ where: { accion, creadoEn: rango } }),
      ]);
      return { accion, perdidos: Math.max(0, actos - eventos) };
    }),
  );

  const perdidos = faltantes.reduce((total, f) => total + f.perdidos, 0);
  const detalle = faltantes
    .filter((f) => f.perdidos > 0)
    .map((f) => `${f.accion}: ${f.perdidos}`)
    .join(", ");

  return [
    {
      nombre: "auditoria_rastros_perdidos_24h",
      valor: perdidos,
      umbral: 1,
      // Aviso y no crítico: lo que se pierde acá es el rastro INFORMATIVO.
      // El legal va dentro de la transacción de su acto y no se puede perder.
      // No hay que levantarse a las 3 de la mañana, hay que mirar el log.
      nivel: "aviso",
      texto: `actos sin su rastro de auditoría en las últimas ${VENTANA_HORAS} h${detalle ? ` (${detalle})` : ""}: buscar "[auditoria] fallo" en el log de la función`,
    },
  ];
};
