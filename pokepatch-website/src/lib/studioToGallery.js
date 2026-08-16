/**
 * Publish Studio before/after slot images as a new gallery item.
 * Uses raw slot sources (crops/annotations), never Instagram stitch canvases.
 */

import {
  adminCreateGalleryItem,
  adminCreateGalleryPair,
  adminUploadGalleryPairSide,
} from "@/lib/adminApi";
import {
  compressImageForUpload,
  GALLERY_THUMB_MAX_DIMENSION,
  makeThumbForUpload,
} from "@/lib/imageCompression";
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

async function compressSideForGallery(file) {
  const { file: uploadFile, error: compressError } =
    await compressImageForUpload(file);
  if (compressError || !uploadFile) {
    throw new Error(compressError || "Couldn't process this image.");
  }
  const { file: thumb } = await makeThumbForUpload(uploadFile, {
    maxDimension: GALLERY_THUMB_MAX_DIMENSION,
  });
  return { uploadFile, thumb };
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

  let item = await adminCreateGalleryItem({
    title,
    set_name: (meta?.set_name ?? "").trim(),
    published: true,
    damage_tags: [],
  });

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

    const beforeUpload = await compressSideForGallery(beforeFile);
    const afterUpload = await compressSideForGallery(afterFile);

    item = await adminCreateGalleryPair(item.id, "image");
    const createdPair =
      (item.pairs ?? []).find(
        (entry) => !entry.urls?.before && !entry.urls?.after,
      ) ?? (item.pairs ?? []).at(-1);
    if (!createdPair?.id) {
      throw new Error(`Could not create gallery pair ${index + 1}.`);
    }

    item = await adminUploadGalleryPairSide(
      createdPair.id,
      "before",
      beforeUpload.uploadFile,
      { thumb: beforeUpload.thumb },
    );
    item = await adminUploadGalleryPairSide(
      createdPair.id,
      "after",
      afterUpload.uploadFile,
      { thumb: afterUpload.thumb },
    );
  }

  return item;
}
