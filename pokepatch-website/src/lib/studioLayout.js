import logoSrc from "@/app/pokepatch_icon.png";

/** Shared canvas width for feed + Reels exports (logical px). */
export const INSTAGRAM_WIDTH = 1080;
/** Legacy 1:1 height — slot math and older callers still reference this. */
export const INSTAGRAM_HEIGHT = 1080;
/** 4:5 carousel / feed portrait canvas. */
export const CAROUSEL_WIDTH = 1080;
export const CAROUSEL_HEIGHT = 1350;
/** 9:16 Reels canvas. */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;

/**
 * Supersampling factor for the export canvas. Every layout number below stays
 * in 1080-space; the stitchers scale the backing store by this and apply a
 * matching transform, so text, the logo, card borders and shadows all rasterize
 * natively at the higher resolution instead of being upscaled after the fact.
 */
export const STUDIO_EXPORT_SCALE = 6;

/** @typedef {'carousel' | 'reel'} StudioOutputFormat */

/** Canvas size for a 1×2 output format. Defaults to Reels 9:16. */
export function getOutputCanvasSize(format = "reel") {
  if (format === "carousel" || format === "square") {
    return { width: CAROUSEL_WIDTH, height: CAROUSEL_HEIGHT };
  }
  return { width: REEL_WIDTH, height: REEL_HEIGHT };
}

/**
 * Logical (pre-supersample) canvas size, stamped on by the stitchers. Layout
 * code must read these instead of the canvas's own width/height — the raw
 * backing store is `STUDIO_EXPORT_SCALE` times larger, which would make
 * `isReelCanvas` mistake a feed post for a Reels layout.
 */
export function stampLogicalSize(canvas, width, height) {
  canvas.__logicalWidth = width;
  canvas.__logicalHeight = height;
}

export function logicalWidth(ctx) {
  return ctx.canvas.__logicalWidth ?? ctx.canvas.width;
}

export function logicalHeight(ctx) {
  return ctx.canvas.__logicalHeight ?? ctx.canvas.height;
}

/** Device pixels per logical unit on this context. */
export function exportScale(ctx) {
  return ctx.canvas.width / logicalWidth(ctx);
}

// --- Studio comparison layout (before | after) ---
export const EDGE_PADDING = 18;
export const COLUMN_GAP = 18;
export const SLOT_WIDTH =
  (INSTAGRAM_WIDTH - 2 * EDGE_PADDING - COLUMN_GAP) / 2;
export const LEFT_COLUMN_X = EDGE_PADDING;
export const RIGHT_COLUMN_X = EDGE_PADDING + SLOT_WIDTH + COLUMN_GAP;
export const BACKGROUND = "#000000";
export const LABEL_FONT_SIZE = 34;
export const LABEL_FONT_FAMILY =
  'Nunito, "Helvetica Neue", Helvetica, Arial, sans-serif';
export const LABEL_COLOR = "rgba(255, 255, 255, 0.9)";
export const LABEL_TRACKING = 14;
export const LABEL_GAP = 28;
export const BRAND_HANDLE = "@pokepatch.cards";
export const LABEL_BLOCK_HEIGHT = LABEL_GAP + LABEL_FONT_SIZE;
export const CARD_RADIUS = 8;

