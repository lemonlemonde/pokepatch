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
    if (action === "added") return `Subtracted discount ${amount}`;
    if (action === "removed") return `Removed discount ${amount}`;
    return `Discount ${formatAdjustmentAmount(before, subtotal)} → ${formatAdjustmentAmount(after, subtotal)}`;
  }

  const label = adjustmentKindLabel(kind).toLowerCase();
  if (action === "added") return `Added ${label} ${amount}`;
  if (action === "removed") return `Removed ${label} ${amount}`;
  return `${adjustmentKindLabel(kind)} ${formatAdjustmentAmount(before, subtotal)} → ${formatAdjustmentAmount(after, subtotal)}`;
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

/**
 * Build customer-facing changelog grouped by card.
 * @returns {{ cardGroups: CardChangelogGroup[], orderChanges: string[], quoteSummary: string | null, text: string, hasChangelog: boolean }}
 */
export function buildOrderChangelog({ beforePayload, afterPayload } = {}) {
  const beforeCards = indexById(beforePayload?.cards);
  const afterCards = indexById(afterPayload?.cards);
  const cardGroupsMap = new Map();
  const orderChanges = [];

  function ensureCardGroup(cardId) {
    let group = cardGroupsMap.get(cardId);
    if (!group) {
      group = {
        cardId,
        label: cardTitleForId(cardId, beforeCards, afterCards),
        status: cardStatus(cardId, beforeCards, afterCards),
        sortIndex: cardSortIndex(cardId, afterCards, beforeCards),
        changes: [],
      };
      cardGroupsMap.set(cardId, group);
    }
    return group;
  }

  const allCards = (afterPayload?.cards ?? beforePayload?.cards ?? []).map(
    (card) => ({ ...card, id: String(card.id) })
  );

  // Cards added or removed always get a box.
  for (const cardId of new Set([...beforeCards.keys(), ...afterCards.keys()])) {
    const status = cardStatus(cardId, beforeCards, afterCards);
    if (status === "added" || status === "removed") {
      ensureCardGroup(cardId);
    }
  }

  const beforeItems = indexById(beforePayload?.quote_items);
  const afterItems = indexById(afterPayload?.quote_items);
  const quoteSubtotal = quoteItemsSubtotal(
    afterPayload?.quote_items ?? beforePayload?.quote_items ?? []
  );

  for (const itemId of new Set([...beforeItems.keys(), ...afterItems.keys()])) {
    const before = beforeItems.get(itemId)?.row;
    const after = afterItems.get(itemId)?.row;
    const item = after ?? before;
    const cardId = findCardIdForQuoteItem(item, allCards);

    let change = null;
    if (before && !after) {
      change = `Removed ${quoteLineForCard(before)}`;
    } else if (!before && after) {
      change = `Added ${quoteLineForCard(after)}`;
    } else if (quoteLineForCard(before) !== quoteLineForCard(after)) {
      change = `Updated ${quoteLineForCard(before)} → ${quoteLineForCard(after)}`;
    }

    if (!change) continue;

    if (cardId) {
      ensureCardGroup(cardId).changes.push(change);
    } else {
      orderChanges.push(change);
    }
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
          `High-value fee ${formatMoney(Number(afterAmt))}`
        );
      } else if (afterAmt == null || afterAmt === "") {
        group.changes.push("Removed high-value fee");
      } else {
        group.changes.push(
          `High-value fee ${formatMoney(Number(beforeAmt))} → ${formatMoney(Number(afterAmt))}`
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
        `High-value fee ${formatMoney(Number(hv.amount_dollars))}`
      );
    }
  }

  // On newly added cards, drop redundant "Added" prefixes — the card box is already "New".
  for (const group of cardGroupsMap.values()) {
    if (group.status !== "added") continue;
    group.changes = group.changes.map((line) =>
      line.startsWith("Added ") ? line.slice(6) : line
    );
  }

  // On removed cards, soften quote line labels.
  for (const group of cardGroupsMap.values()) {
    if (group.status !== "removed") continue;
    group.changes = group.changes.map((line) =>
      line.startsWith("Removed ") ? line.slice(8) : line
    );
  }

  const cardGroups = [...cardGroupsMap.values()]
    .filter((group) => group.status === "added" || group.status === "removed" || group.changes.length > 0)
    .sort((a, b) => a.sortIndex - b.sortIndex);

  let quoteSummary = null;
  if (quoteFingerprint(beforePayload) !== quoteFingerprint(afterPayload)) {
    const beforeTotal = quoteTotalFromPayload(beforePayload);
    const afterTotal = quoteTotalFromPayload(afterPayload);
    quoteSummary =
      beforeTotal === afterTotal
        ? `Quote total unchanged at ${formatMoney(afterTotal)}`
        : `Quote total ${formatMoney(beforeTotal)} → ${formatMoney(afterTotal)}`;
  }

  const text = formatOrderChangelogText({ cardGroups, orderChanges, quoteSummary });
  const hasChangelog = cardGroups.length > 0 || orderChanges.length > 0;

  return {
    cardGroups,
    orderChanges,
    quoteSummary,
    text,
    hasChangelog,
  };
}

export function formatOrderChangelogText({
  cardGroups = [],
  orderChanges = [],
  quoteSummary = null,
} = {}) {
  if (!cardGroups.length && !orderChanges.length) return "";
  const lines = [];
  if (quoteSummary) lines.push(quoteSummary, "");

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

  if (orderChanges.length) {
    lines.push("Order");
    for (const change of orderChanges) {
      lines.push(`  - ${change}`);
    }
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
