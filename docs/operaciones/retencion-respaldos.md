# Retención real de los respaldos

Medido el 2026-09-15 sobre `.github/workflows/backup.yml` en la rama
`respaldo-alarma` (sale de `main` en `33dbdf5`). Este documento dice lo que el
workflow **hace**, no lo que su comentario declara. Donde las dos cosas no
coinciden, está anotado.

No se corrió el workflow ni se consultó el bucket de R2: la medición es sobre
el código y sobre el comportamiento del `aws-cli`, reproducida localmente.

## El dato

| Qué | Cuánto vive | Dónde se decide |
| --- | --- | --- |
| Copia diaria (`backups/sesion-backup-<UTC>.dump.gpg`) | **30 días** | `backup.yml`, paso «Limpiar diarios…», primera llamada |
| Copia mensual (`backups/mensuales/sesion-backup-<UTC>.dump.gpg`) | **366 días** | mismo paso, segunda llamada |

La copia mensual se hace el día 1 de cada mes y es **el mismo archivo** que el
diario de ese día, copiado a otro prefijo.

**La vida máxima de un respaldo del sistema es 366 días, no 30.** Un respaldo
tomado un día 1 sobrevive alrededor de doce meses. Uno tomado cualquier otro
día vive 30.

La limpieza diaria no toca las mensuales, y eso es intencional: el prefijo que
usa es `backups/sesion-backup-`, que no alcanza a `backups/mensuales/…` porque
después de `backups/` viene `mensuales/`. Verificado leyendo las claves que
arma el paso «Calcular nombre del backup» contra los dos prefijos del paso de
limpieza.

## Cómo se midió

La parte no obvia es si el borrado **ocurre**. El paso de limpieza selecciona
qué borrar con un filtro JMESPath del `aws-cli`:

```
--query "Contents[?LastModified<'${cutoff}'].Key"
```

En JMESPath los operadores de orden (`<`, `>`) están definidos **sólo para
números**. Si `LastModified` llegara al filtro como un objeto de fecha, la
comparación devolvería nulo, el filtro no seleccionaría nada y **la retención
no borraría nunca**: los respaldos se acumularían para siempre sin que nadie se
enterara, porque el paso terminaría en verde diciendo «Nada que borrar».

Comprobado que **no** es el caso, en dos pasos:

1. Con `jmespath` 1.1.0 en Python, la misma expresión sobre los dos tipos
   posibles: con `LastModified` como texto selecciona la clave vieja; con
   `LastModified` como `datetime` devuelve lista vacía. O sea: el resultado
   depende enteramente del tipo.
2. Con el `aws-cli` **real** (v2.36.45, sobre `x86_64.ubuntu.24`, la misma
   plataforma que el runner de GitHub) contra un servidor local que imita la
   respuesta XML de `ListObjectsV2`. El CLI entrega el campo ya convertido a
   texto ISO-8601:

   ```
   $ aws s3api list-objects-v2 … --query "Contents[0].LastModified" --output json
   "2026-01-01T06:00:00+00:00"
   ```

   y con la expresión exacta del workflow selecciona correctamente sólo la
   clave anterior al corte.

**Conclusión: el borrado funciona y los números de la tabla son los reales.**

### Dos bordes que la medición dejó a la vista

- **Formato del corte.** El corte se arma con `date -u … +'%Y-%m-%dT%H:%M:%SZ'`
  (termina en `Z`) y se compara como texto contra un `LastModified` que
  termina en `+00:00`. La comparación es correcta para todo par de fechas
  distintas, porque difieren antes del sufijo. Sólo empata raro en el instante
  exacto del corte (`+` ordena antes que `Z`), y ahí borra un archivo que
  cumple exactamente 30 días. Irrelevante en la práctica.
- **Paginación.** `list-objects-v2` devuelve como mucho 1000 claves por
  llamada y el paso no pagina. Con ~30 diarias y ~12 mensuales sobra lugar.
  Si alguna vez hubiera más de 1000 objetos bajo un prefijo, la retención
  empezaría a saltear los más nuevos en silencio.

## La discrepancia con el consentimiento

**No se resolvió acá. Queda anotada para que la resuelva Bruno.**

Lo que se le muestra a la paciente, en `src/lib/consentimiento.ts:76`:

> Las copias de respaldo de la base de datos se guardan **30 días** y no
> contienen el audio, pero sí pueden contener, cifrada, la clave de un audio
> que todavía no se había borrado.

El número sale de `src/lib/consentimiento-hechos.ts:64`
(`RETENCION_BACKUPS_DIAS = 30`), y `consentimiento-hechos.ts:66` declara
`BACKUP_INCLUYE_CLAVE_AUDIO = true`.

Contra lo medido: las copias **mensuales** viven hasta 366 días y son dumps
completos, así que pueden contener esa clave cifrada durante cerca de un año.
El consentimiento declara 30.

Tres consumidores más del mismo número, para que no se corrija en un solo lado:

- `src/lib/__tests__/consentimiento.test.ts:98` fija el 30 con un `expect`.
- `docs/operaciones.md:86` dice «retención 30 días», sin mencionar las
  mensuales.
- `docs/operaciones.md:103-105` dice que una `BACKUP_ENCRYPTION_KEY` rotada se
  conserva «30 días más, lo que duran los backups». **Esto es incorrecto por
  lo mismo:** si la passphrase vieja se descarta a los 30 días, las copias
  mensuales cifradas con ella quedan ilegibles, que es justo lo contrario de
  para lo que existen. Es la consecuencia operativa más concreta de la
  discrepancia y conviene mirarla primero.

Las salidas posibles (no elegidas acá) son bajar las mensuales a 30 días,
subir el número del consentimiento, o dejar los dos y explicar la diferencia
en el texto. Es una decisión de política de datos, no técnica.
