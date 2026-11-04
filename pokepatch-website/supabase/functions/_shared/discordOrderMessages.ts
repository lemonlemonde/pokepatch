/**
 * Discord messages for quote requests. Per order: a header in the quotes
 * channel, a thread off that header, one message per card inside the thread,
 * and a wrap-up (contacts, quote overview, outreach text, Save & notify) as
 * the last message. `notify` posts them on INSERT; `discord-interactions`
 * re-renders card / wrap-up messages after quotes are saved or the customer
 * is notified.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DAMAGE_TAGS } from "./damageTags.ts";
import {
  IS_COMPONENTS_V2,
  ButtonStyle,
  actionRow,
  button,
  container,
  editChannelMessage,
  listChannelMessages,
  mediaGallery,
  messageHasCustomId,
  separator,
  textDisplay,
  type Json,
} from "./discord.ts";
import {
  CONTACT_TYPE_LABELS,
  DEFAULT_OUTREACH_MESSAGE,
  instagramProfileUrl,
  normalizeDiscordUserId,
} from "./outreach.ts";
import {
  SERVICE_KEYS,
  formatMoney,
  orderQuoteTotal,
  roundMoney,
  storedCardHvAmount,
} from "./servicePricing.ts";
import type { ChangelogPayload } from "./resend.ts";

export const BUCKET = "card-photos";
/** Signed URLs expire; 1 year keeps Discord history browsable. */
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;
const MAX_GALLERY_ITEMS = 10;
const MAX_DESCRIPTION_CHARS = 900;

/** Subject of the automatic "we received your request" email (excluded from "last notified"). */
export const QUOTE_CONFIRMATION_SUBJECT = "We received your quote request";
/** Default subject for the Save & notify email — matches the admin summary wording. */
export const DEFAULT_NOTIFY_SUBJECT = "Your order quote has been updated";

/** Customer-uploaded photo pool (admin adds share it). Not before/after. */
const CUSTOMER_IMAGE_TYPES = ["customer", "admin"];

const ACCENT_UNQUOTED = 0xf2a65a; // peach
const ACCENT_QUOTED = 0x7dd3a0; // mint
const ACCENT_CANCELED = 0x8b8b8b;
const ACCENT_ORDER = 0xb8a9f5; // lavender
const ACCENT_WRAPUP = 0x9ecbff; // sky

export const QUOTE_BUTTON_PREFIX = "quote:";
export const NOTIFY_BUTTON_PREFIX = "notify:";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Button / modal custom_id: `<prefix><uuid>` or `<prefix><uuid>:<channelId>:<messageId>`
 * (the modal form carries the message to re-render after submit).
 */
export function parsePrefixedCustomId(
  prefix: string,
  customId: string
): { id: string; channelId: string; messageId: string } | null {
  if (!customId.startsWith(prefix)) return null;
  const [id = "", channelId = "", messageId = ""] = customId.slice(prefix.length).split(":");
  if (!UUID_RE.test(id)) return null;
  return { id, channelId, messageId };
}

export type OrderRow = {
  id: string;
  display_id: number | string;
  customer_name: string | null;
  customer_email: string | null;
  user_id: string | null;
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
  card_id?: string | null;
  card_name: string;
  set_name: string | null;
  service_key: string;
  service_label: string;
  quote_base_amount: number | string;
  high_value_surcharge?: number | string | null;
};

export type ContactRow = {
  id: number | string;
  contact_type: string;
  value: string | null;
};

export type LastNotification = {
  subject: string;
  sent_at: string;
  recipient_email: string;
};

export const deliveryLabels: Record<string, string> = {
  local_dropoff: "Local Drop-Off",
  shipping: "Shipping",
};

function normalizeCardKey(name: unknown, setName: unknown): string {
  return `${String(name ?? "").trim().toLowerCase()}|${String(setName ?? "")
    .trim()
    .toLowerCase()}`;
}

/**
 * Quote lines belong to a card by card_id when set; name + set is legacy
 * fallback (same as admin findMatchingOrderCardId).
 */
export function quoteItemsForCard(items: QuoteItemRow[], card: CardRow): QuoteItemRow[] {
  const cardId = String(card.id);
  const key = normalizeCardKey(card.card_name, card.set_name);
  return items.filter((item) => {
    if (item.card_id != null && String(item.card_id) !== "") {
      return String(item.card_id) === cardId;
    }
    return normalizeCardKey(item.card_name, item.set_name) === key;
  });
}

