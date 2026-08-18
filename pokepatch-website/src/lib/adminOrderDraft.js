import {
  isPendingOrderStatus,
  normalizeCardChecklist,
  normalizeCardStatus,
  normalizeOrderStatus,
  normalizePendingKind,
  orderStatusFromCardStatuses,
  orderStatusManuallyChanged,
  DEFAULT_CARD_STATUS,
  DEFAULT_PENDING_KIND,
} from "@/lib/orderStatus";
import {
  SERVICE_KEYS,
  hvPercentFromMarketValue,
  hvSurchargeFromMarketValue,
  packAdminLedger,
  packQuoteAdjustments,
  parseMoneyInput,
  unpackAdminLedger,
  unpackQuoteAdjustments,
} from "@/lib/servicePricing";
import { normalizeDamageTags } from "@/lib/gallery";

export const MAX_ADMIN_PHOTOS_PER_CARD = 20;

export function newClientId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyAdminCard() {
  return {
    id: newClientId(),
    card_name: "",
    set_name: "",
    description: "",
    damage_tags: [],
    admin_note: "",
    market_value_raw_nm: "",
    status: DEFAULT_CARD_STATUS,
    checklist: normalizeCardChecklist(null),
    images: [],
    pending_files: [],
  };
}

export function validateDriveUrl(driveUrl) {
  const trimmed = (driveUrl ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Google Drive link must be an http(s) URL.";
    }
  } catch {
    return "Google Drive link must be a valid URL.";
  }
  return null;
}

export function copyFileList(fileList) {
  if (!fileList) return [];
  const copied = [];
  for (let i = 0; i < fileList.length; i += 1) {
    copied.push(fileList[i]);
  }
  return copied;
}

export function findMatchingOrderCardId(item, cards) {
  const name = (item?.card_name || "").trim().toLowerCase();
  const set = (item?.set_name || "").trim().toLowerCase();
  if (!name) return null;
  const match = (cards ?? []).find(
    (card) =>
      (card.card_name || "").trim().toLowerCase() === name &&
      (card.set_name || "").trim().toLowerCase() === set
  );
  return match?.id != null ? String(match.id) : null;
}

export function emptyQuoteItem(card = null) {
  return {
    id: newClientId(),
    card_pick: card?.id != null ? String(card.id) : "",
    card_name: card?.card_name ?? "",
    set_name: card?.set_name ?? "",
    service_key: "",
    service_label: "",
    quote_base_amount: "",
  };
}

export function quoteItemHasService(item) {
  return Boolean(item?.service_key);
}

/** True when a quote line is complete enough to collapse / count as priced. */
export function quoteItemIsReady(item) {
  if (!quoteItemHasService(item)) return false;
  if (item.service_key === SERVICE_KEYS.CUSTOM) {
    return Boolean((item.service_label ?? "").trim());
  }
  return true;
}

export function quoteItemCardRef(item, cards = [], index = 0) {
  const linked =
    item?.card_pick && item.card_pick !== "custom"
      ? (cards ?? []).find(
          (card) => String(card.id) === String(item.card_pick)
        )
      : null;
  const name = (linked?.card_name ?? item?.card_name ?? "").trim();
  const set = (linked?.set_name ?? item?.set_name ?? "").trim();
  if (name) return set ? `${name} (${set})` : name;
  return `quote line ${index + 1}`;
}

export function quoteItemBelongsToCard(item, card, cards = null) {
  if (!card) return false;
  const cardId = String(card.id);
  if (item?.card_pick && item.card_pick !== "custom") {
    return String(item.card_pick) === cardId;
  }
  return findMatchingOrderCardId(item, cards ?? [card]) === cardId;
}

/** True when every non-canceled card has at least one ready quote line. */
export function allCardsHaveQuote(cards, quoteItems) {
  const list = (cards ?? []).filter(
    (card) => normalizeCardStatus(card.status) !== "canceled"
  );
  if (list.length === 0) return false;
  return list.every((card) =>
    (quoteItems ?? []).some(
      (item) => quoteItemBelongsToCard(item, card, cards) && quoteItemIsReady(item)
    )
  );
}

/** Pending quote → pending drop-off once every card is quoted. */
export function applyAutoPendingDropoff(draft) {
  if (normalizeOrderStatus(draft.status) !== "pending") return draft;
  if (normalizePendingKind(draft.pending_kind) !== DEFAULT_PENDING_KIND) {
    return draft;
  }
  if (!allCardsHaveQuote(draft.cards, draft.quote_items)) return draft;
  return { ...draft, pending_kind: "drop_off" };
}

/** Ensure every order card has at least one (possibly empty) quote line. */
export function ensureQuoteItemsForCards(cards, quoteItems) {
  const items = [...(quoteItems ?? [])];
  for (const card of cards ?? []) {
    const hasLine = items.some((item) =>
      quoteItemBelongsToCard(item, card, cards)
    );
    if (!hasLine) {
      items.push(emptyQuoteItem(card));
    }
  }
  return items;
}

