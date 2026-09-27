// La respuesta de ejemplo de docs/contrato-finanzas.md, tal cual: "real,
// generada contra la base de test". Si el contrato cambia, este archivo se
// vuelve a copiar de ahí (contrato-ejemplo.test.ts lo compara).
import type { ResumenFinanzas } from "@/app/api/_lib/casos-uso/finanzas";

export const RESPUESTA_EJEMPLO: ResumenFinanzas = {
  "desde": "2026-08",
  "hasta": "2026-09",
  "granularidad": "mes",
  "granularidadAutomatica": true,
  "serie": [
    {
      "clave": "2026-08", "anio": 2026, "mes": 8,
      "cobrado": 1200, "sesionesCobradas": 1,
      "trabajado": 3600, "sesionesRealizadas": 3,
      "trabajadoCobrado": 2400, "sesionesRealizadasCobradas": 2,
      "trabajadoSinCobrar": 1200, "sesionesRealizadasSinCobrar": 1,
      "ausencias": 0, "ausenciasMonto": 0, "canceladas": 0,
      "pacientesDistintas": 2, "tarifaPromedio": 1200,
      "cobradoPorMetodo": [{ "metodo": "efectivo", "sesiones": 1, "monto": 1200 }]
    },
    {
      "clave": "2026-09", "anio": 2026, "mes": 9,
      "cobrado": 3900, "sesionesCobradas": 3,
      "trabajado": 3900, "sesionesRealizadas": 3,
      "trabajadoCobrado": 2700, "sesionesRealizadasCobradas": 2,
      "trabajadoSinCobrar": 1200, "sesionesRealizadasSinCobrar": 1,
      "ausencias": 1, "ausenciasMonto": 1200, "canceladas": 1,
      "pacientesDistintas": 2, "tarifaPromedio": 1300,
      "cobradoPorMetodo": [
        { "metodo": "mercadopago", "sesiones": 1, "monto": 1500 },
        { "metodo": "efectivo", "sesiones": 1, "monto": 1200 },
        { "metodo": "transferencia", "sesiones": 1, "monto": 1200 }
      ]
    }
  ],
  "totales": {
    "cobrado": 5100, "sesionesCobradas": 4,
    "trabajado": 7500, "sesionesRealizadas": 6,
    "trabajadoCobrado": 5100, "sesionesRealizadasCobradas": 4,
    "trabajadoSinCobrar": 2400, "sesionesRealizadasSinCobrar": 2,
    "ausencias": 1, "ausenciasMonto": 1200, "canceladas": 1,
    "pacientesDistintas": 3, "tarifaPromedio": 1250,
    "cobradoPorMetodo": [
      { "metodo": "efectivo", "sesiones": 2, "monto": 2400 },
      { "metodo": "mercadopago", "sesiones": 1, "monto": 1500 },
      { "metodo": "transferencia", "sesiones": 1, "monto": 1200 }
    ]
  },
  "comparaciones": {
    "periodoAnterior": {
      "desde": "2026-06", "hasta": "2026-07",
      "cobrado": 1200, "trabajado": 1200, "sesionesRealizadas": 1,
      "variacionCobrado": 3900, "variacionTrabajado": 6300,
      "variacionSesionesRealizadas": 5,
      "porcentajeCobrado": 325, "porcentajeTrabajado": 525
    },
    "mismoPeriodoAnioAnterior": {
      "desde": "2025-08", "hasta": "2025-09",
      "cobrado": 1000, "trabajado": 1000, "sesionesRealizadas": 1,
      "variacionCobrado": 4100, "variacionTrabajado": 6500,
      "variacionSesionesRealizadas": 5,
      "porcentajeCobrado": 410, "porcentajeTrabajado": 650
    }
  },
  "proporcionCobrada": {
    "deCadaDiez": 7, "porcentaje": 67,
    "sesionesRealizadas": 6, "sesionesRealizadasCobradas": 4
  },
  "deudaHoy": {
    "alDia": "2026-09", "sesiones": 2, "monto": 2400,
    "tramos": [
      { "tramo": "hasta30", "sesiones": 2, "monto": 2400, "pacientes": 2 },
      { "tramo": "de31a90", "sesiones": 0, "monto": 0, "pacientes": 0 },
      { "tramo": "mas90", "sesiones": 0, "monto": 0, "pacientes": 0 }
    ]
  },
  "primerMesConDatos": "2025-09"
};
