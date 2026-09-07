// Capturas de la app para la auditoría de diseño (docs/diseno/01).
//
// SOLO LECTURA. Este script no toca ningún botón que escriba en la base:
// no aprueba, no descarta, no cobra, no elimina, no archiva, no graba, no
// reintenta, no guarda y no marca la casilla "Revisé esta señal".
// Lo único que "acciona" son controles de presentación —pestañas, plegables,
// el desplegable del mes— y la apertura de sheets, que sólo cambian estado
// local de React (dashboard.tsx:151, turno-detail-sheet.tsx:145) y se cierran
// con Escape sin confirmar nada.
//
// Uso:
//   SESION_EMAIL=… SESION_PASSWORD=… \
//     npx -y -p playwright@latest node docs/diseno/capturas/tomar-capturas.mjs
//
//   SESION_CERRAR=1 para cerrar sesión al terminar (la corrida final).
//
// Las credenciales SÓLO llegan por variables de entorno. Nunca se escriben acá
// ni se imprimen. La sesión iniciada se guarda fuera del repo, en el
// scratchpad, para que ninguna corrida posterior tenga que volver a entrar:
// cinco intentos fallidos bloquean la cuenta 15 minutos, así que el login
// ocurre una sola vez y sólo si no hay sesión guardada.

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Resolver playwright ─────────────────────────────────────────────────────
// El paquete no está en el proyecto (no se agregan dependencias). Con
// `npx -p playwright@latest node …` el módulo queda en la caché de npx y node
// no lo encuentra por resolución normal: se busca ahí.
function cargarPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    /* sigue abajo */
  }
  const cache = path.join(os.homedir(), ".npm", "_npx");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      const candidato = path.join(cache, dir, "node_modules", "playwright");
      if (existsSync(candidato)) {
        return createRequire(
          path.join(cache, dir, "node_modules", "resolucion.js"),
        )("playwright");
      }
    }
  }
  throw new Error(
    "No se encontró playwright. Corré:\n" +
      "  SESION_EMAIL=… SESION_PASSWORD=… npx -y -p playwright@latest node docs/diseno/capturas/tomar-capturas.mjs",
  );
}

const { chromium } = cargarPlaywright();

// ── Configuración ───────────────────────────────────────────────────────────
const BASE = process.env.SESION_URL ?? "https://sesion-seven.vercel.app";
const EMAIL = process.env.SESION_EMAIL;
const PASSWORD = process.env.SESION_PASSWORD;
const CERRAR_AL_FINAL = process.env.SESION_CERRAR === "1";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const ESTADO =
  process.env.SESION_ESTADO ??
  path.join(os.tmpdir(), "sesion-capturas-estado.json");

// iPhone 14.
const VIEWPORT = { width: 390, height: 844 };
const ESCALA = 2;

const PACIENTE = process.env.SESION_PACIENTE ?? "Lucia Prueba";

const reporte = { capturas: [], medidas: {}, avisos: [] };

function avisar(mensaje) {
  reporte.avisos.push(mensaje);
  console.log("· " + mensaje);
}

