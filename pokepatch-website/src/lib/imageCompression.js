/**
 * Downscale + re-encode an image File in the browser before upload so we never
 * store huge originals (which are slow to load and exceed Supabase's transform
 * size limit). Videos and non-images are returned unchanged. On any failure the
 * original file is returned so uploads never break.
 */
export async function compressImageForUpload(
  file,
  { maxDimension = 2000, quality = 0.85 } = {}
) {
  if (!file || typeof window === "undefined") return file;
  if (!file.type || !file.type.startsWith("image/")) return file;
  // Animated GIFs would lose their animation when re-encoded — leave as-is.
  if (file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const { width, height } = bitmap;
    if (!width || !height) {
      bitmap.close?.();
      return file;
    }

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality)
    );
    if (!blob) return file;

    // If we neither downscaled nor shrank the bytes, keep the original.
    if (scale === 1 && blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}
