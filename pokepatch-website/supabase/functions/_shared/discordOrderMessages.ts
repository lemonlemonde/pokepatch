/**
 * Discord messages for quote requests: one header per order, then one
 * message per card (tags, description, photos, quote button). `notify` posts
 * them on INSERT; `discord-interactions` re-renders a card message after a
 * quote is saved from Discord.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DAMAGE_TAGS } from "./damageTags.ts";
import {
  IS_COMPONENTS_V2,
  ButtonStyle,
  actionRow,
  button,
  container,
  mediaGallery,
  separator,
  textDisplay,
  type Json,
} from "./discord.ts";
import {
  SERVICE_KEYS,
  formatMoney,
  roundMoney,
  storedCardHvAmount,
} from "./servicePricing.ts";

export const BUCKET = "card-photos";
/** Signed URLs expire; 1 year keeps Discord history browsable. */
export const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;
const SITE_URL = "https://pokepatch.cards";
const MAX_GALLERY_ITEMS = 10;
const MAX_DESCRIPTION_CHARS = 900;

/** Customer-uploaded photo pool (admin adds share it). Not before/after. */
const CUSTOMER_IMAGE_TYPES = ["customer", "admin"];

const ACCENT_UNQUOTED = 0xf2a65a; // peach
const ACCENT_QUOTED = 0x7dd3a0; // mint
const ACCENT_CANCELED = 0x8b8b8b;
const ACCENT_ORDER = 0xb8a9f5; // lavender

export const QUOTE_BUTTON_PREFIX = "quote:";

export type OrderRow = {
  id: string;
  display_id: number | string;
  customer_name: string | null;
  delivery_method: string | null;
  status: string | null;
  pending_kind: string | null;
  quote_bulk_counts: unknown;
};

export type CardRow = {
  id: string;
  order_id: string;
  card_name: string | null;
  set_name: string | null;
  description: string | null;
  damage_tags: unknown;
  admin_note: string | null;
  market_value_raw_nm: number | string | null;
  status: string | null;
  is_priority: boolean | null;
  sort_order: number | null;
};

export type QuoteItemRow = {
  id: string;
  sort_order: number;
  card_name: string;
  set_name: string | null;
  service_key: string;
  service_label: string;
  quote_base_amount: number | string;
  high_value_surcharge?: number | string | null;
};

export const deliveryLabels: Record<string, string> = {
  local_dropoff: "Local Drop-Off",
  shipping: "Shipping",
};

export function adminOrderUrl(orderId: string): string {
  return `${SITE_URL}/admin/orders/?edit=${encodeURIComponent(orderId)}`;
}

function normalizeCardKey(name: unknown, setName: unknown): string {
  return `${String(name ?? "").trim().toLowerCase()}|${String(setName ?? "")
    .trim()
    .toLowerCase()}`;
}

/**
 * Quote lines belong to a card by name + set (order_quote_items has no card
 * id). Same matching as the admin editor's findMatchingOrderCardId.
 */
export function quoteItemsForCard(items: QuoteItemRow[], card: CardRow): QuoteItemRow[] {
  const key = normalizeCardKey(card.card_name, card.set_name);
  return items.filter(
    (item) => normalizeCardKey(item.card_name, item.set_name) === key
  );
}

export function cardIsCanceled(card: CardRow): boolean {
  const status = String(card.status ?? "").trim().toLowerCase();
  return status === "canceled" || status === "cancelled";
}