async function quieto(page) {
  // El movimiento de la app dura como máximo 280 ms (sheet.tsx:165) y las
  // cascadas 40 ms por ítem: 700 ms deja todo asentado sin depender de la red.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}

/**
 * El dashboard no scrollea el documento: scrollea el `main` dentro de un
 * contenedor `h-screen overflow-hidden` (layout.tsx:14-16). Con eso,
 * `fullPage` devuelve exactamente una pantalla. Acá se sueltan esos dos
 * candados —sólo en el navegador de la captura, sin tocar la app— para que
 * la captura completa sea de verdad completa.
 */
async function soltarScrollInterno(page) {
  await page.evaluate(() => {
    document.querySelectorAll("div.h-screen").forEach((el) => {
      el.style.height = "auto";
      el.style.overflow = "visible";
    });
    document.querySelectorAll("main").forEach((el) => {
      el.style.overflow = "visible";
    });
  });
  await page.waitForTimeout(300);
}

/**
 * Devuelve el layout a como estaba. Imprescindible: el dashboard navega del
 * lado del cliente (Link de Next) y el layout NO se remonta, así que un
 * estilo inline puesto para una captura se arrastra a la pantalla siguiente
 * y la deforma.
 */
async function restaurarScrollInterno(page) {
  await page.evaluate(() => {
    document.querySelectorAll("div.h-screen").forEach((el) => {
      el.style.height = "";
      el.style.overflow = "";
    });
    document.querySelectorAll("main").forEach((el) => {
      el.style.overflow = "";
    });
  });
  await page.waitForTimeout(200);
}

async function shot(page, nombre, { full = false } = {}) {
  if (full) await soltarScrollInterno(page);
  const archivo = path.join(DIR, `${nombre}.png`);
  await page.screenshot({ path: archivo, fullPage: full });
  if (full) await restaurarScrollInterno(page);
  reporte.capturas.push(path.basename(archivo));
  console.log(`  ✓ ${path.basename(archivo)}${full ? " (completa)" : ""}`);
}

/** Cuánto mide la pantalla, y cuántas pantallas de 844 px hay que scrollear. */
async function medir(page, nombre) {
  const m = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      alto: Math.max(
        main ? main.scrollHeight : 0,
        document.documentElement.scrollHeight,
      ),
      // Si esto es mayor que 390, la pantalla desborda a lo ancho de verdad.
      anchoDoc: document.documentElement.scrollWidth,
      anchoMain: main ? main.scrollWidth : null,
    };
  });
  reporte.medidas[nombre] = {
    altoPx: m.alto,
    pantallas: +(m.alto / 844).toFixed(2),
    anchoDocPx: m.anchoDoc,
    anchoMainPx: m.anchoMain,
    desbordaAlAncho: m.anchoDoc > 390 || (m.anchoMain ?? 0) > 390,
  };
  return m.alto;
}

/** Capturas pantalla por pantalla, como las ve ella al scrollear. */
async function porPantallas(page, nombre, alto) {
  const pasos = Math.min(Math.ceil(alto / VIEWPORT.height), 6);
  for (let i = 0; i < pasos; i++) {
    const y = i * VIEWPORT.height;
    await page.evaluate((top) => {
      const main = document.querySelector("main");
      if (main && main.scrollHeight > main.clientHeight) main.scrollTop = top;
      else window.scrollTo(0, top);
    }, y);
    await page.waitForTimeout(400);
    await shot(page, `${nombre}-p${i + 1}`);
  }
  await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
    window.scrollTo(0, 0);
  });
}

/** Medir + capturar por pantallas + captura completa, en un paso. */
async function pantalla(page, nombre) {
  const alto = await medir(page, nombre);
  await porPantallas(page, nombre, alto);
  await shot(page, `${nombre}-completa`, { full: true });
}

/** Click sólo si el elemento existe. Devuelve si tocó algo. */
async function tocar(page, locator, que) {
  if ((await locator.count()) === 0) {
    avisar(`No encontré ${que}: no se tocó nada.`);
    return false;
  }
  await locator.first().click();
  await page.waitForTimeout(400);
  return true;
}

