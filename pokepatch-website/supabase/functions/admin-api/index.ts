import {
  getAdminToken,
  handleOptions,
  jsonResponse,
} from "../_shared/adminCors.ts";
import { getServiceClient, requireSession } from "../_shared/adminSession.ts";
import { sendResendEmail, buildStoredMessageBody } from "../_shared/resend.ts";
import { notifyDueCardTimers } from "../_shared/notifyCardTimers.ts";
import {
  fetchPokemonTcgCard,
  normalizeSearchText,
  searchPokemonTcgCatalog,
  tcgCardImageSmallUrl,
} from "../_shared/pokemonTcg.ts";
import { sanitizeDamageTags } from "../_shared/damageTags.ts";

const BUCKET = "card-photos";
const GALLERY_BUCKET = "gallery";
const GALLERY_ITEM_COLUMNS =
  "id, created_at, updated_at, title, set_name, card_number, damage_tags, published, thumbnail_path, tcg_lookup_title, tcg_lookup_set_name, tcg_card_id";
const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24 * 365;
/** Unique order photo paths are never overwritten — long Cache-Control. */
const IMMUTABLE_CACHE_CONTROL = "604800";
/** Gallery can replace in place — shorter browser TTL. */
const GALLERY_CACHE_CONTROL = "86400";
/**
 * Clients compress images before upload (≤1200px WebP, see
 * imageCompression.js POST_COMPRESS_MAX_BYTES). Reject anything bigger so a
 * raw 30MB scan can never land in Storage and leak egress on every view.
 */
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Card icon uploads are tiny WebP only (client compresses to ≤320px). */
const MAX_GALLERY_CARD_THUMB_BYTES = 512 * 1024;

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

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
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
  path: string | null | undefined,
  cacheKey?: string | null
): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path);
  const url = data?.publicUrl ?? null;
  if (!url || !cacheKey) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${encodeURIComponent(String(cacheKey))}`;
}

function tcgThumbnailStoragePath(itemId: string, cardId: string): string {
  const slug = cardId.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
  return `item-${itemId}/tcg-${slug}.thumb.webp`;
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
  const thumbnailPath = item.thumbnail_path as string | null | undefined;
  const cacheKey =
    (item.updated_at as string | null | undefined) ||
    (item.tcg_card_id as string | null | undefined) ||
    null;
  return {
    ...item,
    urls: {
      thumbnail: galleryPublicUrl(supabase, thumbnailPath, cacheKey),
    },
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

const MAX_TIMER_MINUTES = 30 * 24 * 60;

type TimerOrderJoin =
  | { display_id: number | string | null; customer_name: string | null }
  | { display_id: number | string | null; customer_name: string | null }[]
  | null;

function unwrapTimerOrder(orders: TimerOrderJoin) {
  const row = Array.isArray(orders) ? orders[0] : orders;
  return {
    display_id: row?.display_id ?? null,
    customer_name: row?.customer_name ?? null,
  };
}

async function fetchInProgressTimers(
  supabase: ReturnType<typeof getServiceClient>
) {
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, order_id, card_name, set_name, status, timer_ends_at, timer_notified_at, sort_order, orders!inner(display_id, customer_name)"
    )
    .eq("status", "in_progress")
    .order("timer_ends_at", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const order = unwrapTimerOrder(row.orders as TimerOrderJoin);
    return {
      id: row.id,
      order_id: row.order_id,
      card_name: row.card_name ?? null,
      set_name: row.set_name ?? null,
      status: row.status ?? null,
      timer_ends_at: row.timer_ends_at ?? null,
      timer_notified_at: row.timer_notified_at ?? null,
      order_display_id: order.display_id,
      customer_name: order.customer_name,
    };
  });
}

async function addCardTimer(
  supabase: ReturnType<typeof getServiceClient>,
  cardId: string,
  durationMinutes: number
) {
  if (!cardId) throw new Error("card_id required");
  if (
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes > MAX_TIMER_MINUTES
  ) {
    throw new Error(
      `duration_minutes must be between 1 and ${MAX_TIMER_MINUTES}`
    );
  }

  const { data: card, error: fetchError } = await supabase
    .from("cards")
    .select("id, status, timer_ends_at")
    .eq("id", cardId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!card) throw new Error("card not found");
  if (card.status !== "in_progress") {
    throw new Error("timer only allowed on in_progress cards");
  }

  const nowMs = Date.now();
  const existingEndsMs = card.timer_ends_at
    ? new Date(card.timer_ends_at as string).getTime()
    : NaN;
  const baseMs =
    Number.isFinite(existingEndsMs) && existingEndsMs > nowMs
      ? existingEndsMs
      : nowMs;
  const endsAt = new Date(
    baseMs + durationMinutes * 60 * 1000
  ).toISOString();

  const maxEndsAt = new Date(nowMs + MAX_TIMER_MINUTES * 60 * 1000).getTime();
  if (new Date(endsAt).getTime() > maxEndsAt) {
    throw new Error("timer cannot extend more than 30 days from now");
  }

  const { data: updated, error } = await supabase
    .from("cards")
    .update({
      timer_ends_at: endsAt,
      timer_notified_at: null,
    })
    .eq("id", cardId)
    .eq("status", "in_progress")
    .select(
      "id, order_id, card_name, set_name, status, timer_ends_at, timer_notified_at"
    )
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new Error("failed to update timer");
  return updated;
}

async function clearCardTimer(
  supabase: ReturnType<typeof getServiceClient>,
  cardId: string
) {
  if (!cardId) throw new Error("card_id required");
  const { data: updated, error } = await supabase
    .from("cards")
    .update({
      timer_ends_at: null,
      timer_notified_at: null,
    })
    .eq("id", cardId)
    .select(
      "id, order_id, card_name, set_name, status, timer_ends_at, timer_notified_at"
    )
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new Error("card not found");
  return updated;
}

async function fetchOrderListSummary(supabase: ReturnType<typeof getServiceClient>) {
  const listSelectFull =
    "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, status, pending_kind, completed_at, status_changed_at, queue_priority, is_priority, quote_bulk_counts, quote_override_label, quote_override_amount, after_completion_amounts, restoration_costs";
  const listSelectNoQuote =
    "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, status, completed_at, status_changed_at, queue_priority, is_priority";
  const listSelectLegacy =
    "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, status, pending_kind, completed_at, status_changed_at, queue_priority";

  let { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(listSelectFull)
    .order("created_at", { ascending: false });
  if (ordersError) {
    const retry = await supabase
      .from("orders")
      .select(listSelectNoQuote)
      .order("created_at", { ascending: false });
    if (!retry.error) {
      orders = retry.data;
      ordersError = null;
    } else {
      const legacy = await supabase
        .from("orders")
        .select(listSelectLegacy)
        .order("created_at", { ascending: false });
      if (!legacy.error) {
        orders = (legacy.data ?? []).map((order) => ({
          ...order,
          is_priority: false,
        }));
        ordersError = null;
      }
    }
  }
  if (ordersError) throw ordersError;
  if (!orders?.length) return [];

  // 1-based place among status=new, same order as list_queue_orders / get_my_orders.
  const queuePositionById = new Map<string, number>();
  const newOrders = [...orders]
    .filter((o) => o.status === "new")
    .sort((a, b) => {
      const aPriority = Boolean(a.is_priority);
      const bPriority = Boolean(b.is_priority);
      if (aPriority !== bPriority) return aPriority ? -1 : 1;
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
      .select("id, order_id, status, sort_order, card_name, set_name")
      .in("order_id", orderIds)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("order_quote_items")
      .select("order_id, quote_base_amount, card_name, set_name")
      .in("order_id", orderIds),
    listAllAuthUsers(supabase),
  ]);
  if (cardsError) throw cardsError;
  const quoteItems = quoteItemsResult.error ? [] : quoteItemsResult.data ?? [];
  const emailSet = authEmailSet(authUsers);
  const emailToUserId = new Map(authUsers.map((u) => [u.email, u.id]));
  const namesByUserId = await fetchAccountNamesForOrders(
    supabase,
    orders,
    emailToUserId
  );

  const countByOrder = new Map<string, number>();
  const completedCountByOrder = new Map<string, number>();
  const cardOrderById = new Map<string, string>();
  const cardsByOrder = new Map<string, Array<Record<string, unknown>>>();
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
    const cardList = cardsByOrder.get(orderId) ?? [];
    cardList.push({
      id: cardId,
      status: card.status ?? null,
      card_name: card.card_name ?? null,
      set_name: card.set_name ?? null,
    });
    cardsByOrder.set(orderId, cardList);
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
  // Thumbs only — never fall back to signing full-size originals for the
  // kanban. A missing sibling renders a placeholder instead of a 30MB PNG.
  const signedMap = await signPathsThumbsOnly(supabase, allPreviewPaths);

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
      ...withAccountName(order, emailToUserId, namesByUserId),
      has_account: orderHasAccount(order, emailSet),
      quote_items: quoteItemsByOrder.get(orderId) ?? [],
      cards: cardsByOrder.get(orderId) ?? [],
      card_count: countByOrder.get(orderId) ?? 0,
      cards_completed: completedCountByOrder.get(orderId) ?? 0,
      queue_position: queuePositionById.get(orderId) ?? null,
      preview_paths: preview.map((row) => row.path),
      preview_urls: preview.map((row) => row.url),
    };
  });
}

const ORDER_SELECT_WITH_QUOTE =
  "id, display_id, created_at, first_name, last_name, customer_name, customer_email, user_id, delivery_method, general_notes, heard_about_source, photos_drive_url, status, pending_kind, completed_at, status_changed_at, queue_priority, is_priority, quote_bulk_counts, quote_override_label, quote_override_amount, after_completion_amounts, restoration_costs";
const ORDER_SELECT_BASE =
  "id, display_id, created_at, first_name, last_name, customer_name, customer_email, user_id, delivery_method, general_notes, heard_about_source, photos_drive_url, status, pending_kind, completed_at, status_changed_at, queue_priority, is_priority";

const ORDER_STATUS_IDS = new Set([
  "pending",
  "new",
  "in_progress",
  "ready",
  "completed",
  "canceled",
]);

const PENDING_KIND_IDS = new Set(["quote", "drop_off"]);

/** Normalize kanban / editor status ids before RPC (legacy aliases included). */
function normalizeOrderStatusForApi(raw: string): string {
  let status = String(raw ?? "").trim();
  if (
    status === "on_hold" ||
    status === "pending_quote" ||
    status === "pending_dropoff"
  ) {
    status = "pending";
  }
  if (status === "ready_for_customer") {
    status = "ready";
  }
  if (status === "cancelled") {
    status = "canceled";
  }
  if (status === "todo") {
    status = "new";
  }
  if (status === "delivered") {
    status = "completed";
  }
  return status;
}

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
  user_id: string | null;
  delivery_method: string | null;
  status: string | null;
  pending_kind: string | null;
  general_notes: string | null;
  completed_at: string | null;
  first_name?: string | null;
  last_name?: string | null;
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
  const [{ data: orders, error: ordersError }, authUsers] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, display_id, created_at, customer_name, customer_email, user_id, delivery_method, status, pending_kind, general_notes, completed_at"
      )
      .in("id", orderIds),
    listAllAuthUsers(supabase),
  ]);
  if (ordersError) throw ordersError;

  const emailToUserId = new Map(authUsers.map((u) => [u.email, u.id]));
  const namesByUserId = await fetchAccountNamesForOrders(
    supabase,
    (orders ?? []) as SearchOrderRow[],
    emailToUserId
  );

  const orderById = new Map(
    ((orders ?? []) as SearchOrderRow[]).map((order) => [
      order.id,
      withAccountName(order, emailToUserId, namesByUserId),
    ])
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
        pending_kind: order.pending_kind,
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
  if (ordersError) {
    let fallback = supabase
      .from("orders")
      .select(ORDER_SELECT_BASE)
      .order("created_at", { ascending: false });
    if (orderId) fallback = fallback.eq("id", orderId);
    let retry = await fallback;
    if (retry.error) {
      const legacySelect =
        "id, display_id, created_at, first_name, last_name, customer_name, customer_email, user_id, delivery_method, general_notes, heard_about_source, photos_drive_url, status, pending_kind, completed_at, status_changed_at, queue_priority";
      let legacy = supabase
        .from("orders")
        .select(legacySelect)
        .order("created_at", { ascending: false });
      if (orderId) legacy = legacy.eq("id", orderId);
      retry = await legacy;
      if (!retry.error) {
        orders = (retry.data ?? []).map((order) => ({
          ...order,
          is_priority: false,
        }));
        ordersError = null;
      }
    } else {
      orders = retry.data;
      ordersError = null;
    }
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
      .select(
        "id, order_id, sort_order, card_name, set_name, description, damage_tags, admin_note, market_value_raw_nm, status"
      )
      .in("order_id", orderIds)
      .order("sort_order", { ascending: true })
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
  const emailToUserId = new Map(authUsers.map((u) => [u.email, u.id]));
  const namesByUserId = await fetchAccountNamesForOrders(
    supabase,
    orders,
    emailToUserId
  );

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
    ...withAccountName(order, emailToUserId, namesByUserId),
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
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return jsonResponse(
      req,
      { ok: false, error: "image too large — compress it before uploading" },
      413
    );
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
    .select(
      GALLERY_ITEM_COLUMNS
    )
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
    .select(
      GALLERY_ITEM_COLUMNS
    )
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
  const isVideoUpload =
    file.type.startsWith("video/") ||
    detectMediaKindFromPath(file.name) === "video";
  if (!isVideoUpload && file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return jsonResponse(
      req,
      { ok: false, error: "image too large — compress it before uploading" },
      413
    );
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

  const inferredKind = isVideoUpload ? "video" : "image";

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

async function handleGalleryThumbnailUpload(
  req: Request,
  form: FormData,
  supabase: ReturnType<typeof getServiceClient>
) {
  const itemId = String(form.get("item_id") ?? "");
  const file = form.get("file");

  if (!itemId) {
    return jsonResponse(req, { ok: false, error: "item_id required" }, 400);
  }
  if (!(file instanceof File)) {
    return jsonResponse(req, { ok: false, error: "file required" }, 400);
  }
  if (!file.type.startsWith("image/")) {
    return jsonResponse(req, { ok: false, error: "image required" }, 400);
  }
  // Client prefers WebP; Safari falls back to JPEG (or PNG). Accept those.
  const allowedThumbTypes = new Set([
    "image/webp",
    "image/jpeg",
    "image/png",
  ]);
  if (!allowedThumbTypes.has(file.type)) {
    return jsonResponse(
      req,
      { ok: false, error: "thumbnail must be compressed WebP, JPEG, or PNG" },
      400
    );
  }
  if (file.size > MAX_GALLERY_CARD_THUMB_BYTES) {
    return jsonResponse(
      req,
      { ok: false, error: "thumbnail too large — recompress before uploading" },
      413
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("gallery_items")
    .select("id, thumbnail_path")
    .eq("id", itemId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) {
    return jsonResponse(req, { ok: false, error: "gallery item not found" }, 404);
  }

  const previousPath = existing.thumbnail_path as string | null;
  // Stored as .thumb.webp so gallery URL helpers serve this file directly (no sibling).
  const path = `item-${itemId}/card-icon.thumb.webp`;

  const { error: uploadError } = await supabase.storage
    .from(GALLERY_BUCKET)
    .upload(path, file, {
      upsert: true,
      contentType: file.type || "image/webp",
      cacheControl: GALLERY_CACHE_CONTROL,
    });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("gallery_items")
    .update({
      thumbnail_path: path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (updateError) throw updateError;

  if (previousPath && previousPath !== path) {
    await supabase.storage
      .from(GALLERY_BUCKET)
      .remove(pathsWithSiblings([previousPath]));
  }

  const item = await getGalleryItem(supabase, itemId);
  return jsonResponse(req, { ok: true, item });
}

async function saveGalleryItemThumbnailBytes(
  supabase: ReturnType<typeof getServiceClient>,
  itemId: string,
  bytes: Uint8Array,
  contentType: string,
  storagePath?: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("gallery_items")
    .select("id, thumbnail_path")
    .eq("id", itemId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existing) {
    throw new Error("gallery item not found");
  }

  const previousPath = existing.thumbnail_path as string | null;
  const path = storagePath ?? `item-${itemId}/card-icon.thumb.webp`;

  const { error: uploadError } = await supabase.storage
    .from(GALLERY_BUCKET)
    .upload(path, bytes, {
      upsert: true,
      contentType: contentType || "image/png",
      cacheControl: GALLERY_CACHE_CONTROL,
    });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("gallery_items")
    .update({
      thumbnail_path: path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (updateError) throw updateError;

  if (previousPath && previousPath !== path) {
    await supabase.storage
      .from(GALLERY_BUCKET)
      .remove(pathsWithSiblings([previousPath]));
  }
}

async function downloadCardImageBytes(card: {
  id: string;
  image_small: string;
  image_large: string;
}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const urls = [
    card.image_small,
    card.image_large,
    tcgCardImageSmallUrl(card.id),
  ].filter((url, index, all) => Boolean(url) && all.indexOf(url) === index);

  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType =
        response.headers.get("content-type")?.trim() || "image/png";
      return { bytes, contentType };
    } catch {
      /* try next source */
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("could not download card image");
}

async function applyTcgCardThumbnail(
  supabase: ReturnType<typeof getServiceClient>,
  itemId: string,
  cardId: string
) {
  const card = await fetchPokemonTcgCard(cardId);
  if (!card) {
    throw new Error("card not found");
  }

  const { bytes, contentType } = await downloadCardImageBytes(card);

  await saveGalleryItemThumbnailBytes(
    supabase,
    itemId,
    bytes,
    contentType,
    tcgThumbnailStoragePath(itemId, cardId)
  );

  const { error: lookupError } = await supabase
    .from("gallery_items")
    .update({
      tcg_card_id: card.id,
      tcg_lookup_title: card.name,
      tcg_lookup_set_name: card.set_name || null,
      title: card.name,
      set_name: card.set_name || null,
      card_number: card.number || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (lookupError) throw lookupError;

  return card;
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
  if (typeof body.tcg_lookup_title === "string") {
    patch.tcg_lookup_title = body.tcg_lookup_title.trim() || null;
  }
  if (typeof body.tcg_lookup_set_name === "string") {
    patch.tcg_lookup_set_name = body.tcg_lookup_set_name.trim() || null;
  }
  if (typeof body.tcg_card_id === "string") {
    patch.tcg_card_id = body.tcg_card_id.trim() || null;
  }
  if (typeof body.card_number === "string") {
    patch.card_number = body.card_number.trim() || null;
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

type AuthUserRow = {
  id: string;
  email: string;
  /** Signup JWT metadata — often set before customer_profiles exists. */
  first_name: string;
  last_name: string;
};

function authMetadataName(user: {
  user_metadata?: Record<string, unknown> | null;
}): { first_name: string; last_name: string } {
  const meta = user.user_metadata ?? {};
  return {
    first_name: String(meta.first_name ?? "").trim(),
    last_name: String(meta.last_name ?? "").trim(),
  };
}

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
      const metaName = authMetadataName(user);
      users.push({
        id: user.id,
        email,
        first_name: metaName.first_name,
        last_name: metaName.last_name,
      });
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

type ProfileNameRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

/** The account user id backing an order, if any — linked user_id first, else email match. */
function resolveOrderAccountUserId(
  order: { customer_email?: unknown; user_id?: unknown },
  emailToUserId: Map<string, string>
): string | null {
  if (order.user_id) return String(order.user_id);
  const email = normalizeEmail(order.customer_email);
  return (email && emailToUserId.get(email)) || null;
}

/** customer_profiles first/last name, keyed by user_id (includes blank names). */
async function fetchProfileNamesByUserIds(
  supabase: ReturnType<typeof getServiceClient>,
  userIds: string[]
): Promise<Map<string, ProfileNameRow>> {
  const map = new Map<string, ProfileNameRow>();
  if (userIds.length === 0) return map;

  const chunkSize = 200;
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("customer_profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", chunk);
    if (error) throw error;
    for (const row of (data ?? []) as ProfileNameRow[]) {
      map.set(row.user_id, row);
    }
  }
  return map;
}

type AccountSearchHit = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
};

const ACCOUNT_SEARCH_LIMIT = 20;
const ACCOUNT_SEARCH_MIN_CHARS = 1;

function pickNonEmptyName(
  ...candidates: Array<{ first_name?: string | null; last_name?: string | null } | null | undefined>
): { first_name: string; last_name: string } {
  for (const candidate of candidates) {
    const first = (candidate?.first_name ?? "").trim();
    const last = (candidate?.last_name ?? "").trim();
    if (first || last) return { first_name: first, last_name: last };
  }
  return { first_name: "", last_name: "" };
}

function namesFromOrderRow(row: {
  first_name?: unknown;
  last_name?: unknown;
  customer_name?: unknown;
}): { first_name: string; last_name: string } {
  const first = String(row.first_name ?? "").trim();
  const last = String(row.last_name ?? "").trim();
  if (first || last) return { first_name: first, last_name: last };
  const legacy = String(row.customer_name ?? "").trim();
  return legacy ? { first_name: legacy, last_name: "" } : { first_name: "", last_name: "" };
}

/**
 * Latest order name for accounts still missing profile/metadata names.
 * Prefers linked user_id rows, then email match. Keyed by user_id.
 */
async function fetchLatestOrderNamesForAccounts(
  supabase: ReturnType<typeof getServiceClient>,
  users: { id: string; email: string }[]
): Promise<Map<string, { first_name: string; last_name: string }>> {
  const byUserId = new Map<string, { first_name: string; last_name: string }>();
  if (users.length === 0) return byUserId;

  const emailToUserId = new Map(
    users.map((user) => [user.email, user.id] as const)
  );

  const absorbRows = (
    rows: {
      user_id?: unknown;
      customer_email?: unknown;
      first_name?: unknown;
      last_name?: unknown;
      customer_name?: unknown;
    }[]
  ) => {
    for (const row of rows) {
      const email = normalizeEmail(row.customer_email);
      const userId =
        (row.user_id && String(row.user_id)) || emailToUserId.get(email) || "";
      if (!userId || byUserId.has(userId)) continue;
      const names = namesFromOrderRow(row);
      if (!names.first_name && !names.last_name) continue;
      byUserId.set(userId, names);
    }
  };

  const chunkSize = 200;
  const userIds = users.map((user) => user.id);
  for (let i = 0; i < userIds.length; i += chunkSize) {
    const chunk = userIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("orders")
      .select("user_id, customer_email, first_name, last_name, customer_name, created_at")
      .in("user_id", chunk)
      .order("created_at", { ascending: false });
    if (error) throw error;
    absorbRows(data ?? []);
  }

  const emailsStillMissing = users
    .filter((user) => !byUserId.has(user.id))
    .map((user) => user.email);
  for (let i = 0; i < emailsStillMissing.length; i += chunkSize) {
    const chunk = emailsStillMissing.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("orders")
      .select("user_id, customer_email, first_name, last_name, customer_name, created_at")
      .in("customer_email", chunk)
      .order("created_at", { ascending: false });
    if (error) throw error;
    absorbRows(data ?? []);
  }

  return byUserId;
}

function normalizeAccountSearchText(value: string): string {
  return value.trim().toLowerCase();
}

/** Every query token must appear in first, last, full name, or email (substring). */
function accountMatchesSearchTokens(
  firstName: string,
  lastName: string,
  email: string,
  tokens: string[]
): boolean {
  if (tokens.length === 0) return false;
  const emailLocal = email.includes("@") ? email.slice(0, email.indexOf("@")) : email;
  const fields = [
    firstName,
    lastName,
    `${firstName} ${lastName}`.trim(),
    email,
    emailLocal,
  ].map(normalizeAccountSearchText);

  return tokens.every((token) => fields.some((field) => field.includes(token)));
}

function accountSearchRank(
  hit: AccountSearchHit,
  query: string,
  tokens: string[]
): number {
  const email = normalizeAccountSearchText(hit.email);
  const first = normalizeAccountSearchText(hit.first_name);
  const last = normalizeAccountSearchText(hit.last_name);
  const full = `${first} ${last}`.trim();
  const primary = tokens[0] ?? query;

  if (email === query) return 0;
  if (full === query) return 1;
  if (email.startsWith(query)) return 2;
  if (full.startsWith(query)) return 3;
  if (first.startsWith(primary) || last.startsWith(primary)) return 4;
  if (email.includes(query) || full.includes(query)) return 5;
  return 6;
}

/**
 * Match Auth users by fuzzy name/email tokens for admin new-order prefill.
 * Name resolution: customer_profiles → Auth user_metadata → latest order.
 */
async function searchCustomerAccounts(
  supabase: ReturnType<typeof getServiceClient>,
  rawQuery: string
): Promise<{
  accounts: AccountSearchHit[];
  query: string;
  truncated: boolean;
}> {
  const trimmed = rawQuery.trim();
  const query = normalizeAccountSearchText(trimmed);
  const tokens = query.split(/\s+/).filter(Boolean);
  if (query.length < ACCOUNT_SEARCH_MIN_CHARS || tokens.length === 0) {
    return { accounts: [], query: trimmed, truncated: false };
  }

  const authUsers = await listAllAuthUsers(supabase);
  const namesByUserId = await fetchProfileNamesByUserIds(
    supabase,
    authUsers.map((user) => user.id)
  );

  const usersNeedingOrderNames = authUsers.filter((user) => {
    const resolved = pickNonEmptyName(namesByUserId.get(user.id), user);
    return !resolved.first_name && !resolved.last_name;
  });
  const orderNamesByUserId = await fetchLatestOrderNamesForAccounts(
    supabase,
    usersNeedingOrderNames
  );

  const matched: AccountSearchHit[] = [];
  for (const user of authUsers) {
    const { first_name: firstName, last_name: lastName } = pickNonEmptyName(
      namesByUserId.get(user.id),
      user,
      orderNamesByUserId.get(user.id)
    );
    if (!accountMatchesSearchTokens(firstName, lastName, user.email, tokens)) {
      continue;
    }
    matched.push({
      user_id: user.id,
      email: user.email,
      first_name: firstName,
      last_name: lastName,
    });
  }

  matched.sort((a, b) => {
    const rankDelta =
      accountSearchRank(a, query, tokens) - accountSearchRank(b, query, tokens);
    if (rankDelta !== 0) return rankDelta;
    const nameA = `${a.first_name} ${a.last_name}`.trim() || a.email;
    const nameB = `${b.first_name} ${b.last_name}`.trim() || b.email;
    return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
  });

  const truncated = matched.length > ACCOUNT_SEARCH_LIMIT;
  return {
    accounts: matched.slice(0, ACCOUNT_SEARCH_LIMIT),
    query: trimmed,
    truncated,
  };
}

/** customer_profiles first/last name, keyed by user_id, for every account behind these orders. */
async function fetchAccountNamesForOrders(
  supabase: ReturnType<typeof getServiceClient>,
  orders: { customer_email?: unknown; user_id?: unknown }[],
  emailToUserId: Map<string, string>
): Promise<Map<string, ProfileNameRow>> {
  const userIds = new Set<string>();
  for (const order of orders) {
    const userId = resolveOrderAccountUserId(order, emailToUserId);
    if (userId) userIds.add(userId);
  }
  if (userIds.size === 0) return new Map();

  const { data, error } = await supabase
    .from("customer_profiles")
    .select("user_id, first_name, last_name")
    .in("user_id", [...userIds]);
  if (error) throw error;

  const map = new Map<string, ProfileNameRow>();
  for (const row of (data ?? []) as ProfileNameRow[]) {
    if ((row.first_name ?? "").trim() || (row.last_name ?? "").trim()) {
      map.set(row.user_id, row);
    }
  }
  return map;
}

/**
 * Admin should always see the account's current first/last name, not
 * whatever was submitted on the order, if that account has a saved name.
 * Legacy orders that only stored a single customer_name surface that value
 * as first_name when first/last were never split.
 */
function withAccountName<
  T extends {
    customer_email?: unknown;
    user_id?: unknown;
    customer_name?: unknown;
    first_name?: unknown;
    last_name?: unknown;
  }
>(
  order: T,
  emailToUserId: Map<string, string>,
  namesByUserId: Map<string, ProfileNameRow>
): T {
  let result: T = order;
  const userId = resolveOrderAccountUserId(order, emailToUserId);
  const profile = userId ? namesByUserId.get(userId) : undefined;

  if (profile) {
    // Use the account name as-is (even if one side is blank). Do not fill
    // the empty side from the order — that mixes two sources of truth.
    const firstName = (profile.first_name ?? "").trim();
    const lastName = (profile.last_name ?? "").trim();
    const combined = [firstName, lastName].filter(Boolean).join(" ");

    result = {
      ...order,
      first_name: firstName,
      last_name: lastName,
      customer_name: combined || order.customer_name,
    };
  }

  const first = String(result.first_name ?? "").trim();
  const last = String(result.last_name ?? "").trim();
  const legacyName = String(result.customer_name ?? "").trim();
  if (!first && !last && legacyName) {
    return { ...result, first_name: legacyName };
  }
  return result;
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
      if (kind === "gallery_thumbnail") {
        return await handleGalleryThumbnailUpload(req, form, supabase);
      }
      if (kind !== "order") {
        return jsonResponse(
          req,
          { ok: false, error: `unknown upload kind: ${kind || "(missing)"}` },
          400
        );
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

    // Type-to-search Auth accounts (name / email) for admin new-order prefill.
    if (action === "search_accounts") {
      const payload = await searchCustomerAccounts(
        supabase,
        String(body.q ?? body.query ?? "")
      );
      return jsonResponse(req, { ok: true, ...payload });
    }

    // Shell order — guests stay unlinked (claim_my_orders on signup).
    // If the email already belongs to an account, attach that user_id.
    if (action === "create") {
      const firstName = String(body.first_name ?? "").trim();
      const lastName = String(body.last_name ?? "").trim();
      const customerEmail = String(body.customer_email ?? "").trim();
      const deliveryMethod = String(body.delivery_method ?? "").trim();

      if (!firstName) {
        return jsonResponse(req, { ok: false, error: "first_name required" }, 400);
      }
      if (!lastName) {
        return jsonResponse(req, { ok: false, error: "last_name required" }, 400);
      }
      if (!customerEmail || !isValidEmail(normalizeEmail(customerEmail))) {
        return jsonResponse(req, { ok: false, error: "valid customer_email required" }, 400);
      }
      if (
        deliveryMethod !== "local_dropoff" &&
        deliveryMethod !== "shipping"
      ) {
        return jsonResponse(
          req,
          { ok: false, error: "delivery_method must be local_dropoff or shipping" },
          400
        );
      }

      const orderId = crypto.randomUUID();
      const customerName = `${firstName} ${lastName}`.trim();
      const linkedUserId = await resolveUserIdByEmail(
        supabase,
        normalizeEmail(customerEmail)
      );

      const { data: inserted, error: insertError } = await supabase
        .from("orders")
        .insert({
          id: orderId,
          user_id: linkedUserId,
          first_name: firstName,
          last_name: lastName,
          customer_name: customerName,
          customer_email: customerEmail,
          delivery_method: deliveryMethod,
          preferred_contact_type: "email",
          preferred_contact_value: customerEmail,
          status: "pending",
          pending_kind: "quote",
          is_priority: false,
        })
        .select(
          "id, display_id, created_at, first_name, last_name, customer_name, delivery_method, general_notes"
        )
        .single();
      if (insertError) throw insertError;

      const { error: originalError } = await supabase
        .from("orders_original")
        .insert({
          id: inserted.id,
          display_id: inserted.display_id,
          created_at: inserted.created_at,
          first_name: inserted.first_name,
          last_name: inserted.last_name,
          customer_name: inserted.customer_name,
          delivery_method: inserted.delivery_method,
          general_notes: inserted.general_notes,
        });
      if (originalError) {
        await supabase.from("orders").delete().eq("id", orderId);
        throw originalError;
      }

      const order = await fetchOrderGraph(supabase, orderId);
      if (!order) {
        return jsonResponse(
          req,
          { ok: false, error: "order not found after create" },
          404
        );
      }
      return jsonResponse(req, { ok: true, order, full: order });
    }

    if (action === "set_status") {
      const orderId = String(body.order_id ?? "");
      const status = normalizeOrderStatusForApi(String(body.status ?? ""));
      if (!orderId || !status) {
        return jsonResponse(req, { ok: false, error: "order_id and status required" }, 400);
      }
      if (!ORDER_STATUS_IDS.has(status)) {
        return jsonResponse(req, { ok: false, error: "invalid status" }, 400);
      }
      const hasIndex = body.queue_index !== undefined && body.queue_index !== null;
      const queueIndex = hasIndex ? Number(body.queue_index) : null;
      if (hasIndex && !Number.isFinite(queueIndex)) {
        return jsonResponse(req, { ok: false, error: "queue_index must be a number" }, 400);
      }
      if (hasIndex) {
        return jsonResponse(
          req,
          { ok: false, error: "manual queue reorder is no longer supported" },
          400
        );
      }

      const pendingKindRaw =
        body.pending_kind === undefined || body.pending_kind === null
          ? undefined
          : String(body.pending_kind);
      if (
        pendingKindRaw !== undefined &&
        !PENDING_KIND_IDS.has(pendingKindRaw)
      ) {
        return jsonResponse(req, { ok: false, error: "invalid pending_kind" }, 400);
      }

      const orderPatch: Record<string, string> = { status };
      if (status === "pending") {
        orderPatch.pending_kind = pendingKindRaw ?? "quote";
      }
      const { error } = await supabase.rpc("update_order", {
        p_order_id: orderId,
        p_order: orderPatch,
      });
      if (error) throw error;

      const order = await fetchOrderGraph(supabase, orderId);
      return jsonResponse(req, { ok: true, order });
    }

    if (action === "set_pending_kind") {
      const orderId = String(body.order_id ?? "");
      const pendingKind = String(body.pending_kind ?? "");
      if (!orderId || !pendingKind) {
        return jsonResponse(
          req,
          { ok: false, error: "order_id and pending_kind required" },
          400
        );
      }
      if (!PENDING_KIND_IDS.has(pendingKind)) {
        return jsonResponse(req, { ok: false, error: "invalid pending_kind" }, 400);
      }
      const { error } = await supabase.rpc("update_order", {
        p_order_id: orderId,
        p_order: { pending_kind: pendingKind },
      });
      if (error) throw error;
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
        .select("id, card_id, storage_path")
        .eq("id", imageId)
        .maybeSingle();
      if (imageError) throw imageError;
      if (!image) {
        return jsonResponse(req, { ok: false, error: "photo not found" }, 404);
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
          console.error("card photo storage cleanup failed", storageError);
        }
      }

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

      // Admin-only ledger — not handled by update_order; write after RPC.
      const hasAfterCompletion = Object.prototype.hasOwnProperty.call(
        orderPatch,
        "after_completion_amounts"
      );
      const hasRestorationCosts = Object.prototype.hasOwnProperty.call(
        orderPatch,
        "restoration_costs"
      );
      const afterCompletionAmounts = hasAfterCompletion
        ? orderPatch.after_completion_amounts
        : undefined;
      const restorationCosts = hasRestorationCosts
        ? orderPatch.restoration_costs
        : undefined;
      delete orderPatch.after_completion_amounts;
      delete orderPatch.restoration_costs;

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

      if (hasAfterCompletion || hasRestorationCosts) {
        const ledgerPatch: Record<string, unknown> = {};
        if (hasAfterCompletion) {
          ledgerPatch.after_completion_amounts = Array.isArray(
            afterCompletionAmounts
          )
            ? afterCompletionAmounts
            : [];
        }
        if (hasRestorationCosts) {
          ledgerPatch.restoration_costs = Array.isArray(restorationCosts)
            ? restorationCosts
            : [];
        }
        const { error: ledgerError } = await supabase
          .from("orders")
          .update(ledgerPatch)
          .eq("id", orderId);
        if (ledgerError) throw ledgerError;
      }

      if (omittedPhotoPaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(BUCKET)
          .remove(pathsWithSiblings(omittedPhotoPaths));
        if (storageError) {
          console.error("omitted card photo cleanup failed", storageError);
        }
      }


      const order = await fetchOrderGraph(supabase, orderId);
      if (!order) {
        return jsonResponse(req, { ok: false, error: "order not found after save" }, 404);
      }
      return jsonResponse(req, { ok: true, order, full: order });
    }

    if (action === "column_reorder") {
      return jsonResponse(
        req,
        { ok: false, error: "manual queue reorder is no longer supported" },
        400
      );
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
        tcg_lookup_title:
          typeof body.tcg_lookup_title === "string"
            ? body.tcg_lookup_title.trim() || null
            : null,
        tcg_lookup_set_name:
          typeof body.tcg_lookup_set_name === "string"
            ? body.tcg_lookup_set_name.trim() || null
            : null,
        tcg_card_id:
          typeof body.tcg_card_id === "string"
            ? body.tcg_card_id.trim() || null
            : null,
        card_number:
          typeof body.card_number === "string"
            ? body.card_number.trim() || null
            : null,
      };

      const { data, error } = await supabase
        .from("gallery_items")
        .insert(insertRow)
        .select(
          GALLERY_ITEM_COLUMNS
        )
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

      const { data: existingRow, error: existingError } = await supabase
        .from("gallery_items")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existingRow) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }

      const mutableKeys = Object.keys(patch).filter((key) => key !== "updated_at");
      if (mutableKeys.length === 0) {
        return jsonResponse(req, { ok: false, error: "no fields to update" }, 400);
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

      const { data: itemRow, error: itemFetchError } = await supabase
        .from("gallery_items")
        .select("thumbnail_path")
        .eq("id", id)
        .maybeSingle();
      if (itemFetchError) throw itemFetchError;
      if (itemRow?.thumbnail_path) {
        paths.push(itemRow.thumbnail_path as string);
      }

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

    if (action === "gallery_thumbnail_clear") {
      const itemId = String(body.item_id ?? "");
      if (!itemId) {
        return jsonResponse(req, { ok: false, error: "item_id required" }, 400);
      }

      const { data: existing, error: existingError } = await supabase
        .from("gallery_items")
        .select("id, thumbnail_path")
        .eq("id", itemId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return jsonResponse(req, { ok: false, error: "not found" }, 404);
      }

      const previousPath = existing.thumbnail_path as string | null;
      const { error: updateError } = await supabase
        .from("gallery_items")
        .update({
          thumbnail_path: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      if (updateError) throw updateError;

      if (previousPath) {
        await supabase.storage
          .from(GALLERY_BUCKET)
          .remove(pathsWithSiblings([previousPath]));
      }

      const item = await getGalleryItem(supabase, itemId);
      return jsonResponse(req, { ok: true, item });
    }

    if (action === "gallery_tcg_search") {
      const cardName = normalizeSearchText(
        typeof body.card_name === "string"
          ? body.card_name
          : typeof body.q === "string"
            ? body.q
            : ""
      );
      const setName = normalizeSearchText(
        typeof body.set_name === "string" ? body.set_name : ""
      );
      const page = Math.max(1, Number(body.page) || 1);
      const pageSize = Math.min(Math.max(Number(body.page_size) || 24, 1), 50);

      if (cardName.length < 2 && setName.length < 2) {
        return jsonResponse(
          req,
          {
            ok: false,
            error: "Enter card name (3+ chars) or set (2+ chars)",
          },
          400
        );
      }

      if (
        cardName.length > 0 &&
        cardName.length < 3 &&
        setName.length < 2
      ) {
        return jsonResponse(
          req,
          {
            ok: false,
            error: "Add a set name, or enter at least 3 characters for card name",
          },
          400
        );
      }

      try {
        const result = await searchPokemonTcgCatalog(cardName, setName, {
          page,
          pageSize,
        });
        return jsonResponse(req, {
          ok: true,
          candidates: result.candidates,
          total_count: result.totalCount,
          page: result.page,
          page_size: result.pageSize,
          query_used: result.query_used,
        });
      } catch (err) {
        console.error("gallery_tcg_search", err);
        const raw = err instanceof Error ? err.message : String(err);
        const error = /timed out|abort/i.test(raw)
          ? "Card lookup timed out. Try again."
          : /429/.test(raw)
            ? "Card lookup is rate limited. Wait a moment and try again."
            : "Card lookup failed. Try again.";
        return jsonResponse(req, { ok: false, error }, 502);
      }
    }

    if (action === "gallery_tcg_apply") {
      const itemId = String(body.item_id ?? "");
      const cardId = String(body.card_id ?? "");
      if (!itemId || !cardId) {
        return jsonResponse(
          req,
          { ok: false, error: "item_id and card_id required" },
          400
        );
      }

      const { data: itemRow, error: itemError } = await supabase
        .from("gallery_items")
        .select("id")
        .eq("id", itemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!itemRow) {
        return jsonResponse(req, { ok: false, error: "gallery item not found" }, 404);
      }

      try {
        const card = await applyTcgCardThumbnail(supabase, itemId, cardId);
        const item = await getGalleryItem(supabase, itemId);
        return jsonResponse(req, { ok: true, item, card });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not apply TCG thumbnail";
        return jsonResponse(req, { ok: false, error: message }, 502);
      }
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

      const messageColumnsWithSender =
        "id, recipient_email, user_id, order_id, subject, body, changelog, sent_at, email_status, email_error, read_at, batch_id, sender, orders(display_id)";
      const messageColumnsLegacy =
        "id, recipient_email, user_id, order_id, subject, body, changelog, sent_at, email_status, email_error, read_at, batch_id, orders(display_id)";

      async function runMessagesQuery(columns: string) {
        let query = supabase
          .from("customer_messages")
          .select(columns)
          .order("sent_at", { ascending: false })
          .limit(limit);

        if (emailFilter) {
          query = query.eq("recipient_email", emailFilter);
        }
        if (orderIdFilter) {
          query = query.eq("order_id", orderIdFilter);
        }

        return query;
      }

      let { data, error } = await runMessagesQuery(messageColumnsWithSender);
      if (
        error &&
        (/sender/i.test(error.message || "") ||
          /sender/i.test(error.details || "") ||
          error.code === "42703")
      ) {
        ({ data, error } = await runMessagesQuery(messageColumnsLegacy));
      }
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
        return {
          ...rest,
          sender: (rest as { sender?: string }).sender === "customer"
            ? "customer"
            : "admin",
          order_display_id: displayId,
        };
      });

      return jsonResponse(req, { ok: true, messages });
    }

    if (action === "messages_send") {
      const subject =
        typeof body.subject === "string" ? body.subject.trim() : "";
      const messageBody = typeof body.body === "string" ? body.body : "";
      const changelog =
        body.changelog && typeof body.changelog === "object"
          ? body.changelog
          : null;
      const hasChangelog =
        Boolean(changelog) &&
        ((Array.isArray((changelog as { cardGroups?: unknown }).cardGroups) &&
          ((changelog as { cardGroups: unknown[] }).cardGroups?.length ?? 0) >
            0) ||
          (Array.isArray((changelog as { orderChanges?: unknown }).orderChanges) &&
            ((changelog as { orderChanges: unknown[] }).orderChanges?.length ??
              0) > 0) ||
          Boolean((changelog as { quoteSummary?: unknown }).quoteSummary));
      if (!subject) {
        return jsonResponse(req, { ok: false, error: "subject required" }, 400);
      }
      if (!messageBody.trim() && !hasChangelog) {
        return jsonResponse(
          req,
          { ok: false, error: "body or changelog required" },
          400
        );
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

        // sender defaults to 'admin' once the customer_update_my_order migration
        // is applied; omit the column so pre-migration deploys keep working.
        const { data: inserted, error: insertError } = await supabase
          .from("customer_messages")
          .insert({
            order_id: orderId,
            recipient_email: email,
            user_id: userId,
            subject,
            body: storedBody,
            changelog: hasChangelog ? changelog : null,
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
          changelog: hasChangelog ? (changelog as never) : null,
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

    if (action === "insights_heard_about") {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, display_id, created_at, customer_name, customer_email, status, pending_kind, heard_about_source"
        )
        .order("created_at", { ascending: false });
      if (error) throw error;

      const KNOWN_LABELS = [
        "Instagram",
        "Facebook",
        "Discord",
        "Card show",
        "Friend",
      ];
      const knownByLower = new Map(
        KNOWN_LABELS.map((label) => [label.toLowerCase(), label])
      );
      const bucketOrders = new Map<
        string,
        Array<Record<string, unknown>>
      >();
      const otherOrders = new Map<
        string,
        Array<Record<string, unknown>>
      >();
      let total = 0;
      let answered = 0;

      function summarizeOrder(row: Record<string, unknown>) {
        return {
          id: row.id,
          display_id: row.display_id,
          created_at: row.created_at,
          customer_name: row.customer_name,
          customer_email: row.customer_email,
          status: row.status,
          pending_kind: row.pending_kind ?? null,
          heard_about_source: row.heard_about_source,
        };
      }

      function pushBucket(bucket: string, row: Record<string, unknown>) {
        const list = bucketOrders.get(bucket) ?? [];
        list.push(summarizeOrder(row));
        bucketOrders.set(bucket, list);
      }

      for (const row of data ?? []) {
        // Skip canceled — they rarely reflect real acquisition.
        if (String(row.status ?? "") === "canceled") continue;
        total += 1;
        const trimmed = String(row.heard_about_source ?? "").trim();
        // Unanswered stay out of the pie; still counted in `total` for response rate.
        if (!trimmed) continue;
        answered += 1;
        const known = knownByLower.get(trimmed.toLowerCase());
        if (known) {
          pushBucket(known, row);
        } else {
          pushBucket("Other", row);
          const list = otherOrders.get(trimmed) ?? [];
          list.push(summarizeOrder(row));
          otherOrders.set(trimmed, list);
        }
      }

      const bucketOrder = [...KNOWN_LABELS, "Other"];
      const slices = bucketOrder
        .filter((label) => (bucketOrders.get(label)?.length ?? 0) > 0)
        .map((label) => {
          const orders = bucketOrders.get(label) ?? [];
          return { label, count: orders.length, orders };
        });

      const other_details = [...otherOrders.entries()]
        .map(([label, orders]) => ({
          label,
          count: orders.length,
          orders,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

      return jsonResponse(req, {
        ok: true,
        total,
        answered,
        slices,
        other_details,
      });
    }

    if (action === "timers_list") {
      const cards = await fetchInProgressTimers(supabase);
      return jsonResponse(req, { ok: true, cards });
    }

    if (action === "timers_notify_due") {
      const result = await notifyDueCardTimers(
        supabase,
        Deno.env.get("CARD_TIMER_DISCORD_WEBHOOK_URL")
      );
      return jsonResponse(req, result);
    }

    if (action === "timer_add") {
      const cardId = String(body.card_id ?? "");
      const durationMinutes = Number(body.duration_minutes);
      try {
        const card = await addCardTimer(supabase, cardId, durationMinutes);
        return jsonResponse(req, { ok: true, card });
      } catch (err) {
        const message = rpcErrorMessage(err);
        const status =
          message.includes("required") ||
          message.includes("must be") ||
          message.includes("only allowed") ||
          message.includes("cannot extend")
            ? 400
            : message.includes("not found")
              ? 404
              : 500;
        return jsonResponse(req, { ok: false, error: message }, status);
      }
    }

    if (action === "timer_clear") {
      const cardId = String(body.card_id ?? "");
      try {
        const card = await clearCardTimer(supabase, cardId);
        return jsonResponse(req, { ok: true, card });
      } catch (err) {
        const message = rpcErrorMessage(err);
        const status = message.includes("required")
          ? 400
          : message.includes("not found")
            ? 404
            : 500;
        return jsonResponse(req, { ok: false, error: message }, status);
      }
    }

    return jsonResponse(req, { ok: false, error: `unknown action: ${action || "(missing)"}` }, 400);
  } catch (err) {
    const message = rpcErrorMessage(err);
    if (message.includes("unauthorized")) {
      return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
    }
    console.error(err);
    return jsonResponse(req, { ok: false, error: message }, 500);
  }
});
