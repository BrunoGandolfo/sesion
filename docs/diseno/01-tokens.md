# Los tokens de diseño

Sesión es una herramienta de trabajo: se abre entre paciente y paciente, en el
teléfono o en la computadora, y tiene que dejarse leer rápido. Por eso el
diseño es denso y sobrio. Pocos colores, dos letras, tres velocidades y una
sola forma de moverse.

Todo lo de esta página ya existe en el código. Entre paréntesis está dónde
vive cada valor; si alguna vez no coinciden, manda el código y esta página se
corrige. La versión para agentes de lo mismo es
`.claude/skills/diseno-sesion/SKILL.md`.

## Colores

La paleta es cerrada: una pantalla nueva no trae un color nuevo
(`docs/diseno/04-personaje.md:6-7`). Todos los valores salen de
`src/app/globals.css`.

| Nombre | Valores | Qué quiere decir |
|---|---|---|
| Salvia (`sage`) | del 50 #F3F6F4 al 900 #1A2A24; el central, 500, es #4F7A6A (`globals.css:10-20`) | La marca. Botón principal, lo activo, el foco. |
| Salvia para texto | #4A7364 (`globals.css:51`) | La salvia un punto más oscura, para que el texto se lea bien. |
| Crema (`cream`) | 50 #FAFAF6, 100 #F4F0E8, 200 #E8E1D2 (`globals.css:23-25`) | El papel. El 50 es el fondo de toda la app (`globals.css:102`). |
| Tinta (`ink`) | 900 #1A2628, 700 #3F4F52, 500 #627072, 300 #A5B0B2 (`globals.css:28-34`) | El texto: principal, secundario, datos de apoyo, apagado. |
| Terracota (`terracotta`) | 50 #FBF3EB, 100 #F5E0CC, 500 #9A5C3B, 600 #8F5436 (`globals.css:36-40`) | Deudas, advertencias y riesgo. Nada más. |
| Oro (`gold`) | 50 #FAF4E4, 500 #866929 (`globals.css:42-44`) | Acento editorial, de a poco. |
| Estados | éxito #4F7A6A, aviso = terracota 500, error #8F4B48, información #4A6B7D (`globals.css:62-65`) | Mensajes de resultado. |
| Bordes | sutil = crema 200, fuerte #C4BDAE, control #858C86, foco = salvia 500 (`globals.css:90-94`) | Separar bloques; marcar el límite de un campo; mostrar el foco. |

Cada color de texto está medido contra los fondos de la app y pasa AA; las
cuentas están escritas al lado de cada valor en `globals.css`.

## Letras

| Familia | Dónde se usa | Pesos |
|---|---|---|
| Fraunces | Sólo títulos: el título de cada pantalla, de cada sheet, de cada sección (`src/lib/fonts.ts:3-8`, `globals.css:78`) | 400 a 700; en la app, 500 |
| Plus Jakarta Sans | Todo lo demás: texto, botones, rótulos, campos, números (`src/lib/fonts.ts:10-15`, `globals.css:79`, `:101`) | 400 a 700 |

Los números van siempre en Jakarta con cifras de ancho fijo (`tabular-nums`),
para que una columna de importes quede alineada (`globals.css:113-121`).

### Tamaños

Hoy cada componente escribe su tamaño a mano. Esta es la escala propuesta,
armada con los tamaños que más se repiten; ninguno baja de 12 px.

