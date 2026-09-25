import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// ESLint ya trae este parser en el lockfile; no se agregan dependencias.
const { load } = createRequire(import.meta.url)("js-yaml") as {
  load: (texto: string) => Workflow;
};
type Paso = {
  name?: string; uses?: string; run?: string; if?: string;
  env?: Record<string, string>; with?: Record<string, unknown>;
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; steps: Paso[] }>;
};
const leer = (archivo: string) =>
  load(readFileSync(resolve(".github/workflows", archivo), "utf8"));
const publicar = leer("publicar.yml");
const pasos = publicar.jobs.publicar.steps;
const paso = (nombre: string) => {
  const encontrado = pasos.find((p) => p.name === nombre);
  if (!encontrado) throw new Error("Falta el paso: " + nombre);
  return encontrado;
};

describe("publicación manual", () => {
  it("sólo acepta un pedido manual con SHA obligatorio y usa ese SHA", () => {
    expect(publicar.on).toEqual({
      workflow_dispatch: { inputs: { sha: {
        description: "SHA completo de main que pasó CI",
        required: true, type: "string",
      } } },
    });
    expect(pasos[0].with?.ref).toBe("${{ inputs.sha }}");
    expect(paso("Verificar SHA y CI").env?.SHA).toBe("${{ inputs.sha }}");
    expect(paso("Avanzar release (fast-forward, sin force)").env?.SHA)
      .toBe("${{ inputs.sha }}");
  });

  it("valida antes de migrar y conserva migraciones, fast-forward y aviso de error", () => {
    const posicion = (nombre: string) => pasos.findIndex((p) => p.name === nombre);
    expect(posicion("Verificar SHA y CI")).toBeLessThan(posicion("Verificar secrets"));
    expect(posicion("Verificar secrets")).toBeLessThan(posicion("Aplicar migraciones a producción"));
    expect(posicion("Aplicar migraciones a producción"))
      .toBeLessThan(posicion("Avanzar release (fast-forward, sin force)"));
    expect(paso("Aplicar migraciones a producción").run).toBe("npx prisma migrate deploy");
    expect(paso("Aplicar migraciones a producción").env?.DATABASE_URL)
      .toBe("${{ secrets.DATABASE_URL_PRODUCCION_DIRECTA }}");
    expect(paso("Avanzar release (fast-forward, sin force)").run)
      .toContain('git push origin "${SHA}:refs/heads/release"');
    expect(paso("Avanzar release (fast-forward, sin force)").run).not.toMatch(/--force|\+.*refs\/heads/);
    const aviso = paso("Avisar si algo falló");
    expect(aviso.if).toBe("failure()");
    expect(aviso.uses).toBe("./.github/actions/alerta-correo");
    expect(aviso.env?.RESEND_API_KEY).toBe("${{ secrets.RESEND_API_KEY }}");
  });

  it("conserva el aviso automático de CI rojo sin acceso para publicar", () => {
    const aviso = leer("avisar-ci.yml");
    expect(aviso.on).toEqual({
      workflow_run: { workflows: ["CI"], types: ["completed"], branches: ["main"] },
    });
    expect(aviso.permissions).toEqual({ contents: "read" });
    expect(aviso.jobs["ci-rojo"].if).toContain("conclusion == 'failure'");
    expect(aviso.jobs["ci-rojo"].if).toContain("event == 'push'");
    expect(aviso.jobs["ci-rojo"].steps.map((p) => p.uses))
      .toEqual(["actions/checkout@v7", "./.github/actions/alerta-correo"]);
    expect(JSON.stringify(aviso)).not.toMatch(/DATABASE_URL|git push|migrate/);
  });
});

