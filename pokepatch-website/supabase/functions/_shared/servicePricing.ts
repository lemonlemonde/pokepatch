/**
 * Edge-function mirror of the pricing constants in src/lib/servicePricing.js.
 * Edit that file first, then keep keys / titles / list prices / HV tiers in
 * sync here. Only what the Discord quote flow needs is mirrored.
 */

export const SERVICE_KEYS = {
  SURFACE: "surface_restoration",
  PRESSING: "precision_pressing",
  ADVANCED: "advanced_restoration",
  WHITENING: "card_whitening",
  WHITENING_MAJOR: "card_whitening_major",
  SLAB: "slab_cracking",
  CUSTOM: "custom",
} as const;

export type ServiceKey = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS];

export type QuoteService = {
  key: ServiceKey;
  title: string;
  listPrice: number | null;
  priceSuffix?: string;
  /** Short names (kept for parity with the frontend service list). */
  aliases: string[];
};

/** Same order as the admin service picker. Custom is handled separately. */
export const QUOTE_SERVICES: QuoteService[] = [
  {
    key: SERVICE_KEYS.SURFACE,
    title: "Surface Cleaning",
    listPrice: 20,
    aliases: ["surface cleaning", "surface", "cleaning", "clean"],
  },
  {
    key: SERVICE_KEYS.PRESSING,
    title: "Minor Damage",
    listPrice: 30,
    aliases: ["minor damage", "damage minor", "pressing", "minor"],
  },
  {
    key: SERVICE_KEYS.ADVANCED,
    title: "Major Damage",
    listPrice: 50,
    priceSuffix: "+",
    aliases: ["major damage", "damage major", "advanced", "major"],
  },
  {
    key: SERVICE_KEYS.WHITENING,
    title: "Minor Whitening",
    listPrice: 25,
    aliases: ["minor whitening", "whitening minor", "whitening"],
  },
  {
    key: SERVICE_KEYS.WHITENING_MAJOR,
    title: "Major Whitening",
    listPrice: 40,
    aliases: ["major whitening", "whitening major"],
  },
  {
    key: SERVICE_KEYS.SLAB,
    title: "Slab Cracking",
    listPrice: 10,
    aliases: ["slab cracking", "slab", "crack"],
  },
];

export function serviceByKey(key: string): QuoteService | null {
  return QUOTE_SERVICES.find((service) => service.key === key) ?? null;
}

export function servicePriceDisplay(service: QuoteService): string {
  if (service.listPrice == null) return "";
  return `$${service.listPrice}${service.priceSuffix ?? ""}`;
}

/**
 * High-value surcharge tiers from Raw NM market value.
 * Highest matching tier wins; values below the first tier are 0%.
 */
export const HV_SURCHARGE_TIERS = [
  { minValue: 200, maxExclusive: 500 as number | null, percent: 4 },
  { minValue: 500, maxExclusive: null as number | null, percent: 8 },
];

export const HV_TIER_RANGES_LABEL = HV_SURCHARGE_TIERS.map((tier) => {
  const range =
    tier.maxExclusive != null
      ? `$${tier.minValue}–$${tier.maxExclusive - 1}`
      : `$${tier.minValue}+`;
  return `${range} → ${tier.percent}%`;
}).join(", ");

export function hvPercentFromMarketValue(marketValue: unknown): number {
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
export function hvSurchargeFromMarketValue(marketValue: unknown): number | null {
  const value = Number(marketValue);
  const percent = hvPercentFromMarketValue(value);
  if (!Number.isFinite(value) || value < 0 || percent <= 0) return null;
  return Math.round(value * (percent / 100) * 100) / 100;
}

export function formatMoney(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Paid priority service — flat fee per priority card. */
export const PRIORITY_FEE_PER_CARD = 15;
const PRIORITY_ADJUSTMENT_LABEL = "priority service";

/** Stored shape of orders.quote_bulk_counts (version 2). */
export type CardHvRow = {
  card_id: string;
  percent: number | null;
  amount_dollars: number;
};

export type QuoteBulkCountsV2 = {
  version: 2;
  adjustments: Record<string, unknown>[];
  card_hv?: CardHvRow[];
};

function legacyBulkEntry(value: unknown): {
  count: number;
  per_card_off: number;
  enabled: boolean;
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    return {
      count: Math.max(0, Math.floor(Number(row.count) || 0)),
      per_card_off: Number(row.per_card_off) || 0,
      enabled: row.enabled !== false,
    };
  }
  return {
    count: Math.max(0, Math.floor(Number(value) || 0)),
    per_card_off: 0,
    enabled: true,
  };
}

/** Legacy per-service bulk map → v2 adjustment rows (mirrors legacyBulkToAdjustments). */
function legacyBulkToAdjustments(stored: Record<string, unknown>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const service of QUOTE_SERVICES) {
    const entry = legacyBulkEntry(stored[service.key]);
    if (!entry.enabled || entry.count <= 0 || entry.per_card_off <= 0) continue;
    const total = roundMoney(entry.count * entry.per_card_off);
    if (total <= 0) continue;
    rows.push({
      id: crypto.randomUUID(),
      kind: "adjustment",
      description: `${service.title} bulk (${entry.count} × $${entry.per_card_off.toFixed(2)}/card)`,
      amount_dollars: -total,
      amount_percent: null,
    });
  }
  return rows;
}