/** Prefer persisted card_id; else first card matching name + set. */
function cardIdForQuoteItem(item: QuoteItemRow, cards: CardRow[]): string | null {
  if (item.card_id != null && String(item.card_id) !== "") {
    const byId = cards.find((card) => String(card.id) === String(item.card_id));
    if (byId) return String(byId.id);
  }
  const key = normalizeCardKey(item.card_name, item.set_name);
  const match = cards.find((card) => normalizeCardKey(card.card_name, card.set_name) === key);
  return match ? String(match.id) : null;
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

/** "Charizard (Base Set)" / "Charizard" / "Card 2" — same as the admin changelog. */
export function cardLabel(card: CardRow, index: number): string {
  const name = String(card.card_name ?? "").trim();
  const set = String(card.set_name ?? "").trim();
  if (name && set) return `${name} (${set})`;
  if (name) return name;
  return `Card ${index + 1}`;
}

function serviceLabel(item: QuoteItemRow): string {
  return (
    String(item.service_label ?? "").trim() ||
    (item.service_key === SERVICE_KEYS.CUSTOM ? "Custom" : item.service_key)
  );
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
      "id, sort_order, card_id, card_name, set_name, service_key, service_label, quote_base_amount, high_value_surcharge"
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
      "id, display_id, customer_name, customer_email, user_id, delivery_method, status, pending_kind, quote_bulk_counts"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as OrderRow | null) ?? null;
}

