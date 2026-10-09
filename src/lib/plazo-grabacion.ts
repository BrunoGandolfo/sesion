// Cuánto tiempo tiene una grabación para llegar al servidor desde que empezó.
//
// Grabar no depende de la red (flujo-grabacion.ts): la sesión clínica se crea
// recién al subir. Para que una sesión de las 23:30 que sube a las 00:10, o
// una que se reintenta al día siguiente, no choque con la regla de "turno de
// hoy", el cliente manda el instante en que empezó a grabar (`iniciadaEn`) y
// el servidor acepta si es del día del turno y de las últimas
// HORAS_PARA_ENVIAR_GRABACION horas (sePuedeEnviarGrabacion, domain.ts).
//
// Lo leen el servidor y el glosario: no importa nada.

export const HORAS_PARA_ENVIAR_GRABACION = 36;

/** Margen para un reloj de teléfono adelantado: un inicio "en el futuro"
 *  dentro de este margen se acepta. */
export const MINUTOS_RELOJ_ADELANTADO = 5;
