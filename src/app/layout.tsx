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
  maximumScale: 1,
  userScalable: false,
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
