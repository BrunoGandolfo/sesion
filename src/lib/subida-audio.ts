// Cliente de la subida del audio: lo que pasa entre que el grabador entrega
// el Blob y la sesión queda "procesando", más las dos llamadas que la
// pantalla de grabar hace alrededor (volver a "grabando" tras un fallo y
// marcar el turno como realizado). Sin React: se prueba con dobles de
// `fetch` y de `XMLHttpRequest` (src/lib/__tests__/grabacion-subida.test.ts).
//
// Subida directa a R2 en tres pasos. El audio NUNCA pasa por Vercel: el
// límite de 4,5 MB por request de las funciones hacía fallar toda sesión
// real con 413.
//
//   1. POST [id]/upload-url       → { url, key, headers }  (grabando → subiendo)
//      El audio va tal cual: la app no lo cifra.
//   2. PUT  url (XHR, con progreso) → R2
//   3. POST [id]/upload-confirmar → fila actualizada       (subiendo → procesando)

import type { DatosGrabacion } from "@/components/grabacion/GrabadorSesion";
import type { SesionClinicaApi, SesionClinicaApiBase } from "@/hooks/useSesionClinicaPolling";
import { ApiClientError, apiGet, apiPatch, apiPost, mensajeParaElla } from "@/lib/api-client";

type PasoSubida = "url" | "put" | "confirmar";

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

interface UrlSubida {
  url: string;
  key: string;
  expiraEn: string;
  headers: Record<string, string>;
}

/** Un paso de la API con su nombre: la respuesta no-ok sale como
 *  ErrorSubida con el `error` de la API (o un texto para ella) y el status.
 *  El error de red de `fetch` se propaga tal cual. */
async function paso<T>(nombre: PasoSubida, pedido: Promise<T>): Promise<T> {
  try {
    return await pedido;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw new ErrorSubida(mensajeParaElla(error), nombre, error.status);
    }
    throw error;
  }
}

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

export async function subirAudio(
  sesionClinicaId: string,
  datos: DatosGrabacion,
  onProgreso?: (porcentaje: number) => void,
): Promise<SesionClinicaApiBase> {
  const mime = datos.audioBlob.type || "audio/webm";

  // 1. URL prefirmada.
  const subida = await paso(
    "url",
    apiPost<UrlSubida>(`/api/sesion-clinica/${sesionClinicaId}/upload-url`, {
      tamanoBytes: datos.audioBlob.size,
      mime,
    }),
  );

  // 2. PUT directo a R2. El Blob va tal cual: es un Blob de Blobs respaldado
  // en disco, y el navegador lo lee de a tramos mientras lo envía. Pasarlo por
  // arrayBuffer() lo copiaría entero a memoria (~120 MB en dos horas).
  onProgreso?.(0);
  await putConProgreso(subida.url, datos.audioBlob, subida.headers, onProgreso);
  onProgreso?.(100);

  // Solo las pausas cerradas. Una pausa sin `fin` es una grabación todavía
  // detenida: no describe ningún tramo y el schema del backend la rechaza.
  const pausas = (datos.pausas ?? []).filter((pausa) => pausa.inicio && pausa.fin);

  // 3. Confirmación (HeadObject en el servidor).
  return paso(
    "confirmar",
    apiPost<SesionClinicaApiBase>(`/api/sesion-clinica/${sesionClinicaId}/upload-confirmar`, {
      key: subida.key,
      duracionAudioSeg: datos.duracionSegundos,
      // Sin pausas el campo se omite: el backend deja la columna como
      // estaba, así un reintento de la misma subida no borra lo anterior.
      ...(pausas.length > 0 ? { pausas } : {}),
      diagnostico: datos.diagnostico,
    }),
  );
}

/**
 * Tras un fallo en el paso 2 o 3, la sesión puede haber quedado en
 * "subiendo". Se consulta el estado real y, solo si es "subiendo", se la
 * vuelve a "grabando" (POST [id]/volver-a-grabar, la ruta con nombre de esa
 * transición) para poder repetir desde upload-url. Best-effort: si esto falla, el próximo intento de
 * upload-url responde 409 con la instrucción.
 */
export async function volverAGrabando(sesionClinicaId: string): Promise<void> {
  try {
    const fila = await apiGet<Pick<SesionClinicaApi, "estado"> | null>(
      `/api/sesion-clinica/${sesionClinicaId}`,
    );
    if (fila?.estado !== "subiendo") return;
    await apiPost(`/api/sesion-clinica/${sesionClinicaId}/volver-a-grabar`, undefined);
  } catch {
    // tragar: best-effort
  }
}

/**
 * El turno pasa a "realizado" una vez que el audio ya está a salvo en R2.
 *
 * NO es best-effort: si esto falla, el turno queda como "Agendado" y la
 * pantalla de grabar tiene que decirlo y ofrecer reintentar. Antes el error
 * se tragaba con un `catch {}` vacío y el turno se quedaba mal para siempre
 * sin que nadie se enterara — la nota llegaba igual, así que no había ni un
 * síntoma que hiciera sospechar.
 *
 * Lanza ApiClientError con el mensaje de la API (o uno genérico) si la
 * respuesta no es 2xx; el error de red de `fetch` se propaga tal cual.
 */
export async function marcarTurnoRealizado(turnoId: string): Promise<void> {
  await apiPatch(`/api/turnos/${turnoId}`, { estado: "realizado" });
}
