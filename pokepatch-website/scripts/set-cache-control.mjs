#!/usr/bin/env node
/**
 * One-off maintenance: give existing Storage objects a proper Cache-Control.
 *
 * Why: objects uploaded before 2026-07-21 (and all backfilled .thumb.webp /
 * .poster.webp siblings) carry the Storage default `max-age=3600`, so
 * browsers re-download them every hour. On the Free plan CDN-cached egress
 * still counts, so the browser cache is the only cache that reduces billed
 * egress — long TTLs matter.
 *
 * Targets (skips objects whose cacheControl is already correct):
 *   - card-photos siblings (*.thumb.webp / *.poster.webp): 31536000 (1y —
 *     derived, additive-only, never replaced)
 *   - card-photos originals: 604800 (7d — matches admin-api
 *     IMMUTABLE_CACHE_CONTROL; paths are unique and never overwritten)
 *   - gallery (everything): 86400 (1d — matches admin-api
 *     GALLERY_CACHE_CONTROL; gallery files can be replaced in place, so a
 *     long TTL would pin stale content)
 *
 * Supabase has no metadata-only update, so this downloads + re-uploads each
 * object (download counts as egress — siblings are ~10KB each, originals can
 * be MBs). Run scripts/recompress-card-photos.mjs FIRST so the whale files
 * are small before this touches originals. Use --siblings-only to skip
 * originals entirely.
 *
 * Prerequisites: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage (from pokepatch-website/):
 *   node --env-file=.env.local scripts/set-cache-control.mjs --dry-run
 *   node --env-file=.env.local scripts/set-cache-control.mjs --siblings-only
 *   node --env-file=.env.local scripts/set-cache-control.mjs
 *   node --env-file=.env.local scripts/set-cache-control.mjs --bucket=card-photos
 */

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const siblingsOnly = process.argv.includes("--siblings-only");
const bucketArg = process.argv
  .find((arg) => arg.startsWith("--bucket="))
  ?.slice("--bucket=".length);

const BUCKETS = bucketArg ? [bucketArg] : ["card-photos", "gallery"];
const SIBLING_EXT = /\.(thumb|poster)\.webp$/i;

/** Matches backfill-thumbs.mjs SIBLING_CACHE_CONTROL. */
const SIBLING_TTL = "31536000";
/** Matches admin-api IMMUTABLE_CACHE_CONTROL. */
const CARD_ORIGINAL_TTL = "604800";
/** Matches admin-api GALLERY_CACHE_CONTROL (replace-in-place bucket). */
const GALLERY_TTL = "86400";

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Node 20 has no global WebSocket; storage scripts don't need Realtime,
  // but the client still constructs it.
  realtime: { transport: ws },
});

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function desiredTtl(bucket, path) {
  if (bucket === "gallery") return GALLERY_TTL;
  return SIBLING_EXT.test(path) ? SIBLING_TTL : CARD_ORIGINAL_TTL;
}

/** Returns [{ path, size, cacheControl, mimetype }] for every object. */
async function listAllFiles(bucket, prefix = "") {
  const out = [];
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
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
        const nested = await listAllFiles(bucket, path);
        out.push(...nested);
      } else {
        out.push({
          path,
          size: entry.metadata?.size ?? 0,
          cacheControl: entry.metadata?.cacheControl ?? "",
          mimetype: entry.metadata?.mimetype ?? undefined,
        });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function handleFile(bucket, file) {
  const ttl = desiredTtl(bucket, file.path);
  const current = file.cacheControl.replace(/^max-age=/, "");
  if (current === ttl) return { ...file, note: "skip (already set)" };
  if (siblingsOnly && !SIBLING_EXT.test(file.path)) {
    return { ...file, note: "skip (--siblings-only)" };
  }

  if (dryRun) {
    return {
      ...file,
      note: `WOULD set max-age=${ttl} (now ${file.cacheControl || "unset"}, ${mb(file.size)})`,
    };
  }

  const { data, error } = await supabase.storage.from(bucket).download(file.path);
  if (error) return { ...file, note: `ERROR download: ${error.message}` };

  const bytes = Buffer.from(await data.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(file.path, bytes, {
      upsert: true,
      contentType: file.mimetype,
      cacheControl: ttl,
    });
  if (upErr) return { ...file, note: `ERROR upload: ${upErr.message}` };

  return { ...file, note: `set max-age=${ttl} (${mb(file.size)})` };
}

async function main() {
  console.log(
    `Set Cache-Control on existing objects.` +
      `${dryRun ? " (dry run — no downloads/writes)" : ""}` +
      `${siblingsOnly ? " (siblings only)" : ""}\n` +
      `Buckets: ${BUCKETS.join(", ")}\n` +
      `NOTE: the real run downloads each touched object once (egress).\n`
  );

  let written = 0;
  for (const bucket of BUCKETS) {
    console.log(`\n=== ${bucket} ===`);
    const files = await listAllFiles(bucket);
    const touched = files.filter((f) => {
      if (siblingsOnly && !SIBLING_EXT.test(f.path)) return false;
      return f.cacheControl.replace(/^max-age=/, "") !== desiredTtl(bucket, f.path);
    });
    const totalBytes = touched.reduce((sum, f) => sum + f.size, 0);
    console.log(
      `Listed ${files.length} objects; ${touched.length} need updating ` +
        `(${mb(totalBytes)} would be downloaded)\n`
    );

    for (const file of files) {
      const result = await handleFile(bucket, file);
      if (result.note.startsWith("skip (already")) continue;
      console.log(`${result.note.padEnd(60)}  ${file.path}`);
      if (result.note.startsWith("set")) written += 1;
    }
  }

  console.log(`\nDone. ${dryRun ? "Dry run complete." : `Updated ${written} object(s).`}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
