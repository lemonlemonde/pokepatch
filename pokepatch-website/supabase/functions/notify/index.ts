import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "card-photos";
// Signed URLs expire. 1 year keeps links working in Discord history / the Sheet.
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;

const deliveryLabels: Record<string, string> = {
  local_dropoff: "Local Drop-Off",
  shipping: "Shipping",
};

const contactTypeLabels: Record<string, string> = {
  phone: "Phone",
  discord: "Discord",
  instagram: "Instagram",
};

function extractFolderId(paths: string[]): string {
  if (paths.length === 0) return "";
  const first = paths[0];
  const slash = first.indexOf("/");
  return slash > 0 ? first.slice(0, slash) : "";
}

function isOrdersRecord(record: Record<string, unknown>): boolean {
  if (record.restoration_details != null) return false;
  return (
    record.customer_name != null ||
    record.display_id != null ||
    (typeof record.id === "string" && record.id.includes("-"))
  );
}

function isLegacyRecord(record: Record<string, unknown>): boolean {
  return record.restoration_details != null;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = (body.record ?? body) as Record<string, unknown>;

    if (isOrdersRecord(record)) {
      await handleOrdersInsert(record);
    } else if (isLegacyRecord(record)) {
      await handleLegacyInsert(record);
    } else {
      console.log("notify: unrecognized payload, skipping", record);
    }

    return new Response("ok");
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});

async function handleLegacyInsert(record: Record<string, unknown>) {
  const id = record.id ?? "?";
  const delivery =
    deliveryLabels[String(record.delivery_method)] ??
    String(record.delivery_method ?? "unknown");
  const contact = String(record.contact ?? "").trim();
  const details = String(record.restoration_details ?? "").trim();
  const paths: string[] = Array.isArray(record.image_paths)
    ? (record.image_paths as string[])
    : [];

  const photoUrls = await signPaths(paths);
  const folderId = extractFolderId(paths);

  await notifyDiscordLegacy({
    id,
    delivery,
    contact,
    details,
    photoCount: paths.length,
    folderId,
  });
  await notifySheetLegacy({ record, delivery, photoUrls, folderId });
}

async function handleOrdersInsert(record: Record<string, unknown>) {
  const orderUuid = String(record.id ?? "");
  const displayId = record.display_id ?? "?";
  const customerName = String(record.customer_name ?? "").trim();
  const delivery =
    deliveryLabels[String(record.delivery_method)] ??
    String(record.delivery_method ?? "unknown");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("contact_type, value")
    .eq("order_id", orderUuid);
  if (contactsError) throw contactsError;

  const { data: cards, error: cardsError } = await supabase
    .from("cards")
    .select("id")
    .eq("order_id", orderUuid);
  if (cardsError) throw cardsError;

  const cardIds = (cards ?? []).map((c) => c.id as string);
  let paths: string[] = [];

  if (cardIds.length > 0) {
    const { data: images, error: imagesError } = await supabase
      .from("card_images")
      .select("storage_path")
      .in("card_id", cardIds);
    if (imagesError) throw imagesError;
    paths = (images ?? [])
      .map((img) => img.storage_path as string)
      .filter(Boolean);
  }

  const photoUrls = await signPaths(paths, supabase);
  const contactsList = contacts ?? [];
  const storagePrefix = orderUuid ? `order-${orderUuid}` : extractFolderId(paths);

  await notifyDiscordOrder({
    displayId,
    customerName,
    delivery,
    cardCount: cardIds.length,
    contactsText: formatContacts(contactsList, "; "),
    photoCount: paths.length,
    storagePrefix,
  });

  await notifySheetOrder({
    displayId,
    orderUuid,
    createdAt: record.created_at,
    customerName,
    delivery,
    cardCount: cardIds.length,
    contactsText: formatContacts(contactsList, "\n"),
    storagePrefix,
    photoUrls,
  });
}

function formatContacts(
  contacts: { contact_type?: string; value?: string }[],
  separator: string
): string {
  return contacts
    .map((c) => {
      const label =
        contactTypeLabels[String(c.contact_type ?? "")] ??
        String(c.contact_type ?? "Contact");
      const value = String(c.value ?? "").trim();
      return value ? `${label}: ${value}` : null;
    })
    .filter(Boolean)
    .join(separator);
}

async function signPaths(
  paths: string[],
  client?: SupabaseClient
): Promise<string[]> {
  if (paths.length === 0) return [];

  let supabase = client;
  if (!supabase) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return [];
    supabase = createClient(supabaseUrl, serviceKey);
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN);
  if (error) {
    console.error("createSignedUrls error", error);
    return [];
  }
  return (data ?? [])
    .map((d) => d.signedUrl)
    .filter((u): u is string => Boolean(u));
}