describe("guarda ejecutable previa a las migraciones", () => {
  let carpeta: string;
  let base: string;
  let elegido: string;
  let ajeno: string;
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: carpeta, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();

  beforeAll(() => {
    carpeta = mkdtempSync(join(tmpdir(), "sesion-publicar-test-"));
    git("init", "--quiet");
    git("config", "user.name", "Prueba local");
    git("config", "user.email", "prueba@example.invalid");
    git("commit", "--allow-empty", "-qm", "Base");
    base = git("rev-parse", "HEAD");
    git("commit", "--allow-empty", "-qm", "Elegido");
    elegido = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", elegido);
    git("update-ref", "refs/remotes/origin/release", base);
    git("checkout", "--detach", base);
    git("commit", "--allow-empty", "-qm", "Fuera de main");
    ajeno = git("rev-parse", "HEAD");
    git("checkout", "--detach", elegido);
    mkdirSync(join(carpeta, "bin"));
    // Sólo se sustituye la API de GitHub. Los commits y la ascendencia son reales.
    writeFileSync(join(carpeta, "bin/gh"), [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "for (const arg of ['api', 'head_sha=' + process.env.SHA, 'event=push', 'branch=main', 'per_page=1']) {",
      "  if (!args.includes(arg)) process.exit(3);",
      "}",
      "if (process.env.API_CAIDA) process.exit(1);",
      "process.stdout.write(process.env.CI_RESULTADO || '');",
    ].join("\n"), { mode: 0o755 });
  });
  afterAll(() => { if (carpeta) rmSync(carpeta, { recursive: true, force: true }); });
  const ejecutar = (env: Record<string, string> = {}) => spawnSync(
    "bash", ["-c", paso("Verificar SHA y CI").run!], {
      cwd: carpeta, encoding: "utf8",
      env: {
        ...process.env, PATH: join(carpeta, "bin") + ":" + process.env.PATH,
        GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "prueba/local",
        SHA: elegido, CI_RESULTADO: elegido + "\tcompleted\tsuccess", ...env,
      },
    },
  );

  it("acepta el SHA exacto, con CI verde y release antecesora", () => {
    expect(ejecutar().status).toBe(0);
  });
  it.each<[string, Record<string, string>]>([
    ["abreviado", { SHA: "123abc" }],
    ["expresión de shell", { SHA: "$(exit 0)" }],
    ["workflow desde otra rama", { GITHUB_REF: "refs/heads/release" }],
    ["sin corrida", { CI_RESULTADO: "" }],
    ["CI rojo", { CI_RESULTADO: "ELEGIDO\tcompleted\tfailure" }],
    ["CI todavía corriendo", { CI_RESULTADO: "ELEGIDO\tin_progress\t" }],
    ["otro SHA verde", { CI_RESULTADO: "f".repeat(40) + "\tcompleted\tsuccess" }],
    ["API caída", { API_CAIDA: "1" }],
  ])("rechaza %s antes de migrar", (_nombre, cambios) => {
    const env = Object.fromEntries(Object.entries(cambios)
      .map(([k, v]) => [k, v.replace("ELEGIDO", elegido)]));
    expect(ejecutar(env).status).not.toBe(0);
  });
  it("rechaza un checkout que no corresponde al pedido", () => {
    expect(ejecutar({ SHA: base }).stderr).toContain("checkout no coincide");
  });
  it("rechaza un commit fuera de main", () => {
    git("checkout", "--detach", ajeno);
    try {
      expect(ejecutar({ SHA: ajeno }).stderr).toContain("SHA no pertenece a main");
    } finally { git("checkout", "--detach", elegido); }
  });
  it("rechaza release divergida antes de aplicar migraciones", () => {
    git("update-ref", "refs/remotes/origin/release", ajeno);
    try {
      expect(ejecutar().stderr).toContain("release no es antecesora");
    } finally { git("update-ref", "refs/remotes/origin/release", base); }
  });
  it.each(["", "postgresql://usuario:prueba@host-pooler/base"])(
    "conserva el rechazo de la conexión vacía o del pooler (%s)", (url) => {
      const resultado = spawnSync("bash", ["-c", paso("Verificar secrets").run!], {
        encoding: "utf8", env: { ...process.env, DATABASE_URL_PRODUCCION_DIRECTA: url },
      });
      expect(resultado.status).not.toBe(0);
    },
  );
});
