"use client";

// Editor del recordatorio con fichas.
//
// Ella escribe el mensaje como texto y agrega "Nombre", "Fecha", "Hora" o
// "Dirección" como fichas resaltadas, sin ver llaves. Lo que se guarda es el
// template con {{variables}} que ya entiende buildSmsMessage; lo que se
// muestra es el mismo template traducido a fichas.
//
// Traducción:
//   template → editor   "{{nombre}}"  →  <span data-ficha="nombre">Nombre</span>
//   editor   → template <span data-ficha="nombre">  →  "{{nombre}}"
//
// Las variables que no se ofrecen como ficha (apellido, profesional,
// teléfono del consultorio) igual se muestran como ficha si están en el
// template: la línea de contacto obligatoria las trae y no tiene sentido
// que aparezcan como llaves crudas. Una variable desconocida queda como
// texto literal y se conserva al guardar.
//
// El área es contentEditable no controlada: React pinta el HTML inicial una
// sola vez y después el DOM es la fuente de verdad; cada cambio se
// serializa a template y se avisa hacia arriba. Así el cursor no salta.

import * as React from "react";

export type ClaveFicha =
  | "nombre"
  | "apellido"
  | "fecha"
  | "hora"
  | "direccion"
  | "profesional"
  | "telefonoConsultorio";

/** Etiqueta visible de cada variable. */
export const FICHAS: Record<ClaveFicha, string> = {
  nombre: "Nombre",
  apellido: "Apellido",
  fecha: "Fecha",
  hora: "Hora",
  direccion: "Dirección",
  profesional: "Tu nombre",
  telefonoConsultorio: "Tu teléfono",
};

/** Las que se ofrecen como botón para insertar. */
export const FICHAS_INSERTABLES: ClaveFicha[] = [
  "nombre",
  "fecha",
  "hora",
  "direccion",
];

function esClaveFicha(valor: string): valor is ClaveFicha {
  return Object.prototype.hasOwnProperty.call(FICHAS, valor);
}

// La ficha es una píldora con fondo: necesita aire propio a los costados, no
// sólo el espacio literal del template. Con `mx-[2px]` la línea de contacto
// —"comunicate con [Tu nombre] al [Tu teléfono]"— quedaba pegada: el "al" de
// dos letras se leía como parte de la píldora. Con 4 px por lado se separa
// también cuando la ficha cierra una línea y no hay ningún espacio después.
const CLASE_FICHA =
  "inline-flex select-none items-center rounded-full bg-sage-100 px-2 py-[1px] mx-1 align-baseline font-sans text-[12px] font-semibold not-italic text-sage-700";

// Espacio duro (U+00A0) que los navegadores insertan al escribir dos
// espacios seguidos en un contentEditable. El SMS quiere espacios comunes.
const ESPACIO_DURO = " ";

function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** template con {{variables}} → HTML del editor con fichas. */
export function templateAHtml(template: string): string {
  const partes = template.split(/(\{\{\s*[A-Za-z]+\s*\}\})/g);
  let html = "";
  for (const parte of partes) {
    const m = /^\{\{\s*([A-Za-z]+)\s*\}\}$/.exec(parte);
    if (m && esClaveFicha(m[1])) {
      html += fichaHtml(m[1]);
    } else if (parte.length > 0) {
      html += escaparHtml(parte).replaceAll("\n", "<br>");
    }
  }
  return html;
}

function fichaHtml(clave: ClaveFicha): string {
  return `<span data-ficha="${clave}" contenteditable="false" class="${CLASE_FICHA}">${escaparHtml(FICHAS[clave])}</span>`;
}

function crearFicha(clave: ClaveFicha): HTMLSpanElement {
  const span = document.createElement("span");
  span.dataset.ficha = clave;
  span.contentEditable = "false";
  span.className = CLASE_FICHA;
  span.textContent = FICHAS[clave];
  return span;
}

const BLOQUES = new Set(["DIV", "P"]);

