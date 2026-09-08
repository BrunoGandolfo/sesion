import { beforeEach, describe, it, expect, vi } from "vitest";

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
  it("la versión vigente del texto es la 1.1", () => {
    expect(CONSENTIMIENTO_VERSION).toBe("1.1");
  });

  // Texto legal completo: cualquier cambio de redacción tiene que ser
  // deliberado (y, en general, subir CONSENTIMIENTO_VERSION).
  it("genera el texto legal completo con los datos interpolados", () => {
    expect(generarTextoConsentimiento(baseParams)).toMatchInlineSnapshot(`
      "Consentimiento informado para grabación de sesiones
      Versión 1.1

      Hola María González.

      Antes de empezar queremos contarte cómo funciona la grabación de las sesiones y pedirte que la autorices por escrito. Tomate el tiempo de leerlo: se trata de tus datos y de tu intimidad.

      ¿Qué se graba?
      Se graba el audio de tu sesión de psicoterapia con Lic. Ana Pérez, en el consultorio ubicado en Av. 18 de Julio 1234, Montevideo. No se graba video.

      ¿Para qué se graba?
      El audio se usa para escribir, con ayuda de inteligencia artificial, la nota clínica de la sesión: el registro escrito que Lic. Ana Pérez guarda en tu historia clínica. Le permite estar más presente durante la sesión y dedicarle menos tiempo a escribir después.

      ¿Quién escucha el audio?
      Ninguna persona además de Lic. Ana Pérez. Nadie más de su consultorio, ni de ninguna empresa, escucha tus sesiones.

      El audio sí pasa, de forma automática y sin que ninguna persona lo oiga, por dos servicios de empresas que están en Estados Unidos. Es importante que lo sepas antes de firmar:

      1. AssemblyAI convierte el audio en texto. Cuando termina, borra de sus servidores tanto ese texto como la copia del audio.
      2. Anthropic toma ese texto y redacta la nota clínica. Trabaja bajo un acuerdo que no le permite conservar el contenido ni usarlo para entrenar sus sistemas.

      A esos servicios no se les envía tu nombre, tu teléfono ni tu documento: reciben el audio y el texto de la sesión, nada más. Tené en cuenta que, si durante la sesión se dicen nombres en voz alta, esos nombres viajan dentro del audio.

      ¿Cómo viaja y dónde se guarda el audio?
      El audio se cifra en el mismo teléfono de Lic. Ana Pérez apenas termina la grabación, antes de salir del dispositivo. Queda guardado, siempre cifrado, en un servicio de almacenamiento, hasta que se escribe la nota. La clave para abrirlo la tiene solamente esta aplicación.

      ¿Cuánto tiempo se guarda el audio?
      Hasta que Lic. Ana Pérez revisa y aprueba la nota clínica, en general el mismo día de la sesión. En ese momento el audio se borra y además se destruye su clave, así que cualquier copia que llegara a quedar en algún lado sería imposible de abrir.

      ¿Qué queda guardado entonces?
      Quedan dos cosas, las dos cifradas en la base de datos de la aplicación y accesibles solamente para Lic. Ana Pérez:

      - La nota clínica, que forma parte de tu historia clínica igual que las notas que ella escribiría a mano.
      - La transcripción de la sesión, que es el texto de lo que se habló.

      El audio no queda.

      ¿Podés cambiar de opinión?
      Sí, en cualquier momento y sin dar explicaciones. Alcanza con avisarle a Lic. Ana Pérez. A partir de ese momento las sesiones siguientes no se graban. Esto no afecta en nada la continuidad de tu tratamiento ni tu relación con ella.

      ¿Es obligatorio aceptar?
      No. La grabación es totalmente opcional. Si preferís que no se grabe, la sesión sigue de manera normal y Lic. Ana Pérez toma notas como siempre. No hay ninguna consecuencia por decir que no.

      Marco legal
      Esta autorización se enmarca en la Ley 18.331 de Protección de Datos Personales de la República Oriental del Uruguay, que exige que el tratamiento de datos sensibles —como los datos de salud— se haga con tu consentimiento previo, libre, expreso e informado. Como parte de tus sesiones se procesa fuera del país, esta autorización incluye esa transferencia internacional de datos. Tenés derecho a acceder a tus datos, a pedir que se corrijan y a pedir que se eliminen.

      Al firmar, declaro que:
      - Leí y entendí esta información
      - Autorizo la grabación de mis sesiones con Lic. Ana Pérez
      - Entiendo que el audio y su transcripción se procesan en los servicios del exterior mencionados más arriba
      - Sé que puedo revocar esta autorización cuando quiera
      "
    `);
  });
});

