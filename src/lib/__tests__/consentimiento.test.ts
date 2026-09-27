import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as hechos from "@/lib/consentimiento-hechos";
import {
  CONSENTIMIENTO_FECHA,
  CONSENTIMIENTO_VERSION,
  esConsentimientoVigente,
  generarTextoConsentimiento,
  sugiereRefirmar,
} from "@/lib/consentimiento";
import { __resetLlaveroForTests } from "@/lib/llavero";
import { POLITICA_POR_TIPO, backoffTrabajoMs } from "@/app/api/_lib/casos-uso/trabajos/politica";
import { decidirResolucion } from "@/app/api/_lib/casos-uso/trabajos/resolver";

/** El código que hace verdadera una frase, leído del disco. */
const codigo = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

const baseParams = {
  nombrePaciente: "María González",
  nombreProfesional: "Lic. Ana Pérez",
  direccionConsultorio: "Av. 18 de Julio 1234, Montevideo",
};

describe("generarTextoConsentimiento", () => {
  it("la versión vigente del texto es la 2.7 y sugiere re-firmar las anteriores", () => {
    expect(CONSENTIMIENTO_VERSION).toBe("2.7");
    for (const vieja of ["1.1", "2.0", "2.1", "2.2", "2.3", "2.4", "2.5"]) expect(sugiereRefirmar(vieja)).toBe(true);
    // La 2.6 prometía cifrado del audio en el teléfono, clave por sesión y su
    // destrucción al aprobar, y decía que la transcripción no se podía ver.
    expect(sugiereRefirmar("2.6")).toBe(true);
    expect(sugiereRefirmar("2.7")).toBe(false);
  });

  it("interpola los tres datos y cierra con versión y fecha", () => {
    const texto = generarTextoConsentimiento(baseParams);
    expect(texto).toContain("Hola María González.");
    expect(texto).toContain("Lic. Ana Pérez te pide autorización para grabar tus sesiones en Av. 18 de Julio 1234, Montevideo.");
    expect(texto.trimEnd().endsWith(`Versión 2.7, ${CONSENTIMIENTO_FECHA}.`)).toBe(true);
  });

  it("entra en una pantalla y media de teléfono: 3.500 caracteres como máximo", () => {
    // Tope del dueño. Si una frase nueva lo pasa, se acorta otra: no se sube el tope.
    expect(generarTextoConsentimiento(baseParams).length).toBeLessThanOrEqual(3500);
  });

  it("sigue el orden pedido, un párrafo por tema", () => {
    const texto = generarTextoConsentimiento(baseParams);
    const titulos = ["Qué se graba", "A dónde va y quién lo procesa", "Qué queda guardado", "Copias de seguridad",
      "Quién puede ver", "Lupita", "Qué podés pedir", "Si cambiás de opinión", "Al firmar"];
    const posiciones = titulos.map((titulo) => texto.indexOf(`\n${titulo}`));
    expect(posiciones.every((pos) => pos > 0)).toBe(true);
    expect([...posiciones].sort((x, y) => x - y)).toEqual(posiciones);
  });
});

