# Referencias

Once productos y tres guías. De cada uno: qué hace bien, **qué principio se
toma**, y **qué no se toma** y por qué no encaja con una psicóloga de 52
años que abre la app entre paciente y paciente.

No se copia nada. Ninguna de estas apps es competencia directa de Sesión en
el mismo mercado; lo que se mira es cómo resuelven problemas que ya
tenemos planteados en el código.

Los enlaces son a las páginas oficiales de cada producto. No los abrí desde
esta sesión: son las URL canónicas conocidas de cada uno, para que Bruno
pueda ir a mirar.

---

## Gestión de consulta

### 1. SimplePractice — https://www.simplepractice.com
**Qué hace bien.** El calendario es la aplicación entera: todo el trabajo
del día se hace desde el turno, sin ir a otra pantalla a cobrar o a
documentar. Las notas clínicas viven pegadas a la cita que las originó.
**Qué se toma como principio.** *La unidad de trabajo es el turno, no el
módulo.* Sesión ya lo hace bien en `session-row.tsx:69-106`: una fila, una
acción, decidida por el estado del turno y no por la pantalla donde está.
Vale reforzarlo, no reinventarlo.
**Qué NO se toma.** La densidad. SimplePractice pone doce elementos
tocables en la vista de un turno porque su usuario es una clínica con
recepción y facturación de seguros. Mariana necesita **una** acción por
momento: la que no se puede saltear. Tampoco se toma su onboarding por
formularios largos.

### 2. Jane — https://jane.app
**Qué hace bien.** El tono. La interfaz habla como habla una recepcionista
amable, sin jerga de software, y los estados vacíos explican qué va a pasar
después en vez de decir "no hay datos".
**Qué se toma como principio.** *Un estado vacío enseña el próximo paso.*
Ya está aplicado en `day-view.tsx:55-87` y `cobros-view.tsx:575-608`:
ícono, titular, tres líneas, un botón. Es el patrón correcto y conviene
que no aparezca un cuarto formato.
**Qué NO se toma.** El azul clínico y los íconos con relleno: Jane se ve
como un consultorio médico, y la dirección de Sesión es la contraria
—madera, papel, luz—. Tampoco su navegación de siete secciones.

### 3. Cliniko — https://www.cliniko.com
**Qué hace bien.** Velocidad percibida: el calendario responde antes de que
termine de cargar, y las pantallas no parpadean al refrescar.
**Qué se toma como principio.** *Los datos que ya se leyeron no se vuelven a
pedir con la pantalla en blanco.* Sesión ya cachea rangos de la agenda
(`agenda-view.tsx:142-185`) y muestra "Actualizando…" en vez de un
esqueleto (`agenda-view.tsx:345-347`). Es la misma idea y hay que
extenderla a Hoy después de cobrar (delta D12 del plan de movimiento).
**Qué NO se toma.** Su estética utilitaria de tabla. Cliniko asume un
usuario que vive todo el día en la app; Mariana entra 8 a 12 veces por
minutos.

### 4. Upheal — https://www.upheal.io
**Qué hace bien.** Es lo más cercano que hay a lo que hace Sesión: graba la
sesión y devuelve un borrador de nota. Acierta en separar visualmente *lo
que dijo el modelo* de *lo que aprobó la profesional*, y en no esconder la
transcripción.
**Qué se toma como principio.** *El borrador se nombra borrador hasta que
alguien lo firma.* Sesión ya lo hace con el chip de estado
(`nota-sesion-view.tsx:99-101`) y con "Ver el borrador original"
(`nota-sesion-view.tsx:158-174`). Es el principio que sostiene todo el
producto y hay que protegerlo de cualquier simplificación futura.
**Qué NO se toma.** El tablero de métricas de sesión con gráficos de
"engagement" al frente. En Sesión el equivalente —los gráficos del
Recorrido— vive en una pestaña de la ficha y se abre a propósito
(`recorrido-tab.tsx:25-28`), que es donde corresponde: son para pensar el
proceso, no para mirar al pasar.

---

## Calma y movimiento ejemplar

