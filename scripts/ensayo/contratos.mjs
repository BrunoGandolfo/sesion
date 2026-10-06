// Qué esquema tiene que tener una copia restaurada, según la última
// migración que dice haber aplicado (`_prisma_migrations` de la copia).
//
// Antes el ensayo comparaba cada copia contra dos contratos fijos —la
// instantánea de producción d02ae0e y el prisma/schema.prisma del checkout—
// y aceptaba el que coincidiera. Dos problemas: el checkout era `main`, así
// que una migración sin publicar ponía en rojo toda copia de producción, y
// un DROP de columna habría puesto en rojo también a las copias viejas, que
// son legítimas. Ahora el contrato sale de la copia misma: la migración que
// tiene aplicada dice qué columnas tiene que tener, y si no las tiene, el
// esquema es "desconocido" aunque coincida con algún otro contrato.
//
// CÓMO SE MANTIENE ESTE MAPA
//
//   - Toda migración nueva entra acá. Si no cambia tablas, columnas ni
//     tipos (un índice, un CHECK, un trigger), apunta al mismo contrato que
//     la anterior.
//   - Si cambia columnas, el contrato "nuevo" pasa a describir a esa
//     migración y a las que vengan. Las anteriores pasan a un contrato
//     CONGELADO: una copia del schema.prisma tal como estaba, en esta misma
//     carpeta, con su id propio. Las copias viejas siguen siendo legítimas
//     hasta que vence la última (las mensuales duran 366 días).
//
// scripts/ensayo/__tests__/contratos.test.ts lo hace cumplir: aplica las
// migraciones del repo hasta cada una de las del mapa en una base vacía y
// exige que el catálogo resultante sea exactamente el del contrato al que
// apunta, y que la última migración del repo tenga contrato.

/** Filas mínimas por tabla. Una copia con menos no sirve para volver a
 *  atender: no hay a quién ni qué. */
const MINIMOS_COMUNES = {
  organizaciones: 1,
  usuarios: 1,
  pacientes: 1,
  turnos: 1,
  sesiones_clinicas: 1,
};

/** Muestras del esquema nuevo (ENC2): igual en todos sus contratos mientras
 *  no cambien estas columnas ni sus fechas. */
const MUESTRAS_ENC2 = [
  { rotulo: "nota clínica", tabla: "sesiones_clinicas", fecha: "creada_en", tipo: "nota",
    columnas: ["nota_final_encrypted", "nota_ia_encrypted"] },
  { rotulo: "versión del Recorrido", tabla: "hilo_versiones", fecha: "creada_en", tipo: "hilo",
    columnas: ["contenido_encrypted"] },
];

/** El contrato que se lee del schema.prisma PUBLICADO (release). */
export const CONTRATO_ACTUAL = "nuevo";

/**
 * Los contratos. `archivo` es relativo a la raíz del repositorio, salvo el
 * actual (`archivo: null`), que es el `prisma/schema.prisma` de release (ver
 * RAIZ_RELEASE en verificar-restauracion.mjs).
 */
export const CONTRATOS = {
  // Producción anterior a la reconstrucción del 17-sep-2026: schema.prisma de
  // d02ae0e, sin cambios. Otra historia de migraciones (su 0_init no es el
  // de hoy). Cifrado ENC1, sin id de clave.
  "produccion-d02ae0e": {
    archivo: "scripts/ensayo/esquema-produccion.prisma",
    formato: "ENC1",
    minimos: { ...MINIMOS_COMUNES, paciente_contexto_clinico: 1 },
    muestras: [
      { rotulo: "nota clínica", tabla: "sesiones_clinicas", fecha: "createdAt", tipo: "nota",
        columnas: ["nota_soap_encrypted", "nota_soap_original_encrypted"] },
      // Producción conserva el contexto actual por paciente, no versiones.
      { rotulo: "contexto longitudinal", tabla: "paciente_contexto_clinico", fecha: "creado_en", tipo: "contexto",
        columnas: ["resumen_acumulativo_encrypted", "hipotesis_diagnostica_encrypted", "riesgos_historicos_encrypted"] },
    ],
  },
  [CONTRATO_ACTUAL]: {
    archivo: null,
    formato: "ENC2",
    minimos: { ...MINIMOS_COMUNES, hilos: 1, hilo_versiones: 1 },
    muestras: MUESTRAS_ENC2,
  },
};

