import type { Metadata, Viewport } from "next";
import { fraunces, jakarta } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sesión",
  description: "Tu consulta, organizada.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Sesión",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#4F7A6A",
  width: "device-width",
  initialScale: 1,
  // Permitimos zoom hasta 5x para cumplir WCAG 2.1 (1.4.4 Resize Text).
  // Auto-zoom en inputs de iOS se evita con font-size >= 16px en globals.css.
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${fraunces.variable} ${jakarta.variable}`}>
      <body>{children}</body>
    </html>
  );
}
