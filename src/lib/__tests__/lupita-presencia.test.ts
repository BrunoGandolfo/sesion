import { beforeEach, describe, expect, it } from "vitest";

import {
  ENFRIAMIENTO_MS,
  ESTADO_INICIAL,
  VENCE_APROBACION_MS,
  admitePosada,
  anotarRiesgo,
  anotarRutaLupita,
  avisar,
  avisarLupita,
  cambiarRuta,
  contarViva,
  esRutaClinica,
  obtenerLupita,
  posadaViva,
  posadaVisible,
  reiniciarLupitaParaTests,
  retirar,
  type EstadoLupita,
} from "@/lib/lupita-presencia";

const T0 = 1_000_000;

/** Una ruta con la posada a la vista. En Hoy, con el día ya leído sin
 *  riesgo: si no, no aparece. */
const HOY = "2026-09-27";
const AYER = "2026-09-26";

function en(ruta: string): EstadoLupita {
  return cambiarRuta({ ...ESTADO_INICIAL, riesgoDelDia: { dia: HOY, hay: false } }, ruta, T0, HOY);
}

describe("rutas con posada (06, D0: lista de permitidas)", () => {
  it.each(["/", "/agenda", "/pacientes", "/cobros", "/config", "/agenda/"])("%s la admite", (ruta) => {
    expect(admitePosada(ruta)).toBe(true);
  });

  it.each([
    "/grabar/t1",
    "/sesiones/s1",
    "/sesiones/s1/transcripcion",
    "/sesiones/s1/para-vos",
    "/pacientes/p1",
    "/pacientes/p1/recorrido/imprimir",
    "/deudores",
    "/finanzas",
    "/una-ruta-nueva",
  ])("%s no la admite", (ruta) => {
    expect(admitePosada(ruta)).toBe(false);
  });

  it("sin ruta todavía no aparece", () => {
    expect(posadaVisible(ESTADO_INICIAL)).toBe(false);
  });

  it("las rutas clínicas son la ficha, la nota y grabar; la lista de pacientes no", () => {
    expect(esRutaClinica("/pacientes/p1")).toBe(true);
    expect(esRutaClinica("/sesiones/s1")).toBe(true);
    expect(esRutaClinica("/grabar/t1")).toBe(true);
    expect(esRutaClinica("/pacientes")).toBe(false);
    expect(esRutaClinica("/")).toBe(false);
  });
});

// Corrección del dueño (27-sep-2026): la lectura de Hoy se recuerda con su
// fecha, para que al volver a Hoy desde otra pantalla la posada no se vaya y
// vuelva a brotar cuando llegan los datos.
describe("la lectura del riesgo del día se recuerda con su fecha", () => {
  const sinRiesgoHoy = cambiarRuta(
    anotarRiesgo(cambiarRuta(ESTADO_INICIAL, "/", T0, HOY), { dia: HOY, hay: false }, T0),
    "/agenda",
    T0 + 1,
    HOY,
  );

  it("mismo día y sin riesgo: al volver a Hoy se queda desde el primer cuadro", () => {
    expect(posadaVisible(cambiarRuta(sinRiesgoHoy, "/", T0 + 2, HOY))).toBe(true);
  });

  it("lectura de otro día: al volver a Hoy espera la lectura nueva", () => {
    expect(posadaVisible(cambiarRuta(sinRiesgoHoy, "/", T0 + 2, "2026-09-28"))).toBe(false);
    const deAyer = anotarRiesgo(ESTADO_INICIAL, { dia: AYER, hay: false }, T0);
    expect(posadaVisible(cambiarRuta(deAyer, "/", T0 + 1, HOY))).toBe(false);
  });

  it("lectura de hoy con riesgo: espera", () => {
    const conRiesgo = anotarRiesgo(sinRiesgoHoy, { dia: HOY, hay: true }, T0 + 2);
    expect(posadaVisible(cambiarRuta(conRiesgo, "/", T0 + 3, HOY))).toBe(false);
  });

  it("sin lectura: espera", () => {
    expect(posadaVisible(cambiarRuta(ESTADO_INICIAL, "/", T0, HOY))).toBe(false);
  });

  it("pasada la medianoche con Hoy abierta, la lectura fresca adelanta el día", () => {
    // Hoy quedó abierta desde ayer: la ruta no cambió y `hoy` quedó en AYER.
    let e = anotarRiesgo(cambiarRuta(ESTADO_INICIAL, "/", T0, AYER), { dia: AYER, hay: false }, T0);
    expect(posadaVisible(e)).toBe(true);
    // Hoy se relee después de medianoche: la lectura es de HOY y sin riesgo.
    e = anotarRiesgo(e, { dia: HOY, hay: false }, T0 + 1);
    expect(e.hoy).toBe(HOY);
    expect(posadaVisible(e)).toBe(true);
    // Una lectura vieja nunca atrasa el día.
    e = anotarRiesgo(e, { dia: AYER, hay: false }, T0 + 2);
    expect(e.hoy).toBe(HOY);
    expect(posadaVisible(e)).toBe(false);
  });

  it("una lectura nueva reemplaza la vieja", () => {
    let e = cambiarRuta(sinRiesgoHoy, "/", T0 + 2, HOY);
    e = anotarRiesgo(e, { dia: HOY, hay: true }, T0 + 3);
    expect(e.riesgoDelDia).toEqual({ dia: HOY, hay: true });
    expect(posadaVisible(e)).toBe(false);
    e = anotarRiesgo(e, { dia: HOY, hay: false }, T0 + 4);
    expect(posadaVisible(e)).toBe(true);
    e = anotarRiesgo(e, null, T0 + 5);
    expect(e.riesgoDelDia).toBeNull();
    expect(posadaVisible(e)).toBe(false);
  });

  it("irse de Hoy no la borra", () => {
    expect(sinRiesgoHoy.riesgoDelDia).toEqual({ dia: HOY, hay: false });
  });
});

