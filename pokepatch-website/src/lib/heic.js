/**
 * HEIC/HEIF conversion. Chrome and Firefox cannot decode these; Safari can.
 * iOS photo pickers often send HEIC with an empty MIME type, which used to
 * bypass compression and land in Storage as-is — admin then sees a broken
 * image. Convert to JPEG in the browser (heic-to, loaded on demand).
 */

import {
  isHeicLikeSrc,
  needsHeicDecode,
  sniffIsHeic,
} from "@/lib/heicDetect";

let heicToPromise = null;

function loadHeicTo() {
  if (!heicToPromise) {
    heicToPromise = import("heic-to").then((mod) => mod.heicTo);
  }
  return heicToPromise;
}

async function heicToJpegBlob(blob, { quality = 0.92 } = {}) {
  const heicTo = await loadHeicTo();
  return heicTo({ blob, type: "image/jpeg", quality });
}

export async function heicToBitmap(blob) {
  const heicTo = await loadHeicTo();
  try {
    return await heicTo({
      blob,
      type: "bitmap",
      options: { imageOrientation: "from-image" },
    });
  } catch {
    return heicTo({ blob, type: "bitmap" });
  }
}

/** JPEG blob if input is HEIC; otherwise the original. */
export async function webImageBlob(blob) {
  if (!blob) return blob;
  if (await needsHeicDecode(blob)) return heicToJpegBlob(blob);
  return blob;
}

/**
 * Object URL suitable for <img>. HEIC files are converted to JPEG first so
 * Chrome/Firefox previews aren't blank.
 */
export async function createPreviewObjectUrl(file) {
  if (!file) return null;
  try {
    if (await needsHeicDecode(file)) {
      const jpeg = await heicToJpegBlob(file);
      return URL.createObjectURL(jpeg);
    }
  } catch {
    // Safari can still preview native HEIC.
  }
  return URL.createObjectURL(file);
}

/** Fetch a remote HEIC and return a JPEG object URL, or null if not HEIC. */
export async function heicSrcToObjectUrl(src) {
  if (!src) return null;
  const res = await fetch(src);
  if (!res.ok) return null;
  const blob = await res.blob();
  const type = (blob.type || "").toLowerCase();
  const heic =
    isHeicLikeSrc(src) ||
    type.includes("heic") ||
    type.includes("heif") ||
    (await sniffIsHeic(blob));
  if (!heic) return null;
  const jpeg = await heicToJpegBlob(blob);
  return URL.createObjectURL(jpeg);
}
