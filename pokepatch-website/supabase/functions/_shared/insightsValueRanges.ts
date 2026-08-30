/**
 * Admin Insights: bucket card quotes, market prices, and order quote totals
 * into dollar ranges for pie charts.
 *
 * Quote math mirrors the customer quote (services + HV + adjustments + priority),
 * not after-completion / restoration ledger amounts.
 */

export type MoneyRange = { label: string; min: number; max: number };

export type InsightsOrderRow = {
  id: unknown;
  display_id: unknown;
  created_at: unknown;
  customer_name: unknown;
  customer_email: unknown;
  status: unknown;
  pending_kind?: unknown;
  is_priority?: unknown;
  quote_bulk_counts?: unknown;
  quote_override_label?: unknown;
  quote_override_amount?: unknown;
};

export type InsightsCardRow = {
  id: unknown;
  order_id: unknown;
  card_name?: unknown;
  set_name?: unknown;
  status?: unknown;
  market_value_raw_nm?: unknown;
};

export type InsightsQuoteItemRow = {
  order_id: unknown;
  card_name?: unknown;
  set_name?: unknown;
  quote_base_amount?: unknown;
};

type OrderSummary = {
  id: unknown;
  display_id: unknown;
  created_at: unknown;
  customer_name: unknown;
  customer_email: unknown;
  status: unknown;
  pending_kind: unknown;
};

type RangeBucket = {
  label: string;
  count: number;
  orders: OrderSummary[];
  orderIds: Set<string>;
};

export const CARD_QUOTE_RANGES: MoneyRange[] = [
  { label: "Under $25", min: 0, max: 25 },
  { label: "$25–$49", min: 25, max: 50 },
  { label: "$50–$99", min: 50, max: 100 },
  { label: "$100–$199", min: 100, max: 200 },
  { label: "$200+", min: 200, max: Number.POSITIVE_INFINITY },
];

export const MARKET_PRICE_RANGES: MoneyRange[] = [
  { label: "Under $50", min: 0, max: 50 },
  { label: "$50–$199", min: 50, max: 200 },
  { label: "$200–$499", min: 200, max: 500 },
  { label: "$500–$999", min: 500, max: 1000 },
  { label: "$1,000+", min: 1000, max: Number.POSITIVE_INFINITY },
];

export const ORDER_QUOTE_RANGES: MoneyRange[] = [
  { label: "Under $50", min: 0, max: 50 },
  { label: "$50–$99", min: 50, max: 100 },
  { label: "$100–$199", min: 100, max: 200 },
  { label: "$200–$499", min: 200, max: 500 },
  { label: "$500+", min: 500, max: Number.POSITIVE_INFINITY },
];

const PRIORITY_BASE_FEE = 25;
const PRIORITY_EXTRA_CARD_FEE = 10;
const PRIORITY_LABEL = "priority service";

function money(n: number) {
  return Math.round(n * 100) / 100;
}

function cardKey(name: unknown, setName: unknown) {
  return `${String(name ?? "")
    .trim()
    .toLowerCase()}|${String(setName ?? "")
    .trim()
    .toLowerCase()}`;
}

export function isCanceledStatus(status: unknown) {
  const s = String(status ?? "")
    .trim()
    .toLowerCase();
  return s === "canceled" || s === "cancelled";
}

function rangeLabel(ranges: MoneyRange[], amount: number) {
  for (const range of ranges) {
    if (amount >= range.min && amount < range.max) return range.label;
  }
  return ranges[ranges.length - 1]?.label ?? null;
}

function emptyBuckets(ranges: MoneyRange[]): Map<string, RangeBucket> {
  return new Map(
    ranges.map((range) => [
      range.label,
      { label: range.label, count: 0, orders: [], orderIds: new Set() },
    ])
  );
}

function pushRange(
  buckets: Map<string, RangeBucket>,
  ranges: MoneyRange[],
  amount: number,
  order: OrderSummary
) {
  if (!Number.isFinite(amount) || amount < 0) return;
  const label = rangeLabel(ranges, amount);
  if (!label) return;
  const bucket = buckets.get(label);
  if (!bucket) return;
  bucket.count += 1;
  const orderId = String(order.id);
  if (!bucket.orderIds.has(orderId)) {
    bucket.orderIds.add(orderId);
    bucket.orders.push(order);
  }
}

function finishMetric(
  ranges: MoneyRange[],
  buckets: Map<string, RangeBucket>,
  values: number[]
) {
  const counted = values.length;
  const average =
    counted > 0
      ? money(values.reduce((sum, n) => sum + n, 0) / counted)
      : null;
  const slices = ranges
    .map((range) => buckets.get(range.label))
    .filter((bucket): bucket is RangeBucket => (bucket?.count ?? 0) > 0)
    .map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      orders: bucket.orders,
    }));
  return { average, counted, slices };
}

