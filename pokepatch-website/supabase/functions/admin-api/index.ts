import {
  getAdminToken,
  handleOptions,
  jsonResponse,
} from "../_shared/adminCors.ts";
import { getServiceClient, requireSession } from "../_shared/adminSession.ts";

const BUCKET = "card-photos";
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;
const ADMIN_IMAGE_TYPES = new Set([
  "progress_front",
  "progress_back",
  "final_front",
  "final_back",
  "admin",
]);

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function rpcErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) {
      return record.message;
    }
    if (typeof record.details === "string" && record.details) {
      return record.details;
    }
    if (typeof record.hint === "string" && record.hint) {
      return record.hint;
    }
  }
  return String(err);
}

async function signPaths(
  supabase: ReturnType<typeof getServiceClient>,
  paths: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN);
  if (error) {
    console.error("createSignedUrls error", error);
    return map;
  }
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) {
      map.set(item.path, item.signedUrl);
    }
  }
  return map;
}

async function fetchOrderListSummary(supabase: ReturnType<typeof getServiceClient>) {
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, display_id, created_at, customer_name, delivery_method, status"
    )
    .order("created_at", { ascending: false });
  if (ordersError) throw ordersError;
  if (!orders?.length) return [];

  const orderIds = orders.map((o) => o.id as string);
  const { data: cards, error: cardsError } = await supabase
    .from("cards")
    .select("order_id")
    .in("order_id", orderIds);
  if (cardsError) throw cardsError;

  const countByOrder = new Map<string, number>();
  for (const card of cards ?? []) {
    const orderId = card.order_id as string;
    countByOrder.set(orderId, (countByOrder.get(orderId) ?? 0) + 1);
  }

  return orders.map((order) => ({
    ...order,
    card_count: countByOrder.get(order.id as string) ?? 0,
  }));
}

async function fetchOrderGraph(
  supabase: ReturnType<typeof getServiceClient>,
  orderId?: string
) {
  let ordersQuery = supabase
    .from("orders")
    .select(
      "id, display_id, created_at, customer_name, delivery_method, general_notes, status"
    )
    .order("created_at", { ascending: false });

  if (orderId) {
    ordersQuery = ordersQuery.eq("id", orderId);
  }

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) throw ordersError;
  if (!orders?.length) return orderId ? null : [];

  const orderIds = orders.map((o) => o.id as string);

  const [
    { data: contacts, error: contactsError },
    { data: cards, error: cardsError },
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, order_id, contact_type, value")
      .in("order_id", orderIds),
    supabase
      .from("cards")
      .select("id, order_id, card_name, set_name, description")
      .in("order_id", orderIds),
  ]);
  if (contactsError) throw contactsError;
  if (cardsError) throw cardsError;

  const cardIds = (cards ?? []).map((c) => c.id as string);
  let images: { id: number; card_id: string; image_type: string; storage_path: string }[] = [];
  if (cardIds.length > 0) {
    const { data: imageRows, error: imagesError } = await supabase
      .from("card_images")
      .select("id, card_id, image_type, storage_path")
      .in("card_id", cardIds);
    if (imagesError) throw imagesError;
    images = imageRows ?? [];
  }

  const paths = images.map((img) => img.storage_path);
  const signedMap = await signPaths(supabase, paths);

  const contactsByOrder = new Map<string, typeof contacts>();
  for (const c of contacts ?? []) {
    const list = contactsByOrder.get(c.order_id as string) ?? [];
    list.push(c);
    contactsByOrder.set(c.order_id as string, list);
  }

  const cardsByOrder = new Map<string, typeof cards>();
  for (const card of cards ?? []) {
    const list = cardsByOrder.get(card.order_id as string) ?? [];
    list.push(card);
    cardsByOrder.set(card.order_id as string, list);
  }

  const imagesByCard = new Map<string, typeof images>();
  for (const img of images) {
    const list = imagesByCard.get(img.card_id) ?? [];
    list.push(img);
    imagesByCard.set(img.card_id, list);
  }

  const enriched = orders.map((order) => ({
    ...order,
    contacts: contactsByOrder.get(order.id as string) ?? [],
    cards: (cardsByOrder.get(order.id as string) ?? []).map((card) => ({
      ...card,
      images: (imagesByCard.get(card.id as string) ?? []).map((img) => ({
        ...img,
        signed_url: signedMap.get(img.storage_path) ?? null,
      })),
    })),
  }));

  return orderId ? enriched[0] ?? null : enriched;
}

