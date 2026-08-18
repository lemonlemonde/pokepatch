export const ORDER_STATUSES = [
  { id: "pending", label: "Pending" },
  { id: "new", label: "To do", customerLabel: "In queue" },
  { id: "in_progress", label: "In progress" },
  {
    id: "ready",
    label: "Ready for customer",
    customerLabel: "Ready for pickup",
  },
  { id: "completed", label: "Completed", customerLabel: "Completed" },
  { id: "canceled", label: "Canceled" },
];

/** Chip / customer labels for orders.status = pending. */
export const PENDING_KINDS = [
  { id: "quote", label: "Pending quote", shortLabel: "quote" },
  { id: "drop_off", label: "Pending drop-off", shortLabel: "drop-off" },
];

/** Per-card workflow status (independent from order status; uses `todo` not `new`). */
export const CARD_STATUSES = [
  { id: "todo", label: "To do", customerLabel: "In queue" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "canceled", label: "Canceled" },
];

export const DEFAULT_CARD_STATUS = "todo";
export const DEFAULT_PENDING_KIND = "quote";

/**
 * Per-card admin workflow checklist. Purely informal — manual toggles only,
 * never auto-set/reset and never gates card status or anything else.
 */
export const CARD_CHECKLIST_GROUPS = [
  {
    id: "before",
    label: "Before",
    items: [
      { id: "before_scans", label: "Scans" },
      { id: "before_closeup_photos", label: "Closeups" },
    ],
  },
  {
    id: "after",
    label: "After",
    items: [
      { id: "after_scans", label: "Scans" },
      { id: "after_closeup_photos", label: "Closeups" },
    ],
  },
  {
    id: "social",
    label: "Social",
    items: [
      { id: "post_gallery", label: "Gallery" },
      { id: "post_instagram", label: "Instagram" },
    ],
  },
];

const CARD_CHECKLIST_ITEM_IDS = CARD_CHECKLIST_GROUPS.flatMap((group) =>
  group.items.map((item) => item.id),
);

export function normalizeCardChecklist(checklist) {
  const source = checklist && typeof checklist === "object" ? checklist : {};
  return Object.fromEntries(
    CARD_CHECKLIST_ITEM_IDS.map((id) => [id, source[id] === true]),
  );
}

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

/**
 * Matches update_order auto-advance from card statuses (skipped when the admin
 * manually changed order status on the same save):
 * - every card completed → ready
 * - else any card in_progress → in_progress
 * The reverse (order → ready marks cards completed) is a DB trigger.
 * Returns null when no auto change applies.
 */
export function orderStatusFromCardStatuses(orderStatus, cards) {
  const list = cards ?? [];
  if (list.length === 0) return null;
  const status = normalizeOrderStatus(orderStatus);
  if (status === "ready" || status === "completed" || status === "canceled") {
    return null;
  }
  if (list.every((card) => normalizeCardStatus(card.status) === "completed")) {
    return "ready";
  }
  if (
    list.some((card) => normalizeCardStatus(card.status) === "in_progress") &&
    status !== "in_progress"
  ) {
    return "in_progress";
  }
  return null;
}

/** Active cards → completed; canceled unchanged. Mirrors orders_complete_cards_when_ready. */
export function markActiveCardsCompleted(cards) {
  return (cards ?? []).map((card) =>
    normalizeCardStatus(card.status) === "canceled"
      ? card
      : { ...card, status: "completed" }
  );
}

export function orderStatusManuallyChanged(beforeDraft, afterDraft) {
  if (!beforeDraft || !afterDraft) return false;
  return (
    normalizeOrderStatus(beforeDraft.status) !==
    normalizeOrderStatus(afterDraft.status)
  );
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

/** Main kanban row: pending, active work, and awaiting customer pickup. */
export const ACTIVE_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status) =>
    status.id === "pending" ||
    status.id === "new" ||
    status.id === "in_progress" ||
    status.id === "ready"
);

