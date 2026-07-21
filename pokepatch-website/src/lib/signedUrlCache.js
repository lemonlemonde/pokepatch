/**
 * Reuse signed Storage URLs so browser + Supabase Smart CDN can cache hits.
 * A fresh token on every createSignedUrls call is a new cache key → origin egress.
 *
 * Memory + sessionStorage. Keys are bucket + object path.
 */

const MEMORY = new Map();
const STORAGE_PREFIX = "pokepatch:signed:";
/** Refresh a bit before real expiry so mid-session loads don't 401. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function storageKey(bucket, path) {
  return `${STORAGE_PREFIX}${bucket}:${path}`;
}

function readEntry(bucket, path) {
  const key = storageKey(bucket, path);
  const mem = MEMORY.get(key);
  if (mem && mem.expiresAt > Date.now() + REFRESH_SKEW_MS) return mem.url;

  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed?.url &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Date.now() + REFRESH_SKEW_MS
    ) {
      MEMORY.set(key, parsed);
      return parsed.url;
    }
    sessionStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
  return null;
}

function writeEntry(bucket, path, url, expiresInSeconds) {
  const entry = {
    url,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };
  const key = storageKey(bucket, path);
  MEMORY.set(key, entry);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* ignore quota */
  }
}

/** Drop a cached URL (e.g. thumb signed but object 404s). */
export function forgetSignedUrl(bucket, path) {
  if (!bucket || !path) return;
  const key = storageKey(bucket, path);
  MEMORY.delete(key);
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Prefer a previously cached signed URL for this path; otherwise remember `freshUrl`.
 * Used when an API already minted a URL (admin-api) so we keep the same token.
 */
export function reuseOrRememberSignedUrl(
  bucket,
  path,
  freshUrl,
  expiresInSeconds
) {
  if (!path || !freshUrl) return freshUrl || null;
  const cached = readEntry(bucket, path);
  if (cached) return cached;
  writeEntry(bucket, path, freshUrl, expiresInSeconds);
  return freshUrl;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} bucket
 * @param {string[]} paths
 * @param {number} expiresInSeconds
 * @returns {Promise<Record<string, string>>} path → signedUrl
 */
export async function getCachedSignedUrls(
  supabase,
  bucket,
  paths,
  expiresInSeconds
) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  const result = {};
  const missing = [];

  for (const path of unique) {
    const cached = readEntry(bucket, path);
    if (cached) result[path] = cached;
    else missing.push(path);
  }

  if (missing.length === 0 || !supabase) return result;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(missing, expiresInSeconds);
  if (error || !data) return result;

  for (let i = 0; i < missing.length; i += 1) {
    const path = missing[i];
    const item = data[i];
    if (item?.signedUrl && !item.error) {
      result[path] = item.signedUrl;
      writeEntry(bucket, path, item.signedUrl, expiresInSeconds);
    }
  }

  return result;
}
