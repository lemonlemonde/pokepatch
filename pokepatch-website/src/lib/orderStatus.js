export const ORDER_STATUSES = [
  { id: "new", label: "To do", customerLabel: "In queue" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "canceled", label: "Canceled" },
];

/** Per-card workflow status (independent from order status; uses `todo` not `new`). */
export const CARD_STATUSES = [
  { id: "todo", label: "To do", customerLabel: "In queue" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "canceled", label: "Canceled" },
];

export const DEFAULT_CARD_STATUS = "todo";

const CARD_LABEL_BY_ID = Object.fromEntries(
  CARD_STATUSES.map((status) => [status.id, status.label]),
);

const CARD_CUSTOMER_LABEL_BY_ID = Object.fromEntries(
  CARD_STATUSES.map((status) => [
    status.id,
    status.customerLabel ?? status.label,
  ]),
);

export function normalizeCardStatus(statusId) {
  if (statusId && CARD_LABEL_BY_ID[statusId]) return statusId;
  if (statusId === "new") return DEFAULT_CARD_STATUS;
  if (statusId === "cancelled") return "canceled";
  return DEFAULT_CARD_STATUS;
}

export function customerCardStatusLabel(statusId) {
  const status = normalizeCardStatus(statusId);
  return (
    CARD_CUSTOMER_LABEL_BY_ID[status] ??
    CARD_LABEL_BY_ID[status] ??
    CARD_CUSTOMER_LABEL_BY_ID[DEFAULT_CARD_STATUS]
  );
}

/** Same color language as order badges; maps `todo` like order `new`. */
export function cardStatusBadgeClass(statusId) {
  switch (normalizeCardStatus(statusId)) {
    case "in_progress":
      return "bg-status-yellow text-night";
    case "completed":
      return "bg-status-green text-night";
    case "canceled":
      return "bg-ink/25 text-ink/80";
    case "todo":
    default:
      return "bg-status-blue text-white";
  }
}

/** Statuses shown on the admin board by default. */
export const ACTIVE_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status) => status.id === "new" || status.id === "in_progress"
);

/** Closed statuses (completed + canceled). */
export const CLOSED_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status) => status.id === "completed" || status.id === "canceled"
);

/** Completed column on the main kanban row. */
export const COMPLETED_ORDER_STATUS = ORDER_STATUSES.find(
  (status) => status.id === "completed"
);

/** Canceled column docks next to the recycling bin. */
export const CANCELED_ORDER_STATUS = ORDER_STATUSES.find(
  (status) => status.id === "canceled"
);

export const DEFAULT_ORDER_STATUS = "new";

/** Closed orders older than this are hidden on My Orders and the admin kanban. */
export const COMPLETED_VISIBLE_DAYS = 7;

const LABEL_BY_ID = Object.fromEntries(
  ORDER_STATUSES.map((status) => [status.id, status.label]),
);

const CUSTOMER_LABEL_BY_ID = Object.fromEntries(
  ORDER_STATUSES.map((status) => [
    status.id,
    status.customerLabel ?? status.label,
  ]),
);

export function orderStatusLabel(statusId) {
  return LABEL_BY_ID[normalizeOrderStatus(statusId)] ?? LABEL_BY_ID[DEFAULT_ORDER_STATUS];
}

/** Customer-facing label (e.g. "In queue" instead of admin "To do"). */
export function customerOrderStatusLabel(statusId) {
  const status = normalizeOrderStatus(statusId);
  return (
    CUSTOMER_LABEL_BY_ID[status] ??
    LABEL_BY_ID[status] ??
    CUSTOMER_LABEL_BY_ID[DEFAULT_ORDER_STATUS]
  );
}

export function normalizeOrderStatus(statusId) {
  if (statusId && LABEL_BY_ID[statusId]) return statusId;
  // Legacy values from earlier status schemes.
  if (statusId === "todo") return DEFAULT_ORDER_STATUS;
  if (statusId === "delivered") return "completed";
  if (statusId === "cancelled") return "canceled";
  return DEFAULT_ORDER_STATUS;
}

