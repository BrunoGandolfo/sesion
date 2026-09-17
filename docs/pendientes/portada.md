# Portada — rama portada

Base revisada: `origin/main` en `5753e2e`. La portada describe el código de
esa base; no certifica disponibilidad ni configuración de proveedores.

## Presentación

Presentación breve, formulario y después explicación de funciones. En escritorio
el formulario queda junto a la presentación. Dos enlaces «Entrar», en cabecera y
pie, llevan al mismo formulario. Sin carrusel, animaciones ni pasos adicionales.

Se reutiliza el SVG de `src/app/_marca.tsx`, a 44 px, el mismo que genera los
íconos de la app. Fraunces, Plus Jakarta Sans, colores, radios y foco vienen de
los tokens existentes. No se cambiaron fuentes, paleta ni componentes de campos.

El copyright dice **© Mariana Roldán**, sin versión de aplicación ni eslogan
adicional. Los textos nuevos y corregidos están integrados en la sección Entrada
de `src/lib/glosario.ts`: `PORTADA_*`, `ENTRADA_QUE_HACE`,
`ENTRADA_CONFIDENCIALIDAD` y el resumen compacto `ENTRADA_AFIRMACIONES` que siguen
usando las otras pantallas de acceso. No se modifica el consentimiento.

## Respaldo de las afirmaciones

| Texto / alcance | Código revisado |
| --- | --- |
| Turnos únicos y recurrentes | `src/app/api/_lib/casos-uso/crear-turno.ts`, `src/app/api/_lib/casos-uso/serie-turnos.ts` |
| Recordatorios por SMS | `src/lib/recordatorios-programacion.ts`, `src/app/api/_lib/casos-uso/despachar-sms.ts` |
| Cobros y deudas por paciente | `src/app/api/_lib/casos-uso/cobrar-turno.ts`, `src/app/(dashboard)/cobros/_components/cobros-view.tsx` |
| Grabación con autorización, audio cifrado antes de persistir/enviar | `src/app/api/_lib/casos-uso/audio.ts`, `src/lib/audio/grabadora.ts`, `src/lib/audio/cifrado.ts`, `src/lib/audio/sincronizar.ts` |
| Transcripción y borrador SOAP | `processor/processor.py`, `processor/clinical_analyzer.py`, `src/lib/glosario.ts` (`SOAP_SECCIONES`) |
| Revisión, corrección y aprobación profesional | `src/app/(dashboard)/sesiones/[id]/_components/nota-sesion-view.tsx`, `src/app/api/_lib/casos-uso/sesion/aprobar.ts` |
| Recorrido longitudinal; propuestas tras aprobar; aceptar, editar o descartar | `src/app/api/_lib/casos-uso/sesion/aprobar.ts`, `src/app/api/_lib/casos-uso/hilo/trabajo.ts`, `src/app/api/_lib/casos-uso/hilo/escribir.ts` |
| Exportar el Recorrido con la impresión del navegador; copia sin cifrar | `src/app/api/_lib/casos-uso/hilo/exportar.ts`, `src/app/(impresion)/pacientes/[id]/recorrido/imprimir/_components/recorrido-imprimible.tsx` |
| Para vos analiza la transcripción y las intervenciones | `processor/processor.py` (`generar_feedback`), `src/components/grabacion/FeedbackTerapeutaView.tsx` |
| Notas, transcripción, análisis y Recorrido guardados cifrados | `src/lib/prisma-encryption.ts` (`CAMPOS_CIFRADOS`) |
| Lupita responde desde la ayuda; no consulta pacientes/montos; recibe el chat | `src/app/api/ayuda/route.ts`, `src/app/api/_lib/casos-uso/responder-ayuda.ts`, `src/lib/ayuda-corpus.ts` |

## Límites del texto

- Se describe que se transcribe el audio; no se promete una pantalla para leer la
  transcripción, porque no existe en esta base.
- PDF significa exportar el **Recorrido**, no toda la documentación ni las notas
  individuales. El texto explica que el archivo exportado no queda cifrado.
- No se promete borrado infalible, cifrado de todos los campos administrativos ni
  cifrado de extremo a extremo. Los proveedores procesan contenido legible.
- Lupita no consulta la base clínica, pero sí recibe lo que se escribe: por eso
  se evita la afirmación absoluta de que nunca puede ver datos personales.
- El análisis no se presenta como supervisión clínica ni evaluación de competencia.
- Se retiró de la interfaz la afirmación vieja «La copia local previa no está
  cifrada». README y la ayuda de privacidad aún la describen como texto pendiente;
  esa observación documental queda superada por esta rama.

## Verificación

- Pruebas de componente: presentación, orden de lectura, acceso al formulario,
  alcance del cifrado/PDF/Lupita, campos, POST real del cliente con red simulada,
  espera de respuesta, error, reintento y copyright.
- Comparación literal con main: el bloque `<form>` y la función de ingreso,
  incluidos los estados y el efecto de sesión vencida, son idénticos.
- Navegador contra la app real y Postgres 17 exclusivo en Docker, con una cuenta
  del seed local. Ningún proveedor externo ni cuenta de producción.

| Motor | Ancho × alto | Borde inferior del botón Entrar | Ingreso / lectura autenticada |
| --- | --- | ---: | --- |
| Chromium | 390 × 844 | 645,63 px | 200 / 200 |
| Chromium | 1440 × 1000 | 470 px | 200 / 200 |
| WebKit | 390 × 844 | 643 px | 200 / 200 |
| WebKit | 1440 × 1000 | 468 px | 200 / 200 |

En los cuatro casos: sin desborde horizontal ni errores JavaScript; el botón se
ve sin desplazar. «Entrar» seguido de Tab lleva al campo Email, con foco visible
de 2 px. Las fuentes calculadas son Fraunces y Plus Jakarta Sans; el fondo sigue
siendo cream-50. Se inspeccionaron capturas completas de 390 y 1440 px.
WebKit emulado no equivale a una prueba en un teléfono físico.
