# Contrato de riesgo clínico — señal graduada `riesgoDetectado`

**Estado:** Wave Riesgo 0 completada (contrato + tipos + normalización de lectura). Wave Riesgo 1 implementa prompt y processor.
**Fuente de verdad de tipos:** `src/types/domain.ts`

---

## 1. El problema y la forma de la solución

Hoy el pipeline marca riesgo con `FlagsRiesgo`: booleanos por categoría (ideación
suicida, autolesión, violencia a terceros, síntomas psicóticos, crisis de pánico) más un
`detalle` textual único. Eso alcanza para alertar, pero no gradúa (todo flag pesa igual)
ni ancla cada señal a su evidencia textual por separado.

`riesgoDetectado` agrega una **señal graduada con evidencia**, embebida en
`datosEstructurados` como el resto de los campos derivados de la transcripción.
**Coexiste con `FlagsRiesgo`** — este contrato no lo reemplaza, no lo modifica y no lo
deprecia.

### El contrato

```typescript
export type NivelRiesgo = "ninguno" | "bajo" | "moderado" | "alto";

/** Cita literal de la transcripción que ancla un indicador de riesgo */
export interface EvidenciaRiesgo {
  timestamp: string; // formato "MM:SS"
  quote: string;     // cita textual del segmento
}

export interface RiesgoDetectado {
  nivel: NivelRiesgo;
  indicadores: string[];            // ej: "ideación suicida pasiva", "conducta impulsiva de riesgo"
  evidencia: EvidenciaRiesgo[];     // vacía solo si nivel es "ninguno"
  notaParaTerapeuta: string | null; // 1-2 frases, tono calmo, sin diagnóstico
}
```

---

## 2. Reglas del contrato

1. **Opcional en todos los niveles.** `datosEstructurados.riesgoDetectado?` es opcional:
   ausente en todo dato persistido antes de este contrato y en toda sesión donde la
   llamada que lo genera falle (best-effort — su ausencia nunca bloquea la nota).
   **Ausente o inválido → tratar como nivel `"ninguno"` al leer**, vía
   `normalizarRiesgo()`. Misma filosofía que `normalizarFeedback` (ver
   `docs/contrato-multi-orientacion.md`): los datos viejos NO se migran, se normalizan
   al leer.

2. **Panteórico.** La señal no varía por orientación teórica y NO participa de la unión
   discriminada del feedback. Cualquier vista o análisis longitudinal puede cruzarla
   entre sesiones sin importar con qué orientación se generó cada una.

3. **Criterio conservador.** Solo se gradúa riesgo a partir de señales **EXPLÍCITAS** en
   la transcripción:
   - Cada indicador debe poder anclarse a al menos una cita textual en `evidencia`.
   - La ausencia de evidencia textual implica `nivel: "ninguno"` — no se infiere riesgo
     desde el tono, el historial ni la temática general de la sesión.
   - **El sistema señala, NUNCA diagnostica**: `notaParaTerapeuta` describe lo observado
     en 1-2 frases, tono calmo, sin etiquetas diagnósticas ni indicaciones clínicas. El
     juicio clínico es siempre de la profesional.

4. **Sin migración.** El campo vive en el JSON de `datosEstructurados` (persistido
   cifrado). Ninguna columna nueva, ningún backfill.

### Normalización al leer

```typescript
esRiesgoDetectadoValido(raw) // guard estructural (unknown → RiesgoDetectado)
normalizarRiesgo(raw)        // ausente o inválido →
                             // { nivel: "ninguno", indicadores: [], evidencia: [], notaParaTerapeuta: null }
```

Todo punto de lectura de `datosEstructurados.riesgoDetectado` DEBE pasar por
`normalizarRiesgo()` antes de usar `nivel`.

**Frontera estricta (`parseDatosEstructurados`):** el campo NO participa del veredicto
válido/inválido del objeto. Si viene con shape válido se conserva; si falta o es
inválido se omite del resultado. Un `datosEstructurados` legacy (sin el campo) pasa la
validación exactamente igual que antes de este contrato.

---

## 3. Ejemplos

### Nivel `"ninguno"` (el caso por lejos más frecuente)

```json
{
  "nivel": "ninguno",
  "indicadores": [],
  "evidencia": [],
  "notaParaTerapeuta": null
}
```

Es también el objeto que devuelve `normalizarRiesgo()` cuando el campo falta o es
inválido: para los lectores, "no hay señal" y "no hay campo" son indistinguibles a
propósito.

### Nivel `"moderado"`

```json
{
  "nivel": "moderado",
  "indicadores": [
    "ideación suicida pasiva",
    "aumento del consumo de alcohol como regulación"
  ],
  "evidencia": [
    {
      "timestamp": "23:14",
      "quote": "a veces pienso que sería más fácil no estar, pero no haría nada"
    },
    {
      "timestamp": "31:02",
      "quote": "esta semana tomé casi todas las noches para poder dormirme"
    }
  ],
  "notaParaTerapeuta": "Aparecen expresiones de ideación pasiva sin plan y un aumento del consumo de alcohol ligado al sueño. Puede valer la pena retomarlo con calma en la próxima sesión."
}
```

Nótese el estilo de `notaParaTerapeuta`: describe lo observado, invita a explorarlo, no
etiqueta ("episodio depresivo", "alcoholismo") ni prescribe conducta clínica.

---

## 4. Obligaciones de Wave Riesgo 1 (processor)

- El `<output_schema>` del prompt DEBE producir JSON que cumpla exactamente la interfaz
  `RiesgoDetectado` de `src/types/domain.ts`, con el criterio conservador de la regla 3
  expresado en el prompt (evidencia obligatoria para todo indicador; sin evidencia →
  `"ninguno"`).
- Best-effort: si la llamada falla, el campo se **omite** de `datosEstructurados` —
  nunca se inventa un valor ni se bloquea el resto del pipeline.
- El processor no decide política: niveles, indicadores y tono los fija este contrato.
