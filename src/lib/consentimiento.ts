export const CONSENTIMIENTO_VERSION = "1.0";

export function generarTextoConsentimiento(params: {
  nombrePaciente: string;
  nombreProfesional: string;
  direccionConsultorio: string;
}): string {
  const { nombrePaciente, nombreProfesional, direccionConsultorio } = params;

  return `Consentimiento informado para grabación de sesiones
Versión ${CONSENTIMIENTO_VERSION}

Hola ${nombrePaciente}.

Antes de empezar, queremos contarte cómo funciona la grabación de las sesiones y pedirte que la autorices por escrito. Es un trámite simple y querés tomarte el tiempo de leerlo: se trata de tus datos y de tu intimidad.

¿Qué se graba?
Se graba el audio de tu sesión de psicoterapia con ${nombreProfesional}, en el consultorio ubicado en ${direccionConsultorio}. No se graba video.

¿Para qué se graba?
El audio se usa para generar, con ayuda de inteligencia artificial, una nota clínica escrita que ${nombreProfesional} usa para documentar la sesión en tu historia clínica. Esto le permite estar más presente durante la sesión y dedicarle menos tiempo a escribir después.

¿Quién puede escuchar el audio?
Solamente ${nombreProfesional}, que es la profesional que te atiende. Nadie más tiene acceso al audio de tus sesiones.

¿Dónde se procesa el audio?
El audio se procesa en un servidor privado al que solo accede ${nombreProfesional}. No se sube a servicios en internet de uso general ni queda guardado en servidores de empresas externas.

¿Cuánto tiempo se guarda el audio?
El audio se borra automáticamente apenas se genera la nota clínica. En la práctica esto pasa pocos minutos después de que termina la sesión. No queda una copia.

¿Qué queda guardado entonces?
Solo queda la nota clínica escrita, incorporada a tu historia clínica, igual que las notas que ${nombreProfesional} escribiría a mano. El audio no queda.

¿Podés cambiar de opinión?
Sí, en cualquier momento. Podés revocar esta autorización cuando quieras, simplemente avisándole a ${nombreProfesional}. A partir de ese momento las sesiones siguientes no se graban. Esto no afecta para nada la continuidad de tu tratamiento ni la relación con tu profesional.

¿Es obligatorio aceptar?
No. La grabación es totalmente opcional. Si preferís que no se grabe, la sesión sigue de manera normal y ${nombreProfesional} toma notas como siempre. No hay ninguna consecuencia por decir que no.

Marco legal
Esta autorización se enmarca en la Ley 18.331 de Protección de Datos Personales de la República Oriental del Uruguay, que exige que el tratamiento de datos sensibles —como los datos de salud— se haga con tu consentimiento previo, libre, expreso e informado.

Al firmar, declaro que:
- Leí y entendí esta información
- Autorizo la grabación de mis sesiones con ${nombreProfesional}
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
