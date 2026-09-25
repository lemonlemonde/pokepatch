#!/usr/bin/env node
/**
 * Mirror the Pokémon TCG card catalog into public.tcg_cards.
 *
 * Source: https://github.com/PokemonTCG/pokemon-tcg-data (the dataset behind
 * api.pokemontcg.io, same card ids). Downloads the repo zip once, flattens
 * cards/en/*.json + sets/en.json to the slim columns admin search needs, and
 * upserts in batches. Idempotent — safe to re-run any time; a failed run
 * leaves the previous catalog in place.
 *
 * Usage:
 *   node --env-file=.env.local.prod scripts/sync-tcg-catalog.mjs
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-tcg-catalog.mjs
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Optional: TCG_DATA_ZIP_URL to point at a fork/tag.
 */

import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const zipUrl =
  process.env.TCG_DATA_ZIP_URL ||
  "https://codeload.github.com/PokemonTCG/pokemon-tcg-data/zip/refs/heads/master";

const BATCH_SIZE = 500;
const DOWNLOAD_TIMEOUT_MS = 120_000;

if (!url || !key) {
  console.error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function toIsoDate(value) {
  // Dataset uses "2023/08/11".
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(value ?? "").trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

async function downloadZip() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(zipUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function fileName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

async function readCatalog(zipBuffer) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files = Object.values(zip.files).filter((f) => !f.dir);

  const setsFile = files.find((f) => f.name.endsWith("/sets/en.json"));
  if (!setsFile) throw new Error("sets/en.json not found in archive");
  const sets = new Map(
    JSON.parse(await setsFile.async("string")).map((set) => [set.id, set])
  );

  const cardFiles = files.filter(
    (f) => /\/cards\/en\/[^/]+\.json$/.test(f.name)
  );
  if (cardFiles.length === 0) throw new Error("no cards/en/*.json in archive");

  const rows = [];
  const syncedAt = new Date().toISOString();
  for (const file of cardFiles) {
    const setId = fileName(file.name).replace(/\.json$/, "");
    const set = sets.get(setId);
    if (!set) {
      console.warn(`skip ${setId}: no entry in sets/en.json`);
      continue;
    }
    const cards = JSON.parse(await file.async("string"));
    for (const card of cards) {
      const id = String(card.id ?? "").trim();
      if (!id) continue;
      rows.push({
        id,
        name: String(card.name ?? id).trim(),
        number: String(card.number ?? "").trim(),
        set_id: setId,
        set_name: String(set.name ?? "").trim(),
        set_series: set.series ? String(set.series).trim() : null,
        release_date: toIsoDate(set.releaseDate),
        image_small: String(card.images?.small ?? "").trim(),
        image_large: String(card.images?.large ?? "").trim(),
        synced_at: syncedAt,
      });
    }
  }

  return { rows, setCount: cardFiles.length };
}

async function upsertAll(rows) {
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("tcg_cards")
      .upsert(batch, { onConflict: "id" });
    if (error) {
      throw new Error(`upsert failed at row ${i}: ${error.message}`);
    }
    written += batch.length;
    if (written % 5000 === 0 || written === rows.length) {
      console.log(`  ${written}/${rows.length}`);
    }
  }
  return written;
}

const started = Date.now();
console.log(`downloading ${zipUrl}`);
const zipBuffer = await downloadZip();
console.log(`  ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);

const { rows, setCount } = await readCatalog(zipBuffer);
const newest = rows.reduce(
  (acc, row) => (row.release_date && row.release_date > acc ? row.release_date : acc),
  ""
);
console.log(`parsed ${rows.length} cards across ${setCount} sets (newest release ${newest || "?"})`);

console.log("upserting into tcg_cards");
const written = await upsertAll(rows);

const { count, error: countError } = await supabase
  .from("tcg_cards")
  .select("id", { count: "exact", head: true });
if (countError) throw countError;

console.log(
  `done: ${written} upserted, ${count} rows in tcg_cards, ${((Date.now() - started) / 1000).toFixed(1)}s`
);
