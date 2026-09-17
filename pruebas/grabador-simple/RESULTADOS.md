# Grabador simple — 17 de septiembre de 2026

Base: `origin/main` e1843dd550128881821ad3a3e374b7dc374de09e.
Rama: `grabador-simple`. Worktree propio: `~/proyectos/sesion-grabador-simple`.

## Qué cambió el diseño

Un solo `MediaRecorder` por **corrida** (lo que va de un toque de Grabar a la
pausa siguiente), con `start(1000)`. Ese archivo continuo se sube en **piezas**
—los "segmentos" del contrato— cortadas en fronteras de entrega, dentro del
acumulador, sin tocar el recorder.

Se fue: la rotación por temporizador, el segundo recorder con solape, el
respaldo por prefijo acumulado y el cierre preventivo a los 63 segundos.

La captura ya no depende de que un temporizador de la página llegue a horario.
Lo único que la interrumpe sola es la prueba de que el micrófono dejó de estar:
la pista terminada, silenciada más de tres segundos, o **un minuto de página
viva sin una sola entrega** (el criterio del grabador anterior a `ea5ce74`). Un
congelamiento no cuenta como silencio: el reloj de silencio sólo suma el tiempo
que la página estuvo corriendo.

## Durabilidad: escritura lineal

Cada entrega de un segundo se cifra con `cifrarSegmento` —sin tocar
`cifrado.ts`— con el índice de pieza que le tocaría si hubiera que recuperarla,
y se escribe una vez en el almacén `entregas`. Al cerrarse la pieza, la
escritura de la pieza, el avance del reloj durable y la retirada de sus
entregas son **una sola transacción**.

Al reabrir después de una muerte del proceso, las entregas que quedaron sueltas
entran como piezas de un segundo cada una: ya están cifradas con su índice, así
que no hace falta ni la clave, ni la red, ni descifrar nada en el dispositivo.

Costo: cada byte se cifra y se escribe **dos veces** (una como entrega, una como
pieza), las dos lineales. El diseño anterior reescribía el prefijo acumulado
cada segundo: unas treinta veces los bytes de un segmento durante su minuto.

La base local pasa de v2 a v3 sumando el almacén `entregas`. El almacén
`respaldos` de v2 se conserva **sólo para leerlo una vez**: un prefijo que haya
quedado de la versión anterior se incorpora como pieza al abrir esa grabación,
en vez de perderse.

## El worker aprendió qué es una corrida

`processor/audio_entrada.py` agrupa las piezas en corridas y **pega los bytes
descifrados de una corrida antes de decodificar**. Es rearmar un archivo que
venía partido, no concatenar dos archivos Opus/AAC independientes: eso sigue sin
hacerse nunca, y los huecos siguen sin rellenarse con silencio.

Lo declara el cliente con `continuacion` en el descriptor del segmento (columna
nueva `audio_segmentos.continuacion`, `DEFAULT false`). La pieza 0 nunca es
continuación, y el schema Zod, el caso de uso y el worker lo verifican por
separado. **Las grabaciones anteriores quedan con `continuacion = false` en
todas sus piezas, así que el worker las procesa exactamente como antes**: una
pieza por corrida, decodificada sola. Los 32 casos previos de
`test_audio_entrada.py` pasan sin cambios.

El tope por archivo de cinco minutos pasa a ser un tope **por corrida** de 150
minutos, que es el límite de la sesión. El tope de 4 MiB por pieza no cambia.

## Rojo antes del arreglo

`pruebas/grabador-simple/evidencia-rojo.txt` tiene las salidas completas: las
pruebas nuevas contra la implementación de hoy (`origin/main`), con el mismo
archivo de prueba.

| Prueba nueva | Contra el código de hoy |
| --- | --- |
| bloquear la pantalla no corta la grabación | falla: queda `interrumpida` |
| un minuto sin audio sí interrumpe | falla: sigue `capturando` (hoy no mira el audio, mira el reloj) |
| una grabación corta se envía aunque el stop no llegue | falla: queda `interrumpida`, Terminar no hace nada |
| nunca hay dos avisos de momentos distintos | falla: el aviso viejo sigue al lado de la falla |
| un desacuerdo con el servidor deja una salida | falla: no hay acción posible |
| el medidor sigue a la vista en pausa | falla: no se renderiza |
| la autorización se firma en la pantalla de grabar | falla: no existe el botón |
| un aviso y una falla no conviven | falla: conviven |
| una corrida partida en piezas sin cabecera se rearma entera | falla: el worker no puede decodificar una pieza sin cabecera |
| la primera pieza no puede declararse continuación | falla: el worker no lo mira |
| rechaza una corrida más larga que el tope | falla: el tope era por archivo |

`pausar y reanudar, tres veces seguidas` pasa en las dos versiones: en el
teléfono, reanudar fallaba **como consecuencia** de la interrupción anterior, no
por el camino de reanudar en sí.

## Navegador real

`node pruebas/grabador-simple/verificar.mjs` (requiere `npx playwright install
chromium`). Usa `getUserMedia`, `MediaRecorder`, Web Crypto e IndexedDB reales
con el micrófono sintético de Chromium. Sólo se simula la API local: no se
envía nada a R2 ni a proveedores. Se mata el renderer con **SIGKILL**, sin
`stop` ni `pagehide`, y se vuelve a abrir una pestaña del mismo contexto.
Evidencia completa en `resultado-chromium.json`.

| Medición | Resultado |
| --- | --- |
| Chromium | 145.0.7632.6 |
| Recorders creados en 66 s de captura | **1** |
| Entregas recibidas | 64 |
| Piezas al momento de la caída | 1 cerrada + 5 entregas sueltas |
| Reloj antes de matar el renderer | 66,005 s |
| Audio rearmado tras reabrir | 65,220 s |
| **Pérdida ante la caída** | **0,785 s** |
| Reloj durable recuperado | 65,274 s (coincide con el audio) |
| Entregas sueltas tras recuperar | 0 |
| Recuperar de nuevo | no duplica índice ni reloj |
| Una pieza de adentro decodificada sola | **falla** (no tiene cabecera) |
| Migración v2→v3 con prefijo viejo | lo incorpora: 1 pieza, 4000 ms |
| Lectura desde otra cuenta | no ve esta grabación |

## Validación local

- `npx tsc --noEmit`: sin errores.
- `npm run lint`: sin errores ni avisos.
- `npm test`, TZ=UTC: 172 archivos, 2021 tests en verde (1 omitido, la medición
  optativa de `pruebas/vida`), unitarios e integración juntos. Postgres
  17 exclusivo en Docker, contenedor `pg-sesion-grabador-simple`, puerto local
  aleatorio, base `sesion_test`. Migraciones únicamente ahí.
- `processor`: `python -m pytest tests -q` → 261 tests en verde, con audio real
  generado por ffmpeg (Opus y AAC).
- No se tocó `cifrado.ts`, ni `release`, ni `publicar.yml`.

## Lo que no se pudo probar acá

Falta el teléfono físico: bloqueo manual de pantalla en Android e iPhone, volver
de otra app, llamada entrante, revocación del permiso de micrófono, wake lock
real, muerte real de la PWA, y el prefijo AAC de Safari recuperado de una
entrega suelta. Chromium con micrófono sintético prueba la máquina, no el
sistema operativo del teléfono.