describe("retiro", () => {
  it("en Hoy no aparece hasta que Hoy confirma que no hay riesgo en el día (R1)", () => {
    const hoy = cambiarRuta(ESTADO_INICIAL, "/", T0, HOY);
    expect(posadaVisible(hoy)).toBe(false);
    expect(posadaVisible(anotarRiesgo(hoy, { dia: HOY, hay: true }, T0))).toBe(false);
    expect(posadaVisible(anotarRiesgo(hoy, { dia: HOY, hay: false }, T0))).toBe(true);
    // Si la lectura falla, vuelve a no saberse.
    expect(posadaVisible(anotarRiesgo(anotarRiesgo(hoy, { dia: HOY, hay: false }, T0), null, T0))).toBe(false);
    // El riesgo del día es cosa de Hoy: en las otras cuatro no la retira.
    expect(posadaVisible(cambiarRuta(ESTADO_INICIAL, "/agenda", T0))).toBe(true);
  });

  it("un sheet o el teclado la retiran aunque la ruta la admita", () => {
    for (const motivo of ["sheet", "teclado"] as const) {
      const retirada = retirar(en("/"), motivo, true, T0);
      expect(posadaVisible(retirada)).toBe(false);
      expect(posadaVisible(retirar(retirada, motivo, false, T0))).toBe(true);
    }
  });

  it("vuelve sólo cuando se levantan todos los motivos", () => {
    let e = retirar(en("/"), "sheet", true, T0);
    e = retirar(e, "teclado", true, T0);
    e = retirar(e, "sheet", false, T0);
    expect(posadaVisible(e)).toBe(false);
    e = retirar(e, "teclado", false, T0);
    expect(posadaVisible(e)).toBe(true);
  });

  it("con una Lupita de contenido viva se queda quieta, pero sigue a la vista", () => {
    const e = contarViva(en("/pacientes"), 1);
    expect(posadaVisible(e)).toBe(true);
    expect(posadaViva(e)).toBe(false);
    expect(posadaViva(contarViva(e, -1))).toBe(true);
  });

  it("el conteo de vivas no baja de cero", () => {
    expect(contarViva(ESTADO_INICIAL, -1).vivasEnContenido).toBe(0);
  });
});

describe("gestos y enfriamiento", () => {
  it("toque saluda y cobro celebra", () => {
    expect(avisar(en("/"), "toque", T0).gesto?.tipo).toBe("saludo");
    expect(avisar(en("/"), "cobrada", T0).gesto?.tipo).toBe("cobro");
  });

  it("dentro del enfriamiento el gesto se pierde; pasado, entra", () => {
    const primero = avisar(en("/"), "cobrada", T0);
    const durante = avisar(primero, "cobrada", T0 + ENFRIAMIENTO_MS - 1);
    expect(durante).toBe(primero);
    const despues = avisar(primero, "cobrada", T0 + ENFRIAMIENTO_MS);
    expect(despues.gesto).toEqual({ tipo: "cobro", n: 2 });
  });

  it("sin posada a la vista no hay gesto ni cola", () => {
    const retirada = retirar(en("/"), "sheet", true, T0);
    expect(avisar(retirada, "toque", T0)).toBe(retirada);
    expect(avisar(en("/deudores"), "cobrada", T0).gesto).toBeNull();
    // Al volver no aparece un gesto viejo: se perdió.
    expect(retirar(avisar(retirada, "cobrada", T0), "sheet", false, T0 + 1).gesto).toBeNull();
  });
});

