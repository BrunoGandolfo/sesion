# Contrato multi-orientación — Feedback del terapeuta (Llamada C)

**Estado:** Wave 1 completada (tipos + schema + este contrato). Wave 2 implementa prompts, processor y UI.
**Fuente de verdad de tipos:** `src/types/domain.ts`
**Fuente de verdad de configuración:** modelo `Configuracion` en `prisma/schema.prisma`, campo `orientacionTeorica`.

---

## 1. El problema y la forma de la solución

Sesión evalúa la performance de la terapeuta con instrumentos validados derivados de la
transcripción. Hasta ahora el instrumento estaba hardcodeado (MITI 4.2.1 + CTS-R subset),
pero el instrumento correcto depende de la orientación teórica de la profesional:

| `orientacionTeorica` | Instrumento | Referencia |
|---|---|---|
| `"cbt_mi"` (default) | MITI 4.2.1 + CTS-R subset (4 ítems) | Moyers et al.; Blackburn et al. |
| `"gestalt"` | GTFS — Gestalt Therapy Fidelity Scale, 21 ítems | Fogarty et al. 2019 |

### La unión discriminada

`FeedbackTerapeuta` es una **unión discriminada por el campo `instrumento`**:

```typescript
export type OrientacionTeorica = "cbt_mi" | "gestalt";

export type FeedbackTerapeuta = FeedbackMitiCtsr | FeedbackGestalt;
// FeedbackMitiCtsr  → instrumento: "cbt_mi"  + mitiGlobales, mitiCounts, ratiosDerivados, ctsrSubset
// FeedbackGestalt   → instrumento: "gestalt" + itemsGTFS, adherenciaGlobal
```

### Por qué existe un núcleo panteórico

Ambas variantes extienden `FeedbackNucleoPanteorico`:

```typescript
export interface FeedbackNucleoPanteorico {
  fortalezas: FortalezaFeedback[];
  areasCrecimiento: AreaCrecimientoFeedback[];
  sugerenciaProximaSesion: string;
  speechAnalyticsInferido?: SpeechAnalyticsInferido;
  disclaimer: string;
}
```

El núcleo es lo que **"Mi Práctica" cruza longitudinalmente**: fortalezas, áreas de
crecimiento, sugerencias y speech analytics existen en toda orientación y tienen la misma
semántica. Cualquier vista o análisis longitudinal que consuma SOLO el núcleo funciona sin
importar con qué instrumento se generó cada sesión — incluso si la profesional cambia de
orientación a mitad de su historia. Los scores específicos de instrumento (MITI globales,
ítems GTFS) NO son comparables entre orientaciones y por eso viven en el bloque específico,
detrás del discriminador.

### Compatibilidad con datos persistidos (legacy)

Las sesiones aprobadas antes de este contrato guardaron el feedback **sin** el campo
`instrumento` (shape `FeedbackTerapeutaLegacy`). Regla: **los datos viejos NO se migran —
se normalizan al leer**:

```typescript
esFeedbackLegacy(raw)      // type guard: no tiene "instrumento"
normalizarFeedback(raw)    // legacy → { ...raw, instrumento: "cbt_mi" }
```

Todo punto de lectura de `datosEstructurados.feedbackTerapeuta` DEBE pasar por
`normalizarFeedback()` antes de hacer narrowing por discriminador.

---

## 2. Obligaciones de Wave 2

### 2.a Endpoint `/api/sesion-clinica/pendientes`

El payload de cada sesión pendiente DEBE incluir `orientacionTeorica`, leída de la
`Configuracion` de la organización (campo `orientacionTeorica`, String, default `"cbt_mi"`).
Es la única fuente de verdad — el processor no decide orientación por su cuenta.

### 2.b Processor (worker Python)

El processor lee `orientacionTeorica` del payload de `/pendientes` y selecciona el prompt
de la Llamada C con este mapa (fallback a `"cbt_mi"` si el campo falta o trae un valor
desconocido):

```python
PROMPT_FEEDBACK_POR_ORIENTACION = {
    "cbt_mi":  "therapist_feedback_v1.0.md",
    "gestalt": "therapist_feedback_gestalt_v1.0.md",
}
```

### 2.c Prompt GTFS (`processor/prompts/therapist_feedback_gestalt_v1.0.md`)

Su `<output_schema>` DEBE producir JSON que cumpla **exactamente** la interfaz
`FeedbackGestalt` de `src/types/domain.ts`:

- `instrumento: "gestalt"` — literal, obligatorio (es el discriminador).
- `itemsGTFS: ItemGTFS[]` — cada ítem con `id` (ej. `"gtfs_04"`), `nombre` (español),
  `score` (escala GTFS; `null` si no inferible desde transcripción, con `razon`),
  y `evidence: [{timestamp, quote}]` (≥1 si score no es null — misma regla de evidencia
  obligatoria que el prompt MITI).
- `adherenciaGlobal: number | null` — suma GTFS de los ítems evaluables; `null` si no hay
  ítems evaluables.
- TODO el núcleo panteórico: `fortalezas`, `areasCrecimiento`, `sugerenciaProximaSesion`,
  `speechAnalyticsInferido` (opcional), `disclaimer`.

La definición de los 21 ítems (ids, nombres, escala, criterios de scoring) se fija en
Wave 2 tras el análisis del PDF de Fogarty et al. 2019.

### 2.d UI (`src/components/grabacion/FeedbackTerapeutaView.tsx`)

El componente renderiza **por discriminador**: normaliza la entrada con
`normalizarFeedback()` y luego hace switch/narrowing sobre `feedback.instrumento`.
Estado actual (Wave 1): el bloque `"cbt_mi"` renderiza MITI/CTS-R como siempre; el bloque
`"gestalt"` devuelve `null` (placeholder). Wave 2 agrega el render GTFS. El núcleo
panteórico (fortalezas, áreas, sugerencia, disclaimer) debe renderizarse igual para toda
orientación.

---

## 3. Regla de extensión (agregar una orientación N+1)

Agregar una orientación nueva es exactamente esto — y nada más:

1. **Tipo:** agregar el valor a `OrientacionTeorica`, definir `Feedback<Nueva> extends
   FeedbackNucleoPanteorico` con su `instrumento` literal y su bloque específico, y sumarla
   a la unión `FeedbackTerapeuta`.
2. **Prompt:** crear `processor/prompts/therapist_feedback_<nueva>_v1.0.md` cuyo output
   cumpla la interfaz nueva, y agregar la entrada al dict del processor.
3. **Render:** agregar el bloque de render para el nuevo discriminador en
   `FeedbackTerapeutaView`.

No se toca: el núcleo panteórico, la normalización legacy, el endpoint `/pendientes`
(ya envía `orientacionTeorica`), ni el schema de DB (el campo es String justamente para
no requerir migración por orientación nueva). Si una extensión "necesita" tocar algo más,
el diseño de esa extensión está mal — volver a discutir antes de implementar.