async function main() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

  const navegador = await chromium.launch();
  const hayEstado = existsSync(ESTADO);

  const contexto = await navegador.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: ESCALA,
    isMobile: true,
    hasTouch: true,
    locale: "es-UY",
    timezoneId: "America/Montevideo",
    storageState: hayEstado ? ESTADO : undefined,
  });
  const page = await contexto.newPage();
  page.setDefaultTimeout(25000);

  // ── Login: una sola vez, y sólo si no hay sesión guardada ────────────────
  if (!hayEstado) {
    if (!EMAIL || !PASSWORD) {
      throw new Error(
        "Faltan SESION_EMAIL y SESION_PASSWORD en el entorno. No intento entrar a ciegas.",
      );
    }
    console.log("→ Login (único intento)");
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await quieto(page);

    const email = page.locator('input[type="email"]');
    const pass = page.locator('input[type="password"]');
    const entrar = page.locator('button[type="submit"]');

    // Verificación previa: si el formulario no es el esperado, se aborta sin
    // enviar nada. Un envío a ciegas gasta uno de los cinco intentos.
    for (const [loc, nombre] of [
      [email, "input[type=email]"],
      [pass, "input[type=password]"],
      [entrar, "button[type=submit]"],
    ]) {
      if ((await loc.count()) !== 1) {
        throw new Error(
          `El formulario de login no es el esperado (${nombre}). Aborto sin enviar: no gasto un intento.`,
        );
      }
    }

    await email.fill(EMAIL);
    await pass.fill(PASSWORD);
    await entrar.click();

    await page
      .waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 25000 })
      .catch(() => {});

    if (page.url().includes("/login")) {
      const error = await page
        .locator('[role="alert"]')
        .first()
        .textContent()
        .catch(() => null);
      throw new Error(
        `El login no entró (${error?.trim() ?? "sin mensaje"}). No reintento: quedan intentos antes del bloqueo.`,
      );
    }
    await contexto.storageState({ path: ESTADO });
    console.log("  ✓ dentro; sesión guardada fuera del repo");
  } else {
    console.log("→ Sesión ya guardada: no se vuelve a entrar");
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await quieto(page);
    if (page.url().includes("/login")) {
      rmSync(ESTADO, { force: true });
      throw new Error("La sesión guardada venció. Volvé a correr el script.");
    }
  }

  // ── 1 · Hoy ──────────────────────────────────────────────────────────────
  console.log("→ Hoy");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await quieto(page);
  await pantalla(page, "01-hoy");

  // ── 2 · Agenda ───────────────────────────────────────────────────────────
  console.log("→ Agenda");
  await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
  await quieto(page);
  await pantalla(page, "02-agenda-dia");
  // El título de la fecha despliega el mes (agenda-header.tsx:86-104).
  await tocar(
    page,
    page.locator('button[aria-controls="agenda-mes-mobile"]'),
    "el botón que despliega el mes",
  );
  await quieto(page);
  await pantalla(page, "03-agenda-mes-desplegado");

  // Sheet del turno: abrir el detalle no escribe nada (turno-detail-sheet.tsx
  // sólo hace setDetalleId y dos GET).
  const filaTurno = page.locator("main button", { hasText: "min" }).first();
  if ((await filaTurno.count()) > 0) {
    await filaTurno.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(700);
    await shot(page, "04-sheet-turno");
    // Si el turno ofrece cobrar, "Cobrar" sólo cambia el modo local del sheet
    // y muestra los seis métodos (turno-detail-sheet.tsx:81-87). NO se toca
    // ningún método: eso sí cobraría.
    const cobrarEnSheet = page.locator('[role="dialog"] button:text-is("Cobrar")');
    if ((await cobrarEnSheet.count()) > 0) {
      await cobrarEnSheet.first().click();
      await page.waitForTimeout(600);
      await shot(page, "05-sheet-cobrar-metodos");
      reporte.medidas.sheetCobrar = "abierto desde el detalle del turno; ningún método tocado";
    } else {
      avisar("El turno abierto no ofrece Cobrar: no hay captura del sheet de métodos.");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } else {
    avisar("No hay ningún turno en la agenda para abrir su sheet.");
  }

  // ── 3 · Pacientes + ficha ────────────────────────────────────────────────
  console.log("→ Pacientes");
  await page.goto(`${BASE}/pacientes`, { waitUntil: "domcontentloaded" });
  await quieto(page);
  await pantalla(page, "06-pacientes-lista");

  // `:visible`: la tabla de desktop y la lista de mobile se renderizan las
  // dos y una queda oculta por CSS (pacientes-view.tsx:346 y :427).
  const enlacePaciente = page
    .locator('a[href^="/pacientes/"]:visible')
    .filter({ hasText: PACIENTE })
    .first();

  if ((await enlacePaciente.count()) === 0) {
    avisar(`No encontré a "${PACIENTE}" en la lista: la ficha queda sin captura.`);
  } else {
    await enlacePaciente.click();
    await page.waitForURL(/\/pacientes\/[^/]+$/, { timeout: 25000 });
    await quieto(page);
    reporte.medidas.urlFicha = page.url();
    await pantalla(page, "07-ficha-sesiones");

    await tocar(page, page.locator('button[role="tab"]:has-text("Recorrido")'), "la pestaña Recorrido");
    await quieto(page);
    await pantalla(page, "08-ficha-recorrido");

    await tocar(page, page.locator('button[role="tab"]:has-text("Ficha")'), "la pestaña Ficha");
    await quieto(page);
    await pantalla(page, "09-ficha-datos");

    await tocar(page, page.locator('button[role="tab"]:has-text("Sesiones")'), "la pestaña Sesiones");
    await quieto(page);
    reporte.medidas.enlacesNota = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href^="/sesiones/"]')).map((a) =>
        a.getAttribute("href"),
      ),
    );
    reporte.medidas.hrefGrabar = await page.evaluate(() => {
      const a = document.querySelector('a[aria-label="Grabar"]');
      return a ? a.getAttribute("href") : null;
    });
  }

  // ── 4 · Cobros ───────────────────────────────────────────────────────────
  console.log("→ Cobros");
  await page.goto(`${BASE}/cobros`, { waitUntil: "domcontentloaded" });
  await quieto(page);
  await pantalla(page, "10-cobros-te-deben");
  await tocar(page, page.locator('button[role="tab"]:has-text("Cobros del mes")'), "la pestaña Cobros del mes");
  await quieto(page);
  await pantalla(page, "11-cobros-del-mes");

  // ── 5 · Tu consultorio ───────────────────────────────────────────────────
  console.log("→ Tu consultorio");
  await page.goto(`${BASE}/config`, { waitUntil: "domcontentloaded" });
  await quieto(page);
  await pantalla(page, "12-consultorio");
  reporte.medidas.consultorio = await page.evaluate(() => {
    const main = document.querySelector("main");
    const secciones = Array.from(document.querySelectorAll("section")).map((s) => {
      const t = s.querySelector("h2, span");
      return {
        texto: (t?.textContent ?? "").trim(),
        top: Math.round(s.getBoundingClientRect().top + (main ? main.scrollTop : window.scrollY)),
      };
    });
    const enfoque = secciones.find((t) => t.texto.toLowerCase().includes("tu enfoque"));
    return {
      altoTotal: main ? main.scrollHeight : document.documentElement.scrollHeight,
      secciones: secciones.map((t) => t.texto).filter(Boolean),
      topTuEnfoque: enfoque ? enfoque.top : null,
    };
  });

  // ── 6 · La nota clínica ──────────────────────────────────────────────────
  // Se recorren todas las sesiones de la ficha para encontrar una con señal
  // de riesgo y una con "Para vos": no todas las notas tienen las dos cosas.
  const notas = reporte.medidas.enlacesNota ?? [];
  if (notas.length === 0) {
    avisar("No hay ninguna sesión con nota en la ficha: la nota queda sin captura.");
  } else {
    reporte.medidas.notas = [];
    for (const [i, href] of notas.entries()) {
      console.log(`→ Nota ${i + 1}/${notas.length}`);
      await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
      await quieto(page);

      const inventario = await page.evaluate(() => {
        const texto = document.body.innerText;
        return {
          senalDeRiesgo: texto.includes("Señal de riesgo"),
          paraVos: texto.includes("Para vos"),
          masDeEstaSesion: texto.includes("Más de esta sesión"),
          borradorOriginal: texto.includes("Ver el borrador original"),
          estado: texto.includes("Nota guardada")
            ? "aprobada"
            : texto.includes("Para revisar")
              ? "para revisar"
              : "otro",
          plegables: Array.from(
            document.querySelectorAll("button[aria-expanded]"),
          ).map((b) => b.textContent.trim().split("\n")[0]),
        };
      });
      reporte.medidas.notas.push({ href, ...inventario });

      const nombre = `13-nota-${i + 1}`;
      await pantalla(page, nombre);

      // Abrir todos los plegables de la nota (plegable.tsx:52-58: sólo
      // cambian estado local) y capturar la nota entera desplegada.
      const plegables = page.locator("button[aria-expanded]");
      const cuantos = await plegables.count();
      for (let j = 0; j < cuantos; j++) {
        const boton = plegables.nth(j);
        if ((await boton.getAttribute("aria-expanded")) === "false") {
          await boton.click().catch(() => {});
          await page.waitForTimeout(350);
        }
      }
      await quieto(page);
      await pantalla(page, `${nombre}-desplegada`);
    }
  }

  // ── 7 · Grabar (sin tocar el botón) ──────────────────────────────────────
  const hrefGrabar = reporte.medidas.hrefGrabar;
  if (!hrefGrabar) {
    avisar("No encontré el botón Grabar de la ficha: la pantalla queda sin captura.");
  } else {
    console.log("→ Grabar (sólo se abre; no se toca el botón)");
    await page.goto(`${BASE}${hrefGrabar}`, { waitUntil: "domcontentloaded" });
    await quieto(page);
    await pantalla(page, "14-grabar-previo");
  }

  // ── 8 · Sheet de cobrar desde Hoy, si hoy hay algo por cobrar ────────────
  console.log("→ Hoy: sheet de cobrar (sin elegir método)");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await quieto(page);
  const botonCobrar = page.locator('main button:text-is("Cobrar")');
  if ((await botonCobrar.count()) === 0) {
    avisar('Hoy no hay ningún botón "Cobrar": el sheet de Hoy queda sin captura.');
  } else {
    await botonCobrar.first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, "15-hoy-sheet-cobrar");
    // Escape cierra sin elegir método (sheet.tsx:64-71).
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Si el de cobrar no existe hoy (hace falta un turno pasado sin pagar), se
  // captura igual UN sheet: el de agendar. Es el mismo componente Sheet
  // (ui/sheet.tsx) y sirve para auditar el patrón. Abrirlo no crea nada: el
  // turno se crea recién al enviar el formulario, y no se envía.
  console.log("→ Sheet de agendar (no se envía el formulario)");
  await page.goto(`${BASE}/agenda`, { waitUntil: "domcontentloaded" });
  await quieto(page);
  const fab = page.locator('button[aria-label="Agendar"]');
  if ((await fab.count()) === 0) {
    avisar("No encontré el botón de agendar: no hay captura de sheet.");
  } else {
    await fab.first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, "16-sheet-agendar");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // ── 9 · Cerrar sesión (sólo en la corrida final) ─────────────────────────
  if (CERRAR_AL_FINAL) {
    console.log("→ Cerrar sesión");
    await page.goto(`${BASE}/config`, { waitUntil: "domcontentloaded" });
    await quieto(page);
    const salir = page.locator('button:has-text("Cerrar sesión")');
    if ((await salir.count()) === 0) {
      avisar("No encontré el botón de cerrar sesión.");
    } else {
      await salir.first().click();
      await page.waitForURL(/\/login/, { timeout: 25000 }).catch(() => {});
      console.log(`  ✓ sesión cerrada (${page.url()})`);
    }
  } else {
    console.log("→ Sesión abierta a propósito (SESION_CERRAR=1 para cerrarla)");
  }

  await contexto.close();
  await navegador.close();
  if (CERRAR_AL_FINAL) rmSync(ESTADO, { force: true });

  console.log("\n--- REPORTE ---");
  console.log(JSON.stringify(reporte, null, 2));
}

main().catch((error) => {
  console.error("ERROR:", error.message);
  process.exit(1);
});
