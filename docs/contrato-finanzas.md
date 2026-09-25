# Finanzas: qué devuelve el servidor y qué significa cada número

`GET /api/finanzas/resumen`. Un solo pedido trae todo el tablero ya
calculado: la pantalla dibuja, no hace cuentas. Todo es **pesos uruguayos
enteros**; no hay centavos en ningún lado.

El caso de uso está en `src/app/api/_lib/casos-uso/finanzas.ts` y se puede
usar sin levantar la ruta.

## Las dos platas, que no son la misma

Es lo único que hay que entender antes de mirar el resto.

- **COBRADO** — plata que **entró**. Turnos con el pago hecho, contados en el
  mes de la **fecha de pago**. Es lo que dice el banco. No mira en qué estado
  quedó el turno: si se cobró, entró.
- **TRABAJADO** — valor del trabajo **hecho**. Turnos en estado `realizado`,
  contados en el mes de la **fecha de la sesión**, estén cobrados o no. Es lo
  que dice la agenda.

Una sesión dada el 20 de agosto y cobrada el 3 de septiembre suma a
**TRABAJADO de agosto** y a **COBRADO de septiembre**. Los dos números son
correctos y son distintos. Por eso viajan separados y con esos nombres.

De lo trabajado en un período, la parte ya cobrada —cuando sea que se haya
cobrado— es `trabajadoCobrado`, y lo que falta es `trabajadoSinCobrar`.

**No cruzar `sesionesCobradas` con `sesionesRealizadas`**: miran conjuntos
distintos y su cociente puede pasar de uno. La única división que se puede
leer como una proporción es `proporcionCobrada` (abajo).

## El mes es el de Montevideo

Los límites de mes y año se calculan siempre en hora de Montevideo (UTC-3,
sin horario de verano). Una sesión del 31 a las 23:30 es de ese mes, aunque
en UTC ya sea el día 1 del siguiente; lo mismo en el cambio de año. El
corrimiento se aplica dentro de la consulta con el mismo offset que usa toda
la app (`OFFSET_MONTEVIDEO_MIN`), y los bordes entran como literales
`::timestamp` sin zona, para que el resultado no dependa de cómo esté
configurado el servidor de base de datos.

## Parámetros

Todos opcionales.

- `desde`, `hasta` — `"AAAA-MM"`. El período va de mes entero a mes entero,
  los dos incluidos. Por defecto, **los últimos doce meses hasta hoy**.
- `granularidad` — `"mes"` o `"anio"`. Sin esto **la elige el servidor**:
  hasta **24 meses** agrupa por mes, y pasando eso, por año. La respuesta dice
  cuál quedó (`granularidad`) y si la eligió el servidor
  (`granularidadAutomatica`). Un año pedido a mano son doce barras de meses;
  diez años, diez barras de años.

Errores: 400 con un mes mal escrito, una granularidad desconocida, un período
que termina antes de empezar, o uno de más de 600 meses.

## Qué devuelve

Envuelto en `{ data: … }`, como toda la API que consume la app, y validado
contra su schema antes de salir.

### `serie` — una entrada por período, para las barras

Cada entrada trae:

- `clave` — `"2026-08"` con granularidad mes, `"2026"` con granularidad año.
  Es lo que la pantalla manda de vuelta al tocar la barra.
- `anio`, `mes` — el mes va de 1 a 12, y es `null` con granularidad año.
- `cobrado`, `sesionesCobradas` — plata que entró en ese período y cuántos
  cobros fueron.
- `trabajado`, `sesionesRealizadas` — valor de las sesiones dadas y cuántas.
- `trabajadoCobrado`, `sesionesRealizadasCobradas` — de esas sesiones, las ya
  cobradas.
- `trabajadoSinCobrar`, `sesionesRealizadasSinCobrar` — las que faltan cobrar.
  Es exactamente `trabajado - trabajadoCobrado`.
- `ausencias`, `ausenciasMonto` — turnos en estado `ausente` y cuánto
  representan con la tarifa congelada del turno. **No** están sumados en
  `trabajado` ni en `cobrado`: se muestran aparte porque la decisión de
  cobrarlas o no es de ella.
- `canceladas` — cantidad, sin monto: una sesión cancelada no vale nada.
- `pacientesDistintas` — personas distintas con al menos una sesión realizada
  en ese período. **No se pueden sumar entre períodos**: quien vino en marzo y
  en abril es una sola persona en el año, y por eso se cuenta aparte para cada
  granularidad.
- `tarifaPromedio` — `trabajado / sesionesRealizadas`, redondeado al peso más
  cercano (los medios pesos suben). `null` si no hubo sesiones: nunca un cero
  inventado.
