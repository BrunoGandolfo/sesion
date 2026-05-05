/**
 * scripts/migrate-encrypt-existing-notas.ts
 *
 * Cifra las notas clínicas existentes en SesionClinica:
 *   - transcripcion          → transcripcion_encrypted          (string crudo)
 *   - nota{Subjetivo,Objetivo,Analisis,Plan}
 *                            → nota_soap_encrypted              (JSON.stringify({S,O,A,P}))
 *   - datosEstructurados     → datos_estructurados_encrypted    (string crudo)
 *   - notasEdicion           → notas_edicion_encrypted          (string crudo)
 *
 * Cifrado: delega en src/lib/encryption.ts (Agente 2). Algoritmo, magic
 * prefix y formato del blob ahí definidos. La clave se carga una sola vez
 * al inicio vía `validateKey()`.
 *
 * Idempotente: si una columna ya empieza con MAGIC_PREFIX, se salta.
 *
 * Uso:
 *   NOTES_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
 *   DATABASE_URL="postgres://..." \
 *   npx tsx scripts/migrate-encrypt-existing-notas.ts
 */

import { PrismaClient } from "@prisma/client";
import { encrypt, isEncrypted, validateKey } from "../src/lib/encryption";

const BATCH_SIZE = 50;

type Stats = {
  total: number;
  processed: number;
  alreadyEncrypted: number;
  failed: number;
  errors: { id: string; error: string }[];
};

/**
 * Prisma 5 devuelve columnas Bytes? como Uint8Array (no Buffer). El módulo
 * de cifrado expone isEncrypted con check Buffer.isBuffer, así que
 * envolvemos en Buffer.from antes de delegar.
 */
function alreadyEncrypted(buf: Uint8Array | null): boolean {
  if (buf === null) return false;
  return isEncrypted(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
}

type Row = {
  id: string;
  transcripcion: string | null;
  notaSubjetivo: string | null;
  notaObjetivo: string | null;
  notaAnalisis: string | null;
  notaPlan: string | null;
  datosEstructurados: string | null;
  notasEdicion: string | null;
  transcripcionEncrypted: Uint8Array | null;
  notaSoapEncrypted: Uint8Array | null;
  datosEstructuradosEncrypted: Uint8Array | null;
  notasEdicionEncrypted: Uint8Array | null;
};

type RowUpdate = {
  transcripcionEncrypted?: Buffer;
  notaSoapEncrypted?: Buffer;
  datosEstructuradosEncrypted?: Buffer;
  notasEdicionEncrypted?: Buffer;
};

function buildUpdate(row: Row): RowUpdate | null {
  const update: RowUpdate = {};

  // Transcripción: 1:1 con la columna legacy.
  if (row.transcripcion !== null && !alreadyEncrypted(row.transcripcionEncrypted)) {
    update.transcripcionEncrypted = encrypt(row.transcripcion);
  }

  // SOAP: consolida 4 columnas legacy en un único JSON. Solo cifra si al
  // menos una de las 4 tiene contenido.
  const algunSoap =
    row.notaSubjetivo !== null ||
    row.notaObjetivo !== null ||
    row.notaAnalisis !== null ||
    row.notaPlan !== null;
  if (algunSoap && !alreadyEncrypted(row.notaSoapEncrypted)) {
    const soap = JSON.stringify({
      subjetivo: row.notaSubjetivo,
      objetivo: row.notaObjetivo,
      analisis: row.notaAnalisis,
      plan: row.notaPlan,
    });
    update.notaSoapEncrypted = encrypt(soap);
  }

  // Datos estructurados: ya viene como string JSON; se cifra tal cual.
  if (
    row.datosEstructurados !== null &&
    !alreadyEncrypted(row.datosEstructuradosEncrypted)
  ) {
    update.datosEstructuradosEncrypted = encrypt(row.datosEstructurados);
  }

  // Ediciones manuales de la profesional: string plano, sin JSON wrapper.
  if (
    row.notasEdicion !== null &&
    !alreadyEncrypted(row.notasEdicionEncrypted)
  ) {
    update.notasEdicionEncrypted = encrypt(row.notasEdicion);
  }

  return Object.keys(update).length > 0 ? update : null;
}

async function run(): Promise<number> {
  console.log("[encrypt-notas] iniciando…");
  validateKey(); // Falla rápido si NOTES_ENCRYPTION_KEY no existe / no es 32B base64.
  const prisma = new PrismaClient();
  const stats: Stats = {
    total: 0,
    processed: 0,
    alreadyEncrypted: 0,
    failed: 0,
    errors: [],
  };

  try {
    const candidates = await prisma.sesionClinica.findMany({
      where: {
        OR: [
          { transcripcion: { not: null } },
          { notaSubjetivo: { not: null } },
          { notaObjetivo: { not: null } },
          { notaAnalisis: { not: null } },
          { notaPlan: { not: null } },
          { datosEstructurados: { not: null } },
          { notasEdicion: { not: null } },
        ],
      },
      select: {
        id: true,
        transcripcion: true,
        notaSubjetivo: true,
        notaObjetivo: true,
        notaAnalisis: true,
        notaPlan: true,
        datosEstructurados: true,
        notasEdicion: true,
        transcripcionEncrypted: true,
        notaSoapEncrypted: true,
        datosEstructuradosEncrypted: true,
        notasEdicionEncrypted: true,
      },
    });

    stats.total = candidates.length;
    console.log(`[encrypt-notas] filas candidatas: ${stats.total}`);

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      const ops: { id: string; data: RowUpdate }[] = [];

      for (const row of batch) {
        try {
          const update = buildUpdate(row);
          if (update === null) {
            stats.alreadyEncrypted++;
          } else {
            ops.push({ id: row.id, data: update });
          }
        } catch (err) {
          stats.failed++;
          stats.errors.push({
            id: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (ops.length > 0) {
        try {
          await prisma.$transaction(
            ops.map((op) =>
              prisma.sesionClinica.update({
                where: { id: op.id },
                data: op.data,
              }),
            ),
          );
          stats.processed += ops.length;
        } catch (err) {
          // El lote falló como un todo: lo contabilizamos como fallidos.
          for (const op of ops) {
            stats.failed++;
            stats.errors.push({
              id: op.id,
              error:
                "tx batch failed: " +
                (err instanceof Error ? err.message : String(err)),
            });
          }
        }
      }

      console.log(
        `[encrypt-notas] avance: ${Math.min(i + BATCH_SIZE, candidates.length)}/${candidates.length}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("[encrypt-notas] resumen:");
  console.log(`  total candidatas .... ${stats.total}`);
  console.log(`  procesadas .......... ${stats.processed}`);
  console.log(`  ya cifradas (skip) .. ${stats.alreadyEncrypted}`);
  console.log(`  fallidas ............ ${stats.failed}`);
  if (stats.errors.length > 0) {
    console.log("[encrypt-notas] errores:");
    for (const e of stats.errors) {
      console.log(`  - ${e.id}: ${e.error}`);
    }
  }

  return stats.failed === 0 ? 0 : 1;
}

run()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error("[encrypt-notas] error fatal:", err);
    process.exit(1);
  });
