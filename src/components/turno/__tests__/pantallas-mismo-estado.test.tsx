// @vitest-environment jsdom
//
// El mismo turno se dice igual en todas las pantallas: la fila de Hoy y de
// Agenda, el detalle del turno, los puntos del mes y la ficha. Antes cada
// una tenía su copia: "Agendado" era neutro en la fila y dorado en el
// detalle, "No vino" dorado en la ficha, el detalle decía "Cobrado" debajo
// de un chip "Pagado", un turno cobrado que pasó a "No vino" no se podía
// deshacer desde el detalle, y la nota aprobada era "Nota guardada" en la
// ficha y "Nota lista" en Hoy.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { relojFijo } from "@/app/(dashboard)/_components/__tests__/reloj-fijo";
import { GrupoDeMes } from "@/app/(dashboard)/pacientes/[id]/_components/filas-sesion";
import type { DocSesion } from "@/app/(dashboard)/pacientes/[id]/_components/sesiones-datos";
import { TurnosPagosTab } from "@/app/(dashboard)/pacientes/[id]/_components/turnos-pagos-tab";
import { accionesDelDetalle } from "@/app/(dashboard)/agenda/_components/detalle-datos";
import { AccionesDelTurno, DatosDelTurno } from "@/app/(dashboard)/agenda/_components/detalle-ver";
import { PuntosDelDia } from "@/app/(dashboard)/agenda/_components/month-view";
import { SessionRow } from "@/components/ui/session-row";
import {
  AGENDADO,
  DESHACER_COBRO,
  NO_VINO,
  NOTA_LISTA,
  PAGADO,
  PENDIENTE,
} from "@/lib/glosario";
import type { TurnoConPaciente } from "@/types/domain";

vi.mock("framer-motion", async (original) => ({
  ...(await original<typeof import("framer-motion")>()),
  useReducedMotion: () => true,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const AHORA = new Date("2026-09-16T18:00:00.000Z");
relojFijo(AHORA);

const AYER = new Date(AHORA.getTime() - 24 * 60 * 60 * 1000);

function turno(extra: Partial<TurnoConPaciente> = {}): TurnoConPaciente {
  return {
    id: "t", pacienteId: "p", organizationId: "org", serieId: null, sesionClinica: null,
    fecha: AYER, duracion: 50, modalidad: "presencial", estado: "programado",
    tarifaCobrada: 2000, pagoEstado: "pendiente", pagoMetodo: null, pagoFecha: null, notas: null,
    creadoEn: AYER, actualizadoEn: AYER,
    paciente: { id: "p", nombre: "Lucía", apellido: "Prueba", telefono: "099" },
    ...extra,
  } as TurnoConPaciente;
}

/** El Chip pinta su tono con estas clases (components/ui/chip.tsx). */
const NEUTRO = "bg-cream-100";
const SALVIA = "bg-sage-100";

describe("la palabra y el color del estado", () => {
  it("Agendado es neutro en la fila y en el detalle", () => {
    render(<SessionRow turno={turno({ fecha: new Date(AHORA.getTime() + 3_600_000) })} />);
    expect(screen.getByText(AGENDADO).className).toContain(NEUTRO);
  });

  it("No vino es neutro en la ficha, como en la fila", () => {
    render(<TurnosPagosTab turnos={[turno({ estado: "ausente" })]} />);
    expect(screen.getByText(NO_VINO).className).toContain(NEUTRO);
  });

  it("un realizado sin cobrar se marca en el mes con el color de la deuda", () => {
    const { container } = render(
      <PuntosDelDia turnos={[turno({ estado: "realizado" })]} />,
    );
    expect(container.querySelector(".bg-terracotta-500")).not.toBeNull();
  });
});

describe("el pago en el detalle del turno", () => {
  it("dice Pagado, la misma palabra del chip", () => {
    render(
      <DatosDelTurno
        turno={turno({ estado: "realizado", pagoEstado: "pagado", pagoFecha: AYER })}
        aviso={null}
      />,
    );
    expect(screen.getByText(new RegExp(`^${PAGADO}`))).toBeTruthy();
    expect(screen.queryByText(/Cobrado/)).toBeNull();
  });

  it("dice Sin cobrar cuando falta cobrar", () => {
    render(<DatosDelTurno turno={turno({ estado: "realizado" })} aviso={null} />);
    expect(screen.getByText(PENDIENTE)).toBeTruthy();
  });

  it.each(["ausente", "cancelado"] as const)(
    "un turno %s que quedó cobrado se puede deshacer",
    (estado) => {
      const t = turno({ estado, pagoEstado: "pagado", pagoFecha: AYER });
      render(
        <AccionesDelTurno
          turno={t}
          acciones={accionesDelDetalle(t, null, AHORA)}
          enviando={false}
          onModo={() => {}}
          onReprogramar={() => {}}
        />,
      );
      expect(screen.getByRole("button", { name: DESHACER_COBRO })).toBeTruthy();
    },
  );
});

describe("la nota en la ficha", () => {
  it("una nota aprobada se llama Nota lista, como en Hoy y en la Agenda", () => {
    const doc = {
      sesionClinicaId: "s", turnoId: "t2", fecha: AYER.toISOString(), duracionMin: 50,
      duracionAudioSeg: null, modalidad: "presencial", estado: "aprobada", nota: null,
      datos: null, feedback: null, aprobadaEn: null, procesadaEn: null,
    } as DocSesion;
    render(
      <GrupoDeMes
        grupo={{ clave: "m", titulo: "Septiembre", filas: [{ tipo: "nota", clave: "s", fecha: AYER, doc }] }}
        abiertoPorDefecto
        hoy={{ turno: null, sesion: null, cargando: false, paciente: "Lucía", onCobrar: () => {} }}
      />,
    );
    const chip = screen.getByText(NOTA_LISTA);
    expect(chip.className).toContain(SALVIA);
    expect(within(chip.parentElement!).queryByText("Nota guardada")).toBeNull();
  });
});