// Cada frase que afirma algo sobre el tratamiento sale de una constante de
// consentimiento-hechos.ts, y cada constante se compara con el código que la
// hace verdadera. Si una cambia y la otra no, el texto miente: este bloque es
// el que lo grita.
describe("cada frase tiene el hecho que la respalda", () => {
  const texto = generarTextoConsentimiento(baseParams);

  it("solo audio, y solo si acepta", () => {
    expect([...hechos.MEDIOS_CAPTURA]).toEqual(["audio"]);
    expect(texto).toContain("Solo el audio, nunca video, y solo si aceptás. Si no, la sesión sigue igual y Lic. Ana Pérez toma notas como siempre.");
  });

  it("la app no cifra el audio: queda en el teléfono, sube por conexión cifrada y el almacén lo cifra en reposo", () => {
    expect(hechos.RESPALDO_LOCAL_CIFRADO).toBe(false);
    expect(hechos.CLAVE_POR_SESION).toBe(false);
    expect(hechos.AUDIO_SE_SUBE_AL_TERMINAR).toBe(true);
    expect(hechos.AUDIO_VIAJA_POR_CONEXION_CIFRADA).toBe(true);
    expect(hechos.ALMACEN_CIFRA_EN_REPOSO).toBe(true);
    // Cada trozo se guarda como Blob, tal cual: nada lo cifra antes del put.
    const storage = codigo("src/lib/grabacion-storage.ts");
    const desde = storage.indexOf("export async function guardarChunk(");
    const guardar = storage.slice(desde, storage.indexOf("\n}\n", desde));
    expect(guardar).toContain("blob: chunk");
    expect(guardar).not.toMatch(/cifr|encrypt|subtle/i);
    // Sin clave por sesión: la URL de subida no genera ninguna.
    expect(codigo("src/app/api/_lib/casos-uso/audio.ts")).not.toMatch(/audioClave|randomBytes/);
    // Un solo archivo al terminar, por PUT a la URL prefirmada de R2 sobre HTTPS.
    const subida = codigo("src/hooks/useGrabacionSesion.ts");
    expect(subida.indexOf("/upload-url")).toBeLessThan(subida.indexOf("/upload-confirmar"));
    expect(subida).toContain('xhr.open("PUT", url, true)');
    expect(codigo("src/lib/r2.ts")).toContain("endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`");
    expect(texto).toContain("El audio queda en el teléfono de Lic. Ana Pérez hasta que termina la sesión y se sube por una conexión cifrada a Cloudflare R2, un almacenamiento que lo guarda cifrado");
    expect(texto).not.toMatch(/se cifra en el teléfono|clave|descifr|no queda audio sin cifrar/i);
  });

  it("la copia del teléfono se borra al confirmar la subida", () => {
    expect(hechos.COPIA_LOCAL_SE_CONSERVA_TRAS_SUBIR).toBe(false);
    const vista = codigo("src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx");
    expect(vista.indexOf("await subirAudio(")).toBeGreaterThan(-1);
    expect(vista.indexOf("await subirAudio(")).toBeLessThan(vista.indexOf("void limpiarGrabacion(turno)"));
    const storage = codigo("src/lib/grabacion-storage.ts");
    const limpiar = storage.slice(storage.indexOf("export async function limpiarGrabacion("));
    expect(limpiar).toContain("tx.objectStore(STORE_CHUNKS).delete(rangoChunks(sesionClinicaId));");
    expect(texto).toContain(", y se borra del teléfono.");
  });

  it("el servidor tiene el audio solo en memoria", () => {
    expect(hechos.AUDIO_EN_ARCHIVO_DEL_SERVIDOR).toBe(false);
    const worker = codigo("processor/processor.py");
    expect(worker).toContain("asr_assemblyai.transcribir(io.BytesIO(audio_bytes), terminos)");
    expect(worker).not.toMatch(/TemporaryDirectory|NamedTemporaryFile|open\(.*"wb"/);
    const normalizar = codigo("processor/audio_asr.py");
    expect(normalizar).toContain('"pipe:0"');
    expect(normalizar).not.toMatch(/tempfile|NamedTemporaryFile|open\(.*"wb"/);
    expect(texto).toContain("Un programa de esta aplicación en Railway lo manda, sin guardarlo en otro archivo, a AssemblyAI, que lo pasa a texto");
  });

  it("nombra a los proveedores reales, su país y la transferencia internacional", () => {
    for (const p of Object.values(hechos.PROVEEDORES)) expect(texto).toContain(p.nombre);
    expect(hechos.PROVEEDORES.assemblyai.pais).toBe("Estados Unidos");
    expect(hechos.PROVEEDORES.anthropic.pais).toBe("Estados Unidos");
    expect(hechos.MARCO_LEGAL.transferenciaInternacional).toBe(true);
    expect(texto).toContain("AssemblyAI y Anthropic están en Estados Unidos: al firmar autorizás esa transferencia internacional (Ley 18.331).");
  });

  it("el vocabulario, que puede tener su nombre, viaja solo a AssemblyAI", () => {
    expect(hechos.VOCABULARIO_A_ASR).toBe(true);
    expect(hechos.VOCABULARIO_INCLUYE_NOMBRES).toBe(true);
    expect(hechos.VOCABULARIO_SOLO_A_ASR).toBe(true);
    expect(codigo("processor/asr_assemblyai.py")).toContain('payload["keyterms_prompt"] = terminos');
    expect(codigo("processor/clinical_analyzer.py")).not.toMatch(/keyterms|terminos_asr/);
    expect(texto).toContain("con ayuda de una lista de palabras que Lic. Ana Pérez carga y que puede incluir tu nombre");
  });

  it("qué recibe Anthropic y para qué: borrador, análisis para la profesional y propuesta del resumen", () => {
    expect(hechos.LLM_RECIBE_CONTEXTO).toBe(true);
    expect(hechos.LLM_RECIBE_NOTA_APROBADA).toBe(true);
    expect(hechos.RESUMEN_PROPUESTO_POR_IA).toBe(true);
    expect(hechos.ANALISIS_DE_LA_PROFESIONAL_POR_IA).toBe(true);
    const adjunto = codigo("src/app/api/_lib/casos-uso/hilo/trabajo.ts");
    expect(adjunto).toContain("notaFinal: sesion.notaFinal");
    expect(adjunto).toContain("contextoVigente:");
    expect(codigo("processor/processor.py")).toContain("clinical_analyzer.generar_feedback_terapeuta(");
    expect(texto).toContain("Anthropic recibe ese texto y el resumen de tu proceso: redacta un borrador de la nota, prepara un análisis del trabajo de Lic. Ana Pérez que solo ella ve y propone cómo actualizar el resumen cuando ella aprueba la nota.");
  });

  it("Anthropic, con retención cero", () => {
    expect(hechos.ANTHROPIC_RETENCION_CERO).toBe(true);
    expect(texto).toContain("Anthropic está configurada para no conservar el contenido ni usarlo para entrenar.");
  });

  it("qué queda guardado, cifrado en la base, y que el borrador se guarda antes de aprobar", () => {
    expect(hechos.BORRADOR_IA_GUARDADO_ANTES_DE_APROBAR).toBe(true);
    expect(codigo("src/app/api/_lib/casos-uso/sesion/resultado.ts")).toContain("notaIa: resultado.nota");
    const cifrado = codigo("src/lib/prisma-encryption.ts");
    for (const columna of ["transcripcion_encrypted", "nota_final_encrypted", "nota_ia_encrypted", "contenido_encrypted", "texto_completo_encrypted", "firma_digital_encrypted"]) {
      expect(cifrado).toContain(`"${columna}"`);
    }
    expect(texto).toContain("La transcripción, la nota y el resumen de tu proceso se guardan cifrados en la base de datos (Neon), con esta autorización y tu firma.");
    expect(texto).toContain("Ella revisa, corrige y aprueba el borrador de la IA, que también queda guardado; el resumen solo cambia si acepta la propuesta.");
  });

  it("al aprobar se programa el borrado del audio, con reintentos acotados; no hay clave que destruir", () => {
    expect(hechos.CLAVE_AUDIO_DESTRUIDA_AL_APROBAR).toBe(false);
    expect(hechos.LIMPIEZA_AUDIO_REINTENTA).toBe(true);
    const aprobar = codigo("src/app/api/_lib/casos-uso/sesion/aprobar.ts");
    expect(aprobar).toContain('tipo: "borrar_audio_r2"');
    expect(aprobar).not.toContain("audioClave");
    const tipo = "borrar_audio_r2";
    const { tope } = POLITICA_POR_TIPO[tipo];
    expect(tope).toBe(hechos.LIMPIEZA_AUDIO_MAX_INTENTOS);
    const esperas = Array.from({ length: tope - 1 }, (_, i) => backoffTrabajoMs(tipo, i + 1));
    expect(Math.ceil(esperas.reduce((suma, ms) => suma + ms, 0) / 86_400_000)).toBe(hechos.LIMPIEZA_AUDIO_DIAS_APROX);
    expect(decidirResolucion({ tipo, intentos: tope }, { ok: false, error: "R2 no responde" }, new Date("2026-09-16T12:00:00Z"))).toEqual({ estado: "fallido" });
    expect(texto).toContain(`Al aprobar la nota, la aplicación manda borrar el audio y reintenta unos ${hechos.LIMPIEZA_AUDIO_DIAS_APROX} días; si no lo logra, el borrado queda marcado como fallido.`);
    expect(texto).not.toMatch(/imposible de abrir|nadie puede abrir|hasta lograrlo/);
  });

  it("el borrado en AssemblyAI: un pedido inmediato y reintentos acotados sólo si se completó", () => {
    expect(hechos.ASR_BORRADO_INMEDIATO).toBe(true);
    expect(hechos.ASR_BORRADO_CON_REINTENTO).toBe(true);
    expect(hechos.ASR_REINTENTO_SOLO_SI_SE_COMPLETO).toBe(true);
    const cliente = codigo("processor/asr_assemblyai.py");
    const transcribir = cliente.slice(cliente.indexOf("def transcribir("));
    expect(transcribir).toMatch(/try:\s+data = _esperar\(transcript_id\)[\s\S]*finally:\s+_borrar\(transcript_id\)/);
    expect(cliente).toContain("DELETE best-effort: solo se loguea el status, nunca falla.");
    const worker = codigo("processor/processor.py");
    expect(worker.indexOf("transcripcion = transcribir(")).toBeLessThan(worker.indexOf("transcripto = registrar_checkpoint("));
    expect(worker).toContain("app_client.registrar_asr(etiqueta, sesion.ticket, sesion.intento, asr_id)");
    expect(worker).toContain("if response.status_code in (200, 404):");
    expect(codigo("src/app/api/_lib/casos-uso/sesion/registrar-asr.ts")).toContain('tipo: "borrar_transcript_asr"');
    const tipo = "borrar_transcript_asr";
    const { tope } = POLITICA_POR_TIPO[tipo];
    expect(tope).toBe(hechos.ASR_BORRADO_MAX_INTENTOS);
    const esperas = Array.from({ length: tope - 1 }, (_, i) => backoffTrabajoMs(tipo, i + 1));
    expect(Math.ceil(esperas.reduce((suma, ms) => suma + ms, 0) / 86_400_000)).toBe(hechos.ASR_BORRADO_DIAS_APROX);
    expect(texto).toContain(`Al terminar la transcripción le pide a AssemblyAI que borre el audio y el texto y, si se completó, repite el pedido unos ${hechos.ASR_BORRADO_DIAS_APROX} días; si algo falla, puede pedirlo una vez o ninguna, y no puede comprobar que se haya borrado.`);
    expect(texto).not.toContain("borra de sus servidores");
  });

  it("las copias de seguridad: plazos reales y sin audio ni clave", () => {
    expect(hechos.RETENCION_BACKUPS_DIAS).toBe(30);
    expect(hechos.RETENCION_BACKUPS_MENSUALES_MESES).toBe(12);
    expect(hechos.BACKUP_INCLUYE_AUDIO).toBe(false);
    expect(hechos.BACKUP_INCLUYE_CLAVE_AUDIO).toBe(false);
    // El respaldo es un pg_dump de la base: el audio vive en R2.
    expect(codigo(".github/workflows/backup.yml")).toContain('"${PG_BIN}/pg_dump"');
    expect(texto).toContain("Las diarias se guardan 30 días y las mensuales hasta 12 meses. Tienen lo mismo que la base, cifrado, sin el audio.");
  });

  it("quién puede ver, y que cada lectura de la nota o la transcripción queda registrada", () => {
    expect(hechos.ACCION_VER_SESION).toBe("sesion.ver");
    expect(hechos.ACCION_VER_TRANSCRIPCION).toBe("sesion.ver_transcripcion");
    expect(codigo("src/app/api/sesion-clinica/[id]/route.ts")).toContain('accion: "sesion.ver"');
    expect(codigo("src/app/api/_lib/casos-uso/sesion/ver-transcripcion.ts")).toContain('accion: "sesion.ver_transcripcion"');
    expect(texto).toContain("Solo Lic. Ana Pérez, desde su cuenta, y cada vez que abre tu nota o tu transcripción queda registrado.");
    expect(texto).toContain("dicen que nadie accede al contenido, pero la aplicación no puede verificarlo.");
    expect(texto).not.toContain("Ninguna persona además de");
  });

  it("no menciona el acceso técnico del administrador (decisión del dueño)", () => {
    expect(texto).not.toMatch(/administra/i);
  });

  it("el resumen del proceso se puede imprimir, sale sin cifrar y su preparación queda registrada", () => {
    expect(hechos.RECORRIDO_EXPORTABLE).toBe(true);
    expect(hechos.ACCION_EXPORTAR_RECORRIDO).toBe("hilo.exportar_pdf");
    expect(texto).toContain("Si ella imprime o guarda como PDF el resumen de tu proceso, esa copia queda fuera de la aplicación, sin cifrar y bajo su cuidado, y queda registrado.");
  });

  it("Lupita: solo la agenda mínima, sin escribir, y su conversación pasa por Anthropic", () => {
    expect(hechos.LUPITA_CONSULTA_AGENDA).toBe(true);
    expect([...hechos.LUPITA_CAMPOS_AGENDA]).toEqual(["nombre", "dia", "hora", "duracion", "modalidad"]);
    expect(hechos.LUPITA_SOLO_LECTURA).toBe(true);
    expect(hechos.LUPITA_HISTORIAL_A_ANTHROPIC).toBe(true);
    expect(codigo("src/app/api/_lib/casos-uso/ayuda/agenda.ts")).toContain("paciente: { select: { nombre: true } }");
    expect(texto).toContain("puede ver tu nombre y el día, la hora, la duración y la modalidad de tus turnos, y esa conversación pasa por Anthropic. Nunca lee tus notas, tu transcripción ni tu resumen, y no cambia nada.");
  });

  it("sólo ofrece pedidos que la app ejecuta, y dice lo que no se puede hacer", () => {
    expect(hechos.PACIENTE_PUEDE_VER_NOTAS_Y_RESUMEN).toBe(true);
    expect(hechos.PACIENTE_PUEDE_CORREGIR_CONTACTO).toBe(true);
    expect(hechos.PACIENTE_PUEDE_CORREGIR_RESUMEN_CON_VERSIONES).toBe(true);
    expect(codigo("src/app/api/pacientes/[id]/route.ts")).toMatch(/export async function PATCH/);
    expect(codigo("src/app/api/_lib/schemas.ts")).toMatch(/pacienteCreateSchema = z\.object\(\{\s+nombre:[\s\S]*apellido:[\s\S]*telefono:/);
    expect(codigo("src/app/api/_lib/schemas.ts")).toContain("export const pacienteUpdateSchema = pacienteCreateSchema.partial()");
    expect(codigo("src/app/api/pacientes/[id]/hilo/versiones/route.ts")).toMatch(/export async function POST/);
    // La transcripción SÍ se ve: la vista la pide a su ruta (la 2.6 decía que no).
    expect(hechos.TRANSCRIPCION_VISIBLE_EN_PANTALLA).toBe(true);
    expect(codigo("src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx")).toContain("<TranscripcionView sesion={sesion} selector={selector} />");
    expect(codigo("src/app/api/sesion-clinica/[id]/transcripcion/route.ts")).toMatch(/export async function GET/);
    expect(texto).toContain("Podés pedirle a Lic. Ana Pérez que te muestre tus notas aprobadas, tu transcripción y el resumen de tu proceso, y que corrija tus datos de contacto o el resumen. Corregir el resumen agrega una versión nueva: las anteriores se conservan.");

    expect(hechos.BORRADO_DE_DATOS_A_PEDIDO).toBe(false);
    expect(codigo("src/app/api/pacientes/[id]/route.ts")).not.toMatch(/export async function DELETE/);
    const inmutabilidad = codigo("prisma/migrations/20260916013000_inmutabilidad/migration.sql");
    expect(inmutabilidad).toContain("CREATE TRIGGER hilo_versiones_sin_borrado");
    expect(inmutabilidad).toContain("CREATE TRIGGER eventos_auditoria_inmutable");
    expect(hechos.NOTA_APROBADA_CORREGIBLE).toBe(false);
    const estados = codigo("src/lib/sesion-clinica/estados.ts");
    expect([...estados.matchAll(/desde: \[([^\]]*)\]/g)].filter((m) => m[1].includes('"aprobada"'))).toHaveLength(1);
    expect(estados).toMatch(/reintentar_feedback: \{\s+actor: "usuaria",\s+desde: \["revision", "aprobada"\],\s+hacia: "mismo"/);
    expect(hechos.CONSENTIMIENTO_FIRMADO_VISIBLE_EN_PANTALLA).toBe(false);
    const rutaConsentimiento = codigo("src/app/api/pacientes/[id]/consentimiento/route.ts");
    const select = rutaConsentimiento.slice(rutaConsentimiento.indexOf("const consentimientoSelect"), rutaConsentimiento.indexOf("} as const;"));
    expect(select).not.toMatch(/textoCompleto|firmaDigital/);
    expect(texto).toContain("Desde la aplicación no se pueden borrar tus datos, corregir una nota ya aprobada ni ver esta autorización firmada.");
    expect(texto).not.toContain("Tenés derecho");
    expect(texto).not.toMatch(/que se eliminen|acceder a tus datos/);
  });

  it("revocar deja de grabar y no borra lo guardado", () => {
    expect(hechos.REVOCAR_BORRA_HISTORIA).toBe(false);
    expect(texto).toContain("Podés revocar esta autorización cuando quieras, sin explicar por qué: alcanza con avisarle. Desde ese momento no se graba más. Lo ya guardado no se borra: sigue siendo parte de tu historia clínica.");
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
  // El evento sólo se anota si viene por el cliente de la TRANSACCIÓN. Firmar
  // y revocar son actos legales: su rastro se confirma con el acto o no
  // ocurre. Si alguien lo volviera a escribir con el `db` global —después del
  // COMMIT y sin poder volver atrás—, este doble lo hace explotar acá en vez
  // de dejar pasar un acto sin rastro.
  const eventoAuditoriaEnLaTransaccion = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      baseDeDatos.eventos.push(data);
      return data;
    },
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
      create: async () => {
        throw new Error("El rastro de firmar/revocar va DENTRO de la transacción, no con el db global");
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        eventoAuditoria: eventoAuditoriaEnLaTransaccion,
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
    expect(texto).toContain("Versión 2.7");
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
