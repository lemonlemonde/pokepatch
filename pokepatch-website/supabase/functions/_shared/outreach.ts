/**
 * Edge mirror of src/lib/adminOutreachMessage.js — the copy/paste quote
 * outreach text and contact deep links. Edit the JS file first, then sync.
 */

export const DEFAULT_OUTREACH_MESSAGE =
  "Hey! This is Ray with pokepatch. Saw that you submitted a quote request on my website. Just reaching out here to lyk that I've added a quote and some details to your order. Feel free to contact me directly here as well.";

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  phone: "Phone",
  discord: "Discord",
  instagram: "Instagram",
};

/** Strip @ and URL noise; return bare Instagram username or "". */
export function normalizeInstagramHandle(value: unknown): string {
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

export function instagramProfileUrl(value: unknown): string | null {
  const handle = normalizeInstagramHandle(value);
  return handle ? `https://www.instagram.com/${handle}/` : null;
}

/** Discord only deep-links by snowflake; accepts a bare id or users/<id> URL. */
export function normalizeDiscordUserId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const fromUrl = raw.match(
    /(?:https?:\/\/)?(?:www\.)?discord(?:app)?\.com\/users\/(\d{17,20})/i
  );
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^\d{17,20}$/.test(raw)) return raw;
  return "";
}