- `cobradoPorMetodo` — lista de `{ metodo, sesiones, monto }`, de mayor a
  menor monto. Los métodos son los de `constantes-turno.ts`, más
  `sin_metodo` para un cobro que no declaró ninguno. La suma de los montos es
  siempre igual a `cobrado`.

### `totales`

El mismo objeto que una entrada de la serie, sin `clave`, `anio` ni `mes`,
para todo el período pedido. **La suma de la serie da exactamente los
totales** (menos `pacientesDistintas`, por lo dicho arriba, que se cuenta
sobre el período entero).

### `comparaciones`

Dos, ya calculadas, o `null`:

- `periodoAnterior` — el período inmediatamente anterior, del mismo largo en
  meses.
- `mismoPeriodoAnioAnterior` — los mismos meses, un año antes.

Cada una trae `cobrado`, `trabajado` y `sesionesRealizadas` de aquel período,
la `variacion…` contra el período pedido (positivo = el pedido fue mayor) y
el `porcentaje…` entero.

Dos reglas que evitan mentiras:

- La comparación entera es `null` cuando **no hay ningún dato** en esa
  ventana. Un cero ahí diría "ganaste cero" cuando la verdad es "todavía no
  existía el consultorio".
- `porcentajeCobrado` / `porcentajeTrabajado` son `null` cuando la base era
  cero: no existe "creció infinito por ciento".

Las comparaciones sólo cubren esos tres números porque son los únicos que se
pueden sumar entre meses. `pacientesDistintas` no se compara.

### `proporcionCobrada`

Para la frase "de cada diez sesiones que diste, cobraste nueve".

- `deCadaDiez` — 0 a 10, o `null` si no hubo sesiones realizadas.
- `porcentaje` — 0 a 100, o `null`.
- `sesionesRealizadas`, `sesionesRealizadasCobradas` — los dos números de
  donde sale, por si la pantalla quiere decirlos.

Mira **las sesiones realizadas del período** y cuántas de ellas están
cobradas. Un cobro viejo que entró este mes no la toca.

### `deudaHoy`

La deuda vigente **hoy**, no la del período mirado. Sale de la misma lectura y
la misma regla que `/api/deudores` y que Hoy (`esDeudaPendiente` en
`_lib/domain.ts`: turno realizado con pago pendiente), así que los tres
números cierran por construcción.

- `sesiones`, `monto` — el total.
- `tramos` — siempre los tres, en orden, con ceros si están vacíos:
  `hasta30` (hasta 30 días desde la sesión), `de31a90`, `mas90`. Cada uno con
  `sesiones`, `monto` y `pacientes`.
  **Las pacientes de los tres tramos no se suman**: quien debe una sesión
  vieja y una nueva aparece en los dos.

### `primerMesConDatos`

El mes del turno o del pago más viejo de la organización, lo que venga antes.
Es hasta dónde puede ir el botón "Todo". `null` si no hay un solo turno.

## El detalle al tocar una barra

**No hay endpoint nuevo.** Lo que hace falta ya existe:

- las sesiones **trabajadas** de un mes: `GET /api/turnos?desde=…&hasta=…`
  con los bordes del mes (caso de uso `listarTurnos`);
- las sesiones **cobradas** de un mes: `GET /api/turnos/cobros?mes=AAAA-MM`
  (también acepta un día, `AAAA-MM-DD`, y toma su mes, en hora de Montevideo).
  Sin `mes` contesta el mes actual, que es lo que pide la pantalla de Cobros.

## Lo que este endpoint NO incluye

- **Nada clínico**: ni notas, ni transcripciones, ni diagnósticos, ni el
  Recorrido. Sólo plata, cantidades y fechas.
- **Nombres de pacientes**: sólo cuántas personas distintas.
- **Ajuste por inflación.** Comparar 2016 con 2026 en pesos corrientes
  subestima el pasado, y la app no lo dice. Hacerlo bien necesita el índice de
  precios oficial del INE, que es un dato externo con su propia actualización
  y su propia forma de fallar. Queda propuesto, no hecho.
- **Metas, presupuestos y gastos del consultorio.** El sistema sólo conoce lo
  que factura; un "ganó" que ignora los gastos no es ganancia, y prometerlo
  sería peor que no tenerlo.
- **Exportar** a planilla o PDF.

## Costo

Cinco viajes a la base, **siempre los mismos**, pidas un mes o diez años:
cuatro agregados en SQL (trabajo por mes, pagos por mes y método, pacientes
distintas, y el primer turno/pago) más la lista de deuda que comparte con
`/api/deudores`. No hay una consulta por mes. Medido con 12.960 turnos
repartidos en diez años: **99 ms**.

