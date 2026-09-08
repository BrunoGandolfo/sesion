import { describe, it, expect } from "vitest";

import {
  TEMPLATE_COBRO_DEFAULT,
  interpolarTemplateCobro,
  textoAtraso,
  zonaDeuda,
} from "@/lib/deudas";
import { money } from "@/lib/format";

// Este archivo cubre `src/lib/deudas.ts`: cómo se dice y se muestra una
// deuda. El cálculo de quién debe y cuánto vive en `app/api/_lib/domain.ts`
// y lo cubre `deuda.test.ts`.
//
// El bloque que más importa es interpolarTemplateCobro: lo que sale de ahí
// es, literal, el SMS que le llega a una paciente (y el texto que la
// pantalla le muestra a ella antes de confirmar el envío).

// ─── zonaDeuda ────────────────────────────────────────────────────────────

describe("zonaDeuda — los dos umbrales, 15 y 31 días", () => {
  it("de 0 a 14 días es sage", () => {
    for (const dias of [0, 1, 7, 13, 14]) {
      expect(zonaDeuda(dias), `${dias} días`).toBe("sage");
    }
  });

  it("de 15 a 30 días es gold", () => {
    for (const dias of [15, 16, 22, 29, 30]) {
      expect(zonaDeuda(dias), `${dias} días`).toBe("gold");
    }
  });

  it("de 31 días en adelante es terracotta", () => {
    for (const dias of [31, 32, 60, 365, 10_000]) {
      expect(zonaDeuda(dias), `${dias} días`).toBe("terracotta");
    }
  });

  it("los bordes caen del lado que dice el comentario del módulo", () => {
    // 14 todavía no alarma, 15 sí; 30 todavía es ocre, 31 ya es terracotta.
    expect(zonaDeuda(14)).toBe("sage");
    expect(zonaDeuda(15)).toBe("gold");
    expect(zonaDeuda(30)).toBe("gold");
    expect(zonaDeuda(31)).toBe("terracotta");
  });

  it("un atraso negativo (turno futuro) no pinta alarma", () => {
    expect(zonaDeuda(-1)).toBe("sage");
  });
});

// ─── textoAtraso ──────────────────────────────────────────────────────────

describe("textoAtraso", () => {
  it("hoy no dice 'hace 0 días'", () => {
    expect(textoAtraso(0)).toBe("hoy");
  });

  it("un día va en singular", () => {
    expect(textoAtraso(1)).toBe("hace 1 día");
  });

  it("de dos en adelante, plural", () => {
    expect(textoAtraso(2)).toBe("hace 2 días");
    expect(textoAtraso(45)).toBe("hace 45 días");
  });

  it("un atraso negativo se cuenta como hoy, no como 'hace -3 días'", () => {
    expect(textoAtraso(-3)).toBe("hoy");
  });
});

// ─── interpolarTemplateCobro ──────────────────────────────────────────────

const VARS = {
  nombre: "Ana",
  sesiones: 2,
  monto: money(4200),
  profesional: "Lic. Marta Sosa",
};

describe("interpolarTemplateCobro — la plantilla por defecto", () => {
  it("con una sola sesión el mensaje queda en singular y sin barras", () => {
    const mensaje = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
      ...VARS,
      sesiones: 1,
    });
    expect(mensaje).toBe(
      "Hola Ana, ¿cómo estás? Te escribo para recordarte que tenés 1 sesión " +
        "pendiente de pago por un total de $ 4.200. Cualquier duda estoy a " +
        "disposición. Lic. Marta Sosa",
    );
  });

  it("con varias sesiones, plural", () => {
    const mensaje = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
      ...VARS,
      sesiones: 3,
    });
    expect(mensaje).toContain("tenés 3 sesiones pendientes de pago");
  });

  it("nunca le llega a la paciente una barra ni un placeholder", () => {
    for (const n of [1, 2, 7]) {
      const mensaje = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
        ...VARS,
        sesiones: n,
      });
      expect(mensaje, `${n} sesiones`).not.toContain("/");
      expect(mensaje, `${n} sesiones`).not.toMatch(/\{\{|\}\}/);
    }
  });

  it("sin firma configurada el mensaje no termina con un espacio colgando", () => {
    // El caso real: /api/config todavía no existe y cobros-view manda "".
    const mensaje = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, {
      ...VARS,
      profesional: "",
    });
    expect(mensaje.endsWith("Cualquier duda estoy a disposición.")).toBe(true);
    expect(mensaje).toBe(mensaje.trim());
  });

  it("el monto entra tal como lo formatea money(), con su signo", () => {
    const mensaje = interpolarTemplateCobro(TEMPLATE_COBRO_DEFAULT, VARS);
    expect(mensaje).toContain(money(4200));
  });
});

