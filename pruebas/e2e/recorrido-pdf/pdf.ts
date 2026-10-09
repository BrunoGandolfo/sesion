// Páginas y tamaño de un PDF, leídos del propio archivo: sin ghostscript ni
// dependencias. Alcanza para los PDF de Chromium (Skia), que escriben cada
// página como un objeto `/Type /Page` sin comprimir, con su /MediaBox o
// heredándola del nodo /Pages. No es un lector de PDF general.

/** Una medida por página, "anchoxalto" en puntos redondeados: "595x842". */
export function medidasDePaginas(pdf: Uint8Array | string): string[] {
  const texto = typeof pdf === "string" ? pdf : Buffer.from(pdf).toString("latin1");
  const objetos = [...texto.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g)].map((m) => m[1]);
  const caja = (objeto: string) => {
    const m = objeto.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/);
    return m ? `${Math.round(Number(m[3]) - Number(m[1]))}x${Math.round(Number(m[4]) - Number(m[2]))}` : null;
  };
  const heredada = objetos.filter((o) => /\/Type\s*\/Pages\b/.test(o)).map(caja).find(Boolean) ?? null;
  return objetos
    .filter((o) => /\/Type\s*\/Page(?![\w])/.test(o))
    .map((o) => caja(o) ?? heredada ?? "sin-medida");
}
