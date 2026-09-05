// Política de la contraseña. Módulo PURO: sin bcrypt, sin base, sin env, para
// que lo puedan importar el formulario (cliente) y la ruta (servidor) y la
// regla sea una sola. Quien hashea es la ruta, con bcryptjs y BCRYPT_RONDAS.

/**
 * Costo de bcrypt. Es el mismo con el que se creó el usuario en el seed
 * (bcrypt.hash(password, 10)) y con el que compara el login: si se cambiara
 * acá sin más, las contraseñas nuevas y las viejas seguirían conviviendo —
 * bcrypt guarda el costo dentro del propio hash— pero el número dejaría de
 * estar dicho en un solo lugar.
 */
export const BCRYPT_RONDAS = 10;

/**
 * Mínimo de caracteres. Diez y no ocho: acá adentro hay historias clínicas,
 * y la única barrera entre ellas y el mundo es esta contraseña.
 */
export const PASSWORD_MIN = 10;

/**
 * Máximo. No es una preferencia: bcrypt sólo mira los primeros 72 BYTES y
 * descarta el resto en silencio. Una contraseña de 100 caracteres daría la
 * sensación de ser más fuerte y no lo sería, y peor: dos contraseñas que
 * comparten los primeros 72 bytes abrirían la misma cuenta. Se rechaza en vez
 * de truncar.
 */
export const PASSWORD_MAX_BYTES = 72;

export type ResultadoPassword = { ok: true } | { ok: false; motivo: string };

const OK: ResultadoPassword = { ok: true };

/** Largo en bytes UTF-8, que es lo que cuenta bcrypt (una "ñ" son dos). */
export function largoEnBytes(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

/**
 * ¿Sirve esta contraseña nueva?
 *
 * `actual` es la que está reemplazando: si son iguales no es un cambio, y
 * quien la cambia casi siempre lo hace porque sospecha que la vieja se filtró.
 */
export function validarPasswordNueva(
  nueva: string,
  actual?: string,
): ResultadoPassword {
  if (nueva.length < PASSWORD_MIN) {
    return {
      ok: false,
      motivo: `La contraseña nueva necesita al menos ${PASSWORD_MIN} caracteres.`,
    };
  }

  if (largoEnBytes(nueva) > PASSWORD_MAX_BYTES) {
    return {
      ok: false,
      motivo: "La contraseña nueva es demasiado larga.",
    };
  }

  if (nueva.trim().length === 0) {
    return { ok: false, motivo: "La contraseña nueva no puede ser espacios." };
  }

  if (actual !== undefined && nueva === actual) {
    return {
      ok: false,
      motivo: "La contraseña nueva tiene que ser distinta de la actual.",
    };
  }

  return OK;
}
