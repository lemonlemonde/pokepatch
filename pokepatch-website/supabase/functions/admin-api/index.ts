import {
  getAdminToken,
  handleOptions,
  jsonResponse,
} from "../_shared/adminCors.ts";
import { getServiceClient, requireSession } from "../_shared/adminSession.ts";

const BUCKET = "card-photos";
const GALLERY_BUCKET = "gallery";
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;

const ADMIN_IMAGE_TYPES = new Set([
  "progress_front",
  "progress_back",
  "final_front",
  "final_back",
  "admin",
]);

const GALLERY_SIDES = new Set(["before", "after"]);
const GALLERY_MEDIA_KINDS = new Set(["image", "video"]);
const GALLERY_DAMAGE_TAGS = new Set([
  "crease",
  "scratching",
  "dent",
  "edge_lift",
  "dirt",
]);

function sanitizeDamageTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (!GALLERY_DAMAGE_TAGS.has(id) || seen.has(id)) continue;
    seen.add(id);
    tags.push(id);
  }
  return tags;
}

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

function galleryPublicUrl(
  supabase: ReturnType<typeof getServiceClient>,
  path: string | null | undefined
): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function detectMediaKindFromPath(path: string | null | undefined): "image" | "video" {
  if (!path) return "image";
  return /\.(mp4|webm|mov)(\?|$)/i.test(path) ? "video" : "image";
}

function enrichPair(
  supabase: ReturnType<typeof getServiceClient>,
  pair: Record<string, unknown>
) {
  return {
    ...pair,
    urls: {
      before: galleryPublicUrl(supabase, pair.before_path as string | null),
      after: galleryPublicUrl(supabase, pair.after_path as string | null),
    },
  };
}

