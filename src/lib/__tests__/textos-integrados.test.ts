import { expect, it } from "vitest";
import { EstadoEnvioSms } from "@prisma/client";
import { RECORDATORIO_ESTADO, otrasSesionesCerradas, CUENTA_TOPE_INVITACIONES, FRECUENCIA_LABEL, FEEDBACK_ESTADO_LABEL } from "@/lib/glosario";
import { FRECUENCIAS_TURNO } from "@/lib/constantes-turno";
it("cubre cada estado durable de SMS y distingue aceptación de entrega", () => {
  expect(Object.keys(RECORDATORIO_ESTADO).sort()).toEqual(Object.values(EstadoEnvioSms).sort());
  expect(RECORDATORIO_ESTADO.aceptado).toBe("En camino");
  expect(RECORDATORIO_ESTADO.entregado).toBe("Entregado");
  expect(RECORDATORIO_ESTADO.desconocido).toBe("No sabemos si salió");
});
it("los mensajes respetan las cantidades reales", () => {
  expect(otrasSesionesCerradas(0)).toBe("No había otras sesiones abiertas.");
  expect(otrasSesionesCerradas(1)).toBe("Cerramos 1 sesión en otro dispositivo.");
  expect(otrasSesionesCerradas(3)).toBe("Cerramos 3 sesiones en otros dispositivos.");
  expect(CUENTA_TOPE_INVITACIONES(2)).toContain("2 invitaciones vigentes");
});
it("cada frecuencia y cada estado de Para vos tienen texto", () => {
  expect(Object.keys(FRECUENCIA_LABEL).sort()).toEqual([...FRECUENCIAS_TURNO].sort());
  expect(Object.keys(FEEDBACK_ESTADO_LABEL).sort()).toEqual(["fallido","listo","no_pedido","pendiente"]);
});
