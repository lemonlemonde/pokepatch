import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

export async function createSession(
  supabase: SupabaseClient
): Promise<{ token: string; expires_at: string }> {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error } = await supabase.from("admin_sessions").insert({
    token,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return { token, expires_at: expiresAt };
}

export async function validateSession(
  supabase: SupabaseClient,
  token: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("admin_sessions")
    .select("token, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return false;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabase.from("admin_sessions").delete().eq("token", token);
    return false;
  }
  return true;
}

export async function deleteSession(
  supabase: SupabaseClient,
  token: string
): Promise<void> {
  await supabase.from("admin_sessions").delete().eq("token", token);
}

export async function requireSession(
  supabase: SupabaseClient,
  token: string | null
): Promise<void> {
  if (!token) throw new Error("unauthorized");
  const ok = await validateSession(supabase, token);
  if (!ok) throw new Error("unauthorized");
}
