import { drawShapesOnCanvas } from "@/lib/shapeAnnotations";

const MIN_NORM = 0.05;
export const DEFAULT_CROP = { x: 0, y: 0, w: 1, h: 1 };

export const CROP_HANDLES = [
  { id: "nw", cursor: "nwse-resize" },
  { id: "n", cursor: "ns-resize" },
  { id: "ne", cursor: "nesw-resize" },
  { id: "e", cursor: "ew-resize" },
  { id: "se", cursor: "nwse-resize" },
  { id: "s", cursor: "ns-resize" },
  { id: "sw", cursor: "nesw-resize" },
  { id: "w", cursor: "ew-resize" },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampCrop(crop) {
  let { x, y, w, h } = crop;
  w = clamp(w, MIN_NORM, 1);
  h = clamp(h, MIN_NORM, 1);
  x = clamp(x, 0, 1 - w);
  y = clamp(y, 0, 1 - h);
  return { x, y, w, h };
}

export function isDefaultCrop(crop) {
  if (!crop) return true;
  return (
    Math.abs(crop.x - DEFAULT_CROP.x) < 0.0001 &&
    Math.abs(crop.y - DEFAULT_CROP.y) < 0.0001 &&
    Math.abs(crop.w - DEFAULT_CROP.w) < 0.0001 &&
    Math.abs(crop.h - DEFAULT_CROP.h) < 0.0001
  );
}

export function fitCropToAspect(crop, ratio, imageAspect) {
  if (!ratio || !imageAspect) return clampCrop(crop);
  // Crop box is in image-normalized space; visual aspect = (w*imgW)/(h*imgH) = (w/h)*imageAspect
  // Want visualAspect = ratio ⇒ w/h = ratio / imageAspect
  const targetWh = ratio / imageAspect;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let w = crop.w;
  let h = w / targetWh;
  if (h > 1) {
    h = 1;
    w = h * targetWh;
  }
  if (w > 1) {
    w = 1;
    h = w / targetWh;
  }
  return clampCrop({
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
  });
}

export function cropHandlePosition(crop, handleId) {
  const { x, y, w, h } = crop;
  switch (handleId) {
    case "nw":
      return { x, y };
    case "n":
      return { x: x + w / 2, y };
    case "ne":
      return { x: x + w, y };
    case "e":
      return { x: x + w, y: y + h / 2 };
    case "se":
      return { x: x + w, y: y + h };
    case "s":
      return { x: x + w / 2, y: y + h };
    case "sw":
      return { x, y: y + h };
    case "w":
      return { x, y: y + h / 2 };
    default:
      return { x, y };
  }
}

export function resizeCrop(origin, handleId, nx, ny, aspectRatio, imageAspect) {
  let { x, y, w, h } = origin;
  const right = x + w;
  const bottom = y + h;

  if (handleId.includes("w")) {
    x = clamp(nx, 0, right - MIN_NORM);
    w = right - x;
  }
  if (handleId.includes("e")) {
    w = clamp(nx - x, MIN_NORM, 1 - x);
  }
  if (handleId.includes("n")) {
    y = clamp(ny, 0, bottom - MIN_NORM);
    h = bottom - y;
  }
  if (handleId.includes("s")) {
    h = clamp(ny - y, MIN_NORM, 1 - y);
  }

  if (aspectRatio && imageAspect) {
    const targetWh = aspectRatio / imageAspect;
    const cx = x + w / 2;
    const cy = y + h / 2;
    if (handleId === "n" || handleId === "s") {
      w = h * targetWh;
      x = cx - w / 2;
    } else if (handleId === "e" || handleId === "w") {
      h = w / targetWh;
      y = cy - h / 2;
    } else {
      // Corner: keep the dragged corner, adjust the other dimension
      h = w / targetWh;
      if (handleId.includes("n")) y = bottom - h;
      if (handleId.includes("w")) {
        /* x already set */
      }
    }
  }

  return clampCrop({ x, y, w, h });
}

const IMAGE_LOAD_TIMEOUT_MS = 30_000;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function imageSize(drawable) {
  const width = drawable.naturalWidth || drawable.width || 0;
  const height = drawable.naturalHeight || drawable.height || 0;
  return { width, height };
}

/** Load via HTMLImageElement. Never hang forever on a dead blob URL. */
function loadImageElement(imageUrl, { timeoutMs = IMAGE_LOAD_TIMEOUT_MS } = {}) {
  if (!imageUrl) {
    return Promise.reject(new Error("Missing image URL."));
  }

  const load = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("Failed to load image"));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = imageUrl;
  });

  return withTimeout(load, timeoutMs, "Timed out loading image.");
}

