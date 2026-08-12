import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type DueCard = {
  id: string;
  card_name: string | null;
  set_name: string | null;
};

async function postDiscord(webhook: string, content: string) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discord ${res.status}: ${await res.text()}`);
  }
}

/** Notify Discord for due in-progress card timers. Idempotent via timer_notified_at. */
export async function notifyDueCardTimers(
  supabase: SupabaseClient,
  webhook: string | null | undefined
): Promise<{
  ok: true;
  skipped?: boolean;
  reason?: string;
  due: number;
  notified: number;
  failed: number;
}> {
  if (!webhook) {
    return {
      ok: true,
      skipped: true,
      reason: "CARD_TIMER_DISCORD_WEBHOOK_URL not set",
      due: 0,
      notified: 0,
      failed: 0,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from("cards")
    .select("id, card_name, set_name")
    .eq("status", "in_progress")
    .not("timer_ends_at", "is", null)
    .is("timer_notified_at", null)
    .lte("timer_ends_at", nowIso)
    .limit(50);

  if (error) throw error;

  const cards = (due ?? []) as DueCard[];
  let notified = 0;
  let failed = 0;

  for (const card of cards) {
    const name = String(card.card_name ?? "Card").trim() || "Card";
    const setName = String(card.set_name ?? "").trim();
    const label = setName ? `${name} (${setName})` : name;
    const content = `⏱ **Timer done:** ${label}`;

    try {
      await postDiscord(webhook, content.slice(0, 2000));
      const { error: updateError } = await supabase
        .from("cards")
        .update({ timer_notified_at: nowIso })
        .eq("id", card.id)
        .is("timer_notified_at", null);
      if (updateError) throw updateError;
      notified += 1;
    } catch (err) {
      failed += 1;
      console.error("notifyDueCardTimers: failed", card.id, err);
    }
  }

  return { ok: true, due: cards.length, notified, failed };
}
