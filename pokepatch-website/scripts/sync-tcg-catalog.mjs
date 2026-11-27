#!/usr/bin/env node
/**
 * Mirror the Pokémon TCG card catalog into public.tcg_cards.
 *
 * English source: https://github.com/PokemonTCG/pokemon-tcg-data (same ids as
 * api.pokemontcg.io). Japanese source: https://api.tcgdex.net/v2/ja (Japanese
 * printings; ids prefixed jp- so they never collide with English rows).
 *
 * Downloads each source, flattens to the slim columns admin search needs, and
 * upserts in batches. Idempotent — safe to re-run any time; a failed run
 * leaves the previous catalog in place.
 *
 * Usage:
 *   node --env-file=.env.local.prod scripts/sync-tcg-catalog.mjs
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-tcg-catalog.mjs
 *
 * Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY.
 * Optional: TCG_DATA_ZIP_URL, TCG_JP_SET_IDS (comma-separated TCGdex set ids),
 * TCG_SKIP_JP=1, TCG_SKIP_EN=1.
 */

import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import {
  englishCardNameToJapanese,
  japaneseCardNameToEnglish,
  loadSpeciesNameMaps,
} from "./lib/tcgJapaneseNames.mjs";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const zipUrl =
  process.env.TCG_DATA_ZIP_URL ||
  "https://codeload.github.com/PokemonTCG/pokemon-tcg-data/zip/refs/heads/master";
const TCGDEX_JA_SETS_URL = "https://api.tcgdex.net/v2/ja/sets";
const JP_ID_PREFIX = "jp-";
const SET_FETCH_CONCURRENCY = 4;

const BATCH_SIZE = 500;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const JSON_TIMEOUT_MS = 30_000;

