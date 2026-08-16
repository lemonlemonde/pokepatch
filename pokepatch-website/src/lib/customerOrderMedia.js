import { thumbPath } from "@/lib/imageCompression";
import {
  forgetSignedUrl,
  getCachedSignedUrls,
} from "@/lib/signedUrlCache";
import { supabase } from "@/lib/supabaseClient";

export const CARD_PHOTOS_BUCKET = "card-photos";
export const SIGNED_URL_EXPIRES_IN = 60 * 60 * 24; // 24h

/** Mint signed URLs for private card-photos paths (thumb preferred for grids). */
export async function signPaths(paths, { preferThumb = false } = {}) {
  const unique = [...new Set((paths || []).filter(Boolean))];
  if (!supabase || unique.length === 0) return {};

  const requestPaths = preferThumb ? unique.map((p) => thumbPath(p)) : unique;
  const signedByRequestPath = await getCachedSignedUrls(
    supabase,
    CARD_PHOTOS_BUCKET,
    requestPaths,
    SIGNED_URL_EXPIRES_IN
  );

  const map = {};
  const missingOriginals = [];
  for (let i = 0; i < unique.length; i += 1) {
    const original = unique[i];
    const requestPath = requestPaths[i];
    const url = signedByRequestPath[requestPath];
    if (url) {
      map[original] = url;
    } else if (preferThumb) {
      missingOriginals.push(original);
    }
  }

  if (missingOriginals.length > 0) {
    const fallback = await getCachedSignedUrls(
      supabase,
      CARD_PHOTOS_BUCKET,
      missingOriginals,
      SIGNED_URL_EXPIRES_IN
    );
    Object.assign(map, fallback);
  }

  return map;
}

export async function resolveFullAfterBadThumb(storagePath, setFullUrls, setThumbUrls) {
  if (!storagePath) return null;
  forgetSignedUrl(CARD_PHOTOS_BUCKET, thumbPath(storagePath));
  const map = await signPaths([storagePath], { preferThumb: false });
  const full = map[storagePath] ?? null;
  if (full) {
    setFullUrls?.((prev) =>
      prev[storagePath] ? prev : { ...prev, [storagePath]: full }
    );
    setThumbUrls?.((prev) => ({ ...prev, [storagePath]: full }));
  }
  return full;
}

export function sanitizeFilename(name) {
  return String(name ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}
