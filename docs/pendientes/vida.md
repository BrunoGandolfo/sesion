# Vida — interfaz clínica

Base: `origin/main` en `da17af1`. Rama: `vida`.

## Correcciones

| Hallazgo | Resultado |
| --- | --- |
| Nota aprobada inaccesible en Agenda | La fila reconoce `aprobada`, ofrece Ver nota y no vuelve a ofrecer grabar. |
| Pérdida de trabajo al salir o descartar | Confirmación para Recorrido, nota SOAP desde la primera tecla y grabación activa. Cubre enlaces del menú, pestañas, Volver, Atrás/Adelante, recarga y cierre. También protege las notas privadas mientras esperan autoguardado y quitar elementos de un borrador. |
| Motivo incorrecto de aprobación bloqueada | Distingue menciones, señales, ambas y cambio de versión. |
| Para vos sin estados | Muestra no pedido, pendiente y fallido; usa el reintento existente y consulta el pendiente cada diez segundos. Reconcilia respuestas perdidas. No consulta mientras se edita la nota. |
| Contraste de Lupita | El aviso pasa de ink-300 a ink-500: 2,22:1 → 5,15:1 sobre blanco. |
| Agenda a 390 px | Nombre e importe completos; acciones en una fila propia en móvil. |
| Recorrido con error y carga simultáneos | El error reemplaza la espera; conserva un camino de reintento. |
| Grabar deshabilitado sin explicación | Explica la preparación y distingue falta de autorización. |
| Campos y tokens distintos | Input, Textarea y Select compartidos, bordes y radios del sistema. SOAP usa Textarea compartido. |

La comparación del Recorrido agrupa vigente/propuesta por sección: en móvil ya no obliga a leer dos documentos enteros separados para comparar el mismo apartado.

## Entrada y presencia

«Sesión acompaña tu trabajo clínico: las notas de cada encuentro, el recorrido de tus pacientes y la organización del consultorio, en un mismo lugar.»

El eslogan pasa a «Un lugar para tu trabajo clínico». Ambos textos viven en el glosario.

La grabación tiene una tarjeta con estado, duración y acciones jerarquizadas. Los botones responden al tacto con un desplazamiento inmediato de un píxel. Las listas aparecen completas, sin espera entre filas, con un desplazamiento de tres píxeles que termina en 150 ms. Se respeta movimiento reducido. Fraunces y Plus Jakarta Sans, sus archivos y configuración, siguen intactos.

## Medición

Prueba reproducible: `MEDIR_UI=1 npx vitest run pruebas/vida/interacciones.test.tsx`. Node 22, jsdom, 30 interacciones de calentamiento y 200 muestras por acción. Mide evento → actualización del componente, sin red ni pintura. No representa latencia en un teléfono físico.

| Acción | Antes p50 / p95, ms | Después p50 / p95, ms |
| --- | ---: | ---: |
| Botón (Pausar) | 0,054 / 0,126 | 0,033 / 0,122 |
| Cambiar pestaña | 0,271 / 0,451 | 0,247 / 0,370 |
| Escribir en Recorrido | 0,492 / 0,805 | 0,494 / 0,947 |

La edición mantiene una mediana de aproximadamente 0,5 ms; su p95 subió 0,142 ms en estas muestras. No se presenta como una mejora ni como garantía de velocidad idéntica en todo dispositivo. No se agregaron esperas programadas a las acciones. Las confirmaciones agregan deliberadamente un paso cuando hay trabajo en riesgo.

| Transición | Antes | Después |
| --- | ---: | ---: |
| Entrada de una fila | 180 ms, comienza invisible | 150 ms, visible desde el primer cuadro |
| Última de ocho filas | 460 ms, incluyendo espera | 150 ms, sin espera |
| Colores de botón | 150 ms | 150 ms |
| Respuesta táctil agregada | — | inmediata, sin temporizador |

## Verificación y límites

- Pruebas de regresión: nota aprobada en Agenda, motivo de bloqueo por menciones, estados/reintento/reconciliación/polling de Para vos, carga fallida de Recorrido, descarte y conservación del borrador, preparación y salida de captura, enlaces y pestañas, recarga, Atrás/Adelante y salto a entradas previas al dashboard.
- Integración: PostgreSQL 17 en Docker, contenedor propio `sesion-vida-postgres`, puerto 5441. Base de tests separada de la base de pruebas visuales.
- Navegación visual local en Edge con datos ficticios; Agenda, nota aprobada, Recorrido/editor y grabación. Comprobados 390 y 1440 px sin desborde horizontal en las pantallas inspeccionadas. Atrás y Quedarme conservaron el borrador en navegador real.
- Al saltar a una entrada anterior a la protección, History no informa su distancia: se usa confirmación nativa. Si se cancela, se repone la entrada del editor y se pierde la rama Adelante del navegador; el borrador se conserva. En entradas conocidas se conserva el historial sin entradas artificiales.
- No se probó Safari ni un teléfono físico. Cierre y recarga cuentan con la protección nativa del navegador; no cubre terminar el proceso o apagar el dispositivo.

## Decisiones y desacuerdos

Se descartaron pulsos continuos, ondas de audio simuladas, celebraciones, resortes y transiciones de página que demoran las acciones. Se mantuvieron las animaciones existentes del menú y los paneles. No se agregaron dependencias ni se reorganizaron los componentes grandes de Configuración y Cobros.

No cambiaron negocio, API, esquema, migraciones, cifrado ni worker. El texto previo de confidencialidad en la entrada no se reinterpretó: queda pendiente de la decisión del dueño sobre la promesa de respaldo local cifrado. No se tocó consentimiento ni su bandera.

No es verificable prometer que ninguna acción tardará jamás más en cualquier teléfono. Se informan los tiempos observados, su alcance y la pequeña variación de edición, en lugar de declararla inexistente.
