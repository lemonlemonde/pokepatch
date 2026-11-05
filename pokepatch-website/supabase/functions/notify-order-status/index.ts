/**
 * Customer email when `orders.status` / `pending_kind` changes.
 *
 * Fired by the `orders_status_notify_customer` trigger (pg_net). ACK quickly
 * and finish in the background — same pattern as `notify` on INSERT.
 *
 * Does **not** post to Discord. Admin quote/note emails stay on Save & notify.
 */

import { getServiceClient } from "../_shared/adminSession.ts";
import {
  notifyOrderStatusAfterChange,
  snapshotFromOrderRow,
} from "../_shared/orderStatusNotify.ts";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = asRecord(body.record) ?? asRecord(body);
    const oldRecord = asRecord(body.old_record) ?? asRecord(body.old);
    if (!record) {
      console.log("notify-order-status: missing record, skipping");
      return new Response("ok");
    }

    EdgeRuntime.waitUntil(
      handleStatusChange(oldRecord, record).catch((err) => {
        console.error("notify-order-status: failed", err);
      }),
    );
    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});

async function handleStatusChange(
  oldRecord: Record<string, unknown> | null,
  record: Record<string, unknown>,
): Promise<void> {
  const from = snapshotFromOrderRow(oldRecord);
  const to = snapshotFromOrderRow(record);
  if (!to) return;

  const supabase = getServiceClient();
  const result = from
    ? await notifyOrderStatusAfterChange(supabase, to.id, from)
    : { sent: false, skipped: "missing_old_record" as const };
  if (result.error) {
    console.error("notify-order-status: send failed", to.id, result.error);
    return;
  }
  if (result.skipped) {
    console.log("notify-order-status: skipped", to.id, result.skipped);
    return;
  }
  if (result.sent) {
    console.log("notify-order-status: emailed", to.id, to.display_id);
  }
}
