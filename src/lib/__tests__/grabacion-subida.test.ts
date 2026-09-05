// Tests de la subida del audio cifrado a R2, tal como está hoy.
//
// POR QUÉ ESTOS Y NO OTROS
//
// `subirAudioCifrado` y `volverAGrabando` (src/hooks/useGrabacionSesion.ts)
// son funciones de módulo, no hooks: se pueden probar con vitest puro
// poniendo dobles de `fetch` y de `XMLHttpRequest` en el global. No hacen
// falta ni jsdom ni @testing-library, que el proyecto no tiene y que no se
// pueden agregar (no se corre npm install en esta tanda).
//
// Lo que protegen es el camino por donde se puede perder una sesión clínica
// entera: tres pasos encadenados, cada uno con su forma de fallar, y una
// recuperación que depende de que el paso que falló se identifique bien.
//
// `XMLHttpRequest` se dobla porque el paso 2 lo usa a propósito: `fetch` no
// expone progreso de subida y la pantalla muestra una barra.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ErrorSubida,
  subirAudioCifrado,
  volverAGrabando,
} from "@/hooks/useGrabacionSesion";

const SESION_ID = "ses_1";

// ────────────────────────────────────────────────────────────────────────────
// Dobles
// ────────────────────────────────────────────────────────────────────────────

type Llamada = { url: string; init?: RequestInit };

/** Lo que el doble de fetch va a contestar, en orden de llamada. */
interface RespuestaFalsa {
  ok: boolean;
  status: number;
  cuerpo: unknown;
}

function respuesta({ ok, status, cuerpo }: RespuestaFalsa) {
  return {
    ok,
    status,
    json: async () => cuerpo,
  } as unknown as Response;
}

const URL_PREFIRMADA = {
  data: {
    url: "https://r2.example/audio.enc?firma=1",
    key: "org/ses/audio.enc",
    expiraEn: "2026-09-05T16:00:00.000Z",
    headers: { "Content-Type": "application/octet-stream" },
  },
};

const SESION_ACTUALIZADA = { data: { id: SESION_ID, estado: "procesando" } };

let llamadas: Llamada[] = [];

/** Encola respuestas de `fetch`, una por llamada, en orden. */
function fetchQueDevuelve(...respuestas: RespuestaFalsa[]) {
  let i = 0;
  return vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    const r = respuestas[Math.min(i, respuestas.length - 1)];
    i += 1;
    return respuesta(r);
  });
}

const OK_URL: RespuestaFalsa = { ok: true, status: 200, cuerpo: URL_PREFIRMADA };
const OK_CONFIRMAR: RespuestaFalsa = {
  ok: true,
  status: 200,
  cuerpo: SESION_ACTUALIZADA,
};

interface OpcionesXhr {
  /** Status con el que responde el PUT. */
  status?: number;
  /** Si true, dispara onerror en vez de onload. */
  falloDeRed?: boolean;
  /** Progresos a emitir antes de terminar, en bytes cargados de 100. */
  progresos?: number[];
}

/** Estado observable del último PUT que hizo el doble de XHR. */
const ultimoPut = {
  url: "",
  headers: {} as Record<string, string>,
  enviado: null as unknown,
};

function xhrQue(opciones: OpcionesXhr = {}) {
  const { status = 200, falloDeRed = false, progresos = [] } = opciones;

  return class XhrFalso {
    status = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
      onprogress: null,
    };
    private headers: Record<string, string> = {};
    private url = "";

    open(_metodo: string, url: string) {
      this.url = url;
    }

    setRequestHeader(clave: string, valor: string) {
      this.headers[clave] = valor;
    }

    send(cuerpo: unknown) {
      ultimoPut.url = this.url;
      ultimoPut.headers = this.headers;
      ultimoPut.enviado = cuerpo;

      // Asíncrono, como el de verdad: el await de la promesa tiene que
      // resolverse después de que el llamador vuelva.
      queueMicrotask(() => {
        for (const loaded of progresos) {
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded,
            total: 100,
          } as ProgressEvent);
        }

        if (falloDeRed) {
          this.onerror?.();
          return;
        }

        this.status = status;
        this.onload?.();
      });
    }
  };
}

function datosDeGrabacion(pausas?: { inicio: string; fin: string }[]) {
  return {
    audioBlob: new Blob([new Uint8Array([1, 2, 3])], {
      type: "application/octet-stream",
    }),
    claveCifrado: "clave-base64",
    ivCifrado: "iv-base64",
    duracionSegundos: 2400,
    ...(pausas ? { pausas } : {}),
  };
}

/** El JSON que se mandó en la llamada número `i` (0-based). */
function cuerpoDe(i: number): Record<string, unknown> {
  return JSON.parse(String(llamadas[i].init?.body)) as Record<string, unknown>;
}