| Paso | Tamaño | Para qué | Ejemplo en el código |
|---|---|---|---|
| Meta | 12 px | Rótulos en mayúscula, fechas, notas al pie | `src/components/layout/cabecera-usuario.tsx:75` |
| Secundario | 13 px | Texto de apoyo, filas de lista | `src/components/ui/guardado-campo.tsx:8` |
| Cuerpo | 14 px | Texto corriente | `src/components/grabacion/HotWordsManager.tsx:443` |
| Campo | 15 px | Lo que se escribe en un campo | `src/components/ui/input.tsx:53` |
| Título chico | 16 px | Título de un bloque (Fraunces) | `src/components/ui/plegable.tsx:60` |
| Título de sección | 18 px | Título de sección (Fraunces) | `src/app/(dashboard)/pacientes/[id]/_components/graficos/base.tsx:166` |
| Título de sheet | 22 px | Encabezado de un formulario (Fraunces) | `src/components/forms/nuevo-turno-form.tsx:424` |
| Título de pantalla | 30 px | Título de pantalla en la computadora (Fraunces) | `src/app/(dashboard)/agenda/_components/agenda-header.tsx:62` |

Lo que hoy está en 10 u 11 px sube a 12 cuando se toque ese archivo. Los
tamaños grandes de la entrada (`/login`) y del total de Cobros son de esas
dos pantallas y no se copian.

## Espacio

| Regla | Valor | De dónde |
|---|---|---|
| Grilla | 4 px: cada paso de espacio de Tailwind es 4 px | Escala de Tailwind v4, que `@theme` no redefine (`globals.css:9-80`) |
| Blanco táctil | 44 px de alto para todo lo que se toca | `min-h-11` en `src/components/ui/select.tsx:11` |

## Radios

| Nombre | Valor | Para qué |
|---|---|---|
| sm | 6 px (`globals.css:68`) | Campos, botones chicos |
| md | 10 px (`globals.css:69`) | Tarjetas, botones |
| lg | 14 px (`globals.css:70`) | Sheets, paneles grandes |
| xl | 20 px (`globals.css:71`) | Casos excepcionales |

Cuanto más chico el elemento, más chico el radio.

## Sombras

| Nombre | Valor | Para qué |
|---|---|---|
| subtle | `0 1px 2px rgba(26,38,40,.04), 0 1px 3px rgba(26,38,40,.06)` (`globals.css:74`) | Lo que se apoya sobre el fondo |
| raised | `0 2px 4px rgba(26,38,40,.04), 0 4px 12px rgba(26,38,40,.08)` (`globals.css:75`) | Lo que flota: sheets, menús, avisos |

Casi todo lo demás se separa con un borde, no con sombra.

## Movimiento

Todo sale de `src/lib/movimiento.ts`, que el layout publica como variables
CSS (`src/app/layout.tsx:36`).

| Nombre | Duración | Para qué |
|---|---|---|
| Breve | 150 ms (`src/lib/movimiento.ts:2`) | Cambios de color, entradas, el check de "guardado", avisos |
| Navegación | 180 ms (`movimiento.ts:2`) | Pasar de una pantalla a otra |
| Pliegue | 220 ms (`movimiento.ts:2`) | Abrir y cerrar un bloque, un sheet |

| Curva | Valor | De dónde |
|---|---|---|
| Suave | `cubic-bezier(0.16, 1, 0.3, 1)`: arranca rápido y frena despacio | `src/lib/movimiento.ts:3`, aplicada a todo en `globals.css:170` |

Los totales y los indicadores no se mueven. Si el teléfono o la computadora
piden movimiento reducido, la app queda quieta (`globals.css:172-178`). La
única cosa que gira en loop es el indicador de "escribiendo la nota", porque
son minutos y un anillo quieto parece colgado (`globals.css:163-168`).

## Lupita

El personaje tiene su propia página: `docs/diseno/04-personaje.md`. Lo corto:
aparece en la ayuda, los estados vacíos, el onboarding y al cobrar o aprobar;
nunca en la nota clínica, el brief, el Recorrido ni cerca de una señal de
riesgo. Tres poses, colores salvia y oro, nunca terracota, sin loops.

## Lo que no se hace

Números decorativos (01, 02, 03), itálicas de adorno, degradés, transiciones
de "todo" (`transition-all`), el mismo radio grande en todo, vidrio esmerilado,
cosas que laten o giran solas, confeti, duraciones escritas a mano, sombras
en cada tarjeta y modo oscuro. La lista completa, con el porqué, está en el
skill.
