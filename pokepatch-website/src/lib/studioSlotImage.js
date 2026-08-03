import { canvasToBlob } from "@/lib/instagramStitch";
import { downloadBlob } from "@/lib/downloadFile";
import { drawShapesOnCanvas } from "@/lib/shapeAnnotations";

const MIN_NORM = 0.05;
export const DEFAULT_CROP = { x: 0, y: 0, w: 1, h: 1 };

export const ASPECT_OPTIONS = [
  { id: "free", label: "Free", ratio: null },
  { id: "3:4", label: "3:4", ratio: 3 / 4 },
  { id: "1:1", label: "1:1", ratio: 1 },
];

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

/** File extension matching an exported image blob's mime type. */
export function imageExtForBlob(blob) {
  if (blob?.type === "image/png") return "png";
  if (blob?.type === "image/webp") return "webp";
  return "jpg";
}

/** Drop the extension from an upload's filename, for renaming an export. */
export function imageBaseName(originalName) {
  return (originalName || "image").replace(/\.[^.]+$/, "");
}

function blobToFile(blob, originalName, suffix, fallbackType) {
  const baseName = imageBaseName(originalName);
  const ext = imageExtForBlob(blob);
  return new File([blob], `${baseName}-${suffix}.${ext}`, {
    type: blob.type || fallbackType || "image/jpeg",
  });
}

async function blobFromCanvas(canvas, mimeType) {
  const type = mimeType?.startsWith("image/") ? mimeType : "image/jpeg";
  if (type === "image/png") {
    return canvasToBlob(canvas);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to export image"));
      },
      type,
      0.95,
    );
  });
}

function loadImageElement(imageUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = imageUrl;
  });
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
  const img = await loadImageElement(imageUrl);
  const crop = isDefaultCrop(item.crop) ? DEFAULT_CROP : clampCrop(item.crop);

  const sx = Math.round(crop.x * img.naturalWidth);
  const sy = Math.round(crop.y * img.naturalHeight);
  const sw = Math.max(1, Math.round(crop.w * img.naturalWidth));
  const sh = Math.max(1, Math.round(crop.h * img.naturalHeight));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  if (item.annotations?.length) {
    drawShapesOnCanvas(ctx, item.annotations, sw, sh);
  }

  return canvas;
}

/** Blob for the exact image (crop + annotations) this slot contributes to
 * the generated formatted output — also what the download buttons export. */
export async function renderStudioSlotBlob(item, imageUrl) {
  const canvas = await renderStudioSlotCanvas(item, imageUrl);
  return blobFromCanvas(canvas, item.file?.type || "image/jpeg");
}

export async function resolveStudioImageFile(item, imageUrl) {
  if (!item?.file) return null;
  const untouched =
    isDefaultCrop(item.crop) && !item.annotations?.length;
  if (untouched) return item.file;

  const blob = await renderStudioSlotBlob(item, imageUrl);
  return blobToFile(blob, item.file.name, "edited", item.file.type);
}

function slugify(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Export name for one slot image. An `exportName` on the entry replaces the
 * whole name — a generated post's sources use `before-pair-1` so the file says
 * which pair it belongs to instead of repeating the upload's filename. Without
 * one it falls back to `<slot-label>-<original name>`, which is what the
 * editor's own per-slot download wants.
 *
 * Shared so a slot downloaded on its own and the same slot inside a zip
 * package always land on the same filename.
 *
 * @param entry { item, label, exportName }
 */
export function slotImageFileName(entry, blob) {
  const ext = imageExtForBlob(blob);
  if (entry?.exportName) return `${slugify(entry.exportName)}.${ext}`;
  const prefix = slugify(entry?.label);
  const baseName = imageBaseName(entry?.item?.file?.name);
  return `${prefix ? `${prefix}-` : ""}${baseName}.${ext}`;
}

/**
 * Export each slot's cropped + annotated image. Staggered because browsers
 * drop rapid-fire programmatic downloads (same cadence as the existing
 * "Download all" for generated outputs).
 *
 * @param entries [{ item, previewUrl, label, exportName }]
 */
export async function downloadSlotImages(entries) {
  const usable = entries.filter((entry) => entry?.item?.file && entry.previewUrl);
  for (let index = 0; index < usable.length; index += 1) {
    const entry = usable[index];
    const blob = await renderStudioSlotBlob(entry.item, entry.previewUrl);
    downloadBlob(blob, slotImageFileName(entry, blob));
    if (index < usable.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

// All slot UI (the editor, its thumbnail, and the read-only cropped
// preview) lives in StudioSlotEditor.js. That module imports the crop
// helpers above, so keeping any of it here would create a circular import.
