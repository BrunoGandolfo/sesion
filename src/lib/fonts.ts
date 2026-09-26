import localFont from "next/font/local";

export const fraunces = localFont({
  src: "../app/fuentes/fraunces-latin-variable.woff2",
  weight: "400 700",
  variable: "--font-fraunces",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const jakarta = localFont({
  src: "../app/fuentes/plus-jakarta-sans-latin-variable.woff2",
  weight: "400 700",
  variable: "--font-jakarta",
  display: "swap",
});

// Las dos familias viven en el repo (src/app/fuentes/, con sus licencias OFL)
// y no se piden a Google al compilar: con el cargador de Google de next/font,
// a veces Google devolvía una URL sin extensión y el build se caía
// (vercel/next.js#99114).
//
// Son los mismos archivos que ese cargador servía con subsets ["latin"]:
// una fuente variable por familia, de la que se usan los pesos 400 a 700.
// Cubren el español entero; un carácter fuera del subconjunto latin (ł, ő,
// vietnamita) cae en la fuente de respaldo de globals.css.
//
// El respaldo de Fraunces se ajusta sobre Times New Roman, como hacía
// el cargador de Google con las serif; el de Jakarta, sobre Arial (el
// default).