export function damageTagLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const selected = new Set(raw.map((value) => String(value ?? "").trim()));
  return DAMAGE_TAGS.filter((tag) => selected.has(tag.id)).map((tag) => tag.label);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Escape markdown-significant characters in customer text. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\*_~`|])/g, "\\$1")
    // Headings / subtext / quotes / lists only trigger at line start.
    .replace(/(^|\n)([#>-])/g, "$1\\$2");
}

// ---------------------------------------------------------------------------
// Storage

export async function signPhotoUrls(
  supabase: SupabaseClient,
  paths: string[]
): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN);
  if (error) {
    console.error("createSignedUrls error", error);
    return [];
  }
  return (data ?? [])
    .map((row) => (row.error ? "" : row.signedUrl ?? ""))
    .filter(Boolean);
}

export async function customerPhotoPaths(
  supabase: SupabaseClient,
  cardIds: string[]
): Promise<Map<string, string[]>> {
  const byCard = new Map<string, string[]>();
  if (cardIds.length === 0) return byCard;
  const { data, error } = await supabase
    .from("card_images")
    .select("id, card_id, storage_path, image_type")
    .in("card_id", cardIds)
    .in("image_type", CUSTOMER_IMAGE_TYPES)
    .order("id", { ascending: true });
  if (error) throw error;
  for (const row of data ?? []) {
    const path = String(row.storage_path ?? "");
    if (!path) continue;
    const list = byCard.get(String(row.card_id)) ?? [];
    list.push(path);
    byCard.set(String(row.card_id), list);
  }
  return byCard;
}

// ---------------------------------------------------------------------------
// DB loaders

export async function loadOrderCards(
  supabase: SupabaseClient,
  orderId: string
): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, order_id, card_name, set_name, description, damage_tags, admin_note, market_value_raw_nm, status, is_priority, sort_order"
    )
    .eq("order_id", orderId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CardRow[];
}

export async function loadOrderQuoteItems(
  supabase: SupabaseClient,
  orderId: string
): Promise<QuoteItemRow[]> {
  const { data, error } = await supabase
    .from("order_quote_items")
    .select(
      "id, sort_order, card_name, set_name, service_key, service_label, quote_base_amount, high_value_surcharge"
    )
    .eq("order_id", orderId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as QuoteItemRow[];
}

export async function loadOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, display_id, customer_name, delivery_method, status, pending_kind, quote_bulk_counts"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as OrderRow | null) ?? null;
}

export type CardContext = {
  order: OrderRow;
  card: CardRow;
  cards: CardRow[];
  cardIndex: number;
  quoteItems: QuoteItemRow[];
  cardQuoteItems: QuoteItemRow[];
  hvAmount: number;
};

export async function loadCardContext(
  supabase: SupabaseClient,
  cardId: string
): Promise<CardContext | null> {
  const { data: cardRow, error: cardError } = await supabase
    .from("cards")
    .select("id, order_id")
    .eq("id", cardId)
    .maybeSingle();
  if (cardError) throw cardError;
  if (!cardRow) return null;

  const orderId = String(cardRow.order_id);
  const [order, cards, quoteItems] = await Promise.all([
    loadOrder(supabase, orderId),
    loadOrderCards(supabase, orderId),
    loadOrderQuoteItems(supabase, orderId),
  ]);
  if (!order) return null;
  const cardIndex = cards.findIndex((card) => String(card.id) === String(cardId));
  if (cardIndex < 0) return null;
  const card = cards[cardIndex];
  return {
    order,
    card,
    cards,
    cardIndex,
    quoteItems,
    cardQuoteItems: quoteItemsForCard(quoteItems, card),
    hvAmount: storedCardHvAmount(order.quote_bulk_counts, String(card.id)),
  };
}

// ---------------------------------------------------------------------------
// Message builders

export function buildOrderHeaderMessage(params: {
  order: OrderRow;
  cardCount: number;
  photoCount: number;
  contactsText: string;
  sheetUrl?: string;
}): Json {
  const { order, cardCount, photoCount, contactsText, sheetUrl } = params;
  const delivery =
    deliveryLabels[String(order.delivery_method)] ??
    String(order.delivery_method ?? "unknown");
  const customer = String(order.customer_name ?? "").trim();

  const lines = [
    `# New Order #${order.display_id}`,
    `**Customer:** ${customer ? escapeMarkdown(customer) : "—"}`,
    `**Delivery:** ${delivery}`,
    `**Contact:** ${contactsText ? escapeMarkdown(contactsText) : "—"}`,
    `**Cards:** ${cardCount} · **Photos:** ${photoCount}`,
  ];
  const links = [`[Open in admin](${adminOrderUrl(order.id)})`];
  if (sheetUrl) links.push(`[Spreadsheet](${sheetUrl})`);
  lines.push(links.join(" · "));
  lines.push("-# Each card below has its own message — use **Add quote** on each.");

  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [container([textDisplay(lines.join("\n"))], ACCENT_ORDER)],
  };
}

