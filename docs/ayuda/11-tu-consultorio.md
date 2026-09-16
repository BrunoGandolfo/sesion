# Tu consultorio

**Para qué sirve.** Es la configuración: quién sos, cuánto cobrás, con qué
enfoque trabajás, qué recordatorio reciben tus pacientes y tu cuenta.

**Cómo llegar.** En la computadora, **Tu consultorio** en el menú de la
izquierda. En el teléfono, con el **engranaje** de arriba a la derecha, que está
en Hoy, Agenda, Pacientes, Cobros y la ficha. Tocar tu nombre no lleva a ningún
lado.

Los cambios válidos se guardan un segundo y medio después de que dejás de escribir.
Esperá a ver **Guardado** antes de salir; salir antes puede cancelar lo pendiente.
Arriba a la derecha aparece *Guardando…* y después *Guardado.* Si algo falla:
*"Hay cambios sin guardar. Revisá los datos y reintentá."*, con **Reintentar**.

## Vos

| Campo | Qué hace |
| --- | --- |
| **Nombre** | *"Como querés que te nombren los pacientes"*. Va **al principio** de cada recordatorio, después de "Consultorio", y aparece en el texto de la autorización de grabación. Es obligatorio: sin él dice *"Falta tu nombre"*. |
| **Dirección del consultorio** | Aparece en la autorización que firma la paciente, y en el recordatorio si insertás la ficha **Dirección**. |
| **Teléfono** | El número al que la paciente llama para cambios. Va al final de cada recordatorio: *"Cambios: llamar al …"*. |

Debajo lo dice la app: *"Tu nombre y «Consultorio» van al principio de cada
recordatorio. Para cambios, el mensaje indica que te llamen al teléfono
configurado."*

## Lo que cobrás por sesión

Un número en **$UYU**, entero y no negativo. Es la tarifa que se **propone** al
crear un paciente nuevo: *"Cada paciente puede tener la suya."*

**Cambiarla no cambia nada de lo ya cargado**: ni la tarifa de los pacientes que
ya existen, ni la de los turnos ya agendados (cada turno se queda con la tarifa
que tenía la paciente el día que lo creaste).

## Tu enfoque

Dos opciones, con radio button:

- **Gestalt** — *Feedback con GTFS (Gestalt Therapy Fidelity Scale)*
- **Cognitivo-conductual** — *Feedback con CTS-R (Cognitive Therapy Scale —
  Revised) + MITI 4.2.1 (Motivational Interviewing Treatment Integrity)*

Lo dice la propia pantalla: *"Es una decisión clínica: define con qué instrumento
se lee tu práctica en cada sesión. Podés cambiarla cuando quieras; las sesiones
ya analizadas conservan el instrumento con que se generaron."*

**Solo cambia el bloque "Para vos"** de las notas futuras. La nota SOAP se
escribe igual con los dos enfoques.

## Recordatorio

- **Cuándo se avisa** — **El día anterior** (20:00), **Dos días antes** (20:00) o
  **La misma mañana** (8:00). Vale para todos los turnos, y afecta a los turnos
  que agendes o reprogrames de ahí en adelante.
- **Mensaje** — el texto con fichas (**+ Nombre**, **+ Fecha**, **+ Hora**,
  **+ Dirección**). No puede quedar vacío. El consultorio y tu nombre van al
  principio y la línea para llamar al final; si los borrás, se agregan solos.
  La pantalla advierte: *"No pidas respuestas por SMS: no llegan."*
- **Así lo recibe la paciente** — la vista previa, con datos de ejemplo y tus
  datos reales.

Los avisos no salen a la hora en punto sino con unos minutos de corrimiento. El
detalle completo está en `06-recordatorios-sms.md`.

## Vocabulario

*"Palabras que la transcripción tiene que escuchar bien: términos clínicos,
modismos y nombres propios."* Hay dos listas:

