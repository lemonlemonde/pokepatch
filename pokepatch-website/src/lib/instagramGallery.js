/**
 * Hardcoded Instagram permalinks for the public Gallery page (local-only for now).
 *
 * How to add a post or Reel:
 * 1. Open the post/Reel on Instagram (app or web) — must be public.
 * 2. Tap Share → Copy link.
 * 3. Paste into RAW_ITEMS below (optional caption for our own UI under the embed).
 * 4. Save and refresh /gallery.
 *
 * Accepted URL shapes:
 *   https://www.instagram.com/p/SHORTCODE/
 *   https://www.instagram.com/reel/SHORTCODE/
 *   https://www.instagram.com/tv/SHORTCODE/
 *
 * Keep the list small (~6–9). Each embed is a heavy iframe.
 */

const RAW_ITEMS = [
  {
    url: "https://www.instagram.com/p/Da9tOXVFRg-/",
    caption: `🃏Card: Arceus VSTAR (Secret)
🗂️ Set: Crown Zenith: Galarian Gallery

Restoration Performed
• Dents`,
  },
  { url: "https://www.instagram.com/p/Da9tCczlbLt/" },
  { url: "https://www.instagram.com/p/Da4S6KaDSU4/" },
  { url: "https://www.instagram.com/p/Da4QBBMDVsC/" },
];

export function normalizeInstagramUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== "instagram.com") return null;

  const match = parsed.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) return null;

  const [, type, shortcode] = match;
  const pathType = type === "tv" ? "tv" : type;
  return `https://www.instagram.com/${pathType}/${shortcode}/`;
}

export function instagramKindFromUrl(url) {
  if (/\/reel\//.test(url) || /\/tv\//.test(url)) return "reel";
  return "post";
}

function buildItems(entries) {
  const items = [];
  const seen = new Set();

  for (const entry of entries) {
    const rawUrl = typeof entry === "string" ? entry : entry?.url;
    const url = normalizeInstagramUrl(rawUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const caption =
      typeof entry === "object" && typeof entry.caption === "string"
        ? entry.caption.trim()
        : "";

    items.push({
      id: url,
      url,
      kind: instagramKindFromUrl(url),
      caption: caption || null,
    });
  }

  return items;
}

/** Published gallery embeds (hardcoded). */
export const INSTAGRAM_GALLERY_ITEMS = buildItems(RAW_ITEMS);

export const INSTAGRAM_PROFILE_URL = "https://www.instagram.com/pokepatch.cards/";
