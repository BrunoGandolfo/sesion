import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sesión · Tu consulta, organizada",
    short_name: "Sesión",
    description: "Gestión de consulta para profesionales de salud mental",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF6",
    theme_color: "#4F7A6A",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