// Restoration caption — slightly smaller / tighter than BEFORE/AFTER labels.
export const CAPTION_FONT_SIZE = 32;
export const CAPTION_TRACKING = 6;
export const CARD_INFO_FONT_SIZE = 26;
export const CARD_INFO_THUMB_SIZE = 112;
/** 9:16 card chip thumb: 3× carousel thumb, then −10%. */
export const REEL_CARD_INFO_THUMB_SIZE = Math.round(
  CARD_INFO_THUMB_SIZE * 3 * 0.9,
);
/** 4:5 card chip thumb — larger than the old top-left feed chip. */
export const CAROUSEL_CARD_INFO_THUMB_SIZE = Math.round(
  CARD_INFO_THUMB_SIZE * 1.85,
);
export const CARD_INFO_INNER_PAD_Y = 6;
export const CARD_INFO_INNER_PAD_X = 12;
export const CARD_INFO_EDGE_PADDING = 24;
// Clear air between the card-info chip and cards (also used as equal
// caption gaps: chip → caption → images).
export const CARD_INFO_CLEARANCE = 28;
export const CAPTION_GAP = CARD_INFO_CLEARANCE;
/** Extra inset for corner chips on 9:16 so they sit off Instagram's UI edges. */
const REEL_CHIP_EDGE_NUDGE = 20;
/** Drop the top-right brand chip on 9:16. */
const REEL_BRANDING_TOP_NUDGE = 285;
/** Extra gap between brand chip and the right canvas edge on 9:16. */
const REEL_BRANDING_RIGHT_EXTRA = 20;
/** Extra left/right image margin on 9:16 (each side). */
const REEL_SIDE_PADDING_EXTRA = 20;
/** Trim horizontal padding inside the 9:16 card-info chip. */
const REEL_CARD_INFO_WIDTH_TRIM = 20;
/** Fixed text column width inside the 9:16 card-info chip (wraps overflow). */
const REEL_CARD_INFO_TEXT_WIDTH = 370;
/** Nudge the centered 9:16 card-info chip left of true center. */
const REEL_CARD_INFO_LEFT_SHIFT = 20;
/** Extra inner padding on the right of the 9:16 card-info chip. */
const REEL_CARD_INFO_PAD_RIGHT_EXTRA = 16;
/** Space between image/label block and the centered card chip on 9:16. */
const REEL_CARD_INFO_GAP_BELOW_CONTENT = 60;
/** Gap between image/label block and card chip on 4:5 carousel. */
const CAROUSEL_CARD_INFO_GAP_BELOW_CONTENT = 36;
/** Nudge caption+images (and the chip below them) above true vertical center on 9:16. */
const REEL_CENTER_NUDGE_UP = 135;
/** Scale fonts + branding logo on 9:16 only. */
const REEL_TYPE_SCALE = 1.5;
// Branding chip metrics (must stay in sync with drawBranding).
const BRANDING_MAX_FRAME = 72;
const BRANDING_INNER_PAD = 14;
const BRANDING_FONT_SIZE = 24;
/** Feed/carousel branding mark — larger than the old square chip. */
const CAROUSEL_BRANDING_MAX_FRAME = Math.round(BRANDING_MAX_FRAME * 1.35);

/** 9:16 Reels canvas — Instagram UI safe-area layout. */
function isReelCanvas(height) {
  return height >= REEL_HEIGHT;
}

/** Portrait posts (4:5 + 9:16) put the card chip under before/after. */
function placesCardBelow(height) {
  return height > INSTAGRAM_HEIGHT;
}

/** Side-by-side column geometry for 1×2 frames. */
function pairLayout(reel) {
  const edge = EDGE_PADDING + (reel ? REEL_SIDE_PADDING_EXTRA : 0);
  const canvasW = INSTAGRAM_WIDTH;
  const slotWidth = (canvasW - 2 * edge - COLUMN_GAP) / 2;
  return {
    edge,
    slotWidth,
    leftX: edge,
    rightX: edge + slotWidth + COLUMN_GAP,
  };
}

function reelTyped(value, reel) {
  return reel ? Math.round(value * REEL_TYPE_SCALE) : value;
}

/** Font / tracking / gap sizes for the current canvas. */
function typeMetrics(reel) {
  return {
    labelFont: reelTyped(LABEL_FONT_SIZE, reel),
    labelGap: reelTyped(LABEL_GAP, reel),
    labelTracking: reelTyped(LABEL_TRACKING, reel),
    labelBlockHeight: reelTyped(LABEL_GAP, reel) + reelTyped(LABEL_FONT_SIZE, reel),
    captionFont: reelTyped(CAPTION_FONT_SIZE, reel),
    captionTracking: reelTyped(CAPTION_TRACKING, reel),
    captionGap: reelTyped(CAPTION_GAP, reel),
    cardInfoFont: reelTyped(CARD_INFO_FONT_SIZE, reel),
    brandFont: reelTyped(BRANDING_FONT_SIZE, reel),
    brandLogoFrame: reelTyped(BRANDING_MAX_FRAME, reel),
    brandInnerPad: reelTyped(BRANDING_INNER_PAD, reel),
  };
}

function cardInfoChipBottom() {
  return (
    CARD_INFO_EDGE_PADDING +
    CARD_INFO_THUMB_SIZE +
    2 * CARD_INFO_INNER_PAD_Y
  );
}

function reelCardInfoChipHeight() {
  const cardFont = reelTyped(CARD_INFO_FONT_SIZE, true);
  const textH = cardFont * 2 + 6;
  return Math.max(REEL_CARD_INFO_THUMB_SIZE, textH) + 2 * CARD_INFO_INNER_PAD_Y;
}

function carouselCardInfoChipHeight() {
  const textH = CARD_INFO_FONT_SIZE * 2 + 6;
  return (
    Math.max(CAROUSEL_CARD_INFO_THUMB_SIZE, textH) + 2 * CARD_INFO_INNER_PAD_Y
  );
}

