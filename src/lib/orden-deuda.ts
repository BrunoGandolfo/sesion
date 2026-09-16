/** Monto descendente; a igual monto, el impago más viejo primero.
 * Las fechas del mapa son ISO UTC, tal como salen de toISOString(). */
export function porMontoYAntiguedad<T extends { pacienteId: string }>(
  monto: (deuda: T) => number,
  masAntiguo: ReadonlyMap<string, string>,
): (a: T, b: T) => number {
  return (a, b) =>
    monto(b) - monto(a) ||
    (masAntiguo.get(a.pacienteId) ?? "").localeCompare(
      masAntiguo.get(b.pacienteId) ?? "",
    );
}
