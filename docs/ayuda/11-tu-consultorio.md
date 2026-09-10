# Tu consultorio

**Para qué sirve.** Es la configuración: quién sos, cuánto cobrás, con qué
enfoque trabajás, qué recordatorio reciben tus pacientes y tu cuenta.

**Cómo llegar.** En la computadora, **Tu consultorio** en el menú de la
izquierda. En el teléfono, tocando tu avatar y tu nombre arriba en **Hoy** o en
**Cobros**.

**Todo se guarda solo**, un segundo y medio después de que dejás de escribir.
Arriba a la derecha aparece *Guardando…* y después *Guardado.* Si algo falla:
*"No se pudo guardar. Revisá los campos marcados."*, con **Reintentar**.

## Vos

| Campo | Qué hace |
| --- | --- |
| **Nombre** | *"Como querés que te nombren los pacientes"*. Va al final de cada recordatorio y aparece en el texto de la autorización de grabación. Es obligatorio: sin él dice *"Falta tu nombre"*. |
| **Dirección del consultorio** | Aparece en la autorización que firma la paciente, y en el recordatorio si insertás la ficha **Dirección**. |
| **Teléfono** | El número al que la paciente escribe para cambios. Va al final de cada recordatorio. |

Debajo lo dice la app: *"Tu nombre y tu teléfono van al final de cada
recordatorio, para que la paciente sepa a quién escribirle."*

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
  **+ Dirección**). No puede quedar vacío.
- **Así lo recibe la paciente** — la vista previa, con datos de ejemplo y tus
  datos reales.

El detalle completo está en `06-recordatorios-sms.md`.

## Cuenta

Tu nombre, tu email, **Cambiar contraseña** y **Cerrar sesión**. Ver
`01-entrar-y-cuenta.md`.

## Qué hace la app por detrás

Cada campo se guarda por separado y solo si es válido: si la tarifa quedó vacía,
lo demás se guarda igual y la tarifa queda marcada. La configuración es de todo
el consultorio, no de un dispositivo: cambiarla desde el teléfono la cambia
también en la computadora.

## Lo que NO hace

- **No hay logo, ni colores, ni tema oscuro** para elegir.
- **No hay horario de atención** ni días laborables configurables.
- **No hay duración por defecto del turno**: se elige en cada turno (viene 50).
- **No cambia el momento del recordatorio por paciente**: es uno para todos.
- **No cambia el texto de "Recordar cobro"** de Cobros: ese no es configurable.
- **No cambia el texto de la autorización** de grabación.
- **No hay segunda usuaria** ni permisos que repartir.

## Invitar a una colega

1. En **Tu consultorio**, buscá **Invitar a una colega** y tocá **Generar enlace**.
2. Usá **Copiar** o **Compartir por WhatsApp**. La app abre WhatsApp con el texto;
   vos elegís a quién mandarlo y confirmás el envío.
3. Tu colega abre el enlace, completa su nombre, email y contraseña dos veces,
   acepta los términos y la política de privacidad y toca **Crear mi cuenta**.

El enlace vence en **7 días** y se usa una sola vez. Si venció o ya se usó,
tu colega necesita pedirte otro. Compartilo sólo con ella.

La invitada tiene **un consultorio nuevo y separado**, con configuración vacía
y tarifa inicial 0. No ve tus pacientes, turnos ni notas, y vos no ves los suyos.
Al terminar entra a **Hoy**, donde Pendientes le muestra los primeros pasos.
Si la cuenta se creó pero el acceso quedó bloqueado por intentos, puede entrar
más tarde desde la pantalla de entrada: no necesita registrarse otra vez.

<!-- fuentes:
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/config/_components/editor-recordatorio.tsx
src/app/api/config/route.ts
src/lib/recordatorios-programacion.ts
src/lib/sms-texto.ts
src/lib/consentimiento.ts
src/lib/deudas.ts
src/app/api/turnos/route.ts
src/app/(dashboard)/pacientes/_components/nuevo-paciente-form.tsx
src/components/layout/cabecera-usuario.tsx
src/components/layout/sidebar.tsx
src/lib/glosario.ts
-->