const fetchOriginal = globalThis.fetch;
const xhrOriginal = globalThis.XMLHttpRequest;

beforeEach(() => {
  llamadas = [];
  ultimoPut.url = "";
  ultimoPut.headers = {};
  ultimoPut.enviado = null;
  globalThis.XMLHttpRequest = xhrQue() as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.XMLHttpRequest = xhrOriginal;
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────

describe("subirAudioCifrado — camino feliz", () => {
  it("hace los tres pasos en orden y devuelve la sesión actualizada", async () => {
    globalThis.fetch = fetchQueDevuelve(
      OK_URL,
      OK_CONFIRMAR,
    ) as unknown as typeof fetch;

    const resultado = await subirAudioCifrado(SESION_ID, datosDeGrabacion());

    expect(llamadas.map((l) => l.url)).toEqual([
      `/api/sesion-clinica/${SESION_ID}/upload-url`,
      `/api/sesion-clinica/${SESION_ID}/upload-confirmar`,
    ]);
    // El PUT va a R2, no a la app: el audio nunca pasa por Vercel.
    expect(ultimoPut.url).toBe(URL_PREFIRMADA.data.url);
    expect(resultado).toEqual(SESION_ACTUALIZADA.data);
  });

  it("manda la clave y el IV al paso 1, nunca al PUT", async () => {
    globalThis.fetch = fetchQueDevuelve(
      OK_URL,
      OK_CONFIRMAR,
    ) as unknown as typeof fetch;

    await subirAudioCifrado(SESION_ID, datosDeGrabacion());

    expect(cuerpoDe(0)).toEqual({
      claveCifrado: "clave-base64",
      iv: "iv-base64",
      tamanoBytes: 3,
      mime: "application/octet-stream",
    });
    // Lo que viaja a R2 es el blob, a secas.
    expect(ultimoPut.enviado).toBeInstanceOf(Blob);
  });

  it("usa exactamente los headers que firmó el servidor", async () => {
    // El PUT tiene que mandar el Content-Type firmado en la URL: cualquier
    // otro y R2 responde 403.
    globalThis.fetch = fetchQueDevuelve(
      OK_URL,
      OK_CONFIRMAR,
    ) as unknown as typeof fetch;

    await subirAudioCifrado(SESION_ID, datosDeGrabacion());

    expect(ultimoPut.headers).toEqual(URL_PREFIRMADA.data.headers);
  });

  it("informa el progreso, y cierra en 100", async () => {
    globalThis.XMLHttpRequest = xhrQue({
      progresos: [25, 60],
    }) as unknown as typeof XMLHttpRequest;
    globalThis.fetch = fetchQueDevuelve(
      OK_URL,
      OK_CONFIRMAR,
    ) as unknown as typeof fetch;

    const vistos: number[] = [];
    await subirAudioCifrado(SESION_ID, datosDeGrabacion(), (p) =>
      vistos.push(p),
    );

    expect(vistos).toEqual([0, 25, 60, 100]);
  });
});

describe("subirAudioCifrado — las pausas", () => {
  it("manda las pausas cerradas al confirmar", async () => {
    globalThis.fetch = fetchQueDevuelve(
      OK_URL,
      OK_CONFIRMAR,
    ) as unknown as typeof fetch;
    const pausas = [
      {
        inicio: "2026-09-05T15:10:00.000Z",
        fin: "2026-09-05T15:12:00.000Z",
      },
    ];

    await subirAudioCifrado(SESION_ID, datosDeGrabacion(pausas));

    expect(cuerpoDe(1)).toEqual({
      key: URL_PREFIRMADA.data.key,
      duracionAudioSeg: 2400,
      pausas,
    });
  });

  it("descarta una pausa sin fin: no describe ningún tramo", async () => {
    globalThis.fetch = fetchQueDevuelve(
      OK_URL,
      OK_CONFIRMAR,
    ) as unknown as typeof fetch;
    const abierta = { inicio: "2026-09-05T15:10:00.000Z", fin: "" };

    await subirAudioCifrado(SESION_ID, datosDeGrabacion([abierta]));

    // Sin pausas válidas el campo se OMITE, no se manda vacío: así un
    // reintento de la misma subida no borra las pausas ya guardadas.
    expect(cuerpoDe(1)).toEqual({
      key: URL_PREFIRMADA.data.key,
      duracionAudioSeg: 2400,
    });
  });

  it("sin pausas tampoco manda el campo", async () => {
    globalThis.fetch = fetchQueDevuelve(
      OK_URL,
      OK_CONFIRMAR,
    ) as unknown as typeof fetch;

    await subirAudioCifrado(SESION_ID, datosDeGrabacion());

    expect(cuerpoDe(1)).not.toHaveProperty("pausas");
  });
});

describe("subirAudioCifrado — cada paso falla distinto", () => {
  it("si el paso 1 falla, dice paso 'url' y no toca R2", async () => {
    globalThis.fetch = fetchQueDevuelve({
      ok: false,
      status: 409,
      cuerpo: { error: "La sesión ya tiene una subida en curso." },
    }) as unknown as typeof fetch;

    const error = await subirAudioCifrado(
      SESION_ID,
      datosDeGrabacion(),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorSubida);
    expect(error).toMatchObject({
      paso: "url",
      status: 409,
      message: "La sesión ya tiene una subida en curso.",
    });
    // No llegó a intentar el PUT: es lo que decide que la pantalla NO tenga
    // que volver la sesión a "grabando".
    expect(ultimoPut.url).toBe("");
  });

  it("si R2 rechaza el PUT, dice paso 'put' y menciona CORS", async () => {
    globalThis.XMLHttpRequest = xhrQue({
      status: 403,
    }) as unknown as typeof XMLHttpRequest;
    globalThis.fetch = fetchQueDevuelve(OK_URL) as unknown as typeof fetch;

    const error = await subirAudioCifrado(
      SESION_ID,
      datosDeGrabacion(),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorSubida);
    expect(error).toMatchObject({ paso: "put", status: 403 });
    expect((error as ErrorSubida).message).toContain("CORS");
    // No se confirmó nada: la única llamada fue la del paso 1.
    expect(llamadas).toHaveLength(1);
  });

  it("un corte de red en el PUT también es paso 'put', sin status", async () => {
    globalThis.XMLHttpRequest = xhrQue({
      falloDeRed: true,
    }) as unknown as typeof XMLHttpRequest;
    globalThis.fetch = fetchQueDevuelve(OK_URL) as unknown as typeof fetch;

    const error = await subirAudioCifrado(
      SESION_ID,
      datosDeGrabacion(),
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({ paso: "put", status: null });
  });

  it("si la confirmación falla, dice paso 'confirmar' — el audio YA está en R2", async () => {
    globalThis.fetch = fetchQueDevuelve(OK_URL, {
      ok: false,
      status: 502,
      cuerpo: { error: "No se pudo verificar el audio en R2" },
    }) as unknown as typeof fetch;

    const error = await subirAudioCifrado(
      SESION_ID,
      datosDeGrabacion(),
    ).catch((e: unknown) => e);

    expect(error).toMatchObject({ paso: "confirmar", status: 502 });
  });

  it("un error sin cuerpo JSON no se traga: queda el HTTP", async () => {
    globalThis.fetch = fetchQueDevuelve({
      ok: false,
      status: 500,
      cuerpo: null,
    }) as unknown as typeof fetch;

    const error = await subirAudioCifrado(
      SESION_ID,
      datosDeGrabacion(),
    ).catch((e: unknown) => e);

    expect((error as ErrorSubida).message).toBe("HTTP 500");
  });
});

describe("volverAGrabando", () => {
  it("devuelve la sesión a grabando solo si quedó en 'subiendo'", async () => {
    globalThis.fetch = fetchQueDevuelve(
      { ok: true, status: 200, cuerpo: { data: { estado: "subiendo" } } },
      { ok: true, status: 200, cuerpo: { data: { estado: "grabando" } } },
    ) as unknown as typeof fetch;

    await volverAGrabando(SESION_ID);

    expect(llamadas).toHaveLength(2);
    expect(llamadas[1].init?.method).toBe("PATCH");
    expect(cuerpoDe(1)).toEqual({ estado: "grabando" });
  });

  it("no toca una sesión que ya avanzó a procesando", async () => {
    // Si el paso 3 llegó a la base y sólo falló la respuesta, devolverla a
    // "grabando" sería tirar abajo una subida que sí funcionó.
    globalThis.fetch = fetchQueDevuelve({
      ok: true,
      status: 200,
      cuerpo: { data: { estado: "procesando" } },
    }) as unknown as typeof fetch;

    await volverAGrabando(SESION_ID);

    expect(llamadas).toHaveLength(1);
  });

  it("con la sesión inexistente no hace nada", async () => {
    globalThis.fetch = fetchQueDevuelve({
      ok: true,
      status: 200,
      cuerpo: { data: null },
    }) as unknown as typeof fetch;

    await volverAGrabando(SESION_ID);

    expect(llamadas).toHaveLength(1);
  });

  it("es best-effort: si la lectura falla, no lanza", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("sin red");
    }) as unknown as typeof fetch;

    await expect(volverAGrabando(SESION_ID)).resolves.toBeUndefined();
  });

  it("si la lectura responde error HTTP, tampoco lanza ni patchea", async () => {
    globalThis.fetch = fetchQueDevuelve({
      ok: false,
      status: 404,
      cuerpo: null,
    }) as unknown as typeof fetch;

    await expect(volverAGrabando(SESION_ID)).resolves.toBeUndefined();
    expect(llamadas).toHaveLength(1);
  });
});
