#!/usr/bin/env node
/**
 * Backfill Storage siblings for list/thumbnail UI (no Image Transformations):
 *   - Images in `gallery` + `card-photos` → `<path>.thumb.webp`
 *   - Gallery videos → `<path>.poster.webp` (requires ffmpeg on PATH)
 *
 * WARNING: The real (non-dry-run) pass downloads originals to resize them —
 * that counts as Storage egress. --dry-run only lists objects (no downloads).
 * Prefer waiting for a billing-cycle reset or a brief upgrade before the
 * real run if you are already over quota.
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - ffmpeg (only for video posters)
 *
 * Usage (from pokepatch-website/):
 *   node --env-file=.env.local scripts/backfill-thumbs.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-thumbs.mjs
 *   node --env-file=.env.local scripts/backfill-thumbs.mjs --bucket=gallery
 *   node --env-file=.env.local scripts/backfill-thumbs.mjs --bucket=card-photos
 *   node --env-file=.env.local scripts/backfill-thumbs.mjs --bucket=card-photos --prefix=order-<uuid>
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import ws from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const bucketArg = process.argv
  .find((arg) => arg.startsWith("--bucket="))
  ?.slice("--bucket=".length);
const prefixArg =
  process.argv
    .find((arg) => arg.startsWith("--prefix="))
    ?.slice("--prefix=".length)
    ?.replace(/^\/+|\/+$/g, "") || "";

const BUCKETS = bucketArg ? [bucketArg] : ["gallery", "card-photos"];
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const SIBLING_EXT = /\.(thumb|poster)\.webp$/i;

const CARD_THUMB_DIM = 320;
const GALLERY_THUMB_DIM = 640;
const POSTER_DIM = 640;

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  // Node 20 has no global WebSocket; storage scripts don't need Realtime,
  // but the client still constructs it.
  realtime: { transport: ws },
});

function thumbPath(path) {
  return `${path}.thumb.webp`;
}

function posterPath(path) {
  return `${path}.poster.webp`;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

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
        out.push(path);
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function backfillImage(bucket, path, existing) {
  const sibling = thumbPath(path);
  if (existing.has(sibling)) {
    return { path, note: "skip (thumb exists)" };
  }

  // Dry-run: list-only — no downloads (downloads count as egress).
  if (dryRun) {
    return { path, note: `WOULD write thumb -> ${sibling}` };
  }

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) return { path, note: `ERROR download: ${error.message}` };

  const input = Buffer.from(await data.arrayBuffer());
  const maxDim = bucket === "gallery" ? GALLERY_THUMB_DIM : CARD_THUMB_DIM;
  const output = await makeThumbBuffer(input, maxDim);

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(sibling, output, {
      // Additive only — never replace an existing sibling or original.
      upsert: false,
      contentType: "image/webp",
    });
  if (upErr) {
    if (/already exists|Duplicate|resource already/i.test(upErr.message)) {
      existing.add(sibling);
      return { path, note: "skip (thumb exists)" };
    }
    return { path, note: `ERROR upload thumb: ${upErr.message}` };
  }
  existing.add(sibling);
  return { path, note: `wrote thumb ${mb(output.length)}` };
}

async function makeThumbBuffer(input, maxDim) {
  return sharp(input)
    .rotate()
    .resize({
      width: maxDim,
      height: maxDim,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 70 })
    .toBuffer();
}

function extractPosterFrame(videoBytes, pathHint) {
  const dir = mkdtempSync(join(tmpdir(), "pokepatch-poster-"));
  const ext = (pathHint.match(/\.[^.]+$/) || [".mp4"])[0];
  const inFile = join(dir, `in${ext}`);
  const outFile = join(dir, "out.webp");
  try {
    writeFileSync(inFile, videoBytes);
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        "0.1",
        "-i",
        inFile,
        "-frames:v",
        "1",
        "-vf",
        `scale='min(${POSTER_DIM},iw)':-2`,
        outFile,
      ],
      { encoding: "utf8" }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr?.slice(-400) || "ffmpeg failed");
    }
    return readFileSync(outFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function backfillVideoPoster(bucket, path, existing) {
  if (bucket !== "gallery") {
    return { path, note: "skip (video posters only for gallery)" };
  }
  const sibling = posterPath(path);
  if (existing.has(sibling)) {
    return { path, note: "skip (poster exists)" };
  }

  // Dry-run: list-only — no downloads (downloads count as egress).
  if (dryRun) {
    return { path, note: `WOULD write poster -> ${sibling}` };
  }

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) return { path, note: `ERROR download: ${error.message}` };

  const input = Buffer.from(await data.arrayBuffer());
  let output;
  try {
    output = extractPosterFrame(input, path);
  } catch (err) {
    return {
      path,
      note: `ERROR poster: ${err.message} (install ffmpeg or upload poster manually)`,
    };
  }

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(sibling, output, {
      // Additive only — never replace an existing sibling or original.
      upsert: false,
      contentType: "image/webp",
    });
  if (upErr) {
    if (/already exists|Duplicate|resource already/i.test(upErr.message)) {
      existing.add(sibling);
      return { path, note: "skip (poster exists)" };
    }
    return { path, note: `ERROR upload poster: ${upErr.message}` };
  }
  existing.add(sibling);
  return { path, note: `wrote poster ${mb(output.length)}` };
}

async function main() {
  console.log(
    `Backfill thumbs/posters.${dryRun ? " (dry run — no writes)" : ""}\n` +
      `Buckets: ${BUCKETS.join(", ")}\n` +
      (prefixArg ? `Prefix: ${prefixArg}\n` : "") +
      `NOTE: downloads count toward Storage egress.\n`
  );

  let written = 0;
  for (const bucket of BUCKETS) {
    console.log(`\n=== ${bucket} ===`);
    const paths = await listAllFiles(bucket, prefixArg);
    const existing = new Set(paths);
    const work = paths.filter((p) => !SIBLING_EXT.test(p));
    console.log(`Listed ${paths.length} objects (${work.length} sources)\n`);

    for (const path of work) {
      let result;
      if (IMAGE_EXT.test(path)) {
        result = await backfillImage(bucket, path, existing);
      } else if (VIDEO_EXT.test(path)) {
        result = await backfillVideoPoster(bucket, path, existing);
      } else {
        result = { path, note: "skip (unsupported type)" };
      }
      console.log(`${result.note.padEnd(55)}  ${path}`);
      if (result.note.startsWith("wrote")) written += 1;
    }
  }

  console.log(`\nDone. ${written} sibling(s) written.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