/** Bottom reserve so the card chip fits under the content. */
function cardInfoBottomReserve(height) {
  if (isReelCanvas(height)) {
    return (
      REEL_CARD_INFO_GAP_BELOW_CONTENT +
      reelCardInfoChipHeight() +
      EDGE_PADDING
    );
  }
  return (
    CAROUSEL_CARD_INFO_GAP_BELOW_CONTENT +
    carouselCardInfoChipHeight() +
    EDGE_PADDING
  );
}

/** Equal gaps: chip → caption → images (legacy top-left chip + caption). */
function captionStackBelowChip() {
  const chipBottom = cardInfoChipBottom();
  return {
    captionCenterY: chipBottom + CAPTION_GAP + CAPTION_FONT_SIZE / 2,
    imagesTop: chipBottom + CAPTION_GAP + CAPTION_FONT_SIZE + CAPTION_GAP,
  };
}

/** Vertically place images(+labels) on 9:16; caption sits in a reserved band above. */
function captionStackCentered(canvasHeight, imagesAndLabelsHeight) {
  const type = typeMetrics(true);
  const captionBlock = type.captionFont + type.captionGap;
  // Always reserve the caption band so image/chip Y matches with or without caption.
  const blockHeight = captionBlock + imagesAndLabelsHeight;
  const blockTop = Math.max(
    EDGE_PADDING,
    Math.floor((canvasHeight - blockHeight) / 2) - REEL_CENTER_NUDGE_UP,
  );

  return {
    captionCenterY: blockTop + type.captionFont / 2,
    imagesTop: blockTop + type.captionFont + type.captionGap,
  };
}

function chipEdgePadding(ctx, basePadding) {
  return (
    basePadding +
    (isReelCanvas(logicalHeight(ctx)) ? REEL_CHIP_EDGE_NUDGE : 0)
  );
}

let labelFontReady;
let logoReady;

function resolveAssetSrc(src) {
  return typeof src === "string" ? src : src.src;
}

export function enableHighQuality(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

export function ensureLabelFont() {
  if (!labelFontReady) {
    const reel = typeMetrics(true);
    labelFontReady = Promise.all([
      document.fonts.load(`500 ${LABEL_FONT_SIZE}px Nunito`),
      document.fonts.load(`700 ${CARD_INFO_FONT_SIZE}px Nunito`),
      document.fonts.load(`italic 400 ${CARD_INFO_FONT_SIZE}px Nunito`),
      document.fonts.load(`500 ${reel.labelFont}px Nunito`),
      document.fonts.load(`700 ${reel.cardInfoFont}px Nunito`),
      document.fonts.load(`italic 400 ${reel.cardInfoFont}px Nunito`),
      document.fonts.load(`500 ${reel.captionFont}px Nunito`),
      document.fonts.load(`500 ${reel.brandFont}px Nunito`),
    ]).catch(() => undefined);
  }
  return labelFontReady;
}

/** Opaque content box — the PNG has wide transparent padding L/R. */
function getOpaqueBounds(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { sx: 0, sy: 0, sw: width, sh: height };
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = Math.ceil(Math.max(maxX - minX + 1, maxY - minY + 1) * 1.02);
  const sx = Math.max(0, Math.floor(cx - side / 2));
  const sy = Math.max(0, Math.floor(cy - side / 2));
  return {
    sx,
    sy,
    sw: Math.min(side, width - sx),
    sh: Math.min(side, height - sy),
  };
}

export function ensureLogo() {
  if (!logoReady) {
    logoReady = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        img.contentBounds = getOpaqueBounds(img);
        resolve(img);
      };
      img.onerror = () => reject(new Error("Failed to load PokePatch logo"));
      img.src = resolveAssetSrc(logoSrc);
    });
  }
  return logoReady;
}

export function getSourceDimensions(source) {
  return {
    width: source.videoWidth || source.naturalWidth || source.width,
    height: source.videoHeight || source.naturalHeight || source.height,
  };
}

