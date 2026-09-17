import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// vi.mock se hoistea por encima de los imports, por eso usamos vi.hoisted
// para compartir el mock de send entre la factory y los tests.
const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

interface S3CommandInput {
  Bucket?: string;
  Key?: string;
  Metadata?: Record<string, string>;
  ContentType?: string;
  ContentLength?: number;
}

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = sendMock;
  }
  class PutObjectCommand {
    readonly __cmd = "Put" as const;
    constructor(public input: S3CommandInput) {}
  }
  class DeleteObjectCommand {
    readonly __cmd = "Delete" as const;
    constructor(public input: S3CommandInput) {}
  }
  class HeadObjectCommand {
    readonly __cmd = "Head" as const;
    constructor(public input: S3CommandInput) {}
  }
  return {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
  };
});

const ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

function setR2Env() {
  vi.stubEnv("R2_ACCOUNT_ID", "acc-test");
  vi.stubEnv("R2_ACCESS_KEY_ID", "akid-test");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "sk-test");
  vi.stubEnv("R2_BUCKET_NAME", "bucket-test");
}

function unsetR2Env() {
  for (const k of ENV_KEYS) vi.stubEnv(k, "");
}

describe("R2 client", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    getSignedUrlMock.mockReset();
    getSignedUrlMock.mockResolvedValue("https://r2.example/firmada?X-Amz-Signature=abc");
    // resetModules limpia el singleton interno de r2.ts entre tests.
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("r2Configurado", () => {
    it("devuelve false cuando faltan todas las env vars", async () => {
      unsetR2Env();
      const { r2Configurado } = await import("@/lib/r2");
      expect(r2Configurado()).toBe(false);
    });

    it("devuelve true cuando están todas las env vars", async () => {
      setR2Env();
      const { r2Configurado } = await import("@/lib/r2");
      expect(r2Configurado()).toBe(true);
    });

    it("devuelve false si falta una sola variable", async () => {
      setR2Env();
      vi.stubEnv("R2_BUCKET_NAME", "");
      const { r2Configurado } = await import("@/lib/r2");
      expect(r2Configurado()).toBe(false);
    });
  });

  describe("segmentos inmutables", () => {
    const descriptor = { indice: 0, inicioMs: 0, iv: "AAAAAAAAAAAAAAAA", bytes: 12345, sha256: "a".repeat(64), continuacion: false };
    it("firma el tamaño, la huella y la prohibición de sobrescribir durante cinco minutos", async () => {
      setR2Env();
      const { objetosAudio } = await import("@/lib/r2");
      const resultado = await objetosAudio.firmar("org/sesion/0", descriptor);
      const [, comando, opciones] = getSignedUrlMock.mock.calls[0];
      expect(comando.input).toMatchObject({ Key: "org/sesion/0", ContentType: "application/octet-stream", ContentLength: 12345, IfNoneMatch: "*", Metadata: { sha256: descriptor.sha256 } });
      expect(opciones.expiresIn).toBe(300);
      expect(resultado.headers["If-None-Match"]).toBe("*");
    });
    it("verifica el tamaño y la huella declarada sin descargar el audio", async () => {
      setR2Env(); sendMock.mockResolvedValueOnce({ ContentLength: 12345, Metadata: { sha256: descriptor.sha256 } });
      const { objetosAudio } = await import("@/lib/r2");
      expect(await objetosAudio.comprobar("org/sesion/0")).toEqual({ existe: true, bytes: 12345, sha256: descriptor.sha256 });
    });
    it("no firma si R2 no está configurado", async () => {
      unsetR2Env(); const { objetosAudio } = await import("@/lib/r2");
      await expect(objetosAudio.firmar("org/sesion/0", descriptor)).rejects.toThrow(/R2 no está configurado/);
    });
  });

  describe("existeAudio (HeadObject)", () => {
    it("devuelve existe=true con el tamaño cuando el objeto está", async () => {
      setR2Env();
      sendMock.mockResolvedValueOnce({ ContentLength: 987 });
      const { existeAudio } = await import("@/lib/r2");

      const result = await existeAudio("audio/o/s/t.enc");

      expect(result).toEqual({ existe: true, bytes: 987 });
      const cmd = sendMock.mock.calls[0][0] as {
        __cmd: "Head";
        input: S3CommandInput;
      };
      expect(cmd.__cmd).toBe("Head");
      expect(cmd.input.Key).toBe("audio/o/s/t.enc");
    });

    it("devuelve existe=false ante NotFound / 404, sin lanzar", async () => {
      setR2Env();
      const notFound = Object.assign(new Error("not found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      });
      sendMock.mockRejectedValueOnce(notFound);
      const { existeAudio } = await import("@/lib/r2");

      await expect(existeAudio("audio/no.enc")).resolves.toEqual({
        existe: false,
        bytes: null,
      });
    });

    it("propaga otros errores (credenciales, red) con la key", async () => {
      setR2Env();
      const denied = Object.assign(new Error("denied"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      });
      sendMock.mockRejectedValueOnce(denied);
      const { existeAudio } = await import("@/lib/r2");

      await expect(existeAudio("audio/x.enc")).rejects.toThrow(/audio\/x\.enc/);
    });
  });
});
