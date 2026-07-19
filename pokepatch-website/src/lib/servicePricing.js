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
  { percent: 4, label: "4% ($200–$500)" },
  { percent: 8, label: "8% ($500+)" },
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

export function bulkTotalOff(serviceKey, count) {
  const n = Number(count) || 0;
  return n * bulkPerCardOff(serviceKey, n);
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

/** Bulk discount rows for display (only services with off > 0). */
export function bulkDiscountLines(bulkCounts) {
  const lines = [];
  for (const service of QUOTE_SERVICES) {
    if (service.key === SERVICE_KEYS.CUSTOM) continue;
    const count = Number(bulkCounts?.[service.key]) || 0;
    const perCard = bulkPerCardOff(service.key, count);
    const total = bulkTotalOff(service.key, count);
    if (total <= 0) continue;
    lines.push({
      serviceKey: service.key,
      label: service.title,
      count,
      perCardOff: perCard,
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
