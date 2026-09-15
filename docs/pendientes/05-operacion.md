# Área 5 — Pendientes después de integrar los textos

15 de septiembre de 2026.

- **Cableado de agenda y cobros:** está corregido en e2e-main (33dbdf5), todavía
  fuera de la base de esta rama. Hay que fusionarlo: GET /api/sms/envios,
  retiro del reintento manual y de /api/sms/estado, confirmación de programación
  y distinción del pedido duplicado. Los ocho nombres de estado están en el
  glosario. Los textos de reintento anteriores se conservan solo para que main
  compile hasta esa fusión; después se pueden retirar sus exports sin usos.
- **Resultado desconocido:** no hay pantalla de conciliación. Se revisa a mano;
  no se reenvía solo. Los textos y la ayuda ya explican la diferencia entre
  aceptación, entrega y falta de confirmación.
- **Restauración:** sigue pendiente la primera acta de ensayo en
  docs/operaciones/actas/, con fecha límite 2026-12-20.
- **Documentación operativa:** README, pipeline, encryption y operaciones se
  revisan por separado en docs-verdad. No se cambiaron en esta rama.