/** Closed statuses (completed + canceled). */
export const CLOSED_ORDER_STATUSES = ORDER_STATUSES.filter(
  (status) => status.id === "completed" || status.id === "canceled"
);

/** Picked-up orders dock beside canceled / delete (not on the main row). */
export const COMPLETED_ORDER_STATUS = ORDER_STATUSES.find(
  (status) => status.id === "completed"
);

/** Canceled column docks next to the recycling bin. */
export const CANCELED_ORDER_STATUS = ORDER_STATUSES.find(
  (status) => status.id === "canceled"
);

/** Fallback for unknown status ids (not the new-order default). */
export const DEFAULT_ORDER_STATUS = "new";

/** Closed orders older than this are hidden on the admin kanban only. */
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

const PENDING_KIND_LABEL_BY_ID = Object.fromEntries(
  PENDING_KINDS.map((kind) => [kind.id, kind.label]),
);

export function normalizePendingKind(kindId) {
  if (kindId && PENDING_KIND_LABEL_BY_ID[kindId]) return kindId;
  return DEFAULT_PENDING_KIND;
}

export function pendingKindLabel(kindId) {
  return (
    PENDING_KIND_LABEL_BY_ID[normalizePendingKind(kindId)] ??
    PENDING_KIND_LABEL_BY_ID[DEFAULT_PENDING_KIND]
  );
}

const PENDING_KIND_SHORT_LABEL_BY_ID = Object.fromEntries(
  PENDING_KINDS.map((kind) => [kind.id, kind.shortLabel ?? kind.label]),
);

/** Compact kanban chip label (e.g. "quote" / "drop-off"). */
export function pendingKindShortLabel(kindId) {
  const kind = normalizePendingKind(kindId);
  return (
    PENDING_KIND_SHORT_LABEL_BY_ID[kind] ??
    PENDING_KIND_SHORT_LABEL_BY_ID[DEFAULT_PENDING_KIND]
  );
}

/** Peach = quote, sky = drop-off. */
export function pendingKindBadgeClass(kindId) {
  switch (normalizePendingKind(kindId)) {
    case "drop_off":
      return "bg-sky text-night";
    case "quote":
    default:
      return "bg-peach text-night";
  }
}

export function orderStatusLabel(statusId) {
  return LABEL_BY_ID[normalizeOrderStatus(statusId)] ?? LABEL_BY_ID[DEFAULT_ORDER_STATUS];
}

/**
 * Display label for admin/customer chips.
 * Pending orders use the kind label (Pending quote / Pending drop-off).
 */
export function orderDisplayLabel(statusId, pendingKind = null) {
  const status = normalizeOrderStatus(statusId);
  if (status === "pending") return pendingKindLabel(pendingKind);
  return orderStatusLabel(status);
}

/** Customer-facing label (e.g. "In queue" instead of admin "To do"). */
export function customerOrderStatusLabel(
  statusId,
  pendingKind = null,
  deliveryMethod = null,
) {
  const status = normalizeOrderStatus(statusId);
  if (status === "pending") return pendingKindLabel(pendingKind);
  if (status === "ready") {
    return deliveryMethod === "shipping"
      ? "Ready to ship"
      : "Ready for pickup";
  }
  return (
    CUSTOMER_LABEL_BY_ID[status] ??
    LABEL_BY_ID[status] ??
    CUSTOMER_LABEL_BY_ID[DEFAULT_ORDER_STATUS]
  );
}

export function normalizeOrderStatus(statusId) {
  if (statusId && LABEL_BY_ID[statusId]) return statusId;
  // Legacy values from earlier status schemes.
  if (
    statusId === "on_hold" ||
    statusId === "pending_quote" ||
    statusId === "pending_dropoff"
  ) {
    return "pending";
  }
  if (statusId === "todo") return DEFAULT_ORDER_STATUS;
  if (statusId === "ready_for_customer") return "ready";
  if (statusId === "delivered") return "completed";
  if (statusId === "cancelled") return "canceled";
  return DEFAULT_ORDER_STATUS;
}

