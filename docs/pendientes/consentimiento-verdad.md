# Consentimiento 2.2 — verdad del texto

Base: `origin/main` en `6b7c0c5`. Rama: `consentimiento-verdad`.

## Texto anterior y nuevo

«Profesional» es el nombre que se interpola. Los textos de esta tabla fueron generados desde los hechos de ambas versiones. El PDF ya estaba en la 2.1 y se incluye en la 2.2 precisando qué se registra: la preparación de la copia, no cada reimpresión desde una hoja abierta.

| Corrección | Antes | Ahora |
|---|---|---|
| 1. Respaldos | Las copias de respaldo de la base de datos se guardan 30 días y no contienen el audio, pero sí pueden contener, cifrada, la clave de un audio que todavía no se había borrado. | Las copias de respaldo de la base de datos se guardan 30 días si son diarias y hasta 12 meses si son mensuales. No contienen el audio, pero sí pueden contener, cifrada, la clave de un audio que todavía no se había borrado. Esa clave puede conservarse hasta 12 meses, aunque ya se haya eliminado de la base que usa la aplicación. Si el archivo no se pudo borrar, esa copia de la clave podría permitir abrirlo. |
| 2. Borrado del audio | Hasta que Profesional revisa y aprueba la nota, en general el mismo día. En ese momento la aplicación destruye la clave que abre el audio y borra el archivo; si el borrado falla, lo reintenta hasta lograrlo. / El audio no queda. | Hasta que Profesional revisa y aprueba la nota, en general el mismo día. En ese momento la aplicación destruye siempre la clave del audio en la base que usa para trabajar. Desde entonces no puede abrir ese archivo, aunque siga pendiente de borrado. La aplicación intenta borrar el archivo. Si no lo logra, repite los intentos durante unos 15 días; después el borrado queda marcado como fallido. / El borrado del audio sigue los pasos y plazos explicados arriba. |
| 3. Resumen del proceso | Para escribir, con ayuda de inteligencia artificial, la nota clínica de la sesión: el registro escrito que Profesional guarda en tu historia clínica y que ella revisa y aprueba antes de que quede guardado. También para preparar, a partir de varias sesiones, un resumen de tu proceso que solo ella ve y edita, y un análisis de su propio trabajo que solo ella ve. | Para escribir, con ayuda de inteligencia artificial, la nota clínica de la sesión: el registro escrito que Profesional guarda en tu historia clínica y que ella revisa y aprueba antes de que quede guardado. También para preparar, a partir de varias sesiones, un resumen de tu proceso. Lo propone la misma inteligencia artificial que redacta la nota; Profesional lo revisa, lo corrige o lo descarta. Solo queda vigente cuando ella lo acepta. La decisión sigue siendo suya. También se prepara un análisis de su propio trabajo que solo ella ve. |
| 4. Descifrado | 2. Ya cifrado, se guarda en un servicio de almacenamiento (Cloudflare R2) y de ahí lo toma un programa de esta aplicación que corre en un servidor (Railway), lo descifra solo en memoria y lo manda a transcribir. | 2. Ya cifrado, se guarda en un servicio de almacenamiento (Cloudflare R2) y de ahí lo toma un programa de esta aplicación que corre en un servidor (Railway), lo descifra en un archivo temporal del servidor y lo manda a transcribir. Ese archivo temporal se borra al terminar. |
| 5. PDF | Profesional puede imprimir el resumen de tu proceso, o guardarlo como archivo en su teléfono o su computadora, para su propio archivo profesional. Esa copia ya no está dentro de la aplicación ni cifrada: queda bajo su cuidado, como cualquier registro de tu historia clínica en papel. La aplicación registra cada vez que lo hace. | Profesional puede imprimir el resumen de tu proceso, o guardarlo como archivo en su teléfono o su computadora, para su propio archivo profesional. Esa copia ya no está dentro de la aplicación ni cifrada: queda bajo su cuidado, como cualquier registro de tu historia clínica en papel. La preparación de esa copia queda registrada por la aplicación. |
| 6. Versión | Versión 2.1 | Versión 2.2 |

## Respaldo de cada corrección

