import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceClient } from "../_shared/adminSession.ts";
import {
  buildStoredMessageBody,
  sendResendEmail,
  type ChangelogPayload,
} from "../_shared/resend.ts";

const CANCEL_SUBJECT = "Your quote request was canceled";
const CONTACT_EMAIL = "pokepatch.cards@gmail.com";
const CONTACT_INSTAGRAM = "@pokepatch.cards";
const CONTACT_DISCORD = "pokepatch.cards";

type CanceledOrder = {
  id: string;
  display_id: number | string;
  customer_email: string;
  user_id: string | null;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildCancelBody(): string {
  return (
    `Your restoration quote request has been canceled because it ` +
    `remained in our pending queue for over 14 days without moving forward.\n\n` +
    `If you'd still like a quote, you're welcome to submit a new request at ` +
    `pokepatch.cards anytime.\n\n` +
    `Questions? Reach us at:\n` +
    `- Email: ${CONTACT_EMAIL}\n` +
    `- Instagram: ${CONTACT_INSTAGRAM}\n` +
    `- Discord: ${CONTACT_DISCORD}`
  );
}

const cancelChangelog: ChangelogPayload = {
  orderChanges: ["Status: Pending quote → Canceled"],
};

function parseCanceledOrders(data: unknown): CanceledOrder[] {
  if (Array.isArray(data)) return data as CanceledOrder[];
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? (parsed as CanceledOrder[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function sendCancelNotification(
  supabase: SupabaseClient,
  order: CanceledOrder
): Promise<{ ok: boolean; error?: string }> {
  const email = String(order.customer_email ?? "").trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return { ok: false, error: "no valid customer_email" };
  }

  const { data: existing, error: existingError } = await supabase
    .from("customer_messages")
    .select("id")
    .eq("order_id", order.id)
    .eq("subject", CANCEL_SUBJECT)
    .in("email_status", ["pending", "sent"])
    .limit(1);
  if (existingError) {
    return { ok: false, error: existingError.message };
  }
  if ((existing?.length ?? 0) > 0) {
    return { ok: true };
  }

  const messageBody = buildCancelBody();
  const storedBody = buildStoredMessageBody(messageBody, order.display_id);
  const batchId = crypto.randomUUID();

  const { data: inserted, error: insertError } = await supabase
    .from("customer_messages")
    .insert({
      order_id: order.id,
      recipient_email: email,
      user_id: order.user_id,
      subject: CANCEL_SUBJECT,
      body: storedBody,
      changelog: cancelChangelog,
      email_status: "pending",
      batch_id: batchId,
    })
    .select("id")
    .single();

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  const sendResult = await sendResendEmail({
    to: email,
    subject: CANCEL_SUBJECT,
    body: messageBody,
    orderDisplayId: order.display_id,
    changelog: cancelChangelog,
  });

  const emailStatus = sendResult.ok ? "sent" : "failed";
  const emailError = sendResult.ok ? null : sendResult.error;

  const { error: updateError } = await supabase
    .from("customer_messages")
    .update({ email_status: emailStatus, email_error: emailError })
    .eq("id", inserted.id as string);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }
  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("cancel_stale_pending_quotes");
    if (error) throw error;

    const canceled = parseCanceledOrders(data);
    let notified = 0;
    let failed = 0;

    for (const order of canceled) {
      const result = await sendCancelNotification(supabase, order);
      if (result.ok) {
        notified += 1;
      } else {
        failed += 1;
        console.error(
          "cancel-stale-quotes: notify failed",
          order.id,
          result.error
        );
      }
    }

    return Response.json({
      ok: true,
      canceled: canceled.length,
      notified,
      failed,
    });
  } catch (err) {
    console.error("cancel-stale-quotes error", err);
    return new Response(String(err), { status: 500 });
  }
});
