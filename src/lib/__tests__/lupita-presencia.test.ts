import { beforeEach, describe, expect, it } from "vitest";

import {
  ENFRIAMIENTO_MS,
  ESTADO_INICIAL,
  VENCE_APROBACION_MS,
  admitePosada,
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

function en(ruta: string): EstadoLupita {
  return cambiarRuta(ESTADO_INICIAL, ruta, T0);
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

describe("retiro", () => {
  it("un sheet, el teclado o el riesgo del día la retiran aunque la ruta la admita", () => {
    for (const motivo of ["sheet", "teclado", "riesgo-del-dia"] as const) {
      const retirada = retirar(en("/"), motivo, true, T0);
      expect(posadaVisible(retirada)).toBe(false);
      expect(posadaVisible(retirar(retirada, motivo, false, T0))).toBe(true);
    }
  });

  it("vuelve sólo cuando se levantan todos los motivos", () => {
    let e = retirar(en("/"), "sheet", true, T0);
    e = retirar(e, "riesgo-del-dia", true, T0);
    e = retirar(e, "sheet", false, T0);
    expect(posadaVisible(e)).toBe(false);
    e = retirar(e, "riesgo-del-dia", false, T0);
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
    e = cambiarRuta(e, "/", T0 + 30);
    expect(e.gesto).toEqual({ tipo: "asiente", n: 1 });
    e = cambiarRuta(cambiarRuta(e, "/sesiones/s3", T0 + 40), "/", T0 + ENFRIAMIENTO_MS + 50);
    expect(e.gesto).toEqual({ tipo: "asiente", n: 1 });
  });

  it("vencida a los 10 minutos, se descarta sin gesto", () => {
    let e = avisar(cambiarRuta(ESTADO_INICIAL, "/sesiones/s1", T0), "aprobada", T0);
    e = cambiarRuta(e, "/", T0 + VENCE_APROBACION_MS);
    expect(e.gesto).toBeNull();
    expect(e.aprobacionGuardada).toBeNull();
  });

  it("la guardada respeta el enfriamiento de un gesto reciente", () => {
    let e = avisar(en("/"), "cobrada", T0);
    e = avisar(cambiarRuta(e, "/sesiones/s1", T0 + 1), "aprobada", T0 + 2);
    e = cambiarRuta(e, "/", T0 + 3);
    expect(e.gesto?.tipo).toBe("cobro");
  });

  it("si la posada está a la vista, asiente ahí mismo", () => {
    expect(avisar(en("/"), "aprobada", T0).gesto?.tipo).toBe("asiente");
  });

  it("volver con un sheet abierto no la gasta: espera a que se vea", () => {
    let e = avisar(cambiarRuta(ESTADO_INICIAL, "/sesiones/s1", T0), "aprobada", T0);
    e = retirar(e, "sheet", true, T0 + 1);
    e = cambiarRuta(e, "/", T0 + 2);
    expect(e.gesto).toBeNull();
    e = retirar(e, "sheet", false, T0 + 3);
    expect(e.gesto?.tipo).toBe("asiente");
  });
});

describe("almacén", () => {
  beforeEach(() => reiniciarLupitaParaTests());

  it("avisarLupita dice si hubo gesto, para que el toque espere el saludo", () => {
    anotarRutaLupita("/");
    expect(avisarLupita("toque")).toBe(true);
    expect(avisarLupita("toque")).toBe(false);
    expect(obtenerLupita().gesto?.tipo).toBe("saludo");
  });
});
