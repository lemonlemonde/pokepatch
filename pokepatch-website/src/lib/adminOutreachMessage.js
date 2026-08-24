/** Default quote-outreach text for phone SMS / Instagram paste. */
export const DEFAULT_OUTREACH_MESSAGE =
  "Hey! This is Ray with pokepatch. Saw that you submitted a quote request on my website. Just reaching out here to lyk that I've added a quote and some details to your order. Feel free to contact me directly here as well.";

/** Digits only, keep leading + for international. */
export function normalizePhoneForSms(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Cross-platform SMS deep link with prefilled body.
 * `?&body=` is intentional: works on both iOS (ampersand) and Android (query).
 */
export function buildSmsHref(phoneValue, message = DEFAULT_OUTREACH_MESSAGE) {
  const phone = normalizePhoneForSms(phoneValue);
  if (!phone) return null;
  return `sms:${phone}?&body=${encodeURIComponent(message)}`;
}

/** Strip @ and URL noise; return bare Instagram username or "". */
export function normalizeInstagramHandle(value) {
  let raw = String(value ?? "").trim();
  if (!raw) return "";
  raw = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "");
  raw = raw.replace(/\/.*$/, "");
  raw = raw.replace(/^@+/, "");
  raw = raw.split(/[?#]/)[0] ?? "";
  raw = raw.trim();
  if (!raw || !/^[A-Za-z0-9._]+$/.test(raw)) return "";
  return raw;
}

export function buildInstagramProfileUrl(handleValue) {
  const handle = normalizeInstagramHandle(handleValue);
  if (!handle) return null;
  return `https://www.instagram.com/${handle}/`;
}

export async function copyOutreachMessage(
  message = DEFAULT_OUTREACH_MESSAGE
) {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("Nothing to copy");
  if (!navigator?.clipboard?.writeText) {
    throw new Error("Clipboard unavailable");
  }
  await navigator.clipboard.writeText(text);
}
