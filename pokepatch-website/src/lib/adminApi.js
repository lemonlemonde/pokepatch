const TOKEN_KEY = "pokepatch-admin-token";

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
  return payload.orders ?? [];
}

export async function adminGetOrder(orderId) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "get", order_id: orderId },
  });
  return payload.order;
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
  return payload.full ?? payload.order;
}

export async function adminSetStatus(orderId, status) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: { action: "set_status", order_id: orderId, status },
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

export async function adminUploadPhoto(orderId, cardId, imageType, file) {
  const formData = new FormData();
  formData.append("kind", "order");
  formData.append("order_id", orderId);
  formData.append("card_id", cardId);
  formData.append("image_type", imageType);
  formData.append("file", file);

  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    formData,
  });
  return payload.image;
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

export async function adminUploadGalleryPairSide(pairId, side, file) {
  const formData = new FormData();
  formData.append("kind", "gallery");
  formData.append("pair_id", pairId);
  formData.append("side", side);
  formData.append("file", file);

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
