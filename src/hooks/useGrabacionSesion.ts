"use client";

import * as React from "react";

import { limpiarGrabacion } from "@/lib/grabacion-storage";
import { useSesionClinicaPolling } from "@/hooks/useSesionClinicaPolling";
import type {
  DatosEstructurados,
  EstadoProcesamiento,
  NotaSOAP,
  SesionClinicaResponse,
  Turno,
} from "@/types/domain";

export interface DatosGrabacion {
  audioBlob: Blob;
  claveCifrado: string;
  ivCifrado: string;
  duracionSegundos: number;
}

interface UseGrabacionSesionOptions {
  turno: Turno | null;
  onTurnoActualizado?: () => void;
}

interface UseGrabacionSesionResult {
  sesionClinica: SesionClinicaResponse | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  /** true cuando hay un blob cifrado en memoria cuya subida falló. */
  subidaPendiente: boolean;
  /** 0-100 mientras el PUT a R2 está en curso; null fuera de eso. */
  progresoSubida: number | null;
  iniciar: () => Promise<void>;
  completar: (datos: DatosGrabacion) => Promise<void>;
  /** Repite los tres pasos de la subida con el mismo blob cifrado. */
  reintentarSubida: () => Promise<void>;
  reintentar: () => Promise<void>;
  refrescar: () => Promise<void>;
}

type RawSesionClinica = {
  id: string;
  turnoId: string;
  estado: string;
  duracionAudioSeg: number | null;
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
  datosEstructurados: DatosEstructurados | string | null;
  modeloASR: string | null;
  modeloLLM: string | null;
  procesadoEn: string | null;
  aprobadoEn: string | null;
  error: string | null;
};

function parseDatosEstructurados(
  value: DatosEstructurados | string | null,
): DatosEstructurados | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as DatosEstructurados;
    } catch {
      return null;
    }
  }
  return value;
}

function toSesionClinicaResponse(raw: RawSesionClinica): SesionClinicaResponse {
  const nota: NotaSOAP | null =
    raw.notaSubjetivo != null &&
    raw.notaObjetivo != null &&
    raw.notaAnalisis != null &&
    raw.notaPlan != null
      ? {
          subjetivo: raw.notaSubjetivo,
          objetivo: raw.notaObjetivo,
          analisis: raw.notaAnalisis,
          plan: raw.notaPlan,
        }
      : null;

  return {
    id: raw.id,
    turnoId: raw.turnoId,
    estado: raw.estado as EstadoProcesamiento,
    duracionAudioSeg: raw.duracionAudioSeg,
    nota,
    datosEstructurados: parseDatosEstructurados(raw.datosEstructurados),
    modeloASR: raw.modeloASR,
    modeloLLM: raw.modeloLLM,
    procesadoEn: raw.procesadoEn,
    aprobadoEn: raw.aprobadoEn,
    error: raw.error,
  };
}

