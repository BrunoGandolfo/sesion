import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: "sesion",
  project: "sesion-app",
  silent: true, // no loguear durante build
  sourcemaps: {
    disable: true, // no subir sourcemaps por ahora
  },
});
