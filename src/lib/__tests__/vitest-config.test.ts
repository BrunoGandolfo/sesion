// Sólo la suite unitaria corre archivos en paralelo: la de integración
// comparte una base que cada archivo vacía, y `npm test` (sin suite) la
// incluye.
import { afterEach, expect, it, vi } from "vitest";

const SUITE_ORIGINAL = process.env.VITEST_SUITE;

afterEach(() => {
  if (SUITE_ORIGINAL === undefined) delete process.env.VITEST_SUITE;
  else process.env.VITEST_SUITE = SUITE_ORIGINAL;
  vi.resetModules();
});

async function configCon(suite: string | undefined) {
  if (suite === undefined) delete process.env.VITEST_SUITE;
  else process.env.VITEST_SUITE = suite;
  vi.resetModules();
  return (await import("../../../vitest.config")).default as { test: { fileParallelism?: boolean } };
}

it("los unitarios corren en paralelo; la integración y npm test, de a un archivo", async () => {
  expect((await configCon("unit")).test.fileParallelism).toBe(true);
  expect((await configCon("integration")).test.fileParallelism).toBe(false);
  expect((await configCon(undefined)).test.fileParallelism).toBe(false);
});
