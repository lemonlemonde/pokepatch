/**
 * Pure geometry/drawing logic for the studio's rectangle/circle annotation
 * tool, shared between the final-output annotator (StudioAnnotatedPreview)
 * and the per-slot editor (StudioSlotEditor). No React here.
 */

/** Single fixed stroke colour — annotations stay visually uniform. Stroke
 * width is shared across every shape in a set (edits always apply to all). */
export const SHAPE_STROKE = "#f87171";
export const SHAPE_STROKE_WIDTH = 6;
export const MIN_STROKE_WIDTH = 2;
export const MAX_STROKE_WIDTH = 16;
export const STROKE_WIDTH_STEP = 1;
/** Reference width shapes are authored against, so stroke thickness reads the
 * same whether drawn on the small thumbnail, the zoomed editor, or exported
 * at full image resolution. */
export const STROKE_REFERENCE_WIDTH = 480;
export const DEFAULT_SIZE = 0.22;
export const MIN_SIZE = 0.04;
export const HANDLE_SIZE = 8;
export const ROTATE_HANDLE_OFFSET = 0.05;
export const ROTATE_SNAP_DEG = 15;

export const HANDLES = [
  { id: "nw", cursor: "nwse-resize" },
  { id: "n", cursor: "ns-resize" },
  { id: "ne", cursor: "nesw-resize" },
  { id: "e", cursor: "ew-resize" },
  { id: "se", cursor: "nwse-resize" },
  { id: "s", cursor: "ns-resize" },
  { id: "sw", cursor: "nesw-resize" },
  { id: "w", cursor: "ew-resize" },
];

