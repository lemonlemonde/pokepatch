export const ORDER_STATUSES = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
  { id: "delivered", label: "Delivered" },
];

export const DEFAULT_ORDER_STATUS = "todo";

const LABEL_BY_ID = Object.fromEntries(
  ORDER_STATUSES.map((status) => [status.id, status.label]),
);

export function orderStatusLabel(statusId) {
  return LABEL_BY_ID[statusId] ?? LABEL_BY_ID[DEFAULT_ORDER_STATUS];
}

export function normalizeOrderStatus(statusId) {
  if (statusId && LABEL_BY_ID[statusId]) return statusId;
  // Legacy value before the todo rename.
  if (statusId === "new") return DEFAULT_ORDER_STATUS;
  return DEFAULT_ORDER_STATUS;
}

/** Red = not started, yellow = in progress, green = done. */
export function orderStatusBadgeClass(statusId) {
  switch (normalizeOrderStatus(statusId)) {
    case "in_progress":
      return "bg-sun text-night";
    case "completed":
    case "delivered":
      return "bg-mint text-night";
    case "todo":
    default:
      return "bg-berry text-night";
  }
}

export function orderStatusHeadingClass(statusId) {
  switch (normalizeOrderStatus(statusId)) {
    case "in_progress":
      return "text-sun";
    case "completed":
    case "delivered":
      return "text-mint";
    case "todo":
    default:
      return "text-berry";
  }
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
  return grouped;
}