export function fillBackground(ctx) {
  const width = logicalWidth(ctx);
  const height = logicalHeight(ctx);
  const gradient = ctx.createRadialGradient(
    width / 2,
    height * 0.42,
    0,
    width / 2,
    height * 0.42,
    width * 0.78,
  );
  gradient.addColorStop(0, "#14141c");
  gradient.addColorStop(1, BACKGROUND);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/** Fit the full image inside the slot (contain) — no cropping. */
export function getContainMetrics(source, width, maxHeight) {
  const { width: sourceWidth, height: sourceHeight } =
    getSourceDimensions(source);
  const scale = Math.min(width / sourceWidth, maxHeight / sourceHeight);
  const newW = Math.round(sourceWidth * scale);
  const newH = Math.round(sourceHeight * scale);

  return { newW, newH, sw: newW, sh: newH, sx: 0, sy: 0 };
}

/** Shared frame: same width for both; height matches the taller scaled card. */
export function getSharedTargetSize(leftMetrics, rightMetrics, maxSlotWidth) {
  const targetSw = Math.min(
    maxSlotWidth,
    Math.max(leftMetrics.sw, rightMetrics.sw),
  );
  const leftH = Math.round(leftMetrics.sh * (targetSw / leftMetrics.sw));
  const rightH = Math.round(rightMetrics.sh * (targetSw / rightMetrics.sw));
  return { targetSw, targetSh: Math.max(leftH, rightH) };
}

/**
 * Where the card actually lands inside the shared frame. Same width as the
 * taller card's frame, aspect preserved (no crop), shrunk to fit if that would
 * overflow the frame height.
 */
export function getCardDrawSize(metrics, targetSw, targetSh) {
  let drawW = targetSw;
  let drawH = Math.round(metrics.sh * (targetSw / metrics.sw));
  if (drawH > targetSh) {
    const fit = targetSh / drawH;
    drawW = Math.round(drawW * fit);
    drawH = targetSh;
  }
  return { drawW, drawH };
}

/**
 * Repeated halving down to the target instead of one long jump.
 *
 * Canvas' `imageSmoothingQuality: "high"` only samples a small neighbourhood,
 * so taking a 4000px photo straight to a ~500px slot undersamples periodic
 * detail — that's what puts stripes/moiré through holo and foil patterns.
 * Halving stays within the filter's reach at every step and averages the
 * discarded pixels in, which is what actually kills the aliasing.
 */
function downscaleTo(source, targetW, targetH) {
  const { width: sourceWidth, height: sourceHeight } =
    getSourceDimensions(source);
  let current = source;
  let width = sourceWidth;
  let height = sourceHeight;

  // `&&` so a step never clamps one axis while halving the other — the halved
  // canvas has to stay in the source's aspect for the averaging to be uniform.
  while (width > targetW * 2 && height > targetH * 2) {
    width = Math.max(targetW, Math.round(width / 2));
    height = Math.max(targetH, Math.round(height / 2));
    const step = document.createElement("canvas");
    step.width = width;
    step.height = height;
    const stepCtx = step.getContext("2d");
    enableHighQuality(stepCtx);
    stepCtx.drawImage(current, 0, 0, width, height);
    current = step;
  }

  const resized = document.createElement("canvas");
  resized.width = targetW;
  resized.height = targetH;
  const ctx = resized.getContext("2d");
  enableHighQuality(ctx);
  ctx.drawImage(current, 0, 0, targetW, targetH);
  return resized;
}

/**
 * Resample a source straight to its final *device*-pixel size. Callers pass the
 * post-supersample dimensions so the image is resampled exactly once — the old
 * two-stage path fitted to the slot first and then let `drawCard` rescale to
 * the shared frame width, which upscaled the narrower card of every pair back
 * up from an already-shrunken intermediate.
 */
export function prepareResized(source, targetW, targetH) {
  return downscaleTo(source, Math.max(1, targetW), Math.max(1, targetH));
}

/** `prepareResized` at the size this card will occupy on `ctx`, in device pixels. */
function prepareCardResized(ctx, source, metrics, targetSw, targetSh) {
  const { drawW, drawH } = getCardDrawSize(metrics, targetSw, targetSh);
  const scale = exportScale(ctx);
  return prepareResized(
    source,
    Math.round(drawW * scale),
    Math.round(drawH * scale),
  );
}

function drawCard(ctx, resized, metrics, drawX, drawY, targetSw, targetSh) {
  const { drawW, drawH } = getCardDrawSize(metrics, targetSw, targetSh);
  // Equal white extension above and below when this card is shorter.
  const imageX = drawX + Math.floor((targetSw - drawW) / 2);
  const imageY = drawY + Math.floor((targetSh - drawH) / 2);

  ctx.save();
  // Shadow blur and offset are in device pixels — the canvas transform doesn't
  // touch them — so they have to be scaled by hand or the drop shadow shrinks
  // to half its intended size on a supersampled export.
  const shadowScale = exportScale(ctx);
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 28 * shadowScale;
  ctx.shadowOffsetY = 10 * shadowScale;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(drawX, drawY, targetSw, targetSh, CARD_RADIUS);
  ctx.fill();
  ctx.restore();

  ctx.save();
  enableHighQuality(ctx);
  ctx.beginPath();
  ctx.roundRect(drawX, drawY, targetSw, targetSh, CARD_RADIUS);
  ctx.clip();
  // `resized` is already at the exact device-pixel size this rect covers, so
  // this is a 1:1 blit — no second resample.
  ctx.drawImage(resized, imageX, imageY, drawW, drawH);
  ctx.restore();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(
    drawX + 0.5,
    drawY + 0.5,
    targetSw - 1,
    targetSh - 1,
    CARD_RADIUS,
  );
  ctx.stroke();
}

function drawTrackedText(ctx, text, centerX, y, tracking) {
  const chars = [...text];
  const widths = chars.map((char) => ctx.measureText(char).width);
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    tracking * Math.max(chars.length - 1, 0);
  let x = centerX - totalWidth / 2;

  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + tracking;
  }
  ctx.textAlign = "center";
}