if (!url || !key) {
  console.error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function toIsoDate(value) {
  const raw = String(value ?? "").trim();
  const slashed = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(raw);
  if (slashed) return `${slashed[1]}-${slashed[2]}-${slashed[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(resource, { timeout = JSON_TIMEOUT_MS, attempts = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(resource, {
        signal: controller.signal,
        headers: { "user-agent": "pokepatch-tcg-sync" },
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${resource}`);
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      await sleep(400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error(`fetch failed: ${resource}`);
}

async function fetchJson(resource, options) {
  const response = await fetchWithTimeout(resource, options);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} for ${resource}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function downloadZip() {
  const response = await fetchWithTimeout(zipUrl, {
    timeout: DOWNLOAD_TIMEOUT_MS,
    attempts: 3,
  });
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function fileName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const n = Math.min(Math.max(concurrency, 1), Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

async function readEnglishCatalog(zipBuffer, maps) {
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
      const name = String(card.name ?? id).trim();
      const nameJa = maps ? englishCardNameToJapanese(name, maps) : "";
      rows.push({
        id,
        name,
        name_ja: nameJa,
        number: String(card.number ?? "").trim(),
        set_id: setId,
        set_name: String(set.name ?? "").trim(),
        set_name_ja: "",
        set_series: set.series ? String(set.series).trim() : null,
        print_region: "en",
        release_date: toIsoDate(set.releaseDate),
        image_small: String(card.images?.small ?? "").trim(),
        image_large: String(card.images?.large ?? "").trim(),
        synced_at: syncedAt,
      });
    }
  }

  return { rows, setCount: cardFiles.length };
}

function parseSetIdFilter() {
  const raw = String(process.env.TCG_JP_SET_IDS ?? "").trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
}

function tcgdexImageUrls(image) {
  const base = String(image ?? "").trim().replace(/\/+$/, "");
  if (!base) return { small: "", large: "" };
  return {
    small: `${base}/low.webp`,
    large: `${base}/high.webp`,
  };
}

async function readJapaneseCatalog(maps) {
  const filter = parseSetIdFilter();
  let setList = await fetchJson(TCGDEX_JA_SETS_URL, { timeout: 60_000 });
  if (!Array.isArray(setList)) throw new Error("TCGdex ja/sets did not return an array");
  if (filter) {
    setList = setList.filter((set) => filter.has(String(set.id)));
    console.log(`  TCG_JP_SET_IDS filter: ${setList.length} set(s)`);
  }

  const syncedAt = new Date().toISOString();
  const rows = [];
  let skippedNoImage = 0;
  let skippedSets = 0;

  await mapPool(setList, SET_FETCH_CONCURRENCY, async (brief) => {
    const setId = String(brief.id ?? "").trim();
    if (!setId) return;
    let detail;
    try {
      detail = await fetchJson(`${TCGDEX_JA_SETS_URL}/${encodeURIComponent(setId)}`);
    } catch (err) {
      skippedSets += 1;
      console.warn(`skip JP set ${setId}: ${err.message}`);
      return;
    }
    const setNameJa = String(detail.name ?? brief.name ?? setId).trim();
    const setName = `${setId} · ${setNameJa}`;
    const setSeries = detail.serie?.name ? String(detail.serie.name).trim() : null;
    const releaseDate = toIsoDate(detail.releaseDate);
    const cards = Array.isArray(detail.cards) ? detail.cards : [];
    for (const card of cards) {
      const tcgdexId = String(card.id ?? "").trim();
      if (!tcgdexId) continue;
      const images = tcgdexImageUrls(card.image);
      if (!images.small) {
        skippedNoImage += 1;
        continue;
      }
      const nameJa = String(card.name ?? tcgdexId).trim();
      const name = maps
        ? japaneseCardNameToEnglish(nameJa, maps) || nameJa
        : nameJa;
      rows.push({
        id: `${JP_ID_PREFIX}${tcgdexId}`,
        name,
        name_ja: nameJa,
        number: String(card.localId ?? "").trim(),
        set_id: setId,
        set_name: setName,
        set_name_ja: setNameJa,
        set_series: setSeries,
        print_region: "jp",
        release_date: releaseDate,
        image_small: images.small,
        image_large: images.large,
        synced_at: syncedAt,
      });
    }
  });

  return {
    rows,
    setCount: setList.length - skippedSets,
    skippedNoImage,
    skippedSets,
  };
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

function newestRelease(rows) {
  return rows.reduce(
    (acc, row) => (row.release_date && row.release_date > acc ? row.release_date : acc),
    ""
  );
}

const skipEn = process.env.TCG_SKIP_EN === "1";
const skipJp = process.env.TCG_SKIP_JP === "1";
const started = Date.now();

console.log("loading Pokémon species name map");
const maps = await loadSpeciesNameMaps((resource) =>
  fetchWithTimeout(resource, { timeout: 60_000 })
);
console.log(`  ${maps.jaToEn.size} Japanese ↔ English species names`);

const allRows = [];

if (!skipEn) {
  console.log(`downloading English catalog ${zipUrl}`);
  const zipBuffer = await downloadZip();
  console.log(`  ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MB`);
  const english = await readEnglishCatalog(zipBuffer, maps);
  console.log(
    `parsed ${english.rows.length} English cards across ${english.setCount} sets (newest ${newestRelease(english.rows) || "?"})`
  );
  allRows.push(...english.rows);
}

if (!skipJp) {
  console.log(`fetching Japanese catalog ${TCGDEX_JA_SETS_URL}`);
  const japanese = await readJapaneseCatalog(maps);
  console.log(
    `parsed ${japanese.rows.length} Japanese cards across ${japanese.setCount} sets (newest ${newestRelease(japanese.rows) || "?"}; skipped ${japanese.skippedNoImage} without art, ${japanese.skippedSets} missing sets)`
  );
  allRows.push(...japanese.rows);
}

if (allRows.length === 0) {
  console.error("nothing to upsert");
  process.exit(1);
}

console.log(`upserting ${allRows.length} rows into tcg_cards`);
const written = await upsertAll(allRows);

const { count, error: countError } = await supabase
  .from("tcg_cards")
  .select("id", { count: "exact", head: true });
if (countError) throw countError;

console.log(
  `done: ${written} upserted, ${count} rows in tcg_cards, ${((Date.now() - started) / 1000).toFixed(1)}s`
);