function unpackCardHv(stored: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (
    !stored ||
    typeof stored !== "object" ||
    Array.isArray(stored) ||
    (stored as { version?: unknown }).version !== 2 ||
    !Array.isArray((stored as { card_hv?: unknown }).card_hv)
  ) {
    return out;
  }
  for (const row of (stored as { card_hv: unknown[] }).card_hv) {
    if (!row || typeof row !== "object") continue;
    const cardId = String((row as { card_id?: unknown }).card_id ?? "");
    const amount = Number((row as { amount_dollars?: unknown }).amount_dollars);
    if (!cardId || !Number.isFinite(amount) || amount <= 0) continue;
    out.set(cardId, money(Math.abs(amount)));
  }
  return out;
}

function adjustmentSignedAmount(
  row: Record<string, unknown>,
  subtotal: number
) {
  const kind = String(row.kind ?? "adjustment");
  let dollars =
    row.amount_dollars === "" || row.amount_dollars == null
      ? null
      : Number(row.amount_dollars);
  if (
    dollars != null &&
    Number.isFinite(dollars) &&
    dollars > 0 &&
    kind === "discount"
  ) {
    dollars = -dollars;
  }
  if (
    (dollars == null || dollars === 0) &&
    row.amount_percent != null &&
    row.amount_percent !== ""
  ) {
    const pct = Math.abs(Number(row.amount_percent));
    if (Number.isFinite(pct) && Number.isFinite(subtotal) && subtotal >= 0) {
      const fromPercent = money(subtotal * (pct / 100));
      dollars = kind === "discount" ? -fromPercent : fromPercent;
    }
  }
  if (dollars == null || !Number.isFinite(dollars) || dollars === 0) return 0;
  return money(dollars);
}

function unpackAdjustments(
  stored: unknown,
  overrideLabel: unknown,
  overrideAmount: unknown
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  if (
    stored &&
    typeof stored === "object" &&
    !Array.isArray(stored) &&
    (stored as { version?: unknown }).version === 2
  ) {
    const list = Array.isArray(
      (stored as { adjustments?: unknown }).adjustments
    )
      ? (stored as { adjustments: unknown[] }).adjustments
      : [];
    for (const row of list) {
      if (row && typeof row === "object") {
        rows.push(row as Record<string, unknown>);
      }
    }
  } else if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, value] of Object.entries(
      stored as Record<string, unknown>
    )) {
      if (key === "version" || key === "adjustments" || key === "card_hv") {
        continue;
      }
      let count = 0;
      let perCardOff = 0;
      let enabled = true;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const entry = value as {
          count?: unknown;
          per_card_off?: unknown;
          enabled?: unknown;
        };
        count = Math.max(0, Math.floor(Number(entry.count) || 0));
        perCardOff = Number(entry.per_card_off) || 0;
        enabled = entry.enabled !== false;
      } else {
        count = Math.max(0, Math.floor(Number(value) || 0));
      }
      if (!enabled || count <= 0 || perCardOff <= 0) continue;
      rows.push({
        kind: "discount",
        description: `${key} bulk`,
        amount_dollars: money(count * perCardOff),
      });
    }
  }

  if (rows.length === 0 && overrideAmount != null) {
    const n = Number(overrideAmount);
    if (Number.isFinite(n) && n !== 0) {
      rows.push({
        kind: n >= 0 ? "surcharge" : "discount",
        description:
          String(overrideLabel ?? "").trim() ||
          (n >= 0 ? "Surcharge" : "Discount"),
        amount_dollars: Math.abs(n),
      });
    }
  }
  return rows;
}

function priorityFee(cardCount: number) {
  const count = Math.max(1, Math.floor(cardCount) || 1);
  return money(
    PRIORITY_BASE_FEE + Math.max(0, count - 1) * PRIORITY_EXTRA_CARD_FEE
  );
}

