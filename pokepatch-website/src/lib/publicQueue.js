import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { tcgCardImageUrl } from "@/lib/tcgCardImage";

function catalogImageForCard(card) {
  const url = (card?.catalog_image_url ?? "").trim();
  if (url) return url;
  const tcgId = (card?.tcg_card_id ?? "").trim();
  if (tcgId) return tcgCardImageUrl({ id: tcgId });
  return "";
}

/** Prefer official TCG catalog title when set; else the order's card fields. */
function displayNameForCard(card) {
  const catalog = (card?.catalog_card_name ?? "").trim();
  if (catalog) return catalog;
  return (card?.card_name ?? "").trim();
}

function displaySetForCard(card) {
  const catalog = (card?.catalog_set_name ?? "").trim();
  if (catalog) return catalog;
  return (card?.set_name ?? "").trim();
}

function parseCards(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((card) => ({
    card_name: displayNameForCard(card),
    set_name: displaySetForCard(card),
    catalog_image_url: catalogImageForCard(card),
    damage_tags: Array.isArray(card.damage_tags) ? card.damage_tags : [],
    sort_order: card.sort_order ?? 0,
  }));
}

function parseLane(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    display_id: Number(row.display_id),
    lane_position: Number(row.lane_position) || 0,
    card_count: Number(row.card_count) || 0,
    is_priority: Boolean(row.is_priority),
    cards: parseCards(row.cards),
  }));
}

/**
 * Public anonymized board: in progress + priority/standard waiting lanes,
 * each order carrying its non-canceled cards. No customer PII.
 */
export async function fetchPublicQueue() {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.rpc("get_public_queue");
  if (error) throw error;
  return {
    in_progress: parseLane(data?.in_progress),
    priority: parseLane(data?.priority),
    regular: parseLane(data?.regular),
  };
}
