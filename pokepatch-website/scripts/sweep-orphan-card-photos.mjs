#!/usr/bin/env node
/**
 * Delete `card-photos` Storage objects that are not referenced by any
 * `card_images.storage_path` (and are not a `.thumb.webp` / `.poster.webp`
 * sibling of a referenced path).
 *
 * Also sweeps leftover clamperl scratch under `clamperl/` (always orphans —
 * that prefix is hop staging only).
 *
 * Does NOT touch the `gallery` bucket (public site media).
 *
 * Prerequisites: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage (from pokepatch-website/):
 *   node --env-file=.env.local scripts/sweep-orphan-card-photos.mjs --dry-run
 *   node --env-file=.env.local scripts/sweep-orphan-card-photos.mjs
 *   node --env-file=.env.local scripts/sweep-orphan-card-photos.mjs --prefix=order-<uuid>
 */

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const BUCKET = "card-photos";
const REMOVE_BATCH = 100;
const dryRun = process.argv.includes("--dry-run");
const prefixArg =
  process.argv
    .find((arg) => arg.startsWith("--prefix="))
    ?.slice("--prefix=".length)
    ?.replace(/^\/+|\/+$/g, "") || "";

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});

function thumbPath(storagePath) {
  if (
    storagePath.endsWith(".thumb.webp") ||
    storagePath.endsWith(".poster.webp")
  ) {
    return storagePath;
  }
  return `${storagePath}.thumb.webp`;
}

function posterPath(storagePath) {
  if (storagePath.endsWith(".poster.webp")) return storagePath;
  return `${storagePath}.poster.webp`;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

/** Returns [{ path, size }] for every object under prefix. */
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
      if (entry.id == null && !entry.metadata) {
        const nested = await listAllFiles(path);
        out.push(...nested);
      } else {
        out.push({ path, size: Number(entry.metadata?.size ?? 0) || 0 });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function collectReferencedPaths() {
  const keep = new Set();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("card_images")
      .select("storage_path")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const path = (row.storage_path ?? "").trim();
      if (!path) continue;
      keep.add(path);
      keep.add(thumbPath(path));
      keep.add(posterPath(path));
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return keep;
}

async function removePaths(paths) {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) throw error;
  }
}

async function main() {
  console.log(
    `Sweep orphan objects in \`${BUCKET}\`.` +
      `${dryRun ? " (dry run — no deletes)" : " (LIVE DELETE)"}\n` +
      (prefixArg ? `Prefix filter: ${prefixArg}\n` : "")
  );

  const [files, keep] = await Promise.all([
    listAllFiles(prefixArg),
    collectReferencedPaths(),
  ]);

  const orphans = files.filter((file) => !keep.has(file.path));
  const keepCount = files.length - orphans.length;
  const orphanBytes = orphans.reduce((sum, file) => sum + file.size, 0);

  console.log(
    `Storage objects: ${files.length} · referenced (kept): ${keepCount} · orphans: ${orphans.length} (${mb(orphanBytes)})`
  );

  if (orphans.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const sample = orphans.slice(0, 40);
  for (const file of sample) {
    console.log(`  ${dryRun ? "WOULD delete" : "delete"} ${file.path} (${mb(file.size)})`);
  }
  if (orphans.length > sample.length) {
    console.log(`  …and ${orphans.length - sample.length} more`);
  }

  if (dryRun) {
    console.log("\nDry run only. Re-run without --dry-run to delete.");
    return;
  }

  await removePaths(orphans.map((file) => file.path));
  console.log(`\nDeleted ${orphans.length} orphan object(s) (${mb(orphanBytes)}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
