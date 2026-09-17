import { expect, it } from "vitest";

import { INVITAR_DESCRIPCION, INVITAR_LIMITES, PRUEBA_AVISO, PRUEBA_TOPE } from "@/lib/glosario";
import {
  cupoInvitacion,
  ESPERA_ENTRE_INVITACIONES_MS,
  estadoPrueba,
  TOPE_GRABACIONES_PRUEBA,
  TOPE_INVITACIONES_TOTAL,
} from "@/lib/limites-prueba";

const ahora = new Date("2026-09-17T15:30:00Z");

it("los tres números son los que decidió el dueño", () => {
  expect(TOPE_INVITACIONES_TOTAL).toBe(5);
  expect(ESPERA_ENTRE_INVITACIONES_MS).toBe(30 * 24 * 60 * 60 * 1000);
  expect(TOPE_GRABACIONES_PRUEBA).toBe(15);
});

it("cinco en total, para siempre: la sexta no, aunque hayan pasado años", () => {
  const hace_anios = new Date("2020-01-01T00:00:00Z");
  expect(cupoInvitacion({ generadas: 4, ultimaEn: hace_anios }, ahora)).toEqual({ disponible: true, restantes: 1 });
  expect(cupoInvitacion({ generadas: 5, ultimaEn: hace_anios }, ahora)).toEqual({ disponible: false, motivo: "agotadas", restantes: 0 });
});

it("una cada treinta días desde la última, no por mes calendario", () => {
  // Última el 30 de septiembre: el 1 de octubre ya es otro mes, y no alcanza.
  const ultimaEn = new Date("2026-09-30T12:00:00Z");
  const desde = new Date("2026-10-30T12:00:00Z");
  expect(cupoInvitacion({ generadas: 1, ultimaEn }, new Date("2026-10-01T12:00:00Z"))).toEqual({ disponible: false, motivo: "espera", restantes: 4, desde });
  expect(cupoInvitacion({ generadas: 1, ultimaEn }, new Date(desde.getTime() - 1))).toMatchObject({ disponible: false, motivo: "espera" });
  expect(cupoInvitacion({ generadas: 1, ultimaEn }, desde)).toEqual({ disponible: true, restantes: 4 });
  expect(cupoInvitacion({ generadas: 0, ultimaEn: null }, ahora)).toEqual({ disponible: true, restantes: 5 });
});

it("estado de la prueba: null para una cuenta que no nació de una invitación", () => {
  expect(estadoPrueba({ deInvitacion: false, grabacionesIniciadas: 40 })).toBeNull();
  expect(estadoPrueba({ deInvitacion: true, grabacionesIniciadas: 0 })).toEqual({ usadas: 0, restantes: 15, tope: 15 });
  expect(estadoPrueba({ deInvitacion: true, grabacionesIniciadas: 15 })).toEqual({ usadas: 15, restantes: 0, tope: 15 });
});

it("los textos dicen los tres límites con los números del código", () => {
  expect(INVITAR_DESCRIPCION).toContain("para que una colega pruebe Sesión");
  expect(INVITAR_DESCRIPCION).toContain("hasta 15 sesiones en total");
  expect(INVITAR_LIMITES).toBe("Podés generar 5 invitaciones en total, una cada 30 días.");
  expect(PRUEBA_AVISO(3)).toBe("Estás probando Sesión: este consultorio puede grabar hasta 15 sesiones. Llevás 3.");
  expect(PRUEBA_TOPE).toContain("Llegaste a las 15 sesiones grabadas de la prueba");
});
