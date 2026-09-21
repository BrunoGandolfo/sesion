# Respaldos: qué está probado y qué no (21 de septiembre de 2026)

Este documento es el resultado de auditar los respaldos con la evidencia de
GitHub Actions, no con lo que dicen los workflows. Complementa
`docs/operaciones.md` §4, que describe el procedimiento; acá está el estado
real y lo que falta.

## Resumen en una línea

La copia diaria funciona y está probada de punta a punta: el ensayo del 16 de
septiembre la restauró entera. La copia **mensual nunca existió**, y no por un
permiso ni por la retención: el paso que la creaba estaba condicionado a un día
que ninguna corrida tocó jamás.

## Lo que se encontró

**1. Nunca hubo una copia mensual, y no podía haberla.**

El paso de `backup.yml` que copia el `.gpg` a `backups/mensuales/` se agregó el
11 de septiembre de 2026 (commit `86f11f7`) condicionado a que la corrida
cayera el **día 1** del mes. Entre esa fecha y hoy no pasó ningún día 1.

Mirando más atrás: el respaldo tiene **74 corridas** registradas, desde el 22
de abril de 2026 hasta hoy. Agrupadas por día del mes, los días que aparecen
son el 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22,
23, 24, 25, 26, 27, 28 y 29. **El día 1 no aparece ni una vez.** El mecanismo
de la copia mensual es más joven que su primer disparo posible, que habría sido
el 1 de octubre de 2026.

