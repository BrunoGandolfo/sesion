// BORRAR ESTE ARCHIVO
//
// Nadie lo importa. Verificado con `grep -rn "NotaClinicaView" src/`: las
// únicas apariciones fuera de este archivo son menciones en comentarios
// (useSesionClinicaPolling.ts, RiesgoDetectadoBanner.tsx, confirmar.tsx,
// sesion-clinica/[id]/aprobar/route.ts, types/domain.ts).
//
// Qué hacía: la nota clínica dentro de un sheet, sobre la ficha del paciente.
// La reemplazó la pantalla completa /sesiones/[id] —la nota es el documento
// clínico de la sesión y se lee entera, con su propia URL, no en un panel que
// tapa la ficha—, cuyas partes son
// sesiones/[id]/_components/{sesion-detail-view,nota-sesion-view,
// seccion-soap,mas-de-esta-sesion}.tsx.
//
// De acá salieron dos cosas que sí siguen vivas y no se tocan: el bloque de
// riesgo con sus casillas obligatorias, que se unificó en
// components/grabacion/RiesgoDetectadoBanner.tsx, y el patrón de
// confirmación de components/ui/confirmar.tsx.
//
// Se deja la cáscara en vez de borrarlo en este PR para que el borrado sea un
// commit propio y no se mezcle con los cambios de comportamiento de la tanda.
//
// Lo que había acá quedó en el historial: `git log --follow` sobre esta ruta.

export {};
