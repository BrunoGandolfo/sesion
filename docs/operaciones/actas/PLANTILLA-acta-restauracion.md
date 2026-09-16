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

## Descifrado manual (`scripts/ensayo/ensayo-manual.sh`)

Es lo único que el ensayo automático NO hace, y es el motivo de que exista
este ensayo a mano: el automático no tiene ninguna clave clínica. Acá se corre
el guion con el llavero completo de la época del respaldo (`CLAVES_CIFRADO`) y
se pega su salida: descifra la nota clínica más vieja y más nueva y la versión
del Recorrido más vieja y más nueva, y dice sí/no por cada una.

- Ids de clave conocidos (del llavero, nunca los valores):
- Nota clínica más vieja descifrada y leída: sí / no — sesión `<id>`, clave `<n>`
- Nota clínica más nueva descifrada y leída: sí / no — sesión `<id>`, clave `<n>`
- Versión del Recorrido más vieja descifrada y leída: sí / no — versión `<id>`, clave `<n>`
- Versión del Recorrido más nueva descifrada y leída: sí / no — versión `<id>`, clave `<n>`
- Si alguna dijo NO: ¿el guion habló de clave ausente (falta una clave del
  llavero) o de dato corrupto? (copiar el motivo, sin texto clínico)

## Problemas encontrados

## Próximo ensayo

Fecha (a los tres meses, como mucho a los 100 días):
