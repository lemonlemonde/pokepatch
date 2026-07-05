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

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const supabase = getServiceClient();
    const body = req.method === "POST" ? await req.json() : {};
    const action = String(body.action ?? "validate");

    if (action === "login") {
      const password = String(body.password ?? "");
      const expected = Deno.env.get("ADMIN_PASSWORD") ?? "";
      if (!expected || password !== expected) {
        return jsonResponse(req, { ok: false, error: "invalid password" }, 401);
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
