#!/usr/bin/env node
/**
 * Sync every supported TCG's cards into public.card_catalog.
 *
 * Usage: node --env-file=.env.local scripts/sync-card-catalog.mjs [game...]
 *   e.g. node --env-file=.env.local scripts/sync-card-catalog.mjs yugioh
 *
 * Runs off the request path on purpose — the Pokémon API 5xxs on a large
 * share of requests and 20k cards takes a while.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const supabase = createClient(url, key);

const UPSERT_CHUNK = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(endpoint, { headers = {}, attempts = 6 } = {}) {
  for (let tryNum = 0; tryNum < attempts; tryNum += 1) {
    try {
      const response = await fetch(endpoint, { headers });
      if (!response.ok) {
        await sleep(600 * (tryNum + 1));
        continue;
      }
      return await response.json();
    } catch (err) {
      console.warn(`  retry ${tryNum + 1}: ${err.message}`);
      await sleep(600 * (tryNum + 1));
    }
  }
  throw new Error(`failed after ${attempts} attempts: ${endpoint}`);
}

/** Pokémon: paginated, ~20k cards. */
async function* pokemonCards() {
  const apiKey = process.env.POKEMON_TCG_API_KEY?.trim();
  const headers = apiKey ? { "X-Api-Key": apiKey } : {};
  const select = "id,name,number,images,set";
  const pageSize = 250;

  for (let page = 1; ; page += 1) {
    const payload = await fetchJson(
      `https://api.pokemontcg.io/v2/cards?page=${page}&pageSize=${pageSize}&select=${select}`,
      { headers }
    );
    const rows = payload.data ?? [];
    if (rows.length === 0) return;

    yield rows.map((row) => ({
      game: "pokemon",
      card_id: row.id,
      name: row.name ?? row.id,
      set_name: row.set?.name ?? "",
      number: row.number ?? "",
      // Scrydex serves the same art as JPEG (~34KB) vs the API's PNG (~180KB).
      image_thumb: `https://images.scrydex.com/pokemon/${row.id}/small`,
      image_large: row.images?.large ?? row.images?.small ?? "",
    }));

    if (rows.length < pageSize) return;
  }
}

/** Yu-Gi-Oh!: YGOPRODeck returns all ~14k cards in one response. */
async function* yugiohCards() {
  const payload = await fetchJson(
    "https://db.ygoprodeck.com/api/v7/cardinfo.php"
  );
  const rows = payload.data ?? [];

  // A card reprints across many sets; keep the first so one row = one card.
  yield rows.map((row) => ({
    game: "yugioh",
    card_id: String(row.id),
    name: row.name ?? String(row.id),
    set_name: row.card_sets?.[0]?.set_name ?? "",
    number: row.card_sets?.[0]?.set_code ?? "",
    image_thumb: row.card_images?.[0]?.image_url_small ?? "",
    image_large: row.card_images?.[0]?.image_url ?? "",
  }));
}

/** One Piece: apitcg.com requires a free key from apitcg.com/platform. */
async function* onePieceCards() {
  const apiKey = process.env.APITCG_API_KEY?.trim();
  if (!apiKey) {
    console.log("  skipped — set APITCG_API_KEY to enable");
    return;
  }

  for (let page = 1; ; page += 1) {
    const payload = await fetchJson(
      `https://www.apitcg.com/api/one-piece/cards?limit=100&page=${page}`,
      { headers: { "x-api-key": apiKey } }
    );
    const rows = payload.data ?? [];
    if (rows.length === 0) return;

    yield rows.map((row) => ({
      game: "onepiece",
      card_id: String(row.id ?? row.code),
      name: row.name ?? "",
      set_name: row.set?.name ?? "",
      number: row.code ?? "",
      image_thumb: row.images?.small ?? "",
      image_large: row.images?.large ?? row.images?.small ?? "",
    }));

    if (rows.length < 100) return;
  }
}

const GAMES = {
  pokemon: pokemonCards,
  yugioh: yugiohCards,
  onepiece: onePieceCards,
};

const requested = process.argv.slice(2);
const games = requested.length > 0 ? requested : Object.keys(GAMES);

for (const game of games) {
  const source = GAMES[game];
  if (!source) {
    console.error(`Unknown game: ${game}`);
    process.exit(1);
  }

  console.log(`Syncing ${game}…`);
  let total = 0;

  for await (const batch of source()) {
    // YGOPRODeck hands back all ~14k cards at once; chunk so no single
    // upsert is oversized.
    for (let i = 0; i < batch.length; i += UPSERT_CHUNK) {
      const chunk = batch.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase
        .from("card_catalog")
        .upsert(chunk, { onConflict: "game,card_id" });
      if (error) {
        console.error(`  ${game} upsert failed: ${error.message}`);
        process.exit(1);
      }
      total += chunk.length;
      process.stdout.write(`\r  ${total} cards`);
    }
  }

  console.log(`\r  ${total} cards ✓`);
}