function enrichGalleryItem(
  supabase: ReturnType<typeof getServiceClient>,
  item: Record<string, unknown>,
  pairs: Record<string, unknown>[] = []
) {
  const sorted = [...pairs].sort(
    (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
  );
  return {
    ...item,
    pairs: sorted.map((pair) => enrichPair(supabase, pair)),
  };
}

async function fetchPairsForItems(
  supabase: ReturnType<typeof getServiceClient>,
  itemIds: string[]
) {
  if (itemIds.length === 0) return new Map<string, Record<string, unknown>[]>();
  const { data, error } = await supabase
    .from("gallery_pairs")
    .select("id, item_id, sort_order, media_kind, before_path, after_path, created_at")
    .in("item_id", itemIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const map = new Map<string, Record<string, unknown>[]>();
  for (const pair of data ?? []) {
    const itemId = pair.item_id as string;
    const list = map.get(itemId) ?? [];
    list.push(pair);
    map.set(itemId, list);
  }
  return map;
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

async function handleOrderUpload(
  req: Request,
  form: FormData,
  supabase: ReturnType<typeof getServiceClient>
) {
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

async function listGalleryItems(supabase: ReturnType<typeof getServiceClient>) {
  const { data, error } = await supabase
    .from("gallery_items")
    .select("id, created_at, updated_at, title, set_name, damage_tags, sort_order, published")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  const items = data ?? [];
  const pairsByItem = await fetchPairsForItems(
    supabase,
    items.map((item) => item.id as string)
  );
  return items.map((item) =>
    enrichGalleryItem(supabase, item, pairsByItem.get(item.id as string) ?? [])
  );
}

async function getGalleryItem(
  supabase: ReturnType<typeof getServiceClient>,
  id: string
) {
  const { data, error } = await supabase
    .from("gallery_items")
    .select("id, created_at, updated_at, title, set_name, damage_tags, sort_order, published")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const pairsByItem = await fetchPairsForItems(supabase, [id]);
  return enrichGalleryItem(supabase, data, pairsByItem.get(id) ?? []);
}

async function handleGalleryUpload(
  req: Request,
  form: FormData,
  supabase: ReturnType<typeof getServiceClient>
) {
  const pairId = String(form.get("pair_id") ?? "");
  const side = String(form.get("side") ?? "");
  const file = form.get("file");

  if (!pairId || !GALLERY_SIDES.has(side)) {
    return jsonResponse(req, { ok: false, error: "invalid gallery upload" }, 400);
  }
  if (!(file instanceof File)) {
    return jsonResponse(req, { ok: false, error: "file required" }, 400);
  }

  const { data: existing, error: existingError } = await supabase
    .from("gallery_pairs")
    .select("*")
    .eq("id", pairId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) {
    return jsonResponse(req, { ok: false, error: "gallery pair not found" }, 404);
  }

  const column = side === "before" ? "before_path" : "after_path";
  const previousPath = existing[column] as string | null;
  const path =
    `item-${existing.item_id}/pair-${pairId}/${side}-${sanitizeFilename(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(GALLERY_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (uploadError) throw uploadError;

  const inferredKind =
    file.type.startsWith("video/") || detectMediaKindFromPath(file.name) === "video"
      ? "video"
      : "image";

  const { error: updateError } = await supabase
    .from("gallery_pairs")
    .update({
      [column]: path,
      media_kind: inferredKind,
    })
    .eq("id", pairId);
  if (updateError) throw updateError;

  await supabase
    .from("gallery_items")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", existing.item_id);

  if (previousPath && previousPath !== path) {
    await supabase.storage.from(GALLERY_BUCKET).remove([previousPath]);
  }

  const item = await getGalleryItem(supabase, existing.item_id as string);
  return jsonResponse(req, { ok: true, item });
}

function normalizeGalleryPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};

  if (typeof body.title === "string") {
    patch.title = body.title.trim();
  }
  if (typeof body.set_name === "string") {
    patch.set_name = body.set_name.trim();
  }
  if (Array.isArray(body.damage_tags)) {
    patch.damage_tags = sanitizeDamageTags(body.damage_tags);
  }
  if (typeof body.published === "boolean") {
    patch.published = body.published;
  }
  if (typeof body.sort_order === "number" && Number.isFinite(body.sort_order)) {
    patch.sort_order = Math.trunc(body.sort_order);
  }

  return patch;
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
      const form = await req.formData();
      const kind = String(form.get("kind") ?? "order");
      if (kind === "gallery") {
        return await handleGalleryUpload(req, form, supabase);
      }
      return await handleOrderUpload(req, form, supabase);
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

    if (action === "gallery_list") {
      const items = await listGalleryItems(supabase);
      return jsonResponse(req, { ok: true, items });
    }

    if (action === "gallery_get") {
      const id = String(body.id ?? "");
      if (!id) {
        return jsonResponse(req, { ok: false, error: "id required" }, 400);
      }
      const item = await getGalleryItem(supabase, id);
      if (!item) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }
      return jsonResponse(req, { ok: true, item });
    }

    if (action === "gallery_create") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return jsonResponse(req, { ok: false, error: "title required" }, 400);
      }

      const { data: maxRow, error: maxError } = await supabase
        .from("gallery_items")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxError) throw maxError;

      const sortOrder =
        typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
          ? Math.trunc(body.sort_order)
          : (maxRow?.sort_order ?? -1) + 1;

      const insertRow = {
        title,
        set_name: typeof body.set_name === "string" ? body.set_name.trim() : "",
        damage_tags: sanitizeDamageTags(body.damage_tags),
        published: body.published !== false,
        sort_order: sortOrder,
      };

      const { data, error } = await supabase
        .from("gallery_items")
        .insert(insertRow)
        .select("id, created_at, updated_at, title, set_name, damage_tags, sort_order, published")
        .single();
      if (error) throw error;

      return jsonResponse(req, {
        ok: true,
        item: enrichGalleryItem(supabase, data, []),
      });
    }

    if (action === "gallery_save") {
      const id = String(body.id ?? "");
      if (!id) {
        return jsonResponse(req, { ok: false, error: "id required" }, 400);
      }

      const patch = normalizeGalleryPatch(body);
      if (Object.keys(patch).length === 0) {
        return jsonResponse(req, { ok: false, error: "no fields to update" }, 400);
      }
      if (patch.title === "") {
        return jsonResponse(req, { ok: false, error: "title required" }, 400);
      }

      patch.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from("gallery_items")
        .update(patch)
        .eq("id", id);
      if (error) throw error;

      const item = await getGalleryItem(supabase, id);
      return jsonResponse(req, { ok: true, item });
    }

    if (action === "gallery_delete") {
      const id = String(body.id ?? "");
      if (!id) {
        return jsonResponse(req, { ok: false, error: "id required" }, 400);
      }

      const pairsByItem = await fetchPairsForItems(supabase, [id]);
      const pairs = pairsByItem.get(id) ?? [];
      const paths = pairs
        .flatMap((pair) => [pair.before_path, pair.after_path])
        .filter((path): path is string => Boolean(path));

      const { error: deleteError } = await supabase
        .from("gallery_items")
        .delete()
        .eq("id", id);
      if (deleteError) throw deleteError;

      if (paths.length > 0) {
        await supabase.storage.from(GALLERY_BUCKET).remove(paths);
      }

      const { data: listed } = await supabase.storage
        .from(GALLERY_BUCKET)
        .list(`item-${id}`);
      if (listed?.length) {
        await supabase.storage
          .from(GALLERY_BUCKET)
          .remove(listed.map((f) => `item-${id}/${f.name}`));
      }

      return jsonResponse(req, { ok: true });
    }

    if (action === "gallery_reorder") {
      const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids : null;
      if (!orderedIds || orderedIds.length === 0) {
        return jsonResponse(req, { ok: false, error: "ordered_ids required" }, 400);
      }

      const now = new Date().toISOString();
      for (let index = 0; index < orderedIds.length; index += 1) {
        const id = String(orderedIds[index] ?? "");
        if (!id) continue;
        const { error } = await supabase
          .from("gallery_items")
          .update({ sort_order: index, updated_at: now })
          .eq("id", id);
        if (error) throw error;
      }

      const items = await listGalleryItems(supabase);
      return jsonResponse(req, { ok: true, items });
    }

    if (action === "gallery_pair_create") {
      const itemId = String(body.item_id ?? "");
      if (!itemId) {
        return jsonResponse(req, { ok: false, error: "item_id required" }, 400);
      }

      const mediaKind = String(body.media_kind ?? "image");
      if (!GALLERY_MEDIA_KINDS.has(mediaKind)) {
        return jsonResponse(req, { ok: false, error: "invalid media_kind" }, 400);
      }

      const { data: item, error: itemError } = await supabase
        .from("gallery_items")
        .select("id")
        .eq("id", itemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) {
        return jsonResponse(req, { ok: false, error: "gallery item not found" }, 404);
      }

      const { data: maxRow, error: maxError } = await supabase
        .from("gallery_pairs")
        .select("sort_order")
        .eq("item_id", itemId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxError) throw maxError;

      const { error: insertError } = await supabase.from("gallery_pairs").insert({
        item_id: itemId,
        sort_order: (maxRow?.sort_order ?? -1) + 1,
        media_kind: mediaKind,
      });
      if (insertError) throw insertError;

      await supabase
        .from("gallery_items")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", itemId);

      const enriched = await getGalleryItem(supabase, itemId);
      return jsonResponse(req, { ok: true, item: enriched });
    }

    if (action === "gallery_pair_delete") {
      const pairId = String(body.pair_id ?? "");
      if (!pairId) {
        return jsonResponse(req, { ok: false, error: "pair_id required" }, 400);
      }

      const { data: existing, error: existingError } = await supabase
        .from("gallery_pairs")
        .select("*")
        .eq("id", pairId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }

      const paths = [existing.before_path, existing.after_path].filter(
        (path): path is string => Boolean(path)
      );

      const { error: deleteError } = await supabase
        .from("gallery_pairs")
        .delete()
        .eq("id", pairId);
      if (deleteError) throw deleteError;

      if (paths.length > 0) {
        await supabase.storage.from(GALLERY_BUCKET).remove(paths);
      }

      await supabase
        .from("gallery_items")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", existing.item_id);

      const item = await getGalleryItem(supabase, existing.item_id as string);
      return jsonResponse(req, { ok: true, item });
    }

    if (action === "gallery_pair_reorder") {
      const itemId = String(body.item_id ?? "");
      const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids : null;
      if (!itemId || !orderedIds) {
        return jsonResponse(
          req,
          { ok: false, error: "item_id and ordered_ids required" },
          400
        );
      }

      for (let index = 0; index < orderedIds.length; index += 1) {
        const pairId = String(orderedIds[index] ?? "");
        if (!pairId) continue;
        const { error } = await supabase
          .from("gallery_pairs")
          .update({ sort_order: index })
          .eq("id", pairId)
          .eq("item_id", itemId);
        if (error) throw error;
      }

      await supabase
        .from("gallery_items")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", itemId);

      const item = await getGalleryItem(supabase, itemId);
      return jsonResponse(req, { ok: true, item });
    }

    if (action === "gallery_pair_clear_side") {
      const pairId = String(body.pair_id ?? "");
      const side = String(body.side ?? "");
      if (!pairId || !GALLERY_SIDES.has(side)) {
        return jsonResponse(req, { ok: false, error: "pair_id and side required" }, 400);
      }

      const column = side === "before" ? "before_path" : "after_path";
      const { data: existing, error: existingError } = await supabase
        .from("gallery_pairs")
        .select("*")
        .eq("id", pairId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }

      const previousPath = existing[column] as string | null;
      const { error: updateError } = await supabase
        .from("gallery_pairs")
        .update({ [column]: null })
        .eq("id", pairId);
      if (updateError) throw updateError;

      if (previousPath) {
        await supabase.storage.from(GALLERY_BUCKET).remove([previousPath]);
      }

      const item = await getGalleryItem(supabase, existing.item_id as string);
      return jsonResponse(req, { ok: true, item });
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
