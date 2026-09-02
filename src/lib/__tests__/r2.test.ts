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
  class GetObjectCommand {
    readonly __cmd = "Get" as const;
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
    GetObjectCommand,
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

  describe("subirAudioCifrado", () => {
    it("retorna la key suministrada (formato audio/{id}.enc)", async () => {
      setR2Env();
      const { subirAudioCifrado } = await import("@/lib/r2");
      const key = "audio/sc-123.enc";

      const result = await subirAudioCifrado(
        key,
        Buffer.from("payload"),
        { iv: "ivb64", claveId: "clave-1" },
      );

      expect(result).toBe(key);
      expect(result).toMatch(/^audio\/.+\.enc$/);
    });

    it("envía el bucket, key y metadata correctos al S3Client", async () => {
      setR2Env();
      const { subirAudioCifrado } = await import("@/lib/r2");

      await subirAudioCifrado(
        "audio/abc.enc",
        Buffer.from("x"),
        { iv: "iv-base64", claveId: "clave-42" },
      );

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0] as {
        __cmd: "Put";
        input: S3CommandInput;
      };
      expect(cmd.__cmd).toBe("Put");
      expect(cmd.input.Bucket).toBe("bucket-test");
      expect(cmd.input.Key).toBe("audio/abc.enc");
      // S3 normaliza metadata a minúsculas: la implementación las
      // emite ya en minúsculas para que el round-trip sea estable.
      expect(cmd.input.Metadata).toEqual({
        iv: "iv-base64",
        claveid: "clave-42",
      });
    });

    it("lanza error descriptivo cuando R2 no está configurado", async () => {
      unsetR2Env();
      const { subirAudioCifrado } = await import("@/lib/r2");

      await expect(
        subirAudioCifrado(
          "audio/x.enc",
          Buffer.from("x"),
          { iv: "i", claveId: "c" },
        ),
      ).rejects.toThrow(/R2 no está configurado/);
    });

    it("envuelve errores del S3 en un mensaje con la key", async () => {
      setR2Env();
      sendMock.mockRejectedValueOnce(new Error("network down"));
      const { subirAudioCifrado } = await import("@/lib/r2");

      await expect(
        subirAudioCifrado(
          "audio/falla.enc",
          Buffer.from("x"),
          { iv: "i", claveId: "c" },
        ),
      ).rejects.toThrow(/audio\/falla\.enc/);
    });
  });

  describe("generarUrlSubida (PUT prefirmado para el navegador)", () => {
    it("firma un PutObject con bucket, key, Content-Type y Content-Length", async () => {
      setR2Env();
      const { generarUrlSubida } = await import("@/lib/r2");

      const antes = Date.now();
      const result = await generarUrlSubida("audio/o/s/t.enc", {
        contentType: "audio/webm",
        contentLength: 12345,
        expiraEnSegundos: 3600,
      });

      expect(result.url).toMatch(/^https:\/\/r2\.example\/firmada/);
      expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
      const [, cmd, opts] = getSignedUrlMock.mock.calls[0] as [
        unknown,
        { __cmd: "Put"; input: S3CommandInput },
        { expiresIn: number },
      ];
      expect(cmd.__cmd).toBe("Put");
      expect(cmd.input.Bucket).toBe("bucket-test");
      expect(cmd.input.Key).toBe("audio/o/s/t.enc");
      expect(cmd.input.ContentType).toBe("audio/webm");
      expect(cmd.input.ContentLength).toBe(12345);
      expect(opts.expiresIn).toBe(3600);
      // expiraEn ≈ ahora + 3600 s (tolerancia de 5 s)
      const delta = result.expiraEn.getTime() - antes;
      expect(delta).toBeGreaterThanOrEqual(3600 * 1000 - 5000);
      expect(delta).toBeLessThanOrEqual(3600 * 1000 + 5000);
    });

    it("usa 60 minutos por defecto", async () => {
      setR2Env();
      const { generarUrlSubida } = await import("@/lib/r2");
      await generarUrlSubida("audio/k.enc", {
        contentType: "application/octet-stream",
        contentLength: 1,
      });
      const [, , opts] = getSignedUrlMock.mock.calls[0] as [
        unknown,
        unknown,
        { expiresIn: number },
      ];
      expect(opts.expiresIn).toBe(3600);
    });

    it("lanza si R2 no está configurado", async () => {
      unsetR2Env();
      const { generarUrlSubida } = await import("@/lib/r2");
      await expect(
        generarUrlSubida("audio/k.enc", {
          contentType: "audio/webm",
          contentLength: 1,
        }),
      ).rejects.toThrow(/R2 no está configurado/);
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
