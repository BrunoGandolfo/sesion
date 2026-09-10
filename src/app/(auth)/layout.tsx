// Este layout no dibuja nada: existe sólo para que /login se renderice por
// request y no en el build.
//
// POR QUÉ IMPORTA
//
// La CSP lleva un nonce distinto por request, que el middleware genera y le
// pasa al renderizador por las cabeceras del PEDIDO (ver src/lib/csp.ts).
// Next lee ese nonce y se lo pone a sus propios <script>. Una página
// PRERENDERIZADA en el build no participa de eso: su HTML se armó una vez,
// sin ningún request a mano, así que sus scripts salen sin nonce mientras la
// respuesta anuncia uno nuevo. Resultado: violaciones de script-src en cada
// carga, del dominio propio — justo el montón que AGENTS.md pone como
// condición para pasar a enforce, y que nunca llegaría a cero.
//
// Todo lo demás de la app ya es dinámico por (dashboard)/layout.tsx. /login
// era la única página que quedaba estática, y encima es la primera que
// cualquiera abre.
//
// Va acá y no en login/page.tsx porque esa página es "use client", y la
// configuración de segmento (`dynamic`, `revalidate`, …) sólo la lee Next en
// componentes de servidor. Mismo patrón que (dashboard)/layout.tsx.

export const metadata = { referrer: "no-referrer" as const };

export const dynamic = "force-dynamic";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
