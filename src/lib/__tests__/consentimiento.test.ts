import { randomBytes } from "node:crypto";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as hechos from "@/lib/consentimiento-hechos";
import {
  CONSENTIMIENTO_VERSION,
  esConsentimientoVigente,
  generarTextoConsentimiento,
  sugiereRefirmar,
} from "@/lib/consentimiento";
import { __resetLlaveroForTests } from "@/lib/llavero";

const baseParams = {
  nombrePaciente: "María González",
  nombreProfesional: "Lic. Ana Pérez",
  direccionConsultorio: "Av. 18 de Julio 1234, Montevideo",
};

describe("generarTextoConsentimiento", () => {
  it("la versión vigente del texto es la 2.1 y sugiere re-firmar las anteriores", () => {
    expect(CONSENTIMIENTO_VERSION).toBe("2.1");
    expect(sugiereRefirmar("1.1")).toBe(true);
    // La 2.0 no decía que el resumen del proceso se puede imprimir.
    expect(sugiereRefirmar("2.0")).toBe(true);
    expect(sugiereRefirmar("2.1")).toBe(false);
  });

  it("interpola los tres datos y lleva la versión", () => {
    const texto = generarTextoConsentimiento(baseParams);
    expect(texto).toContain("Versión 2.1");
    expect(texto).toContain("Hola María González.");
    expect(texto).toContain("con Lic. Ana Pérez, en el consultorio ubicado en Av. 18 de Julio 1234, Montevideo");
  });
});

// Cada frase que afirma algo sobre el tratamiento sale de una constante de
// consentimiento-hechos.ts. Si una constante cambia y la frase no, o al revés,
// el texto miente: este bloque es el que lo grita.
describe("cada frase tiene el hecho que la respalda", () => {
  const texto = generarTextoConsentimiento(baseParams);

  it("solo audio", () => {
    expect([...hechos.MEDIOS_CAPTURA]).toEqual(["audio"]);
    expect(texto).toContain("No se graba video.");
  });

  it("el respaldo local va cifrado por tramos con clave por sesión", () => {
    expect(hechos.RESPALDO_LOCAL_CIFRADO).toBe(true);
    expect(hechos.CLAVE_POR_SESION).toBe(true);
    expect(texto).toContain("se cifra en el teléfono de Lic. Ana Pérez, por tramos, con una clave que se crea para esa sesión");
    expect(texto).toContain("En el teléfono no queda audio sin cifrar.");
    expect(texto).not.toContain("todavía no está cifrado");
  });

  it("nombra a los proveedores reales y dónde están", () => {
    for (const p of Object.values(hechos.PROVEEDORES)) expect(texto).toContain(p.nombre);
    expect(texto).toContain(`AssemblyAI, una empresa de ${hechos.PROVEEDORES.assemblyai.pais}`);
    expect(texto).toContain(`Anthropic, otra empresa de ${hechos.PROVEEDORES.anthropic.pais}`);
  });

  it("el vocabulario con nombres propios SÍ viaja a AssemblyAI, y lo dice", () => {
    expect(hechos.VOCABULARIO_A_ASR).toBe(true);
    expect(hechos.VOCABULARIO_INCLUYE_NOMBRES).toBe(true);
    expect(texto).toContain("términos clínicos y nombres propios, que pueden incluir el tuyo");
    expect(texto).toContain("y las palabras de la lista");
    expect(texto).not.toContain("no se les envía tu nombre");
  });

  it("el borrado en AssemblyAI se reintenta hasta la confirmación, no se da por hecho", () => {
    expect(hechos.ASR_BORRADO_CON_REINTENTO).toBe(true);
    expect(texto).toContain("repite el pedido hasta que el servicio confirma que lo hizo");
    expect(texto).not.toContain("borra de sus servidores");
  });

  it("Anthropic recibe la transcripción y el resumen del proceso, con retención cero", () => {
    expect(hechos.LLM_RECIBE_CONTEXTO).toBe(true);
    expect(hechos.ANTHROPIC_RETENCION_CERO).toBe(true);
    expect(texto).toContain("el resumen de tu proceso hasta ese día");
    expect(texto).toContain("no conserve ese contenido ni lo use para entrenar");
  });

  it("no promete lo que no puede verificar sobre las personas de los proveedores", () => {
    expect(texto).toContain("esta aplicación no puede verificarlo");
    expect(texto).not.toContain("Ninguna persona además de");
  });

  it("no menciona el acceso técnico del administrador (decisión del dueño)", () => {
    expect(texto).not.toMatch(/administra/i);
  });

  it("el audio se borra al aprobar, la clave se destruye, y el borrado se reintenta", () => {
    expect(hechos.LIMPIEZA_AUDIO_REINTENTA).toBe(true);
    expect(texto).toContain("revisa y aprueba la nota");
    expect(texto).toContain("destruye la clave que abre el audio y borra el archivo; si el borrado falla, lo reintenta");
    expect(texto).not.toContain("imposible de abrir");
  });

  it("los backups se declaran con su plazo y que pueden contener la clave cifrada", () => {
    expect(hechos.RETENCION_BACKUPS_DIAS).toBe(30);
    expect(hechos.BACKUP_INCLUYE_CLAVE_AUDIO).toBe(true);
    expect(texto).toContain("se guardan 30 días");
    expect(texto).toContain("sí pueden contener, cifrada, la clave de un audio");
  });

  it("dice qué queda guardado, cifrado: nota, transcripción, resumen, consentimiento y firma", () => {
    expect(texto).toContain("La transcripción de la sesión.");
    expect(texto).toContain("El resumen de tu proceso que ella mantiene.");
    expect(texto).toContain("Este consentimiento y tu firma.");
    expect(texto).toContain("El audio no queda.");
  });

  it("el resumen del proceso se puede imprimir, sale sin cifrar y cada vez queda registrado", () => {
    expect(hechos.RECORRIDO_EXPORTABLE).toBe(true);
    // La acción que el caso de uso escribe (hilo-integracion.test.ts lo comprueba contra la base).
    expect(hechos.ACCION_EXPORTAR_RECORRIDO).toBe("hilo.exportar_pdf");
    expect(texto).toContain("Lic. Ana Pérez puede imprimir el resumen de tu proceso, o guardarlo como archivo");
    expect(texto).toContain("para su propio archivo profesional");
    expect(texto).toContain("ya no está dentro de la aplicación ni cifrada");
    expect(texto).toContain("La aplicación registra cada vez que lo hace.");
  });

  it("revocar no borra la historia clínica, y se puede revocar cuando quiera", () => {
    expect(hechos.REVOCAR_BORRA_HISTORIA).toBe(false);
    expect(texto).toContain("Lo ya guardado sigue formando parte de tu historia clínica.");
    expect(texto).toContain("Sé que puedo revocar esta autorización cuando quiera");
  });

  it("marco legal y transferencia internacional", () => {
    expect(texto).toContain(hechos.MARCO_LEGAL.ley);
    expect(texto).toContain("transferencia internacional");
  });
});

