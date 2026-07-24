import {
  adjustmentKindLabel,
  computeQuoteTotal,
  defaultServiceLabel,
  formatMoney,
  quoteAdjustmentSignedAmount,
  quoteItemsSubtotal,
  unpackQuoteAdjustments,
  unpackQuoteCardHv,
  cardsWithQuoteHv,
} from "@/lib/servicePricing";
import {
  customerCardStatusLabel,
  customerOrderStatusLabel,
  normalizeCardStatus,
  normalizeOrderStatus,
} from "@/lib/orderStatus";

function cardLabel(card, index = 0) {
  const name = String(card?.card_name ?? "").trim();
  const set = String(card?.set_name ?? "").trim();
  if (name && set) return `${name} (${set})`;
  if (name) return name;
  return `Card ${index + 1}`;
}

function indexById(rows, idKey = "id") {
  const map = new Map();
  (rows ?? []).forEach((row, index) => {
    if (row?.[idKey] == null) return;
    map.set(String(row[idKey]), { row, index });
  });
  return map;
}

function valuesEqual(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function findCardIdForQuoteItem(item, cards) {
  const name = (item?.card_name ?? "").trim().toLowerCase();
  const set = (item?.set_name ?? "").trim().toLowerCase();
  if (!name) return null;
  const match = (cards ?? []).find(
    (card) =>
      (card.card_name ?? "").trim().toLowerCase() === name &&
      (card.set_name ?? "").trim().toLowerCase() === set
  );
  return match?.id != null ? String(match.id) : null;
}

function cardSortIndex(cardId, afterCards, beforeCards) {
  const afterIdx = afterCards.get(cardId)?.index;
  if (afterIdx != null) return afterIdx;
  const beforeIdx = beforeCards.get(cardId)?.index;
  if (beforeIdx != null) return 1000 + beforeIdx;
  return 9999;
}

function quoteLineForCard(item) {
  const service =
    String(item?.service_label ?? "").trim() ||
    defaultServiceLabel(item?.service_key) ||
    "Service";
  const amount =
    item?.quote_base_amount != null
      ? formatMoney(Number(item.quote_base_amount))
      : null;
  return amount ? `${service} (${amount})` : service;
}

function formatAdjustmentAmount(row, subtotal = null) {
  const signed = quoteAdjustmentSignedAmount(row, subtotal);
  if (signed !== 0) return formatMoney(signed);
  const kind = row?.kind ?? "discount";
  const percent = row?.amount_percent;
  if (percent != null && percent !== "" && Number(percent) !== 0) {
    const n = Number(percent);
    const signedPct = kind === "discount" ? -Math.abs(n) : Math.abs(n);
    return `${signedPct}%`;
  }
  return null;
}

function adjustmentChangeCause(before, after, action, subtotal) {
  const row = after ?? before;
  const kind = row?.kind ?? "discount";
  const amount = formatAdjustmentAmount(row, subtotal);

  if (kind === "discount") {
    if (action === "added") return `Applied discount: ${amount}`;
    if (action === "removed") return `Removed discount: ${amount}`;
    return `Discount: ${formatAdjustmentAmount(before, subtotal)} → ${formatAdjustmentAmount(after, subtotal)}`;
  }

  const label = adjustmentKindLabel(kind).toLowerCase();
  if (action === "added") return `Added: ${label} ${amount}`;
  if (action === "removed") return `Removed: ${label} ${amount}`;
  return `${adjustmentKindLabel(kind)}: ${formatAdjustmentAmount(before, subtotal)} → ${formatAdjustmentAmount(after, subtotal)}`;
}

function quoteFingerprint(payload) {
  const order = payload?.order ?? {};
  const items = (payload?.quote_items ?? [])
    .map((item) => ({
      card_name: item.card_name ?? "",
      set_name: item.set_name ?? "",
      service_key: item.service_key ?? "",
      service_label: item.service_label ?? "",
      quote_base_amount: item.quote_base_amount ?? null,
    }))
    .sort((a, b) =>
      `${a.card_name}:${a.set_name}:${a.service_key}`.localeCompare(
        `${b.card_name}:${b.set_name}:${b.service_key}`
      )
    );
  return JSON.stringify({
    items,
    bulk: order.quote_bulk_counts ?? null,
  });
}

function quoteTotalFromPayload(payload) {
  if (!payload) return 0;
  const order = payload.order ?? {};
  const items = payload.quote_items ?? [];
  const adjustments = unpackQuoteAdjustments(order.quote_bulk_counts, {
    overrideLabel: "",
    overrideAmount: null,
  });
  const cardHvMap = unpackQuoteCardHv(order.quote_bulk_counts);
  const cardIds = new Set([
    ...Object.keys(cardHvMap),
    ...(payload.cards ?? []).map((card) => String(card.id)),
  ]);
  const cards = cardsWithQuoteHv(
    [...cardIds].map((id) => ({ id })),
    cardHvMap
  );
  return computeQuoteTotal({ items, cards, adjustments });
}

function cardTitleForId(cardId, beforeCards, afterCards) {
  const after = afterCards.get(cardId)?.row;
  const before = beforeCards.get(cardId)?.row;
  return cardLabel(
    after ?? before,
    afterCards.get(cardId)?.index ?? beforeCards.get(cardId)?.index ?? 0
  );
}

function cardStatus(cardId, beforeCards, afterCards) {
  const before = beforeCards.get(cardId)?.row;
  const after = afterCards.get(cardId)?.row;
  if (before && !after) return "removed";
  if (!before && after) return "added";
  return "modified";
}

/**
 * @typedef {'added' | 'removed' | 'modified'} CardChangelogStatus
 * @typedef {{ cardId: string, label: string, status: CardChangelogStatus, sortIndex: number, changes: string[] }} CardChangelogGroup
 */

/** First usable preview URL for a card (admin signed URLs when present). */
export function buildCardThumbById(cards = []) {
  const map = {};
  for (const card of cards ?? []) {
    if (card?.id == null) continue;
    const id = String(card.id);
    if (map[id]) continue;
    const images = card.images ?? [];
    const preferred =
      images.find((image) => image?.image_type === "customer") ?? images[0];
    const url =
      preferred?.signed_thumb_url || preferred?.signed_url || null;
    if (url) map[id] = url;
  }
  return map;
}

/**
 * Build customer-facing changelog grouped by card.
 * Order section: order status, adjustments (discount/surcharge/etc), quote total change.
 * Card sections: card status, services, high-value fees.
 * @returns {{ cardGroups: CardChangelogGroup[], orderChanges: string[], quoteSummary: string | null, text: string, hasChangelog: boolean }}
 */
export function buildOrderChangelog({ beforePayload, afterPayload } = {}) {
  const beforeCards = indexById(beforePayload?.cards);
  const afterCards = indexById(afterPayload?.cards);
  const cardGroupsMap = new Map();
  const orderChanges = [];

  function ensureCardGroup(cardId, { label, status, sortIndex } = {}) {
    let group = cardGroupsMap.get(cardId);
    if (!group) {
      group = {
        cardId,
        label:
          label ?? cardTitleForId(cardId, beforeCards, afterCards),
        status: status ?? cardStatus(cardId, beforeCards, afterCards),
        sortIndex:
          sortIndex ?? cardSortIndex(cardId, afterCards, beforeCards),
        changes: [],
      };
      cardGroupsMap.set(cardId, group);
    }
    return group;
  }

  /** Service lines always belong to a card box — never the Order section. */
  function ensureGroupForQuoteItem(item) {
    const cardId = findCardIdForQuoteItem(item, allCards);
    if (cardId) return ensureCardGroup(cardId);
    const label = cardLabel(item, 0);
    const orphanId = `orphan:${label.toLowerCase()}`;
    return ensureCardGroup(orphanId, {
      label,
      status: "modified",
      sortIndex: 5000 + cardGroupsMap.size,
    });
  }

  // Prefer after-card fields when both sides have the same id.
  const allCardsById = new Map();
  for (const card of beforePayload?.cards ?? []) {
    if (card?.id == null) continue;
    allCardsById.set(String(card.id), { ...card, id: String(card.id) });
  }
  for (const card of afterPayload?.cards ?? []) {
    if (card?.id == null) continue;
    allCardsById.set(String(card.id), { ...card, id: String(card.id) });
  }
  const allCards = [...allCardsById.values()];

  // Cards added or removed always get a box.
  for (const cardId of new Set([...beforeCards.keys(), ...afterCards.keys()])) {
    const status = cardStatus(cardId, beforeCards, afterCards);
    if (status === "added" || status === "removed") {
      ensureCardGroup(cardId);
    }
  }

  // Order status change.
  const beforeOrderStatus = normalizeOrderStatus(
    beforePayload?.order?.status
  );
  const afterOrderStatus = normalizeOrderStatus(afterPayload?.order?.status);
  if (
    beforePayload?.order != null &&
    afterPayload?.order != null &&
    beforeOrderStatus !== afterOrderStatus
  ) {
    orderChanges.push(
      `Status: ${customerOrderStatusLabel(beforeOrderStatus)} → ${customerOrderStatusLabel(afterOrderStatus)}`
    );
  }

  // Per-card status changes (surviving cards only).
  for (const cardId of new Set([...beforeCards.keys(), ...afterCards.keys()])) {
    const before = beforeCards.get(cardId)?.row;
    const after = afterCards.get(cardId)?.row;
    if (!before || !after) continue;
    const beforeStatus = normalizeCardStatus(before.status);
    const afterStatus = normalizeCardStatus(after.status);
    if (beforeStatus === afterStatus) continue;
    ensureCardGroup(cardId).changes.push(
      `Status: ${customerCardStatusLabel(beforeStatus)} → ${customerCardStatusLabel(afterStatus)}`
    );
  }

  const beforeItems = indexById(beforePayload?.quote_items);
  const afterItems = indexById(afterPayload?.quote_items);
  const quoteSubtotal = quoteItemsSubtotal(
    afterPayload?.quote_items ?? beforePayload?.quote_items ?? []
  );

  // Per-card service / quote-line diffs (Order never lists these).
  for (const itemId of new Set([...beforeItems.keys(), ...afterItems.keys()])) {
    const before = beforeItems.get(itemId)?.row;
    const after = afterItems.get(itemId)?.row;
    const item = after ?? before;

    let change = null;
    if (before && !after) {
      change = `Removed: ${quoteLineForCard(before)}`;
    } else if (!before && after) {
      change = `Added: ${quoteLineForCard(after)}`;
    } else if (quoteLineForCard(before) !== quoteLineForCard(after)) {
      change = `Updated: ${quoteLineForCard(before)} → ${quoteLineForCard(after)}`;
    }

    if (!change) continue;
    ensureGroupForQuoteItem(item).changes.push(change);
  }

  const beforeAdj = indexById(
    beforePayload?.order?.quote_bulk_counts?.adjustments ?? []
  );
  const afterAdj = indexById(
    afterPayload?.order?.quote_bulk_counts?.adjustments ?? []
  );

  for (const adjId of new Set([...beforeAdj.keys(), ...afterAdj.keys()])) {
    const before = beforeAdj.get(adjId)?.row;
    const after = afterAdj.get(adjId)?.row;
    if (before && !after) {
      orderChanges.push(adjustmentChangeCause(before, null, "removed", quoteSubtotal));
      continue;
    }
    if (!before && after) {
      orderChanges.push(adjustmentChangeCause(null, after, "added", quoteSubtotal));
      continue;
    }
    const beforeAmt = formatAdjustmentAmount(before, quoteSubtotal);
    const afterAmt = formatAdjustmentAmount(after, quoteSubtotal);
    if (before.kind !== after.kind || beforeAmt !== afterAmt) {
      orderChanges.push(
        adjustmentChangeCause(before, after, "updated", quoteSubtotal)
      );
    }
  }

  const beforeHv = indexById(
    beforePayload?.order?.quote_bulk_counts?.card_hv ?? [],
    "card_id"
  );
  const afterHv = indexById(
    afterPayload?.order?.quote_bulk_counts?.card_hv ?? [],
    "card_id"
  );

  for (const cardId of new Set([...beforeHv.keys(), ...afterHv.keys()])) {
    const before = beforeHv.get(cardId)?.row;
    const after = afterHv.get(cardId)?.row;
    const beforeAmt = before?.amount_dollars;
    const afterAmt = after?.amount_dollars;
    if (!valuesEqual(beforeAmt, afterAmt)) {
      const group = ensureCardGroup(String(cardId));
      if (beforeAmt == null || beforeAmt === "") {
        group.changes.push(
          `High-value fee: ${formatMoney(Number(afterAmt))}`
        );
      } else if (afterAmt == null || afterAmt === "") {
        group.changes.push("Removed: high-value fee");
      } else {
        group.changes.push(
          `High-value fee: ${formatMoney(Number(beforeAmt))} → ${formatMoney(Number(afterAmt))}`
        );
      }
    }
  }

  // New or removed cards: show full quote snapshot when we only have the add/remove event.
  for (const group of cardGroupsMap.values()) {
    if (group.changes.length > 0) continue;

    const items =
      group.status === "removed"
        ? beforePayload?.quote_items ?? []
        : afterPayload?.quote_items ?? [];
    const cards =
      group.status === "removed"
        ? beforePayload?.cards ?? []
        : afterPayload?.cards ?? [];

    for (const item of items) {
      if (findCardIdForQuoteItem(item, cards) !== group.cardId) continue;
      group.changes.push(quoteLineForCard(item));
    }

    const hvMap = unpackQuoteCardHv(
      (group.status === "removed"
        ? beforePayload?.order
        : afterPayload?.order
      )?.quote_bulk_counts
    );
    const hv = hvMap[group.cardId];
    if (hv?.amount_dollars) {
      group.changes.push(
        `High-value fee: ${formatMoney(Number(hv.amount_dollars))}`
      );
    }
  }

  // On newly added cards, drop redundant "Added:" prefixes — the card box is already "New".
  for (const group of cardGroupsMap.values()) {
    if (group.status !== "added") continue;
    group.changes = group.changes.map((line) => {
      if (line.startsWith("Added: ")) return line.slice(7);
      if (line.startsWith("Added ")) return line.slice(6);
      return line;
    });
  }

  // On removed cards, soften quote line labels.
  for (const group of cardGroupsMap.values()) {
    if (group.status !== "removed") continue;
    group.changes = group.changes.map((line) => {
      if (line.startsWith("Removed: ")) return line.slice(9);
      if (line.startsWith("Removed ")) return line.slice(8);
      return line;
    });
  }

  const cardGroups = [...cardGroupsMap.values()]
    .filter((group) => group.status === "added" || group.status === "removed" || group.changes.length > 0)
    .sort((a, b) => a.sortIndex - b.sortIndex);

  // Order section: status (above), adjustments (above), and total change only.
  let quoteSummary = null;
  if (quoteFingerprint(beforePayload) !== quoteFingerprint(afterPayload)) {
    const beforeTotal = quoteTotalFromPayload(beforePayload);
    const afterTotal = quoteTotalFromPayload(afterPayload);
    if (beforeTotal !== afterTotal) {
      quoteSummary = `Quote total: ${formatMoney(beforeTotal)} → ${formatMoney(afterTotal)}`;
      const alreadyListed = orderChanges.some((line) =>
        String(line).startsWith("Quote total")
      );
      if (!alreadyListed) {
        orderChanges.unshift(quoteSummary);
      }
    }
  }

  const text = formatOrderChangelogText({ cardGroups, orderChanges, quoteSummary });
  const hasChangelog =
    cardGroups.length > 0 || orderChanges.length > 0 || Boolean(quoteSummary);

  const changelog = {
    cardGroups,
    orderChanges,
    quoteSummary,
  };

  return {
    ...changelog,
    text,
    hasChangelog,
    summary: summarizeChangelog(changelog),
  };
}

/**
 * Short customer-facing subject. Up to two phrases join with " + ";
 * more than that becomes a single "multiple changes" line.
 * @param {{ cardGroups?: CardChangelogGroup[], orderChanges?: string[], quoteSummary?: string | null }} changelog
 */
export function summarizeChangelog(changelog = {}) {
  const phrases = [];
  const cardGroups = changelog.cardGroups ?? [];
  const orderChanges = changelog.orderChanges ?? [];
  const quoteSummary = changelog.quoteSummary ?? null;

  const orderStatusLine = orderChanges.find((line) =>
    String(line).startsWith("Status:")
  );
  if (orderStatusLine) {
    const toLabel = String(orderStatusLine).split("→").pop()?.trim();
    if (toLabel) {
      phrases.push(`Your order is now ${toLabel.toLowerCase()}`);
    }
  }

  const added = cardGroups.filter((g) => g.status === "added").length;
  const removed = cardGroups.filter((g) => g.status === "removed").length;
  if (added === 1) phrases.push("A new card has been added");
  else if (added > 1) phrases.push("New cards have been added");
  if (removed === 1) phrases.push("A card has been removed");
  else if (removed > 1) phrases.push("Cards have been removed");

  let completedCards = 0;
  let inProgressCards = 0;
  let otherCardStatus = 0;
  for (const group of cardGroups) {
    if (group.status !== "modified") continue;
    for (const line of group.changes ?? []) {
      if (!String(line).startsWith("Status:")) continue;
      const toLabel = String(line).split("→").pop()?.trim()?.toLowerCase();
      if (toLabel === "completed") completedCards += 1;
      else if (toLabel === "in progress") inProgressCards += 1;
      else otherCardStatus += 1;
    }
  }
  if (completedCards === 1) phrases.push("Your card has been completed");
  else if (completedCards > 1) phrases.push("Your cards have been completed");
  if (inProgressCards >= 1) {
    phrases.push(
      inProgressCards === 1
        ? "Your card is now in progress"
        : "Your cards are now in progress"
    );
  }
  if (otherCardStatus >= 1 && completedCards === 0 && inProgressCards === 0) {
    phrases.push(
      otherCardStatus === 1
        ? "A card status has been updated"
        : "Card statuses have been updated"
    );
  }

  const quoteTouched =
    Boolean(quoteSummary) ||
    orderChanges.some((line) => !String(line).startsWith("Status:")) ||
    cardGroups.some((g) =>
      (g.changes ?? []).some((line) => !String(line).startsWith("Status:"))
    );
  if (quoteTouched) {
    phrases.push("Your order quote has been updated");
  }

  if (phrases.length === 0 && (cardGroups.length > 0 || orderChanges.length > 0)) {
    phrases.push("Your order has been updated");
  }

  if (phrases.length > 2) {
    return "Your order has multiple changes";
  }
  return phrases.join(" + ");
}

export function formatOrderChangelogText({
  cardGroups = [],
  orderChanges = [],
  quoteSummary = null,
} = {}) {
  if (!cardGroups.length && !orderChanges.length && !quoteSummary) return "";
  const lines = [];
  const quoteInOrder = orderChanges.some((line) =>
    String(line).startsWith("Quote total")
  );
  if (quoteSummary && !quoteInOrder) lines.push(quoteSummary, "");

  if (orderChanges.length) {
    lines.push("Order");
    for (const change of orderChanges) {
      lines.push(`  - ${change}`);
    }
    lines.push("");
  }

  for (const group of cardGroups) {
    lines.push(group.label);
    if (group.status === "added") lines.push("  (New card)");
    if (group.status === "removed") lines.push("  (Removed)");
    if (group.status === "modified") lines.push("  (Updated)");
    for (const change of group.changes) {
      lines.push(`  - ${change}`);
    }
    lines.push("");
  }

  while (lines[lines.length - 1] === "") lines.pop();
  return `Updates on your order:\n\n${lines.join("\n")}`;
}

export function buildCustomerMessageBody({
  message = "",
  attachChangelog = false,
  changelogText = "",
} = {}) {
  const note = String(message ?? "").trim();
  const changelog = attachChangelog ? String(changelogText ?? "").trim() : "";
  if (note && changelog) return `${note}\n\n${changelog}`;
  if (note) return note;
  if (changelog) return changelog;
  return "";
}