export async function loadContacts(
  supabase: SupabaseClient,
  orderId: string
): Promise<ContactRow[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, contact_type, value")
    .eq("order_id", orderId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ContactRow[];
}

/** Most recent admin email for the order (ignores the automatic confirmation). */
export async function loadLastNotification(
  supabase: SupabaseClient,
  orderId: string
): Promise<LastNotification | null> {
  const { data, error } = await supabase
    .from("customer_messages")
    .select("subject, sent_at, recipient_email, sender")
    .eq("order_id", orderId)
    .eq("email_status", "sent")
    .neq("subject", QUOTE_CONFIRMATION_SUBJECT)
    .order("sent_at", { ascending: false })
    .limit(5);
  if (error) {
    // The wrap-up still renders without this line.
    console.error("loadLastNotification", error);
    return null;
  }
  const row = (data ?? []).find((entry) => entry.sender !== "customer");
  if (!row) return null;
  return {
    subject: String(row.subject ?? ""),
    sent_at: String(row.sent_at ?? ""),
    recipient_email: String(row.recipient_email ?? ""),
  };
}

export type OrderContext = {
  order: OrderRow;
  cards: CardRow[];
  quoteItems: QuoteItemRow[];
  contacts: ContactRow[];
  lastNotification: LastNotification | null;
};

export async function loadOrderContext(
  supabase: SupabaseClient,
  orderId: string
): Promise<OrderContext | null> {
  const [order, cards, quoteItems, contacts, lastNotification] = await Promise.all([
    loadOrder(supabase, orderId),
    loadOrderCards(supabase, orderId),
    loadOrderQuoteItems(supabase, orderId),
    loadContacts(supabase, orderId),
    loadLastNotification(supabase, orderId),
  ]);
  if (!order) return null;
  return { order, cards, quoteItems, contacts, lastNotification };
}

export type CardContext = OrderContext & {
  card: CardRow;
  cardIndex: number;
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

  const context = await loadOrderContext(supabase, String(cardRow.order_id));
  if (!context) return null;
  const cardIndex = context.cards.findIndex((card) => String(card.id) === String(cardId));
  if (cardIndex < 0) return null;
  const card = context.cards[cardIndex];
  return {
    ...context,
    card,
    cardIndex,
    cardQuoteItems: quoteItemsForCard(context.quoteItems, card),
    hvAmount: storedCardHvAmount(context.order.quote_bulk_counts, String(card.id)),
  };
}

// ---------------------------------------------------------------------------
// Quote math over a context

export type CardQuote = {
  card: CardRow;
  index: number;
  items: QuoteItemRow[];
  hvAmount: number;
  subtotal: number;
  quoted: boolean;
  canceled: boolean;
};

export function cardQuotes(context: OrderContext): CardQuote[] {
  return context.cards.map((card, index) => {
    const items = quoteItemsForCard(context.quoteItems, card);
    const hvAmount = storedCardHvAmount(context.order.quote_bulk_counts, String(card.id));
    const services = items.reduce((sum, item) => sum + (Number(item.quote_base_amount) || 0), 0);
    const canceled = cardIsCanceled(card);
    return {
      card,
      index,
      items,
      hvAmount,
      subtotal: canceled ? 0 : roundMoney(services + hvAmount),
      quoted: !canceled && (items.length > 0 || hvAmount > 0),
      canceled,
    };
  });
}

export function orderTotals(context: OrderContext) {
  return orderQuoteTotal({
    cards: context.cards.map((card) => ({
      id: String(card.id),
      status: card.status,
      is_priority: card.is_priority,
    })),
    items: context.quoteItems.map((item) => ({
      card_id: cardIdForQuoteItem(item, context.cards),
      quote_base_amount: item.quote_base_amount,
    })),
    quoteBulkCounts: context.order.quote_bulk_counts,
  });
}

/** "pending quote" / "pending drop-off" / other statuses with underscores spaced. */
export function orderStatusText(order: OrderRow): string {
  const status = String(order.status ?? "");
  if (status === "pending") {
    return order.pending_kind === "drop_off" ? "pending drop-off" : "pending quote";
  }
  return status.replace(/_/g, " ");
}

/** `{ quoted, active }` counts over non-canceled cards. */
export function quoteProgress(context: OrderContext): { quoted: number; active: number } {
  const active = cardQuotes(context).filter((entry) => !entry.canceled);
  return { quoted: active.filter((entry) => entry.quoted).length, active: active.length };
}

/**
 * Email changelog built from the stored quote (no "before" snapshot exists in
 * Discord). Uses the same line wording as the admin editor's changelog so the
 * Resend template renders it identically.
 */
export function buildQuoteChangelog(context: OrderContext): ChangelogPayload {
  const cardGroups: NonNullable<ChangelogPayload["cardGroups"]> = [];
  for (const entry of cardQuotes(context)) {
    if (entry.canceled) continue;
    const changes: string[] = entry.items.map(
      (item) => `Added: ${serviceLabel(item)}: ${formatMoney(item.quote_base_amount)}`
    );
    if (entry.hvAmount > 0) {
      changes.push(`Added: High-value fee: ${formatMoney(entry.hvAmount)}`);
    }
    const note = String(entry.card.admin_note ?? "").trim();
    if (note) changes.push(`Note: ${note}`);
    if (changes.length === 0) continue;
    cardGroups.push({
      cardId: String(entry.card.id),
      label: cardLabel(entry.card, entry.index),
      status: "modified",
      changes,
    });
  }
  const totals = orderTotals(context);
  const orderChanges: string[] = [];
  if (totals.priorityFee > 0) orderChanges.push("Added: Priority service");
  return {
    cardGroups,
    orderChanges,
    quoteSummary: `Quote total: ${formatMoney(totals.total)}`,
  };
}

// ---------------------------------------------------------------------------
// Message builders

export function threadName(order: OrderRow): string {
  const customer = String(order.customer_name ?? "").trim();
  return `#${order.display_id}${customer ? ` · ${customer}` : ""}`.slice(0, 100);
}

export function buildOrderHeaderMessage(params: {
  order: OrderRow;
  cardCount: number;
}): Json {
  const { order, cardCount } = params;
  const customer = String(order.customer_name ?? "").trim();

  const lines = [
    `# New Order #${order.display_id}`,
    `**Customer:** ${customer ? escapeMarkdown(customer) : "—"}`,
    `**Cards:** ${cardCount}`,
    "-# Cards are in this thread — quote each one, then **Save & notify** on the last message.",
  ];

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
  const serviceLines = cardQuoteItems.map(
    (item) => `• ${escapeMarkdown(serviceLabel(item))} — ${formatMoney(item.quote_base_amount)}`
  );
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

function contactLine(contact: ContactRow): string {
  const type = String(contact.contact_type ?? "");
  const label = CONTACT_TYPE_LABELS[type] ?? "Contact";
  const value = String(contact.value ?? "").trim();
  if (!value) return "";
  if (type === "instagram") {
    const url = instagramProfileUrl(value);
    return url ? `• ${label}: [${escapeMarkdown(value)}](${url})` : `• ${label}: ${escapeMarkdown(value)}`;
  }
  if (type === "discord") {
    const id = normalizeDiscordUserId(value);
    // Mention renders a clickable profile; allowed_mentions keeps it silent.
    return id ? `• ${label}: <@${id}> (${escapeMarkdown(value)})` : `• ${label}: ${escapeMarkdown(value)}`;
  }
  return `• ${label}: ${escapeMarkdown(value)}`;
}

function discordTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return `<t:${Math.floor(ms / 1000)}:f>`;
}

/** Last message in the order thread: contacts, quote overview, outreach text, notify. */
export function buildWrapupMessage(params: {
  context: OrderContext;
  interactive: boolean;
}): Json {
  const { context, interactive } = params;
  const { order, contacts, lastNotification } = context;
  const customer = String(order.customer_name ?? "").trim();
  const email = String(order.customer_email ?? "").trim();

  const headerLines = [
    `## Order #${order.display_id} · wrap-up`,
    `**Customer:** ${customer ? escapeMarkdown(customer) : "—"}`,
  ];

  const contactLines = contacts.map(contactLine).filter(Boolean);
  if (email) contactLines.push(`• Email: ${escapeMarkdown(email)}`);
  const contactsBlock = [
    "**Contacts**",
    ...(contactLines.length > 0 ? contactLines : ["_none on file_"]),
  ];

  const quotes = cardQuotes(context);
  const totals = orderTotals(context);
  const overviewLines = quotes.map((entry) => {
    const label = escapeMarkdown(cardLabel(entry.card, entry.index));
    if (entry.canceled) return `• ${entry.index + 1} · ${label} — canceled`;
    if (!entry.quoted) return `• ${entry.index + 1} · ${label} — _not quoted_`;
    const parts = [
      entry.items.length > 0 ? `${entry.items.length} service${entry.items.length === 1 ? "" : "s"}` : "",
      entry.hvAmount > 0 ? `HV +${formatMoney(entry.hvAmount)}` : "",
    ].filter(Boolean);
    return `• ${entry.index + 1} · ${label} — **${formatMoney(entry.subtotal)}**${
      parts.length ? ` (${parts.join(", ")})` : ""
    }`;
  });
  const extras: string[] = [];
  if (totals.priorityFee > 0) extras.push(`priority +${formatMoney(totals.priorityFee)}`);
  if (totals.adjustmentsTotal !== 0) {
    extras.push(
      `adjustments ${totals.adjustmentsTotal > 0 ? "+" : "−"}${formatMoney(Math.abs(totals.adjustmentsTotal))}`
    );
  }
  const overviewBlock = [
    "**Quote overview**",
    ...overviewLines,
    `**Total ${formatMoney(totals.total)}**${extras.length ? ` (${extras.join(", ")})` : ""}`,
    `-# Order ${orderStatusText(order)}`,
  ];

  const outreachBlock = [
    "**Quote message (copy & paste)**",
    "```text",
    DEFAULT_OUTREACH_MESSAGE,
    "```",
  ];

  const notifyLine = lastNotification
    ? `✅ Emailed ${escapeMarkdown(lastNotification.recipient_email)} ${discordTimestamp(
        lastNotification.sent_at
      )} — “${escapeMarkdown(truncate(lastNotification.subject, 80))}”`
    : email
      ? "-# Customer not emailed yet. **Save & notify** sends the quote summary like the admin editor does."
      : "-# No email on this order — notify via a contact above.";

  const components: Json[] = [
    textDisplay(headerLines.join("\n")),
    textDisplay(contactsBlock.join("\n")),
    separator(1),
    textDisplay(overviewBlock.join("\n")),
    separator(1),
    textDisplay(outreachBlock.join("\n")),
    separator(1),
    textDisplay(notifyLine),
  ];

  if (interactive) {
    components.push(
      actionRow([
        button({
          customId: `${NOTIFY_BUTTON_PREFIX}${order.id}`,
          label: lastNotification ? "Save & notify again" : "Save & notify",
          style: ButtonStyle.SUCCESS,
          emoji: "📨",
          disabled: !email,
        }),
      ])
    );
  }

  return {
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [container(components, ACCENT_WRAPUP)],
  };
}

// ---------------------------------------------------------------------------
// Re-render from DB

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

/** Find the wrap-up message in an order thread by its notify button id. */
export async function findWrapupMessageId(
  threadId: string,
  orderId: string
): Promise<string | null> {
  const messages = await listChannelMessages(threadId, 50);
  const customId = `${NOTIFY_BUTTON_PREFIX}${orderId}`;
  const match = messages.find((message) => messageHasCustomId(message, customId));
  return match ? String(match.id) : null;
}

/** Re-render the wrap-up in its thread from the DB. Best effort; returns success. */
export async function refreshWrapupInThread(
  supabase: SupabaseClient,
  threadId: string,
  orderId: string,
  context?: OrderContext | null
): Promise<boolean> {
  try {
    const messageId = await findWrapupMessageId(threadId, orderId);
    if (!messageId) return false;
    const fresh = context ?? (await loadOrderContext(supabase, orderId));
    if (!fresh) return false;
    return await editChannelMessage(
      threadId,
      messageId,
      buildWrapupMessage({ context: fresh, interactive: true })
    );
  } catch (err) {
    console.error("wrap-up refresh failed", err);
    return false;
  }
}
