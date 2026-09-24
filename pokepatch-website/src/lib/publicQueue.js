import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { tcgCardImageUrl } from "@/lib/tcgCardImage";

function parseLane(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    display_id: Number(row.display_id),
    lane_position: Number(row.lane_position) || 0,
    card_count: Number(row.card_count) || 0,
    is_priority: Boolean(row.is_priority),
  }));
}

/**
 * Public anonymized board: in progress + priority/standard To do lanes.
 * No customer PII.
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

function catalogImageForCard(card) {
  const url = (card?.catalog_image_url ?? "").trim();
  if (url) return url;
  const tcgId = (card?.tcg_card_id ?? "").trim();
  if (tcgId) return tcgCardImageUrl({ id: tcgId });
  return "";
}

/**
 * Cards for one board order by public display id.
 * Null if not in To do or In progress.
 */
export async function fetchPublicQueueOrder(displayId) {
  if (!isSupabaseConfigured || !supabase) return null;
  const id = Number(displayId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const { data, error } = await supabase.rpc("get_public_queue_order", {
    p_display_id: id,
  });
  if (error) throw error;
  if (!data) return null;

  const cards = Array.isArray(data.cards)
    ? data.cards.map((card) => ({
        card_name: card.card_name ?? "",
        set_name: card.set_name ?? "",
        catalog_image_url: catalogImageForCard(card),
        damage_tags: Array.isArray(card.damage_tags) ? card.damage_tags : [],
        sort_order: card.sort_order ?? 0,
      }))
    : [];

  return {
    display_id: Number(data.display_id),
    status: data.status ?? null,
    is_priority: Boolean(data.is_priority),
    lane_position: Number(data.lane_position) || null,
    queue_position: Number(data.queue_position) || null,
    cards,
  };
}
