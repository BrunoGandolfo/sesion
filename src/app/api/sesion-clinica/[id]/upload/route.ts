// Endpoint retirado. La subida monolítica (audio en el cuerpo del request)
// chocaba con el límite de 4,5 MB por request de las funciones de Vercel:
// ninguna sesión real entraba (HTTP 413).
//
// Flujo vigente, en tres pasos, sin pasar el audio por Vercel:
//   POST [id]/upload-url       → clave+IV guardadas, URL prefirmada de R2
//   PUT  <url prefirmada>      → el navegador sube directo a R2
//   POST [id]/upload-confirmar → HeadObject y subiendo → procesando
//
// Se deja este archivo respondiendo 410 para que un cliente viejo (o una
// pestaña abierta antes del deploy) reciba un mensaje claro en vez de un
// 404 o un 413. Borrarlo en una tanda posterior.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MENSAJE =
  "Este endpoint fue retirado: la subida de audio ahora va directo a R2. Recargá la página para usar el flujo nuevo (upload-url → PUT → upload-confirmar).";

export async function POST() {
  return Response.json({ error: MENSAJE }, { status: 410 });
}
