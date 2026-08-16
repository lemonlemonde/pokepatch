/**
 * Downscale + re-encode images in the browser before upload so we store small
 * display files and never depend on Supabase Image Transformations.
 * Videos and non-images are returned unchanged. Animated GIFs are left as-is.
 *
 * Encoding prefers WebP, but falls back to JPEG when the browser cannot encode
 * WebP (Safari still cannot via canvas.toBlob — it silently yields PNG).
 */

export const UPLOAD_MAX_DIMENSION = 1200;
export const UPLOAD_QUALITY = 0.75;
export const CARD_THUMB_MAX_DIMENSION = 320;
export const GALLERY_THUMB_MAX_DIMENSION = 640;
export const POST_COMPRESS_MAX_BYTES = 15 * 1024 * 1024;

const WEBP_TYPE = "image/webp";
const JPEG_TYPE = "image/jpeg";

/** Sibling path for list/thumbnail UI: foo.webp → foo.thumb.webp */
export function thumbPath(storagePath) {
  if (!storagePath || typeof storagePath !== "string") return storagePath;
  if (storagePath.endsWith(".thumb.webp") || storagePath.endsWith(".poster.webp")) {
    return storagePath;
  }
  return `${storagePath}.thumb.webp`;
}

/** Sibling poster for a video: clip.mp4 → clip.mp4.poster.webp */
export function posterPath(videoPath) {
  if (!videoPath || typeof videoPath !== "string") return videoPath;
  if (videoPath.endsWith(".poster.webp")) return videoPath;
  return `${videoPath}.poster.webp`;
}

/** Paths to remove alongside a main storage object (thumb + poster siblings). */
export function siblingPaths(storagePath) {
  if (!storagePath || typeof storagePath !== "string") return [];
  if (
    storagePath.endsWith(".thumb.webp") ||
    storagePath.endsWith(".poster.webp")
  ) {
    return [];
  }
  return [thumbPath(storagePath), posterPath(storagePath)];
}

function baseNameFromFile(file) {
  return file?.name?.replace(/\.[^.]+$/, "") || "image";
}

function isHeicLike(file) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  return /\.hei[cf]$/i.test(file.name || "");
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = url;
  });
}

/**
 * Decode a Blob/File to something canvas.drawImage can use.
 * Prefers ImageBitmap; falls back to an HTMLImageElement when createImageBitmap
 * fails (seen with some HEIC/Safari paths and odd MIME labels).
 */
async function drawableFromBlob(blob) {
  try {
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: "from-image",
    });
    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    };
  } catch {
    // continue
  }

  try {
    const bitmap = await createImageBitmap(blob);
    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close?.(),
    };
  } catch {
    // continue
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(url);
    return {
      drawable: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/** File/Blob/Canvas/Image → drawable + dimensions + release(). */
async function drawableFromSource(source) {
  if (!source) return null;

  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return {
      drawable: source,
      width: source.width,
      height: source.height,
      release: () => {},
    };
  }

  if (
    typeof HTMLCanvasElement !== "undefined" &&
    source instanceof HTMLCanvasElement
  ) {
    return {
      drawable: source,
      width: source.width,
      height: source.height,
      release: () => {},
    };
  }

  if (
    typeof HTMLImageElement !== "undefined" &&
    source instanceof HTMLImageElement
  ) {
    return {
      drawable: source,
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
      release: () => {},
    };
  }

  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return drawableFromBlob(source);
  }

  return null;
}

/**
 * Encode a canvas to a File. Prefer WebP; if the browser can't produce WebP
 * (Safari returns PNG for an unsupported type), fall back to JPEG and label
 * the File with the real MIME type.
 */
async function encodeCanvasToFile(
  canvas,
  { quality = UPLOAD_QUALITY, baseName = "image", nameSuffix = "" } = {}
) {
  if (!canvas) return null;

  const tryEncode = (mimeType) =>
    new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    });

  let blob = await tryEncode(WEBP_TYPE);
  let type = WEBP_TYPE;
  let ext = "webp";

  // Unsupported type → browsers fall back to PNG. Anything that isn't actually
  // WebP (including empty type) gets a JPEG retry so we never mislabel bytes.
  if (!blob || blob.type !== WEBP_TYPE) {
    blob = await tryEncode(JPEG_TYPE);
    type = JPEG_TYPE;
    ext = "jpg";
  }

  if (!blob) return null;

  return new File([blob], `${baseName}${nameSuffix}.${ext}`, {
    type,
    lastModified: Date.now(),
  });
}

async function resizeSourceToUploadFile(
  source,
  { maxDimension, quality, baseName, nameSuffix = "" }
) {
  if (!source || typeof window === "undefined") return null;

  const loaded = await drawableFromSource(source);
  if (!loaded) return null;

  try {
    const { drawable, width, height } = loaded;
    if (!width || !height) return null;

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(drawable, 0, 0, targetWidth, targetHeight);

    return encodeCanvasToFile(canvas, {
      quality,
      baseName: baseName || "image",
      nameSuffix,
    });
  } finally {
    loaded.release?.();
  }
}