export const OPPOSITE_HANDLE = {
  nw: "se",
  n: "s",
  ne: "sw",
  e: "w",
  se: "nw",
  s: "n",
  sw: "ne",
  w: "e",
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createId() {
  return `shape-${Math.random().toString(36).slice(2, 10)}`;
}

export function shapeCenter(shape) {
  return {
    cx: shape.x + shape.w / 2,
    cy: shape.y + shape.h / 2,
  };
}

export function shapeRotation(shape) {
  return shape.rotation || 0;
}

/**
 * Rotate a normalized (0–1) point around a center in *visual* space.
 * `aspect` is displayWidth/displayHeight — required because unit X ≠ unit Y
 * on non-square images (SVG viewBox 0–1 is anisotropic).
 */
export function rotateNormalized(x, y, cx, cy, degrees, aspect = 1) {
  const a = aspect > 0 ? aspect : 1;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = (x - cx) * a;
  const dy = y - cy;
  return {
    x: cx + (dx * cos - dy * sin) / a,
    y: cy + dx * sin + dy * cos,
  };
}

/** Visual angle from center to point (matches on-screen geometry). */
export function visualAtan2(nx, ny, cx, cy, aspect = 1) {
  const a = aspect > 0 ? aspect : 1;
  return Math.atan2(ny - cy, (nx - cx) * a);
}

/** Map a world point into the shape's unrotated local frame. */
export function toLocalPoint(shape, nx, ny, aspect = 1) {
  const { cx, cy } = shapeCenter(shape);
  return rotateNormalized(nx, ny, cx, cy, -shapeRotation(shape), aspect);
}

export function clampStrokeWidth(value) {
  return clamp(
    Math.round(Number(value) || SHAPE_STROKE_WIDTH),
    MIN_STROKE_WIDTH,
    MAX_STROKE_WIDTH,
  );
}

export function shapeStrokeWidth(shape) {
  return typeof shape?.strokeWidth === "number" && shape.strokeWidth > 0
    ? clampStrokeWidth(shape.strokeWidth)
    : SHAPE_STROKE_WIDTH;
}

/** Shared stroke width for a shape set — read from the first shape (they
 * stay in lockstep), else the default. */
export function getSharedStrokeWidth(shapes) {
  if (!shapes?.length) return SHAPE_STROKE_WIDTH;
  return shapeStrokeWidth(shapes[0]);
}

/** Thickness is never per-circle — rewrite every shape to the same width. */
export function applyStrokeWidth(shapes, strokeWidth) {
  const next = clampStrokeWidth(strokeWidth);
  return (shapes ?? []).map((shape) =>
    shape.strokeWidth === next ? shape : { ...shape, strokeWidth: next },
  );
}

export function createShape(type, index = 0, options = {}) {
  const offset = (index % 5) * 0.04;
  return {
    id: createId(),
    type,
    x: clamp(0.39 + offset, 0, 1 - DEFAULT_SIZE),
    y: clamp(0.39 + offset, 0, 1 - DEFAULT_SIZE),
    w: DEFAULT_SIZE,
    h: DEFAULT_SIZE,
    rotation: 0,
    strokeWidth: clampStrokeWidth(
      options.strokeWidth ?? SHAPE_STROKE_WIDTH,
    ),
  };
}

export function finalizeShapeSize(shape) {
  let { x, y, w, h } = shape;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  w = Math.max(MIN_SIZE, w);
  h = Math.max(MIN_SIZE, h);
  return { ...shape, x, y, w, h, rotation: shapeRotation(shape) };
}

export function clampShapePosition(shape) {
  return {
    ...shape,
    x: clamp(shape.x, 0, 1 - shape.w),
    y: clamp(shape.y, 0, 1 - shape.h),
  };
}

export function normalizeShape(shape) {
  return clampShapePosition(finalizeShapeSize(shape));
}

export function hitTest(shape, nx, ny, aspect = 1) {
  const local = toLocalPoint(shape, nx, ny, aspect);
  const { x, y, w, h, type } = shape;
  if (type === "circle") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2;
    const ry = h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (local.x - cx) / rx;
    const dy = (local.y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return (
    local.x >= x && local.x <= x + w && local.y >= y && local.y <= y + h
  );
}

function strokeShapePath(ctx, shape, w, h) {
  ctx.beginPath();
  if (shape.type === "circle") {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(-w / 2, -h / 2, w, h);
  }
  ctx.stroke();
}

/**
 * Bake shapes onto a canvas. Shape x/y/w/h are normalized 0–1 against this
 * canvas, and stroke thickness scales with its width — so when the canvas
 * is the *cropped* region (which the formatter then enlarges to a
 * consistent slot width), line weight lands the same in the final output
 * no matter how tight the crop was.
 */
export function drawShapesOnCanvas(ctx, shapes, width, height) {
  const scale = width / STROKE_REFERENCE_WIDTH;

  for (const shape of shapes) {
    const x = shape.x * width;
    const y = shape.y * height;
    const w = shape.w * width;
    const h = shape.h * height;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rotationRad = (shapeRotation(shape) * Math.PI) / 180;
    const strokeWidth = Math.max(1, shapeStrokeWidth(shape) * scale);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationRad);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = SHAPE_STROKE;
    strokeShapePath(ctx, shape, w, h);
    ctx.restore();
  }
}

export function localHandlePosition(shape, handleId) {
  const { x, y, w, h } = shape;
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

export function handlePosition(shape, handleId, aspect = 1) {
  const local = localHandlePosition(shape, handleId);
  const { cx, cy } = shapeCenter(shape);
  return rotateNormalized(
    local.x,
    local.y,
    cx,
    cy,
    shapeRotation(shape),
    aspect,
  );
}

export function rotateHandlePosition(shape, aspect = 1) {
  const { cx, cy } = shapeCenter(shape);
  const local = { x: cx, y: shape.y - ROTATE_HANDLE_OFFSET };
  return rotateNormalized(
    local.x,
    local.y,
    cx,
    cy,
    shapeRotation(shape),
    aspect,
  );
}

export function resizeFromHandle(shape, handleId, nx, ny, constrainSquare = false) {
  let { x, y, w, h } = shape;
  const right = x + w;
  const bottom = y + h;

  switch (handleId) {
    case "nw":
      x = nx;
      y = ny;
      w = right - nx;
      h = bottom - ny;
      break;
    case "n":
      y = ny;
      h = bottom - ny;
      break;
    case "ne":
      y = ny;
      w = nx - x;
      h = bottom - ny;
      break;
    case "e":
      w = nx - x;
      break;
    case "se":
      w = nx - x;
      h = ny - y;
      break;
    case "s":
      h = ny - y;
      break;
    case "sw":
      x = nx;
      w = right - nx;
      h = ny - y;
      break;
    case "w":
      x = nx;
      w = right - nx;
      break;
    default:
      break;
  }

  if (constrainSquare) {
    const isEdgeNS = handleId === "n" || handleId === "s";
    const isEdgeEW = handleId === "e" || handleId === "w";
    const size = isEdgeNS
      ? Math.abs(h)
      : isEdgeEW
        ? Math.abs(w)
        : Math.max(Math.abs(w), Math.abs(h));
    const signedW = w < 0 ? -size : size;
    const signedH = h < 0 ? -size : size;

    switch (handleId) {
      case "nw":
        x = right - signedW;
        y = bottom - signedH;
        w = signedW;
        h = signedH;
        break;
      case "ne":
        y = bottom - signedH;
        w = signedW;
        h = signedH;
        break;
      case "se":
        w = signedW;
        h = signedH;
        break;
      case "sw":
        x = right - signedW;
        w = signedW;
        h = signedH;
        break;
      case "n":
      case "s": {
        const midX = x + w / 2;
        w = size;
        h = signedH < 0 ? -size : size;
        x = midX - w / 2;
        if (handleId === "n") y = bottom - h;
        break;
      }
      case "e":
      case "w": {
        const midY = y + h / 2;
        h = size;
        w = signedW < 0 ? -size : size;
        y = midY - h / 2;
        if (handleId === "w") x = right - w;
        break;
      }
      default:
        break;
    }
  }

  return { ...shape, x, y, w, h };
}

/**
 * Resize in local space, then keep the opposite edge/corner fixed in world
 * space so rotation-around-center doesn't make side drags feel like sliding.
 */
export function resizeRotatedShape(
  shape,
  handleId,
  worldX,
  worldY,
  constrainSquare,
  aspect = 1,
) {
  const oppositeId = OPPOSITE_HANDLE[handleId];
  const anchorWorld = handlePosition(shape, oppositeId, aspect);
  const local = toLocalPoint(shape, worldX, worldY, aspect);

  let next = finalizeShapeSize(
    resizeFromHandle(shape, handleId, local.x, local.y, constrainSquare),
  );

  const nextAnchor = handlePosition(next, oppositeId, aspect);
  next = {
    ...next,
    x: next.x + (anchorWorld.x - nextAnchor.x),
    y: next.y + (anchorWorld.y - nextAnchor.y),
  };

  return clampShapePosition(next);
}

/** Content-box metrics of a rendered <img>, excluding CSS border/letterboxing. */
/**
 * Content box of a rendered <img>, corrected for `object-contain`
 * letterboxing. Some callers (e.g. thumbnails) force the img's CSS box to
 * an aspect ratio that doesn't match the natural image (via a fixed width
 * + max-height), which pillar/letterboxes the actual drawn pixels inside
 * `clientWidth`/`clientHeight` — using those raw dimensions would size and
 * position overlays against the *box*, not the visible image. When the box
 * and image aspect already match (the common unconstrained case), this
 * reduces to the same numbers as just using clientWidth/clientHeight.
 */
export function getImageContentMetrics(img) {
  if (!img) return null;
  const rect = img.getBoundingClientRect();
  const boxWidth = img.clientWidth;
  const boxHeight = img.clientHeight;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  let width = boxWidth;
  let height = boxHeight;
  let offsetLeft = img.offsetLeft + img.clientLeft;
  let offsetTop = img.offsetTop + img.clientTop;

  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    const boxAspect = boxWidth / boxHeight;
    const imageAspect = img.naturalWidth / img.naturalHeight;

    if (imageAspect > boxAspect) {
      width = boxWidth;
      height = width / imageAspect;
      offsetTop += (boxHeight - height) / 2;
    } else {
      height = boxHeight;
      width = height * imageAspect;
      offsetLeft += (boxWidth - width) / 2;
    }
  }

  return {
    // Viewport rect of the content box (excludes CSS border).
    left: rect.left + (offsetLeft - img.offsetLeft),
    top: rect.top + (offsetTop - img.offsetTop),
    width,
    height,
    // Position of the content box inside the surface wrapper.
    offsetLeft,
    offsetTop,
  };
}