function drawColumn(
  ctx,
  resized,
  metrics,
  columnX,
  slotWidth,
  label,
  targetSw,
  targetSh,
  imageTop,
) {
  const type = typeMetrics(isReelCanvas(logicalHeight(ctx)));
  const drawX = columnX + Math.floor((slotWidth - targetSw) / 2);
  drawCard(ctx, resized, metrics, drawX, imageTop, targetSw, targetSh);

  ctx.font = `500 ${type.labelFont}px ${LABEL_FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = LABEL_COLOR;

  const labelY = imageTop + targetSh + type.labelGap + type.labelFont / 2;
  drawTrackedText(
    ctx,
    label.toUpperCase(),
    columnX + slotWidth / 2,
    labelY,
    type.labelTracking,
  );
}

function drawBadgeBackground(ctx, blockX, blockY, blockW, blockH) {
  ctx.fillStyle = "rgba(12, 12, 12, 0.88)";
  ctx.beginPath();
  ctx.roundRect(blockX, blockY, blockW, blockH, 12);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(blockX + 0.5, blockY + 0.5, blockW - 1, blockH - 1, 12);
  ctx.stroke();
}

export function drawBranding(ctx, logoImg) {
  const reel = isReelCanvas(logicalHeight(ctx));
  const type = typeMetrics(reel);
  const padding = chipEdgePadding(ctx, 24);
  const maxFrameSize = reel
    ? type.brandLogoFrame
    : CAROUSEL_BRANDING_MAX_FRAME;
  const gap = reelTyped(10, reel);
  const fontSize = reel ? type.brandFont : Math.round(BRANDING_FONT_SIZE * 1.15);
  const innerPad = type.brandInnerPad;

  // Size the mark to the branding frame using opaque bounds (the PNG has
  // wide transparent padding that would otherwise shrink the visible logo).
  const bounds =
    logoImg.contentBounds ?? {
      sx: 0,
      sy: 0,
      sw: logoImg.naturalWidth,
      sh: logoImg.naturalHeight,
    };
  const logoScale = Math.min(
    maxFrameSize / bounds.sw,
    maxFrameSize / bounds.sh,
  );
  const logoW = Math.max(1, Math.round(bounds.sw * logoScale));
  const logoH = Math.max(1, Math.round(bounds.sh * logoScale));

  ctx.font = `500 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  const textWidth = ctx.measureText(BRAND_HANDLE).width;
  const blockW = innerPad + logoW + gap + textWidth + innerPad;
  const blockH = Math.max(logoH, fontSize) + innerPad * 2;
  const blockX =
    logicalWidth(ctx) -
    padding -
    blockW -
    (reel ? REEL_BRANDING_RIGHT_EXTRA : 0);
  // Reels need a deep top inset to clear Instagram UI; carousel keeps the
  // chip in the true top-right like the classic feed posts.
  const blockY = padding + (reel ? REEL_BRANDING_TOP_NUDGE : 0);

  drawBadgeBackground(ctx, blockX, blockY, blockW, blockH);

  enableHighQuality(ctx);
  ctx.drawImage(
    logoImg,
    bounds.sx,
    bounds.sy,
    bounds.sw,
    bounds.sh,
    blockX + innerPad,
    blockY + (blockH - logoH) / 2,
    logoW,
    logoH,
  );

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(
    BRAND_HANDLE,
    blockX + innerPad + logoW + gap,
    blockY + blockH / 2,
  );
}

