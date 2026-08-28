/**
 * Shared admin gallery write helpers.
 * Studio + Gallery admin both go through these so create/upload behavior matches.
 */

import {
  adminCreateGalleryItem,
  adminCreateGalleryPair,
  adminSaveGalleryItem,
  adminUploadGalleryPairSide,
  adminUploadGalleryThumbnail,
} from "@/lib/adminApi";
import { normalizeDamageTags } from "@/lib/damageTags";
import {
  CARD_THUMB_MAX_DIMENSION,
  compressImageForUpload,
  GALLERY_THUMB_MAX_DIMENSION,
  makeThumbForUpload,
  makeVideoPosterForUpload,
} from "@/lib/imageCompression";

const UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withUploadRetries(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= UPLOAD_ATTEMPTS) break;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  const message =
    lastError instanceof Error && lastError.message
      ? lastError.message
      : `Could not upload ${label}.`;
  throw new Error(message);
}

/** Canonical gallery item fields for create/save (same shape everywhere). */
export function normalizeGalleryItemFields({
  title = "",
  set_name = "",
  card_number = "",
  tcg_lookup_title = "",
  tcg_lookup_set_name = "",
  tcg_card_id = "",
  damage_tags = [],
  published = true,
} = {}) {
  return {
    title: (title ?? "").trim(),
    set_name: (set_name ?? "").trim(),
    card_number: (card_number ?? "").trim(),
    tcg_lookup_title: (tcg_lookup_title ?? "").trim(),
    tcg_lookup_set_name: (tcg_lookup_set_name ?? "").trim(),
    tcg_card_id: (tcg_card_id ?? "").trim(),
    damage_tags: normalizeDamageTags(damage_tags),
    published: published !== false,
  };
}

export async function createGalleryItem(fields) {
  return adminCreateGalleryItem(normalizeGalleryItemFields(fields));
}

export async function saveGalleryItem(id, fields) {
  return adminSaveGalleryItem(id, normalizeGalleryItemFields(fields));
}

/**
 * Compress an image (or capture a video poster) the same way Gallery admin does
 * before calling the gallery pair-side upload endpoint.
 * `file` may be a File/Blob or an HTMLCanvasElement (Studio crop/annotation).
 */
async function prepareGalleryPairSideUpload(file) {
  if (!file) {
    throw new Error("Missing file.");
  }

  if (file.type?.startsWith("video/")) {
    const { file: poster, error: posterError } =
      await makeVideoPosterForUpload(file);
    if (posterError || !poster) {
      throw new Error(
        posterError || "Couldn't capture a poster from this video.",
      );
    }
    return { uploadFile: file, thumb: null, poster };
  }

  const { file: uploadFile, error: compressError } =
    await compressImageForUpload(file);
  if (compressError || !uploadFile) {
    throw new Error(compressError || "Couldn't process this image.");
  }
  const { file: thumb } = await makeThumbForUpload(uploadFile, {
    maxDimension: GALLERY_THUMB_MAX_DIMENSION,
  });
  return { uploadFile, thumb, poster: null };
}

/** Prepare + upload one before/after side (image or video). */
export async function uploadGalleryPairSide(pairId, side, file) {
  const { uploadFile, thumb, poster } =
    await prepareGalleryPairSideUpload(file);
  return withUploadRetries(
    () =>
      adminUploadGalleryPairSide(pairId, side, uploadFile, {
        thumb,
        poster,
      }),
    side,
  );
}

/**
 * Create an empty pair on an item, then upload before + after with the same
 * compression/thumb pipeline Gallery admin uses.
 * Side inputs may be File/Blob or HTMLCanvasElement.
 */
export async function createGalleryPairWithSides(
  itemId,
  { beforeFile, afterFile, mediaKind = "image" } = {},
) {
  if (!beforeFile || !afterFile) {
    throw new Error("Each pair needs both a before and an after.");
  }

  let item = await adminCreateGalleryPair(itemId, mediaKind);
  const createdPair =
    (item.pairs ?? []).find(
      (entry) => !entry.urls?.before && !entry.urls?.after,
    ) ?? (item.pairs ?? []).at(-1);
  if (!createdPair?.id) {
    throw new Error("Could not create gallery pair.");
  }

  item = await uploadGalleryPairSide(createdPair.id, "before", beforeFile);
  item = await uploadGalleryPairSide(createdPair.id, "after", afterFile);
  return item;
}

/** Compress + upload the card-icon thumbnail (Gallery admin path). */
export async function uploadGalleryThumbnail(itemId, file) {
  const { file: uploadFile, error: compressError } =
    await compressImageForUpload(file, {
      maxDimension: CARD_THUMB_MAX_DIMENSION,
    });
  if (compressError || !uploadFile) {
    throw new Error(compressError || "Couldn't process this image.");
  }
  return withUploadRetries(
    () => adminUploadGalleryThumbnail(itemId, uploadFile),
    "thumbnail",
  );
}
