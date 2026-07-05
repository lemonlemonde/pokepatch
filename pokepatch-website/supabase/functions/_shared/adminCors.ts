const ALLOWED_ORIGINS = [
  "https://pokepatch.cards",
  "https://www.pokepatch.cards",
  "https://lemonlemonde.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-admin-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

export function getAdminToken(req: Request): string | null {
  return req.headers.get("X-Admin-Token")?.trim() || null;
}

export function getSupabaseAnonKey(req: Request): string | null {
  return req.headers.get("apikey")?.trim() ||
    req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    null;
}
