// @vitest-environment jsdom
// El registro del service worker: debe quedar cierto que no guarda el HTML de
// las páginas visitadas (cacheOnNavigation) y que no recarga la página al
// volver la señal (reloadOnOnline), que cortaría una grabación.
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { URL_SW } from "@/lib/sw-politica";

const recibido = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("@serwist/turbopack/react", () => ({
  SerwistProvider: ({ children, ...props }: { children: React.ReactNode }) => {
    recibido.props = props;
    return <>{children}</>;
  },
}));

import { RegistroServiceWorker } from "../registro-service-worker";

afterEach(cleanup);

it("registra /serwist/sw.js sin guardar páginas ni recargar al volver la señal", () => {
  render(
    <RegistroServiceWorker>
      <p>la app</p>
    </RegistroServiceWorker>,
  );
  expect(screen.getByText("la app")).toBeTruthy();
  expect(recibido.props).toMatchObject({ swUrl: URL_SW, cacheOnNavigation: false, reloadOnOnline: false });
  expect(URL_SW).toBe("/serwist/sw.js");
});
