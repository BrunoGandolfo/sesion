# Cuando algo falla

**Para qué sirve.** Síntoma por síntoma: qué revisar y qué podés hacer,
sin dar por guardado lo que todavía no se confirmó.

---

## No puedo entrar

**Ves:** *"Email o contraseña incorrectos"* y debajo *"Después de varios intentos
seguidos el acceso queda bloqueado unos minutos."*

Ese mensaje es el mismo para tres cosas distintas: contraseña equivocada, email
mal escrito, o acceso bloqueado por intentos.

**Qué hacer:**
1. Revisá el email: sin espacios de más, sin mayúsculas raras.
2. Probá la contraseña con cuidado.
3. Si ya probaste varias veces seguidas, **esperá 15 minutos y volvé**. El
   bloqueo se destraba solo. Seguir probando alarga la espera.
4. Si vuelve a fallar después de esperar, el bloqueo puede ser más largo: 30
   minutos, una hora, o cuatro horas si se repitió mucho.

Si la olvidaste, tocá **¿Olvidaste tu contraseña?** en la entrada y pedí un enlace por correo. Detalle en `01-entrar-y-cuenta.md`.

---

## La grabación se cortó

### Se cortó el micrófono en el medio

**Ves:** el estado **Cortado**, un ícono de micrófono tachado y
*"Se cortó el micrófono. Lo grabado está a salvo."*

Pasa cuando entra una llamada o cuando otra app se lleva el micrófono.

**Qué hacer:** revisá si podés **Reanudar** o **Terminar la sesión** con lo
capturado. Durante el corte no se graba. La recuperación completa no está
garantizada; no cierres ni descartes el audio mientras intentás guardarlo.

### Se cerró el navegador o se apagó el teléfono

**Qué hacer:** volvé a entrar a la pantalla de grabar de **ese mismo turno**. Si
quedó algo, la app te ofrece: *"Quedó una grabación de ~N min sin enviar"*, con
**Guardarla ahora** y **Descartarla**.

### No se pudo guardar el audio

**Ves:** *"No se pudo guardar el audio. Está a salvo en tu teléfono. Probá de
nuevo."* y un botón **Reintentar**.

Puede ser la conexión u otro fallo. La copia local puede faltar: no des por
guardado el audio hasta comprobar la confirmación de subida.

**Qué hacer:** poné el teléfono en una conexión buena (wifi mejor que datos) y
tocá **Reintentar**. Podés reintentar las veces que haga falta. Si vas a salir de
la pantalla, mejor esperá: reintentar es más fácil desde acá.

### No se pudo capturar audio

**Ves:** *"No se pudo capturar audio de la sesión."*

Se grabó silencio o el micrófono no entregó nada. **Ese audio no se recupera.**

### El micrófono no arranca

**Ves:** uno de estos, con un botón **Probá de nuevo**:
- *"No diste permiso para usar el micrófono. Habilitalo y probá de nuevo."* — hay
  que dar el permiso en el navegador.
- *"No encontramos un micrófono disponible en este dispositivo."*
- *"No pudimos acceder al micrófono. Cerrá otras apps que lo estén usando y probá
  de nuevo."* — típicamente hay otra llamada o grabación abierta.

---

## La nota no llega

### Sigue diciendo "Escribiendo la nota…"

Es normal que tarde. La pantalla se refresca sola mientras la sesión está en el
proceso.

**Qué hacer:** salí y volvé más tarde. La nota, cuando esté, aparece en **Hoy**,
en el bloque de pendientes, y en la ficha con el chip **Para revisar**.

### Dice "No pudimos escribir la nota"

La sesión quedó en error. Si el audio sigue disponible, se puede reintentar.
La pantalla ofrece estas acciones:

- **Reintentar** — vuelve a escribir la nota con el mismo audio. Es lo primero
  que hay que probar.
- **Eliminar** — *"Se borran la sesión y su audio. No queda registro y no se
  puede deshacer."* Solo si ya no querés esa sesión.

### La nota llegó rara, corta o equivocada

**Qué hacer:** tocá **Descartar**. Avisa: *"Se puede deshacer: la sesión vuelve a
error y la podés volver a escribir. Se descarta la nota generada; la
transcripción y el audio se conservan."* Después usá **Reintentar**.

