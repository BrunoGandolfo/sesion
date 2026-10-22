import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { interpolarTemplateCobro, TEMPLATE_COBRO_DEFAULT } from "@/lib/deudas";
import { armarMensaje, prepararPlantillaRecordatorio, TEMPLATE_RECORDATORIO_SUGERIDO, textoDelEnvio } from "@/lib/recordatorio-texto";

// Textos anteriores congelados: las plantillas guardadas con ellos se siguen
// reconociendo y se actualizan al prepararlas.
const CONTACTO_ANTERIOR = "Para cambios, comunicate con {{profesional}} al {{telefonoConsultorio}}";
const RECORDATORIO_ANTERIOR = `Hola {{nombre}}, te recordamos tu sesión el {{fecha}} a las {{hora}}. ${CONTACTO_ANTERIOR}`;
const CAMBIO_ANTERIOR = `Hola {{nombre}}, cambió el horario de tu sesión: ahora es el {{fecha}} a las {{hora}}. ${CONTACTO_ANTERIOR}`;
const COBRO_ANTERIOR = "Hola {{nombre}}, ¿cómo estás? Te escribo para recordarte que tenés {{sesiones}} sesión/es pendiente/s de pago por un total de {{monto}}. Cualquier duda estoy a disposición. {{profesional}}";
const RECORDATORIO_INICIAL = "Hola {{nombre}}. Te recordamos tu sesión:\n{{fecha}}  |  {{hora}}\n{{direccion}}\n\nCualquier cambio, avisame con anticipación. Gracias.";

const datos = {
  nombre: "Lucía", apellido: "Fernández", profesional: "Mariana Roldán",
  fecha: new Date("2026-04-21T13:00:00Z"), direccion: "Calle 123",
  telefonoConsultorio: "+598 99 876 543", sesiones: 2, monto: "$ 4.200",
};

function mensajes(d: typeof datos) {
  return [
    { tipo: "recordatorio", antes: armarMensaje(RECORDATORIO_ANTERIOR, d), despues: textoDelEnvio("recordatorio_turno", TEMPLATE_RECORDATORIO_SUGERIDO, d) },
    { tipo: "recordatorio inicial", antes: armarMensaje(`${RECORDATORIO_INICIAL}\n${CONTACTO_ANTERIOR}`, d), despues: textoDelEnvio("recordatorio_turno", RECORDATORIO_INICIAL, d) },
    { tipo: "cambio", antes: armarMensaje(CAMBIO_ANTERIOR, d), despues: textoDelEnvio("cambio_de_horario", RECORDATORIO_ANTERIOR, d) },
    { tipo: "cobro", antes: interpolarTemplateCobro(COBRO_ANTERIOR, d), despues: interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, d) },
  ];
}

describe("identidad de los avisos a la paciente", () => {
  it("actualiza la sugerencia vieja ya guardada y no duplica remitente ni contacto al prepararla de nuevo", () => {
    const preparada = prepararPlantillaRecordatorio(RECORDATORIO_ANTERIOR);
    expect(preparada).toBe(TEMPLATE_RECORDATORIO_SUGERIDO);
    expect(prepararPlantillaRecordatorio(preparada)).toBe(preparada);
    expect(textoDelEnvio("recordatorio_turno", RECORDATORIO_ANTERIOR, datos)).toBe(mensajes(datos)[0].despues);
    const personalizada = prepararPlantillaRecordatorio(`Traer libreta. ${CONTACTO_ANTERIOR}`);
    expect(personalizada).toBe("Consultorio {{profesional}}\nTraer libreta. Cambios: llamar al {{telefonoConsultorio}}");
    expect(prepararPlantillaRecordatorio(personalizada)).toBe(personalizada);
  });

  it("actualiza el default de la base que decía avisame, preservando la dirección y dando un canal", () => {
    // Si cambia ese default, esta compatibilidad debe revisarse.
    const esquema = readFileSync("prisma/schema.prisma", "utf8");
    expect(esquema).toContain(`@default(${JSON.stringify(RECORDATORIO_INICIAL)})`);
    for (const plantilla of [RECORDATORIO_INICIAL, `${RECORDATORIO_INICIAL}\n${CONTACTO_ANTERIOR}`]) {
      const preparada = prepararPlantillaRecordatorio(plantilla);
      expect(prepararPlantillaRecordatorio(preparada)).toBe(preparada);
      const nuevo = textoDelEnvio("recordatorio_turno", plantilla, datos);
      expect(nuevo).toBe("Consultorio Mariana Roldán\nLucía, tu turno es el martes 21 de abril a las 10:00.\nCalle 123\nCambios: llamar al +598 99 876 543");
      expect(nuevo).not.toContain("avisame");
    }
  });

  it("reubica firma y contacto de textos personalizados sin cambiar el cuerpo", () => {
    for (const cuerpo of ["Traer libreta.", "í".repeat(40), "😀 nos vemos"]) {
      for (const plantilla of [cuerpo, `${cuerpo} ${CONTACTO_ANTERIOR}`]) {
        const d = { ...datos, nombre: "Ana", profesional: "Marta" };
        expect(textoDelEnvio("recordatorio_turno", plantilla, d))
          .toBe(`Consultorio Marta\n${cuerpo}${plantilla.includes(CONTACTO_ANTERIOR) ? " " : "\n"}Cambios: llamar al +598 99 876 543`);
      }
    }
  });

  it("preserva las aclaraciones de horario y las menciones al consultorio dentro del cuerpo", () => {
    const plantilla = `Hola {{nombre}}, te esperamos en el Consultorio {{profesional}}. ${CONTACTO_ANTERIOR} de 9 a 17.`;
    const nuevo = textoDelEnvio("recordatorio_turno", plantilla, datos);
    expect(nuevo).toBe("Consultorio Mariana Roldán\nHola Lucía, te esperamos en el Consultorio Mariana Roldán. Cambios: llamar al +598 99 876 543 de 9 a 17.");
    const conSede = "Consultorio {{profesional}} (sede Centro)\nHola {{nombre}}. Cambios: llamar al {{telefonoConsultorio}} de 9 a 17.";
    expect(prepararPlantillaRecordatorio(conSede)).toBe(conSede);
  });

  it("los avisos empiezan con el consultorio y la profesional, sin invitar a responder", () => {
    const textos = mensajes(datos);
    for (const { tipo, despues } of textos) {
      expect(despues.split("\n")[0], tipo).toBe("Consultorio Mariana Roldán");
      expect(despues, tipo).not.toMatch(/respond|contest|cómo estás|disposición/i);
    }
    expect(textos[0].despues).toBe("Consultorio Mariana Roldán\nLucía, tu turno es el martes 21 de abril a las 10:00. Cambios: llamar al +598 99 876 543");
    expect(textos[2].despues).toBe("Consultorio Mariana Roldán\nLucía, tu turno cambió al martes 21 de abril a las 10:00. Cambios: llamar al +598 99 876 543");
    expect(textos[3].despues).toBe("Consultorio Mariana Roldán\nLucía, tenés 2 sesiones pendientes de pago: $ 4.200.");
  });
});
