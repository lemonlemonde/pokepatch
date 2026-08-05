#!/usr/bin/env node
/**
 * Sync gallery_items title, set_name, and card_number from the Pokémon TCG API
 * for every row with tcg_card_id.
 *
 * Usage: node --env-file=.env.local scripts/sync-gallery-card-names.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.POKEMON_TCG_API_KEY?.trim();

if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const supabase = createClient(url, key);

async function fetchCardFromApi(cardId) {
  const headers = apiKey ? { "X-Api-Key": apiKey } : {};
  const select = "id,name,number,set";
  const attempts = [
    `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(cardId)}?select=${select}`,
    `https://api.pokemontcg.io/v2/cards?q=id:${encodeURIComponent(cardId)}&pageSize=1&select=${select}`,
  ];

  for (const endpoint of attempts) {
    for (let tryNum = 0; tryNum < 3; tryNum += 1) {
      try {
        const response = await fetch(endpoint, { headers });
        if (!response.ok) {
          await new Promise((r) => setTimeout(r, 600 * (tryNum + 1)));
          continue;
        }
        const payload = await response.json();
        const row = payload.data?.id ? payload.data : payload.data?.[0];
        if (!row?.id) continue;
        return {
          id: row.id,
          name: row.name ?? "",
          set_name: row.set?.name ?? "",
          number: row.number ?? "",
        };
      } catch {
        await new Promise((r) => setTimeout(r, 600 * (tryNum + 1)));
      }
    }
  }
  return null;
}

const { data: rows, error } = await supabase
  .from("gallery_items")
  .select("id, title, set_name, card_number, tcg_card_id")
  .not("tcg_card_id", "is", null)
  .order("created_at");

if (error) {
  console.error(error);
  process.exit(1);
}

let updated = 0;
let skipped = 0;

for (const row of rows ?? []) {
  const cardId = String(row.tcg_card_id ?? "").trim();
  if (!cardId) continue;

  const card = await fetchCardFromApi(cardId);
  if (!card) {
    console.warn(`SKIP ${row.id} — could not fetch ${cardId}`);
    skipped += 1;
    continue;
  }

  const patch = {
    title: card.name,
    set_name: card.set_name || null,
    card_number: card.number || null,
    tcg_lookup_title: card.name,
    tcg_lookup_set_name: card.set_name || null,
    tcg_card_id: card.id,
    updated_at: new Date().toISOString(),
  };

  const unchanged =
    row.title === patch.title &&
    (row.set_name ?? "") === (patch.set_name ?? "") &&
    (row.card_number ?? "") === (patch.card_number ?? "");

  if (unchanged) {
    console.log(`OK ${cardId} — already synced (${card.name})`);
    continue;
  }

  const { error: updateError } = await supabase
    .from("gallery_items")
    .update(patch)
    .eq("id", row.id);

  if (updateError) {
    console.error(`FAIL ${row.id} ${cardId}:`, updateError.message);
    skipped += 1;
    continue;
  }

  console.log(
    `UPD ${row.id} ${cardId}: "${row.title}" → "${patch.title}" | set "${row.set_name}" → "${patch.set_name}" | #${row.card_number ?? "—"} → #${patch.card_number}`
  );
  updated += 1;
  await new Promise((r) => setTimeout(r, 500));
}

console.log(`Done. ${updated} updated, ${skipped} skipped.`);
