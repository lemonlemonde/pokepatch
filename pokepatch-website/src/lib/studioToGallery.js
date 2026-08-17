/**
 * Send Studio before/after slot images as a new gallery item (unpublished).
 * Uses raw slot sources (crops/annotations), never Instagram stitch canvases.
 * Writes go through galleryAdminWrites (same path as Gallery admin).
 */

import {
  createGalleryItem,
  createGalleryPairWithSides,
} from "@/lib/galleryAdminWrites";
import { resolveStudioImageSource } from "@/lib/studioSlotImage";

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

/** Create a gallery item and upload each complete Studio pair as before/after. */
export async function publishStudioPairsToGallery({
  pairs,
  beforeItems,
  afterItems,
  previewUrls,
  meta,
}) {
  const title = (meta?.title ?? "").trim();
  if (!title) {
    throw new Error("Add a card name before sending to gallery.");
  }

  const completePairs = (pairs ?? []).filter((pair) => pair.before && pair.after);
  if (completePairs.length === 0) {
    throw new Error("Fill at least one complete before & after pair.");
  }

  // Match Gallery admin create fields, but keep off the public gallery until published.
  let item = await createGalleryItem({ ...meta, title, published: false });

  for (let index = 0; index < completePairs.length; index += 1) {
    const pair = completePairs[index];
    const beforeItem = beforeItems.find((entry) => entry.id === pair.before);
    const afterItem = afterItems.find((entry) => entry.id === pair.after);
    if (!beforeItem?.file || !afterItem?.file) {
      throw new Error(`Pair ${index + 1} is missing a photo.`);
    }

    const beforeSource = assertUploadSource(
      await resolveStudioImageSource(beforeItem, previewUrls[beforeItem.id]),
      `pair-${index + 1}-before`,
    );
    const afterSource = assertUploadSource(
      await resolveStudioImageSource(afterItem, previewUrls[afterItem.id]),
      `pair-${index + 1}-after`,
    );

    try {
      item = await createGalleryPairWithSides(item.id, {
        beforeFile: beforeSource,
        afterFile: afterSource,
        mediaKind: "image",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not create gallery pair.";
      throw new Error(`Pair ${index + 1}: ${message}`);
    }
  }

  return item;
}