export function moneyFieldToPayload(value) {
  return parseMoneyInput(value);
}

/** One card HV entry from market value (tier %); null when under threshold / empty. */
function cardHvEntryFromMarket(marketValue) {
  const amount = hvSurchargeFromMarketValue(marketValue);
  if (amount == null) return null;
  return {
    percent: String(hvPercentFromMarketValue(marketValue)),
    amount_dollars: String(amount),
  };
}

/** Build card HV map from market values only (tier %). */
export function quoteCardHvFromMarkets(cards) {
  const out = {};
  for (const card of cards ?? []) {
    if (card?.id == null) continue;
    const entry = cardHvEntryFromMarket(
      moneyFieldToPayload(card.market_value_raw_nm)
    );
    if (entry) out[String(card.id)] = entry;
  }
  return out;
}

export function applyCardHvFromMarket(quoteCardHv, cardId, marketValue) {
  const next = { ...(quoteCardHv ?? {}) };
  const hv = cardHvEntryFromMarket(marketValue);
  if (hv) {
    next[cardId] = hv;
  } else {
    delete next[cardId];
  }
  return next;
}

export function orderToDraft(order) {
  const orderCards = order.cards ?? [];
  const quoteItems = (order.quote_items ?? []).map((item) => {
    const card_name = item.card_name ?? "";
    const set_name = item.set_name ?? "";
    const matchedId = findMatchingOrderCardId(
      { card_name, set_name },
      orderCards
    );
    return {
      id: item.id ?? newClientId(),
      card_pick: matchedId ?? "",
      card_name,
      set_name,
      service_key: item.service_key ?? SERVICE_KEYS.CUSTOM,
      service_label: item.service_label ?? "",
      quote_base_amount:
        item.quote_base_amount != null ? String(item.quote_base_amount) : "",
    };
  });
  const ensuredQuoteItems = ensureQuoteItemsForCards(orderCards, quoteItems);
  const quote_adjustments = unpackQuoteAdjustments(order.quote_bulk_counts, {
    overrideLabel: order.quote_override_label ?? "",
    overrideAmount: order.quote_override_amount,
  });
  const admin_tips = unpackAdminLedger(order.admin_tips);
  const restoration_costs = unpackAdminLedger(order.restoration_costs);
  const cards = orderCards.map((card) => ({
    id: card.id,
    card_name: card.card_name ?? "",
    set_name: card.set_name ?? "",
    description: card.description ?? "",
    damage_tags: normalizeDamageTags(card.damage_tags),
    admin_note: card.admin_note ?? "",
    market_value_raw_nm:
      card.market_value_raw_nm != null
        ? String(card.market_value_raw_nm)
        : "",
    status: normalizeCardStatus(card.status),
    checklist: normalizeCardChecklist(card.checklist),
    images: card.images ?? [],
    pending_files: [],
  }));
  const quote_card_hv = quoteCardHvFromMarkets(cards);

  const firstName = (order.first_name ?? "").trim();
  const lastName = (order.last_name ?? "").trim();
  const customerName = (order.customer_name ?? "").trim();
  const displayFirstName =
    firstName || (!lastName && customerName ? customerName : "");

  return {
    first_name: displayFirstName,
    last_name: lastName,
    customer_name: customerName,
    customer_email: order.customer_email ?? "",
    has_account: Boolean(order.has_account),
    delivery_method: order.delivery_method ?? "local_dropoff",
    general_notes: order.general_notes ?? "",
    heard_about_source: order.heard_about_source ?? "",
    photos_drive_url: order.photos_drive_url ?? "",
    status: normalizeOrderStatus(order.status),
    is_priority: Boolean(order.is_priority),
    pending_kind: isPendingOrderStatus(order.status)
      ? normalizePendingKind(order.pending_kind)
      : null,
    contacts: (order.contacts ?? []).map((contact) => ({
      id: contact.id,
      contact_type: contact.contact_type,
      value: contact.value ?? "",
    })),
    cards,
    quote_items: ensuredQuoteItems,
    quote_adjustments,
    quote_card_hv,
    admin_tips,
    restoration_costs,
  };
}

