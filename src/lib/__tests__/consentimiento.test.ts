import { describe, it, expect } from "vitest";

import {
  CONSENTIMIENTO_VERSION,
  esConsentimientoVigente,
  generarTextoConsentimiento,
} from "@/lib/consentimiento";

const baseParams = {
  nombrePaciente: "María González",
  nombreProfesional: "Lic. Ana Pérez",
  direccionConsultorio: "Av. 18 de Julio 1234, Montevideo",
};

describe("generarTextoConsentimiento", () => {
  it("la versión vigente del texto es la 1.0", () => {
    expect(CONSENTIMIENTO_VERSION).toBe("1.0");
  });

  // Texto legal completo: cualquier cambio de redacción tiene que ser
  // deliberado (y, en general, subir CONSENTIMIENTO_VERSION).
  it("genera el texto legal completo con los datos interpolados", () => {
    expect(generarTextoConsentimiento(baseParams)).toMatchInlineSnapshot(`
      "Consentimiento informado para grabación de sesiones
      Versión 1.0

      Hola María González.

      Antes de empezar, queremos contarte cómo funciona la grabación de las sesiones y pedirte que la autorices por escrito. Es un trámite simple y querés tomarte el tiempo de leerlo: se trata de tus datos y de tu intimidad.

      ¿Qué se graba?
      Se graba el audio de tu sesión de psicoterapia con Lic. Ana Pérez, en el consultorio ubicado en Av. 18 de Julio 1234, Montevideo. No se graba video.

      ¿Para qué se graba?
      El audio se usa para generar, con ayuda de inteligencia artificial, una nota clínica escrita que Lic. Ana Pérez usa para documentar la sesión en tu historia clínica. Esto le permite estar más presente durante la sesión y dedicarle menos tiempo a escribir después.

      ¿Quién puede escuchar el audio?
      Solamente Lic. Ana Pérez, que es la profesional que te atiende. Nadie más tiene acceso al audio de tus sesiones.

      ¿Dónde se procesa el audio?
      El audio se procesa en un servidor privado al que solo accede Lic. Ana Pérez. No se sube a servicios en internet de uso general ni queda guardado en servidores de empresas externas.

      ¿Cuánto tiempo se guarda el audio?
      El audio se borra automáticamente apenas se genera la nota clínica. En la práctica esto pasa pocos minutos después de que termina la sesión. No queda una copia.

      ¿Qué queda guardado entonces?
      Solo queda la nota clínica escrita, incorporada a tu historia clínica, igual que las notas que Lic. Ana Pérez escribiría a mano. El audio no queda.

      ¿Podés cambiar de opinión?
      Sí, en cualquier momento. Podés revocar esta autorización cuando quieras, simplemente avisándole a Lic. Ana Pérez. A partir de ese momento las sesiones siguientes no se graban. Esto no afecta para nada la continuidad de tu tratamiento ni la relación con tu profesional.

      ¿Es obligatorio aceptar?
      No. La grabación es totalmente opcional. Si preferís que no se grabe, la sesión sigue de manera normal y Lic. Ana Pérez toma notas como siempre. No hay ninguna consecuencia por decir que no.

      Marco legal
      Esta autorización se enmarca en la Ley 18.331 de Protección de Datos Personales de la República Oriental del Uruguay, que exige que el tratamiento de datos sensibles —como los datos de salud— se haga con tu consentimiento previo, libre, expreso e informado.

      Al firmar, declaro que:
      - Leí y entendí esta información
      - Autorizo la grabación de mis sesiones con Lic. Ana Pérez
      - Sé que puedo revocar esta autorización cuando quiera
      "
    `);
  });
});

describe("esConsentimientoVigente", () => {
  it("devuelve true cuando está firmado y no revocado", () => {
    expect(
      esConsentimientoVigente({
        firmadoEn: new Date("2026-01-01"),
        revocadoEn: null,
      }),
    ).toBe(true);
  });

  it("devuelve false cuando tiene fecha de revocación", () => {
    expect(
      esConsentimientoVigente({
        firmadoEn: new Date("2026-01-01"),
        revocadoEn: new Date("2026-02-01"),
      }),
    ).toBe(false);
  });

  it("devuelve false cuando el consentimiento es null", () => {
    expect(esConsentimientoVigente(null)).toBe(false);
  });
});
