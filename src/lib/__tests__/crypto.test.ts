import { expect, test } from "vitest";
import { sha256Hex } from "@/lib/crypto";
test("sha256 conserva el contrato de tokens y auditoría", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