async function loadDrawableFromBlob(blob) {
  if (!blob) throw new Error("Missing image file.");

  if (typeof createImageBitmap === "function") {
    for (const options of [{ imageOrientation: "from-image" }, undefined]) {
      try {
        const bitmap = await withTimeout(
          options ? createImageBitmap(blob, options) : createImageBitmap(blob),
          IMAGE_LOAD_TIMEOUT_MS,
          "Timed out decoding image.",
        );
        return {
          drawable: bitmap,
          ...imageSize(bitmap),
          release: () => bitmap.close?.(),
        };
      } catch {
        // try next strategy / fall through to <img>
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(url);
    return {
      drawable: image,
      ...imageSize(image),
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Prefer the slot's File (stable) over a preview object URL (can be revoked or
 * race the React effect that creates it). Preview URL is a last-resort fallback.
 */
async function loadStudioDrawable(item, imageUrl) {
  const errors = [];

  if (item?.file) {
    try {
      return await loadDrawableFromBlob(item.file);
    } catch (err) {
      errors.push(err);
    }
  }

  if (imageUrl) {
    try {
      const image = await loadImageElement(imageUrl);
      return {
        drawable: image,
        ...imageSize(image),
        release: () => {},
      };
    } catch (err) {
      errors.push(err);
    }
  }

  const message =
    errors.find((err) => err instanceof Error)?.message ||
    "Failed to load image";
  throw new Error(message);
}

/**
 * Crop first, then draw annotations onto the cropped frame — the same order
 * the editor presents. Because shapes are normalized against the crop, they
 * map 1:1 onto this canvas, and `drawShapesOnCanvas` scales stroke weight by
 * the cropped width. The formatter then enlarges every slot to a shared
 * width, so line weight lands identical across tight and loose crops with no
 * compensation math.
 */
export async function renderStudioSlotCanvas(item, imageUrl) {
  const loaded = await loadStudioDrawable(item, imageUrl);
  try {
    const { drawable, width, height } = loaded;
    if (!width || !height) {
      throw new Error("Failed to load image");
    }

    const crop = isDefaultCrop(item.crop) ? DEFAULT_CROP : clampCrop(item.crop);

    const sx = Math.round(crop.x * width);
    const sy = Math.round(crop.y * height);
    const sw = Math.max(1, Math.round(crop.w * width));
    const sh = Math.max(1, Math.round(crop.h * height));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not prepare this image for upload.");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(drawable, sx, sy, sw, sh, 0, 0, sw, sh);

    if (item.annotations?.length) {
      drawShapesOnCanvas(ctx, item.annotations, sw, sh);
    }

    return canvas;
  } finally {
    loaded.release?.();
  }
}

/**
 * What the formatter should draw for this slot. An untouched slot hands back
 * its original File; a cropped or annotated one hands back the rendered canvas
 * *directly* rather than a re-encoded File — the formatter accepts either, and
 * routing through a JPEG in between cost a generation of quality that only
 * edited slots paid.
 *
 * `imageUrl` is optional — edited slots load from `item.file` first.
 */
export async function resolveStudioImageSource(item, imageUrl) {
  if (!item?.file) return null;
  const untouched = isDefaultCrop(item.crop) && !item.annotations?.length;
  if (untouched) return item.file;

  return renderStudioSlotCanvas(item, imageUrl);
}

export function slugify(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Drop the extension from an upload's filename, for renaming an export. */
export function imageBaseName(originalName) {
  return (originalName || "image").replace(/\.[^.]+$/, "") || "image";
}

// All slot UI (the editor, its thumbnail, and the read-only cropped
// preview) lives in StudioSlotEditor.js. That module imports the crop
// helpers above, so keeping any of it here would create a circular import.