### 5. Headspace — https://www.headspace.com
**Qué hace bien.** El movimiento nunca compite con la lectura: todo entra
con fundidos cortos y desplazamientos mínimos, y lo único que se mueve en
bucle es lo que efectivamente está ocurriendo (la respiración guiada).
**Qué se toma como principio.** *Un solo elemento en bucle por pantalla, y
sólo si algo está pasando de verdad.* Es exactamente la regla del `Latido`
(`movimiento.tsx:255-261`), usada en la sesión en curso
(`card-ahora.tsx:183`) y en el REC de la grabación
(`grabar-view.tsx:461`). Nada más debería latir.
**Qué NO se toma.** Las ilustraciones a pantalla completa y las
animaciones de recompensa. Headspace es una app de consumo que necesita
que vuelvas; Sesión necesita que ella termine rápido y se vaya.

### 6. Calm — https://www.calm.com
**Qué hace bien.** Una sola cosa por pantalla, con muchísimo aire y
tipografía grande.
**Qué se toma como principio.** *El aire es información: dice qué es
importante.* La pantalla de grabar ya está construida así
(`grabar-view.tsx:280`, un botón de 132 px centrado y nada más) y es la
mejor pantalla de la app.
**Qué NO se toma.** Las fotos de fondo y los degradados. En Sesión el fondo
es crema plano (`globals.css:99-105`) y tiene que seguir siéndolo: la nota
clínica se lee sobre él.

### 7. Oak — https://www.oakmeditation.com
**Qué hace bien.** Es la prueba de que se puede hacer una app de calma sin
mascota, sin racha, sin notificaciones y sin gamificación. Vacío casi
total, y funciona.
**Qué se toma como principio.** *Sacar antes de agregar.* Sirve de contraste
para el documento del personaje: Oak demuestra que un personaje no es
obligatorio, y por eso el personaje de Sesión tiene que ganarse su lugar en
contextos muy acotados (ver `04-personaje.md`).
**Qué NO se toma.** Su ascetismo total. Sesión tiene momentos de trabajo
administrativo —cobrar, agendar— que se benefician de una confirmación
cálida; Oak no tiene ninguno.

---

## Micro-interacciones y productividad

### 8. Linear — https://linear.app
**Qué hace bien.** Cada transición dura entre 100 y 200 ms y tiene un
motivo; nada se mueve porque sí. Las listas responden antes que la red.
**Qué se toma como principio.** *La duración es parte del significado: si no
podés decir qué significa el movimiento, sacalo.* Es la doctrina que ya
está escrita en la cabecera de `movimiento.tsx:13-33`, y por eso este
proyecto tiene siete primitivos y no una biblioteca.
**Qué NO se toma.** Los atajos de teclado como interfaz principal, la
densidad de información y el modo oscuro por defecto. Mariana toca con el
pulgar, de pie, con una paciente entrando.

### 9. Notion Calendar — https://www.notion.com/product/calendar
**Qué hace bien.** El "hoy" siempre es evidente, y moverse entre días o
semanas no cambia de contexto: el encabezado se mantiene y sólo cambia el
contenido.
**Qué se toma como principio.** *Navegar el tiempo no debe repintar la
pantalla.* La agenda de Sesión ya lo respeta (el encabezado de
`agenda-header.tsx:58-127` no se remonta al cambiar de día).
**Qué NO se toma.** La rejilla horaria de 24 filas. En mobile —el uso real—
Sesión dibuja la semana como día (`agenda-view.tsx:126-128`), que para seis
turnos diarios es la decisión correcta y hay que sostenerla.

### 10. Things — https://culturedcode.com/things
**Qué hace bien.** El "magic rovering": cuando algo se completa o se crea,
la lista se reacomoda con una animación de altura que muestra de dónde salió
o adónde fue. Nunca hay saltos.
**Qué se toma como principio.** *Si el contenido cambia de altura, la altura
se anima.* Es lo que `AlturaAnimada` (`movimiento.tsx:192`) ya hace en los
plegables, y lo que falta en `Confirmar` (`confirmar.tsx:86`) — delta D8.
**Qué NO se toma.** Su capa de gestos ocultos (deslizar, mantener
apretado). Todo lo que hace falta en Sesión tiene que estar visible: es la
diferencia entre una app que se aprende y una que se descubre.

