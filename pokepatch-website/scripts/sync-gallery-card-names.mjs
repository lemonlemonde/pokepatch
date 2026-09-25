#!/usr/bin/env node
/**
 * Sync gallery_items title, set_name, and card_number from the local
 * tcg_cards mirror (see sync-tcg-catalog.mjs) for every row with tcg_card_id.
 *
 * Usage: node --env-file=.env.local.prod scripts/sync-gallery-card-names.mjs
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase env");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function fetchCardFromCatalog(cardId) {
  const { data, error: lookupError } = await supabase
    .from("tcg_cards")
    .select("id, name, number, set_name")
    .eq("id", cardId)
    .maybeSingle();
  if (lookupError) {
    console.error(`lookup ${cardId}:`, lookupError.message);
    return null;
  }
  return data ?? null;
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

  const card = await fetchCardFromCatalog(cardId);
  if (!card) {
    console.warn(`SKIP ${row.id} — could not fetch ${cardId}`);
    skipped += 1;
    continue;
  }

  const patch = {
    title: card.name,
    set_name: card.set_name || "",
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
}

console.log(`Done. ${updated} updated, ${skipped} skipped.`);
