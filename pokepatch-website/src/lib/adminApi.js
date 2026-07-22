import { thumbPath } from "@/lib/imageCompression";
import { reuseOrRememberSignedUrl } from "@/lib/signedUrlCache";

const TOKEN_KEY = "pokepatch-admin-token";

/** Matches admin-api SIGNED_URL_EXPIRES_IN so we keep the same token warm. */
const ADMIN_SIGNED_TTL_SEC = 60 * 60 * 24 * 365;
const CARD_PHOTOS_BUCKET = "card-photos";

function stabilizeUrl(storagePath, freshUrl) {
  return reuseOrRememberSignedUrl(
    CARD_PHOTOS_BUCKET,
    storagePath,
    freshUrl,
    ADMIN_SIGNED_TTL_SEC
  );
}

/** Keep the same signed tokens across list/get refreshes (CDN + browser cache). */
function stabilizeOrderSummary(order) {
  if (!order) return order;
  const paths = Array.isArray(order.preview_paths) ? order.preview_paths : null;
  const urls = Array.isArray(order.preview_urls) ? order.preview_urls : null;
  if (!paths?.length || !urls?.length) return order;

  const preview_urls = paths
    .map((path, i) => {
      const fresh = urls[i];
      if (!path || !fresh) return null;
      // List previews are prefer-thumb signed.
      return stabilizeUrl(thumbPath(path), fresh);
    })
    .filter(Boolean);

  return { ...order, preview_urls };
}

function stabilizeOrderDetail(order) {
  if (!order) return order;
  const base = stabilizeOrderSummary(order);
  if (!Array.isArray(base.cards)) return base;

  return {
    ...base,
    cards: base.cards.map((card) => ({
      ...card,
      images: (card.images ?? []).map((image) => {
        const path = image.storage_path;
        if (!path) return image;
        let signed_url = image.signed_url ?? null;
        let signed_thumb_url = image.signed_thumb_url ?? null;
        if (signed_url) {
          signed_url = stabilizeUrl(path, signed_url);
        }
        if (signed_thumb_url) {
          signed_thumb_url = stabilizeUrl(thumbPath(path), signed_thumb_url);
        }
        return { ...image, signed_url, signed_thumb_url };
      }),
    })),
  };
}

function stabilizeImageRow(image) {
  if (!image?.storage_path) return image;
  const path = image.storage_path;
  let signed_url = image.signed_url ?? null;
  let signed_thumb_url = image.signed_thumb_url ?? null;
  if (signed_url) signed_url = stabilizeUrl(path, signed_url);
  if (signed_thumb_url) {
    signed_thumb_url = stabilizeUrl(thumbPath(path), signed_thumb_url);
  }
  return { ...image, signed_url, signed_thumb_url };
}

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
}

function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
}

export function isAdminApiConfigured() {
  return Boolean(getSupabaseUrl() && getAnonKey());
}

export function getStoredAdminToken() {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function storeAdminToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredAdminToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

function authUrl() {
  return `${getSupabaseUrl()}/functions/v1/admin-auth`;
}

function apiUrl() {
  return `${getSupabaseUrl()}/functions/v1/admin-api`;
}

async function adminRequest(url, { token, body, formData, method = "POST" } = {}) {
  const anonKey = getAnonKey();
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
  if (token) {
    headers["X-Admin-Token"] = token;
  }
  if (!formData) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: formData ?? (body ? JSON.stringify(body) : undefined),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const message =
      (typeof payload?.error === "string" && payload.error) ||
      (typeof payload?.message === "string" && payload.message) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

/** Mint an admin session from a signed-in customer's Supabase access token. */
export async function adminLoginWithSession(accessToken) {
  if (!accessToken) throw new Error("Missing session");
  const anonKey = getAnonKey();
  const response = await fetch(authUrl(), {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "loginWithSession" }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const message =
      (typeof payload?.error === "string" && payload.error) ||
      (typeof payload?.message === "string" && payload.message) ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  storeAdminToken(payload.token);
  return payload;
}

export async function adminLogout() {
  const token = getStoredAdminToken();
  if (token) {
    try {
      await adminRequest(authUrl(), {
        token,
        body: { action: "logout" },
      });
    } catch {
      // ignore — clear local session anyway
    }
  }
  clearStoredAdminToken();
}

export async function adminValidate() {
  const token = getStoredAdminToken();
  if (!token) return false;
  try {
    await adminRequest(authUrl(), {
      token,
      body: { action: "validate" },
    });
    return true;
  } catch {
    clearStoredAdminToken();
    return false;
  }
}

export async function adminListOrders() {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "list" },
  });
  return (payload.orders ?? []).map(stabilizeOrderSummary);
}

