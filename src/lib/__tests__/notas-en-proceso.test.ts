import { describe, expect, it } from "vitest";

import {
  INTERVALO_CONSULTA_MS,
  MARGEN_VISTA_MS,
  INTERVALO_SIN_VER_MS,
  SEGUIMIENTO_VACIO,
  aplicarRespuesta,
  avisosVisibles,
  enProceso,
  intervaloDeConsulta,
  marcarFallo,
  marcarVista,
  seguir,
  sesionDeLaRuta,
  type AvisoServidor,
  type NotaSeguida,
} from "@/lib/notas-en-proceso";

/** Un reloj cualquiera: lo que importa es la distancia entre marca y pedido. */
const T = 1_000_000;

const lucia: NotaSeguida = { sesionId: "s1", turnoId: "t1", paciente: "Lucía Fernández" };

function fila(id: string, estado: AvisoServidor["estado"], paciente = "Lucía Fernández"): AvisoServidor {
  return { id, paciente, estado, fecha: "2026-09-23T13:00:00.000Z" };
}

describe("cuándo consultar", () => {
  it("con nada en proceso ni sin ver no se consulta", () => {
    expect(intervaloDeConsulta(SEGUIMIENTO_VACIO)).toBeNull();
    expect(intervaloDeConsulta(aplicarRespuesta(SEGUIMIENTO_VACIO, [], T))).toBeNull();
  });

  it("con algo en proceso se consulta cada 15 s; con solo avisos, cada minuto", () => {
    const procesando = aplicarRespuesta(SEGUIMIENTO_VACIO, [fila("s1", "procesando")], T);
    expect(intervaloDeConsulta(procesando)).toBe(INTERVALO_CONSULTA_MS);
    const lista = aplicarRespuesta(procesando, [fila("s1", "revision")], T);
    expect(intervaloDeConsulta(lista)).toBe(INTERVALO_SIN_VER_MS);
    expect(intervaloDeConsulta(aplicarRespuesta(lista, [], T))).toBeNull();
  });

  it("una consulta fallida reintenta aunque no se sepa de nada pendiente, hasta que una responde", () => {
    const fallida = marcarFallo(SEGUIMIENTO_VACIO);
    expect(intervaloDeConsulta(fallida)).toBe(INTERVALO_CONSULTA_MS);
    expect(marcarFallo(fallida)).toBe(fallida);
    expect(intervaloDeConsulta(aplicarRespuesta(fallida, [], T))).toBeNull();
  });

  it("solo subiendo y procesando están en proceso", () => {
    expect(["subiendo", "procesando"].every(enProceso)).toBe(true);
    expect(["grabando", "revision", "aprobada", "fallida", null].some(enProceso)).toBe(false);
  });
});

describe("seguir una sesión que vio una pantalla", () => {
  it("entra en proceso y pide consultar ya", () => {
    const s = seguir(SEGUIMIENTO_VACIO, lucia, T);
    expect(s.enProceso).toEqual([{ sesionId: "s1", paciente: "Lucía Fernández", desde: T }]);
    expect(s.consultarYa).toBe(1);
  });

  it("una ya conocida, con aviso o resuelta no cambia nada (Hoy con datos viejos)", () => {
    const conocida = seguir(SEGUIMIENTO_VACIO, lucia, T);
    expect(seguir(conocida, lucia, T)).toBe(conocida);
    const conAviso = aplicarRespuesta(conocida, [fila("s1", "revision")], T);
    expect(seguir(conAviso, lucia, T)).toBe(conAviso);
    const resuelta = aplicarRespuesta(conAviso, [], T);
    expect(resuelta.resueltas).toContain("s1");
    expect(seguir(resuelta, lucia, T)).toBe(resuelta);
  });
});

