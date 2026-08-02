import { corsHeaders, handleOptions, jsonResponse } from "../_shared/adminCors.ts";
import { getServiceClient } from "../_shared/adminSession.ts";
import { sendResendEmail } from "../_shared/resend.ts";

const LOGIN_URL = "https://pokepatch.cards/login";
const RATE_LIMIT_MAX = 4;
const RATE_LIMIT_WINDOW_MINUTES = 30;

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Paginated auth user lookup by email — mirrors admin-api's listAllAuthUsers. */
async function findAuthUserIdByEmail(
  supabase: ReturnType<typeof getServiceClient>,
  email: string
): Promise<string | null> {
  const perPage = 200;
  let page = 1;

  while (page <= 50) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return null;

    const match = (data?.users ?? []).find(
      (u) => (u.email ?? "").trim().toLowerCase() === email
    );
    if (match) return match.id;

    const count = data?.users?.length ?? 0;
    if (count < perPage) break;
    page += 1;
  }

  return null;
}

/** True when this email has already hit the send limit within the window. */
async function isRateLimited(
  supabase: ReturnType<typeof getServiceClient>,
  email: string
): Promise<boolean> {
  const windowStart = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
  ).toISOString();

  const { count, error } = await supabase
    .from("account_signup_notice_log")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("sent_at", windowStart);

  // Fail open on a query error — a rare DB hiccup shouldn't silently block a
  // legitimate customer from getting the notice.
  if (error) return false;

  return (count ?? 0) >= RATE_LIMIT_MAX;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  // Always the same generic response, whether or not the email matched an
  // account — this endpoint's response must never be a way to check who has
  // an account. The email itself (only readable by the inbox owner) is the
  // only real signal.
  const generic = () => jsonResponse(req, { ok: true });

  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders(req),
      });
    }

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail((body as { email?: unknown })?.email);
    if (!email || !isValidEmail(email)) {
      return generic();
    }

    const supabase = getServiceClient();
    const userId = await findAuthUserIdByEmail(supabase, email);
    if (!userId) {
      return generic();
    }

    if (await isRateLimited(supabase, email)) {
      return generic();
    }

    const sendResult = await sendResendEmail({
      to: email,
      subject: "You already have a PokePatch account",
      body:
        "Looks like you just tried to create a PokePatch account with this " +
        "email address, but you already have one.\n\n" +
        `Log in here: ${LOGIN_URL}\n\n` +
        "If this wasn't you, you can safely ignore this email.",
    });

    if (sendResult.ok) {
      const { error: logError } = await supabase
        .from("account_signup_notice_log")
        .insert({ email });
      if (logError) {
        console.error("account-signup-notice: failed to log send", logError);
      }
    }

    return generic();
  } catch (err) {
    console.error("account-signup-notice error", err);
    return generic();
  }
});