async function handleUpload(
  req: Request,
  supabase: ReturnType<typeof getServiceClient>
) {
  const form = await req.formData();
  const orderId = String(form.get("order_id") ?? "");
  const cardId = String(form.get("card_id") ?? "");
  const imageType = String(form.get("image_type") ?? "");
  const file = form.get("file");

  if (!orderId || !cardId || !ADMIN_IMAGE_TYPES.has(imageType)) {
    return jsonResponse(req, { ok: false, error: "invalid upload payload" }, 400);
  }
  if (!(file instanceof File)) {
    return jsonResponse(req, { ok: false, error: "file required" }, 400);
  }

  const { data: card, error: cardError } = await supabase
    .from("cards")
    .select("id, order_id")
    .eq("id", cardId)
    .eq("order_id", orderId)
    .maybeSingle();
  if (cardError) throw cardError;
  if (!card) {
    return jsonResponse(req, { ok: false, error: "card not found" }, 404);
  }

  const { count, error: countError } = await supabase
    .from("card_images")
    .select("id", { count: "exact", head: true })
    .eq("card_id", cardId)
    .eq("image_type", imageType);
  if (countError) throw countError;

  const index = (count ?? 0) + 1;
  const path =
    `order-${orderId}/card-${cardId}/${imageType}-${index}-${sanitizeFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (uploadError) throw uploadError;

  const { data: imageRow, error: insertError } = await supabase
    .from("card_images")
    .insert({ card_id: cardId, image_type: imageType, storage_path: path })
    .select("id, card_id, image_type, storage_path")
    .single();
  if (insertError) throw insertError;

  const signedMap = await signPaths(supabase, [path]);

  return jsonResponse(req, {
    ok: true,
    image: {
      ...imageRow,
      signed_url: signedMap.get(path) ?? null,
    },
  });
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const supabase = getServiceClient();
    const token = getAdminToken(req);
    await requireSession(supabase, token);

    const contentType = req.headers.get("Content-Type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return await handleUpload(req, supabase);
    }

    const body = await req.json();
    const action = String(body.action ?? "");

    if (action === "list") {
      const orders = await fetchOrderListSummary(supabase);
      return jsonResponse(req, { ok: true, orders });
    }

    if (action === "get") {
      const orderId = String(body.order_id ?? "");
      if (!orderId) {
        return jsonResponse(req, { ok: false, error: "order_id required" }, 400);
      }
      const order = await fetchOrderGraph(supabase, orderId);
      if (!order) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }
      return jsonResponse(req, { ok: true, order });
    }

    if (action === "set_status") {
      const orderId = String(body.order_id ?? "");
      const status = String(body.status ?? "");
      if (!orderId || !status) {
        return jsonResponse(req, { ok: false, error: "order_id and status required" }, 400);
      }
      const { data, error } = await supabase.rpc("update_order", {
        p_order_id: orderId,
        p_order: { status },
      });
      if (error) throw error;
      return jsonResponse(req, { ok: true, order: data });
    }

    if (action === "save") {
      const orderId = String(body.order_id ?? "");
      if (!orderId) {
        return jsonResponse(req, { ok: false, error: "order_id required" }, 400);
      }

      const orderPatch = body.order ?? null;
      const contacts = Array.isArray(body.contacts) ? body.contacts : null;
      const cards = Array.isArray(body.cards) ? body.cards : null;

      const { error: rpcError } = await supabase.rpc("update_order", {
        p_order_id: orderId,
        p_order: orderPatch,
        p_contacts: contacts,
        p_cards: cards,
      });
      if (rpcError) throw rpcError;

      const order = await fetchOrderGraph(supabase, orderId);
      if (!order) {
        return jsonResponse(req, { ok: false, error: "order not found after save" }, 404);
      }
      return jsonResponse(req, { ok: true, order, full: order });
    }

    return jsonResponse(req, { ok: false, error: "unknown action" }, 400);
  } catch (err) {
    const message = rpcErrorMessage(err);
    if (message.includes("unauthorized")) {
      return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
    }
    console.error(err);
    return jsonResponse(req, { ok: false, error: message }, 500);
  }
});