Por eso el ensayo de restauración falla con "no existe la copia mensual"
([issue #33](https://github.com/BrunoGandolfo/sesion/issues/33)). No hay que
revisar permisos de R2 ni la retención: no hay nada que buscar en ese prefijo.

**2. El diseño era frágil aunque el día 1 hubiera caído.**

Dependía de que **una** corrida puntual saliera bien. Si el día 1 GitHub se
saltea el `schedule` —lo hace bajo carga— o el respaldo falla antes de ese
paso, ese mes se quedaba sin copia mensual **para siempre**, sin alarma, y el
hueco recién se veía en el ensayo del mes siguiente. Desde que el respaldo
se reactivó, el 1 de septiembre de 2026, corrió 19 veces por `schedule` y
**5 terminaron en rojo** (2, 3, 13, 14 y 15 de septiembre): que una corrida
puntual falle no es una hipótesis, pasa una de cada cuatro veces.

**3. El ensayo de restauración corría antes que el respaldo que venía a
verificar.**

El ensayo estaba agendado el día 1 a las 07:00 UTC, descrito en el propio
archivo como "una hora después del backup de ese día". El respaldo está
agendado a las 06:00 UTC, pero GitHub demora los `schedule`: sus 25 corridas
programadas arrancaron entre las **10:23 y las 12:26 UTC**, es decir entre
cuatro y seis horas y media tarde. El ensayo del día 1 miraba un bucket donde
el respaldo de ese día todavía no había llegado. Y en el primer mes —cuando
además no hay ninguna copia mensual anterior— eso lo condenaba a fallar
doblemente.

**4. El ensayo automático nunca corrió solo.**

Sus cuatro corridas son `workflow_dispatch`, todas del 16 de septiembre de
2026, todas en rojo. No hay ninguna corrida por `schedule`: la primera habría
sido el 1 de octubre.

**5. Lo que sí está probado: la copia diaria se restaura.**

El acta del issue #33 no es sólo malas noticias. Con la copia diaria del 16 de
septiembre, el ensayo levantó un Postgres 17 vacío, descifró, restauró con
`pg_restore --exit-on-error` y verificó: 2 organizaciones, 2 usuarios, 36
pacientes, 113 turnos, 43 sesiones clínicas, 1263 eventos de auditoría, 17
claves foráneas con 0 violaciones, 8 columnas cifradas con formato válido y
ningún problema. **Eso es una restauración probada de la copia diaria.**

## Qué se arregló en el código (esta rama)

`.github/workflows/backup.yml` — la copia mensual ya no depende del calendario
sino del **estado del bucket**: si no hay ninguna copia bajo
`backups/mensuales/sesion-backup-<AAAA-MM>-`, se hace; si ya hay, no se
duplica. La primera corrida exitosa de cada mes la crea, caiga el día que
caiga, y las demás no hacen nada. Es idempotente y se repara sola: si el día 1
no hubo corrida, la del día 3 cubre el mes.

Un listado que falla **no** se lee como "no hay ninguna" (eso duplicaría) ni
como "ya hay" (eso saltearía el mes): aborta el paso y la corrida avisa por
correo.

`.github/workflows/ensayo-restauracion.yml` — el ensayo pasa al **día 2**. Un
día entero de margen, sin depender de cuánto demore GitHub.

`scripts/ensayo/verificar-restauracion.mjs` — el acta anuncia el día real
(`DIA_ENSAYO`), atado al cron por un test.

Tests: `processor/tests/test_backup_mensual.py` corre el Bash real del paso con
un `aws` simulado y JMESPath de verdad, contra un bucket que conserva estado, y
comprueba las cinco cosas: que crea la copia cuando falta, que no la duplica
cuando está, que N corridas del mismo mes dejan UNA, que una copia de otro mes
o una diaria del mismo mes no la confunden, y que un listado o una copia que
fallan hacen fallar el paso.
`src/lib/__tests__/ensayo-restauracion.test.ts` exige que el día del acta sea
el del cron y que nunca vuelva a ser el 1.

## Qué falta, y es del dueño

Ninguna de estas cosas se puede hacer desde el repositorio.

**A. Verificar que existe la copia mensual de octubre.** El 1 o 2 de octubre
de 2026, después de que corra el respaldo, confirmar que apareció un objeto
bajo `backups/mensuales/`. Es la prueba de que el arreglo funciona contra R2
de verdad, que ningún test puede dar.
Pantalla: Cloudflare → R2 → el bucket → carpeta `backups/mensuales/`
(<https://dash.cloudflare.com/?to=/:account/r2/overview>).

**B. Correr el ensayo de restauración a mano una vez más, después de A.** Para
ver el primer acta con las dos copias en verde.
Pantalla: <https://github.com/BrunoGandolfo/sesion/actions/workflows/ensayo-restauracion.yml>
→ "Run workflow".

**C. El ensayo trimestral a mano, con acta. Esto es lo urgente.**
`docs/operaciones/actas/` **está vacío**: sólo tiene la plantilla. No existe
ningún acta. `scripts/ci/acta-vigente.mjs` hoy avisa sin fallar, pero **el 20
de diciembre de 2026 empieza a fallar el CI** si sigue sin haber ninguna. Para
esa fecha tiene que existir al menos un archivo
`docs/operaciones/actas/AAAA-MM-DD-loquesea.md` con el resultado de un ensayo
manual real. El procedimiento completo está en `docs/operaciones.md` §4; se
corre en la máquina del dueño, con el llavero, y el acta no lleva texto
clínico: ids y sí/no.

**D. Confirmar que `CLAVES_CIFRADO_IDS` está cargada en Variables.** El ensayo
falla antes de bajar nada si falta. Son sólo ids (`1`, `1,2`), nunca valores.
Pantalla: <https://github.com/BrunoGandolfo/sesion/settings/variables/actions>

**E. Decidir la contradicción del consentimiento.** El consentimiento declara
30 días de retención; el workflow guarda diarios 30 días y mensuales 366. No
es un error de código: es una decisión de política que está pendiente desde
antes y que ahora importa más, porque a partir de octubre van a existir copias
mensuales de verdad. Está documentada en `docs/pendientes/consentimiento-verdad.md`.

## Qué prueba el ensayo automático, y qué no

**Prueba:** que el archivo de R2 se descifra con `BACKUP_ENCRYPTION_KEY`, que
`pg_restore --exit-on-error` lo abre entero en una base vacía, que las tablas
tienen filas por encima de un piso (una base vacía falla), que las columnas
cifradas tienen formato válido y que ninguna clave foránea quedó huérfana.

**No prueba** —y es deliberado— que una nota clínica se pueda **leer**. El
ensayo automático no recibe ninguna clave clínica: tenerla en GitHub Actions
sería poner la clave de todo el histórico en un lugar más. Con ENC2 censa los
ids de clave de cada blob contra `CLAVES_CIFRADO_IDS` y detecta lo que importa
sin abrir nada: si hay datos que ningún llavero conocido abre. Con ENC1 —que
es lo que hay hoy en producción, 123 blobs sin identificador de clave— ni
siquiera puede eso: sólo confirma el formato.

**Qué haría falta para que el automático demostrara el descifrado de punta a
punta sin exponer datos ni claves reales:** que el ensayo, ya con la base
restaurada, escriba en ella una fila propia —un paciente y una sesión
inventados por el test— cifrada con una clave **generada en la corrida**, y
después la lea. Eso ejercita el código de descifrado completo contra el
esquema restaurado, sin que la clave real ni una nota real entren nunca al
runner. Lo que esa variante **sigue sin probar** es que las claves que abren
los datos **históricos** existan y estén guardadas, que es justamente lo que
el ensayo manual con el llavero verifica. Por eso el manual no se reemplaza:
se complementa. Hoy no está hecho; queda anotado acá como la mejora que vale
la pena si el ensayo manual se vuelve difícil de sostener.
