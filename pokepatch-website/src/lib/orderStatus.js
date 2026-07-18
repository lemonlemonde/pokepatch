export const ORDER_STATUSES = [
  { id: "new", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "canceled", label: "Canceled" },
];

/** Statuses shown on the admin board by default. */
export const ACTIVE_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status) => status.id === "new" || status.id === "in_progress"
);

/** Closed statuses — drop targets on admin; cards older than 7 days need Show all. */
export const CLOSED_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status) => status.id === "completed" || status.id === "canceled"
);

export const DEFAULT_ORDER_STATUS = "new";

/** Closed orders older than this are hidden by default. */
export const COMPLETED_VISIBLE_DAYS = 7;

const LABEL_BY_ID = Object.fromEntries(
  ORDER_STATUSES.map((status) => [status.id, status.label]),
);

export function orderStatusLabel(statusId) {
  return LABEL_BY_ID[normalizeOrderStatus(statusId)] ?? LABEL_BY_ID[DEFAULT_ORDER_STATUS];
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

/** Red = not started, yellow = in progress, green = done, muted = canceled. */
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
      return "bg-status-red text-night";
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
      return "text-status-red";
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

export function filterClosedColumnOrders(orders, showAllClosed = false) {
  if (showAllClosed) return orders ?? [];
  return filterOrdersByCompletedVisibility(orders);
}

function timeMs(value, fallback) {
  const primary = value ? new Date(value).getTime() : NaN;
  if (!Number.isNaN(primary)) return primary;
  const secondary = fallback ? new Date(fallback).getTime() : NaN;
  return Number.isNaN(secondary) ? 0 : secondary;
}

/**
 * Column sort: oldest at top, newest at bottom.
 * - To do: when submitted (created_at)
 * - In progress: when moved into in progress (status_changed_at)
 * - Completed / canceled: when closed (completed_at)
 */
export function sortOrdersForStatusColumn(orders, statusId) {
  const status = normalizeOrderStatus(statusId);
  return [...(orders ?? [])].sort((a, b) => {
    if (status === "new") {
      return timeMs(a.created_at) - timeMs(b.created_at);
    }
    if (status === "in_progress") {
      return (
        timeMs(a.status_changed_at, a.created_at) -
        timeMs(b.status_changed_at, b.created_at)
      );
    }
    return (
      timeMs(a.completed_at, a.status_changed_at || a.created_at) -
      timeMs(b.completed_at, b.status_changed_at || b.created_at)
    );
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
