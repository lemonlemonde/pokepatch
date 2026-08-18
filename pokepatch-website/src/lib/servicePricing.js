/**
 * Single source of truth for PokePatch pricing.
 *
 * Per-card list rates, bulk discounts, and high-value surcharges all live here.
 * Homepage marketing cards, admin quote defaults, HV auto-fill, and receipt math
 * read from these constants — update prices here only.
 */

export const SERVICE_KEYS = {
  SURFACE: "surface_restoration",
  PRESSING: "precision_pressing",
  ADVANCED: "advanced_restoration",
  WHITENING: "card_whitening",
  SLAB: "slab_cracking",
  CUSTOM: "custom",
};

const SERVICE_UNIT = "/ card";

/**
 * Shared risk copy for Card Whitening (homepage, quote form, admin).
 * Keep in sync with FAQ wording on the homepage.
 */
export const CARD_WHITENING_WARNING =
  "Only for very small whitening dots on edges and corners. Grading companies like PSA may potentially detect added ink and mark the card as altered.";

/** Services that can appear on a quote line (excludes marketing-only cards). */
export const QUOTE_SERVICES = [
  {
    key: SERVICE_KEYS.SURFACE,
    title: "Surface Cleaning",
    listPrice: 15,
    features: ["Dirt", "Scratches"],
    accent: "ink",
  },
  {
    key: SERVICE_KEYS.PRESSING,
    title: "Minor Damage",
    listPrice: 30,
    features: ["Bends", "Warping", "Minor edge lift"],
    accent: "lavender",
  },
  {
    key: SERVICE_KEYS.ADVANCED,
    title: "Major Damage",
    listPrice: 50,
    priceSuffix: "+",
    features: ["Creases", "Dents", "Edge peeling", "Water damage"],
    accent: "peach",
  },
  {
    key: SERVICE_KEYS.WHITENING,
    title: "Card Whitening",
    listPrice: 25,
    features: [
      "Tiny edge & corner dots only",
      "Not for heavy or widespread whitening",
    ],
    warning: CARD_WHITENING_WARNING,
    accent: "ink",
  },
  {
    key: SERVICE_KEYS.SLAB,
    title: "Slab Cracking",
    listPrice: 10,
    features: [],
    accent: "sky",
  },
  {
    key: SERVICE_KEYS.CUSTOM,
    title: "Custom",
    listPrice: null,
    features: [],
    accent: "mint",
  },
];

/** Format a list rate for display (homepage cards, admin labels). */
export function formatListPrice(listPrice, priceSuffix = "") {
  if (listPrice == null) return null;
  return `$${listPrice}${priceSuffix ?? ""}`;
}

export function servicePriceDisplay(service) {
  if (!service || service.listPrice == null) return null;
  return formatListPrice(service.listPrice, service.priceSuffix ?? "");
}

/** Admin/customer-facing service picker label, e.g. "Surface Cleaning ($15)". */
export function serviceSelectLabel(service) {
  const price = servicePriceDisplay(service);
  return price ? `${service.title} (${price})` : service.title;
}

/** Paid priority service — whole order, not per card. */
export const PRIORITY_BASE_FEE = 25;
export const PRIORITY_EXTRA_CARD_FEE = 10;

/** Dollar fee for priority on an order with `cardCount` cards. */
export function priorityServiceFee(cardCount) {
  const count = Math.max(1, Math.floor(Number(cardCount)) || 1);
  return (
    Math.round(
      (PRIORITY_BASE_FEE +
        Math.max(0, count - 1) * PRIORITY_EXTRA_CARD_FEE) *
        100
    ) / 100
  );
}

export function priorityServiceDescription(cardCount) {
  const count = Math.max(1, Math.floor(Number(cardCount)) || 1);
  if (count <= 1) {
    return `Priority service ($${PRIORITY_BASE_FEE} first card)`;
  }
  const extras = count - 1;
  return `Priority service ($${PRIORITY_BASE_FEE} first card + ${extras} × $${PRIORITY_EXTRA_CARD_FEE})`;
}

/** Customer-facing priority pricing copy (quote form, etc.). */
export function priorityServicePricingHint(cardCount) {
  const count = Math.max(1, Math.floor(Number(cardCount)) || 1);
  const rate = `$${PRIORITY_BASE_FEE} for the first card, plus $${PRIORITY_EXTRA_CARD_FEE} for each additional card`;
  if (count <= 1) {
    return `${rate}.`;
  }
  return `${rate}. ${count} cards: ${formatMoney(priorityServiceFee(count))} total.`;
}

export const PRIORITY_ADJUSTMENT_LABEL = "Priority service";

export function isPriorityAdjustmentRow(row) {
  const normalized = normalizeQuoteAdjustment(row);
  if (!normalized) return false;
  return (
    normalized.description.trim().toLowerCase() ===
    PRIORITY_ADJUSTMENT_LABEL.toLowerCase()
  );
}