function measureLabeledLineWidth(ctx, label, value, fontSize) {
  ctx.font = `700 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  const labelW = ctx.measureText(label).width;
  ctx.font = `italic 400 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  const valueW = ctx.measureText(value).width;
  return labelW + valueW;
}

function measureValueWidth(ctx, value, fontSize) {
  ctx.font = `italic 400 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  return ctx.measureText(value).width;
}

/**
 * Wrap a labeled field into lines within maxTextW.
 * First line includes the bold label; continuation lines are value-only
 * (indented under the value start when the label fits on the first line).
 * @returns {{ lines: { label: string, value: string }[], height: number }}
 */
function layoutLabeledField(ctx, label, value, fontSize, maxTextW, lineGap) {
  const raw = (value ?? "").trim();
  ctx.font = `700 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  const labelW = ctx.measureText(label).width;
  const firstValueMax = Math.max(8, maxTextW - labelW);
  const contMax = maxTextW;

  if (!raw) {
    return {
      lines: [{ label, value: "" }],
      height: fontSize,
    };
  }

  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let wordIndex = 0;

  // First line: label + as many words as fit.
  let firstValue = "";
  while (wordIndex < words.length) {
    const next =
      firstValue.length === 0
        ? words[wordIndex]
        : `${firstValue} ${words[wordIndex]}`;
    if (measureValueWidth(ctx, next, fontSize) <= firstValueMax) {
      firstValue = next;
      wordIndex += 1;
    } else {
      break;
    }
  }
  // If the first word alone is wider than firstValueMax, still place it
  // (character-wrap) so we never truncate with ellipsis.
  if (firstValue.length === 0 && wordIndex < words.length) {
    firstValue = wrapCharsToWidth(ctx, words[wordIndex], fontSize, firstValueMax);
    // Consume the word; leftover chars become the next "word" stream.
    const leftover = words[wordIndex].slice(firstValue.length);
    words[wordIndex] = leftover;
    if (!leftover) wordIndex += 1;
  }
  lines.push({ label, value: firstValue });

  // Continuation lines: wrap remaining words to contMax.
  let current = "";
  while (wordIndex < words.length) {
    const word = words[wordIndex];
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (measureValueWidth(ctx, next, fontSize) <= contMax) {
      current = next;
      wordIndex += 1;
      continue;
    }
    if (current.length > 0) {
      lines.push({ label: "", value: current });
      current = "";
      continue;
    }
    // Single word wider than contMax — character wrap.
    const chunk = wrapCharsToWidth(ctx, word, fontSize, contMax);
    lines.push({ label: "", value: chunk });
    words[wordIndex] = word.slice(chunk.length);
    if (!words[wordIndex]) wordIndex += 1;
  }
  if (current.length > 0) {
    lines.push({ label: "", value: current });
  }

  const height = lines.length * fontSize + Math.max(0, lines.length - 1) * lineGap;
  return { lines, height };
}

function wrapCharsToWidth(ctx, text, fontSize, maxWidth) {
  if (!text) return "";
  if (measureValueWidth(ctx, text, fontSize) <= maxWidth) return text;
  let fitted = text;
  while (
    fitted.length > 1 &&
    measureValueWidth(ctx, fitted, fontSize) > maxWidth
  ) {
    fitted = fitted.slice(0, -1);
  }
  return fitted.length > 0 ? fitted : text.slice(0, 1);
}