// Estas afirmaciones son el motivo por el que existe la versión 1.1. Si
// alguna se rompe, el texto volvió a describir un pipeline que no es el que
// corre, y deja de ser consentimiento informado bajo la Ley 18.331.
describe("el texto describe el pipeline real", () => {
  const texto = generarTextoConsentimiento(baseParams);

  it("nombra a los dos proveedores externos y dice dónde están", () => {
    expect(texto).toContain("AssemblyAI");
    expect(texto).toContain("Anthropic");
    expect(texto).toContain("Estados Unidos");
  });

  it("dice que AssemblyAI borra el audio y el texto al terminar", () => {
    expect(texto).toContain(
      "borra de sus servidores tanto ese texto como la copia del audio",
    );
  });

  it("dice que Anthropic no conserva el contenido", () => {
    expect(texto).toContain("no le permite conservar el contenido");
  });

  it("dice que el audio se cifra en el teléfono antes de salir", () => {
    expect(texto).toContain("se cifra en el mismo teléfono");
    expect(texto).toContain("antes de salir del dispositivo");
  });

  it("dice que el audio se borra al aprobar la nota, con su clave", () => {
    expect(texto).toContain("revisa y aprueba la nota clínica");
    expect(texto).toContain("se destruye su clave");
  });

  it("avisa que la transcripción también queda guardada, cifrada", () => {
    expect(texto).toContain("La transcripción de la sesión");
    expect(texto).toContain("cifradas en la base de datos");
  });

  it("cubre la transferencia internacional y la Ley 18.331", () => {
    expect(texto).toContain("Ley 18.331");
    expect(texto).toContain("transferencia internacional de datos");
  });

  it("conserva el derecho a revocar", () => {
    expect(texto).toContain("Sé que puedo revocar esta autorización cuando quiera");
  });

  it("ya no afirma lo que la versión 1.0 afirmaba de más", () => {
    // Las dos frases falsas de la 1.0.
    expect(texto).not.toContain("servidor privado");
    expect(texto).not.toContain(
      "ni queda guardado en servidores de empresas externas",
    );
    expect(texto).not.toContain("Solo queda la nota clínica escrita");
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

// ---------------------------------------------------------------------------
// Auditoría de la ruta: POST /api/pacientes/[id]/consentimiento y su DELETE.
//
// Firmar y revocar la autorización de grabación es el acto legal más sensible
// de la app —es lo que habilita grabar a una persona— y hasta ahora no dejaba
// rastro en eventos_auditoria. Estos casos son el guardián de que lo deje.
//
// Son unitarios: la base y la sesión están mockeadas. No prueban que Prisma
// escriba (eso ya lo cubren los tests de integración de la tabla), prueban que
// la ruta LLAME al registro y con qué.
// ---------------------------------------------------------------------------

const sesionActual = vi.hoisted(() => ({
  organizationId: "org-1",
  userId: "user-1",
}));

const baseDeDatos = vi.hoisted(() => ({
  /** Eventos que la ruta mandó a eventos_auditoria, en orden. */
  eventos: [] as Array<Record<string, unknown>>,
  /** Cuántos consentimientos vigentes encuentra el updateMany de turno. */
  vigentes: 0,
  /** null para que el paciente "no exista". */
  paciente: { id: "pac-1", nombre: "María", apellido: "González" } as {
    id: string;
    nombre: string;
    apellido: string;
  } | null,
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentOrganizationId: async () => sesionActual.organizationId,
  getServerSession: async () => ({
    organizationId: sesionActual.organizationId,
    userId: sesionActual.userId,
  }),
}));

vi.mock("@/lib/db", () => {
  const revocarVigentes = async () => {
    const count = baseDeDatos.vigentes;
    baseDeDatos.vigentes = 0;
    return { count };
  };

  const db = {
    paciente: { findFirst: async () => baseDeDatos.paciente },
    configuracion: {
      findUnique: async () => ({
        nombreProfesional: "Lic. Ana Pérez",
        direccion: "Av. 18 de Julio 1234, Montevideo",
      }),
    },
    consentimientoGrabacion: { updateMany: revocarVigentes },
    eventoAuditoria: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        baseDeDatos.eventos.push(data);
        return data;
      },
    },
    $transaction: async (
      fn: (tx: {
        consentimientoGrabacion: {
          updateMany: typeof revocarVigentes;
          create: (args: unknown) => Promise<unknown>;
        };
      }) => Promise<unknown>,
    ) =>
      fn({
        consentimientoGrabacion: {
          updateMany: revocarVigentes,
          create: async () => ({
            id: "cons-1",
            pacienteId: "pac-1",
            firmadoEn: new Date("2026-03-01T12:00:00Z"),
            textoVersion: CONSENTIMIENTO_VERSION,
            revocadoEn: null,
          }),
        },
      }),
  };

  return { db };
});

const { POST, DELETE } = await import(
  "@/app/api/pacientes/[id]/consentimiento/route"
);

const params = { params: Promise.resolve({ id: "pac-1" }) };

function pedidoFirma(): Request {
  return new Request("http://localhost/api/pacientes/pac-1/consentimiento", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "200.40.1.7, 10.0.0.1",
    },
    body: JSON.stringify({
      firmaDigital: "María González",
      textoVersion: CONSENTIMIENTO_VERSION,
    }),
  });
}

