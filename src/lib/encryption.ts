import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const MAGIC_PREFIX: Buffer = Buffer.from([0x45, 0x4e, 0x43, 0x31]);

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const KEY_ERROR = "NOTES_ENCRYPTION_KEY missing or invalid (expected 32 bytes base64)";

let cachedKey: Buffer | null = null;

/** @internal Exposed only so tests can mock or reset the key cache. */
export function getKey(): Buffer {
  if (cachedKey !== null) return cachedKey;

  const raw = process.env.NOTES_ENCRYPTION_KEY;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(KEY_ERROR);
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_LENGTH) {
    throw new Error(KEY_ERROR);
  }

  cachedKey = decoded;
  return cachedKey;
}

/** @internal Test helper: clears the cached key so a new env value is picked up. */
export function __resetKeyCacheForTests(): void {
  cachedKey = null;
}

export function validateKey(): void {
  getKey();
}

export function isEncrypted(blob: Buffer | null | undefined): boolean {
  if (!blob || !Buffer.isBuffer(blob)) return false;
  if (blob.length < MAGIC_PREFIX.length) return false;
  return timingSafeEqual(
    blob.subarray(0, MAGIC_PREFIX.length),
    MAGIC_PREFIX,
  );
}

export function encrypt(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([MAGIC_PREFIX, iv, authTag, ciphertext]);
}

export function decrypt(blob: Buffer): string {
  if (!Buffer.isBuffer(blob)) {
    throw new Error(
      "Blob does not have encryption magic prefix; data may be corrupted or not encrypted",
    );
  }

  const headerLength = MAGIC_PREFIX.length + IV_LENGTH + AUTH_TAG_LENGTH;
  if (blob.length < headerLength || !isEncrypted(blob)) {
    throw new Error(
      "Blob does not have encryption magic prefix; data may be corrupted or not encrypted",
    );
  }

  const key = getKey();
  const ivStart = MAGIC_PREFIX.length;
  const tagStart = ivStart + IV_LENGTH;
  const ctStart = tagStart + AUTH_TAG_LENGTH;

  const iv = blob.subarray(ivStart, tagStart);
  const authTag = blob.subarray(tagStart, ctStart);
  const ciphertext = blob.subarray(ctStart);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new Error(
      "Decryption failed: authentication tag mismatch (wrong key or tampered data)",
    );
  }
}