describe("esConsentimientoVigente", () => {
  it("firmado y no revocado → vigente; revocado o null → no", () => {
    expect(esConsentimientoVigente({ firmadoEn: new Date("2026-01-01"), revocadoEn: null })).toBe(true);
    expect(esConsentimientoVigente({ firmadoEn: new Date("2026-01-01"), revocadoEn: new Date("2026-02-01") })).toBe(false);
    expect(esConsentimientoVigente(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// La ruta: cifra texto y firma atados al id, no guarda IP, y audita sin
// texto, sin firma y sin IP. Base y sesión dobladas.
// ---------------------------------------------------------------------------

const sesionActual = vi.hoisted(() => ({ organizationId: "org-1", userId: "user-1" }));
const baseDeDatos = vi.hoisted(() => ({
  eventos: [] as Array<Record<string, unknown>>,
  creados: [] as Array<Record<string, unknown>>,
  vigentes: 0,
  paciente: { id: "pac-1", nombre: "María", apellido: "González" } as { id: string; nombre: string; apellido: string } | null,
  /** Lo que el GET encuentra firmado (findFirst), y con qué `where` preguntó. */
  firmado: null as null | { id: string; pacienteId: string; firmadoEn: Date; textoVersion: string; revocadoEn: Date | null },
  ultimoWhere: null as null | Record<string, unknown>,
}));

vi.mock("@/app/api/_lib/auth", () => ({
  getOrganizationId: async () => sesionActual.organizationId,
  getSessionActor: async () => ({ ...sesionActual, sesionId: "s", rol: "titular", nombre: "Ana", email: "a@example.test" }),
}));

vi.mock("@/lib/db", () => {
  const revocarVigentes = async () => {
    const count = baseDeDatos.vigentes;
    baseDeDatos.vigentes = 0;
    return { count };
  };
  const db = {
    paciente: { findFirst: async () => baseDeDatos.paciente },
    configuracion: { findUnique: async () => ({ nombreProfesional: "Lic. Ana Pérez", direccion: "Av. 18 de Julio 1234, Montevideo" }) },
    consentimientoGrabacion: {
      updateMany: revocarVigentes,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        baseDeDatos.ultimoWhere = where;
        return baseDeDatos.firmado;
      },
    },
    eventoAuditoria: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        baseDeDatos.eventos.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        consentimientoGrabacion: {
          updateMany: revocarVigentes,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            baseDeDatos.creados.push(data);
            return { id: data.id, pacienteId: "pac-1", firmadoEn: new Date("2026-03-01T12:00:00Z"), textoVersion: CONSENTIMIENTO_VERSION, revocadoEn: null };
          },
        },
      }),
  };
  return { db };
});

const { GET, POST, DELETE } = await import("@/app/api/pacientes/[id]/consentimiento/route");
const params = { params: Promise.resolve({ id: "pac-1" }) };

function pedidoFirma(): Request {
  return new Request("http://localhost/api/pacientes/pac-1/consentimiento", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "200.40.1.7, 10.0.0.1" },
    body: JSON.stringify({ firmaDigital: "data:image/png;base64,FIRMA", textoVersion: CONSENTIMIENTO_VERSION }),
  });
}

