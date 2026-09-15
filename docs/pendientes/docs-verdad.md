# Diferencias pendientes entre documentación de producto e implementación

15 de septiembre de 2026. Base main e247d8b.

- Retención: el consentimiento 2.0 y el texto pendiente de Identidad hablan de 30 días. .github/workflows/backup.yml conserva diarios 30 días y mensuales 366 días. Decidir política y luego alinear consentimiento/ayuda; esta rama describe lo que hace el workflow y no cambia ninguna retención.
- Cifrado durante la captura: el consentimiento lo promete, pero el grabador de main respalda fragmentos locales sin cifrar y cifra al terminar. Sigue a cargo de la reconstrucción del grabador.
- Borrado ASR: el id durable se registra después de que retorna el ASR, no apenas se crea el transcript. Persiste una ventana de caída del worker antes de ese registro; los reintentos de borrado tienen tope de 20.
- Recorrido: se encola integrar_contexto, pero falta su ejecutor y las rutas nuevas. El worker todavía tolera sin contexto la lectura de una ruta ausente. Tampoco se resolvió en esta rama la unión de contenedores/recorte de solapes de los segmentos.
- Los dos helpers de integración conservan guardas diferentes para hosts remotos. La guía exige localhost y base exclusiva; unificarlos es trabajo de código aparte.
- Restauración: no hay un acta en esta base. La guarda todavía permite esa ausencia hasta el 20 de diciembre de 2026; el primer ensayo manual con descifrado sigue pendiente.