- **De todas tus sesiones** — *"Se usa en cada sesión que grabes, de cualquier
  paciente."*
- **Tuyo** — *"Las palabras de tu enfoque y tu manera de escribir."*

Con **Carga masiva** pegás una lista separada por comas o saltos de línea, y
**Quitar** saca una palabra. Cada ficha de paciente tiene además su propio
**Vocabulario de esta persona**.

El vocabulario viaja a AssemblyAI junto con el audio y puede incluir nombres
propios. Ver `12-camino-del-audio-y-privacidad.md`.

## Cuenta

Tu nombre, tu email, **Cambiar contraseña**, **Cerrar sesión** y
**Cerrar sesión en los demás dispositivos**. Al cambiar la contraseña se
cierran todos los accesos, incluido este. Cerrar solo las otras sesiones
mantiene abierta la actual. Ver
`01-entrar-y-cuenta.md`.

## Qué hace la app por detrás

Los cambios pendientes se envían juntos. **Si un campo del lote es inválido,
no se guarda ninguno de esos cambios.** Corregí los campos marcados y tocá
**Reintentar**; esperá la confirmación **Guardado** antes de salir.
La configuración es de todo el consultorio: los cambios guardados también
se ven en la computadora.

## Lo que NO hace

- **No hay logo, ni colores, ni tema oscuro** para elegir.
- **No hay horario de atención** ni días laborables configurables.
- **No hay duración por defecto del turno**: se elige en cada turno (viene 50).
- **No cambia el momento del recordatorio por paciente**: es uno para todos.
- **No cambia el texto de "Recordar cobro"** de Cobros: ese no es configurable.
- **No cambia el texto de la autorización** de grabación.
- Cada cuenta tiene su propio consultorio; invitar no comparte el tuyo.

## Invitar a una colega

1. En **Tu consultorio** buscá **Invitar a una colega** y tocá **Generar enlace**.
   La sección aparece siempre, pero solo algunas cuentas tienen permiso para
   invitar: si la tuya no, dice *"No podés invitar desde esta cuenta."*
2. Usá **Copiar** o **Compartir por WhatsApp** y compartí el enlace de forma
   privada con tu colega.
3. Tu colega abre el enlace, completa su nombre, email y contraseña dos veces,
   acepta los términos y la política de privacidad y toca **Crear mi cuenta**.

Podés tener hasta **2 invitaciones vigentes**. Si llegaste al límite, dice *"Ya
tenés 2 invitaciones vigentes. Esperá a que se usen o venzan."* El enlace vence en **7 días** y se usa una sola vez. Si venció o ya se usó,
tu colega necesita pedirte otro. Compartilo sólo con ella.

La invitada tiene **un consultorio nuevo y separado**, con configuración vacía
y tarifa inicial 0. No ve tus pacientes, turnos ni notas, y vos no ves los suyos.
Al crear la cuenta ya queda adentro y entra a **Hoy**, donde Pendientes le
muestra los primeros pasos, empezando por *"Cargá tu tarifa"*. Mientras la
tarifa sea 0, el alta de paciente la propone en 0 y hay que escribir una mayor.

<!-- fuentes:
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/config/_components/editor-recordatorio.tsx
src/app/api/config/route.ts
src/lib/recordatorios-programacion.ts
src/lib/consentimiento.ts
src/lib/deudas.ts
src/app/api/turnos/route.ts
src/app/(dashboard)/pacientes/_components/nuevo-paciente-form.tsx
src/components/layout/cabecera-usuario.tsx
src/components/layout/sidebar.tsx
src/app/(dashboard)/config/_components/mensaje-recordatorio.tsx
src/app/(dashboard)/config/_components/vocabulario-seccion.tsx
src/app/(dashboard)/config/_components/invitar-colega.tsx
src/app/api/_lib/casos-uso/registrar-cuenta.ts
src/app/api/cuenta/registro/route.ts
src/lib/sms/texto.ts
src/lib/glosario.ts
-->
