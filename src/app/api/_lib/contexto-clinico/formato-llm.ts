// Formato Markdown del Golden Thread para inyectar al prompt del LLM
// (processor.py lo pide con ?format=llm y lo mete en <contexto_previo>).
//
// Objetivos de diseño:
//   - Compacto: el contexto debe caber en ~3K tokens para dejar espacio a
//     la transcripción de 90 min (~6-8K) en una ventana de 16K.
//   - Sin ruido: secciones vacías se renderizan como "—" en lugar de
//     bloques en blanco, para que el LLM no las trate como "información
//     suprimida".
//   - Sólo A + P de las notas previas (no S + O): es donde vive la
//     interpretación clínica que importa para continuidad.
//
// Función pura: sin acceso a base. El texto es contractual con el prompt del
// worker; cualquier cambio acá cambia lo que ve el LLM.

import type { ContextoPayload } from "./tipos";

export function formatearParaLLM(payload: ContextoPayload): string {
  const activos = payload.objetivosTerapeuticos.filter(
    (o) => o.estado === "activo",
  );
  const cerrados = payload.objetivosTerapeuticos.filter(
    (o) => o.estado === "cerrado",
  );

  const lines: string[] = [];
  lines.push("## Contexto longitudinal del paciente");
  lines.push("");
  lines.push(
    `**Total de sesiones aprobadas previas**: ${payload.totalSesionesAprobadas}`,
  );
  if (payload.actualizadoEn) {
    lines.push(
      `**Última actualización del contexto**: ${payload.actualizadoEn.slice(0, 10)} (v${payload.version})`,
    );
  }
  if (payload.aprobadoPorTerapeutaEn) {
    lines.push(
      `**Revisado por la terapeuta**: ${payload.aprobadoPorTerapeutaEn.slice(0, 10)}`,
    );
  } else if (payload.version > 0) {
    lines.push("**Revisado por la terapeuta**: pendiente");
  }

  if (payload.version === 0 && payload.totalSesionesAprobadas === 0) {
    lines.push("");
    lines.push(
      "_Primer ciclo del Golden Thread: no hay contexto previo ni sesiones aprobadas._",
    );
    return lines.join("\n");
  }

  lines.push("");
  lines.push("### Hipótesis diagnóstica de trabajo");
  lines.push(payload.hipotesisDiagnostica?.trim() || "—");

  lines.push("");
  lines.push("### Objetivos terapéuticos activos");
  if (activos.length === 0) {
    lines.push("—");
  } else {
    for (const o of activos) {
      const inicio = o.fechaInicio.slice(0, 10);
      lines.push(`- [activo desde ${inicio}] ${o.descripcion}`);
    }
  }

  if (cerrados.length > 0) {
    lines.push("");
    lines.push("### Objetivos cerrados (referencia)");
    for (const o of cerrados) {
      const cierre = (o.fechaCierre ?? "").slice(0, 10);
      lines.push(
        `- [cerrado${cierre ? ` ${cierre}` : ""}] ${o.descripcion}`,
      );
    }
  }

  lines.push("");
  lines.push("### Resumen acumulativo");
  lines.push(payload.resumenAcumulativo?.trim() || "—");

  lines.push("");
  lines.push("### Temas recurrentes");
  if (payload.temasRecurrentes.length === 0) {
    lines.push("—");
  } else {
    const ordenados = [...payload.temasRecurrentes].sort(
      (a, b) => b.conteo - a.conteo,
    );
    for (const t of ordenados) {
      lines.push(`- ${t.tema} (${t.conteo})`);
    }
  }

  lines.push("");
  lines.push("### Intervenciones probadas");
  if (payload.intervencionesProbadas.length === 0) {
    lines.push("—");
  } else {
    for (const i of payload.intervencionesProbadas) {
      lines.push(
        `- ${i.tecnica}: eficacia ${i.eficaciaPercibida} (${i.sesiones.length} sesiones)`,
      );
    }
  }

  if (payload.riesgosHistoricos.length > 0) {
    lines.push("");
    lines.push("### Riesgos históricos");
    const ordenados = [...payload.riesgosHistoricos].sort((a, b) =>
      a.fecha < b.fecha ? 1 : -1,
    );
    for (const r of ordenados) {
      const fecha = r.fecha.slice(0, 10);
      const detalle = r.detalle ? ` — ${r.detalle}` : "";
      lines.push(`- ${fecha}: ${r.flag}${detalle}`);
    }
  }

  lines.push("");
  lines.push(
    `### Últimas ${payload.ultimasNotas.length} sesión(es) aprobada(s) — Análisis + Plan`,
  );
  if (payload.ultimasNotas.length === 0) {
    lines.push("Sin sesiones aprobadas previas.");
  } else {
    for (const n of payload.ultimasNotas) {
      const fecha = n.fechaSesion.slice(0, 10);
      lines.push("");
      lines.push(`#### Sesión del ${fecha}`);
      lines.push("");
      lines.push("**A (Análisis):**");
      lines.push(n.notaAnalisis?.trim() || "—");
      lines.push("");
      lines.push("**P (Plan):**");
      lines.push(n.notaPlan?.trim() || "—");
    }
  }

  return lines.join("\n");
}
