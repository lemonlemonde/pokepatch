#!/usr/bin/env node
/**
 * One-time seed: upload public/gallery assets into the Supabase `gallery` bucket
 * and insert matching `gallery_items` + `gallery_pairs` rows.
 *
 * Prerequisites:
 *   1. Run migrations through 20260714030000_gallery_damage_tags.sql
 *   2. Set env:
 *        NEXT_PUBLIC_SUPABASE_URL
 *        SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage (from pokepatch-website/):
 *   node --env-file=.env.local scripts/seed-gallery.mjs
 *
 * Safe to re-run only if the gallery_items table is empty (exits early otherwise).
 */

import { createClient } from "@supabase/supabase-js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const galleryDir = path.join(root, "public", "gallery");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(url, key);

const SEED = [
  {
    title: "Rocket's Mewtwo",
    set_name: "Gym Challenge",
    damage_tags: ["crease", "scratching"],
    pairs: [
      {
        media_kind: "image",
        before: "mewtwo-before-front.webp",
        after: "mewtwo-after-front.webp",
      },
      {
        media_kind: "image",
        before: "mewtwo-before-back.webp",
        after: "mewtwo-after-back.webp",
      },
      {
        media_kind: "video",
        before: "mewtwo-before-front.mp4",
        after: "mewtwo-after-front.mp4",
      },
      {
        media_kind: "video",
        before: "mewtwo-before-back.mp4",
        after: "mewtwo-after-back.mp4",
      },
    ],
  },
  {
    title: "Scizor ex",
    set_name: "Unseen Forces",
    damage_tags: ["edge_lift", "crease"],
    pairs: [
      {
        media_kind: "image",
        before: "scizor-before-front.webp",
        after: "scizor-after-front.webp",
      },
      {
        media_kind: "image",
        before: "scizor-before-back.webp",
        after: "scizor-after-back.webp",
      },
      {
        media_kind: "video",
        before: "scizor-before-front.mp4",
        after: "scizor-after-front.mp4",
      },
      {
        media_kind: "video",
        before: "scizor-before-back.mp4",
        after: "scizor-after-back.mp4",
      },
    ],
  },
  {
    title: "Reshiram Full Art",
    set_name: "Black and White",
    damage_tags: ["edge_lift", "dirt"],
    pairs: [
      {
        media_kind: "image",
        before: "reshiram-before-front.webp",
        after: "reshiram-after-front.webp",
      },
      {
        media_kind: "image",
        before: "reshiram-before-back.webp",
        after: "reshiram-after-back.webp",
      },
    ],
  },
  {
    title: "Rayquaza",
    set_name: "Delta Species",
    damage_tags: ["crease"],
    pairs: [
      {
        media_kind: "image",
        before: "rayquaza-before-front.webp",
        after: "rayquaza-after-front.webp",
      },
      {
        media_kind: "image",
        before: "rayquaza-before-back.webp",
        after: "rayquaza-after-back.webp",
      },
      {
        media_kind: "video",
        before: "rayquaza-before-front.mp4",
        after: "rayquaza-after-front.mp4",
      },
      {
        media_kind: "video",
        before: "rayquaza-before-back.mp4",
        after: "rayquaza-after-back.mp4",
      },
    ],
  },
  {
    title: "Team Japan's Pikachu",
    set_name: "XY Promos",
    damage_tags: ["dent"],
    pairs: [
      {
        media_kind: "image",
        before: "pikachu-before-front.webp",
        after: "pikachu-after-front.webp",
      },
      {
        media_kind: "image",
        before: "pikachu-before-back.webp",
        after: "pikachu-after-back.webp",
      },
      {
        media_kind: "video",
        before: "pikachu-before-front.mp4",
        after: "pikachu-after-front.mp4",
      },
      {
        media_kind: "video",
        before: "pikachu-before-back.mp4",
        after: "pikachu-after-back.mp4",
      },
    ],
  },
];

function contentType(filename) {
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".mp4")) return "video/mp4";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  if (filename.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function uploadSide(itemId, pairId, side, filename) {
  const localPath = path.join(galleryDir, filename);
  const bytes = await readFile(localPath);
  const storagePath = `item-${itemId}/pair-${pairId}/${side}-${filename}`;
  const { error } = await supabase.storage.from("gallery").upload(storagePath, bytes, {
    contentType: contentType(filename),
    upsert: true,
  });
  if (error) throw error;
  console.log(`  uploaded ${filename}`);
  return storagePath;
}

async function main() {
  const { count, error: countError } = await supabase
    .from("gallery_items")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    console.log(
      `gallery_items already has ${count} row(s). Skipping seed to avoid duplicates.`
    );
    console.log(
      "To re-seed: delete gallery_items rows (pairs cascade), then re-run."
    );
    return;
  }

  await readdir(galleryDir);

  for (const entry of SEED) {
    const itemId = randomUUID();
    const { error: insertError } = await supabase.from("gallery_items").insert({
      id: itemId,
      title: entry.title,
      set_name: entry.set_name,
      damage_tags: entry.damage_tags,
      published: true,
    });
    if (insertError) throw insertError;

    let pairOrder = 0;
    for (const pair of entry.pairs) {
      const pairId = randomUUID();
      const beforePath = await uploadSide(itemId, pairId, "before", pair.before);
      const afterPath = await uploadSide(itemId, pairId, "after", pair.after);
      const { error: pairError } = await supabase.from("gallery_pairs").insert({
        id: pairId,
        item_id: itemId,
        sort_order: pairOrder,
        media_kind: pair.media_kind,
        before_path: beforePath,
        after_path: afterPath,
      });
      if (pairError) throw pairError;
      pairOrder += 1;
    }

    console.log(`Seeded ${entry.title}`);
  }

  console.log("Done. Public /gallery will now load from Supabase.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