/** Aggregate active orders into range-pie metrics. */
export function buildValueRangeInsights(
  orders: InsightsOrderRow[],
  cards: InsightsCardRow[],
  quoteItems: InsightsQuoteItemRow[]
) {
  const activeOrders = (orders ?? []).filter(
    (row) => !isCanceledStatus(row.status)
  );
  if (activeOrders.length === 0) {
    return {
      card_quote: { average: null, counted: 0, slices: [] },
      card_market: { average: null, counted: 0, slices: [] },
      order_quote: { average: null, counted: 0, slices: [] },
    };
  }

  const cardsByOrder = new Map<string, InsightsCardRow[]>();
  for (const card of cards ?? []) {
    const orderId = String(card.order_id);
    const list = cardsByOrder.get(orderId) ?? [];
    list.push(card);
    cardsByOrder.set(orderId, list);
  }

  const itemsByOrder = new Map<string, InsightsQuoteItemRow[]>();
  for (const item of quoteItems ?? []) {
    const orderId = String(item.order_id);
    const list = itemsByOrder.get(orderId) ?? [];
    list.push(item);
    itemsByOrder.set(orderId, list);
  }

  const cardQuoteBuckets = emptyBuckets(CARD_QUOTE_RANGES);
  const marketBuckets = emptyBuckets(MARKET_PRICE_RANGES);
  const orderQuoteBuckets = emptyBuckets(ORDER_QUOTE_RANGES);
  const cardQuoteValues: number[] = [];
  const marketValues: number[] = [];
  const orderQuoteValues: number[] = [];

  for (const orderRow of activeOrders) {
    const orderId = String(orderRow.id);
    const summary: OrderSummary = {
      id: orderRow.id,
      display_id: orderRow.display_id,
      created_at: orderRow.created_at,
      customer_name: orderRow.customer_name,
      customer_email: orderRow.customer_email,
      status: orderRow.status,
      pending_kind: orderRow.pending_kind ?? null,
    };
    const orderCards = cardsByOrder.get(orderId) ?? [];
    const billableCards = orderCards.filter(
      (card) => !isCanceledStatus(card.status)
    );
    const canceledByKey = new Set(
      orderCards
        .filter((card) => isCanceledStatus(card.status))
        .map((card) => cardKey(card.card_name, card.set_name))
    );
    const orderItems = (itemsByOrder.get(orderId) ?? []).filter((item) => {
      const key = cardKey(item.card_name, item.set_name);
      return key === "|" || !canceledByKey.has(key);
    });
    const hvByCardId = unpackCardHv(orderRow.quote_bulk_counts);

    const servicesByKey = new Map<string, number>();
    for (const item of orderItems) {
      const key = cardKey(item.card_name, item.set_name);
      const amount = Number(item.quote_base_amount) || 0;
      servicesByKey.set(key, money((servicesByKey.get(key) ?? 0) + amount));
    }

    const cardsByKey = new Map<string, InsightsCardRow[]>();
    for (const card of billableCards) {
      const key = cardKey(card.card_name, card.set_name);
      const list = cardsByKey.get(key) ?? [];
      list.push(card);
      cardsByKey.set(key, list);
    }

    function hvForKey(key: string) {
      return money(
        (cardsByKey.get(key) ?? []).reduce(
          (sum, card) => sum + (hvByCardId.get(String(card.id)) ?? 0),
          0
        )
      );
    }

    const seenQuoteKeys = new Set<string>();
    for (const [key, services] of servicesByKey.entries()) {
      const amount = money(services + hvForKey(key));
      if (amount <= 0) continue;
      seenQuoteKeys.add(key);
      cardQuoteValues.push(amount);
      pushRange(cardQuoteBuckets, CARD_QUOTE_RANGES, amount, summary);
    }
    for (const key of cardsByKey.keys()) {
      if (seenQuoteKeys.has(key)) continue;
      const hv = hvForKey(key);
      if (hv <= 0) continue;
      seenQuoteKeys.add(key);
      cardQuoteValues.push(hv);
      pushRange(cardQuoteBuckets, CARD_QUOTE_RANGES, hv, summary);
    }

    for (const card of billableCards) {
      const market = Number(card.market_value_raw_nm);
      if (!Number.isFinite(market) || market < 0) continue;
      const rounded = money(market);
      marketValues.push(rounded);
      pushRange(marketBuckets, MARKET_PRICE_RANGES, rounded, summary);
    }

    const subtotal = money(
      orderItems.reduce(
        (sum, item) => sum + (Number(item.quote_base_amount) || 0),
        0
      )
    );
    const cardHvTotal = money(
      billableCards.reduce(
        (sum, card) => sum + (hvByCardId.get(String(card.id)) ?? 0),
        0
      )
    );
    const adjustments = unpackAdjustments(
      orderRow.quote_bulk_counts,
      orderRow.quote_override_label,
      orderRow.quote_override_amount
    );
    const adjustmentTotal = money(
      adjustments.reduce(
        (sum, row) => sum + adjustmentSignedAmount(row, subtotal),
        0
      )
    );
    const hasPriorityAdj = adjustments.some(
      (row) =>
        String(row.description ?? "").trim().toLowerCase() === PRIORITY_LABEL
    );
    const priority =
      Boolean(orderRow.is_priority) && !hasPriorityAdj
        ? priorityFee(billableCards.length)
        : 0;
    const orderTotal = money(
      subtotal + cardHvTotal + adjustmentTotal + priority
    );
    if (orderTotal <= 0 && subtotal <= 0 && cardHvTotal <= 0) continue;
    orderQuoteValues.push(orderTotal);
    pushRange(orderQuoteBuckets, ORDER_QUOTE_RANGES, orderTotal, summary);
  }

  return {
    card_quote: finishMetric(
      CARD_QUOTE_RANGES,
      cardQuoteBuckets,
      cardQuoteValues
    ),
    card_market: finishMetric(
      MARKET_PRICE_RANGES,
      marketBuckets,
      marketValues
    ),
    order_quote: finishMetric(
      ORDER_QUOTE_RANGES,
      orderQuoteBuckets,
      orderQuoteValues
    ),
  };
}
