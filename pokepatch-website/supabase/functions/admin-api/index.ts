import {
  getAdminToken,
  handleOptions,
  jsonResponse,
} from "../_shared/adminCors.ts";
import { getServiceClient, requireSession } from "../_shared/adminSession.ts";
import { sendResendEmail, buildStoredMessageBody } from "../_shared/resend.ts";

const BUCKET = "card-photos";
const GALLERY_BUCKET = "gallery";
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;
/** Unique order photo paths are never overwritten — long Cache-Control. */
const IMMUTABLE_CACHE_CONTROL = "604800";
/** Gallery can replace in place — shorter browser TTL. */
const GALLERY_CACHE_CONTROL = "86400";

function thumbPath(storagePath: string): string {
  if (storagePath.endsWith(".thumb.webp") || storagePath.endsWith(".poster.webp")) {
    return storagePath;
  }
  return `${storagePath}.thumb.webp`;
}

function posterPath(storagePath: string): string {
  if (storagePath.endsWith(".poster.webp")) return storagePath;
  return `${storagePath}.poster.webp`;
}

function siblingPaths(storagePath: string): string[] {
  if (
    storagePath.endsWith(".thumb.webp") ||
    storagePath.endsWith(".poster.webp")
  ) {
    return [];
  }
  return [thumbPath(storagePath), posterPath(storagePath)];
}

function pathsWithSiblings(paths: string[]): string[] {
  const out = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    out.add(path);
    for (const sibling of siblingPaths(path)) out.add(sibling);
  }
  return [...out];
}

