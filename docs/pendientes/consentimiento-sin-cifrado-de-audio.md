# Consentimiento 2.6: frases que dejaron de ser ciertas

18 de septiembre de 2026. Rama `grabador-dhh`.

La app dejó de cifrar el audio (orden del dueño: el grabador más simple que
grabe dos horas en un Android de gama media). El texto del consentimiento **no
se tocó**: corregirlo es una versión nueva, que las pacientes vuelven a firmar,
y esa decisión es del dueño. Hasta entonces el texto vigente promete cosas que
el código ya no hace. Están todas acá, con archivo y línea.

El texto se arma en `src/lib/consentimiento.ts` a partir de las banderas de
`src/lib/consentimiento-hechos.ts`. Ninguna bandera se cambió: cambiar una
cambia el texto.

| # | Frase del consentimiento vigente | Dónde | Qué pasa hoy |
| --- | --- | --- | --- |
| 1 | "Mientras se graba, cada trozo de audio se cifra en el teléfono de … antes de guardarse, con una clave que se crea para esa sesión." | `consentimiento.ts:98` (bandera `RESPALDO_LOCAL_CIFRADO`, `consentimiento-hechos.ts:35`; `CLAVE_POR_SESION`, `:43`) | Cada trozo se guarda tal cual en el navegador del teléfono. No hay clave por sesión. |
| 2 | "Al terminar, el archivo completo se cifra con esa misma clave y recién entonces se sube." | `consentimiento.ts:98` | El archivo se sube tal como se grabó, por una conexión cifrada (TLS). |
| 3 | "En el teléfono no queda audio sin cifrar." | `consentimiento.ts:98` | Queda el audio sin cifrar hasta que la subida se confirma; lo protege el bloqueo del teléfono. |
| 4 | "Ya cifrado, se guarda en un servicio de almacenamiento (Cloudflare R2)…" | `consentimiento.ts:191` | Llega sin cifrar por la app. R2 lo cifra en reposo por su cuenta: quien tenga acceso al almacén puede escucharlo. |
| 5 | "…lo descifra solo en memoria y lo manda a transcribir." | `consentimiento.ts:147` (`AUDIO_DESCIFRADO_EN_ARCHIVO_TEMPORAL`, `consentimiento-hechos.ts:107`) | No hay nada que descifrar. Sigue siendo cierto que el servidor lo tiene sólo en memoria y no escribe ningún archivo. |
| 6 | "En ese momento la aplicación destruye siempre la clave del audio en la base que usa para trabajar. Desde entonces no puede abrir ese archivo, aunque siga pendiente de borrado." | `consentimiento.ts:123` (`CLAVE_AUDIO_DESTRUIDA_AL_APROBAR`, `consentimiento-hechos.ts:135`) | No hay clave. Al aprobar sólo se programa el borrado; **mientras el archivo no se borre se puede escuchar**. Es la pérdida real de este cambio. |
| 7 | "No contienen el audio, pero sí pueden contener, cifrada, la clave de un audio que todavía no se había borrado. Esa clave puede conservarse hasta 12 meses… Si el archivo no se pudo borrar, esa copia de la clave podría permitir abrirlo." | `consentimiento.ts:134` (`BACKUP_INCLUYE_CLAVE_AUDIO`, `consentimiento-hechos.ts:145`) | Las sesiones nuevas no tienen clave. Sólo un respaldo anterior puede tener la de una sesión grabada con la versión que cifraba. |

Frases que **siguen siendo ciertas** y conviene conservar: "Recibe el audio sin
cifrar" (AssemblyAI, `consentimiento.ts:192`); los reintentos y plazos del
borrado; que el servidor no escribe el audio en ningún archivo.

## Qué queda atado a esto en el código

- `src/lib/__tests__/consentimiento.test.ts`: la prueba "cada trozo se cifra en
  el teléfono…" está marcada `it.fails`. El día que el texto y las banderas
  digan la verdad va a ponerse roja, y hay que reescribirla contra el hecho
  nuevo.
- `docs/ayuda/12-camino-del-audio-y-privacidad.md` avisa que el consentimiento
  2.6 todavía dice otra cosa.
- Las columnas `audio_clave_encrypted` y `audio_iv` siguen en el esquema, sin
  usarse. `aprobar.ts` sigue anulando `audioClave`: sólo tiene efecto en
  sesiones grabadas con la versión anterior.
