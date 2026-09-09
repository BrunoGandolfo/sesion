import { Sidebar } from "@/components/layout/sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Providers } from "@/components/layout/providers";

export const dynamic = "force-dynamic";

// EL QUE SCROLLEA ES EL DOCUMENTO, NO EL <main>
//
// Antes esto era `h-screen overflow-hidden` con un `<main overflow-y-auto>`
// adentro: el scroll de toda la app vivía en un contenedor anidado que está
// en el layout y, por lo tanto, NO se desmonta al navegar. Dos consecuencias,
// las dos visibles en el teléfono:
//
//   - Al cambiar de pantalla, ese contenedor conservaba su `scrollTop`. Con
//     "Cargando…" —dos renglones— el navegador lo recortaba solo a 0 y no se
//     notaba; con un esqueleto, que mide lo que va a medir la pantalla, ya no
//     hay recorte y la pantalla nueva abría por la mitad.
//   - Al volver de una nota con `router.back()` la posición se perdía: la
//     restauración de scroll del navegador es del documento, y el documento
//     no scrolleaba.
//
// Next resuelve las dos cosas solo, pero sobre el documento: su manejador
// (client/components/layout-router.js) hace `document.documentElement
// .scrollTop = 0` cuando la pantalla nueva no está a la vista, y el
// historial del navegador restaura la posición al volver. Con el scroll en
// un `<main>` interno, el primero no hacía nada y el segundo tampoco. Por
// eso el arreglo es devolverle el scroll al documento y no un `scrollTo` a
// mano, que sería pelearse con esos dos.
//
// Lo que se conserva de lo viejo:
//
//   - `overflow-x-clip` en el `main` hace el recorte horizontal que hacía el
//     `overflow-hidden` del contenedor (el chip del brief que mide 464 px en
//     un viewport de 390, ver 01-auditoria-frontend.md §0). `clip` y no
//     `hidden` a propósito: `hidden` volvería a crear un contenedor de
//     scroll y estaríamos donde empezamos.
//   - La barra lateral queda pegada arriba con `sticky` y su alto de
//     pantalla; el envoltorio va acá y no en sidebar.tsx para no tocar un
//     archivo ajeno. En mobile el `<aside>` ya es `hidden`, así que el
//     envoltorio no ocupa nada.
//   - El menú inferior era `fixed` y lo sigue siendo, y el `pb-20` del
//     `main` le sigue reservando su franja.
//
// Efecto lateral bueno: el bloqueo de scroll de fondo que `ui/sheet.tsx` ya
// escribía (`document.body.style.overflow = "hidden"`) recién ahora hace
// algo. Antes el body nunca scrolleaba y esa línea era decorativa.

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex min-h-screen bg-cream-50">
        <div className="shrink-0 lg:sticky lg:top-0 lg:flex lg:h-screen">
          <Sidebar />
        </div>
        <main className="min-w-0 flex-1 overflow-x-clip pb-20 lg:pb-0">
          {children}
        </main>
        <BottomNav />
      </div>
    </Providers>
  );
}
