import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { randomBytes } from "node:crypto";

import {
  encrypt,
  decrypt,
  isEncrypted,
  validateKey,
  MAGIC_PREFIX,
  __resetKeyCacheForTests,
} from "@/lib/encryption";

const IV_LENGTH = 12;
const VALID_KEY_B64 = randomBytes(32).toString("base64");
const ORIGINAL_KEY = process.env.NOTES_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.NOTES_ENCRYPTION_KEY = VALID_KEY_B64;
  __resetKeyCacheForTests();
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.NOTES_ENCRYPTION_KEY;
  } else {
    process.env.NOTES_ENCRYPTION_KEY = ORIGINAL_KEY;
  }
  __resetKeyCacheForTests();
});

afterEach(() => {
  // Tests that mutate the env restore it locally, but enforce a clean
  // baseline so a leaked mutation doesn't cascade into the next test.
  process.env.NOTES_ENCRYPTION_KEY = VALID_KEY_B64;
  __resetKeyCacheForTests();
});

describe("encrypt + decrypt — roundtrip", () => {
  it("decrypt(encrypt(plaintext)) returns the original plaintext", () => {
    const blob = encrypt("hola, sesión clínica");
    expect(decrypt(blob)).toBe("hola, sesión clínica");
  });

  it("encrypting the same plaintext twice produces different blobs (random IV)", () => {
    const a = encrypt("contenido idéntico");
    const b = encrypt("contenido idéntico");
    expect(Buffer.isBuffer(a)).toBe(true);
    expect(Buffer.isBuffer(b)).toBe(true);
    expect(a.equals(b)).toBe(false);
    // Both decrypt to the same plaintext — the difference is only IV/tag/ciphertext.
    expect(decrypt(a)).toBe("contenido idéntico");
    expect(decrypt(b)).toBe("contenido idéntico");
  });

  it("roundtrips an empty string", () => {
    const blob = encrypt("");
    expect(isEncrypted(blob)).toBe(true);
    expect(decrypt(blob)).toBe("");
  });

  it("preserves unicode (acentos, ñ, emojis)", () => {
    const text = "Mariana atendió en Caaguazú: ¿está bien? 👩‍⚕️🇺🇾 — niño/a";
    const blob = encrypt(text);
    expect(decrypt(blob)).toBe(text);
  });

  it("handles plaintext larger than 10KB", () => {
    const text = "ó".repeat(15_000); // multibyte char to push real byte size up
    const blob = encrypt(text);
    const out = decrypt(blob);
    expect(out.length).toBe(text.length);
    expect(out).toBe(text);
  });
});

describe("decrypt — tamper detection", () => {
  it("throws an authTag error when a ciphertext byte is flipped", () => {
    const blob = encrypt("transcripción confidencial");
    const tampered = Buffer.from(blob);
    // Flip the last byte (well inside the ciphertext region).
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(tampered)).toThrow(/authentication tag/i);
  });

  it("throws when the authTag itself is modified", () => {
    const blob = encrypt("payload");
    const tampered = Buffer.from(blob);
    const tagStart = MAGIC_PREFIX.length + IV_LENGTH;
    tampered[tagStart] ^= 0xff;
    expect(() => decrypt(tampered)).toThrow(/authentication tag/i);
  });

  it("throws a prefix-specific error when the buffer does not start with MAGIC_PREFIX", () => {
    // Long enough to pass the length check but missing the magic prefix.
    const fake = Buffer.alloc(64, 0x61); // 64 'a' bytes
    expect(() => decrypt(fake)).toThrow(/magic prefix/i);
  });
});

describe("isEncrypted", () => {
  it("returns false for null", () => {
    expect(isEncrypted(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isEncrypted(undefined)).toBe(false);
  });

  it("returns false for a plain Buffer that lacks the magic prefix", () => {
    expect(isEncrypted(Buffer.from("hola"))).toBe(false);
  });

  it("returns true for a buffer produced by encrypt()", () => {
    const blob = encrypt("ok");
    expect(isEncrypted(blob)).toBe(true);
  });
});

describe("key configuration", () => {
  it("encrypt() and decrypt() throw a clear error when NOTES_ENCRYPTION_KEY is missing", () => {
    // Build a valid blob first, then unset the key so decrypt is forced to read env.
    const validBlob = encrypt("payload");
    delete process.env.NOTES_ENCRYPTION_KEY;
    __resetKeyCacheForTests();

    expect(() => encrypt("x")).toThrow(/NOTES_ENCRYPTION_KEY/);
    expect(() => decrypt(validBlob)).toThrow(/NOTES_ENCRYPTION_KEY/);
  });

  it("validateKey() throws when the key decodes to a wrong byte length", () => {
    process.env.NOTES_ENCRYPTION_KEY = randomBytes(16).toString("base64"); // 16 bytes ≠ 32
    __resetKeyCacheForTests();
    expect(() => validateKey()).toThrow(/NOTES_ENCRYPTION_KEY/);
  });

  it("validateKey() returns undefined (does not throw) with a valid key", () => {
    // Baseline restored by afterEach; the key is the valid one set in beforeAll.
    expect(validateKey()).toBeUndefined();
  });
});