async function parseError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string }
    | null;
  return body?.error ?? `HTTP ${res.status}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Subida directa a R2 en tres pasos. Exportada para que cualquier pantalla
// que grabe (historia-tab, paciente-detail-view vía este hook) use el mismo
// flujo. El audio NUNCA pasa por Vercel: el límite de 4,5 MB por request de
// las funciones hacía fallar toda sesión real con 413.
//
//   1. POST [id]/upload-url       → { url, key, headers }  (grabando → subiendo)
//   2. PUT  url (XHR, con progreso) → R2
//   3. POST [id]/upload-confirmar → fila actualizada       (subiendo → procesando)
// ────────────────────────────────────────────────────────────────────────────

export type PasoSubida = "url" | "put" | "confirmar";

export class ErrorSubida extends Error {
  constructor(
    message: string,
    public readonly paso: PasoSubida,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ErrorSubida";
  }
}

type UrlSubidaResponse = {
  data: { url: string; key: string; expiraEn: string; headers: Record<string, string> };
};

function putConProgreso(
  url: string,
  blob: Blob,
  headers: Record<string, string>,
  onProgreso?: (porcentaje: number) => void,
): Promise<void> {
  // fetch no expone progreso de subida; XHR sí. Sin credenciales: la URL
  // prefirmada lleva la autorización en la query string.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgreso) {
        onProgreso(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new ErrorSubida(
            `R2 rechazó la subida (HTTP ${xhr.status}). Si es 403, revisá la configuración de CORS del bucket.`,
            "put",
            xhr.status,
          ),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ErrorSubida(
          "Fallo de red al subir el audio. Revisá la conexión y reintentá.",
          "put",
        ),
      );
    xhr.onabort = () =>
      reject(new ErrorSubida("La subida fue cancelada.", "put"));
    xhr.send(blob);
  });
}

export async function subirAudioCifrado(
  sesionClinicaId: string,
  datos: DatosGrabacion,
  onProgreso?: (porcentaje: number) => void,
): Promise<RawSesionClinica> {
  const mime = datos.audioBlob.type || "application/octet-stream";

  // 1. URL prefirmada (guarda clave + IV en el servidor).
  const resUrl = await fetch(`/api/sesion-clinica/${sesionClinicaId}/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      claveCifrado: datos.claveCifrado,
      iv: datos.ivCifrado,
      tamanoBytes: datos.audioBlob.size,
      mime,
    }),
  });
  if (!resUrl.ok) {
    throw new ErrorSubida(await parseError(resUrl), "url", resUrl.status);
  }
  const { data: subida } = (await resUrl.json()) as UrlSubidaResponse;

  // 2. PUT directo a R2.
  onProgreso?.(0);
  await putConProgreso(subida.url, datos.audioBlob, subida.headers, onProgreso);
  onProgreso?.(100);

  // 3. Confirmación (HeadObject en el servidor).
  const resConfirmar = await fetch(
    `/api/sesion-clinica/${sesionClinicaId}/upload-confirmar`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: subida.key,
        duracionAudioSeg: datos.duracionSegundos,
      }),
    },
  );
  if (!resConfirmar.ok) {
    throw new ErrorSubida(
      await parseError(resConfirmar),
      "confirmar",
      resConfirmar.status,
    );
  }
  const body = (await resConfirmar.json()) as { data: RawSesionClinica };
  return body.data;
}

/**
 * Tras un fallo en el paso 2 o 3, la sesión puede haber quedado en
 * "subiendo". Se consulta el estado real y, solo si es "subiendo", se la
 * vuelve a "grabando" (transición de cliente permitida) para poder repetir
 * desde upload-url. Best-effort: si esto falla, el próximo intento de
 * upload-url responde 409 con la instrucción.
 */
async function volverAGrabando(sesionClinicaId: string): Promise<void> {
  try {
    const res = await fetch(`/api/sesion-clinica/${sesionClinicaId}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const body = (await res.json()) as { data: { estado?: string } | null };
    if (body.data?.estado !== "subiendo") return;
    await fetch(`/api/sesion-clinica/${sesionClinicaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "grabando" }),
    });
  } catch {
    // tragar: best-effort
  }
}

