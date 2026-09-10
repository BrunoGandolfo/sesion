// @vitest-environment jsdom
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { asegurarLineaContacto, buildSmsMessage, LINEA_CONTACTO } from "@/lib/sms-texto";
import { htmlATemplate } from "../editor-recordatorio";
import { MensajeRecordatorio } from "../mensaje-recordatorio";

const datos = { profesional: "Mariana Roldán", direccion: "Calle 123", telefono: "+59899123456" };
const templatePegado = "{{profesional}}Hola {{nombre}}, tu sesión es el {{fecha}} a las {{hora}}.";
function ejemplo(template: string) {
  return buildSmsMessage(asegurarLineaContacto(template), {
    ...datos, telefonoConsultorio: datos.telefono, nombre: "Lucía", apellido: "Fernández",
    fecha: new Date("2026-04-21T10:00:00-03:00"),
  });
}

describe("vista previa fiel del recordatorio", () => {
  it("muestra el texto que prepara el envío, advierte la unión y no cambia la plantilla al abrir", () => {
    const onChange = vi.fn();
    render(<MensajeRecordatorio {...datos} template={templatePegado} onChange={onChange} />);
    expect(screen.getByRole("region", { name: "Vista previa del SMS" }).textContent).toBe(ejemplo(templatePegado));
    expect(screen.getByRole("region").textContent).toContain("Mariana RoldánHola Lucía");
    expect(screen.getByText(/En el SMS también se leería así/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("corrige la plantilla real con un toque y actualiza el editor y la vista previa juntos", () => {
    const guardar = vi.fn();
    function Formulario() {
      const [template, setTemplate] = React.useState(templatePegado);
      return <MensajeRecordatorio {...datos} template={template} onChange={(valor) => { guardar(valor); setTemplate(valor); }} />;
    }
    render(<Formulario />);
    fireEvent.click(screen.getByRole("button", { name: "Separar nombre y texto" }));
    const corregido = templatePegado.replace("}}Hola", "}}\nHola");
    expect(guardar).toHaveBeenCalledExactlyOnceWith(corregido);
    expect(screen.queryByRole("button", { name: "Separar nombre y texto" })).toBeNull();
    expect(screen.getByRole("region").textContent).toBe(ejemplo(corregido));
    const editor = screen.getByRole("textbox");
    expect(htmlATemplate(editor)).toBe(corregido);
    fireEvent.input(editor);
    expect(guardar).toHaveBeenLastCalledWith(corregido);
  });

  it.each(["{{profesional}} Hola {{nombre}}", "{{profesional}}\nHola {{nombre}}", "{{profesional}}: Hola {{nombre}}"])("respeta separaciones y puntuación existentes: %s", (template) => {
    render(<MensajeRecordatorio {...datos} template={template} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Separar nombre y texto" })).toBeNull();
    expect(screen.getByRole("region").textContent).toBe(ejemplo(template));
  });

  it("incluye el contacto una sola vez y mantiene las 10:00 del ejemplo en cualquier zona", () => {
    render(<MensajeRecordatorio {...datos} template={`Hola {{nombre}}, {{hora}}. ${LINEA_CONTACTO}`} onChange={vi.fn()} />);
    const texto = screen.getByRole("region").textContent ?? "";
    expect(texto).toContain("10:00");
    expect(texto.split("Para cambios, comunicate")).toHaveLength(2);
    expect(texto).toContain(datos.telefono);
  });
});
