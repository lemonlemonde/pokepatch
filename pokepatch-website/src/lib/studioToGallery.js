/**
 * Publish Studio before/after slot images as a new gallery item.
 * Uses raw slot sources (crops/annotations), never Instagram stitch canvases.
 * Writes go through galleryAdminWrites (same path as Gallery admin).
 */

import {
  createGalleryItem,
  createGalleryPairWithSides,
} from "@/lib/galleryAdminWrites";
import { resolveStudioImageSource } from "@/lib/studioSlotImage";

async function sourceToFile(source, label) {
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
    const blob = await new Promise((resolve, reject) => {
      source.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error(`Couldn't export ${label} image.`));
        },
        "image/webp",
        0.92,
      );
    });
    return new File([blob], `${label}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
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

  // Same field shape / defaults as Gallery admin create.
  let item = await createGalleryItem({ ...meta, title });

  for (let index = 0; index < completePairs.length; index += 1) {
    const pair = completePairs[index];
    const beforeItem = beforeItems.find((entry) => entry.id === pair.before);
    const afterItem = afterItems.find((entry) => entry.id === pair.after);
    if (!beforeItem?.file || !afterItem?.file) {
      throw new Error(`Pair ${index + 1} is missing a photo.`);
    }

    const beforeSource = await resolveStudioImageSource(
      beforeItem,
      previewUrls[beforeItem.id],
    );
    const afterSource = await resolveStudioImageSource(
      afterItem,
      previewUrls[afterItem.id],
    );

    const beforeFile = await sourceToFile(
      beforeSource,
      `pair-${index + 1}-before`,
    );
    const afterFile = await sourceToFile(
      afterSource,
      `pair-${index + 1}-after`,
    );

    try {
      item = await createGalleryPairWithSides(item.id, {
        beforeFile,
        afterFile,
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
