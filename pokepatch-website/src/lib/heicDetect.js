/**
 * HEIC/HEIF detection only — no decoder. Keep this tiny so quote/admin
 * bundles can sniff files without pulling in heic-to (~3MB).
 */

const HEIC_MIME = /^image\/hei[cf](-sequence)?$/i;
const HEIC_EXT = /\.hei[cf]$/i;
/** ISO-BMFF brands used by HEIC/HEIF. `mif1` is also AVIF — only used after
 * native decode already failed. */
const HEIC_FTYP = /^(heic|heix|heif|heis|heim|hevc|hevx|mif1|msf1)$/i;

export function isHeicLikeFile(file) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  if (HEIC_MIME.test(type)) return true;
  return HEIC_EXT.test(file.name || "");
}

/** True when a storage path or signed URL points at a .heic/.heif object. */
export function isHeicLikeSrc(src) {
  if (!src || typeof src !== "string") return false;
  if (src.startsWith("blob:") || src.startsWith("data:")) return false;
  const path = src.split("?")[0].split("#")[0];
  return HEIC_EXT.test(path);
}

export function likelyAlreadyWebImage(file) {
  const type = (file.type || "").toLowerCase();
  return (
    type === "image/jpeg" ||
    type === "image/jpg" ||
    type === "image/png" ||
    type === "image/webp" ||
    type === "image/gif"
  );
}

export async function sniffIsHeic(blob) {
  if (!blob || typeof blob.slice !== "function") return false;
  try {
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (bytes.length < 12) return false;
    const tag = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (tag !== "ftyp") return false;
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    return HEIC_FTYP.test(brand);
  } catch {
    return false;
  }
}

/** MIME/extension match, or a sniff when the type is missing/wrong. */
export async function needsHeicDecode(file) {
  if (!file) return false;
  if (isHeicLikeFile(file)) return true;
  if (likelyAlreadyWebImage(file)) return false;
  return sniffIsHeic(file);
}
