import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "card-photos";
// Signed URLs expire. 1 year keeps links working in Discord history / the Sheet.
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;

const deliveryLabels: Record<string, string> = {
  local_dropoff: "Local Drop-Off",
  shipping: "Shipping",
};

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = body.record ?? body;

    const id = record.id ?? "?";
    const delivery =
      deliveryLabels[record.delivery_method] ?? record.delivery_method ?? "unknown";
    const contact = String(record.contact ?? "").trim();
    const details = String(record.restoration_details ?? "").trim();
    const paths: string[] = Array.isArray(record.image_paths)
      ? record.image_paths
      : [];

    // Sign each image path with the service role key (server-side only).
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let photoUrls: string[] = [];

    if (supabaseUrl && serviceKey && paths.length > 0) {
      const supabase = createClient(supabaseUrl, serviceKey);
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN);
      if (error) {
        console.error("createSignedUrls error", error);
      } else {
        photoUrls = (data ?? [])
          .map((d) => d.signedUrl)
          .filter((u): u is string => Boolean(u));
      }
    }

    const photoCount = paths.length;

    await notifyDiscord({
      id,
      delivery,
      contact,
      details,
      photoCount,
      photoUrls,
    });
    await notifySheet({ record, delivery, photoUrls });

    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});

async function notifyDiscord({
  id,
  delivery,
  contact,
  details,
  photoCount,
}: {
  id: number | string;
  delivery: string;
  contact: string;
  details: string;
  photoCount: number;
  photoUrls: string[];
}) {
  const webhook = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhook) return;

  const sheetUrl = Deno.env.get("SHEET_VIEW_URL");

  // Discord's content field maxes out at 2000 chars. Keep details bounded so a
  // long entry can't push the whole message over the limit and fail to send.
  const safeDetails = details
    ? details.length > 1200
      ? `${details.slice(0, 1200)}… (see spreadsheet)`
      : details
    : "—";

  const lines = [
    `<<--<<-- **New Quote Request #${id}:** -->>-->>`,
    `- **Delivery Method:** ${delivery}`,
    `- **Photo Count:** ${photoCount} image${photoCount === 1 ? "" : "s"}`,
    `- **Contact:** ${contact || "—"}`,
    `- **Details:** ${safeDetails}`,
  ];
  if (sheetUrl) {
    lines.push(`**Spreadsheet link:** ${sheetUrl}`);
  }

  const content = lines.join("\n").slice(0, 2000);

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    console.error("Discord error", res.status, await res.text());
  }
}

async function notifySheet({
  record,
  delivery,
  photoUrls,
}: {
  record: Record<string, unknown>;
  delivery: string;
  photoUrls: string[];
}) {
  const url = Deno.env.get("SHEETS_WEBHOOK_URL");
  if (!url) return;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: Deno.env.get("SHEETS_SECRET") ?? "",
      record: {
        id: record.id,
        created_at: record.created_at,
        delivery,
        contact: record.contact,
        restoration_details: record.restoration_details,
      },
      photos: photoUrls,
    }),
  });
  if (!res.ok) console.error("Sheets error", await res.text());
}
