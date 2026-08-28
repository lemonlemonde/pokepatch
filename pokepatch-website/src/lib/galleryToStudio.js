/**
 * Load a gallery item into Studio before/after banks (image pairs only).
 */

import { adminGetGalleryItem } from "@/lib/adminApi";
import { fetchTcgCardImageFile } from "@/lib/tcgCardImage";

const FETCH_TIMEOUT_MS = 45_000;
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fetchBlobOnce(url, fallbackName) {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(url, {
      signal: controller?.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Couldn't download ${fallbackName}.`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      throw new Error(`${fallbackName} is not an image.`);
    }
    return blob;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`Timed out downloading ${fallbackName}.`);
    }
    throw err instanceof Error
      ? err
      : new Error(`Couldn't download ${fallbackName}.`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fileFromUrl(url, fallbackName) {
  if (!url) return null;

  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const blob = await fetchBlobOnce(url, fallbackName);
      const name = filenameFromUrl(url, fallbackName);
      return new File([blob], name, {
        type: blob.type || "image/webp",
        lastModified: Date.now(),
      });
    } catch (err) {
      lastError = err;
      const message = (err instanceof Error ? err.message : "").toLowerCase();
      if (message.includes("not an image")) break;
      if (attempt < FETCH_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Couldn't download ${fallbackName}.`);
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
  const failures = [];

  for (let index = 0; index < imagePairs.length; index += 1) {
    const pair = imagePairs[index];
    const beforeUrl = pair.urls?.before ?? null;
    const afterUrl = pair.urls?.after ?? null;
    if (!beforeUrl || !afterUrl) continue;

    const label = `pair-${index + 1}`;
    try {
      const [beforeFile, afterFile] = await Promise.all([
        fileFromUrl(beforeUrl, `${label}-before.webp`),
        fileFromUrl(afterUrl, `${label}-after.webp`),
      ]);
      if (!beforeFile || !afterFile) {
        failures.push(label);
        continue;
      }

      const beforeItem = studioItemFromFile(beforeFile);
      const afterItem = studioItemFromFile(afterFile);
      beforeItems.push(beforeItem);
      afterItems.push(afterItem);
      pairs.push({
        id: crypto.randomUUID(),
        before: beforeItem.id,
        after: afterItem.id,
      });
    } catch (err) {
      failures.push(
        err instanceof Error ? `${label} (${err.message})` : label,
      );
    }
  }

  if (pairs.length === 0) {
    if (failures.length > 0) {
      throw new Error(
        `Could not load gallery images: ${failures.join("; ")}`,
      );
    }
    throw new Error(
      skippedVideoPairs > 0
        ? "This item only has video pairs. Studio needs image pairs."
        : "This item has no complete before/after image pairs.",
    );
  }

  let frontFile = null;
  // Prefer the stored gallery thumbnail (already on our CDN) over another TCG fetch.
  if (item.urls?.thumbnail) {
    try {
      frontFile = await fileFromUrl(
        item.urls.thumbnail,
        `${item.title || "card"}-thumb.webp`,
      );
    } catch {
      frontFile = null;
    }
  }
  if (!frontFile && item.tcg_card_id) {
    try {
      frontFile = await fetchTcgCardImageFile({
        id: item.tcg_card_id,
        name: item.title,
      });
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
      showCardInfo: true,
      frontFile,
      tcg_card_id: (item.tcg_card_id ?? "").trim(),
      card_number: (item.card_number ?? "").trim(),
      tcg_lookup_title: (item.tcg_lookup_title ?? item.title ?? "").trim(),
      tcg_lookup_set_name: (item.tcg_lookup_set_name ?? item.set_name ?? "").trim(),
    },
  };
}
