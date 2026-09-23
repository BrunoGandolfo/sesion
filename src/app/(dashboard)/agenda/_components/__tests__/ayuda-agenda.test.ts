// La ayuda de Agenda (la que lee Lupita) dice lo que la agenda hace después
// de agenda-tocable: la fila lleva a la ficha, el turno se abre desde "Ver
// turno", en el teléfono hay una tira con la semana, y los puntos del mes no
// llevan número.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { VER_TURNO } from "@/lib/glosario";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const ayuda = leer("docs/ayuda/03-agenda-y-turnos.md").replace(/\s+/g, " ");

it("la fila lleva a la ficha y el turno se abre desde su control", () => {
  expect(ayuda).toContain("te lleva a la ficha de esa paciente");
  expect(ayuda).toContain(`**"${VER_TURNO}"**`);
  expect(leer("src/components/ui/session-row.tsx")).toContain("href={`/pacientes/${turno.paciente.id}`}");
  expect(ayuda).not.toMatch(/Tocá el turno\. Se abre/);
});

it("describe la semana del teléfono y los puntos sin número", () => {
  expect(ayuda).toContain("la **semana** de ese día");
  expect(ayuda).toContain("mueven la semana de a una");
  expect(ayuda).toContain("**tres puntos y un +**");
  expect(ayuda).toContain("No hay número al lado");
  expect(ayuda).not.toContain("la cantidad de turnos en cada día");
});

it("no dice que los cancelados desaparecen: la agenda los pide y los muestra", () => {
  expect(leer("src/app/(dashboard)/agenda/_components/agenda-view.tsx")).toContain("&includeCancelados=true");
  expect(ayuda).not.toContain("no se muestran en la agenda");
});

it("dice que Grabar no desaparece al pasar la hora y convive con Cobrar", () => {
  expect(ayuda).toContain("**no desaparece cuando pasa la hora**");
  expect(ayuda).toContain("una cosa no reemplaza a la otra");
});
