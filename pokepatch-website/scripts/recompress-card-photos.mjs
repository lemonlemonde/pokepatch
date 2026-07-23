#!/usr/bin/env node
/**
 * One-off maintenance: shrink oversized `card-photos` originals in place.
 *
 * Why: a few customer uploads predate (or bypassed) client-side compression —
 * e.g. 28–36MB PNG scans. Every full-size view (lightbox, stale cached URL)
 * costs that many bytes of Storage egress. This re-encodes any original above
 * --min-bytes (default 2MB) to ≤1200px WebP, matching the app's upload
 * pipeline (imageCompression.js UPLOAD_MAX_DIMENSION / UPLOAD_QUALITY).
 *
 * In-place: the storage path (and therefore card_images.storage_path and the
 * .thumb.webp sibling) stays the same — no DB changes, existing signed URLs
 * keep working. The stored Content-Type becomes image/webp even when the
 * path ends in .png/.jpg; browsers go by Content-Type, not extension.
 *
 * Skips: .thumb.webp/.poster.webp siblings, GIFs (may be animated), videos,
 * and anything already under --min-bytes.
 *
 * WARNING: downloads each oversized original once (counts as egress) and
 * REPLACES it. Before replacing, each original is saved locally to
 * storage-backup/card-photos/<path> (gitignored) so full-res scans are
 * recoverable. Run --dry-run first.
 *
 * Prerequisites: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage (from pokepatch-website/):
 *   node --env-file=.env.local scripts/recompress-card-photos.mjs --dry-run
 *   node --env-file=.env.local scripts/recompress-card-photos.mjs
 *   node --env-file=.env.local scripts/recompress-card-photos.mjs --prefix=order-<uuid>
 *   node --env-file=.env.local scripts/recompress-card-photos.mjs --min-bytes=5000000
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import ws from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const BUCKET = "card-photos";
/** Matches imageCompression.js UPLOAD_MAX_DIMENSION / UPLOAD_QUALITY. */
const MAX_DIM = 1200;
const WEBP_QUALITY = 75;
/** Matches admin-api IMMUTABLE_CACHE_CONTROL for card-photos objects. */
const CACHE_CONTROL = "604800";

const dryRun = process.argv.includes("--dry-run");
const prefixArg =
  process.argv
    .find((arg) => arg.startsWith("--prefix="))
    ?.slice("--prefix=".length)
    ?.replace(/^\/+|\/+$/g, "") || "";
const minBytes = Number(
  process.argv
    .find((arg) => arg.startsWith("--min-bytes="))
    ?.slice("--min-bytes=".length) ?? 2 * 1024 * 1024
);

const SIBLING_EXT = /\.(thumb|poster)\.webp$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|heic|bmp|tiff?)$/i;
/** Local safety copy of every original before it is replaced. */
const BACKUP_DIR = join(process.cwd(), "storage-backup", BUCKET);

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Node 20 has no global WebSocket; storage scripts don't need Realtime,
  // but the client still constructs it.
  realtime: { transport: ws },
});

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

/** Returns [{ path, size }] for every object in the bucket. */
async function listAllFiles(prefix = "") {
  const out = [];
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders have id null and no metadata in some API versions.
      if (entry.id == null && !entry.metadata) {
        const nested = await listAllFiles(path);
        out.push(...nested);
      } else {
        out.push({ path, size: entry.metadata?.size ?? 0 });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function handleFile({ path, size }) {
  if (SIBLING_EXT.test(path)) return { path, note: "skip (sibling)" };
  if (!IMAGE_EXT.test(path)) return { path, note: "skip (not an image)" };
  if (size < minBytes) return { path, note: `skip (${mb(size)} < floor)` };

  if (dryRun) {
    return { path, note: `WOULD recompress ${mb(size)} -> ≤${MAX_DIM}px webp` };
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) return { path, note: `ERROR download: ${error.message}` };

  const input = Buffer.from(await data.arrayBuffer());

  // Keep a local full-res copy before replacing anything in Storage.
  try {
    const backupPath = join(BACKUP_DIR, path);
    mkdirSync(dirname(backupPath), { recursive: true });
    writeFileSync(backupPath, input);
  } catch (err) {
    return { path, note: `ERROR backup (skipping replace): ${err.message}` };
  }

  let output;
  try {
    output = await sharp(input)
      .rotate() // bake in EXIF orientation
      .resize({
        width: MAX_DIM,
        height: MAX_DIM,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (err) {
    return { path, note: `ERROR encode: ${err.message}` };
  }

  if (output.length >= input.length) {
    return { path, note: `skip (no gain ${mb(input.length)} -> ${mb(output.length)})` };
  }

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, output, {
      upsert: true,
      contentType: "image/webp",
      cacheControl: CACHE_CONTROL,
    });
  if (upErr) return { path, note: `ERROR upload: ${upErr.message}` };

  return {
    path,
    note: `wrote ${mb(input.length)} -> ${mb(output.length)}`,
    saved: input.length - output.length,
  };
}

async function main() {
  console.log(
    `Recompress card-photos originals ≥ ${mb(minBytes)}.` +
      `${dryRun ? " (dry run — no downloads/writes)" : ""}\n` +
      (prefixArg ? `Prefix: ${prefixArg}\n` : "") +
      `NOTE: the real run downloads each oversized original once (egress) and replaces it.\n`
  );

  const files = await listAllFiles(prefixArg);
  const oversized = files.filter(
    (f) => !SIBLING_EXT.test(f.path) && IMAGE_EXT.test(f.path) && f.size >= minBytes
  );
  const totalOversized = oversized.reduce((sum, f) => sum + f.size, 0);
  console.log(
    `Listed ${files.length} objects; ${oversized.length} oversized (${mb(totalOversized)} total)\n`
  );

  let written = 0;
  let saved = 0;
  for (const file of oversized) {
    const result = await handleFile(file);
    console.log(`${result.note.padEnd(55)}  ${result.path}`);
    if (result.note.startsWith("wrote")) {
      written += 1;
      saved += result.saved ?? 0;
    }
  }

  console.log(
    `\nDone. ${
      dryRun
        ? `Dry run complete — would process ${oversized.length} file(s).`
        : `Rewrote ${written} file(s), saved ${mb(saved)}.`
    }`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