/** Última migración aplicada en la copia → contrato. */
export const CONTRATO_POR_MIGRACION = {
  // Historia vieja (producción hasta el 17-sep-2026). Solo su última
  // migración: una copia que se quedó en una anterior no tiene el esquema de
  // d02ae0e y no hay instantánea para ella.
  "20260909194000_invitaciones": "produccion-d02ae0e",

  // Historia nueva (reconstrucción del 17-sep-2026). Las anteriores a
  // grabador_restaurado tenían la tabla audio_segmentos y nunca llegaron a
  // una copia: la primera copia de la base nueva (18-sep) ya la tiene
  // aplicada. Si apareciera una, no tiene contrato y es "desconocida".
  "20260918120000_grabador_restaurado": CONTRATO_ACTUAL,
  "20260923120000_turnos_duracion_120": CONTRATO_ACTUAL, // CHECK
  "20260923120100_turnos_pago_fecha_idx": CONTRATO_ACTUAL, // índice
  "20260924120000_eventos_auditoria_accion_idx": CONTRATO_ACTUAL, // índice
  "20260928120000_hilo_versiones_recifrado": CONTRATO_ACTUAL, // trigger
};

/**
 * Tablas → columnas → tipo físico (udt_name), leído de un schema.prisma. Es
 * un lector mínimo y no Prisma: el ensayo corre sin `npm ci`.
 */
export function contratoDelSchema(schema) {
  const tipos = { String: "text", Int: "int4", Float: "float8", Boolean: "bool", DateTime: "timestamp", Json: "jsonb", Bytes: "bytea" };
  for (const [, nombre, cuerpo] of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    tipos[nombre] = cuerpo.match(/@@map\("([^"]+)"\)/)?.[1] ?? nombre;
  }
  const tablas = {};
  for (const [, nombre, cuerpo] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const tabla = cuerpo.match(/@@map\("([^"]+)"\)/)?.[1] ?? nombre;
    tablas[tabla] = {};
    for (const linea of cuerpo.split("\n")) {
      const campo = linea.match(/^\s*(\w+)\s+(\w+)(\??)(\s+.*|\s*)$/);
      if (!campo || !tipos[campo[2]]) continue; // Relaciones, no columnas.
      const columna = campo[4].match(/@map\("([^"]+)"\)/)?.[1] ?? campo[1];
      tablas[tabla][columna] = /@db\.VarChar\(/.test(campo[4]) ? "varchar"
        : /@db\.Char\(/.test(campo[4]) ? "bpchar" : tipos[campo[2]];
    }
  }
  return tablas;
}

/** Firma comparable de un catálogo { tabla: { columna: tipo } }. */
export const firma = (tablas) =>
  JSON.stringify(Object.entries(tablas).sort().map(([tabla, columnas]) => [tabla, Object.entries(columnas).sort()]));

/** Qué difiere entre el catálogo restaurado y el contrato, en pocas palabras. */
export function diferencias(restaurado, contrato) {
  const salida = [];
  for (const t of Object.keys(contrato).sort()) {
    if (!restaurado[t]) { salida.push(`falta la tabla ${t}`); continue; }
    for (const [c, tipo] of Object.entries(contrato[t])) {
      if (!(c in restaurado[t])) salida.push(`falta ${t}.${c}`);
      else if (restaurado[t][c] !== tipo) salida.push(`${t}.${c} es ${restaurado[t][c]}, el contrato dice ${tipo}`);
    }
    for (const c of Object.keys(restaurado[t])) if (!(c in contrato[t])) salida.push(`sobra ${t}.${c}`);
  }
  for (const t of Object.keys(restaurado).sort()) if (!contrato[t]) salida.push(`sobra la tabla ${t}`);
  return salida;
}