/** DOM del editor → template con {{variables}}. */
export function htmlATemplate(raiz: HTMLElement): string {
  let salida = "";

  const recorrer = (nodo: Node, primeroDeBloque: boolean) => {
    if (nodo.nodeType === Node.TEXT_NODE) {
      salida += (nodo.textContent ?? "").replaceAll(ESPACIO_DURO, " ");
      return;
    }
    if (nodo.nodeType !== Node.ELEMENT_NODE) return;
    const el = nodo as HTMLElement;

    if (el.dataset.ficha && esClaveFicha(el.dataset.ficha)) {
      salida += `{{${el.dataset.ficha}}}`;
      return;
    }
    if (el.tagName === "BR") {
      salida += "\n";
      return;
    }
    // Enter dentro de un contentEditable crea <div>: cada bloque que no es
    // el primero equivale a un salto de línea.
    if (BLOQUES.has(el.tagName) && !primeroDeBloque) {
      salida += "\n";
    }
    let primero = true;
    for (const hijo of Array.from(el.childNodes)) {
      recorrer(hijo, primero);
      primero = false;
    }
  };

  let primero = true;
  for (const hijo of Array.from(raiz.childNodes)) {
    recorrer(hijo, primero);
    primero = false;
  }

  return salida;
}

interface Props {
  template: string;
  onChange: (template: string) => void;
  fichas: ClaveFicha[];
}

export function EditorRecordatorio({ template, onChange, fichas }: Props) {
  const editorRef = React.useRef<HTMLDivElement>(null);
  const editorId = React.useId();
  // Se calcula una sola vez: el DOM es la fuente de verdad después.
  const [htmlInicial] = React.useState(() => templateAHtml(template));

  const emitir = React.useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    onChange(htmlATemplate(el));
  }, [onChange]);

  const insertarFicha = (clave: ClaveFicha) => {
    const el = editorRef.current;
    if (!el) return;

    const ficha = crearFicha(clave);
    const espacio = document.createTextNode(" ");

    const seleccion = window.getSelection();
    const rango =
      seleccion && seleccion.rangeCount > 0 ? seleccion.getRangeAt(0) : null;
    const dentro = rango ? el.contains(rango.commonAncestorContainer) : false;

    if (rango && dentro) {
      rango.deleteContents();
      rango.insertNode(espacio);
      rango.insertNode(ficha);
    } else {
      el.appendChild(ficha);
      el.appendChild(espacio);
    }

    // El cursor queda después de la ficha, listo para seguir escribiendo.
    const nuevo = document.createRange();
    nuevo.setStartAfter(espacio);
    nuevo.collapse(true);
    seleccion?.removeAllRanges();
    seleccion?.addRange(nuevo);
    el.focus();

    emitir();
  };

  // Pegar: solo texto plano, para que no entren estilos ni HTML ajeno.
  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const texto = event.clipboardData.getData("text/plain");
    const seleccion = window.getSelection();
    if (!seleccion || seleccion.rangeCount === 0) return;
    const rango = seleccion.getRangeAt(0);
    rango.deleteContents();
    const nodo = document.createTextNode(texto);
    rango.insertNode(nodo);
    rango.setStartAfter(nodo);
    rango.collapse(true);
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
    emitir();
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {fichas.map((clave) => (
          <button
            key={clave}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertarFicha(clave)}
            aria-label={`Agregar ficha ${FICHAS[clave]}`}
            aria-controls={editorId}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-sage-500/40 bg-sage-50 px-3 text-[13px] font-semibold text-sage-700 transition-colors duration-150 hover:bg-sage-100 lg:min-h-[36px]"
          >
            <span aria-hidden="true">+</span>
            {FICHAS[clave]}
          </button>
        ))}
      </div>
      <div className="flex rounded-sm border border-[color:var(--border-subtle)] bg-cream-50 transition-colors duration-150 focus-within:border-sage-500 focus-within:bg-white focus-within:ring-[3px] focus-within:ring-sage-500/20">
        <div
          ref={editorRef}
          id={editorId}
          role="textbox"
          aria-multiline="true"
          aria-label="Mensaje del recordatorio"
          contentEditable
          suppressContentEditableWarning
          spellCheck
          onInput={emitir}
          onBlur={emitir}
          onPaste={onPaste}
          className="min-h-[120px] w-full whitespace-pre-wrap break-words px-[14px] py-[10px] text-[15px] leading-[1.7] text-ink-900 outline-none"
          dangerouslySetInnerHTML={{ __html: htmlInicial }}
        />
      </div>
    </div>
  );
}
