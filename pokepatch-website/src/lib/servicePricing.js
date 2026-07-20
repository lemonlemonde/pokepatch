/** Shared restoration rates — homepage marketing + admin quote defaults. */

export const SERVICE_KEYS = {
  SURFACE: "surface_restoration",
  PRESSING: "precision_pressing",
  ADVANCED: "advanced_restoration",
  CUSTOM: "custom",
};

/** Services that can appear on a quote line (excludes marketing-only HV card). */
export const QUOTE_SERVICES = [
  {
    key: SERVICE_KEYS.SURFACE,
    title: "Surface Cleaning",
    listPrice: 9,
    priceDisplay: "$9",
    unit: "/ card",
    features: [
      "Surface cleaning",
      "Scratch minimization",
      "Shine enhancement",
    ],
    // Highest matching tier wins. Off is vs list price.
    bulkTiers: [
      { minCount: 10, perCardOff: 2, label: "10+ cards", value: "$7 / card" },
      { minCount: 25, perCardOff: 3, label: "25+ cards", value: "$6 / card" },
    ],
    accent: "blush",
  },
  {
    key: SERVICE_KEYS.PRESSING,
    title: "Flattening",
    listPrice: 28,
    priceDisplay: "$28",
    unit: "/ card",
    features: ["Minor bends", "Light warping", "Subtle edge lift"],
    bulkTiers: [
      { minCount: 10, perCardOff: 5, label: "10+ cards", value: "$5 off / card" },
    ],
    accent: "lavender",
  },
  {
    key: SERVICE_KEYS.ADVANCED,
    title: "Heavy Damage",
    listPrice: 45,
    priceDisplay: "$45+",
    unit: "/ card",
    features: ["Creases", "Heavy dents", "Severe warping"],
    bulkTiers: [
      {
        minCount: 25,
        perCardOff: 10,
        label: "25+ cards",
        value: "$10 off / card",
      },
    ],
    accent: "peach",
  },
  {
    key: SERVICE_KEYS.CUSTOM,
    title: "Custom",
    listPrice: null,
    priceDisplay: null,
    unit: null,
    features: [],
    bulkTiers: [],
    accent: "mint",
  },
];

const HIGH_VALUE_MARKETING = {
  title: "High-Value Handling",
  features: ["Added on top of restoration service"],
  bulk: [
    { label: "$200–$499", value: "+4%" },
    { label: "$500+", value: "+8%" },
  ],
  bulkLabel: "Surcharge Tiers",
  accent: "mint",
};

/** Short admin/customer hint for default HV market-value tiers. */
export const HV_TIER_RANGES_LABEL = "$200–$499 → 4%, $500+ → 8%";

function serviceByKey(key) {
  return QUOTE_SERVICES.find((service) => service.key === key) ?? null;
}

/** Homepage ServiceCard props (includes High-Value Handling). */
export function marketingServices() {
  return [
    ...QUOTE_SERVICES.filter((s) => s.key !== SERVICE_KEYS.CUSTOM).map(
      (service) => ({
        title: service.title,
        price: service.priceDisplay,
        unit: service.unit,
        features: service.features,
        accent: service.accent,
      })
    ),
    HIGH_VALUE_MARKETING,
  ];
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

/**
 * HV tiers from Raw NM market value:
 * under $200 → 0%, $200–$499 → 4%, $500+ → 8%.
 */
export function hvPercentFromMarketValue(marketValue) {
  const value = Number(marketValue);
  if (!Number.isFinite(value) || value < 200) return 0;
  if (value < 500) return 4;
  return 8;
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
  "discount",
  "delivery",
  "shipping",
  // Legacy kind kept for stored rows; not offered in the admin UI.
  "surcharge",
]);

/** Admin type dropdown options (excludes legacy surcharge). */
export const ADJUSTMENT_KIND_OPTIONS = [
  { value: "discount", label: "Discount" },
  { value: "delivery", label: "Delivery" },
  { value: "shipping", label: "Shipping" },
];

const ADJUSTMENT_KIND_LABELS = {
  discount: "Discount",
  delivery: "Delivery",
  shipping: "Shipping",
  surcharge: "Surcharge",
};

export function adjustmentKindLabel(kind) {
  return ADJUSTMENT_KIND_LABELS[kind] ?? "Discount";
}

function newAdjustmentId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `adj-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emptyQuoteAdjustment(kind = "discount") {
  return {
    id: newAdjustmentId(),
    kind: ADJUSTMENT_KINDS.has(kind) ? kind : "discount",
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

/** Normalize one editor/storage adjustment row. */
export function normalizeQuoteAdjustment(row) {
  if (!row || typeof row !== "object") return null;
  const kind = ADJUSTMENT_KINDS.has(row.kind) ? row.kind : "discount";
  const description =
    row.description != null ? String(row.description).trim() : "";
  const dollarsRaw = row.amount_dollars;
  const percentRaw = row.amount_percent;
  const dollars =
    dollarsRaw === "" || dollarsRaw == null
      ? null
      : Number.isFinite(Number(dollarsRaw))
        ? Math.abs(Number(dollarsRaw))
        : null;
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
  if (normalized.amount_dollars != null && normalized.amount_dollars > 0) {
    return true;
  }
  if (normalized.amount_percent != null && normalized.amount_percent > 0) {
    return true;
  }
  return false;
}

/** Signed $ applied to the total (discount negative; all other kinds positive). */
export function quoteAdjustmentSignedAmount(row, subtotal = null) {
  const normalized = normalizeQuoteAdjustment(row);
  if (!normalized) return 0;
  let dollars = normalized.amount_dollars;
  if (
    (dollars == null || dollars === 0) &&
    normalized.amount_percent != null &&
    subtotal != null
  ) {
    dollars = percentToDollars(normalized.amount_percent, subtotal) ?? 0;
  }
  if (dollars == null || !Number.isFinite(dollars) || dollars === 0) return 0;
  const signed = normalized.kind === "discount" ? -dollars : dollars;
  return Math.round(signed * 100) / 100;
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
      kind: row.kind,
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
} = {}) {
  const subtotal = quoteItemsSubtotal(items);
  const cardHv = quoteCardsHvTotal(cards);
  const adjustmentTotal = quoteAdjustmentsTotal(adjustments, items);
  return Math.round((subtotal + cardHv + adjustmentTotal) * 100) / 100;
}

export function hasQuoteData({
  items,
  cards = null,
  adjustments = null,
} = {}) {
  if ((items ?? []).length > 0) return true;
  if (quoteCardsHvTotal(cards) > 0) return true;
  if (quoteAdjustmentLines(adjustments, items).length > 0) return true;
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

/** Group quote lines by card name/set, preserving first-seen order. */
export function groupQuoteItemsByCard(items = [], cards = []) {
  const cardByKey = new Map(
    (cards ?? []).map((card) => [
      normalizeCardKey(card.card_name, card.set_name),
      card,
    ])
  );
  const groups = [];
  const indexByKey = new Map();
  for (const item of items ?? []) {
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
  for (const card of cards ?? []) {
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

function normalizeCardKey(name, setName) {
  return `${(name || "").trim().toLowerCase()}|${(setName || "").trim().toLowerCase()}`;
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
