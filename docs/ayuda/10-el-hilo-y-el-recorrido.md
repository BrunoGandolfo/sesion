# El hilo y el Recorrido

**Para qué sirve.** El hilo es la memoria del proceso de cada paciente; el
Recorrido, cómo se ve ese proceso en el tiempo.

## El hilo

Está en la ficha, pestaña **Recorrido**, arriba de todo. Un proceso automático
intenta incorporar las notas aprobadas. Aprobar no confirma que el hilo ya esté
actualizado: esa tarea puede quedar pendiente o fallar. Seis bloques:

- **Hipótesis diagnóstica** — podés editarla. El modelo recibe instrucciones
  para respetar lo que formulaste; revisá que la actualización las cumpla.
- **Objetivos terapéuticos** — con su fecha de inicio y su estado: **Activo**,
  **Pausado** o **Cerrado**. Editando los agregás y cambiás su estado.
- **Intervenciones probadas** — se acumulan solas: técnica, eficacia percibida
  (alta / media / baja) y en cuántas sesiones apareció.
- **Temas recurrentes** — cada uno con su cuenta.
- **El recorrido hasta hoy** — el resumen acumulado, con el chip *Generado por
  IA*. Se agrega un párrafo por sesión aprobada, que empieza con *"Sesión del …:
  "*. La conservación de los párrafos anteriores depende de la actualización.
- **Señales anteriores** — todas, con su fecha, de la más reciente a la más
  vieja.

El hilo no es un historial inmutable: una actualización automática puede
reemplazar contenido y pisar una corrección. Revisá los objetivos, temas y
señales después de una actualización; no des por preservado todo lo anterior.

Arriba hay un chip: **Revisado** (verde) o **"Actualizado tras la última sesión ·
revisalo"** (dorado). Con el dorado aparece además: *"Lo escribió la IA después
de la última sesión. Revisalo y guardalo."* Con **Editar** y después
**Guardar**, queda revisado por vos.

## El brief antes de la sesión

- **"Para retomar"**, en la pestaña **Sesiones**: la señal de riesgo, qué pasó la
  última vez, el **Progreso percibido**, **Para la próxima** y un extracto del
  hilo. Si la última nota está sin aprobar, avisa que *"lo de arriba puede
  cambiar cuando la apruebes"*.
- **La versión corta**, en la tarjeta de **Hoy** y en el turno de la agenda: dos
  líneas para leer de pie.

El brief toma la última nota aprobada disponible, aunque haya una revisión más
reciente. Si no hay aprobadas, puede usar un borrador. La advertencia de falta
de aprobación no aparece en todas las vistas: comprobá la nota de origen si
necesitás saber qué fue revisado. Abrir el brief no genera una nota nueva.

## El Recorrido ("Cómo va")

Debajo del hilo, plegable. **Los gráficos aparecen a partir de la tercera sesión
grabada y aprobada**; antes dice *"Todavía no hay suficiente recorrido."*

El selector de período ofrece **Últimas 10** (el default), **3 meses**, **6
meses** y **Todo**, y queda guardado en la dirección de la página.

### Los gráficos

- **Señales de riesgo** — todas, por fecha: *"No se agrupan ni se ocultan."*
- **Intensidad emocional** — *"Cómo llegó a cada sesión, del 1 al 10."* Los
  puntos en terracotta son sesiones con señal de riesgo.
- **Alianza terapéutica** — *"Calidad del vínculo."* Las caídas en terracotta son
  posibles rupturas.
- **Temas** — *"Qué se repite en el período elegido."* Cada uno con su tendencia
  (**nuevo**, **↑ sube**, **↓ baja**, **= estable**) y *"desde 4 mar"*.
- **Intervenciones** — cantidad y tipo por sesión.
- **Progreso percibido** y **Observación IA** — de la **última sesión del
  período**, con su fecha y el enlace **Ver la sesión**.

### Los huecos y los alcances

Donde la sesión no registró el dato, la línea **se corta**: *"no se completa por
interpolación"*. El hueco es un dato que no se pudo evaluar, no un cero.

Intensidad, alianza e intervenciones muestran el período elegido; **los temas y
las señales de riesgo se cuentan sobre todas las sesiones**.

## Lo que NO hace

- **No proyecta ni pronostica**: no dice "va mejorando" salvo que la nota lo diga.
- **No borra ni condensa** el resumen acumulado.
- **No cuenta sesiones sin aprobar**: el hilo se mueve al aprobar.
- **No muestra el ratio de habla**: el dato existe, pero no se grafica.
- **No compara pacientes.**

<!-- fuentes:
src/app/(dashboard)/pacientes/[id]/_components/recorrido-tab.tsx
src/components/clinico/ContextoGoldenThreadView.tsx
src/app/(dashboard)/pacientes/[id]/_components/brief-pre-sesion.tsx
src/components/clinico/brief-corto.tsx
src/app/(dashboard)/pacientes/[id]/_components/graficos/contenedor.tsx
src/app/(dashboard)/pacientes/[id]/_components/graficos/selector-rango.tsx
src/app/api/_lib/casos-uso/progreso-clinico.ts
src/lib/glosario.ts
processor/prompts/update_context_v2.0.md
docs/pipeline.md
-->
