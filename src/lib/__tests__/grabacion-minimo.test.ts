/**
 * Integración — el mínimo de grabación, también en el servidor.
 *
 * El teléfono ya no sube una grabación de menos de MINIMO_SEGUNDOS: corta en
 * grabacion-captura.ts. Pero el 19 de septiembre una PWA vieja cacheada subió
 * una de 2 segundos, el servidor la aceptó, se pagó la transcripción y la
 * sesión terminó fallida con `asr_vacio`. El tope tiene que estar de los dos
 * lados, con UNA sola constante.
 *
 * Ejecutar:
 *   DATABASE_URL_TEST="postgresql://postgres:postgres@127.0.0.1:25433/sesion_test" \
 *   npx vitest run src/lib/__tests__/grabacion-minimo.test.ts
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  confirmarSubida,
  MENSAJE_GRABACION_CORTA,
  type AlmacenAudio,
} from "@/app/api/_lib/casos-uso/audio";
import { ApiError } from "@/app/api/_lib/responses";
import { MINIMO_SEGUNDOS } from "@/lib/grabacion-captura";
import { __resetLlaveroForTests } from "@/lib/llavero";
import {
  CODIGO_GRABACION_CORTA,
  keyAudio,
} from "@/lib/sesion-clinica/estados";

import { CLAVES_CIFRADO_TEST } from "./base-identidad";
import { conectarBaseDeTest, vaciarTablas, type ClienteCifrado } from "./db-test";

let prismaRaw!: PrismaClient;
let db!: ClienteCifrado;

const ORIGINAL_KEY = process.env.CLAVES_CIFRADO;

/** R2 doblado: el objeto siempre está, que es el caso que importa acá. */
const almacen: AlmacenAudio = {
  existe: async () => ({ existe: true, bytes: 12_345 }),
  firmarSubida: async () => ({ url: "https://r2.invalid/x", expiraEn: new Date() }),
};

async function sesionSubiendo() {
  const org = await prismaRaw.organization.create({
    data: { nombre: `Org ${randomUUID()}` },
  });
  const paciente = await prismaRaw.paciente.create({
    data: {
      nombre: "Ana",
      apellido: "López",
      telefono: `+5989900${Math.floor(1000 + Math.random() * 8999)}`,
      tarifa: 1200,
      organizationId: org.id,
    },
  });
  const turno = await prismaRaw.turno.create({
    data: {
      fecha: new Date("2026-09-21T15:00:00.000Z"),
      estado: "realizado",
      tarifaCobrada: 1200,
      pacienteId: paciente.id,
      organizationId: org.id,
    },
  });
  const sesion = await prismaRaw.sesionClinica.create({
    data: {
      turnoId: turno.id,
      organizationId: org.id,
      estado: "subiendo",
      audioEstado: "sin_audio",
    },
    select: { id: true },
  });
  return { orgId: org.id, sesionId: sesion.id };
}

const confirmar = (orgId: string, sesionId: string, duracionAudioSeg: number) =>
  confirmarSubida({
    prisma: db,
    organizationId: orgId,
    sesionId,
    key: keyAudio(orgId, sesionId, 0),
    duracionAudioSeg,
    almacen,
  });

const trabajosDe = (sesionId: string) =>
  prismaRaw.trabajo.findMany({ where: { sesionId } });

beforeAll(() => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  ({ prisma: prismaRaw, db } = conectarBaseDeTest());
});

beforeEach(async () => {
  process.env.CLAVES_CIFRADO = CLAVES_CIFRADO_TEST;
  __resetLlaveroForTests();
  await vaciarTablas(prismaRaw);
});

afterAll(async () => {
  await prismaRaw.$disconnect();
  if (ORIGINAL_KEY === undefined) delete process.env.CLAVES_CIFRADO;
  else process.env.CLAVES_CIFRADO = ORIGINAL_KEY;
  __resetLlaveroForTests();
});

describe("una grabación más corta que el mínimo", () => {
  it("no pasa a procesando, contesta con su código y encola el borrado del audio", async () => {
    const { orgId, sesionId } = await sesionSubiendo();

    const error = await confirmar(orgId, sesionId, 3).catch((e) => e as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).codigo).toBe(CODIGO_GRABACION_CORTA);
    expect((error as ApiError).message).toBe(MENSAJE_GRABACION_CORTA);

    // La sesión NO quedó lista para el worker: ni `procesando`, ni con una
    // próxima entrega agendada. Ahí es donde se pagaba la transcripción.
    const fila = await prismaRaw.sesionClinica.findUniqueOrThrow({ where: { id: sesionId } });
    expect(fila.estado).toBe("fallida");
    expect(fila.falloCodigo).toBe(CODIGO_GRABACION_CORTA);
    expect(fila.proximoIntentoEn).toBeNull();

    // Y el audio que ya está en R2 no queda huérfano.
    const trabajos = await trabajosDe(sesionId);
    expect(trabajos.map((t) => t.tipo)).toEqual(["borrar_audio_r2"]);
    expect(trabajos[0].payload).toEqual({
      prefijo: `${orgId}/${sesionId}/`,
      indices: [0],
    });
  });

  it("el acto y el borrado quedan juntos: no hay sesión fallida sin su trabajo", async () => {
    const { orgId, sesionId } = await sesionSubiendo();
    await confirmar(orgId, sesionId, 1).catch(() => undefined);

    const fila = await prismaRaw.sesionClinica.findUniqueOrThrow({ where: { id: sesionId } });
    expect(fila.estado).toBe("fallida");
    expect(await trabajosDe(sesionId)).toHaveLength(1);
  });
});

describe("una grabación que llega al mínimo", () => {
  it(`con ${MINIMO_SEGUNDOS} segundos justos pasa a procesando y no encola borrado`, async () => {
    const { orgId, sesionId } = await sesionSubiendo();

    const { sesion } = await confirmar(orgId, sesionId, MINIMO_SEGUNDOS);

    expect(sesion.estado).toBe("procesando");
    const fila = await prismaRaw.sesionClinica.findUniqueOrThrow({ where: { id: sesionId } });
    expect(fila.audioEstado).toBe("en_r2");
    expect(fila.duracionAudioSeg).toBe(MINIMO_SEGUNDOS);
    expect(fila.falloCodigo).toBeNull();
    expect(await trabajosDe(sesionId)).toEqual([]);
  });
});

describe("una sola constante para los dos lados", () => {
  it("grabacion-captura.ts no importa NADA, así que el servidor lo puede leer", () => {
    // Es lo que hace que la constante no haya tenido que mudarse. Si alguien
    // le agrega un import del navegador, el servidor se lo llevaría puesto:
    // este test se pone rojo antes.
    const fuente = readFileSync(
      join(process.cwd(), "src", "lib", "grabacion-captura.ts"),
      "utf8",
    );
    expect(fuente).not.toMatch(/^\s*import\s/m);
    expect(fuente).not.toMatch(/\brequire\(/);
  });
});