describe("aprobación guardada", () => {
  it("aprobar en la nota la guarda y la posada asiente al volver a una de sus pantallas", () => {
    const enLaNota = cambiarRuta(en("/"), "/sesiones/s1", T0);
    const aprobada = avisar(enLaNota, "aprobada", T0);
    expect(aprobada.gesto).toBeNull();
    expect(aprobada.aprobacionGuardada).toBe(T0);

    // Pasar por otra ruta sin posada no la gasta.
    const ficha = cambiarRuta(aprobada, "/pacientes/p1", T0 + 1000);
    expect(ficha.aprobacionGuardada).toBe(T0);

    const vuelta = cambiarRuta(ficha, "/", T0 + 2000);
    expect(vuelta.gesto?.tipo).toBe("asiente");
    expect(vuelta.aprobacionGuardada).toBeNull();
  });

  it("se guarda una sola: dos aprobaciones son un asentimiento", () => {
    let e = cambiarRuta(ESTADO_INICIAL, "/sesiones/s1", T0);
    e = avisar(e, "aprobada", T0);
    e = cambiarRuta(e, "/sesiones/s2", T0 + 10);
    e = avisar(e, "aprobada", T0 + 20);
    e = cambiarRuta(e, "/agenda", T0 + 30);
    expect(e.gesto).toEqual({ tipo: "asiente", n: 1 });
    e = cambiarRuta(cambiarRuta(e, "/sesiones/s3", T0 + 40), "/agenda", T0 + ENFRIAMIENTO_MS + 50);
    expect(e.gesto).toEqual({ tipo: "asiente", n: 1 });
  });

  it("vencida a los 10 minutos, se descarta sin gesto", () => {
    let e = avisar(cambiarRuta(ESTADO_INICIAL, "/sesiones/s1", T0), "aprobada", T0);
    e = cambiarRuta(e, "/agenda", T0 + VENCE_APROBACION_MS);
    expect(e.gesto).toBeNull();
    expect(e.aprobacionGuardada).toBeNull();
  });

  it("la guardada respeta el enfriamiento de un gesto reciente", () => {
    let e = avisar(en("/"), "cobrada", T0);
    e = avisar(cambiarRuta(e, "/sesiones/s1", T0 + 1), "aprobada", T0 + 2);
    e = cambiarRuta(e, "/", T0 + 3);
    expect(e.gesto?.tipo).toBe("cobro");
  });

  it("en Hoy espera a que Hoy confirme el día sin riesgo, y ahí asiente", () => {
    let e = avisar(cambiarRuta(ESTADO_INICIAL, "/sesiones/s1", T0), "aprobada", T0);
    e = cambiarRuta(e, "/", T0 + 1, HOY);
    expect(e.gesto).toBeNull();
    e = anotarRiesgo(e, { dia: HOY, hay: false }, T0 + 2);
    expect(e.gesto?.tipo).toBe("asiente");
  });

  it("si la posada está a la vista, asiente ahí mismo", () => {
    expect(avisar(en("/"), "aprobada", T0).gesto?.tipo).toBe("asiente");
  });

  it("volver con un sheet abierto no la gasta: espera a que se vea", () => {
    let e = avisar(cambiarRuta(ESTADO_INICIAL, "/sesiones/s1", T0), "aprobada", T0);
    e = retirar(e, "sheet", true, T0 + 1);
    e = cambiarRuta(e, "/agenda", T0 + 2);
    expect(e.gesto).toBeNull();
    e = retirar(e, "sheet", false, T0 + 3);
    expect(e.gesto?.tipo).toBe("asiente");
  });
});

describe("almacén", () => {
  beforeEach(() => reiniciarLupitaParaTests());

  it("avisarLupita dice si hubo gesto, para que el toque espere el saludo", () => {
    anotarRutaLupita("/agenda");
    expect(avisarLupita("toque")).toBe(true);
    expect(avisarLupita("toque")).toBe(false);
    expect(obtenerLupita().gesto?.tipo).toBe("saludo");
  });
});
