import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

interface R2Cliente {
  cliente: S3Client;
  bucket: string;
}

interface AudioMetadata {
  iv: string;
  claveId: string;
}

function leerConfig(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

let clienteSingleton: R2Cliente | null = null;

function obtenerCliente(): R2Cliente {
  if (clienteSingleton) return clienteSingleton;

  const config = leerConfig();
  if (!config) {
    throw new Error(
      "R2 no está configurado: faltan R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY o R2_BUCKET_NAME",
    );
  }

  const cliente = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  clienteSingleton = { cliente, bucket: config.bucketName };
  return clienteSingleton;
}

/**
 * Devuelve true si todas las env vars de R2 están presentes.
 * Permite que la app arranque en desarrollo sin credenciales.
 */
export function r2Configurado(): boolean {
  return leerConfig() !== null;
}

/**
 * Sube audio cifrado a R2.
 * Sólo el IV y el identificador de la clave (claveId) se guardan como
 * metadata del objeto. La clave de cifrado real vive en la DB.
 *
 * @param key - identificador único (ej: "audio/{sesionClinicaId}.enc")
 * @param data - Buffer con el audio cifrado
 * @param metadata - iv y claveId (referencia a la clave en DB)
 * @returns la key del objeto subido
 */
export async function subirAudioCifrado(
  key: string,
  data: Buffer,
  metadata: AudioMetadata,
): Promise<string> {
  const { cliente, bucket } = obtenerCliente();

  try {
    await cliente.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: "application/octet-stream",
        // S3 normaliza nombres de metadata a minúsculas. Usamos minúsculas
        // explícitas para evitar sorpresas al leer.
        Metadata: {
          iv: metadata.iv,
          claveid: metadata.claveId,
        },
      }),
    );
    return key;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo subir el audio a R2 (${key}): ${msg}`);
  }
}

/**
 * Descarga audio cifrado de R2 junto con su metadata (iv, claveId).
 */
export async function descargarAudioCifrado(
  key: string,
): Promise<{ data: Buffer; metadata: AudioMetadata }> {
  const { cliente, bucket } = obtenerCliente();

  try {
    const response = await cliente.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error("respuesta vacía de R2");
    }

    const bytes = await response.Body.transformToByteArray();
    const data = Buffer.from(bytes);

    const meta = response.Metadata ?? {};
    const iv = meta.iv;
    const claveId = meta.claveid ?? meta.claveId;

    if (!iv || !claveId) {
      throw new Error("metadata incompleta en el objeto R2 (faltan iv o claveId)");
    }

    return { data, metadata: { iv, claveId } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo descargar el audio de R2 (${key}): ${msg}`);
  }
}

/**
 * Borra un audio de R2 (después de procesar exitosamente).
 */
export async function borrarAudio(key: string): Promise<void> {
  const { cliente, bucket } = obtenerCliente();

  try {
    await cliente.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`No se pudo borrar el audio de R2 (${key}): ${msg}`);
  }
}
