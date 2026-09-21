# Los dos contratos de respuesta de la API, y por qué conviven

La API de Sesión contesta de dos formas distintas **a propósito**. No es una
migración a medias ni una inconsistencia: son dos consumidores con dos
necesidades, y cada forma está probada de su lado.

## 1. Para la usuaria: `{ data: … }`

Todo lo que consume la app —pantallas, `src/lib/api-client.ts`— viaja
envuelto:

```json
{ "data": { "consentimiento": { "id": "…", "vigente": true } } }
```

Lo escribe `ok()` (`src/app/api/_lib/responses.ts`), que es la única forma de
contestar 2xx en esas rutas. El cliente desenvuelve `data` siempre, así que
una ruta que conteste sin envoltorio le entrega `undefined` al llamador y el
error aparece lejos de su causa. Ya pasó: el POST del consentimiento contestó
un rato sin `data` y no se notó porque ninguno de sus dos consumidores leía el
cuerpo.

Los errores van por el otro lado y tampoco llevan `data`:
`{ "error": "…" }`, con `details` cuando es una validación de Zod.

## 2. Para el worker: un array pelado

Los dos endpoints de reclamo contestan una **lista JSON de primer nivel**, sin
envoltorio:

- `GET /api/sesion-clinica/pendientes` → `[ { sesion… }, … ]`
- `GET /api/trabajos/pendientes` → `[ { trabajo… }, … ]`

Los escribe `Response.json(...)` directo, no `ok()`.

**Por qué.** Del otro lado está `processor/app_client.py`, y su helper
`_lista()` exige que el cuerpo sea una lista de objetos: si no lo es, lanza
`requests.RequestException` y el poll se reintenta. Esa comprobación es la que
evita que el worker interprete una página de error de un proxy, o un cuerpo
recortado, como "no hay trabajo". Envolver la lista en `{ data: [...] }`
obligaría a aflojar esa comprobación —a mirar dentro de un objeto antes de
saber si es la respuesta correcta— a cambio de nada: el worker no comparte una
línea de código con el cliente de la app.

Son los ÚNICOS dos endpoints así, y los dos autorizan con `PROCESSING_SECRET`
(lo único que ese secreto autoriza). El resto de lo que habla el worker —lease,
checkpoint, asr, resultado— va con el ticket de la fila y contesta con el
envoltorio, porque son respuestas de una operación y no listas de reclamo.

## Cómo elegir, para una ruta nueva

- ¿La lee una pantalla, o cualquier cosa que pase por `api-client.ts`? →
  `ok(...)`.
- ¿Es el reclamo de trabajo del worker? → array pelado, y agregala a esta
  lista de dos.
- Cualquier otro caso → `ok(...)`. Un tercer contrato hay que justificarlo acá
  antes de escribirlo.