describe("la respuesta del servidor es la verdad", () => {
  it("revision y fallida son avisos, con el nombre", () => {
    const s = aplicarRespuesta(SEGUIMIENTO_VACIO, [
      fila("s1", "revision"),
      fila("s2", "fallida", "Ana Pérez"),
    ], T);
    expect(s.avisos).toEqual([
      { sesionId: "s1", paciente: "Lucía Fernández", tipo: "lista" },
      { sesionId: "s2", paciente: "Ana Pérez", tipo: "fallida" },
    ]);
    expect(s.enProceso).toEqual([]);
  });

  it("lo que estaba en proceso y ya no está pasa a resueltas, una sola vez", () => {
    const s1 = aplicarRespuesta(SEGUIMIENTO_VACIO, [fila("s1", "procesando")], T);
    expect(s1.resueltas).toEqual([]);
    const s2 = aplicarRespuesta(s1, [fila("s1", "revision")], T);
    expect(s2.resueltas).toEqual(["s1"]);
    expect(aplicarRespuesta(s2, [], T).resueltas).toEqual(["s1"]);
  });

  it("una sesión seguida por la ficha que el servidor no trae sale del proceso", () => {
    const s = aplicarRespuesta(seguir(SEGUIMIENTO_VACIO, lucia, T), [], T + 1);
    expect(s.enProceso).toEqual([]);
    expect(s.resueltas).toEqual(["s1"]);
  });

  it("una respuesta a un pedido que salió antes de seguirla no la da por terminada", () => {
    // El pedido sale en T; Hoy la ve en proceso en T + 100; la respuesta
    // (vacía: el pedido no sabía de ella) llega después.
    const seguida = seguir(SEGUIMIENTO_VACIO, lucia, T + 100);
    const vieja = aplicarRespuesta(seguida, [], T);
    expect(vieja.enProceso.map((n) => n.sesionId)).toEqual(["s1"]);
    expect(vieja.resueltas).toEqual([]);
    // La siguiente, ya enterada, la confirma en proceso y después terminada.
    const nueva = aplicarRespuesta(vieja, [fila("s1", "procesando")], T + 200);
    expect(nueva.resueltas).toEqual([]);
    expect(aplicarRespuesta(nueva, [fila("s1", "revision")], T + 300).resueltas).toEqual(["s1"]);
  });

  it("una que vuelve a procesarse deja de estar resuelta, y se resuelve de nuevo al terminar", () => {
    const lista = aplicarRespuesta(
      aplicarRespuesta(SEGUIMIENTO_VACIO, [fila("s1", "procesando")], T),
      [fila("s1", "revision")],
      T + 1,
    );
    expect(lista.resueltas).toEqual(["s1"]);
    const otraVez = aplicarRespuesta(lista, [fila("s1", "procesando")], T + 2);
    expect(otraVez.resueltas).toEqual([]);
    expect(aplicarRespuesta(otraVez, [fila("s1", "revision")], T + 3).resueltas).toEqual(["s1"]);
  });
});

describe("abrir la nota", () => {
  it("la saca de la franja ya, y se olvida cuando el servidor deja de traerla", () => {
    const conAviso = aplicarRespuesta(SEGUIMIENTO_VACIO, [fila("s1", "revision")], T);
    const vista = marcarVista(conAviso, "s1", T);
    expect(avisosVisibles(vista)).toEqual([]);
    // Una respuesta de un pedido que salió antes del sesion.ver todavía la
    // trae: no la hace reaparecer.
    const atrasada = aplicarRespuesta(vista, [fila("s1", "revision")], T + MARGEN_VISTA_MS);
    expect(avisosVisibles(atrasada)).toEqual([]);
    // El servidor ya registró el sesion.ver: se olvida la marca local.
    const confirmada = aplicarRespuesta(atrasada, [], T + 60_000);
    expect(confirmada.vistas).toEqual([]);
    // Si después vuelve a estar lista (Volver a escribirla), avisa de nuevo.
    expect(avisosVisibles(aplicarRespuesta(confirmada, [fila("s1", "revision")], T + 120_000))).toHaveLength(1);
  });

  it("si la nota no se llegó a leer (falló la carga), el aviso vuelve con la primera respuesta posterior", () => {
    const conAviso = aplicarRespuesta(SEGUIMIENTO_VACIO, [fila("s1", "revision")], T);
    const vista = marcarVista(conAviso, "s1", T);
    const despues = aplicarRespuesta(vista, [fila("s1", "revision")], T + MARGEN_VISTA_MS + 1);
    expect(despues.vistas).toEqual([]);
    expect(avisosVisibles(despues)).toHaveLength(1);
  });

  it("salir de la nota renueva la marca", () => {
    const conAviso = aplicarRespuesta(SEGUIMIENTO_VACIO, [fila("s1", "revision")], T);
    const s = marcarVista(marcarVista(conAviso, "s1", T), "s1", T + 30_000);
    expect(s.vistas).toEqual([{ sesionId: "s1", desde: T + 30_000 }]);
  });

  it("marcar una sesión sin aviso no cambia nada", () => {
    expect(marcarVista(SEGUIMIENTO_VACIO, "s1", T)).toBe(SEGUIMIENTO_VACIO);
  });

  it("reconoce la sesión en la ruta", () => {
    expect(sesionDeLaRuta("/sesiones/abc")).toBe("abc");
    expect(sesionDeLaRuta("/sesiones/abc/transcripcion")).toBe("abc");
    expect(sesionDeLaRuta("/cobros")).toBeNull();
    expect(sesionDeLaRuta(null)).toBeNull();
  });
});
