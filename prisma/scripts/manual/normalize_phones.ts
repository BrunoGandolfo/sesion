/**
 * Migración manual: normalizar teléfonos existentes a E.164.
 *
 * Uso:
 *   npx tsx prisma/migrations/manual/normalize_phones.ts
 *
 * - Idempotente: correrlo dos veces no cambia nada la segunda vez.
 * - Reversible: antes de tocar la base escribe un backup JSON con los
 *   valores originales en prisma/migrations/manual/phones_backup_<fecha>.json.
 *
 * La lógica de normalización se replica acá (no se importa desde src/)
 * para que el script corra standalone con tsx/ts-node.
 */

import { PrismaClient } from "@prisma/client";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ───────────────────────────────────────────────────────────
// Lógica de normalización (copia de src/lib/phone.ts)
// ───────────────────────────────────────────────────────────

const E164_RE = /^\+[1-9]\d{6,14}$/;

function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");

  let candidate: string;
  if (cleaned.startsWith("+")) {
    candidate = cleaned;
  } else if (cleaned.startsWith("0")) {
    candidate = `+598${cleaned.slice(1)}`;
  } else {
    throw new Error("formato inválido");
  }

  if (!E164_RE.test(candidate)) {
    throw new Error("formato inválido");
  }

  return candidate;
}

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

function hoyYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function ahoraHHMMSS(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

// ───────────────────────────────────────────────────────────
// Script principal
// ───────────────────────────────────────────────────────────

type Resultado =
  | { id: string; original: string; normalizado: string; cambio: true }
  | { id: string; original: string; normalizado: string; cambio: false }
  | { id: string; original: string; error: string };

async function main() {
  const prisma = new PrismaClient();

  try {
    const pacientes = await prisma.paciente.findMany({
      select: { id: true, nombre: true, apellido: true, telefono: true },
    });

    console.log(`→ Encontrados ${pacientes.length} pacientes.\n`);

    if (pacientes.length === 0) {
      console.log("No hay pacientes para procesar. Salgo.");
      return;
    }

    // Backup de los valores originales antes de tocar nada.
    // Nombre base: phones_backup_YYYYMMDD.json. Si ya existe (corrida previa
    // el mismo día) agrego sufijo HHMMSS para no pisarlo.
    const dir = join(process.cwd(), "prisma", "migrations", "manual");
    const baseName = `phones_backup_${hoyYYYYMMDD()}`;
    let backupPath = join(dir, `${baseName}.json`);
    if (existsSync(backupPath)) {
      backupPath = join(dir, `${baseName}-${ahoraHHMMSS()}.json`);
    }

    const backup = pacientes.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      apellido: p.apellido,
      telefono: p.telefono,
    }));
    writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
    console.log(`→ Backup escrito en: ${backupPath}\n`);

    const resultados: Resultado[] = [];

    for (const p of pacientes) {
      const original = p.telefono;

      let normalizado: string;
      try {
        normalizado = normalizePhone(original);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(
          `[ERROR] ${p.id} (${p.nombre} ${p.apellido}) → "${original}" no se pudo normalizar: ${msg}`,
        );
        resultados.push({ id: p.id, original, error: msg });
        continue;
      }

      if (normalizado === original) {
        console.log(
          `[OK]    ${p.id} (${p.nombre} ${p.apellido}) → "${original}" ya estaba normalizado.`,
        );
        resultados.push({ id: p.id, original, normalizado, cambio: false });
        continue;
      }

      try {
        await prisma.paciente.update({
          where: { id: p.id },
          data: { telefono: normalizado },
        });
        console.log(
          `[UPD]   ${p.id} (${p.nombre} ${p.apellido}) → "${original}" ⇒ "${normalizado}"`,
        );
        resultados.push({ id: p.id, original, normalizado, cambio: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(
          `[ERROR] ${p.id} (${p.nombre} ${p.apellido}) → fallo al actualizar: ${msg}`,
        );
        resultados.push({ id: p.id, original, error: msg });
      }
    }

    // Resumen
    const total = resultados.length;
    const cambiados = resultados.filter(
      (r): r is Extract<Resultado, { cambio: true }> =>
        "cambio" in r && r.cambio === true,
    ).length;
    const sinCambios = resultados.filter(
      (r): r is Extract<Resultado, { cambio: false }> =>
        "cambio" in r && r.cambio === false,
    ).length;
    const errores = resultados.filter(
      (r): r is Extract<Resultado, { error: string }> => "error" in r,
    ).length;

    console.log("\n─────────────────────────────");
    console.log("Resumen:");
    console.log(`  Total procesados : ${total}`);
    console.log(`  Actualizados     : ${cambiados}`);
    console.log(`  Sin cambios      : ${sinCambios}`);
    console.log(`  Errores          : ${errores}`);
    console.log(`  Backup           : ${backupPath}`);
    console.log("─────────────────────────────");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fallo no controlado:", err);
  process.exit(1);
});