describe("la ruta de consentimiento", () => {
  beforeAll(() => {
    process.env.CLAVES_CIFRADO = `1=${randomBytes(32).toString("base64")}`;
    __resetLlaveroForTests();
  });
  beforeEach(() => {
    baseDeDatos.eventos = [];
    baseDeDatos.creados = [];
    baseDeDatos.vigentes = 0;
    baseDeDatos.paciente = { id: "pac-1", nombre: "María", apellido: "González" };
    baseDeDatos.firmado = null;
    baseDeDatos.ultimoWhere = null;
  });

  it("una firma de la versión 1.1 sigue vigente: el GET la devuelve vigente y solo sugiere re-firmar", async () => {
    baseDeDatos.firmado = { id: "c-11", pacienteId: "pac-1", firmadoEn: new Date("2026-01-10T12:00:00Z"), textoVersion: "1.1", revocadoEn: null };
    const res = await GET(new Request("http://localhost/x"), params);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.consentimiento).toMatchObject({ textoVersion: "1.1", vigente: true, sugiereRefirmar: true });
    // La vigencia se decide por revocación, nunca por versión del texto.
    expect(baseDeDatos.ultimoWhere).toEqual({ pacienteId: "pac-1", organizationId: "org-1", revocadoEn: null });
    expect(baseDeDatos.ultimoWhere).not.toHaveProperty("textoVersion");
  });

  it("guarda texto y firma cifrados (ENC2) atados al id de la fila, y ninguna IP", async () => {
    const respuesta = await POST(pedidoFirma(), params);
    expect(respuesta.status).toBe(201);
    const [fila] = baseDeDatos.creados;
    expect(typeof fila.id).toBe("string");
    expect(Buffer.isBuffer(fila.textoCompletoEncrypted)).toBe(true);
    expect((fila.textoCompletoEncrypted as Buffer).subarray(0, 4).toString("ascii")).toBe("ENC2");
    expect(Buffer.isBuffer(fila.firmaDigitalEncrypted)).toBe(true);
    expect(fila).not.toHaveProperty("textoCompleto");
    expect(fila).not.toHaveProperty("firmaDigital");
    expect(fila).not.toHaveProperty("ipOrigen");
    const { descifrar, aadDe } = await import("@/lib/encryption");
    const texto = descifrar(fila.textoCompletoEncrypted as Buffer, aadDe("consentimientos_grabacion", "texto_completo_encrypted", fila.id as string));
    expect(texto).toContain("Hola María González.");
    expect(texto).toContain("Versión 2.1");
    const cuerpo = await respuesta.json();
    expect(cuerpo.data.consentimiento).toMatchObject({ vigente: true, sugiereRefirmar: false });
  });

  it("firmar registra consentimiento.firmar sin IP, sin texto y sin firma", async () => {
    await POST(pedidoFirma(), params);
    expect(baseDeDatos.eventos).toHaveLength(1);
    const [evento] = baseDeDatos.eventos;
    expect(evento).toMatchObject({ organizationId: "org-1", actorTipo: "usuario", actorId: "user-1", accion: "consentimiento.firmar", entidad: "paciente", entidadId: "pac-1" });
    expect(evento.detalle).toEqual({ consentimientoId: baseDeDatos.creados[0].id, textoVersion: CONSENTIMIENTO_VERSION, reemplazados: 0 });
    const detalle = JSON.stringify(evento.detalle);
    expect(detalle).not.toContain("200.40.1.7");
    expect(detalle).not.toContain("María");
    expect(detalle).not.toContain("FIRMA");
  });

  it("firmar sobre una autorización vigente deja constancia del reemplazo", async () => {
    baseDeDatos.vigentes = 1;
    await POST(pedidoFirma(), params);
    expect(baseDeDatos.eventos[0]?.detalle).toMatchObject({ reemplazados: 1 });
  });

  it("revocar registra consentimiento.revocar sin IP; sin nada vigente es 404 y no hay evento", async () => {
    baseDeDatos.vigentes = 1;
    const ok = await DELETE(new Request("http://localhost/x", { method: "DELETE", headers: { "x-forwarded-for": "200.40.1.7" } }), params);
    expect(ok.status).toBe(200);
    expect(baseDeDatos.eventos[0]).toMatchObject({ accion: "consentimiento.revocar", entidadId: "pac-1" });
    expect(baseDeDatos.eventos[0].detalle).toEqual({ revocados: 1 });

    baseDeDatos.eventos = [];
    const nada = await DELETE(new Request("http://localhost/x", { method: "DELETE" }), params);
    expect(nada.status).toBe(404);
    expect(baseDeDatos.eventos).toHaveLength(0);
  });
});
