/**
 * Per-card Ultra Pro semi-rigid holder upgrade ("PSA ready").
 * Default is a regular hard top loader (included). Mixed holders stay
 * on one order — unlike queue speed, this does not split.
 */

export const PSA_READY_FEE = 2;
export const PSA_READY_LABEL = "PSA ready";
export const HOLDER_STANDARD_LABEL = "Hard top loader";

export const HOLDER_STANDARD_HINT =
  "Returned in a regular hard top loader. Included.";

export const PSA_READY_HINT =
  "Upgraded Ultra Pro semi-rigid card holder, sleeved and ready to hand to PSA as-is.";

export const SHIPPING_COST_COPY =
  "Shipping is $12. Cards come back in a hard top loader (included), or a PSA-ready Ultra Pro semi-rigid holder if you choose that upgrade.";

export function psaReadyControlClass(isReady) {
  return isReady
    ? "border-sky/50 bg-sky/20 text-ink"
    : "border-ink/15 bg-ink/[0.04] text-ink/40";
}

function isCanceledStatus(status) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  return s === "canceled" || s === "cancelled";
}

export function cardIsPsaReady(card) {
  if (!card) return false;
  const value = card.is_psa_ready ?? card.isPsaReady;
  return value === true || value === "true" || value === 1 || value === "1";
}

export function psaReadyHolderLabel(isReady) {
  return isReady ? PSA_READY_LABEL : HOLDER_STANDARD_LABEL;
}

function adjustmentDescription(row) {
  return String(row?.description ?? "")
    .trim()
    .toLowerCase();
}

export function isPsaReadyAdjustmentRow(row) {
  const description = adjustmentDescription(row);
  return description === "psa ready" || description === "psa-ready";
}

function psaReadyCountFromCards(cards) {
  let count = 0;
  for (const card of cards ?? []) {
    if (isCanceledStatus(card?.status)) continue;
    if (cardIsPsaReady(card)) count += 1;
  }
  return count;
}

export function psaReadyFeeFromCards(cards) {
  return Math.round(psaReadyCountFromCards(cards) * PSA_READY_FEE * 100) / 100;
}

function psaReadyDescription(count) {
  const n = Math.floor(Number(count));
  const cardCount = Number.isFinite(n) && n > 0 ? n : 0;
  if (cardCount <= 1) {
    return `${PSA_READY_LABEL} ($${PSA_READY_FEE} per card)`;
  }
  return `${PSA_READY_LABEL} (${cardCount} × $${PSA_READY_FEE})`;
}

/**
 * Live fee from cards when a card list is present; otherwise the stored
 * quote_bulk_counts adjustment (list views without cards).
 */
function resolvePsaReadyFee({ cards = null, adjustments = null } = {}) {
  if (Array.isArray(cards)) {
    const count = psaReadyCountFromCards(cards);
    return {
      count,
      amount: Math.round(count * PSA_READY_FEE * 100) / 100,
    };
  }
  const row = (adjustments ?? []).find((entry) => isPsaReadyAdjustmentRow(entry));
  if (!row) return { count: 0, amount: 0 };
  const amount = Math.abs(Number(row.amount_dollars) || 0);
  return {
    count: amount > 0 ? Math.round(amount / PSA_READY_FEE) : 0,
    amount: Math.round(amount * 100) / 100,
  };
}

export function psaReadyFeeRows(params) {
  const { count, amount } = resolvePsaReadyFee(params);
  if (!(amount > 0)) return [];
  return [
    {
      description: psaReadyDescription(count),
      amount,
      count,
    },
  ];
}

export function marketingPsaReadyPanel() {
  return {
    title: PSA_READY_LABEL,
    features: [
      "Ultra Pro semi-rigid card holder",
      "Sleeved and ready to submit to PSA",
    ],
    bulk: [{ label: "Per card", value: `+$${PSA_READY_FEE}` }],
    bulkLabel: "Pricing",
  };
}

export function psaReadyFaqEntry() {
  return {
    question: "What does PSA ready mean?",
    answer: `By default we return each card in a regular hard top loader, included. Choose ${PSA_READY_LABEL} and we'll sleeve that card in an Ultra Pro semi-rigid card holder so you can hand it to PSA without extra prep. That's $${PSA_READY_FEE} per card.`,
  };
}
