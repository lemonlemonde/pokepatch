/**
 * Official card renders. English ids resolve on the Scrydex CDN; Japanese
 * printings (jp-*) use the image URLs stored on the catalog row (TCGplayer).
 * Both CDNs send `access-control-allow-origin: *`, so Studio can fetch into
 * a File and draw onto the export canvas without a proxy.
 */

/** Thumbnail-sized render (~50KB) — search results, list UI. */
export const TCG_IMAGE_SMALL = "small";
/** Full-sized render (~900KB) — anything that gets drawn into an export. */
export const TCG_IMAGE_LARGE = "large";

export function tcgCardImageUrl(card, size = TCG_IMAGE_SMALL) {
  const large = String(card?.image_large ?? "").trim();
  const small = String(card?.image_small ?? "").trim();
  if (size === TCG_IMAGE_LARGE) {
    if (large) return large;
    if (small) return small;
  } else if (small) {
    return small;
  }
  const id = String(card?.id ?? "").trim();
  if (!id || id.startsWith("jp-")) return "";
  return `https://images.scrydex.com/pokemon/${id}/${size}`;
}

function extensionForType(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

/**
 * Download a card's full-sized render as a File, ready to drop into an upload
 * slot. Large rather than small because the Studio card-info chip is drawn at
 * the supersampled export scale, where the small render would be upscaled.
 */
export async function fetchTcgCardImageFile(card) {
  const url = tcgCardImageUrl(card, TCG_IMAGE_LARGE);
  if (!url) throw new Error("That card has no image.");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Couldn't download that card image.");

  const blob = await response.blob();
  const type = blob.type || "image/png";
  const name = `${card.id}.${extensionForType(type)}`;
  return new File([blob], name, { type, lastModified: Date.now() });
}