### 11. Family — https://family.co
**Qué hace bien.** Es la referencia contemporánea de confirmación háptica y
visual: cuando una operación irreversible se completa, la propia superficie
que tocaste confirma, en el lugar donde tocaste.
**Qué se toma como principio.** *La confirmación ocurre donde ocurrió la
acción, no en una esquina.* Ya está implementado, y bien, en
`useConfirmacionDibujada` (`movimiento.tsx:339-353`) y en el check sobre el
método de pago elegido (`sheet-metodo-pago.tsx:77-79`). El delta D9 lo
extiende a la fila que originó el cobro.
**Qué NO se toma.** El vocabulario visual de cripto —degradados, brillos,
3D— y la celebración larga. Family celebra una transferencia durante casi
un segundo; acá el respiro es de 120 ms (`movimiento.tsx:371`) porque hay
alguien esperando del otro lado del escritorio.

---

## Guías

### 12. Apple · Human Interface Guidelines — Motion
https://developer.apple.com/design/human-interface-guidelines/motion
**Qué se toma.** Dos cosas: que el movimiento comunique jerarquía y
causalidad (de dónde salió esto, adónde fue), y el tratamiento de
*Reduce Motion* como una preferencia que se respeta **eliminando** el
movimiento, no acortándolo. Es literalmente la regla escrita en
`movimiento.tsx:31-33`; los deltas D1 y D2 existen para terminar de
cumplirla.
**Qué NO se toma.** Los patrones de navegación de iOS (push lateral entre
pantallas). Sesión es una PWA que también corre en Android y en escritorio,
y el fundido plano de `template.tsx:20` es más honesto que fingir una pila
de vistas nativa.

### 13. Material 3 · Motion
https://m3.material.io/styles/motion/overview
**Qué se toma.** El vocabulario de duraciones por tamaño de superficie: lo
chico se mueve rápido, lo grande un poco más. Es coherente con lo que ya
hay: 150 ms para un color (`--duration-fast`, `globals.css:87`), 220-280 ms
para un panel (`sheet.tsx:165`, `movimiento.tsx:165`).
**Qué NO se toma.** Las curvas *emphasized* con sobrepaso y los
contenedores que se transforman uno en otro. Todo eso llama la atención
sobre la interfaz, y acá la interfaz no debería notarse.

### 14. Emil Kowalski · *Animations on the Web* — https://animations.dev
(y sus ensayos en https://emilkowal.ski/ui)
**Qué se toma.** Tres criterios concretos: que las animaciones de
interacción vivan por debajo de 300 ms, que se anime lo barato
(transformaciones y opacidad) y no el layout, y que toda animación se pueda
interrumpir. También su defensa de `ease-out` para lo que entra, que es
exactamente la curva única del proyecto (`globals.css:86`).
**Qué NO se toma.** Su gusto por el detalle demostrativo —animaciones de
lujo en botones, listas con física—. Su público son desarrolladores mirando
una demo; el nuestro es alguien que tiene dos minutos entre sesión y sesión.

---

## Resumen de principios adoptados

1. La unidad de trabajo es el turno (SimplePractice).
2. El estado vacío enseña el próximo paso (Jane).
3. Lo ya leído no se vuelve a pedir en blanco (Cliniko).
4. El borrador se llama borrador hasta que se firma (Upheal).
5. Un solo elemento en bucle por pantalla (Headspace).
6. El aire dice qué importa (Calm).
7. Sacar antes de agregar (Oak).
8. Si no podés decir qué significa el movimiento, sacalo (Linear).
9. Navegar el tiempo no repinta la pantalla (Notion Calendar).
10. Si cambia la altura, se anima la altura (Things).
11. La confirmación ocurre donde ocurrió la acción (Family).
12. *Reduce Motion* elimina, no acorta (Apple HIG).
