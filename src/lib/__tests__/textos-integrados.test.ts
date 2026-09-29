import { expect, it } from "vitest";
import { EstadoEnvioSms } from "@prisma/client";
import { RECORDATORIO_ESTADO, otrasSesionesCerradas, INVITAR_RESTANTES, PRUEBA_CERCA, FRECUENCIA_LABEL, FEEDBACK_ESTADO_LABEL } from "@/lib/glosario";
import { FRECUENCIAS_TURNO } from "@/lib/constantes-turno";
// Lo que protege: ningún estado del SMS llega a la pantalla como clave cruda,
// y "aceptado" (Twilio lo tomó) no se dice igual que "entregado". Las
// palabras en sí no se copian acá: viven en el glosario.
it("cubre cada estado durable de SMS y distingue aceptación de entrega", () => {
  expect(Object.keys(RECORDATORIO_ESTADO).sort()).toEqual(Object.values(EstadoEnvioSms).sort());
  for (const [estado, texto] of Object.entries(RECORDATORIO_ESTADO)) {
    expect(texto.trim(), estado).not.toBe("");
    expect(texto, estado).not.toBe(estado);
  }
  expect(RECORDATORIO_ESTADO.aceptado).not.toBe(RECORDATORIO_ESTADO.entregado);
  expect(new Set(Object.values(RECORDATORIO_ESTADO)).size).toBe(Object.keys(RECORDATORIO_ESTADO).length);
});
it("los mensajes respetan las cantidades reales", () => {
  expect(otrasSesionesCerradas(0)).toBe("No había otras sesiones abiertas.");
  expect(otrasSesionesCerradas(1)).toBe("Cerramos 1 sesión en otro dispositivo.");
  expect(otrasSesionesCerradas(3)).toBe("Cerramos 3 sesiones en otros dispositivos.");
  expect(INVITAR_RESTANTES(1)).toBe("Te queda 1 invitación.");
  expect(INVITAR_RESTANTES(4)).toBe("Te quedan 4 invitaciones.");
  expect(PRUEBA_CERCA(1)).toBe("Te queda 1 sesión para grabar de las 15 de la prueba.");
  expect(PRUEBA_CERCA(3)).toBe("Te quedan 3 sesiones para grabar de las 15 de la prueba.");
});
it("cada frecuencia y cada estado de Para vos tienen texto", () => {
  expect(Object.keys(FRECUENCIA_LABEL).sort()).toEqual([...FRECUENCIAS_TURNO].sort());
  expect(Object.keys(FEEDBACK_ESTADO_LABEL).sort()).toEqual(["fallido","listo","no_pedido","pendiente"]);
});