export function hasPriorityAdjustment(adjustments) {
  return (adjustments ?? []).some(isPriorityAdjustmentRow);
}

/** Editor/storage row for the order-level priority surcharge. */
export function priorityQuoteAdjustment(cardCount) {
  const fee = priorityServiceFee(cardCount);
  return {
    ...emptyQuoteAdjustment("surcharge"),
    description: PRIORITY_ADJUSTMENT_LABEL,
    amount_dollars: String(fee),
    amount_percent: "",
  };
}

/** Keep priority surcharge row in sync with the order flag and card count. */
export function syncPriorityQuoteAdjustments(
  isPriority,
  cardCount,
  adjustments = []
) {
  const without = (adjustments ?? []).filter((row) => !isPriorityAdjustmentRow(row));
  if (!isPriority) return without;
  return [...without, priorityQuoteAdjustment(cardCount)];
}

/**
 * Order-level bulk discount, applied to the whole order (not per service).
 * Highest matching tier wins.
 */
export const BULK_DISCOUNT_TIERS = [
  { minCards: 10, percent: 7.5 },
  { minCards: 25, percent: 10 },
];

/** Discount % for a card count; 0 when below the first tier. */
export function bulkDiscountPercentForCardCount(cardCount) {
  const count = Math.floor(Number(cardCount));
  if (!Number.isFinite(count)) return 0;
  let percent = 0;
  for (const tier of BULK_DISCOUNT_TIERS) {
    if (count >= tier.minCards) percent = tier.percent;
  }
  return percent;
}

/** Short admin/customer hint for the bulk tiers. */
export const BULK_TIER_RANGES_LABEL = BULK_DISCOUNT_TIERS.map(
  (tier) => `${tier.minCards}+ cards → ${tier.percent}% off`
).join(", ");

/**
 * High-value surcharge tiers from Raw NM market value.
 * Highest matching tier wins; values below the first tier are 0%.
 */
export const HV_SURCHARGE_TIERS = [
  { minValue: 200, maxExclusive: 500, percent: 4 },
  { minValue: 500, maxExclusive: null, percent: 8 },
];

function formatHvTierLabel(tier) {
  if (tier.maxExclusive != null) {
    return `$${tier.minValue}–$${tier.maxExclusive - 1}`;
  }
  return `$${tier.minValue}+`;
}

/** Short admin/customer hint for default HV market-value tiers. */
export const HV_TIER_RANGES_LABEL = HV_SURCHARGE_TIERS.map(
  (tier) => `${formatHvTierLabel(tier)} → ${tier.percent}%`
).join(", ");

function serviceByKey(key) {
  return QUOTE_SERVICES.find((service) => service.key === key) ?? null;
}

/** Accent token for a service key (Custom → mint). */
export function serviceAccent(serviceKey) {
  return serviceByKey(serviceKey)?.accent ?? "mint";
}

/** Quiet form-option shell + soft accent wash (not solid pastel badges). */
const SERVICE_ACCENT_CHIP_STYLES = {
  ink: {
    idle: "border-ink/10 bg-ink/[0.03] text-ink hover:border-ink/35 hover:bg-ink/10",
    selected: "border-ink/45 bg-ink/20 text-ink ring-1 ring-ink/25",
  },
  lavender: {
    idle: "border-ink/10 bg-ink/[0.03] text-ink hover:border-lavender/35 hover:bg-lavender/10",
    selected: "border-lavender/45 bg-lavender/20 text-ink ring-1 ring-lavender/25",
  },
  peach: {
    idle: "border-ink/10 bg-ink/[0.03] text-ink hover:border-peach/40 hover:bg-peach/10",
    selected: "border-peach/50 bg-peach/20 text-ink ring-1 ring-peach/25",
  },
  sky: {
    idle: "border-ink/10 bg-ink/[0.03] text-ink hover:border-sky/40 hover:bg-sky/10",
    selected: "border-sky/50 bg-sky/20 text-ink ring-1 ring-sky/25",
  },
  mint: {
    idle: "border-ink/10 bg-ink/[0.03] text-ink hover:border-mint/35 hover:bg-mint/10",
    selected: "border-mint/45 bg-mint/20 text-ink ring-1 ring-mint/25",
  },
};

/** Soft panel tint for admin expanded quote lines. */
const SERVICE_ACCENT_PANEL_STYLES = {
  ink: "border-ink/30 bg-ink/10",
  lavender: "border-lavender/30 bg-lavender/10",
  peach: "border-peach/35 bg-peach/10",
  sky: "border-sky/35 bg-sky/10",
  mint: "border-mint/30 bg-mint/10",
};

