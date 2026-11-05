/**
 * Email the customer when the *order* status (or pending kind) changes.
 * Per-card status flips are noisy mid-job and must not notify.
 *
 * Keep customer-facing labels in sync with src/lib/orderStatus.js.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendCustomerEmail } from "./customerMessages.ts";
import { isOwnerOrderDisplayId } from "./ownerOrder.ts";
import type { ChangelogPayload } from "./resend.ts";

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export type OrderStatusSnapshot = {
  id: string;
  display_id: number | string;
  status: string | null;
  pending_kind: string | null;
  delivery_method: string | null;
  customer_email: string | null;
  user_id: string | null;
};

const ORDER_STATUS_COLUMNS =
  "id, display_id, status, pending_kind, delivery_method, customer_email, user_id";

function normalizeOrderStatus(value: unknown): string {
  const status = String(value ?? "").trim().toLowerCase();
  if (
    status === "on_hold" ||
    status === "pending_quote" ||
    status === "pending_dropoff"
  ) {
    return "pending";
  }
  if (status === "todo") return "new";
  if (status === "ready_for_customer") return "ready";
  if (status === "delivered") return "completed";
  if (status === "cancelled") return "canceled";
  if (
    status === "pending" ||
    status === "new" ||
    status === "in_progress" ||
    status === "ready" ||
    status === "completed" ||
    status === "canceled"
  ) {
    return status;
  }
  return "new";
}

function normalizePendingKind(value: unknown): string | null {
  const kind = String(value ?? "").trim().toLowerCase();
  if (kind === "drop_off") return "drop_off";
  if (kind === "quote") return "quote";
  return null;
}

export function customerOrderStatusLabel(
  statusId: unknown,
  pendingKind: unknown = null,
  deliveryMethod: unknown = null,
): string {
  const status = normalizeOrderStatus(statusId);
  if (status === "pending") {
    return normalizePendingKind(pendingKind) === "drop_off"
      ? "Pending drop-off"
      : "Pending quote";
  }
  if (status === "ready") {
    return String(deliveryMethod ?? "").trim() === "shipping"
      ? "Ready to ship"
      : "Ready for pickup";
  }
  if (status === "new") return "In queue";
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "canceled") return "Canceled";
  return status;
}

function displayIdNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function snapshotFromOrderRow(
  row: object | null | undefined,
): OrderStatusSnapshot | null {
  if (!row || !("id" in row) || (row as { id?: unknown }).id == null) {
    return null;
  }
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id),
    display_id: (record.display_id as number | string | null) ?? "",
    status: record.status == null ? null : String(record.status),
    pending_kind:
      record.pending_kind == null ? null : String(record.pending_kind),
    delivery_method:
      record.delivery_method == null ? null : String(record.delivery_method),
    customer_email:
      record.customer_email == null ? null : String(record.customer_email),
    user_id: record.user_id == null ? null : String(record.user_id),
  };
}

function pendingKindForStatus(
  status: string,
  pendingKind: unknown,
): string | null {
  if (status !== "pending") return null;
  return normalizePendingKind(pendingKind) ?? "quote";
}

function labelForSnapshot(snapshot: OrderStatusSnapshot): string {
  const status = normalizeOrderStatus(snapshot.status);
  return customerOrderStatusLabel(
    status,
    pendingKindForStatus(status, snapshot.pending_kind),
    snapshot.delivery_method,
  );
}

function statusChangeLine(fromLabel: string, toLabel: string): string {
  return `Status: ${fromLabel} → ${toLabel}`;
}

export async function loadOrderStatusSnapshot(
  supabase: SupabaseClient,
  orderId: string,
): Promise<OrderStatusSnapshot | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_STATUS_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return snapshotFromOrderRow(data);
}

function changelogHasStatusLine(
  changelog: unknown,
  fromLabel: string,
  toLabel: string,
): boolean {
  if (!changelog || typeof changelog !== "object") return false;
  const orderChanges = (changelog as { orderChanges?: unknown }).orderChanges;
  if (!Array.isArray(orderChanges)) return false;
  const expected = statusChangeLine(fromLabel, toLabel).toLowerCase();
  return orderChanges.some(
    (line) => String(line ?? "").trim().toLowerCase() === expected,
  );
}

/**
 * pending quote → canceled is emailed by cancel-stale-quotes (cron) or the
 * admin editor save dialog (forced notify). Skip the generic auto email there.
 * Kanban Move only is skipped earlier via update_order_kanban.
 */
function shouldSkipAutomaticOrderStatusEmail(
  from: OrderStatusSnapshot,
  to: OrderStatusSnapshot,
): string | null {
  const displayId = displayIdNumber(to.display_id ?? from.display_id);
  if (displayId != null && isOwnerOrderDisplayId(displayId)) {
    return "owner portfolio";
  }

  if (labelForSnapshot(from) === labelForSnapshot(to)) return "unchanged";

  if (
    normalizeOrderStatus(from.status) === "pending" &&
    normalizeOrderStatus(to.status) === "canceled"
  ) {
    return "pending_canceled";
  }

  return null;
}

async function alreadyNotifiedRecently(
  supabase: SupabaseClient,
  orderId: string,
  fromLabel: string,
  toLabel: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("customer_messages")
    .select("id, changelog")
    .eq("order_id", orderId)
    .in("email_status", ["pending", "sent"])
    .gte("created_at", since)
    .limit(20);
  if (error) {
    console.error("order-status notify: dedupe lookup failed", error);
    return false;
  }
  return (data ?? []).some((row) =>
    changelogHasStatusLine(row.changelog, fromLabel, toLabel),
  );
}

async function notifyOrderStatusIfChanged(
  supabase: SupabaseClient,
  from: OrderStatusSnapshot | null | undefined,
  to: OrderStatusSnapshot | null | undefined,
): Promise<{ sent: boolean; skipped?: string; error?: string }> {
  if (!from || !to) return { sent: false, skipped: "missing_snapshot" };

  const skip = shouldSkipAutomaticOrderStatusEmail(from, to);
  if (skip) return { sent: false, skipped: skip };

  const email = String(to.customer_email ?? "").trim().toLowerCase();
  if (!email) return { sent: false, skipped: "no_email" };

  const fromLabel = labelForSnapshot(from);
  const toLabel = labelForSnapshot(to);
  if (await alreadyNotifiedRecently(supabase, to.id, fromLabel, toLabel)) {
    return { sent: false, skipped: "already_notified" };
  }

  const changelog: ChangelogPayload = {
    orderChanges: [statusChangeLine(fromLabel, toLabel)],
  };
  const lowered = toLabel.toLowerCase();
  const subject =
    lowered.startsWith("ready for pickup") || lowered.startsWith("ready to ship")
      ? `Your order is ${lowered}`
      : `Your order is now ${lowered}`;

  const result = await sendCustomerEmail({
    supabase,
    orderId: to.id,
    orderDisplayId: to.display_id,
    to: email,
    userId: to.user_id,
    subject,
    body: "",
    changelog,
  });
  if (!result.ok) return { sent: false, error: result.error };
  return { sent: true };
}

export async function notifyOrderStatusAfterChange(
  supabase: SupabaseClient,
  orderId: string,
  from: OrderStatusSnapshot | null | undefined,
): Promise<{ sent: boolean; skipped?: string; error?: string }> {
  const to = await loadOrderStatusSnapshot(supabase, orderId);
  return notifyOrderStatusIfChanged(supabase, from, to);
}
