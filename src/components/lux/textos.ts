// Textos de Lux.
//
// Viven acá y no en src/lib/glosario.ts porque esta rama no toca el glosario
// en paralelo con las otras (docs/como-trabajamos.md, "Fusión y cierre"): la
// lista está también en docs/pendientes/lux.md y se muda al glosario al
// integrar, dejando acá un re-export como graficos/textos.ts.

export const LUX = "Lux";

/** El nombre de pila de la profesional: "Mariana López" → "Mariana", y
 *  "Lic. Mariana López" → "Mariana". Vacío si no hay nombre. */
export function nombreDePila(nombreProfesional: string | null | undefined): string {
  const palabras = (nombreProfesional ?? "").trim().split(/\s+/).filter(Boolean);
  return palabras.find((p) => !p.endsWith(".")) ?? "";
}

/** Lo primero que se ve al entrar: lo dice la app, no Lux, y no viaja en el
 *  historial. Sin nombre de la profesional, "Hola" a secas. */
export function luxSaludo(profesional: string, paciente: string): string {
  const hola = profesional ? `Hola ${profesional}` : "Hola";
  return `${hola}, dame un momentito que repaso lo de ${paciente}…`;
}

/** La línea fija de arriba del chat. */
export function luxQueLee(paciente: string): string {
  return `Lux lee el Recorrido, las notas y las últimas sesiones de ${paciente}. No guarda esta conversación.`;
}

/** El estado que Lux manda mientras abre una transcripción. */
export function luxMirando(fecha: string): string {
  return `Mirando la transcripción del ${fecha}…`;
}

export const LUX_CONVERSACION = "Conversación con Lux";
export const LUX_DIJO = "Lux:";
export const LUX_DIJO_ELLA = "Vos:";
export const LUX_EN_QUE_ME_BASO = "Ver en qué me baso";
export const LUX_PLACEHOLDER = "Preguntale a Lux";
export const LUX_ENVIAR = "Enviar";
export const LUX_NUEVA = "Nueva conversación";
export const LUX_PENSANDO = "Lux está leyendo…";
export const LUX_TOPE = "Lux llegó a su tope de hoy.";
export const LUX_NO_PUDO = "Lux no pudo responder. Probá de nuevo en un rato.";
export const LUX_SIN_CONEXION = "No hay conexión. Probá de nuevo cuando vuelva.";
export const LUX_CORTADO = "Se cortó la respuesta. Podés preguntar de nuevo.";
export const LUX_SALIR =
  "Escribiste algo para Lux que todavía no mandaste. Si seguís, se pierde.";