const SERVICE_ACCENT_DOT = {
  ink: "bg-ink",
  lavender: "bg-lavender",
  peach: "bg-peach",
  sky: "bg-sky",
  mint: "bg-mint",
};

export function serviceAccentChipClass(accent, selected = false) {
  const styles =
    SERVICE_ACCENT_CHIP_STYLES[accent] ?? SERVICE_ACCENT_CHIP_STYLES.ink;
  return selected ? styles.selected : styles.idle;
}

export function serviceAccentPanelClass(accent) {
  return SERVICE_ACCENT_PANEL_STYLES[accent] ?? "border-ink/15 bg-night/30";
}

export function serviceAccentDotClass(accent) {
  return SERVICE_ACCENT_DOT[accent] ?? SERVICE_ACCENT_DOT.mint;
}

/** Homepage restoration-tier cards (excludes slab add-on and custom). */
export function marketingServices() {
  return QUOTE_SERVICES.filter(
    (s) => s.key !== SERVICE_KEYS.CUSTOM && s.key !== SERVICE_KEYS.SLAB
  ).map((service) => ({
    title: service.title,
    price: servicePriceDisplay(service),
    unit: SERVICE_UNIT,
    features: service.features,
    featuresLabel: "Includes",
    warning: service.warning ?? null,
  }));
}

function slabMarketingPanel() {
  const service = QUOTE_SERVICES.find((s) => s.key === SERVICE_KEYS.SLAB);
  if (!service) return null;
  return {
    title: service.title,
    features: [],
    bulk: [
      {
        label: "Per card",
        value: formatListPrice(service.listPrice, service.priceSuffix ?? ""),
      },
    ],
    bulkLabel: "Pricing",
  };
}

const PRIORITY_PRICING_MARKETING = {
  title: "Priority",
  features: ["Faster queue for your order"],
  bulk: [
    { label: "First card", value: `$${PRIORITY_BASE_FEE}` },
    { label: "Each additional card", value: `+$${PRIORITY_EXTRA_CARD_FEE}` },
  ],
  bulkLabel: "Pricing",
};

const BULK_PRICING_MARKETING = {
  title: "Bulk discount",
  features: ["Off the whole order"],
  bulk: BULK_DISCOUNT_TIERS.map((tier) => ({
    label: `${tier.minCards}+ cards`,
    value: `${tier.percent}% off`,
  })),
  bulkLabel: "Discounts",
};

/** Homepage extras — purchasable options only. */
export function marketingExtras() {
  return [
    slabMarketingPanel(),
    PRIORITY_PRICING_MARKETING,
    BULK_PRICING_MARKETING,
  ].filter(Boolean);
}

/** Homepage high-value fee module — same visual weight as extras. */
export function marketingHighValue() {
  return {
    title: "High-Value Handling",
    features: ["Extra fee on higher-value cards, based on market price"],
    bulk: HV_SURCHARGE_TIERS.map((tier) => ({
      label: formatHvTierLabel(tier),
      value: `+${tier.percent}%`,
    })),
    bulkLabel: "Fee by card value",
  };
}

export function defaultBaseAmount(serviceKey) {
  const service = serviceByKey(serviceKey);
  return service?.listPrice ?? null;
}

export function defaultServiceLabel(serviceKey) {
  const service = serviceByKey(serviceKey);
  if (!service || service.key === SERVICE_KEYS.CUSTOM) return "";
  return service.title;
}

export function highValueSurchargeFromValue(cardValue, percent) {
  const value = Number(cardValue);
  const pct = Number(percent);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(pct) || pct <= 0) {
    return null;
  }
  return Math.round(value * (pct / 100) * 100) / 100;
}

/** HV surcharge % from Raw NM market value; 0 when below the first tier. */
export function hvPercentFromMarketValue(marketValue) {
  const value = Number(marketValue);
  if (!Number.isFinite(value)) return 0;
  let percent = 0;
  for (const tier of HV_SURCHARGE_TIERS) {
    if (
      value >= tier.minValue &&
      (tier.maxExclusive == null || value < tier.maxExclusive)
    ) {
      percent = tier.percent;
    }
  }
  return percent;
}

/** Dollar HV from market value using tier percent; null when 0% or invalid. */
export function hvSurchargeFromMarketValue(marketValue) {
  const percent = hvPercentFromMarketValue(marketValue);
  if (percent <= 0) return null;
  return highValueSurchargeFromValue(marketValue, percent);
}

