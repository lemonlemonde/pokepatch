#!/usr/bin/env node
/**
 * One-off maintenance: downscale + re-encode oversized images already stored in
 * the `gallery` bucket so they load fast and stay under Supabase's image
 * transform size limit (~25MB). Each file is overwritten in place (same path
 * and format), so no DB rows or storage paths change.
 *
 * Prerequisites:
 *   - Set env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage (from pokepatch-website/):
 *   node --env-file=.env.local scripts/recompress-gallery.mjs --dry-run
 *   node --env-file=.env.local scripts/recompress-gallery.mjs
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const BUCKET = "gallery";
const MAX_DIM = 2000;
const SIZE_FLOOR = 1_500_000; // leave already-small files (<1.5MB, <=2000px) alone
const dryRun = process.argv.includes("--dry-run");
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

const supabase = createClient(url, key);

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

async function collectPaths() {
  const paths = new Set();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("gallery_pairs")
      .select("before_path, after_path")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.before_path) paths.add(row.before_path);
      if (row.after_path) paths.add(row.after_path);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return [...paths];
}

async function handlePath(path) {
  if (!IMAGE_EXT.test(path)) return { path, note: "skip (not an image)" };

  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) return { path, note: `ERROR download: ${error.message}` };

  const input = Buffer.from(await data.arrayBuffer());
  const meta = await sharp(input).metadata();
  const maxSide = Math.max(meta.width ?? 0, meta.height ?? 0);

  if (maxSide <= MAX_DIM && input.length < SIZE_FLOOR) {
    return { path, note: `skip (${maxSide}px, ${mb(input.length)})` };
  }

  let pipeline = sharp(input)
    .rotate() // bake in EXIF orientation
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true });

  const format = (meta.format || "").toLowerCase();
  let contentType;
  if (format === "png") {
    pipeline = pipeline.png({ compressionLevel: 9 });
    contentType = "image/png";
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality: 82 });
    contentType = "image/webp";
  } else {
    pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });
    contentType = "image/jpeg";
  }

  const output = await pipeline.toBuffer();
  if (output.length >= input.length) {
    return { path, note: `skip (no gain ${mb(input.length)} -> ${mb(output.length)})` };
  }

  const change = `${mb(input.length)} -> ${mb(output.length)} (${maxSide}px -> ${Math.min(
    maxSide,
    MAX_DIM
  )}px)`;

  if (dryRun) return { path, note: `WOULD write ${change}` };

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, output, { upsert: true, contentType });
  if (upErr) return { path, note: `ERROR upload: ${upErr.message}` };

  return { path, note: `wrote ${change}` };
}

async function main() {
  const paths = await collectPaths();
  console.log(
    `Found ${paths.length} referenced image(s).${dryRun ? " (dry run — no writes)" : ""}\n`
  );
  let written = 0;
  for (const path of paths) {
    const result = await handlePath(path);
    console.log(`${result.note.padEnd(40)}  ${path}`);
    if (result.note.startsWith("wrote")) written += 1;
  }
  console.log(`\nDone. ${dryRun ? "Dry run complete." : `Rewrote ${written} file(s).`}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
