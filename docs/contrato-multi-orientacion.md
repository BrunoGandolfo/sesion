# Contrato multi-orientación — Feedback de la terapeuta (Llamada C)

**Estado:** implementado de punta a punta (tipos, endpoint, processor, prompts, UI).
**Fuente de verdad de tipos:** `src/types/domain.ts`.
**Fuente de verdad de configuración:** `Configuracion.orientacionTeorica` en
`prisma/schema.prisma` (String, default `"cbt_mi"`), editable desde la
pantalla Configuración.

Verificado contra `processor/clinical_analyzer.py`, `processor/schemas_llm.py`,
`processor/prompts/` y `src/app/api/_lib/casos-uso/reclamar-pendientes.ts`.

## 1. Orientaciones que existen

Son exactamente dos. Están en `_FEEDBACK_POR_ORIENTACION`
(`processor/clinical_analyzer.py`) y en `OrientacionTeorica` (`src/types/domain.ts`).

| `orientacionTeorica` | Instrumento | Prompt | Schema (processor) |
| --- | --- | --- | --- |
| `"cbt_mi"` (default) | MITI 4.2.1 (4 globales + 10 conteos) + subset CTS-R de 4 ítems | `prompts/therapist_feedback_v1.0.md` | `SCHEMA_FEEDBACK_CBT_MI` |
| `"gestalt"` | GTFS (Gestalt Therapy Fidelity Scale) | `prompts/therapist_feedback_gestalt_v1.0.md` | `SCHEMA_FEEDBACK_GESTALT` |

## 2. Cómo se elige

1. `GET /api/sesion-clinica/pendientes` → `reclamarPendientes` lee
   `Configuracion.orientacionTeorica` de la organización de cada sesión y la
   incluye en el payload. Si la organización no tiene configuración, manda
   `"cbt_mi"`.
2. El worker la pasa a `generar_feedback_terapeuta(orientacion=...)`. Un valor
   desconocido cae a `"cbt_mi"`. El processor no decide orientación por su
   cuenta.
3. La Llamada C es best-effort: si falla, `datosEstructurados` sale sin
   `feedbackTerapeuta` y la nota igual llega a revisión.
4. Al leer, la UI pasa el feedback por `normalizarFeedback()` y hace
   narrowing por `instrumento` (`FeedbackTerapeutaView.tsx`). El mapper
   `toConfiguracion` (`src/app/api/_lib/domain.ts`) también estrecha a la
   unión con fallback `"cbt_mi"`.

## 3. La unión discriminada

```typescript
export type OrientacionTeorica = "cbt_mi" | "gestalt";
export type FeedbackTerapeuta = FeedbackMitiCtsr | FeedbackGestalt;
```

Ambas variantes extienden `FeedbackNucleoPanteorico`: `fortalezas`,
`areasCrecimiento`, `sugerenciaProximaSesion`, `speechAnalyticsInferido`,
`disclaimer`. El núcleo es lo comparable entre orientaciones. Los scores
específicos no lo son y viven detrás del discriminador.

### Datos persistidos antes del contrato

Las sesiones aprobadas antes del contrato guardaron el feedback sin
`instrumento` (`FeedbackTerapeutaLegacy`). No se migran: `normalizarFeedback`
les agrega `instrumento: "cbt_mi"` al leer.

### Discrepancias entre prompt, schema y tipos

- El prompt GTFS y `IDS_GTFS` en `schemas_llm.py` definen **20 ítems**
  (`gtfs_01` a `gtfs_20`). El "ítem 21" de la escala original (factores
  inusuales) no es un ítem del JSON: es una regla del prompt que manda los
  ítems afectados a `null`. `src/types/domain.ts` menciona "21 ítems" en un
  comentario; el contrato real es 20.
- `adherenciaGlobal`: el schema del processor lo exige entero
  (`_INT`), el tipo TS admite `number | null`. En la práctica nunca llega
  `null`.
- El prompt cbt_mi documenta `speech_analytics` con ratios 0-1; el worker manda
  porcentajes 0-100 (`processor/speech_analytics.py`). Pendiente de alinear
  en el prompt.

## 4. Regla de extensión (orientación N+1)

1. **Tipo:** agregar el valor a `OrientacionTeorica`, definir
   `Feedback<Nueva> extends FeedbackNucleoPanteorico` con su `instrumento`
   literal, sumarla a `FeedbackTerapeuta`.
2. **Processor:** crear `prompts/therapist_feedback_<nueva>_v1.0.md`, su schema
   en `schemas_llm.py` y la entrada en `PROMPTS` y `_FEEDBACK_POR_ORIENTACION`.
3. **UI:** el bloque de render para el nuevo discriminador en
   `FeedbackTerapeutaView`, y la opción en la pantalla Configuración.

No se toca el núcleo, la normalización legacy, el endpoint `/pendientes` ni el
schema de base (el campo es String para no requerir migración).
