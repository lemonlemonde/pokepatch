function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
}

function getAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
}

/**
 * Supabase's signUp() never errors for an email that already has a
 * confirmed account — it's intentional anti-enumeration behavior, and
 * instead returns a normal-looking response with an empty `identities`
 * array (a genuinely new signup has a non-empty one). Use that to tell the
 * two cases apart instead of relying on an error that will never come.
 */
export function isExistingAccountSignup(signUpData) {
  return (
    Array.isArray(signUpData?.user?.identities) &&
    signUpData.user.identities.length === 0
  );
}

/** Fire-and-forget: ask the backend to email this address a "log in instead" notice. */
export async function sendExistingAccountNotice(email) {
  const url = getSupabaseUrl();
  const anonKey = getAnonKey();
  if (!url || !anonKey) return;

  try {
    await fetch(`${url}/functions/v1/account-signup-notice`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
  } catch (err) {
    console.error("Failed to send existing-account notice:", err);
  }
}