| Corrección | Código que la sostiene |
|---|---|
| Diarias: 30 días; mensuales: 12 meses | `.github/workflows/backup.yml:262` y `:263`: limpieza a 30 y 366 días. El volcado completo de la base está en `:143`; incluye las claves cifradas que todavía existían al copiar. |
| Clave eliminada al aprobar; borrado con límite | `src/app/api/_lib/casos-uso/sesion/aprobar.ts:113` abre la transacción y `:126` escribe `audioClave: null` sin depender del resultado de R2. `trabajos/politica.ts:20` fija 20 intentos; `trabajos/resolver.ts:42` marca `fallido` al agotarlos. Las 19 esperas suman 14 días, 8 horas y 36 minutos; «unos 15 días» es aproximado, no un vencimiento exacto si el servicio se interrumpe. |
| La IA propone; la profesional decide | `processor/clinical_analyzer.py:145` usa el modelo compartido; `:351` redacta la nota y `:395` prepara el contexto. `processor/processor.py:449` devuelve la propuesta; `src/app/api/_lib/casos-uso/hilo/trabajo.ts` la guarda como `propuesta` o `desactualizada`. `hilo/escribir.ts:26` acepta, con o sin edición; `:51` rechaza. |
| Audio descifrado en archivo temporal | `processor/audio_entrada.py:91` usa `TemporaryDirectory`; `:112` descifra y `:114` escribe el archivo. El contexto elimina sus archivos al terminar, también ante una excepción normal. `processor/processor.py:188` mantiene ese contexto durante la transcripción. |
| Exportación a PDF | `src/app/(impresion)/pacientes/[id]/recorrido/imprimir/_components/recorrido-imprimible.tsx:106` usa el diálogo de impresión del navegador. `src/app/api/_lib/casos-uso/hilo/exportar.ts:92` registra la exportación antes de devolver sus datos, en la misma transacción. Reimprimir desde la hoja abierta (`recorrido-imprimible.tsx:119`) no vuelve a pedir datos ni crea otro evento; por eso se precisa que se registra la preparación. |
| Versión y refirma | `src/lib/consentimiento.ts:44` fija 2.2; `:47` compara toda firma anterior con esa versión. `src/components/grabacion/ConsentimientoForm.tsx:63` envía la versión vigente al firmar. |

## Refirma y límites

**Las firmas anteriores necesitan refirma**, incluidas las de la 2.1. No cambié la regla de vigencia ni agregué un bloqueo de captura: la API sigue devolviendo `sugiereRefirmar`; la profesional debe solicitarla. Cambiar ese comportamiento excedería la barrera de no modificar la aplicación.

La enumeración de «¿Qué queda guardado?» se conserva literalmente: misma introducción y mismos cuatro ítems. Un test compara ese bloque completo. La frase posterior «El audio no queda» se reemplazó para que no contradiga el borrado con fallos; no es un ítem de esa lista.

## Desacuerdo sobre la clave

No se puede garantizar «nadie puede abrirlo» mientras un respaldo anterior conserve la clave cifrada. Aprobar la elimina de la base activa, no de copias ya hechas. El texto informa la pérdida de acceso desde la aplicación y la excepción del respaldo: si el archivo sigue existiendo, recuperar esa clave podría permitir abrirlo. No cambié la retención, las claves ni la política de reintentos.

## Otras afirmaciones no respaldadas, fuera de los seis cambios

- **AssemblyAI:** todavía dice que se repite el pedido hasta recibir confirmación. `trabajos/politica.ts:24` también limita `borrar_transcript_asr` a 20 intentos. Queda señalado, sin ampliar esta tanda a ese párrafo.
- **Guardar la nota sólo después de aprobar:** «ella revisa y aprueba antes de que quede guardado» no distingue el borrador de la nota final. `src/app/api/_lib/casos-uso/sesion/resultado.ts:85` persiste la nota de la IA antes de aprobar. No agregué ese borrador a la enumeración, por decisión del dueño.

## Pruebas

- `consentimiento.test.ts`: cada frase corregida se vincula con su hecho; versión/refirma, lista intacta, PDF y registro de su preparación, reintentos acotados y excepción de la clave en respaldos.
- El plazo de borrado se calcula desde la política real y se ejerce su resolución al agotar los intentos.
- `consentimiento-retencion.test.ts`: ejecuta exclusivamente la limpieza extraída del YAML con un `aws` simulado y fecha fija. Contrasta prefijos y fechas de corte con los hechos y el texto. Cambiar cualquiera de los dos plazos del workflow sin actualizar el consentimiento hace fallar la prueba. No ejecuta el workflow ni accede a R2.
- Tipos en cero y lint limpio. Suite completa contra un Postgres 17 propio en Docker: 1.890 pruebas aprobadas, con el único benchmark manual existente omitido. `codex review --uncommitted` no encontró regresiones. El resultado final de CI y el SHA se informan al entregar la rama.
