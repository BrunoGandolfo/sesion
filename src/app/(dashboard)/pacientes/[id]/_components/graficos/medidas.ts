"use client";

import * as React from "react";
import { fechaCorta } from "@/lib/format";
import { partesMvd } from "@/lib/fechas-montevideo";

/** Un punto SVG equivale a un píxel del contenedor: el texto no se achica. */
export function useAnchoGrafico() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = React.useState(320);
  React.useEffect(() => {
    const elemento = ref.current;
    if (!elemento) return;
    const actualizar = (valor: number) => {
      if (valor > 0) setAncho(valor);
    };
    if (typeof ResizeObserver !== "undefined") {
      const observador = new ResizeObserver(([entrada]) => {
        if (entrada) actualizar(entrada.contentRect.width);
      });
      observador.observe(elemento);
      return () => observador.disconnect();
    }
    const medir = () => actualizar(elemento.getBoundingClientRect().width);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return { ref, ancho };
}

/** Elige rótulos por el espacio real; nunca elimina puntos ni valores. */
export function etiquetasDeFechas(fechas: Date[], posiciones: number[], izquierda: number, derecha: number) {
  const dias = new Set<string>();
  const candidatas = fechas.flatMap((fecha, i) => {
    const partes = partesMvd(fecha);
    const dia = `${partes.anio}-${partes.mes}-${partes.dia}`;
    if (dias.has(dia)) return [];
    dias.add(dia);
    const texto = fechaCorta(fecha);
    // Margen conservador para los dígitos y abreviaturas a 12 px.
    const mitad = texto.length * 7.5 / 2;
    const x = Math.max(izquierda + mitad, Math.min(derecha - mitad, posiciones[i]));
    return [{ indice: i, texto, x, inicio: x - mitad, fin: x + mitad }];
  });
  const elegidas: typeof candidatas = [];
  const agregar = (candidata: typeof candidatas[number]) => {
    if (elegidas.every((otra) => candidata.inicio >= otra.fin + 12 || otra.inicio >= candidata.fin + 12)) {
      elegidas.push(candidata);
    }
  };
  if (candidatas.length > 0) agregar(candidatas[0]);
  if (candidatas.length > 1) agregar(candidatas[candidatas.length - 1]);
  for (const candidata of candidatas.slice(1, -1)) {
    if (elegidas.length >= 8) break;
    agregar(candidata);
  }
  return elegidas.sort((a, b) => a.x - b.x);
}
