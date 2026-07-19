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
    title: "Surface Restoration",
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
    title: "Precision Pressing & Flattening",
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
    title: "Advanced Restoration",
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
    { label: "$200–$500", value: "+4%" },
    { label: "$500+", value: "+8%" },
  ],
  bulkLabel: "Surcharge Tiers",
  accent: "mint",
};

export const HV_PERCENT_OPTIONS = [
  { percent: 0, label: "0%" },
  { percent: 4, label: "4%" },
  { percent: 8, label: "8%" },
];

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
        bulk: service.bulkTiers.map((tier) => ({
          label: tier.label,
          value: tier.value,
        })),
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

export function bulkPerCardOff(serviceKey, count) {
  const n = Number(count) || 0;
  const service = serviceByKey(serviceKey);
  if (!service?.bulkTiers?.length || n <= 0) return 0;
  let best = 0;
  for (const tier of service.bulkTiers) {
    if (n >= tier.minCount && tier.perCardOff > best) {
      best = tier.perCardOff;
    }
  }
  return best;
}

export function bulkTotalOff(serviceKey, count, perCardOff = null) {
  const n = Number(count) || 0;
  const off =
    perCardOff != null && Number.isFinite(Number(perCardOff))
      ? Number(perCardOff)
      : bulkPerCardOff(serviceKey, n);
  return Math.round(n * off * 100) / 100;
}

/** Normalize stored bulk calc entry. Supports legacy `{ key: count }` maps. */
export function normalizeBulkEntry(value, serviceKey) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const count = Math.max(0, Math.floor(Number(value.count) || 0));
    const hasOff =
      value.per_card_off != null &&
      value.per_card_off !== "" &&
      Number.isFinite(Number(value.per_card_off));
    const per_card_off = hasOff
      ? Number(value.per_card_off)
      : bulkPerCardOff(serviceKey, count);
    return { count, per_card_off };
  }
  const count = Math.max(0, Math.floor(Number(value) || 0));
  return { count, per_card_off: bulkPerCardOff(serviceKey, count) };
}

export function suggestBulkCountsFromItems(items) {
  const counts = {};
  for (const item of items ?? []) {
    const key = item?.service_key;
    if (!key || key === SERVICE_KEYS.CUSTOM) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Map of service_key → { count, per_card_off } with tier defaults. */
export function suggestBulkCalcsFromItems(items) {
  const counts = suggestBulkCountsFromItems(items);
  const out = {};
  for (const [key, count] of Object.entries(counts)) {
    out[key] = {
      count,
      per_card_off: bulkPerCardOff(key, count),
    };
  }
  return out;
}

export function normalizeBulkCalcs(bulkCalcs) {
  const out = {};
  for (const [key, value] of Object.entries(bulkCalcs ?? {})) {
    if (key === SERVICE_KEYS.CUSTOM) continue;
    const entry = normalizeBulkEntry(value, key);
    if (entry.count > 0) out[key] = entry;
  }
  return out;
}

export function highValueSurchargeFromValue(cardValue, percent) {
  const value = Number(cardValue);
  const pct = Number(percent);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(pct) || pct <= 0) {
    return null;
  }
  return Math.round(value * (pct / 100) * 100) / 100;
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

/** Bulk discount rows for display (count > 0 and per-card off > 0). */
export function bulkDiscountLines(bulkCalcs) {
  const lines = [];
  for (const service of QUOTE_SERVICES) {
    if (service.key === SERVICE_KEYS.CUSTOM) continue;
    const entry = normalizeBulkEntry(bulkCalcs?.[service.key], service.key);
    const total = bulkTotalOff(
      service.key,
      entry.count,
      entry.per_card_off
    );
    if (entry.count <= 0 || entry.per_card_off <= 0) continue;
    lines.push({
      serviceKey: service.key,
      label: service.title,
      count: entry.count,
      perCardOff: entry.per_card_off,
      totalOff: total,
    });
  }
  return lines;
}

export function quoteItemsSubtotal(items) {
  let sum = 0;
  for (const item of items ?? []) {
    const base = Number(item.quote_base_amount) || 0;
    const hv = Number(item.high_value_surcharge) || 0;
    sum += base + hv;
  }
  return sum;
}

export function quoteBulkTotalOff(bulkCounts) {
  return bulkDiscountLines(bulkCounts).reduce(
    (sum, line) => sum + line.totalOff,
    0
  );
}

export function computeQuoteTotal({
  items,
  bulkCounts,
  overrideAmount = null,
} = {}) {
  const subtotal = quoteItemsSubtotal(items);
  const bulkOff = quoteBulkTotalOff(bulkCounts);
  const override = Number(overrideAmount) || 0;
  return Math.round((subtotal - bulkOff + override) * 100) / 100;
}

export function hasQuoteData({
  items,
  bulkCounts,
  overrideAmount = null,
} = {}) {
  if ((items ?? []).length > 0) return true;
  if (quoteBulkTotalOff(bulkCounts) > 0) return true;
  if (overrideAmount != null && Number.isFinite(Number(overrideAmount))) {
    return true;
  }
  return false;
}

export function quoteItemCardLabel(item) {
  const name = (item?.card_name || "").trim() || "Card";
  const set = (item?.set_name || "").trim();
  return set ? `${name} (${set})` : name;
}

export function quoteItemLineTotal(item) {
  const base = Number(item?.quote_base_amount) || 0;
  const hv = Number(item?.high_value_surcharge) || 0;
  return Math.round((base + hv) * 100) / 100;
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
