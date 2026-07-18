import {
  corsHeaders,
  getAdminToken,
  handleOptions,
  jsonResponse,
} from "../_shared/adminCors.ts";
import {
  createSession,
  deleteSession,
  getServiceClient,
  validateSession,
} from "../_shared/adminSession.ts";

function getAllowedAdminEmails(): string[] {
  return (Deno.env.get("ADMIN_ALLOWED_EMAILS") ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const supabase = getServiceClient();
    const body = req.method === "POST" ? await req.json() : {};
    const action = String(body.action ?? "validate");

    if (action === "loginWithSession") {
      const jwt = getBearerToken(req);
      if (!jwt) {
        return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
      }

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(jwt);
      if (error || !user?.email) {
        return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
      }

      const allowed = getAllowedAdminEmails();
      if (
        allowed.length === 0 ||
        !allowed.includes(user.email.trim().toLowerCase())
      ) {
        return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
      }

      const session = await createSession(supabase);
      return jsonResponse(req, { ok: true, ...session });
    }

    const token = getAdminToken(req);
    if (!token) {
      return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
    }

    if (action === "logout") {
      await deleteSession(supabase, token);
      return jsonResponse(req, { ok: true });
    }

    if (action === "validate") {
      const ok = await validateSession(supabase, token);
      if (!ok) {
        return jsonResponse(req, { ok: false, error: "unauthorized" }, 401);
      }
      return jsonResponse(req, { ok: true });
    }

    return jsonResponse(req, { ok: false, error: "unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return jsonResponse(req, { ok: false, error: String(err) }, 500);
  }
});
