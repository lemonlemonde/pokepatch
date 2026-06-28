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
    const headline = `New Quote Request #${id}: ${delivery}, ${photoCount} image${
      photoCount === 1 ? "" : "s"
    }, ${contact || "no contact"}`;

    await notifyDiscord({ headline, details, photoUrls });
    await notifySheet({ record, delivery, photoUrls });

    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});

async function notifyDiscord({
  headline,
  details,
  photoUrls,
}: {
  headline: string;
  details: string;
  photoUrls: string[];
}) {
  const webhook = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhook) return;

  const links =
    photoUrls.length > 0
      ? photoUrls.map((url, i) => `[Photo ${i + 1}](${url})`).join(" · ")
      : "No photos";

  const description = [
    details ? `**Details:** ${details.slice(0, 1500)}` : null,
    `**Photos:** ${links}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{ title: headline, description }],
    }),
  });
  if (!res.ok) console.error("Discord error", await res.text());
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
