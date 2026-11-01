/**
 * Send one customer email and log it in `customer_messages` (pending → sent /
 * failed). Shared by `notify` (confirmation) and `discord-interactions`
 * (Save & notify) so both write the same history rows the admin UI reads.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildStoredMessageBody,
  sendResendEmail,
  type ChangelogPayload,
} from "./resend.ts";

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function sendCustomerEmail(params: {
  supabase: SupabaseClient;
  orderId: string;
  orderDisplayId: number | string;
  to: string;
  userId: string | null;
  subject: string;
  body: string;
  changelog?: ChangelogPayload | null;
}): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const { supabase, orderId, orderDisplayId, userId, subject, body, changelog } = params;
  const email = params.to.trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return { ok: false, error: "order has no valid customer_email" };
  }

  // `sender` defaults to 'admin' in the DB — omitted on purpose.
  const { data: inserted, error: insertError } = await supabase
    .from("customer_messages")
    .insert({
      order_id: orderId,
      recipient_email: email,
      user_id: userId,
      subject,
      body: buildStoredMessageBody(body, orderDisplayId),
      changelog: changelog ?? null,
      email_status: "pending",
      batch_id: crypto.randomUUID(),
    })
    .select("id")
    .single();
  if (insertError) return { ok: false, error: insertError.message };

  const sendResult = await sendResendEmail({
    to: email,
    subject,
    body,
    orderDisplayId,
    changelog: changelog ?? null,
  });

  const { error: updateError } = await supabase
    .from("customer_messages")
    .update({
      email_status: sendResult.ok ? "sent" : "failed",
      email_error: sendResult.ok ? null : sendResult.error,
    })
    .eq("id", inserted.id);
  if (updateError) {
    console.error("customer_messages status update failed", updateError);
  }

  return sendResult.ok ? { ok: true, email } : { ok: false, error: sendResult.error };
}
