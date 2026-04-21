const INVALID_PHONE_MESSAGE =
  "El teléfono no tiene un formato válido. Usá el formato +598 99 123 456";

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");

  let candidate: string;
  if (cleaned.startsWith("+")) {
    candidate = cleaned;
  } else if (cleaned.startsWith("0")) {
    candidate = `+598${cleaned.slice(1)}`;
  } else {
    throw new Error(INVALID_PHONE_MESSAGE);
  }

  if (!E164_RE.test(candidate)) {
    throw new Error(INVALID_PHONE_MESSAGE);
  }

  return candidate;
}

export function formatPhoneDisplay(e164: string): string {
  const uruguayMobile = /^\+598(\d{2})(\d{3})(\d{3})$/;
  const m = e164.match(uruguayMobile);
  if (m) return `+598 ${m[1]} ${m[2]} ${m[3]}`;
  return e164;
}
