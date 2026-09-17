# Grabador: textos para integrar

17 de septiembre de 2026. Rama grabador-regresiones.

- El medidor recupera AVISO_SIN_SONIDO. Si Web Audio no está disponible o está suspendido, muestra «Medidor de sonido no disponible»; no afirma que se escucha bien.
- La ayuda debe explicar que Sesión solicita mantener la pantalla encendida y recupera ese permiso al volver. Ocultar la página por sí solo no pausa. Algunos teléfonos suspenden el micrófono o JavaScript al bloquearse.
- Mute tiene tres segundos de gracia, cancelables con unmute. Una demora del hilo mayor a cinco segundos puede pausar preventivamente, con explicación.
- Si stop no llega en cinco segundos, se conservan los bytes entregados, se avisa que el último tramo puede estar incompleto y se permite reanudar o terminar lo guardado.
- El respaldo local se actualiza con cada entrega solicitada cada segundo. No prometer un máximo absoluto de pérdida de un segundo: el navegador puede postergar las entregas y las escrituras.

No se modificó glosario.ts, docs/ayuda ni el texto del consentimiento.
