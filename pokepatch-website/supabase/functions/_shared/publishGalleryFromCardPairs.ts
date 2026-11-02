/**
 * Publish order-card before/after source photos as a public gallery item.
 * Copies bytes from the card-photos bucket into the gallery bucket — never
 * Instagram/clamperl stitch canvases.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeDamageTags } from "./damageTags.ts";

const GALLERY_BUCKET = "gallery";
const GALLERY_CACHE_CONTROL = "86400";
const SITE_URL = "https://pokepatch.cards";

export type GallerySourcePair = {
  beforePath: string;
  afterPath: string;
};

export type PublishGalleryFromCardPairsInput = {
  title: string;
  setName?: string;
  damageTags?: unknown;
  tcgCardId?: string | null;
  tcgLookupTitle?: string;
  tcgLookupSetName?: string;
  /** Source storage paths in `sourceBucket` (before/after). */
  pairs: GallerySourcePair[];
  /** Usually `card-photos`. */
  sourceBucket: string;
  /** Optional card-art bytes for the gallery thumbnail. */
  catalogFrontBytes?: Uint8Array | null;
  catalogFrontContentType?: string;
};

export type PublishGalleryFromCardPairsResult = {
  id: string;
  adminUrl: string;
  publicUrl: string;
  pairCount: number;
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

async function cleanupGalleryItem(
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
      await supabase.storage.from(GALLERY_BUCKET).remove(paths);
    }
    await supabase.from("gallery_items").delete().eq("id", itemId);
  } catch (err) {
    console.error("gallery publish cleanup failed", itemId, err);
  }
}

/**
 * Create a published gallery item and copy each source before/after into it.
 * On failure after the row is created, best-effort deletes the orphan item.
 */
export async function publishGalleryFromCardPairs(
  supabase: SupabaseClient,
  input: PublishGalleryFromCardPairsInput
): Promise<PublishGalleryFromCardPairsResult> {
  const title = (input.title ?? "").trim();
  if (!title) {
    throw new Error("gallery publish: title required");
  }
  const pairs = (input.pairs ?? []).filter(
    (pair) => pair?.beforePath && pair?.afterPath
  );
  if (pairs.length === 0) {
    throw new Error("gallery publish: at least one before/after pair required");
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

  const itemId = String(inserted.id);

  try {
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index];
      const { data: pairRow, error: pairError } = await supabase
        .from("gallery_pairs")
        .insert({
          item_id: itemId,
          sort_order: index,
          media_kind: "image",
        })
        .select("id")
        .single();
      if (pairError || !pairRow?.id) {
        throw new Error(
          `gallery publish: create pair ${index + 1} failed: ${
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
        downloadBytes(supabase, input.sourceBucket, pair.beforePath),
        downloadBytes(supabase, input.sourceBucket, pair.afterPath),
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

      const { error: updateError } = await supabase
        .from("gallery_pairs")
        .update({
          before_path: beforeDest,
          after_path: afterDest,
        })
        .eq("id", pairId);
      if (updateError) {
        throw new Error(
          `gallery publish: pair ${index + 1} paths failed: ${updateError.message}`
        );
      }
    }

    if (input.catalogFrontBytes && input.catalogFrontBytes.byteLength > 0) {
      const thumbPath = `item-${itemId}/card-icon.thumb.webp`;
      const contentType =
        (input.catalogFrontContentType ?? "").trim() || "image/jpeg";
      try {
        await uploadBytes(
          supabase,
          thumbPath,
          input.catalogFrontBytes,
          contentType
        );
        await supabase
          .from("gallery_items")
          .update({
            thumbnail_path: thumbPath,
            updated_at: new Date().toISOString(),
          })
          .eq("id", itemId);
      } catch (err) {
        // Thumbnail is best-effort once pairs are saved.
        console.error("gallery publish thumb failed", itemId, err);
      }
    } else {
      await supabase
        .from("gallery_items")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", itemId);
    }

    return {
      id: itemId,
      adminUrl: `${SITE_URL}/admin/gallery/?item=${encodeURIComponent(itemId)}`,
      publicUrl: `${SITE_URL}/gallery/?item=${encodeURIComponent(itemId)}`,
      pairCount: pairs.length,
    };
  } catch (err) {
    await cleanupGalleryItem(supabase, itemId);
    throw err;
  }
}