Si el problema es puntual, es más rápido **editar la sección** a mano y aprobar.

### Dice "Esta sesión todavía no tiene nota"

La sesión existe pero todavía no se grabó o no se subió el audio. Volvé a la
ficha y grabá.

---

## El SMS no salió

**Dónde mirar:** abrí el turno en la agenda. En un turno agendado aparece el
bloque **Recordatorio** con su estado.

| Lo que dice | Qué pasa | Qué hacer |
| --- | --- | --- |
| **Todavía no salió** | Está en cola, esperando su hora | Nada: la app lo manda a la hora |
| **Saliendo** | Se está enviando ahora | Esperar unos minutos y volver a mirar |
| **Enviado** | Salió, con fecha y hora | Nada |
| **No se pudo enviar** | Falló las tres veces que tenía | **Volver a intentarlo** |
| **Cancelado** | El turno se canceló, se reprogramó, se cobró o se marcó "No vino" | Es lo correcto: no hay que avisar de un turno que ya no es |

**Volver a intentarlo** avisa: *"Se pone otra vez en la cola y sale en la próxima
pasada, en unos minutos. Si vuelve a fallar, lo vas a ver acá."*

Ese botón **solo aparece** si el recordatorio falló, el turno sigue agendado y la
hora todavía no pasó. Si no aparece y el turno es hoy en un rato, es más rápido
llamarla.

**Si no aparece el bloque Recordatorio:** el turno puede haberse creado con la
fecha ya pasada (una sesión que empezó sin turno previo), y en ese caso nunca
hubo recordatorio que mandar.

---

## Otros mensajes que podés ver

- **"Algo falló. Probá de nuevo."** — un problema puntual de conexión o del
  servidor. Reintentá; si sigue, esperá unos minutos.
- **"No pudimos traer la agenda."** / **"No pudimos traer los cobros."** — la
  pantalla no cargó. Siempre aclara: *"Tus turnos no se perdieron."* Tocá
  **Reintentar**.
- **"No pudimos abrir la ficha."** — lo mismo, con **Reintentar**.
- **"No se pudo cobrar. Probá de nuevo."** — el pago **no** quedó registrado.
  Volvé a intentar.
- **"No se pudo guardar. Revisá los campos marcados."** (en Tu consultorio) —
  algún campo quedó vacío o inválido: el nombre, la tarifa o el mensaje del
  recordatorio. Arreglalo y tocá **Reintentar**.
- **"El turno cambió mientras se cobraba. Probá de nuevo."** — se tocó el mismo
  turno desde dos lados a la vez. Volvé a mirar el estado antes de reintentar.
- **"Esta sesión ya está en camino."** — se quiso empezar a grabar una sesión que
  ya está subiendo o procesando. Mirá la ficha: probablemente ya está escrita.

---

## Una regla general

No confundas una opción de reintento con una garantía de recuperación.
Podés perder una grabación si falló el almacenamiento local o la descartaste;
también las correcciones de una nota si salís sin aprobar. Si hay audio
pendiente, no empieces otra grabación del mismo turno ni lo descartes.
Comprobá el estado guardado antes de salir y pedí ayuda si sigue fallando.

<!-- fuentes:
src/app/(auth)/login/page.tsx
src/lib/login-intentos.ts
src/components/grabacion/GrabadorSesion.tsx
src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx
src/hooks/useGrabacionSesion.ts
src/app/(dashboard)/sesiones/[id]/_components/sesion-detail-view.tsx
src/app/(dashboard)/agenda/_components/turno-detail-sheet.tsx
src/app/(dashboard)/agenda/_components/agenda-view.tsx
src/app/(dashboard)/cobros/_components/cobros-view.tsx
src/app/(dashboard)/pacientes/[id]/_components/paciente-detail-view.tsx
src/app/(dashboard)/config/_components/config-view.tsx
src/app/(dashboard)/_components/dashboard.tsx
src/app/api/recordatorios/[id]/reintentar/route.ts
src/app/api/_lib/casos-uso/enviar-recordatorios.ts
src/app/api/_lib/casos-uso/recordatorios-del-turno.ts
src/app/api/_lib/casos-uso/cobrar-turno.ts
src/lib/glosario.ts
-->