export function useGrabacionSesion({
  turno,
  onTurnoActualizado,
}: UseGrabacionSesionOptions): UseGrabacionSesionResult {
  const [sesionClinica, setSesionClinica] =
    React.useState<SesionClinicaResponse | null>(null);
  const [loading, setLoading] = React.useState<boolean>(Boolean(turno));
  const [submitting, setSubmitting] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [subidaPendiente, setSubidaPendiente] = React.useState<boolean>(false);
  const [progresoSubida, setProgresoSubida] = React.useState<number | null>(
    null,
  );

  // Último blob cifrado cuya subida no se completó. Vive solo en memoria de
  // esta pestaña; los chunks sin cifrar siguen en IndexedDB (no se borran
  // hasta que la confirmación responde OK).
  const ultimoAudioRef = React.useRef<DatosGrabacion | null>(null);

  const turnoId = turno?.id ?? null;
  const turnoEstado = turno?.estado ?? null;
  const onTurnoActualizadoRef = React.useRef(onTurnoActualizado);
  React.useEffect(() => {
    onTurnoActualizadoRef.current = onTurnoActualizado;
  }, [onTurnoActualizado]);

  React.useEffect(() => {
    if (!turnoId) {
      setSesionClinica(null);
      setLoading(false);
      return;
    }
    let cancelado = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/sesion-clinica?turnoId=${turnoId}`, {
          cache: "no-store",
        });
        if (cancelado) return;
        if (res.ok) {
          const body = (await res.json()) as { data: RawSesionClinica | null };
          setSesionClinica(
            body.data ? toSesionClinicaResponse(body.data) : null,
          );
        } else {
          setSesionClinica(null);
        }
      } catch {
        if (!cancelado) setSesionClinica(null);
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [turnoId]);

  const enProcesamiento =
    sesionClinica !== null &&
    (sesionClinica.estado === "grabando" ||
      sesionClinica.estado === "subiendo" ||
      sesionClinica.estado === "procesando");

  const { data: polled } = useSesionClinicaPolling({
    sesionClinicaId: enProcesamiento ? (sesionClinica?.id ?? null) : null,
    enabled: enProcesamiento,
  });

  React.useEffect(() => {
    if (polled) setSesionClinica(polled);
  }, [polled]);

  const iniciar = React.useCallback(async () => {
    if (!turnoId) return;
    setError(null);
    setSubmitting(true);
    try {
      const createRes = await fetch("/api/sesion-clinica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnoId }),
      });
      if (!createRes.ok) throw new Error(await parseError(createRes));
      const createBody = (await createRes.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(createBody.data));

      const patchRes = await fetch(
        `/api/sesion-clinica/${createBody.data.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: "grabando" }),
        },
      );
      if (!patchRes.ok) throw new Error(await parseError(patchRes));
      const patchBody = (await patchRes.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(patchBody.data));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo iniciar la grabación",
      );
    } finally {
      setSubmitting(false);
    }
  }, [turnoId]);

  const completar = React.useCallback(
    async (datos: DatosGrabacion) => {
      const current = sesionClinica;
      if (!current || !turnoId) return;
      const sesionId = current.id;
      const eraProgramado = turnoEstado === "programado";
      ultimoAudioRef.current = datos;
      setError(null);
      setSubmitting(true);
      setProgresoSubida(null);
      try {
        const actualizada = await subirAudioCifrado(sesionId, datos, (p) =>
          setProgresoSubida(p),
        );
        setSesionClinica(toSesionClinicaResponse(actualizada));

        // Confirmación OK: recién ahora el backup incremental en IndexedDB
        // deja de hacer falta (GrabadorSesion lo persiste con el turnoId
        // como clave; fire-and-forget).
        ultimoAudioRef.current = null;
        setSubidaPendiente(false);
        void limpiarGrabacion(turnoId);

        if (eraProgramado) {
          try {
            await fetch(`/api/turnos/${turnoId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ estado: "realizado" }),
            });
          } catch {
            // best-effort
          }
          onTurnoActualizadoRef.current?.();
        }
      } catch (err) {
        // Nada se borra: el blob cifrado queda en memoria y los chunks en
        // IndexedDB. La sesión vuelve a "grabando" para repetir desde el
        // paso 1 con el mismo blob ("Reintentar subida").
        const mensaje =
          err instanceof Error ? err.message : "Error al subir el audio";
        setError(mensaje);
        setSubidaPendiente(true);
        const paso = err instanceof ErrorSubida ? err.paso : "put";
        if (paso !== "url") {
          await volverAGrabando(sesionId);
        }
      } finally {
        setProgresoSubida(null);
        setSubmitting(false);
      }
    },
    [sesionClinica, turnoId, turnoEstado],
  );

  const reintentarSubida = React.useCallback(async () => {
    const datos = ultimoAudioRef.current;
    if (!datos) {
      setError(
        "No queda un audio cifrado en memoria para reenviar. Si la grabación quedó guardada en el dispositivo, el grabador la ofrece al volver a entrar.",
      );
      return;
    }
    await completar(datos);
  }, [completar]);

  const reintentar = React.useCallback(async () => {
    if (!sesionClinica) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinica.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado: "procesando" }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      const body = (await res.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(body.data));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo reintentar",
      );
    } finally {
      setSubmitting(false);
    }
  }, [sesionClinica]);

  const refrescar = React.useCallback(async () => {
    if (!sesionClinica) return;
    try {
      const res = await fetch(`/api/sesion-clinica/${sesionClinica.id}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { data: RawSesionClinica };
      setSesionClinica(toSesionClinicaResponse(body.data));
      onTurnoActualizadoRef.current?.();
    } catch {
      // tragar
    }
  }, [sesionClinica]);

  return {
    sesionClinica,
    loading,
    submitting,
    error,
    subidaPendiente,
    progresoSubida,
    iniciar,
    completar,
    reintentarSubida,
    reintentar,
    refrescar,
  };
}
