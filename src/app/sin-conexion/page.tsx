// La pantalla que el service worker muestra cuando una página no llega a la
// red (src/app/sw.ts). Es la única página que queda guardada en el teléfono,
// así que no trae NINGÚN dato del servidor: todo lo que muestra sale de la
// agenda local (src/lib/agenda-local.ts), en el cliente.
//
// Pública (src/lib/sesion-cookie.ts): el service worker la baja al
// instalarse, y no tiene nada que proteger.
//
// Dinámica por la CSP: una página prerenderizada no lleva el nonce en sus
// scripts (src/lib/csp.ts, "LAS PÁGINAS TIENEN QUE SER DINÁMICAS"). La copia
// guardada trae su nonce y sus cabeceras juntos, así que sigue cuadrando.

import { SinConexion } from "./_components/sin-conexion";

export const dynamic = "force-dynamic";

export default function SinConexionPage() {
  return <SinConexion />;
}