export function quoteSummaryLines(params: {
  card: CardRow;
  cardQuoteItems: QuoteItemRow[];
  hvAmount: number;
}): { lines: string[]; subtotal: number; quoted: boolean } {
  const { card, cardQuoteItems, hvAmount } = params;
  if (cardIsCanceled(card)) {
    return { lines: ["**Quote:** card canceled — not in quote"], subtotal: 0, quoted: false };
  }
  const serviceLines = cardQuoteItems.map((item) => {
    const label =
      String(item.service_label ?? "").trim() ||
      (item.service_key === SERVICE_KEYS.CUSTOM ? "Custom" : item.service_key);
    return `• ${escapeMarkdown(label)} — ${formatMoney(item.quote_base_amount)}`;
  });
  const servicesTotal = cardQuoteItems.reduce(
    (sum, item) => sum + (Number(item.quote_base_amount) || 0),
    0
  );
  const market = Number(card.market_value_raw_nm);
  if (hvAmount > 0) {
    const marketText = Number.isFinite(market) && market > 0 ? ` (market ${formatMoney(market)})` : "";
    serviceLines.push(`• High-value fee${marketText} — +${formatMoney(hvAmount)}`);
  }
  const subtotal = roundMoney(servicesTotal + hvAmount);
  const quoted = serviceLines.length > 0;
  if (!quoted) {
    return { lines: ["**Quote:** _not quoted yet_"], subtotal: 0, quoted: false };
  }
  const lines = ["**Quote**", ...serviceLines, `**Subtotal ${formatMoney(subtotal)}**`];
  const note = String(card.admin_note ?? "").trim();
  if (note) lines.push(`-# Note to customer: ${escapeMarkdown(truncate(note, 300))}`);
  return { lines, subtotal, quoted };
}

export function buildCardMessage(params: {
  order: OrderRow;
  card: CardRow;
  cardIndex: number;
  cardCount: number;
  imageUrls: string[];
  cardQuoteItems: QuoteItemRow[];
  hvAmount: number;
  interactive: boolean;
}): Json {
  const {
    order,
    card,
    cardIndex,
    cardCount,
    imageUrls,
    cardQuoteItems,
    hvAmount,
    interactive,
  } = params;

  const name = String(card.card_name ?? "").trim() || "Untitled card";
  const setName = String(card.set_name ?? "").trim();
  const heading =
    `## #${order.display_id} · Card ${cardIndex + 1}/${cardCount}\n` +
    `**${escapeMarkdown(name)}**${setName ? ` · ${escapeMarkdown(setName)}` : ""}` +
    (card.is_priority ? "  ⭐ Priority" : "");

  const tags = damageTagLabels(card.damage_tags);
  const description = String(card.description ?? "").trim();
  const details = [
    `**Damage:** ${tags.length > 0 ? tags.join(" · ") : "_no tags_"}`,
    `**Description:** ${
      description ? escapeMarkdown(truncate(description, MAX_DESCRIPTION_CHARS)) : "_none_"
    }`,
  ];

  const components: Json[] = [textDisplay(heading), textDisplay(details.join("\n"))];

  if (imageUrls.length > 0) {
    components.push(
      mediaGallery(
        imageUrls.slice(0, MAX_GALLERY_ITEMS),
        imageUrls.map((_, index) => `${name} — photo ${index + 1}`)
      )
    );
    if (imageUrls.length > MAX_GALLERY_ITEMS) {
      components.push(
        textDisplay(`-# +${imageUrls.length - MAX_GALLERY_ITEMS} more photo(s) in admin`)
      );
    }
  } else {
    components.push(textDisplay("-# No photos on this card"));
  }

  const summary = quoteSummaryLines({ card, cardQuoteItems, hvAmount });
  components.push(separator(1), textDisplay(summary.lines.join("\n")));

  if (interactive && !cardIsCanceled(card)) {
    components.push(
      actionRow([
        button({
          customId: `${QUOTE_BUTTON_PREFIX}${card.id}`,
          label: summary.quoted ? "Edit quote" : "Add quote",
          style: summary.quoted ? ButtonStyle.SECONDARY : ButtonStyle.PRIMARY,
          emoji: summary.quoted ? "✏️" : "💵",
        }),
        button({ label: "Open in admin", url: adminOrderUrl(order.id) }),
      ])
    );
  }

  const accent = cardIsCanceled(card)
    ? ACCENT_CANCELED
    : summary.quoted
      ? ACCENT_QUOTED
      : ACCENT_UNQUOTED;

  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [container(components, accent)],
  };
}

/** Re-render a card message straight from the DB (after a quote save). */
export async function renderCardMessageFromDb(
  supabase: SupabaseClient,
  cardId: string
): Promise<{ payload: Json; context: CardContext } | null> {
  const context = await loadCardContext(supabase, cardId);
  if (!context) return null;
  const photoPaths = await customerPhotoPaths(supabase, [cardId]);
  const imageUrls = await signPhotoUrls(supabase, photoPaths.get(cardId) ?? []);
  const payload = buildCardMessage({
    order: context.order,
    card: context.card,
    cardIndex: context.cardIndex,
    cardCount: context.cards.length,
    imageUrls,
    cardQuoteItems: context.cardQuoteItems,
    hvAmount: context.hvAmount,
    interactive: true,
  });
  return { payload, context };
}
