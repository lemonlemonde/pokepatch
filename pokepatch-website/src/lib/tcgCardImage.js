/**
 * Official card renders from the Scrydex CDN, keyed by TCG card id.
 *
 * The CDN answers with `access-control-allow-origin: *`, so these can be
 * fetched straight into a File and drawn onto the Studio export canvas without
 * a proxy and without tainting it.
 */

/** Thumbnail-sized render (~50KB) — search results, list UI. */
export const TCG_IMAGE_SMALL = "small";
/** Full-sized render (~900KB) — anything that gets drawn into an export. */
export const TCG_IMAGE_LARGE = "large";

/**
 * Scrydex first: it serves the same ~245px art as the Pokémon TCG API as
 * JPEG (~34KB) rather than PNG (~180KB). The API's own `small` is the
 * fallback, for cards Scrydex doesn't carry — see tcgCardImageFallbackUrl.
 */
export function tcgCardImageUrl(card, size = TCG_IMAGE_SMALL) {
  if (card?.id) return `https://images.scrydex.com/pokemon/${card.id}/${size}`;
  if (size === TCG_IMAGE_SMALL) return card?.image_small ?? "";
  return card?.image_large ?? card?.image_small ?? "";
}

/** Fallback to swap in when {@link tcgCardImageUrl} 404s. */
export function tcgCardImageFallbackUrl(card, size = TCG_IMAGE_SMALL) {
  if (size === TCG_IMAGE_SMALL) return card?.image_small ?? "";
  return card?.image_large ?? card?.image_small ?? "";
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