/** Normalize any stored quote_bulk_counts value into the v2 shape. */
export function normalizeQuoteBulkCounts(stored: unknown): QuoteBulkCountsV2 {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { version: 2, adjustments: [] };
  }
  const record = stored as Record<string, unknown>;
  if (record.version === 2) {
    const adjustments = Array.isArray(record.adjustments)
      ? (record.adjustments as Record<string, unknown>[])
      : [];
    const card_hv = Array.isArray(record.card_hv)
      ? (record.card_hv as unknown[])
          .map(normalizeCardHvRow)
          .filter((row): row is CardHvRow => row != null)
      : [];
    return { version: 2, adjustments, card_hv };
  }
  return { version: 2, adjustments: legacyBulkToAdjustments(record) };
}

function normalizeCardHvRow(raw: unknown): CardHvRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const card_id = row.card_id != null ? String(row.card_id) : "";
  if (!card_id) return null;
  const amount = Number(row.amount_dollars);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const percentRaw = row.percent;
  const percent =
    percentRaw == null || percentRaw === ""
      ? null
      : Number.isFinite(Number(percentRaw))
        ? Math.abs(Number(percentRaw))
        : null;
  return { card_id, percent, amount_dollars: Math.abs(amount) };
}

/** HV dollars stored for a card (0 when none). */
export function storedCardHvAmount(stored: unknown, cardId: string): number {
  const normalized = normalizeQuoteBulkCounts(stored);
  const row = (normalized.card_hv ?? []).find((entry) => entry.card_id === String(cardId));
  return row ? row.amount_dollars : 0;
}

/**
 * Replace one card's HV row from its market value (tier %), returning the
 * payload to store — or null when nothing is left to store.
 */
export function withCardHvFromMarket(
  stored: unknown,
  cardId: string,
  marketValue: number | null
): QuoteBulkCountsV2 | null {
  const normalized = normalizeQuoteBulkCounts(stored);
  const others = (normalized.card_hv ?? []).filter(
    (row) => row.card_id !== String(cardId)
  );
  const amount = marketValue == null ? null : hvSurchargeFromMarketValue(marketValue);
  const card_hv =
    amount != null
      ? [
          ...others,
          {
            card_id: String(cardId),
            percent: hvPercentFromMarketValue(marketValue),
            amount_dollars: amount,
          },
        ]
      : others;
  if (normalized.adjustments.length === 0 && card_hv.length === 0) return null;
  return {
    version: 2,
    adjustments: normalized.adjustments,
    ...(card_hv.length > 0 ? { card_hv } : {}),
  };
}

// ---------------------------------------------------------------------------
// Order total (mirrors computeQuoteTotal / orderQuoteTotalFromStored)

type TotalCard = {
  id: string;
  status?: string | null;
  is_priority?: boolean | null;
};
type TotalItem = {
  card_id?: string | null;
  quote_base_amount: number | string;
};

function isCanceledStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "canceled" || s === "cancelled";
}

function isPriorityAdjustment(row: Record<string, unknown>): boolean {
  return String(row.description ?? "").trim().toLowerCase() === PRIORITY_ADJUSTMENT_LABEL;
}

/** Signed $ for one adjustment row; percent rows apply to the services subtotal. */
function adjustmentSignedAmount(row: Record<string, unknown>, subtotal: number): number {
  const kind = String(row.kind ?? "adjustment");
  let dollars = Number(row.amount_dollars);
  if (!Number.isFinite(dollars) || dollars === 0) {
    const percent = Math.abs(Number(row.amount_percent));
    if (!Number.isFinite(percent) || percent <= 0) return 0;
    const fromPercent = roundMoney(subtotal * (percent / 100));
    return kind === "discount" ? -fromPercent : fromPercent;
  }
  if (dollars > 0 && kind === "discount") dollars = -dollars;
  return roundMoney(dollars);
}

/**
 * Full order quote: billable service lines + card HV + adjustments + priority
 * fee. `items` must already be attributed to cards (`card_id`) so canceled
 * cards drop out; items without a card_id always count.
 */
export function orderQuoteTotal(params: {
  cards: TotalCard[];
  items: TotalItem[];
  quoteBulkCounts: unknown;
}): {
  servicesSubtotal: number;
  hvTotal: number;
  adjustmentsTotal: number;
  priorityFee: number;
  total: number;
} {
  const { cards, items, quoteBulkCounts } = params;
  const billable = cards.filter((card) => !isCanceledStatus(card.status));
  const billableIds = new Set(billable.map((card) => String(card.id)));

  const servicesSubtotal = roundMoney(
    items
      .filter((item) => !item.card_id || billableIds.has(String(item.card_id)))
      .reduce((sum, item) => sum + (Number(item.quote_base_amount) || 0), 0)
  );

  const stored = normalizeQuoteBulkCounts(quoteBulkCounts);
  const hvTotal = roundMoney(
    (stored.card_hv ?? [])
      .filter((row) => billableIds.has(row.card_id))
      .reduce((sum, row) => sum + row.amount_dollars, 0)
  );
  const adjustmentsTotal = roundMoney(
    stored.adjustments
      .filter((row) => !isPriorityAdjustment(row))
      .reduce((sum, row) => sum + adjustmentSignedAmount(row, servicesSubtotal), 0)
  );
  const priorityCount = billable.filter((card) => Boolean(card.is_priority)).length;
  const priorityFee = roundMoney(priorityCount * PRIORITY_FEE_PER_CARD);

  return {
    servicesSubtotal,
    hvTotal,
    adjustmentsTotal,
    priorityFee,
    total: roundMoney(servicesSubtotal + hvTotal + adjustmentsTotal + priorityFee),
  };
}
