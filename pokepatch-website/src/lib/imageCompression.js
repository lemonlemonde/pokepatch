/**
 * Downscale + re-encode images in the browser before upload so we store small
 * display files and never depend on Supabase Image Transformations.
 * Videos and non-images are returned unchanged. Animated GIFs are left as-is.
 */

export const UPLOAD_MAX_DIMENSION = 1200;
export const UPLOAD_QUALITY = 0.75;
export const CARD_THUMB_MAX_DIMENSION = 320;
export const GALLERY_THUMB_MAX_DIMENSION = 640;
export const POST_COMPRESS_MAX_BYTES = 15 * 1024 * 1024;

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

async function resizeToWebpFile(
  file,
  { maxDimension, quality, nameSuffix = "" }
) {
  if (!file || typeof window === "undefined") return null;
  if (!file.type || !file.type.startsWith("image/")) return null;
  if (file.type === "image/gif") return null;

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const { width, height } = bitmap;
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
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality)
    );
    if (!blob) return null;

    const baseName = baseNameFromFile(file);
    return new File([blob], `${baseName}${nameSuffix}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } finally {
    bitmap.close?.();
  }
}

/**
 * Compress an image for Storage upload (≤1200px WebP @ ~0.75).
 * Returns { file, error }. On success `file` is the compressed File (or the
 * original for non-images / GIF). On decode failure `error` is a user message.
 */
export async function compressImageForUpload(
  file,
  { maxDimension = UPLOAD_MAX_DIMENSION, quality = UPLOAD_QUALITY } = {}
) {
  if (!file) return { file: null, error: "No file selected." };
  if (typeof window === "undefined") return { file, error: null };
  if (!file.type || !file.type.startsWith("image/")) {
    return { file, error: null };
  }
  if (file.type === "image/gif") {
    return { file, error: null };
  }

  try {
    const compressed = await resizeToWebpFile(file, {
      maxDimension,
      quality,
      nameSuffix: "",
    });
    if (!compressed) {
      return {
        file: null,
        error: "Couldn't process this image — try JPEG or PNG.",
      };
    }

    if (compressed.size > POST_COMPRESS_MAX_BYTES) {
      return {
        file: null,
        error: "Image is still too large after compression. Try a smaller photo.",
      };
    }

    return { file: compressed, error: null };
  } catch {
    return {
      file: null,
      error: "Couldn't process this image — try JPEG or PNG.",
    };
  }
}

/**
 * Small WebP sibling for list UIs. Returns { file, error }.
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
    const thumb = await resizeToWebpFile(file, {
      maxDimension,
      quality,
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
 * Capture a poster frame from a video File as WebP.
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

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality)
    );
    if (!blob) {
      return {
        file: null,
        error: "Couldn't capture a poster from this video.",
      };
    }

    const baseName = baseNameFromFile(videoFile);
    return {
      file: new File([blob], `${baseName}.poster.webp`, {
        type: "image/webp",
        lastModified: Date.now(),
      }),
      error: null,
    };
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
