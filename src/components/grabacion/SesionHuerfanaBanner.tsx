// BORRAR ESTE ARCHIVO
//
// Nadie lo importa. Verificado con
// `grep -rn "SesionHuerfanaBanner" src/`: las únicas apariciones fuera de
// este archivo son menciones en comentarios (src/lib/sesion-clinica-utils.ts).
//
// Qué hacía: el aviso de una sesión huérfana —en "error", o en "grabando"
// hace más de 4 h— con los botones para descartarla o reintentarla. Vivía en
// la pestaña Historia de la ficha, que ya no existe: la grabación se mudó a
// /grabar/[turnoId] y la revisión de la nota a /sesiones/[id], y esa segunda
// pantalla resolvió el caso por su cuenta (el bloque "No pudimos escribir la
// nota" con Reintentar y Eliminar, en sesion-detail-view.tsx).
//
// Se deja la cáscara en vez de borrarlo en este PR para que el borrado sea un
// commit propio y no se mezcle con los cambios de comportamiento de la tanda.
//
// La regla que lo justificaba SÍ sigue viva y no se toca:
// `esSesionHuerfana` en src/lib/sesion-clinica-utils.ts la usa el caso de uso
// eliminarSesion para decidir si una grabación en curso se puede descartar.
//
// Lo que había acá quedó en el historial: `git log --follow` sobre esta ruta.

export {};
