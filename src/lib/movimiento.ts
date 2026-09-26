// Fuente única para JS y CSS. El layout publica las variables en <html>.
export const TIEMPOS = { breve: 150, navegacion: 180, pliegue: 220 } as const;
export const SUAVE = [0.16, 1, 0.3, 1] as const;

// Los tiempos de Lupita como presencia (docs/diseno/06-lupita-presencia.md,
// sección 3). Aparte de TIEMPOS a propósito: son sólo de ella, y el guardián
// de límites (ui/__tests__/limites-movimiento.test.tsx) no deja que los use
// nadie más. La app no gana duraciones nuevas por la puerta de atrás.
//
//   respiracion — un ciclo entero de la respiración (sube y baja).
//   gesto       — saludo y cobro, ida y vuelta; asiente usa 0,9 de esto.
//   parpadeo    — la hoja chica plegada y vuelta.
//   pensamiento — un semiciclo del vaivén del chat.
export const TIEMPOS_LUPITA = { respiracion: 4000, gesto: 450, parpadeo: 120, pensamiento: 900 } as const;

export const VARIABLES_MOVIMIENTO = {
  "--duration-fast": TIEMPOS.breve + "ms",
  "--duration-normal": TIEMPOS.navegacion + "ms",
  "--duration-pliegue": TIEMPOS.pliegue + "ms",
  "--ease-out": "cubic-bezier(" + SUAVE.join(", ") + ")",
  "--default-transition-duration": TIEMPOS.breve + "ms",
  "--default-transition-timing-function": "cubic-bezier(" + SUAVE.join(", ") + ")",
  "--lupita-respiracion": TIEMPOS_LUPITA.respiracion + "ms",
} as const;