function drawLabeledLine(ctx, label, value, x, y, fontSize) {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";

  let cursorX = x;
  if (label) {
    ctx.font = `700 ${fontSize}px ${LABEL_FONT_FAMILY}`;
    ctx.fillText(label, cursorX, y);
    cursorX += ctx.measureText(label).width;
  }

  ctx.font = `italic 400 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  ctx.fillText(value, cursorX, y);
}

/**
 * Card-info chip: top-left on legacy 1:1; centered under before/after on
 * portrait (4:5 carousel + 9:16 Reels).
 * @param {{ frontImg: CanvasImageSource, card: string, set: string }} cardInfo
 * @param {{ blockX?: number, blockY?: number, thumbBox?: number } | null} layout
 */
export function drawCardInfo(ctx, cardInfo, layout = null) {
  const { frontImg, card, set } = cardInfo;
  const reel = isReelCanvas(logicalHeight(ctx));
  const below = Boolean(layout);
  const type = typeMetrics(reel);
  const padding = chipEdgePadding(ctx, CARD_INFO_EDGE_PADDING);
  const thumbBox =
    layout?.thumbBox ??
    (reel ? REEL_CARD_INFO_THUMB_SIZE : CARD_INFO_THUMB_SIZE);
  const gap = reelTyped(12, reel);
  // 9:16: pull Card/Set text about halfway closer to the thumb.
  const textGap = reel ? Math.round(gap / 2) : gap;
  const fontSize = type.cardInfoFont;
  const lineGap = reelTyped(6, reel);
  const fieldGap = reelTyped(6, reel);
  const padX = Math.max(
    4,
    reelTyped(CARD_INFO_INNER_PAD_X, reel) -
      (reel ? Math.floor(REEL_CARD_INFO_WIDTH_TRIM / 2) : 0),
  );
  // 9:16: flush thumb on the left; extra breathing room on the right.
  const padLeft = reel ? 0 : padX;
  const padRight = reel
    ? padX + reelTyped(REEL_CARD_INFO_PAD_RIGHT_EXTRA, reel)
    : padX;
  const padY = reelTyped(CARD_INFO_INNER_PAD_Y, reel);
  const thumbRadius = reel || below ? 14 : 8;

  const cardLabel = "Card: ";
  const setLabel = "Set: ";
  const maxTextW = reel
    ? reelTyped(REEL_CARD_INFO_TEXT_WIDTH, reel)
    : Math.max(
        80,
        logicalWidth(ctx) -
          2 * padding -
          padLeft -
          thumbBox -
          textGap -
          padRight,
      );
  const cardField = layoutLabeledField(
    ctx,
    cardLabel,
    card,
    fontSize,
    maxTextW,
    lineGap,
  );
  const setField = layoutLabeledField(
    ctx,
    setLabel,
    set,
    fontSize,
    maxTextW,
    lineGap,
  );
  const textW = reel
    ? maxTextW
    : Math.max(
        ...cardField.lines.map((line) =>
          measureLabeledLineWidth(ctx, line.label, line.value, fontSize),
        ),
        ...setField.lines.map((line) =>
          measureLabeledLineWidth(ctx, line.label, line.value, fontSize),
        ),
      );
  const textH = cardField.height + fieldGap + setField.height;

  const { width: srcW, height: srcH } = getSourceDimensions(frontImg);
  const thumbScale = Math.min(thumbBox / srcW, thumbBox / srcH);
  const thumbW = Math.max(1, Math.round(srcW * thumbScale));
  const thumbH = Math.max(1, Math.round(srcH * thumbScale));

  const blockW = padLeft + thumbBox + textGap + textW + padRight;
  const blockH = Math.max(thumbBox, textH) + padY * 2;
  const blockX =
    layout?.blockX ??
    (below
      ? Math.floor((logicalWidth(ctx) - blockW) / 2) -
        (reel ? REEL_CARD_INFO_LEFT_SHIFT : 0)
      : padding);
  const blockY = layout?.blockY ?? padding;

  drawBadgeBackground(ctx, blockX, blockY, blockW, blockH);

  const thumbX = blockX + padLeft + Math.floor((thumbBox - thumbW) / 2);
  const thumbY = blockY + Math.floor((blockH - thumbH) / 2);
  ctx.save();
  enableHighQuality(ctx);
  ctx.beginPath();
  ctx.roundRect(thumbX, thumbY, thumbW, thumbH, thumbRadius);
  ctx.clip();
  // Same stepped downscale as the cards — the chip is a ~10-30× reduction of a
  // full-res photo, which is exactly where a single drawImage aliases worst.
  const scale = exportScale(ctx);
  const thumb = prepareResized(
    frontImg,
    Math.round(thumbW * scale),
    Math.round(thumbH * scale),
  );
  ctx.drawImage(thumb, thumbX, thumbY, thumbW, thumbH);
  ctx.restore();

  const textX = blockX + padLeft + thumbBox + textGap;
  let textTop = blockY + (blockH - textH) / 2;
  for (const line of cardField.lines) {
    drawLabeledLine(ctx, line.label, line.value, textX, textTop, fontSize);
    textTop += fontSize + lineGap;
  }
  textTop += fieldGap - lineGap;
  for (const line of setField.lines) {
    drawLabeledLine(ctx, line.label, line.value, textX, textTop, fontSize);
    textTop += fontSize + lineGap;
  }
}

/** Centered caption; `centerY` is the vertical middle of the text. */
function drawRestorationCaption(ctx, caption, centerY) {
  const type = typeMetrics(isReelCanvas(logicalHeight(ctx)));
  ctx.font = `500 ${type.captionFont}px ${LABEL_FONT_FAMILY}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = LABEL_COLOR;
  drawTrackedText(
    ctx,
    caption,
    logicalWidth(ctx) / 2,
    centerY,
    type.captionTracking,
  );
}

