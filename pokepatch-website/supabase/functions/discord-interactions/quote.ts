/**
 * Quote a card from Discord.
 *
 * `notify` posts one message per card with an **Add quote** button. Clicking
 * it opens a modal (services checklist, market value, note to customer).
 * Submitting writes through `update_order` — the same RPC the admin editor
 * uses — then re-renders the card message. Non-list prices / custom lines
 * stay in the admin editor.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/adminSession.ts";
import {
  CallbackType,
  EPHEMERAL,
  TextInputStyle,
  checkboxGroup,
  collectModalFields,
  editChannelMessage,
  editOriginal,
  ephemeralReply,
  fieldValue,
  fieldValues,
  json,
  labeled,
  textInput,
  type Interaction,
  type Json,
} from "../_shared/discord.ts";
import {
  QUOTE_BUTTON_PREFIX,
  cardIsCanceled,
  loadCardContext,
  orderStatusText,
  parsePrefixedCustomId,
  quoteItemsForCard,
  quoteProgress,
  quoteSummaryLines,
  refreshWrapupInThread,
  renderCardMessageFromDb,
  type CardContext,
  type CardRow,
  type QuoteItemRow,
} from "../_shared/discordOrderMessages.ts";
import {
  HV_TIER_RANGES_LABEL,
  QUOTE_SERVICES,
  serviceByKey,
  servicePriceDisplay,
  withCardHvFromMarket,
} from "../_shared/servicePricing.ts";

const FIELD = {
  SERVICES: "services",
  MARKET: "market",
  NOTE: "note",
} as const;

const MAX_NOTE_CHARS = 1000;

type QuoteLine = {
  service_key: string;
  service_label: string;
  quote_base_amount: number;
};

function parseMoneyText(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Checked services at list price. */
export function buildQuoteLines(selectedKeys: string[]): QuoteLine[] {
  const wanted = new Set(selectedKeys);
  const lines: QuoteLine[] = [];
  for (const service of QUOTE_SERVICES) {
    if (!wanted.has(service.key)) continue;
    lines.push({
      service_key: service.key,
      service_label: service.title,
      quote_base_amount: service.listPrice ?? 0,
    });
  }
  return lines;
}

function moneyPrefill(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
}

function quoteModal(params: {
  customId: string;
  card: CardRow;
  cardQuoteItems: QuoteItemRow[];
  cardLabel: string;
}): Json {
  const { customId, card, cardQuoteItems, cardLabel } = params;
  const selectedKeys = new Set(
    cardQuoteItems
      .map((item) => item.service_key)
      .filter((key) => Boolean(serviceByKey(key)))
  );

  return {
    type: CallbackType.MODAL,
    data: {
      custom_id: customId,
      title: `Quote · ${cardLabel}`.slice(0, 45),
      components: [
        labeled(
          "Services",
          checkboxGroup({
            customId: FIELD.SERVICES,
            options: QUOTE_SERVICES.map((service) => ({
              value: service.key,
              label: service.title,
              description: `${servicePriceDisplay(service)} / card`,
              default: selectedKeys.has(service.key),
            })),
          }),
          "List prices — custom amounts in admin"
        ),
        labeled(
          "Market value (Raw NM, $)",
          textInput({
            customId: FIELD.MARKET,
            placeholder: "e.g. 350 — leave blank if under $200",
            value: moneyPrefill(card.market_value_raw_nm),
            maxLength: 12,
          }),
          `High-value fee: ${HV_TIER_RANGES_LABEL}`
        ),
        labeled(
          "Note to customer",
          textInput({
            customId: FIELD.NOTE,
            style: TextInputStyle.PARAGRAPH,
            placeholder: "Optional — shown on this card in My Orders",
            value: String(card.admin_note ?? ""),
            maxLength: MAX_NOTE_CHARS,
          }),
          "Shown under this card in My Orders"
        ),
      ],
    },
  };
}

function cardLabelFor(context: CardContext): string {
  const name = String(context.card.card_name ?? "").trim() || `Card ${context.cardIndex + 1}`;
  return `#${context.order.display_id} · ${name}`;
}

/** Button click → open the quote modal, prefilled from the current quote. */
export async function handleQuoteButton(interaction: Interaction): Promise<Response> {
  const data = (interaction.data ?? {}) as Json;
  const parsed = parsePrefixedCustomId(QUOTE_BUTTON_PREFIX, String(data.custom_id ?? ""));
  if (!parsed) return ephemeralReply("Unknown button.");

  let context: CardContext | null;
  try {
    context = await loadCardContext(getServiceClient(), parsed.id);
  } catch (err) {
    console.error("quote button load failed", err);
    return ephemeralReply("Couldn't load this card. Try again.");
  }
  if (!context) {
    return ephemeralReply("This card no longer exists (order deleted or card removed).");
  }
  if (cardIsCanceled(context.card)) {
    return ephemeralReply("This card is canceled — it isn't part of the quote.");
  }

  const message = (interaction.message ?? {}) as Json;
  const channelId = String(interaction.channel_id ?? message.channel_id ?? "");
  const messageId = String(message.id ?? "");
  const customId = `${QUOTE_BUTTON_PREFIX}${parsed.id}:${channelId}:${messageId}`;

  return json(
    quoteModal({
      customId,
      card: context.card,
      cardQuoteItems: context.cardQuoteItems,
      cardLabel: cardLabelFor(context),
    })
  );
}

// ---------------------------------------------------------------------------
// Save