export function isPendingOrderStatus(statusId) {
  return normalizeOrderStatus(statusId) === "pending";
}

export function isClosedOrderStatus(statusId) {
  const status = normalizeOrderStatus(statusId);
  return status === "completed" || status === "canceled";
}

/**
 * Blue = not started, peach/sky = pending (by kind), yellow = in progress,
 * mint = ready, green = picked up, muted = canceled.
 */
export function orderStatusBadgeClass(statusId, pendingKind = null) {
  switch (normalizeOrderStatus(statusId)) {
    case "pending":
      return pendingKindBadgeClass(pendingKind);
    case "in_progress":
      return "bg-status-yellow text-night";
    case "ready":
      return "bg-mint text-night";
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
    case "pending":
      return "text-peach";
    case "in_progress":
      return "text-status-yellow";
    case "ready":
      return "text-mint";
    case "completed":
      return "text-status-green";
    case "canceled":
      return "text-ink/55";
    case "new":
    default:
      return "text-status-blue";
  }
}

/** True when a closed order is older than the admin kanban visibility window. */
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
 * Column sort:
 * - completed: most recently completed first (completed_at, then
 *   status_changed_at / created_at)
 * - other statuses: paid priority first, then earliest status_changed_at
 *   (when the order entered this column). created_at / id are tiebreakers.
 */
export function sortOrdersForStatusColumn(orders, statusId) {
  const completedColumn = normalizeOrderStatus(statusId) === "completed";

  return [...(orders ?? [])].sort((a, b) => {
    if (completedColumn) {
      const byCompleted =
        timeMs(b.completed_at, b.status_changed_at) -
        timeMs(a.completed_at, a.status_changed_at);
      if (byCompleted !== 0) return byCompleted;
      const byCreated = timeMs(b.created_at) - timeMs(a.created_at);
      if (byCreated !== 0) return byCreated;
      return String(b.id ?? "").localeCompare(String(a.id ?? ""));
    }

    const aPriority = Boolean(a.is_priority);
    const bPriority = Boolean(b.is_priority);
    if (aPriority !== bPriority) return aPriority ? -1 : 1;

    const byChanged =
      timeMs(a.status_changed_at, a.created_at) -
      timeMs(b.status_changed_at, b.created_at);
    if (byChanged !== 0) return byChanged;
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
      status.id,
    );
  }
  return grouped;
}

/**
 * Editor / move-dialog status options.
 * Pending is split into quote vs drop-off choices.
 */
export const EDITOR_STATUS_OPTIONS = [
  { value: "pending:quote", status: "pending", pendingKind: "quote", label: "Pending quote" },
  {
    value: "pending:drop_off",
    status: "pending",
    pendingKind: "drop_off",
    label: "Pending drop-off",
  },
  { value: "new", status: "new", pendingKind: null, label: "To do" },
  {
    value: "in_progress",
    status: "in_progress",
    pendingKind: null,
    label: "In progress",
  },
  {
    value: "ready",
    status: "ready",
    pendingKind: null,
    label: "Ready for customer",
  },
  {
    value: "completed",
    status: "completed",
    pendingKind: null,
    label: "Completed",
  },
  { value: "canceled", status: "canceled", pendingKind: null, label: "Canceled" },
];

export function editorStatusValue(statusId, pendingKind = null) {
  const status = normalizeOrderStatus(statusId);
  if (status === "pending") {
    return `pending:${normalizePendingKind(pendingKind)}`;
  }
  return status;
}

export function parseEditorStatusValue(value) {
  const raw = String(value ?? "");
  if (raw.startsWith("pending:")) {
    return {
      status: "pending",
      pendingKind: normalizePendingKind(raw.slice("pending:".length)),
    };
  }
  const status = normalizeOrderStatus(raw);
  return {
    status,
    pendingKind: status === "pending" ? DEFAULT_PENDING_KIND : null,
  };
}
