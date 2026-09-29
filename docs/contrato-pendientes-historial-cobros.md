# Tres contratos que crecieron sin romperse

Pendientes, el historial clínico de la ficha y los cobros del mes ganaron
campos y parámetros nuevos. **Todos fueron aditivos**: una pantalla que no los
usa recibe exactamente lo que recibía antes, byte por byte. Hay un test por
cada uno que lo demuestra pidiendo sin los parámetros nuevos y comparando.
Los del historial (sección 2) se sacaron después: nadie los usaba.

El período de los cobros del mes se lee en **hora de Montevideo** (UTC-3, sin
horario de verano) con el parser de `src/app/api/_lib/periodo.ts`. Acepta un
mes (`2026-09`) o un día (`2026-09-30`).

---

## 1. `GET /api/dashboard` → `data.pendientes.notasFallidas`

**Qué es.** Las sesiones que se procesaron y fallaron: ocurrieron, la nota no
existe, y hasta ahora sólo se podían encontrar si alguien se acordaba del
paciente y entraba a su ficha. Ahora vienen de cualquier fecha, de la **más
vieja a la más nueva** (lo viejo primero porque es lo que más urge), con tope
de **20**.

**Forma** (`NotaFallida` en `src/types/domain.ts`):

```json
{
  "sesionId": "…",
  "turnoId": "…",
  "pacienteId": "…",
  "pacienteNombre": "Ana López",
  "fecha": "2026-09-14T15:00:00.000Z",
  "codigo": "intentos_agotados",
  "puedeReintentarse": true
}
```

**`codigo`** es el código del fallo, o `null` si la fila quedó sin uno. Es
seguro de mostrar. **Nunca viaja `falloDetalle`**: ese texto es de
diagnóstico, puede tener recortes del pipeline, y no tiene por qué entrar a
una pantalla.

**`puedeReintentarse`** dice si todavía hay con qué volver a intentar: audio
en R2, o una transcripción ya hecha. En `false` el único camino es eliminar
la sesión y volver a grabar. La regla es la misma que usa el reproceso
(`hayMaterial` en `casos-uso/sesion/reprocesar.ts`, gemela en JS de la
condición SQL, atadas por un test que corre las dos sobre las mismas filas):
la pantalla no puede ofrecer un botón que el servidor va a rechazar.

**El campo es opcional en el tipo** (`notasFallidas?`). No es duda sobre el
contrato: la respuesta siempre lo trae. Es para que el código que arma un
`PendientesTerapeuta` a mano —hay un test de la pantalla que lo hace— no
deje de compilar por un campo que no le importa.

---

## 2. `GET /api/pacientes/[id]/documentacion`: los filtros se sacaron

Este endpoint tuvo tres parámetros opcionales, `desde`, `hasta` e
`incluirFallidas`, que ninguna pantalla llegó a mandar. **Se sacaron el
29-09-2026 por decisión del dueño (D4).** Hoy acepta sólo `page` y `limit`,
como siempre; cualquier otro parámetro se ignora (no filtra ni da 400).

Sigue auditándose como exportación de documentación clínica, con `auditar`
(si el rastro no se puede escribir, las notas no salen). El `detalle` del
evento lleva `page`, `limit` y `total`.

Las sesiones fallidas se encuentran en **Pendientes** (sección 1), no acá.

---

## 3. `GET /api/turnos/cobros?mes=AAAA-MM`

Sin `mes`, el mes actual, igual que siempre. Con `mes`, los cobros de ese mes
(también acepta un día y toma su mes).

Existe para el **detalle de Finanzas**: al tocar la barra de un mes en el
tablero (`docs/contrato-finanzas.md`) hay que poder pedir los cobros de ESE
mes, no sólo los del corriente.

Ojo con cuál fecha: la lista es por **fecha de pago**, no por fecha de sesión.
Es la misma distinción COBRADO/TRABAJADO de Finanzas, y por eso los cobros de
septiembre pueden incluir una sesión de agosto.

---

## 4. Un error con código, para el mínimo de grabación

No es de la parte A, pero lo toca la misma pantalla. El servidor ahora aplica
el mínimo de duración por su cuenta al confirmar la subida: una grabación más
corta que `MINIMO_SEGUNDOS` (`src/lib/grabacion-captura.ts`, la única copia
de ese número) no se transcribe.

La respuesta es **422** y, por primera vez, lleva un código estable:

```json
{ "error": "…", "codigo": "grabacion_corta" }
```

`codigo` es opcional en `ApiError` y **sólo aparece cuando la ruta lo pone**:
los errores que ya existían siguen contestando `{ error }` a secas, sin
cambio de forma. Sirve para que el cliente distinga ESTE 422 de otro sin leer
el texto.

Del lado del servidor, esa confirmación deja la sesión en `fallida` con
`falloCodigo = "grabacion_corta"` y encola el borrado del audio en R2, todo
en la misma transacción. No queda un archivo huérfano pagando storage por una
grabación que nunca se va a usar.