export async function saveCardQuote(params: {
  supabase: SupabaseClient;
  context: CardContext;
  lines: QuoteLine[];
  marketValue: number | null;
  note: string;
}): Promise<void> {
  const { supabase, context, lines, marketValue, note } = params;
  const { order, card, cards, quoteItems } = context;

  const cardName = String(card.card_name ?? "").trim();
  if (!cardName && lines.length > 0) {
    throw new Error("This card has no name yet — set one in admin before quoting.");
  }
  const setName = String(card.set_name ?? "").trim();

  // Quote lines attach to a card by name + set; drop this card's old lines.
  const cardItemIds = new Set(quoteItemsForCard(quoteItems, card).map((item) => item.id));
  const kept = quoteItems
    .filter((item) => !cardItemIds.has(item.id))
    .map((item) => ({
      id: item.id,
      card_name: item.card_name,
      set_name: item.set_name ?? "",
      service_key: item.service_key,
      service_label: item.service_label,
      quote_base_amount: Number(item.quote_base_amount),
      high_value_surcharge: item.high_value_surcharge ?? null,
    }));
  const added = lines.map((line) => ({
    card_name: cardName,
    set_name: setName,
    service_key: line.service_key,
    service_label: line.service_label,
    quote_base_amount: line.quote_base_amount,
    high_value_surcharge: null,
  }));
  const quote_items = [...kept, ...added].map((item, index) => ({
    ...item,
    sort_order: index,
  }));

  // update_order treats p_cards as the full card list (missing cards are deleted).
  const p_cards = cards.map((row) =>
    String(row.id) === String(card.id)
      ? {
          id: row.id,
          market_value_raw_nm: marketValue,
          admin_note: note,
        }
      : { id: row.id }
  );

  const { error } = await supabase.rpc("update_order", {
    p_order_id: order.id,
    p_order: {
      quote_items,
      quote_bulk_counts: withCardHvFromMarket(
        order.quote_bulk_counts,
        String(card.id),
        marketValue
      ),
    },
    p_cards,
  });
  if (error) throw error;
}

function orderProgressLine(context: CardContext): string {
  const { quoted, active } = quoteProgress(context);
  return `${quoted}/${active} cards quoted. Order is **${orderStatusText(context.order)}**.`;
}

async function processQuoteModal(interaction: Interaction): Promise<void> {
  const applicationId = String(interaction.application_id ?? "");
  const token = String(interaction.token ?? "");
  const data = (interaction.data ?? {}) as Json;
  const parsed = parsePrefixedCustomId(QUOTE_BUTTON_PREFIX, String(data.custom_id ?? ""));

  try {
    if (!parsed) {
      await editOriginal(applicationId, token, "Invalid quote form.");
      return;
    }

    const fields = collectModalFields(data.components);
    const selectedKeys = fieldValues(fields, FIELD.SERVICES).filter((key) =>
      Boolean(serviceByKey(key))
    );
    const marketRaw = fieldValue(fields, FIELD.MARKET);
    const note = fieldValue(fields, FIELD.NOTE).slice(0, MAX_NOTE_CHARS);

    let marketValue: number | null = null;
    if (marketRaw) {
      marketValue = parseMoneyText(marketRaw);
      if (marketValue == null || marketValue < 0) {
        await editOriginal(
          applicationId,
          token,
          `**Nothing saved.** Market value "${marketRaw}" isn't a valid dollar amount.`
        );
        return;
      }
    }

    const lines = buildQuoteLines(selectedKeys);

    const supabase = getServiceClient();
    const context = await loadCardContext(supabase, parsed.id);
    if (!context) {
      await editOriginal(applicationId, token, "This card no longer exists — nothing saved.");
      return;
    }
    if (cardIsCanceled(context.card)) {
      await editOriginal(applicationId, token, "This card is canceled — nothing saved.");
      return;
    }

    await saveCardQuote({ supabase, context, lines, marketValue, note });

    // Reload so the confirmation and the card message reflect what's stored.
    const rendered = await renderCardMessageFromDb(supabase, parsed.id);
    let messageUpdated = false;
    if (rendered && parsed.channelId && parsed.messageId) {
      messageUpdated = await editChannelMessage(
        parsed.channelId,
        parsed.messageId,
        rendered.payload
      );
    }

    const fresh = rendered?.context ?? context;
    // Card messages live in the order thread with the wrap-up; keep its
    // quote overview / Save & notify state current.
    if (messageUpdated && parsed.channelId) {
      await refreshWrapupInThread(supabase, parsed.channelId, fresh.order.id, fresh);
    }
    const summary = quoteSummaryLines({
      card: fresh.card,
      cardQuoteItems: fresh.cardQuoteItems,
      hvAmount: fresh.hvAmount,
    });
    const header = lines.length === 0 && fresh.hvAmount <= 0
      ? `🗑️ Cleared quote for **${cardLabelFor(fresh)}**`
      : `✅ Saved quote for **${cardLabelFor(fresh)}**`;
    const out = [header, ...summary.lines, orderProgressLine(fresh)];
    if (!messageUpdated) {
      out.push("-# Couldn't refresh the card message (missing bot token or message). The quote is saved.");
    }
    await editOriginal(applicationId, token, out.join("\n"));
  } catch (err) {
    console.error("quote modal failed", err);
    const message = err instanceof Error ? err.message : String(err);
    await editOriginal(applicationId, token, `Quote not saved: ${message}`);
  }
}

/** Modal submit: ACK now, save in the background. */
export function handleQuoteModal(
  interaction: Interaction,
  waitUntil: (promise: Promise<unknown>) => void
): Response {
  waitUntil(
    processQuoteModal(interaction).catch((err) => {
      console.error("quote modal background failed", err);
    })
  );
  return json({
    type: CallbackType.DEFERRED_CHANNEL_MESSAGE,
    data: { flags: EPHEMERAL },
  });
}
