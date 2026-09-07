// Texto del consentimiento informado para grabar sesiones.
//
// Versión 1.1 — corrección por veracidad. La 1.0 afirmaba dos cosas que el
// pipeline real no cumple (ver docs/pipeline.md, verificado 2026-09-04):
//
//   - "El audio se procesa en un servidor privado al que solo accede la
//     profesional. No se sube a servicios en internet de uso general ni
//     queda guardado en servidores de empresas externas." Falso: el audio
//     se transcribe en AssemblyAI y la nota la redacta Anthropic, las dos
//     empresas en Estados Unidos.
//   - "Solo queda la nota clínica escrita." Incompleto: la transcripción
//     completa de la sesión también queda guardada, cifrada, en la base.
//
// Un consentimiento que describe mal el tratamiento de datos no es
// consentimiento informado bajo la Ley 18.331, por más firmado que esté.
//
// El texto es deliberadamente más largo que el de la 1.0: se agrega lo que
// faltaba, no se recorta lo que ya estaba.

import type { db } from "@/lib/db";

export const CONSENTIMIENTO_VERSION = "1.1";

export function generarTextoConsentimiento(params: {
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
}): string {
  const { nombrePaciente, nombreProfesional, direccionConsultorio } = params;

  return `Consentimiento informado para grabación de sesiones
Versión ${CONSENTIMIENTO_VERSION}

Hola ${nombrePaciente}.

Antes de empezar queremos contarte cómo funciona la grabación de las sesiones y pedirte que la autorices por escrito. Tomate el tiempo de leerlo: se trata de tus datos y de tu intimidad.

¿Qué se graba?
Se graba el audio de tu sesión de psicoterapia con ${nombreProfesional}, en el consultorio ubicado en ${direccionConsultorio}. No se graba video.

¿Para qué se graba?
El audio se usa para escribir, con ayuda de inteligencia artificial, la nota clínica de la sesión: el registro escrito que ${nombreProfesional} guarda en tu historia clínica. Le permite estar más presente durante la sesión y dedicarle menos tiempo a escribir después.

¿Quién escucha el audio?
Ninguna persona además de ${nombreProfesional}. Nadie más de su consultorio, ni de ninguna empresa, escucha tus sesiones.

El audio sí pasa, de forma automática y sin que ninguna persona lo oiga, por dos servicios de empresas que están en Estados Unidos. Es importante que lo sepas antes de firmar:

1. AssemblyAI convierte el audio en texto. Cuando termina, borra de sus servidores tanto ese texto como la copia del audio.
2. Anthropic toma ese texto y redacta la nota clínica. Trabaja bajo un acuerdo que no le permite conservar el contenido ni usarlo para entrenar sus sistemas.

A esos servicios no se les envía tu nombre, tu teléfono ni tu documento: reciben el audio y el texto de la sesión, nada más. Tené en cuenta que, si durante la sesión se dicen nombres en voz alta, esos nombres viajan dentro del audio.

¿Cómo viaja y dónde se guarda el audio?
El audio se cifra en el mismo teléfono de ${nombreProfesional} apenas termina la grabación, antes de salir del dispositivo. Queda guardado, siempre cifrado, en un servicio de almacenamiento, hasta que se escribe la nota. La clave para abrirlo la tiene solamente esta aplicación.

¿Cuánto tiempo se guarda el audio?
Hasta que ${nombreProfesional} revisa y aprueba la nota clínica, en general el mismo día de la sesión. En ese momento el audio se borra y además se destruye su clave, así que cualquier copia que llegara a quedar en algún lado sería imposible de abrir.

¿Qué queda guardado entonces?
Quedan dos cosas, las dos cifradas en la base de datos de la aplicación y accesibles solamente para ${nombreProfesional}:

- La nota clínica, que forma parte de tu historia clínica igual que las notas que ella escribiría a mano.
- La transcripción de la sesión, que es el texto de lo que se habló.

El audio no queda.

¿Podés cambiar de opinión?
Sí, en cualquier momento y sin dar explicaciones. Alcanza con avisarle a ${nombreProfesional}. A partir de ese momento las sesiones siguientes no se graban. Esto no afecta en nada la continuidad de tu tratamiento ni tu relación con ella.

¿Es obligatorio aceptar?
No. La grabación es totalmente opcional. Si preferís que no se grabe, la sesión sigue de manera normal y ${nombreProfesional} toma notas como siempre. No hay ninguna consecuencia por decir que no.

Marco legal
Esta autorización se enmarca en la Ley 18.331 de Protección de Datos Personales de la República Oriental del Uruguay, que exige que el tratamiento de datos sensibles —como los datos de salud— se haga con tu consentimiento previo, libre, expreso e informado. Como parte de tus sesiones se procesa fuera del país, esta autorización incluye esa transferencia internacional de datos. Tenés derecho a acceder a tus datos, a pedir que se corrijan y a pedir que se eliminen.

Al firmar, declaro que:
- Leí y entendí esta información
- Autorizo la grabación de mis sesiones con ${nombreProfesional}
- Entiendo que el audio y su transcripción se procesan en los servicios del exterior mencionados más arriba
- Sé que puedo revocar esta autorización cuando quiera
`;
}

