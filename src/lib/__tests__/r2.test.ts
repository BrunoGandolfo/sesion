import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

interface S3CommandInput {
  Bucket?: string;
  Key?: string;
  Metadata?: Record<string, string>;
  ContentType?: string;
  ContentLength?: number;
  Prefix?: string;
  ContinuationToken?: string;
}

// vi.mock se hoistea por encima de los imports, por eso usamos vi.hoisted
// para compartir el mock de send entre la factory y los tests. Las factories
// son nombradas porque el describe del SDK real las vuelve a registrar al
// terminar (vi.doMock).
const { sendMock, getSignedUrlMock, fabricaPresigner, fabricaClienteS3 } =
  vi.hoisted(() => {
    const sendMock = vi.fn();
    const getSignedUrlMock = vi.fn();

    const fabricaPresigner = () => ({
      getSignedUrl: getSignedUrlMock,
    });

    const fabricaClienteS3 = () => {
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
      class ListObjectsV2Command {
        readonly __cmd = "List" as const;
        constructor(public input: S3CommandInput) {}
      }
      return {
        S3Client,
        PutObjectCommand,
        DeleteObjectCommand,
        HeadObjectCommand,
        ListObjectsV2Command,
      };
    };

    return { sendMock, getSignedUrlMock, fabricaPresigner, fabricaClienteS3 };
  });

vi.mock("@aws-sdk/s3-request-presigner", fabricaPresigner);
vi.mock("@aws-sdk/client-s3", fabricaClienteS3);

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

  describe("listarPorPrefijo (lo que borra borrar_audio_r2)", () => {
    it("pagina con ContinuationToken hasta que R2 dice que no hay más", async () => {
      setR2Env();
      sendMock
        .mockResolvedValueOnce({ Contents: [{ Key: "org/ses/0" }], IsTruncated: true, NextContinuationToken: "t1" })
        .mockResolvedValueOnce({ Contents: [{ Key: "org/ses/1" }, { Key: "org/ses/2" }], IsTruncated: false });
      const { listarPorPrefijo } = await import("@/lib/r2");

      expect(await listarPorPrefijo("org/ses/")).toEqual(["org/ses/0", "org/ses/1", "org/ses/2"]);
      const pedidos = sendMock.mock.calls.map(([cmd]) => (cmd as { __cmd: string; input: S3CommandInput }));
      expect(pedidos.map((c) => c.__cmd)).toEqual(["List", "List"]);
      expect(pedidos.map((c) => c.input.Prefix)).toEqual(["org/ses/", "org/ses/"]);
      expect(pedidos.map((c) => c.input.ContinuationToken)).toEqual([undefined, "t1"]);
      expect(pedidos[0].input.Bucket).toBe("bucket-test");
    });

    it("un prefijo vacío o sin barra final no llega a R2", async () => {
      setR2Env();
      const { listarPorPrefijo } = await import("@/lib/r2");
      await expect(listarPorPrefijo("")).rejects.toThrow(/Prefijo inválido/);
      await expect(listarPorPrefijo("org/ses")).rejects.toThrow(/Prefijo inválido/);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("un error de R2 se propaga con el prefijo, sin confundirse con 'no hay nada'", async () => {
      setR2Env();
      sendMock.mockRejectedValueOnce(new Error("AccessDenied"));
      const { listarPorPrefijo } = await import("@/lib/r2");
      await expect(listarPorPrefijo("org/ses/")).rejects.toThrow(/No se pudo listar el audio en R2 \(org\/ses\/\): AccessDenied/);
    });
  });

  describe("conTimeout y el adaptador del cron de trabajos", () => {
    it("rechaza con la operación si R2 no contesta a tiempo, y deja pasar lo que llega antes", async () => {
      const { conTimeout } = await import("@/lib/r2");
      await expect(conTimeout(new Promise(() => {}), "list", 5)).rejects.toThrow("R2 no respondió en 5 ms (list)");
      await expect(conTimeout(Promise.resolve("ok"), "delete", 50)).resolves.toBe("ok");
      await expect(conTimeout(Promise.reject(new Error("AccessDenied")), "delete", 50)).rejects.toThrow("AccessDenied");
    });

    it("el adaptador lista y borra contra el bucket", async () => {
      setR2Env();
      sendMock.mockResolvedValueOnce({ Contents: [{ Key: "org/ses/0" }], IsTruncated: false });
      const { adaptadorBorradoR2 } = await import("@/lib/r2");
      expect(await adaptadorBorradoR2.listar("org/ses/")).toEqual(["org/ses/0"]);
      await adaptadorBorradoR2.borrar("org/ses/0");
      const ultimo = sendMock.mock.calls.at(-1)?.[0] as { __cmd: string; input: S3CommandInput };
      expect(ultimo.__cmd).toBe("Delete");
      expect(ultimo.input.Key).toBe("org/ses/0");
    });
  });

  describe("generarUrlSubida (PUT prefirmado para el navegador)", () => {
    it("firma un PutObject con bucket, key, Content-Type y Content-Length", async () => {
      setR2Env();
      const { generarUrlSubida } = await import("@/lib/r2");

      const antes = Date.now();
      const result = await generarUrlSubida("org/sesion/0", {
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
      expect(cmd.input.Key).toBe("org/sesion/0");
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
      await generarUrlSubida("org/sesion/0", {
        contentType: "application/octet-stream",
        contentLength: 1,
      });
      const [, , opts] = getSignedUrlMock.mock.calls[0] as [unknown, unknown, { expiresIn: number }];
      expect(opts.expiresIn).toBe(3600);
    });

    it("lanza si R2 no está configurado", async () => {
      unsetR2Env();
      const { generarUrlSubida } = await import("@/lib/r2");
      await expect(
        generarUrlSubida("org/sesion/0", { contentType: "audio/webm", contentLength: 1 }),
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

  // Con el SDK real, sin red: getSignedUrl firma en local. Protege
  // `requestChecksumCalculation: "WHEN_REQUIRED"` de r2.ts: sin eso el SDK
  // agrega a la URL un checksum del cuerpo vacío y R2 rechaza el PUT del
  // navegador con el audio real. Corre con cada versión del SDK que traiga
  // Dependabot.
  describe("generarUrlSubida con el SDK real (checksum)", () => {
    beforeEach(() => {
      vi.doUnmock("@aws-sdk/client-s3");
      vi.doUnmock("@aws-sdk/s3-request-presigner");
    });

    afterEach(() => {
      vi.doMock("@aws-sdk/client-s3", fabricaClienteS3);
      vi.doMock("@aws-sdk/s3-request-presigner", fabricaPresigner);
    });

    it("la URL firmada no lleva checksum del cuerpo y sí la firma", async () => {
      setR2Env();
      const { generarUrlSubida } = await import("@/lib/r2");

      const { url } = await generarUrlSubida("org/sesion/0", {
        contentType: "audio/webm",
        contentLength: 12345,
        expiraEnSegundos: 600,
      });

      const query = new URL(url).searchParams;
      expect(query.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
      expect(query.has("x-amz-checksum-crc32")).toBe(false);
      expect(query.has("x-amz-sdk-checksum-algorithm")).toBe(false);
      expect(getSignedUrlMock).not.toHaveBeenCalled();
    });
  });
});