export function isClosedOrderStatus(statusId) {
  const status = normalizeOrderStatus(statusId);
  return status === "completed" || status === "canceled";
}

/** Blue = not started, yellow = in progress, green = done, muted = canceled. */
export function orderStatusBadgeClass(statusId) {
  switch (normalizeOrderStatus(statusId)) {
    case "in_progress":
      return "bg-status-yellow text-night";
    case "completed":
      return "bg-status-green text-night";
    case "canceled":
      return "bg-ink/25 text-ink/80";
    case "new":
    default:
      return "bg-status-blue text-white";
  }
}

export function orderStatusHeadingClass(statusId) {
  switch (normalizeOrderStatus(statusId)) {
    case "in_progress":
      return "text-status-yellow";
    case "completed":
      return "text-status-green";
    case "canceled":
      return "text-ink/55";
    case "new":
    default:
      return "text-status-blue";
  }
}

/** True when a closed order is older than the My Orders visibility window. */
export function isOlderCompletedOrder(order) {
  if (!isClosedOrderStatus(order?.status)) return false;
  // Without a timestamp we cannot age the order — keep it visible.
  if (!order.completed_at) return false;
  const completedMs = new Date(order.completed_at).getTime();
  if (Number.isNaN(completedMs)) return false;
  const cutoffMs = COMPLETED_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - completedMs > cutoffMs;
}

export function filterOrdersByCompletedVisibility(orders) {
  return (orders ?? []).filter((order) => !isOlderCompletedOrder(order));
}

/**
 * Admin kanban closed columns: only orders closed within COMPLETED_VISIBLE_DAYS.
 * Older closed orders live on the all-orders list.
 */
export function filterClosedColumnOrders(orders) {
  return filterOrdersByCompletedVisibility(orders);
}

function timeMs(value, fallback) {
  const primary = value ? new Date(value).getTime() : NaN;
  if (!Number.isNaN(primary)) return primary;
  const secondary = fallback ? new Date(fallback).getTime() : NaN;
  return Number.isNaN(secondary) ? 0 : secondary;
}

/**
 * Column sort: relative queue_priority within the status (lower = higher).
 * Ties broken by created_at, then id.
 */
export function sortOrdersForStatusColumn(orders, _statusId) {
  return [...(orders ?? [])].sort((a, b) => {
    const ap = a.queue_priority;
    const bp = b.queue_priority;
    if (ap == null && bp != null) return 1;
    if (ap != null && bp == null) return -1;
    if (ap != null && bp != null && ap !== bp) {
      return Number(ap) - Number(bp);
    }
    const byCreated = timeMs(a.created_at) - timeMs(b.created_at);
    if (byCreated !== 0) return byCreated;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
}

/** Group orders into status buckets; preserves ORDER_STATUSES column order. */
export function groupOrdersByStatus(orders) {
  const grouped = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status.id, []]),
  );
  for (const order of orders ?? []) {
    const status = normalizeOrderStatus(order.status);
    grouped[status].push(order);
  }
  for (const status of ORDER_STATUSES) {
    grouped[status.id] = sortOrdersForStatusColumn(
      grouped[status.id],
      status.id
    );
  }
  return grouped;
}

/**
 * True when an order sits higher in `columnOrders` (already priority-sorted)
 * than it would under chronological order by display_id (lower number = older).
 */
export function isPriorityElevated(order, columnOrders) {
  const list = columnOrders ?? [];
  if (!order?.id || list.length < 2) return false;
  const actual = list.findIndex((entry) => entry.id === order.id);
  if (actual < 0) return false;
  const chronological = [...list].sort((a, b) => {
    const aId = Number(a.display_id) || 0;
    const bId = Number(b.display_id) || 0;
    if (aId !== bId) return aId - bId;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  const expected = chronological.findIndex((entry) => entry.id === order.id);
  return expected >= 0 && actual < expected;
}