export function esConsentimientoVigente(
  consentimiento: {
    firmadoEn: Date;
    revocadoEn: Date | null;
  } | null,
): boolean {
  if (!consentimiento) return false;
  return consentimiento.revocadoEn === null;
}

// ────────────────────────────────────────────────────────────────────────────
// La búsqueda del consentimiento vigente
//
// Estaba escrita tres veces, y una de las tres estaba mal: POST
// /api/sesion-clinica preguntaba `{ pacienteId, revocadoEn: null }` SIN la
// organización, mientras la página de grabar y el GET de /consentimiento sí la
// filtraban. Con una sola organización no se nota; el día que haya dos, un id
// de paciente ajeno alcanzaba para que la comprobación previa a grabar mirara
// la fila equivocada. La pertenencia no es un detalle de cada llamador: es
// parte de la pregunta.
//
// El `import type` de db es solo el tipo del cliente (se borra al compilar),
// así que este módulo sigue siendo importable desde un componente cliente —
// ConsentimientoForm.tsx trae de acá el texto y la versión.
// ────────────────────────────────────────────────────────────────────────────

/** Lo que devuelve la búsqueda. Es lo que necesita el GET de la ruta; el
 *  resto de los llamadores solo mira si hay algo. */
const CONSENTIMIENTO_SELECT = {
  id: true,
  pacienteId: true,
  firmadoEn: true,
  textoVersion: true,
  revocadoEn: true,
} as const;

export interface ConsentimientoVigente {
  id: string;
  pacienteId: string;
  firmadoEn: Date;
  textoVersion: string;
  revocadoEn: Date | null;
}

/** Lo mínimo del cliente Prisma que hace falta acá. `Pick` y no el cliente
 *  entero para que también entre el de una transacción. */
type ClienteConsentimientos = Pick<typeof db, "consentimientoGrabacion">;

/**
 * El consentimiento vigente de una paciente, o null.
 *
 * `revocadoEn: null` va en el WHERE —es la proyección en SQL de
 * `esConsentimientoVigente`— y el predicado se vuelve a aplicar sobre la fila
 * leída. Es a propósito, igual que con `esDeudaPendiente` en
 * casos-uso/pendientes-terapeuta.ts: si mañana "vigente" pasa a significar
 * otra cosa (un vencimiento, una versión mínima del texto), la regla sigue
 * viviendo en una sola función y esto no queda contestando que sí por su
 * cuenta.
 *
 * `orderBy` por fecha de firma descendente: firmar de nuevo revoca lo
 * anterior en la misma transacción, así que en la práctica hay como mucho una
 * fila viva; el orden es lo que hace determinista el caso de que no.
 */
export async function buscarConsentimientoVigente(
  prisma: ClienteConsentimientos,
  pacienteId: string,
  organizationId: string,
): Promise<ConsentimientoVigente | null> {
  const consentimiento = await prisma.consentimientoGrabacion.findFirst({
    where: { pacienteId, organizationId, revocadoEn: null },
    orderBy: { firmadoEn: "desc" },
    select: CONSENTIMIENTO_SELECT,
  });

  return esConsentimientoVigente(consentimiento) ? consentimiento : null;
}

/** ¿Se puede grabar a esta paciente? La pregunta que hacen la página de
 *  grabar y la creación de la sesión clínica. */
export async function consentimientoVigenteDe(
  prisma: ClienteConsentimientos,
  pacienteId: string,
  organizationId: string,
): Promise<boolean> {
  return (
    (await buscarConsentimientoVigente(prisma, pacienteId, organizationId)) !==
    null
  );
}
