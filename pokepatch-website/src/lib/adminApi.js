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
  const headers = {
    apikey: getAnonKey(),
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

export async function adminLogin(password) {
  const payload = await adminRequest(authUrl(), {
    body: { action: "login", password },
  });
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

export async function adminSaveOrder(orderId, { order, contacts, cards }) {
  const payload = await adminRequest(apiUrl(), {
    token: getStoredAdminToken(),
    body: {
      action: "save",
      order_id: orderId,
      order,
      contacts,
      cards,
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

export async function adminUploadPhoto(orderId, cardId, imageType, file) {
  const formData = new FormData();
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
