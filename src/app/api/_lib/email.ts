// Un email se compara siempre normalizado: sin espacios alrededor y en
// minúsculas. Una sola definición para el login, el registro, la recuperación
// y la lista de quien puede invitar.

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}
