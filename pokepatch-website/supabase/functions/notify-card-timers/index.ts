import { getServiceClient } from "../_shared/adminSession.ts";
import { notifyDueCardTimers } from "../_shared/notifyCardTimers.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const webhook = Deno.env.get("CARD_TIMER_DISCORD_WEBHOOK_URL");
    const result = await notifyDueCardTimers(getServiceClient(), webhook);
    return Response.json(result);
  } catch (err) {
    console.error("notify-card-timers error", err);
    return new Response(String(err), { status: 500 });
  }
});