describe("interpolarTemplateCobro — la regex de {{sesiones}} + texto redundante", () => {
  it("absorbe 'sesión/es pendiente/s' aunque haya espacios de más", () => {
    expect(
      interpolarTemplateCobro("Tenés {{sesiones}}  sesión/es   pendiente/s.", {
        ...VARS,
        sesiones: 1,
      }),
    ).toBe("Tenés 1 sesión pendiente.");
  });

  it("absorbe el trozo aunque el placeholder y el texto queden pegados", () => {
    expect(
      interpolarTemplateCobro("Tenés {{sesiones}}sesión/es pendiente/s.", {
        ...VARS,
        sesiones: 4,
      }),
    ).toBe("Tenés 4 sesiones pendientes.");
  });

  it("lo absorbe también si el trozo aparece más de una vez", () => {
    expect(
      interpolarTemplateCobro(
        "{{sesiones}} sesión/es pendiente/s — repito: {{sesiones}} sesión/es pendiente/s",
        { ...VARS, sesiones: 1 },
      ),
    ).toBe("1 sesión pendiente — repito: 1 sesión pendiente");
  });

  it("sin el texto redundante cae al reemplazo simple por el número", () => {
    expect(
      interpolarTemplateCobro("Te debo {{sesiones}} sesiones.", {
        ...VARS,
        sesiones: 5,
      }),
    ).toBe("Te debo 5 sesiones.");
  });

  it("cero sesiones va en plural, como en castellano rioplatense", () => {
    expect(
      interpolarTemplateCobro("{{sesiones}} sesión/es pendiente/s", {
        ...VARS,
        sesiones: 0,
      }),
    ).toBe("0 sesiones pendientes");
  });

  it("un placeholder desconocido o mal escrito se deja como está, no se rompe", () => {
    // Preferimos que se vea el error a mandar un mensaje mutilado.
    expect(
      interpolarTemplateCobro("{{Sesiones}} y {{ sesiones }} y {{apellido}}", VARS),
    ).toBe("{{Sesiones}} y {{ sesiones }} y {{apellido}}");
  });

  it("una plantilla sin placeholders sale intacta", () => {
    expect(interpolarTemplateCobro("Hola, ¿pasamos el pago?", VARS)).toBe(
      "Hola, ¿pasamos el pago?",
    );
  });
});

describe("interpolarTemplateCobro — los valores entran literales", () => {
  // Los valores se insertan con una función de reemplazo, no con un string:
  // como string, "$&", "$'" y "$`" son patrones de reemplazo de
  // String.replace y se expandirían solos. Nombre y firma son campos que
  // escribe la profesional; lo que salga de acá lo lee una paciente.
  it("un nombre con $& no se convierte en el placeholder", () => {
    expect(
      interpolarTemplateCobro("Hola {{nombre}}.", { ...VARS, nombre: "A$&B" }),
    ).toBe("Hola A$&B.");
  });

  it("una firma con $` o $' entra tal cual", () => {
    expect(
      interpolarTemplateCobro("— {{profesional}}", {
        ...VARS,
        profesional: "M$`S$'",
      }),
    ).toBe("— M$`S$'");
  });

  it("un monto con signo pegado al número entra tal cual", () => {
    expect(
      interpolarTemplateCobro("Total {{monto}}", { ...VARS, monto: "$1.200" }),
    ).toBe("Total $1.200");
  });
});
