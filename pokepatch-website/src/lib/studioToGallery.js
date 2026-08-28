/**
 * Send Studio before/after slot images as a new gallery item (unpublished).
 * Uses raw slot sources (crops/annotations), never Instagram stitch canvases.
 * Writes go through galleryAdminWrites (same path as Gallery admin).
 */

import {
  createGalleryItem,
  createGalleryPairWithSides,
  uploadGalleryThumbnail,
} from "@/lib/galleryAdminWrites";
import { adminDeleteGalleryItem } from "@/lib/adminApi";
import { resolveStudioImageSource } from "@/lib/studioSlotImage";

const RESOLVE_ATTEMPTS = 2;
const RETRY_DELAY_MS = 600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err, fallback) {
  return err instanceof Error && err.message ? err.message : fallback;
}

function isRetryableResolveError(err) {
  const message = errorMessage(err, "").toLowerCase();
  if (!message) return true;
  if (message.includes("missing ")) return false;
  if (message.includes("unsupported ")) return false;
  return true;
}

async function resolveWithRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= RESOLVE_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= RESOLVE_ATTEMPTS || !isRetryableResolveError(err)) {
        break;
      }
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw new Error(
    `${label}: ${errorMessage(lastError, "Could not prepare image.")}`,
  );
}

function assertUploadSource(source, label) {
  if (!source) {
    throw new Error(`Missing ${label} image.`);
  }
  if (typeof File !== "undefined" && source instanceof File) {
    return source;
  }
  if (
    typeof HTMLCanvasElement !== "undefined" &&
    source instanceof HTMLCanvasElement
  ) {
    return source;
  }
  throw new Error(`Unsupported ${label} image source.`);
}

async function resolvePairSources(pair, index, beforeItems, afterItems, previewUrls) {
  const beforeItem = beforeItems.find((entry) => entry.id === pair.before);
  const afterItem = afterItems.find((entry) => entry.id === pair.after);
  if (!beforeItem?.file || !afterItem?.file) {
    throw new Error(`Pair ${index + 1} is missing a photo.`);
  }

  const beforeSource = assertUploadSource(
    await resolveStudioImageSource(beforeItem, previewUrls?.[beforeItem.id]),
    `pair-${index + 1}-before`,
  );
  const afterSource = assertUploadSource(
    await resolveStudioImageSource(afterItem, previewUrls?.[afterItem.id]),
    `pair-${index + 1}-after`,
  );

  return { beforeSource, afterSource };
}

async function cleanupOrphanGalleryItem(itemId) {
  if (!itemId) return;
  try {
    await adminDeleteGalleryItem(itemId);
  } catch {
    // Best-effort — leave unpublished draft rather than masking the real error.
  }
}

function isImageThumbnail(file) {
  if (!file || typeof Blob === "undefined" || !(file instanceof Blob)) {
    return false;
  }
  return !file.type || file.type.startsWith("image/");
}

/** Create a gallery item and upload each complete Studio pair as before/after. */
export async function publishStudioPairsToGallery({
  pairs,
  beforeItems,
  afterItems,
  previewUrls,
  meta,
  thumbnailFile = null,
  onProgress,
} = {}) {
  const title = (meta?.title ?? "").trim();
  if (!title) {
    throw new Error("Add a card name before sending to gallery.");
  }

  const completePairs = (pairs ?? []).filter((pair) => pair.before && pair.after);
  if (completePairs.length === 0) {
    throw new Error("Fill at least one complete before & after pair.");
  }

  const report = (message) => {
    if (typeof onProgress === "function") onProgress(message);
  };

  // Resolve every image *before* creating the gallery row so a bad/hung decode
  // cannot leave an empty unpublished item behind.
  report(
    completePairs.length === 1
      ? "Preparing images…"
      : `Preparing ${completePairs.length} pairs…`,
  );

  const resolvedPairs = [];
  for (let index = 0; index < completePairs.length; index += 1) {
    const pair = completePairs[index];
    report(`Preparing pair ${index + 1} of ${completePairs.length}…`);
    const sources = await resolveWithRetry(
      () =>
        resolvePairSources(
          pair,
          index,
          beforeItems,
          afterItems,
          previewUrls,
        ),
      `Pair ${index + 1}`,
    );
    resolvedPairs.push(sources);
  }

  report("Creating gallery item…");
  let item;
  try {
    item = await createGalleryItem({ ...meta, title, published: false });
  } catch (err) {
    throw new Error(errorMessage(err, "Could not create gallery item."));
  }

  try {
    for (let index = 0; index < resolvedPairs.length; index += 1) {
      const { beforeSource, afterSource } = resolvedPairs[index];
      report(`Uploading pair ${index + 1} of ${resolvedPairs.length}…`);

      try {
        item = await createGalleryPairWithSides(item.id, {
          beforeFile: beforeSource,
          afterFile: afterSource,
          mediaKind: "image",
        });
      } catch (err) {
        throw new Error(
          `Pair ${index + 1}: ${errorMessage(err, "Could not create gallery pair.")}`,
        );
      }
    }

    // Reuse Studio's already-picked front image — no second TCG catalog fetch.
    // If this fails, keep the pairs rather than deleting a successful publish.
    if (isImageThumbnail(thumbnailFile)) {
      report("Uploading card thumbnail…");
      try {
        item = await uploadGalleryThumbnail(item.id, thumbnailFile);
      } catch {
        // Thumbnail is best-effort once pairs are saved.
      }
    }

    report("Opening gallery…");
    return item;
  } catch (err) {
    await cleanupOrphanGalleryItem(item?.id);
    throw err;
  }
}
