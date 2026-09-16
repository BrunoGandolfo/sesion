import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { generarTextoConsentimiento } from "@/lib/consentimiento";
import { RETENCION_BACKUPS_DIAS, RETENCION_BACKUPS_MENSUALES_DIAS, RETENCION_BACKUPS_MENSUALES_MESES } from "@/lib/consentimiento-hechos";

const { load } = createRequire(import.meta.url)("js-yaml") as {
  load: (s: string) => { jobs: { backup: { steps: { run?: string }[] } } };
};

it("la limpieza real de respaldos usa los dos plazos declarados a la paciente", () => {
  const pasos = load(readFileSync(".github/workflows/backup.yml", "utf8")).jobs.backup.steps;
  const limpieza = pasos.find(p => p.run?.includes("borrar_anteriores_a()"))?.run;
  expect(limpieza, "No se encontró la limpieza de respaldos: revisar el consentimiento").toBeTruthy();
  const carpeta = mkdtempSync(join(tmpdir(), "consentimiento-retencion-"));
  try {
    // Se ejecuta el shell del workflow: nunca aws real, ni credenciales, ni R2.
    // La fecha fija evita que cruzar un segundo cambie el resultado.
    const dobles = `
date() {
  [[ "$1" = "-u" && "$2" = "-d" ]] || return 64
  command date -u -d "2026-09-16T12:00:00Z $3" "$4"
}
aws() {
  [[ "$1 $2" = "s3api list-objects-v2" ]] || return 64
  printf '%s\\n' "$*" >> "$LISTADOS"
  printf 'None'
}
`;
    const resultado = spawnSync("bash", ["-c", dobles + limpieza], {
      cwd: carpeta, encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH, LISTADOS: join(carpeta, "listados"), R2_BUCKET: "prueba", R2_ENDPOINT: "https://r2.invalid" },
    });
    expect(resultado.status, resultado.stderr).toBe(0);
    const listados = readFileSync(join(carpeta, "listados"), "utf8").trim().split("\n");
    expect(listados).toHaveLength(2);
    for (const [indice, prefijo, dias] of [
      [0, "backups/sesion-backup-", RETENCION_BACKUPS_DIAS],
      [1, "backups/mensuales/", RETENCION_BACKUPS_MENSUALES_DIAS],
    ] as const) {
      const fecha = spawnSync("date", ["-u", "-d", `2026-09-16T12:00:00Z ${dias} days ago`, "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" });
      expect(fecha.status).toBe(0);
      expect(listados[indice]).toContain(`--prefix ${prefijo} `);
      expect(listados[indice]).toContain(`Contents[?LastModified<'${fecha.stdout.trim()}'].Key`);
    }
    // 366 días es la implementación de los 12 meses informados.
    expect([RETENCION_BACKUPS_MENSUALES_DIAS, RETENCION_BACKUPS_MENSUALES_MESES]).toEqual([366, 12]);
    const texto = generarTextoConsentimiento({ nombrePaciente: "Ana", nombreProfesional: "Lic. Prueba", direccionConsultorio: "Consultorio" });
    expect(texto).toContain(`se guardan ${RETENCION_BACKUPS_DIAS} días si son diarias y hasta ${RETENCION_BACKUPS_MENSUALES_MESES} meses si son mensuales`);
    expect(texto).toContain(`Esa clave puede conservarse hasta ${RETENCION_BACKUPS_MENSUALES_MESES} meses`);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});
