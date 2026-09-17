# Segmentos largos en el worker — 17 de septiembre de 2026

Base: origin/main 920269f27e50b4b2b5d3ca5b3d8b11d4e9dc078c.
Rama: worker-segmento-largo. Worktree: ~/proyectos/sesion-worker-segmento-largo.

## Cambio y límite elegido

processor/audio_entrada.py define MAX_SEGUNDOS_SEGMENTO = 5 * 60.
Los dos controles que antes rechazaban más de 65 segundos —duración AAC del
contenedor y cantidad de muestras decodificadas— usan ahora esa constante.

Cinco minutos es el máximo del archivo completo, no cinco minutos adicionales
de congelación. Si se congela justo antes de la rotación de 60 segundos,
admite aproximadamente cuatro minutos más. Es una tolerancia acotada para
suspensiones de varios minutos; no promete soportar cualquier bloqueo.

A los 64 kbit/s que solicita el grabador, 300 segundos equivalen a unos
2,4 MB comprimidos. Queda margen frente al límite existente de 4 MiB,
que no cambia y sigue siendo obligatorio aunque el navegador elija otra tasa.
Diez minutos serían unos 4,8 MB y ya excederían ese tope. El PCM temporal
de cinco minutos ocupa 9,6 MB en disco a 16 kHz, mono y 16 bits.

No cambia el grabador, el tamaño normal de 60 segundos, el solape, el cifrado,
el contrato, los reintentos ni el aviso de huecos. No hay dependencias nuevas.

## Prueba roja antes de cambiar la implementación

Se agregaron primero los casos reales a processor/tests/test_audio_entrada.py.
Con processor/audio_entrada.py idéntico a la base:

```sh
cd processor
.venv/bin/python -m pytest tests/test_audio_entrada.py -k largo -q
```

Resultado: **4 fallaron, 30 deseleccionados, 17,51 s**.
Fallaron Opus y AAC, tanto con solape como con hueco. Error audio_invalido:
Opus fue rechazado por el número de muestras; AAC, por la duración del contenedor.
El primer segmento de cada caso dura realmente 300 segundos; ffmpeg lo codifica
y el worker lo descifra y decodifica. Solo la descarga de R2 se sustituye por
bytes locales. No se simulan ffmpeg, ffprobe ni la duración.

## Resultado con el límite nuevo

Entorno: Python 3.12.3, ffmpeg 6.1.1-3ubuntu5, Ubuntu/WSL.
La suite genera archivos WebM/Opus y MP4/AAC; no necesita micrófono ni servicios.

| Caso | Resultado comprobado |
| --- | --- |
| Primer segmento de 300 s; segundo empieza en 299,125 s y termina en 359 s | Solape de 875 ms recortado según inicioMs; 5.744.000 muestras finales = 359 s exactos; ningún hueco |
| Pitidos de identidad distinta cada segundo en esa unión | 359 encontrados; intervalos y posiciones dentro de 40 ms; ninguna identidad perdida ni repetida |
| Primer segmento de 300 s; segundo empieza en 300,250 s y termina en 359 s | 358,750 s de audio; hueco informado de 250 ms; audio + hueco = 359 s; sin inventar silencio |
| Archivo bien formado de 301 s, bien cifrado y menor a 4 MiB | Rechazado con audio_invalido definitivo |
| Bytes que no son un contenedor de audio, con cifrado y huella válidos | Rechazados con audio_invalido definitivo |
| Ensamblado que pierde 200 ms, guardia existente | Rechazado con audio_duracion |
| Hueco en el procesamiento, guardias existentes | Se avisa y persiste antes de transcribir; si no puede persistirse el aviso, no transcribe |

Comando completo desde processor: `.venv/bin/python -m pytest tests -q`.
Resultado local: **258 tests en verde, 61,65 s**. Sin base de datos ni proveedores.
Revisión previa al commit: `codex review --uncommitted`, sin hallazgos;
ejecutó además los 34 tests de entrada de audio, todos en verde.
El CI de la rama agrega tipos, lint, build, auditorías, guardias y suite de la app
con Postgres efímero; su enlace y resultado se entregan en el reporte del chat.

## Alcance y desacuerdos

- El worker existente verifica conservación exacta de muestras después de
  recortar. No compara contra duracionAudioSeg: ese campo se recibe, pero no se
  usa para validar el audio. Se mantiene ese comportamiento; las pruebas
  comparan contra el reloj conocido de la fuente sintética.
- Cuando hay un hueco, el audio dura menos que el reloj por ese hueco: se avisa,
  no se rellena. Exigir ambas duraciones iguales en ese caso cambiaría el diseño.
- Más de cinco minutos no demuestra corrupción: también puede ser una
  congelación legítima más larga. Se rechaza por estar fuera del límite
  operativo. Los controles de autenticación, huella, formato, bytes y muestras
  siguen detectando los errores que detectaban antes.
- No se prueba un teléfono físico: estos archivos demuestran la aceptación y
  el ensamblado del worker, no que Android o iOS mantengan el micrófono activo,
  ni que un prefijo AAC interrumpido sea recuperable.
- No se toca release ni publicar.yml; no se abre PR ni se despliega.