export function formatMoney(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function parseMoneyInput(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCardKey(name, setName) {
  return `${(name || "").trim().toLowerCase()}|${(setName || "").trim().toLowerCase()}`;
}

/** True when a card is canceled and must not contribute to quote totals. */
export function cardIsCanceledForQuote(card) {
  const status = String(card?.status ?? "")
    .trim()
    .toLowerCase();
  return status === "canceled" || status === "cancelled";
}

/** Cards that still count toward quote totals / priority card count. */
export function billableQuoteCards(cards = []) {
  return (cards ?? []).filter((card) => !cardIsCanceledForQuote(card));
}

/**
 * Drop quote lines that belong to canceled cards (by card_pick id, else name/set).
 * When `cards` is empty/unknown, returns items unchanged.
 */
export function billableQuoteItems(items = [], cards = []) {
  const list = items ?? [];
  const cardList = cards ?? [];
  if (cardList.length === 0) return list;

  const canceledById = new Set();
  const canceledByKey = new Set();
  for (const card of cardList) {
    if (!cardIsCanceledForQuote(card)) continue;
    if (card.id != null && String(card.id) !== "") {
      canceledById.add(String(card.id));
    }
    const key = normalizeCardKey(card.card_name, card.set_name);
    if (key !== "|") canceledByKey.add(key);
  }
  if (canceledById.size === 0 && canceledByKey.size === 0) return list;

  return list.filter((item) => {
    if (item?.card_pick && item.card_pick !== "custom") {
      return !canceledById.has(String(item.card_pick));
    }
    const key = normalizeCardKey(item?.card_name, item?.set_name);
    if (key !== "|" && canceledByKey.has(key)) return false;
    return true;
  });
}

export function quoteItemsSubtotal(items) {
  let sum = 0;
  for (const item of items ?? []) {
    sum += Number(item.quote_base_amount) || 0;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Card-level HV dollar amount from an explicit quote HV entry on the card
 * (`hv_amount`), not auto-derived unless that entry exists.
 */
export function quoteCardHvAmount(card) {
  if (!card) return 0;
  if (card.hv_amount == null || card.hv_amount === "") return 0;
  const n = Number(card.hv_amount);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

export function quoteCardsHvTotal(cards = []) {
  return Math.round(
    (cards ?? []).reduce((sum, card) => sum + quoteCardHvAmount(card), 0) * 100
  ) / 100;
}

/** Normalize one stored card HV row from quote_bulk_counts.card_hv. */
export function normalizeCardHvEntry(row) {
  if (!row || typeof row !== "object") return null;
  const card_id = row.card_id != null ? String(row.card_id) : "";
  if (!card_id) return null;
  const percent =
    row.percent === "" || row.percent == null
      ? null
      : Number.isFinite(Number(row.percent))
        ? Math.abs(Number(row.percent))
        : null;
  const amount_dollars =
    row.amount_dollars === "" || row.amount_dollars == null
      ? null
      : Number.isFinite(Number(row.amount_dollars))
        ? Math.abs(Number(row.amount_dollars))
        : null;
  if (amount_dollars == null || amount_dollars <= 0) return null;
  return { card_id, percent, amount_dollars };
}

const ADJUSTMENT_KINDS = new Set([
  // Generic signed adjustment (admin UI).
  "adjustment",
  // Legacy kinds — still read from stored rows.
  "discount",
  "delivery",
  "shipping",
  "surcharge",
]);

const ADJUSTMENT_KIND_LABELS = {
  adjustment: "Adjustment",
  discount: "Discount",
  delivery: "Delivery",
  shipping: "Shipping",
  surcharge: "Surcharge",
};

export function adjustmentKindLabel(kind) {
  return ADJUSTMENT_KIND_LABELS[kind] ?? "Adjustment";
}

function newAdjustmentId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `adj-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyQuoteAdjustment(kind = "adjustment") {
  return {
    id: newAdjustmentId(),
    kind: ADJUSTMENT_KINDS.has(kind) ? kind : "adjustment",
    description: "",
    amount_dollars: "",
    amount_percent: "",
  };
}

export function percentToDollars(percent, subtotal) {
  const pct = Math.abs(Number(percent));
  const base = Number(subtotal);
  if (!Number.isFinite(pct) || !Number.isFinite(base) || base < 0) {
    return null;
  }
  return Math.round(base * (pct / 100) * 100) / 100;
}

/**
 * Normalize one editor/storage adjustment row.
 * amount_dollars is signed (negative = credit/discount). Legacy rows stored
 * absolute $ with kind "discount"; those are converted to a negative amount.
 */
export function normalizeQuoteAdjustment(row) {
  if (!row || typeof row !== "object") return null;
  const kind = ADJUSTMENT_KINDS.has(row.kind) ? row.kind : "adjustment";
  const description =
    row.description != null ? String(row.description).trim() : "";
  const dollarsRaw = row.amount_dollars;
  const percentRaw = row.amount_percent;
  let dollars =
    dollarsRaw === "" || dollarsRaw == null
      ? null
      : Number.isFinite(Number(dollarsRaw))
        ? Number(dollarsRaw)
        : null;
  if (dollars != null && dollars !== 0 && dollars > 0 && kind === "discount") {
    // Legacy abs storage + discount kind → signed negative.
    dollars = -dollars;
  }
  const percent =
    percentRaw === "" || percentRaw == null
      ? null
      : Number.isFinite(Number(percentRaw))
        ? Math.abs(Number(percentRaw))
        : null;
  return {
    id: row.id != null ? String(row.id) : newAdjustmentId(),
    kind,
    description,
    amount_dollars: dollars,
    amount_percent: percent,
  };
}

export function quoteAdjustmentHasContent(row) {
  const normalized = normalizeQuoteAdjustment(row);
  if (!normalized) return false;
  if (normalized.description) return true;
  if (normalized.amount_dollars != null && normalized.amount_dollars !== 0) {
    return true;
  }
  if (normalized.amount_percent != null && normalized.amount_percent > 0) {
    return true;
  }
  return false;
}

/** Signed $ applied to the total (negative reduces the quote). */
export function quoteAdjustmentSignedAmount(row, subtotal = null) {
  const normalized = normalizeQuoteAdjustment(row);
  if (!normalized) return 0;
  let dollars = normalized.amount_dollars;
  if (
    (dollars == null || dollars === 0) &&
    normalized.amount_percent != null &&
    subtotal != null
  ) {
    const fromPercent =
      percentToDollars(normalized.amount_percent, subtotal) ?? 0;
    // Legacy percent rows used kind to encode sign.
    dollars =
      normalized.kind === "discount" ? -fromPercent : fromPercent;
  }
  if (dollars == null || !Number.isFinite(dollars) || dollars === 0) return 0;
  return Math.round(dollars * 100) / 100;
}

export function quoteAdjustmentsTotal(adjustments, items = []) {
  const subtotal = quoteItemsSubtotal(items);
  return Math.round(
    (adjustments ?? []).reduce(
      (sum, row) => sum + quoteAdjustmentSignedAmount(row, subtotal),
      0
    ) * 100
  ) / 100;
}

/** Receipt-ready rows with non-zero signed amounts. */
export function quoteAdjustmentLines(adjustments, items = []) {
  const subtotal = quoteItemsSubtotal(items);
  const lines = [];
  for (const row of adjustments ?? []) {
    const normalized = normalizeQuoteAdjustment(row);
    if (!normalized) continue;
    const signed = quoteAdjustmentSignedAmount(normalized, subtotal);
    if (signed === 0 && !normalized.description) continue;
    if (signed === 0) continue;
    lines.push({
      id: normalized.id,
      kind: normalized.kind,
      description:
        normalized.description || adjustmentKindLabel(normalized.kind),
      amount: signed,
      amountDollars: Math.abs(signed),
      amountPercent: normalized.amount_percent,
    });
  }
  return lines;
}

/**
 * Persist shape stored in orders.quote_bulk_counts (jsonb object).
 * New format: { version: 2, adjustments: [...], card_hv: [...] }
 * Legacy format: { service_key: { count, per_card_off, enabled } }
 */
export function packQuoteAdjustments(adjustments, cardHv = null) {
  const rows = (adjustments ?? [])
    .map((row) => normalizeQuoteAdjustment(row))
    .filter((row) => row && quoteAdjustmentHasContent(row))
    .map((row) => ({
      id: row.id,
      kind: isPriorityAdjustmentRow(row) ? "surcharge" : "adjustment",
      description: row.description,
      amount_dollars: row.amount_dollars,
      amount_percent: row.amount_percent,
    }));

  const hvRows = [];
  if (cardHv && typeof cardHv === "object" && !Array.isArray(cardHv)) {
    for (const [card_id, entry] of Object.entries(cardHv)) {
      const normalized = normalizeCardHvEntry({
        card_id,
        percent: entry?.percent,
        amount_dollars: entry?.amount_dollars,
      });
      if (normalized) hvRows.push(normalized);
    }
  }

  if (rows.length === 0 && hvRows.length === 0) return null;
  return {
    version: 2,
    adjustments: rows,
    ...(hvRows.length > 0 ? { card_hv: hvRows } : {}),
  };
}

/** Editor map: cardId → { percent, amount_dollars } as strings. */
export function unpackQuoteCardHv(stored) {
  if (
    !stored ||
    typeof stored !== "object" ||
    Array.isArray(stored) ||
    stored.version !== 2 ||
    !Array.isArray(stored.card_hv)
  ) {
    return {};
  }
  const out = {};
  for (const row of stored.card_hv) {
    const normalized = normalizeCardHvEntry(row);
    if (!normalized) continue;
    out[normalized.card_id] = {
      percent:
        normalized.percent != null ? String(normalized.percent) : "",
      amount_dollars: String(normalized.amount_dollars),
    };
  }
  return out;
}

/** Attach quote HV fields onto cards for receipt/total helpers. */
export function cardsWithQuoteHv(cards = [], cardHv = {}) {
  return (cards ?? []).map((card) => {
    const entry = cardHv?.[String(card.id)];
    if (!entry) return { ...card, hv_percent: null, hv_amount: null };
    return {
      ...card,
      hv_percent:
        entry.percent === "" || entry.percent == null
          ? null
          : Number(entry.percent),
      hv_amount:
        entry.amount_dollars === "" || entry.amount_dollars == null
          ? null
          : Number(entry.amount_dollars),
    };
  });
}

function legacyBulkEntry(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const count = Math.max(0, Math.floor(Number(value.count) || 0));
    const per_card_off = Number(value.per_card_off) || 0;
    const enabled = value.enabled !== false;
    return { count, per_card_off, enabled };
  }
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return { count, per_card_off: 0, enabled: true };
}

/** Convert legacy per-service bulk map into adjustment rows. */
export function legacyBulkToAdjustments(bulkCalcs) {
  if (!bulkCalcs || typeof bulkCalcs !== "object" || Array.isArray(bulkCalcs)) {
    return [];
  }
  if (bulkCalcs.version === 2) return [];
  const rows = [];
  for (const service of QUOTE_SERVICES) {
    if (service.key === SERVICE_KEYS.CUSTOM) continue;
    const entry = legacyBulkEntry(bulkCalcs[service.key]);
    if (!entry.enabled || entry.count <= 0 || entry.per_card_off <= 0) {
      continue;
    }
    const total =
      Math.round(entry.count * entry.per_card_off * 100) / 100;
    if (total <= 0) continue;
    rows.push({
      id: newAdjustmentId(),
      kind: "discount",
      description: `${service.title} bulk (${entry.count} × $${Number(
        entry.per_card_off
      ).toFixed(2)}/card)`,
      amount_dollars: total,
      amount_percent: null,
    });
  }
  return rows;
}

export function legacyOverrideToAdjustment(label, amount) {
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const n = Number(amount);
  if (n === 0) return null;
  const text = label != null ? String(label).trim() : "";
  return {
    id: newAdjustmentId(),
    kind: n >= 0 ? "surcharge" : "discount",
    description: text || (n >= 0 ? "Surcharge" : "Discount"),
    amount_dollars: Math.abs(n),
    amount_percent: null,
  };
}

/**
 * Load adjustments from stored quote_bulk_counts (+ optional legacy override).
 * Returns editor-ready rows (string money fields).
 */
export function unpackQuoteAdjustments(
  stored,
  { overrideLabel = "", overrideAmount = null } = {}
) {
  const fromOverride = legacyOverrideToAdjustment(
    overrideLabel,
    overrideAmount
  );
  let rows = [];

  if (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored) &&
    stored.version === 2
  ) {
    rows = (Array.isArray(stored.adjustments) ? stored.adjustments : [])
      .map((row) => normalizeQuoteAdjustment(row))
      .filter(Boolean);
    // Only fold leftover override columns when v2 payload is empty.
    if (rows.length === 0 && fromOverride) {
      rows = [normalizeQuoteAdjustment(fromOverride)];
    }
  } else if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    rows = legacyBulkToAdjustments(stored)
      .map((row) => normalizeQuoteAdjustment(row))
      .filter(Boolean);
    if (fromOverride) {
      rows = [...rows, normalizeQuoteAdjustment(fromOverride)];
    }
  } else if (fromOverride) {
    rows = [normalizeQuoteAdjustment(fromOverride)];
  }

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    description: row.description,
    amount_dollars:
      row.amount_dollars != null ? String(row.amount_dollars) : "",
    amount_percent:
      row.amount_percent != null ? String(row.amount_percent) : "",
  }));
}

export function computeQuoteTotal({
  items,
  cards = null,
  adjustments = null,
  isPriority = false,
  cardCount = null,
} = {}) {
  const billableCards = billableQuoteCards(cards);
  const billableItems = billableQuoteItems(items, cards);
  const subtotal = quoteItemsSubtotal(billableItems);
  const cardHv = quoteCardsHvTotal(billableCards);
  const adjustmentTotal = quoteAdjustmentsTotal(adjustments, billableItems);
  // Prefer live card list (canceled excluded) over a stale cardCount hint.
  const count =
    Array.isArray(cards) && cards.length > 0
      ? billableCards.length
      : cardCount ?? null;
  const priorityFee =
    isPriority &&
    count != null &&
    !hasPriorityAdjustment(adjustments)
      ? priorityServiceFee(count)
      : 0;
  return (
    Math.round((subtotal + cardHv + adjustmentTotal + priorityFee) * 100) / 100
  );
}

/**
 * Quote total from stored order fields (list rows or full order graphs).
 * Uses quote_items + quote_bulk_counts (+ legacy override columns).
 * When `order.cards` include status, canceled cards are excluded from the total.
 */
export function orderQuoteTotalFromStored(order) {
  if (!order) return 0;
  const items = order.quote_items ?? [];
  const adjustments = unpackQuoteAdjustments(order.quote_bulk_counts, {
    overrideLabel: order.quote_override_label ?? "",
    overrideAmount: order.quote_override_amount,
  });
  const cardHvMap = unpackQuoteCardHv(order.quote_bulk_counts);
  const baseCards =
    Array.isArray(order.cards) && order.cards.length > 0
      ? order.cards
      : Object.keys(cardHvMap).map((id) => ({ id }));
  const cards = cardsWithQuoteHv(baseCards, cardHvMap);
  const cardCount = Array.isArray(order.cards)
    ? billableQuoteCards(order.cards).length
    : (order.card_count ?? null);
  return computeQuoteTotal({
    items,
    cards,
    adjustments,
    isPriority: Boolean(order.is_priority),
    cardCount,
  });
}

function newAdminLedgerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Empty after-completion / restoration-cost row for the admin order editor. */
export function emptyAdminLedgerEntry() {
  return {
    id: newAdminLedgerId(),
    description: "",
    amount_dollars: "",
  };
}

/** Normalize one admin ledger row (after-completion or restoration costs). */
export function normalizeAdminLedgerEntry(row) {
  if (!row || typeof row !== "object") return null;
  const description =
    row.description != null ? String(row.description).trim() : "";
  const dollarsRaw = row.amount_dollars;
  const dollars =
    dollarsRaw === "" || dollarsRaw == null
      ? null
      : Number.isFinite(Number(dollarsRaw))
        ? Number(dollarsRaw)
        : null;
  return {
    id: row.id != null ? String(row.id) : newAdminLedgerId(),
    description,
    amount_dollars: dollars,
  };
}

function adminLedgerEntryHasContent(row) {
  if (!row) return false;
  if ((row.description ?? "").trim()) return true;
  return row.amount_dollars != null && row.amount_dollars !== 0;
}

/** Persist after-completion / restoration costs as a jsonb array. */
export function packAdminLedger(rows) {
  return (rows ?? [])
    .map((row) => normalizeAdminLedgerEntry(row))
    .filter((row) => row && adminLedgerEntryHasContent(row))
    .map((row) => ({
      id: row.id,
      description: row.description,
      amount_dollars: row.amount_dollars,
    }));
}

/** Load after-completion / restoration costs into editor string fields. */
export function unpackAdminLedger(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((row) => normalizeAdminLedgerEntry(row))
    .filter(Boolean)
    .map((row) => ({
      id: row.id,
      description: row.description,
      amount_dollars:
        row.amount_dollars != null ? String(row.amount_dollars) : "",
    }));
}

export function adminLedgerTotal(rows) {
  return (
    Math.round(
      (rows ?? []).reduce((sum, row) => {
        const normalized = normalizeAdminLedgerEntry(row);
        const amount = normalized?.amount_dollars;
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0) * 100
    ) / 100
  );
}

/**
 * Money earned for admin totals: quote + after-completion − restoration spend.
 * After-completion / spend never affect the customer quote.
 */
export function orderEarnedTotalFromStored(order) {
  const quote = orderQuoteTotalFromStored(order);
  const afterCompletion = adminLedgerTotal(order?.after_completion_amounts);
  const costs = adminLedgerTotal(order?.restoration_costs);
  return Math.round((quote + afterCompletion - costs) * 100) / 100;
}

export function hasQuoteData({
  items,
  cards = null,
  adjustments = null,
  isPriority = false,
} = {}) {
  const billableItems = billableQuoteItems(items, cards);
  const billableCards = billableQuoteCards(cards);
  if (billableItems.length > 0) return true;
  if (quoteCardsHvTotal(billableCards) > 0) return true;
  if (quoteAdjustmentLines(adjustments, billableItems).length > 0) return true;
  if (isPriority) return true;
  return false;
}

export function quoteItemCardLabel(item) {
  const name = (item?.card_name || "").trim() || "Card";
  const set = (item?.set_name || "").trim();
  return set ? `${name} (${set})` : name;
}

export function quoteItemLineTotal(item) {
  return Math.round((Number(item?.quote_base_amount) || 0) * 100) / 100;
}

/** Group quote lines by card name/set, preserving first-seen order.
 * Canceled cards are omitted (their amounts are excluded from the quote).
 */
export function groupQuoteItemsByCard(items = [], cards = []) {
  const billableItems = billableQuoteItems(items, cards);
  const billableCards = billableQuoteCards(cards);
  const cardByKey = new Map(
    billableCards.map((card) => [
      normalizeCardKey(card.card_name, card.set_name),
      card,
    ])
  );
  const groups = [];
  const indexByKey = new Map();
  for (const item of billableItems) {
    const key = normalizeCardKey(item?.card_name, item?.set_name);
    let group = indexByKey.get(key);
    if (!group) {
      const card = cardByKey.get(key) ?? null;
      const highValueSurcharge = quoteCardHvAmount(card);
      group = {
        key,
        label: quoteItemCardLabel(item),
        items: [],
        servicesSubtotal: 0,
        highValueSurcharge,
        subtotal: highValueSurcharge,
        card,
      };
      indexByKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
    group.servicesSubtotal =
      Math.round((group.servicesSubtotal + quoteItemLineTotal(item)) * 100) /
      100;
    group.subtotal =
      Math.round((group.servicesSubtotal + group.highValueSurcharge) * 100) /
      100;
  }

  // Cards with HV but no quote services still need a receipt row.
  for (const card of billableCards) {
    const key = normalizeCardKey(card.card_name, card.set_name);
    if (indexByKey.has(key)) continue;
    const highValueSurcharge = quoteCardHvAmount(card);
    if (highValueSurcharge <= 0) continue;
    groups.push({
      key,
      label: quoteItemCardLabel(card),
      items: [],
      servicesSubtotal: 0,
      highValueSurcharge,
      subtotal: highValueSurcharge,
      card,
    });
  }

  return groups;
}

/**
 * Summarize which services are on which order cards, plus coverage warnings.
 */
export function analyzeQuoteCardCoverage(orderCards = [], quoteItems = []) {
  const cards = orderCards ?? [];
  const items = quoteItems ?? [];

  const cardNumberById = new Map(
    cards.map((card, index) => [String(card.id), index + 1])
  );
  const cardById = new Map(cards.map((card) => [String(card.id), card]));
  const cardByNameSet = new Map(
    cards.map((card) => [
      normalizeCardKey(card.card_name, card.set_name),
      card,
    ])
  );

  /** @type {Map<string, { card: object|null, number: number|null, label: string, services: { key: string, label: string, count: number }[] }>} */
  const byCard = new Map();
  let unmatchedIndex = 0;

  function ensureCardEntry(key, card, label) {
    if (!byCard.has(key)) {
      const number = card
        ? cardNumberById.get(String(card.id)) ?? null
        : null;
      byCard.set(key, { card, number, label, services: [] });
    }
    return byCard.get(key);
  }

  for (const item of items) {
    if (!item?.service_key) continue;
    if (
      item.service_key === SERVICE_KEYS.CUSTOM &&
      !(item.service_label || "").trim()
    ) {
      continue;
    }
    const pick =
      item.card_pick && item.card_pick !== "custom"
        ? String(item.card_pick)
        : "";
    const matched =
      (pick && cardById.get(pick)) ||
      cardByNameSet.get(normalizeCardKey(item.card_name, item.set_name)) ||
      null;

    const key = matched
      ? `id:${matched.id}`
      : `name:${normalizeCardKey(item.card_name, item.set_name)}`;
    const label = matched
      ? quoteItemCardLabel(matched)
      : quoteItemCardLabel(item);
    const entry = ensureCardEntry(key, matched, label);
    if (entry.number == null) {
      unmatchedIndex += 1;
      entry.number = cards.length + unmatchedIndex;
    }
    const serviceKey = item.service_key || SERVICE_KEYS.CUSTOM;
    const serviceLabel =
      (item.service_label || "").trim() ||
      defaultServiceLabel(serviceKey) ||
      serviceKey;
    const existing = entry.services.find((s) => s.key === serviceKey);
    if (existing) {
      existing.count += 1;
    } else {
      entry.services.push({ key: serviceKey, label: serviceLabel, count: 1 });
    }
  }

  const assignments = [...byCard.values()]
    .map((entry) => ({
      number: entry.number,
      label: entry.label,
      services: entry.services,
    }))
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));

  const coveredIds = new Set(
    [...byCard.values()]
      .filter((entry) => entry.card)
      .map((entry) => String(entry.card.id))
  );
  const uncoveredCards = cards
    .filter((card) => !coveredIds.has(String(card.id)))
    .map((card) => ({
      number: cardNumberById.get(String(card.id)),
      label: quoteItemCardLabel(card),
    }));

  const duplicateServiceCards = [...byCard.values()]
    .filter((entry) => entry.services.some((s) => s.count > 1))
    .map((entry) => ({
      number: entry.number,
      label: entry.label,
      services: entry.services.filter((s) => s.count > 1),
    }))
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));

  return { assignments, uncoveredCards, duplicateServiceCards };
}