function pedidoRevocacion(): Request {
  return new Request("http://localhost/api/pacientes/pac-1/consentimiento", {
    method: "DELETE",
    headers: { "x-forwarded-for": "200.40.1.7" },
  });
}

describe("auditoría de la autorización de grabación", () => {
  beforeEach(() => {
    baseDeDatos.eventos = [];
    baseDeDatos.vigentes = 0;
    baseDeDatos.paciente = {
      id: "pac-1",
      nombre: "María",
      apellido: "González",
    };
  });

  it("firmar registra consentimiento.firmar contra la paciente", async () => {
    const respuesta = await POST(pedidoFirma(), params);
    expect(respuesta.status).toBe(201);

    expect(baseDeDatos.eventos).toHaveLength(1);
    const [evento] = baseDeDatos.eventos;
    expect(evento).toMatchObject({
      organizationId: "org-1",
      actorTipo: "usuario",
      actorId: "user-1",
      accion: "consentimiento.firmar",
      entidad: "paciente",
      entidadId: "pac-1",
    });
    expect(evento.detalle).toEqual({
      consentimientoId: "cons-1",
      textoVersion: CONSENTIMIENTO_VERSION,
      reemplazados: 0,
      ip: "200.40.1.7",
    });
  });

  it("firmar sobre una autorización vigente deja constancia del reemplazo", async () => {
    baseDeDatos.vigentes = 1;

    await POST(pedidoFirma(), params);

    expect(baseDeDatos.eventos[0]?.detalle).toMatchObject({ reemplazados: 1 });
  });

  it("revocar registra consentimiento.revocar contra la paciente", async () => {
    baseDeDatos.vigentes = 1;

    const respuesta = await DELETE(pedidoRevocacion(), params);
    expect(respuesta.status).toBe(200);

    expect(baseDeDatos.eventos).toHaveLength(1);
    const [evento] = baseDeDatos.eventos;
    expect(evento).toMatchObject({
      organizationId: "org-1",
      actorTipo: "usuario",
      actorId: "user-1",
      accion: "consentimiento.revocar",
      entidad: "paciente",
      entidadId: "pac-1",
    });
    expect(evento.detalle).toEqual({ revocados: 1, ip: "200.40.1.7" });
  });

  // El registro es de hechos, no de intentos: si no había nada vigente que
  // revocar la ruta contesta 404 y no puede quedar un evento diciendo que se
  // revocó algo.
  it("un DELETE que no revoca nada no genera evento", async () => {
    const respuesta = await DELETE(pedidoRevocacion(), params);

    expect(respuesta.status).toBe(404);
    expect(baseDeDatos.eventos).toHaveLength(0);
  });

  // Ni el texto legal completo ni la firma digital —el documento en sí— pueden
  // filtrarse al registro, que no está pensado para guardar datos personales.
  it("el evento de firma no contiene el texto ni la firma", async () => {
    await POST(pedidoFirma(), params);

    const detalle = JSON.stringify(baseDeDatos.eventos[0]?.detalle);
    expect(detalle).not.toContain("María");
    expect(detalle).not.toContain("Consentimiento informado");
  });
});