/** Search cards by name/set/description; optionally scope to order statuses. */
export async function adminSearchOrders(query, { statuses } = {}) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "search",
      q: query,
      statuses: statuses ?? [],
    },
  });
  const results = (payload.results ?? []).map((hit) => {
    const card = hit?.card;
    if (!card?.preview_path || !card?.preview_url) return hit;
    return {
      ...hit,
      card: {
        ...card,
        preview_url: stabilizeUrl(
          thumbPath(card.preview_path),
          card.preview_url
        ),
      },
    };
  });
  return {
    results,
    query: payload.query ?? String(query ?? ""),
    truncated: Boolean(payload.truncated),
  };
}

export async function adminReorderStatusOrders(status, orderedIds) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "column_reorder",
      status,
      ordered_ids: orderedIds,
    },
  });
  return payload;
}

export async function adminGetOrder(orderId) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "get", order_id: orderId },
  });
  return stabilizeOrderDetail(payload.order);
}

export async function adminSaveOrder(
  orderId,
  { order, contacts, cards, quote_items }
) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "save",
      order_id: orderId,
      order,
      contacts,
      cards,
      quote_items,
    },
  });
  return stabilizeOrderDetail(payload.full ?? payload.order);
}

export async function adminSetStatus(orderId, status, queueIndex = null) {
  const body = { action: "set_status", order_id: orderId, status };
  if (queueIndex != null && Number.isFinite(Number(queueIndex))) {
    body.queue_index = Number(queueIndex);
  }
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body,
  });
  return payload.order;
}

export async function adminDeleteOrders(orderIds) {
  const ids = [...new Set((orderIds ?? []).map(String).filter(Boolean))];
  if (ids.length === 0) {
    throw new Error("No orders selected.");
  }
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "delete", order_ids: ids },
  });
  return payload.deleted;
}

export async function adminUploadPhoto(
  orderId,
  cardId,
  imageType,
  file,
  { thumb = null } = {}
) {
  const formData = new FormData();
  formData.append("kind", "order");
  formData.append("order_id", orderId);
  formData.append("card_id", cardId);
  formData.append("image_type", imageType);
  formData.append("file", file);
  if (thumb) formData.append("thumb", thumb);

  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    formData,
  });
  return stabilizeImageRow(payload.image);
}

export async function adminDeletePhoto(orderId, imageId) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "delete_photo",
      order_id: orderId,
      image_id: imageId,
    },
  });
  return payload.deleted_image_id;
}

export async function adminListGallery() {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "gallery_list" },
  });
  return payload.items ?? [];
}

export async function adminCreateGalleryItem({
  title,
  set_name = "",
  damage_tags = [],
  published = true,
} = {}) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "gallery_create",
      title,
      set_name,
      damage_tags,
      published,
    },
  });
  return payload.item;
}

export async function adminSaveGalleryItem(id, fields) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "gallery_save",
      id,
      ...fields,
    },
  });
  return payload.item;
}

export async function adminDeleteGalleryItem(id) {
  await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "gallery_delete", id },
  });
}

export async function adminCreateGalleryPair(itemId, mediaKind = "image") {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "gallery_pair_create",
      item_id: itemId,
      media_kind: mediaKind,
    },
  });
  return payload.item;
}

export async function adminDeleteGalleryPair(pairId) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "gallery_pair_delete", pair_id: pairId },
  });
  return payload.item;
}

export async function adminReorderGalleryPairs(itemId, orderedIds) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "gallery_pair_reorder",
      item_id: itemId,
      ordered_ids: orderedIds,
    },
  });
  return payload.item;
}

export async function adminSaveGalleryPairCaption(pairId, caption) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "gallery_pair_save_caption",
      pair_id: pairId,
      caption,
    },
  });
  return payload.item;
}

export async function adminClearGalleryPairSide(pairId, side) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "gallery_pair_clear_side",
      pair_id: pairId,
      side,
    },
  });
  return payload.item;
}

export async function adminUploadGalleryPairSide(
  pairId,
  side,
  file,
  { thumb = null, poster = null } = {}
) {
  const formData = new FormData();
  formData.append("kind", "gallery");
  formData.append("pair_id", pairId);
  formData.append("side", side);
  formData.append("file", file);
  if (thumb) formData.append("thumb", thumb);
  if (poster) formData.append("poster", poster);

  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    formData,
  });
  return payload.item;
}

export async function adminMessageHistory({ email, order_id, limit } = {}) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "messages_history",
      email: email || undefined,
      order_id: order_id || undefined,
      limit: limit || undefined,
    },
  });
  return payload.messages ?? [];
}

export async function adminSendMessages({
  order_ids = [],
  subject,
  body,
} = {}) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "messages_send",
      order_ids,
      subject,
      body,
    },
  });
  return payload;
}
