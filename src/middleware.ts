import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export default auth((request) => {
  const isLoggedIn = Boolean(request.auth);
  const { nextUrl } = request;
  const isLoginRoute = nextUrl.pathname === "/login";
  const origin = `${nextUrl.protocol}//${
    request.headers.get("host") ?? nextUrl.host
  }`;

  if (!isLoggedIn && !isLoginRoute) {
    const loginUrl = new URL("/login", origin);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginRoute) {
    return NextResponse.redirect(new URL("/", origin));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Cron endpoints se autentican por CRON_SECRET header, no por sesión.
    // /api/health es público para servicios de monitoreo (UptimeRobot, etc.).
    // /api/sesion-clinica/callback es machine-to-machine (La Escondida),
    // se autentica por PROCESSING_SECRET header.
    "/((?!_next/static|_next/image|static|favicon.ico|api/auth|api/seed|api/cron|api/health|api/sesion-clinica/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