const ADMIN_IMAGE_TYPES = new Set([
  "customer",
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
  "water_damage",
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

/** Resurface the customer's "New updates" chip after any admin order change. */
async function bumpOrderUpdatesAvailable(
  supabase: ReturnType<typeof getServiceClient>,
  orderId: string
) {
  const { error } = await supabase
    .from("orders")
    .update({ updates_available_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) {
    console.error("updates_available_at bump failed", error);
  }
}

async function deleteOrderAndPhotos(
  supabase: ReturnType<typeof getServiceClient>,
  orderId: string
): Promise<{ id: string; display_id: number | string } | null> {
  const { data: existing, error: existingError } = await supabase
    .from("orders")
    .select("id, display_id")
    .eq("id", orderId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) return null;

  const { data: cards, error: cardsError } = await supabase
    .from("cards")
    .select("id")
    .eq("order_id", orderId);
  if (cardsError) throw cardsError;

  const cardIds = (cards ?? []).map((card) => card.id as string);
  let paths: string[] = [];
  if (cardIds.length > 0) {
    const { data: images, error: imagesError } = await supabase
      .from("card_images")
      .select("storage_path")
      .in("card_id", cardIds);
    if (imagesError) throw imagesError;
    paths = (images ?? [])
      .map((image) => image.storage_path as string)
      .filter(Boolean);
  }

  const { error: deleteError } = await supabase
    .from("orders")
    .delete()
    .eq("id", orderId);
  if (deleteError) throw deleteError;

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove(pathsWithSiblings(paths));
    if (storageError) {
      console.error("order photo cleanup failed", storageError);
    }
  }

  return {
    id: existing.id as string,
    display_id: existing.display_id as number | string,
  };
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
    .select("id, item_id, sort_order, media_kind, caption, before_path, after_path, created_at")
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
    if (item.path && item.signedUrl && !(item as { error?: string }).error) {
      map.set(item.path, item.signedUrl);
    }
  }
  return map;
}

/** Sign thumb siblings when present; fall back to full object. Keys = original paths. */
async function signPathsPreferThumb(
  supabase: ReturnType<typeof getServiceClient>,
  paths: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const thumbPaths = unique.map((p) => thumbPath(p));
  const { data: thumbData, error: thumbError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(thumbPaths, SIGNED_URL_EXPIRES_IN);
  if (thumbError) {
    console.error("createSignedUrls thumb error", thumbError);
  }

  const missing: string[] = [];
  for (let i = 0; i < unique.length; i += 1) {
    const original = unique[i];
    const item = thumbData?.[i];
    if (item?.signedUrl && !(item as { error?: string }).error) {
      result.set(original, item.signedUrl);
    } else {
      missing.push(original);
    }
  }

  if (missing.length > 0) {
    const fullSigned = await signPaths(supabase, missing);
    for (const [path, url] of fullSigned) result.set(path, url);
  }
  return result;
}

/** Sign only `.thumb.webp` siblings — never full-size objects. Keys = original paths. */
async function signPathsThumbsOnly(
  supabase: ReturnType<typeof getServiceClient>,
  paths: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const thumbPaths = unique.map((p) => thumbPath(p));
  const { data: thumbData, error: thumbError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(thumbPaths, SIGNED_URL_EXPIRES_IN);
  if (thumbError) {
    console.error("createSignedUrls thumbs-only error", thumbError);
    return result;
  }

  for (let i = 0; i < unique.length; i += 1) {
    const item = thumbData?.[i];
    if (item?.signedUrl && !(item as { error?: string }).error) {
      result.set(unique[i], item.signedUrl);
    }
  }
  return result;
}

async function fetchOrderListSummary(supabase: ReturnType<typeof getServiceClient>) {
  let { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, status, completed_at, status_changed_at, queue_priority, quote_bulk_counts, quote_override_label, quote_override_amount"
    )
    .order("created_at", { ascending: false });
  // Quote columns may be missing until the order_quotes migration is applied.
  if (ordersError) {
    const retry = await supabase
      .from("orders")
      .select(
        "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, status, completed_at, status_changed_at, queue_priority"
      )
      .order("created_at", { ascending: false });
    if (retry.error) throw ordersError;
    orders = retry.data;
    ordersError = null;
  }
  if (ordersError) throw ordersError;
  if (!orders?.length) return [];

  // 1-based place among status=new, same order as list_queue_orders / get_my_orders.
  const queuePositionById = new Map<string, number>();
  const newOrders = [...orders]
    .filter((o) => o.status === "new")
    .sort((a, b) => {
      const ap = a.queue_priority;
      const bp = b.queue_priority;
      if (ap == null && bp == null) {
        /* fall through */
      } else if (ap == null) return 1;
      else if (bp == null) return -1;
      else if (ap !== bp) return Number(ap) - Number(bp);
      const at = a.created_at ? new Date(a.created_at as string).getTime() : 0;
      const bt = b.created_at ? new Date(b.created_at as string).getTime() : 0;
      if (at !== bt) return at - bt;
      return String(a.id).localeCompare(String(b.id));
    });
  newOrders.forEach((o, index) => {
    queuePositionById.set(o.id as string, index + 1);
  });

  const orderIds = orders.map((o) => o.id as string);
  const [
    { data: cards, error: cardsError },
    quoteItemsResult,
    authUsers,
  ] = await Promise.all([
    supabase
      .from("cards")
      .select("id, order_id, status")
      .in("order_id", orderIds)
      .order("id", { ascending: true }),
    supabase
      .from("order_quote_items")
      .select("order_id, quote_base_amount")
      .in("order_id", orderIds),
    listAllAuthUsers(supabase),
  ]);
  if (cardsError) throw cardsError;
  const quoteItems = quoteItemsResult.error ? [] : quoteItemsResult.data ?? [];
  const emailSet = authEmailSet(authUsers);

  const countByOrder = new Map<string, number>();
  const completedCountByOrder = new Map<string, number>();
  const cardOrderById = new Map<string, string>();
  for (const card of cards ?? []) {
    const orderId = card.order_id as string;
    const cardId = card.id as string;
    countByOrder.set(orderId, (countByOrder.get(orderId) ?? 0) + 1);
    if (card.status === "completed") {
      completedCountByOrder.set(
        orderId,
        (completedCountByOrder.get(orderId) ?? 0) + 1
      );
    }
    cardOrderById.set(cardId, orderId);
  }

  const quoteItemsByOrder = new Map<string, typeof quoteItems>();
  for (const item of quoteItems) {
    const orderId = item.order_id as string;
    const list = quoteItemsByOrder.get(orderId) ?? [];
    list.push(item);
    quoteItemsByOrder.set(orderId, list);
  }

  const cardIds = (cards ?? []).map((c) => c.id as string);
  const previewPathsByOrder = new Map<string, string[]>();
  if (cardIds.length > 0) {
    const { data: imageRows, error: imagesError } = await supabase
      .from("card_images")
      .select("id, card_id, storage_path")
      .in("card_id", cardIds)
      .eq("image_type", "customer")
      .order("id", { ascending: true });
    if (imagesError) throw imagesError;

    for (const image of imageRows ?? []) {
      const orderId = cardOrderById.get(image.card_id as string);
      if (!orderId) continue;
      const paths = previewPathsByOrder.get(orderId) ?? [];
      // Kanban only needs one preview thumb per order.
      if (paths.length >= 1) continue;
      paths.push(image.storage_path as string);
      previewPathsByOrder.set(orderId, paths);
    }
  }

  const allPreviewPaths = [...previewPathsByOrder.values()].flat();
  const signedMap = await signPathsPreferThumb(supabase, allPreviewPaths);

  return orders.map((order) => {
    const orderId = order.id as string;
    const paths = previewPathsByOrder.get(orderId) ?? [];
    const preview = paths
      .map((path) => {
        const url = signedMap.get(path);
        return url ? { path, url } : null;
      })
      .filter((row): row is { path: string; url: string } => Boolean(row));
    return {
      ...order,
      has_account: orderHasAccount(order, emailSet),
      quote_items: quoteItemsByOrder.get(orderId) ?? [],
      card_count: countByOrder.get(orderId) ?? 0,
      cards_completed: completedCountByOrder.get(orderId) ?? 0,
      queue_position: queuePositionById.get(orderId) ?? null,
      preview_paths: preview.map((row) => row.path),
      preview_urls: preview.map((row) => row.url),
    };
  });
}

const ORDER_SELECT_WITH_QUOTE =
  "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, general_notes, photos_drive_url, status, completed_at, status_changed_at, quote_bulk_counts, quote_override_label, quote_override_amount";
const ORDER_SELECT_BASE =
  "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, general_notes, photos_drive_url, status, completed_at, status_changed_at";

const ORDER_STATUS_IDS = new Set([
  "on_hold",
  "new",
  "in_progress",
  "completed",
  "canceled",
]);

const SEARCH_RESULT_LIMIT = 10;
/** Pull extra matches so we can re-rank by order created_at before cutting to 10. */
const SEARCH_CANDIDATE_LIMIT = 80;

/** Escape `%` / `_` so user input is treated literally in ILIKE patterns. */
function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Quote a PostgREST filter value (needed when the pattern contains `,` etc.). */
function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

type SearchCardRow = {
  id: string | number;
  order_id: string;
  card_name: string | null;
  set_name: string | null;
  description: string | null;
  status: string | null;
};

type SearchOrderRow = {
  id: string;
  display_id: number | string | null;
  created_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
  delivery_method: string | null;
  status: string | null;
  general_notes: string | null;
  completed_at: string | null;
};

function orderCreatedMs(order: SearchOrderRow | undefined): number {
  if (!order?.created_at) return 0;
  const ms = new Date(order.created_at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Search cards by name/set/description, optionally scoped to order statuses.
 * Returns one hit per matching card with a compact order summary (newest orders first).
 */
async function searchOrdersByCardText(
  supabase: ReturnType<typeof getServiceClient>,
  rawQuery: string,
  rawStatuses: unknown
) {
  const q = String(rawQuery ?? "").trim();
  if (q.length < 2) {
    return { results: [], query: q, truncated: false };
  }

  const statuses = (
    Array.isArray(rawStatuses)
      ? rawStatuses.map((value) => String(value ?? "").trim())
      : []
  ).filter((status) => ORDER_STATUS_IDS.has(status));

  // Empty column scope means "search nothing", not "search all statuses".
  if (statuses.length === 0) {
    return { results: [], query: q, truncated: false };
  }

  const searchingAllStatuses = statuses.length === ORDER_STATUS_IDS.size;
  let scopedOrderIds: string[] | null = null;
  if (!searchingAllStatuses) {
    const { data: scopedOrders, error: scopedError } = await supabase
      .from("orders")
      .select("id")
      .in("status", statuses);
    if (scopedError) throw scopedError;
    scopedOrderIds = (scopedOrders ?? []).map((row) => row.id as string);
    if (scopedOrderIds.length === 0) {
      return { results: [], query: q, truncated: false };
    }
  }

  const pattern = quotePostgrestValue(`%${escapeIlikePattern(q)}%`);
  let cardsQuery = supabase
    .from("cards")
    .select("id, order_id, card_name, set_name, description, status")
    .or(
      `card_name.ilike.${pattern},set_name.ilike.${pattern},description.ilike.${pattern}`
    )
    .limit(SEARCH_CANDIDATE_LIMIT);
  if (scopedOrderIds) {
    cardsQuery = cardsQuery.in("order_id", scopedOrderIds);
  }

  const { data: cardRows, error: cardsError } = await cardsQuery;
  if (cardsError) throw cardsError;

  const matchedCards = (cardRows ?? []) as SearchCardRow[];
  if (matchedCards.length === 0) {
    return { results: [], query: q, truncated: false };
  }

  const orderIds = [
    ...new Set(matchedCards.map((card) => card.order_id as string)),
  ];
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, display_id, created_at, customer_name, customer_email, delivery_method, status, general_notes, completed_at"
    )
    .in("id", orderIds);
  if (ordersError) throw ordersError;

  const orderById = new Map(
    ((orders ?? []) as SearchOrderRow[]).map((order) => [order.id, order])
  );

  // Newest orders first; tie-break by higher display_id, then card id.
  const rankedCards = [...matchedCards].sort((a, b) => {
    const orderA = orderById.get(a.order_id as string);
    const orderB = orderById.get(b.order_id as string);
    const byCreated = orderCreatedMs(orderB) - orderCreatedMs(orderA);
    if (byCreated !== 0) return byCreated;
    const displayA = Number(orderA?.display_id) || 0;
    const displayB = Number(orderB?.display_id) || 0;
    if (displayA !== displayB) return displayB - displayA;
    return String(b.id).localeCompare(String(a.id));
  });

  const truncated =
    rankedCards.length > SEARCH_RESULT_LIMIT ||
    matchedCards.length >= SEARCH_CANDIDATE_LIMIT;
  const limitedCards = rankedCards.slice(0, SEARCH_RESULT_LIMIT);
  const cardIds = limitedCards.map((card) => card.id);

  const { data: imageRows, error: imagesError } = await supabase
    .from("card_images")
    .select("id, card_id, image_type, storage_path")
    .in("card_id", cardIds)
    .order("id", { ascending: true });
  if (imagesError) throw imagesError;

  // Prefer first customer photo; otherwise first image for that card.
  const previewPathByCard = new Map<string, string>();
  const hasCustomerPreview = new Set<string>();
  for (const image of imageRows ?? []) {
    const cardId = String(image.card_id);
    const path = image.storage_path as string;
    if (!path) continue;
    if (image.image_type === "customer") {
      if (hasCustomerPreview.has(cardId)) continue;
      hasCustomerPreview.add(cardId);
      previewPathByCard.set(cardId, path);
      continue;
    }
    if (!previewPathByCard.has(cardId)) {
      previewPathByCard.set(cardId, path);
    }
  }

  const signedMap = await signPathsThumbsOnly(
    supabase,
    [...previewPathByCard.values()]
  );

  const needle = q.toLowerCase();
  const results = limitedCards
    .map((card) => {
      const order = orderById.get(card.order_id as string);
      if (!order) return null;

      const matchFields: string[] = [];
      if (String(card.card_name ?? "").toLowerCase().includes(needle)) {
        matchFields.push("card_name");
      }
      if (String(card.set_name ?? "").toLowerCase().includes(needle)) {
        matchFields.push("set_name");
      }
      if (String(card.description ?? "").toLowerCase().includes(needle)) {
        matchFields.push("description");
      }

      const previewPath = previewPathByCard.get(String(card.id)) ?? null;
      const previewUrl = previewPath
        ? signedMap.get(previewPath) ?? null
        : null;

      return {
        order_id: order.id,
        display_id: order.display_id,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        delivery_method: order.delivery_method,
        status: order.status,
        general_notes: order.general_notes,
        completed_at: order.completed_at,
        created_at: order.created_at,
        match_fields: matchFields,
        card: {
          id: card.id,
          card_name: card.card_name,
          set_name: card.set_name,
          description: card.description,
          status: card.status,
          preview_path: previewPath,
          preview_url: previewUrl,
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return { results, query: q, truncated };
}

async function fetchOrderGraph(
  supabase: ReturnType<typeof getServiceClient>,
  orderId?: string
) {
  let ordersQuery = supabase
    .from("orders")
    .select(ORDER_SELECT_WITH_QUOTE)
    .order("created_at", { ascending: false });

  if (orderId) {
    ordersQuery = ordersQuery.eq("id", orderId);
  }

  let { data: orders, error: ordersError } = await ordersQuery;
  // Quote columns may be missing until the order_quotes migration is applied.
  if (ordersError) {
    let fallback = supabase
      .from("orders")
      .select(ORDER_SELECT_BASE)
      .order("created_at", { ascending: false });
    if (orderId) fallback = fallback.eq("id", orderId);
    const retry = await fallback;
    if (retry.error) throw ordersError;
    orders = retry.data;
    ordersError = null;
  }
  if (ordersError) throw ordersError;
  if (!orders?.length) return orderId ? null : [];

  const orderIds = orders.map((o) => o.id as string);

  const [
    { data: contacts, error: contactsError },
    { data: cards, error: cardsError },
    quoteItemsResult,
    authUsers,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, order_id, contact_type, value")
      .in("order_id", orderIds),
    supabase
      .from("cards")
      .select("id, order_id, card_name, set_name, description, market_value_raw_nm, status")
      .in("order_id", orderIds)
      .order("id", { ascending: true }),
    supabase
      .from("order_quote_items")
      .select(
        "id, order_id, sort_order, card_name, set_name, service_key, service_label, quote_base_amount, high_value_surcharge"
      )
      .in("order_id", orderIds)
      .order("sort_order", { ascending: true }),
    listAllAuthUsers(supabase),
  ]);
  if (contactsError) throw contactsError;
  if (cardsError) throw cardsError;
  // Table may not exist until migration; treat as empty quote list.
  const quoteItems = quoteItemsResult.error ? [] : quoteItemsResult.data ?? [];
  const emailSet = authEmailSet(authUsers);

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
  const [signedMap, thumbSignedMap] = await Promise.all([
    signPaths(supabase, paths),
    signPathsPreferThumb(supabase, paths),
  ]);

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

  const quoteItemsByOrder = new Map<string, typeof quoteItems>();
  for (const item of quoteItems ?? []) {
    const list = quoteItemsByOrder.get(item.order_id as string) ?? [];
    list.push(item);
    quoteItemsByOrder.set(item.order_id as string, list);
  }

  const imagesByCard = new Map<string, typeof images>();
  for (const img of images) {
    const list = imagesByCard.get(img.card_id) ?? [];
    list.push(img);
    imagesByCard.set(img.card_id, list);
  }

  const enriched = orders.map((order) => ({
    ...order,
    has_account: orderHasAccount(order, emailSet),
    contacts: contactsByOrder.get(order.id as string) ?? [],
    cards: (cardsByOrder.get(order.id as string) ?? []).map((card) => ({
      ...card,
      images: (imagesByCard.get(card.id as string) ?? []).map((img) => ({
        ...img,
        signed_url: signedMap.get(img.storage_path) ?? null,
        signed_thumb_url: thumbSignedMap.get(img.storage_path) ?? null,
      })),
    })),
    quote_items: quoteItemsByOrder.get(order.id as string) ?? [],
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
    .upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  if (uploadError) throw uploadError;

  const thumb = form.get("thumb");
  if (thumb instanceof File) {
    const { error: thumbError } = await supabase.storage
      .from(BUCKET)
      .upload(thumbPath(path), thumb, {
        upsert: true,
        contentType: thumb.type || "image/webp",
        cacheControl: IMMUTABLE_CACHE_CONTROL,
      });
    if (thumbError) {
      console.error("order thumb upload failed", thumbError);
    }
  }

  const { data: imageRow, error: insertError } = await supabase
    .from("card_images")
    .insert({ card_id: cardId, image_type: imageType, storage_path: path })
    .select("id, card_id, image_type, storage_path")
    .single();
  if (insertError) throw insertError;

  // Team uploads should resurface the customer's "New updates" chip.
  if (imageType !== "customer") {
    await bumpOrderUpdatesAvailable(supabase, orderId);
  }

  const [signedMap, thumbSignedMap] = await Promise.all([
    signPaths(supabase, [path]),
    signPathsPreferThumb(supabase, [path]),
  ]);

  return jsonResponse(req, {
    ok: true,
    image: {
      ...imageRow,
      signed_url: signedMap.get(path) ?? null,
      signed_thumb_url: thumbSignedMap.get(path) ?? null,
    },
  });
}

async function listGalleryItems(supabase: ReturnType<typeof getServiceClient>) {
  const { data, error } = await supabase
    .from("gallery_items")
    .select("id, created_at, updated_at, title, set_name, damage_tags, published")
    .order("created_at", { ascending: false });
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
    .select("id, created_at, updated_at, title, set_name, damage_tags, published")
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
    .upload(path, file, {
      upsert: true,
      contentType: file.type || undefined,
      cacheControl: GALLERY_CACHE_CONTROL,
    });
  if (uploadError) throw uploadError;

  const inferredKind =
    file.type.startsWith("video/") || detectMediaKindFromPath(file.name) === "video"
      ? "video"
      : "image";

  const thumb = form.get("thumb");
  if (thumb instanceof File && inferredKind === "image") {
    const { error: thumbError } = await supabase.storage
      .from(GALLERY_BUCKET)
      .upload(thumbPath(path), thumb, {
        upsert: true,
        contentType: thumb.type || "image/webp",
        cacheControl: GALLERY_CACHE_CONTROL,
      });
    if (thumbError) console.error("gallery thumb upload failed", thumbError);
  }

  const poster = form.get("poster");
  if (poster instanceof File && inferredKind === "video") {
    const { error: posterError } = await supabase.storage
      .from(GALLERY_BUCKET)
      .upload(posterPath(path), poster, {
        upsert: true,
        contentType: poster.type || "image/webp",
        cacheControl: GALLERY_CACHE_CONTROL,
      });
    if (posterError) console.error("gallery poster upload failed", posterError);
  }

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
    await supabase.storage
      .from(GALLERY_BUCKET)
      .remove(pathsWithSiblings([previousPath]));
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

  return patch;
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type AuthUserRow = { id: string; email: string };

async function listAllAuthUsers(
  supabase: ReturnType<typeof getServiceClient>
): Promise<AuthUserRow[]> {
  const users: AuthUserRow[] = [];
  const perPage = 200;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    for (const user of data?.users ?? []) {
      const email = normalizeEmail(user.email);
      if (!email || !user.id) continue;
      users.push({ id: user.id, email });
    }

    const count = data?.users?.length ?? 0;
    if (count < perPage) break;
    page += 1;
    if (page > 50) break;
  }

  return users;
}

async function resolveUserIdByEmail(
  supabase: ReturnType<typeof getServiceClient>,
  email: string,
  authUsers?: AuthUserRow[]
): Promise<string | null> {
  const users = authUsers ?? (await listAllAuthUsers(supabase));
  const match = users.find((user) => user.email === email);
  return match?.id ?? null;
}

function authEmailSet(authUsers: AuthUserRow[]): Set<string> {
  return new Set(authUsers.map((user) => user.email));
}

/** True when the order email matches an Auth user, or the order is already linked. */
function orderHasAccount(
  order: { customer_email?: unknown; user_id?: unknown },
  emailSet: Set<string>
): boolean {
  if (order.user_id) return true;
  const email = normalizeEmail(order.customer_email);
  return Boolean(email && emailSet.has(email));
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

    if (action === "search") {
      const payload = await searchOrdersByCardText(
        supabase,
        body.q ?? body.query ?? "",
        body.statuses
      );
      return jsonResponse(req, { ok: true, ...payload });
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
      const hasIndex = body.queue_index !== undefined && body.queue_index !== null;
      const queueIndex = hasIndex ? Number(body.queue_index) : null;
      if (hasIndex && !Number.isFinite(queueIndex)) {
        return jsonResponse(req, { ok: false, error: "queue_index must be a number" }, 400);
      }

      if (hasIndex) {
        const { error } = await supabase.rpc("move_order_in_status", {
          p_order_id: orderId,
          p_status: status,
          p_queue_index: queueIndex,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("update_order", {
          p_order_id: orderId,
          p_order: { status },
        });
        if (error) throw error;
      }

      await bumpOrderUpdatesAvailable(supabase, orderId);
      const order = await fetchOrderGraph(supabase, orderId);
      return jsonResponse(req, { ok: true, order });
    }

    if (action === "delete") {
      const rawIds = Array.isArray(body.order_ids)
        ? body.order_ids
        : body.order_id
          ? [body.order_id]
          : [];
      const orderIds = [
        ...new Set(
          rawIds
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
        ),
      ];
      if (orderIds.length === 0) {
        return jsonResponse(
          req,
          { ok: false, error: "order_id or order_ids required" },
          400
        );
      }

      const deleted: { id: string; display_id: number | string }[] = [];
      for (const orderId of orderIds) {
        const result = await deleteOrderAndPhotos(supabase, orderId);
        if (result) deleted.push(result);
      }

      if (deleted.length === 0) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }

      return jsonResponse(req, { ok: true, deleted });
    }

    if (action === "delete_photo") {
      const orderId = String(body.order_id ?? "");
      const imageId = Number(body.image_id);
      if (!orderId || !Number.isFinite(imageId)) {
        return jsonResponse(
          req,
          { ok: false, error: "order_id and image_id required" },
          400
        );
      }

      const { data: image, error: imageError } = await supabase
        .from("card_images")
        .select("id, card_id, image_type, storage_path")
        .eq("id", imageId)
        .maybeSingle();
      if (imageError) throw imageError;
      if (!image) {
        return jsonResponse(req, { ok: false, error: "photo not found" }, 404);
      }
      if (image.image_type === "customer") {
        return jsonResponse(
          req,
          { ok: false, error: "customer photos cannot be deleted" },
          400
        );
      }

      const { data: card, error: cardError } = await supabase
        .from("cards")
        .select("id, order_id")
        .eq("id", image.card_id)
        .eq("order_id", orderId)
        .maybeSingle();
      if (cardError) throw cardError;
      if (!card) {
        return jsonResponse(req, { ok: false, error: "photo not found" }, 404);
      }

      const { error: deleteRowError } = await supabase
        .from("card_images")
        .delete()
        .eq("id", imageId);
      if (deleteRowError) throw deleteRowError;

      if (image.storage_path) {
        const { error: storageError } = await supabase.storage
          .from(BUCKET)
          .remove(pathsWithSiblings([image.storage_path as string]));
        if (storageError) {
          console.error("admin photo storage cleanup failed", storageError);
        }
      }

      await bumpOrderUpdatesAvailable(supabase, orderId);
      return jsonResponse(req, { ok: true, deleted_image_id: imageId });
    }

    if (action === "save") {
      const orderId = String(body.order_id ?? "");
      if (!orderId) {
        return jsonResponse(req, { ok: false, error: "order_id required" }, 400);
      }

      const orderPatch =
        body.order && typeof body.order === "object" ? { ...body.order } : {};
      const contacts = Array.isArray(body.contacts) ? body.contacts : null;
      const cards = Array.isArray(body.cards) ? body.cards : null;
      if (Array.isArray(body.quote_items)) {
        orderPatch.quote_items = body.quote_items;
      }

      let omittedPhotoPaths: string[] = [];
      if (cards) {
        const keptIds = new Set(
          cards
            .map((card: { id?: unknown }) => String(card?.id ?? ""))
            .filter(Boolean)
        );
        const { data: existingCards, error: existingCardsError } = await supabase
          .from("cards")
          .select("id")
          .eq("order_id", orderId);
        if (existingCardsError) throw existingCardsError;

        const omittedIds = (existingCards ?? [])
          .map((card) => card.id as string)
          .filter((id) => !keptIds.has(String(id)));

        if (omittedIds.length > 0) {
          const { data: images, error: imagesError } = await supabase
            .from("card_images")
            .select("storage_path")
            .in("card_id", omittedIds);
          if (imagesError) throw imagesError;
          omittedPhotoPaths = (images ?? [])
            .map((image) => image.storage_path as string)
            .filter(Boolean);
        }
      }

      const { error: rpcError } = await supabase.rpc("update_order", {
        p_order_id: orderId,
        p_order: orderPatch,
        p_contacts: contacts,
        p_cards: cards,
      });
      if (rpcError) throw rpcError;

      if (omittedPhotoPaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(BUCKET)
          .remove(pathsWithSiblings(omittedPhotoPaths));
        if (storageError) {
          console.error("omitted card photo cleanup failed", storageError);
        }
      }

      await bumpOrderUpdatesAvailable(supabase, orderId);

      const order = await fetchOrderGraph(supabase, orderId);
      if (!order) {
        return jsonResponse(req, { ok: false, error: "order not found after save" }, 404);
      }
      return jsonResponse(req, { ok: true, order, full: order });
    }

    if (action === "column_reorder") {
      const status = String(body.status ?? "");
      const orderedIds = Array.isArray(body.ordered_ids)
        ? body.ordered_ids.map((id: unknown) => String(id ?? "")).filter(Boolean)
        : null;
      if (!status || !orderedIds) {
        return jsonResponse(
          req,
          { ok: false, error: "status and ordered_ids required" },
          400
        );
      }

      const { error } = await supabase.rpc("reorder_status_orders", {
        p_status: status,
        p_ordered_ids: orderedIds,
      });
      if (error) throw error;
      return jsonResponse(req, { ok: true });
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

      const insertRow = {
        title,
        set_name: typeof body.set_name === "string" ? body.set_name.trim() : "",
        damage_tags: sanitizeDamageTags(body.damage_tags),
        published: body.published !== false,
      };

      const { data, error } = await supabase
        .from("gallery_items")
        .insert(insertRow)
        .select("id, created_at, updated_at, title, set_name, damage_tags, published")
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
        await supabase.storage
          .from(GALLERY_BUCKET)
          .remove(pathsWithSiblings(paths));
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
        await supabase.storage
          .from(GALLERY_BUCKET)
          .remove(pathsWithSiblings(paths));
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
        await supabase.storage
          .from(GALLERY_BUCKET)
          .remove(pathsWithSiblings([previousPath]));
      }

      const item = await getGalleryItem(supabase, existing.item_id as string);
      return jsonResponse(req, { ok: true, item });
    }

    if (action === "gallery_pair_save_caption") {
      const pairId = String(body.pair_id ?? "");
      if (!pairId) {
        return jsonResponse(req, { ok: false, error: "pair_id required" }, 400);
      }

      const caption =
        typeof body.caption === "string" ? body.caption.trim().slice(0, 200) : "";

      const { data: existing, error: existingError } = await supabase
        .from("gallery_pairs")
        .select("id, item_id")
        .eq("id", pairId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }

      const { error: updateError } = await supabase
        .from("gallery_pairs")
        .update({ caption })
        .eq("id", pairId);
      if (updateError) throw updateError;

      await supabase
        .from("gallery_items")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", existing.item_id);

      const item = await getGalleryItem(supabase, existing.item_id as string);
      return jsonResponse(req, { ok: true, item });
    }

    if (action === "messages_list_orders") {
      const rawLimit = Number(body.limit ?? 200);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 500)
        : 200;

      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, display_id, status, customer_name, customer_email, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

      return jsonResponse(req, { ok: true, orders: data ?? [] });
    }

    if (action === "messages_history") {
      const emailFilter = normalizeEmail(body.email);
      const orderIdFilter =
        typeof body.order_id === "string" ? body.order_id.trim() : "";
      const rawLimit = Number(body.limit ?? 100);
      const limit = Number.isFinite(rawLimit)
        ? Math.min(Math.max(Math.floor(rawLimit), 1), 500)
        : 100;

      let query = supabase
        .from("customer_messages")
        .select(
          "id, recipient_email, user_id, order_id, subject, body, sent_at, email_status, email_error, read_at, batch_id, orders(display_id)"
        )
        .order("sent_at", { ascending: false })
        .limit(limit);

      if (emailFilter) {
        query = query.eq("recipient_email", emailFilter);
      }
      if (orderIdFilter) {
        query = query.eq("order_id", orderIdFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const messages = (data ?? []).map((row) => {
        const orderRel = row.orders as
          | { display_id?: number | string }
          | { display_id?: number | string }[]
          | null
          | undefined;
        const displayId = Array.isArray(orderRel)
          ? orderRel[0]?.display_id ?? null
          : orderRel?.display_id ?? null;
        const { orders: _orders, ...rest } = row as Record<string, unknown>;
        return { ...rest, order_display_id: displayId };
      });

      return jsonResponse(req, { ok: true, messages });
    }

    if (action === "messages_send") {
      const subject =
        typeof body.subject === "string" ? body.subject.trim() : "";
      const messageBody = typeof body.body === "string" ? body.body : "";
      if (!subject) {
        return jsonResponse(req, { ok: false, error: "subject required" }, 400);
      }
      if (!messageBody.trim()) {
        return jsonResponse(req, { ok: false, error: "body required" }, 400);
      }

      const rawOrderIds = Array.isArray(body.order_ids) ? body.order_ids : [];
      const orderIdSet = new Set<string>();
      for (const value of rawOrderIds) {
        const id = typeof value === "string" ? value.trim() : "";
        if (id) orderIdSet.add(id);
      }
      const orderIds = [...orderIdSet];
      if (orderIds.length === 0) {
        return jsonResponse(
          req,
          { ok: false, error: "at least one order_id required" },
          400
        );
      }

      const { data: orderRows, error: ordersError } = await supabase
        .from("orders")
        .select("id, display_id, customer_email, user_id")
        .in("id", orderIds);
      if (ordersError) throw ordersError;

      const orderById = new Map(
        (orderRows ?? []).map((row) => [row.id as string, row])
      );
      for (const orderId of orderIds) {
        if (!orderById.has(orderId)) {
          return jsonResponse(
            req,
            { ok: false, error: `order not found: ${orderId}` },
            404
          );
        }
      }

      const authUsers = await listAllAuthUsers(supabase);
      const batchId = crypto.randomUUID();
      const results: {
        order_id: string;
        email: string;
        user_id: string | null;
        message_id: string | null;
        email_status: string;
        email_error: string | null;
      }[] = [];

      for (const orderId of orderIds) {
        const orderRow = orderById.get(orderId)!;
        const email = normalizeEmail(orderRow.customer_email);
        if (!email || !isValidEmail(email)) {
          results.push({
            order_id: orderId,
            email: email || "",
            user_id: null,
            message_id: null,
            email_status: "failed",
            email_error: "order has no valid customer_email",
          });
          continue;
        }

        const orderDisplayId = orderRow.display_id as number | string;
        const userId =
          (orderRow.user_id as string | null) ??
          (await resolveUserIdByEmail(supabase, email, authUsers));
        const storedBody = buildStoredMessageBody(messageBody, orderDisplayId);

        const { data: inserted, error: insertError } = await supabase
          .from("customer_messages")
          .insert({
            order_id: orderId,
            recipient_email: email,
            user_id: userId,
            subject,
            body: storedBody,
            email_status: "pending",
            batch_id: batchId,
          })
          .select("id")
          .single();

        if (insertError) {
          results.push({
            order_id: orderId,
            email,
            user_id: userId,
            message_id: null,
            email_status: "failed",
            email_error: insertError.message,
          });
          continue;
        }

        const messageId = inserted.id as string;
        const sendResult = await sendResendEmail({
          to: email,
          subject,
          body: messageBody,
          orderDisplayId,
        });

        const emailStatus = sendResult.ok ? "sent" : "failed";
        const emailError = sendResult.ok ? null : sendResult.error;

        const { error: updateError } = await supabase
          .from("customer_messages")
          .update({
            email_status: emailStatus,
            email_error: emailError,
          })
          .eq("id", messageId);
        if (updateError) {
          results.push({
            order_id: orderId,
            email,
            user_id: userId,
            message_id: messageId,
            email_status: "failed",
            email_error: updateError.message,
          });
          continue;
        }

        await bumpOrderUpdatesAvailable(supabase, orderId);

        results.push({
          order_id: orderId,
          email,
          user_id: userId,
          message_id: messageId,
          email_status: emailStatus,
          email_error: emailError,
        });
      }

      const sent = results.filter((row) => row.email_status === "sent").length;
      const failed = results.length - sent;

      return jsonResponse(req, {
        ok: true,
        batch_id: batchId,
        sent,
        failed,
        results,
      });
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
