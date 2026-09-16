import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { interpolarTemplateCobro, TEMPLATE_COBRO_DEFAULT } from "@/lib/deudas";
import { SMS_BAJA_CONFIRMADA } from "@/lib/glosario";
import { buildSmsMessage, contarLongitudSms, prepararPlantillaRecordatorio, TEMPLATE_SMS_SUGERIDO, textoDelEnvio } from "@/lib/sms/texto";

// Textos anteriores congelados: el presupuesto se compara con lo que salía
// antes, no con otra constante de producción que podría cambiar a la vez.
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
    { tipo: "recordatorio", antes: buildSmsMessage(RECORDATORIO_ANTERIOR, d), despues: textoDelEnvio("recordatorio_turno", TEMPLATE_SMS_SUGERIDO, d) },
    { tipo: "recordatorio inicial", antes: buildSmsMessage(`${RECORDATORIO_INICIAL}\n${CONTACTO_ANTERIOR}`, d), despues: textoDelEnvio("recordatorio_turno", RECORDATORIO_INICIAL, d) },
    { tipo: "cambio", antes: buildSmsMessage(CAMBIO_ANTERIOR, d), despues: textoDelEnvio("cambio_de_horario", RECORDATORIO_ANTERIOR, d) },
    { tipo: "cobro", antes: interpolarTemplateCobro(COBRO_ANTERIOR, d), despues: interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, d) },
  ];
}

describe("identidad y costo de los SMS", () => {
  it("registra el conteo antes y después con los mismos datos", () => {
    const filas = [...mensajes(datos), {
      tipo: "baja global", antes: "Listo: no vas a recibir más mensajes de este número.", despues: SMS_BAJA_CONFIRMADA,
    }];
    expect(filas.map(({ tipo, antes, despues }) => ({ tipo, antes: contarLongitudSms(antes), despues: contarLongitudSms(despues) }))).toEqual([
      { tipo: "recordatorio", antes: { caracteres: 133, segmentos: 2, gsm7: false }, despues: { caracteres: 115, segmentos: 2, gsm7: false } },
      { tipo: "recordatorio inicial", antes: { caracteres: 192, segmentos: 3, gsm7: false }, despues: { caracteres: 125, segmentos: 2, gsm7: false } },
      { tipo: "cambio", antes: { caracteres: 150, segmentos: 3, gsm7: false }, despues: { caracteres: 119, segmentos: 2, gsm7: false } },
      { tipo: "cobro", antes: { caracteres: 167, segmentos: 3, gsm7: false }, despues: { caracteres: 79, segmentos: 2, gsm7: false } },
      { tipo: "baja global", antes: { caracteres: 52, segmentos: 1, gsm7: false }, despues: { caracteres: 37, segmentos: 1, gsm7: false } },
    ]);
  });

  it("actualiza la sugerencia vieja ya guardada y no duplica remitente ni contacto al prepararla de nuevo", () => {
    const preparada = prepararPlantillaRecordatorio(RECORDATORIO_ANTERIOR);
    expect(preparada).toBe(TEMPLATE_SMS_SUGERIDO);
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
      expect(contarLongitudSms(buildSmsMessage(`${RECORDATORIO_INICIAL}\n${CONTACTO_ANTERIOR}`, datos))).toEqual({ caracteres: 192, segmentos: 3, gsm7: false });
      expect(contarLongitudSms(nuevo)).toEqual({ caracteres: 125, segmentos: 2, gsm7: false });
    }
  });

  it("reubica firma y contacto de textos personalizados sin aumentar segmentos ni cambiar el cuerpo", () => {
    for (const caracter of ["A", "í", "€", "😀"]) {
      for (let longitud = 1; longitud <= 320; longitud++) {
        const cuerpo = caracter.repeat(longitud);
        for (const plantilla of [cuerpo, `${cuerpo} ${CONTACTO_ANTERIOR}`]) {
          const d = { ...datos, nombre: "Ana", profesional: "Marta" };
          const antes = buildSmsMessage(plantilla.includes(CONTACTO_ANTERIOR) ? plantilla : `${plantilla}\n${CONTACTO_ANTERIOR}`, d);
          const despues = textoDelEnvio("recordatorio_turno", plantilla, d);
          expect(despues).toBe(`Consultorio Marta\n${cuerpo}${plantilla.includes(CONTACTO_ANTERIOR) ? " " : "\n"}Cambios: llamar al +598 99 876 543`);
          expect(contarLongitudSms(despues).segmentos).toBeLessThanOrEqual(contarLongitudSms(antes).segmentos);
        }
      }
    }
  });

  it("preserva las aclaraciones de horario y las menciones al consultorio dentro del cuerpo", () => {
    const plantilla = `Hola {{nombre}}, te esperamos en el Consultorio {{profesional}}. ${CONTACTO_ANTERIOR} de 9 a 17.`;
    const nuevo = textoDelEnvio("recordatorio_turno", plantilla, datos);
    expect(nuevo).toBe("Consultorio Mariana Roldán\nHola Lucía, te esperamos en el Consultorio Mariana Roldán. Cambios: llamar al +598 99 876 543 de 9 a 17.");
    expect(contarLongitudSms(nuevo).segmentos).toBeLessThanOrEqual(contarLongitudSms(buildSmsMessage(plantilla, datos)).segmentos);
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

  it("no aumenta segmentos con nombres GSM-7, tildes, extensión, emoji ni en los límites de longitud", () => {
    for (const nombre of ["Ana", "Lucía", "Ana €", "Ana 😀"]) {
      for (const sesiones of [1, 2, 100]) {
        for (let longitud = 1; longitud <= 170; longitud++) {
          const d = { ...datos, nombre, sesiones, profesional: "A".repeat(longitud) };
          for (const { tipo, antes, despues } of mensajes(d)) {
            expect(contarLongitudSms(despues).segmentos, `${tipo}: ${nombre}, ${sesiones}, ${longitud}`).toBeLessThanOrEqual(contarLongitudSms(antes).segmentos);
          }
        }
      }
    }
  });
});
