// Fuente única para JS y CSS. El layout publica las variables en <html>.
export const TIEMPOS = { breve: 150, navegacion: 180, pliegue: 220 } as const;
export const SUAVE = [0.16, 1, 0.3, 1] as const;

export const VARIABLES_MOVIMIENTO = {
  "--duration-fast": TIEMPOS.breve + "ms",
  "--duration-normal": TIEMPOS.navegacion + "ms",
  "--duration-pliegue": TIEMPOS.pliegue + "ms",
  "--ease-out": "cubic-bezier(" + SUAVE.join(", ") + ")",
  "--default-transition-duration": TIEMPOS.breve + "ms",
  "--default-transition-timing-function": "cubic-bezier(" + SUAVE.join(", ") + ")",
} as const;
