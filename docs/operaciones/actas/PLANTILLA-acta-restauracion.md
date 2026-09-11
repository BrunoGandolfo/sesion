# Acta de ensayo de restauración

Copiar este archivo a `docs/operaciones/actas/AAAA-MM-DD-restauracion.md`
(la fecha adelante es lo que lee `scripts/ci/acta-vigente.mjs`: sin un acta
de menos de 100 días, el CI se pone rojo). Rellenar todo. Nada de acá lleva
texto clínico: donde dice "primeras palabras" se pone **sí/no**, no las
palabras.

- **Fecha:**
- **Ejecutó:**
- **Archivo:** `backups/sesion-backup-AAAA-MM-DD-HHMMSS.dump.gpg` — fecha del backup:
- **Destino:** (contenedor local / rama efímera de Neon; nunca producción)
- **Duración total:** (bajar + descifrar + restaurar + verificar)

## Conteo de filas por tabla

Pegar el `resultado.json` que escribe `node scripts/ensayo/verificar-restauracion.mjs`
(o la tabla de conteos), y comparar a ojo con lo que se espera del
consultorio en esa fecha.

## Prefijo de cifrado verificado (ENC1/ENC2 en toda columna `*_encrypted`)

sí / no — otros: (número; tiene que ser 0)

## Claves foráneas

(constraints verificadas / violaciones; tiene que ser 0)

## Nota clínica descifrada y leída

Es lo único que el ensayo automático NO hace, y es el motivo de que exista
este ensayo a mano: prueba que la clave vigente (`CLAVES_CIFRADO`) todavía
abre lo que está en el backup.

- ¿Se descifró una nota? sí / no
- Sesión: `<id>`
- ¿Las primeras palabras del campo *subjetivo* se leen? sí / no (no se transcriben)
- Clave usada: id `<n>` del llavero (nunca el valor)

## Problemas encontrados

## Próximo ensayo

Fecha (a los tres meses, como mucho a los 100 días):
