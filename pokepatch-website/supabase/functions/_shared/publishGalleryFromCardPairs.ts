/**
 * Publish order-card before/after source photos as a public gallery item.
 * Copies bytes from the card-photos bucket into the gallery bucket — never
 * Instagram/clamperl stitch canvases.
 *
 * Every image side gets a required `.thumb.webp` sibling (ImageScript). Callers
 * that hit Edge CPU limits should publish **one pair per worker**; a failed
 * thumb fails the pair (and the item should be cleaned up). No silent skip.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "npm:imagescript@3.12.2";
import { sanitizeDamageTags } from "./damageTags.ts";

const GALLERY_BUCKET = "gallery";
const GALLERY_CACHE_CONTROL = "86400";
const SITE_URL = "https://pokepatch.cards";
/** Match browser `GALLERY_THUMB_MAX_DIMENSION` in imageCompression.js. */
const GALLERY_THUMB_MAX_DIMENSION = 640;
const GALLERY_THUMB_QUALITY = 70;

export type GallerySourcePair = {
  beforePath: string;
  afterPath: string;
};

export type CreateGalleryItemInput = {
  title: string;
  setName?: string;
  damageTags?: unknown;
  tcgCardId?: string | null;
  tcgLookupTitle?: string;
  tcgLookupSetName?: string;
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || "image.jpg";
}

function contentTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

export function galleryItemAdminUrl(itemId: string): string {
  return `${SITE_URL}/admin/gallery/?item=${encodeURIComponent(itemId)}`;
}

export function galleryItemPublicUrl(itemId: string): string {
  return `${SITE_URL}/gallery/?item=${encodeURIComponent(itemId)}`;
}

async function downloadBytes(
  supabase: SupabaseClient,
  bucket: string,
  path: string
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new Error(`gallery publish: download failed (${bucket}/${path})`);
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadBytes(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const { error } = await supabase.storage.from(GALLERY_BUCKET).upload(path, bytes, {
    upsert: true,
    contentType,
    cacheControl: GALLERY_CACHE_CONTROL,
  });
  if (error) {
    throw new Error(`gallery publish: upload failed (${path}): ${error.message}`);
  }
}

/** Sibling path for list/thumbnail UI: foo.jpg → foo.jpg.thumb.webp */
function thumbSiblingPath(storagePath: string): string {
  if (
    storagePath.endsWith(".thumb.webp") ||
    storagePath.endsWith(".poster.webp")
  ) {
    return storagePath;
  }
  return `${storagePath}.thumb.webp`;
}

function pathsWithThumbSiblings(paths: string[]): string[] {
  const out = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    out.add(path);
    out.add(thumbSiblingPath(path));
  }
  return [...out];
}

/**
 * Downscale + encode a `.thumb.webp` sibling (same convention as admin uploads).
 * Required — decode/encode failures throw so the publish can roll back.
 */
async function uploadThumbSibling(
  supabase: SupabaseClient,
  destPath: string,
  bytes: Uint8Array
): Promise<void> {
  const img = await Image.decode(bytes);
  const maxSide = Math.max(img.width, img.height);
  if (maxSide > GALLERY_THUMB_MAX_DIMENSION) {
    const scale = GALLERY_THUMB_MAX_DIMENSION / maxSide;
    img.resize(
      Math.max(1, Math.round(img.width * scale)),
      Math.max(1, Math.round(img.height * scale))
    );
  }
  const webp = await img.encodeWebP({ quality: GALLERY_THUMB_QUALITY });
  await uploadBytes(
    supabase,
    thumbSiblingPath(destPath),
    webp,
    "image/webp"
  );
}

/** Best-effort delete of an orphan gallery item + its storage objects. */
export async function cleanupGalleryItem(
  supabase: SupabaseClient,
  itemId: string
): Promise<void> {
  try {
    const { data: pairs } = await supabase
      .from("gallery_pairs")
      .select("before_path, after_path")
      .eq("item_id", itemId);
    const paths: string[] = [];
    for (const pair of pairs ?? []) {
      if (pair.before_path) paths.push(String(pair.before_path));
      if (pair.after_path) paths.push(String(pair.after_path));
    }
    const { data: item } = await supabase
      .from("gallery_items")
      .select("thumbnail_path")
      .eq("id", itemId)
      .maybeSingle();
    if (item?.thumbnail_path) paths.push(String(item.thumbnail_path));
    if (paths.length > 0) {
      await supabase.storage
        .from(GALLERY_BUCKET)
        .remove(pathsWithThumbSiblings(paths));
    }
    await supabase.from("gallery_items").delete().eq("id", itemId);
  } catch (err) {
    console.error("gallery publish cleanup failed", itemId, err);
  }
}

