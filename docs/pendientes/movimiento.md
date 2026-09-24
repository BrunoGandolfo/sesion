# Movimiento y textos de campo: lo que sigue abierto

- **Textos al glosario:** los cuatro estados de
  `src/components/ui/guardado-campo.tsx` siguen escritos en el componente:
  «Sin guardar todavía.», «Guardando…», «Guardado.» y «No se guardó. Revisá
  los campos y reintentá.». `GUARDANDO` ya existe en el glosario.
- **Transiciones de ancho:** las barras de
  `src/app/(dashboard)/grabar/[turnoId]/_components/grabar-view.tsx` y
  `src/components/grabacion/FeedbackTerapeutaView.tsx` todavía animan el ancho
  (200 ms). La regla CSS global las apaga con movimiento reducido; retirarlas
  del todo queda para el dueño de esas pantallas.