Lo cobrado en un mes usa el índice `(organization_id, pago_fecha)`, migración
`20260923120100_turnos_pago_fecha_idx`.

## Ejemplo de respuesta

Real, generado contra la base de test: dos meses (agosto y septiembre de
2026), tres pacientes, diez turnos.

~~~json
{
  "desde": "2026-08",
  "hasta": "2026-09",
  "granularidad": "mes",
  "granularidadAutomatica": true,
  "serie": [
    {
      "clave": "2026-08", "anio": 2026, "mes": 8,
      "cobrado": 1200, "sesionesCobradas": 1,
      "trabajado": 3600, "sesionesRealizadas": 3,
      "trabajadoCobrado": 2400, "sesionesRealizadasCobradas": 2,
      "trabajadoSinCobrar": 1200, "sesionesRealizadasSinCobrar": 1,
      "ausencias": 0, "ausenciasMonto": 0, "canceladas": 0,
      "pacientesDistintas": 2, "tarifaPromedio": 1200,
      "cobradoPorMetodo": [{ "metodo": "efectivo", "sesiones": 1, "monto": 1200 }]
    },
    {
      "clave": "2026-09", "anio": 2026, "mes": 9,
      "cobrado": 3900, "sesionesCobradas": 3,
      "trabajado": 3900, "sesionesRealizadas": 3,
      "trabajadoCobrado": 2700, "sesionesRealizadasCobradas": 2,
      "trabajadoSinCobrar": 1200, "sesionesRealizadasSinCobrar": 1,
      "ausencias": 1, "ausenciasMonto": 1200, "canceladas": 1,
      "pacientesDistintas": 2, "tarifaPromedio": 1300,
      "cobradoPorMetodo": [
        { "metodo": "mercadopago", "sesiones": 1, "monto": 1500 },
        { "metodo": "efectivo", "sesiones": 1, "monto": 1200 },
        { "metodo": "transferencia", "sesiones": 1, "monto": 1200 }
      ]
    }
  ],
  "totales": {
    "cobrado": 5100, "sesionesCobradas": 4,
    "trabajado": 7500, "sesionesRealizadas": 6,
    "trabajadoCobrado": 5100, "sesionesRealizadasCobradas": 4,
    "trabajadoSinCobrar": 2400, "sesionesRealizadasSinCobrar": 2,
    "ausencias": 1, "ausenciasMonto": 1200, "canceladas": 1,
    "pacientesDistintas": 3, "tarifaPromedio": 1250,
    "cobradoPorMetodo": [
      { "metodo": "efectivo", "sesiones": 2, "monto": 2400 },
      { "metodo": "mercadopago", "sesiones": 1, "monto": 1500 },
      { "metodo": "transferencia", "sesiones": 1, "monto": 1200 }
    ]
  },
  "comparaciones": {
    "periodoAnterior": {
      "desde": "2026-06", "hasta": "2026-07",
      "cobrado": 1200, "trabajado": 1200, "sesionesRealizadas": 1,
      "variacionCobrado": 3900, "variacionTrabajado": 6300,
      "variacionSesionesRealizadas": 5,
      "porcentajeCobrado": 325, "porcentajeTrabajado": 525
    },
    "mismoPeriodoAnioAnterior": {
      "desde": "2025-08", "hasta": "2025-09",
      "cobrado": 1000, "trabajado": 1000, "sesionesRealizadas": 1,
      "variacionCobrado": 4100, "variacionTrabajado": 6500,
      "variacionSesionesRealizadas": 5,
      "porcentajeCobrado": 410, "porcentajeTrabajado": 650
    }
  },
  "proporcionCobrada": {
    "deCadaDiez": 7, "porcentaje": 67,
    "sesionesRealizadas": 6, "sesionesRealizadasCobradas": 4
  },
  "deudaHoy": {
    "alDia": "2026-09", "sesiones": 2, "monto": 2400,
    "tramos": [
      { "tramo": "hasta30", "sesiones": 2, "monto": 2400, "pacientes": 2 },
      { "tramo": "de31a90", "sesiones": 0, "monto": 0, "pacientes": 0 },
      { "tramo": "mas90", "sesiones": 0, "monto": 0, "pacientes": 0 }
    ]
  },
  "primerMesConDatos": "2025-09"
}
~~~

En ese ejemplo se ve la regla de las dos platas: la sesión del 12 de agosto se
cobró el 2 de septiembre, así que suma a `trabajado` de agosto y a `cobrado`
de septiembre.