/** Card-info chip → branding (draw after cards/labels/caption). */
function drawOverlays(ctx, logoImg, overlay, cardInfoLayout = null) {
  if (overlay?.cardInfo) {
    drawCardInfo(ctx, overlay.cardInfo, cardInfoLayout);
  }
  drawBranding(ctx, logoImg);
}

function cardInfoLayoutBelowContent(contentBottom, height) {
  const reel = isReelCanvas(height);
  return {
    blockY:
      contentBottom +
      (reel
        ? REEL_CARD_INFO_GAP_BELOW_CONTENT
        : CAROUSEL_CARD_INFO_GAP_BELOW_CONTENT),
    thumbBox: reel ? REEL_CARD_INFO_THUMB_SIZE : CAROUSEL_CARD_INFO_THUMB_SIZE,
  };
}

export function drawComparisonFrame(
  ctx,
  leftSource,
  rightSource,
  leftLabel,
  rightLabel,
  logoImg,
  overlay = null,
) {
  const canvasHeight = logicalHeight(ctx);
  const reel = isReelCanvas(canvasHeight);
  const cardBelow = placesCardBelow(canvasHeight);
  const type = typeMetrics(reel);
  const cols = pairLayout(reel);
  const hasCaption = Boolean(overlay?.caption);
  const hasCardInfo = Boolean(overlay?.cardInfo);
  const bottomReserve =
    cardBelow && hasCardInfo
      ? cardInfoBottomReserve(canvasHeight)
      : EDGE_PADDING;

  // Reels: reserved caption band + vertically centered stack.
  // Carousel with card-below: images sit above the chip (no Reels UI nudge).
  // Legacy top-left chip + caption: pin under the chip.
  const pinnedStack =
    hasCaption && !reel && !cardBelow ? captionStackBelowChip() : null;
  const contentTop = pinnedStack?.imagesTop ?? EDGE_PADDING;
  const captionReserve =
    reel || hasCaption ? type.captionFont + type.captionGap : 0;
  const maxImageHeight =
    canvasHeight -
    (reel || cardBelow ? EDGE_PADDING : contentTop) -
    bottomReserve -
    captionReserve -
    2 * type.labelBlockHeight;
  const leftMetrics = getContainMetrics(
    leftSource,
    cols.slotWidth,
    maxImageHeight,
  );
  const rightMetrics = getContainMetrics(
    rightSource,
    cols.slotWidth,
    maxImageHeight,
  );
  const { targetSw, targetSh } = getSharedTargetSize(
    leftMetrics,
    rightMetrics,
    cols.slotWidth,
  );

  const imagesAndLabelsHeight = targetSh + type.labelBlockHeight;
  const reelStack = reel
    ? captionStackCentered(canvasHeight, imagesAndLabelsHeight)
    : null;

  const availableH = canvasHeight - contentTop - bottomReserve;
  const imageTop = reelStack
    ? reelStack.imagesTop
    : pinnedStack
      ? pinnedStack.imagesTop
      : contentTop +
        Math.floor((availableH - imagesAndLabelsHeight) / 2);

  const leftResized = prepareCardResized(
    ctx,
    leftSource,
    leftMetrics,
    targetSw,
    targetSh,
  );
  const rightResized = prepareCardResized(
    ctx,
    rightSource,
    rightMetrics,
    targetSw,
    targetSh,
  );

  enableHighQuality(ctx);
  fillBackground(ctx);
  if (hasCaption) {
    const captionY = reelStack?.captionCenterY ?? pinnedStack?.captionCenterY;
    if (captionY != null) {
      drawRestorationCaption(ctx, overlay.caption, captionY);
    }
  }
  drawColumn(
    ctx,
    leftResized,
    leftMetrics,
    cols.leftX,
    cols.slotWidth,
    leftLabel,
    targetSw,
    targetSh,
    imageTop,
  );
  drawColumn(
    ctx,
    rightResized,
    rightMetrics,
    cols.rightX,
    cols.slotWidth,
    rightLabel,
    targetSw,
    targetSh,
    imageTop,
  );
  const cardInfoLayout =
    cardBelow && hasCardInfo
      ? cardInfoLayoutBelowContent(
          imageTop + targetSh + type.labelBlockHeight,
          canvasHeight,
        )
      : null;
  drawOverlays(ctx, logoImg, overlay, cardInfoLayout);
}