async function notifyDiscordLegacy({
  id,
  delivery,
  contact,
  details,
  photoCount,
  folderId,
}: {
  id: number | string;
  delivery: string;
  contact: string;
  details: string;
  photoCount: number;
  folderId: string;
}) {
  const webhook = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhook) return;

  const sheetUrl = Deno.env.get("SHEET_VIEW_URL");

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
  if (folderId) {
    lines.push(`- **Storage folder:** \`${BUCKET}/${folderId}\``);
  }
  if (sheetUrl) {
    lines.push(`**Spreadsheet link:** ${sheetUrl}`);
  }

  await postDiscord(webhook, lines.join("\n").slice(0, 2000));
}

async function notifyDiscordOrder({
  displayId,
  customerName,
  delivery,
  cardCount,
  contactsText,
  photoCount,
  storagePrefix,
}: {
  displayId: number | string;
  customerName: string;
  delivery: string;
  cardCount: number;
  contactsText: string;
  photoCount: number;
  storagePrefix: string;
}) {
  const webhook = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!webhook) return;

  const sheetUrl = Deno.env.get("ORDERS_SHEET_VIEW_URL");

  const lines = [
    `<<--<<-- **New Order #${displayId}:** -->>-->>`,
    `- **Customer:** ${customerName || "—"}`,
    `- **Delivery:** ${delivery}`,
    `- **Cards:** ${cardCount}`,
    `- **Contact:** ${contactsText || "—"}`,
    `- **Photos:** ${photoCount} image${photoCount === 1 ? "" : "s"}`,
  ];
  if (storagePrefix) {
    lines.push(`- **Storage:** \`${BUCKET}/${storagePrefix}/\``);
  }
  if (sheetUrl) {
    lines.push(`**Spreadsheet:** ${sheetUrl}`);
  }

  await postDiscord(webhook, lines.join("\n").slice(0, 2000));
}

async function postDiscord(webhook: string, content: string) {
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    console.error("Discord error", res.status, await res.text());
  }
}

async function notifySheetLegacy({
  record,
  delivery,
  photoUrls,
  folderId,
}: {
  record: Record<string, unknown>;
  delivery: string;
  photoUrls: string[];
  folderId: string;
}) {
  const url = Deno.env.get("SHEETS_WEBHOOK_URL");
  if (!url) return;

  const secret = Deno.env.get("SHEETS_SECRET") ?? "";
  const baseRecord = {
    id: record.id,
    created_at: record.created_at,
    delivery,
    contact: record.contact,
    restoration_details: record.restoration_details,
    folder_id: folderId,
  };

  const ok = await postToSheet(url, { secret, record: baseRecord, photos: photoUrls });
  if (!ok && photoUrls.length > 0) {
    console.error("Sheets error with photo URLs, retrying without URLs");
    await postToSheet(url, { secret, record: baseRecord, photos: [] });
  }
}

async function notifySheetOrder({
  displayId,
  orderUuid,
  createdAt,
  customerName,
  delivery,
  cardCount,
  contactsText,
  storagePrefix,
  photoUrls,
}: {
  displayId: number | string;
  orderUuid: string;
  createdAt: unknown;
  customerName: string;
  delivery: string;
  cardCount: number;
  contactsText: string;
  storagePrefix: string;
  photoUrls: string[];
}) {
  const url = Deno.env.get("ORDERS_SHEETS_WEBHOOK_URL");
  if (!url) return;

  const secret = Deno.env.get("ORDERS_SHEETS_SECRET") ?? "";
  const baseRecord = {
    id: displayId,
    order_uuid: orderUuid,
    created_at: createdAt,
    customer_name: customerName,
    delivery,
    card_count: cardCount,
    contacts: contactsText,
    storage_prefix: storagePrefix,
  };

  const ok = await postToSheet(url, { secret, record: baseRecord, photos: photoUrls });
  if (!ok && photoUrls.length > 0) {
    console.error("Orders sheets error with photo URLs, retrying without URLs");
    await postToSheet(url, { secret, record: baseRecord, photos: [] });
  }
}

async function postToSheet(
  url: string,
  body: { secret: string; record: Record<string, unknown>; photos: string[] }
): Promise<boolean> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok || text.includes("<!DOCTYPE html>")) {
    console.error("Sheets error", res.status, text.slice(0, 500));
    return false;
  }

  try {
    const data = JSON.parse(text);
    if (!data.ok) {
      console.error("Sheets error", data);
      return false;
    }
    return true;
  } catch {
    console.error("Sheets error: non-JSON response", text.slice(0, 500));
    return false;
  }
}
