/**
 * Load a gallery item into Studio before/after banks (image pairs only).
 */

import { adminGetGalleryItem } from "@/lib/adminApi";
import { fetchTcgCardImageFile } from "@/lib/tcgCardImage";

function isImagePair(pair) {
  const kind = pair?.media_kind || pair?.mediaKind || "image";
  return kind !== "video";
}

function filenameFromUrl(url, fallback) {
  try {
    const path = new URL(url, "https://example.invalid").pathname;
    const base = path.split("/").pop();
    if (base) return decodeURIComponent(base);
  } catch {
    // fall through
  }
  return fallback;
}

async function fileFromUrl(url, fallbackName) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Couldn't download ${fallbackName}.`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`${fallbackName} is not an image.`);
  }
  const name = filenameFromUrl(url, fallbackName);
  return new File([blob], name, {
    type: blob.type || "image/webp",
    lastModified: Date.now(),
  });
}

function studioItemFromFile(file) {
  return {
    id: crypto.randomUUID(),
    file,
    crop: null,
    annotations: null,
  };
}

/** Fetch a gallery item and build Studio before/after banks + card meta. */
export async function buildStudioSeedFromGalleryItem(itemId) {
  const item = await adminGetGalleryItem(itemId);
  if (!item) {
    throw new Error("Gallery item not found.");
  }

  const allPairs = item.pairs ?? [];
  const imagePairs = allPairs.filter(isImagePair);
  const skippedVideoPairs = allPairs.length - imagePairs.length;

  const beforeItems = [];
  const afterItems = [];
  const pairs = [];

  for (let index = 0; index < imagePairs.length; index += 1) {
    const pair = imagePairs[index];
    const beforeUrl = pair.urls?.before ?? null;
    const afterUrl = pair.urls?.after ?? null;
    if (!beforeUrl || !afterUrl) continue;

    const label = `pair-${index + 1}`;
    const [beforeFile, afterFile] = await Promise.all([
      fileFromUrl(beforeUrl, `${label}-before.webp`),
      fileFromUrl(afterUrl, `${label}-after.webp`),
    ]);
    if (!beforeFile || !afterFile) continue;

    const beforeItem = studioItemFromFile(beforeFile);
    const afterItem = studioItemFromFile(afterFile);
    beforeItems.push(beforeItem);
    afterItems.push(afterItem);
    pairs.push({
      id: crypto.randomUUID(),
      before: beforeItem.id,
      after: afterItem.id,
    });
  }

  if (pairs.length === 0) {
    throw new Error(
      skippedVideoPairs > 0
        ? "This item only has video pairs. Studio needs image pairs."
        : "This item has no complete before/after image pairs.",
    );
  }

  let frontFile = null;
  if (item.tcg_card_id) {
    try {
      frontFile = await fetchTcgCardImageFile({
        id: item.tcg_card_id,
        name: item.title,
      });
    } catch {
      frontFile = null;
    }
  }
  if (!frontFile && item.urls?.thumbnail) {
    try {
      frontFile = await fileFromUrl(
        item.urls.thumbnail,
        `${item.title || "card"}-thumb.webp`,
      );
    } catch {
      frontFile = null;
    }
  }

  return {
    beforeItems,
    afterItems,
    pairs,
    cardMeta: {
      card: (item.title ?? "").trim(),
      set: (item.set_name ?? "").trim(),
      frontFile,
    },
  };
}