export function draftPayload(draft) {
  const status = normalizeOrderStatus(draft.status);
  return {
    order: {
      delivery_method: draft.delivery_method,
      general_notes: draft.general_notes.trim(),
      photos_drive_url: draft.photos_drive_url.trim(),
      is_priority: Boolean(draft.is_priority),
      status,
      ...(status === "pending"
        ? { pending_kind: normalizePendingKind(draft.pending_kind) }
        : { pending_kind: null }),
      quote_bulk_counts: packQuoteAdjustments(
        draft.quote_adjustments,
        draft.quote_card_hv
      ),
      quote_override_label: "",
      quote_override_amount: null,
      admin_tips: packAdminLedger(draft.admin_tips),
      restoration_costs: packAdminLedger(draft.restoration_costs),
    },
    contacts: draft.contacts
      .filter((contact) => contact.value.trim() !== "")
      .map((contact) => ({
        ...(contact.id != null ? { id: contact.id } : {}),
        contact_type: contact.contact_type,
        value: contact.value.trim(),
      })),
    cards: draft.cards.map((card) => ({
      id: card.id,
      card_name: card.card_name.trim(),
      set_name: card.set_name.trim(),
      description: card.description.trim(),
      damage_tags: normalizeDamageTags(card.damage_tags),
      admin_note: card.admin_note.trim(),
      market_value_raw_nm: moneyFieldToPayload(card.market_value_raw_nm),
      status: normalizeCardStatus(card.status),
      checklist: normalizeCardChecklist(card.checklist),
    })),
    quote_items: (draft.quote_items ?? [])
      .filter((item) => quoteItemHasService(item))
      .map((item, index) => {
        const linked =
          item.card_pick && item.card_pick !== "custom"
            ? draft.cards.find(
                (card) => String(card.id) === String(item.card_pick)
              )
            : null;
        const card_name = (linked?.card_name ?? item.card_name).trim();
        const set_name = (linked?.set_name ?? item.set_name).trim();
        return {
          id: item.id,
          sort_order: index,
          card_name,
          set_name,
          service_key: item.service_key,
          service_label: item.service_label.trim(),
          quote_base_amount: moneyFieldToPayload(item.quote_base_amount),
          high_value_surcharge: null,
        };
      }),
  };
}

/** Changelog / notify preview: includes order auto-advance from card statuses. */
export function draftPayloadForSavePreview(draft, savedDraft = null) {
  const payload = draftPayload(draft);
  if (savedDraft && orderStatusManuallyChanged(savedDraft, draft)) {
    return payload;
  }
  const autoStatus = orderStatusFromCardStatuses(draft.status, draft.cards);
  if (!autoStatus) return payload;
  return {
    ...payload,
    order: {
      ...payload.order,
      status: autoStatus,
      pending_kind: null,
    },
  };
}

export function validateDraftForSave(draft) {
  const driveError = validateDriveUrl(draft.photos_drive_url);
  if (driveError) {
    return driveError;
  }
  for (const contact of draft.contacts) {
    if (!contact.value.trim()) {
      return "Fill in every contact or remove empty rows before saving.";
    }
  }
  for (let index = 0; index < draft.cards.length; index += 1) {
    const card = draft.cards[index];
    if (!card.card_name.trim()) {
      return `Card ${index + 1} needs a name.`;
    }
    if (
      (card.market_value_raw_nm ?? "").trim() !== "" &&
      moneyFieldToPayload(card.market_value_raw_nm) == null
    ) {
      return `Card ${index + 1} has an invalid market value.`;
    }
  }
  for (let index = 0; index < (draft.quote_items ?? []).length; index += 1) {
    const item = draft.quote_items[index];
    if (!quoteItemHasService(item)) continue;
    const linked =
      item.card_pick && item.card_pick !== "custom"
        ? draft.cards.find(
            (card) => String(card.id) === String(item.card_pick)
          )
        : null;
    const cardName = (linked?.card_name ?? item.card_name ?? "").trim();
    const cardRef = quoteItemCardRef(item, draft.cards, index);
    if (!cardName) {
      return `Quote for ${cardRef} needs a card name.`;
    }
    if (!item.service_label.trim()) {
      return `Quote for ${cardRef} needs a service name.`;
    }
    if (moneyFieldToPayload(item.quote_base_amount) == null) {
      return `Quote for ${cardRef} needs a valid base amount.`;
    }
  }
  for (let index = 0; index < (draft.quote_adjustments ?? []).length; index += 1) {
    const row = draft.quote_adjustments[index];
    const hasDescription = Boolean((row.description ?? "").trim());
    const dollars = moneyFieldToPayload(row.amount_dollars);
    const hasAmount = dollars != null && dollars !== 0;
    if (!hasDescription && !hasAmount) continue;
    if (!hasAmount) {
      return `Adjustment ${index + 1} needs a $ amount.`;
    }
  }
  const tipError = validateAdminLedgerDraft(draft.admin_tips, "Tip");
  if (tipError) return tipError;
  const spendError = validateAdminLedgerDraft(
    draft.restoration_costs,
    "Restoration spend"
  );
  if (spendError) return spendError;
  return null;
}

function validateAdminLedgerDraft(rows, label) {
  for (let index = 0; index < (rows ?? []).length; index += 1) {
    const row = rows[index];
    const hasDescription = Boolean((row.description ?? "").trim());
    const dollars = moneyFieldToPayload(row.amount_dollars);
    const hasAmount = dollars != null && dollars !== 0;
    if (!hasDescription && !hasAmount) continue;
    if (!hasAmount) {
      return `${label} ${index + 1} needs a $ amount.`;
    }
  }
  return null;
}