function isPassthroughImage(file) {
  if (!file?.type) return true;
  if (!file.type.startsWith("image/")) return true;
  if (file.type === "image/gif") return true;
  return false;
}

function compressFailureMessage(source) {
  return isHeicLike(source)
    ? "Couldn't process this HEIC image — export it as JPEG or PNG first."
    : "Couldn't process this image — try JPEG or PNG.";
}

/**
 * Compress an image for Storage upload (≤1200px WebP/JPEG @ ~0.75).
 * Accepts File/Blob or an HTMLCanvasElement (Studio crop/annotation path).
 * Returns { file, error }. On success `file` is the compressed File (or the
 * original for non-images / GIF). On decode failure `error` is a user message.
 */
export async function compressImageForUpload(
  source,
  { maxDimension = UPLOAD_MAX_DIMENSION, quality = UPLOAD_QUALITY } = {}
) {
  if (!source) return { file: null, error: "No file selected." };
  if (typeof window === "undefined") {
    return {
      file: typeof Blob !== "undefined" && source instanceof Blob ? source : null,
      error: null,
    };
  }

  const isCanvas =
    typeof HTMLCanvasElement !== "undefined" &&
    source instanceof HTMLCanvasElement;

  if (!isCanvas && isPassthroughImage(source)) {
    return { file: source, error: null };
  }

  try {
    const compressed = await resizeSourceToUploadFile(source, {
      maxDimension,
      quality,
      baseName: isCanvas ? "image" : baseNameFromFile(source),
      nameSuffix: "",
    });
    if (!compressed) {
      return { file: null, error: compressFailureMessage(source) };
    }

    if (compressed.size > POST_COMPRESS_MAX_BYTES) {
      return {
        file: null,
        error: "Image is still too large after compression. Try a smaller photo.",
      };
    }

    return { file: compressed, error: null };
  } catch {
    return { file: null, error: compressFailureMessage(source) };
  }
}

/**
 * Small WebP/JPEG sibling for list UIs. Returns { file, error }.
 * Non-images / GIF → { file: null, error: null } (caller skips thumb upload).
 */
export async function makeThumbForUpload(
  file,
  { maxDimension = CARD_THUMB_MAX_DIMENSION, quality = 0.7 } = {}
) {
  if (!file || typeof window === "undefined") {
    return { file: null, error: null };
  }
  if (!file.type || !file.type.startsWith("image/") || file.type === "image/gif") {
    return { file: null, error: null };
  }

  try {
    const thumb = await resizeSourceToUploadFile(file, {
      maxDimension,
      quality,
      baseName: baseNameFromFile(file),
      nameSuffix: ".thumb",
    });
    if (!thumb) {
      return {
        file: null,
        error: "Couldn't create thumbnail for this image.",
      };
    }
    return { file: thumb, error: null };
  } catch {
    return {
      file: null,
      error: "Couldn't create thumbnail for this image.",
    };
  }
}

/**
 * Capture a poster frame from a video File as WebP/JPEG.
 * Returns { file, error }.
 */
export async function makeVideoPosterForUpload(
  videoFile,
  { maxDimension = GALLERY_THUMB_MAX_DIMENSION, quality = 0.7 } = {}
) {
  if (!videoFile || typeof window === "undefined") {
    return { file: null, error: "No video selected." };
  }
  if (!videoFile.type || !videoFile.type.startsWith("video/")) {
    return { file: null, error: "Not a video file." };
  }

  const objectUrl = URL.createObjectURL(videoFile);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = objectUrl;

    await new Promise((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
    });

    // Seek a hair past start so we get a real frame (some codecs black at 0).
    const seekTo = Math.min(0.1, (video.duration || 1) * 0.05);
    if (Number.isFinite(seekTo) && seekTo > 0) {
      await new Promise((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = seekTo;
      });
    }

    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!width || !height) {
      return {
        file: null,
        error: "Couldn't capture a poster from this video.",
      };
    }

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        file: null,
        error: "Couldn't capture a poster from this video.",
      };
    }
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    const file = await encodeCanvasToFile(canvas, {
      quality,
      baseName: baseNameFromFile(videoFile),
      nameSuffix: ".poster",
    });
    if (!file) {
      return {
        file: null,
        error: "Couldn't capture a poster from this video.",
      };
    }
    return { file, error: null };
  } catch {
    return {
      file: null,
      error: "Couldn't capture a poster from this video.",
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Legacy helper used where callers expect a File back.
 * Prefer compressImageForUpload which returns { file, error }.
 */
export async function compressImageForUploadOrPassthrough(file, options) {
  const { file: out, error } = await compressImageForUpload(file, options);
  if (error) throw new Error(error);
  return out ?? file;
}