/** Create the published gallery row (no pairs yet). */
export async function createPublishedGalleryItem(
  supabase: SupabaseClient,
  input: CreateGalleryItemInput
): Promise<{ id: string; adminUrl: string; publicUrl: string }> {
  const title = (input.title ?? "").trim();
  if (!title) {
    throw new Error("gallery publish: title required");
  }
  const setName = (input.setName ?? "").trim();
  const damageTags = sanitizeDamageTags(input.damageTags);
  const tcgCardId = (input.tcgCardId ?? "").trim() || null;
  const tcgLookupTitle =
    (input.tcgLookupTitle ?? "").trim() || title;
  const tcgLookupSetName =
    (input.tcgLookupSetName ?? "").trim() || setName;

  const { data: inserted, error: insertError } = await supabase
    .from("gallery_items")
    .insert({
      title,
      set_name: setName || null,
      card_number: null,
      damage_tags: damageTags,
      published: true,
      tcg_card_id: tcgCardId,
      tcg_lookup_title: tcgLookupTitle || null,
      tcg_lookup_set_name: tcgLookupSetName || null,
    })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    throw new Error(
      `gallery publish: create item failed: ${insertError?.message ?? "unknown"}`
    );
  }

  const id = String(inserted.id);
  return {
    id,
    adminUrl: galleryItemAdminUrl(id),
    publicUrl: galleryItemPublicUrl(id),
  };
}

/**
 * Copy one before/after pair into an existing gallery item and write required
 * `.thumb.webp` siblings. Throws on any failure (caller should cleanup).
 */
export async function publishGalleryPairWithThumbs(
  supabase: SupabaseClient,
  params: {
    itemId: string;
    sortOrder: number;
    pair: GallerySourcePair;
    sourceBucket: string;
  }
): Promise<void> {
  const { itemId, sortOrder, pair, sourceBucket } = params;
  if (!pair?.beforePath || !pair?.afterPath) {
    throw new Error(`gallery publish: pair ${sortOrder + 1} missing paths`);
  }

  const { data: pairRow, error: pairError } = await supabase
    .from("gallery_pairs")
    .insert({
      item_id: itemId,
      sort_order: sortOrder,
      media_kind: "image",
    })
    .select("id")
    .single();
  if (pairError || !pairRow?.id) {
    throw new Error(
      `gallery publish: create pair ${sortOrder + 1} failed: ${
        pairError?.message ?? "unknown"
      }`
    );
  }

  const pairId = String(pairRow.id);
  const beforeName = sanitizeFilename(basename(pair.beforePath));
  const afterName = sanitizeFilename(basename(pair.afterPath));
  const beforeDest = `item-${itemId}/pair-${pairId}/before-${beforeName}`;
  const afterDest = `item-${itemId}/pair-${pairId}/after-${afterName}`;

  const [beforeBytes, afterBytes] = await Promise.all([
    downloadBytes(supabase, sourceBucket, pair.beforePath),
    downloadBytes(supabase, sourceBucket, pair.afterPath),
  ]);

  await uploadBytes(
    supabase,
    beforeDest,
    beforeBytes,
    contentTypeFromPath(pair.beforePath)
  );
  await uploadBytes(
    supabase,
    afterDest,
    afterBytes,
    contentTypeFromPath(pair.afterPath)
  );
  // Required thumbs — sequential so one Edge hop stays within CPU budget.
  await uploadThumbSibling(supabase, beforeDest, beforeBytes);
  await uploadThumbSibling(supabase, afterDest, afterBytes);

  const { error: updateError } = await supabase
    .from("gallery_pairs")
    .update({
      before_path: beforeDest,
      after_path: afterDest,
    })
    .eq("id", pairId);
  if (updateError) {
    throw new Error(
      `gallery publish: pair ${sortOrder + 1} paths failed: ${updateError.message}`
    );
  }
}

/** Attach catalog card art as the item thumbnail (required when bytes provided). */
export async function setGalleryItemCatalogThumbnail(
  supabase: SupabaseClient,
  itemId: string,
  catalogFrontBytes: Uint8Array,
  catalogFrontContentType?: string
): Promise<void> {
  if (!catalogFrontBytes || catalogFrontBytes.byteLength === 0) {
    throw new Error("gallery publish: catalog thumb bytes required");
  }
  const thumbPath = `item-${itemId}/card-icon.thumb.webp`;
  const contentType = (catalogFrontContentType ?? "").trim() || "image/jpeg";
  await uploadBytes(supabase, thumbPath, catalogFrontBytes, contentType);
  const { error } = await supabase
    .from("gallery_items")
    .update({
      thumbnail_path: thumbPath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (error) {
    throw new Error(`gallery publish: catalog thumb update failed: ${error.message}`);
  }
}

export async function touchGalleryItemUpdatedAt(
  supabase: SupabaseClient,
  itemId: string
): Promise<void> {
  const { error } = await supabase
    .from("gallery_items")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) {
    throw new Error(`gallery publish: touch failed: ${error.message}`);
  }
}
