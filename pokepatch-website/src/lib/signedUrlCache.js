/**
 * Reuse signed Storage URLs so browser + Supabase Smart CDN can cache hits.
 * A fresh token on every createSignedUrls call is a new cache key → origin egress.
 *
 * Memory + sessionStorage. Keys are bucket + object path.
 *
 * Safety rails (learned the hard way — a stale full-size URL cached under a
 * thumb key served 35MB originals on every kanban render for days):
 *   1. Entries are only stored/served when the URL's object path matches the
 *      cache key path exactly (no full-object URL under a thumb key).
 *   2. Client-side reuse is capped at 24h even if the token lives longer, so a
 *      bad entry can never persist for a year.
 *   3. Versioned namespace — bumping STORAGE_PREFIX invalidates old entries.
 */

const MEMORY = new Map();
/** v2: invalidates pre-validation entries that may hold full-size URLs. */
const STORAGE_PREFIX = "pokepatch:signed:v2:";
/** Refresh a bit before real expiry so mid-session loads don't 401. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
/** Never reuse an entry longer than this, regardless of token validity. */
const MAX_REUSE_MS = 24 * 60 * 60 * 1000;

function storageKey(bucket, path) {
  return `${STORAGE_PREFIX}${bucket}:${path}`;
}

/**
 * True when `url` is a signed Storage URL for exactly `bucket`/`path`.
 * Guards against caching (or serving) a URL for a different object than the
 * key claims — e.g. a full-size fallback URL under a `.thumb.webp` key.
 */
export function signedUrlMatchesPath(bucket, path, url) {
  if (!bucket || !path || !url) return false;
  try {
    const parsed = new URL(url, "https://placeholder.invalid");
    const pathname = decodeURIComponent(parsed.pathname);
    return pathname.endsWith(`/object/sign/${bucket}/${path}`);
  } catch {
    return false;
  }
}

function entryIsFresh(entry) {
  return (
    entry?.url &&
    typeof entry.expiresAt === "number" &&
    entry.expiresAt > Date.now() + REFRESH_SKEW_MS
  );
}

function readEntry(bucket, path) {
  const key = storageKey(bucket, path);
  const mem = MEMORY.get(key);
  if (entryIsFresh(mem) && signedUrlMatchesPath(bucket, path, mem.url)) {
    return mem.url;
  }

  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (entryIsFresh(parsed) && signedUrlMatchesPath(bucket, path, parsed.url)) {
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
  // Refuse to cache a URL that doesn't point at the keyed object.
  if (!signedUrlMatchesPath(bucket, path, url)) return;
  const ttlMs = Math.min(expiresInSeconds * 1000, MAX_REUSE_MS);
  const entry = {
    url,
    expiresAt: Date.now() + ttlMs,
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
 * If `freshUrl` points at a different object than `path` (e.g. a full-size
 * fallback), it is returned as-is but never cached under this key.
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
